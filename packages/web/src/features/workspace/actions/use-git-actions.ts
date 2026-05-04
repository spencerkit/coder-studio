import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import type { GitBranch, GitFileChange, GitStatus } from '@coder-studio/core';
import { dispatchCommandAtom } from '../../../atoms/connection';
import {
  branchQuickPickAtom,
  fileTreeStaleAtomFamily,
  gitBranchListAtomFamily,
  gitDiffPreviewAtomFamily,
  gitStateAtomFamily,
  type GitDiffPreview,
} from '../atoms';
import { useTranslation } from '../../../lib/i18n';
import { pushToastAtom } from '../../notifications/atoms';

export type GitChangeType = 'staged' | 'modified' | 'untracked' | 'deleted';

export interface GitChangeGroupDescriptor {
  title: string;
  type: GitChangeType;
  changes: GitFileChange[];
}

interface PendingDiscardConfirmation {
  scope: 'single' | 'all';
  paths: string[];
  filePath?: string;
}

interface GitCheckoutResult {
  success: boolean;
  message: string;
  branch?: string;
}

interface GitSyncResult {
  success: boolean;
  message: string;
  updatedFiles?: string[];
}

const GIT_SYNC_TIMEOUT_MS = 3 * 60 * 1000;

export function useGitSyncActions(workspaceId: string) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const setGitState = useSetAtom(gitStateAtomFamily(workspaceId));
  const setBranchList = useSetAtom(gitBranchListAtomFamily(workspaceId));
  const setFileTreeStale = useSetAtom(fileTreeStaleAtomFamily(workspaceId));
  const [syncingIntent, setSyncingIntent] = useState<'push' | 'pull' | null>(null);

  const refreshBranchState = useCallback(async () => {
    if (!workspaceId) {
      return false;
    }

    const [branchResult, statusResult] = await Promise.all([
      dispatch<{ current: string; branches: GitBranch[] }>('git.branches', {
        workspaceId,
      }),
      dispatch<GitStatus>('git.status', {
        workspaceId,
      }),
    ]);

    if (branchResult.ok && branchResult.data) {
      setBranchList({
        current: branchResult.data.current,
        branches: branchResult.data.branches,
        loading: false,
      });
    } else {
      setBranchList((prev) => ({
        ...prev,
        loading: false,
      }));
    }

    if (statusResult.ok && statusResult.data) {
      setGitState(statusResult.data);
    }
    return branchResult.ok && statusResult.ok;
  }, [dispatch, setBranchList, setGitState, workspaceId]);

  const runSyncAction = useCallback(
    async (
      op: 'git.push' | 'git.pull',
      options: {
        successTitle: string;
        fallbackSuccessBody?: string;
        errorTitle: string;
        markFileTreeStale?: boolean;
      }
    ) => {
      if (!workspaceId) {
        return false;
      }

      setSyncingIntent(op === 'git.push' ? 'push' : 'pull');

      try {
        const result = await dispatch<GitSyncResult>(op, { workspaceId }, { timeoutMs: GIT_SYNC_TIMEOUT_MS });

        if (!result.ok || !result.data?.success) {
          const body = result.error?.message ?? result.data?.message;
          pushToast({
            kind: 'error',
            title: options.errorTitle,
            body,
          });
          console.error(`Failed to run ${op}:`, body);
          return false;
        }

        await refreshBranchState();

        if (options.markFileTreeStale) {
          setFileTreeStale(true);
        }

        pushToast({
          kind: 'success',
          title: options.successTitle,
          body: result.data.message || options.fallbackSuccessBody,
        });

        return true;
      } finally {
        setSyncingIntent(null);
      }
    },
    [dispatch, pushToast, refreshBranchState, setFileTreeStale, workspaceId]
  );

  const handlePush = useCallback(
    async () =>
      runSyncAction('git.push', {
        successTitle: t('git.push_success_title'),
        fallbackSuccessBody: t('git.push_success_body'),
        errorTitle: t('git.push_failed_title'),
      }),
    [runSyncAction, t]
  );

  const handlePull = useCallback(
    async () =>
      runSyncAction('git.pull', {
        successTitle: t('git.pull_success_title'),
        fallbackSuccessBody: t('git.pull_success_body'),
        errorTitle: t('git.pull_failed_title'),
        markFileTreeStale: true,
      }),
    [runSyncAction, t]
  );

  return {
    handlePull,
    handlePush,
    refreshBranchState,
    syncingIntent,
  };
}

