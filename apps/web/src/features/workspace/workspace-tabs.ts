import type { Locale } from "../../i18n";
import { localizeWorkspaceTitle } from "../../i18n";
import type { Tab } from "../../state/workbench";
import type { WorkspaceTabItem } from "../../types/app";
import { displayPathName } from "../../shared/utils/path";

export const buildWorkspaceTabItems = (
  tabs: Tab[],
  activeTabId: string,
  locale: Locale,
  sort: "default" | "name" = "default"
): WorkspaceTabItem[] => (sort === "name"
  ? [...tabs].sort((left, right) => (displayPathName(left.project?.path) || localizeWorkspaceTitle(left.title, locale))
    .localeCompare(displayPathName(right.project?.path) || localizeWorkspaceTitle(right.title, locale), locale === "zh" ? "zh-CN" : "en"))
  : tabs)
  .map((tab) => ({
    id: tab.id,
    label: displayPathName(tab.project?.path) || localizeWorkspaceTitle(tab.title, locale),
    active: tab.id === activeTabId,
    hasRunning: tab.sessions.some((session) => session.status === "running"),
    unread: tab.sessions.reduce((sum, session) => sum + session.unread, 0)
  }));
