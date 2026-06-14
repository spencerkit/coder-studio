import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";
import {
  activeEditorTabAtomFamily,
  activeFilePathAtomFamily,
  openFilesAtomFamily,
} from "../../workspace/atoms";
import { pendingEditorNavigationAtomFamily } from "../atoms";
import { useOpenLocation } from "./use-open-location";

function createWrapper(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  };
}

function browserTab(id: string, url: string | null) {
  return { kind: "browser" as const, id, url };
}

describe("useOpenLocation", () => {
  it("sets the active file path and stores pending navigation details", async () => {
    const store = createStore();
    const wrapper = createWrapper(store);
    const { result } = renderHook(() => useOpenLocation("ws-1"), { wrapper });

    await act(async () => {
      await result.current.openLocation({
        workspaceId: "ws-1",
        path: "src/utils/math.ts",
        line: 12,
        column: 5,
        source: "manual",
      });
    });

    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/utils/math.ts");
    expect(store.get(pendingEditorNavigationAtomFamily("ws-1"))).toMatchObject({
      workspaceId: "ws-1",
      path: "src/utils/math.ts",
      line: 12,
      column: 5,
      source: "manual",
      requestId: expect.any(Number),
    });
  });

  it("switches back to the file editor tab when opening a file while browser is active", async () => {
    const store = createStore();
    store.set(activeFilePathAtomFamily("ws-1"), "src/utils/math.ts");
    store.set(activeEditorTabAtomFamily("ws-1"), browserTab("browser-1", "localhost:8001"));
    const wrapper = createWrapper(store);
    const { result } = renderHook(() => useOpenLocation("ws-1"), { wrapper });

    await act(async () => {
      await result.current.openLocation({
        workspaceId: "ws-1",
        path: "src/utils/math.ts",
        source: "manual",
      });
    });

    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual({
      kind: "file",
      path: "src/utils/math.ts",
    });
  });

  it("preserves an existing open buffer while still updating pending navigation", async () => {
    const store = createStore();
    store.set(openFilesAtomFamily("ws-1"), {
      "src/utils/math.ts": {
        kind: "text",
        path: "src/utils/math.ts",
        content: "export const sum = (a: number, b: number) => a + b;\n",
        savedContent: "export const sum = (a: number, b: number) => a + b;\n",
        baseHash: "hash-1",
        isDirty: false,
      },
    });
    const wrapper = createWrapper(store);
    const { result } = renderHook(() => useOpenLocation("ws-1"), { wrapper });

    await act(async () => {
      await result.current.openLocation({
        workspaceId: "ws-1",
        path: "src/utils/math.ts",
        line: 3,
        column: 1,
        source: "lsp",
      });
    });

    expect(store.get(openFilesAtomFamily("ws-1"))["src/utils/math.ts"]).toMatchObject({
      content: "export const sum = (a: number, b: number) => a + b;\n",
      savedContent: "export const sum = (a: number, b: number) => a + b;\n",
    });
    expect(store.get(pendingEditorNavigationAtomFamily("ws-1"))).toMatchObject({
      workspaceId: "ws-1",
      path: "src/utils/math.ts",
      line: 3,
      column: 1,
      source: "lsp",
      requestId: expect.any(Number),
    });
  });

  it("assigns a fresh navigation request id for repeated open-location calls", async () => {
    const store = createStore();
    const wrapper = createWrapper(store);
    const { result } = renderHook(() => useOpenLocation("ws-1"), { wrapper });

    await act(async () => {
      await result.current.openLocation({
        workspaceId: "ws-1",
        path: "src/utils/math.ts",
        line: 1,
        column: 1,
        source: "search",
      });
    });

    const first = store.get(pendingEditorNavigationAtomFamily("ws-1"));

    await act(async () => {
      await result.current.openLocation({
        workspaceId: "ws-1",
        path: "src/utils/math.ts",
        line: 9,
        column: 2,
        source: "search",
      });
    });

    const second = store.get(pendingEditorNavigationAtomFamily("ws-1"));

    expect(first?.requestId).toEqual(expect.any(Number));
    expect(second?.requestId).toEqual(expect.any(Number));
    expect(second?.requestId).not.toBe(first?.requestId);
  });

  it("clears pending navigation only when the active path matches", async () => {
    const store = createStore();
    const wrapper = createWrapper(store);
    const { result } = renderHook(() => useOpenLocation("ws-1"), { wrapper });

    await act(async () => {
      await result.current.openLocation({
        workspaceId: "ws-1",
        path: "src/utils/math.ts",
        line: 7,
        column: 9,
        source: "search",
      });
    });

    act(() => {
      result.current.clearPendingNavigation("src/other.ts");
    });

    expect(store.get(pendingEditorNavigationAtomFamily("ws-1"))).not.toBeNull();

    act(() => {
      result.current.clearPendingNavigation("src/utils/math.ts");
    });

    expect(store.get(pendingEditorNavigationAtomFamily("ws-1"))).toBeNull();
  });
});
