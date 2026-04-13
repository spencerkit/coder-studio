import type { Translator } from "../../i18n";
import {
  HeaderAddIcon,
  HeaderSettingsIcon,
} from "../icons";

type WorkspaceWelcomeScreenProps = {
  onOpenWorkspacePicker: () => void;
  onOpenSettings: () => void;
  t: Translator;
};

export const WorkspaceWelcomeScreen = ({
  onOpenWorkspacePicker,
  onOpenSettings,
  t,
}: WorkspaceWelcomeScreenProps) => (
  <main className="workspace-welcome-screen" data-testid="workspace-welcome-screen">
    <div className="workspace-welcome-screen__panel">
      <span className="workspace-welcome-screen__kicker">{t("workspaceWelcomeKicker")}</span>
      <h1 className="workspace-welcome-screen__title">{t("workspaceWelcomeTitle")}</h1>
      <p className="workspace-welcome-screen__body">{t("workspaceWelcomeBody")}</p>

      <div className="workspace-welcome-screen__actions">
        <button
          type="button"
          className="workspace-welcome-screen__button workspace-welcome-screen__button--primary"
          onClick={onOpenWorkspacePicker}
        >
          <HeaderAddIcon />
          <span>{t("workspaceWelcomeOpenWorkspace")}</span>
        </button>
      </div>

      <button
        type="button"
        className="workspace-welcome-screen__link"
        onClick={onOpenSettings}
      >
        <HeaderSettingsIcon />
        <span>{t("workspaceWelcomeOpenSettings")}</span>
      </button>
    </div>
  </main>
);

export default WorkspaceWelcomeScreen;
