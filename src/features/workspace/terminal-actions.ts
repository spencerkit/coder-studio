import type { MutableRefObject } from "react";
import { formatTerminalTitle, type Locale, type Translator } from "../../i18n";
import type { Tab } from "../../state/workbench";
import {
  closeTerminal as closeTerminalRequest,
  createTerminal as createTerminalRequest,
  resizeTerminal as resizeTerminalRequest,
  writeTerminal as writeTerminalRequest,
} from "../../services/http/terminal.service";
import type { Toast } from "../../types/app";

type UpdateTab = (tabId: string, updater: (tab: Tab) => Tab) => void;
type WithServiceFallback = <T>(operation: () => Promise<T>, fallback: T) => Promise<T>;

type TerminalSizeRef = MutableRefObject<{ id?: string; cols: number; rows: number }>;

export const syncWorkspaceTerminalSize = (
  terminalSizeRef: TerminalSizeRef,
  tabId: string,
  terminalId: string | undefined,
  cols: number,
  rows: number,
) => {
  if (!tabId || !terminalId) return;
  const numericId = Number(terminalId.replace("term-", ""));
  if (!Number.isFinite(numericId)) return;

  const last = terminalSizeRef.current;
  if (last.id === terminalId && last.cols === cols && last.rows === rows) return;
  terminalSizeRef.current = { id: terminalId, cols, rows };
  void resizeTerminalRequest(tabId, numericId, cols, rows).catch(() => {
    // Keep UI state stable even if backend resize lags or fails.
  });
};

export const writeWorkspaceTerminalData = (
  tabId: string,
  terminalId: string | undefined,
  data: string,
) => {
  if (!terminalId) return;
  const numericId = Number(terminalId.replace("term-", ""));
  if (!Number.isFinite(numericId)) return;
  void writeTerminalRequest(tabId, numericId, data).catch(() => {
    // Keep the terminal interactive even if a single write fails.
  });
};

type AddWorkspaceTerminalArgs = {
  tab: Tab;
  locale: Locale;
  updateTab: UpdateTab;
  withServiceFallback: WithServiceFallback;
  addToast: (toast: Toast) => void;
  activeSessionId: string;
  createToastId: () => string;
  t: Translator;
};

export const addWorkspaceTerminal = async ({
  tab,
  locale,
  updateTab,
  withServiceFallback,
  addToast,
  activeSessionId,
  createToastId,
  t,
}: AddWorkspaceTerminalArgs) => {
  const activeProject = tab.project;
  if (!activeProject?.path) {
    addToast({ id: createToastId(), text: t("selectProjectFirst"), sessionId: activeSessionId });
    return false;
  }

  const info = await withServiceFallback<{ id: number; output: string }>(
    () => createTerminalRequest(tab.id, activeProject.path, activeProject.target),
    { id: Date.now(), output: "" },
  );

  updateTab(tab.id, (currentTab) => {
    const newTerminal = {
      id: `term-${info.id}`,
      title: formatTerminalTitle(currentTab.terminals.length + 1, locale),
      output: info.output ?? "",
    };
    return {
      ...currentTab,
      terminals: [...currentTab.terminals, newTerminal],
      activeTerminalId: newTerminal.id,
    };
  });
  return true;
};

export const selectWorkspaceTerminal = (
  updateTab: UpdateTab,
  tabId: string,
  terminalId: string,
) => {
  updateTab(tabId, (tab) => ({ ...tab, activeTerminalId: terminalId }));
};

export const closeWorkspaceTerminal = async (
  tab: Tab,
  terminalId: string,
  updateTab: UpdateTab,
  withServiceFallback: WithServiceFallback,
) => {
  const numericId = Number(terminalId.replace("term-", ""));
  if (Number.isFinite(numericId)) {
    await withServiceFallback(() => closeTerminalRequest(tab.id, numericId), null);
  }

  updateTab(tab.id, (currentTab) => {
    const remaining = currentTab.terminals.filter((terminal) => terminal.id !== terminalId);
    const nextActiveId = currentTab.activeTerminalId === terminalId
      ? (remaining[0]?.id ?? "")
      : currentTab.activeTerminalId;

    return {
      ...currentTab,
      terminals: remaining,
      activeTerminalId: nextActiveId,
    };
  });
};
