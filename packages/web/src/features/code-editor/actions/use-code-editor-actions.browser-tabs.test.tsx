import { act, renderHook, waitFor } from "@testing-library/react";
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

describe("useCodeEditorActions non-file tabs", () => {
  const canvasTab = {
    kind: "canvas" as const,
    id: "canvas:canvas-1",
    canvasId: "canvas-1",
    title: "Runtime Flow",
    artifactType: "architecture_canvas" as const,
    sourcePath: ".coder-studio/canvases/canvas-1.canvas.json",
  };

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

  it("pins an active preview file tab when the user edits it", async () => {
    const { store } = setupStore();
    store.set(openEditorTabsAtomFamily("ws-1"), [
      { kind: "file", path: "src/app.ts", pinned: false },
    ]);
    store.set(activeEditorTabAtomFamily("ws-1"), {
      kind: "file",
      path: "src/app.ts",
      pinned: false,
    });

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: createWrapper(store),
    });

    await act(async () => {
      result.current.handleContentChange("export const app = 2;\n");
    });

    expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([
      { kind: "file", path: "src/app.ts", pinned: true },
    ]);
    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual({
      kind: "file",
      path: "src/app.ts",
      pinned: true,
    });
    expect(store.get(openEditorPathsAtomFamily("ws-1"))).toEqual(["src/app.ts"]);
  });

  it("returns preview file tab metadata to the editor header", () => {
    const { store } = setupStore();
    store.set(openEditorPathsAtomFamily("ws-1"), []);
    store.set(openEditorTabsAtomFamily("ws-1"), [
      { kind: "file", path: "src/app.ts", pinned: false },
    ]);
    store.set(activeEditorTabAtomFamily("ws-1"), {
      kind: "file",
      path: "src/app.ts",
      pinned: false,
    });

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: createWrapper(store),
    });

    expect(result.current.openEditorTabs).toEqual([
      { kind: "file", path: "src/app.ts", pinned: false },
    ]);
  });

  it("syncs the active file tab from open preview tab metadata", async () => {
    const { store } = setupStore();
    store.set(openEditorPathsAtomFamily("ws-1"), []);
    store.set(openEditorTabsAtomFamily("ws-1"), [
      { kind: "file", path: "src/app.ts", pinned: false },
    ]);
    store.set(activeEditorTabAtomFamily("ws-1"), {
      kind: "file",
      path: "src/app.ts",
      pinned: true,
    });

    renderHook(() => useCodeEditorActions(), {
      wrapper: createWrapper(store),
    });

    await waitFor(() => {
      expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual({
        kind: "file",
        path: "src/app.ts",
        pinned: false,
      });
    });
  });

  it("does not pin an active file tab when it is not in persistent open editor paths", async () => {
    const { store } = setupStore();
    store.set(openEditorPathsAtomFamily("ws-1"), []);
    store.set(openEditorTabsAtomFamily("ws-1"), []);
    store.set(activeEditorTabAtomFamily("ws-1"), null);

    renderHook(() => useCodeEditorActions(), {
      wrapper: createWrapper(store),
    });

    await waitFor(() => {
      expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual({
        kind: "file",
        path: "src/app.ts",
        pinned: false,
      });
    });
  });

  it("returns an active preview fallback tab as unpinned when it is not persisted open", () => {
    const { store } = setupStore();
    store.set(openEditorPathsAtomFamily("ws-1"), []);
    store.set(openEditorTabsAtomFamily("ws-1"), []);
    store.set(activeEditorTabAtomFamily("ws-1"), {
      kind: "file",
      path: "src/app.ts",
      pinned: false,
    });

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: createWrapper(store),
    });

    expect(result.current.openEditorTabs).toEqual([
      { kind: "file", path: "src/app.ts", pinned: false },
    ]);
  });

  it("keeps a preview file tab open when requested from the tab menu", async () => {
    const { store } = setupStore();
    store.set(openEditorTabsAtomFamily("ws-1"), [
      { kind: "file", path: "src/app.ts", pinned: false },
    ]);
    store.set(activeEditorTabAtomFamily("ws-1"), {
      kind: "file",
      path: "src/app.ts",
      pinned: false,
    });

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: createWrapper(store),
    });

    await act(async () => {
      result.current.keepOpenEditorTab({ kind: "file", path: "src/app.ts", pinned: false });
    });

    expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([
      { kind: "file", path: "src/app.ts", pinned: true },
    ]);
    expect(store.get(openEditorPathsAtomFamily("ws-1"))).toEqual(["src/app.ts"]);
  });

  it("closes saved file tabs while keeping dirty file tabs", async () => {
    const { store } = setupStore();
    store.set(activeFilePathAtomFamily("ws-1"), "src/dirty.ts");
    store.set(openEditorTabsAtomFamily("ws-1"), [
      { kind: "file", path: "src/app.ts", pinned: true },
      { kind: "file", path: "src/dirty.ts", pinned: true },
    ]);
    store.set(openEditorPathsAtomFamily("ws-1"), ["src/app.ts", "src/dirty.ts"]);
    store.set(openFilesAtomFamily("ws-1"), {
      "src/app.ts": {
        kind: "text",
        path: "src/app.ts",
        content: "a",
        savedContent: "a",
        baseHash: "hash-app",
        isDirty: false,
      },
      "src/dirty.ts": {
        kind: "text",
        path: "src/dirty.ts",
        content: "changed",
        savedContent: "saved",
        baseHash: "hash-dirty",
        isDirty: true,
      },
    });

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: createWrapper(store),
    });

    await act(async () => {
      result.current.closeSavedEditorTabs();
    });

    expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([
      { kind: "file", path: "src/dirty.ts", pinned: true },
    ]);
    expect(store.get(openEditorPathsAtomFamily("ws-1"))).toEqual(["src/dirty.ts"]);
    expect(store.get(openFilesAtomFamily("ws-1"))).toHaveProperty("src/dirty.ts");
    expect(store.get(openFilesAtomFamily("ws-1"))).not.toHaveProperty("src/app.ts");
  });

  it("keeps dirty file tabs when closing all editor tabs", async () => {
    const { store } = setupStore();
    const browser = {
      kind: "browser" as const,
      id: "browser-1",
      url: null,
      devicePreset: "desktop" as const,
      viewportWidth: null,
      viewportHeight: null,
      orientation: "portrait" as const,
      userAgentMode: "desktop" as const,
    };
    store.set(activeFilePathAtomFamily("ws-1"), "src/dirty.ts");
    store.set(activeEditorTabAtomFamily("ws-1"), {
      kind: "file",
      path: "src/dirty.ts",
      pinned: true,
    });
    store.set(openEditorTabsAtomFamily("ws-1"), [
      { kind: "file", path: "src/app.ts", pinned: true },
      { kind: "file", path: "src/dirty.ts", pinned: true },
      browser,
    ]);
    store.set(openEditorPathsAtomFamily("ws-1"), ["src/app.ts", "src/dirty.ts"]);
    store.set(openFilesAtomFamily("ws-1"), {
      "src/app.ts": {
        kind: "text",
        path: "src/app.ts",
        content: "app",
        savedContent: "app",
        baseHash: "hash-app",
        isDirty: false,
      },
      "src/dirty.ts": {
        kind: "text",
        path: "src/dirty.ts",
        content: "changed",
        savedContent: "saved",
        baseHash: "hash-dirty",
        isDirty: true,
      },
    });

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: createWrapper(store),
    });

    await act(async () => {
      result.current.closeAllEditorTabs();
    });

    expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([
      { kind: "file", path: "src/dirty.ts", pinned: true },
    ]);
    expect(store.get(openEditorPathsAtomFamily("ws-1"))).toEqual(["src/dirty.ts"]);
    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual({
      kind: "file",
      path: "src/dirty.ts",
      pinned: true,
    });
    expect(store.get(openFilesAtomFamily("ws-1"))).toEqual({
      "src/dirty.ts": {
        kind: "text",
        path: "src/dirty.ts",
        content: "changed",
        savedContent: "saved",
        baseHash: "hash-dirty",
        isDirty: true,
      },
    });
  });

  it("closes editor tabs to the right of the target tab", async () => {
    const { store } = setupStore();
    const browser = {
      kind: "browser" as const,
      id: "browser-right",
      url: null,
      devicePreset: "desktop" as const,
      viewportWidth: null,
      viewportHeight: null,
      orientation: "portrait" as const,
      userAgentMode: "desktop" as const,
    };
    store.set(openEditorTabsAtomFamily("ws-1"), [
      { kind: "file", path: "src/app.ts", pinned: true },
      { kind: "file", path: "src/right.ts", pinned: true },
      browser,
    ]);
    store.set(openEditorPathsAtomFamily("ws-1"), ["src/app.ts", "src/right.ts"]);
    store.set(openFilesAtomFamily("ws-1"), {
      "src/app.ts": {
        kind: "text",
        path: "src/app.ts",
        content: "app",
        savedContent: "app",
        baseHash: "hash-app",
        isDirty: false,
      },
      "src/right.ts": {
        kind: "text",
        path: "src/right.ts",
        content: "right",
        savedContent: "right",
        baseHash: "hash-right",
        isDirty: false,
      },
    });

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: createWrapper(store),
    });

    await act(async () => {
      result.current.closeEditorTabsToRight({ kind: "file", path: "src/app.ts", pinned: true });
    });

    expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([
      { kind: "file", path: "src/app.ts", pinned: true },
    ]);
    expect(store.get(openEditorPathsAtomFamily("ws-1"))).toEqual(["src/app.ts"]);
  });

  it("keeps dirty file tabs when closing editor tabs to the right", async () => {
    const { store } = setupStore();
    const browser = {
      kind: "browser" as const,
      id: "browser-right",
      url: null,
      devicePreset: "desktop" as const,
      viewportWidth: null,
      viewportHeight: null,
      orientation: "portrait" as const,
      userAgentMode: "desktop" as const,
    };
    store.set(activeFilePathAtomFamily("ws-1"), "src/app.ts");
    store.set(openEditorTabsAtomFamily("ws-1"), [
      { kind: "file", path: "src/app.ts", pinned: true },
      { kind: "file", path: "src/dirty.ts", pinned: true },
      { kind: "file", path: "src/right.ts", pinned: true },
      browser,
    ]);
    store.set(openEditorPathsAtomFamily("ws-1"), ["src/app.ts", "src/dirty.ts", "src/right.ts"]);
    store.set(openFilesAtomFamily("ws-1"), {
      "src/app.ts": {
        kind: "text",
        path: "src/app.ts",
        content: "app",
        savedContent: "app",
        baseHash: "hash-app",
        isDirty: false,
      },
      "src/dirty.ts": {
        kind: "text",
        path: "src/dirty.ts",
        content: "changed",
        savedContent: "saved",
        baseHash: "hash-dirty",
        isDirty: true,
      },
      "src/right.ts": {
        kind: "text",
        path: "src/right.ts",
        content: "right",
        savedContent: "right",
        baseHash: "hash-right",
        isDirty: false,
      },
    });

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: createWrapper(store),
    });

    await act(async () => {
      result.current.closeEditorTabsToRight({ kind: "file", path: "src/app.ts", pinned: true });
    });

    expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([
      { kind: "file", path: "src/app.ts", pinned: true },
      { kind: "file", path: "src/dirty.ts", pinned: true },
    ]);
    expect(store.get(openEditorPathsAtomFamily("ws-1"))).toEqual(["src/app.ts", "src/dirty.ts"]);
    expect(store.get(openFilesAtomFamily("ws-1"))).toHaveProperty("src/dirty.ts");
    expect(store.get(openFilesAtomFamily("ws-1"))).not.toHaveProperty("src/right.ts");
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

  it("returns canvas tabs and allows activating and closing them like other non-file tabs", async () => {
    const { store } = setupStore();
    const browser = {
      kind: "browser" as const,
      id: "browser-1",
      url: "localhost:8001",
      devicePreset: "desktop" as const,
      viewportWidth: null,
      viewportHeight: null,
      orientation: "portrait" as const,
      userAgentMode: "desktop" as const,
    };

    store.set(openEditorTabsAtomFamily("ws-1"), [canvasTab, browser]);
    store.set(activeEditorTabAtomFamily("ws-1"), browser);
    store.set(editorViewVisibleAtomFamily("ws-1"), true);

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: createWrapper(store),
    });

    expect(result.current.openEditorTabs).toEqual([
      { kind: "file", path: "src/app.ts", pinned: true },
      canvasTab,
      browser,
    ]);

    await act(async () => {
      result.current.activateEditorTab(canvasTab);
    });

    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual(canvasTab);

    await act(async () => {
      result.current.closeEditorTab(canvasTab);
    });

    expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([browser]);
    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual(browser);
  });

  it("closes only the matching source-path-first canvas tab when canvasId is absent", async () => {
    const { store } = setupStore();
    const firstCanvas = {
      kind: "canvas" as const,
      id: "canvas:.coder-studio/canvases/auth-gate.csc",
      title: "auth-gate",
      sourcePath: ".coder-studio/canvases/auth-gate.csc",
    };
    const secondCanvas = {
      kind: "canvas" as const,
      id: "canvas:.coder-studio/canvases/billing.csc",
      title: "billing",
      sourcePath: ".coder-studio/canvases/billing.csc",
    };

    store.set(openEditorTabsAtomFamily("ws-1"), [firstCanvas, secondCanvas]);
    store.set(activeEditorTabAtomFamily("ws-1"), secondCanvas);
    store.set(editorViewVisibleAtomFamily("ws-1"), true);

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: createWrapper(store),
    });

    await act(async () => {
      result.current.closeEditorTab(firstCanvas);
    });

    expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([secondCanvas]);
    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual(secondCanvas);
  });

  it("switches a .csc source file into a canvas tab when preview mode is requested", async () => {
    const { store } = setupStore();
    store.set(activeFilePathAtomFamily("ws-1"), ".coder-studio/canvases/auth-gate.csc");
    store.set(openEditorPathsAtomFamily("ws-1"), [".coder-studio/canvases/auth-gate.csc"]);
    store.set(openFilesAtomFamily("ws-1"), {
      ".coder-studio/canvases/auth-gate.csc": {
        kind: "text",
        path: ".coder-studio/canvases/auth-gate.csc",
        content: '{"kind":"architecture_canvas"}',
        savedContent: '{"kind":"architecture_canvas"}',
        baseHash: "hash-canvas",
        isDirty: false,
      },
    });

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: createWrapper(store),
    });

    await act(async () => {
      result.current.setMode("preview");
    });

    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual({
      kind: "canvas",
      id: "canvas:.coder-studio/canvases/auth-gate.csc",
      title: "auth-gate",
      sourcePath: ".coder-studio/canvases/auth-gate.csc",
      artifactType: "architecture_canvas",
      canvasId: ".coder-studio/canvases/auth-gate.csc",
    });
    expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([
      {
        kind: "canvas",
        id: "canvas:.coder-studio/canvases/auth-gate.csc",
        title: "auth-gate",
        sourcePath: ".coder-studio/canvases/auth-gate.csc",
        artifactType: "architecture_canvas",
        canvasId: ".coder-studio/canvases/auth-gate.csc",
      },
    ]);
    expect(result.current.mode).toBe("preview");
  });

  it("refreshes legacy .csc canvas tab metadata when preview mode is requested again", async () => {
    const { store } = setupStore();
    store.set(activeFilePathAtomFamily("ws-1"), ".coder-studio/canvases/auth-gate.csc");
    store.set(openEditorPathsAtomFamily("ws-1"), [".coder-studio/canvases/auth-gate.csc"]);
    store.set(openFilesAtomFamily("ws-1"), {
      ".coder-studio/canvases/auth-gate.csc": {
        kind: "text",
        path: ".coder-studio/canvases/auth-gate.csc",
        content: '{"kind":"report_canvas"}',
        savedContent: '{"kind":"report_canvas"}',
        baseHash: "hash-canvas",
        isDirty: false,
      },
    });
    store.set(openEditorTabsAtomFamily("ws-1"), [
      {
        kind: "canvas",
        id: "canvas:.coder-studio/canvases/auth-gate.csc",
        title: "auth-gate",
        sourcePath: ".coder-studio/canvases/auth-gate.csc",
        artifactType: "architecture_canvas",
      },
    ]);

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: createWrapper(store),
    });

    await act(async () => {
      result.current.setMode("preview");
    });

    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toMatchObject({
      kind: "canvas",
      sourcePath: ".coder-studio/canvases/auth-gate.csc",
      artifactType: "report_canvas",
      canvasId: ".coder-studio/canvases/auth-gate.csc",
    });
    expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([
      expect.objectContaining({
        kind: "canvas",
        sourcePath: ".coder-studio/canvases/auth-gate.csc",
        artifactType: "report_canvas",
        canvasId: ".coder-studio/canvases/auth-gate.csc",
      }),
    ]);
  });

  it("switches an active canvas tab back to its source file when edit mode is requested", async () => {
    const { store } = setupStore();
    store.set(activeFilePathAtomFamily("ws-1"), null);
    store.set(openEditorPathsAtomFamily("ws-1"), []);
    store.set(openFilesAtomFamily("ws-1"), {
      ".coder-studio/canvases/auth-gate.csc": {
        kind: "text",
        path: ".coder-studio/canvases/auth-gate.csc",
        content: '{"kind":"architecture_canvas"}',
        savedContent: '{"kind":"architecture_canvas"}',
        baseHash: "hash-canvas",
        isDirty: false,
      },
    });
    store.set(openEditorTabsAtomFamily("ws-1"), [
      {
        kind: "canvas",
        id: "canvas:.coder-studio/canvases/auth-gate.csc",
        title: "auth-gate",
        sourcePath: ".coder-studio/canvases/auth-gate.csc",
      },
    ]);
    store.set(activeEditorTabAtomFamily("ws-1"), {
      kind: "canvas",
      id: "canvas:.coder-studio/canvases/auth-gate.csc",
      title: "auth-gate",
      sourcePath: ".coder-studio/canvases/auth-gate.csc",
    });
    store.set(editorViewVisibleAtomFamily("ws-1"), true);

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: createWrapper(store),
    });

    await act(async () => {
      result.current.setMode("edit");
    });

    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe(
      ".coder-studio/canvases/auth-gate.csc"
    );
    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual({
      kind: "file",
      path: ".coder-studio/canvases/auth-gate.csc",
      pinned: true,
    });
    expect(result.current.mode).toBe("edit");
  });

  it("hideEditorView persists a hidden global editor when the active tab is a browser tab", async () => {
    const { store, sendCommand } = setupStore();
    store.set(activeFilePathAtomFamily("ws-1"), null);
    store.set(openEditorTabsAtomFamily("ws-1"), [
      { kind: "browser", id: "browser-1", url: "localhost:8001" },
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
      await result.current.hideEditorView();
    });

    expect(store.get(editorViewVisibleAtomFamily("ws-1"))).toBe(false);
    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledTimes(1);
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "workspace.uiState.set",
      expect.objectContaining({
        workspaceId: "ws-1",
        uiState: expect.objectContaining({
          editorViewVisible: false,
          activeEditorPath: null,
          openEditorTabs: [{ kind: "browser", id: "browser-1", url: "localhost:8001" }],
          activeEditorTab: { kind: "browser", id: "browser-1", url: "localhost:8001" },
        }),
      }),
      undefined
    );
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
      pinned: true,
    });
    expect(result.current.openEditorTabs).toEqual([
      { kind: "file", path: "src/app.ts", pinned: true },
    ]);
  });

  it("switches a pane-local .csc file between source edit and canvas preview", async () => {
    const { store } = setupStore();
    const paneStateKey = getEditorPaneStateKey("ws-1", "pane-1");

    store.set(
      editorPaneActiveFilePathAtomFamily(paneStateKey),
      ".coder-studio/canvases/auth-gate.csc"
    );
    store.set(editorPaneOpenEditorPathsAtomFamily(paneStateKey), [
      ".coder-studio/canvases/auth-gate.csc",
    ]);
    store.set(openFilesAtomFamily("ws-1"), {
      ".coder-studio/canvases/auth-gate.csc": {
        kind: "text",
        path: ".coder-studio/canvases/auth-gate.csc",
        content: '{"kind":"architecture_canvas"}',
        savedContent: '{"kind":"architecture_canvas"}',
        baseHash: "hash-canvas",
        isDirty: false,
      },
    });

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

    await act(async () => {
      result.current.setMode("preview");
    });

    expect(result.current.activeEditorTab).toEqual({
      kind: "canvas",
      id: "canvas:.coder-studio/canvases/auth-gate.csc",
      title: "auth-gate",
      sourcePath: ".coder-studio/canvases/auth-gate.csc",
      artifactType: "architecture_canvas",
      canvasId: ".coder-studio/canvases/auth-gate.csc",
    });
    expect(result.current.openEditorTabs).toEqual([
      { kind: "file", path: ".coder-studio/canvases/auth-gate.csc", pinned: true },
      {
        kind: "canvas",
        id: "canvas:.coder-studio/canvases/auth-gate.csc",
        title: "auth-gate",
        sourcePath: ".coder-studio/canvases/auth-gate.csc",
        artifactType: "architecture_canvas",
        canvasId: ".coder-studio/canvases/auth-gate.csc",
      },
    ]);
    expect(result.current.mode).toBe("preview");

    await act(async () => {
      result.current.setMode("edit");
    });

    expect(result.current.activeEditorTab).toEqual({
      kind: "file",
      path: ".coder-studio/canvases/auth-gate.csc",
      pinned: true,
    });
    expect(result.current.mode).toBe("edit");
  });
});
