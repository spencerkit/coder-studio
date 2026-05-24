import type { FC } from "react";
import { useState } from "react";
import { useTranslation } from "../../../../lib/i18n";
import { PanelHeader } from "../../../shared/components/panel-header";
import type { WorkspaceCreateRequest } from "../../actions/use-workspace-screen-model";
import { FileTreePanel } from "./file-tree-panel";
import { OpenEditorsSection } from "./open-editors-section";
import { WorkspaceSectionHeader } from "./workspace-section-header";

interface ExplorerPanelProps {
  workspaceId: string;
  createRequest: WorkspaceCreateRequest | null;
  onCreateRequestConsumed: () => void;
  onOpenFileCreate: () => void;
  onOpenFolderCreate: () => void;
}

export const ExplorerPanel: FC<ExplorerPanelProps> = ({
  workspaceId,
  createRequest,
  onCreateRequestConsumed,
  onOpenFileCreate,
  onOpenFolderCreate,
}) => {
  const t = useTranslation();
  const [collapseVersion, setCollapseVersion] = useState(0);

  return (
    <div className="workspace-sidebar-view">
      <PanelHeader title={t("workspace.sidebar.explorer")} />

      <div className="workspace-sidebar-panel__body workspace-sidebar-panel__body--stacked">
        <OpenEditorsSection workspaceId={workspaceId} />

        <section className="workspace-sidebar-section workspace-sidebar-section--fill">
          <WorkspaceSectionHeader
            onOpenFileCreate={onOpenFileCreate}
            onOpenFolderCreate={onOpenFolderCreate}
            onCollapseAll={() => setCollapseVersion((value) => value + 1)}
          />
          <FileTreePanel
            workspaceId={workspaceId}
            createRequest={createRequest}
            onCreateRequestConsumed={onCreateRequestConsumed}
            collapseVersion={collapseVersion}
            variant="desktop"
            showSearch={false}
          />
        </section>
      </div>
    </div>
  );
};
