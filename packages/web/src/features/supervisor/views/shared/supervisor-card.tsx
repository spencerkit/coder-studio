import { IconButton, ThemedIcon, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { useSupervisorActions } from "../../actions/use-supervisor-actions";

interface SupervisorCardProps {
  sessionId: string;
  workspaceId: string;
}

export function SupervisorCard({ sessionId, workspaceId }: SupervisorCardProps) {
  const t = useTranslation();
  const {
    activeItem,
    actionError,
    decompositionModeLabel,
    decompositionStatusLabel,
    handlePause,
    handleResume,
    handleTrigger,
    isBusy,
    openDialog,
    recentReasoning,
    stopReasonLabel,
    stateClass,
    stateLabel,
    supervisor,
    targetMemory,
  } = useSupervisorActions({ sessionId });

  if (!supervisor) {
    return (
      <div className="supervisor-card supervisor-card-inactive">
        <Tooltip content={t("supervisor.action.enable")}>
          <button
            className="supervisor-enable-btn"
            onClick={() => openDialog("enable")}
            aria-label={t("supervisor.action.enable")}
          >
            <ThemedIcon semantic="supervisor.entry" size={13} />
            <span>{t("supervisor.title")}</span>
          </button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className={`supervisor-card ${stateClass}`} data-workspace-id={workspaceId}>
      <div className="supervisor-strip-row">
        <span className="supervisor-strip-eyebrow">
          <span className={`supervisor-pulse ${stateClass}`} aria-hidden="true" />
          <span className="supervisor-label">{t("supervisor.title")}</span>
          <span className="supervisor-provider-pill">{supervisor.evaluatorProviderId}</span>
        </span>

        <span className="supervisor-status-cluster">
          <span className={`supervisor-state-tag ${stateClass}`}>{stateLabel}</span>
          <span className="supervisor-cycle-count">
            {t("supervisor.completed_cycles", {
              count: String(supervisor.completedSupervisionCount),
            })}
          </span>
        </span>

        <div className="supervisor-actions">
          <Tooltip content={t("supervisor.action.edit_objective")}>
            <IconButton
              aria-label={t("supervisor.action.edit_objective")}
              className="supervisor-icon-btn"
              icon={<ThemedIcon semantic="supervisor.mode.edit" size={12} />}
              onClick={() => openDialog("edit")}
              size="sm"
            />
          </Tooltip>

          {supervisor.state === "paused" ? (
            <Tooltip content={t("supervisor.action.resume")}>
              <IconButton
                aria-label={t("supervisor.action.resume")}
                className="supervisor-icon-btn"
                icon={<ThemedIcon semantic="supervisor.action.resume" size={12} />}
                onClick={() => {
                  void handleResume();
                }}
                size="sm"
              />
            </Tooltip>
          ) : (
            <Tooltip content={t("supervisor.action.pause")}>
              <IconButton
                aria-label={t("supervisor.action.pause")}
                className="supervisor-icon-btn"
                icon={<ThemedIcon semantic="supervisor.action.pause" size={12} />}
                onClick={() => {
                  void handlePause();
                }}
                size="sm"
              />
            </Tooltip>
          )}

          <Tooltip content={t("supervisor.action.trigger")}>
            <IconButton
              aria-label={t("supervisor.action.trigger")}
              className="supervisor-icon-btn"
              disabled={isBusy}
              icon={<ThemedIcon semantic="supervisor.action.trigger" size={12} />}
              onClick={() => {
                void handleTrigger();
              }}
              size="sm"
            />
          </Tooltip>

          <Tooltip content={t("supervisor.action.disable")}>
            <IconButton
              aria-label={t("supervisor.action.disable")}
              className="supervisor-icon-btn supervisor-icon-btn-danger"
              icon={<ThemedIcon semantic="supervisor.mode.disable" size={12} />}
              onClick={() => openDialog("disable")}
              size="sm"
            />
          </Tooltip>
        </div>
      </div>

      <div className="supervisor-objective-row" onDoubleClick={() => openDialog("edit")}>
        <Tooltip content={supervisor.objective}>
          <span className="supervisor-objective-text">{supervisor.objective}</span>
        </Tooltip>
      </div>

      {targetMemory ? (
        <div className="supervisor-details" aria-label={t("supervisor.target_memory.title")}>
          <div className="supervisor-meta-grid">
            <div className="supervisor-meta-item">
              <p className="supervisor-meta-label">{t("supervisor.target_memory.target")}</p>
              <p className="supervisor-meta-value">{decompositionStatusLabel}</p>
            </div>
            {decompositionModeLabel ? (
              <div className="supervisor-meta-item">
                <p className="supervisor-meta-label">
                  {t("supervisor.target_memory.decomposition_mode_title")}
                </p>
                <p className="supervisor-meta-value">{decompositionModeLabel}</p>
              </div>
            ) : null}
            {activeItem ? (
              <div className="supervisor-meta-item">
                <p className="supervisor-meta-label">{t("supervisor.target_memory.active_item")}</p>
                <p className="supervisor-meta-value">{activeItem.title}</p>
              </div>
            ) : null}
            <div className="supervisor-meta-item">
              <p className="supervisor-meta-label">{t("supervisor.target_memory.stalled")}</p>
              <p className="supervisor-meta-value">{String(targetMemory.stalledCount)}</p>
            </div>
          </div>

          {targetMemory.progressSummary ? (
            <div className="supervisor-meta-item">
              <p className="supervisor-meta-label">
                {t("supervisor.target_memory.progress_title")}
              </p>
              <p className="supervisor-meta-value">{targetMemory.progressSummary}</p>
            </div>
          ) : null}

          {targetMemory.items.length > 0 ? (
            <div className="supervisor-meta-item">
              <p className="supervisor-meta-label">
                {t("supervisor.target_memory.decomposition_title")}
              </p>
              <div className="supervisor-details-panel">
                {targetMemory.items.map((item) => (
                  <div key={item.id} className="supervisor-meta-item">
                    <p className="supervisor-meta-label">
                      {t(`supervisor.target_memory.step_status.${item.status}`)}
                    </p>
                    <p className="supervisor-meta-value">{item.title}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {recentReasoning ? (
            <div className="supervisor-meta-item">
              <p className="supervisor-meta-label">
                {t("supervisor.target_memory.reasoning_title")}
              </p>
              <p className="supervisor-meta-value">{recentReasoning}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {supervisor.state === "stopped" && stopReasonLabel ? (
        <div className="supervisor-error" role="status">
          {stopReasonLabel}
        </div>
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
