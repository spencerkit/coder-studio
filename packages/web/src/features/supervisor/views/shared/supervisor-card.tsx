import { ArrowUpCircle, Eye, Pause, Pencil, Play, PowerOff } from "lucide-react";
import { Tooltip } from "../../../../components/ui";
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
          onClick={() => openDialog("enable")}
          title={t("supervisor.action.enable")}
          aria-label={t("supervisor.action.enable")}
        >
          <Eye size={13} />
          <span>{t("supervisor.title")}</span>
        </button>
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
            <button
              className="supervisor-icon-btn"
              onClick={() => openDialog("edit")}
              aria-label={t("supervisor.action.edit_objective")}
            >
              <Pencil size={12} />
            </button>
          </Tooltip>

          {supervisor.state === "paused" ? (
            <Tooltip content={t("supervisor.action.resume")}>
              <button
                className="supervisor-icon-btn"
                onClick={() => {
                  void handleResume();
                }}
                aria-label={t("supervisor.action.resume")}
              >
                <Play size={12} />
              </button>
            </Tooltip>
          ) : (
            <Tooltip content={t("supervisor.action.pause")}>
              <button
                className="supervisor-icon-btn"
                disabled={isBusy}
                onClick={() => {
                  void handlePause();
                }}
                aria-label={t("supervisor.action.pause")}
              >
                <Pause size={12} />
              </button>
            </Tooltip>
          )}

          <Tooltip content={t("supervisor.action.trigger")}>
            <button
              className="supervisor-icon-btn"
              disabled={isBusy}
              onClick={() => {
                void handleTrigger();
              }}
              aria-label={t("supervisor.action.trigger")}
            >
              <ArrowUpCircle size={12} />
            </button>
          </Tooltip>

          <Tooltip content={t("supervisor.action.disable")}>
            <button
              className="supervisor-icon-btn supervisor-icon-btn-danger"
              onClick={() => openDialog("disable")}
              aria-label={t("supervisor.action.disable")}
            >
              <PowerOff size={12} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="supervisor-objective-row" onDoubleClick={() => openDialog("edit")}>
        <span className="supervisor-objective-text" title={supervisor.objective}>
          {supervisor.objective}
        </span>
        <span className="supervisor-provider-pill">{supervisor.evaluatorProviderId}</span>
      </div>

      {latestCycle ? (
        <ol className="supervisor-history-list" aria-label={t("supervisor.latest_evaluation")}>
          <li className="supervisor-history-item" data-trigger={latestCycle.trigger}>
            <span className="supervisor-history-trigger">
              {latestCycle.trigger === "manual"
                ? t("supervisor.trigger.manual")
                : t("supervisor.trigger.auto")}
            </span>
            <span className="supervisor-history-result">{latestCycleText}</span>
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
