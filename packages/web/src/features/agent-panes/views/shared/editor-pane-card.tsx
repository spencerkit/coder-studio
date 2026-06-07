import { useAtomValue } from "jotai";
import { FlipHorizontal, FlipVertical, GripVertical, X } from "lucide-react";
import type { DragEvent, FC } from "react";
import { useState } from "react";
import { ConfirmDialog, IconButton, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import {
  getWorkspacePathDragPayload,
  hasWorkspacePathDragType,
} from "../../../../lib/workspace-path-drag";
import { useCodeEditorActions } from "../../../code-editor/actions/use-code-editor-actions";
import {
  CodeEditorDesktopHeaderActions,
  CodeEditorHost,
} from "../../../code-editor/views/shared/code-editor-host";
import { PanelHeader } from "../../../shared/components/panel-header";
import { openFilesAtomFamily } from "../../../workspace/atoms";
import type { PaneDropPlacement } from "../../actions/pane-drag-types";
import type { PaneDragSourceSnapshot } from "../../actions/use-pane-drag-controller";
import { usePaneDragEnabled } from "../../actions/use-pane-drag-enabled";
import {
  editorPaneActiveFilePathAtomFamily,
  editorPaneModeAtomFamily,
  editorPanePendingNavigationAtomFamily,
  getEditorPaneStateKey,
} from "../../atoms/editor-panes";

function getEditorPaneTitle(path: string | null, fallbackTitle: string): string {
  if (!path) {
    return fallbackTitle;
  }

  const segments = path.split("/");
  return segments[segments.length - 1] || path;
}

interface EditorPaneCardProps {
  dragState?: {
    isDragging: boolean;
    isActiveDropTarget: boolean;
    hoverPlacement: PaneDropPlacement | null;
  };
  paneId: string;
  workspaceId: string;
  onClosePane: (paneId: string) => void;
  onOpenFile?: (paneId: string, path: string) => void;
  onPaneDragStart?: (source: PaneDragSourceSnapshot) => void;
  onSplitPane: (paneId: string, direction: "horizontal" | "vertical") => void;
}

export const EditorPaneCard: FC<EditorPaneCardProps> = ({
  dragState,
  paneId,
  workspaceId,
  onClosePane,
  onOpenFile,
  onPaneDragStart,
  onSplitPane,
}) => {
  const t = useTranslation();
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [isFileDropTarget, setIsFileDropTarget] = useState(false);
  const editorPaneStateKey = getEditorPaneStateKey(workspaceId, paneId);
  const activeFilePathAtom = editorPaneActiveFilePathAtomFamily(editorPaneStateKey);
  const editorModeAtom = editorPaneModeAtomFamily(editorPaneStateKey);
  const pendingNavigationAtom = editorPanePendingNavigationAtomFamily(editorPaneStateKey);
  const activeFilePath = useAtomValue(activeFilePathAtom);
  const openFiles = useAtomValue(openFilesAtomFamily(workspaceId));
  const editorState = useCodeEditorActions({
    activeFilePathAtom,
    editorModeAtom,
    pendingNavigationAtom,
  });
  const supportsPaneDrag = usePaneDragEnabled();
  const canDragPane = supportsPaneDrag && Boolean(onPaneDragStart);
  const title = getEditorPaneTitle(activeFilePath, t("agent_panes.file_editor"));
  const activeOpenFile = activeFilePath ? openFiles[activeFilePath] : undefined;
  const isDirtyTextFile = activeOpenFile?.kind === "text" && activeOpenFile.isDirty === true;
  const dragOverlayPlacement = dragState?.isActiveDropTarget ? dragState.hoverPlacement : null;
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
  const handleWorkspaceFileDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!onOpenFile || !hasWorkspacePathDragType(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setIsFileDropTarget(true);
  };
  const handleWorkspaceFileDragLeave = () => {
    setIsFileDropTarget(false);
  };
  const handleWorkspaceFileDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!onOpenFile || !hasWorkspacePathDragType(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setIsFileDropTarget(false);

    const payload = getWorkspacePathDragPayload(event.dataTransfer);
    if (!payload || payload.workspaceId !== workspaceId || payload.kind !== "file") {
      return;
    }

    onOpenFile(paneId, payload.path);
  };

  return (
    <div
      className={`session-card agent-pane editor-pane-card${dragState?.isDragging ? " editor-pane-card--dragging" : ""}${dragState?.isActiveDropTarget || isFileDropTarget ? " editor-pane-card--drop-target" : ""}`}
      data-pane-id={paneId}
      data-testid={`editor-pane-${paneId}`}
      onDragLeaveCapture={handleWorkspaceFileDragLeave}
      onDragOverCapture={handleWorkspaceFileDragOver}
      onDropCapture={handleWorkspaceFileDrop}
    >
      {isFileDropTarget ? (
        <div className="pane-drop-overlay pane-drop-overlay--draft">
          <div className="pane-drop-overlay__center">{t("agent_panes.open_in_editor")}</div>
        </div>
      ) : dragOverlayPlacement ? (
        <div className={`pane-drop-overlay pane-drop-overlay--${dragOverlayPlacement}`}>
          {dragOverlayPlacement === "center" ? (
            <div className="pane-drop-overlay__center">{t("agent_panes.swap")}</div>
          ) : null}
        </div>
      ) : null}

      <PanelHeader
        title={title}
        meta={dirtyIndicator}
        metaPlacement="inline"
        actions={
          <>
            {canDragPane ? (
              <Tooltip content={t("agent_panes.drag_pane")}>
                <IconButton
                  aria-label={t("agent_panes.drag_pane")}
                  className="session-action-btn session-action-btn-drag"
                  data-session-action="drag"
                  icon={<GripVertical size={13} />}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();

                    if (event.pointerType === "touch") {
                      return;
                    }

                    onPaneDragStart?.({ paneId });
                  }}
                  size="sm"
                />
              </Tooltip>
            ) : null}
            <CodeEditorDesktopHeaderActions state={editorState} showCloseAction={false} />
            <Tooltip content={t("agent_panes.split_horizontal")}>
              <IconButton
                aria-label={t("agent_panes.split_horizontal")}
                className="session-action-btn"
                data-session-action="split-horizontal"
                icon={<FlipHorizontal size={13} />}
                onClick={() => onSplitPane(paneId, "horizontal")}
                size="sm"
              />
            </Tooltip>
            <Tooltip content={t("agent_panes.split_vertical")}>
              <IconButton
                aria-label={t("agent_panes.split_vertical")}
                className="session-action-btn"
                data-session-action="split-vertical"
                icon={<FlipVertical size={13} />}
                onClick={() => onSplitPane(paneId, "vertical")}
                size="sm"
              />
            </Tooltip>
            <Tooltip content={t("action.close")}>
              <IconButton
                aria-label={t("action.close")}
                className="session-action-btn session-action-btn-close"
                data-session-action="close"
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
