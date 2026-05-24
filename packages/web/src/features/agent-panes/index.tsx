/**
 * Agent Panes Feature
 *
 * Manages agent session panels with split layout support.
 * Each panel contains a terminal showing agent output.
 */

import { useAtomValue } from "jotai";
import { type FC, useCallback, useEffect, useRef } from "react";
import { activeWorkspaceAtom } from "../../atoms/workspaces";
import { EmptyState } from "../../components/ui";
import { useTranslation } from "../../lib/i18n";
import type { PaneDropIntent } from "./actions/pane-drag-types";
import { usePaneActions } from "./actions/use-pane-actions";
import { usePaneDragController } from "./actions/use-pane-drag-controller";
import { usePaneDragEnabled } from "./actions/use-pane-drag-enabled";
import { useSessionActions } from "./actions/use-session-actions";
import { useWorkspaceSessions } from "./actions/use-workspace-sessions";
import { type PaneNode, readPaneRatio, writePaneRatio } from "./atoms/pane-layout";
import { collectSessionIds } from "./pane-layout-tree";
import { DraftLauncher } from "./views/shared/draft-launcher";
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

export const AgentPanes: FC<AgentPanesProps> = ({ hydrateSessions = true }) => {
  const t = useTranslation();
  const paneDragEnabled = usePaneDragEnabled();
  const workspace = useAtomValue(activeWorkspaceAtom);
  const { workspaceId, sessions, paneLayout } = useWorkspaceSessions(workspace, {
    disabled: !hydrateSessions,
  });
  const paneActions = usePaneActions(workspaceId);
  const sessionActions = useSessionActions();
  const { insertSessionPaneAtEdge, moveSessionToDraft, swapPaneSessions } = paneActions;
  const hasLayoutSessions = collectSessionIds(paneLayout).length > 0;
  const shouldShowStandaloneDraftLauncher =
    sessions.length === 0 &&
    (hasLayoutSessions ||
      (paneLayout.type === "leaf" && !paneLayout.sessionId && paneLayout.id === "root"));

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
        workspaceId={workspaceId}
        onReplaceWithSession={paneActions.replaceWithSession}
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
        onSplitSession={paneActions.splitSessionPane}
        onCloseDraftPane={paneActions.closeDraftPane}
        onAssignSession={paneActions.assignSession}
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
  onCloseDraftPane: (paneId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onCloseSessionCommand: (
    sessionId: string,
    paneDisposition?: "draft" | "remove"
  ) => Promise<boolean | void>;
  onPaneDrop: (intent: PaneDropIntent) => void;
  onReplaceWithSession: (sessionId: string) => void;
  onSplitDraftPane: (paneId: string, direction: "horizontal" | "vertical") => void;
  onSplitSession: (sessionId: string, direction: "horizontal" | "vertical") => void;
}

type PaneLeafNode = PaneNode & {
  type: "leaf";
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
  onCloseDraftPane: (paneId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onCloseSessionCommand: (
    sessionId: string,
    paneDisposition?: "draft" | "remove"
  ) => Promise<boolean | void>;
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
  onCloseDraftPane,
  onCloseSession,
  onCloseSessionCommand,
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

    dragController.registerPane(node.id, {
      type: node.sessionId ? "session" : "draft",
      element,
    });

    return () => {
      dragController.registerPane(node.id, null);
    };
  }, [dragController, node.id, node.sessionId]);

  if (node.sessionId) {
    return (
      <div
        ref={leafRef}
        className="agent-pane-leaf"
        data-pane-id={node.id}
        data-pane-dragging={dragState.isDragging ? "true" : undefined}
        data-pane-drop-target={dragState.isActiveDropTarget ? "true" : undefined}
        data-pane-hover-placement={dragState.hoverPlacement ?? undefined}
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

  return (
    <div
      ref={leafRef}
      className="agent-pane-leaf"
      data-pane-id={node.id}
      data-pane-dragging={dragState.isDragging ? "true" : undefined}
      data-pane-drop-target={dragState.isActiveDropTarget ? "true" : undefined}
      data-pane-hover-placement={dragState.hoverPlacement ?? undefined}
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
  onCloseDraftPane,
  onCloseSession,
  onCloseSessionCommand,
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
        onCloseDraftPane={onCloseDraftPane}
        onCloseSession={onCloseSession}
        onCloseSessionCommand={onCloseSessionCommand}
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
          onCloseDraftPane={onCloseDraftPane}
          onCloseSession={onCloseSession}
          onCloseSessionCommand={onCloseSessionCommand}
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
