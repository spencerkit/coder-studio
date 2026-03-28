import type { Translator } from "../../i18n";
import {
  HeaderAddIcon,
  HeaderHistoryIcon,
  HeaderSettingsIcon,
} from "../icons";

type WorkspaceWelcomeScreenProps = {
  hasHistory: boolean;
  onOpenWorkspacePicker: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  t: Translator;
};

export const WorkspaceWelcomeScreen = ({
  hasHistory,
  onOpenWorkspacePicker,
  onOpenHistory,
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
        <button
          type="button"
          className="workspace-welcome-screen__button"
          onClick={onOpenHistory}
          disabled={!hasHistory}
        >
          <HeaderHistoryIcon />
          <span>{t("workspaceWelcomeRestoreHistory")}</span>
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
