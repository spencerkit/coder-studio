import type {
  GitBranch,
  GitCommitDetail,
  GitCommitSummary,
  GitFileChange,
  GitFileDiffPayload,
  GitStatus,
} from "@coder-studio/core";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { useTranslation } from "../../../lib/i18n";
import { pushToastAtom } from "../../notifications/atoms";
import {
  activeFilePathAtomFamily,
  branchQuickPickAtom,
  commitMessageDraftAtomFamily,
  editorModeAtomFamily,
  fileTreeStaleAtomFamily,
  type GitDiffPreview,
  gitBranchListAtomFamily,
  gitDiffPreviewAtomFamily,
  gitDiffPreviewDismissedAtomFamily,
  gitFetchAtomFamily,
  gitStateAtomFamily,
} from "../atoms";

export type GitChangeType = "staged" | "modified" | "untracked" | "deleted";

export interface GitPanelChangeItem {
  change: GitFileChange;
  type: GitChangeType;
}

export interface GitChangeGroupDescriptor {
  title: string;
  changes: GitPanelChangeItem[];
}

interface PendingDiscardConfirmation {
  scope: "single" | "all";
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
  remote?: string;
  branch?: string;
  updated?: boolean;
  updatedFiles?: string[];
}

export interface GitAuthFailureDetails {
  operation: "push" | "pull" | "fetch";
  remote?: string;
  remoteUrl?: string;
  remoteLabel: string;
  host?: string;
  reason: "missing_credentials" | "invalid_credentials" | "authorization_failed";
  authMode: "username_password" | "unsupported";
  canPrompt: boolean;
  usernameHint?: string;
}

export interface GitSyncAuthPromptState {
  intent: "push" | "pull" | "fetch";
  details: GitAuthFailureDetails;
}

function isCommitPreview(
  preview: GitDiffPreview | null
): preview is Extract<GitDiffPreview, { kind: "commit-file-list" | "commit-file-diff" }> {
  return preview?.kind === "commit-file-list" || preview?.kind === "commit-file-diff";
}

const GIT_SYNC_TIMEOUT_MS = 3 * 60 * 1000;
const GIT_OPERATION_LABELS: Record<"push" | "pull" | "fetch", string> = {
  push: "git.operation_push",
  pull: "git.operation_pull",
  fetch: "git.operation_fetch",
};

function formatGitSyncTarget(remote?: string, branch?: string): string | null {
  if (remote && branch) {
    return `${remote}/${branch}`;
  }
  return null;
}

