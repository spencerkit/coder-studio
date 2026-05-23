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
import { activeFilePathAtomFamily } from "../../workspace/atoms/files";
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

    const result = screen.getByRole("button", { name: /app\.tsx/i });
    expect(within(result).getByText("app.tsx")).toHaveClass("quick-open__name");
    expect(within(result).getByText("src/app.tsx")).toHaveClass("quick-open__path");
    expect(result.querySelector(".quick-open__primary")).not.toBeNull();
    expect(result.querySelector(".quick-open__secondary")).not.toBeNull();
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
    const firstResult = screen.getByRole("button", { name: /app\.tsx/i });
    const secondResult = screen.getByRole("button", { name: /routes\.ts/i });

    expect(firstResult).toHaveClass("quick-open__item--active");
    expect(secondResult).not.toHaveClass("quick-open__item--active");

    fireEvent.keyDown(input, {
      key: "ArrowDown",
    });

    expect(firstResult).not.toHaveClass("quick-open__item--active");
    expect(secondResult).toHaveClass("quick-open__item--active");

    fireEvent.keyDown(input, {
      key: "Enter",
    });

    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/routes.ts");
    expect(store.get(quickOpenOpenAtom)).toBe(false);
  });
});
