import { EmptyState } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";

interface TasksPanelProps {
  workspaceId: string;
}

export function TasksPanel({ workspaceId }: TasksPanelProps) {
  const t = useTranslation();

  return (
    <div className="tasks-panel" data-workspace-id={workspaceId}>
      <EmptyState
        className="tasks-empty"
        title={<p>{t("bottom_panel.tasks")}</p>}
        description={<p>{t("tasks.placeholder")}</p>}
      />
    </div>
  );
}
