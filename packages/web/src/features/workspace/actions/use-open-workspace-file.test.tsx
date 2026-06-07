// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../atoms/connection";
import { workspacesAtom } from "../../../atoms/workspaces";
import {
  activeEditorPaneIdAtomFamily,
  editorPaneActiveFilePathAtomFamily,
  editorPanePendingNavigationAtomFamily,
  focusedEditorPaneIdAtomFamily,
} from "../../agent-panes/atoms/editor-panes";
import { paneLayoutAtomFamily } from "../../agent-panes/atoms/pane-layout";
import { pendingEditorNavigationAtomFamily } from "../../code-editor/atoms";
import { activeFilePathAtomFamily, openEditorPathsAtomFamily } from "../atoms";
import { useOpenWorkspaceFile } from "./use-open-workspace-file";

function editorPaneStateKey(workspaceId: string, paneId: string): string {
  return `${workspaceId}::${paneId}`;
}

function wrapperFor(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

function seedWorkspace(store: ReturnType<typeof createStore>) {
  store.set(workspacesAtom, {
    "ws-test": {
      id: "ws-test",
      path: "/workspace",
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 280,
        bottomPanelHeight: 200,
        focusMode: false,
      },
    },
  } as never);
}

describe("useOpenWorkspaceFile", () => {
  it("opens regular files in the standalone editor without clearing the focused editor pane", async () => {
    const store = createStore();
    seedWorkspace(store);
    store.set(paneLayoutAtomFamily("ws-test"), {
      id: "root",
      type: "split",
      direction: "horizontal",
      children: [
        { id: "pane-editor-1", type: "leaf", leafKind: "editor" },
        { id: "pane-draft-1", type: "leaf", leafKind: "draft" },
      ],
    });
    store.set(focusedEditorPaneIdAtomFamily("ws-test"), "pane-editor-1");
    store.set(activeEditorPaneIdAtomFamily("ws-test"), "pane-editor-1");
    store.set(
      editorPaneActiveFilePathAtomFamily(editorPaneStateKey("ws-test", "pane-editor-1")),
      "src/panel.tsx"
    );

    const { result } = renderHook(() => useOpenWorkspaceFile("ws-test"), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      await result.current.openWorkspaceFile({
        workspaceId: "ws-test",
        path: "src/app.tsx",
        source: "manual",
      });
    });

    expect(store.get(activeEditorPaneIdAtomFamily("ws-test"))).toBe("pane-editor-1");
    expect(store.get(focusedEditorPaneIdAtomFamily("ws-test"))).toBeNull();
    expect(
      store.get(editorPaneActiveFilePathAtomFamily(editorPaneStateKey("ws-test", "pane-editor-1")))
    ).toBe("src/panel.tsx");
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/app.tsx");
    expect(store.get(pendingEditorNavigationAtomFamily("ws-test"))).toMatchObject({
      workspaceId: "ws-test",
      path: "src/app.tsx",
      source: "manual",
    });
  });

  it("keeps the active editor pane identity for regular file opens", async () => {
    const store = createStore();
    seedWorkspace(store);
    store.set(paneLayoutAtomFamily("ws-test"), {
      id: "root",
      type: "leaf",
      leafKind: "editor",
    });
    store.set(activeEditorPaneIdAtomFamily("ws-test"), "root");

    const { result } = renderHook(() => useOpenWorkspaceFile("ws-test"), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      await result.current.openWorkspaceFile({
        workspaceId: "ws-test",
        path: "src/standalone.ts",
        source: "manual",
      });
    });

    expect(store.get(activeEditorPaneIdAtomFamily("ws-test"))).toBe("root");
    expect(store.get(focusedEditorPaneIdAtomFamily("ws-test"))).toBeNull();
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/standalone.ts");
  });

  it("falls back to the standalone editor when no reusable editor pane exists", async () => {
    const store = createStore();
    seedWorkspace(store);
    store.set(paneLayoutAtomFamily("ws-test"), {
      id: "root",
      type: "leaf",
      leafKind: "draft",
    });
    store.set(activeEditorPaneIdAtomFamily("ws-test"), "stale-editor-pane");

    const { result } = renderHook(() => useOpenWorkspaceFile("ws-test"), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      await result.current.openWorkspaceFile({
        workspaceId: "ws-test",
        path: "src/fallback.ts",
        source: "manual",
      });
    });

    expect(store.get(activeEditorPaneIdAtomFamily("ws-test"))).toBeNull();
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/fallback.ts");
  });

  it("converts a dropped draft pane into the editor target when no editor pane exists", async () => {
    const store = createStore();
    seedWorkspace(store);
    store.set(paneLayoutAtomFamily("ws-test"), {
      id: "root",
      type: "leaf",
      leafKind: "draft",
    });

    const { result } = renderHook(() => useOpenWorkspaceFile("ws-test"), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      await result.current.openWorkspaceFile(
        {
          workspaceId: "ws-test",
          path: "src/from-drop.ts",
          source: "file-tree",
        },
        {
          targetDraftPaneId: "root",
        }
      );
    });

    expect(store.get(paneLayoutAtomFamily("ws-test"))).toEqual({
      id: "root",
      type: "leaf",
      leafKind: "editor",
    });
    expect(store.get(activeEditorPaneIdAtomFamily("ws-test"))).toBe("root");
    expect(store.get(focusedEditorPaneIdAtomFamily("ws-test"))).toBe("root");
    expect(
      store.get(editorPaneActiveFilePathAtomFamily(editorPaneStateKey("ws-test", "root")))
    ).toBe("src/from-drop.ts");
    expect(
      store.get(editorPanePendingNavigationAtomFamily(editorPaneStateKey("ws-test", "root")))
    ).toMatchObject({
      workspaceId: "ws-test",
      path: "src/from-drop.ts",
      source: "file-tree",
    });
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
  });

  it("converts the target draft pane when another draft receives a dropped file", async () => {
    const store = createStore();
    seedWorkspace(store);
    store.set(paneLayoutAtomFamily("ws-test"), {
      id: "root",
      type: "split",
      direction: "horizontal",
      children: [
        { id: "left", type: "leaf", leafKind: "editor" },
        { id: "right", type: "leaf", leafKind: "draft" },
      ],
    });
    store.set(
      editorPaneActiveFilePathAtomFamily(editorPaneStateKey("ws-test", "left")),
      "src/left.ts"
    );

    const { result } = renderHook(() => useOpenWorkspaceFile("ws-test"), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      await result.current.openWorkspaceFile(
        {
          workspaceId: "ws-test",
          path: "src/reused.ts",
          source: "file-tree",
        },
        {
          targetDraftPaneId: "right",
        }
      );
    });

    expect(store.get(paneLayoutAtomFamily("ws-test"))).toEqual({
      id: "root",
      type: "split",
      direction: "horizontal",
      children: [
        { id: "left", type: "leaf", leafKind: "editor" },
        { id: "right", type: "leaf", leafKind: "editor" },
      ],
    });
    expect(store.get(activeEditorPaneIdAtomFamily("ws-test"))).toBe("right");
    expect(store.get(focusedEditorPaneIdAtomFamily("ws-test"))).toBe("right");
    expect(
      store.get(editorPaneActiveFilePathAtomFamily(editorPaneStateKey("ws-test", "left")))
    ).toBe("src/left.ts");
    expect(
      store.get(editorPaneActiveFilePathAtomFamily(editorPaneStateKey("ws-test", "right")))
    ).toBe("src/reused.ts");
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
  });

  it("persists the opened path and active editor path", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      id: "ws-test",
      path: "/workspace",
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 280,
        bottomPanelHeight: 200,
        focusMode: false,
      },
    });

    const store = createStore();
    seedWorkspace(store);
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(paneLayoutAtomFamily("ws-test"), {
      id: "root",
      type: "leaf",
      leafKind: "editor",
    });

    const { result } = renderHook(() => useOpenWorkspaceFile("ws-test"), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      await result.current.openWorkspaceFile({
        workspaceId: "ws-test",
        path: "src/persisted.ts",
        source: "manual",
      });
    });

    expect(store.get(openEditorPathsAtomFamily("ws-test"))).toEqual(["src/persisted.ts"]);
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/persisted.ts");
    expect(sendCommand).toHaveBeenCalledWith(
      "workspace.uiState.set",
      expect.objectContaining({
        workspaceId: "ws-test",
        uiState: expect.objectContaining({
          openEditorPaths: ["src/persisted.ts"],
          activeEditorPath: "src/persisted.ts",
        }),
      }),
      undefined
    );
  });
});
