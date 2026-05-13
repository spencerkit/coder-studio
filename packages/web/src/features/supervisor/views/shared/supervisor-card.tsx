import { ArrowUpCircle, ChevronDown, Eye, Pause, Pencil, Play, PowerOff } from "lucide-react";
import { useState } from "react";
import { IconButton, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { useSupervisorActions } from "../../actions/use-supervisor-actions";

interface SupervisorCardProps {
  sessionId: string;
  workspaceId: string;
  defaultDetailsOpen?: boolean;
}

export function SupervisorCard({
  sessionId,
  workspaceId,
  defaultDetailsOpen = false,
}: SupervisorCardProps) {
  const t = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(defaultDetailsOpen);
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
    planGeneratedLabel,
    recentTargetCycles,
    stopReasonLabel,
    stateClass,
    stateLabel,
    supervisor,
    targetCycleResultLabel,
    targetMemory,
    targetProgressLabel,
    targetPlanItems,
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
            <Eye size={13} />
            <span>{t("supervisor.title")}</span>
          </button>
        </Tooltip>
      </div>
    );
  }

  const latestTargetCycle = recentTargetCycles[0] ?? null;
  const detailsLabel = targetMemory
    ? t("supervisor.target_memory.title")
    : t("supervisor.meta.title");
  const detailSummaryItems = [
    targetMemory ? `${t("supervisor.target_memory.target")}: ${supervisor.targetId}` : null,
    targetMemory && planGeneratedLabel
      ? `${t("supervisor.target_memory.plan")}: ${planGeneratedLabel}`
      : null,
    targetMemory
      ? `${t("supervisor.target_memory.stalled")}: ${String(targetMemory.stalledCount)}`
      : null,
    targetMemory?.progressSummary
      ? `${targetProgressLabel}: ${targetMemory.progressSummary}`
      : null,
  ].filter((item): item is string => item !== null);

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
              icon={<Pencil size={12} />}
              onClick={() => openDialog("edit")}
              size="sm"
            />
          </Tooltip>

          {supervisor.state === "paused" ? (
            <Tooltip content={t("supervisor.action.resume")}>
              <IconButton
                aria-label={t("supervisor.action.resume")}
                className="supervisor-icon-btn"
                icon={<Play size={12} />}
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
                icon={<Pause size={12} />}
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
              icon={<ArrowUpCircle size={12} />}
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
              icon={<PowerOff size={12} />}
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

      {targetMemory || executionPolicyItems.length > 0 || latestTargetCycle?.reason ? (
        <div className="supervisor-details">
          <button
            type="button"
            className="supervisor-details-toggle"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((current) => !current)}
          >
            <span className="supervisor-details-copy">
              <span className="supervisor-details-label">{detailsLabel}</span>
              <span className="supervisor-details-summary">
                {detailSummaryItems.length > 0
                  ? detailSummaryItems.join(" · ")
                  : t("supervisor.meta.title")}
              </span>
            </span>
            <span
              className={`supervisor-details-chevron${detailsOpen ? " expanded" : ""}`}
              aria-hidden="true"
            >
              <ChevronDown size={14} />
            </span>
            <span className="supervisor-details-toggle-text">
              {detailsOpen ? t("action.collapse") : t("action.expand")}
            </span>
          </button>

          {detailsOpen ? (
            <div className="supervisor-details-panel">
              {targetMemory ? (
                <dl
                  className="supervisor-meta-grid"
                  aria-label={t("supervisor.target_memory.title")}
                >
                  <div className="supervisor-meta-item">
                    <dt className="supervisor-meta-label">
                      {t("supervisor.target_memory.target")}
                    </dt>
                    <dd className="supervisor-meta-value">{supervisor.targetId}</dd>
                  </div>
                  <div className="supervisor-meta-item">
                    <dt className="supervisor-meta-label">{t("supervisor.target_memory.plan")}</dt>
                    <dd className="supervisor-meta-value">{planGeneratedLabel}</dd>
                  </div>
                  <div className="supervisor-meta-item">
                    <dt className="supervisor-meta-label">
                      {t("supervisor.target_memory.stalled")}
                    </dt>
                    <dd className="supervisor-meta-value">{String(targetMemory.stalledCount)}</dd>
                  </div>
                </dl>
              ) : null}

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

              {targetMemory?.progressSummary ? (
                <div
                  className="supervisor-history-list"
                  aria-label={t("supervisor.target_memory.progress_title")}
                >
                  <div className="supervisor-history-item">
                    <span className="supervisor-history-trigger">{targetProgressLabel}</span>
                    <span className="supervisor-history-result">
                      {targetMemory.progressSummary}
                    </span>
                  </div>
                </div>
              ) : null}

              {targetPlanItems.length > 0 ? (
                <ol
                  className="supervisor-history-list"
                  aria-label={t("supervisor.target_memory.plan_title")}
                >
                  {targetPlanItems.slice(0, 3).map((step) => (
                    <li
                      key={step.id}
                      className="supervisor-history-item"
                      data-trigger={step.status}
                    >
                      <span className="supervisor-history-trigger">
                        {t(`supervisor.target_memory.step_status.${step.status}`)}
                      </span>
                      <span className="supervisor-history-result">{step.title}</span>
                    </li>
                  ))}
                </ol>
              ) : null}

              {latestTargetCycle?.reason ? (
                <ol
                  className="supervisor-history-list"
                  aria-label={t("supervisor.target_memory.reasoning_title")}
                >
                  <li className="supervisor-history-item" data-trigger={latestTargetCycle.result}>
                    <span className="supervisor-history-trigger">{targetCycleResultLabel}</span>
                    <span className="supervisor-history-result">{latestTargetCycle.reason}</span>
                  </li>
                </ol>
              ) : null}
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
