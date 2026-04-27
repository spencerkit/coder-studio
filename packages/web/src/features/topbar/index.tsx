/**
 * TopBar Feature
 *
 * Main navigation bar with workspace tabs, quick actions, and settings.
 */

import { useAtomValue, useAtom } from 'jotai';
import { Plus, Search, Settings, PanelBottom, PanelLeft } from 'lucide-react';
import type { FC } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { orderedWorkspacesAtom, resolvedActiveWorkspaceIdAtom } from '../../atoms/workspaces';
import { commandPaletteOpenAtom, terminalPanelVisibleAtom, sidebarCollapsedAtom } from '../../atoms/ui';
import { WorkspaceTab } from './components/tab';
import { ConnectionStatus } from './components/connection-status';
import { WorkspaceLaunchModal } from '../workspace/components/workspace-launch-modal';

/**
 * TopBar Component
 *
 * Height: 36px (from PRD §5.1)
 * Layout:
 *   - Left: Workspace tabs + Add button
 *   - Right: ConnectionStatus, Quick Actions, Terminal toggle, Files toggle, Settings
 */
export const TopBar: FC = () => {
  const navigate = useNavigate();
  const workspaceList = useAtomValue(orderedWorkspacesAtom);
  const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
  const [commandPaletteOpen, setCommandPaletteOpen] = useAtom(commandPaletteOpenAtom);
  const [terminalPanelVisible, setTerminalPanelVisible] = useAtom(terminalPanelVisibleAtom);
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom);
  const [workspaceLaunchOpen, setWorkspaceLaunchOpen] = useState(false);

  return (
    <header className="app-topbar">
      <div className="topbar-tabs">
        {workspaceList.length === 0 ? (
          <div className="topbar-empty-state">
            <span className="topbar-hint">No workspaces open</span>
          </div>
        ) : (
          workspaceList.map((ws) => (
            <WorkspaceTab
              key={ws.id}
              workspace={ws}
              isActive={ws.id === activeWorkspaceId}
            />
          ))
        )}
        <button
          className="topbar-add"
          onClick={() => setWorkspaceLaunchOpen(true)}
          aria-label="New workspace"
          title="New workspace"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="topbar-actions">
        <ConnectionStatus />
        <button
          className="topbar-btn topbar-quick-actions"
          onClick={() => setCommandPaletteOpen(!commandPaletteOpen)}
          aria-label="Quick Actions"
          title="Quick Actions"
        >
          <Search size={14} />
          <span className="topbar-btn-label">Quick Actions</span>
        </button>
        <button
          className={`topbar-btn ${terminalPanelVisible ? '' : 'topbar-btn--muted'}`}
          onClick={() => setTerminalPanelVisible(!terminalPanelVisible)}
          aria-label={terminalPanelVisible ? 'Hide Terminal' : 'Show Terminal'}
          title={terminalPanelVisible ? 'Hide Terminal (Ctrl+\`)' : 'Show Terminal (Ctrl+\`)'}
        >
          <PanelBottom size={14} />
        </button>
        <button
          className={`topbar-btn ${sidebarCollapsed ? 'topbar-btn--muted' : ''}`}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          aria-label={sidebarCollapsed ? 'Show Files' : 'Hide Files'}
          title={sidebarCollapsed ? 'Show Files' : 'Hide Files'}
        >
          <PanelLeft size={14} />
        </button>
        <button
          className="topbar-btn"
          onClick={() => navigate('/settings')}
          aria-label="Settings"
          title="Settings"
          data-testid="settings-open"
        >
          <Settings size={14} />
        </button>
      </div>
      {workspaceLaunchOpen ? (
        <WorkspaceLaunchModal onClose={() => setWorkspaceLaunchOpen(false)} />
      ) : null}
    </header>
  );
};

export default TopBar;
