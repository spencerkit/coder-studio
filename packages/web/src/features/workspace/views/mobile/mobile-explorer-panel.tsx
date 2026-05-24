import type { CreateRequest } from "../../actions/use-file-actions";
import { FileTreePanel } from "../shared/file-tree-panel";
import { OpenEditorsSection } from "../shared/open-editors-section";
import { QuickJumpSection } from "../shared/quick-jump-section";
import { WorkspaceSectionHeader } from "../shared/workspace-section-header";

interface MobileExplorerPanelProps {
  workspaceId: string;
  createRequest?: CreateRequest | null;
  onCreateRequestConsumed?: () => void;
  collapseVersion?: number;
  onOpenFileCreate?: () => void;
  onOpenFolderCreate?: () => void;
  onCollapseAll?: () => void;
  routeToDetail: (path: string) => void;
}

export function MobileExplorerPanel({
  workspaceId,
  createRequest = null,
  onCreateRequestConsumed,
  collapseVersion = 0,
  onOpenFileCreate,
  onOpenFolderCreate,
  onCollapseAll,
  routeToDetail,
}: MobileExplorerPanelProps) {
  return (
    <div className="mobile-explorer-panel">
      <QuickJumpSection workspaceId={workspaceId} onSelectFile={routeToDetail} />
      <OpenEditorsSection workspaceId={workspaceId} onSelectFile={routeToDetail} />
      <section className="workspace-sidebar-section workspace-sidebar-section--fill">
        <WorkspaceSectionHeader
          onOpenFileCreate={onOpenFileCreate}
          onOpenFolderCreate={onOpenFolderCreate}
          onCollapseAll={onCollapseAll}
        />
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
