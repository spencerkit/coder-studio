// @vitest-environment jsdom

import type { GitStatus, Workspace, WorktreeInfo } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { workspacesAtom } from "../../../../atoms/workspaces";
import { worktreeListAtomFamily } from "../../atoms";
import { WorktreeManagerSurface } from "./worktree-manager-surface";

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

const baseStatus: GitStatus = {
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
};

function buildWorkspace(path: string): Workspace {
  return {
    id: "ws-1",
    path,
    targetRuntime: "native",
    openedAt: Date.now(),
    lastActiveAt: Date.now(),
    uiState: {
      leftPanelWidth: 320,
      bottomPanelHeight: 240,
      focusMode: false,
    },
  };
}

function buildManagerStore(
  sendCommand: ReturnType<typeof vi.fn>,
  initialWorktrees: WorktreeInfo[],
  workspacePath: string,
  options?: {
    loading?: boolean;
    lastLoadedAt?: number;
    error?: string;
  }
) {
  const store = createStore();
  store.set(localeAtom, "en");
  store.set(workspacesAtom, {
    "ws-1": buildWorkspace(workspacePath),
  });
  store.set(worktreeListAtomFamily("ws-1"), {
    items: initialWorktrees,
    loading: options?.loading ?? false,
    lastLoadedAt:
      options && Object.prototype.hasOwnProperty.call(options, "lastLoadedAt")
        ? options.lastLoadedAt
        : Date.now(),
    error: options?.error,
  });
  store.set(wsClientAtom, {
    sendCommand,
    subscribe: vi.fn(() => () => {}),
  } as never);
  return store;
}

