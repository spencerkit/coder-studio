/**
 * Welcome Page Feature
 *
 * Landing page shown when no workspace is open.
 * Displays product info and "Open Workspace" button.
 */

import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../../lib/i18n';
import { Plus, Settings } from 'lucide-react';
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
  const navigate = useNavigate();
  const setCommandPaletteOpen = useSetAtom(commandPaletteOpenAtom);

  const handleOpenWorkspace = () => {
    // Open command palette for workspace selection
    setCommandPaletteOpen(true);
  };

  const handleOpenSettings = () => {
    navigate('/settings');
  };

  return (
    <div className="welcome-container">
      <div className="welcome-card">
        <div className="welcome-kicker">Get Started</div>
        <h1 className="welcome-title">{t('app.name')}</h1>
        <p className="welcome-body">{t('app.description')}</p>

        <button className="welcome-btn" onClick={handleOpenWorkspace}>
          <Plus size={16} />
          <span>{t('action.open_workspace')}</span>
        </button>

        <a className="welcome-link" onClick={handleOpenSettings}>
          <Settings size={14} />
          <span>{t('action.settings')}</span>
        </a>
      </div>
    </div>
  );
};

export default WelcomePage;
