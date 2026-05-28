import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lastViewedTargetAtom } from "../../atoms/app-ui";
import { connectionStatusAtom, wsClientAtom } from "../../atoms/connection";
import { activeWorkspaceIdAtom, workspaceOrderAtom, workspacesAtom } from "../../atoms/workspaces";
import { seedReadyWorkspaceState } from "../../test-utils/workspace-state";
import { activeEditorPaneIdAtomFamily } from "../agent-panes/atoms/editor-panes";
import { paneLayoutAtomFamily } from "../agent-panes/atoms/pane-layout";
import { updateStateAtom } from "../updates/atoms";
import {
  activeFilePathAtomFamily,
  bottomPanelHeightAtom,
  branchQuickPickAtom,
  editorModeAtomFamily,
  gitDiffPreviewAtomFamily,
  leftPanelWidthAtom,
  openFilesAtomFamily,
  terminalPanelVisibleAtom,
} from "./atoms";
import { WorkspaceDesktopView } from "./views/desktop/workspace-desktop-view";

const fileTreePanelSpy = vi.fn();

vi.mock("../topbar", () => ({
  TopBar: () => <div data-testid="topbar" />,
}));

vi.mock("../agent-panes", () => ({
  AgentPanes: () => <div data-testid="agent-panes" />,
}));

vi.mock("../terminal-panel", () => ({
  TerminalPanel: () => <div data-testid="terminal-panel" />,
}));

vi.mock("./views/shared/file-tree-panel", () => ({
  FileTreePanel: (props: unknown) => {
    fileTreePanelSpy(props);
    return <div data-testid="file-tree-panel" />;
  },
}));

vi.mock("./views/shared/git-panel", () => ({
  GitPanel: () => <div data-testid="git-panel" />,
}));

vi.mock("./views/shared/git-diff-viewer", () => ({
  GitDiffViewer: ({ onClose }: { onClose?: () => void }) => (
    <div data-testid="git-diff-viewer">
      <button type="button" onClick={onClose}>
        关闭
      </button>
    </div>
  ),
}));

vi.mock("../code-editor/views/shared/code-editor-host", () => ({
  CodeEditorHost: () => <div data-testid="code-editor-host" />,
}));

