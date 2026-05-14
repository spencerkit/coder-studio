import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectionStatusAtom, wsClientAtom } from "../../atoms/connection";
import { activeWorkspaceIdAtom, workspaceOrderAtom, workspacesAtom } from "../../atoms/workspaces";
import { seedReadyWorkspaceState } from "../../test-utils/workspace-state";
import {
  bottomPanelHeightAtom,
  branchQuickPickAtom,
  gitDiffPreviewAtomFamily,
  leftPanelWidthAtom,
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

    expect(
      document.querySelector(".workspace-status-bar .git-panel-status-strip__branch-text")
    ).toHaveTextContent("feature/refactor-ts");
    expect(document.querySelector(".workspace-page > .workspace-status-bar")).not.toBeNull();
    expect(document.querySelector(".workspace-status-bar .git-panel-status-strip")).toHaveClass(
      "git-panel-status-strip--start"
    );
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

    fireEvent.click(screen.getByRole("tab", { name: "Git" }));

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
    expect(branchButton?.querySelector('[data-icon-semantic="git.branch"]')).toBeTruthy();
    fireEvent.click(branchButton as HTMLElement);

    const gitTab = screen.getByRole("tab", { name: "Git" });
    expect(screen.getByRole("tablist", { name: "Workspace sections" })).toBeInTheDocument();
    expect(gitTab).toHaveAttribute("aria-selected", "true");
    expect(gitTab).toHaveClass("workspace-sidebar-panel__tab", "active");
    expect(gitTab).not.toHaveClass("panel-tab");
    expect(
      await screen.findByPlaceholderText("Search branches or create new branch...")
    ).toBeInTheDocument();
    expect(store.get(branchQuickPickAtom)).toEqual({
      visible: true,
      workspaceId: "ws-test",
      inputValue: "",
    });
  });

  it("uses workspace sidebar-specific tab styling without legacy panel-tab classes", async () => {
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

    const filesTab = screen.getByRole("tab", { name: /Files|文件/i });
    const gitTab = screen.getByRole("tab", { name: "Git" });

    expect(filesTab).toHaveClass("workspace-sidebar-panel__tab", "active");
    expect(filesTab).not.toHaveClass("panel-tab");
    expect(gitTab).toHaveClass("workspace-sidebar-panel__tab");
    expect(gitTab).not.toHaveClass("panel-tab");
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

  it("writes the displayed workspace id on mount and clears it on unmount", async () => {
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

    expect(store.get(activeWorkspaceIdAtom)).toBeNull();
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

  it("returns to the session content when closing the git diff viewer", async () => {
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

    fireEvent.click(await screen.findByRole("tab", { name: "Git" }));

    act(() => {
      store.set(gitDiffPreviewAtomFamily("ws-test"), {
        path: "src/app.tsx",
        diff: "diff --git a/src/app.tsx b/src/app.tsx",
        staged: false,
      });
    });

    const closeButton = await screen.findByRole("button", { name: "关闭" });
    fireEvent.click(closeButton);

    await waitFor(() => {
      expect(screen.getByTestId("agent-panes")).toBeInTheDocument();
    });
    expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toBeNull();
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
