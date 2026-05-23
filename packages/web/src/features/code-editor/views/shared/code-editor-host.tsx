import { FileText, Image as ImageIcon, Save, X } from "lucide-react";
import type { FC } from "react";
import { IconButton, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { useCodeEditorActions } from "../../actions/use-code-editor-actions";
import { EditorSurface } from "./editor-surface";

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

interface CodeEditorDesktopHeaderActionsProps {
  state: CodeEditorState;
}

export const CodeEditorDesktopHeaderActions: FC<CodeEditorDesktopHeaderActionsProps> = ({
  state,
}) => {
  const t = useTranslation();
  const {
    canDiff,
    canEdit,
    canPreview,
    canSave,
    handleClose,
    handleSave,
    isImageFile,
    isSvgTextBacked,
    isSaving,
    mode,
    openInDiffMode,
    setMode,
    toggleSvgTextMode,
  } = state;
  const saveLabel = isSaving ? t("code_editor.saving") : t("action.save_file");
  const handlePreviewMode = () => {
    if (isSvgTextBacked && !isImageFile) {
      toggleSvgTextMode();
      return;
    }
    setMode("preview");
  };
  const handleEditMode = () => {
    if (isSvgTextBacked && isImageFile) {
      toggleSvgTextMode();
      return;
    }
    setMode("edit");
  };

  return (
    <div className="editor-surface__toolbar" role="toolbar" aria-label="Editor actions">
      {canDiff ? (
        <button
          type="button"
          className={`code-mode-btn editor-surface__mode-btn${mode === "diff" ? " active" : ""}`}
          onClick={() => void openInDiffMode()}
          aria-pressed={mode === "diff"}
          aria-label={t("code_editor.mode_diff")}
        >
          <span>{t("code_editor.mode_diff")}</span>
        </button>
      ) : null}
      {canPreview ? (
        <button
          type="button"
          className={`code-mode-btn editor-surface__mode-btn${mode === "preview" ? " active" : ""}`}
          onClick={handlePreviewMode}
          aria-pressed={mode === "preview"}
          aria-label={t("code_editor.mode_preview")}
        >
          {isImageFile ? <ImageIcon size={12} /> : <FileText size={12} />}
          <span>{t("code_editor.mode_preview")}</span>
        </button>
      ) : null}
      {canEdit ? (
        <button
          type="button"
          className={`code-mode-btn editor-surface__mode-btn${mode === "edit" ? " active" : ""}`}
          onClick={handleEditMode}
          aria-pressed={mode === "edit"}
          aria-label={t("code_editor.mode_edit")}
        >
          <FileText size={12} />
          <span>{t("code_editor.mode_edit")}</span>
        </button>
      ) : null}
      <Tooltip content={saveLabel} disabled={!canSave}>
        <button
          type="button"
          className="code-mode-btn editor-surface__action-btn"
          onClick={handleSave}
          disabled={!canSave}
          aria-label={saveLabel}
        >
          <Save size={12} />
          <span>{saveLabel}</span>
        </button>
      </Tooltip>
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
  );
};

export const CodeEditorHeaderActions: FC<CodeEditorHeaderActionsProps> = ({
  state,
  variant = "full",
}) => {
  const t = useTranslation();
  const {
    canDiff,
    canEdit,
    canPreview,
    canSave,
    handleSave,
    isImageFile,
    isSaving,
    isSvgTextBacked,
    mode,
    openInDiffMode,
    setMode,
    toggleSvgTextMode,
  } = state;
  const saveLabel = isSaving ? t("code_editor.saving") : t("action.save_file");
  const toggleModeTitle = isImageFile
    ? t("code_editor.edit_as_text")
    : t("code_editor.preview_as_image");

  if (variant !== "mobile") {
    return <CodeEditorDesktopHeaderActions state={state} />;
  }

  const handlePreviewMode = () => {
    if (isSvgTextBacked && !isImageFile) {
      toggleSvgTextMode();
      return;
    }
    setMode("preview");
  };

  const handleEditMode = () => {
    if (isSvgTextBacked && isImageFile) {
      toggleSvgTextMode();
      return;
    }
    setMode("edit");
  };

  return (
    <div className="mobile-sheet__header-actions">
      {canDiff ? (
        <button
          type="button"
          className={`mobile-sheet__action mobile-sheet__action--mode${mode === "diff" ? " active" : ""}`}
          onClick={() => void openInDiffMode()}
          aria-pressed={mode === "diff"}
          aria-label={t("code_editor.mode_diff")}
        >
          {t("code_editor.mode_diff")}
        </button>
      ) : null}
      {canPreview ? (
        <button
          type="button"
          className={`mobile-sheet__action mobile-sheet__action--mode${mode === "preview" ? " active" : ""}`}
          onClick={handlePreviewMode}
          aria-pressed={mode === "preview"}
          aria-label={t("code_editor.mode_preview")}
        >
          {t("code_editor.mode_preview")}
        </button>
      ) : null}
      {canEdit ? (
        <button
          type="button"
          className={`mobile-sheet__action mobile-sheet__action--mode${mode === "edit" ? " active" : ""}`}
          onClick={handleEditMode}
          aria-pressed={mode === "edit"}
          aria-label={t("code_editor.mode_edit")}
        >
          {t("code_editor.mode_edit")}
        </button>
      ) : null}
      {isSvgTextBacked ? (
        <Tooltip content={toggleModeTitle}>
          <IconButton
            aria-label={toggleModeTitle}
            className="mobile-sheet__action mobile-sheet__action--icon"
            icon={isImageFile ? <FileText size={16} /> : <ImageIcon size={16} />}
            onClick={toggleSvgTextMode}
          />
        </Tooltip>
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
};

export const CodeEditorView: FC<CodeEditorViewProps> = ({ state, chrome = "full" }) => {
  return <EditorSurface state={state} chrome={chrome} />;
};

export const CodeEditorHost: FC<CodeEditorHostProps> = ({ chrome = "full", editorState }) => {
  const state = editorState ?? useCodeEditorActions();

  return <CodeEditorView state={state} chrome={chrome} />;
};

export default CodeEditorHost;
