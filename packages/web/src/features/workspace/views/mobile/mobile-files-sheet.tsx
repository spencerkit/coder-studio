import { ChevronsUp, FilePlus, FolderPlus } from "lucide-react";
import { Tab, TabList, Tabs } from "../../../../components/ui";
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
          onValueChange={onTabChange ?? (() => {})}
          value={activeTab}
        >
          <TabList className="panel-tabs mobile-files-sheet__tabs">
            <Tab className="panel-tab mobile-files-sheet__segment" value="files">
              {t("file.title")}
            </Tab>
            <Tab className="panel-tab mobile-files-sheet__segment" value="git">
              {t("label.git")}
            </Tab>
          </TabList>
        </Tabs>

        {activeTab === "files" ? (
          <div className="mobile-files-sheet__tab-actions">
            <button
              type="button"
              className="mobile-files-sheet__tab-action"
              aria-label={t("file.new_file")}
              title={t("file.new_file")}
              onClick={onCreateFile}
            >
              <FilePlus size={14} />
            </button>
            <button
              type="button"
              className="mobile-files-sheet__tab-action"
              aria-label={t("file.new_folder")}
              title={t("file.new_folder")}
              onClick={onCreateFolder}
            >
              <FolderPlus size={14} />
            </button>
            <button
              type="button"
              className="mobile-files-sheet__tab-action"
              aria-label={t("file.collapse_all")}
              title={t("file.collapse_all")}
              onClick={onCollapseAll}
            >
              <ChevronsUp size={14} />
            </button>
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
