/**
 * TopBar Feature
 *
 * Main navigation bar with workspace tabs, quick actions, and settings.
 */

import { useAtomValue } from 'jotai';
import { useAtom } from 'jotai';
import { Plus } from 'lucide-react';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { workspacesAtom } from '../../atoms/workspaces';
import { commandPaletteOpenAtom, activeWorkspaceIdAtom } from '../../atoms/ui';
import { useTranslation } from '../../lib/i18n';
import { WorkspaceTab } from './components/tab';
import { ConnectionStatus } from './components/connection-status';

/**
 * TopBar Component
 *
 * Height: 36px (from PRD §5.1)
 * Layout:
 *   - Left: Workspace tabs + Add button
 *   - Right: Quick Actions + Settings button
 */
export const TopBar: FC = () => {
  const t = useTranslation();
  const navigate = useNavigate();
  const workspaces = useAtomValue(workspacesAtom);
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom);
  const [commandPaletteOpen, setCommandPaletteOpen] = useAtom(commandPaletteOpenAtom);

  const workspaceList = Object.values(workspaces);

  return (
    <header className="app-topbar">
      <div className="topbar-tabs">
        {workspaceList.length === 0 ? (
          <div className="topbar-empty-state">
            <span className="topbar-hint">{t('workspace.no_workspace')}</span>
          </div>
        ) : (
          <>
            {workspaceList.map((ws) => (
              <WorkspaceTab
                key={ws.id}
                workspace={ws}
                isActive={ws.id === activeWorkspaceId}
              />
            ))}
            <button
              className="topbar-add"
              onClick={() => {/* TODO: Open workspace launch modal */}}
              aria-label={t('workspace.open')}
              title={t('workspace.open')}
            >
              <Plus size={16} />
            </button>
          </>
        )}
      </div>

      <div className="topbar-actions">
        <ConnectionStatus />
        <button
          className="topbar-btn"
          onClick={() => setCommandPaletteOpen(!commandPaletteOpen)}
          aria-label={t('command.palette')}
        >
          <span className="topbar-btn-label">{t('command.palette')}</span>
        </button>
        <button
          className="topbar-btn"
          onClick={() => navigate('/settings')}
          aria-label={t('action.settings')}
          data-testid="settings-open"
        >
          <span className="topbar-btn-label">{t('action.settings')}</span>
        </button>
      </div>
    </header>
  );
};

export default TopBar;
