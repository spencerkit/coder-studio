/**
 * Agent Panes Feature
 *
 * Manages agent session panels with split layout support.
 * Each panel contains a terminal showing agent output.
 */

import { useAtomValue, useSetAtom } from "jotai";
import { type FC, useCallback, useEffect, useRef } from "react";
import { activeWorkspaceAtom } from "../../atoms/workspaces";
import { EmptyState } from "../../components/ui";
import { useTranslation } from "../../lib/i18n";
import { useOpenEditorsActions } from "../workspace/actions/use-open-editors-actions";
import { useOpenWorkspaceFile } from "../workspace/actions/use-open-workspace-file";
import type { PaneDropIntent } from "./actions/pane-drag-types";
import { usePaneActions } from "./actions/use-pane-actions";
import { usePaneDragController } from "./actions/use-pane-drag-controller";
import { usePaneDragEnabled } from "./actions/use-pane-drag-enabled";
import { useSessionActions } from "./actions/use-session-actions";
import { useWorkspaceSessions } from "./actions/use-workspace-sessions";
import { activeEditorPaneIdAtomFamily, focusedEditorPaneIdAtomFamily } from "./atoms/editor-panes";
import { type PaneNode, readPaneRatio, writePaneRatio } from "./atoms/pane-layout";
import { collectSessionIds, paneLayoutHasEditorPaneId } from "./pane-layout-tree";
import { DraftLauncher } from "./views/shared/draft-launcher";
import { EditorPaneCard } from "./views/shared/editor-pane-card";
import { PaneLayout } from "./views/shared/pane-layout";
import { SessionCard } from "./views/shared/session-card";

/**
 * Agent Panes Container
 *
 * PRD §8:
 *   - Split panel layout (vertical/horizontal)
 *   - Multiple concurrent sessions
 *   - Each panel: terminal + session card
 *   - Draft launcher for new sessions
 */
interface AgentPanesProps {
  hydrateSessions?: boolean;
}

const emptyStateTitleStyle = {
  margin: 0,
  color: "var(--text-tertiary)",
  fontWeight: "var(--font-normal)",
};

function isDraftLeaf(node: PaneLeafNode): boolean {
  return node.leafKind === "draft" || (!node.leafKind && !node.sessionId);
}

function isEditorLeaf(node: PaneLeafNode): boolean {
  return node.leafKind === "editor";
}