interface UseGitPanelActionsArgs {
  workspaceId: string;
  refreshToken?: number;
  onPreviewOpen?: (preview: GitDiffPreview) => void;
}

export function getFirstChange(
  status: GitStatus
): { change: GitFileChange; type: GitChangeType } | null {
  const groups: GitChangeGroupDescriptor[] = [
    { title: 'staged', type: 'staged', changes: status.staged },
    { title: 'modified', type: 'modified', changes: status.modified },
    { title: 'deleted', type: 'deleted', changes: status.deleted },
    { title: 'untracked', type: 'untracked', changes: status.untracked },
  ];

  for (const group of groups) {
    if (group.changes[0]) {
      return { change: group.changes[0], type: group.type };
    }
  }

  return null;
}

export function getChangeByPath(
  status: GitStatus,
  path: string
): { change: GitFileChange; type: GitChangeType } | null {
  const groups: Array<{ type: GitChangeType; changes: GitFileChange[] }> = [
    { type: 'staged', changes: status.staged },
    { type: 'modified', changes: status.modified },
    { type: 'deleted', changes: status.deleted },
    { type: 'untracked', changes: status.untracked },
  ];

  for (const group of groups) {
    const change = group.changes.find((item) => item.path === path);
    if (change) {
      return { change, type: group.type };
    }
  }

  return null;
}

