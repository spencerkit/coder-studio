import { useTranslation } from "../../../../lib/i18n";

interface WorkspaceEmptyStateProps {
  title?: string;
  description?: string;
}

export function WorkspaceEmptyState({ title, description }: WorkspaceEmptyStateProps) {
  const t = useTranslation();

  return (
    <div className="workspace-resolving-shell">
      <div className="workspace-resolving-card">
        <div className="workspace-resolving-kicker">{t("workspace.title")}</div>
        <div className="workspace-resolving-title">{title ?? t("workspace.load_failed_title")}</div>
        <div className="workspace-resolving-desc">
          {description ?? t("workspace.load_failed_description")}
        </div>
      </div>
    </div>
  );
}
