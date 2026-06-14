import { Globe, X } from "lucide-react";
import type { FC, PointerEvent } from "react";
import { useState } from "react";
import { EmptyState, IconButton, ThemedIcon, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { DevBrowserSurface } from "../../../dev-browser/dev-browser-surface";
import { mergeOpenEditorPaths } from "../../../workspace/actions/open-editor-state";
import { deriveDocumentPreviewKind, type WorkspaceEditorTab } from "../../../workspace/atoms";
import { CommitFileListPreview } from "../../components/commit-file-list-preview";
import { DocumentPreview } from "../../components/document-preview";
import { ImageDiffPreview } from "../../components/image-diff-preview";
import { ImagePreview } from "../../components/image-preview";
import { MonacoDiffHost } from "../../components/monaco-diff-host";
import { MonacoHost } from "../../components/monaco-host";
import { isSystemAgentInstructionsEditorPath } from "../../system-agent-instructions-path";
import type { CodeEditorChrome, CodeEditorState } from "./code-editor-host";
import { CodeEditorDesktopHeaderActions } from "./code-editor-host";
import {
  CodeEditorTabsHeader,
  getFileName,
  getFullWorkspaceFilePath,
} from "./code-editor-tabs-header";

interface EditorSurfaceProps {
  state: CodeEditorState;
  chrome?: CodeEditorChrome;
  editorPinned?: boolean;
  onBeginFloatingEditorMove?: (event: PointerEvent<HTMLButtonElement>) => void;
  onToggleEditorPinned?: (pinned: boolean) => void;
}

const CLOSE_TO_RESTORE_ANIMATION_MS = 180;

type TextDiffPreview = Extract<
  NonNullable<CodeEditorState["activeDiffChange"]>,
  {
    kind: "worktree-file-diff" | "commit-file-diff" | "search-replace-file-diff";
  }
>;

function getTextDiffFilePath(preview: TextDiffPreview, fallbackPath?: string): string {
  if (preview.kind === "worktree-file-diff" || preview.kind === "commit-file-diff") {
    return preview.modifiedPath ?? preview.path ?? fallbackPath ?? "diff.patch";
  }

  return preview.path ?? fallbackPath ?? "diff.patch";
}

function getTextDiffModifiedContent(preview: TextDiffPreview): string {
  if (preview.kind === "worktree-file-diff" || preview.kind === "commit-file-diff") {
    return preview.modifiedContent ?? preview.diff ?? "";
  }

  return preview.modifiedContent ?? "";
}

export const EditorSurface: FC<EditorSurfaceProps> = ({
  state,
  chrome = "full",
  editorPinned,
  onBeginFloatingEditorMove,
  onToggleEditorPinned,
}) => {
  const t = useTranslation();
  const [closingToRestore, setClosingToRestore] = useState(false);
  const {
    activeFilePath,
    activeEditorTab,
    activeDiffChange,
    activeExternalStatus,
    activeLoadError,
    activateEditorTab,
    activateOpenFile,
    closeEditorTab,
    closeOpenFilePath,
    currentFile,
    documentPreview,
    handleClose,
    handleContentChange,
    hideEditorView,
    handleSave,
    hasUnsavedChangesOutsideDiff,
    mode,
    openBrowserTab,
    openEditorPaths,
    openEditorTabs,
    openFiles,
    pendingNavigationAtom,
    saveError,
    workspace,
  } = state;

  if (!workspace) {
    return (
      <div className="workspace-git-view">
        <div className="code-editor workspace-git-editor">
          <div className="code-editor-body">
            <EmptyState
              className="git-diff-empty"
              title={<p className="git-diff-empty-title">{t("workspace.no_workspace")}</p>}
            />
          </div>
        </div>
      </div>
    );
  }

  const activePreviewKind = activeDiffChange?.kind;
  const resolvedActiveEditorTab =
    activeEditorTab?.kind === "browser"
      ? activeEditorTab
      : activeFilePath
        ? { kind: "file" as const, path: activeFilePath }
        : activeEditorTab;
  const isBrowserEditorTabActive = resolvedActiveEditorTab?.kind === "browser";
  const currentTextFile = currentFile?.kind === "text" ? currentFile : null;
  const currentImageFile = currentFile?.kind === "image" ? currentFile : null;
  const showHeader = chrome === "full";
  const commitFileListPreview = activePreviewKind === "commit-file-list" ? activeDiffChange : null;
  const commitFileDiffPreview = activePreviewKind === "commit-file-diff" ? activeDiffChange : null;
  const searchReplaceDiffPreview =
    activePreviewKind === "search-replace-file-diff" ? activeDiffChange : null;
  const worktreeFileDiffPreview =
    activePreviewKind === "worktree-file-diff" ? activeDiffChange : null;
  const isCommitFileListPreview = commitFileListPreview !== null;
  const isCommitFileDiffPreview = commitFileDiffPreview !== null;
  const isCommitPreview = isCommitFileListPreview || isCommitFileDiffPreview;
  const commitPreview = commitFileListPreview ?? commitFileDiffPreview;
  const isDirtyTextFile = !isCommitPreview && currentTextFile?.isDirty === true;
  const textDiffPreview =
    worktreeFileDiffPreview && mode === "diff" && worktreeFileDiffPreview.renderAs === "text"
      ? worktreeFileDiffPreview
      : searchReplaceDiffPreview && mode === "diff"
        ? searchReplaceDiffPreview
        : commitFileDiffPreview?.renderAs === "text"
          ? commitFileDiffPreview
          : null;
  const imageDiffPreview =
    worktreeFileDiffPreview && mode === "diff" && worktreeFileDiffPreview.renderAs === "image"
      ? worktreeFileDiffPreview
      : commitFileDiffPreview?.renderAs === "image"
        ? commitFileDiffPreview
        : null;
  const canRenderTextDiff = textDiffPreview !== null;
  const canRenderImageDiff = imageDiffPreview !== null;
  const isSystemTextFile = Boolean(
    currentTextFile && isSystemAgentInstructionsEditorPath(currentTextFile.path)
  );
  const shouldRenderDocumentPreview =
    mode === "preview" &&
    currentTextFile !== null &&
    deriveDocumentPreviewKind(currentTextFile.path) !== null;
  const titleText = commitPreview
    ? (commitPreview.title ?? commitPreview.path)
    : currentFile
      ? (currentFile.displayPath ?? getFileName(currentFile.path))
      : (activeDiffChange?.title ?? activeFilePath ?? t("file.title"));
  const visibleEditorPaths = isCommitPreview
    ? []
    : mergeOpenEditorPaths(openEditorPaths, activeFilePath ? [activeFilePath] : undefined);
  const visibleEditorTabs = isCommitPreview
    ? []
    : [
        ...visibleEditorPaths.map((path) => ({ kind: "file" as const, path })),
        ...openEditorTabs.filter((tab) => tab.kind === "browser"),
      ];
  const activeFullPath =
    currentFile?.displayPath ??
    (activeFilePath ? getFullWorkspaceFilePath(workspace.path, activeFilePath) : titleText);
  const dirtyStatusLabel = isDirtyTextFile ? t("code_editor.modified_unsaved_changes") : null;
  const handleActivateEditorTab = (tab: WorkspaceEditorTab) => {
    if (tab.kind === "browser" || isBrowserEditorTabActive) {
      activateEditorTab(tab);
      return;
    }

    activateOpenFile(tab.path);
  };
  const handleCloseEditorTab = (tab: WorkspaceEditorTab) => {
    if (tab.kind === "browser" || isBrowserEditorTabActive) {
      closeEditorTab(tab);
      return;
    }

    closeOpenFilePath?.(tab.path);
  };
  const requestClose = () => {
    if (closingToRestore) {
      return;
    }

    setClosingToRestore(true);
    window.setTimeout(() => {
      void hideEditorView();
    }, CLOSE_TO_RESTORE_ANIMATION_MS);
  };
  const buildRevisionUrl = (path: string, revision?: string) => {
    const query = new URLSearchParams({
      workspaceId: workspace.id,
      path,
    });
    if (revision) {
      query.set("revision", revision);
    }
    return `/api/file?${query.toString()}`;
  };
  const imageDiffPath = imageDiffPreview
    ? (imageDiffPreview.modifiedPath ?? imageDiffPreview.originalPath ?? imageDiffPreview.path)
    : null;
  const imageDiffMime = imageDiffPreview
    ? (imageDiffPreview.mime ?? currentImageFile?.mime ?? "application/octet-stream")
    : null;
  const imageDiffBeforeUrl = imageDiffPreview?.originalPath
    ? buildRevisionUrl(
        imageDiffPreview.originalPath,
        imageDiffPreview.originalRevision === "WORKTREE"
          ? undefined
          : imageDiffPreview.originalRevision
      )
    : undefined;
  const imageDiffAfterUrl =
    imageDiffPreview?.modifiedPath && imageDiffPreview.status !== "deleted"
      ? buildRevisionUrl(
          imageDiffPreview.modifiedPath,
          imageDiffPreview.modifiedRevision === "WORKTREE"
            ? undefined
            : imageDiffPreview.modifiedRevision
        )
      : undefined;

  return (
    <div
      className={`workspace-git-view${closingToRestore ? " workspace-git-view--closing-to-restore" : ""}`}
    >
      <div className="code-editor workspace-git-editor">
        {showHeader ? (
          isCommitPreview ? (
            <div className="code-editor-header editor-surface__header">
              <span className="code-file-path" title={titleText}>
                {titleText}
              </span>
              <div
                className="editor-surface__toolbar"
                role="toolbar"
                aria-label={t("code_editor.toolbar_actions")}
              >
                <Tooltip content={t("action.close")}>
                  <IconButton
                    aria-label={t("action.close")}
                    className="code-mode-btn editor-surface__action-btn"
                    icon={<X size={14} />}
                    onClick={handleClose}
                    size="sm"
                  />
                </Tooltip>
              </div>
            </div>
          ) : (
            <CodeEditorTabsHeader
              activeFilePath={activeFilePath}
              activeFullPath={activeFullPath}
              activeEditorTab={resolvedActiveEditorTab}
              dirtyStatusLabel={dirtyStatusLabel}
              onActivateOpenFile={activateOpenFile}
              onActivateEditorTab={handleActivateEditorTab}
              onCloseEditorTab={handleCloseEditorTab}
              onCloseOpenFilePath={closeOpenFilePath}
              openEditorPaths={visibleEditorPaths}
              openEditorTabs={visibleEditorTabs}
              openFiles={openFiles}
              showPathRow={!isBrowserEditorTabActive}
              workspaceRootPath={workspace.path}
              tabbarActions={
                <>
                  <Tooltip content={t("code_editor.open_browser_tab")}>
                    <IconButton
                      aria-label={t("code_editor.open_browser_tab")}
                      className="code-mode-btn editor-surface__action-btn editor-surface__browser-btn"
                      icon={<Globe size={14} />}
                      onClick={openBrowserTab}
                      size="sm"
                    />
                  </Tooltip>
                  <CodeEditorDesktopHeaderActions
                    state={state}
                    onRequestClose={requestClose}
                    editorPinned={editorPinned}
                    onBeginFloatingEditorMove={onBeginFloatingEditorMove}
                    onToggleEditorPinned={onToggleEditorPinned}
                    showModeActions={false}
                  />
                </>
              }
              pathActions={
                <>
                  <CodeEditorDesktopHeaderActions state={state} showCloseAction={false} />
                </>
              }
            />
          )
        ) : null}

        {!isCommitPreview && !isBrowserEditorTabActive && saveError ? (
          <div className="code-editor-error" role="alert">
            <ThemedIcon semantic="state.error" size={14} />
            <span>{saveError}</span>
          </div>
        ) : null}

        {!isCommitPreview && !isBrowserEditorTabActive && activeExternalStatus ? (
          <div className="code-editor-error" role="alert">
            <ThemedIcon
              semantic={
                activeExternalStatus === "deleted" ? "state.fileDeleted" : "state.fileModified"
              }
              size={14}
            />
            <span>
              {activeExternalStatus === "deleted"
                ? t("code_editor.deleted_on_disk")
                : t("code_editor.modified_on_disk")}
            </span>
          </div>
        ) : null}

        {!isCommitPreview && !isBrowserEditorTabActive && hasUnsavedChangesOutsideDiff ? (
          <div className="code-editor-error" role="alert">
            <ThemedIcon semantic="state.warning" size={14} />
            <span>{t("code_editor.diff_saved_only")}</span>
          </div>
        ) : null}

        <div className="code-editor-body">
          {isBrowserEditorTabActive ? (
            <DevBrowserSurface
              key={resolvedActiveEditorTab.id}
              workspaceId={workspace.id}
              browserTab={resolvedActiveEditorTab}
            />
          ) : isCommitFileListPreview ? (
            <CommitFileListPreview
              preview={commitFileListPreview}
              onOpenFile={(file) => void state.openCommitFileDiff(file)}
            />
          ) : canRenderTextDiff ? (
            <MonacoDiffHost
              filePath={getTextDiffFilePath(textDiffPreview, currentFile?.path)}
              originalContent={textDiffPreview.originalContent ?? ""}
              modifiedContent={getTextDiffModifiedContent(textDiffPreview)}
            />
          ) : canRenderImageDiff && imageDiffPath && imageDiffMime ? (
            <ImageDiffPreview
              path={imageDiffPath}
              mime={imageDiffMime}
              status={imageDiffPreview.status ?? "modified"}
              beforeUrl={imageDiffBeforeUrl}
              afterUrl={imageDiffAfterUrl}
            />
          ) : shouldRenderDocumentPreview && currentTextFile ? (
            <DocumentPreview
              src={documentPreview.iframeSrc}
              title={currentTextFile.path}
              allowScripts={documentPreview.allowScripts}
              isLoading={documentPreview.isBootstrapping}
              error={documentPreview.error}
              onRetry={documentPreview.retry}
            />
          ) : currentTextFile ? (
            <MonacoHost
              workspaceId={workspace.id}
              workspaceRootPath={isSystemTextFile ? undefined : workspace.path}
              filePath={currentTextFile.displayPath ?? currentTextFile.path}
              content={currentTextFile.content}
              pendingNavigationAtom={pendingNavigationAtom}
              standalone={isSystemTextFile}
              onContentChange={handleContentChange}
              onSave={handleSave}
              readOnly={mode === "preview"}
            />
          ) : currentImageFile ? (
            <ImagePreview
              url={currentImageFile.url}
              version={currentImageFile.version}
              mime={currentImageFile.mime}
              sizeBytes={currentImageFile.size}
              alt={currentImageFile.path}
            />
          ) : activeLoadError ? (
            <EmptyState
              className="git-diff-empty"
              description={<p className="git-diff-empty-body">{activeLoadError}</p>}
              role="alert"
              title={<p className="git-diff-empty-title">{t("code_editor.open_failed_title")}</p>}
            />
          ) : activeFilePath ? (
            <EmptyState
              className="git-diff-empty"
              title={<p className="git-diff-empty-title">{t("status.connecting")}…</p>}
            />
          ) : (
            <EmptyState
              className="git-diff-empty"
              description={<p className="git-diff-empty-body">{t("code_editor.empty_hint")}</p>}
              title={<p className="git-diff-empty-title">{t("file.title")}</p>}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default EditorSurface;
