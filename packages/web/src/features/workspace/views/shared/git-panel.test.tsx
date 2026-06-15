// @vitest-environment jsdom

import type { GitStatus, TaskDefinition, TaskRun } from "@coder-studio/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { workspacesAtom } from "../../../../atoms/workspaces";
import { CommandResultError } from "../../../../ws/client";
import { toastsAtom } from "../../../notifications/atoms";
import { taskStateAtomFamily } from "../../../tasks/atoms";
import { terminalCommandSidePanelOpenAtomFamily } from "../../../terminal-panel/atoms";
import {
  gitBranchListAtomFamily,
  gitDiffPreviewAtomFamily,
  gitDiffPreviewDismissedAtomFamily,
  gitStateAtomFamily,
} from "../../atoms";
import { GitPanel } from "./git-panel";

describe("GitPanel", () => {
  const originalIntersectionObserver = global.IntersectionObserver;
  let intersectionObserverInstances: Array<{
    callback: IntersectionObserverCallback;
    observe: ReturnType<typeof vi.fn>;
    unobserve: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];

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
    conflicted: [],
  };

  const conflictedStatus: GitStatus = {
    ...status,
    staged: [],
    modified: [],
    untracked: [],
    deleted: [],
    conflicted: [{ path: "src/conflicted.ts", status: "conflicted" }],
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

  const compactListWorktrees = [
    {
      name: "develop",
      path: "/home/spencer/workspace/coder-studio",
      branch: "refs/heads/develop",
      commit: "abc1234",
      status: "dirty" as const,
    },
    {
      name: "performance-monitoring",
      path: "/home/spencer/workspace/coder-studio-performance-monitoring",
      branch: "refs/heads/feat/performance-monitoring",
      commit: "def5678",
      status: "dirty" as const,
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

  function createHistoryEntries(count: number) {
    return Array.from({ length: count }, (_, index) => {
      const ordinal = index + 1;
      const shortSha = `feed${String(ordinal).padStart(3, "0")}`;
      return {
        sha: `${shortSha}${"0".repeat(40 - shortSha.length)}`,
        shortSha,
        subject: `commit ${ordinal}`,
        authorName: "pallyoung",
        authoredAt: Date.now() - index * 60_000,
      };
    });
  }

  const unstagedOnlyStatus: GitStatus = {
    ...status,
    staged: [],
  };

  const verifyTask: TaskDefinition = {
    id: "verify",
    workspaceId: "ws-test",
    kind: "verify",
    label: "Verify",
    command: "pnpm",
    args: ["ci:verify"],
    cwdPath: ".",
    source: "package-json",
    priority: 900,
  };

  const failedVerifyRun: TaskRun = {
    id: "run-verify-1",
    workspaceId: "ws-test",
    taskId: "verify",
    terminalId: "term-verify",
    status: "failed",
    command: "pnpm",
    args: ["ci:verify"],
    cwdPath: ".",
    startedAt: 100,
    finishedAt: 200,
    exitCode: 1,
  };

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
    intersectionObserverInstances = [];
    class IntersectionObserverMock {
      readonly observe = vi.fn();
      readonly unobserve = vi.fn();
      readonly disconnect = vi.fn();
      readonly root: Element | Document | null;
      readonly rootMargin: string;
      readonly thresholds: readonly number[];

      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.root = options?.root ?? null;
        this.rootMargin = options?.rootMargin ?? "";
        this.thresholds = Array.isArray(options?.threshold)
          ? options.threshold
          : [options?.threshold ?? 0];
        intersectionObserverInstances.push({
          callback,
          observe: this.observe,
          unobserve: this.unobserve,
          disconnect: this.disconnect,
        });
      }

      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    global.IntersectionObserver =
      IntersectionObserverMock as unknown as typeof IntersectionObserver;
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.IntersectionObserver = originalIntersectionObserver;
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

    expect(container.querySelector(".git-panel.git-panel--desktop")).toBeTruthy();
    await screen.findByText("History");
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

    await screen.findByText("History");

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

    await screen.findByText("History");

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

    await screen.findByText("History");

    const actionRow = container.querySelector(".git-commit-actions");
    const primaryButton = container.querySelector(".git-commit-primary");

    expect(actionRow).not.toBeNull();
    expect(primaryButton).not.toBeNull();
    expect(actionRow).toContainElement(primaryButton as HTMLElement);
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

    await screen.findByText("History");

    expect(container.querySelector(".git-commit-actions")).not.toBeNull();
    expect(container.querySelector(".git-commit-actions .git-commit-primary")).not.toBeNull();
    expect(container.querySelector(".git-commit-primary-mobile")).toBeNull();
    expect(container.querySelectorAll(".git-commit-actions button")).toHaveLength(1);
    expect(container.querySelector('[data-icon-semantic="git.commit"]')).toBeTruthy();
  });

  it("renders the collapsed git sections in commit, worktrees, staged, changes, history order", async () => {
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
    expect(screen.getByText("Staged")).toBeInTheDocument();
    expect(screen.getByText("Changes")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.queryByText("pr/123-fix-auth")).toBeNull();
    expect(screen.queryByText("feat: refresh source control surface")).toBeNull();
    const summary = screen.getByText("Worktrees");
    const staged = screen.getByText("Staged");
    const changes = screen.getByText("Changes");
    const history = screen.getByText("History");
    const textarea = screen.getByPlaceholderText("Enter commit message...");
    expect(
      textarea.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(summary.compareDocumentPosition(staged) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(staged.compareDocumentPosition(changes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      changes.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("renders full directory paths for changed files", async () => {
    const longDirectory = "packages/web/src/features/workspace/views/shared/";
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          ...status,
          modified: [{ path: `${longDirectory}git-panel.test.tsx`, status: "modified" }],
          deleted: [],
          untracked: [],
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

    const row = (await screen.findByText("git-panel.test.tsx")).closest(".git-row");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText(longDirectory)).toHaveClass("git-row-dir");
    expect(screen.queryByText("packages/web/...")).toBeNull();
  });

  it("toggles the commit composer from the commit section header", async () => {
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

    const commitInput = await screen.findByPlaceholderText("Enter commit message...");
    const commitBlock = commitInput.closest(".git-commit-block");
    const commitToggle = commitBlock?.querySelector("button.git-panel-section-toggle");

    expect(commitBlock).not.toBeNull();
    expect(commitToggle).not.toBeNull();
    expect(commitToggle).toHaveAttribute("aria-expanded", "true");
    expect(commitToggle).toHaveAccessibleName("Collapse Commit");

    fireEvent.click(commitToggle as HTMLButtonElement);

    expect(commitToggle).toHaveAttribute("aria-expanded", "false");
    expect(commitToggle).toHaveAccessibleName("Expand Commit");
    expect(screen.queryByPlaceholderText("Enter commit message...")).toBeNull();
    expect(screen.getByRole("button", { name: /^Commit$/ })).toBeInTheDocument();

    fireEvent.click(commitToggle as HTMLButtonElement);

    expect(await screen.findByPlaceholderText("Enter commit message...")).toBeInTheDocument();
  });

  it("keeps the mobile worktree section between commit and the staged and changes sections", async () => {
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
        <GitPanel workspaceId="ws-test" variant="mobile" />
      </Provider>
    );

    const commitInput = await screen.findByPlaceholderText("Enter commit message...");
    const worktrees = screen.getByText("Worktrees");
    const staged = screen.getByText("Staged");
    const changes = screen.getByText("Changes");
    const history = screen.getByText("History");

    expect(
      commitInput.compareDocumentPosition(worktrees) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      worktrees.compareDocumentPosition(staged) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(staged.compareDocumentPosition(changes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      changes.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("keeps the mobile worktree entry visible even when the list is empty", async () => {
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

    expect(await screen.findByText("Worktrees")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
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

    const historyToggle = await screen.findByRole("button", { name: "History2" });

    expect(historyToggle).toHaveAttribute("aria-expanded", "false");
    expect(historyToggle.querySelector(".git-panel-section-chevron")).not.toBeNull();
  });

  it("renders the desktop changes section as a collapsible header with a chevron", async () => {
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

    const changesToggle = await screen.findByRole("button", { name: "Changes3" });

    expect(changesToggle).toHaveAttribute("aria-expanded", "true");
    expect(changesToggle.querySelector(".git-panel-section-chevron")).not.toBeNull();
  });

  it("renders the desktop staged section as a collapsible header with a chevron", async () => {
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

    const stagedToggle = await screen.findByRole("button", { name: "Staged1" });

    expect(stagedToggle).toHaveAttribute("aria-expanded", "true");
    expect(stagedToggle.querySelector(".git-panel-section-chevron")).not.toBeNull();
  });

  it("toggles the changes list from the changes section header", async () => {
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

    const changesToggle = await screen.findByRole("button", { name: "Changes3" });

    expect(screen.getByText("AuthGate.tsx")).toBeInTheDocument();
    expect(screen.getByText("AppController.tsx")).toBeInTheDocument();

    fireEvent.click(changesToggle);

    expect(changesToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("AuthGate.tsx")).toBeInTheDocument();
    expect(screen.queryByText("AppController.tsx")).toBeNull();
    expect(screen.getByRole("button", { name: "Stage All" })).toBeInTheDocument();

    fireEvent.click(changesToggle);

    expect(changesToggle).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("AppController.tsx")).toBeInTheDocument();
  });

  it("toggles the staged list from the staged section header", async () => {
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

    const stagedToggle = await screen.findByRole("button", { name: "Staged1" });

    expect(screen.getByText("AuthGate.tsx")).toBeInTheDocument();

    fireEvent.click(stagedToggle);

    expect(stagedToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("AuthGate.tsx")).toBeNull();
    expect(screen.getByRole("button", { name: "Unstage All" })).toBeInTheDocument();

    fireEvent.click(stagedToggle);

    expect(stagedToggle).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("AuthGate.tsx")).toBeInTheDocument();
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

  it("keeps worktrees, staged, changes, and history as section toggles inside one continuous git body", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return unstagedOnlyStatus;
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

    const { container } = render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const panel = container.querySelector(".git-panel-scroll");
    const worktreesToggle = await screen.findByRole("button", { name: /Worktrees/ });
    const stagedToggle = screen.getByRole("button", { name: "Staged0" });
    const historyToggle = screen.getByRole("button", { name: "History2" });

    expect(panel).toBeTruthy();
    expect(panel?.querySelectorAll(".git-panel-section")).toHaveLength(5);
    expect(panel?.querySelector(".panel-header")).toBeNull();
    expect(worktreesToggle).toHaveAttribute("aria-expanded", "false");
    expect(stagedToggle).toHaveAttribute("aria-expanded", "true");
    expect(historyToggle).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the compact worktree list to a single row without branch refs", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }

      if (op === "git.branches") {
        return { current: "develop", branches: [] };
      }

      if (op === "worktree.list") {
        return {
          worktrees: compactListWorktrees,
        };
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

    fireEvent.click(await screen.findByRole("button", { name: "Worktrees2" }));

    const removableRow = screen
      .getByRole("button", { name: "Remove performance-monitoring" })
      .closest(".git-worktree-row");

    expect(removableRow).not.toBeNull();
    expect(removableRow?.querySelector(".git-worktree-row__name")).toHaveTextContent(
      "performance-monitoring"
    );
    expect(removableRow?.querySelector(".git-worktree-row__status")).toHaveTextContent(
      "Has changes"
    );
    expect(screen.queryByText("refs/heads/develop")).toBeNull();
    expect(screen.queryByText("refs/heads/feat/performance-monitoring")).toBeNull();
    expect(screen.queryByText("feat/performance-monitoring")).toBeNull();
  });

  it("shows inline delete only for removable worktrees in the compact list", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }

      if (op === "git.branches") {
        return { current: "develop", branches: [] };
      }

      if (op === "worktree.list") {
        return {
          worktrees: compactListWorktrees,
        };
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

    fireEvent.click(await screen.findByRole("button", { name: "Worktrees2" }));

    expect(screen.queryByRole("button", { name: "Remove develop" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Remove performance-monitoring" })
    ).toBeInTheDocument();
  });

  it("removes a dirty compact-list worktree through the existing worktree.remove flow", async () => {
    let worktreeListCalls = 0;
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
      }

      if (op === "git.branches") {
        return { current: "develop", branches: [] };
      }

      if (op === "worktree.list") {
        worktreeListCalls += 1;
        return {
          worktrees:
            worktreeListCalls === 1 ? compactListWorktrees : compactListWorktrees.slice(0, 1),
        };
      }

      if (op === "worktree.remove") {
        return {};
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

    fireEvent.click(await screen.findByRole("button", { name: "Worktrees2" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove performance-monitoring" }));
    expect(screen.getByRole("dialog", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByText("Force remove dirty worktree?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Force Remove" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "worktree.remove",
        {
          workspaceId: "ws-test",
          worktreePath: "/home/spencer/workspace/coder-studio-performance-monitoring",
          force: true,
        },
        undefined
      );
    });
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

  it("persists the global last-viewed target when opening another worktree as a workspace", async () => {
    const sendCommand = vi
      .fn()
      .mockImplementation(async (op: string, args?: Record<string, string>) => {
        if (op === "git.status") {
          return status;
        }

        if (op === "git.branches") {
          return { current: "feature/ai-agent", branches: [] };
        }

        if (op === "worktree.list") {
          return {
            worktrees: [
              {
                name: "main",
                path: "/tmp/ws-test",
                branch: "main",
                commit: "abc1234",
                status: "clean",
              },
              {
                name: "feature/ai-agent",
                path: "/tmp/ws-test-feature",
                branch: "feature/ai-agent",
                commit: "def5678",
                status: "dirty",
              },
            ],
          };
        }

        if (op === "git.log") {
          return { entries: [] };
        }

        if (op === "workspace.open") {
          return {
            id: "ws-opened",
            path: args?.path ?? "/tmp/ws-test-feature",
            targetRuntime: "native",
            openedAt: 1,
            lastActiveAt: 1,
            uiState: {
              leftPanelWidth: 280,
              bottomPanelHeight: 200,
              focusMode: false,
            },
          };
        }

        if (op === "workspace.lastViewedTarget.set") {
          return {
            workspaceId: "ws-opened",
            updatedAt: 10,
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

    const worktreeToggle = await screen.findByRole("button", { name: "Worktrees0" });
    fireEvent.click(worktreeToggle);

    const worktreeButtons = await screen.findAllByRole("button", { name: /feature\/ai-agent/i });
    fireEvent.click(
      worktreeButtons.find((button) =>
        button.classList.contains("git-worktree-row__main")
      ) as HTMLButtonElement
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.lastViewedTarget.set",
        { workspaceId: "ws-opened", sessionId: undefined },
        undefined
      );
    });
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

    expect(await screen.findByRole("button", { name: /^Commit$/ })).toBeInTheDocument();
    expect(screen.getByText("Staged")).toBeInTheDocument();
    expect(screen.getByText("Changes")).toBeInTheDocument();
    expect(screen.queryByText("Untracked")).toBeNull();
    const stagedSection = screen.getByText("Staged").closest(".git-panel-section");
    const changesSection = screen.getByText("Changes").closest(".git-panel-section");
    expect(stagedSection).not.toBeNull();
    expect(changesSection).not.toBeNull();
    expect(within(stagedSection as HTMLElement).getByText("AuthGate.tsx")).toBeInTheDocument();
    expect(within(changesSection as HTMLElement).queryByText("AuthGate.tsx")).toBeNull();
    expect(
      within(changesSection as HTMLElement).getByText("AppController.tsx")
    ).toBeInTheDocument();
    expect(
      within(changesSection as HTMLElement).getByText("supervisor.test.ts")
    ).toBeInTheDocument();
    expect(within(changesSection as HTMLElement).getByText("deprecated.ts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "History0" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Latest Commit")).not.toBeInTheDocument();
  });

  it("surfaces the latest verify result in the git panel", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return status;
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
    store.set(taskStateAtomFamily("ws-test"), {
      tasks: [verifyTask],
      runs: [failedVerifyRun],
      loading: false,
    });

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    expect(screen.getByText("Verification: Failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View Tasks" }));
    expect(store.get(terminalCommandSidePanelOpenAtomFamily("ws-test"))).toBe(true);
    expect(screen.getByRole("button", { name: "Rerun Verify" })).toBeInTheDocument();
  });

  it("renders unmerged conflict files in a merge changes section", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return conflictedStatus;
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

    const mergeChangesSection = (await screen.findByText("Merge Changes")).closest(
      ".git-panel-section"
    );
    const changesSection = screen.getByText("Changes").closest(".git-panel-section");
    expect(mergeChangesSection).not.toBeNull();
    expect(changesSection).not.toBeNull();
    expect(
      within(mergeChangesSection as HTMLElement).getByText("conflicted.ts")
    ).toBeInTheDocument();
    expect(within(changesSection as HTMLElement).queryByText("conflicted.ts")).toBeNull();
    expect(screen.getByRole("button", { name: "Merge Changes1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Changes0" })).toBeInTheDocument();
  });

  it("loads the latest 20 history entries by default and does not render a show-all control", async () => {
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

  it("loads and appends the next history page when the expanded history bottom is reached", async () => {
    const nextHistoryEntries = [
      {
        sha: "7a91234000000000000000000000000000000000",
        shortSha: "7a91234",
        subject: "fix: append older git history",
        authorName: "pallyoung",
        authoredAt: Date.now() - 120_000,
      },
    ];
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
        const logArgs = args as { afterSha?: string };
        if (logArgs.afterSha) {
          return {
            entries: nextHistoryEntries,
            hasMore: false,
          };
        }

        return {
          entries: historyEntries,
          hasMore: true,
        };
      }

      return {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    const { container } = render(
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

    fireEvent.click(await screen.findByRole("button", { name: "History2" }));
    expect(await screen.findByText("feat: refresh source control surface")).toBeInTheDocument();
    expect(screen.getByText("Add worktree management surface spec")).toBeInTheDocument();

    await waitFor(() => {
      expect(intersectionObserverInstances.length).toBeGreaterThan(0);
    });
    const sentinel = container.querySelector(".git-history-load-sentinel");
    expect(sentinel).not.toBeNull();

    await act(async () => {
      intersectionObserverInstances[intersectionObserverInstances.length - 1]?.callback(
        [
          {
            isIntersecting: true,
            target: sentinel,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver
      );
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.log",
        {
          workspaceId: "ws-test",
          limit: 20,
          afterSha: historyEntries[1]!.sha,
        },
        undefined
      );
    });

    expect(await screen.findByText("fix: append older git history")).toBeInTheDocument();
    expect(screen.getByText("feat: refresh source control surface")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "History3" })).toBeInTheDocument();
  });

  it("loads and appends the next history page when the git panel scrolls near the bottom", async () => {
    const nextHistoryEntries = [
      {
        sha: "21c0ffee00000000000000000000000000000000",
        shortSha: "21c0ffe",
        subject: "chore: load older commits while scrolling",
        authorName: "pallyoung",
        authoredAt: Date.now() - 120_000,
      },
    ];
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
        const logArgs = args as { afterSha?: string };
        if (logArgs.afterSha) {
          return {
            entries: nextHistoryEntries,
            hasMore: false,
          };
        }

        return {
          entries: historyEntries,
          hasMore: true,
        };
      }

      return {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    const { container } = render(
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

    fireEvent.click(await screen.findByRole("button", { name: "History2" }));
    expect(await screen.findByText("feat: refresh source control surface")).toBeInTheDocument();

    const panelScrollRoot = container.querySelector(".git-panel-scroll");
    expect(panelScrollRoot).not.toBeNull();
    Object.defineProperties(panelScrollRoot, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 320 },
      scrollTop: { configurable: true, value: 635 },
    });

    fireEvent.scroll(panelScrollRoot as HTMLElement);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.log",
        {
          workspaceId: "ws-test",
          limit: 20,
          afterSha: historyEntries[1]!.sha,
        },
        undefined
      );
    });

    expect(
      await screen.findByText("chore: load older commits while scrolling")
    ).toBeInTheDocument();
    expect(screen.getByText("feat: refresh source control surface")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "History3" })).toBeInTheDocument();
  });

  it("attempts to load the next page when a full initial history page omits hasMore", async () => {
    const firstPageEntries = createHistoryEntries(20);
    const nextHistoryEntries = [
      {
        sha: "9a91234000000000000000000000000000000000",
        shortSha: "9a91234",
        subject: "fix: load fallback history page",
        authorName: "pallyoung",
        authoredAt: Date.now() - 1_500_000,
      },
    ];
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
        const logArgs = args as { afterSha?: string };
        if (logArgs.afterSha) {
          return {
            entries: nextHistoryEntries,
            hasMore: false,
          };
        }

        return {
          entries: firstPageEntries,
        };
      }

      return {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    const { container } = render(
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

    fireEvent.click(await screen.findByRole("button", { name: "History20" }));
    expect(await screen.findByText("commit 1")).toBeInTheDocument();

    const panelScrollRoot = container.querySelector(".git-panel-scroll");
    expect(panelScrollRoot).not.toBeNull();
    Object.defineProperties(panelScrollRoot, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 320 },
      scrollTop: { configurable: true, value: 635 },
    });

    fireEvent.scroll(panelScrollRoot as HTMLElement);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.log",
        {
          workspaceId: "ws-test",
          limit: 20,
          afterSha: firstPageEntries[19]!.sha,
        },
        undefined
      );
    });

    expect(await screen.findByText("fix: load fallback history page")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "History21" })).toBeInTheDocument();
  });

  it("attempts to load the next page when a full initial history page reports hasMore false", async () => {
    const firstPageEntries = createHistoryEntries(20);
    const nextHistoryEntries = [
      {
        sha: "7e570dd000000000000000000000000000000000",
        shortSha: "7e570dd",
        subject: "fix: probe full history page despite false hasMore",
        authorName: "pallyoung",
        authoredAt: Date.now() - 1_500_000,
      },
    ];
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
        const logArgs = args as { afterSha?: string };
        if (logArgs.afterSha) {
          return {
            entries: nextHistoryEntries,
            hasMore: false,
          };
        }

        return {
          entries: firstPageEntries,
          hasMore: false,
        };
      }

      return {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    const { container } = render(
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

    fireEvent.click(await screen.findByRole("button", { name: "History20" }));
    expect(await screen.findByText("commit 1")).toBeInTheDocument();

    const panelScrollRoot = container.querySelector(".git-panel-scroll");
    expect(panelScrollRoot).not.toBeNull();
    Object.defineProperties(panelScrollRoot, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 320 },
      scrollTop: { configurable: true, value: 635 },
    });

    fireEvent.scroll(panelScrollRoot as HTMLElement);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.log",
        {
          workspaceId: "ws-test",
          limit: 20,
          afterSha: firstPageEntries[19]!.sha,
        },
        undefined
      );
    });

    expect(
      await screen.findByText("fix: probe full history page despite false hasMore")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "History21" })).toBeInTheDocument();
  });

  it("keeps history in the git panel scroll flow and loads the next page from the panel bottom", async () => {
    const nextHistoryEntries = [
      {
        sha: "15c0ffee00000000000000000000000000000000",
        shortSha: "15c0ffe",
        subject: "fix: paginate from the git panel scroll root",
        authorName: "pallyoung",
        authoredAt: Date.now() - 120_000,
      },
    ];
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
        const logArgs = args as { afterSha?: string };
        if (logArgs.afterSha) {
          return {
            entries: nextHistoryEntries,
            hasMore: false,
          };
        }

        return {
          entries: historyEntries,
          hasMore: true,
        };
      }

      return {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    const { container } = render(
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

    fireEvent.click(await screen.findByRole("button", { name: "History2" }));
    expect(await screen.findByText("feat: refresh source control surface")).toBeInTheDocument();

    const historyBody = container.querySelector(".git-panel-section-body--history");
    expect(historyBody).not.toBeNull();
    Object.defineProperties(historyBody, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 320 },
      scrollTop: { configurable: true, value: 635 },
    });

    fireEvent.scroll(historyBody as HTMLElement);

    expect(sendCommand).not.toHaveBeenCalledWith(
      "git.log",
      {
        workspaceId: "ws-test",
        limit: 20,
        afterSha: historyEntries[1]!.sha,
      },
      undefined
    );

    const panelScrollRoot = container.querySelector(".git-panel-scroll");
    expect(panelScrollRoot).not.toBeNull();
    Object.defineProperties(panelScrollRoot, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 320 },
      scrollTop: { configurable: true, value: 635 },
    });

    fireEvent.scroll(panelScrollRoot as HTMLElement);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.log",
        {
          workspaceId: "ws-test",
          limit: 20,
          afterSha: historyEntries[1]!.sha,
        },
        undefined
      );
    });

    expect(
      await screen.findByText("fix: paginate from the git panel scroll root")
    ).toBeInTheDocument();
    expect(screen.getByText("feat: refresh source control surface")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "History3" })).toBeInTheDocument();
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

    const noChanges = await screen.findAllByText("No changes");

    expect(noChanges).toHaveLength(2);
    for (const entry of noChanges) {
      const changesShell = entry.closest(".git-panel-empty");
      expect(changesShell).not.toBeNull();
      expect(changesShell).toHaveStyle({
        minHeight: "auto",
        padding: "12px 0",
        gap: "4px",
      });
    }

    fireEvent.click(screen.getByRole("button", { name: "History0" }));

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

      if (op === "git.commitDetail") {
        return {
          commit: historyEntries[0],
          files: [
            {
              path: "src/auth/AuthGate.tsx",
              status: "modified",
              renderAs: "text",
            },
          ],
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

    fireEvent.click(await screen.findByRole("button", { name: "History2" }));

    const historyRow = await screen.findByRole("button", {
      name: /feat: refresh source control surface/i,
    });
    fireEvent.click(historyRow);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.commitDetail",
        {
          workspaceId: "ws-test",
          sha: historyEntries[0]?.sha,
        },
        undefined
      );
    });

    expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toEqual({
      kind: "commit-file-list",
      path: historyEntries[0]?.sha,
      title: `98db173 · ${historyEntries[0]?.subject}`,
      commit: historyEntries[0],
      files: [
        {
          path: "src/auth/AuthGate.tsx",
          status: "modified",
          renderAs: "text",
        },
      ],
    });
    expect(onPreviewOpen).toHaveBeenCalledWith({
      kind: "commit-file-list",
      path: historyEntries[0]?.sha,
      title: `98db173 · ${historyEntries[0]?.subject}`,
      commit: historyEntries[0],
      files: [
        {
          path: "src/auth/AuthGate.tsx",
          status: "modified",
          renderAs: "text",
        },
      ],
    });
    expect(historyRow).toHaveClass("workspace-sidebar-row", "workspace-sidebar-row--selected");
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

    fireEvent.click(await screen.findByRole("button", { name: "History2" }));

    const subject = await screen.findByText("feat: refresh source control surface");
    expect(subject).not.toHaveAttribute("title");
    expect(subject.closest(".git-history-row")).not.toHaveAttribute("title");

    fireEvent.mouseEnter(subject);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("feat: refresh source control surface");
    expect(subject).toHaveAttribute("aria-describedby", tooltip.getAttribute("id") ?? "");
  }, 15_000);

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

  it("keeps the desktop git chrome blocks and active change row visible in the polished shell", async () => {
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

      if (op === "worktree.list") {
        return { worktrees };
      }

      if (op === "git.log") {
        return { entries: historyEntries };
      }

      if (op === "git.diff") {
        return {
          diff: `diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx\n${JSON.stringify(args)}`,
        };
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

    const worktreesToggle = await screen.findByRole("button", { name: /Worktrees/ });
    fireEvent.click(worktreesToggle);
    fireEvent.click(screen.getByText("AuthGate.tsx"));
    fireEvent.click(screen.getByRole("button", { name: "History2" }));

    expect(container.querySelector(".git-panel.git-panel--desktop")).toBeTruthy();
    expect(container.querySelector(".git-commit-block")).toBeTruthy();
    expect(container.querySelector(".git-panel-section")).toBeTruthy();
    expect(await screen.findByText("feature/ai-agent")).toBeInTheDocument();
    expect(container.querySelector(".git-worktree-row")).toBeTruthy();
    expect(await screen.findByText("feat: refresh source control surface")).toBeInTheDocument();
    expect(container.querySelector(".git-history-row")).toBeTruthy();
    await waitFor(() => {
      expect(container.querySelector(".git-row.active")).toBeTruthy();
    });
    expect(container.querySelector(".git-row.active")).toHaveClass(
      "workspace-sidebar-row",
      "workspace-sidebar-row--selected"
    );
    expect(container.querySelector(".git-worktree-row.active .git-worktree-row__main")).toHaveClass(
      "workspace-sidebar-row",
      "workspace-sidebar-row--selected"
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
      kind: "worktree-file-diff",
      path: "src/auth/AuthGate.tsx",
      diff: expect.stringContaining("diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx"),
      staged: true,
    });
    expect(onPreviewOpen).toHaveBeenCalledWith({
      kind: "worktree-file-diff",
      path: "src/auth/AuthGate.tsx",
      diff: expect.stringContaining("diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx"),
      staged: true,
    });
    expect(dispatchEventSpy).not.toHaveBeenCalled();
  });

  it("does not auto-select the first change from hydrated state", async () => {
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
      expect(screen.getByText("AuthGate.tsx")).toBeInTheDocument();
    });

    expect(sendCommand).not.toHaveBeenCalledWith(
      "git.diff",
      expect.objectContaining({
        workspaceId: "ws-test",
      })
    );
    expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toBeNull();
    expect(document.querySelector(".git-row.active")).toBeNull();
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

  it("shows a section-level discard action for the changes group only", async () => {
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
    expect(screen.getByText("Staged")).toBeInTheDocument();
    expect(
      within(changesSection as HTMLElement).getByRole("button", { name: "Discard All" })
    ).toBeInTheDocument();
  });

  it("discards only the changes group files after section confirmation", async () => {
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

    expect(await screen.findByRole("button", { name: /^提交$/ })).toBeInTheDocument();
    expect(screen.getByText("更改")).toBeInTheDocument();
    expect(screen.getByText("已暂存")).toBeInTheDocument();
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

    const modifiedRow = screen.getByText("AppController.tsx").closest(".git-row");
    expect(modifiedRow).not.toBeNull();
    expect(
      (modifiedRow as HTMLElement).querySelector('[data-icon-semantic="git.status.modified"]')
    ).toBeTruthy();
    expect((modifiedRow as HTMLElement).querySelector(".git-row-icon")).toBeTruthy();
    expect(
      (modifiedRow as HTMLElement).querySelector('[data-icon-semantic="git.status.modified"]')
    ).toBeTruthy();
    expect(within(modifiedRow as HTMLElement).queryByText("src/app/")).toHaveClass("git-row-dir");
    const rowContent = (modifiedRow as HTMLElement).querySelector(".git-row-content");
    expect(rowContent?.children[0]).toHaveClass("git-row-name");
    expect(rowContent?.children[1]).toHaveClass("git-row-meta");
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

  it("restores git panel instance state per workspace tab instance", async () => {
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
    store.set(workspacesAtom, {
      "ws-a": {
        id: "ws-a",
        path: "/repo/a",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
      "ws-b": {
        id: "ws-b",
        path: "/repo/b",
        targetRuntime: "native",
        openedAt: 2,
        lastActiveAt: 2,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    } as never);

    const { rerender } = render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-a" />
      </Provider>
    );

    fireEvent.click(await screen.findByRole("button", { name: /Worktrees/ }));
    fireEvent.click(screen.getByRole("button", { name: "Staged1" }));
    fireEvent.click(screen.getByRole("button", { name: "Changes3" }));
    fireEvent.click(screen.getByRole("button", { name: "History2" }));
    fireEvent.click(screen.getByRole("button", { name: "New" }));

    expect(await screen.findByText("pr/123-fix-auth")).toBeInTheDocument();
    expect(screen.queryByText("AuthGate.tsx")).toBeNull();
    expect(await screen.findByLabelText("Branch")).toBeInTheDocument();
    expect(await screen.findByText("feat: refresh source control surface")).toBeInTheDocument();

    rerender(
      <Provider store={store}>
        <GitPanel workspaceId="ws-b" />
      </Provider>
    );

    expect(await screen.findByRole("button", { name: /Worktrees/ })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(screen.getByRole("button", { name: "History2" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(screen.getByRole("button", { name: "Staged1" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByRole("button", { name: "Changes3" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.queryByText("pr/123-fix-auth")).toBeNull();
    expect(screen.getByText("AuthGate.tsx")).toBeInTheDocument();
    expect(screen.queryByText("feat: refresh source control surface")).toBeNull();
    expect(screen.queryByLabelText("Branch")).toBeNull();

    rerender(
      <Provider store={store}>
        <GitPanel workspaceId="ws-a" />
      </Provider>
    );

    expect(await screen.findByRole("button", { name: /Worktrees/ })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByRole("button", { name: "History2" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByRole("button", { name: "Staged1" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(screen.getByRole("button", { name: "Changes3" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(await screen.findByText("pr/123-fix-auth")).toBeInTheDocument();
    expect(screen.queryByText("AuthGate.tsx")).toBeNull();
    expect(await screen.findByText("feat: refresh source control surface")).toBeInTheDocument();
    expect(await screen.findByLabelText("Branch")).toBeInTheDocument();
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

    const commitButton = await screen.findByRole("button", { name: /^提交$/ });
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
