import {
  ArrowUpCircle,
  Eye,
  Pause,
  Pencil,
  Play,
  PowerOff,
} from 'lucide-react';
import { useTranslation } from '../../../../lib/i18n';
import { useSupervisorActions } from '../../actions/use-supervisor-actions';

interface SupervisorCardProps {
  sessionId: string;
  workspaceId: string;
}

export function SupervisorCard({ sessionId, workspaceId }: SupervisorCardProps) {
  const t = useTranslation();
  const {
    actionError,
    handlePause,
    handleResume,
    handleTrigger,
    isBusy,
    latestCycle,
    latestCycleText,
    openDialog,
    stateClass,
    stateLabel,
    supervisor,
  } = useSupervisorActions({ sessionId });

  if (!supervisor) {
    return (
      <div className="supervisor-card supervisor-card-inactive">
        <button
          className="supervisor-enable-btn"
          onClick={() => openDialog('enable')}
          title={t('supervisor.action.enable')}
        >
          <Eye size={13} />
          <span>{t('supervisor.action.enable')}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={`supervisor-card ${stateClass}`}
      data-workspace-id={workspaceId}
    >
      <div className="supervisor-strip-row">
        <span className="supervisor-strip-eyebrow">
          <span className={`supervisor-pulse ${stateClass}`} aria-hidden="true" />
          <span className="supervisor-label">{t('supervisor.title')}</span>
        </span>

        <span className={`supervisor-state-tag ${stateClass}`}>
          {stateLabel}
        </span>

        <div className="supervisor-actions">
          <button
            className="supervisor-icon-btn"
            onClick={() => openDialog('edit')}
            title={t('supervisor.action.edit_objective')}
            aria-label={t('supervisor.action.edit_objective')}
          >
            <Pencil size={12} />
          </button>

          {supervisor.state === 'paused' ? (
            <button
              className="supervisor-icon-btn"
              onClick={() => {
                void handleResume();
              }}
              title={t('supervisor.action.resume')}
              aria-label={t('supervisor.action.resume')}
            >
              <Play size={12} />
            </button>
          ) : (
            <button
              className="supervisor-icon-btn"
              onClick={() => {
                void handlePause();
              }}
              title={t('supervisor.action.pause')}
              aria-label={t('supervisor.action.pause')}
              disabled={isBusy}
            >
              <Pause size={12} />
            </button>
          )}

          <button
            className="supervisor-icon-btn"
            onClick={() => {
              void handleTrigger();
            }}
            title={t('supervisor.action.trigger')}
            aria-label={t('supervisor.action.trigger')}
            disabled={isBusy}
          >
            <ArrowUpCircle size={12} />
          </button>

          <button
            className="supervisor-icon-btn supervisor-icon-btn-danger"
            onClick={() => openDialog('disable')}
            title={t('supervisor.action.disable')}
            aria-label={t('supervisor.action.disable')}
          >
            <PowerOff size={12} />
          </button>
        </div>
      </div>

      <div className="supervisor-objective-row" onDoubleClick={() => openDialog('edit')}>
        <span className="supervisor-objective-text" title={supervisor.objective}>
          {supervisor.objective}
        </span>
        <span className="supervisor-provider-pill">{supervisor.evaluatorProviderId}</span>
      </div>

      {latestCycle ? (
        <ol className="supervisor-history-list" aria-label={t('supervisor.latest_evaluation')}>
          <li className="supervisor-history-item" data-trigger={latestCycle.trigger}>
            <span className="supervisor-history-trigger">
              {latestCycle.trigger === 'manual' ? t('supervisor.trigger.manual') : t('supervisor.trigger.auto')}
            </span>
            <span className="supervisor-history-result">
              {latestCycleText}
            </span>
          </li>
        </ol>
      ) : null}

      {actionError ? (
        <div className="supervisor-error" role="alert">
          {actionError}
        </div>
      ) : supervisor.errorReason ? (
        <div className="supervisor-error" role="alert">
          {supervisor.errorReason}
        </div>
      ) : null}
    </div>
  );
}
