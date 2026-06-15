import { Topics, type UiActionEvent } from "@coder-studio/core";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useMemo } from "react";
import { commandPaletteOpenAtom, quickOpenOpenAtom } from "../../atoms/app-ui";
import { wsClientAtom } from "../../atoms/connection";
import {
  currentDevBrowserUrlAtomFamily,
  pendingDevBrowserUrlAtomFamily,
} from "../dev-browser/atoms";
import { pushToastAtom } from "../notifications/atoms";
import { useOpenWorkspaceFile } from "../workspace/actions/use-open-workspace-file";
import { useSelectWorkspaceTarget } from "../workspace/actions/use-select-workspace-target";
import {
  activeEditorTabAtomFamily,
  activeFilePathAtomFamily,
  createWorkspaceBrowserEditorTab,
  editorViewVisibleAtomFamily,
  openEditorPathsAtomFamily,
  openEditorTabsAtomFamily,
  type WorkspaceEditorTab,
} from "../workspace/atoms/files";
import {
  desktopSidebarViewAtomFamily,
  sidebarCollapsedAtomFamily,
  terminalPanelVisibleAtomFamily,
} from "../workspace/atoms/layout";
import { createUiActionRegistry, isAllowedFrontendUiCommand } from "./registry";

function isUiActionEvent(value: unknown): value is UiActionEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as UiActionEvent).requestId === "string" &&
    typeof (value as UiActionEvent).workspaceId === "string" &&
    typeof (value as UiActionEvent).dispatchedAt === "number" &&
    typeof (value as UiActionEvent).intent === "object" &&
    (value as UiActionEvent).intent !== null &&
    typeof (value as UiActionEvent).intent.type === "string"
  );
}

