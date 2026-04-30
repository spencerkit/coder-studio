import type { FC } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue, useStore } from 'jotai';
import {
  AlertTriangle,
  ArrowUp,
  File,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import type { GitBranch, GitFileChange, GitStatus } from '@coder-studio/core';
import {
  gitBranchListAtomFamily,
  gitDiffPreviewAtomFamily,
  gitStateAtomFamily,
  type GitDiffPreview,
} from '../../../atoms/git';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { useTranslation } from '../../../lib/i18n';

interface GitPanelProps {
  workspaceId: string;
  refreshToken?: number;
}

type GitChangeType = 'staged' | 'modified' | 'untracked' | 'deleted';

interface GitChangeGroupDescriptor {
  title: string;
  type: GitChangeType;
  changes: GitFileChange[];
}

interface PendingDiscardConfirmation {
  scope: 'single' | 'all';
  paths: string[];
  filePath?: string;
}

function getFirstChange(status: GitStatus): { change: GitFileChange; type: GitChangeType } | null {
  const groups: GitChangeGroupDescriptor[] = [
    { title: 'Staged', type: 'staged', changes: status.staged },
    { title: 'Changes', type: 'modified', changes: status.modified },
    { title: 'Deleted', type: 'deleted', changes: status.deleted },
    { title: 'Untracked', type: 'untracked', changes: status.untracked },
  ];

  for (const group of groups) {
    if (group.changes[0]) {
      return { change: group.changes[0], type: group.type };
    }
  }

  return null;
}

function getChangeByPath(
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

export const GitPanel: FC<GitPanelProps> = ({ workspaceId, refreshToken = 0 }) => {
  const t = useTranslation();
  const store = useStore();
  const gitState = useAtomValue(gitStateAtomFamily(workspaceId));
  const diffPreview = useAtomValue(gitDiffPreviewAtomFamily(workspaceId));
  const dispatch = useAtomValue(dispatchCommandAtom);

  console.log('[GitPanel] Render - gitState:', gitState ? `${gitState.staged.length} staged, ${gitState.modified.length} modified` : 'null', 'diffPreview:', diffPreview?.path ?? 'null', 'refreshToken:', refreshToken);

  const [commitMessage, setCommitMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingDiscard, setPendingDiscard] = useState<PendingDiscardConfirmation | null>(null);
  const isLoadingRef = useRef(false);

  const setGitState = useCallback(
    (status: GitStatus | null) => {
      store.set(gitStateAtomFamily(workspaceId), status);
    },
    [store, workspaceId]
  );

  const setBranchList = useCallback(
    (
      branchList: {
        current: string;
        branches: GitBranch[];
      } | null
    ) => {
      store.set(gitBranchListAtomFamily(workspaceId), {
        current: branchList?.current ?? '',
        branches: branchList?.branches ?? [],
        loading: false,
      });
    },
    [store, workspaceId]
  );

  const setDiffPreview = useCallback(
    (preview: GitDiffPreview | null) => {
      store.set(gitDiffPreviewAtomFamily(workspaceId), preview);
    },
    [store, workspaceId]
  );

  const requestDiff = useCallback(
    async (change: GitFileChange, type: GitChangeType) => {
      const result = await dispatch<{ diff: string }>('git.diff', {
        workspaceId,
        path: change.path,
        staged: type === 'staged',
      });

      if (!result.ok || !result.data) {
        console.error('Failed to get diff:', result.error?.message);
        return;
      }

      const preview: GitDiffPreview = {
        path: change.path,
        diff: result.data.diff,
        staged: type === 'staged',
      };

      setDiffPreview(preview);

      window.dispatchEvent(
        new CustomEvent('coder-studio:show-diff', {
          detail: preview,
        })
      );
    },
    [dispatch, setDiffPreview, workspaceId]
  );

  const loadBranchList = useCallback(async () => {
    if (!workspaceId) {
      return;
    }

    store.set(gitBranchListAtomFamily(workspaceId), (prev) => ({
      ...prev,
      loading: true,
      error: undefined,
    }));

    const result = await dispatch<{ current: string; branches: GitBranch[] }>('git.branches', {
      workspaceId,
    });

    if (!result.ok || !result.data) {
      store.set(gitBranchListAtomFamily(workspaceId), (prev) => ({
        ...prev,
        loading: false,
        error: result.error?.message ?? 'Failed to load branches',
      }));
      console.error('Failed to load git branches:', result.error?.message);
      return;
    }

    setBranchList(result.data);
  }, [dispatch, setBranchList, store, workspaceId]);

  const loadGitStatus = useCallback(async () => {
    if (!workspaceId || isLoadingRef.current) {
      console.log('[GitPanel] loadGitStatus skipped - workspaceId:', workspaceId, 'isLoading:', isLoadingRef.current);
      return;
    }

    console.log('[GitPanel] loadGitStatus starting...');
    isLoadingRef.current = true;
    setIsLoading(true);

    try {
      const result = await dispatch<GitStatus>('git.status', {
        workspaceId,
      });

      if (!result.ok || !result.data) {
        console.error('[GitPanel] Failed to load git status:', result.error?.message);
        return;
      }

      console.log('[GitPanel] git.status succeeded, setting gitState with', result.data.staged.length, 'staged,', result.data.modified.length, 'modified');
      setGitState(result.data);

      const nextPreviewTarget =
        (diffPreview ? getChangeByPath(result.data, diffPreview.path) : null) ??
        getFirstChange(result.data);

      if (!nextPreviewTarget) {
        setDiffPreview(null);
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
    }
  }, [diffPreview, dispatch, requestDiff, setDiffPreview, setGitState, workspaceId]);

  useEffect(() => {
    if (!gitState && !isLoadingRef.current) {
      void loadGitStatus();
    }
  }, [gitState, loadGitStatus]);

  useEffect(() => {
    void loadBranchList();
  }, [loadBranchList]);

  useEffect(() => {
    // When gitState changes (e.g., from fs.dirty event), update diffPreview if needed
    if (!gitState) {
      return;
    }

    console.log('[GitPanel] gitState changed, checking if diffPreview needs update...');

    // If currently previewing a file that still exists, keep it
    if (diffPreview) {
      const currentChange = getChangeByPath(gitState, diffPreview.path);
      if (currentChange && Boolean(diffPreview.staged) === (currentChange.type === 'staged')) {
        console.log('[GitPanel] Current diffPreview still valid, keeping it');
        return;
      }
      console.log('[GitPanel] Current diffPreview no longer valid, selecting new file');
    }

    // Select first available change
    const firstChange = getFirstChange(gitState);
    if (!firstChange) {
      console.log('[GitPanel] No changes available, clearing diffPreview');
      setDiffPreview(null);
      return;
    }

    console.log('[GitPanel] Selecting first change for diff:', firstChange.change.path);
    void requestDiff(firstChange.change, firstChange.type);
  }, [gitState, diffPreview, requestDiff, setDiffPreview]);

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
        return;
      }

      afterSuccess?.();
      await loadGitStatus();
    },
    [dispatch, loadGitStatus]
  );

  const handleStageAll = useCallback(async () => {
    const paths = [
      ...(gitState?.modified.map((file) => file.path) ?? []),
      ...(gitState?.deleted.map((file) => file.path) ?? []),
      ...(gitState?.untracked.map((file) => file.path) ?? []),
    ];

    await runGitMutation(
      'git.stage',
      { workspaceId, paths },
      'Failed to stage all:'
    );
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
    () => [
      { title: 'Staged', type: 'staged', changes: gitState?.staged ?? [] },
      { title: 'Changes', type: 'modified', changes: gitState?.modified ?? [] },
      { title: 'Deleted', type: 'deleted', changes: gitState?.deleted ?? [] },
      { title: 'Untracked', type: 'untracked', changes: gitState?.untracked ?? [] },
    ].filter((group) => group.changes.length > 0),
    [gitState]
  );

  return (
    <div className="git-panel">
      <div className="panel-toolbar git-panel-toolbar">
        <div className="git-toolbar-cluster">
          <button
            className="panel-toolbar-btn"
            onClick={() => void loadGitStatus()}
            disabled={isLoading}
            title="Refresh"
            type="button"
          >
            <RefreshCw size={14} className={isLoading ? 'spin' : undefined} />
          </button>

          {hasChanges && (
            <>
              <button
                className="panel-toolbar-btn"
                onClick={() => void handleStageAll()}
                title="Stage All"
                type="button"
              >
                <Plus size={14} />
              </button>
              <button
                className="panel-toolbar-btn"
                onClick={() => void handleUnstageAll()}
                title="Unstage All"
                type="button"
              >
                <Minus size={14} />
              </button>
              <button
                className="panel-toolbar-btn"
                onClick={() => void handleDiscardAll()}
                title="Discard All"
                type="button"
              >
                <RotateCcw size={14} />
              </button>
              <button
                className="panel-toolbar-btn git-panel-commit-btn"
                onClick={() => void handleCommit()}
                disabled={!commitMessage.trim() || !gitState?.staged.length}
                title="Commit"
                type="button"
              >
                <ArrowUp size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      <textarea
        className="git-commit-input"
        placeholder="Enter commit message..."
        value={commitMessage}
        onChange={(event) => setCommitMessage(event.target.value)}
        rows={1}
      />

      <div className="git-list">
        {gitState ? (
          groups.length > 0 ? (
            groups.map((group) => (
              <GitChangeGroup
                key={group.title}
                title={group.title}
                changes={group.changes}
                type={group.type}
                selectedPath={diffPreview?.path ?? null}
                onViewDiff={requestDiff}
                onRunMutation={runGitMutation}
                onRequestDiscard={handleRequestDiscardSingle}
                workspaceId={workspaceId}
              />
            ))
          ) : (
            <div className="git-empty">{t('git.no_changes')}</div>
          )
        ) : (
          <div className="git-empty">{isLoading ? 'Loading...' : t('git.no_changes')}</div>
        )}
      </div>

      <GitDiscardConfirmModal
        discard={pendingDiscard}
        onCancel={handleCancelDiscard}
        onConfirm={handleConfirmDiscard}
      />
    </div>
  );
};

interface GitChangeGroupProps {
  title: string;
  changes: GitFileChange[];
  type: GitChangeType;
  selectedPath: string | null;
  workspaceId: string;
  onViewDiff: (change: GitFileChange, type: GitChangeType) => Promise<void>;
  onRunMutation: (
    op: 'git.stage' | 'git.unstage' | 'git.discard' | 'git.commit',
    args: Record<string, unknown>,
    errorMessage: string,
    afterSuccess?: () => void
  ) => Promise<void>;
  onRequestDiscard: (path: string) => void;
}

const GitChangeGroup: FC<GitChangeGroupProps> = ({
  title,
  changes,
  type,
  selectedPath,
  workspaceId,
  onViewDiff,
  onRunMutation,
  onRequestDiscard,
}) => (
  <div className="git-group">
    <div className="git-group-header">
      <span>{title}</span>
      <span className="git-group-count">{changes.length}</span>
    </div>

    {changes.map((change) => (
      <GitChangeRow
        key={change.path}
        change={change}
        type={type}
        workspaceId={workspaceId}
        selected={selectedPath === change.path}
        onViewDiff={onViewDiff}
        onRunMutation={onRunMutation}
        onRequestDiscard={onRequestDiscard}
      />
    ))}
  </div>
);

interface GitChangeRowProps {
  change: GitFileChange;
  type: GitChangeType;
  workspaceId: string;
  selected: boolean;
  onViewDiff: (change: GitFileChange, type: GitChangeType) => Promise<void>;
  onRunMutation: (
    op: 'git.stage' | 'git.unstage' | 'git.discard' | 'git.commit',
    args: Record<string, unknown>,
    errorMessage: string,
    afterSuccess?: () => void
  ) => Promise<void>;
  onRequestDiscard: (path: string) => void;
}

const GitChangeRow: FC<GitChangeRowProps> = ({
  change,
  type,
  workspaceId,
  selected,
  onViewDiff,
  onRunMutation,
  onRequestDiscard,
}) => {
  const pathParts = change.path.split('/');
  const fileName = pathParts[pathParts.length - 1] ?? change.path;
  const dirName = pathParts.length > 1 ? `${pathParts.slice(0, -1).join('/')}/` : '';

  const badgeLabel =
    type === 'staged'
      ? 'Staged'
      : type === 'modified'
        ? 'Modified'
        : type === 'deleted'
          ? 'Deleted'
          : 'Untracked';

  const iconTone =
    type === 'modified'
      ? 'modified'
      : type === 'deleted'
        ? 'deleted'
        : type === 'staged'
          ? 'staged'
          : 'untracked';

  const handleToggleStage = async () => {
    if (type === 'staged') {
      await onRunMutation(
        'git.unstage',
        { workspaceId, paths: [change.path] },
        'Failed to unstage:'
      );
      return;
    }

    await onRunMutation(
      'git.stage',
      { workspaceId, paths: [change.path] },
      'Failed to stage:'
    );
  };

  return (
    <div
      className={`git-row ${selected ? 'active' : ''}`}
      onClick={() => void onViewDiff(change, type)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          void onViewDiff(change, type);
        }
      }}
    >
      <span className={`git-row-icon git-row-icon-${iconTone}`}>
        <File size={14} />
      </span>

      <span className="git-row-name">{fileName}</span>

      {dirName ? <span className="git-row-dir">{dirName}</span> : null}

      <span className={`git-status-badge ${iconTone}`}>{badgeLabel}</span>

      <div className="git-row-actions">
        <button
          className="git-row-action"
          onClick={(event) => {
            event.stopPropagation();
            void handleToggleStage();
          }}
          title={type === 'staged' ? 'Unstage' : 'Stage'}
          type="button"
        >
          {type === 'staged' ? <Minus size={12} /> : <Plus size={12} />}
        </button>

        <button
          className="git-row-action"
          onClick={(event) => {
            event.stopPropagation();
            onRequestDiscard(change.path);
          }}
          title="Discard"
          type="button"
        >
          <RotateCcw size={12} />
        </button>
      </div>
    </div>
  );
};

interface GitDiscardConfirmModalProps {
  discard: PendingDiscardConfirmation | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

const GitDiscardConfirmModal: FC<GitDiscardConfirmModalProps> = ({
  discard,
  onCancel,
  onConfirm,
}) => {
  const t = useTranslation();

  if (!discard) {
    return null;
  }

  const title =
    discard.scope === 'all'
      ? t('git.discard_all_confirm_title')
      : t('git.discard_file_confirm_title');
  const message =
    discard.scope === 'all'
      ? t('git.discard_all_confirm_message', { count: discard.paths.length })
      : t('git.discard_file_confirm_message', {
          path: discard.filePath ?? discard.paths[0] ?? '',
        });

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title">
            <AlertTriangle size={16} />
            <h3>{title}</h3>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onCancel} aria-label={t('action.close')}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <p>{message}</p>
          <p className="dialog-helper">{t('git.discard_confirm_irreversible')}</p>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>
            {t('action.cancel')}
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              void onConfirm();
            }}
          >
            {t('git.discard')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GitPanel;
