/**
 * Welcome Page Feature
 *
 * Landing page shown when no workspace is open.
 * Displays product info, "Open Workspace" button, and feature highlights.
 */

import type { FC } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState, ThemedIcon } from "../../components/ui";
import { useViewport } from "../../hooks/use-viewport";
import { useTranslation } from "../../lib/i18n";
import type { IconSemantic } from "../../theme";
import { WorkspaceLaunchModal } from "../workspace/views/shared/workspace-launch-modal";

interface FeatureItem {
  iconSemantic: IconSemantic;
  title: string;
  description: string;
}

const welcomeEmptyStateStyle = {
  minHeight: "auto",
  padding: 0,
  gap: "var(--sp-5)",
};

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
  const isMobile = useViewport() === "mobile";
  const features: FeatureItem[] = [
    {
      iconSemantic: "state.welcome.lightning",
      title: t("welcome.features.agent_first.title"),
      description: t("welcome.features.agent_first.description"),
    },
    {
      iconSemantic: "state.welcome.git",
      title: t("welcome.features.git_tools.title"),
      description: t("welcome.features.git_tools.description"),
    },
    {
      iconSemantic: "state.welcome.terminal",
      title: t("welcome.features.terminals.title"),
      description: t("welcome.features.terminals.description"),
    },
  ];

  const handleOpenWorkspace = () => {
    setWorkspaceLaunchOpen(true);
  };

  const handleOpenSettings = () => {
    navigate("/settings");
  };

  return (
    <>
      <div className={`welcome-container ${isMobile ? "welcome-container--mobile" : ""}`}>
        <div className={`welcome-card ${isMobile ? "welcome-card--mobile" : ""}`}>
          <div className="welcome-card__hero">
            <EmptyState
              style={welcomeEmptyStateStyle}
              title={
                <div>
                  <div className="welcome-kicker page-kicker">{t("welcome.kicker")}</div>
                  <h1 className="welcome-title page-title">{t("welcome.title")}</h1>
                </div>
              }
              description={<p className="welcome-body meta-text">{t("welcome.description")}</p>}
            />
          </div>

          <div className="welcome-card__actions">
            <button className="welcome-btn" onClick={handleOpenWorkspace}>
              <ThemedIcon semantic="nav.newWorkspace" size={18} />
              <span>{t("action.open_workspace")}</span>
            </button>

            <button className="welcome-link" onClick={handleOpenSettings}>
              <ThemedIcon semantic="nav.settings" size={14} />
              <span>{t("action.settings")}</span>
            </button>
          </div>

          <div className="welcome-card__panel">
            <div className="welcome-divider" />

            <div className="welcome-features">
              {features.map((feature) => (
                <div className="welcome-feature" key={feature.iconSemantic}>
                  <ThemedIcon
                    className="welcome-feature-icon"
                    semantic={feature.iconSemantic}
                    size={18}
                  />
                  <div className="welcome-feature-text">
                    <div className="welcome-feature-title">{feature.title}</div>
                    <div className="welcome-feature-desc">{feature.description}</div>
                  </div>
                </div>
              ))}
            </div>
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
