import { useAtomValue, useSetAtom } from "jotai";
import { FileCode2 } from "lucide-react";
import {
  type CSSProperties,
  type FC,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { activeWorkspaceAtom } from "../../../../atoms/workspaces";
import { EmptyState, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { AgentPanes } from "../../../agent-panes";
import { CodeEditorHost } from "../../../code-editor/views/shared/code-editor-host";
import { TopBar } from "../../../topbar";
import { useUiActionSubscription } from "../../../ui-actions/use-ui-action-subscription";
import { useWorkspaceFullscreen } from "../../actions/use-workspace-fullscreen";
import { useWorkspaceNavigationShortcuts } from "../../actions/use-workspace-navigation-shortcuts";
import { useWorkspaceScreenModel } from "../../actions/use-workspace-screen-model";
import { useWorkspaceUiStatePersistence } from "../../actions/use-workspace-ui-state-persistence";
import {
  activeFilePathAtomFamily,
  deriveEditorModeForOpenFile,
  deriveEditorModeForPath,
  editorModeAtomFamily,
  editorViewVisibleAtomFamily,
  openEditorPathsAtomFamily,
  openFilesAtomFamily,
  sidebarCollapsedAtom,
} from "../../atoms";
import { sanitizeDesktopSidebarView } from "../../atoms/layout";
import { AgentInstructionsSection } from "../shared/agent-instructions-section";
import { AgentTokenTrendSection } from "../shared/agent-token-trend-section";
import { ExplorerPanel } from "../shared/explorer-panel";
import { GitPanel } from "../shared/git-panel";
import { MemoryPanel } from "../shared/memory-panel";
import { SearchPanel } from "../shared/search-panel";
import { SkillsPanel } from "../shared/skills-panel";
import { WorkspaceActivityBar } from "../shared/workspace-activity-bar";
import { WorkspaceBottomPanel } from "../shared/workspace-bottom-panel";
import { WorkspaceStatusBar } from "../shared/workspace-status-bar";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable || target.closest('[contenteditable="true"]')) {
    return true;
  }

  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

interface EditorRestorePosition {
  x: number;
  y: number;
}

interface FloatingEditorGeometry {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface FloatingEditorBounds {
  height: number;
  left: number;
  top: number;
  width: number;
}

type FloatingEditorResizeCorner = "bottom-left" | "bottom-right" | "top-left" | "top-right";

interface FloatingEditorInteraction {
  bounds: FloatingEditorBounds;
  kind: "move" | "resize";
  pointerId: number;
  resizeCorner?: FloatingEditorResizeCorner;
  startClientX: number;
  startClientY: number;
  startGeometry: FloatingEditorGeometry;
}

const EDITOR_RESTORE_HANDLE_SIZE = 40;
const EDITOR_RESTORE_HANDLE_MARGIN = 16;
const EDITOR_RESTORE_DRAG_THRESHOLD = 3;
const EDITOR_RESTORE_OPEN_ANIMATION_MS = 220;
const FLOATING_EDITOR_DEFAULT_HEIGHT = 560;
const FLOATING_EDITOR_MARGIN = 16;
const FLOATING_EDITOR_MAX_WIDTH = 760;
const FLOATING_EDITOR_MIN_HEIGHT = 280;
const FLOATING_EDITOR_MIN_WIDTH = 420;

function clampPosition(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveFloatingDimension(min: number, max: number, preferred: number): number {
  const safeMax = Math.max(1, max);
  const safeMin = Math.min(min, safeMax);
  return Math.round(clampPosition(preferred, safeMin, safeMax));
}

function clampFloatingEditorGeometry(
  geometry: FloatingEditorGeometry,
  bounds: FloatingEditorBounds
): FloatingEditorGeometry {
  const maxWidth = Math.max(1, bounds.width - FLOATING_EDITOR_MARGIN * 2);
  const maxHeight = Math.max(1, bounds.height - FLOATING_EDITOR_MARGIN * 2);
  const width = resolveFloatingDimension(FLOATING_EDITOR_MIN_WIDTH, maxWidth, geometry.width);
  const height = resolveFloatingDimension(FLOATING_EDITOR_MIN_HEIGHT, maxHeight, geometry.height);
  const minX = bounds.left + FLOATING_EDITOR_MARGIN;
  const minY = bounds.top + FLOATING_EDITOR_MARGIN;
  const maxX = Math.max(minX, bounds.left + bounds.width - width - FLOATING_EDITOR_MARGIN);
  const maxY = Math.max(minY, bounds.top + bounds.height - height - FLOATING_EDITOR_MARGIN);

  return {
    height,
    width,
    x: Math.round(clampPosition(geometry.x, minX, maxX)),
    y: Math.round(clampPosition(geometry.y, minY, maxY)),
  };
}

const FLOATING_EDITOR_RESIZE_HANDLES: Array<{
  corner: FloatingEditorResizeCorner;
  labelKey: string;
}> = [
  {
    corner: "top-left",
    labelKey: "code_editor.resize_floating_editor_top_left",
  },
  {
    corner: "top-right",
    labelKey: "code_editor.resize_floating_editor_top_right",
  },
  {
    corner: "bottom-left",
    labelKey: "code_editor.resize_floating_editor_bottom_left",
  },
  {
    corner: "bottom-right",
    labelKey: "code_editor.resize_floating_editor_bottom_right",
  },
];

interface WorkspaceEditorRestoreButtonProps {
  lastActivePath: string | null;
  onPositionChange: (position: EditorRestorePosition) => void;
  onRestoreStart: () => void;
  position: EditorRestorePosition | null;
  restoring?: boolean;
  workspaceId: string;
}

const WorkspaceEditorRestoreButton: FC<WorkspaceEditorRestoreButtonProps> = ({
  lastActivePath,
  onPositionChange,
  onRestoreStart,
  position,
  restoring = false,
  workspaceId,
}) => {
  const t = useTranslation();
  const openFiles = useAtomValue(openFilesAtomFamily(workspaceId));
  const openEditorPaths = useAtomValue(openEditorPathsAtomFamily(workspaceId));
  const setActiveFilePath = useSetAtom(activeFilePathAtomFamily(workspaceId));
  const setEditorMode = useSetAtom(editorModeAtomFamily(workspaceId));
  const setEditorViewVisible = useSetAtom(editorViewVisibleAtomFamily(workspaceId));
  const { persistUiState } = useWorkspaceUiStatePersistence(workspaceId);
  const [isDragging, setIsDragging] = useState(false);
  const dragStateRef = useRef<{
    maxX: number;
    maxY: number;
    minX: number;
    minY: number;
    originX: number;
    originY: number;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const didDragRef = useRef(false);
  const openPaths = openEditorPaths;
  const restorePath =
    lastActivePath && openPaths.includes(lastActivePath) ? lastActivePath : (openPaths[0] ?? null);
  const restoreLabel = t("code_editor.open_editor_view");
  const restoreFile = openFiles[restorePath];
  const restoreEditorView = () => {
    setEditorViewVisible(true);

    if (!restorePath) {
      setEditorMode("edit");
      void persistUiState({ activeEditorPath: null, editorViewVisible: true });
      return;
    }

    const nextMode = restoreFile
      ? deriveEditorModeForOpenFile(restoreFile)
      : deriveEditorModeForPath(restorePath);
    setEditorMode(nextMode);
    setActiveFilePath(restorePath);
    void persistUiState({ activeEditorPath: restorePath, editorViewVisible: true });
  };
  const getBoundsRect = (button: HTMLButtonElement) => {
    const page = button.closest(".workspace-page--desktop") as HTMLElement | null;
    return page?.getBoundingClientRect() ?? button.getBoundingClientRect();
  };
  const getPositionRect = (button: HTMLButtonElement) => {
    const stage = button.closest(".workspace-main-stage") as HTMLElement | null;
    return stage?.getBoundingClientRect() ?? button.getBoundingClientRect();
  };
  const getPositionStyle = (): CSSProperties | undefined =>
    position
      ? {
          left: `${position.x}px`,
          top: `${position.y}px`,
        }
      : undefined;
  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }

    const button = event.currentTarget;
    const boundsRect = getBoundsRect(button);
    const positionRect = getPositionRect(button);
    const buttonRect = button.getBoundingClientRect();
    const originX = position?.x ?? buttonRect.left - positionRect.left;
    const originY = position?.y ?? buttonRect.top - positionRect.top;
    const minX = Math.round(EDITOR_RESTORE_HANDLE_MARGIN + boundsRect.left - positionRect.left);
    const minY = Math.round(EDITOR_RESTORE_HANDLE_MARGIN + boundsRect.top - positionRect.top);
    const maxX = Math.round(
      boundsRect.left +
        (boundsRect.width || window.innerWidth) -
        EDITOR_RESTORE_HANDLE_SIZE -
        EDITOR_RESTORE_HANDLE_MARGIN -
        positionRect.left
    );
    const maxY = Math.round(
      boundsRect.top +
        (boundsRect.height || window.innerHeight) -
        EDITOR_RESTORE_HANDLE_SIZE -
        EDITOR_RESTORE_HANDLE_MARGIN -
        positionRect.top
    );
    dragStateRef.current = {
      maxX,
      maxY,
      minX,
      minY,
      originX,
      originY,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    didDragRef.current = false;
    button.setPointerCapture?.(event.pointerId);
  };
  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    if (
      Math.abs(deltaX) > EDITOR_RESTORE_DRAG_THRESHOLD ||
      Math.abs(deltaY) > EDITOR_RESTORE_DRAG_THRESHOLD
    ) {
      didDragRef.current = true;
      setIsDragging(true);
    }

    onPositionChange({
      x: Math.round(clampPosition(dragState.originX + deltaX, dragState.minX, dragState.maxX)),
      y: Math.round(clampPosition(dragState.originY + deltaY, dragState.minY, dragState.maxY)),
    });
  };
  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
    }
    setIsDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };
  const handleClick = () => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }

    onRestoreStart();
    restoreEditorView();
  };

  return (
    <Tooltip content={restoreLabel}>
      <button
        type="button"
        aria-label={restoreLabel}
        className={`workspace-editor-restore${position ? " workspace-editor-restore--placed" : ""}${
          isDragging ? " workspace-editor-restore--dragging" : ""
        }${restoring ? " workspace-editor-restore--restoring" : ""}`}
        onClick={handleClick}
        onPointerCancel={handlePointerUp}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={getPositionStyle()}
      >
        <FileCode2 size={18} aria-hidden="true" />
        <span className="workspace-editor-restore__count">{openPaths.length}</span>
      </button>
    </Tooltip>
  );
};

