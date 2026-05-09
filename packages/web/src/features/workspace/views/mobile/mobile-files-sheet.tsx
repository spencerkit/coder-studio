import { ChevronsUp, FilePlus, FolderPlus } from "lucide-react";
import { IconButton, Tab, TabList, Tabs, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import {
  CodeEditorHost,
  type CodeEditorState,
} from "../../../code-editor/views/shared/code-editor-host";
import type { CreateRequest } from "../../actions/use-file-actions";
import { useGitDiffViewerActions } from "../../actions/use-git-actions";
import type { MobileFilesRoute } from "../../actions/use-workspace-screen-model";
import { FileTreePanel } from "../shared/file-tree-panel";
import { GitDiffViewer } from "../shared/git-diff-viewer";
import { GitPanel } from "../shared/git-panel";

interface MobileFilesSheetProps {
  workspaceId: string;
  route: MobileFilesRoute;
  activeTab: "files" | "git";
  createRequest?: CreateRequest | null;
  onCreateRequestConsumed?: () => void;
  collapseVersion?: number;
  onCreateFile?: () => void;
  onCreateFolder?: () => void;
  onCollapseAll?: () => void;
  onRouteChange?: (route: MobileFilesRoute) => void;
  onTabChange?: (tab: "files" | "git") => void;
  onCloseSheet?: () => void;
  editorState?: CodeEditorState;
}

export function MobileFilesSheet({
  workspaceId,
  route,
  activeTab,
  createRequest = null,
  onCreateRequestConsumed,
  collapseVersion = 0,
  onCreateFile,
  onCreateFolder,
  onCollapseAll,
  onRouteChange,
  onTabChange,
  onCloseSheet,
  editorState,
}: MobileFilesSheetProps) {
  const t = useTranslation();
  const { closePreview } = useGitDiffViewerActions(workspaceId);

  const handlePreviewChange = (preview: { path: string }) => {
    onRouteChange?.({ kind: "diff", path: preview.path });
  };

  const handleCloseDiff = () => {
    closePreview();
    onCloseSheet?.();
  };

  if (route.kind === "editor") {
    return (
      <div className="mobile-files-sheet">
        <div className="mobile-files-sheet__detail">
          <CodeEditorHost chrome="content-only" editorState={editorState} />
        </div>
      </div>
    );
  }

  if (route.kind === "diff") {
    return (
      <div className="mobile-files-sheet">
        <div className="mobile-files-sheet__detail">
          <GitDiffViewer
            workspaceId={workspaceId}
            onClose={handleCloseDiff}
            showCloseButton={false}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-files-sheet mobile-files-sheet--root">
      <div className="mobile-files-sheet__segmented">
        <Tabs
          aria-label={t("mobile.files.tabs")}
          onValueChange={(tab) => onTabChange?.(tab as "files" | "git")}
          value={activeTab}
        >
          <TabList className="mobile-files-sheet__tabs">
            <Tab className="mobile-files-sheet__segment panel-tab" value="files">
              <span>{t("file.title")}</span>
            </Tab>
            <Tab className="mobile-files-sheet__segment panel-tab" value="git">
              <span>{t("label.git")}</span>
            </Tab>
          </TabList>
        </Tabs>

        {activeTab === "files" ? (
          <div className="mobile-files-sheet__tab-actions">
            <Tooltip content={t("file.new_file")}>
              <IconButton
                className="mobile-files-sheet__tab-action"
                aria-label={t("file.new_file")}
                icon={<FilePlus size={14} />}
                onClick={onCreateFile}
                size="sm"
              />
            </Tooltip>
            <Tooltip content={t("file.new_folder")}>
              <IconButton
                className="mobile-files-sheet__tab-action"
                aria-label={t("file.new_folder")}
                icon={<FolderPlus size={14} />}
                onClick={onCreateFolder}
                size="sm"
              />
            </Tooltip>
            <Tooltip content={t("file.collapse_all")}>
              <IconButton
                className="mobile-files-sheet__tab-action"
                aria-label={t("file.collapse_all")}
                icon={<ChevronsUp size={14} />}
                onClick={onCollapseAll}
                size="sm"
              />
            </Tooltip>
          </div>
        ) : null}
      </div>

      <div className="mobile-files-sheet__content">
        {activeTab === "files" ? (
          <FileTreePanel
            workspaceId={workspaceId}
            createRequest={createRequest}
            onCreateRequestConsumed={onCreateRequestConsumed}
            onSelectFile={(path) => onRouteChange?.({ kind: "editor", path })}
            collapseVersion={collapseVersion}
            variant="mobile"
          />
        ) : (
          <GitPanel
            workspaceId={workspaceId}
            onPreviewOpen={handlePreviewChange}
            variant="mobile"
          />
        )}
      </div>
    </div>
  );
}
