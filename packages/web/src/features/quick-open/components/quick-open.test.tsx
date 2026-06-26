// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quickOpenOpenAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import {
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadStateAtom,
} from "../../../atoms/workspaces";
import {
  activeEditorPaneIdAtomFamily,
  focusedEditorPaneIdAtomFamily,
} from "../../agent-panes/atoms/editor-panes";
import { paneLayoutAtomFamily } from "../../agent-panes/atoms/pane-layout";
import {
  activeEditorTabAtomFamily,
  activeFilePathAtomFamily,
  openEditorTabsAtomFamily,
} from "../../workspace/atoms/files";
import { QuickOpen } from "./quick-open";

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
  store.set(workspaceOrderAtom, ["ws-test"]);
  store.set(activeWorkspaceIdAtom, "ws-test");
  store.set(workspacesLoadStateAtom, "ready");
}

describe("QuickOpen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens on Ctrl/Cmd+P, queries file.search, and renders file name with path", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      files: [{ path: "src/app.tsx", name: "app.tsx", kind: "file" }],
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspace(store);

    render(
      <Provider store={store}>
        <QuickOpen />
      </Provider>
    );

    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    fireEvent.change(screen.getByRole("textbox", { name: /Go to File|跳转到文件/i }), {
      target: { value: "app" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "file.search",
      {
        workspaceId: "ws-test",
        query: "app",
        limit: 25,
      },
      undefined
    );

    const result = screen.getByRole("option", { name: /app\.tsx/i });
    expect(within(result).getByText("app.tsx")).toHaveClass("quick-open__primary");
    expect(within(result).getByText("src/app.tsx")).toHaveClass("quick-open__secondary");
  });

  it("moves the active row with keyboard and opens the selected file on Enter", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      files: [
        { path: "src/app.tsx", name: "app.tsx", kind: "file" },
        { path: "src/routes.ts", name: "routes.ts", kind: "file" },
      ],
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspace(store);
    store.set(quickOpenOpenAtom, true);

    render(
      <Provider store={store}>
        <QuickOpen />
      </Provider>
    );

    fireEvent.change(screen.getByRole("textbox", { name: /Go to File|跳转到文件/i }), {
      target: { value: "app" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    const input = screen.getByRole("textbox", { name: /Go to File|跳转到文件/i });
    const firstResult = screen.getByRole("option", { name: /app\.tsx/i });
    const secondResult = screen.getByRole("option", { name: /routes\.ts/i });

    expect(firstResult).toHaveAttribute("aria-selected", "true");
    expect(secondResult).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(input, {
      key: "ArrowDown",
    });

    expect(firstResult).toHaveAttribute("aria-selected", "false");
    expect(secondResult).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, {
      key: "Enter",
    });

    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/routes.ts");
    expect(store.get(quickOpenOpenAtom)).toBe(false);
  });

  it("opens quick open selections in the standalone editor when an editor pane is focused", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      files: [{ path: "src/app.tsx", name: "app.tsx", kind: "file" }],
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspace(store);
    store.set(quickOpenOpenAtom, true);
    store.set(paneLayoutAtomFamily("ws-test"), {
      id: "root",
      type: "leaf",
      leafKind: "editor",
    });
    store.set(focusedEditorPaneIdAtomFamily("ws-test"), "root");

    render(
      <Provider store={store}>
        <QuickOpen />
      </Provider>
    );

    fireEvent.change(screen.getByRole("textbox", { name: /Go to File|跳转到文件/i }), {
      target: { value: "app" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    fireEvent.click(screen.getByRole("option", { name: /app\.tsx/i }));

    expect(store.get(activeEditorPaneIdAtomFamily("ws-test"))).toBeNull();
    expect(store.get(focusedEditorPaneIdAtomFamily("ws-test"))).toBeNull();
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/app.tsx");
  });

  it("opens .csc quick open selections as canvas tabs", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      files: [
        {
          path: ".coder-studio/canvases/auth-gate.csc",
          name: "auth-gate.csc",
          kind: "file",
        },
      ],
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspace(store);
    store.set(quickOpenOpenAtom, true);

    render(
      <Provider store={store}>
        <QuickOpen />
      </Provider>
    );

    fireEvent.change(screen.getByRole("textbox", { name: /Go to File|跳转到文件/i }), {
      target: { value: "auth" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    fireEvent.click(screen.getByRole("option", { name: /auth-gate\.csc/i }));

    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
    expect(store.get(openEditorTabsAtomFamily("ws-test"))).toEqual([
      {
        kind: "canvas",
        id: "canvas:.coder-studio/canvases/auth-gate.csc",
        title: "auth-gate",
        sourcePath: ".coder-studio/canvases/auth-gate.csc",
        canvasId: ".coder-studio/canvases/auth-gate.csc",
      },
    ]);
    expect(store.get(activeEditorTabAtomFamily("ws-test"))).toEqual({
      kind: "canvas",
      id: "canvas:.coder-studio/canvases/auth-gate.csc",
      title: "auth-gate",
      sourcePath: ".coder-studio/canvases/auth-gate.csc",
      canvasId: ".coder-studio/canvases/auth-gate.csc",
    });
    expect(store.get(quickOpenOpenAtom)).toBe(false);
  });
});
