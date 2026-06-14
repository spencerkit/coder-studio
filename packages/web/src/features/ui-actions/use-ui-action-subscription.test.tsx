// @vitest-environment jsdom

import { Topics, type UiActionEvent } from "@coder-studio/core";
import { act, render, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { commandPaletteOpenAtom, quickOpenOpenAtom } from "../../atoms/app-ui";
import { wsClientAtom } from "../../atoms/connection";
import { workspacesAtom } from "../../atoms/workspaces";
import { pendingEditorNavigationAtomFamily } from "../code-editor/atoms";
import {
  currentDevBrowserUrlAtomFamily,
  pendingDevBrowserUrlAtomFamily,
} from "../dev-browser/atoms";
import { toastsAtom } from "../notifications/atoms";
import {
  activeEditorTabAtomFamily,
  activeFilePathAtomFamily,
  openEditorPathsAtomFamily,
  type WorkspaceBrowserEditorTab,
} from "../workspace/atoms";
import { editorViewVisibleAtomFamily, openEditorTabsAtomFamily } from "../workspace/atoms/files";
import {
  desktopSidebarViewAtomFamily,
  sidebarCollapsedAtomFamily,
  terminalPanelVisibleAtomFamily,
} from "../workspace/atoms/layout";
import { useUiActionSubscription } from "./use-ui-action-subscription";

function Harness({ workspaceId }: { workspaceId: string }) {
  useUiActionSubscription(workspaceId);
  return null;
}

function createWorkspace(id: string) {
  return {
    id,
    name: "repo",
    path: "/repo",
    targetRuntime: "native",
    openedAt: 1,
    lastActiveAt: 1,
    uiState: {
      leftPanelWidth: 280,
      bottomPanelHeight: 200,
      focusMode: false,
    },
  };
}

function setupHarness() {
  let handler: ((topic: string, payload: unknown, seq: number) => void) | null = null;
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((_topics: string[], nextHandler: typeof handler) => {
    handler = nextHandler;
    return unsubscribe;
  });
  const store = createStore();
  store.set(workspacesAtom, { "ws-1": createWorkspace("ws-1") } as never);
  store.set(wsClientAtom, { subscribe } as never);

  const view = render(
    <Provider store={store}>
      <Harness workspaceId="ws-1" />
    </Provider>
  );

  const emit = async (payload: unknown) => {
    await act(async () => {
      handler?.(Topics.workspaceUiAction("ws-1"), payload, 1);
    });
  };

  return { emit, store, subscribe, unsubscribe, ...view };
}

function createEvent(intent: UiActionEvent["intent"]): UiActionEvent {
  return {
    requestId: "req-1",
    workspaceId: "ws-1",
    intent,
    dispatchedAt: 1,
  };
}

function browserTab(id: string, url: string | null): WorkspaceBrowserEditorTab {
  return { kind: "browser", id, url };
}

describe("useUiActionSubscription", () => {
  it("subscribes to the workspace UI action topic and unsubscribes on unmount", () => {
    const { subscribe, unsubscribe, unmount } = setupHarness();

    expect(subscribe).toHaveBeenCalledWith(
      [Topics.workspaceUiAction("ws-1")],
      expect.any(Function)
    );

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("shows terminal and sidebar panels from panel.show events", async () => {
    const { emit, store } = setupHarness();
    store.set(terminalPanelVisibleAtomFamily("ws-1"), false);
    store.set(sidebarCollapsedAtomFamily("ws-1"), true);

    await emit(createEvent({ type: "panel.show", panel: "terminal" }));

    expect(store.get(terminalPanelVisibleAtomFamily("ws-1"))).toBe(true);

    await emit(createEvent({ type: "panel.show", panel: "git" }));

    expect(store.get(desktopSidebarViewAtomFamily("ws-1"))).toBe("source-control");
    expect(store.get(sidebarCollapsedAtomFamily("ws-1"))).toBe(false);
  });

  it("opens allowlisted frontend commands", async () => {
    const { emit, store } = setupHarness();

    await emit(createEvent({ type: "command.run", commandId: "quickOpen.open" }));
    expect(store.get(quickOpenOpenAtom)).toBe(true);

    await emit(createEvent({ type: "command.run", commandId: "commandPalette.open" }));
    expect(store.get(commandPaletteOpenAtom)).toBe(true);
  });

  it("opens files in the workspace editor from editor.openFile events", async () => {
    const { emit, store } = setupHarness();

    await emit(
      createEvent({
        type: "editor.openFile",
        workspaceId: "ws-1",
        path: "src/index.ts",
        line: 12,
        column: 3,
      })
    );

    await waitFor(() => {
      expect(store.get(pendingEditorNavigationAtomFamily("ws-1"))).toMatchObject({
        workspaceId: "ws-1",
        path: "src/index.ts",
        line: 12,
        column: 3,
        source: "manual",
      });
    });
  });

  it("opens localhost URLs in the built-in dev browser", async () => {
    const { emit, store } = setupHarness();

    await emit(
      createEvent({
        type: "browser.openUrl",
        workspaceId: "ws-1",
        url: "http://127.0.0.1:5173/",
      })
    );

    expect(store.get(pendingDevBrowserUrlAtomFamily("ws-1"))).toBe("http://127.0.0.1:5173/");
    expect(store.get(editorViewVisibleAtomFamily("ws-1"))).toBe(true);
    const openEditorTabs = store.get(openEditorTabsAtomFamily("ws-1"));
    expect(openEditorTabs).toEqual([
      expect.objectContaining({
        kind: "browser",
        url: "http://127.0.0.1:5173/",
      }),
    ]);
    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual(openEditorTabs[0]);
  });

  it("closes a matching file tab from editor.closeFile events", async () => {
    const { emit, store } = setupHarness();
    store.set(editorViewVisibleAtomFamily("ws-1"), true);
    store.set(openEditorPathsAtomFamily("ws-1"), ["src/index.ts", "src/other.ts"]);
    store.set(openEditorTabsAtomFamily("ws-1"), [
      { kind: "file", path: "src/index.ts" },
      { kind: "file", path: "src/other.ts" },
      browserTab("browser-1", "http://127.0.0.1:5173/"),
    ]);
    store.set(activeFilePathAtomFamily("ws-1"), "src/index.ts");
    store.set(activeEditorTabAtomFamily("ws-1"), { kind: "file", path: "src/index.ts" });

    await emit(createEvent({ type: "editor.closeFile", path: "src/index.ts" }));

    expect(store.get(openEditorPathsAtomFamily("ws-1"))).toEqual(["src/other.ts"]);
    expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([
      { kind: "file", path: "src/other.ts" },
      browserTab("browser-1", "http://127.0.0.1:5173/"),
    ]);
    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/other.ts");
    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual({
      kind: "file",
      path: "src/other.ts",
    });
    expect(store.get(editorViewVisibleAtomFamily("ws-1"))).toBe(true);
  });

  it("does not close file tabs when editor.closeFile path is not open", async () => {
    const { emit, store } = setupHarness();
    store.set(editorViewVisibleAtomFamily("ws-1"), true);
    store.set(openEditorPathsAtomFamily("ws-1"), ["src/index.ts"]);
    store.set(openEditorTabsAtomFamily("ws-1"), [{ kind: "file", path: "src/index.ts" }]);
    store.set(activeFilePathAtomFamily("ws-1"), "src/index.ts");
    store.set(activeEditorTabAtomFamily("ws-1"), { kind: "file", path: "src/index.ts" });

    await emit(createEvent({ type: "editor.closeFile", path: "src/missing.ts" }));

    expect(store.get(openEditorPathsAtomFamily("ws-1"))).toEqual(["src/index.ts"]);
    expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([
      { kind: "file", path: "src/index.ts" },
    ]);
    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/index.ts");
    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual({
      kind: "file",
      path: "src/index.ts",
    });
    expect(store.get(editorViewVisibleAtomFamily("ws-1"))).toBe(true);
  });

  it("hides the editor when editor.closeFile closes the final tab", async () => {
    const { emit, store } = setupHarness();
    store.set(editorViewVisibleAtomFamily("ws-1"), true);
    store.set(openEditorPathsAtomFamily("ws-1"), ["src/index.ts"]);
    store.set(openEditorTabsAtomFamily("ws-1"), [{ kind: "file", path: "src/index.ts" }]);
    store.set(activeFilePathAtomFamily("ws-1"), "src/index.ts");
    store.set(activeEditorTabAtomFamily("ws-1"), { kind: "file", path: "src/index.ts" });

    await emit(createEvent({ type: "editor.closeFile", path: "src/index.ts" }));

    expect(store.get(openEditorPathsAtomFamily("ws-1"))).toEqual([]);
    expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([]);
    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toBeNull();
    expect(store.get(editorViewVisibleAtomFamily("ws-1"))).toBe(false);
  });

  it("closes the browser tab only when browser.closeUrl matches the current URL", async () => {
    const { emit, store } = setupHarness();
    const activeBrowserTab = browserTab("browser-1", "http://127.0.0.1:5173/");
    store.set(editorViewVisibleAtomFamily("ws-1"), true);
    store.set(openEditorPathsAtomFamily("ws-1"), ["src/index.ts"]);
    store.set(openEditorTabsAtomFamily("ws-1"), [activeBrowserTab]);
    store.set(activeFilePathAtomFamily("ws-1"), "src/index.ts");
    store.set(activeEditorTabAtomFamily("ws-1"), activeBrowserTab);
    store.set(currentDevBrowserUrlAtomFamily("ws-1"), "http://127.0.0.1:5173/");

    await emit(createEvent({ type: "browser.closeUrl", url: "http://127.0.0.1:5173/" }));

    expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([]);
    expect(store.get(currentDevBrowserUrlAtomFamily("ws-1"))).toBeNull();
    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual({
      kind: "file",
      path: "src/index.ts",
    });
    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/index.ts");
    expect(store.get(editorViewVisibleAtomFamily("ws-1"))).toBe(true);
  });

  it("does not close the browser tab when browser.closeUrl does not match", async () => {
    const { emit, store } = setupHarness();
    const activeBrowserTab = browserTab("browser-1", "http://127.0.0.1:5173/");
    store.set(editorViewVisibleAtomFamily("ws-1"), true);
    store.set(openEditorTabsAtomFamily("ws-1"), [activeBrowserTab]);
    store.set(activeEditorTabAtomFamily("ws-1"), activeBrowserTab);
    store.set(currentDevBrowserUrlAtomFamily("ws-1"), "http://127.0.0.1:5173/");

    await emit(createEvent({ type: "browser.closeUrl", url: "http://127.0.0.1:5174/" }));

    expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([activeBrowserTab]);
    expect(store.get(currentDevBrowserUrlAtomFamily("ws-1"))).toBe("http://127.0.0.1:5173/");
    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual(activeBrowserTab);
    expect(store.get(editorViewVisibleAtomFamily("ws-1"))).toBe(true);
  });

  it("pushes an error toast for invalid event payloads", async () => {
    const { emit, store } = setupHarness();

    await emit({ nope: true });

    expect(store.get(toastsAtom)).toEqual([
      expect.objectContaining({
        kind: "error",
        title: "UI action failed",
      }),
    ]);
  });

  it("rejects events whose payload workspace does not match the subscribed workspace", async () => {
    const { emit, store } = setupHarness();
    store.set(terminalPanelVisibleAtomFamily("ws-1"), false);

    await emit({
      ...createEvent({ type: "panel.show", panel: "terminal" }),
      workspaceId: "ws-2",
    });

    expect(store.get(terminalPanelVisibleAtomFamily("ws-1"))).toBe(false);
    expect(store.get(toastsAtom)).toEqual([
      expect.objectContaining({
        kind: "error",
        title: "UI action failed",
      }),
    ]);
  });
});
