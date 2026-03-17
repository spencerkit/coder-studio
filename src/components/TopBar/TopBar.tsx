// ==========================================================================
// Coder Studio - TopBar Component
// ==========================================================================

import React from "react";
import type { TopBarProps } from "./types";
import { HeaderCloseIcon, HeaderAddIcon, HeaderSettingsIcon, ThemeDarkIcon, ThemeLightIcon, HeaderBackIcon } from "../icons";

export const TopBar: React.FC<TopBarProps> = ({
  theme,
  locale,
  route,
  workspaceTabs,
  onSwitchWorkspace,
  onAddTab,
  onRemoveTab,
  onOpenSettings,
  onCloseSettings,
  onToggleTheme,
  onToggleLocale,
  t
}) => {
  const isSettingsRoute = route === "settings";

  return (
    <header className="topbar">
      <div className="topbar-tabs-wrap">
        {isSettingsRoute ? (
          <div className="settings-topbar" data-testid="settings-topbar">
            <div className="settings-topbar-copy">
              <div className="section-kicker">{t("globalSettings")}</div>
              <div className="settings-topbar-title">{t("settings")}</div>
            </div>
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
                onKeyDown={(event: KeyboardEvent) => {
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
                  onClick={(event: React.MouseEvent) => {
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
              className="topbar-tool"
              onClick={onToggleTheme}
              title={theme === "dark" ? t("themeLight") : t("themeDark")}
              aria-label={t("theme")}
            >
              {theme === "dark" ? <ThemeDarkIcon /> : <ThemeLightIcon />}
            </button>
            <button
              type="button"
              className="topbar-tool locale"
              onClick={onToggleLocale}
              data-testid="locale-toggle-compact"
              title={t("languageLabel")}
              aria-label={t("languageLabel")}
            >
              {locale === "zh" ? "中" : "EN"}
            </button>
            <button className="topbar-tool" type="button" onClick={onOpenSettings} data-testid="settings-open" title={t("settings")} aria-label={t("settings")}>
              <HeaderSettingsIcon />
            </button>
          </>
        )}
      </div>
    </header>
  );
};

export default TopBar;