describe("WorkspacePage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    fileTreePanelSpy.mockReset();
    window.localStorage.clear();
    document.body.classList.remove("is-resizing-panels");
  });

  it("loads git status on mount so the file view shows the active branch", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "feature/refactor-ts",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [{ path: "src/app.tsx", status: "modified" }],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(updateStateAtom, {
      version: 1,
      currentVersion: "0.4.0",
      latestVersion: "0.5.0",
      availability: "update_available",
      updateStatus: "idle",
      lastCheckedAt: 123,
      targetVersion: null,
      startedAt: null,
      finishedAt: null,
      requiresManualStep: false,
      manualCommand: null,
      errorSummary: null,
      supported: true,
      installKind: "global_npm",
      unsupportedReason: null,
    });
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.status",
        {
          workspaceId: "ws-test",
        },
        undefined
      );
    });

    await screen.findByText("feature/refactor-ts");

    expect(document.querySelector(".workspace-page.workspace-page--desktop")).toBeTruthy();
    expect(document.querySelector(".workspace-main-stage")).toBeTruthy();
    expect(document.querySelector(".workspace-main-area > .workspace-main-stage")).toBeTruthy();
    expect(document.querySelector(".workspace-status-bar__left")).not.toBeNull();
    expect(document.querySelector(".workspace-status-bar__right")).not.toBeNull();
    expect(
      document.querySelector(".workspace-status-bar__left .git-panel-status-strip__branch-text")
    ).toHaveTextContent("feature/refactor-ts");
    expect(document.querySelector(".workspace-page > .workspace-status-bar")).not.toBeNull();
    expect(document.querySelector(".workspace-status-bar__right")).toHaveTextContent("v0.5.0");
    expect(document.querySelector(".workspace-sidebar-panel__tab-count")).toBeNull();
  });

  it("shows file actions without a separate refresh action in the desktop sidebar", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByTestId("file-tree-panel");
    expect(screen.getByRole("button", { name: /^new file$|^新建文件$/i })).toBeInTheDocument();
    expect(document.querySelector('[data-icon-semantic="file.action.new"]')).toBeTruthy();
    expect(document.querySelector('[data-icon-semantic="file.action.newFolder"]')).toBeTruthy();
    expect(screen.queryByRole("button", { name: /refresh|刷新/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Source Control|源代码管理/i }));

    expect(screen.getByTestId("git-panel")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^new file$|^新建文件$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /refresh|刷新/i })).toBeNull();
  });

  it("opens branch quick pick from the existing branch pill and switches to git tab", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "feature/refactor-ts",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      if (op === "git.branches") {
        return {
          current: "feature/refactor-ts",
          branches: [
            { name: "feature/refactor-ts", isCurrent: true, isRemote: false },
            { name: "origin/main", isCurrent: false, isRemote: true },
          ],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByText("feature/refactor-ts");

    const branchButton = document.querySelector(
      ".workspace-status-bar .git-panel-status-strip__branch"
    );
    expect(branchButton).not.toBeNull();
    expect(branchButton?.querySelector('[data-icon-semantic="git.footer.branch"]')).toBeTruthy();
    fireEvent.click(branchButton as HTMLElement);

    const sourceControlButton = screen.getByRole("button", { name: /Source Control|源代码管理/i });
    expect(
      screen.getByRole("navigation", { name: /Workspace activity bar|工作区活动栏/i })
    ).toBeInTheDocument();
    expect(sourceControlButton).toHaveAttribute("aria-pressed", "true");
    expect(
      await screen.findByPlaceholderText("Search branches or create new branch...")
    ).toBeInTheDocument();
    expect(store.get(branchQuickPickAtom)).toEqual({
      visible: true,
      workspaceId: "ws-test",
      inputValue: "",
    });
  });

  it("uses workspace activity bar styling without legacy tab chrome", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByRole("button", { name: /Explorer|资源管理器/i });

    expect(document.querySelector(".workspace-activity-bar")).toBeTruthy();
    expect(document.querySelector('[data-icon-semantic="nav.explorer"]')).toBeTruthy();
    expect(document.querySelector('[data-icon-semantic="nav.search"]')).toBeTruthy();
    expect(document.querySelector('[data-icon-semantic="nav.sourceControl"]')).toBeTruthy();
    expect(document.querySelector(".workspace-sidebar-panel__tabs")).toBeNull();
    expect(document.querySelector(".workspace-sidebar-panel__tab")).toBeNull();
  });

  it("renders an explorer-first activity bar and removes the desktop tree search box", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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
    store.set(openFilesAtomFamily("ws-test"), {
      "README.md": {
        kind: "text",
        path: "README.md",
        content: "# README",
        savedContent: "# README",
        baseHash: "hash-readme",
        isDirty: false,
      },
      "src/app.tsx": {
        kind: "text",
        path: "src/app.tsx",
        content: "export const app = true;",
        savedContent: "export const app = true;",
        baseHash: "hash-app",
        isDirty: false,
      },
    });
    store.set(activeFilePathAtomFamily("ws-test"), "src/app.tsx");

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByText(/Open Editors|打开的编辑器/i);

    const explorerButton = screen.getByRole("button", { name: /Explorer|资源管理器/i });
    expect(explorerButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "README.md" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "src/app.tsx" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Search files|搜索文件/i)).toBeNull();
    expect(document.querySelector(".workspace-activity-bar")).toBeTruthy();
  });

  it("switches desktop sidebar views from the activity bar", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Search|搜索/i }));
    expect(await screen.findByRole("searchbox", { name: /Search|搜索/i })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: /Results|结果/i,
      })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Source Control|源代码管理/i }));
    expect(screen.getByTestId("git-panel")).toBeInTheDocument();
  });

  it("mounts desktop workspace navigation shortcuts and switches workspaces on Ctrl+Shift+ArrowRight", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, payload: unknown) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      if (op === "session.list") {
        return [];
      }

      if (op === "workspace.lastViewedTarget.set") {
        const target = payload as { workspaceId: string; sessionId?: string };
        return {
          workspaceId: target.workspaceId,
          sessionId: target.sessionId,
          updatedAt: 10,
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-a": {
        id: "ws-a",
        path: "/workspace-a",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
          activeSessionId: "sess-a",
        },
      },
      "ws-b": {
        id: "ws-b",
        path: "/workspace-b",
        targetRuntime: "native",
        openedAt: 2,
        lastActiveAt: 2,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
          activeSessionId: "sess-b",
        },
      },
    });
    store.set(activeWorkspaceIdAtom, "ws-a");
    store.set(paneLayoutAtomFamily("ws-a"), {
      id: "root",
      type: "leaf",
      sessionId: "sess-a",
    });
    store.set(paneLayoutAtomFamily("ws-b"), {
      id: "root",
      type: "leaf",
      sessionId: "sess-b",
    });

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByTestId("file-tree-panel");

    fireEvent.keyDown(window, {
      key: "ArrowRight",
      ctrlKey: true,
      shiftKey: true,
    });

    await waitFor(() => {
      expect(store.get(activeWorkspaceIdAtom)).toBe("ws-b");
    });

    expect(store.get(lastViewedTargetAtom)).toMatchObject({
      workspaceId: "ws-b",
    });
  });

  it("renders the content search input when the Search activity item is active", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      if (op === "file.searchContent") {
        return {
          files: [],
          totalMatchCount: 0,
          hasMoreFiles: false,
          truncatedMatchFileCount: 0,
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Search|搜索/i }));
    expect(await screen.findByRole("searchbox", { name: /Search|搜索/i })).toBeInTheDocument();
  });

  it("keeps sidebar view and terminal visibility isolated per workspace tab instance", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-a": {
        id: "ws-a",
        path: "/workspace-a",
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
        path: "/workspace-b",
        targetRuntime: "native",
        openedAt: 2,
        lastActiveAt: 2,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(activeWorkspaceIdAtom, "ws-a");

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByTestId("file-tree-panel");

    fireEvent.click(screen.getByRole("button", { name: /Search|搜索/i }));
    expect(await screen.findByRole("searchbox", { name: /Search|搜索/i })).toBeInTheDocument();

    act(() => {
      store.set(terminalPanelVisibleAtom, false);
    });

    expect(screen.queryByTestId("terminal-panel")).toBeNull();

    act(() => {
      store.set(activeWorkspaceIdAtom, "ws-b");
    });

    await screen.findByTestId("file-tree-panel");
    expect(screen.queryByRole("searchbox", { name: /Search|搜索/i })).toBeNull();
    expect(screen.getByTestId("terminal-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Source Control|源代码管理/i }));
    expect(screen.getByTestId("git-panel")).toBeInTheDocument();

    act(() => {
      store.set(activeWorkspaceIdAtom, "ws-a");
    });

    expect(await screen.findByRole("searchbox", { name: /Search|搜索/i })).toBeInTheDocument();
    expect(screen.queryByTestId("terminal-panel")).toBeNull();

    act(() => {
      store.set(activeWorkspaceIdAtom, "ws-b");
    });

    expect(await screen.findByTestId("git-panel")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-panel")).toBeInTheDocument();
  });

  it("restores content search query and results per workspace tab instance", async () => {
    vi.useFakeTimers();

    const sendCommand = vi
      .fn()
      .mockImplementation(async (op: string, args?: { workspaceId?: string; query?: string }) => {
        if (op === "git.status") {
          return {
            branch: "main",
            ahead: 0,
            behind: 0,
            staged: [],
            modified: [],
            deleted: [],
            untracked: [],
          };
        }

        if (op === "file.searchContent") {
          if (args?.workspaceId === "ws-a" && args.query === "alpha") {
            return {
              files: [
                {
                  path: "src/alpha.tsx",
                  name: "alpha.tsx",
                  matchCount: 1,
                  hasMoreMatches: false,
                  matches: [
                    {
                      line: 3,
                      column: 7,
                      endColumn: 12,
                      preview: "const alpha = true;",
                      previewColumnStart: 7,
                      previewColumnEnd: 12,
                    },
                  ],
                },
              ],
              totalMatchCount: 1,
              hasMoreFiles: false,
              truncatedMatchFileCount: 0,
            };
          }

          if (args?.workspaceId === "ws-b" && args.query === "beta") {
            return {
              files: [
                {
                  path: "src/beta.tsx",
                  name: "beta.tsx",
                  matchCount: 1,
                  hasMoreMatches: false,
                  matches: [
                    {
                      line: 4,
                      column: 7,
                      endColumn: 11,
                      preview: "const beta = true;",
                      previewColumnStart: 7,
                      previewColumnEnd: 11,
                    },
                  ],
                },
              ],
              totalMatchCount: 1,
              hasMoreFiles: false,
              truncatedMatchFileCount: 0,
            };
          }

          return {
            files: [],
            totalMatchCount: 0,
            hasMoreFiles: false,
            truncatedMatchFileCount: 0,
          };
        }

        return [];
      });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-a": {
        id: "ws-a",
        path: "/workspace-a",
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
        path: "/workspace-b",
        targetRuntime: "native",
        openedAt: 2,
        lastActiveAt: 2,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(activeWorkspaceIdAtom, "ws-a");

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Search|搜索/i }));
    const alphaInput = screen.getByRole("searchbox", { name: /Search|搜索/i });
    fireEvent.change(alphaInput, { target: { value: "alpha" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(screen.getByDisplayValue("alpha")).toBeInTheDocument();
    expect(screen.getByText("alpha.tsx")).toBeInTheDocument();

    act(() => {
      store.set(activeWorkspaceIdAtom, "ws-b");
    });

    fireEvent.click(screen.getByRole("button", { name: /Search|搜索/i }));
    const betaInput = screen.getByRole("searchbox", { name: /Search|搜索/i });
    expect(betaInput).toHaveValue("");

    fireEvent.change(betaInput, { target: { value: "beta" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(screen.getByDisplayValue("beta")).toBeInTheDocument();
    expect(screen.getByText("beta.tsx")).toBeInTheDocument();

    act(() => {
      store.set(activeWorkspaceIdAtom, "ws-a");
    });

    expect(screen.getByRole("searchbox", { name: /Search|搜索/i })).toHaveValue("alpha");
    expect(screen.getByText("alpha.tsx")).toBeInTheDocument();
    expect(screen.queryByText("beta.tsx")).toBeNull();

    vi.useRealTimers();
  });

  it("falls back to Explorer when the persisted desktop sidebar view is invalid", async () => {
    window.localStorage.setItem("ui.desktopSidebarView", JSON.stringify("legacy"));

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    const explorerButton = await screen.findByRole("button", { name: /Explorer|资源管理器/i });
    expect(explorerButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("file-tree-panel")).toBeInTheDocument();
  });

  it("ignores sidebar shortcuts while focus is inside an editable field", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: "3", ctrlKey: true });

    expect(screen.queryByTestId("git-panel")).toBeNull();
    expect(screen.getByRole("button", { name: /Explorer|资源管理器/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    input.remove();
  });

  it("does not render a duplicate worktree entry button in the desktop git header", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "feature/refactor-ts",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByText("feature/refactor-ts");

    expect(
      screen.queryByRole("button", {
        name: "查看工作树",
      })
    ).not.toBeInTheDocument();
  });

  it("writes the displayed workspace id on mount and preserves it on unmount", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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

    const { unmount } = render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(store.get(activeWorkspaceIdAtom)).toBe("ws-test");
    });

    unmount();

    expect(store.get(activeWorkspaceIdAtom)).toBe("ws-test");
  });

  it("preserves the active workspace when leaving /workspace and returning later", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    function SettingsTestPage() {
      const navigate = useNavigate();

      return (
        <button type="button" onClick={() => navigate("/workspace")}>
          返回工作区
        </button>
      );
    }

    function WorkspaceRouteControls() {
      const navigate = useNavigate();

      return (
        <>
          <button type="button" onClick={() => navigate("/settings")}>
            打开设置
          </button>
          <WorkspaceDesktopView />
        </>
      );
    }

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-a": {
        id: "ws-a",
        path: "/workspace-a",
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
        path: "/workspace-b",
        targetRuntime: "native",
        openedAt: 2,
        lastActiveAt: 2,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(activeWorkspaceIdAtom, "ws-b");

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceRouteControls />} />
            <Route path="/settings" element={<SettingsTestPage />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByTestId("file-tree-panel");
    expect(store.get(activeWorkspaceIdAtom)).toBe("ws-b");

    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));

    await screen.findByRole("button", { name: "返回工作区" });
    expect(store.get(activeWorkspaceIdAtom)).toBe("ws-b");

    fireEvent.click(screen.getByRole("button", { name: "返回工作区" }));

    await screen.findByTestId("file-tree-panel");
    expect(store.get(activeWorkspaceIdAtom)).toBe("ws-b");
  });

  it("shows the empty state when rendered without an active workspace", async () => {
    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByText("未打开工作区")).toBeInTheDocument();
  });

  it("passes toolbar create requests through to the file tree panel", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    expect(await screen.findByRole("button", { name: "新建文件" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新建文件" }));

    await waitFor(() => {
      expect(fileTreePanelSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          workspaceId: "ws-test",
          createRequest: expect.objectContaining({
            mode: "file",
            baseDir: null,
          }),
        })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "新建文件夹" }));

    await waitFor(() => {
      expect(fileTreePanelSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          workspaceId: "ws-test",
          createRequest: expect.objectContaining({
            mode: "folder",
            baseDir: null,
          }),
        })
      );
    });
  });

  it("keeps agent panes mounted when the bottom terminal panel is hidden", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(terminalPanelVisibleAtom, true);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    expect(await screen.findByTestId("agent-panes")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-panel")).toBeInTheDocument();

    act(() => {
      store.set(terminalPanelVisibleAtom, false);
    });

    expect(screen.getByTestId("agent-panes")).toBeInTheDocument();
    expect(screen.queryByTestId("terminal-panel")).not.toBeInTheDocument();
  });

  it("keeps the session content visible when git diff preview state changes", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    act(() => {
      store.set(gitDiffPreviewAtomFamily("ws-test"), {
        kind: "worktree-file-diff",
        path: "src/app.tsx",
        diff: "diff --git a/src/app.tsx b/src/app.tsx",
        staged: false,
      });
    });

    expect(screen.getByTestId("agent-panes")).toBeInTheDocument();
    expect(screen.queryByTestId("git-diff-viewer")).not.toBeInTheDocument();
    expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toEqual({
      kind: "worktree-file-diff",
      path: "src/app.tsx",
      diff: "diff --git a/src/app.tsx b/src/app.tsx",
      staged: false,
    });
  });

  it("keeps the desktop main area on the editor for active-file diff mode", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [{ path: "src/app.tsx", status: "modified" }],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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
    store.set(activeFilePathAtomFamily("ws-test"), "src/app.tsx");
    store.set(editorModeAtomFamily("ws-test"), "diff");
    store.set(openFilesAtomFamily("ws-test"), {
      "src/app.tsx": {
        kind: "text",
        path: "src/app.tsx",
        content: "const app = 1;",
        savedContent: "const app = 1;",
        baseHash: "hash-app",
        isDirty: false,
      },
    });
    store.set(gitDiffPreviewAtomFamily("ws-test"), {
      kind: "worktree-file-diff",
      path: "src/app.tsx",
      diff: "diff --git a/src/app.tsx b/src/app.tsx",
      staged: false,
      renderAs: "text",
      status: "modified",
      originalContent: "const app = 0;",
      modifiedContent: "const app = 1;",
    });

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByTestId("code-editor-host");
    expect(screen.queryByTestId("git-diff-viewer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agent-panes")).not.toBeInTheDocument();
  });

  it("keeps the desktop main area on agent panes when an active file is targeted at an editor pane", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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
    store.set(activeFilePathAtomFamily("ws-test"), "src/app.tsx");
    store.set(activeEditorPaneIdAtomFamily("ws-test"), "root");
    store.set(paneLayoutAtomFamily("ws-test"), {
      id: "root",
      type: "leaf",
      leafKind: "editor",
    });

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByTestId("agent-panes");
    expect(screen.queryByTestId("code-editor-host")).not.toBeInTheDocument();
  });

  it("does not switch to a dedicated diff page when git preview payload state changes", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [{ path: "src/app.tsx", status: "modified" }],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByTestId("agent-panes");

    act(() => {
      store.set(gitDiffPreviewAtomFamily("ws-test"), {
        kind: "worktree-file-diff",
        path: "src/app.tsx",
        diff: "diff --git a/src/app.tsx b/src/app.tsx",
        staged: false,
        renderAs: "text",
        status: "modified",
        originalContent: "const app = 0;",
        modifiedContent: "const app = 1;",
      });
    });

    expect(screen.getByTestId("agent-panes")).toBeInTheDocument();
    expect(screen.queryByTestId("git-diff-viewer")).not.toBeInTheDocument();
  });

  it("returns from editor mode to the agent session view when close all closes the last desktop editor", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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
    store.set(activeFilePathAtomFamily("ws-test"), "src/app.tsx");
    store.set(editorModeAtomFamily("ws-test"), "edit");
    store.set(openFilesAtomFamily("ws-test"), {
      "src/app.tsx": {
        kind: "text",
        path: "src/app.tsx",
        content: "const app = 1;",
        savedContent: "const app = 1;",
        baseHash: "hash-app",
        isDirty: false,
      },
    });

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByTestId("code-editor-host");
    expect(screen.queryByTestId("agent-panes")).not.toBeInTheDocument();

    const heading = screen.getByRole("heading", { level: 2, name: /(Open Editors|打开的编辑器)/i });
    const section = heading.closest("section") as HTMLElement;
    expect(heading).toHaveTextContent(/Open Editors|打开的编辑器/i);
    expect(within(section).getByText("1")).toHaveClass("workspace-open-editors__count");
    fireEvent.click(within(section).getByRole("button", { name: /Close all|全部关闭/i }));

    await screen.findByTestId("agent-panes");
    expect(within(section).getByText("0")).toHaveClass("workspace-open-editors__count");
    expect(screen.queryByTestId("code-editor-host")).not.toBeInTheDocument();
    expect(store.get(openFilesAtomFamily("ws-test"))).toEqual({});
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
  });

  it("keeps commit-history diff previews reachable on desktop without an active file", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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
    store.set(gitDiffPreviewAtomFamily("ws-test"), {
      kind: "commit-file-list",
      path: "abc123",
      title: "abc123 · commit subject",
      commit: {
        sha: "abc123",
        shortSha: "abc123",
        subject: "commit subject",
        authorName: "Spencer",
        authoredAt: 1,
      },
      files: [
        {
          path: "src/app.tsx",
          status: "modified",
          renderAs: "text",
        },
      ],
    });

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByTestId("code-editor-host");
    expect(screen.queryByTestId("agent-panes")).not.toBeInTheDocument();
  });

  it("keeps commit-history diff previews reachable after close all clears open editors", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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
    store.set(activeFilePathAtomFamily("ws-test"), "src/app.tsx");
    store.set(editorModeAtomFamily("ws-test"), "edit");
    store.set(openFilesAtomFamily("ws-test"), {
      "src/app.tsx": {
        kind: "text",
        path: "src/app.tsx",
        content: "const app = 1;",
        savedContent: "const app = 1;",
        baseHash: "hash-app",
        isDirty: false,
      },
    });
    store.set(gitDiffPreviewAtomFamily("ws-test"), {
      kind: "commit-file-list",
      path: "abc123",
      title: "abc123 · commit subject",
      commit: {
        sha: "abc123",
        shortSha: "abc123",
        subject: "commit subject",
        authorName: "Spencer",
        authoredAt: 1,
      },
      files: [
        {
          path: "src/app.tsx",
          status: "modified",
          renderAs: "text",
        },
      ],
    });

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByTestId("code-editor-host");

    const heading = screen.getByRole("heading", { level: 2, name: /(Open Editors|打开的编辑器)/i });
    const section = heading.closest("section") as HTMLElement;
    fireEvent.click(within(section).getByRole("button", { name: /Close all|全部关闭/i }));

    await screen.findByTestId("code-editor-host");
    expect(screen.queryByTestId("agent-panes")).not.toBeInTheDocument();
    expect(store.get(openFilesAtomFamily("ws-test"))).toEqual({});
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
    expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toEqual({
      kind: "commit-file-list",
      path: "abc123",
      title: "abc123 · commit subject",
      commit: {
        sha: "abc123",
        shortSha: "abc123",
        subject: "commit subject",
        authorName: "Spencer",
        authoredAt: 1,
      },
      files: [
        {
          path: "src/app.tsx",
          status: "modified",
          renderAs: "text",
        },
      ],
    });
  });

  it("clearing the final open editor from Open Editors preserves an active commit preview", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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
    store.set(activeFilePathAtomFamily("ws-test"), "src/app.tsx");
    store.set(editorModeAtomFamily("ws-test"), "edit");
    store.set(openFilesAtomFamily("ws-test"), {
      "src/app.tsx": {
        kind: "text",
        path: "src/app.tsx",
        content: "const app = 1;",
        savedContent: "const app = 1;",
        baseHash: "hash-app",
        isDirty: false,
      },
    });
    store.set(gitDiffPreviewAtomFamily("ws-test"), {
      kind: "commit-file-list",
      path: "abc123",
      title: "abc123 · commit subject",
      commit: {
        sha: "abc123",
        shortSha: "abc123",
        subject: "commit subject",
        authorName: "Spencer",
        authoredAt: 1,
      },
      files: [
        {
          path: "src/app.tsx",
          status: "modified",
          renderAs: "text",
        },
      ],
    });

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByTestId("code-editor-host");
    expect(screen.queryByTestId("agent-panes")).not.toBeInTheDocument();

    const activeRow = screen
      .getByRole("button", { name: "src/app.tsx" })
      .closest(".workspace-open-editors__row") as HTMLElement;
    fireEvent.click(
      within(activeRow).getByRole("button", { name: /^(Close|关闭) src\/app\.tsx$/ })
    );

    await screen.findByTestId("code-editor-host");
    expect(screen.queryByTestId("agent-panes")).not.toBeInTheDocument();
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
    expect(store.get(openFilesAtomFamily("ws-test"))).toEqual({});
    expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toEqual({
      kind: "commit-file-list",
      path: "abc123",
      title: "abc123 · commit subject",
      commit: {
        sha: "abc123",
        shortSha: "abc123",
        subject: "commit subject",
        authorName: "Spencer",
        authoredAt: 1,
      },
      files: [
        {
          path: "src/app.tsx",
          status: "modified",
          renderAs: "text",
        },
      ],
    });
  });

  it("keeps the resized desktop file panel width after dragging the left separator", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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

    const { container } = render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByTestId("file-tree-panel");

    const leftSeparator = screen.getByRole("separator", { name: "Resize left panel" });
    const leftPanel = container.querySelector(".left-panel");

    expect(leftPanel).not.toBeNull();
    expect(store.get(leftPanelWidthAtom)).toBe(280);

    fireEvent.mouseDown(leftSeparator, { clientX: 280 });
    fireEvent.mouseMove(document, { clientX: 264 });

    expect(leftPanel).toHaveStyle({ width: "264px" });
    expect(store.get(leftPanelWidthAtom)).toBe(280);

    fireEvent.mouseUp(document);

    await waitFor(() => {
      expect(store.get(leftPanelWidthAtom)).toBe(264);
    });
    expect(leftPanel).toHaveStyle({ width: "264px" });
  });

  it("toggles the global resizing body class while dragging the desktop file panel separator", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByTestId("file-tree-panel");

    const leftSeparator = screen.getByRole("separator", { name: "Resize left panel" });

    expect(document.body).not.toHaveClass("is-resizing-panels");

    fireEvent.mouseDown(leftSeparator, { clientX: 280 });
    expect(document.body).toHaveClass("is-resizing-panels");

    fireEvent.mouseUp(document);
    await waitFor(() => {
      expect(document.body).not.toHaveClass("is-resizing-panels");
    });
  });

  it("allows the desktop file panel to grow past the previous max width limit", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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

    const { container } = render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByTestId("file-tree-panel");

    const leftSeparator = screen.getByRole("separator", { name: "Resize left panel" });
    const leftPanel = container.querySelector(".left-panel");

    expect(leftPanel).not.toBeNull();

    fireEvent.mouseDown(leftSeparator, { clientX: 280 });
    fireEvent.mouseMove(document, { clientX: 620 });
    expect(leftPanel).toHaveStyle({ width: "620px" });

    fireEvent.mouseUp(document);

    await waitFor(() => {
      expect(store.get(leftPanelWidthAtom)).toBe(620);
    });
  });

  it("allows the bottom terminal panel to grow past the previous max height limit", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(terminalPanelVisibleAtom, true);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
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

    const { container } = render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByTestId("terminal-panel");

    const bottomSeparator = screen.getByRole("separator", { name: "Resize bottom panel" });
    const bottomPanel = container.querySelector(".workspace-bottom-panel");

    expect(bottomPanel).not.toBeNull();

    fireEvent.mouseDown(bottomSeparator, { clientY: 400 });
    fireEvent.mouseMove(document, { clientY: 100 });
    expect(bottomPanel).toHaveStyle({ height: "500px" });

    fireEvent.mouseUp(document);

    await waitFor(() => {
      expect(store.get(bottomPanelHeightAtom)).toBe(500);
    });
  });
});
