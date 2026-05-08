import type { WorktreeInfo } from "@coder-studio/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { activeWorkspaceIdAtom } from "../../../../atoms/workspaces";
import { worktreeListAtomFamily } from "../../atoms";
import { WorktreeListButton } from "./worktree-list-button";

const viewportMocks = vi.hoisted(() => ({
  viewport: "desktop" as "desktop" | "mobile",
}));

vi.mock("../../../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

const worktrees: WorktreeInfo[] = [
  {
    name: "main",
    path: "/repo/main",
    branch: "main",
    commit: "abc1234",
    status: "clean",
  },
  {
    name: "feature/x",
    path: "/repo/feature-x",
    branch: "feature/x",
    commit: "def5678",
    status: "dirty",
  },
];

function buildStore() {
  const store = createStore();
  store.set(localeAtom, "en");
  store.set(activeWorkspaceIdAtom, "ws-1");
  return store;
}

describe("WorktreeListButton", () => {
  afterEach(() => {
    viewportMocks.viewport = "desktop";
    vi.restoreAllMocks();
  });

  it("dispatches worktree.list on mount and shows the count", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "worktree.list") {
        return { worktrees };
      }
      return {};
    });

    const store = buildStore();
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <WorktreeListButton workspaceId="ws-1" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("worktree.list", { workspaceId: "ws-1" }, undefined);
    });

    await waitFor(() => {
      expect(store.get(worktreeListAtomFamily("ws-1")).items.length).toBe(2);
    });

    expect(screen.getByLabelText("Open worktree list").textContent).toContain("2");
  });

  it("opens a list and lets the user open a worktree's details", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "worktree.list") {
        return { worktrees };
      }
      if (op === "worktree.status") {
        return {
          status: {
            branch: "feature/x",
            ahead: 0,
            behind: 0,
            headSha: "def567890",
            headShortSha: "def5678",
            headSubject: "feature x progress",
            staged: [],
            modified: [],
            untracked: [],
            deleted: [],
          },
        };
      }
      return {};
    });

    const store = buildStore();
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <WorktreeListButton workspaceId="ws-1" />
      </Provider>
    );

    await waitFor(() => expect(store.get(worktreeListAtomFamily("ws-1")).items.length).toBe(2));

    fireEvent.click(screen.getByLabelText("Open worktree list"));

    expect(await screen.findByText("Worktrees")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("feature/x")).toBeInTheDocument();

    fireEvent.click(screen.getByText("feature/x"));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("worktree.status", {
        workspaceId: "ws-1",
        worktreePath: "/repo/feature-x",
      });
    });
  });

  it("does not refetch when atom already has lastLoadedAt", async () => {
    const sendCommand = vi.fn(async () => ({ worktrees }));

    const store = buildStore();
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);
    store.set(worktreeListAtomFamily("ws-1"), {
      items: worktrees,
      loading: false,
      lastLoadedAt: Date.now(),
    });

    render(
      <Provider store={store}>
        <WorktreeListButton workspaceId="ws-1" />
      </Provider>
    );

    await new Promise((r) => setTimeout(r, 30));

    expect(sendCommand).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Open worktree list").textContent).toContain("2");
  });

  it("retries loading when the user opens the list after the first request fails", async () => {
    const sendCommand = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ worktrees });

    const store = buildStore();
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <WorktreeListButton workspaceId="ws-1" />
      </Provider>
    );

    await waitFor(() => {
      expect(store.get(worktreeListAtomFamily("ws-1")).error).toContain("network down");
    });
    expect(sendCommand).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("Open worktree list"));

    await waitFor(() => {
      expect(store.get(worktreeListAtomFamily("ws-1")).items).toHaveLength(2);
    });
    expect(sendCommand).toHaveBeenCalledTimes(2);
  });

  it("retries from an error state even when a stale snapshot already exists", async () => {
    const sendCommand = vi.fn().mockResolvedValue({ worktrees });

    const store = buildStore();
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);
    store.set(worktreeListAtomFamily("ws-1"), {
      items: [worktrees[0]!],
      loading: false,
      lastLoadedAt: Date.now(),
      error: "stale snapshot",
    });

    render(
      <Provider store={store}>
        <WorktreeListButton workspaceId="ws-1" />
      </Provider>
    );

    fireEvent.click(screen.getByLabelText("Open worktree list"));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("worktree.list", { workspaceId: "ws-1" }, undefined);
    });
  });

  it("keeps the detail modal pinned to the originating workspace after the active workspace changes", async () => {
    const sendCommand = vi.fn(
      async (op: string, args?: { workspaceId?: string; worktreePath?: string }) => {
        if (op === "worktree.list") {
          return { worktrees };
        }
        if (op === "worktree.status") {
          return {
            status: {
              branch: args?.workspaceId === "ws-1" ? "feature/x" : "wrong-workspace",
              ahead: 0,
              behind: 0,
              staged: [],
              modified: [],
              untracked: [],
              deleted: [],
            },
          };
        }
        return {};
      }
    );

    const store = buildStore();
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <WorktreeListButton workspaceId="ws-1" />
      </Provider>
    );

    await waitFor(() => expect(store.get(worktreeListAtomFamily("ws-1")).items.length).toBe(2));

    fireEvent.click(screen.getByLabelText("Open worktree list"));
    fireEvent.click(screen.getByText("feature/x"));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("worktree.status", {
        workspaceId: "ws-1",
        worktreePath: "/repo/feature-x",
      });
    });

    act(() => {
      store.set(activeWorkspaceIdAtom, "ws-2");
    });

    fireEvent.click(screen.getByRole("button", { name: "Diff" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("worktree.diff", {
        workspaceId: "ws-1",
        worktreePath: "/repo/feature-x",
      });
    });
  });
});
