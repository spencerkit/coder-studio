import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { activeWorkspaceIdAtom, workspacesAtom } from "../../../atoms/workspaces";
import { useWorkspaceLaunchActions } from "./use-workspace-launch-actions";

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

function Harness({ onClose }: { onClose: () => void }) {
  const actions = useWorkspaceLaunchActions(onClose);

  return (
    <div>
      <div data-testid="current-path">{actions.currentPath}</div>
      <div data-testid="directories">{actions.directories.map((dir) => dir.name).join("|")}</div>
      <div data-testid="wsl-path">{actions.wslPath}</div>
      <div data-testid="wsl-distro">{actions.wslDistro}</div>
      <div data-testid="recent-workspaces">
        {actions.recentWorkspaces.map((entry) => entry.path).join("|")}
      </div>
      <div data-testid="history-loading">{String(actions.historyLoading)}</div>
      <button type="button" onClick={() => actions.setTargetRuntime("wsl")}>
        set-runtime-wsl
      </button>
      <button type="button" onClick={() => actions.setWslDistro("Ubuntu-24.04")}>
        set-distro-ubuntu
      </button>
      <button type="button" onClick={() => actions.setWslDistro("Debian")}>
        set-distro-debian
      </button>
      <button type="button" onClick={() => actions.openCreateFolder()}>
        open-create-folder
      </button>
      <button type="button" onClick={() => actions.updateNewFolderName("demo")}>
        set-new-folder-demo
      </button>
      <button type="button" onClick={() => void actions.submitCreateFolder()}>
        submit-create-folder
      </button>
      <button type="button" onClick={() => void actions.openWorkspaceByPath("/repo/history-app")}>
        open-history
      </button>
      <button type="button" onClick={() => void actions.removeRecentWorkspace("/repo/history-app")}>
        remove-history
      </button>
      <button type="button" onClick={() => void actions.clearRecentWorkspaces()}>
        clear-history
      </button>
    </div>
  );
}

