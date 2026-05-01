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
import { WorkspaceLaunchModal } from '../workspace/views/shared/workspace-launch-modal';

interface FeatureItem {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const features: FeatureItem[] = [
  {
    icon: <Zap size={18} />,
    title: 'Agent-first AI coding',
    description: 'Launch AI sessions that write, test, and deploy code.',
  },
  {
    icon: <GitBranch size={18} />,
    title: 'Built-in Git tools',
    description: 'Stage, commit, and manage branches without leaving the IDE.',
  },
  {
    icon: <Terminal size={18} />,
    title: 'Integrated terminals',
    description: 'Run commands and scripts alongside your AI sessions.',
  },
];

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
  const navigate = useNavigate();
  const [workspaceLaunchOpen, setWorkspaceLaunchOpen] = useState(false);
  const isMobile = useViewport() === 'mobile';

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
          <div className="welcome-kicker">GET STARTED</div>
          <h1 className="welcome-title">Welcome to Coder Studio</h1>
          <p className="welcome-body">
            A local-first AI coding workbench. Launch AI agent sessions, review generated code,
            manage Git changes, and run terminals — all in one place.
          </p>
          <button className="welcome-btn" onClick={handleOpenWorkspace}>
            <Plus size={18} />
            <span>Open Workspace</span>
          </button>
          <button className="welcome-link" onClick={handleOpenSettings}>
            <Settings size={14} />
            <span>Open Settings</span>
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
