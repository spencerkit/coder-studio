import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { formatDate } from "../../../../lib/i18n";
import { CommandResultError } from "../../../../ws/client";
import { useWorkspaceLaunchActions } from "../../actions/use-workspace-launch-actions";
import { activeFilePathAtomFamily, openEditorPathsAtomFamily } from "../../atoms";
import { WorkspaceLaunchModal } from "./workspace-launch-modal";

const viewportMocks = vi.hoisted(() => ({
  viewport: "desktop" as "desktop" | "mobile",
}));

vi.mock("../../../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  location: { pathname: "/" },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => routerMocks.navigate,
    useLocation: () => routerMocks.location,
  };
});

const activeElementState = {
  current: null as HTMLElement | null,
};

const originalFocus = HTMLElement.prototype.focus;

function WorkspaceLaunchActionsHarness() {
  const actions = useWorkspaceLaunchActions(vi.fn());

  return (
    <div>
      <div data-testid="current-path">{actions.currentPath}</div>
      <div data-testid="recent-workspaces">
        {actions.recentWorkspaces?.map((entry) => entry.path).join("|") ?? ""}
      </div>
      <div data-testid="history-loading">{String(actions.historyLoading)}</div>
      <div data-testid="selected-path">{actions.selectedPath ?? ""}</div>
      <div data-testid="create-folder-error">{actions.createFolderError ?? ""}</div>
      <div data-testid="is-creating-folder">{String(actions.isCreatingFolder)}</div>
      <div data-testid="creating-folder">{String(actions.creatingFolder)}</div>
      <div data-testid="new-folder-name">{actions.newFolderName}</div>
      <button onClick={() => actions.openCreateFolder()}>open-create-folder</button>
      <button onClick={() => actions.closeCreateFolder()}>close-create-folder</button>
      <button onClick={() => actions.handleNavigate("/home/spencer/projects")}>
        navigate-projects
      </button>
      <button onClick={() => actions.handleNavigate("/home/spencer/workspace")}>
        navigate-workspace
      </button>
      <button onClick={() => actions.updateNewFolderName("   ")}>set-empty-name</button>
      <button onClick={() => actions.updateNewFolderName("feature-demo")}>set-valid-name</button>
      <button onClick={() => actions.updateNewFolderName("bad/name")}>set-invalid-name</button>
      <button onClick={() => actions.updateNewFolderName("kept-open")}>set-failing-name</button>
      <button onClick={() => void actions.submitCreateFolder()}>submit-create-folder</button>
    </div>
  );
}

