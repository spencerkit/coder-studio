import type { Workspace } from "@coder-studio/core";
import { act, render } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticatedAtom } from "../atoms/app-ui";
import { authEnabledAtom, connectionStatusAtom } from "../atoms/connection";
import {
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadStateAtom,
} from "../atoms/workspaces";
import { terminalPreferencesAtom } from "../features/terminal-panel/preferences";
import {
  fileTreeStaleAtomFamily,
  gitBranchListAtomFamily,
  gitStateAtomFamily,
  worktreeListAtomFamily,
} from "../features/workspace/atoms";
import { AppProviders, resetAppProvidersSingletonsForTests } from "./providers";

const wsState = vi.hoisted(() => ({
  client: null as {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    onStatus: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
    recoverConnection: ReturnType<typeof vi.fn>;
    sendCommand?: ReturnType<typeof vi.fn>;
    eventHandler?: (topic: string, payload: unknown, seq: number) => void;
    statusHandler?: (status: string) => void;
  } | null,
}));

vi.mock("../ws", () => ({
  resolveWsUrl: () => "ws://127.0.0.1:4173/ws",
  WsClient: vi.fn().mockImplementation(function MockWsClient() {
    return wsState.client;
  }),
}));

vi.mock("../features/notifications", () => ({
  useSessionNotifications: () => {},
}));

function renderProviders(store = createStore()) {
  const rendered = render(
    <Provider store={store}>
      <AppProviders>
        <div>child</div>
      </AppProviders>
    </Provider>
  );

  return { store, ...rendered };
}

function setVisibilityState(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
}

