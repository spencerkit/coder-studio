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
  }

  return (
    <div className="code-mode-toggle">
      {isSvgTextBacked && (
        <Tooltip content={toggleModeTitle}>
          <button
            type="button"
            className="code-mode-btn"
            onClick={toggleSvgTextMode}
            aria-label={toggleModeTitle}
          >
            {isImageFile ? <FileText size={12} /> : <ImageIcon size={12} />}
            <span>{toggleModeLabel}</span>
          </button>
        </Tooltip>
      )}
      <Tooltip content={saveLabel} disabled={!canSave}>
        <button
          type="button"
          className="code-mode-btn"
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
          className="code-mode-btn"
          icon={<X size={12} />}
          onClick={handleClose}
          size="sm"
        />
      </Tooltip>
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