export function useGitPanelActions({
  workspaceId,
  refreshToken = 0,
  onPreviewOpen,
}: UseGitPanelActionsArgs) {
  const t = useTranslation();
  const gitState = useAtomValue(gitStateAtomFamily(workspaceId));
  const diffPreview = useAtomValue(gitDiffPreviewAtomFamily(workspaceId));
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setGitState = useSetAtom(gitStateAtomFamily(workspaceId));
  const setBranchList = useSetAtom(gitBranchListAtomFamily(workspaceId));
  const setDiffPreview = useSetAtom(gitDiffPreviewAtomFamily(workspaceId));

  const [commitMessage, setCommitMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingDiscard, setPendingDiscard] = useState<PendingDiscardConfirmation | null>(null);
  const isLoadingRef = useRef(false);
  const pendingReloadRef = useRef(false);

  const updateBranchList = useCallback(
    (
      branchList: {
        current: string;
        branches: GitBranch[];
      } | null
    ) => {
      setBranchList({
        current: branchList?.current ?? '',
        branches: branchList?.branches ?? [],
        loading: false,
      });
    },
    [setBranchList]
  );

  const updatePreview = useCallback(
    (preview: GitDiffPreview | null) => {
      setDiffPreview(preview);
    },
    [setDiffPreview]
  );

  const requestDiff = useCallback(
    async (change: GitFileChange, type: GitChangeType): Promise<GitDiffPreview | null> => {
      const result = await dispatch<{ diff: string }>('git.diff', {
        workspaceId,
        path: change.path,
        staged: type === 'staged',
      });

      if (!result.ok || !result.data) {
        console.error('Failed to get diff:', result.error?.message);
        return null;
      }

      const preview = {
        path: change.path,
        diff: result.data.diff,
        staged: type === 'staged',
      };
      updatePreview(preview);
      return preview;
    },
    [dispatch, setDiffPreviewDismissed, updatePreview, workspaceId]
  );

  const openDiff = useCallback(
    async (change: GitFileChange, type: GitChangeType) => {
      const preview = await requestDiff(change, type);
      if (preview) {
        onPreviewOpen?.(preview);
      }
    },
    [onPreviewOpen, requestDiff]
  );

  const loadBranchList = useCallback(async () => {
    if (!workspaceId) {
      return;
    }

    setBranchList((prev) => ({
      ...prev,
      loading: true,
      error: undefined,
    }));

    const result = await dispatch<{ current: string; branches: GitBranch[] }>('git.branches', {
      workspaceId,
    });

    if (!result.ok || !result.data) {
      setBranchList((prev) => ({
        ...prev,
  const diffPreviewDismissed = useAtomValue(gitDiffPreviewDismissedAtomFamily(workspaceId));
        loading: false,
        error: result.error?.message ?? 'Failed to load branches',
      }));
      console.error('Failed to load git branches:', result.error?.message);
  const setDiffPreviewDismissed = useSetAtom(gitDiffPreviewDismissedAtomFamily(workspaceId));
      return;
    }

    updateBranchList(result.data);
  }, [dispatch, setBranchList, updateBranchList, workspaceId]);

  const loadGitStatus = useCallback(async () => {
    if (!workspaceId) {
      return;
    }

    if (isLoadingRef.current) {
      pendingReloadRef.current = true;
      return;
    }

    isLoadingRef.current = true;
    setIsLoading(true);

    try {
      const result = await dispatch<GitStatus>('git.status', {
        workspaceId,
      });

      if (!result.ok || !result.data) {
        console.error('Failed to load git status:', result.error?.message);
        return;
      }

      setGitState(result.data);

      const nextPreviewTarget =
        (diffPreview ? getChangeByPath(result.data, diffPreview.path) : null) ??
        getFirstChange(result.data);

      if (!nextPreviewTarget) {
        updatePreview(null);
        return;
      }

      if (
        !diffPreview ||
        diffPreview.path !== nextPreviewTarget.change.path ||
        Boolean(diffPreview.staged) !== (nextPreviewTarget.type === 'staged')
      ) {
        await requestDiff(nextPreviewTarget.change, nextPreviewTarget.type);
      }
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
      setDiffPreviewDismissed(false);

      if (pendingReloadRef.current) {
        pendingReloadRef.current = false;
        queueMicrotask(() => {
          void loadGitStatus();
        });
      }
    }
  }, [diffPreview, diffPreviewDismissed, dispatch, requestDiff, setGitState, updatePreview, workspaceId]);

  useEffect(() => {
    if (!gitState && !isLoadingRef.current) {
      void loadGitStatus();
    }
  }, [gitState, loadGitStatus]);

  useEffect(() => {
    void loadBranchList();
  }, [loadBranchList]);

  useEffect(() => {
    if (!gitState) {
      return;
    }

    if (diffPreview) {
      const currentChange = getChangeByPath(gitState, diffPreview.path);
      if (currentChange && Boolean(diffPreview.staged) === (currentChange.type === 'staged')) {
        return;
      }
    }

    const firstChange = getFirstChange(gitState);
    if (!firstChange) {
      updatePreview(null);
      return;
    }

    void requestDiff(firstChange.change, firstChange.type);
  }, [diffPreview, diffPreviewDismissed, gitState, requestDiff, updatePreview]);

  useEffect(() => {
    if (refreshToken > 0 && !isLoadingRef.current) {
      void loadGitStatus();
    }
  }, [refreshToken, loadGitStatus]);

  const runGitMutation = useCallback(
    async (
      op: 'git.stage' | 'git.unstage' | 'git.discard' | 'git.commit',
      args: Record<string, unknown>,
      errorMessage: string,
      afterSuccess?: () => void
    ) => {
      const result = await dispatch<void>(op, args);
      if (!result.ok) {
        console.error(errorMessage, result.error?.message);
        return false;
      }

      afterSuccess?.();
      await loadGitStatus();
      return true;
    },
    [dispatch, loadGitStatus]
  );

  const handleStageAll = useCallback(async () => {
    const paths = [
      if (diffPreviewDismissed) {
        updatePreview(null);
        return;
      }

      ...(gitState?.modified.map((file) => file.path) ?? []),
      ...(gitState?.deleted.map((file) => file.path) ?? []),
      ...(gitState?.untracked.map((file) => file.path) ?? []),
    ];

    await runGitMutation('git.stage', { workspaceId, paths }, 'Failed to stage all:');
  }, [gitState, runGitMutation, workspaceId]);

  const handleUnstageAll = useCallback(async () => {
    await runGitMutation(
      'git.unstage',
      {
        workspaceId,
        paths: gitState?.staged.map((file) => file.path) ?? [],
      },
      'Failed to unstage all:'
    );
  }, [gitState, runGitMutation, workspaceId]);

  const handleDiscardAll = useCallback(() => {
    const paths = [
      ...(gitState?.staged.map((file) => file.path) ?? []),
      ...(gitState?.modified.map((file) => file.path) ?? []),
      ...(gitState?.deleted.map((file) => file.path) ?? []),
      ...(gitState?.untracked.map((file) => file.path) ?? []),
    ];

    if (!paths.length) {
      return;
    }

    setPendingDiscard({
      scope: 'all',
      paths,
    });
  }, [gitState]);

  const handleRequestDiscardSingle = useCallback((path: string) => {
    setPendingDiscard({
      scope: 'single',
      paths: [path],
      filePath: path,
    });
  }, []);

  const handleCancelDiscard = useCallback(() => {
    setPendingDiscard(null);
  }, []);

  const handleConfirmDiscard = useCallback(async () => {
    if (!pendingDiscard) {
      return;
    if (diffPreviewDismissed) {
      return;
    }

    }

    const nextDiscard = pendingDiscard;
    setPendingDiscard(null);

    await runGitMutation(
      'git.discard',
      {
        workspaceId,
        paths: nextDiscard.paths,
      },
      nextDiscard.scope === 'all' ? 'Failed to discard all:' : 'Failed to discard:'
    );
  }, [pendingDiscard, runGitMutation, workspaceId]);

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim() || !gitState?.staged.length) {
      return;
    }

    await runGitMutation(
      'git.commit',
      {
        workspaceId,
        message: commitMessage.trim(),
      },
      'Failed to commit:',
      () => setCommitMessage('')
    );
  }, [commitMessage, gitState?.staged.length, runGitMutation, workspaceId]);

  const hasChanges = Boolean(
    gitState &&
      (
        gitState.staged.length > 0 ||
        gitState.modified.length > 0 ||
        gitState.untracked.length > 0 ||
        gitState.deleted.length > 0
      )
  );

  const groups = useMemo<GitChangeGroupDescriptor[]>(
    () =>
      [
        { title: 'staged', type: 'staged', changes: gitState?.staged ?? [] },
        { title: 'changes', type: 'modified', changes: gitState?.modified ?? [] },
        { title: 'deleted', type: 'deleted', changes: gitState?.deleted ?? [] },
        { title: 'untracked', type: 'untracked', changes: gitState?.untracked ?? [] },
      ].filter((group) => group.changes.length > 0),
    [gitState]
  );

  return {
    commitMessage,
    diffPreview,
    gitState,
    groups,
    hasChanges,
    isLoading,
    pendingDiscard,
    setCommitMessage,
    handleCancelDiscard,
    handleCommit,
    handleConfirmDiscard,
    handleDiscardAll,
    handleRequestDiscardSingle,
    handleStageAll,
    handleUnstageAll,
    loadGitStatus,
    openDiff,
    requestDiff,
    runGitMutation,
    t,
  };
}

