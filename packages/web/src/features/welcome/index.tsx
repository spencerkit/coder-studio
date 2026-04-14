/**
 * Welcome Page Feature
 *
 * Landing page shown when no workspace is open.
 * Displays product info and "Open Workspace" button.
 */

import type { FC } from 'react';
import { useTranslation } from '../../lib/i18n';
import { FolderOpen, Settings } from 'lucide-react';
import { useSetAtom } from 'jotai';
import { commandPaletteOpenAtom } from '../../atoms/ui';

/**
 * Welcome Page
 *
 * PRD §7.4:
 *   - Centered panel with product info
 *   - "Open Workspace" button (primary action)
 *   - "Open Settings" link
 */
export const WelcomePage: FC = () => {
  const t = useTranslation();
  const setCommandPaletteOpen = useSetAtom(commandPaletteOpenAtom);

  const handleOpenWorkspace = () => {
    // TODO: Dispatch open workspace modal command
    console.log('Open workspace modal');
  };

  const handleOpenSettings = () => {
    // TODO: Navigate to settings
    console.log('Navigate to settings');
  };

  return (
    <div className="welcome-page">
      <div className="welcome-content">
        <div className="welcome-header">
          <h1 className="welcome-title">{t('app.name')}</h1>
          <p className="welcome-subtitle">{t('app.description')}</p>
        </div>

        <div className="welcome-actions">
          <button className="btn btn-primary btn-lg" onClick={handleOpenWorkspace}>
            <FolderOpen size={16} />
            <span>{t('action.open_workspace')}</span>
          </button>

          <button className="welcome-settings-link" onClick={handleOpenSettings}>
            <Settings size={14} />
            <span>{t('action.settings')}</span>
          </button>
        </div>

        <div className="welcome-hint">
          <p className="welcome-hint-text">{t('workspace.open_hint')}</p>
        </div>
      </div>
    </div>
  );
};

export default WelcomePage;
