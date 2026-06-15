import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { activeWorkspaceIdAtom } from "../../../atoms/workspaces";
import { seedReadyWorkspaceState } from "../../../test-utils/workspace-state";
import {
  editorPaneActiveFilePathAtomFamily,
  editorPaneModeAtomFamily,
  editorPaneOpenEditorPathsAtomFamily,
  editorPanePendingNavigationAtomFamily,
  getEditorPaneStateKey,
} from "../../agent-panes/atoms/editor-panes";
import {
  activeEditorTabAtomFamily,
  activeFilePathAtomFamily,
  editorViewVisibleAtomFamily,
  openEditorPathsAtomFamily,
  openEditorTabsAtomFamily,
  openFilesAtomFamily,
} from "../../workspace/atoms";
import { useCodeEditorActions } from "./use-code-editor-actions";

vi.mock("./use-preview-session", () => ({
  usePreviewSession: () => ({
    iframeSrc: null,
    allowScripts: false,
    isBootstrapping: false,
    isSyncing: false,
    error: null,
    retry: vi.fn(),
  }),
}));

function createWrapper(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  };
}

function setupStore() {
  const store = createStore();
  const sendCommand = vi.fn().mockResolvedValue({
    id: "ws-1",
    path: "/tmp/ws-1",
    targetRuntime: "native",
    openedAt: 1,
    lastActiveAt: 1,
    uiState: {
      leftPanelWidth: 280,
      bottomPanelHeight: 200,
      focusMode: false,
    },
  });

  store.set(wsClientAtom, { sendCommand } as never);
  seedReadyWorkspaceState(store, {
    "ws-1": {
      id: "ws-1",
      path: "/tmp/ws-1",
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 280,
        bottomPanelHeight: 200,
        focusMode: false,
      },
    },
  });
  store.set(activeWorkspaceIdAtom, "ws-1");
  store.set(localeAtom, "en");
  store.set(activeFilePathAtomFamily("ws-1"), "src/app.ts");
  store.set(openEditorPathsAtomFamily("ws-1"), ["src/app.ts"]);
  store.set(openFilesAtomFamily("ws-1"), {
    "src/app.ts": {
      kind: "text",
      path: "src/app.ts",
      content: "export const app = 1;\n",
      savedContent: "export const app = 1;\n",
      baseHash: "hash-app",
      isDirty: false,
    },
  });

  return { store, sendCommand };
}

