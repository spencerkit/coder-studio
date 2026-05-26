/**
 * Welcome Page Feature
 *
 * Landing page shown when no workspace is open.
 * Displays product info, a two-step workflow, and compact supporting context.
 */

import type { FC } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ThemedIcon } from "../../components/ui";
import { useViewport } from "../../hooks/use-viewport";
import { useTranslation } from "../../lib/i18n";
import type { IconSemantic } from "../../theme";
import { WorkspaceLaunchModal } from "../workspace/views/shared/workspace-launch-modal";

interface FeatureItem {
  iconSemantic: IconSemantic;
  title: string;
  description: string;
}

/**
 * Welcome Page
 *
 * PRD §7.4:
 *   - Clear first-run workspace activation flow
 *   - "Open Workspace" button as the primary action
 *   - "Settings" as secondary setup help
 *   - Compact support context below the core steps
 */
export const WelcomePage: FC = () => {
  const t = useTranslation();
  const navigate = useNavigate();
  const [workspaceLaunchOpen, setWorkspaceLaunchOpen] = useState(false);
  const isMobile = useViewport() === "mobile";
  const features: FeatureItem[] = [
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
      <div
        className={`welcome-container welcome-container--landing ${isMobile ? "welcome-container--mobile" : ""}`}
      >
        <div
          className={`welcome-card welcome-card--landing ${isMobile ? "welcome-card--mobile" : ""}`}
        >
          <div className="welcome-layout">
            <div className="welcome-card__hero">
              <div className="welcome-kicker page-kicker">{t("welcome.kicker")}</div>
              <h1 className="welcome-title page-title">{t("welcome.title")}</h1>
              <p className="welcome-body meta-text">{t("welcome.description")}</p>
            </div>

            <section className="welcome-flow" aria-labelledby="welcome-flow-title">
              <div className="welcome-flow__header">
                <div className="welcome-step-hint meta-text" id="welcome-flow-title">
                  {t("welcome.workflow_title")}
                </div>
              </div>

              <div className="welcome-flow__steps">
                <section className="welcome-step-card">
                  <div className="welcome-step-card__header">
                    <div className="welcome-step-card__label">{t("welcome.step_1_label")}</div>
                    <div className="welcome-step-card__icon">
                      <ThemedIcon semantic="nav.newWorkspace" size={18} />
                    </div>
                  </div>

                  <div className="welcome-step-card__title">{t("welcome.step_1_title")}</div>
                  <p className="welcome-step-detail meta-text">{t("welcome.step_1_detail")}</p>

                  <button className="welcome-btn" onClick={handleOpenWorkspace}>
                    <ThemedIcon semantic="nav.newWorkspace" size={18} />
                    <span>{t("action.open_workspace")}</span>
                  </button>
                </section>

                <section className="welcome-step-card">
                  <div className="welcome-step-card__header">
                    <div className="welcome-step-card__label">{t("welcome.step_2_label")}</div>
                    <div className="welcome-step-card__icon">
                      <ThemedIcon semantic="state.welcome.lightning" size={18} />
                    </div>
                  </div>

                  <div className="welcome-step-card__title">{t("welcome.step_2_title")}</div>
                  <p className="welcome-step-detail meta-text">{t("welcome.step_2_detail")}</p>
                  <p className="welcome-settings-hint meta-text">{t("welcome.settings_hint")}</p>

                  <button className="welcome-link" onClick={handleOpenSettings}>
                    <ThemedIcon semantic="nav.settings" size={14} />
                    <span>{t("action.settings")}</span>
                  </button>
                </section>
              </div>
            </section>
          </div>

          <div className="welcome-card__features">
            <div className="welcome-support">
              <div className="welcome-support__title">{t("welcome.support_title")}</div>
              <div className="welcome-support-list">
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
      </div>
      {workspaceLaunchOpen ? (
        <WorkspaceLaunchModal onClose={() => setWorkspaceLaunchOpen(false)} />
      ) : null}
    </>
  );
};

export default WelcomePage;
