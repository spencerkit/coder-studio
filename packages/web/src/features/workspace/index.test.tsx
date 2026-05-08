import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectionStatusAtom, wsClientAtom } from "../../atoms/connection";
import { activeWorkspaceIdAtom, workspaceOrderAtom, workspacesAtom } from "../../atoms/workspaces";
import { seedReadyWorkspaceState } from "../../test-utils/workspace-state";
import { branchQuickPickAtom, gitDiffPreviewAtomFamily, terminalPanelVisibleAtom } from "./atoms";
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
  });

  it("loads git status on mount so the file view shows the active branch", async () => {
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

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.status",
        {
          workspaceId: "ws-test",
        },
        undefined
      );
    });

    expect(await screen.findByText("feature/refactor-ts")).toBeInTheDocument();
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

    const branchButton = await screen.findByRole("button", {
      name: "Open branch switcher for feature/refactor-ts",
    });
    fireEvent.click(branchButton);

    expect(screen.getByRole("button", { name: "Git" })).toHaveClass("active");
    expect(store.get(branchQuickPickAtom)).toEqual({
      visible: true,
      workspaceId: "ws-test",
      inputValue: "",
    });
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

    fireEvent.click(await screen.findByRole("button", { name: "Git" }));

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
});