describe("useCodeEditorActions browser tabs", () => {
  it("openBrowserTab uses the latest tab state across back-to-back calls before rerender", async () => {
    const { store } = setupStore();
    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: createWrapper(store),
    });

    await act(async () => {
      result.current.openBrowserTab();
      result.current.openBrowserTab();
    });

    const browserTabs = store.get(openEditorTabsAtomFamily("ws-1"));

    expect(browserTabs).toHaveLength(2);
    expect(browserTabs[0]).toMatchObject({ kind: "browser", url: null });
    expect(browserTabs[1]).toMatchObject({ kind: "browser", url: null });
    expect(browserTabs[0]?.kind).toBe("browser");
    expect(browserTabs[1]?.kind).toBe("browser");
    expect(
      browserTabs[0]?.kind === "browser" && browserTabs[1]?.kind === "browser"
        ? browserTabs[0].id
        : null
    ).not.toBe(browserTabs[1]?.kind === "browser" ? browserTabs[1].id : null);
    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual(browserTabs[1]);
  });

  it("openBrowserTab opens a new browser tab every time with unique ids and activates the latest tab", async () => {
    const { store } = setupStore();
    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: createWrapper(store),
    });

    await act(async () => {
      result.current.openBrowserTab();
    });

    const firstTabs = store.get(openEditorTabsAtomFamily("ws-1"));
    expect(firstTabs).toHaveLength(1);
    expect(firstTabs[0]).toMatchObject({ kind: "browser", url: null });
    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual(firstTabs[0]);
    expect(store.get(editorViewVisibleAtomFamily("ws-1"))).toBe(true);

    await act(async () => {
      result.current.openBrowserTab();
    });

    const secondTabs = store.get(openEditorTabsAtomFamily("ws-1"));
    expect(secondTabs).toHaveLength(2);
    expect(secondTabs[0]).toMatchObject({ kind: "browser", url: null });
    expect(secondTabs[1]).toMatchObject({ kind: "browser", url: null });
    expect(secondTabs[0]).not.toEqual(secondTabs[1]);
    expect(secondTabs[0]?.kind).toBe("browser");
    expect(secondTabs[1]?.kind).toBe("browser");
    expect(
      secondTabs[0]?.kind === "browser" && secondTabs[1]?.kind === "browser"
        ? secondTabs[0].id
        : null
    ).not.toBe(secondTabs[1]?.kind === "browser" ? secondTabs[1].id : null);
    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual(secondTabs[1]);
    expect(result.current.activeEditorTab).toEqual(secondTabs[1]);
  });

  it("activateEditorTab activates the exact browser tab instance by id and closeEditorTab removes only the matching browser tab id", async () => {
    const { store } = setupStore();
    store.set(openEditorTabsAtomFamily("ws-1"), [
      { kind: "browser", id: "browser-1", url: "localhost:8001" },
      { kind: "browser", id: "browser-2", url: "localhost:8001" },
      { kind: "browser", id: "browser-3", url: "localhost:8002" },
    ]);
    store.set(activeEditorTabAtomFamily("ws-1"), {
      kind: "browser",
      id: "browser-1",
      url: "localhost:8001",
    });
    store.set(editorViewVisibleAtomFamily("ws-1"), true);

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: createWrapper(store),
    });

    await act(async () => {
      result.current.activateEditorTab({ kind: "browser", id: "browser-2", url: "localhost:8001" });
    });

    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual({
      kind: "browser",
      id: "browser-2",
      url: "localhost:8001",
    });
    expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([
      { kind: "browser", id: "browser-1", url: "localhost:8001" },
      { kind: "browser", id: "browser-2", url: "localhost:8001" },
      { kind: "browser", id: "browser-3", url: "localhost:8002" },
    ]);

    await act(async () => {
      result.current.closeEditorTab({ kind: "browser", id: "browser-2", url: "localhost:8001" });
    });

    expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([
      { kind: "browser", id: "browser-1", url: "localhost:8001" },
      { kind: "browser", id: "browser-3", url: "localhost:8002" },
    ]);
    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual({
      kind: "browser",
      id: "browser-3",
      url: "localhost:8002",
    });
  });

  it("keeps editor pane state on the pane file even when the global editor is on a browser tab", () => {
    const { store } = setupStore();
    const paneStateKey = getEditorPaneStateKey("ws-1", "pane-1");

    store.set(activeEditorTabAtomFamily("ws-1"), {
      kind: "browser",
      id: "browser-1",
      url: "localhost:8001",
    });
    store.set(openEditorTabsAtomFamily("ws-1"), [
      { kind: "browser", id: "browser-1", url: "localhost:8001" },
    ]);
    store.set(editorPaneActiveFilePathAtomFamily(paneStateKey), "src/app.ts");
    store.set(editorPaneOpenEditorPathsAtomFamily(paneStateKey), ["src/app.ts"]);

    const { result } = renderHook(
      () =>
        useCodeEditorActions({
          activeFilePathAtom: editorPaneActiveFilePathAtomFamily(paneStateKey),
          editorModeAtom: editorPaneModeAtomFamily(paneStateKey),
          openEditorPathsAtom: editorPaneOpenEditorPathsAtomFamily(paneStateKey),
          pendingNavigationAtom: editorPanePendingNavigationAtomFamily(paneStateKey),
          persistEditorUiState: false,
        }),
      {
        wrapper: createWrapper(store),
      }
    );

    expect(result.current.activeEditorTab).toEqual({
      kind: "file",
      path: "src/app.ts",
    });
    expect(result.current.openEditorTabs).toEqual([{ kind: "file", path: "src/app.ts" }]);
  });
});
