import { useAtomValue } from "jotai";
import { FlipHorizontal, FlipVertical, X } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
import { ConfirmDialog, IconButton, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { useCodeEditorActions } from "../../../code-editor/actions/use-code-editor-actions";
import {
  CodeEditorDesktopHeaderActions,
  CodeEditorHost,
} from "../../../code-editor/views/shared/code-editor-host";
import { PanelHeader } from "../../../shared/components/panel-header";
import { activeFilePathAtomFamily, openFilesAtomFamily } from "../../../workspace/atoms";

function getEditorPaneTitle(path: string | null): string {
  if (!path) {
    return "Editor";
  }

  const segments = path.split("/");
  return segments[segments.length - 1] || path;
}

interface EditorPaneCardProps {
  paneId: string;
  workspaceId: string;
  onClosePane: (paneId: string) => void;
  onSplitPane: (paneId: string, direction: "horizontal" | "vertical") => void;
}

export const EditorPaneCard: FC<EditorPaneCardProps> = ({
  paneId,
  workspaceId,
  onClosePane,
  onSplitPane,
}) => {
  const t = useTranslation();
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const activeFilePath = useAtomValue(activeFilePathAtomFamily(workspaceId));
  const openFiles = useAtomValue(openFilesAtomFamily(workspaceId));
  const editorState = useCodeEditorActions();
  const title = getEditorPaneTitle(activeFilePath);
  const activeOpenFile = activeFilePath ? openFiles[activeFilePath] : undefined;
  const isDirtyTextFile = activeOpenFile?.kind === "text" && activeOpenFile.isDirty === true;
  const dirtyIndicator = isDirtyTextFile ? (
    <span
      className="dirty-indicator editor-pane-card__dirty-indicator"
      aria-label={t("code_editor.unsaved_changes")}
      title={t("code_editor.unsaved_changes")}
    />
  ) : null;
  const requestClosePane = () => {
    if (isDirtyTextFile) {
      setCloseConfirmOpen(true);
      return;
    }

    onClosePane(paneId);
  };
  const confirmClosePane = () => {
    setCloseConfirmOpen(false);
    onClosePane(paneId);
  };

  return (
    <div
      className="session-card agent-pane editor-pane-card"
      data-pane-id={paneId}
      data-testid={`editor-pane-${paneId}`}
    >
      <PanelHeader
        title={title}
        meta={dirtyIndicator}
        metaPlacement="inline"
        actions={
          <>
            <CodeEditorDesktopHeaderActions state={editorState} showCloseAction={false} />
            <Tooltip content="Split horizontal">
              <IconButton
                aria-label="Split horizontal"
                className="session-action-btn"
                icon={<FlipHorizontal size={13} />}
                onClick={() => onSplitPane(paneId, "horizontal")}
                size="sm"
              />
            </Tooltip>
            <Tooltip content="Split vertical">
              <IconButton
                aria-label="Split vertical"
                className="session-action-btn"
                icon={<FlipVertical size={13} />}
                onClick={() => onSplitPane(paneId, "vertical")}
                size="sm"
              />
            </Tooltip>
            <Tooltip content={t("action.close")}>
              <IconButton
                aria-label={t("action.close")}
                className="session-action-btn session-action-btn-close"
                icon={<X size={14} />}
                onClick={requestClosePane}
                size="sm"
              />
            </Tooltip>
          </>
        }
      />

      <div className="editor-pane-card__body">
        <div className="editor-pane-card__content">
          <CodeEditorHost chrome="content-only" editorState={editorState} />
        </div>
      </div>
      <ConfirmDialog
        open={closeConfirmOpen}
        onOpenChange={setCloseConfirmOpen}
        title={t("code_editor.close_unsaved_title")}
        description={t("code_editor.close_unsaved_description", { name: title })}
        cancelText={t("common.cancel")}
        confirmText={t("code_editor.discard_and_close")}
        tone="danger"
        onConfirm={confirmClosePane}
      />
    </div>
  );
};

export default EditorPaneCard;