export function useGitSyncActions(workspaceId: string) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const setGitState = useSetAtom(gitStateAtomFamily(workspaceId));
  const setBranchList = useSetAtom(gitBranchListAtomFamily(workspaceId));
  const setFileTreeStale = useSetAtom(fileTreeStaleAtomFamily(workspaceId));
  const setFetchState = useSetAtom(gitFetchAtomFamily(workspaceId));
  const [syncingIntent, setSyncingIntent] = useState<"push" | "pull" | "fetch" | null>(null);
  const [authPrompt, setAuthPrompt] = useState<GitSyncAuthPromptState | null>(null);

  const getAuthPromptMessage = useCallback(
    (details: GitAuthFailureDetails) => {
      if (!details.canPrompt) {
        return t("git.auth_failed_unsupported", { remote: details.remoteLabel });
      }

      if (details.reason === "invalid_credentials") {
        return t("git.auth_failed_invalid", { remote: details.remoteLabel });
      }

      if (details.reason === "authorization_failed") {
        return t("git.auth_failed_forbidden", {
          remote: details.remoteLabel,
          operation: t(GIT_OPERATION_LABELS[details.operation]),
        });
      }

      return t("git.auth_required_message", { remote: details.remoteLabel });
    },
    [t]
  );

  const getSuccessToastBody = useCallback(
    (
      op: "git.push" | "git.pull" | "git.fetch",
      result: GitSyncResult,
      fallbackSuccessBody?: string
    ) => {
      if (op === "git.fetch") {
        return result.message || fallbackSuccessBody;
      }

      const target = formatGitSyncTarget(result.remote, result.branch);
      if (target) {
        if (op === "git.push") {
          return result.updated
            ? t("git.push_success_target", { target })
            : t("git.sync_up_to_date", { target });
        }

        return result.updated
          ? t("git.pull_success_target", { target })
          : t("git.sync_up_to_date", { target });
      }

      return result.message || fallbackSuccessBody;
    },
    [t]
  );

  const refreshBranchState = useCallback(async () => {
    if (!workspaceId) {
      return false;
    }

    const [branchResult, statusResult] = await Promise.all([
      dispatch<{ current: string; branches: GitBranch[] }>("git.branches", {
        workspaceId,
      }),
      dispatch<GitStatus>("git.status", {
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
      op: "git.push" | "git.pull" | "git.fetch",
      options: {
        successTitle: string;
        fallbackSuccessBody?: string;
        errorTitle: string;
        markFileTreeStale?: boolean;
        auth?: {
          username: string;
          password: string;
        };
      }
    ) => {
      if (!workspaceId) {
        return false;
      }

      const isFetch = op === "git.fetch";
      if (isFetch) {
        setFetchState((prev) => ({ ...prev, status: "fetching", error: undefined }));
        setSyncingIntent("fetch");
      } else {
        setSyncingIntent(op === "git.push" ? "push" : "pull");
      }

      try {
        const result = await dispatch<GitSyncResult>(
          op,
          {
            workspaceId,
            ...(options.auth ? { auth: options.auth } : {}),
          },
          { timeoutMs: GIT_SYNC_TIMEOUT_MS }
        );

        if (!result.ok || !result.data?.success) {
          const body = result.error?.message ?? result.data?.message;
          if (
            (result.error?.code === "git_auth_required" ||
              result.error?.code === "git_auth_failed") &&
            result.error.details &&
            typeof result.error.details === "object"
          ) {
            if (isFetch) {
              setFetchState((prev) => ({
                ...prev,
                status: "error",
                error: body,
              }));
            }
            const details = result.error.details as GitAuthFailureDetails;
            const intent = op === "git.push" ? "push" : op === "git.pull" ? "pull" : "fetch";
            setAuthPrompt({
              intent,
              details: {
                ...details,
                usernameHint:
                  authPrompt?.intent === intent
                    ? authPrompt.details.usernameHint
                    : details.usernameHint,
              },
            });
            return false;
          }

          if (options.auth) {
            setAuthPrompt(null);
          }

          if (isFetch) {
            setFetchState((prev) => ({
              ...prev,
              status: "error",
              error: body,
            }));
          }

          pushToast({
            kind: "error",
            title: options.errorTitle,
            body,
          });
          console.error(`Failed to run ${op}:`, body);
          return false;
        }

        const refreshed = await refreshBranchState();
        if (!refreshed) {
          if (isFetch) {
            const message = t("git.fetch_refresh_failed_body");
            setFetchState((prev) => ({
              ...prev,
              status: "error",
              error: message,
            }));
            pushToast({
              kind: "error",
              title: options.errorTitle,
              body: message,
            });
            return false;
          }
        }

        if (options.markFileTreeStale) {
          setFileTreeStale(true);
        }

        if (isFetch) {
          setFetchState({
            status: "idle",
            lastFetchAt: Date.now(),
          });
        }

        pushToast({
          kind: "success",
          title: options.successTitle,
          body: getSuccessToastBody(op, result.data, options.fallbackSuccessBody),
        });

        return true;
      } finally {
        setSyncingIntent(null);
      }
    },
    [
      authPrompt,
      dispatch,
      getSuccessToastBody,
      pushToast,
      refreshBranchState,
      setFetchState,
      setFileTreeStale,
      t,
      workspaceId,
    ]
  );

  const handlePush = useCallback(
    async (auth?: { username: string; password: string }) =>
      runSyncAction("git.push", {
        successTitle: t("git.push_success_title"),
        fallbackSuccessBody: t("git.push_success_body"),
        errorTitle: t("git.push_failed_title"),
        auth,
      }),
    [runSyncAction, t]
  );

  const handlePull = useCallback(
    async (auth?: { username: string; password: string }) =>
      runSyncAction("git.pull", {
        successTitle: t("git.pull_success_title"),
        fallbackSuccessBody: t("git.pull_success_body"),
        errorTitle: t("git.pull_failed_title"),
        markFileTreeStale: true,
        auth,
      }),
    [runSyncAction, t]
  );

  const handleFetch = useCallback(
    async (auth?: { username: string; password: string }) =>
      runSyncAction("git.fetch", {
        successTitle: t("git.fetch_success_title"),
        fallbackSuccessBody: t("git.fetch_success_body"),
        errorTitle: t("git.fetch_failed_title"),
        auth,
      }),
    [runSyncAction, t]
  );

  return {
    authPrompt,
    clearAuthPrompt: () => setAuthPrompt(null),
    setAuthPrompt,
    getAuthPromptMessage,
    handleFetch,
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
  initialHistoryLimit?: number;
}

export function getFirstChange(
  status: GitStatus
): { change: GitFileChange; type: GitChangeType } | null {
  const groups: Array<{ title: string; type: GitChangeType; changes: GitFileChange[] }> = [
    { title: "staged", type: "staged", changes: status.staged },
    { title: "modified", type: "modified", changes: status.modified },
    { title: "deleted", type: "deleted", changes: status.deleted },
    { title: "untracked", type: "untracked", changes: status.untracked },
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
    { type: "staged", changes: status.staged },
    { type: "modified", changes: status.modified },
    { type: "deleted", changes: status.deleted },
    { type: "untracked", changes: status.untracked },
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
  initialHistoryLimit = 5,
}: UseGitPanelActionsArgs) {
  const t = useTranslation();
  const gitState = useAtomValue(gitStateAtomFamily(workspaceId));
  const diffPreview = useAtomValue(gitDiffPreviewAtomFamily(workspaceId));
  const diffPreviewDismissed = useAtomValue(gitDiffPreviewDismissedAtomFamily(workspaceId));
  const dispatch = useAtomValue(dispatchCommandAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const setGitState = useSetAtom(gitStateAtomFamily(workspaceId));
  const setBranchList = useSetAtom(gitBranchListAtomFamily(workspaceId));
  const setDiffPreview = useSetAtom(gitDiffPreviewAtomFamily(workspaceId));
  const setDiffPreviewDismissed = useSetAtom(gitDiffPreviewDismissedAtomFamily(workspaceId));
  const setActiveFilePath = useSetAtom(activeFilePathAtomFamily(workspaceId));
  const setEditorMode = useSetAtom(editorModeAtomFamily(workspaceId));

  const [commitMessage, setCommitMessage] = useAtom(commitMessageDraftAtomFamily(workspaceId));
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<GitCommitSummary[]>([]);
  const [historyLimit, setHistoryLimit] = useState(initialHistoryLimit);
  const [historyLoading, setHistoryLoading] = useState(false);
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
        current: branchList?.current ?? "",
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
      const result = await dispatch<GitFileDiffPayload>("git.diff", {
        workspaceId,
        path: change.path,
        staged: type === "staged",
      });

      if (!result.ok || !result.data) {
        console.error("Failed to get diff:", result.error?.message);
        return null;
      }

      const preview: GitDiffPreview = {
        kind: "worktree-file-diff" as const,
        path: change.path,
        diff: result.data.diff,
        staged: type === "staged",
        ...(result.data.renderAs ? { renderAs: result.data.renderAs } : {}),
        ...(result.data.status ? { status: result.data.status } : {}),
        ...(result.data.mime ? { mime: result.data.mime } : {}),
        ...(result.data.originalPath ? { originalPath: result.data.originalPath } : {}),
        ...(result.data.modifiedPath ? { modifiedPath: result.data.modifiedPath } : {}),
        ...(result.data.originalContent !== undefined
          ? { originalContent: result.data.originalContent }
          : {}),
        ...(result.data.modifiedContent !== undefined
          ? { modifiedContent: result.data.modifiedContent }
          : {}),
        ...(result.data.originalRevision ? { originalRevision: result.data.originalRevision } : {}),
        ...(result.data.modifiedRevision ? { modifiedRevision: result.data.modifiedRevision } : {}),
      };
      setDiffPreviewDismissed(false);
      updatePreview(preview);
      setActiveFilePath(change.path);
      setEditorMode("diff");
      return preview;
    },
    [
      dispatch,
      setActiveFilePath,
      setDiffPreviewDismissed,
      setEditorMode,
      updatePreview,
      workspaceId,
    ]
  );

  const openHistoryDiff = useCallback(
    async (entry: GitCommitSummary) => {
      const result = await dispatch<GitCommitDetail>("git.commitDetail", {
        workspaceId,
        sha: entry.sha,
      });

      if (!result.ok || !result.data) {
        console.error("Failed to get commit detail:", result.error?.message);
        return null;
      }

      const preview = {
        kind: "commit-file-list" as const,
        path: entry.sha,
        title: `${entry.shortSha} · ${entry.subject}`,
        commit: result.data.commit,
        files: result.data.files,
      };
      setDiffPreviewDismissed(false);
      updatePreview(preview);
      onPreviewOpen?.(preview);
      return preview;
    },
    [dispatch, onPreviewOpen, setDiffPreviewDismissed, updatePreview, workspaceId]
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

    const result = await dispatch<{ current: string; branches: GitBranch[] }>("git.branches", {
      workspaceId,
    });

    if (!result.ok || !result.data) {
      setBranchList((prev) => ({
        ...prev,
        loading: false,
        error: result.error?.message ?? "Failed to load branches",
      }));
      console.error("Failed to load git branches:", result.error?.message);
      return;
    }

    updateBranchList(result.data);
  }, [dispatch, setBranchList, updateBranchList, workspaceId]);

  const loadGitHistory = useCallback(
    async (limit = historyLimit) => {
      if (!workspaceId) {
        return;
      }

      setHistoryLoading(true);
      try {
        const result = await dispatch<{ entries?: GitCommitSummary[] }>("git.log", {
          workspaceId,
          limit,
        });

        if (!result.ok) {
          console.error("Failed to load git history:", result.error?.message);
          setHistory([]);
          return;
        }

        setHistory(Array.isArray(result.data?.entries) ? result.data.entries : []);
      } finally {
        setHistoryLoading(false);
      }
    },
    [dispatch, historyLimit, workspaceId]
  );

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
      const result = await dispatch<GitStatus>("git.status", {
        workspaceId,
      });

      if (!result.ok || !result.data) {
        console.error("Failed to load git status:", result.error?.message);
        return;
      }

      setGitState(result.data);

      if (diffPreviewDismissed) {
        updatePreview(null);
        return;
      }

      if (isCommitPreview(diffPreview)) {
        return;
      }

      if (!diffPreview) {
        return;
      }

      const currentPreviewTarget = getChangeByPath(result.data, diffPreview.path);
      if (!currentPreviewTarget) {
        updatePreview(null);
        return;
      }

      if (Boolean(diffPreview.staged) !== (currentPreviewTarget.type === "staged")) {
        await requestDiff(currentPreviewTarget.change, currentPreviewTarget.type);
      }
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);

      if (pendingReloadRef.current) {
        pendingReloadRef.current = false;
        queueMicrotask(() => {
          void loadGitStatus();
        });
      }
    }
  }, [
    diffPreview,
    diffPreviewDismissed,
    dispatch,
    requestDiff,
    setGitState,
    updatePreview,
    workspaceId,
  ]);

  useEffect(() => {
    if (!gitState && !isLoadingRef.current) {
      void loadGitStatus();
    }
  }, [gitState, loadGitStatus]);

  useEffect(() => {
    void loadBranchList();
  }, [loadBranchList]);

  useEffect(() => {
    void loadGitHistory(historyLimit);
  }, [gitState?.headSha, historyLimit, loadGitHistory]);

  useEffect(() => {
    if (!gitState) {
      return;
    }

    if (diffPreviewDismissed) {
      return;
    }

    if (isCommitPreview(diffPreview)) {
      return;
    }

    if (!diffPreview) {
      return;
    }

    const currentChange = getChangeByPath(gitState, diffPreview.path);
    if (!currentChange) {
      updatePreview(null);
      return;
    }

    if (Boolean(diffPreview.staged) !== (currentChange.type === "staged")) {
      void requestDiff(currentChange.change, currentChange.type);
    }
  }, [diffPreview, diffPreviewDismissed, gitState, requestDiff, updatePreview]);

  useEffect(() => {
    if (refreshToken > 0 && !isLoadingRef.current) {
      void loadGitStatus();
    }
  }, [refreshToken, loadGitStatus]);

  const runGitMutation = useCallback(
    async (
      op: "git.stage" | "git.unstage" | "git.discard" | "git.commit",
      args: Record<string, unknown>,
      errorMessage: string,
      errorTitle: string,
      afterSuccess?: () => void
    ) => {
      const result = await dispatch<void>(op, args);
      if (!result.ok) {
        pushToast({
          kind: "error",
          title: errorTitle,
          body: result.error?.message ?? errorMessage,
        });
        console.error(errorMessage, result.error?.message);
        return false;
      }

      afterSuccess?.();
      await loadGitStatus();
      return true;
    },
    [dispatch, loadGitStatus, pushToast]
  );

  const stagePaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) {
        return;
      }

      await runGitMutation(
        "git.stage",
        { workspaceId, paths },
        "Failed to stage all:",
        t("git.stage_failed_title")
      );
    },
    [runGitMutation, t, workspaceId]
  );

  const unstagePaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) {
        return;
      }

      await runGitMutation(
        "git.unstage",
        { workspaceId, paths },
        "Failed to unstage all:",
        t("git.unstage_failed_title")
      );
    },
    [runGitMutation, t, workspaceId]
  );

  const handleStageAll = useCallback(async () => {
    await stagePaths([
      ...(gitState?.modified.map((file) => file.path) ?? []),
      ...(gitState?.deleted.map((file) => file.path) ?? []),
      ...(gitState?.untracked.map((file) => file.path) ?? []),
    ]);
  }, [gitState, stagePaths]);

  const handleUnstageAll = useCallback(async () => {
    await unstagePaths(gitState?.staged.map((file) => file.path) ?? []);
  }, [gitState, unstagePaths]);

  const handleDiscardAll = useCallback(() => {
    const paths = [
      ...(gitState?.modified.map((file) => file.path) ?? []),
      ...(gitState?.deleted.map((file) => file.path) ?? []),
      ...(gitState?.untracked.map((file) => file.path) ?? []),
    ];

    if (!paths.length) {
      return;
    }

    setPendingDiscard({
      scope: "all",
      paths,
    });
  }, [gitState]);

  const handleRequestDiscardPaths = useCallback((paths: string[]) => {
    if (!paths.length) {
      return;
    }

    setPendingDiscard({
      scope: "all",
      paths,
    });
  }, []);

  const handleRequestDiscardSingle = useCallback((path: string) => {
    setPendingDiscard({
      scope: "single",
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
    }

    const nextDiscard = pendingDiscard;
    setPendingDiscard(null);

    await runGitMutation(
      "git.discard",
      {
        workspaceId,
        paths: nextDiscard.paths,
      },
      nextDiscard.scope === "all" ? "Failed to discard all:" : "Failed to discard:",
      t("git.discard_failed_title")
    );
  }, [pendingDiscard, runGitMutation, t, workspaceId]);

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim() || !gitState?.staged.length) {
      return;
    }

    await runGitMutation(
      "git.commit",
      {
        workspaceId,
        message: commitMessage.trim(),
      },
      "Failed to commit:",
      t("git.commit_failed_title"),
      () => setCommitMessage("")
    );
  }, [commitMessage, gitState?.staged.length, runGitMutation, t, workspaceId]);

  const hasChanges = Boolean(
    gitState &&
      (gitState.staged.length > 0 ||
        gitState.modified.length > 0 ||
        gitState.untracked.length > 0 ||
        gitState.deleted.length > 0)
  );

  const groups = useMemo<GitChangeGroupDescriptor[]>(
    () =>
      [
        {
          title: "staged",
          changes: (gitState?.staged ?? []).map((change) => ({ change, type: "staged" as const })),
        },
        {
          title: "changes",
          changes: [
            ...(gitState?.modified ?? []).map((change) => ({ change, type: "modified" as const })),
            ...(gitState?.deleted ?? []).map((change) => ({ change, type: "deleted" as const })),
            ...(gitState?.untracked ?? []).map((change) => ({
              change,
              type: "untracked" as const,
            })),
          ],
        },
      ].filter((group) => group.changes.length > 0),
    [gitState]
  );

  return {
    commitMessage,
    diffPreview,
    gitState,
    groups,
    hasChanges,
    history,
    historyLimit,
    historyLoading,
    isLoading,
    pendingDiscard,
    canShowMoreHistory: historyLimit < 10 && history.length > 0,
    setCommitMessage,
    handleCancelDiscard,
    handleCommit,
    handleConfirmDiscard,
    handleDiscardAll,
    handleRequestDiscardPaths,
    handleRequestDiscardSingle,
    handleStageAll,
    handleStagePaths: stagePaths,
    handleUnstageAll,
    handleUnstagePaths: unstagePaths,
    loadGitStatus,
    loadGitHistory,
    openDiff,
    openHistoryDiff,
    requestDiff,
    runGitMutation,
    showMoreHistory: () => setHistoryLimit(10),
    t,
  };
}

