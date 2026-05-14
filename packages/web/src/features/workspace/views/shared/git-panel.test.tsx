// @vitest-environment jsdom

import type { GitStatus } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { workspacesAtom } from "../../../../atoms/workspaces";
import { CommandResultError } from "../../../../ws/client";
import { toastsAtom } from "../../../notifications/atoms";
import {
  gitBranchListAtomFamily,
  gitDiffPreviewAtomFamily,
  gitDiffPreviewDismissedAtomFamily,
  gitStateAtomFamily,
} from "../../atoms";
import { GitPanel } from "./git-panel";

describe("GitPanel", () => {
  const status: GitStatus = {
    branch: "feature/ai-agent",
    ahead: 0,
    behind: 0,
    headSha: "abc1234567890",
    headShortSha: "abc1234",
    headSubject: "Refresh git projection",
    staged: [{ path: "src/auth/AuthGate.tsx", status: "modified" }],
    modified: [{ path: "src/app/AppController.tsx", status: "modified" }],
    untracked: [{ path: "tests/supervisor.test.ts", status: "untracked" }],
    deleted: [{ path: "src/legacy/deprecated.ts", status: "deleted" }],
  };

  const worktrees = [
    {
      name: "feature/ai-agent",
      path: "/home/spencer/workspace/coder-studio",
      branch: "feature/ai-agent",
      commit: "abc1234",
      status: "dirty" as const,
    },
    {
      name: "pr/123-fix-auth",
      path: "/home/spencer/workspace/coder-studio-pr-123-fix-auth",
      branch: "pr/123-fix-auth",
      commit: "def5678",
      status: "clean" as const,
    },
  ];

  const historyEntries = [
    {
      sha: "98db173000000000000000000000000000000000",
      shortSha: "98db173",
      subject: "feat: refresh source control surface",
      authorName: "pallyoung",
      authoredAt: Date.now(),
    },
    {
      sha: "4c16c68000000000000000000000000000000000",
      shortSha: "4c16c68",
      subject: "Add worktree management surface spec",
      authorName: "pallyoung",
      authoredAt: Date.now() - 60_000,
    },
  ];

  function seedWorkspaceStore(store: ReturnType<typeof createStore>, workspaceId = "ws-test") {
    store.set(workspacesAtom, {
      [workspaceId]: {
        id: workspaceId,
        path: "/home/spencer/workspace/coder-studio",
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
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("does not render a branch switcher inside the desktop panel", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }

      if (op === "git.branches") {
        return { current: "feature/ai-agent", branches: [] };
      }

      if (op === "worktree.list") {
        return { worktrees: [] };
      }

      if (op === "git.log") {
        return { entries: [] };
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    const { container } = render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    await screen.findByText("Worktrees");
    expect(container.querySelector('[data-icon-semantic="git.status.staged"]')).toBeTruthy();
    expect(container.querySelector('[data-icon-semantic="git.status.modified"]')).toBeTruthy();
    expect(container.querySelector('[data-icon-semantic="git.status.deleted"]')).toBeTruthy();
    expect(container.querySelector('[data-icon-semantic="git.status.untracked"]')).toBeTruthy();

    expect(container.querySelector(".git-panel-branch-row")).toBeNull();
    expect(screen.queryByRole("button", { name: "Current Branch: feature/ai-agent" })).toBeNull();
  });

  it("does not render a branch switcher inside the mobile panel", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }

      if (op === "git.branches") {
        return { current: "feature/ai-agent", branches: [] };
      }

      if (op === "worktree.list") {
        return { worktrees: [] };
      }

      if (op === "git.log") {
        return { entries: [] };
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" variant="mobile" />
      </Provider>
    );

    await screen.findByText("Worktrees");

    expect(screen.queryByRole("button", { name: "Current Branch: feature/ai-agent" })).toBeNull();
  });

  it("does not render an internal footer strip or duplicate change-count label", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }

      if (op === "git.branches") {
        return { current: "feature/ai-agent", branches: [] };
      }

      if (op === "worktree.list") {
        return { worktrees: [] };
      }

      if (op === "git.log") {
        return { entries: [] };
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    const { container } = render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    await screen.findByText("Worktrees");

    expect(screen.queryByText("4 changes")).toBeNull();
    expect(container.querySelector(".git-panel-status-strip")).toBeNull();
  });

  it("renders a single trailing commit button in the desktop commit actions", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }

      if (op === "git.branches") {
        return { current: "feature/ai-agent", branches: [] };
      }

      if (op === "worktree.list") {
        return { worktrees: [] };
      }

      if (op === "git.log") {
        return { entries: [] };
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    const { container } = render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    await screen.findByText("Worktrees");

    const actionRow = container.querySelector(".git-commit-actions");
    const primaryButton = container.querySelector(".git-commit-primary");

    expect(actionRow).not.toBeNull();
    expect(primaryButton).not.toBeNull();
    expect(actionRow).toContainElement(primaryButton);
    expect(actionRow?.querySelectorAll("button")).toHaveLength(1);
    expect(primaryButton?.querySelector('[data-icon-semantic="git.commit"]')).toBeTruthy();
  });

  it("renders compact mobile commit actions with only the shared primary button", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }

      if (op === "git.branches") {
        return { current: "feature/ai-agent", branches: [] };
      }

      if (op === "worktree.list") {
        return { worktrees: [] };
      }

      if (op === "git.log") {
        return { entries: [] };
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    const { container } = render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" variant="mobile" />
      </Provider>
    );

    await screen.findByText("Worktrees");

    expect(container.querySelector(".git-commit-actions")).not.toBeNull();
    expect(container.querySelector(".git-commit-actions .git-commit-primary")).not.toBeNull();
    expect(container.querySelector(".git-commit-primary-mobile")).toBeNull();
    expect(container.querySelectorAll(".git-commit-actions button")).toHaveLength(1);
    expect(container.querySelector('[data-icon-semantic="git.commit"]')).toBeTruthy();
  });

  it("renders the commit box above collapsed worktree and history sections", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }

      if (op === "git.branches") {
        return { current: "feature/ai-agent", branches: [] };
      }

      if (op === "worktree.list") {
        return {
          worktrees,
        };
      }

      if (op === "git.log") {
        return {
          entries: historyEntries,
        };
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    expect(await screen.findByText("Worktrees")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.queryByText("pr/123-fix-auth")).toBeNull();
    expect(screen.queryByText("feat: refresh source control surface")).toBeNull();
    const summary = screen.getByText("Worktrees");
    const textarea = screen.getByPlaceholderText("Enter commit message...");
    expect(
      textarea.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      summary.compareDocumentPosition(screen.getByText("History")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("renders the desktop history section as a collapsible header with a chevron", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }

      if (op === "git.branches") {
        return { current: "feature/ai-agent", branches: [] };
      }

      if (op === "worktree.list") {
        return {
          worktrees,
        };
      }

      if (op === "git.log") {
        return {
          entries: historyEntries,
        };
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const historyToggle = await screen.findByRole("button", { name: "History" });

    expect(historyToggle).toHaveAttribute("aria-expanded", "false");
    expect(historyToggle.querySelector(".git-panel-section-chevron")).not.toBeNull();
  });

  it("keeps the worktree list collapsed by default", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }

      if (op === "git.branches") {
        return { current: "feature/ai-agent", branches: [] };
      }

      if (op === "worktree.list") {
        return {
          worktrees,
        };
      }

      if (op === "git.log") {
        return {
          entries: historyEntries,
        };
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const worktreeToggle = (await screen.findByText("Worktrees")).closest("button");
    const newWorktreeButton = screen.getByRole("button", { name: "New" });

    expect(worktreeToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("pr/123-fix-auth")).toBeNull();
    expect(
      newWorktreeButton.querySelector('[data-icon-semantic="worktree.action.new"]')
    ).toBeTruthy();
  });

  it("does not render the legacy header worktree button", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }

      if (op === "git.branches") {
        return { current: "feature/ai-agent", branches: [] };
      }

      if (op === "worktree.list") {
        return { worktrees: [] };
      }

      if (op === "git.log") {
        return { entries: [] };
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    expect(await screen.findByText("Worktrees")).toBeInTheDocument();
    expect(screen.queryByLabelText("Open worktree list")).not.toBeInTheDocument();
  });

  it("renders git groups from the first git.status response", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      return {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("git.status", { workspaceId: "ws-test" }, undefined);
    });

    expect((await screen.findAllByText("Staged")).length).toBeGreaterThan(0);
    expect(screen.getByText("Changes")).toBeInTheDocument();
    expect(screen.queryByText("Untracked")).toBeNull();
    expect(screen.getByText("AuthGate.tsx")).toBeInTheDocument();
    expect(screen.getByText("AppController.tsx")).toBeInTheDocument();
    expect(screen.getByText("supervisor.test.ts")).toBeInTheDocument();
    expect(screen.getByText("deprecated.ts")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.queryByLabelText("Latest Commit")).not.toBeInTheDocument();
  });

  it("loads the latest 20 history entries by default and does not render a show-all control", async () => {
    const sendCommand = vi
      .fn()
      .mockImplementation(async (op: string, args?: { limit?: number }) => {
        if (op === "git.status") {
          return status;
        }

        if (op === "git.branches") {
          return {
            current: "feature/ai-agent",
            branches: [],
          };
        }

        if (op === "git.log") {
          return {
            entries: historyEntries,
          };
        }

        return {};
      });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.log",
        {
          workspaceId: "ws-test",
          limit: 20,
        },
        undefined
      );
    });

    expect(screen.queryByRole("button", { name: "Show all history" })).toBeNull();
  });

  it("renders compact shared empty shells for clean changes and empty history", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          ...status,
          staged: [],
          modified: [],
          untracked: [],
          deleted: [],
        };
      }

      if (op === "git.branches") {
        return { current: "feature/ai-agent", branches: [] };
      }

      if (op === "worktree.list") {
        return { worktrees: [] };
      }

      if (op === "git.log") {
        return { entries: [] };
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const noChanges = await screen.findByText("No changes");
    const changesShell = noChanges.closest(".git-panel-empty");

    expect(changesShell).not.toBeNull();
    expect(changesShell).toHaveStyle({
      minHeight: "auto",
      padding: "12px 0",
      gap: "4px",
    });

    fireEvent.click(screen.getByRole("button", { name: "History" }));

    const noCommits = await screen.findByText("No commits yet");
    const historyShell = noCommits.closest(".git-panel-empty");

    expect(historyShell).not.toBeNull();
    expect(historyShell).toHaveStyle({
      minHeight: "auto",
      padding: "12px 0",
      gap: "4px",
    });
  });

  it("opens a commit diff when a history row is clicked", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === "git.status") {
        return status;
      }

      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }

      if (op === "git.log") {
        return {
          entries: historyEntries,
        };
      }

      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }

      if (op === "git.show") {
        return {
          diff: `commit-diff:${JSON.stringify(args)}`,
        };
      }

      return {};
    });
    const onPreviewOpen = vi.fn();
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" onPreviewOpen={onPreviewOpen} />
      </Provider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "History" }));

    const historyRow = await screen.findByRole("button", {
      name: /feat: refresh source control surface/i,
    });
    fireEvent.click(historyRow);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.show",
        {
          workspaceId: "ws-test",
          sha: historyEntries[0]?.sha,
        },
        undefined
      );
    });

    expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toEqual({
      path: historyEntries[0]?.sha,
      title: `98db173 · ${historyEntries[0]?.subject}`,
      diff: expect.stringContaining("commit-diff"),
      source: "commit",
    });
    expect(onPreviewOpen).toHaveBeenCalledWith({
      path: historyEntries[0]?.sha,
      title: `98db173 · ${historyEntries[0]?.subject}`,
      diff: expect.stringContaining("commit-diff"),
      source: "commit",
    });
  });

  it("uses the shared tooltip for long history subjects instead of native titles", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }

      if (op === "git.branches") {
        return { current: "feature/ai-agent", branches: [] };
      }

      if (op === "worktree.list") {
        return { worktrees: [] };
      }

      if (op === "git.log") {
        return { entries: historyEntries };
      }

      return {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "History" }));

    const subject = await screen.findByText("feat: refresh source control surface");
    expect(subject).not.toHaveAttribute("title");
    expect(subject.closest(".git-history-row")).not.toHaveAttribute("title");

    fireEvent.mouseEnter(subject);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("feat: refresh source control surface");
    expect(subject).toHaveAttribute("aria-describedby", tooltip.getAttribute("id") ?? "");
  });

  it("renders the shared commit textarea styling in the updated panel shell", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }

      if (op === "git.branches") {
        return { current: "feature/ai-agent", branches: [] };
      }

      if (op === "worktree.list") {
        return { worktrees: [] };
      }

      if (op === "git.log") {
        return { entries: [] };
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    await screen.findByText("Worktrees");

    expect(screen.getByPlaceholderText("Enter commit message...")).toHaveClass(
      "input",
      "textarea",
      "git-commit-input"
    );
  });

  it("loads branch list on mount", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, _args: unknown) => {
      if (op === "git.status") {
        return status;
      }

      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [
            { name: "feature/ai-agent", isCurrent: true, isRemote: false },
            { name: "main", isCurrent: false, isRemote: false },
          ],
        };
      }

      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }

      return {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.branches",
        { workspaceId: "ws-test" },
        undefined
      );
    });

    expect(store.get(gitBranchListAtomFamily("ws-test")).current).toBe("feature/ai-agent");
  });

  it("requests a diff, updates preview state, and emits an explicit preview-open event only when a row is clicked", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === "git.status") {
        return status;
      }

      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }

      if (op === "git.diff") {
        return {
          diff: `diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx\n${JSON.stringify(args)}`,
        };
      }

      if (op === "git.log") {
        return {
          entries: [],
        };
      }

      return {};
    });
    const onPreviewOpen = vi.fn();
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" onPreviewOpen={onPreviewOpen} />
      </Provider>
    );

    const row = await screen.findByText("AuthGate.tsx");
    fireEvent.click(row);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.diff",
        {
          workspaceId: "ws-test",
          path: "src/auth/AuthGate.tsx",
          staged: true,
        },
        undefined
      );
    });

    expect(store.get(gitStateAtomFamily("ws-test"))).toEqual(status);
    expect(store.get(gitBranchListAtomFamily("ws-test")).current).toBe("feature/ai-agent");
    expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toEqual({
      path: "src/auth/AuthGate.tsx",
      diff: expect.stringContaining("diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx"),
      staged: true,
      source: "file",
    });
    expect(onPreviewOpen).toHaveBeenCalledWith({
      path: "src/auth/AuthGate.tsx",
      diff: expect.stringContaining("diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx"),
      staged: true,
      source: "file",
    });
    expect(dispatchEventSpy).not.toHaveBeenCalled();
  });

  it("auto-selects the first change from hydrated state without emitting a workspace diff event", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === "git.diff") {
        return {
          diff: `diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx\n${JSON.stringify(args)}`,
        };
      }

      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }

      if (op === "git.log") {
        return {
          entries: [],
        };
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(gitStateAtomFamily("ws-test"), status);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.diff",
        {
          workspaceId: "ws-test",
          path: "src/auth/AuthGate.tsx",
          staged: true,
        },
        undefined
      );
    });

    expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toEqual({
      path: "src/auth/AuthGate.tsx",
      diff: expect.stringContaining("diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx"),
      staged: true,
      source: "file",
    });
    expect(dispatchEventSpy).not.toHaveBeenCalled();
  });

  it("does not auto-reopen the first diff after the preview is manually dismissed", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === "git.diff") {
        return {
          diff: `diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx\n${JSON.stringify(args)}`,
        };
      }

      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(gitStateAtomFamily("ws-test"), status);
    store.set(gitDiffPreviewDismissedAtomFamily("ws-test"), true);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText("AuthGate.tsx")).toBeInTheDocument();
    });

    expect(sendCommand).not.toHaveBeenCalledWith(
      "git.diff",
      expect.objectContaining({
        workspaceId: "ws-test",
      })
    );
    expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toBeNull();
  });

  it("retries a refresh request after the in-flight git status load finishes", async () => {
    let resolveFirst: ((value: GitStatus) => void) | null = null;
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "git.status") {
        return new Promise<GitStatus>((resolve) => {
          if (!resolveFirst) {
            resolveFirst = resolve;
            return;
          }

          resolve({
            ...status,
            modified: [],
            untracked: [],
            deleted: [],
          });
        });
      }

      if (op === "git.branches") {
        return Promise.resolve({ current: "feature/ai-agent", branches: [] });
      }

      if (op === "git.diff") {
        return Promise.resolve({
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        });
      }

      return Promise.resolve({});
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    const { rerender } = render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" refreshToken={0} />
      </Provider>
    );

    rerender(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" refreshToken={1} />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("git.status", { workspaceId: "ws-test" }, undefined);
    });

    expect(resolveFirst).not.toBeNull();
    resolveFirst!(status);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledTimes(3);
    });
  });

  it("stages modified, deleted, and untracked files from the merged changes section action", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }
      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }
      if (op === "git.log") {
        return {
          entries: [],
        };
      }

      if (op === "worktree.list") {
        return {
          worktrees: [],
        };
      }

      return {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const changesSection = (await screen.findByText("Changes")).closest(".git-panel-section");
    expect(changesSection).not.toBeNull();

    fireEvent.click(
      within(changesSection as HTMLElement).getByRole("button", { name: "Stage All" })
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.stage",
        {
          workspaceId: "ws-test",
          paths: [
            "src/app/AppController.tsx",
            "src/legacy/deprecated.ts",
            "tests/supervisor.test.ts",
          ],
        },
        undefined
      );
    });
  });

  it("shows an error toast when staging fails", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }
      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }
      if (op === "git.log") {
        return {
          entries: [],
        };
      }
      if (op === "worktree.list") {
        return {
          worktrees: [],
        };
      }
      if (op === "git.stage") {
        throw new CommandResultError({
          code: "git_locked",
          message: "fatal: Unable to create '.git/index.lock': File exists.",
        });
      }

      return {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const changesSection = (await screen.findByText("Changes")).closest(".git-panel-section");
    expect(changesSection).not.toBeNull();

    fireEvent.click(
      within(changesSection as HTMLElement).getByRole("button", { name: "Stage All" })
    );

    await waitFor(() => {
      expect(store.get(toastsAtom)[0]).toMatchObject({
        kind: "error",
        title: "Stage failed",
        body: expect.stringContaining("index.lock"),
      });
    });
  });

  it("preserves shared IconButton classes, tooltip copy, and row click isolation for row actions", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }
      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }
      if (op === "git.log") {
        return {
          entries: [],
        };
      }
      if (op === "worktree.list") {
        return {
          worktrees: [],
        };
      }

      return {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const stagedRow = (await screen.findByText("AuthGate.tsx")).closest(".git-row");
    expect(stagedRow).not.toBeNull();

    const unstageButton = within(stagedRow as HTMLElement).getByRole("button", { name: "Unstage" });
    expect(unstageButton).toHaveClass("btn", "btn-ghost", "btn-sm", "git-row-action");
    expect(unstageButton).not.toHaveAttribute("title");

    fireEvent.mouseEnter(unstageButton);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Unstage");
    fireEvent.mouseLeave(unstageButton);
    expect(screen.queryByRole("tooltip")).toBeNull();

    const changedRow = screen.getByText("AppController.tsx").closest(".git-row");
    expect(changedRow).not.toBeNull();

    const stageButton = within(changedRow as HTMLElement).getByRole("button", { name: "Stage" });
    const discardButton = within(changedRow as HTMLElement).getByRole("button", {
      name: "Discard",
    });
    const initialDiffCallCount = sendCommand.mock.calls.filter(([op]) => op === "git.diff").length;

    expect(stageButton).toHaveClass("btn", "btn-ghost", "btn-sm", "git-row-action");
    expect(discardButton).toHaveClass("btn", "btn-ghost", "btn-sm", "git-row-action");
    expect(stageButton).not.toHaveAttribute("title");
    expect(discardButton).not.toHaveAttribute("title");

    fireEvent.focus(discardButton);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Discard");
    fireEvent.blur(discardButton);

    fireEvent.click(discardButton);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(sendCommand.mock.calls.filter(([op]) => op === "git.diff")).toHaveLength(
      initialDiffCallCount
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(stageButton);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.stage",
        {
          workspaceId: "ws-test",
          paths: ["src/app/AppController.tsx"],
        },
        undefined
      );
    });

    expect(sendCommand.mock.calls.filter(([op]) => op === "git.diff")).toHaveLength(
      initialDiffCallCount
    );
  });

  it("shows an error toast with the unstage title when row-level unstage fails", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }
      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }
      if (op === "git.log") {
        return {
          entries: [],
        };
      }
      if (op === "worktree.list") {
        return {
          worktrees: [],
        };
      }
      if (op === "git.unstage") {
        throw new CommandResultError({
          code: "git_locked",
          message: "fatal: Unable to create '.git/index.lock': File exists.",
        });
      }

      return {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const row = (await screen.findByText("AuthGate.tsx")).closest(".git-row");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByRole("button", { name: "Unstage" })).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm",
      "git-row-action"
    );
    expect(within(row as HTMLElement).getByRole("button", { name: "Discard" })).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm",
      "git-row-action"
    );

    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Unstage" }));

    await waitFor(() => {
      expect(store.get(toastsAtom)[0]).toMatchObject({
        kind: "error",
        title: "Unstage failed",
        body: expect.stringContaining("index.lock"),
      });
    });
  });

  it("shows an error toast with the stage title when row-level stage fails", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }
      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }
      if (op === "git.log") {
        return {
          entries: [],
        };
      }
      if (op === "worktree.list") {
        return {
          worktrees: [],
        };
      }
      if (op === "git.stage") {
        throw new CommandResultError({
          code: "git_locked",
          message: "fatal: Unable to create '.git/index.lock': File exists.",
        });
      }

      return {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const row = (await screen.findByText("AppController.tsx")).closest(".git-row");
    expect(row).not.toBeNull();

    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Stage" }));

    await waitFor(() => {
      expect(store.get(toastsAtom)[0]).toMatchObject({
        kind: "error",
        title: "Stage failed",
        body: expect.stringContaining("index.lock"),
      });
    });
  });

  it("allows manually retrying worktree.list after the initial load fails", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }

      if (op === "git.branches") {
        return { current: "feature/ai-agent", branches: [] };
      }

      if (op === "git.log") {
        return { entries: [] };
      }

      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }

      if (op === "worktree.list") {
        throw new Error("boom");
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    expect(await screen.findByText("Worktrees")).toBeInTheDocument();

    await waitFor(() => {
      expect(sendCommand.mock.calls.filter(([op]) => op === "worktree.list")).toHaveLength(1);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sendCommand.mock.calls.filter(([op]) => op === "worktree.list")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Worktrees0" }));
    const errorText = await screen.findByText("boom");
    const errorShell = errorText.closest(".git-panel-empty");

    expect(errorShell).not.toBeNull();
    expect(errorShell).toHaveStyle({
      minHeight: "auto",
      padding: "12px 0",
      gap: "4px",
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(sendCommand.mock.calls.filter(([op]) => op === "worktree.list")).toHaveLength(2);
    });
  });

  it("shows a section-level discard action for the merged changes group only", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }
      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }
      if (op === "git.log") {
        return {
          entries: [],
        };
      }
      if (op === "worktree.list") {
        return {
          worktrees: [],
        };
      }
      return {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const stagedSection = (await screen.findByText("Staged")).closest(".git-panel-section");
    const changesSection = screen.getByText("Changes").closest(".git-panel-section");

    expect(stagedSection).not.toBeNull();
    expect(changesSection).not.toBeNull();
    expect(
      within(stagedSection as HTMLElement).queryByRole("button", { name: "Discard All" })
    ).toBeNull();
    expect(
      within(changesSection as HTMLElement).getByRole("button", { name: "Discard All" })
    ).toBeInTheDocument();
  });

  it("discards only the merged changes group files after section confirmation", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }
      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }
      if (op === "git.log") {
        return {
          entries: [],
        };
      }
      if (op === "worktree.list") {
        return {
          worktrees: [],
        };
      }
      return {};
    });
    const store = createStore();
    store.set(localeAtom, "zh");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const changesSection = (await screen.findByText("更改")).closest(".git-panel-section");
    expect(changesSection).not.toBeNull();

    fireEvent.click(
      within(changesSection as HTMLElement).getByRole("button", { name: "放弃全部" })
    );

    expect(screen.getByText("放弃所有更改")).toBeInTheDocument();
    expect(screen.getByText("确定要放弃 3 个文件的更改吗？")).toBeInTheDocument();

    const modal = screen.getByText("放弃所有更改").closest(".modal-card");
    expect(modal).not.toBeNull();
    fireEvent.click(within(modal as HTMLElement).getByRole("button", { name: /^放弃$/ }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.discard",
        {
          workspaceId: "ws-test",
          paths: [
            "src/app/AppController.tsx",
            "src/legacy/deprecated.ts",
            "tests/supervisor.test.ts",
          ],
        },
        undefined
      );
    });
  });

  it("requires confirmation before discarding a single file", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }
      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }
      return {};
    });
    const store = createStore();
    store.set(localeAtom, "zh");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const row = (await screen.findByText("AppController.tsx")).closest(".git-row");
    expect(row).not.toBeNull();

    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "放弃" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("放弃文件更改")).toBeInTheDocument();
    expect(
      screen.getByText("确定要放弃 “src/app/AppController.tsx” 的更改吗？")
    ).toBeInTheDocument();
    expect(screen.getByText("此操作不可恢复。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(sendCommand).not.toHaveBeenCalledWith("git.discard", {
      workspaceId: "ws-test",
      paths: ["src/app/AppController.tsx"],
    });
  });

  it("discards a single file only after confirmation", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }
      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }
      return {};
    });
    const store = createStore();
    store.set(localeAtom, "zh");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const row = (await screen.findByText("AppController.tsx")).closest(".git-row");
    expect(row).not.toBeNull();

    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "放弃" }));
    const dialog = screen.getByRole("dialog");
    const modal = dialog.closest(".modal-card") ?? dialog;
    expect(modal).not.toBeNull();
    fireEvent.click(within(modal as HTMLElement).getByRole("button", { name: /^放弃$/ }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.discard",
        {
          workspaceId: "ws-test",
          paths: ["src/app/AppController.tsx"],
        },
        undefined
      );
    });
  });

  it("shows a discard-all confirmation with the affected file count from the changes group", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }
      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }
      return {};
    });
    const store = createStore();
    store.set(localeAtom, "zh");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const changesSection = (await screen.findByText("更改")).closest(".git-panel-section");
    expect(changesSection).not.toBeNull();

    fireEvent.click(
      within(changesSection as HTMLElement).getByRole("button", { name: "放弃全部" })
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("放弃所有更改")).toBeInTheDocument();
    expect(screen.getByText("确定要放弃 3 个文件的更改吗？")).toBeInTheDocument();

    const dialog = screen.getByRole("dialog");
    const modal = dialog.closest(".modal-card") ?? dialog;
    expect(modal).not.toBeNull();
    fireEvent.click(within(modal as HTMLElement).getByRole("button", { name: /^放弃$/ }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.discard",
        {
          workspaceId: "ws-test",
          paths: [
            "src/app/AppController.tsx",
            "src/legacy/deprecated.ts",
            "tests/supervisor.test.ts",
          ],
        },
        undefined
      );
    });
  });

  it("renders discard confirmation actions with shared button compatibility classes", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }
      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }
      return {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Discard All" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("This action cannot be undone.")).toBeInTheDocument();
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    const modal = cancelButton.closest(".modal-card") ?? screen.getByRole("dialog");
    expect(modal).not.toBeNull();

    expect(cancelButton).toHaveClass("btn", "btn-secondary");
    expect(within(modal as HTMLElement).getByRole("button", { name: /^Discard$/ })).toHaveClass(
      "btn",
      "btn-danger"
    );
    expect(within(modal as HTMLElement).getByRole("button", { name: "Close" })).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm"
    );
  });

  it("allows discarding a staged file after confirmation", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }
      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }
      return {};
    });
    const store = createStore();
    store.set(localeAtom, "zh");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const row = (await screen.findByText("AuthGate.tsx")).closest(".git-row");
    expect(row).not.toBeNull();

    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "放弃" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    const modal = dialog.closest(".modal-card") ?? dialog;
    expect(modal).not.toBeNull();
    fireEvent.click(within(modal as HTMLElement).getByRole("button", { name: /^放弃$/ }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.discard",
        {
          workspaceId: "ws-test",
          paths: ["src/auth/AuthGate.tsx"],
        },
        undefined
      );
    });
  });

  it("requires explicit confirmation before discarding all changes", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }
      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }
      return {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Discard All" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(sendCommand).not.toHaveBeenCalledWith(
      "git.discard",
      {
        workspaceId: "ws-test",
        paths: [
          "src/auth/AuthGate.tsx",
          "src/app/AppController.tsx",
          "src/legacy/deprecated.ts",
          "tests/supervisor.test.ts",
        ],
      },
      undefined
    );
  });

  it("renders translated Chinese panel copy when locale is zh", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }
      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx",
        };
      }
      return {};
    });
    const store = createStore();
    store.set(localeAtom, "zh");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    expect((await screen.findAllByText("已暂存")).length).toBeGreaterThan(0);
    expect(screen.getByText("更改")).toBeInTheDocument();
    expect(screen.queryByText("未跟踪")).toBeNull();
    expect(screen.getByPlaceholderText("输入提交信息...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "刷新" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "放弃全部" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "暂存全部" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "取消暂存全部" })).toBeInTheDocument();

    const commitBlock = screen.getByPlaceholderText("输入提交信息...").closest(".git-commit-block");
    expect(commitBlock).not.toBeNull();
    expect(within(commitBlock as HTMLElement).queryByRole("button", { name: "放弃" })).toBeNull();
    expect(
      within(commitBlock as HTMLElement).queryByRole("button", { name: "暂存全部" })
    ).toBeNull();
    expect(
      within(commitBlock as HTMLElement).getByRole("button", { name: "提交" })
    ).toBeInTheDocument();

    const untrackedRow = screen.getByText("supervisor.test.ts").closest(".git-row");
    expect(untrackedRow).not.toBeNull();
    expect(
      (untrackedRow as HTMLElement).querySelector('[data-icon-semantic="git.status.untracked"]')
    ).toBeTruthy();
    expect((untrackedRow as HTMLElement).querySelector(".git-row-icon")).toBeTruthy();
    expect(
      (untrackedRow as HTMLElement).querySelector('[data-icon-semantic="git.status.untracked"]')
    ).toBeTruthy();
    expect(within(untrackedRow as HTMLElement).queryByText("tests/")).toHaveClass("git-row-dir");
  });

  it("renders add and discard row actions on mobile like desktop", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return { current: "feature/ai-agent", branches: [] };
      }
      if (op === "worktree.list") {
        return { worktrees: [] };
      }
      if (op === "git.log") {
        return { entries: [] };
      }
      if (op === "git.diff") {
        return { diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx" };
      }
      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" variant="mobile" />
      </Provider>
    );

    const changesToggle = (await screen.findByText("Changes")).closest("button");
    expect(changesToggle).not.toBeNull();
    fireEvent.click(changesToggle as HTMLElement);

    const row = (await screen.findByText("supervisor.test.ts")).closest(".git-row");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByRole("button", { name: "Stage" })).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm",
      "git-row-action"
    );
    expect(within(row as HTMLElement).getByRole("button", { name: "Discard" })).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm",
      "git-row-action"
    );
  });

  it("persists the commit message draft across panel remount per workspace", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return { current: "feature/ai-agent", branches: [] };
      }
      if (op === "git.diff") {
        return { diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx" };
      }
      return {};
    });

    const firstStore = createStore();
    firstStore.set(localeAtom, "zh");
    firstStore.set(wsClientAtom, { sendCommand } as never);

    const firstMount = render(
      <Provider store={firstStore}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const textarea = (await screen.findByPlaceholderText("输入提交信息...")) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "wip: persist me" } });

    await waitFor(() => {
      expect(textarea.value).toBe("wip: persist me");
    });

    firstMount.unmount();

    const secondStore = createStore();
    secondStore.set(localeAtom, "zh");
    secondStore.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={secondStore}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const restoredTextarea = (await screen.findByPlaceholderText(
      "输入提交信息..."
    )) as HTMLTextAreaElement;
    expect(restoredTextarea.value).toBe("wip: persist me");

    const otherStore = createStore();
    otherStore.set(localeAtom, "zh");
    otherStore.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={otherStore}>
        <GitPanel workspaceId="ws-other" />
      </Provider>
    );

    const otherTextareas = (await screen.findAllByPlaceholderText(
      "输入提交信息..."
    )) as HTMLTextAreaElement[];
    const otherTextarea = otherTextareas[otherTextareas.length - 1];
    expect(otherTextarea?.value).toBe("");
  });

  it("clears the persisted commit draft for the workspace after a successful commit", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }
      if (op === "git.branches") {
        return { current: "feature/ai-agent", branches: [] };
      }
      if (op === "git.diff") {
        return { diff: "diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx" };
      }
      if (op === "git.commit") {
        return undefined;
      }
      return {};
    });

    const store = createStore();
    store.set(localeAtom, "zh");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const textarea = (await screen.findByPlaceholderText("输入提交信息...")) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "feat: ship it" } });

    await waitFor(() => {
      expect(textarea.value).toBe("feat: ship it");
    });

    const commitButton = await screen.findByRole("button", { name: "提交" });
    fireEvent.click(commitButton);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.commit",
        { workspaceId: "ws-test", message: "feat: ship it" },
        undefined
      );
    });

    await waitFor(() => {
      expect(textarea.value).toBe("");
    });

    const persistedDraftKeys = Object.keys(window.localStorage).filter((key) =>
      key.includes("git-commit-draft")
    );
    for (const key of persistedDraftKeys) {
      const raw = window.localStorage.getItem(key);
      if (raw === null) {
        continue;
      }
      expect(JSON.parse(raw)).toBe("");
    }
  });
});
