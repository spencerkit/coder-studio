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
    actionError,
    executionPolicyItems,
    handlePause,
    handleResume,
    handleTrigger,
    isBusy,
    latestCycle,
    latestCycleText,
    openDialog,
    stopReasonLabel,
    stateClass,
    stateLabel,
    supervisor,
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
        </span>

        <span className={`supervisor-state-tag ${stateClass}`}>{stateLabel}</span>

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
        <span className="supervisor-provider-pill">{supervisor.evaluatorProviderId}</span>
      </div>

      {executionPolicyItems.length > 0 ? (
        <dl className="supervisor-meta-grid" aria-label={t("supervisor.meta.title")}>
          {executionPolicyItems.map((item) => (
            <div key={item.key} className="supervisor-meta-item">
              <dt className="supervisor-meta-label">{item.label}</dt>
              <dd className="supervisor-meta-value">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {latestCycle ? (
        <ol className="supervisor-history-list" aria-label={t("supervisor.latest_evaluation")}>
          <li className="supervisor-history-item" data-trigger={latestCycle.trigger}>
            <span className="supervisor-history-trigger">
              {latestCycle.trigger === "manual"
                ? t("supervisor.trigger.manual")
                : latestCycle.trigger === "scheduled"
                  ? t("supervisor.trigger.scheduled")
                  : t("supervisor.trigger.auto")}
            </span>
            <span className="supervisor-history-result">{latestCycleText}</span>
          </li>
        </ol>
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
