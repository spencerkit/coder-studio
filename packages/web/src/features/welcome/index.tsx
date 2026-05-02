/**
 * Welcome Page Feature
 *
 * Landing page shown when no workspace is open.
 * Displays product info, "Open Workspace" button, and feature highlights.
 */

import type { FC } from 'react';
import { Plus, Settings, Terminal, Zap, GitBranch } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useViewport } from '../../hooks/use-viewport';
import { useTranslation } from '../../lib/i18n';
import { WorkspaceLaunchModal } from '../workspace/views/shared/workspace-launch-modal';

interface FeatureItem {
  icon: React.ReactNode;
  title: string;
  description: string;
}

/**
 * Welcome Page
 *
 * PRD §7.4:
 *   - Centered card with product info
 *   - "Open Workspace" button (primary action)
 *   - "Open Settings" link
 *   - Three feature highlights at bottom
 */
export const WelcomePage: FC = () => {
  const t = useTranslation();
  const navigate = useNavigate();
  const [workspaceLaunchOpen, setWorkspaceLaunchOpen] = useState(false);
  const isMobile = useViewport() === 'mobile';
  const features: FeatureItem[] = [
    {
      icon: <Zap size={18} />,
      title: t('welcome.features.agent_first.title'),
      description: t('welcome.features.agent_first.description'),
    },
    {
      icon: <GitBranch size={18} />,
      title: t('welcome.features.git_tools.title'),
      description: t('welcome.features.git_tools.description'),
    },
    {
      icon: <Terminal size={18} />,
      title: t('welcome.features.terminals.title'),
      description: t('welcome.features.terminals.description'),
    },
  ];

  const handleOpenWorkspace = () => {
    setWorkspaceLaunchOpen(true);
  };

  const handleOpenSettings = () => {
    navigate('/settings');
  };

  return (
    <>
      <div className={`welcome-container ${isMobile ? 'welcome-container--mobile' : ''}`}>
        <div className={`welcome-card ${isMobile ? 'welcome-card--mobile' : ''}`}>
          <div className="welcome-kicker">{t('welcome.kicker')}</div>
          <h1 className="welcome-title">{t('welcome.title')}</h1>
          <p className="welcome-body">{t('welcome.description')}</p>
          <button className="welcome-btn" onClick={handleOpenWorkspace}>
            <Plus size={18} />
            <span>{t('action.open_workspace')}</span>
          </button>
          <button className="welcome-link" onClick={handleOpenSettings}>
            <Settings size={14} />
            <span>{t('action.settings')}</span>
          </button>

          <div className="welcome-divider" />

          <div className="welcome-features">
            {features.map((f, i) => (
              <div className="welcome-feature" key={i}>
                <div className="welcome-feature-icon">{f.icon}</div>
                <div className="welcome-feature-text">
                  <div className="welcome-feature-title">{f.title}</div>
                  <div className="welcome-feature-desc">{f.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {workspaceLaunchOpen ? (
        <WorkspaceLaunchModal onClose={() => setWorkspaceLaunchOpen(false)} />
      ) : null}
    </>
  );
};

export default WelcomePage;
