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
  return (
    <div className="supervisor-details" aria-label={t("supervisor.target_memory.title")}>
      <section className="supervisor-details-section">
        <h3 className="supervisor-details-section-title">
          {t("supervisor.target_memory.basic_info_title")}
        </h3>
        <div className="supervisor-summary-card">
          <div className="supervisor-meta-grid">
            <div className="supervisor-meta-item">
              <p className="supervisor-meta-label">{t("supervisor.field.objective")}</p>
              <p className="supervisor-meta-value supervisor-meta-value--wrap">
                {supervisor.objective}
              </p>
            </div>
            <div className="supervisor-meta-item">
              <p className="supervisor-meta-label">{t("supervisor.target_memory.cycles_title")}</p>
              <p className="supervisor-meta-value">
                {completedCycles} / {cycleCap}
              </p>
            </div>
          </div>
        </div>
      </section>

      {recentReasoning ? (
        <section className="supervisor-details-section">
          <h3 className="supervisor-details-section-title">
            {t("supervisor.target_memory.reasoning_title")}
          </h3>
          <div className="supervisor-meta-item supervisor-meta-item--reasoning">
            <p className="supervisor-meta-value supervisor-meta-value--wrap">{recentReasoning}</p>
          </div>
        </section>
      ) : null}

      {targetMemory?.items.length ? (
        <section className="supervisor-details-section">
          <h3 className="supervisor-details-section-title">
            {t("supervisor.target_memory.progress_list_title")}
          </h3>
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
        </section>
      ) : null}

      <div className="supervisor-details-actions">
        <Button onClick={onEdit}>{t("supervisor.action.edit_objective")}</Button>
      </div>
    </div>
  );
}
