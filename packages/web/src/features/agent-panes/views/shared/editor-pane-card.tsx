import { useAtomValue } from "jotai";
import { FlipHorizontal, FlipVertical, GripVertical, X } from "lucide-react";
import type { DragEvent, FC } from "react";
import { useEffect, useState } from "react";
import { ConfirmDialog, IconButton, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import {
  getSkillPathDragPayload,
  hasSkillPathDragType,
  isSkillPathDragPayload,
  SKILL_PATH_DRAG_END_EVENT,
  SKILL_PATH_DRAG_START_EVENT,
  type SkillPathDragPayload,
  toSkillDragEditorPath,
} from "../../../../lib/skill-path-drag";
import {
  getWorkspacePathDragPayload,
  hasWorkspacePathDragType,
  isWorkspacePathDragPayload,
  WORKSPACE_PATH_DRAG_END_EVENT,
  WORKSPACE_PATH_DRAG_START_EVENT,
  type WorkspacePathDragPayload,
} from "../../../../lib/workspace-path-drag";
import { useCodeEditorActions } from "../../../code-editor/actions/use-code-editor-actions";
import {
  CodeEditorDesktopHeaderActions,
  CodeEditorHost,
} from "../../../code-editor/views/shared/code-editor-host";
import {
  CodeEditorTabsHeader,
  getFileName,
  getFullWorkspaceFilePath,
} from "../../../code-editor/views/shared/code-editor-tabs-header";
import { mergeOpenEditorPaths } from "../../../workspace/actions/open-editor-state";
import { openFilesAtomFamily } from "../../../workspace/atoms";
import type { PaneDropPlacement } from "../../actions/pane-drag-types";
import type { PaneDragSourceSnapshot } from "../../actions/use-pane-drag-controller";
import { usePaneDragEnabled } from "../../actions/use-pane-drag-enabled";
import {
  editorPaneActiveFilePathAtomFamily,
  editorPaneModeAtomFamily,
  editorPaneOpenEditorPathsAtomFamily,
  editorPanePendingNavigationAtomFamily,
  getEditorPaneStateKey,
} from "../../atoms/editor-panes";

function getEditorPaneTitle(path: string | null, fallbackTitle: string): string {
  if (!path) {
    return fallbackTitle;
  }

  return getFileName(path);
}

function resolveDroppedEditorPath(
  dataTransfer: DataTransfer | null | undefined,
  workspaceId: string
): string | null {
  const workspacePayload = getWorkspacePathDragPayload(dataTransfer);
  if (workspacePayload) {
    if (workspacePayload.workspaceId !== workspaceId || workspacePayload.kind !== "file") {
      return null;
    }

    return workspacePayload.path;
  }

  const skillPayload = getSkillPathDragPayload(dataTransfer);
  return skillPayload?.kind === "file" ? toSkillDragEditorPath(skillPayload) : null;
}

function isHandledNonFileDrop(
  dataTransfer: DataTransfer | null | undefined,
  workspaceId: string,
  workspacePathDragPayload: WorkspacePathDragPayload | null,
  skillPathDragPayload: SkillPathDragPayload | null
): boolean {
  if (hasWorkspacePathDragType(dataTransfer)) {
    const payload = getWorkspacePathDragPayload(dataTransfer) ?? workspacePathDragPayload;
    return payload?.workspaceId === workspaceId && payload.kind === "dir";
  }

  if (hasSkillPathDragType(dataTransfer)) {
    const payload = getSkillPathDragPayload(dataTransfer) ?? skillPathDragPayload;
    return payload?.kind === "dir";
  }

  return false;
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
  const [workspacePathDragPayload, setWorkspacePathDragPayload] =
    useState<WorkspacePathDragPayload | null>(null);
  const [skillPathDragPayload, setSkillPathDragPayload] = useState<SkillPathDragPayload | null>(
    null
  );
  const editorPaneStateKey = getEditorPaneStateKey(workspaceId, paneId);
  const activeFilePathAtom = editorPaneActiveFilePathAtomFamily(editorPaneStateKey);
  const editorModeAtom = editorPaneModeAtomFamily(editorPaneStateKey);
  const openEditorPathsAtom = editorPaneOpenEditorPathsAtomFamily(editorPaneStateKey);
  const pendingNavigationAtom = editorPanePendingNavigationAtomFamily(editorPaneStateKey);
  const activeFilePath = useAtomValue(activeFilePathAtom);
  const paneOpenEditorPaths = useAtomValue(openEditorPathsAtom);
  const openFiles = useAtomValue(openFilesAtomFamily(workspaceId));
  const editorState = useCodeEditorActions({
    activeFilePathAtom,
    editorModeAtom,
    openEditorPathsAtom,
    pendingNavigationAtom,
    persistEditorUiState: false,
  });
  const supportsPaneDrag = usePaneDragEnabled();
  const canDragPane = supportsPaneDrag && Boolean(onPaneDragStart);
  const title = getEditorPaneTitle(activeFilePath, t("agent_panes.file_editor"));
  const activeOpenFile = activeFilePath ? openFiles[activeFilePath] : undefined;
  const isDirtyTextFile = activeOpenFile?.kind === "text" && activeOpenFile.isDirty === true;
  const dragOverlayPlacement = dragState?.isActiveDropTarget ? dragState.hoverPlacement : null;
  const editorStateOpenEditorPaths = Array.isArray(editorState.openEditorPaths)
    ? editorState.openEditorPaths
    : [];
  const headerOpenEditorPaths = mergeOpenEditorPaths(
    paneOpenEditorPaths,
    editorStateOpenEditorPaths,
    activeFilePath ? [activeFilePath] : undefined
  );
  const headerOpenFiles =
    editorState.openFiles && Object.keys(editorState.openFiles).length > 0
      ? editorState.openFiles
      : openFiles;
  const workspaceRootPath = editorState.workspace?.path;
  const activeFullPath =
    activeOpenFile?.displayPath ??
    (activeFilePath ? getFullWorkspaceFilePath(workspaceRootPath, activeFilePath) : title);
  const dirtyStatusLabel = isDirtyTextFile ? t("code_editor.modified_unsaved_changes") : null;
  const shouldRenderFileDropOverlay =
    isFileDropTarget ||
    (workspacePathDragPayload?.workspaceId === workspaceId &&
      workspacePathDragPayload.kind === "file") ||
    skillPathDragPayload?.kind === "file";

  useEffect(() => {
    const handleWorkspacePathDragStart = (event: Event) => {
      const payload = event instanceof CustomEvent ? event.detail : null;
      setWorkspacePathDragPayload(isWorkspacePathDragPayload(payload) ? payload : null);
    };
    const handleWorkspacePathDragEnd = () => {
      setWorkspacePathDragPayload(null);
      setIsFileDropTarget(false);
    };

    window.addEventListener(WORKSPACE_PATH_DRAG_START_EVENT, handleWorkspacePathDragStart);
    window.addEventListener(WORKSPACE_PATH_DRAG_END_EVENT, handleWorkspacePathDragEnd);
    return () => {
      window.removeEventListener(WORKSPACE_PATH_DRAG_START_EVENT, handleWorkspacePathDragStart);
      window.removeEventListener(WORKSPACE_PATH_DRAG_END_EVENT, handleWorkspacePathDragEnd);
    };
  }, []);

  useEffect(() => {
    const handleSkillPathDragStart = (event: Event) => {
      const payload = event instanceof CustomEvent ? event.detail : null;
      setSkillPathDragPayload(isSkillPathDragPayload(payload) ? payload : null);
    };
    const handleSkillPathDragEnd = () => {
      setSkillPathDragPayload(null);
      setIsFileDropTarget(false);
    };

    window.addEventListener(SKILL_PATH_DRAG_START_EVENT, handleSkillPathDragStart);
    window.addEventListener(SKILL_PATH_DRAG_END_EVENT, handleSkillPathDragEnd);
    return () => {
      window.removeEventListener(SKILL_PATH_DRAG_START_EVENT, handleSkillPathDragStart);
      window.removeEventListener(SKILL_PATH_DRAG_END_EVENT, handleSkillPathDragEnd);
    };
  }, []);

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
  const handleWorkspaceFileDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!onOpenFile) {
      return;
    }

    const hasWorkspacePath = hasWorkspacePathDragType(event.dataTransfer);
    const hasSkillPath = hasSkillPathDragType(event.dataTransfer);
    if (!hasWorkspacePath && !hasSkillPath) {
      return;
    }

    if (resolveDroppedEditorPath(event.dataTransfer, workspaceId)) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      setIsFileDropTarget(true);
      return;
    }

    if (
      isHandledNonFileDrop(
        event.dataTransfer,
        workspaceId,
        workspacePathDragPayload,
        skillPathDragPayload
      )
    ) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "none";
      setIsFileDropTarget(false);
    }
  };
  const handleWorkspaceFileDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setIsFileDropTarget(false);
  };
  const handleWorkspaceFileDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!onOpenFile) {
      return;
    }

    const path = resolveDroppedEditorPath(event.dataTransfer, workspaceId);
    if (path) {
      setIsFileDropTarget(false);
      event.preventDefault();
      event.stopPropagation();
      onOpenFile(paneId, path);
      return;
    }

    if (
      isHandledNonFileDrop(
        event.dataTransfer,
        workspaceId,
        workspacePathDragPayload,
        skillPathDragPayload
      )
    ) {
      setIsFileDropTarget(false);
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <div
      className={`session-card agent-pane editor-pane-card${dragState?.isDragging ? " editor-pane-card--dragging" : ""}${dragState?.isActiveDropTarget || isFileDropTarget ? " editor-pane-card--drop-target" : ""}`}
      data-pane-id={paneId}
      data-testid={`editor-pane-${paneId}`}
      onDragEnterCapture={handleWorkspaceFileDragEnter}
      onDragLeaveCapture={handleWorkspaceFileDragLeave}
      onDragOverCapture={handleWorkspaceFileDragEnter}
      onDropCapture={handleWorkspaceFileDrop}
    >
      {shouldRenderFileDropOverlay ? (
        <div
          className={`pane-drop-overlay pane-drop-overlay--draft editor-pane-card__file-drop-overlay${
            isFileDropTarget ? "" : " editor-pane-card__file-drop-overlay--hidden"
          }`}
        >
          {isFileDropTarget ? (
            <div className="pane-drop-overlay__center">{t("agent_panes.open_in_editor")}</div>
          ) : null}
        </div>
      ) : dragOverlayPlacement ? (
        <div className={`pane-drop-overlay pane-drop-overlay--${dragOverlayPlacement}`}>
          {dragOverlayPlacement === "center" ? (
            <div className="pane-drop-overlay__center">{t("agent_panes.swap")}</div>
          ) : null}
        </div>
      ) : null}

      <CodeEditorTabsHeader
        activeFilePath={activeFilePath}
        activeFullPath={activeFullPath}
        className="editor-surface__header--pane"
        dirtyStatusLabel={dirtyStatusLabel}
        emptyLabel={t("agent_panes.file_editor")}
        onActivateOpenFile={editorState.activateOpenFile}
        onCloseOpenFilePath={editorState.closeOpenFilePath}
        openEditorPaths={headerOpenEditorPaths}
        openFiles={headerOpenFiles}
        workspaceRootPath={workspaceRootPath}
        tabbarActions={
          <div className="session-header-actions editor-pane-card__header-actions">
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

                    onPaneDragStart?.({ paneId, title });
                  }}
                  size="sm"
                />
              </Tooltip>
            ) : null}
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
          </div>
        }
        pathActions={<CodeEditorDesktopHeaderActions state={editorState} showCloseAction={false} />}
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
