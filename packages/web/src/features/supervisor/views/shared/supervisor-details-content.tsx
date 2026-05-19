import { Button } from "../../../../components/ui";
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
  const {
    activeItem,
    decompositionModeLabel,
    decompositionStatusLabel,
    recentReasoning,
    supervisor,
    targetMemory,
  } = useSupervisorActions({ sessionId });

  if (!supervisor) {
    return null;
  }

  return (
    <div className="supervisor-details" aria-label={t("supervisor.target_memory.title")}>
      {targetMemory ? (
        <>
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
        </>
      ) : (
        <div className="supervisor-meta-item">
          <p className="supervisor-meta-label">{t("supervisor.field.current_objective")}</p>
          <p className="supervisor-meta-value">{supervisor.objective}</p>
        </div>
      )}

      <div className="supervisor-details-actions">
        <Button onClick={onEdit}>{t("supervisor.action.edit_objective")}</Button>
      </div>
    </div>
  );
}
