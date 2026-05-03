/**
 * Agent Panes Feature
 *
 * Manages agent session panels with split layout support.
 * Each panel contains a terminal showing agent output.
 */

import type { FC } from 'react';
import { useAtomValue } from 'jotai';
import { activeWorkspaceAtom } from '../../atoms/workspaces';
import { useWorkspaceSessions } from './actions/use-workspace-sessions';
import { readPaneRatio, writePaneRatio, type PaneNode } from './atoms/pane-layout';
import { useTranslation } from '../../lib/i18n';
import { DraftLauncher } from './views/shared/draft-launcher';
import { PaneLayout } from './views/shared/pane-layout';
import { SessionCard } from './views/shared/session-card';
import { usePaneActions } from './actions/use-pane-actions';
import { useSessionActions } from './actions/use-session-actions';
import { collectSessionIds } from './pane-layout-tree';

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

export const AgentPanes: FC<AgentPanesProps> = ({ hydrateSessions = true }) => {
  const t = useTranslation();
  const workspace = useAtomValue(activeWorkspaceAtom);
  const { workspaceId, sessions, paneLayout } = useWorkspaceSessions(workspace, {
    disabled: !hydrateSessions,
  });
  const paneActions = usePaneActions(workspaceId);
  const sessionActions = useSessionActions();
  const hasLayoutSessions = collectSessionIds(paneLayout).length > 0;
  const shouldShowStandaloneDraftLauncher =
    sessions.length === 0 &&
    (hasLayoutSessions || (paneLayout.type === 'leaf' && !paneLayout.sessionId && paneLayout.id === 'root'));

  if (!workspace) {
    return (
      <div className="agent-panes-empty">
        <p>{t('workspace.no_workspace')}</p>
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
        onReplaceWithSession={paneActions.replaceWithSession}
        onCloseSessionCommand={sessionActions.closeSession}
        onStopSession={sessionActions.stopSession}
      />
    </div>
  );
};

interface PaneNodeRendererProps {
  node: PaneNode;
  workspaceId: string;
  onAssignSession: (paneId: string, sessionId: string) => void;
  onCloseDraftPane: (paneId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onCloseSessionCommand: (sessionId: string) => Promise<void>;
  onReplaceWithSession: (sessionId: string) => void;
  onSplitDraftPane: (paneId: string, direction: 'horizontal' | 'vertical') => void;
  onSplitSession: (sessionId: string, direction: 'horizontal' | 'vertical') => void;
  onStopSession: (sessionId: string) => Promise<void>;
}

/**
 * Recursively render pane tree
 */
const PaneNodeRenderer: FC<PaneNodeRendererProps> = ({
  node,
  workspaceId,
  onAssignSession,
  onCloseDraftPane,
  onCloseSession,
  onCloseSessionCommand,
  onReplaceWithSession,
  onSplitDraftPane,
  onSplitSession,
  onStopSession,
}) => {
  if (node.type === 'leaf') {
    // Render session card or draft launcher
    if (node.sessionId) {
      return (
        <SessionCard
          sessionId={node.sessionId}
          onClose={async () => {
            onCloseSession(node.sessionId!);
            await onCloseSessionCommand(node.sessionId!);
          }}
          onSplitHorizontal={() => onSplitSession(node.sessionId!, 'horizontal')}
          onSplitVertical={() => onSplitSession(node.sessionId!, 'vertical')}
          onStop={() => onStopSession(node.sessionId!)}
        />
      );
    } else {
      return (
        <DraftLauncher
          workspaceId={workspaceId}
          paneId={node.id}
          onAssignSession={onAssignSession}
          onClosePane={onCloseDraftPane}
          onReplaceWithSession={onReplaceWithSession}
          onSplitPane={onSplitDraftPane}
        />
      );
    }
  }

  // Render split container
  const resolvedRatio = readPaneRatio(workspaceId, node.id) ?? node.ratio ?? 0.5;

  return (
    <PaneLayout
      splitId={node.id}
      direction={node.direction || 'horizontal'}
      ratio={resolvedRatio}
      onRatioCommit={(ratio) => writePaneRatio(workspaceId, node.id, ratio)}
    >
      {node.children?.map((child) => (
        <PaneNodeRenderer
          key={child.id}
          node={child}
          workspaceId={workspaceId}
          onAssignSession={onAssignSession}
          onCloseDraftPane={onCloseDraftPane}
          onCloseSession={onCloseSession}
          onCloseSessionCommand={onCloseSessionCommand}
          onReplaceWithSession={onReplaceWithSession}
          onSplitDraftPane={onSplitDraftPane}
          onSplitSession={onSplitSession}
          onStopSession={onStopSession}
        />
      ))}
    </PaneLayout>
  );
};

export default AgentPanes;