describe("WorkspaceLaunchModal", () => {
  beforeEach(() => {
    activeElementState.current = document.body;

    Object.defineProperty(document, "activeElement", {
      configurable: true,
      get: () => activeElementState.current,
    });

    Object.defineProperty(HTMLElement.prototype, "focus", {
      configurable: true,
      writable: true,
      value: function focus() {
        activeElementState.current = this;
      },
    });
  });

  afterEach(() => {
    viewportMocks.viewport = "desktop";
    routerMocks.navigate.mockReset();
    routerMocks.location.pathname = "/";
    Object.defineProperty(HTMLElement.prototype, "focus", {
      configurable: true,
      writable: true,
      value: originalFocus,
    });
    delete (document as Document & { activeElement?: Element }).activeElement;
    vi.restoreAllMocks();
  });

  it("navigates into a selected folder from the inline enter action", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { path?: string }) => {
      if (op !== "workspace.browse") {
        return {};
      }

      if (args.path === "/home/spencer/workspace") {
        return {
          currentPath: "/home/spencer/workspace",
          parentPath: "/home/spencer",
          directories: [{ name: "coder-studio", path: "/home/spencer/workspace/coder-studio" }],
        };
      }

      return {
        currentPath: "/home/spencer",
        parentPath: "/home",
        directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
      };
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );

    const folderName = await screen.findByText("workspace");
    fireEvent.click(folderName);

    const enterButton = await screen.findByRole("button", { name: "Enter workspace" });
    fireEvent.click(enterButton);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.browse",
        {
          path: "/home/spencer/workspace",
        },
        undefined
      );
    });

    expect(await screen.findByText("coder-studio")).toBeInTheDocument();
  });

  it("uses shared IconButton compatibility classes for the desktop close action", () => {
    const onClose = vi.fn();
    const store = createStore();

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({
        currentPath: "/home/spencer",
        parentPath: "/home",
        directories: [],
      }),
    } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={onClose} />
        </MemoryRouter>
      </Provider>
    );

    const closeButton = screen.getByRole("button", { name: "Close" });
    const homeButton = screen.getByRole("button", { name: "Home Directory" });

    expect(closeButton).toHaveClass("btn", "btn-ghost", "btn-sm", "launch-close-btn");
    expect(homeButton.querySelector('[data-icon-semantic="workspace.launch.home"]')).toBeTruthy();

    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders root chips from browse results instead of hardcoded workspace paths", async () => {
    const store = createStore();

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({
        currentPath: "/Users/tester",
        parentPath: "/Users",
        rootPaths: ["/", "/Users/tester"],
        directories: [],
      }),
    } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );

    expect(await screen.findByText("~")).toBeInTheDocument();
    expect(screen.queryByText("/home/spencer")).not.toBeInTheDocument();
  });

  it("renders the shared empty state when the current directory has no child directories", async () => {
    const store = createStore();

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({
        currentPath: "/home/spencer",
        parentPath: "/home",
        directories: [],
      }),
    } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );

    const emptyMessage = await screen.findByText("No directories found");

    expect(emptyMessage).toBeInTheDocument();
    expect(emptyMessage.closest(".directory-empty")).toBeTruthy();
  });

  it("opens the selected host directory without showing runtime target choices", async () => {
    const onClose = vi.fn();
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { path?: string }) => {
      if (op === "workspace.browse") {
        return {
          currentPath: "/home/spencer",
          parentPath: "/home",
          directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
        };
      }

      if (op === "workspace.open") {
        return {
          id: "ws-1",
          path: "/home/spencer/workspace",
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: {
            leftPanelWidth: 280,
            bottomPanelHeight: 200,
            focusMode: false,
            openEditorPaths: ["src/app.tsx", "README.md"],
            activeEditorPath: "README.md",
          },
        };
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={onClose} />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.queryByRole("button", { name: "Native" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "WSL" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Target:/)).not.toBeInTheDocument();
    expect(screen.queryByText("Local Folder")).not.toBeInTheDocument();
    expect(screen.queryByText("Remote Git")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Start Workspace" })).toBeInTheDocument();
    expect(screen.getAllByText("Select a directory to use as the workspace root.")).toHaveLength(1);
    expect(document.querySelector(".launch-path-display")).toBeNull();

    const folderName = await screen.findByText("workspace");
    fireEvent.click(folderName);
    fireEvent.click(screen.getByRole("button", { name: "Start Workspace" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.open",
        {
          path: "/home/spencer/workspace",
        },
        undefined
      );
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(store.get(openEditorPathsAtomFamily("ws-1"))).toEqual(["src/app.tsx", "README.md"]);
    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("README.md");
  });

  it("shows WSL launch controls on Windows and opens with explicit distro metadata", async () => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Win32");

    const onClose = vi.fn();
    const sendCommand = vi
      .fn()
      .mockImplementation(
        async (
          op: string,
          args?: { path?: string; targetRuntime?: string; wslDistro?: string }
        ) => {
          if (op === "workspace.browse") {
            return {
              currentPath: "/home/spencer",
              parentPath: "/home",
              directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
            };
          }

          if (op === "workspace.history.list") {
            return [];
          }

          if (op === "workspace.wsl.listDistros") {
            return {
              distros: ["Ubuntu-24.04"],
            };
          }

          if (op === "workspace.open") {
            return {
              id: "ws-wsl",
              path: args?.path ?? "/home/spencer/workspace",
              targetRuntime: "wsl",
              wslDistro: args?.wslDistro ?? "Ubuntu-24.04",
              openedAt: 1,
              lastActiveAt: 1,
              uiState: {
                leftPanelWidth: 280,
                bottomPanelHeight: 200,
                focusMode: false,
              },
            };
          }

          return {};
        }
      );

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={onClose} />
        </MemoryRouter>
      </Provider>
    );

    const runtimeSelect = await screen.findByRole("combobox", { name: "Workspace Runtime" });
    expect(screen.getByText("Native Windows")).toBeInTheDocument();
    expect(screen.getByText("WSL")).toBeInTheDocument();

    fireEvent.change(runtimeSelect, { target: { value: "wsl" } });
    fireEvent.change(await screen.findByRole("combobox", { name: "WSL Distribution" }), {
      target: { value: "Ubuntu-24.04" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Workspace Path" }), {
      target: { value: "/home/spencer/workspace" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Workspace" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.open",
        {
          path: "/home/spencer/workspace",
          targetRuntime: "wsl",
          wslDistro: "Ubuntu-24.04",
        },
        undefined
      );
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("renders the folder picker while in WSL launch mode", async () => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Win32");

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "workspace.browse") {
        return {
          currentPath: "/Users/tester",
          parentPath: "/Users",
          directories: [],
        };
      }

      if (op === "workspace.history.list") {
        return [];
      }

      if (op === "workspace.wsl.listDistros") {
        return {
          distros: ["Ubuntu-24.04"],
        };
      }

      if (op === "workspace.wsl.browse") {
        return {
          currentPath: "/home/spencer",
          parentPath: "/home",
          rootPaths: ["/", "/home/spencer"],
          directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
        };
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );

    fireEvent.change(await screen.findByRole("combobox", { name: "Workspace Runtime" }), {
      target: { value: "wsl" },
    });

    expect(await screen.findByText("workspace")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "WSL Distribution" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Workspace Path" })).toHaveValue("/home/spencer");
  });

  it("creates folders through workspace.wsl.mkdir while in WSL mode", async () => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Win32");

    const sendCommand = vi.fn().mockImplementation(async (op: string, args?: { path?: string }) => {
      if (op === "workspace.browse") {
        return {
          currentPath: "/Users/tester",
          parentPath: "/Users",
          directories: [],
        };
      }

      if (op === "workspace.history.list") {
        return [];
      }

      if (op === "workspace.wsl.listDistros") {
        return {
          distros: ["Ubuntu-24.04"],
        };
      }

      if (op === "workspace.wsl.browse") {
        return {
          currentPath: "/home/spencer",
          parentPath: "/home",
          rootPaths: ["/", "/home/spencer"],
          directories:
            args?.path === "/home/spencer"
              ? [
                  { name: "demo", path: "/home/spencer/demo" },
                  { name: "workspace", path: "/home/spencer/workspace" },
                ]
              : [{ name: "workspace", path: "/home/spencer/workspace" }],
        };
      }

      if (op === "workspace.wsl.mkdir") {
        return { ok: true };
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );

    fireEvent.change(await screen.findByRole("combobox", { name: "Workspace Runtime" }), {
      target: { value: "wsl" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "New Folder" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Folder Name" }), {
      target: { value: "demo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Folder" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.wsl.mkdir",
        { distro: "Ubuntu-24.04", path: "/home/spencer/demo" },
        undefined
      );
    });

    expect(await screen.findByText("demo")).toBeInTheDocument();
  });

  it("navigates to /workspace after opening a workspace from outside the workspace page", async () => {
    const onClose = vi.fn();
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { path?: string }) => {
      if (op === "workspace.browse") {
        return {
          currentPath: "/home/spencer",
          parentPath: "/home",
          directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
        };
      }

      if (op === "workspace.open") {
        return {
          id: "ws-1",
        };
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    routerMocks.location.pathname = "/";

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={onClose} />
        </MemoryRouter>
      </Provider>
    );

    const folderName = await screen.findByText("workspace");
    fireEvent.click(folderName);
    fireEvent.click(screen.getByRole("button", { name: "Start Workspace" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.open",
        {
          path: "/home/spencer/workspace",
        },
        undefined
      );
    });

    await waitFor(() => {
      expect(routerMocks.navigate).toHaveBeenCalledWith("/workspace");
    });
  });

  it("redirects failed workspace opens into diagnostics with the selected path preserved", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { path?: string }) => {
      if (op === "workspace.browse") {
        return {
          currentPath: "/home/spencer",
          parentPath: "/home",
          directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
        };
      }

      if (op === "workspace.open") {
        throw new CommandResultError({
          code: "workspace_open_failed",
          message: "Workspace path is no longer available",
        });
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    routerMocks.location.pathname = "/";

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );

    const folderName = await screen.findByText("workspace");
    fireEvent.click(folderName);
    fireEvent.click(screen.getByRole("button", { name: "Start Workspace" }));

    await waitFor(() => {
      expect(routerMocks.navigate).toHaveBeenCalledWith(
        "/diagnostics?context=workspace_open&workspacePath=%2Fhome%2Fspencer%2Fworkspace"
      );
    });
  });

  it("preserves WSL runtime metadata when redirecting failed opens into diagnostics", async () => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Win32");

    const sendCommand = vi
      .fn()
      .mockImplementation(
        async (
          op: string,
          args?: { path?: string; targetRuntime?: string; wslDistro?: string }
        ) => {
          if (op === "workspace.browse") {
            return {
              currentPath: "/home/spencer",
              parentPath: "/home",
              directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
            };
          }

          if (op === "workspace.history.list") {
            return [];
          }

          if (op === "workspace.wsl.listDistros") {
            return {
              distros: ["Ubuntu-24.04"],
            };
          }

          if (op === "workspace.open") {
            throw new CommandResultError({
              code: "workspace_open_failed",
              message: "Workspace path is no longer available",
            });
          }

          return {};
        }
      );

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    routerMocks.location.pathname = "/";

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );

    fireEvent.change(await screen.findByRole("combobox", { name: "Workspace Runtime" }), {
      target: { value: "wsl" },
    });
    fireEvent.change(await screen.findByRole("combobox", { name: "WSL Distribution" }), {
      target: { value: "Ubuntu-24.04" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Workspace Path" }), {
      target: { value: "/home/spencer/workspace" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Workspace" }));

    await waitFor(() => {
      expect(routerMocks.navigate).toHaveBeenCalledWith(
        "/diagnostics?context=workspace_open&workspacePath=%2Fhome%2Fspencer%2Fworkspace&targetRuntime=wsl&wslDistro=Ubuntu-24.04"
      );
    });
  });

  it("persists a workspace-only target after opening a workspace", async () => {
    const onClose = vi.fn();
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { path?: string }) => {
      if (op === "workspace.browse") {
        return {
          currentPath: "/home/spencer",
          parentPath: "/home",
          directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
        };
      }

      if (op === "workspace.open") {
        return {
          id: "ws-1",
        };
      }

      if (op === "workspace.lastViewedTarget.set") {
        return {
          workspaceId: "ws-1",
          updatedAt: 10,
        };
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={onClose} />
        </MemoryRouter>
      </Provider>
    );

    const folderName = await screen.findByText("workspace");
    fireEvent.click(folderName);
    fireEvent.click(screen.getByRole("button", { name: "Start Workspace" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.lastViewedTarget.set",
        { workspaceId: "ws-1", sessionId: undefined },
        undefined
      );
    });
  });

  it("renders recent workspace rows and opens them directly on desktop", async () => {
    const onClose = vi.fn();
    const lastOpenedAt = new Date(2026, 5, 5, 13, 24).getTime();
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { path?: string }) => {
      if (op === "workspace.browse") {
        return {
          currentPath: "/home/spencer",
          parentPath: "/home",
          directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
        };
      }

      if (op === "workspace.history.list") {
        return [
          {
            path: "/repo/coder-studio",
            name: "coder-studio",
            lastOpenedAt,
          },
        ];
      }

      if (op === "workspace.open") {
        return {
          id: "ws-history-row",
          path: args.path,
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
          workspaceId: "ws-history-row",
          updatedAt: 10,
        };
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={onClose} />
        </MemoryRouter>
      </Provider>
    );

    expect(await screen.findByText("Recent Workspaces")).toBeInTheDocument();
    expect(screen.getByText("/repo/coder-studio")).toBeInTheDocument();
    expect(screen.getByText(formatDate(lastOpenedAt, "en"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open recent workspace coder-studio" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.open",
        { path: "/repo/coder-studio" },
        undefined
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("removes a recent workspace row without opening it", async () => {
    const onClose = vi.fn();
    const sendCommand = vi.fn().mockImplementation(async (op: string, args?: { path?: string }) => {
      if (op === "workspace.browse") {
        return {
          currentPath: "/home/spencer",
          parentPath: "/home",
          directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
        };
      }

      if (op === "workspace.history.list") {
        return [
          {
            path: "/repo/coder-studio",
            name: "coder-studio",
            lastOpenedAt: 100,
          },
          {
            path: "/repo/keep-me",
            name: "keep-me",
            lastOpenedAt: 90,
          },
        ];
      }

      if (op === "workspace.history.remove") {
        expect(args).toEqual({ path: "/repo/coder-studio" });
        return [
          {
            path: "/repo/keep-me",
            name: "keep-me",
            lastOpenedAt: 90,
          },
        ];
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={onClose} />
        </MemoryRouter>
      </Provider>
    );

    expect(await screen.findByText("coder-studio")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove coder-studio from recent workspaces" })
    );

    await waitFor(() => {
      expect(screen.queryByText("/repo/coder-studio")).not.toBeInTheDocument();
    });
    expect(sendCommand).not.toHaveBeenCalledWith(
      "workspace.open",
      { path: "/repo/coder-studio" },
      undefined
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("confirms before clearing all recent workspaces", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "workspace.browse") {
        return {
          currentPath: "/home/spencer",
          parentPath: "/home",
          directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
        };
      }

      if (op === "workspace.history.list") {
        return [
          {
            path: "/repo/coder-studio",
            name: "coder-studio",
            lastOpenedAt: 100,
          },
        ];
      }

      if (op === "workspace.history.clear") {
        return [];
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );

    expect(await screen.findByText("Recent Workspaces")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear all recent workspaces" }));

    expect(screen.getByText("Clear recent workspaces?")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This only clears the recent workspace list. It does not delete any project directories from disk."
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    await waitFor(() => {
      expect(screen.queryByText("Recent Workspaces")).not.toBeInTheDocument();
    });
  });

  it("renders recent workspace rows inside the mobile launch sheet", async () => {
    viewportMocks.viewport = "mobile";

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "workspace.browse") {
        return {
          currentPath: "/home/spencer",
          parentPath: "/home",
          directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
        };
      }

      if (op === "workspace.history.list") {
        return [
          {
            path: "/repo/mobile-history",
            name: "mobile-history",
            lastOpenedAt: 100,
          },
        ];
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );

    expect(await screen.findByText("Recent Workspaces")).toBeInTheDocument();
    expect(screen.getByText("mobile-history")).toBeInTheDocument();
    expect(document.querySelector(".mobile-sheet--launch")).toBeTruthy();
  });

  it("renders inside shared Sheet on mobile while preserving browse and open behavior", async () => {
    viewportMocks.viewport = "mobile";
    const onClose = vi.fn();
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { path?: string }) => {
      if (op === "workspace.browse") {
        return {
          currentPath: "/home/spencer",
          parentPath: "/home",
          directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
        };
      }

      if (op === "workspace.open") {
        return {
          id: "ws-1",
        };
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={onClose} />
        </MemoryRouter>
      </Provider>
    );

    await screen.findByText("workspace");

    expect(document.querySelector(".mobile-sheet")).toBeTruthy();
    expect(document.querySelector(".mobile-sheet--fullscreen")).toBeTruthy();
    expect(document.querySelector(".mobile-sheet--launch")).toBeTruthy();
    expect(document.querySelector(".mobile-sheet__body--fullscreen")).toBeTruthy();
    expect(document.querySelector(".launch-start-btn--mobile")).toBeTruthy();
    expect(document.querySelector(".launch-overlay")).toBeNull();
    expect(
      screen.queryByText("Select a directory to use as the workspace root.")
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();

    const folderName = screen.getByText("workspace");
    fireEvent.click(folderName);
    fireEvent.click(screen.getByRole("button", { name: "Start Workspace" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.open",
        {
          path: "/home/spencer/workspace",
        },
        undefined
      );
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("uses the shared workbench layer on desktop", async () => {
    const onClose = vi.fn();
    const sendCommand = vi.fn().mockResolvedValue({
      currentPath: "/home/spencer",
      parentPath: "/home",
      directories: [{ name: "workspace", path: "/home/spencer/workspace", itemCount: 3 }],
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={onClose} />
        </MemoryRouter>
      </Provider>
    );

    expect(await screen.findByRole("dialog", { name: "Start Workspace" })).toBeInTheDocument();
    expect(document.querySelector(".workbench-layer-backdrop")).toBeTruthy();
    expect(document.querySelector(".launch-overlay")).toBeNull();
    expect(document.querySelector(".launch-modal")).toBeTruthy();

    fireEvent.click(document.querySelector(".workbench-layer-backdrop") as HTMLElement);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders English labels when locale is set to en", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      currentPath: "/home/spencer",
      parentPath: "/home",
      directories: [{ name: "workspace", path: "/home/spencer/workspace", itemCount: 3 }],
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );

    expect(await screen.findByRole("dialog", { name: "Start Workspace" })).toBeInTheDocument();
    expect(screen.queryByText("Local Folder")).not.toBeInTheDocument();
    expect(screen.queryByText("Remote Git")).not.toBeInTheDocument();
    expect(screen.getAllByText("Select a directory to use as the workspace root.")).toHaveLength(1);
    expect(document.querySelector(".launch-start-btn--desktop")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Home Directory" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Workspace" })).toBeInTheDocument();
    expect(screen.getByText("3 items")).toBeInTheDocument();
    expect(document.querySelector('[data-icon-semantic="file.folder.closed"]')).toBeTruthy();
  });

  it("shows the shared animated spinner while browsing directories", () => {
    const sendCommand = vi.fn(
      () =>
        new Promise(() => {
          return undefined;
        })
    );
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );

    const spinner = screen.getByRole("status", { name: "Loading..." });
    const loadingShell = document.querySelector(".directory-loading");

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(loadingShell).toBeTruthy();
    expect(spinner).toHaveClass("animate-spin");
    expect(document.querySelector(".directory-loading .animate-spin")).toBe(spinner);
  });

  it("shows a single desktop launch title with an inline new-folder entry point", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      currentPath: "/home/spencer",
      parentPath: "/home",
      directories: [{ name: "workspace", path: "/home/spencer/workspace", itemCount: 3 }],
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );

    expect(await screen.findByRole("dialog", { name: "Start Workspace" })).toBeInTheDocument();
    expect(document.querySelector(".launch-header-left .launch-title")?.textContent).toBe(
      "Start Workspace"
    );
    expect(document.querySelector(".launch-kicker")).toBeNull();
    expect(screen.getByRole("button", { name: "New Folder" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Folder Name" })).not.toBeInTheDocument();
  });

  it("opens the inline new-folder form and closes it without dismissing the modal", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      currentPath: "/home/spencer",
      parentPath: "/home",
      directories: [],
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );

    await screen.findByRole("dialog", { name: "Start Workspace" });

    fireEvent.click(screen.getByRole("button", { name: "New Folder" }));

    const input = screen.getByRole("textbox", { name: "Folder Name" });
    await waitFor(() => {
      expect(input).toHaveFocus();
    });
    expect(screen.getByRole("button", { name: "Create Folder" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "feature-demo" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("textbox", { name: "Folder Name" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Start Workspace" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New Folder" }));
    const reopenedInput = screen.getByRole("textbox", { name: "Folder Name" });
    fireEvent.change(reopenedInput, { target: { value: "feature-demo" } });
    fireEvent.keyDown(reopenedInput, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: "Folder Name" })).not.toBeInTheDocument();
    });

    expect(screen.getByRole("dialog", { name: "Start Workspace" })).toBeInTheDocument();
  });

  it("submits the inline new-folder form with Enter and keeps the new folder selected", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { path?: string }) => {
      if (op === "workspace.browse" && args.path === "/home/spencer") {
        return {
          currentPath: "/home/spencer",
          parentPath: "/home",
          directories: [
            { name: "feature-demo", path: "/home/spencer/feature-demo", itemCount: 0 },
            { name: "workspace", path: "/home/spencer/workspace", itemCount: 3 },
          ],
        };
      }

      if (op === "workspace.browse") {
        return {
          currentPath: "/home/spencer",
          parentPath: "/home",
          directories: [{ name: "workspace", path: "/home/spencer/workspace", itemCount: 3 }],
        };
      }

      if (op === "workspace.mkdir") {
        return { ok: true };
      }

      return {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );

    await screen.findByRole("dialog", { name: "Start Workspace" });

    fireEvent.click(screen.getByRole("button", { name: "New Folder" }));

    const input = screen.getByRole("textbox", { name: "Folder Name" });
    fireEvent.change(input, { target: { value: "feature-demo" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.mkdir",
        { path: "/home/spencer/feature-demo" },
        undefined
      );
    });

    await waitFor(() => {
      expect(document.querySelector(".fp-dir.selected .fp-dir-name")?.textContent?.trim()).toBe(
        "feature-demo"
      );
    });

    expect(screen.queryByRole("textbox", { name: "Folder Name" })).not.toBeInTheDocument();
  });

  it("opens and cancels the inline folder form", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      currentPath: "/home/spencer",
      parentPath: "/home",
      directories: [],
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchActionsHarness />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent("/home/spencer");
    });

    expect(screen.getByTestId("is-creating-folder")).toHaveTextContent("false");
    fireEvent.click(screen.getByText("open-create-folder"));
    expect(screen.getByTestId("is-creating-folder")).toHaveTextContent("true");

    fireEvent.click(screen.getByText("set-valid-name"));
    expect(screen.getByTestId("new-folder-name")).toHaveTextContent("feature-demo");

    fireEvent.click(screen.getByText("close-create-folder"));
    expect(screen.getByTestId("is-creating-folder")).toHaveTextContent("false");
    expect(screen.getByTestId("new-folder-name")).toHaveTextContent("");
    expect(screen.getByTestId("create-folder-error")).toHaveTextContent("");
  });

  it("validates when the folder name is empty", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      currentPath: "/home/spencer",
      parentPath: "/home",
      directories: [],
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchActionsHarness />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent("/home/spencer");
    });

    fireEvent.click(screen.getByText("open-create-folder"));
    fireEvent.click(screen.getByText("set-empty-name"));
    fireEvent.click(screen.getByText("submit-create-folder"));

    await waitFor(() => {
      expect(screen.getByTestId("create-folder-error")).toHaveTextContent(
        "Folder name is required"
      );
    });

    expect(sendCommand).toHaveBeenCalledTimes(2);
    expect(sendCommand.mock.calls.some(([op]) => op === "workspace.mkdir")).toBe(false);
    expect(screen.getByTestId("is-creating-folder")).toHaveTextContent("true");
  });

  it("validates when the folder name contains a path separator", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      currentPath: "/home/spencer",
      parentPath: "/home",
      directories: [],
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchActionsHarness />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent("/home/spencer");
    });

    fireEvent.click(screen.getByText("open-create-folder"));
    fireEvent.click(screen.getByText("set-invalid-name"));
    fireEvent.click(screen.getByText("submit-create-folder"));

    await waitFor(() => {
      expect(screen.getByTestId("create-folder-error")).toHaveTextContent(
        "Folder name cannot include / or \\\\"
      );
    });

    expect(sendCommand).toHaveBeenCalledTimes(2);
    expect(sendCommand.mock.calls.some(([op]) => op === "workspace.mkdir")).toBe(false);
    expect(screen.getByTestId("is-creating-folder")).toHaveTextContent("true");
  });

  it("shows create-folder failure when there is no current path yet", async () => {
    const sendCommand = vi.fn(
      () =>
        new Promise(() => {
          return undefined;
        })
    );
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchActionsHarness />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByTestId("current-path")).toHaveTextContent("");

    fireEvent.click(screen.getByText("open-create-folder"));
    fireEvent.click(screen.getByText("set-valid-name"));
    fireEvent.click(screen.getByText("submit-create-folder"));

    await waitFor(() => {
      expect(screen.getByTestId("create-folder-error")).toHaveTextContent(
        "Failed to create folder"
      );
    });

    expect(sendCommand).toHaveBeenCalledTimes(2);
    expect(sendCommand.mock.calls.some(([op]) => op === "workspace.mkdir")).toBe(false);
    expect(screen.getByTestId("creating-folder")).toHaveTextContent("false");
  });

  it("creates a folder, reloads the directory, and selects the new folder", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { path?: string }) => {
      if (op === "workspace.browse" && args.path === "/home/spencer") {
        return {
          currentPath: "/home/spencer",
          parentPath: "/home",
          directories: [
            { name: "workspace", path: "/home/spencer/workspace" },
            { name: "feature-demo", path: "/home/spencer/feature-demo" },
          ],
        };
      }

      if (op === "workspace.browse") {
        return {
          currentPath: "/home/spencer",
          parentPath: "/home",
          directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
        };
      }

      if (op === "workspace.mkdir") {
        return { ok: true };
      }

      return {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchActionsHarness />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent("/home/spencer");
    });

    fireEvent.click(screen.getByText("open-create-folder"));
    fireEvent.click(screen.getByText("set-valid-name"));
    fireEvent.click(screen.getByText("submit-create-folder"));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.mkdir",
        { path: "/home/spencer/feature-demo" },
        undefined
      );
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.browse",
        { path: "/home/spencer" },
        undefined
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("selected-path")).toHaveTextContent("/home/spencer/feature-demo");
    });

    expect(screen.getByTestId("is-creating-folder")).toHaveTextContent("false");
    expect(screen.getByTestId("create-folder-error")).toHaveTextContent("");
  });

  it("keeps the inline form open and shows command errors when folder creation fails", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "workspace.browse") {
        return {
          currentPath: "/home/spencer",
          parentPath: "/home",
          directories: [],
        };
      }

      throw new CommandResultError({
        code: "create_failed",
        message: "Folder already exists",
      });
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchActionsHarness />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent("/home/spencer");
    });

    fireEvent.click(screen.getByText("open-create-folder"));
    fireEvent.click(screen.getByText("set-failing-name"));
    fireEvent.click(screen.getByText("submit-create-folder"));

    await waitFor(() => {
      expect(screen.getByTestId("create-folder-error")).toHaveTextContent("Folder already exists");
    });

    expect(screen.getByTestId("is-creating-folder")).toHaveTextContent("true");
    expect(screen.getByTestId("selected-path")).toHaveTextContent("");
  });

  it("creates from the root path without introducing a double slash", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { path?: string }) => {
      if (op === "workspace.browse" && args.path === "/") {
        return {
          currentPath: "/",
          parentPath: null,
          directories: [{ name: "root-demo", path: "/root-demo" }],
          rootPaths: ["/"],
        };
      }

      if (op === "workspace.browse") {
        return {
          currentPath: "/",
          parentPath: null,
          directories: [],
          rootPaths: ["/"],
        };
      }

      if (op === "workspace.mkdir") {
        return { ok: true };
      }

      return {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchActionsHarness />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent("/");
    });

    fireEvent.click(screen.getByText("open-create-folder"));
    fireEvent.click(screen.getByText("set-valid-name"));
    fireEvent.click(screen.getByText("submit-create-folder"));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.mkdir",
        { path: "/feature-demo" },
        undefined
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("selected-path")).toHaveTextContent("/feature-demo");
    });
  });

  it("resets creating-folder state when navigating during an active create request", async () => {
    let resolveCreate: (() => void) | undefined;
    const sendCommand = vi.fn().mockImplementation((op: string, args: { path?: string }) => {
      if (op === "workspace.browse") {
        return Promise.resolve({
          currentPath: args.path ?? "/home/spencer",
          parentPath: "/home",
          directories: [],
        });
      }

      if (op === "workspace.mkdir") {
        return new Promise((resolve) => {
          resolveCreate = () => resolve({ ok: true });
        });
      }

      return Promise.resolve({});
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchActionsHarness />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent("/home/spencer");
    });

    fireEvent.click(screen.getByText("open-create-folder"));
    fireEvent.click(screen.getByText("set-valid-name"));
    fireEvent.click(screen.getByText("submit-create-folder"));

    await waitFor(() => {
      expect(screen.getByTestId("creating-folder")).toHaveTextContent("true");
    });

    fireEvent.click(screen.getByText("navigate-projects"));

    await waitFor(() => {
      expect(screen.getByTestId("creating-folder")).toHaveTextContent("false");
    });

    resolveCreate?.();

    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent("/home/spencer/projects");
    });

    expect(screen.getByTestId("selected-path")).toHaveTextContent("");
    expect(screen.getByTestId("is-creating-folder")).toHaveTextContent("false");
    expect(sendCommand).not.toHaveBeenCalledWith(
      "workspace.browse",
      { path: "/home/spencer" },
      undefined
    );
  });

  it("keeps create-folder state reset when canceling during an active create request", async () => {
    let resolveCreate: (() => void) | undefined;
    const sendCommand = vi.fn().mockImplementation((op: string, args: { path?: string }) => {
      if (op === "workspace.browse") {
        return Promise.resolve({
          currentPath: args.path ?? "/home/spencer",
          parentPath: "/home",
          directories: [],
        });
      }

      if (op === "workspace.mkdir") {
        return new Promise((resolve) => {
          resolveCreate = () => resolve({ ok: true });
        });
      }

      return Promise.resolve({});
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchActionsHarness />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent("/home/spencer");
    });

    fireEvent.click(screen.getByText("open-create-folder"));
    fireEvent.click(screen.getByText("set-valid-name"));
    fireEvent.click(screen.getByText("submit-create-folder"));

    await waitFor(() => {
      expect(screen.getByTestId("creating-folder")).toHaveTextContent("true");
    });

    fireEvent.click(screen.getByText("close-create-folder"));

    await waitFor(() => {
      expect(screen.getByTestId("creating-folder")).toHaveTextContent("false");
    });

    resolveCreate?.();

    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent("/home/spencer");
    });

    expect(screen.getByTestId("selected-path")).toHaveTextContent("");
    expect(screen.getByTestId("is-creating-folder")).toHaveTextContent("false");
    expect(sendCommand).not.toHaveBeenCalledWith(
      "workspace.browse",
      { path: "/home/spencer" },
      undefined
    );
  });
});