describe("useWorkspaceLaunchActions", () => {
  beforeEach(() => {
    routerMocks.navigate.mockReset();
    routerMocks.location.pathname = "/";
  });

  it("loads recent history independently from directory browsing", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "workspace.browse") {
        return {
          currentPath: "/home/spencer",
          parentPath: "/home",
          directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
        };
      }

      if (op === "workspace.history.list") {
        throw new Error("history unavailable");
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <Harness onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );

    expect(await screen.findByTestId("directories")).toHaveTextContent("workspace");
    await waitFor(() => {
      expect(screen.getByTestId("history-loading")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("recent-workspaces")).toHaveTextContent("");
  });

  it("reuses one open path for direct history launches", async () => {
    const onClose = vi.fn();
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { path?: string }) => {
      if (op === "workspace.browse") {
        return {
          currentPath: "/home/spencer",
          parentPath: "/home",
          directories: [],
        };
      }

      if (op === "workspace.history.list") {
        return [
          {
            path: "/repo/history-app",
            name: "history-app",
            lastOpenedAt: 100,
          },
        ];
      }

      if (op === "workspace.open") {
        return {
          id: "ws-history",
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
          workspaceId: "ws-history",
          updatedAt: 200,
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
          <Harness onClose={onClose} />
        </MemoryRouter>
      </Provider>
    );

    expect(await screen.findByTestId("recent-workspaces")).toHaveTextContent("/repo/history-app");

    fireEvent.click(await screen.findByRole("button", { name: "open-history" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.open",
        { path: "/repo/history-app" },
        undefined
      );
    });
    expect(store.get(activeWorkspaceIdAtom)).toBe("ws-history");
    expect(store.get(workspacesAtom)).toHaveProperty("ws-history");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("removes one recent workspace entry using the server-returned history snapshot", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args?: { path?: string }) => {
      if (op === "workspace.browse") {
        return {
          currentPath: "/home/spencer",
          parentPath: "/home",
          directories: [],
        };
      }

      if (op === "workspace.history.list") {
        return [
          {
            path: "/repo/history-app",
            name: "history-app",
            lastOpenedAt: 100,
          },
          {
            path: "/repo/keep-app",
            name: "keep-app",
            lastOpenedAt: 90,
          },
        ];
      }

      if (op === "workspace.history.remove") {
        expect(args).toEqual({ path: "/repo/history-app" });
        return [
          {
            path: "/repo/keep-app",
            name: "keep-app",
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
          <Harness onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );

    expect(await screen.findByTestId("recent-workspaces")).toHaveTextContent(
      "/repo/history-app|/repo/keep-app"
    );

    fireEvent.click(screen.getByRole("button", { name: "remove-history" }));

    await waitFor(() => {
      expect(screen.getByTestId("recent-workspaces")).toHaveTextContent("/repo/keep-app");
    });
  });

  it("clears all recent workspaces using the server-returned empty history snapshot", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "workspace.browse") {
        return {
          currentPath: "/home/spencer",
          parentPath: "/home",
          directories: [],
        };
      }

      if (op === "workspace.history.list") {
        return [
          {
            path: "/repo/history-app",
            name: "history-app",
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
          <Harness onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );

    expect(await screen.findByTestId("recent-workspaces")).toHaveTextContent("/repo/history-app");

    fireEvent.click(screen.getByRole("button", { name: "clear-history" }));

    await waitFor(() => {
      expect(screen.getByTestId("recent-workspaces")).toHaveTextContent("");
    });
  });

  it("loads WSL directories through workspace.wsl.browse when the runtime target is wsl", async () => {
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
          <Harness onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "set-runtime-wsl" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.wsl.browse",
        { distro: "Ubuntu-24.04" },
        undefined
      );
    });
    expect(screen.getByTestId("current-path")).toHaveTextContent("/home/spencer");
    expect(screen.getByTestId("wsl-path")).toHaveTextContent("/home/spencer");
  });

  it("reloads WSL browse results when the selected distro changes", async () => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Win32");

    const sendCommand = vi
      .fn()
      .mockImplementation(async (op: string, args?: { distro?: string }) => {
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
            distros: ["Ubuntu-24.04", "Debian"],
          };
        }

        if (op === "workspace.wsl.browse") {
          return {
            currentPath: args?.distro === "Debian" ? "/home/debian" : "/home/spencer",
            parentPath: "/home",
            rootPaths: ["/", args?.distro === "Debian" ? "/home/debian" : "/home/spencer"],
            directories: [],
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
          <Harness onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "set-runtime-wsl" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.wsl.browse",
        { distro: "Ubuntu-24.04" },
        undefined
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "set-distro-debian" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.wsl.browse",
        { distro: "Debian", path: "/home/spencer" },
        undefined
      );
    });
    expect(screen.getByTestId("current-path")).toHaveTextContent("/home/debian");
    expect(screen.getByTestId("wsl-path")).toHaveTextContent("/home/debian");
  });

  it("creates folders through workspace.wsl.mkdir while in WSL mode", async () => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Win32");

    const sendCommand = vi
      .fn()
      .mockImplementation(async (op: string, args?: { distro?: string; path?: string }) => {
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
          if (args?.path === "/home/spencer") {
            return {
              currentPath: "/home/spencer",
              parentPath: "/home",
              rootPaths: ["/", "/home/spencer"],
              directories: [
                { name: "demo", path: "/home/spencer/demo" },
                { name: "workspace", path: "/home/spencer/workspace" },
              ],
            };
          }

          return {
            currentPath: "/home/spencer",
            parentPath: "/home",
            rootPaths: ["/", "/home/spencer"],
            directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
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
          <Harness onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "set-runtime-wsl" }));
    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent("/home/spencer");
    });

    fireEvent.click(screen.getByRole("button", { name: "open-create-folder" }));
    fireEvent.click(screen.getByRole("button", { name: "set-new-folder-demo" }));
    fireEvent.click(screen.getByRole("button", { name: "submit-create-folder" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.wsl.mkdir",
        { distro: "Ubuntu-24.04", path: "/home/spencer/demo" },
        undefined
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("directories")).toHaveTextContent("demo|workspace");
    });
  });
});