function seedWorkspaces(
  store: ReturnType<typeof createStore>,
  ids: string[],
  activeWorkspaceId: string
) {
  const workspaces: Record<string, Workspace> = Object.fromEntries(
    ids.map((id, index) => [
      id,
      {
        id,
        path: `/tmp/${id}`,
        targetRuntime: "native" as const,
        openedAt: index + 1,
        lastActiveAt: index + 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    ])
  );

  act(() => {
    store.set(workspacesAtom, workspaces);
    store.set(workspaceOrderAtom, ids);
    store.set(workspacesLoadStateAtom, "ready");
    store.set(activeWorkspaceIdAtom, activeWorkspaceId);
    store.set(connectionStatusAtom, "connected");
  });
}

describe("AppProviders lifecycle recovery", () => {
  const originalFetch = globalThis.fetch;
  const originalVisibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState");

  beforeEach(() => {
    resetAppProvidersSingletonsForTests();
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ authEnabled: false }),
    }) as unknown as typeof fetch;

    wsState.client = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      subscribe: vi.fn((_topics, handler) => {
        wsState.client!.eventHandler = handler;
        return () => {
          if (wsState.client?.eventHandler === handler) {
            wsState.client!.eventHandler = undefined;
          }
        };
      }),
      onStatus: vi.fn((handler) => {
        wsState.client!.statusHandler = handler;
        return () => {
          if (wsState.client?.statusHandler === handler) {
            wsState.client!.statusHandler = undefined;
          }
        };
      }),
      getStatus: vi.fn(() => "disconnected"),
      recoverConnection: vi.fn(),
      sendCommand: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    resetAppProvidersSingletonsForTests();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    if (originalVisibilityState) {
      Object.defineProperty(document, "visibilityState", originalVisibilityState);
    } else {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
    }
  });

  it("sends workspace.activate when the active workspace becomes available", async () => {
    const store = createStore();
    setVisibilityState("visible");

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    expect(wsState.client?.sendCommand).not.toHaveBeenCalledWith(
      "workspace.activate",
      expect.anything(),
      undefined
    );

    seedWorkspaces(store, ["ws-1"], "ws-1");

    await vi.waitFor(() => {
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith("workspace.activate", {
        workspaceId: "ws-1",
      });
    });
  });

  it("sends workspace.deactivate when the page becomes hidden", async () => {
    const store = createStore();
    setVisibilityState("visible");
    seedWorkspaces(store, ["ws-1"], "ws-1");

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith("workspace.activate", {
        workspaceId: "ws-1",
      });
    });

    act(() => {
      setVisibilityState("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await vi.waitFor(() => {
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith("workspace.deactivate", {});
    });
  });

  it("re-activates the current workspace when the page becomes visible again", async () => {
    const store = createStore();
    setVisibilityState("visible");
    seedWorkspaces(store, ["ws-1"], "ws-1");

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith("workspace.activate", {
        workspaceId: "ws-1",
      });
    });

    act(() => {
      setVisibilityState("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await vi.waitFor(() => {
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith("workspace.deactivate", {});
    });

    act(() => {
      setVisibilityState("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await vi.waitFor(() => {
      const activateCalls =
        wsState.client?.sendCommand?.mock.calls.filter(
          ([op, args]) => op === "workspace.activate" && args?.workspaceId === "ws-1"
        ) ?? [];
      expect(activateCalls.length).toBe(2);
    });
  });

  it("re-sends workspace.activate after websocket reconnects", async () => {
    const store = createStore();
    setVisibilityState("visible");
    seedWorkspaces(store, ["ws-1"], "ws-1");

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith("workspace.activate", {
        workspaceId: "ws-1",
      });
    });

    act(() => {
      wsState.client?.statusHandler?.("reconnecting");
      wsState.client?.statusHandler?.("connected");
    });

    await vi.waitFor(() => {
      const activateCalls =
        wsState.client?.sendCommand?.mock.calls.filter(
          ([op, args]) => op === "workspace.activate" && args?.workspaceId === "ws-1"
        ) ?? [];
      expect(activateCalls.length).toBe(2);
    });
  });

  it("sends workspace.deactivate when the active workspace intent is cleared", async () => {
    const store = createStore();
    setVisibilityState("visible");
    seedWorkspaces(store, ["ws-1", "ws-2"], "ws-1");

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith("workspace.activate", {
        workspaceId: "ws-1",
      });
    });

    act(() => {
      store.set(activeWorkspaceIdAtom, null);
    });

    await vi.waitFor(() => {
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith("workspace.deactivate", {});
    });
  });

  it("recovers the websocket when the page becomes visible again", () => {
    renderProviders();

    return vi
      .waitFor(() => {
        expect(wsState.client?.connect).toHaveBeenCalled();
      })
      .then(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible",
        });

        act(() => {
          document.dispatchEvent(new Event("visibilitychange"));
        });

        expect(wsState.client?.recoverConnection).toHaveBeenCalledWith("visibility_resume");
      });
  });

  it("recovers the websocket when the browser reports network return", () => {
    renderProviders();

    return vi
      .waitFor(() => {
        expect(wsState.client?.connect).toHaveBeenCalled();
      })
      .then(() => {
        act(() => {
          window.dispatchEvent(new Event("online"));
        });

        expect(wsState.client?.recoverConnection).toHaveBeenCalledWith("network_online");
      });
  });

  it("hydrates authEnabled and authenticated from /auth/status instead of trusting stale local state", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ authEnabled: true, authenticated: false }),
    }) as unknown as typeof fetch;

    const store = createStore();
    store.set(authenticatedAtom, true);

    renderProviders(store);

    await vi.waitFor(() => {
      expect(store.get(authEnabledAtom)).toBe(true);
      expect(store.get(authenticatedAtom)).toBe(false);
    });
  });

  it("does not connect or recover the websocket before login when auth is required", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ authEnabled: true, authenticated: false }),
    }) as unknown as typeof fetch;

    const { store } = renderProviders();

    await vi.waitFor(() => {
      expect(store.get(authEnabledAtom)).toBe(true);
      expect(store.get(authenticatedAtom)).toBe(false);
    });

    expect(wsState.client?.connect).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));

    expect(wsState.client?.recoverConnection).not.toHaveBeenCalled();
  });

  it("connects the websocket after auth state flips to authenticated", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ authEnabled: true, authenticated: false }),
    }) as unknown as typeof fetch;

    const { store } = renderProviders();

    await vi.waitFor(() => {
      expect(store.get(authEnabledAtom)).toBe(true);
      expect(store.get(authenticatedAtom)).toBe(false);
    });

    expect(wsState.client?.connect).not.toHaveBeenCalled();

    store.set(authenticatedAtom, true);

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalledTimes(1);
    });
  });

  it("hydrates terminal copy-on-select preferences from settings.get once connected", async () => {
    const store = createStore();
    setVisibilityState("visible");

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.terminalCopyOnSelect": true,
        };
      }

      return undefined;
    });
    wsState.client!.sendCommand = sendCommand;

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    act(() => {
      wsState.client?.statusHandler?.("connected");
    });

    await vi.waitFor(() => {
      expect(store.get(terminalPreferencesAtom)).toEqual({ copyOnSelect: true });
    });

    expect(sendCommand).toHaveBeenCalledWith("settings.get", {}, undefined);
  });

  it("marks the session authenticated when /auth/status confirms an existing server session", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ authEnabled: true, authenticated: true }),
    }) as unknown as typeof fetch;

    const { store } = renderProviders();

    await vi.waitFor(() => {
      expect(store.get(authEnabledAtom)).toBe(true);
      expect(store.get(authenticatedAtom)).toBe(true);
    });
  });

  it("coalesces git refresh events into one git status and branch reload while marking the tree stale", async () => {
    wsState.client!.sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "feature/refresh",
          ahead: 1,
          behind: 0,
          staged: [],
          modified: [],
          untracked: [],
          deleted: [],
        };
      }

      if (op === "git.branches") {
        return {
          current: "feature/refresh",
          branches: [{ name: "feature/refresh", isCurrent: true, isRemote: false }],
        };
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    const { store } = renderProviders();

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    act(() => {
      wsState.client?.eventHandler?.(
        "workspace.ws-1.git.state",
        { treeChanged: true, branchChanged: true },
        1
      );
      wsState.client?.eventHandler?.("workspace.ws-1.fs.dirty", { reason: "git_metadata" }, 2);
    });

    await vi.waitFor(() => {
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith(
        "git.status",
        { workspaceId: "ws-1" },
        undefined
      );
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith(
        "git.branches",
        { workspaceId: "ws-1" },
        undefined
      );
    });

    const calls = wsState.client?.sendCommand?.mock.calls ?? [];
    expect(calls.filter(([op]) => op === "git.status")).toHaveLength(1);
    expect(calls.filter(([op]) => op === "git.branches")).toHaveLength(1);
    expect(store.get(fileTreeStaleAtomFamily("ws-1"))).toBe(true);
    expect(store.get(gitStateAtomFamily("ws-1"))?.branch).toBe("feature/refresh");
    expect(store.get(gitBranchListAtomFamily("ws-1")).current).toBe("feature/refresh");
  });

  it("refreshes git status for file content events without marking the tree stale", async () => {
    wsState.client!.sendCommand = vi.fn().mockResolvedValue({
      branch: "feature/edit",
      ahead: 0,
      behind: 0,
      staged: [],
      modified: [{ path: "README.md" }],
      untracked: [],
      deleted: [],
    });

    const { store } = renderProviders();

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    act(() => {
      wsState.client?.eventHandler?.("workspace.ws-1.fs.dirty", { reason: "file_content" }, 1);
    });

    await vi.waitFor(() => {
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith(
        "git.status",
        { workspaceId: "ws-1" },
        undefined
      );
    });

    expect(store.get(fileTreeStaleAtomFamily("ws-1"))).toBe(false);
  });

  it("refreshes both git status and branches when fs.dirty arrives with reason=git_metadata", async () => {
    wsState.client!.sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "feature/external",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          untracked: [],
          deleted: [],
        };
      }

      if (op === "git.branches") {
        return {
          current: "feature/external",
          branches: [{ name: "feature/external", isCurrent: true, isRemote: false }],
        };
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    const { store } = renderProviders();

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    act(() => {
      wsState.client?.eventHandler?.("workspace.ws-1.fs.dirty", { reason: "git_metadata" }, 1);
    });

    await vi.waitFor(() => {
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith(
        "git.status",
        { workspaceId: "ws-1" },
        undefined
      );
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith(
        "git.branches",
        { workspaceId: "ws-1" },
        undefined
      );
    });

    expect(store.get(fileTreeStaleAtomFamily("ws-1"))).toBe(false);
    expect(store.get(gitBranchListAtomFamily("ws-1")).current).toBe("feature/external");
  });

  it("does not call git.branches for fs.dirty events with reason=fs_change", async () => {
    wsState.client!.sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "feature/edit",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [{ path: "README.md" }],
          untracked: [],
          deleted: [],
        };
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    const { store } = renderProviders();

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    act(() => {
      wsState.client?.eventHandler?.("workspace.ws-1.fs.dirty", { reason: "fs_change" }, 1);
    });

    await vi.waitFor(() => {
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith(
        "git.status",
        { workspaceId: "ws-1" },
        undefined
      );
    });

    const calls = wsState.client?.sendCommand?.mock.calls ?? [];
    expect(calls.filter(([op]) => op === "git.branches")).toHaveLength(0);
    expect(store.get(fileTreeStaleAtomFamily("ws-1"))).toBe(true);
  });

  it("refreshes worktree list when git.state.changed reports worktreeChanged", async () => {
    wsState.client!.sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          untracked: [],
          deleted: [],
        };
      }
      if (op === "worktree.list") {
        return {
          worktrees: [
            {
              name: "main",
              path: "/repo",
              branch: "main",
              commit: "abc123",
              status: "clean" as const,
            },
            {
              name: "feature",
              path: "/repo-feature",
              branch: "feature/new",
              commit: "def456",
              status: "dirty" as const,
            },
          ],
        };
      }
      throw new Error(`Unexpected command: ${op}`);
    });

    const { store } = renderProviders();

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    act(() => {
      wsState.client?.eventHandler?.("workspace.ws-1.git.state", { worktreeChanged: true }, 1);
    });

    await vi.waitFor(() => {
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith(
        "worktree.list",
        { workspaceId: "ws-1" },
        undefined
      );
    });

    await vi.waitFor(() => {
      const list = store.get(worktreeListAtomFamily("ws-1"));
      expect(list.items).toHaveLength(2);
      expect(list.items[0]?.branch).toBe("main");
      expect(list.loading).toBe(false);
      expect(typeof list.lastLoadedAt).toBe("number");
    });
  });

  it("refreshes worktree list when fs.dirty arrives with reason=git_metadata", async () => {
    wsState.client!.sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          untracked: [],
          deleted: [],
        };
      }
      if (op === "git.branches") {
        return { current: "main", branches: [{ name: "main", isCurrent: true, isRemote: false }] };
      }
      if (op === "worktree.list") {
        return {
          worktrees: [
            {
              name: "main",
              path: "/repo",
              branch: "main",
              commit: "abc123",
              status: "clean" as const,
            },
          ],
        };
      }
      throw new Error(`Unexpected command: ${op}`);
    });

    const { store } = renderProviders();

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    act(() => {
      wsState.client?.eventHandler?.("workspace.ws-1.fs.dirty", { reason: "git_metadata" }, 1);
    });

    await vi.waitFor(() => {
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith(
        "worktree.list",
        { workspaceId: "ws-1" },
        undefined
      );
    });

    await vi.waitFor(() => {
      expect(store.get(worktreeListAtomFamily("ws-1")).items).toHaveLength(1);
    });
  });

  it("does not call worktree.list for fs.dirty(fs_change) or git.state without worktreeChanged", async () => {
    wsState.client!.sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [{ path: "README.md" }],
          untracked: [],
          deleted: [],
        };
      }
      if (op === "git.branches") {
        return { current: "main", branches: [] };
      }
      throw new Error(`Unexpected command: ${op}`);
    });

    renderProviders();

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    act(() => {
      wsState.client?.eventHandler?.("workspace.ws-1.fs.dirty", { reason: "fs_change" }, 1);
      wsState.client?.eventHandler?.("workspace.ws-1.git.state", { branchChanged: true }, 2);
    });

    await vi.waitFor(() => {
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith(
        "git.status",
        { workspaceId: "ws-1" },
        undefined
      );
    });

    const calls = wsState.client?.sendCommand?.mock.calls ?? [];
    expect(calls.filter(([op]) => op === "worktree.list")).toHaveLength(0);
  });
});
