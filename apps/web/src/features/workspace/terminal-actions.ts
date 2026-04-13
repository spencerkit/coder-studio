import type { MutableRefObject } from "react";
import { formatTerminalTitle, type Locale, type Translator } from "../../i18n";
import type { TerminalGridSize } from "../../shared/utils/terminal";
import type { Tab } from "../../state/workbench";
import type { WorkspaceControllerState } from "./workspace-controller";
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
  controller: WorkspaceControllerState,
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
  void resizeTerminalRequest(tabId, controller, numericId, cols, rows).catch(() => {
    // Keep UI state stable even if backend resize lags or fails.
  });
};

export const writeWorkspaceTerminalData = (
  tabId: string,
  controller: WorkspaceControllerState,
  terminalId: string | undefined,
  data: string,
) => {
  if (!terminalId) return;
  const numericId = Number(terminalId.replace("term-", ""));
  if (!Number.isFinite(numericId)) return;
  void writeTerminalRequest(tabId, controller, numericId, data).catch(() => {
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
  initialSize?: TerminalGridSize | null;
};

type ReplaceWorkspaceTerminalArgs = {
  tab: Tab;
  terminalId: string;
  updateTab: UpdateTab;
  addToast: (toast: Toast) => void;
  activeSessionId: string;
  createToastId: () => string;
  t: Translator;
  initialSize?: TerminalGridSize | null;
};

export const replaceWorkspaceTerminalEntry = (
  tab: Tab,
  terminalId: string,
  nextTerminal: Tab["terminals"][number],
): Tab => {
  if (!tab.terminals.some((terminal) => terminal.id === terminalId)) {
    return tab;
  }

  return {
    ...tab,
    terminals: tab.terminals.map((terminal) => (
      terminal.id === terminalId ? nextTerminal : terminal
    )),
    activeTerminalId: tab.activeTerminalId === terminalId
      ? nextTerminal.id
      : tab.activeTerminalId,
  };
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
  initialSize,
}: AddWorkspaceTerminalArgs) => {
  const activeProject = tab.project;
  if (!activeProject?.path) {
    addToast({ id: createToastId(), text: t("selectProjectFirst"), sessionId: activeSessionId });
    return false;
  }

  const info = await withServiceFallback<{ id: number; output: string }>(
    () => createTerminalRequest(tab.id, tab.controller, activeProject.path, activeProject.target, initialSize),
    { id: Date.now(), output: "" },
  );

  updateTab(tab.id, (currentTab) => {
    const newTerminal = {
      id: `term-${info.id}`,
      title: formatTerminalTitle(currentTab.terminals.length + 1, locale),
      output: info.output ?? "",
      recoverable: true,
    };
    return {
      ...currentTab,
      terminals: [...currentTab.terminals, newTerminal],
      activeTerminalId: newTerminal.id,
    };
  });
  return true;
};

export const replaceWorkspaceTerminal = async ({
  tab,
  terminalId,
  updateTab,
  addToast,
  activeSessionId,
  createToastId,
  t,
  initialSize,
}: ReplaceWorkspaceTerminalArgs) => {
  const activeProject = tab.project;
  if (!activeProject?.path) {
    addToast({ id: createToastId(), text: t("selectProjectFirst"), sessionId: activeSessionId });
    return false;
  }

  const currentTerminal = tab.terminals.find((terminal) => terminal.id === terminalId);
  if (!currentTerminal) {
    return false;
  }

  try {
    const info = await createTerminalRequest(
      tab.id,
      tab.controller,
      activeProject.path,
      activeProject.target,
      initialSize,
    );
    const nextTerminal = {
      id: `term-${info.id}`,
      title: currentTerminal.title,
      output: info.output ?? "",
      recoverable: true,
    };
    updateTab(tab.id, (currentTab) => replaceWorkspaceTerminalEntry(currentTab, terminalId, nextTerminal));

    const numericId = Number(terminalId.replace("term-", ""));
    if (Number.isFinite(numericId)) {
      void closeTerminalRequest(tab.id, tab.controller, numericId).catch(() => {
        // Keep the replacement shell usable even if cleanup of the dead snapshot lags.
      });
    }
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    addToast({
      id: createToastId(),
      text: `${t("workspaceTerminalCreateFailed")}: ${detail}`,
      sessionId: activeSessionId,
    });
    return false;
  }
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
    await withServiceFallback(() => closeTerminalRequest(tab.id, tab.controller, numericId), null);
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
