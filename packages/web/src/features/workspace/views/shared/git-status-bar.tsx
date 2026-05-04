import { useState, type FC } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Diff, X } from 'lucide-react';
import { useTranslation } from '../../../../lib/i18n';
import type { GitStatus } from '@coder-studio/core';
import { useGitSyncActions } from '../../actions/use-git-actions';

interface GitStatusBarProps {
  workspaceId: string;
  gitState: GitStatus | null;
  inline?: boolean;
}

type GitSyncIntent = 'push' | 'pull';

interface SyncDialogState {
  intent: GitSyncIntent;
  count: number;
}

export const GitStatusBar: FC<GitStatusBarProps> = ({ workspaceId, gitState, inline = false }) => {
  const t = useTranslation();
  const { handlePull, handlePush, syncingIntent } = useGitSyncActions(workspaceId);
  const [pendingAction, setPendingAction] = useState<SyncDialogState | null>(null);

  if (!gitState) {
    return null;
  }

  const changeCount =
    gitState.staged.length +
    gitState.modified.length +
    gitState.untracked.length +
    gitState.deleted.length;

  const ahead = gitState.ahead;
  const behind = gitState.behind;
  const confirmTitle =
    pendingAction?.intent === 'push'
      ? t('git.push_confirm_title')
      : t('git.pull_confirm_title');
  const confirmMessage =
    pendingAction?.intent === 'push'
      ? t('git.push_confirm_message', { count: pendingAction.count })
      : t('git.pull_confirm_message', { count: pendingAction?.count ?? 0 });
  const confirmActionLabel = pendingAction?.intent === 'push' ? t('action.push') : t('action.pull');
  const confirmActionBusyLabel =
    pendingAction?.intent === 'push' ? t('git.push_in_progress') : t('git.pull_in_progress');
  const isSyncingCurrentAction = Boolean(pendingAction && syncingIntent === pendingAction.intent);

  const openConfirm = (intent: GitSyncIntent, count: number) => {
    if (count <= 0) {
      return;
    }

    setPendingAction({ intent, count });
  };

  const closeConfirm = () => {
    setPendingAction(null);
  };

  const confirmSync = async () => {
    if (!pendingAction) {
      return;
    }

    if (pendingAction.intent === 'push') {
      const success = await handlePush();
      if (success) {
        setPendingAction(null);
      }
      return;
    }

    const success = await handlePull();
    if (success) {
      setPendingAction(null);
    }
  };

  return (
    <>
      <div className={`git-status-bar${inline ? ' git-status-bar--inline' : ''}`}>
        <span className="git-status-bar__item" title={t('git.statusbar.changes')}>
          <Diff size={13} aria-hidden="true" />
          <span className="git-status-bar__value">{changeCount}</span>
        </span>
        <button
          className="git-status-bar__item git-status-bar__item--actionable git-status-bar__item--ahead"
          title={t('git.statusbar.ahead')}
          type="button"
          aria-label={t('action.push')}
          disabled={ahead <= 0}
          onClick={() => openConfirm('push', ahead)}
        >
          <ArrowUpFromLine size={13} aria-hidden="true" />
          <span className="git-status-bar__value">{ahead}</span>
        </button>
        <button
          className="git-status-bar__item git-status-bar__item--actionable git-status-bar__item--behind"
          title={t('git.statusbar.behind')}
          type="button"
          aria-label={t('action.pull')}
          disabled={behind <= 0}
          onClick={() => openConfirm('pull', behind)}
        >
          <ArrowDownToLine size={13} aria-hidden="true" />
          <span className="git-status-bar__value">{behind}</span>
        </button>
      </div>

      {pendingAction ? (
        <div className="modal-overlay" onClick={closeConfirm}>
          <div className="modal-card git-status-bar__confirm" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <AlertTriangle size={16} />
                <h3>{confirmTitle}</h3>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={closeConfirm}
                aria-label={t('action.close')}
                type="button"
              >
                <X size={14} />
              </button>
            </div>

            <div className="modal-body">
              <p>{confirmMessage}</p>
              <p className="dialog-helper">{t('git.sync_confirm_helper')}</p>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeConfirm} type="button">
                {t('action.cancel')}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void confirmSync()}
                type="button"
                disabled={isSyncingCurrentAction}
              >
                {isSyncingCurrentAction ? confirmActionBusyLabel : confirmActionLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default GitStatusBar;
