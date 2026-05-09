import { useTranslation } from "../../../../lib/i18n";
import { WorkspaceResolvingStateShell } from "./workspace-empty-state";

export function WorkspaceLoadingState() {
  const t = useTranslation();

  return (
    <WorkspaceResolvingStateShell
      testId="workspace-resolving-shell"
      title={t("workspace.loading_title")}
      description={t("workspace.loading_description")}
    />
  );
}
