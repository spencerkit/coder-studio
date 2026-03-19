import type { Translator, Locale } from "../../i18n";
import type { WorkspaceTabItem } from "../../types/app";
import { HeaderAddIcon, HeaderBackIcon, HeaderCloseIcon, HeaderSettingsIcon, SearchIcon } from "../icons";

type TopBarProps = {
  isSettingsRoute: boolean;
  locale: Locale;
  workspaceTabs: WorkspaceTabItem[];
  onSwitchWorkspace: (id: string) => void;
  onAddTab: () => void;
  onRemoveTab: (id: string) => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onOpenCommandPalette: () => void;
  t: Translator;
};

export const TopBar = ({
  isSettingsRoute,
  locale,
  workspaceTabs,
  onSwitchWorkspace,
  onAddTab,
  onRemoveTab,
  onOpenSettings,
  onCloseSettings,
  onOpenCommandPalette,
  t
}: TopBarProps) => (
  <header className={`topbar ${isSettingsRoute ? "topbar-settings" : ""}`}>
    <div className="topbar-tabs-wrap">
      {isSettingsRoute ? (
        <div className="route-topbar" data-testid="settings-topbar">
          <button className="route-topbar-back" type="button" onClick={onCloseSettings}>
            <HeaderBackIcon />
            <span>{t("backToApp")}</span>
          </button>
          <div className="route-topbar-title">{t("settings")}</div>
        </div>
      ) : (
        <div className="topbar-session-strip topbar-workspace-strip" data-testid="workspace-topbar">
          {workspaceTabs.map((item) => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              className={`session-top-tab workspace-top-tab ${item.active ? "active" : ""} ${item.hasRunning ? "running-glow" : ""}`}
              onClick={() => onSwitchWorkspace(item.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSwitchWorkspace(item.id);
                }
              }}
              title={item.label}
            >
              <span className={`session-top-dot ${item.hasRunning ? "active pulse" : "idle"}`} />
              <span className="session-top-label">{item.label}</span>
              {!item.active && item.unread > 0 && (
                <span className="session-top-unread" title={`${item.unread}`} aria-label={`${item.unread}`}>
                  {item.unread > 9 ? "9+" : item.unread}
                </span>
              )}
              <button
                type="button"
                className="session-top-close"
                title={t("close")}
                aria-label={t("close")}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveTab(item.id);
                }}
              >
                <HeaderCloseIcon />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="session-top-add"
            onClick={onAddTab}
            title={locale === "zh" ? "新建工作区" : "Add workspace"}
            aria-label={locale === "zh" ? "新建工作区" : "Add workspace"}
          >
            <HeaderAddIcon />
          </button>
        </div>
      )}
    </div>
    <div className="topbar-actions">
      {!isSettingsRoute && (
        <>
          <button
            type="button"
            className="topbar-tool topbar-tool-wide"
            onClick={onOpenCommandPalette}
            title={locale === "zh" ? "快速操作（⌘/Ctrl+K）" : "Quick actions (⌘/Ctrl+K)"}
            aria-label={locale === "zh" ? "快速操作" : "Quick actions"}
          >
            <SearchIcon />
            <span>{locale === "zh" ? "操作" : "Actions"}</span>
          </button>
          <button className="topbar-tool" type="button" onClick={onOpenSettings} data-testid="settings-open" title={t("settings")} aria-label={t("settings")}>
            <HeaderSettingsIcon />
          </button>
        </>
      )}
    </div>
  </header>
);

export default TopBar;
