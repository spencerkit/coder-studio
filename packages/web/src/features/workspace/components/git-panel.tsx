import type { FC } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue, useStore } from 'jotai';
import {
  ArrowUp,
  File,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import type { GitFileChange, GitStatus } from '@coder-studio/core';
import {
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

  const [commitMessage, setCommitMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const isLoadingRef = useRef(false);

  const setGitState = useCallback(
    (status: GitStatus | null) => {
      store.set(gitStateAtomFamily(workspaceId), status);
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

  const loadGitStatus = useCallback(async () => {
    if (!workspaceId || isLoadingRef.current) {
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
    if (!gitState || diffPreview) {
      return;
    }

    const firstChange = getFirstChange(gitState);
    if (!firstChange) {
      return;
    }

    void requestDiff(firstChange.change, firstChange.type);
  }, [gitState, diffPreview, requestDiff]);

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

  const handleDiscardAll = useCallback(async () => {
    await runGitMutation(
      'git.discard',
      {
        workspaceId,
        paths: [
          ...(gitState?.modified.map((file) => file.path) ?? []),
          ...(gitState?.deleted.map((file) => file.path) ?? []),
        ],
      },
      'Failed to discard all:'
    );
  }, [gitState, runGitMutation, workspaceId]);

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
}

const GitChangeGroup: FC<GitChangeGroupProps> = ({
  title,
  changes,
  type,
  selectedPath,
  workspaceId,
  onViewDiff,
  onRunMutation,
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
}

const GitChangeRow: FC<GitChangeRowProps> = ({
  change,
  type,
  workspaceId,
  selected,
  onViewDiff,
  onRunMutation,
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

  const handleDiscard = async () => {
    await onRunMutation(
      'git.discard',
      { workspaceId, paths: [change.path] },
      'Failed to discard:'
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

        {type !== 'staged' ? (
          <button
            className="git-row-action"
            onClick={(event) => {
              event.stopPropagation();
              void handleDiscard();
            }}
            title="Discard"
            type="button"
          >
            <RotateCcw size={12} />
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default GitPanel;
