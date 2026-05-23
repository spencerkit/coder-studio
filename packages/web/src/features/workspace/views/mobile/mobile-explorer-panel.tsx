import { useTranslation } from "../../../../lib/i18n";
import type { CreateRequest } from "../../actions/use-file-actions";
import { FileTreePanel } from "../shared/file-tree-panel";
import { OpenEditorsSection } from "../shared/open-editors-section";
import { QuickJumpSection } from "../shared/quick-jump-section";

interface MobileExplorerPanelProps {
  workspaceId: string;
  createRequest?: CreateRequest | null;
  onCreateRequestConsumed?: () => void;
  collapseVersion?: number;
  routeToDetail: (path: string) => void;
}

export function MobileExplorerPanel({
  workspaceId,
  createRequest = null,
  onCreateRequestConsumed,
  collapseVersion = 0,
  routeToDetail,
}: MobileExplorerPanelProps) {
  const t = useTranslation();

  return (
    <div className="mobile-explorer-panel">
      <OpenEditorsSection workspaceId={workspaceId} onSelectFile={routeToDetail} />
      <QuickJumpSection workspaceId={workspaceId} onSelectFile={routeToDetail} />
      <section className="workspace-sidebar-section workspace-sidebar-section--fill">
        <h2 className="workspace-sidebar-section__title">{t("workspace.sidebar.workspace")}</h2>
        <FileTreePanel
          workspaceId={workspaceId}
          createRequest={createRequest}
          onCreateRequestConsumed={onCreateRequestConsumed}
          onSelectFile={routeToDetail}
          collapseVersion={collapseVersion}
          variant="mobile"
          showSearch={false}
        />
      </section>
    </div>
  );
}
