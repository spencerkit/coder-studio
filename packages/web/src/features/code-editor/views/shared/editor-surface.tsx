import { X } from "lucide-react";
import type { FC } from "react";
import { EmptyState, IconButton, ThemedIcon, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { deriveDocumentPreviewKind } from "../../../workspace/atoms";
import { DocumentPreview } from "../../components/document-preview";
import { ImageDiffPreview } from "../../components/image-diff-preview";
import { ImagePreview } from "../../components/image-preview";
import { MonacoDiffHost } from "../../components/monaco-diff-host";
import { MonacoHost } from "../../components/monaco-host";
import type { CodeEditorChrome, CodeEditorState } from "./code-editor-host";
import { CodeEditorDesktopHeaderActions } from "./code-editor-host";

interface EditorSurfaceProps {
  state: CodeEditorState;
  chrome?: CodeEditorChrome;
}

export const EditorSurface: FC<EditorSurfaceProps> = ({ state, chrome = "full" }) => {
  const t = useTranslation();
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
    openInDiffMode,
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

  const currentTextFile = currentFile?.kind === "text" ? currentFile : null;
  const currentImageFile = currentFile?.kind === "image" ? currentFile : null;
  const showHeader = chrome === "full";
  const isCommitPreview = activeDiffChange?.source === "commit";
  const dirtyIndicator =
    !isCommitPreview && currentTextFile?.isDirty ? (
      <span className="dirty-indicator">*</span>
    ) : null;
  const canRenderTextDiff =
    (mode === "diff" || isCommitPreview) &&
    Boolean(activeDiffChange) &&
    (activeDiffChange?.renderAs === "text" || activeDiffChange?.source === "commit");
  const canRenderImageDiff =
    mode === "diff" && Boolean(activeDiffChange) && activeDiffChange?.renderAs === "image";
  const shouldRenderDocumentPreview =
    mode === "preview" &&
    currentTextFile !== null &&
    deriveDocumentPreviewKind(currentTextFile.path) !== null;
  const titleText = isCommitPreview
    ? (activeDiffChange.title ?? activeDiffChange.path)
    : currentFile
      ? currentFile.path
      : (activeDiffChange?.title ?? activeFilePath ?? t("file.title"));

  return (
    <div className="workspace-git-view">
      <div className="code-editor workspace-git-editor">
        {showHeader ? (
          <div className="code-editor-header editor-surface__header">
            <span className="code-file-path">
              {currentFile && !isCommitPreview ? (
                <>
                  {titleText}
                  {dirtyIndicator}
                </>
              ) : (
                titleText
              )}
            </span>
            {isCommitPreview ? (
              <div className="editor-surface__toolbar" role="toolbar" aria-label="Editor actions">
                <Tooltip content={t("action.close")}>
                  <IconButton
                    aria-label={t("action.close")}
                    className="code-mode-btn editor-surface__action-btn"
                    icon={<X size={12} />}
                    onClick={handleClose}
                    size="sm"
                  />
                </Tooltip>
              </div>
            ) : (
              <CodeEditorDesktopHeaderActions state={state} />
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
          {canRenderTextDiff ? (
            <MonacoDiffHost
              filePath={activeDiffChange?.path ?? currentFile?.path ?? "diff.patch"}
              originalContent={activeDiffChange?.originalContent ?? ""}
              modifiedContent={activeDiffChange?.modifiedContent ?? activeDiffChange?.diff ?? ""}
            />
          ) : canRenderImageDiff && currentImageFile ? (
            <ImageDiffPreview
              path={currentImageFile.path}
              mime={currentImageFile.mime}
              status={activeDiffChange?.status ?? "modified"}
              beforeUrl={
                activeDiffChange?.originalRevision
                  ? `${currentImageFile.url}&revision=${activeDiffChange.originalRevision}`
                  : undefined
              }
              afterUrl={
                activeDiffChange?.status === "deleted"
                  ? undefined
                  : activeDiffChange?.modifiedRevision === "WORKTREE"
                    ? currentImageFile.url
                    : activeDiffChange?.modifiedRevision
                      ? `${currentImageFile.url}&revision=${activeDiffChange.modifiedRevision}`
                      : currentImageFile.url
              }
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
              workspaceRootPath={workspace.path}
              filePath={currentTextFile.path}
              content={currentTextFile.content}
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
