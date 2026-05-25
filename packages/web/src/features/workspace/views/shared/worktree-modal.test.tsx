import type { WorktreeInfo } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import {
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadStateAtom,
} from "../../../../atoms/workspaces";
import { WorktreeModal } from "./worktree-modal";

const viewportMocks = vi.hoisted(() => ({
  viewport: "desktop" as "desktop" | "mobile",
}));

vi.mock("../../../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

const worktree: WorktreeInfo = {
  name: "feature/mobile-sheet",
  path: "/tmp/coder-studio-feature",
  branch: "feature/mobile-sheet",
  commit: "abc1234",
  status: "dirty",
};

function createWorkspace(id: string) {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    targetRuntime: "native" as const,
    openedAt: 1,
    lastActiveAt: 1,
    uiState: {
      leftPanelWidth: 280,
      bottomPanelHeight: 200,
      focusMode: false,
    },
  };
}

describe("WorktreeModal", () => {
  afterEach(() => {
    viewportMocks.viewport = "desktop";
    vi.restoreAllMocks();
  });

  it("uses the shared drawer shell on desktop viewports", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      status: {
        branch: "feature/mobile-sheet",
        ahead: 0,
        behind: 0,
        headSha: "abc1234567890",
        headShortSha: "abc1234",
        headSubject: "Initial mobile sheet setup",
        staged: [],
        modified: [],
        untracked: [],
        deleted: [],
      },
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(activeWorkspaceIdAtom, "ws-1");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <WorktreeModal workspaceId="ws-1" worktree={worktree} onClose={vi.fn()} />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("worktree.status", {
        workspaceId: "ws-1",
        worktreePath: "/tmp/coder-studio-feature",
      });
    });

    expect(document.querySelector(".drawer-backdrop")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: worktree.name })).toBeInTheDocument();
    expect(document.querySelector(".drawer-panel")).toBeTruthy();
    expect(document.querySelector(".modal-card-lg")).toBeNull();
    expect(await screen.findByText("Latest Commit")).toBeInTheDocument();
    expect(await screen.findByText("abc1234")).toBeInTheDocument();
    expect(await screen.findByText("Initial mobile sheet setup")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toHaveClass("btn", "btn-ghost", "btn-sm");
  });

  it("keeps tab content inside the desktop drawer viewport", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      status: {
        branch: "feature/mobile-sheet",
        ahead: 0,
        behind: 0,
        headSha: "abc1234567890",
        headShortSha: "abc1234",
        headSubject: "Initial mobile sheet setup",
        staged: [],
        modified: [],
        untracked: [],
        deleted: [],
      },
    });

    const store = createStore();
    const workspace = createWorkspace("ws-1");
    store.set(localeAtom, "en");
    store.set(activeWorkspaceIdAtom, "ws-1");
    store.set(workspacesAtom, {
      [workspace.id]: workspace,
    });
    store.set(workspaceOrderAtom, [workspace.id]);
    store.set(workspacesLoadStateAtom, "ready");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <WorktreeModal worktree={worktree} onClose={vi.fn()} />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("worktree.status", {
        workspaceId: "ws-1",
        worktreePath: "/tmp/coder-studio-feature",
      });
    });

    expect(screen.getByRole("dialog", { name: worktree.name })).toHaveClass("drawer-panel");
    expect(screen.getByRole("tablist", { name: "Worktree" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Status" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Status" })).toHaveClass("worktree-tab", "active");
    expect(await screen.findByText("Latest Commit")).toBeInTheDocument();
  });

  it("does not render without an explicit workspace until the workspace list is ready", () => {
    const store = createStore();
    const workspace = createWorkspace("ws-1");

    store.set(localeAtom, "en");
    store.set(activeWorkspaceIdAtom, workspace.id);
    store.set(workspacesAtom, {
      [workspace.id]: workspace,
    });
    store.set(workspaceOrderAtom, [workspace.id]);
    store.set(workspacesLoadStateAtom, "loading");

    const { container } = render(
      <Provider store={store}>
        <WorktreeModal worktree={worktree} onClose={vi.fn()} />
      </Provider>
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("falls back to the first ordered workspace when the requested workspace is missing", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      status: {
        branch: "feature/mobile-sheet",
        ahead: 0,
        behind: 0,
        headSha: "abc1234567890",
        headShortSha: "abc1234",
        headSubject: "Initial mobile sheet setup",
        staged: [],
        modified: [],
        untracked: [],
        deleted: [],
      },
    });

    const store = createStore();
    const fallbackWorkspace = createWorkspace("ws-fallback");
    const otherWorkspace = createWorkspace("ws-other");
    store.set(localeAtom, "en");
    store.set(activeWorkspaceIdAtom, "ws-missing");
    store.set(workspacesAtom, {
      [fallbackWorkspace.id]: fallbackWorkspace,
      [otherWorkspace.id]: otherWorkspace,
    });
    store.set(workspaceOrderAtom, [fallbackWorkspace.id, otherWorkspace.id]);
    store.set(workspacesLoadStateAtom, "ready");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <WorktreeModal worktree={worktree} onClose={vi.fn()} />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("worktree.status", {
        workspaceId: fallbackWorkspace.id,
        worktreePath: "/tmp/coder-studio-feature",
      });
    });
  });

  it("renders inside shared Sheet on mobile and still loads data when tabs change", async () => {
    viewportMocks.viewport = "mobile";
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "worktree.status") {
        return {
          status: {
            branch: "feature/mobile-sheet",
            ahead: 0,
            behind: 0,
            headSha: "abc1234567890",
            headShortSha: "abc1234",
            headSubject: "Initial mobile sheet setup",
            staged: [],
            modified: [{ path: "src/app.tsx" }],
            untracked: [],
            deleted: [],
          },
        };
      }

      if (op === "worktree.diff") {
        return {
          diff: "diff --git a/src/app.tsx b/src/app.tsx",
        };
      }

      if (op === "worktree.tree") {
        return {
          tree: [],
        };
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(activeWorkspaceIdAtom, "ws-1");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <WorktreeModal workspaceId="ws-1" worktree={worktree} onClose={vi.fn()} />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("worktree.status", {
        workspaceId: "ws-1",
        worktreePath: "/tmp/coder-studio-feature",
      });
    });

    expect(document.querySelector(".mobile-sheet")).toBeTruthy();
    expect(document.querySelector(".modal-overlay")).toBeNull();
    expect(
      document.querySelector(".mobile-worktree-sheet__content .worktree-content")
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Diff" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("worktree.diff", {
        workspaceId: "ws-1",
        worktreePath: "/tmp/coder-studio-feature",
      });
    });

    expect(await screen.findByText("diff --git a/src/app.tsx b/src/app.tsx")).toBeInTheDocument();
  });

  it("renders translated Chinese worktree chrome when locale is zh", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      status: {
        branch: "feature/mobile-sheet",
        ahead: 0,
        behind: 0,
        headSha: "abc1234567890",
        headShortSha: "abc1234",
        headSubject: "初始移动端面板",
        staged: [],
        modified: [],
        untracked: [],
        deleted: [],
      },
    });

    const store = createStore();
    store.set(localeAtom, "zh");
    store.set(activeWorkspaceIdAtom, "ws-1");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <WorktreeModal workspaceId="ws-1" worktree={worktree} onClose={vi.fn()} />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("worktree.status", {
        workspaceId: "ws-1",
        worktreePath: "/tmp/coder-studio-feature",
      });
    });

    expect(screen.getByRole("tab", { name: "状态" })).toBeInTheDocument();
    expect(screen.getByText("路径")).toBeInTheDocument();
    expect(screen.getByText("最新提交")).toBeInTheDocument();
    expect(screen.getByText("初始移动端面板")).toBeInTheDocument();
    expect(screen.getByText("● 有更改")).toBeInTheDocument();
  });
});
