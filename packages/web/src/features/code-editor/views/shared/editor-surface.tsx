import { X } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
import {
  ConfirmDialog,
  EmptyState,
  IconButton,
  ThemedIcon,
  Tooltip,
} from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { deriveDocumentPreviewKind } from "../../../workspace/atoms";
import { CommitFileListPreview } from "../../components/commit-file-list-preview";
import { DocumentPreview } from "../../components/document-preview";
import { ImageDiffPreview } from "../../components/image-diff-preview";
import { ImagePreview } from "../../components/image-preview";
import { MonacoDiffHost } from "../../components/monaco-diff-host";
import { MonacoHost } from "../../components/monaco-host";
import { isSystemAgentInstructionsEditorPath } from "../../system-agent-instructions-path";
import type { CodeEditorChrome, CodeEditorState } from "./code-editor-host";
import { CodeEditorDesktopHeaderActions } from "./code-editor-host";

interface EditorSurfaceProps {
  state: CodeEditorState;
  chrome?: CodeEditorChrome;
}

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export const EditorSurface: FC<EditorSurfaceProps> = ({ state, chrome = "full" }) => {
  const t = useTranslation();
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const {
    activeFilePath,
    activeDiffChange,
    activeExternalStatus,
    activeLoadError,
    currentFile,
    documentPreview,
    handleClose,
    handleContentChange,
    handleSave,
    hasUnsavedChangesOutsideDiff,
    mode,
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
  const dirtyIndicator = isDirtyTextFile ? (
    <span
      className="dirty-indicator"
      aria-label={t("code_editor.unsaved_changes")}
      title={t("code_editor.unsaved_changes")}
    />
  ) : null;
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
  const closeConfirmFileName =
    currentTextFile?.path !== undefined ? getFileName(currentTextFile.path) : t("file.title");
  const requestClose = () => {
    if (isDirtyTextFile) {
      setCloseConfirmOpen(true);
      return;
    }

    void handleClose();
  };
  const confirmClose = () => {
    setCloseConfirmOpen(false);
    void handleClose();
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
    <div className="workspace-git-view">
      <div className="code-editor workspace-git-editor">
        {showHeader ? (
          <div className="code-editor-header editor-surface__header">
            <span
              className="code-file-path"
              title={
                commitPreview
                  ? titleText
                  : (currentFile?.displayPath ?? currentFile?.path ?? titleText)
              }
            >
              {currentFile && !isCommitPreview ? (
                <>
                  <span className="code-file-path__name">{titleText}</span>
                  {dirtyIndicator}
                </>
              ) : (
                titleText
              )}
            </span>
            {isCommitPreview ? (
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
            ) : (
              <CodeEditorDesktopHeaderActions state={state} onRequestClose={requestClose} />
            )}
          </div>
        ) : null}

        {!isCommitPreview && saveError ? (
          <div className="code-editor-error" role="alert">
            <ThemedIcon semantic="state.error" size={14} />
            <span>{saveError}</span>
          </div>
        ) : null}

        {!isCommitPreview && activeExternalStatus ? (
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

        {!isCommitPreview && hasUnsavedChangesOutsideDiff ? (
          <div className="code-editor-error" role="alert">
            <ThemedIcon semantic="state.warning" size={14} />
            <span>{t("code_editor.diff_saved_only")}</span>
          </div>
        ) : null}

        <div className="code-editor-body">
          {isCommitFileListPreview ? (
            <CommitFileListPreview
              preview={commitFileListPreview}
              onOpenFile={(file) => void state.openCommitFileDiff(file)}
            />
          ) : canRenderTextDiff ? (
            <MonacoDiffHost
              filePath={
                textDiffPreview.modifiedPath ??
                textDiffPreview.path ??
                currentFile?.path ??
                "diff.patch"
              }
              originalContent={textDiffPreview.originalContent ?? ""}
              modifiedContent={textDiffPreview.modifiedContent ?? textDiffPreview.diff ?? ""}
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
      <ConfirmDialog
        open={closeConfirmOpen}
        onOpenChange={setCloseConfirmOpen}
        title={t("code_editor.close_unsaved_title")}
        description={t("code_editor.close_unsaved_description", { name: closeConfirmFileName })}
        cancelText={t("common.cancel")}
        confirmText={t("code_editor.discard_and_close")}
        tone="danger"
        onConfirm={confirmClose}
      />
    </div>
  );
};

export default EditorSurface;
