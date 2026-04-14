/**
 * Agent Panes Feature
 *
 * Manages agent session panels with split layout support.
 * Each panel contains a terminal showing agent output.
 */

import type { FC } from 'react';
import { useAtomValue } from 'jotai';
import { activeWorkspaceAtom } from '../../atoms/workspaces';
import { sessionsByWorkspaceAtomFamily } from '../../atoms/sessions';
import { paneLayoutAtomFamily, type PaneNode } from '../../atoms/ui';
import { useTranslation } from '../../lib/i18n';
import { PaneLayout } from './components/pane-layout';
import { SessionCard } from './components/session-card';

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

  if (!workspace) {
    return (
      <div className="agent-panes-empty">
        <p>{t('workspace.no_workspace')}</p>
      </div>
    );
  }

  const sessions = useAtomValue(sessionsByWorkspaceAtomFamily(workspace.id));
  const paneLayout = useAtomValue(paneLayoutAtomFamily(workspace.id));

  // If no sessions, show draft launcher
  if (sessions.length === 0) {
    return <DraftLauncher workspaceId={workspace.id} />;
  }

  // Render pane tree recursively
  return (
    <div className="agent-panes">
      <PaneNodeRenderer node={paneLayout} workspaceId={workspace.id} />
    </div>
  );
};

interface PaneNodeRendererProps {
  node: PaneNode;
  workspaceId: string;
}

/**
 * Recursively render pane tree
 */
const PaneNodeRenderer: FC<PaneNodeRendererProps> = ({ node, workspaceId }) => {
  if (node.type === 'leaf') {
    // Render session card or draft launcher
    if (node.sessionId) {
      return <SessionCard sessionId={node.sessionId} />;
    } else {
      return <DraftLauncher workspaceId={workspaceId} />;
    }
  }

  // Render split container
  return (
    <PaneLayout direction={node.direction || 'horizontal'} ratio={node.ratio || 0.5}>
      {node.children?.map((child, idx) => (
        <PaneNodeRenderer key={child.id} node={child} workspaceId={workspaceId} />
      ))}
    </PaneLayout>
  );
};

interface DraftLauncherProps {
  workspaceId: string;
}

/**
 * Draft Session Launcher
 *
 * PRD §8.4:
 *   - Provider selection buttons (Claude, Codex)
 *   - Click to start new session
 */
const DraftLauncher: FC<DraftLauncherProps> = ({ workspaceId }) => {
  const t = useTranslation();

  const handleSelectProvider = (provider: 'claude' | 'codex') => {
    // TODO: Dispatch session create command
    console.log('Start session with provider:', provider);
  };

  return (
    <div className="agent-draft-launcher">
      <div className="agent-draft-content">
        <h3 className="agent-draft-title">{t('session.provider_select')}</h3>
        <div className="agent-draft-providers">
          <button
            className="btn btn-primary"
            onClick={() => handleSelectProvider('claude')}
          >
            Claude
          </button>
          <button
            className="btn btn-primary"
            onClick={() => handleSelectProvider('codex')}
          >
            Codex
          </button>
        </div>
      </div>
    </div>
  );
};

export default AgentPanes;
