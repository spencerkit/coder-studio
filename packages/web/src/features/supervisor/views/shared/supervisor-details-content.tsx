import { Button, Tag } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { useSupervisorActions } from "../../actions/use-supervisor-actions";

interface SupervisorDetailsContentProps {
  sessionId: string;
  workspaceId: string;
  onEdit: () => void;
}

export function SupervisorDetailsContent({
  sessionId,
  workspaceId,
  onEdit,
}: SupervisorDetailsContentProps) {
  const t = useTranslation();
  const { recentReasoning, supervisor, targetMemory } = useSupervisorActions({ sessionId });

  if (!supervisor) {
    return null;
  }

  const completedCycles = supervisor.completedSupervisionCount;
  const cycleCap =
    supervisor.maxSupervisionCount > 0
      ? String(supervisor.maxSupervisionCount)
      : t("supervisor.meta.no_cap");
  const latestErrorCycle = supervisor.recentTargetCycles?.find((cycle) => cycle.result === "error");
  const evaluationError = latestErrorCycle?.errorReason ?? supervisor.errorReason ?? null;
  const runtimeStatus =
    supervisor.state === "error"
      ? "error"
      : supervisor.state === "evaluating" || supervisor.state === "injecting"
        ? "running"
        : "idle";

  return (
    <div className="supervisor-details" aria-label={t("supervisor.target_memory.title")}>
      <section className="supervisor-details-section">
        <div className="supervisor-details-section-header">
          <h3 className="supervisor-details-section-title">
            {t("supervisor.target_memory.basic_info_title")}
          </h3>
          <Button
            className="supervisor-details-edit-btn"
            onClick={onEdit}
            size="sm"
            variant="ghost"
          >
            {t("supervisor.action.edit_objective")}
          </Button>
        </div>
        <div className="supervisor-summary-card supervisor-details-surface">
          <div className="supervisor-meta-grid supervisor-meta-grid--stacked">
            <div className="supervisor-meta-item">
              <p className="supervisor-meta-label">{t("supervisor.field.objective")}</p>
              <p className="supervisor-meta-value supervisor-meta-value--wrap">
                {supervisor.objective}
              </p>
            </div>
            <div className="supervisor-meta-item">
              <p className="supervisor-meta-label">{t("supervisor.target_memory.cycles_title")}</p>
              <p className="supervisor-meta-value supervisor-meta-value--strong">
                {completedCycles} / {cycleCap}
              </p>
            </div>
            <div className="supervisor-meta-item">
              <p className="supervisor-meta-label">{t("supervisor.target_memory.runtime_title")}</p>
              <p className="supervisor-meta-value supervisor-meta-value--strong">
                {t(`supervisor.target_memory.runtime_status.${runtimeStatus}`)}
              </p>
            </div>
            {runtimeStatus === "error" && evaluationError ? (
              <div className="supervisor-meta-item">
                <p className="supervisor-meta-label">
                  {t("supervisor.target_memory.error_reason_label")}
                </p>
                <div className="supervisor-error" role="alert">
                  {evaluationError}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {recentReasoning && runtimeStatus !== "error" ? (
        <section className="supervisor-details-section">
          <h3 className="supervisor-details-section-title">
            {t("supervisor.target_memory.reasoning_title")}
          </h3>
          <div className="supervisor-details-surface supervisor-details-surface--reasoning supervisor-meta-item--reasoning">
            <p className="supervisor-meta-value supervisor-meta-value--wrap">{recentReasoning}</p>
          </div>
        </section>
      ) : null}

      {targetMemory?.items.length ? (
        <section className="supervisor-details-section">
          <h3 className="supervisor-details-section-title">
            {t("supervisor.target_memory.progress_list_title")}
          </h3>
          <div className="supervisor-details-surface supervisor-details-surface--progress">
            <div className="supervisor-progress-list supervisor-progress-list--checklist">
              {targetMemory.items.map((item) => {
                const isActive = item.id === targetMemory.activeItemId;
                const tagColor =
                  item.status === "done"
                    ? "green"
                    : item.status === "in_progress"
                      ? "blue"
                      : "neutral";

                return (
                  <article
                    key={item.id}
                    className={`supervisor-progress-item${isActive ? " supervisor-progress-item--active" : ""}`}
                  >
                    <div className="supervisor-progress-item__rail" aria-hidden="true">
                      <span
                        className={`supervisor-progress-item__marker supervisor-progress-item__marker--${item.status}`}
                      />
                    </div>
                    <div className="supervisor-progress-item__body">
                      <div className="supervisor-progress-item__header">
                        <p className="supervisor-progress-item__title">{item.title}</p>
                        <Tag color={tagColor} size="sm" caps={false}>
                          {t(`supervisor.target_memory.step_status.${item.status}`)}
                        </Tag>
                      </div>
                      <p className="supervisor-progress-item__meta-label">
                        {t("supervisor.target_memory.item_objective_title")}
                      </p>
                      <p className="supervisor-progress-item__meta-value">{item.objective}</p>
                      <p className="supervisor-progress-item__meta-label">
                        {t("supervisor.target_memory.item_deliverable_title")}
                      </p>
                      <p className="supervisor-progress-item__meta-value">{item.deliverable}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
