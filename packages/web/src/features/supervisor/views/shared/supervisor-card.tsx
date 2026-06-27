import { Button, IconButton, ThemedIcon, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { SessionActivityButton, SessionActivityDialog } from "../../../session-activity";
import { useSupervisorActions } from "../../actions/use-supervisor-actions";
import { ObjectiveDialog } from "./objective-dialog";
import { SupervisorDetailsDialog } from "./supervisor-details-dialog";

interface SupervisorCardProps {
  sessionId: string;
  workspaceId: string;
}

export function SupervisorCard({ sessionId, workspaceId }: SupervisorCardProps) {
  const t = useTranslation();
  const {
    handlePause,
    handleResume,
    handleTrigger,
    isBusy,
    openDetails,
    openDialog,
    stateClass,
    stateLabel,
    supervisor,
  } = useSupervisorActions({ sessionId });

  if (!supervisor) {
    return (
      <>
        <div className="supervisor-card supervisor-card-inactive" data-supervisor-state="inactive">
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
          <SessionActivityButton sessionId={sessionId} />
        </div>

        <ObjectiveDialog workspaceId={workspaceId} sessionId={sessionId} />
        <SessionActivityDialog sessionId={sessionId} workspaceId={workspaceId} />
      </>
    );
  }

  return (
    <div
      className={`supervisor-card ${stateClass}`}
      data-supervisor-state={supervisor.state}
      data-workspace-id={workspaceId}
    >
      <div className="supervisor-strip-row" data-supervisor-state={supervisor.state}>
        <span className="supervisor-strip-eyebrow">
          <span className={`supervisor-pulse ${stateClass}`} aria-hidden="true" />
          <span className="supervisor-label">{t("supervisor.title")}</span>
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
          <SessionActivityButton sessionId={sessionId} />

          <Tooltip content={t("supervisor.action.details")}>
            <IconButton
              aria-label={t("supervisor.action.details")}
              className="supervisor-icon-btn"
              icon={<ThemedIcon semantic="supervisor.action.details" size={12} />}
              onClick={openDetails}
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
        </div>
      </div>

      <SupervisorDetailsDialog workspaceId={workspaceId} sessionId={sessionId} />
      <ObjectiveDialog workspaceId={workspaceId} sessionId={sessionId} />
      <SessionActivityDialog sessionId={sessionId} workspaceId={workspaceId} />
    </div>
  );
}
