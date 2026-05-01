import {
  ArrowUpCircle,
  Eye,
  Pause,
  Pencil,
  Play,
  PowerOff,
} from 'lucide-react';
import { useSupervisorActions } from '../../actions/use-supervisor-actions';

interface SupervisorCardProps {
  sessionId: string;
  workspaceId: string;
}

export function SupervisorCard({ sessionId, workspaceId }: SupervisorCardProps) {
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
          title="启用 Supervisor"
        >
          <Eye size={13} />
          <span>启用 Supervisor</span>
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
          <span className="supervisor-label">Supervisor</span>
        </span>

        <span className={`supervisor-state-tag ${stateClass}`}>
          {stateLabel}
        </span>

        <div className="supervisor-actions">
          <button
            className="supervisor-icon-btn"
            onClick={() => openDialog('edit')}
            title="编辑目标"
            aria-label="编辑目标"
          >
            <Pencil size={12} />
          </button>

          {supervisor.state === 'paused' ? (
            <button
              className="supervisor-icon-btn"
              onClick={() => {
                void handleResume();
              }}
              title="恢复"
              aria-label="恢复"
            >
              <Play size={12} />
            </button>
          ) : (
            <button
              className="supervisor-icon-btn"
              onClick={() => {
                void handlePause();
              }}
              title="暂停"
              aria-label="暂停"
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
            title="触发评估"
            aria-label="触发评估"
            disabled={isBusy}
          >
            <ArrowUpCircle size={12} />
          </button>

          <button
            className="supervisor-icon-btn supervisor-icon-btn-danger"
            onClick={() => openDialog('disable')}
            title="禁用 Supervisor"
            aria-label="禁用 Supervisor"
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
        <ol className="supervisor-history-list" aria-label="最近一次评估">
          <li className="supervisor-history-item" data-trigger={latestCycle.trigger}>
            <span className="supervisor-history-trigger">
              {latestCycle.trigger === 'manual' ? 'MANUAL' : 'AUTO'}
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