export const AgentPanes: FC<AgentPanesProps> = ({ hydrateSessions = true }) => {
  const t = useTranslation();
  const paneDragEnabled = usePaneDragEnabled();
  const workspace = useAtomValue(activeWorkspaceAtom);
  const { workspaceId, sessions, paneLayout } = useWorkspaceSessions(workspace, {
    disabled: !hydrateSessions,
  });
  const paneActions = usePaneActions(workspaceId);
  const sessionActions = useSessionActions();
  const { openWorkspaceFile } = useOpenWorkspaceFile(workspaceId);
  const { closeAll } = useOpenEditorsActions(workspaceId, {
    workspaceRootPath: workspace?.path,
  });
  const setActiveEditorPaneId = useSetAtom(activeEditorPaneIdAtomFamily(workspaceId));
  const setFocusedEditorPaneId = useSetAtom(focusedEditorPaneIdAtomFamily(workspaceId));
  const { insertSessionPaneAtEdge, moveSessionToDraft, swapPaneSessions } = paneActions;
  const hasLayoutSessions = collectSessionIds(paneLayout).length > 0;
  const shouldShowStandaloneDraftLauncher =
    sessions.length === 0 &&
    (hasLayoutSessions ||
      (paneLayout.type === "leaf" && isDraftLeaf(paneLayout) && paneLayout.id === "root"));

  const handleOpenFile = useCallback(
    (paneId: string, path: string) => {
      void openWorkspaceFile(
        {
          workspaceId,
          path,
          source: "file-tree",
        },
        {
          targetDraftPaneId: paneId,
        }
      );
    },
    [openWorkspaceFile, workspaceId]
  );

  const handleActivateEditorPane = useCallback(
    (paneId: string) => {
      setActiveEditorPaneId(paneId);
      setFocusedEditorPaneId(paneId);
    },
    [setActiveEditorPaneId, setFocusedEditorPaneId]
  );

  const handleBlurEditorFocus = useCallback(() => {
    setFocusedEditorPaneId(null);
  }, [setFocusedEditorPaneId]);

  const handleCloseEditorPane = useCallback(
    (paneId: string) => {
      closeAll();
      paneActions.closeEditorPane(paneId);
      setActiveEditorPaneId((current) => (current === paneId ? null : current));
      setFocusedEditorPaneId((current) => (current === paneId ? null : current));
    },
    [closeAll, paneActions, setActiveEditorPaneId, setFocusedEditorPaneId]
  );

  useEffect(() => {
    setActiveEditorPaneId((current) =>
      current && !paneLayoutHasEditorPaneId(paneLayout, current) ? null : current
    );
    setFocusedEditorPaneId((current) =>
      current && !paneLayoutHasEditorPaneId(paneLayout, current) ? null : current
    );
  }, [paneLayout, setActiveEditorPaneId, setFocusedEditorPaneId]);

  const handlePaneDrop = useCallback(
    (intent: PaneDropIntent) => {
      if (intent.placement === "center") {
        if (intent.targetType === "draft") {
          moveSessionToDraft(intent.sourcePaneId, intent.targetPaneId);
          return;
        }

        swapPaneSessions(intent.sourcePaneId, intent.targetPaneId);
        return;
      }

      insertSessionPaneAtEdge(intent.sourcePaneId, intent.targetPaneId, intent.placement);
    },
    [insertSessionPaneAtEdge, moveSessionToDraft, swapPaneSessions]
  );
  const dragController = usePaneDragController({
    enabled: paneDragEnabled,
    onDrop: handlePaneDrop,
  });

  if (!workspace) {
    return (
      <div className="agent-panes-empty">
        <EmptyState
          style={{ padding: 0 }}
          title={<p style={emptyStateTitleStyle}>{t("workspace.no_workspace")}</p>}
        />
      </div>
    );
  }

  if (shouldShowStandaloneDraftLauncher) {
    return (
      <DraftLauncher
        paneId="root"
        workspaceId={workspaceId}
        onAssignSession={paneActions.assignSession}
        onOpenFile={handleOpenFile}
        onReplaceWithSession={paneActions.replaceWithSession}
        onSplitPane={paneActions.splitDraftPane}
      />
    );
  }

  // Render pane tree recursively
  return (
    <div className="agent-panes">
      <PaneNodeRenderer
        node={paneLayout}
        workspaceId={workspaceId}
        onCloseSession={paneActions.closeSessionPane}
        onSplitDraftPane={paneActions.splitDraftPane}
        onActivateEditorPane={handleActivateEditorPane}
        onBlurEditorFocus={handleBlurEditorFocus}
        onCloseEditorPane={handleCloseEditorPane}
        onSplitSession={paneActions.splitSessionPane}
        onCloseDraftPane={paneActions.closeDraftPane}
        onAssignSession={paneActions.assignSession}
        onOpenFile={handleOpenFile}
        dragController={dragController}
        onPaneDrop={handlePaneDrop}
        onReplaceWithSession={paneActions.replaceWithSession}
        onCloseSessionCommand={sessionActions.closeSession}
      />
    </div>
  );
};