export function useUiActionSubscription(workspaceId: string): void {
  const wsClient = useAtomValue(wsClientAtom);
  const setQuickOpenOpen = useSetAtom(quickOpenOpenAtom);
  const setCommandPaletteOpen = useSetAtom(commandPaletteOpenAtom);
  const setPendingDevBrowserUrl = useSetAtom(pendingDevBrowserUrlAtomFamily(workspaceId));
  const setCurrentDevBrowserUrl = useSetAtom(currentDevBrowserUrlAtomFamily(workspaceId));
  const setEditorViewVisible = useSetAtom(editorViewVisibleAtomFamily(workspaceId));
  const setOpenEditorPaths = useSetAtom(openEditorPathsAtomFamily(workspaceId));
  const setOpenEditorTabs = useSetAtom(openEditorTabsAtomFamily(workspaceId));
  const setActiveFilePath = useSetAtom(activeFilePathAtomFamily(workspaceId));
  const setActiveEditorTab = useSetAtom(activeEditorTabAtomFamily(workspaceId));
  const setTerminalVisible = useSetAtom(terminalPanelVisibleAtomFamily(workspaceId));
  const setDesktopSidebarView = useSetAtom(desktopSidebarViewAtomFamily(workspaceId));
  const setSidebarCollapsed = useSetAtom(sidebarCollapsedAtomFamily(workspaceId));
  const pushToast = useSetAtom(pushToastAtom);
  const store = useStore();
  const selectWorkspaceTarget = useSelectWorkspaceTarget();
  const { openWorkspaceFile } = useOpenWorkspaceFile(workspaceId);

  const registry = useMemo(() => {
    const nextRegistry = createUiActionRegistry();

    nextRegistry.register("editor.openFile", async (event) => {
      if (event.intent.type !== "editor.openFile") {
        return;
      }

      await openWorkspaceFile({
        workspaceId: event.intent.workspaceId ?? event.workspaceId,
        path: event.intent.path,
        line: event.intent.line,
        column: event.intent.column,
        source: "manual",
      });
    });

    nextRegistry.register("editor.closeFile", (event) => {
      if (event.intent.type !== "editor.closeFile") {
        return;
      }

      const targetPath = event.intent.path;
      const currentOpenPaths = store.get(openEditorPathsAtomFamily(workspaceId));
      const currentTabs = store.get(openEditorTabsAtomFamily(workspaceId));
      const currentActivePath = store.get(activeFilePathAtomFamily(workspaceId));
      const currentActiveTab = store.get(activeEditorTabAtomFamily(workspaceId));
      const isOpen =
        currentOpenPaths.includes(targetPath) ||
        currentTabs.some((tab) => tab.kind === "file" && tab.path === targetPath) ||
        currentActivePath === targetPath ||
        (currentActiveTab?.kind === "file" && currentActiveTab.path === targetPath);

      if (!isOpen) {
        return;
      }

      const nextOpenPaths = currentOpenPaths.filter((path) => path !== targetPath);
      const nextTabs = currentTabs.filter((tab) => tab.kind !== "file" || tab.path !== targetPath);
      const remainingFilePaths = [
        ...nextOpenPaths,
        ...nextTabs
          .filter(
            (tab): tab is Extract<WorkspaceEditorTab, { kind: "file" }> => tab.kind === "file"
          )
          .map((tab) => tab.path),
        ...(currentActivePath && currentActivePath !== targetPath ? [currentActivePath] : []),
      ].filter((path, index, paths) => paths.indexOf(path) === index);
      const browserTab = nextTabs.find((tab) => tab.kind === "browser") ?? null;
      const nextActiveFilePath =
        currentActivePath === targetPath ? (remainingFilePaths[0] ?? null) : currentActivePath;
      const shouldReplaceActiveTab =
        currentActiveTab?.kind === "file" && currentActiveTab.path === targetPath;
      const nextActiveTab: WorkspaceEditorTab | null = shouldReplaceActiveTab
        ? remainingFilePaths[0]
          ? { kind: "file", path: remainingFilePaths[0] }
          : browserTab
        : currentActiveTab;

      setOpenEditorPaths(nextOpenPaths);
      setOpenEditorTabs(nextTabs);
      setActiveFilePath(nextActiveFilePath);
      setActiveEditorTab(nextActiveTab);
      setEditorViewVisible(remainingFilePaths.length > 0 || browserTab !== null);
    });

    nextRegistry.register("browser.openUrl", (event) => {
      if (event.intent.type !== "browser.openUrl") {
        return;
      }

      const nextBrowserTab = createWorkspaceBrowserEditorTab(event.intent.url);
      setPendingDevBrowserUrl(event.intent.url);
      setEditorViewVisible(true);
      setOpenEditorTabs((current) => [...current, nextBrowserTab]);
      setActiveEditorTab(nextBrowserTab);
    });

    nextRegistry.register("browser.closeUrl", (event) => {
      if (event.intent.type !== "browser.closeUrl") {
        return;
      }

      const targetUrl = event.intent.url;
      const currentUrl = store.get(currentDevBrowserUrlAtomFamily(workspaceId));
      if (currentUrl !== targetUrl) {
        return;
      }

      const currentTabs = store.get(openEditorTabsAtomFamily(workspaceId));
      const currentActiveTab = store.get(activeEditorTabAtomFamily(workspaceId));
      if (currentActiveTab?.kind !== "browser") {
        return;
      }

      const currentOpenPaths = store.get(openEditorPathsAtomFamily(workspaceId));
      const currentActivePath = store.get(activeFilePathAtomFamily(workspaceId));
      const closedBrowserIndex = currentTabs
        .filter((tab): tab is Extract<WorkspaceEditorTab, { kind: "browser" }> => {
          return tab.kind === "browser";
        })
        .findIndex((tab) => tab.id === currentActiveTab.id);
      const nextTabs = currentTabs.filter(
        (tab) => tab.kind !== "browser" || tab.id !== currentActiveTab.id
      );
      if (nextTabs.length === currentTabs.length) {
        return;
      }

      const nextBrowserTabs = nextTabs.filter(
        (tab): tab is Extract<WorkspaceEditorTab, { kind: "browser" }> => tab.kind === "browser"
      );
      const fallbackFilePath = currentActivePath ?? currentOpenPaths[0] ?? null;
      const nextActiveTab =
        nextBrowserTabs[closedBrowserIndex] ??
        nextBrowserTabs[closedBrowserIndex - 1] ??
        (fallbackFilePath ? ({ kind: "file", path: fallbackFilePath } as const) : null);

      setPendingDevBrowserUrl((current) => (current === targetUrl ? null : current));
      setCurrentDevBrowserUrl(null);
      setOpenEditorTabs(nextTabs);
      setActiveEditorTab(nextActiveTab);
      setActiveFilePath(nextActiveTab?.kind === "file" ? nextActiveTab.path : fallbackFilePath);
      setEditorViewVisible(
        nextTabs.length > 0 || currentOpenPaths.length > 0 || fallbackFilePath !== null
      );
    });

    nextRegistry.register("workspace.focus", async (event) => {
      if (event.intent.type !== "workspace.focus") {
        return;
      }

      await selectWorkspaceTarget(event.intent.workspaceId);
    });

    nextRegistry.register("panel.show", (event) => {
      if (event.intent.type !== "panel.show") {
        return;
      }

      if (event.intent.panel === "terminal") {
        setTerminalVisible(true);
        return;
      }

      const panelMap = {
        explorer: "explorer",
        search: "search",
        git: "source-control",
        skills: "skills",
        agentInstructions: "agent-instructions",
      } as const;
      setDesktopSidebarView(panelMap[event.intent.panel]);
      setSidebarCollapsed(false);
    });

    nextRegistry.register("command.run", (event) => {
      if (event.intent.type !== "command.run") {
        return;
      }

      if (!isAllowedFrontendUiCommand(event.intent.commandId)) {
        throw new Error(`Frontend UI command is not allowed: ${event.intent.commandId}`);
      }

      if (event.intent.commandId === "quickOpen.open") {
        setQuickOpenOpen(true);
      } else if (event.intent.commandId === "commandPalette.open") {
        setCommandPaletteOpen(true);
      }
    });

    return nextRegistry;
  }, [
    openWorkspaceFile,
    selectWorkspaceTarget,
    setActiveEditorTab,
    setActiveFilePath,
    setCommandPaletteOpen,
    setCurrentDevBrowserUrl,
    setDesktopSidebarView,
    setEditorViewVisible,
    setOpenEditorPaths,
    setOpenEditorTabs,
    setPendingDevBrowserUrl,
    setQuickOpenOpen,
    setSidebarCollapsed,
    setTerminalVisible,
    store,
    workspaceId,
  ]);

  useEffect(() => {
    if (!wsClient || typeof wsClient.subscribe !== "function") {
      return;
    }

    return wsClient.subscribe([Topics.workspaceUiAction(workspaceId)], (_topic, payload) => {
      if (!isUiActionEvent(payload)) {
        pushToast({
          kind: "error",
          title: "UI action failed",
          body: "Received an invalid UI action event.",
        });
        return;
      }

      if (payload.workspaceId !== workspaceId) {
        pushToast({
          kind: "error",
          title: "UI action failed",
          body: "Received a UI action event for a different workspace.",
        });
        return;
      }

      void registry.execute(payload).catch((error) => {
        pushToast({
          kind: "error",
          title: "UI action failed",
          body: error instanceof Error ? error.message : "Unable to execute UI action.",
        });
      });
    });
  }, [pushToast, registry, workspaceId, wsClient]);
}
