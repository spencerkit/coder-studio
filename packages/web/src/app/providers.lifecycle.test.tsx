import type { Workspace } from "@coder-studio/core";
import { act, render } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activationGenerationAtom,
  activationReasonAtom,
  activationStatusAtom,
} from "../atoms/activation";
import { authenticatedAtom, themeAtom } from "../atoms/app-ui";
import { authEnabledAtom, connectionStatusAtom } from "../atoms/connection";
import { sessionsAtom } from "../atoms/sessions";
import {
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadStateAtom,
} from "../atoms/workspaces";
import { terminalPreferencesAtom } from "../features/terminal-panel/preferences";
import {
  fileTreeAtomFamily,
  fileTreeStaleAtomFamily,
  gitBranchListAtomFamily,
  gitStateAtomFamily,
  loadedDirsAtomFamily,
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

function createWsSendCommandMock(
  handler?: (op: string, args: unknown) => Promise<unknown> | unknown
) {
  return vi.fn().mockImplementation(async (op: string, args: unknown) => {
    if (handler) {
      const handled = await handler(op, args);
      if (handled !== undefined) {
        return handled;
      }
    }

    if (op === "activation.claim") {
      return {
        active: true,
        generation: 1,
        recoveryMode: "fresh",
      };
    }

    if (op === "activation.release") {
      return { ok: true };
    }

    return undefined;
  });
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
  const originalDocumentTheme = document.documentElement.getAttribute("data-theme");
  const originalLegacyTheme = localStorage.getItem("ui.theme");
  const originalThemeId = localStorage.getItem("ui.themeId");
  const originalTerminalPreferences = localStorage.getItem("ui.terminalPreferences");

  beforeEach(() => {
    resetAppProvidersSingletonsForTests();
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem("ui.theme");
    localStorage.removeItem("ui.themeId");
    localStorage.removeItem("ui.terminalPreferences");
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
      sendCommand: createWsSendCommandMock(),
    };
  });

  afterEach(() => {
    resetAppProvidersSingletonsForTests();
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalTerminalPreferences === null) {
      localStorage.removeItem("ui.terminalPreferences");
    } else {
      localStorage.setItem("ui.terminalPreferences", originalTerminalPreferences);
    }
    if (originalLegacyTheme === null) {
      localStorage.removeItem("ui.theme");
    } else {
      localStorage.setItem("ui.theme", originalLegacyTheme);
    }
    if (originalThemeId === null) {
      localStorage.removeItem("ui.themeId");
    } else {
      localStorage.setItem("ui.themeId", originalThemeId);
    }
    if (originalDocumentTheme === null) {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", originalDocumentTheme);
    }
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

  it("recovers the websocket when the window regains focus while already visible", () => {
    setVisibilityState("visible");
    renderProviders();

    return vi
      .waitFor(() => {
        expect(wsState.client?.connect).toHaveBeenCalled();
      })
      .then(() => {
        act(() => {
          window.dispatchEvent(new Event("focus"));
        });

        expect(wsState.client?.recoverConnection).toHaveBeenCalledWith("visibility_resume");
      });
  });

  it("recovers the websocket when the page is shown again while visible", () => {
    setVisibilityState("visible");
    renderProviders();

    return vi
      .waitFor(() => {
        expect(wsState.client?.connect).toHaveBeenCalled();
      })
      .then(() => {
        act(() => {
          window.dispatchEvent(new Event("pageshow"));
        });

        expect(wsState.client?.recoverConnection).toHaveBeenCalledWith("visibility_resume");
      });
  });

  it("coalesces back-to-back foreground recovery signals", async () => {
    setVisibilityState("visible");
    renderProviders();

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    wsState.client?.recoverConnection.mockClear();
    vi.useFakeTimers();

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(wsState.client?.recoverConnection).toHaveBeenCalledTimes(1);
    expect(wsState.client?.recoverConnection).toHaveBeenLastCalledWith("visibility_resume");

    act(() => {
      vi.advanceTimersByTime(100);
      window.dispatchEvent(new Event("pageshow"));
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(wsState.client?.recoverConnection).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(250);
      window.dispatchEvent(new Event("focus"));
    });

    expect(wsState.client?.recoverConnection).toHaveBeenCalledTimes(2);
    expect(wsState.client?.recoverConnection).toHaveBeenLastCalledWith("visibility_resume");
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

  it("claims activation when the websocket becomes connected", async () => {
    const store = createStore();
    setVisibilityState("visible");

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    act(() => {
      wsState.client?.statusHandler?.("connected");
    });

    await vi.waitFor(() => {
      const claimCalls =
        wsState.client?.sendCommand?.mock.calls.filter(([op]) => op === "activation.claim") ?? [];
      expect(claimCalls.length).toBeGreaterThan(0);
      expect(claimCalls[0]?.[1]).toEqual(
        expect.objectContaining({
          clientInstanceId: expect.any(String),
        })
      );
      expect(store.get(activationStatusAtom)).toBe("active");
      expect(store.get(activationGenerationAtom)).toBe(1);
      expect(store.get(activationReasonAtom)).toBeNull();
    });
  });

  it("does not send activation.heartbeat after the session becomes active", async () => {
    const store = createStore();
    setVisibilityState("visible");
    vi.useFakeTimers();

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    act(() => {
      wsState.client?.statusHandler?.("connected");
    });

    await vi.waitFor(() => {
      expect(store.get(activationStatusAtom)).toBe("active");
    });

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(
      wsState.client?.sendCommand?.mock.calls.filter(([op]) => op === "activation.heartbeat") ?? []
    ).toHaveLength(0);
  });

  it("does not gate activation when websocket reconnect fails", async () => {
    const store = createStore();
    wsState.client!.connect = vi.fn().mockRejectedValue(new Error("connect failed"));

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    await vi.waitFor(() => {
      expect(store.get(activationStatusAtom)).not.toBe("gated");
      expect(store.get(activationReasonAtom)).toBeNull();
    });
  });

  it("does not gate activation when activation.claim fails", async () => {
    const store = createStore();
    wsState.client!.sendCommand = createWsSendCommandMock(async (op: string) => {
      if (op === "activation.claim") {
        throw new Error("claim failed");
      }

      return undefined;
    });

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    act(() => {
      wsState.client?.statusHandler?.("connected");
    });

    await vi.waitFor(() => {
      expect(store.get(activationStatusAtom)).not.toBe("gated");
      expect(store.get(activationReasonAtom)).toBeNull();
    });
  });

  it("retries activation.claim after a transient failure while connected", async () => {
    const store = createStore();
    let claimAttempts = 0;
    vi.useFakeTimers();
    wsState.client!.sendCommand = createWsSendCommandMock(async (op: string) => {
      if (op === "activation.claim") {
        claimAttempts += 1;
        if (claimAttempts === 1) {
          throw new Error("claim failed");
        }

        return {
          active: true,
          generation: 2,
          recoveryMode: "grace_recover",
        };
      }

      return undefined;
    });

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    act(() => {
      wsState.client?.statusHandler?.("connected");
    });

    await vi.waitFor(() => {
      expect(claimAttempts).toBe(1);
      expect(store.get(activationStatusAtom)).toBe("idle");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    await vi.waitFor(() => {
      expect(claimAttempts).toBe(2);
      expect(store.get(activationStatusAtom)).toBe("active");
      expect(store.get(activationGenerationAtom)).toBe(2);
      expect(store.get(activationReasonAtom)).toBeNull();
    });
  });

  it("disconnects and gates when activation.revoked is received", async () => {
    const store = createStore();
    seedWorkspaces(store, ["ws-1"], "ws-1");
    act(() => {
      store.set(activationStatusAtom, "active");
      store.set(activationGenerationAtom, 1);
      store.set(activationReasonAtom, null);
      store.set(gitStateAtomFamily("ws-1"), {
        branch: "feature/test",
        ahead: 1,
        behind: 0,
        modified: [],
        staged: [],
        untracked: [],
        deleted: [],
      });
      store.set(gitBranchListAtomFamily("ws-1"), {
        current: "feature/test",
        branches: [],
        loading: false,
      });
      store.set(fileTreeAtomFamily("ws-1"), new Map([[".", []]]));
      store.set(loadedDirsAtomFamily("ws-1"), new Set(["src"]));
      store.set(worktreeListAtomFamily("ws-1"), {
        items: [],
        loading: false,
        lastLoadedAt: Date.now(),
      });
      store.set(fileTreeStaleAtomFamily("ws-1"), true);
      store.set(sessionsAtom, {
        "session-1": {
          id: "session-1",
          workspaceId: "ws-1",
          terminalId: "terminal-1",
          providerId: "codex",
          state: "running",
          capability: "full",
          startedAt: Date.now(),
          lastActiveAt: Date.now(),
        },
      });
    });

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    act(() => {
      wsState.client?.eventHandler?.(
        "activation.revoked",
        { reason: "displaced", generation: 2 },
        1
      );
    });

    await vi.waitFor(() => {
      expect(wsState.client?.disconnect).toHaveBeenCalledWith("single_active_displaced");
      expect(store.get(activationStatusAtom)).toBe("gated");
      expect(store.get(activationReasonAtom)).toBe("displaced");
      expect(store.get(activationGenerationAtom)).toBe(2);
      expect(store.get(workspacesLoadStateAtom)).toBe("idle");
      expect(store.get(workspaceOrderAtom)).toEqual([]);
      expect(store.get(workspacesAtom)).toEqual({});
      expect(store.get(activeWorkspaceIdAtom)).toBeNull();
      expect(store.get(fileTreeAtomFamily("ws-1"))).toBeNull();
      expect(Array.from(store.get(loadedDirsAtomFamily("ws-1")))).toEqual([]);
      expect(store.get(gitStateAtomFamily("ws-1"))).toBeNull();
      expect(store.get(gitBranchListAtomFamily("ws-1")).current).toBe("");
      expect(store.get(worktreeListAtomFamily("ws-1")).items).toEqual([]);
      expect(store.get(fileTreeStaleAtomFamily("ws-1"))).toBe(false);
      expect(store.get(sessionsAtom)).toEqual({});
    });
  });

  it("does not auto-claim again while activation remains gated", async () => {
    const store = createStore();

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    act(() => {
      store.set(activationStatusAtom, "gated");
      wsState.client?.statusHandler?.("connected");
    });

    const claimCalls =
      wsState.client?.sendCommand?.mock.calls.filter(([op]) => op === "activation.claim") ?? [];

    expect(claimCalls).toHaveLength(0);
  });

  it("does not auto-recover the websocket from foreground signals while gated", async () => {
    const store = createStore();
    setVisibilityState("visible");

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    act(() => {
      store.set(activationStatusAtom, "gated");
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(wsState.client?.recoverConnection).not.toHaveBeenCalled();
  });

  it("hydrates terminal copy-on-select and font size preferences from settings.get once connected", async () => {
    const store = createStore();
    setVisibilityState("visible");

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.terminalCopyOnSelect": true,
          "appearance.terminalFontSize": 17,
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
      expect(store.get(terminalPreferencesAtom)).toEqual({
        copyOnSelect: true,
        fontSize: 17,
      });
    });

    expect(sendCommand).toHaveBeenCalledWith("settings.get", {}, undefined);
  });

  it("preserves a newer local terminal font size update while hydrating untouched copy-on-select", async () => {
    const store = createStore();
    setVisibilityState("visible");
    const settingsGetDeferred = createDeferred<Record<string, unknown>>();

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return settingsGetDeferred.promise;
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
      expect(sendCommand).toHaveBeenCalledWith("settings.get", {}, undefined);
    });

    act(() => {
      store.set(terminalPreferencesAtom, {
        copyOnSelect: false,
        fontSize: 14,
      });
    });

    await act(async () => {
      settingsGetDeferred.resolve({
        "appearance.terminalCopyOnSelect": true,
        "appearance.terminalFontSize": 18,
      });
      await settingsGetDeferred.promise;
    });

    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: true,
      fontSize: 14,
    });
  });

  it("hydrates untouched terminal preference fields when another field was updated locally first", async () => {
    const store = createStore();
    setVisibilityState("visible");
    const settingsGetDeferred = createDeferred<Record<string, unknown>>();

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return settingsGetDeferred.promise;
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
      expect(sendCommand).toHaveBeenCalledWith("settings.get", {}, undefined);
    });

    act(() => {
      store.set(terminalPreferencesAtom, {
        copyOnSelect: true,
        fontSize: 11,
      });
    });

    await act(async () => {
      settingsGetDeferred.resolve({
        "appearance.terminalCopyOnSelect": false,
        "appearance.terminalFontSize": 18,
      });
      await settingsGetDeferred.promise;
    });

    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: true,
      fontSize: 18,
    });
  });

  it("falls back to the default terminal font size when persisted settings are fractional", async () => {
    const store = createStore();
    setVisibilityState("visible");

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.terminalCopyOnSelect": true,
          "appearance.terminalFontSize": 11.5,
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
      expect(store.get(terminalPreferencesAtom)).toEqual({
        copyOnSelect: true,
        fontSize: 11,
      });
    });
  });

  it("bootstraps the document theme from legacy ui.theme localStorage", async () => {
    localStorage.setItem("ui.theme", JSON.stringify("light"));

    renderProviders();

    await vi.waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("mint-light");
      expect(localStorage.getItem("ui.themeId")).toBe(JSON.stringify("mint-light"));
    });
  });

  it("hydrates appearance.themeId from settings.get and updates the document theme and atom", async () => {
    const store = createStore();
    setVisibilityState("visible");

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.themeId": "graphite-dark",
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
      expect(document.documentElement.getAttribute("data-theme")).toBe("graphite-dark");
      expect(store.get(themeAtom)).toBe("graphite-dark");
      expect(localStorage.getItem("ui.themeId")).toBe(JSON.stringify("graphite-dark"));
    });
  });

  it("prefers server-provided appearance.themeId over legacy ui.theme localStorage", async () => {
    const store = createStore();
    setVisibilityState("visible");
    localStorage.setItem("ui.theme", JSON.stringify("light"));

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.themeId": "graphite-dark",
        };
      }

      return undefined;
    });
    wsState.client!.sendCommand = sendCommand;

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    await vi.waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("mint-light");
    });

    act(() => {
      wsState.client?.statusHandler?.("connected");
    });

    await vi.waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("graphite-dark");
      expect(store.get(themeAtom)).toBe("graphite-dark");
    });
  });

  it("falls back to legacy server appearance.theme when themeId is absent", async () => {
    const store = createStore();
    setVisibilityState("visible");

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.theme": "light",
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
      expect(document.documentElement.getAttribute("data-theme")).toBe("mint-light");
      expect(store.get(themeAtom)).toBe("mint-light");
      expect(localStorage.getItem("ui.themeId")).toBe(JSON.stringify("mint-light"));
    });
  });

  it("preserves a newer local theme selection when startup hydration resolves afterward", async () => {
    const store = createStore();
    setVisibilityState("visible");

    let resolveSettingsGet: ((value: Record<string, unknown>) => void) | undefined;
    const settingsGetPromise = new Promise<Record<string, unknown>>((resolve) => {
      resolveSettingsGet = resolve;
    });
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return await settingsGetPromise;
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
      expect(sendCommand).toHaveBeenCalledWith("settings.get", {}, undefined);
    });

    act(() => {
      store.set(themeAtom, "graphite-dark");
    });

    await act(async () => {
      resolveSettingsGet?.({
        "appearance.themeId": "nord-light",
      });
      await settingsGetPromise;
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("graphite-dark");
    expect(store.get(themeAtom)).toBe("graphite-dark");
    expect(localStorage.getItem("ui.themeId")).toBe(JSON.stringify("graphite-dark"));
  });

  it("preserves a persisted local theme selection when startup hydration returns a stale server theme", async () => {
    const store = createStore();
    setVisibilityState("visible");
    localStorage.setItem("ui.themeId", JSON.stringify("graphite-dark"));

    let resolveSettingsGet: ((value: Record<string, unknown>) => void) | undefined;
    const settingsGetPromise = new Promise<Record<string, unknown>>((resolve) => {
      resolveSettingsGet = resolve;
    });
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return await settingsGetPromise;
      }

      return undefined;
    });
    wsState.client!.sendCommand = sendCommand;

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    await vi.waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("graphite-dark");
      expect(store.get(themeAtom)).toBe("graphite-dark");
    });

    act(() => {
      wsState.client?.statusHandler?.("connected");
    });

    await vi.waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("settings.get", {}, undefined);
    });

    await act(async () => {
      resolveSettingsGet?.({
        "appearance.themeId": "nord-light",
      });
      await settingsGetPromise;
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("graphite-dark");
    expect(store.get(themeAtom)).toBe("graphite-dark");
    expect(localStorage.getItem("ui.themeId")).toBe(JSON.stringify("graphite-dark"));
  });

  it("preserves a newer local terminal copy-on-select update when startup hydration resolves later", async () => {
    const store = createStore();
    setVisibilityState("visible");

    let resolveSettingsGet: ((value: Record<string, unknown>) => void) | undefined;
    const settingsGetPromise = new Promise<Record<string, unknown>>((resolve) => {
      resolveSettingsGet = resolve;
    });
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return await settingsGetPromise;
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
      expect(sendCommand).toHaveBeenCalledWith("settings.get", {}, undefined);
    });

    act(() => {
      store.set(terminalPreferencesAtom, { copyOnSelect: true, fontSize: 11 });
    });

    await act(async () => {
      resolveSettingsGet?.({});
      await settingsGetPromise;
    });

    expect(store.get(terminalPreferencesAtom)).toEqual({ copyOnSelect: true, fontSize: 11 });
  });

  it("preserves an ABA local terminal copy-on-select update when startup hydration resolves later", async () => {
    const store = createStore();
    setVisibilityState("visible");

    act(() => {
      store.set(terminalPreferencesAtom, { copyOnSelect: true, fontSize: 11 });
    });

    let resolveSettingsGet: ((value: Record<string, unknown>) => void) | undefined;
    const settingsGetPromise = new Promise<Record<string, unknown>>((resolve) => {
      resolveSettingsGet = resolve;
    });
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return await settingsGetPromise;
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
      expect(sendCommand).toHaveBeenCalledWith("settings.get", {}, undefined);
    });

    act(() => {
      store.set(terminalPreferencesAtom, { copyOnSelect: false, fontSize: 11 });
      store.set(terminalPreferencesAtom, { copyOnSelect: true, fontSize: 11 });
    });

    await act(async () => {
      resolveSettingsGet?.({
        "appearance.terminalCopyOnSelect": false,
      });
      await settingsGetPromise;
    });

    expect(store.get(terminalPreferencesAtom)).toEqual({ copyOnSelect: true, fontSize: 11 });
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
