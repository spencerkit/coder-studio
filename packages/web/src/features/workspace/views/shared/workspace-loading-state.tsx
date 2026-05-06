import { useTranslation } from "../../../../lib/i18n";

export function WorkspaceLoadingState() {
  const t = useTranslation();

  return (
    <div className="workspace-resolving-shell" data-testid="workspace-resolving-shell">
      <div className="workspace-resolving-card">
        <div className="workspace-resolving-kicker">{t("workspace.title")}</div>
        <div className="workspace-resolving-title">{t("workspace.loading_title")}</div>
        <div className="workspace-resolving-desc">{t("workspace.loading_description")}</div>
      </div>
    </div>
  );
}
