/**
 * Git Panel Component
 *
 * Displays Git changes, staging area, and commit interface.
 */

import type { FC } from 'react';
import { useAtomValue } from 'jotai';
import { GitBranch, Plus, Minus, RotateCcw, RefreshCw } from 'lucide-react';
import { gitStateAtomFamily } from '../../../atoms/git';
import { useTranslation } from '../../../lib/i18n';
import { useState } from 'react';

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
  const [commitMessage, setCommitMessage] = useState('');

  const handleRefresh = () => {
    // TODO: Dispatch git status refresh
    console.log('Refresh git status');
  };

  const handleStageAll = () => {
    // TODO: Dispatch stage all command
    console.log('Stage all');
  };

  const handleUnstageAll = () => {
    // TODO: Dispatch unstage all command
    console.log('Unstage all');
  };

  const handleDiscardAll = () => {
    // TODO: Show confirmation dialog, then discard all
    console.log('Discard all');
  };

  const handleCommit = () => {
    // TODO: Dispatch commit command
    console.log('Commit:', commitMessage);
  };

  const hasChanges = gitState && (gitState.staged.length > 0 || gitState.changes.length > 0 || gitState.untracked.length > 0);

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
          aria-label={t('action.refresh')}
        >
          <RefreshCw size={14} />
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
          disabled={!commitMessage.trim() || gitState?.staged.length === 0}
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
              />
            )}

            {gitState.changes.length > 0 && (
              <GitChangeGroup
                title={t('git.unstaged')}
                changes={gitState.changes}
                type="unstaged"
              />
            )}

            {gitState.untracked.length > 0 && (
              <GitChangeGroup
                title={t('git.untracked')}
                changes={gitState.untracked}
                type="untracked"
              />
            )}
          </>
        ) : (
          <div className="git-empty">
            <p>{t('git.no_changes')}</p>
          </div>
        )}
      </div>
    </div>
  );
};

interface GitChangeGroupProps {
  title: string;
  changes: Array<{ path: string; status: string }>;
  type: 'staged' | 'unstaged' | 'untracked';
}

const GitChangeGroup: FC<GitChangeGroupProps> = ({ title, changes, type }) => {
  const t = useTranslation();

  return (
    <div className="git-change-group">
      <div className="git-change-group-header">
        <span className="git-change-group-title">{title}</span>
        <span className="git-change-group-count">{changes.length}</span>
      </div>

      <div className="git-change-group-list">
        {changes.map((change) => (
          <GitChangeRow key={change.path} change={change} type={type} />
        ))}
      </div>
    </div>
  );
};

interface GitChangeRowProps {
  change: { path: string; status: string };
  type: 'staged' | 'unstaged' | 'untracked';
}

const GitChangeRow: FC<GitChangeRowProps> = ({ change, type }) => {
  const t = useTranslation();

  const handleAction = () => {
    // TODO: Dispatch appropriate action based on type
    console.log('Action for:', change.path, type);
  };

  const statusClass = `git-status-${type}`;

  return (
    <div className="git-change-row">
      <File size={14} />
      <span className="git-change-path">{change.path}</span>
      <span className={`git-change-status ${statusClass}`}>
        {type}
      </span>
      <button
        className="btn btn-icon btn-sm"
        onClick={handleAction}
        aria-label={type === 'staged' ? t('git.unstage') : t('git.stage')}
      >
        {type === 'staged' ? <Minus size={12} /> : <Plus size={12} />}
      </button>
    </div>
  );
};

import { File } from 'lucide-react';

export default GitPanel;