describe("WorktreeManagerSurface", () => {
  afterEach(() => {
    viewportMocks.viewport = "desktop";
    vi.restoreAllMocks();
  });

  it("shows worktree rows and opens detail view from list mode", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "worktree.status") return { status: baseStatus };
      return {};
    });

    render(
      <Provider store={buildManagerStore(sendCommand, worktrees, "/repo/main")}>
        <WorktreeManagerSurface workspaceId="ws-1" openView="list" onClose={vi.fn()} />
      </Provider>
    );

    expect(screen.getByText("feature/x")).toBeInTheDocument();
    expect(screen.getByText("/repo/feature-x")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();

    fireEvent.click(screen.getByText("feature/x"));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("worktree.status", {
        workspaceId: "ws-1",
        worktreePath: "/repo/feature-x",
      });
    });
  });

  it("uses shared Sheet chrome on mobile viewports", () => {
    viewportMocks.viewport = "mobile";

    render(
      <Provider store={buildManagerStore(vi.fn(), worktrees, "/repo/main")}>
        <WorktreeManagerSurface workspaceId="ws-1" openView="list" onClose={vi.fn()} />
      </Provider>
    );

    expect(document.querySelector(".mobile-sheet--worktree")).toBeTruthy();
    expect(document.querySelector(".modal-overlay")).toBeNull();
    expect(screen.getByRole("region", { name: "Worktrees sheet" })).toBeInTheDocument();
  });

  it("uses shared Drawer chrome on desktop viewports", () => {
    const onClose = vi.fn();

    render(
      <Provider store={buildManagerStore(vi.fn(), worktrees, "/repo/main")}>
        <WorktreeManagerSurface workspaceId="ws-1" openView="list" onClose={onClose} />
      </Provider>
    );

    const dialog = screen.getByRole("dialog", { name: "Worktrees" });
    expect(dialog).toHaveClass("drawer-panel", "worktree-manager-surface");
    expect(document.querySelector(".mobile-sheet--worktree")).toBeNull();

    const overlay = document.querySelector(".drawer-backdrop");
    expect(overlay).toBeTruthy();

    fireEvent.click(overlay as Element);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders inline desktop preview chrome without a portal overlay when requested", () => {
    render(
      <Provider store={buildManagerStore(vi.fn(), worktrees, "/repo/main")}>
        <WorktreeManagerSurface
          workspaceId="ws-1"
          openView="list"
          onClose={vi.fn()}
          desktopPreviewInline
        />
      </Provider>
    );

    const dialog = screen
      .getByRole("heading", { name: "Worktrees" })
      .closest(".worktree-manager-surface");

    expect(dialog).toHaveClass("drawer-panel", "worktree-manager-surface");
    expect(dialog).toHaveClass("worktree-manager-surface--inline-preview");
    expect(document.querySelector(".drawer-backdrop")).toBeNull();
  });

  it("renders the shared empty state when the worktree list is empty", () => {
    render(
      <Provider store={buildManagerStore(vi.fn(), [], "/repo/main")}>
        <WorktreeManagerSurface workspaceId="ws-1" openView="list" onClose={vi.fn()} />
      </Provider>
    );

    const emptyMessage = screen.getByText("No worktrees");

    expect(emptyMessage).toBeInTheDocument();
    expect(emptyMessage.closest(".worktree-empty")).toBeTruthy();
  });

  it("renders the shared loading shell when the worktree list is pending", () => {
    render(
      <Provider
        store={buildManagerStore(vi.fn(), [], "/repo/main", {
          loading: true,
          lastLoadedAt: undefined,
        })}
      >
        <WorktreeManagerSurface workspaceId="ws-1" openView="list" onClose={vi.fn()} />
      </Provider>
    );

    const loadingMessage = screen.getByText("Loading...");

    expect(loadingMessage).toBeInTheDocument();
    expect(loadingMessage.closest(".worktree-loading")).toBeTruthy();
  });

  it("creates a worktree and closes the create surface instead of returning to list mode", async () => {
    const onClose = vi.fn();
    const sendCommand = vi
      .fn()
      .mockImplementation(async (op: string, args: Record<string, string>) => {
        if (op === "worktree.create") {
          return {
            worktree: {
              name: "feature/new-worktree",
              path: args.path,
              branch: args.branch,
              commit: "aaa1111",
              status: "clean",
            },
          };
        }

        if (op === "worktree.list") {
          return {
            worktrees: [
              ...worktrees,
              {
                name: "feature/new-worktree",
                path: "/repo/main-feature-new-worktree",
                branch: "feature/new-worktree",
                commit: "aaa1111",
                status: "clean",
              },
            ],
          };
        }

        return {};
      });

    render(
      <Provider store={buildManagerStore(sendCommand, worktrees, "/repo/main")}>
        <WorktreeManagerSurface workspaceId="ws-1" openView="create" onClose={onClose} />
      </Provider>
    );

    fireEvent.change(screen.getByLabelText("Branch"), {
      target: { value: "feature/new-worktree" },
    });
    fireEvent.change(screen.getByLabelText("Path"), {
      target: { value: "/repo/main-feature-new-worktree" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "worktree.create",
        {
          workspaceId: "ws-1",
          branch: "feature/new-worktree",
          path: "/repo/main-feature-new-worktree",
        },
        undefined
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes the create surface when cancel is pressed", () => {
    const onClose = vi.fn();

    render(
      <Provider store={buildManagerStore(vi.fn(), worktrees, "/repo/main")}>
        <WorktreeManagerSurface workspaceId="ws-1" openView="create" onClose={onClose} />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the create form fields with shared input compatibility classes", () => {
    render(
      <Provider store={buildManagerStore(vi.fn(), worktrees, "/repo/main")}>
        <WorktreeManagerSurface workspaceId="ws-1" openView="create" onClose={vi.fn()} />
      </Provider>
    );

    const branchInput = screen.getByLabelText("Branch");
    const pathInput = screen.getByLabelText("Path");

    expect(branchInput).toHaveClass("input");
    expect(branchInput).toHaveAttribute("placeholder", "feature/worktree-manager");

    expect(pathInput).toHaveClass("input");
    expect(pathInput).toHaveAttribute(
      "placeholder",
      "/home/spencer/workspace/coder-studio-feature-worktree-manager"
    );
    expect(pathInput).toHaveAttribute("aria-describedby", "worktree-path-hint-ws-1");
  });

  it("requires a force confirmation for dirty worktree removal", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "worktree.remove") return {};
      if (op === "worktree.list") return { worktrees: [worktrees[0]] };
      return {};
    });

    render(
      <Provider store={buildManagerStore(sendCommand, worktrees, "/repo/main")}>
        <WorktreeManagerSurface workspaceId="ws-1" openView="list" onClose={vi.fn()} />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove feature/x" }));
    expect(screen.getByRole("dialog", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByText("Force remove dirty worktree?")).toBeInTheDocument();
    expect(screen.getByText("/repo/feature-x")).toHaveClass("worktree-manager__confirm-path");
    fireEvent.click(screen.getByRole("button", { name: "Force Remove" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "worktree.remove",
        {
          workspaceId: "ws-1",
          worktreePath: "/repo/feature-x",
          force: true,
        },
        undefined
      );
    });
  });

  it("uses the shared confirm dialog copy for clean worktree removal and returns to list on cancel", () => {
    const cleanRemovableWorktrees: WorktreeInfo[] = [
      worktrees[0]!,
      {
        name: "feature/y",
        path: "/repo/feature-y",
        branch: "feature/y",
        commit: "ghi9012",
        status: "clean",
      },
    ];

    render(
      <Provider store={buildManagerStore(vi.fn(), cleanRemovableWorktrees, "/repo/main")}>
        <WorktreeManagerSurface workspaceId="ws-1" openView="list" onClose={vi.fn()} />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove feature/y" }));

    expect(screen.getByRole("dialog", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByText("Remove worktree?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByText("/repo/feature-y")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Delete" })).toBeNull();
    expect(screen.getByText("feature/y")).toBeInTheDocument();
  });

  it("keeps removal errors visible inside the shared confirm dialog until dismissed", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "worktree.remove") {
        throw new Error("permission denied");
      }

      return {};
    });

    render(
      <Provider store={buildManagerStore(sendCommand, worktrees, "/repo/main")}>
        <WorktreeManagerSurface workspaceId="ws-1" openView="list" onClose={vi.fn()} />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove feature/x" }));
    fireEvent.click(screen.getByRole("button", { name: "Force Remove" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("permission denied")).toBeInTheDocument();
    expect(screen.getByText("Force remove dirty worktree?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Delete" })).toBeNull();
    expect(screen.getByText("feature/x")).toBeInTheDocument();
  });

  it("keeps mobile worktree removal inside the shared sheet instead of opening a dialog", () => {
    viewportMocks.viewport = "mobile";

    render(
      <Provider store={buildManagerStore(vi.fn(), worktrees, "/repo/main")}>
        <WorktreeManagerSurface workspaceId="ws-1" openView="list" onClose={vi.fn()} />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove feature/x" }));

    expect(screen.queryByRole("dialog", { name: "Delete" })).toBeNull();
    expect(screen.getByRole("region", { name: "Worktrees sheet" })).toBeInTheDocument();
    expect(screen.getByText("Force remove dirty worktree?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Force Remove" })).toBeInTheDocument();
  });

  it("does not retry worktree.list in a loop after an initial load failure", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "worktree.list") {
        throw new Error("boom");
      }

      return {};
    });

    render(
      <Provider
        store={buildManagerStore(sendCommand, [], "/repo/main", {
          lastLoadedAt: undefined,
        })}
      >
        <WorktreeManagerSurface workspaceId="ws-1" openView="list" onClose={vi.fn()} />
      </Provider>
    );

    expect(await screen.findByText("boom")).toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sendCommand.mock.calls.filter(([op]) => op === "worktree.list")).toHaveLength(1);
  });

  it("allows manually retrying worktree.list after an initial load failure", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "worktree.list") {
        throw new Error("boom");
      }

      return {};
    });

    render(
      <Provider
        store={buildManagerStore(sendCommand, [], "/repo/main", {
          lastLoadedAt: undefined,
        })}
      >
        <WorktreeManagerSurface workspaceId="ws-1" openView="list" onClose={vi.fn()} />
      </Provider>
    );

    expect(await screen.findByText("boom")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(sendCommand.mock.calls.filter(([op]) => op === "worktree.list")).toHaveLength(2);
    });
  });

  it("recovers from a worktree.list retry after an initial load failure", async () => {
    let attempts = 0;
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "worktree.list") {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("boom");
        }

        return { worktrees };
      }

      return {};
    });

    render(
      <Provider
        store={buildManagerStore(sendCommand, [], "/repo/main", {
          lastLoadedAt: undefined,
        })}
      >
        <WorktreeManagerSurface workspaceId="ws-1" openView="list" onClose={vi.fn()} />
      </Provider>
    );

    expect(await screen.findByText("boom")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(screen.queryByText("boom")).not.toBeInTheDocument();
      expect(screen.getByText("feature/x")).toBeInTheDocument();
    });
  });

  it("normalizes a trailing slash before creating a worktree", async () => {
    const sendCommand = vi
      .fn()
      .mockImplementation(async (op: string, args: Record<string, string>) => {
        if (op === "worktree.create") {
          return {
            worktree: {
              name: "feature/new-worktree",
              path: args.path,
              branch: args.branch,
              commit: "aaa1111",
              status: "clean",
            },
          };
        }

        if (op === "worktree.list") {
          return {
            worktrees: [
              ...worktrees,
              {
                name: "feature/new-worktree",
                path: "/repo/main-feature-new-worktree",
                branch: "feature/new-worktree",
                commit: "aaa1111",
                status: "clean",
              },
            ],
          };
        }

        return {};
      });

    render(
      <Provider store={buildManagerStore(sendCommand, worktrees, "/repo/main")}>
        <WorktreeManagerSurface workspaceId="ws-1" openView="create" onClose={vi.fn()} />
      </Provider>
    );

    fireEvent.change(screen.getByLabelText("Branch"), {
      target: { value: "feature/new-worktree" },
    });
    fireEvent.change(screen.getByLabelText("Path"), {
      target: { value: "/repo/main-feature-new-worktree/" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "worktree.create",
        {
          workspaceId: "ws-1",
          branch: "feature/new-worktree",
          path: "/repo/main-feature-new-worktree",
        },
        undefined
      );
    });
  });

  it("allows creating a worktree with a Windows absolute path", async () => {
    const sendCommand = vi
      .fn()
      .mockImplementation(async (op: string, args: Record<string, string>) => {
        if (op === "worktree.create") {
          return {
            worktree: {
              name: "feature/new-worktree",
              path: args.path,
              branch: args.branch,
              commit: "aaa1111",
              status: "clean",
            },
          };
        }

        if (op === "worktree.list") {
          return { worktrees };
        }

        return {};
      });

    render(
      <Provider store={buildManagerStore(sendCommand, worktrees, "C:/repo/main")}>
        <WorktreeManagerSurface workspaceId="ws-1" openView="create" onClose={vi.fn()} />
      </Provider>
    );

    fireEvent.change(screen.getByLabelText("Branch"), {
      target: { value: "feature/new-worktree" },
    });
    fireEvent.change(screen.getByLabelText("Path"), {
      target: { value: "C:\\repo\\main-feature-new-worktree" },
    });

    expect(screen.getByRole("button", { name: "Create" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "worktree.create",
        expect.objectContaining({
          workspaceId: "ws-1",
          branch: "feature/new-worktree",
          path: "C:\\repo\\main-feature-new-worktree",
        }),
        undefined
      );
    });
  });

  it("preserves a Windows drive root when normalizing a worktree path", async () => {
    const sendCommand = vi
      .fn()
      .mockImplementation(async (op: string, args: Record<string, string>) => {
        if (op === "worktree.create") {
          return {
            worktree: {
              name: "feature/new-worktree",
              path: args.path,
              branch: args.branch,
              commit: "aaa1111",
              status: "clean",
            },
          };
        }

        if (op === "worktree.list") {
          return { worktrees };
        }

        return {};
      });

    render(
      <Provider store={buildManagerStore(sendCommand, worktrees, "C:\\repo\\main")}>
        <WorktreeManagerSurface workspaceId="ws-1" openView="create" onClose={vi.fn()} />
      </Provider>
    );

    fireEvent.change(screen.getByLabelText("Branch"), {
      target: { value: "feature/new-worktree" },
    });
    fireEvent.change(screen.getByLabelText("Path"), {
      target: { value: "C:\\" },
    });

    expect(screen.getByRole("button", { name: "Create" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "worktree.create",
        expect.objectContaining({
          workspaceId: "ws-1",
          branch: "feature/new-worktree",
          path: "C:\\",
        }),
        undefined
      );
    });
  });

  it("keeps UNC share prefixes when suggesting a worktree path", () => {
    render(
      <Provider store={buildManagerStore(vi.fn(), worktrees, "\\\\server\\share\\repo")}>
        <WorktreeManagerSurface workspaceId="ws-1" openView="create" onClose={vi.fn()} />
      </Provider>
    );

    fireEvent.change(screen.getByLabelText("Branch"), {
      target: { value: "feature/new-worktree" },
    });

    expect(screen.getByLabelText("Path")).toHaveValue(
      "\\\\server\\share\\repo-feature-new-worktree"
    );
  });

  it("does not offer removing the main worktree from a linked workspace", () => {
    const linkedWorkspaceWorktrees: WorktreeInfo[] = [
      worktrees[0]!,
      worktrees[1]!,
      {
        name: "feature/y",
        path: "/repo/feature-y",
        branch: "feature/y",
        commit: "ghi9012",
        status: "clean",
      },
    ];

    render(
      <Provider store={buildManagerStore(vi.fn(), linkedWorkspaceWorktrees, "/repo/feature-x")}>
        <WorktreeManagerSurface workspaceId="ws-1" openView="list" onClose={vi.fn()} />
      </Provider>
    );

    expect(screen.queryByRole("button", { name: "Remove main" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove feature/y" })).toBeInTheDocument();
  });
});