export function useGitDiffViewerActions(workspaceId: string) {
  const preview = useAtomValue(gitDiffPreviewAtomFamily(workspaceId));
  const setPreview = useSetAtom(gitDiffPreviewAtomFamily(workspaceId));

  return {
    closePreview: () => {
      setPreviewDismissed(true);
      setPreview(null);
    },
    preview,
  };
}

export function useBranchQuickPickActions() {
  const t = useTranslation();
  const quickPickState = useAtomValue(branchQuickPickAtom);
  const setQuickPick = useSetAtom(branchQuickPickAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const workspaceId = quickPickState.workspaceId;
  const branchList = useAtomValue(gitBranchListAtomFamily(workspaceId ?? ''));
  const setBranchList = useSetAtom(gitBranchListAtomFamily(workspaceId ?? ''));
  const { refreshBranchState } = useGitSyncActions(workspaceId ?? '');

  const [inputValue, setInputValue] = useState(quickPickState.inputValue);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingCreateBranchName, setPendingCreateBranchName] = useState<string | null>(null);

  useEffect(() => {
    setInputValue(quickPickState.inputValue);
  }, [quickPickState.inputValue]);

  useEffect(() => {
    if (quickPickState.visible) {
      setSelectedIndex(0);
      setPendingCreateBranchName(null);
    }
  }, [quickPickState.visible]);

  useEffect(() => {
    if (!quickPickState.visible || !workspaceId) {
      return;
    }

    if (branchList.branches.length > 0) {
      setBranchList((prev) => ({
        ...prev,
        loading: false,
        error: undefined,
      }));
      return;
    }

    let cancelled = false;

    setBranchList((prev) => ({
      ...prev,
      loading: true,
      error: undefined,
    }));

    void dispatch<{ current: string; branches: GitBranch[] }>('git.branches', {
      workspaceId,
    })
      .then((result) => {
        if (cancelled) {
          return;
        }

        if (!result.ok || !result.data) {
          setBranchList((prev) => ({
            ...prev,
            loading: false,
            error: result.error?.message ?? 'Failed to load branches',
          }));
          console.error('Failed to load git branches:', result.error?.message);
          return;
        }

        setBranchList({
          current: result.data.current,
          branches: result.data.branches,
          loading: false,
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setBranchList((prev) => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to load branches',
        }));
        console.error('Failed to load git branches:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [branchList.branches.length, dispatch, quickPickState.visible, setBranchList, workspaceId]);

  const trimmedInput = inputValue.trim();

  const filteredBranches = useMemo(
  const setPreviewDismissed = useSetAtom(gitDiffPreviewDismissedAtomFamily(workspaceId));
    () =>
      branchList.branches.filter((branch) =>
        branch.name.toLowerCase().includes(inputValue.toLowerCase())
      ),
    [branchList.branches, inputValue]
  );

  const exactMatch = filteredBranches.find(
    (branch) => branch.name.toLowerCase() === inputValue.toLowerCase()
  );

  const displayItems = useMemo<
    Array<{
      type: 'branch' | 'create' | 'confirm-create';
      branch?: GitBranch;
      label: string;
    }>
  >(() => {
    const items: Array<{
      type: 'branch' | 'create' | 'confirm-create';
      branch?: GitBranch;
      label: string;
    }> = [];

    filteredBranches.forEach((branch) => {
      items.push({
        type: 'branch',
        branch,
        label: branch.name,
      });
    });

    if (!exactMatch && trimmedInput && !branchList.loading) {
      items.push({
        type: pendingCreateBranchName === trimmedInput ? 'confirm-create' : 'create',
        label:
          pendingCreateBranchName === trimmedInput
            ? t('git.quick_pick.confirm_create', { name: trimmedInput })
            : t('git.quick_pick.create', { name: trimmedInput }),
      });
    }

    return items;
  }, [branchList.loading, exactMatch, filteredBranches, pendingCreateBranchName, t, trimmedInput]);

  const handleClose = useCallback(() => {
    setPendingCreateBranchName(null);
    setQuickPick({
      visible: false,
      inputValue: '',
    });
  }, [setQuickPick]);

  const handleRequestBranchCreate = useCallback((branchName: string) => {
    if (!branchName) {
      return;
    }

    setPendingCreateBranchName(branchName);
  }, []);

  const handleBranchSelect = useCallback(
    async (branchName: string) => {
      if (!workspaceId) {
        return;
      }

      const result = await dispatch<GitCheckoutResult>('git.checkout', {
        workspaceId,
        ref: branchName,
      });

      if (!result.ok || !result.data?.success) {
        console.error('Failed to checkout branch:', result.error?.message ?? result.data?.message);
        return;
      }

      await refreshBranchState();
      handleClose();
    },
    [dispatch, handleClose, refreshBranchState, workspaceId]
  );

  const handleBranchCreate = useCallback(
    async (branchName: string) => {
      if (!workspaceId || !branchName) {
        return;
      }

      const result = await dispatch<GitCheckoutResult>('git.checkout', {
        workspaceId,
        ref: branchName,
        createBranch: true,
      });

      if (!result.ok || !result.data?.success) {
        console.error('Failed to create branch:', result.error?.message ?? result.data?.message);
        return;
      }

      await refreshBranchState();
      handleClose();
    },
    [dispatch, handleClose, refreshBranchState, workspaceId]
  );

  return {
    branchList,
    displayItems,
    filteredBranches,
    handleBranchCreate,
    handleBranchSelect,
    handleClose,
    handleRequestBranchCreate,
    inputValue,
    pendingCreateBranchName,
    quickPickState,
    selectedIndex,
    setInputValue,
    setPendingCreateBranchName,
    setSelectedIndex,
    trimmedInput,
  };
}
