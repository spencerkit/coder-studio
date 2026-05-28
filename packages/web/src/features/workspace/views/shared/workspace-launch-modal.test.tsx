import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { CommandResultError } from "../../../../ws/client";
import { useWorkspaceLaunchActions } from "../../actions/use-workspace-launch-actions";
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

function WorkspaceLaunchActionsHarness() {
  const actions = useWorkspaceLaunchActions(vi.fn());

  return (
    <div>
      <div data-testid="current-path">{actions.currentPath}</div>
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
  afterEach(() => {
    viewportMocks.viewport = "desktop";
    routerMocks.navigate.mockReset();
    routerMocks.location.pathname = "/";
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
    expect(screen.getByText("Open Workspace")).toBeInTheDocument();
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

    expect(await screen.findByRole("dialog", { name: "Open Workspace" })).toBeInTheDocument();
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

    expect(await screen.findByText("Open Workspace")).toBeInTheDocument();
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
        "workspace.launch.folder_name_required"
      );
    });

    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("is-creating-folder")).toHaveTextContent("true");
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
  });
});