const WorkspaceDesktopScene: FC = () => {
  const t = useTranslation();
  const fullscreenRootRef = useRef<HTMLDivElement>(null);
  const mainStageRef = useRef<HTMLDivElement>(null);
  const fullscreenController = useWorkspaceFullscreen(fullscreenRootRef);
  const {
    activeFilePath,
    createRequest,
    desktopSidebarView,
    focusMode,
    gitState,
    handleBottomPointerDown,
    handleConsumeCreateRequest,
    handleLeftPointerDown,
    handleOpenBranchSwitcher,
    handleOpenFileCreate,
    handleOpenFolderCreate,
    leftPanelWidth,
    leftPanelRef,
    mainAreaMode,
    setDesktopSidebarView,
    sidebarCollapsed,
    terminalPanelVisible,
    workspace,
    bottomPanelHeight,
    bottomPanelRef,
    panelRefreshToken,
  } = useWorkspaceScreenModel();
  const setSidebarCollapsed = useSetAtom(sidebarCollapsedAtom);
  const activeSidebarView = sanitizeDesktopSidebarView(desktopSidebarView);
  const workspaceId = workspace?.id ?? "__workspace_placeholder__";
  const [editorRestorePosition, setEditorRestorePosition] = useState<EditorRestorePosition | null>(
    null
  );
  const [editorRestoreOpening, setEditorRestoreOpening] = useState(false);
  const [editorPinned, setEditorPinned] = useState(workspace?.uiState.editorPinned ?? true);
  const [floatingEditorGeometry, setFloatingEditorGeometry] =
    useState<FloatingEditorGeometry | null>(null);
  const [floatingEditorInteractionKind, setFloatingEditorInteractionKind] = useState<
    FloatingEditorInteraction["kind"] | null
  >(null);
  const lastActiveEditorPathRef = useRef<string | null>(null);
  const editorRestoreOpeningTimerRef = useRef<number | null>(null);
  const floatingEditorRef = useRef<HTMLDivElement>(null);
  const floatingEditorInteractionRef = useRef<FloatingEditorInteraction | null>(null);
  const floatingEditorInteractionCleanupRef = useRef<(() => void) | null>(null);
  const { persistUiState } = useWorkspaceUiStatePersistence(workspaceId);
  const editorRestoreStyle = useMemo<CSSProperties | undefined>(() => {
    if (!editorRestorePosition) {
      return undefined;
    }

    return {
      "--workspace-editor-restore-origin-x": `${
        editorRestorePosition.x + EDITOR_RESTORE_HANDLE_SIZE / 2
      }px`,
      "--workspace-editor-restore-origin-y": `${
        editorRestorePosition.y + EDITOR_RESTORE_HANDLE_SIZE / 2
      }px`,
    } as CSSProperties;
  }, [editorRestorePosition]);

  useWorkspaceNavigationShortcuts(workspaceId);
  useUiActionSubscription(workspaceId);

  useEffect(() => {
    if (activeFilePath) {
      lastActiveEditorPathRef.current = activeFilePath;
    }
  }, [activeFilePath]);

  useEffect(() => {
    setEditorPinned(workspace?.uiState.editorPinned ?? true);
  }, [workspace?.id, workspace?.uiState.editorPinned]);

  const handleEditorRestoreStart = () => {
    if (editorRestoreOpeningTimerRef.current !== null) {
      window.clearTimeout(editorRestoreOpeningTimerRef.current);
    }

    setEditorRestoreOpening(true);
    editorRestoreOpeningTimerRef.current = window.setTimeout(() => {
      setEditorRestoreOpening(false);
      editorRestoreOpeningTimerRef.current = null;
    }, EDITOR_RESTORE_OPEN_ANIMATION_MS);
  };

  const getFloatingEditorBounds = (): FloatingEditorBounds => {
    const pageRect = fullscreenRootRef.current?.getBoundingClientRect();
    return {
      height: pageRect?.height || window.innerHeight,
      left: pageRect?.left ?? 0,
      top: pageRect?.top ?? 0,
      width: pageRect?.width || window.innerWidth,
    };
  };

  const getFloatingEditorGeometry = () => {
    const bounds = getFloatingEditorBounds();
    const editorRect = floatingEditorRef.current?.getBoundingClientRect();
    const fallbackWidth = resolveFloatingDimension(
      FLOATING_EDITOR_MIN_WIDTH,
      bounds.width - FLOATING_EDITOR_MARGIN * 2,
      FLOATING_EDITOR_MAX_WIDTH
    );
    const fallbackHeight = resolveFloatingDimension(
      FLOATING_EDITOR_MIN_HEIGHT,
      bounds.height - FLOATING_EDITOR_MARGIN * 2,
      FLOATING_EDITOR_DEFAULT_HEIGHT
    );

    return {
      bounds,
      geometry: clampFloatingEditorGeometry(
        floatingEditorGeometry ??
          (editorRect
            ? {
                height: editorRect.height,
                width: editorRect.width,
                x: editorRect.left,
                y: editorRect.top,
              }
            : {
                height: fallbackHeight,
                width: fallbackWidth,
                x: bounds.left + bounds.width - fallbackWidth - FLOATING_EDITOR_MARGIN,
                y: bounds.top + FLOATING_EDITOR_MARGIN,
              }),
        bounds
      ),
    };
  };

  const finishFloatingEditorInteraction = (pointerId?: number) => {
    const current = floatingEditorInteractionRef.current;
    if (!current || (pointerId !== undefined && current.pointerId !== pointerId)) {
      return;
    }

    const cleanup = floatingEditorInteractionCleanupRef.current;
    floatingEditorInteractionCleanupRef.current = null;
    cleanup?.();
    floatingEditorInteractionRef.current = null;
    setFloatingEditorInteractionKind(null);
    document.body.classList.remove(
      "is-moving-floating-editor",
      "is-resizing-floating-editor",
      "is-resizing-floating-editor--nesw",
      "is-resizing-floating-editor--nwse"
    );
  };

  useEffect(
    () => () => {
      if (editorRestoreOpeningTimerRef.current !== null) {
        window.clearTimeout(editorRestoreOpeningTimerRef.current);
      }
      finishFloatingEditorInteraction();
    },
    []
  );

  const resolveFloatingEditorResizeGeometry = (
    interaction: FloatingEditorInteraction,
    deltaX: number,
    deltaY: number
  ): FloatingEditorGeometry => {
    const corner = interaction.resizeCorner ?? "bottom-right";
    const maxRight = interaction.bounds.left + interaction.bounds.width - FLOATING_EDITOR_MARGIN;
    const maxBottom = interaction.bounds.top + interaction.bounds.height - FLOATING_EDITOR_MARGIN;
    const minLeft = interaction.bounds.left + FLOATING_EDITOR_MARGIN;
    const minTop = interaction.bounds.top + FLOATING_EDITOR_MARGIN;
    const safeMinWidth = Math.min(
      FLOATING_EDITOR_MIN_WIDTH,
      Math.max(1, interaction.bounds.width - FLOATING_EDITOR_MARGIN * 2)
    );
    const safeMinHeight = Math.min(
      FLOATING_EDITOR_MIN_HEIGHT,
      Math.max(1, interaction.bounds.height - FLOATING_EDITOR_MARGIN * 2)
    );
    let left = interaction.startGeometry.x;
    let top = interaction.startGeometry.y;
    let right = interaction.startGeometry.x + interaction.startGeometry.width;
    let bottom = interaction.startGeometry.y + interaction.startGeometry.height;

    if (corner === "top-left" || corner === "bottom-left") {
      left = clampPosition(interaction.startGeometry.x + deltaX, minLeft, right - safeMinWidth);
    } else {
      right = clampPosition(
        interaction.startGeometry.x + interaction.startGeometry.width + deltaX,
        left + safeMinWidth,
        maxRight
      );
    }

    if (corner === "top-left" || corner === "top-right") {
      top = clampPosition(interaction.startGeometry.y + deltaY, minTop, bottom - safeMinHeight);
    } else {
      bottom = clampPosition(
        interaction.startGeometry.y + interaction.startGeometry.height + deltaY,
        top + safeMinHeight,
        maxBottom
      );
    }

    return {
      height: bottom - top,
      width: right - left,
      x: left,
      y: top,
    };
  };

  const beginFloatingEditorInteraction = (
    kind: FloatingEditorInteraction["kind"],
    event: PointerEvent<HTMLButtonElement>,
    resizeCorner?: FloatingEditorResizeCorner
  ) => {
    if (editorPinned || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const { bounds, geometry } = getFloatingEditorGeometry();
    finishFloatingEditorInteraction();

    floatingEditorInteractionRef.current = {
      bounds,
      kind,
      pointerId: event.pointerId,
      resizeCorner,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startGeometry: geometry,
    };
    setFloatingEditorGeometry(geometry);
    setFloatingEditorInteractionKind(kind);
    document.body.classList.toggle("is-moving-floating-editor", kind === "move");
    document.body.classList.toggle("is-resizing-floating-editor", kind === "resize");
    document.body.classList.toggle(
      "is-resizing-floating-editor--nesw",
      kind === "resize" && (resizeCorner === "top-right" || resizeCorner === "bottom-left")
    );
    document.body.classList.toggle(
      "is-resizing-floating-editor--nwse",
      kind === "resize" && (resizeCorner === "top-left" || resizeCorner === "bottom-right")
    );
    const pointerId = event.pointerId;
    const pointerTarget = event.currentTarget;

    const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
      const interaction = floatingEditorInteractionRef.current;
      if (!interaction || moveEvent.pointerId !== interaction.pointerId) {
        return;
      }

      const deltaX = moveEvent.clientX - interaction.startClientX;
      const deltaY = moveEvent.clientY - interaction.startClientY;
      const nextGeometry =
        interaction.kind === "move"
          ? {
              ...interaction.startGeometry,
              x: interaction.startGeometry.x + deltaX,
              y: interaction.startGeometry.y + deltaY,
            }
          : resolveFloatingEditorResizeGeometry(interaction, deltaX, deltaY);

      setFloatingEditorGeometry(clampFloatingEditorGeometry(nextGeometry, interaction.bounds));
    };

    const onPointerFinish = (finishEvent?: globalThis.PointerEvent) => {
      if (
        finishEvent &&
        finishEvent.pointerId !== floatingEditorInteractionRef.current?.pointerId
      ) {
        return;
      }

      finishFloatingEditorInteraction(finishEvent?.pointerId);
    };

    const onWindowBlur = () => {
      finishFloatingEditorInteraction();
    };

    floatingEditorInteractionCleanupRef.current = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerFinish);
      window.removeEventListener("pointercancel", onPointerFinish);
      window.removeEventListener("blur", onWindowBlur);
      if (pointerTarget.hasPointerCapture?.(pointerId)) {
        pointerTarget.releasePointerCapture?.(pointerId);
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerFinish);
    window.addEventListener("pointercancel", onPointerFinish);
    window.addEventListener("blur", onWindowBlur);
    pointerTarget.setPointerCapture?.(pointerId);
  };

  const getFloatingEditorStyle = (): CSSProperties | undefined => {
    if (editorPinned || !floatingEditorGeometry) {
      return undefined;
    }

    return {
      height: `${floatingEditorGeometry.height}px`,
      left: `${floatingEditorGeometry.x}px`,
      top: `${floatingEditorGeometry.y}px`,
      width: `${floatingEditorGeometry.width}px`,
    };
  };

  const handleToggleEditorPinned = (nextPinned: boolean) => {
    setEditorPinned(nextPinned);
    void persistUiState({ editorPinned: nextPinned });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) {
        return;
      }

      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }

      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarCollapsed((value) => !value);
        return;
      }

      if (event.key === "1") {
        event.preventDefault();
        setDesktopSidebarView("explorer");
        return;
      }

      if (event.key === "2") {
        event.preventDefault();
        setDesktopSidebarView("search");
        return;
      }

      if (event.key === "3") {
        event.preventDefault();
        setDesktopSidebarView("source-control");
        return;
      }

      if (event.key === "4") {
        event.preventDefault();
        setDesktopSidebarView("agent-instructions");
        return;
      }

      if (event.key === "5") {
        event.preventDefault();
        setDesktopSidebarView("memory");
        return;
      }

      if (event.key === "6") {
        event.preventDefault();
        setDesktopSidebarView("skills");
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setDesktopSidebarView, setSidebarCollapsed]);

  if (!workspace) {
    return null;
  }

  return (
    <div ref={fullscreenRootRef} className="workspace-page workspace-page--desktop">
      <TopBar fullscreenController={fullscreenController} />

      <div className="workspace-body">
        {!focusMode && !sidebarCollapsed && (
          <>
            <aside
              ref={leftPanelRef}
              className="left-panel"
              style={{ width: `${leftPanelWidth}px` }}
            >
              <div className="nav-panel workspace-sidebar-panel">
                <WorkspaceActivityBar
                  activeView={activeSidebarView}
                  onSelectView={setDesktopSidebarView}
                />

                <div className="workspace-sidebar-panel__content">
                  {activeSidebarView === "explorer" ? (
                    <ExplorerPanel
                      workspaceId={workspace.id}
                      createRequest={createRequest}
                      onCreateRequestConsumed={handleConsumeCreateRequest}
                      onOpenFileCreate={handleOpenFileCreate}
                      onOpenFolderCreate={handleOpenFolderCreate}
                      refreshToken={panelRefreshToken}
                    />
                  ) : null}

                  {activeSidebarView === "search" ? (
                    <SearchPanel workspaceId={workspace.id} refreshToken={panelRefreshToken} />
                  ) : null}

                  {activeSidebarView === "source-control" ? (
                    <div className="workspace-sidebar-view">
                      <div className="workspace-sidebar-panel__body">
                        <GitPanel
                          workspaceId={workspace.id}
                          refreshToken={panelRefreshToken}
                          variant="desktop"
                        />
                      </div>
                    </div>
                  ) : null}

                  {activeSidebarView === "agent-instructions" ? (
                    <div className="workspace-sidebar-view">
                      <div className="workspace-sidebar-panel__body workspace-sidebar-panel__body--stacked">
                        <AgentTokenTrendSection workspacePath={workspace.path} />
                        <AgentInstructionsSection workspaceId={workspace.id} />
                      </div>
                    </div>
                  ) : null}

                  {activeSidebarView === "memory" ? (
                    <MemoryPanel workspaceId={workspace.id} refreshToken={panelRefreshToken} />
                  ) : null}

                  {activeSidebarView === "skills" ? (
                    <SkillsPanel workspaceId={workspace.id} refreshToken={panelRefreshToken} />
                  ) : null}
                </div>
              </div>
            </aside>

            <div
              className="split-divider-v"
              onPointerDown={handleLeftPointerDown}
              role="separator"
              aria-orientation="vertical"
              aria-label={t("workspace.resize_left_panel")}
            />
          </>
        )}

        <div className="workspace-main-area">
          <div ref={mainStageRef} className="workspace-main-stage" style={editorRestoreStyle}>
            <div
              className="agent-panes"
              aria-hidden={mainAreaMode === "editor" && editorPinned ? true : undefined}
            >
              <AgentPanes hydrateSessions={false} />
            </div>
            {mainAreaMode === "agent" || editorRestoreOpening ? (
              <WorkspaceEditorRestoreButton
                lastActivePath={lastActiveEditorPathRef.current}
                onPositionChange={setEditorRestorePosition}
                onRestoreStart={handleEditorRestoreStart}
                position={editorRestorePosition}
                restoring={editorRestoreOpening}
                workspaceId={workspace.id}
              />
            ) : null}
            {mainAreaMode === "editor" ? (
              <div
                ref={floatingEditorRef}
                className={`workspace-main-stage__editor-overlay workspace-main-stage__editor-overlay--${
                  editorPinned ? "pinned" : "floating"
                }${floatingEditorInteractionKind ? " workspace-main-stage__editor-overlay--interacting" : ""}${editorRestoreOpening ? " workspace-main-stage__editor-overlay--opening" : ""}`}
                style={getFloatingEditorStyle()}
              >
                {!editorPinned
                  ? FLOATING_EDITOR_RESIZE_HANDLES.map(({ corner, labelKey }) => (
                      <button
                        key={corner}
                        type="button"
                        aria-label={t(labelKey)}
                        className={`workspace-main-stage__editor-resize-handle workspace-main-stage__editor-resize-handle--${corner}`}
                        onPointerDown={(event) =>
                          beginFloatingEditorInteraction("resize", event, corner)
                        }
                      />
                    ))
                  : null}
                <CodeEditorHost
                  editorPinned={editorPinned}
                  onBeginFloatingEditorMove={(event) =>
                    beginFloatingEditorInteraction("move", event)
                  }
                  onToggleEditorPinned={handleToggleEditorPinned}
                />
              </div>
            ) : null}
          </div>

          {!focusMode && terminalPanelVisible && (
            <div
              className="split-divider-h"
              onPointerDown={handleBottomPointerDown}
              role="separator"
              aria-orientation="horizontal"
              aria-label={t("workspace.resize_bottom_panel")}
            />
          )}

          {!focusMode && terminalPanelVisible && (
            <div
              ref={bottomPanelRef}
              className="workspace-bottom-panel"
              style={{ height: `${bottomPanelHeight}px` }}
            >
              <WorkspaceBottomPanel workspaceId={workspace.id} />
            </div>
          )}
        </div>
      </div>

      <WorkspaceStatusBar
        align="start"
        workspaceId={workspace.id}
        gitState={gitState}
        onOpenBranchSwitcher={handleOpenBranchSwitcher}
      />
    </div>
  );
};

export const WorkspaceDesktopView: FC = () => {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const t = useTranslation();

  if (!workspace) {
    return (
      <div className="workspace-page workspace-page-empty">
        <div className="workspace-empty-content">
          <div className="workspace-empty-inner">
            <EmptyState
              style={{ minHeight: "auto", padding: 0 }}
              title={<p>{t("workspace.no_workspace")}</p>}
            />
          </div>
        </div>
      </div>
    );
  }

  return <WorkspaceDesktopScene key={workspace.id} />;
};

export { WorkspaceDesktopView as WorkspacePage };
export default WorkspaceDesktopView;