interface PaneNodeRendererProps {
  dragController: ReturnType<typeof usePaneDragController>;
  node: PaneNode;
  workspaceId: string;
  onAssignSession: (paneId: string, sessionId: string) => void;
  onActivateEditorPane: (paneId: string) => void;
  onBlurEditorFocus: () => void;
  onCloseDraftPane: (paneId: string) => void;
  onCloseEditorPane: (paneId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onCloseSessionCommand: (
    sessionId: string,
    paneDisposition?: "draft" | "remove"
  ) => Promise<boolean | void>;
  onOpenFile: (paneId: string, path: string) => void;
  onPaneDrop: (intent: PaneDropIntent) => void;
  onReplaceWithSession: (sessionId: string) => void;
  onSplitDraftPane: (paneId: string, direction: "horizontal" | "vertical") => void;
  onSplitSession: (sessionId: string, direction: "horizontal" | "vertical") => void;
}

type PaneLeafNode = PaneNode & {
  type: "leaf";
  leafKind?: "draft" | "session" | "editor";
  sessionId?: string;
};

interface PaneLeafDragState {
  isDragging: boolean;
  isActiveDropTarget: boolean;
  hoverPlacement: ReturnType<typeof usePaneDragController>["state"]["hoverPlacement"];
}

function getPaneLeafDragState(
  dragState: ReturnType<typeof usePaneDragController>["state"],
  paneId: string
): PaneLeafDragState {
  const isActiveDropTarget = dragState.hoverTargetPaneId === paneId;

  return {
    isDragging: dragState.isDragging,
    isActiveDropTarget,
    hoverPlacement: isActiveDropTarget ? dragState.hoverPlacement : null,
  };
}

interface PaneLeafProps {
  dragController: ReturnType<typeof usePaneDragController>;
  node: PaneLeafNode;
  workspaceId: string;
  onAssignSession: (paneId: string, sessionId: string) => void;
  onActivateEditorPane: (paneId: string) => void;
  onBlurEditorFocus: () => void;
  onCloseDraftPane: (paneId: string) => void;
  onCloseEditorPane: (paneId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onCloseSessionCommand: (
    sessionId: string,
    paneDisposition?: "draft" | "remove"
  ) => Promise<boolean | void>;
  onOpenFile: (paneId: string, path: string) => void;
  onPaneDrop: (intent: PaneDropIntent) => void;
  onReplaceWithSession: (sessionId: string) => void;
  onSplitDraftPane: (paneId: string, direction: "horizontal" | "vertical") => void;
  onSplitSession: (sessionId: string, direction: "horizontal" | "vertical") => void;
}

const PaneLeaf: FC<PaneLeafProps> = ({
  dragController,
  node,
  workspaceId,
  onAssignSession,
  onActivateEditorPane,
  onBlurEditorFocus,
  onCloseDraftPane,
  onCloseEditorPane,
  onCloseSession,
  onCloseSessionCommand,
  onOpenFile,
  onPaneDrop,
  onReplaceWithSession,
  onSplitDraftPane,
  onSplitSession,
}) => {
  const leafRef = useRef<HTMLDivElement | null>(null);
  const dragState = getPaneLeafDragState(dragController.state, node.id);

  useEffect(() => {
    const element = leafRef.current;

    if (!element) {
      return;
    }

    if (isEditorLeaf(node)) {
      return;
    }

    dragController.registerPane(node.id, {
      type: node.sessionId ? "session" : "draft",
      element,
    });

    return () => {
      dragController.registerPane(node.id, null);
    };
  }, [dragController, node]);

  if (node.sessionId) {
    return (
      <div
        ref={leafRef}
        className="agent-pane-leaf"
        data-pane-id={node.id}
        data-pane-dragging={dragState.isDragging ? "true" : undefined}
        data-pane-drop-target={dragState.isActiveDropTarget ? "true" : undefined}
        data-pane-hover-placement={dragState.hoverPlacement ?? undefined}
        onPointerDownCapture={onBlurEditorFocus}
      >
        <SessionCard
          dragState={dragState}
          paneId={node.id}
          onPaneDragStart={dragController.startDrag}
          onPaneDrop={onPaneDrop}
          sessionId={node.sessionId}
          onClose={async () => {
            onCloseSession(node.sessionId);
            await onCloseSessionCommand(node.sessionId, "draft");
          }}
          onSplitHorizontal={() => onSplitSession(node.sessionId!, "horizontal")}
          onSplitVertical={() => onSplitSession(node.sessionId!, "vertical")}
        />
      </div>
    );
  }

  if (isEditorLeaf(node)) {
    return (
      <div
        ref={leafRef}
        className="agent-pane-leaf"
        data-pane-id={node.id}
        data-pane-dragging={dragState.isDragging ? "true" : undefined}
        onPointerDownCapture={() => onActivateEditorPane(node.id)}
      >
        <EditorPaneCard
          paneId={node.id}
          workspaceId={workspaceId}
          onClosePane={onCloseEditorPane}
          onSplitPane={onSplitDraftPane}
        />
      </div>
    );
  }

  return (
    <div
      ref={leafRef}
      className="agent-pane-leaf"
      data-pane-id={node.id}
      data-pane-dragging={dragState.isDragging ? "true" : undefined}
      data-pane-drop-target={dragState.isActiveDropTarget ? "true" : undefined}
      data-pane-hover-placement={dragState.hoverPlacement ?? undefined}
      onPointerDownCapture={onBlurEditorFocus}
    >
      <DraftLauncher
        dragState={{
          isDragging: dragState.isDragging,
          isActiveDropTarget: dragState.isActiveDropTarget,
          hoverPlacement: dragState.hoverPlacement === "center" ? "center" : null,
        }}
        workspaceId={workspaceId}
        paneId={node.id}
        onAssignSession={onAssignSession}
        onClosePane={onCloseDraftPane}
        onOpenFile={onOpenFile}
        onPaneDrop={onPaneDrop}
        onReplaceWithSession={onReplaceWithSession}
        onSplitPane={onSplitDraftPane}
      />
    </div>
  );
};

/**
 * Recursively render pane tree
 */
const PaneNodeRenderer: FC<PaneNodeRendererProps> = ({
  dragController,
  node,
  workspaceId,
  onAssignSession,
  onActivateEditorPane,
  onBlurEditorFocus,
  onCloseDraftPane,
  onCloseEditorPane,
  onCloseSession,
  onCloseSessionCommand,
  onOpenFile,
  onPaneDrop,
  onReplaceWithSession,
  onSplitDraftPane,
  onSplitSession,
}) => {
  if (node.type === "leaf") {
    return (
      <PaneLeaf
        dragController={dragController}
        node={node}
        workspaceId={workspaceId}
        onAssignSession={onAssignSession}
        onActivateEditorPane={onActivateEditorPane}
        onBlurEditorFocus={onBlurEditorFocus}
        onCloseDraftPane={onCloseDraftPane}
        onCloseEditorPane={onCloseEditorPane}
        onCloseSession={onCloseSession}
        onCloseSessionCommand={onCloseSessionCommand}
        onOpenFile={onOpenFile}
        onPaneDrop={onPaneDrop}
        onReplaceWithSession={onReplaceWithSession}
        onSplitDraftPane={onSplitDraftPane}
        onSplitSession={onSplitSession}
      />
    );
  }

  // Render split container
  const resolvedRatio = readPaneRatio(workspaceId, node.id) ?? node.ratio ?? 0.5;

  return (
    <PaneLayout
      splitId={node.id}
      direction={node.direction || "horizontal"}
      ratio={resolvedRatio}
      onRatioCommit={(ratio) => writePaneRatio(workspaceId, node.id, ratio)}
    >
      {node.children?.map((child) => (
        <PaneNodeRenderer
          key={child.id}
          dragController={dragController}
          node={child}
          workspaceId={workspaceId}
          onAssignSession={onAssignSession}
          onActivateEditorPane={onActivateEditorPane}
          onBlurEditorFocus={onBlurEditorFocus}
          onCloseDraftPane={onCloseDraftPane}
          onCloseEditorPane={onCloseEditorPane}
          onCloseSession={onCloseSession}
          onCloseSessionCommand={onCloseSessionCommand}
          onOpenFile={onOpenFile}
          onPaneDrop={onPaneDrop}
          onReplaceWithSession={onReplaceWithSession}
          onSplitDraftPane={onSplitDraftPane}
          onSplitSession={onSplitSession}
        />
      ))}
    </PaneLayout>
  );
};

export default AgentPanes;
