import { ChevronsUp } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
import { IconButton, ThemedIcon, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { PanelHeader } from "../../../shared/components/panel-header";
import type { WorkspaceCreateRequest } from "../../actions/use-workspace-screen-model";
import { FileTreePanel } from "./file-tree-panel";
import { OpenEditorsSection } from "./open-editors-section";

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
      <PanelHeader
        title={t("workspace.sidebar.explorer")}
        actions={
          <div className="workspace-sidebar-panel__actions">
            <Tooltip content={t("file.new_file")}>
              <IconButton
                className="panel-toolbar-btn"
                aria-label={t("file.new_file")}
                icon={<ThemedIcon semantic="file.action.new" size={14} />}
                onClick={onOpenFileCreate}
                size="sm"
              />
            </Tooltip>
            <Tooltip content={t("file.new_folder")}>
              <IconButton
                className="panel-toolbar-btn"
                aria-label={t("file.new_folder")}
                icon={<ThemedIcon semantic="file.action.newFolder" size={14} />}
                onClick={onOpenFolderCreate}
                size="sm"
              />
            </Tooltip>
            <Tooltip content={t("file.collapse_all")}>
              <IconButton
                className="panel-toolbar-btn"
                aria-label={t("file.collapse_all")}
                icon={<ChevronsUp size={14} />}
                onClick={() => setCollapseVersion((value) => value + 1)}
                size="sm"
              />
            </Tooltip>
          </div>
        }
      />

      <div className="workspace-sidebar-panel__body workspace-sidebar-panel__body--stacked">
        <OpenEditorsSection workspaceId={workspaceId} />

        <section className="workspace-sidebar-section workspace-sidebar-section--fill">
          <h2 className="workspace-sidebar-section__title">{t("workspace.sidebar.workspace")}</h2>
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
