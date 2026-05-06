import { AlertCircle, FileText, Image as ImageIcon, Save, X } from "lucide-react";
import type { FC } from "react";
import { useTranslation } from "../../../../lib/i18n";
import { useCodeEditorActions } from "../../actions/use-code-editor-actions";
import { ImagePreview } from "../../components/image-preview";
import { MonacoHost } from "../../components/monaco-host";

export type CodeEditorChrome = "full" | "content-only";
export type CodeEditorHeaderActionVariant = "full" | "mobile";
export type CodeEditorState = ReturnType<typeof useCodeEditorActions>;

interface CodeEditorHostProps {
  chrome?: CodeEditorChrome;
  editorState?: CodeEditorState;
}

interface CodeEditorViewProps {
  state: CodeEditorState;
  chrome?: CodeEditorChrome;
}

interface CodeEditorHeaderActionsProps {
  state: CodeEditorState;
  variant?: CodeEditorHeaderActionVariant;
}

export const CodeEditorHeaderActions: FC<CodeEditorHeaderActionsProps> = ({
  state,
  variant = "full",
}) => {
  const t = useTranslation();
  const {
    canSave,
    handleClose,
    handleSave,
    isImageFile,
    isSaving,
    isSvgTextBacked,
    toggleSvgTextMode,
  } = state;
  const saveLabel = isSaving ? t("code_editor.saving") : t("action.save_file");
  const toggleModeTitle = isImageFile
    ? t("code_editor.edit_as_text")
    : t("code_editor.preview_as_image");
  const toggleModeLabel = isImageFile ? t("code_editor.mode_text") : t("code_editor.mode_image");

  if (variant === "mobile") {
    return (
      <div className="mobile-sheet__header-actions">
        {isSvgTextBacked ? (
          <button
            type="button"
            className="mobile-sheet__action mobile-sheet__action--icon"
            onClick={toggleSvgTextMode}
            title={toggleModeTitle}
            aria-label={toggleModeTitle}
          >
            {isImageFile ? <FileText size={16} /> : <ImageIcon size={16} />}
          </button>
        ) : null}
        <button
          type="button"
          className="mobile-sheet__action"
          onClick={handleSave}
          disabled={!canSave}
          aria-label={saveLabel}
        >
          {saveLabel}
        </button>
      </div>
    );
  }

  return (
    <div className="code-mode-toggle">
      {isSvgTextBacked && (
        <button
          type="button"
          className="code-mode-btn"
          onClick={toggleSvgTextMode}
          title={toggleModeTitle}
          aria-label={toggleModeTitle}
        >
          {isImageFile ? <FileText size={12} /> : <ImageIcon size={12} />}
          <span>{toggleModeLabel}</span>
        </button>
      )}
      <button
        type="button"
        className="code-mode-btn"
        onClick={handleSave}
        disabled={!canSave}
        title={saveLabel}
        aria-label={saveLabel}
      >
        <Save size={12} />
        <span>{saveLabel}</span>
      </button>
      <button
        type="button"
        className="code-mode-btn"
        onClick={handleClose}
        title={t("action.close")}
        aria-label={t("action.close")}
      >
        <X size={12} />
      </button>
    </div>
  );
};

export const CodeEditorView: FC<CodeEditorViewProps> = ({ state, chrome = "full" }) => {
  const t = useTranslation();
  const {
    activeFilePath,
    activeExternalStatus,
    activeLoadError,
    currentFile,
    handleContentChange,
    handleSave,
    isImageFile,
    isTextFile,
    saveError,
    workspace,
  } = state;

  if (!workspace) {
    return (
      <div className="workspace-git-view">
        <div className="code-editor workspace-git-editor">
          <div className="code-editor-body">
            <div className="git-diff-empty">
              <p className="git-diff-empty-title">{t("workspace.no_workspace")}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const dirtyIndicator =
    isTextFile && currentFile.isDirty ? <span className="dirty-indicator">*</span> : null;
  const showHeader = chrome === "full";

  return (
    <div className="workspace-git-view">
      <div className="code-editor workspace-git-editor">
        {showHeader ? (
          <div className="code-editor-header">
            <span className="code-file-path">
              {currentFile ? (
                <>
                  {currentFile.path}
                  {dirtyIndicator}
                </>
              ) : activeFilePath ? (
                activeFilePath
              ) : (
                t("file.title")
              )}
            </span>
            <CodeEditorHeaderActions state={state} />
          </div>
        ) : null}

        {saveError && (
          <div className="code-editor-error" role="alert">
            <AlertCircle size={14} />
            <span>{saveError}</span>
          </div>
        )}

        {activeExternalStatus && (
          <div className="code-editor-error" role="alert">
            <AlertCircle size={14} />
            <span>
              {activeExternalStatus === "deleted"
                ? t("code_editor.deleted_on_disk")
                : t("code_editor.modified_on_disk")}
            </span>
          </div>
        )}

        <div className="code-editor-body">
          {isTextFile ? (
            <MonacoHost
              workspaceId={workspace.id}
              filePath={currentFile.path}
              content={currentFile.content}
              onContentChange={handleContentChange}
              onSave={handleSave}
            />
          ) : isImageFile ? (
            <ImagePreview
              url={currentFile.url}
              mime={currentFile.mime}
              sizeBytes={currentFile.size}
              alt={currentFile.path}
            />
          ) : activeLoadError ? (
            <div className="git-diff-empty" role="alert">
              <p className="git-diff-empty-title">{t("code_editor.open_failed_title")}</p>
              <p className="git-diff-empty-body">{activeLoadError}</p>
            </div>
          ) : activeFilePath ? (
            <div className="git-diff-empty">
              <p className="git-diff-empty-title">{t("status.connecting")}…</p>
            </div>
          ) : (
            <div className="git-diff-empty">
              <p className="git-diff-empty-title">{t("file.title")}</p>
              <p className="git-diff-empty-body">{t("code_editor.empty_hint")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const CodeEditorHost: FC<CodeEditorHostProps> = ({ chrome = "full", editorState }) => {
  const state = editorState ?? useCodeEditorActions();

  return <CodeEditorView state={state} chrome={chrome} />;
};

export default CodeEditorHost;
