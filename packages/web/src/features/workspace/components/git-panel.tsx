/**
 * Git Panel Component
 *
 * Displays Git changes, staging area, and commit interface.
 */

import type { FC } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  GitBranch,
  Plus,
  Minus,
  RotateCcw,
  RefreshCw,
  File,
} from 'lucide-react';
import { gitStateAtomFamily } from '../../../atoms/git';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { useTranslation } from '../../../lib/i18n';
import { useState, useCallback, useEffect } from 'react';

interface GitPanelProps {
  workspaceId: string;
}

/**
 * Git Panel
 *
 * PRD §10:
 *   - Header with "SOURCE CONTROL" label and branch info
 *   - Toolbar with stage/unstage/discard/commit buttons
 *   - Commit message input
 *   - Change groups: Staged / Changes / Untracked
 *   - Per-file actions: stage, unstage, discard
 */
export const GitPanel: FC<GitPanelProps> = ({ workspaceId }) => {
  const t = useTranslation();
  const gitState = useAtomValue(gitStateAtomFamily(workspaceId));
  const dispatch = useSetAtom(dispatchCommandAtom);

  const [commitMessage, setCommitMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Load git status: dispatch git.status command
   */
  const loadGitStatus = useCallback(async () => {
    if (!workspaceId || isLoading) return;

    setIsLoading(true);
    const result = await dispatch<void>('git.status', {
      workspaceId,
    });

    if (!result.ok) {
      console.error('Failed to load git status:', result.error?.message);
    }

    setIsLoading(false);
  }, [workspaceId, isLoading, dispatch]);

  // Load git status on mount
  useEffect(() => {
    if (!gitState && !isLoading) {
      loadGitStatus();
    }
  }, [gitState, isLoading, loadGitStatus]);

  /**
   * Refresh git status
   */
  const handleRefresh = () => {
    if (!isLoading) {
      loadGitStatus();
    }
  };

  /**
   * Stage all changes
   */
  const handleStageAll = async () => {
    const result = await dispatch<void>('git.stage', {
      workspaceId,
      paths: gitState?.modified.map((f) => f.path) ?? [],
    });

    if (!result.ok) {
      console.error('Failed to stage all:', result.error?.message);
    }
  };

  /**
   * Unstage all changes
   */
  const handleUnstageAll = async () => {
    const result = await dispatch<void>('git.unstage', {
      workspaceId,
      paths: gitState?.staged.map((f) => f.path) ?? [],
    });

    if (!result.ok) {
      console.error('Failed to unstage all:', result.error?.message);
    }
  };

  /**
   * Discard all changes
   */
  const handleDiscardAll = async () => {
    // TODO: Show confirmation dialog
    const result = await dispatch<void>('git.discard', {
      workspaceId,
      paths: gitState?.modified.map((f) => f.path) ?? [],
    });

    if (!result.ok) {
      console.error('Failed to discard all:', result.error?.message);
    }
  };

  /**
   * Commit staged changes
   */
  const handleCommit = async () => {
    if (!commitMessage.trim() || !gitState?.staged.length) return;

    const result = await dispatch<void>('git.commit', {
      workspaceId,
      message: commitMessage,
    });

    if (result.ok) {
      setCommitMessage('');
    } else {
      console.error('Failed to commit:', result.error?.message);
    }
  };

  const hasChanges =
    gitState &&
    (gitState.staged.length > 0 ||
      gitState.modified.length > 0 ||
      gitState.untracked.length > 0);

  return (
    <div className="git-panel">
      <div className="git-header">
        <span className="git-label">{t('git.title').toUpperCase()}</span>
        {gitState?.branch && (
          <span className="git-branch-chip">
            <GitBranch size={12} />
            <span>{gitState.branch}</span>
          </span>
        )}
      </div>

      <div className="git-toolbar">
        <button
          className="btn btn-icon btn-sm"
          onClick={handleRefresh}
          disabled={isLoading}
          aria-label={t('action.refresh')}
        >
          <RefreshCw size={14} className={isLoading ? 'spin' : ''} />
        </button>

        {hasChanges && (
          <>
            <button
              className="btn btn-icon btn-sm"
              onClick={handleStageAll}
              aria-label={t('git.stage_all')}
            >
              <Plus size={14} />
            </button>
            <button
              className="btn btn-icon btn-sm"
              onClick={handleUnstageAll}
              aria-label={t('git.unstage_all')}
            >
              <Minus size={14} />
            </button>
            <button
              className="btn btn-icon btn-sm"
              onClick={handleDiscardAll}
              aria-label={t('git.discard')}
            >
              <RotateCcw size={14} />
            </button>
          </>
        )}
      </div>

      <div className="git-commit-input">
        <textarea
          className="input"
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder={t('git.commit_placeholder')}
          rows={3}
        />
        <button
          className="btn btn-primary btn-sm"
          onClick={handleCommit}
          disabled={!commitMessage.trim() || !gitState?.staged.length}
        >
          {t('git.commit')}
        </button>
      </div>

      <div className="git-changes">
        {gitState ? (
          <>
            {gitState.staged.length > 0 && (
              <GitChangeGroup
                title={t('git.staged')}
                changes={gitState.staged}
                type="staged"
                workspaceId={workspaceId}
              />
            )}

            {gitState.modified.length > 0 && (
              <GitChangeGroup
                title={t('git.unstaged')}
                changes={gitState.modified}
                type="unstaged"
                workspaceId={workspaceId}
              />
            )}

            {gitState.untracked.length > 0 && (
              <GitChangeGroup
                title={t('git.untracked')}
                changes={gitState.untracked}
                type="untracked"
                workspaceId={workspaceId}
              />
            )}
          </>
        ) : (
          <div className="git-empty">
            <p>
              {isLoading ? 'Loading...' : t('git.no_changes')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

interface GitChangeGroupProps {
  title: string;
  changes: Array<{ path: string; oldPath?: string }>;
  type: 'staged' | 'unstaged' | 'untracked';
  workspaceId: string;
}

const GitChangeGroup: FC<GitChangeGroupProps> = ({
  title,
  changes,
  type,
  workspaceId,
}) => {
  const t = useTranslation();
  const dispatch = useSetAtom(dispatchCommandAtom);

  return (
    <div className="git-change-group">
      <div className="git-change-group-header">
        <span className="git-change-group-title">{title}</span>
        <span className="git-change-group-count">{changes.length}</span>
      </div>

      <div className="git-change-group-list">
        {changes.map((change) => (
          <GitChangeRow
            key={change.path}
            change={change}
            type={type}
            workspaceId={workspaceId}
          />
        ))}
      </div>
    </div>
  );
};

interface GitChangeRowProps {
  change: { path: string; oldPath?: string };
  type: 'staged' | 'unstaged' | 'untracked';
  workspaceId: string;
}

const GitChangeRow: FC<GitChangeRowProps> = ({ change, type, workspaceId }) => {
  const t = useTranslation();
  const dispatch = useSetAtom(dispatchCommandAtom);

  /**
   * Stage or unstage file
   */
  const handleAction = async () => {
    if (type === 'staged') {
      // Unstage
      const result = await dispatch<void>('git.unstage', {
        workspaceId,
        paths: [change.path],
      });

      if (!result.ok) {
        console.error('Failed to unstage:', result.error?.message);
      }
    } else {
      // Stage
      const result = await dispatch<void>('git.stage', {
        workspaceId,
        paths: [change.path],
      });

      if (!result.ok) {
        console.error('Failed to stage:', result.error?.message);
      }
    }
  };

  /**
   * View diff
   */
  const handleViewDiff = async () => {
    const result = await dispatch<{ diff: string }>('git.diff', {
      workspaceId,
      path: change.path,
    });

    if (result.ok && result.data) {
      // Dispatch custom event to open diff in editor
      window.dispatchEvent(
        new CustomEvent('coder-studio:show-diff', {
          detail: { path: change.path, diff: result.data.diff },
        })
      );
    } else {
      console.error('Failed to get diff:', result.error?.message);
    }
  };

  const statusClass = `git-status-${type}`;

  return (
    <div className="git-change-row" onClick={handleViewDiff}>
      <File size={14} />
      <span className="git-change-path">{change.path}</span>
      <span className={`git-change-status ${statusClass}`}>{type}</span>
      <button
        className="btn btn-icon btn-sm"
        onClick={(e) => {
          e.stopPropagation();
          handleAction();
        }}
        aria-label={type === 'staged' ? t('git.unstage') : t('git.stage')}
      >
        {type === 'staged' ? <Minus size={12} /> : <Plus size={12} />}
      </button>
    </div>
  );
};

export default GitPanel;
