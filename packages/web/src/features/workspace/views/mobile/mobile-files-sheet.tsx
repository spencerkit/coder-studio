import { ChevronsUp, FolderTree, GitBranch, Search } from "lucide-react";
import { IconButton, Tab, TabList, Tabs, ThemedIcon, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import {
  CodeEditorHost,
  type CodeEditorState,
} from "../../../code-editor/views/shared/code-editor-host";
import type { CreateRequest } from "../../actions/use-file-actions";
import type {
  MobileFilesRoute,
  MobileWorkspaceSidebarView,
} from "../../actions/use-workspace-screen-model";
import type { GitDiffPreview } from "../../atoms";
import { GitPanel } from "../shared/git-panel";
import { SearchPanel } from "../shared/search-panel";
import { MobileExplorerPanel } from "./mobile-explorer-panel";

interface MobileFilesSheetProps {
  workspaceId: string;
  route: MobileFilesRoute;
  activeView: MobileWorkspaceSidebarView;
  createRequest?: CreateRequest | null;
  onCreateRequestConsumed?: () => void;
  collapseVersion?: number;
  onCreateFile?: () => void;
  onCreateFolder?: () => void;
  onCollapseAll?: () => void;
  onRouteChange?: (route: MobileFilesRoute) => void;
  onTabChange?: (view: MobileWorkspaceSidebarView) => void;
  onCloseSheet?: () => void;
  editorState?: CodeEditorState;
}

export function MobileFilesSheet({
  workspaceId,
  route,
  activeView,
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
  const handlePreviewOpen = (preview: GitDiffPreview) => {
    onRouteChange?.({
      kind: "detail",
      ...(preview.path ? { path: preview.path } : {}),
      ...(preview.title ? { title: preview.title } : {}),
    });
  };

  if (route.kind === "detail") {
    return (
      <div className="mobile-files-sheet">
        <div className="mobile-files-sheet__detail">
          <CodeEditorHost chrome="content-only" editorState={editorState} />
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-files-sheet mobile-files-sheet--root">
      <div className="mobile-files-sheet__segmented">
        <Tabs
          aria-label={t("mobile.files.tabs")}
          onValueChange={(view) => onTabChange?.(view as MobileWorkspaceSidebarView)}
          value={activeView}
        >
          <TabList className="mobile-files-sheet__tabs">
            <Tab
              aria-label={t("workspace.sidebar.explorer")}
              className="mobile-files-sheet__segment"
              value="explorer"
            >
              <span className="mobile-files-sheet__segment-icon" aria-hidden="true">
                <FolderTree size={16} aria-hidden="true" />
              </span>
            </Tab>
            <Tab
              aria-label={t("workspace.sidebar.search")}
              className="mobile-files-sheet__segment"
              value="search"
            >
              <span className="mobile-files-sheet__segment-icon" aria-hidden="true">
                <Search size={16} aria-hidden="true" />
              </span>
            </Tab>
            <Tab
              aria-label={t("workspace.sidebar.source_control")}
              className="mobile-files-sheet__segment"
              value="source-control"
            >
              <span className="mobile-files-sheet__segment-icon" aria-hidden="true">
                <GitBranch size={16} aria-hidden="true" />
              </span>
            </Tab>
          </TabList>
        </Tabs>

        {activeView === "explorer" ? (
          <div className="mobile-files-sheet__tab-actions">
            <Tooltip content={t("file.new_file")}>
              <IconButton
                className="mobile-files-sheet__tab-action"
                aria-label={t("file.new_file")}
                icon={<ThemedIcon semantic="file.action.new" size={14} />}
                onClick={onCreateFile}
                size="sm"
              />
            </Tooltip>
            <Tooltip content={t("file.new_folder")}>
              <IconButton
                className="mobile-files-sheet__tab-action"
                aria-label={t("file.new_folder")}
                icon={<ThemedIcon semantic="file.action.newFolder" size={14} />}
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
        {activeView === "explorer" ? (
          <MobileExplorerPanel
            workspaceId={workspaceId}
            createRequest={createRequest}
            onCreateRequestConsumed={onCreateRequestConsumed}
            routeToDetail={(path) => onRouteChange?.({ kind: "detail", path })}
            collapseVersion={collapseVersion}
          />
        ) : activeView === "search" ? (
          <SearchPanel
            workspaceId={workspaceId}
            variant="mobile"
            onSelectFile={(path) => onRouteChange?.({ kind: "detail", path })}
          />
        ) : (
          <GitPanel workspaceId={workspaceId} onPreviewOpen={handlePreviewOpen} variant="mobile" />
        )}
      </div>
    </div>
  );
}
