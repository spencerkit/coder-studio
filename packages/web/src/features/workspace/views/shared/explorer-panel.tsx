import type { FC } from "react";
import { useState } from "react";
import type { WorkspaceCreateRequest } from "../../actions/use-workspace-screen-model";
import { FileTreePanel } from "./file-tree-panel";
import { WorkspaceSectionHeader } from "./workspace-section-header";

interface ExplorerPanelProps {
  workspaceId: string;
  createRequest: WorkspaceCreateRequest | null;
  onCreateRequestConsumed: () => void;
  onOpenFileCreate: () => void;
  onOpenFolderCreate: () => void;
  refreshToken?: number;
}

export const ExplorerPanel: FC<ExplorerPanelProps> = ({
  workspaceId,
  createRequest,
  onCreateRequestConsumed,
  onOpenFileCreate,
  onOpenFolderCreate,
  refreshToken = 0,
}) => {
  const [collapseVersion, setCollapseVersion] = useState(0);
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false);
  const fileTreePanelId = `workspace-file-tree-${workspaceId}`;

  const handleOpenFileCreate = () => {
    setWorkspaceCollapsed(false);
    onOpenFileCreate();
  };

  const handleOpenFolderCreate = () => {
    setWorkspaceCollapsed(false);
    onOpenFolderCreate();
  };

  return (
    <div className="workspace-sidebar-view">
      <div className="workspace-sidebar-panel__body workspace-sidebar-panel__body--stacked">
        <section className="workspace-sidebar-section workspace-sidebar-section--fill">
          <WorkspaceSectionHeader
            isExpanded={!workspaceCollapsed}
            panelId={fileTreePanelId}
            onToggleExpanded={() => setWorkspaceCollapsed((value) => !value)}
            onOpenFileCreate={handleOpenFileCreate}
            onOpenFolderCreate={handleOpenFolderCreate}
            onCollapseAll={() => setCollapseVersion((value) => value + 1)}
          />
          {!workspaceCollapsed ? (
            <FileTreePanel
              workspaceId={workspaceId}
              createRequest={createRequest}
              onCreateRequestConsumed={onCreateRequestConsumed}
              collapseVersion={collapseVersion}
              refreshToken={refreshToken}
              variant="desktop"
              showSearch={false}
              preserveSourceOrder
              panelId={fileTreePanelId}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
};