export function useGitDiffViewerActions(workspaceId: string) {
  const preview = useAtomValue(gitDiffPreviewAtomFamily(workspaceId));
  const setPreview = useSetAtom(gitDiffPreviewAtomFamily(workspaceId));
  const setPreviewDismissed = useSetAtom(gitDiffPreviewDismissedAtomFamily(workspaceId));

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
  const pushToast = useSetAtom(pushToastAtom);
  const workspaceId = quickPickState.workspaceId;
  const branchList = useAtomValue(gitBranchListAtomFamily(workspaceId ?? ""));
  const setBranchList = useSetAtom(gitBranchListAtomFamily(workspaceId ?? ""));
  const { refreshBranchState } = useGitSyncActions(workspaceId ?? "");

  const [inputValue, setInputValue] = useState(quickPickState.inputValue);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingCreateBranchName, setPendingCreateBranchName] = useState<string | null>(null);

  useEffect(() => {
    setInputValue(quickPickState.inputValue);
  }, [quickPickState.inputValue]);

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

    void dispatch<{ current: string; branches: GitBranch[] }>("git.branches", {
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
            error: result.error?.message ?? "Failed to load branches",
          }));
          console.error("Failed to load git branches:", result.error?.message);
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
          error: error instanceof Error ? error.message : "Failed to load branches",
        }));
        console.error("Failed to load git branches:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [branchList.branches.length, dispatch, quickPickState.visible, setBranchList, workspaceId]);

  const trimmedInput = inputValue.trim();

  const filteredBranches = useMemo(
    () =>
      branchList.branches.filter(
        (branch) =>
          (branch.isCurrent || !branch.linkedWorktreePath) &&
          branch.name.toLowerCase().includes(inputValue.toLowerCase())
      ),
    [branchList.branches, inputValue]
  );

  const isBranchSelectable = useCallback(
    (branch: GitBranch) => branch.isCurrent || !branch.linkedWorktreePath,
    []
  );

  const exactMatch = filteredBranches.find(
    (branch) => branch.name.toLowerCase() === inputValue.toLowerCase()
  );

  const displayItems = useMemo<
    Array<{
      type: "branch" | "create" | "confirm-create";
      branch?: GitBranch;
      label: string;
    }>
  >(() => {
    const items: Array<{
      type: "branch" | "create" | "confirm-create";
      branch?: GitBranch;
      label: string;
    }> = [];

    filteredBranches.forEach((branch) => {
      items.push({
        type: "branch",
        branch,
        label: branch.name,
      });
    });

    if (!exactMatch && trimmedInput && !branchList.loading) {
      items.push({
        type: pendingCreateBranchName === trimmedInput ? "confirm-create" : "create",
        label:
          pendingCreateBranchName === trimmedInput
            ? t("git.quick_pick.confirm_create", { name: trimmedInput })
            : t("git.quick_pick.create", { name: trimmedInput }),
      });
    }

    return items;
  }, [branchList.loading, exactMatch, filteredBranches, pendingCreateBranchName, t, trimmedInput]);

  const currentBranchIndex = useMemo(
    () =>
      displayItems.findIndex(
        (item) =>
          item.type === "branch" &&
          item.branch &&
          (item.branch.isCurrent || item.branch.name === branchList.current)
      ),
    [branchList.current, displayItems]
  );

  useEffect(() => {
    if (!quickPickState.visible) {
      return;
    }

    setPendingCreateBranchName(null);

    if (trimmedInput) {
      setSelectedIndex(0);
      return;
    }

    setSelectedIndex(currentBranchIndex >= 0 ? currentBranchIndex : 0);
  }, [currentBranchIndex, quickPickState.visible, trimmedInput]);

  const handleClose = useCallback(() => {
    setPendingCreateBranchName(null);
    setQuickPick({
      visible: false,
      inputValue: "",
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

      const result = await dispatch<GitCheckoutResult>("git.checkout", {
        workspaceId,
        ref: branchName,
      });

      if (!result.ok || !result.data?.success) {
        const errorMessage = result.error?.message ?? result.data?.message;
        console.error("Failed to checkout branch:", errorMessage);
        pushToast({
          kind: "error",
          title: t("git.quick_pick.checkout_failed_title"),
          body: errorMessage || t("git.quick_pick.checkout_failed_body", { name: branchName }),
        });
        return;
      }

      await refreshBranchState();
      handleClose();
    },
    [dispatch, handleClose, pushToast, refreshBranchState, t, workspaceId]
  );

  const handleBranchCreate = useCallback(
    async (branchName: string) => {
      if (!workspaceId || !branchName) {
        return;
      }

      const result = await dispatch<GitCheckoutResult>("git.checkout", {
        workspaceId,
        ref: branchName,
        createBranch: true,
      });

      if (!result.ok || !result.data?.success) {
        const errorMessage = result.error?.message ?? result.data?.message;
        console.error("Failed to create branch:", errorMessage);
        pushToast({
          kind: "error",
          title: t("git.quick_pick.create_failed_title"),
          body: errorMessage || t("git.quick_pick.create_failed_body", { name: branchName }),
        });
        return;
      }

      await refreshBranchState();
      handleClose();
    },
    [dispatch, handleClose, pushToast, refreshBranchState, t, workspaceId]
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
    isBranchSelectable,
    pendingCreateBranchName,
    quickPickState,
    selectedIndex,
    setInputValue,
    setPendingCreateBranchName,
    setSelectedIndex,
    trimmedInput,
  };
}
