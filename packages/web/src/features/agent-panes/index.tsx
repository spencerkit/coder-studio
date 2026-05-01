/**
 * Agent Panes Feature
 *
 * Manages agent session panels with split layout support.
 * Each panel contains a terminal showing agent output.
 */

import type { FC } from 'react';
import { useAtomValue } from 'jotai';
import { activeWorkspaceAtom } from '../../atoms/workspaces';
import type { PaneNode } from '../agent-panes/atoms/pane-layout';
import { useTranslation } from '../../lib/i18n';
import { PaneLayout } from './components/pane-layout';
import { SessionCard } from './components/session-card';
import { DraftLauncher } from './views/shared/draft-launcher';
import { useWorkspaceSessions } from './actions/use-workspace-sessions';
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
export const AgentPanes: FC = () => {
  const t = useTranslation();
  const workspace = useAtomValue(activeWorkspaceAtom);
  const { workspaceId, sessions, paneLayout } = useWorkspaceSessions(workspace);
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
        onResumeSession={sessionActions.resumeSession}
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
  onResumeSession: (sessionId: string) => Promise<void>;
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
  onResumeSession,
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
          onStart={() => onResumeSession(node.sessionId!)}
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
  return (
    <PaneLayout direction={node.direction || 'horizontal'} ratio={node.ratio || 0.5}>
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
          onResumeSession={onResumeSession}
          onSplitDraftPane={onSplitDraftPane}
          onSplitSession={onSplitSession}
          onStopSession={onStopSession}
        />
      ))}
    </PaneLayout>
  );
};

export default AgentPanes;
