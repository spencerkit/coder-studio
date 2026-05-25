// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { workspacesAtom } from "../../../atoms/workspaces";
import {
  activeEditorPaneIdAtomFamily,
  focusedEditorPaneIdAtomFamily,
} from "../../agent-panes/atoms/editor-panes";
import { paneLayoutAtomFamily } from "../../agent-panes/atoms/pane-layout";
import { pendingEditorNavigationAtomFamily } from "../../code-editor/atoms";
import { activeFilePathAtomFamily } from "../atoms";
import { useOpenWorkspaceFile } from "./use-open-workspace-file";

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
  it("routes regular file opens into the focused editor pane", async () => {
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
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/app.tsx");
    expect(store.get(pendingEditorNavigationAtomFamily("ws-test"))).toMatchObject({
      workspaceId: "ws-test",
      path: "src/app.tsx",
      source: "manual",
    });
  });

  it("falls back to the standalone editor when no editor pane is focused", async () => {
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

    expect(store.get(activeEditorPaneIdAtomFamily("ws-test"))).toBeNull();
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/standalone.ts");
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
  });

  it("reuses the existing editor pane when another draft receives a dropped file", async () => {
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
        { id: "right", type: "leaf", leafKind: "draft" },
      ],
    });
    expect(store.get(activeEditorPaneIdAtomFamily("ws-test"))).toBe("left");
    expect(store.get(focusedEditorPaneIdAtomFamily("ws-test"))).toBe("left");
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/reused.ts");
  });
});
