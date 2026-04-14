/**
 * TopBar Feature
 *
 * Main navigation bar with workspace tabs, quick actions, and settings.
 */

import { useAtomValue, useSetAtom } from 'jotai';
import { useAtom } from 'jotai';
import { Plus } from 'lucide-react';
import { useAtomCallback } from 'jotai/utils';
import type { FC } from 'react';
import { useCallback } from 'react';
import { workspacesAtom, activeWorkspaceIdAtom } from '../../atoms/workspaces';
import { commandPaletteOpenAtom } from '../../atoms/ui';
import { useTranslation } from '../../lib/i18n';
import { WorkspaceTab } from './components/tab';
import { ConnectionStatus } from './components/connection-status';
import type { Workspace } from '@coder-studio/core';

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
  const workspaces = useAtomValue(workspacesAtom);
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom);
  const [commandPaletteOpen, setCommandPaletteOpen] = useAtom(commandPaletteOpenAtom);

  const workspaceList = Object.values(workspaces);

  return (
    <header className="topbar">
      <div className="topbar-left">
        {workspaceList.length === 0 ? (
          <div className="topbar-empty-state">
            <span className="topbar-hint">{t('workspace.no_workspace')}</span>
          </div>
        ) : (
          <>
            <div className="topbar-tabs">
              {workspaceList.map((ws) => (
                <WorkspaceTab
                  key={ws.id}
                  workspace={ws}
                  isActive={ws.id === activeWorkspaceId}
                />
              ))}
            </div>
            <button
              className="topbar-add-btn"
              onClick={() => {/* TODO: Open workspace launch modal */}}
              aria-label={t('workspace.open')}
              title={t('workspace.open')}
            >
              <Plus size={16} />
            </button>
          </>
        )}
      </div>

      <div className="topbar-right">
        <ConnectionStatus />
        <button
          className="topbar-tool"
          onClick={() => setCommandPaletteOpen(!commandPaletteOpen)}
          aria-label={t('command.palette')}
        >
          <span className="topbar-tool-label">{t('command.palette')}</span>
        </button>
        <button
          className="topbar-tool"
          onClick={() => {/* TODO: Navigate to settings */}}
          aria-label={t('action.settings')}
          data-testid="settings-open"
        >
          <span className="topbar-tool-label">{t('action.settings')}</span>
        </button>
      </div>
    </header>
  );
};

export default TopBar;
