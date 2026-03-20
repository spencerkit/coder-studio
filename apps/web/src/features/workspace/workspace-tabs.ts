import type { Locale } from "../../i18n";
import { localizeWorkspaceTitle } from "../../i18n";
import type { Tab } from "../../state/workbench";
import type { WorkspaceTabItem } from "../../types/app";
import { displayPathName } from "../../shared/utils/path";

export const buildWorkspaceTabItems = (
  tabs: Tab[],
  activeTabId: string,
  locale: Locale,
  sort: "time" | "name" = "time"
): WorkspaceTabItem[] => [...tabs]
  .sort((left, right) => {
    if (sort === "name") {
      return (displayPathName(left.project?.path) || localizeWorkspaceTitle(left.title, locale))
        .localeCompare(displayPathName(right.project?.path) || localizeWorkspaceTitle(right.title, locale), locale === "zh" ? "zh-CN" : "en");
    }
    const leftTime = Math.max(...left.sessions.map((session) => session.lastActiveAt));
    const rightTime = Math.max(...right.sessions.map((session) => session.lastActiveAt));
    return rightTime - leftTime;
  })
  .map((tab) => ({
    id: tab.id,
    label: displayPathName(tab.project?.path) || localizeWorkspaceTitle(tab.title, locale),
    active: tab.id === activeTabId,
    hasRunning: tab.sessions.some((session) => ["running", "waiting", "background"].includes(session.status)),
    unread: tab.sessions.reduce((sum, session) => sum + session.unread, 0)
  }));
