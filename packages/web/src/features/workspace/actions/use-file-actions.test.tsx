// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import {
  activeEditorPaneIdAtomFamily,
  focusedEditorPaneIdAtomFamily,
} from "../../agent-panes/atoms/editor-panes";
import { paneLayoutAtomFamily } from "../../agent-panes/atoms/pane-layout";
import { pendingEditorNavigationAtomFamily } from "../../code-editor/atoms";
import { activeFilePathAtomFamily, fileTreeAtomFamily, openFilesAtomFamily } from "../atoms";
import { useFileActions } from "./use-file-actions";

function wrapperFor(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

describe("useFileActions rename behavior", () => {
  it("renames the active file and rewrites the open-file map key", async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ path: "/workspace", children: [] });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(activeFilePathAtomFamily("ws-test"), "src/app.tsx");
    store.set(openFilesAtomFamily("ws-test"), {
      "src/app.tsx": {
        kind: "text",
        path: "src/app.tsx",
        content: "export {};",
        baseHash: "hash-1",
        isDirty: false,
      },
    });
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));

    const { result } = renderHook(() => useFileActions({ workspaceId: "ws-test" }), {
      wrapper: wrapperFor(store),
    });

    act(() => {
      result.current.openRenameDialog({
        path: "src/app.tsx",
        name: "app.tsx",
        kind: "file",
      });
      result.current.updateRenameDraft("main.tsx");
    });

    await act(async () => {
      await result.current.submitRenameDialog();
    });

    expect(sendCommand).toHaveBeenNthCalledWith(
      1,
      "file.rename",
      {
        workspaceId: "ws-test",
        fromPath: "src/app.tsx",
        toPath: "src/main.tsx",
      },
      undefined
    );
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/main.tsx");
    expect(store.get(openFilesAtomFamily("ws-test"))).toEqual({
      "src/main.tsx": expect.objectContaining({
        path: "src/main.tsx",
      }),
    });
  });

  it("rewrites descendant editor paths when renaming a directory", async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ path: "/workspace", children: [] });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(activeFilePathAtomFamily("ws-test"), "src/nested/app.tsx");
    store.set(openFilesAtomFamily("ws-test"), {
      "src/nested/app.tsx": {
        kind: "text",
        path: "src/nested/app.tsx",
        content: "export {};",
        baseHash: "hash-2",
        isDirty: false,
      },
    });
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));

    const { result } = renderHook(() => useFileActions({ workspaceId: "ws-test" }), {
      wrapper: wrapperFor(store),
    });

    act(() => {
      result.current.openRenameDialog({
        path: "src/nested",
        name: "nested",
        kind: "dir",
      });
      result.current.updateRenameDraft("renamed");
    });

    await act(async () => {
      await result.current.submitRenameDialog();
    });

    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/renamed/app.tsx");
    expect(store.get(openFilesAtomFamily("ws-test"))).toEqual({
      "src/renamed/app.tsx": expect.objectContaining({
        path: "src/renamed/app.tsx",
      }),
    });
  });

  it("rejects blank names and names containing path separators before dispatch", async () => {
    const sendCommand = vi.fn();
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));

    const { result } = renderHook(() => useFileActions({ workspaceId: "ws-test" }), {
      wrapper: wrapperFor(store),
    });

    act(() => {
      result.current.openRenameDialog({
        path: "src/app.tsx",
        name: "app.tsx",
        kind: "file",
      });
      result.current.updateRenameDraft("   ");
    });

    await act(async () => {
      await result.current.submitRenameDialog();
    });

    expect(sendCommand).not.toHaveBeenCalled();
    expect(result.current.renameDialog?.error).toBe("Name is required.");

    act(() => {
      result.current.updateRenameDraft("bad/name.tsx");
    });

    await act(async () => {
      await result.current.submitRenameDialog();
    });

    expect(sendCommand).not.toHaveBeenCalled();
    expect(result.current.renameDialog?.error).toBe("Name cannot contain / or \\.");
  });

  it("routes explorer file opens into the focused editor pane when one is active", async () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));
    store.set(paneLayoutAtomFamily("ws-test"), {
      id: "pane-editor-1",
      type: "leaf",
      leafKind: "editor",
    });
    store.set(focusedEditorPaneIdAtomFamily("ws-test"), "pane-editor-1");

    const { result } = renderHook(() => useFileActions({ workspaceId: "ws-test" }), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      result.current.handleSelectFile("src/app.tsx");
      await Promise.resolve();
    });

    expect(store.get(activeEditorPaneIdAtomFamily("ws-test"))).toBe("pane-editor-1");
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/app.tsx");
    expect(store.get(pendingEditorNavigationAtomFamily("ws-test"))).toMatchObject({
      path: "src/app.tsx",
      source: "file-tree",
      workspaceId: "ws-test",
    });
  });

  it("keeps explorer file opens on the standalone editor path when no editor pane is focused", async () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));
    store.set(activeEditorPaneIdAtomFamily("ws-test"), "pane-editor-1");

    const { result } = renderHook(() => useFileActions({ workspaceId: "ws-test" }), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      result.current.handleSelectFile("src/standalone.ts");
      await Promise.resolve();
    });

    expect(store.get(activeEditorPaneIdAtomFamily("ws-test"))).toBeNull();
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/standalone.ts");
  });
});
