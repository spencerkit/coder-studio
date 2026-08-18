import {
  createDefaultProductUpdateState,
  type UpdateStateView,
  type Workspace,
} from "@coder-studio/core";
import { act, render } from "@testing-library/react";
import { createStore, Provider, useAtomValue } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activationGenerationAtom,
  activationReasonAtom,
  activationStatusAtom,
} from "../atoms/activation";
import { appearancePersonalizationAtom, authenticatedAtom, themeAtom } from "../atoms/app-ui";
import { authEnabledAtom, connectionStatusAtom } from "../atoms/connection";
import { providerListAtom } from "../atoms/providers";
import { sessionsAtom } from "../atoms/sessions";
import {
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadStateAtom,
} from "../atoms/workspaces";
import { toastsAtom } from "../features/notifications/atoms";
import { terminalPreferencesAtom } from "../features/terminal-panel/preferences";
import { getGlobalRecoveryCoordinator } from "../features/terminal-panel/recovery-singleton";
import {
  productUpdateStateAtom,
  serverUpdateStateAtom,
  updateControllerAtom,
  updateStateAtom,
} from "../features/updates/atoms";
import {
  expandedDirsAtomFamily,
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
    probeConnection?: ReturnType<typeof vi.fn>;
    recoverConnection: ReturnType<typeof vi.fn>;
    sendCommand?: ReturnType<typeof vi.fn>;
    eventHandler?: (topic: string, payload: unknown, seq: number) => void;
    statusHandler?: (status: string) => void;
  } | null,
}));

const { mockDisposeWorkspace } = vi.hoisted(() => ({
  mockDisposeWorkspace: vi.fn(),
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

vi.mock("../features/code-editor/monaco/model-registry", () => ({
  monacoModelRegistry: {
    getOrCreate: vi.fn(),
    updateFromDisk: vi.fn(),
    disposeFile: vi.fn(),
    disposeWorkspace: mockDisposeWorkspace,
  },
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

function TerminalPreferencesProbe() {
  useAtomValue(terminalPreferencesAtom);
  return null;
}

function UpdateStateProbe() {
  useAtomValue(updateStateAtom);
  return null;
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
  const originalDesktopBridge = Object.getOwnPropertyDescriptor(window, "coderStudioDesktop");

  beforeEach(() => {
    resetAppProvidersSingletonsForTests();
    mockDisposeWorkspace.mockClear();
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem("ui.theme");
    localStorage.removeItem("ui.themeId");
    localStorage.removeItem("ui.terminalPreferences");
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ authEnabled: false }),
    }) as unknown as typeof fetch;
    Reflect.deleteProperty(window, "coderStudioDesktop");

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
      probeConnection: vi.fn().mockResolvedValue({ ok: true }),
      recoverConnection: vi.fn(),
      sendCommand: createWsSendCommandMock(),
    };
  });

  afterEach(() => {
    resetAppProvidersSingletonsForTests();
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalDesktopBridge) {
      Object.defineProperty(window, "coderStudioDesktop", originalDesktopBridge);
    } else {
      Reflect.deleteProperty(window, "coderStudioDesktop");
    }
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

  it("hydrates update state after the websocket connects", async () => {
    const updateState: UpdateStateView = {
      version: 2,
      currentVersion: "0.4.0",
      currentPublishedAt: null,
      latestVersion: "0.5.0",
      latestPublishedAt: null,
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
      runtimeContext: {
        environment: "cli-global-npm",
        authority: "cli",
        supported: true,
        unsupportedReason: null,
      },
    };
    wsState.client!.sendCommand = createWsSendCommandMock(async (op) => {
      if (op === "updates.getState") {
        return updateState;
      }
      return undefined;
    });
    const store = createStore();
    setVisibilityState("visible");

    await act(async () => {
      render(
        <Provider store={store}>
          <AppProviders>
            <UpdateStateProbe />
          </AppProviders>
        </Provider>
      );
    });

    act(() => {
      wsState.client?.statusHandler?.("connected");
    });

    await vi.waitFor(() => {
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith("updates.getState", {}, undefined);
    });

    await vi.waitFor(() => {
      expect(store.get(updateStateAtom)).toEqual(updateState);
    });
  });

  it("waits for activation before hydrating update state", async () => {
    const activationClaim = createDeferred<{
      active: true;
      generation: number;
      recoveryMode: "fresh";
    }>();
    const updateState: UpdateStateView = {
      version: 2,
      currentVersion: "0.5.6",
      currentPublishedAt: null,
      latestVersion: null,
      latestPublishedAt: null,
      availability: "unknown",
      updateStatus: "idle",
      lastCheckedAt: null,
      targetVersion: null,
      startedAt: null,
      finishedAt: null,
      requiresManualStep: false,
      manualCommand: null,
      errorSummary: null,
      supported: false,
      installKind: "unsupported",
      unsupportedReason: "Managed by Coder Studio Desktop",
      runtimeContext: {
        environment: "desktop-managed",
        authority: "desktop",
        supported: true,
        unsupportedReason: null,
      },
    };
    wsState.client!.sendCommand = createWsSendCommandMock(async (op) => {
      if (op === "activation.claim") return activationClaim.promise;
      if (op === "updates.getState") return updateState;
      return undefined;
    });
    const store = createStore();
    renderProviders(store);

    await vi.waitFor(() => expect(wsState.client?.connect).toHaveBeenCalled());
    act(() => wsState.client?.statusHandler?.("connected"));
    await vi.waitFor(() => {
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith(
        "activation.claim",
        expect.anything()
      );
    });
    expect(
      wsState.client?.sendCommand?.mock.calls.filter(([op]) => op === "updates.getState")
    ).toHaveLength(0);

    await act(async () => {
      activationClaim.resolve({ active: true, generation: 1, recoveryMode: "fresh" });
      await activationClaim.promise;
    });

    await vi.waitFor(() => {
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith("updates.getState", {}, undefined);
      expect(store.get(serverUpdateStateAtom)).toEqual(updateState);
    });
  });

  it("hydrates update state again after reconnect activation", async () => {
    const updateState: UpdateStateView = {
      version: 2,
      currentVersion: "0.5.6",
      currentPublishedAt: null,
      latestVersion: null,
      latestPublishedAt: null,
      availability: "unknown",
      updateStatus: "idle",
      lastCheckedAt: null,
      targetVersion: null,
      startedAt: null,
      finishedAt: null,
      requiresManualStep: false,
      manualCommand: null,
      errorSummary: null,
      supported: false,
      installKind: "unsupported",
      unsupportedReason: "Managed by Coder Studio Desktop",
      runtimeContext: {
        environment: "desktop-managed",
        authority: "desktop",
        supported: true,
        unsupportedReason: null,
      },
    };
    wsState.client!.sendCommand = createWsSendCommandMock(async (op) =>
      op === "updates.getState" ? updateState : undefined
    );
    const store = createStore();
    renderProviders(store);

    await vi.waitFor(() => expect(wsState.client?.connect).toHaveBeenCalled());
    act(() => wsState.client?.statusHandler?.("connected"));
    await vi.waitFor(() => {
      expect(
        wsState.client?.sendCommand?.mock.calls.filter(([op]) => op === "updates.getState")
      ).toHaveLength(1);
    });

    act(() => wsState.client?.statusHandler?.("reconnecting"));
    await vi.waitFor(() => expect(store.get(activationStatusAtom)).toBe("idle"));
    act(() => wsState.client?.statusHandler?.("connected"));

    await vi.waitFor(() => {
      expect(
        wsState.client?.sendCommand?.mock.calls.filter(([op]) => op === "updates.getState")
      ).toHaveLength(2);
    });
  });

  it("hydrates Desktop-managed Server context before resolving the Desktop controller", async () => {
    const runtimeContext = {
      environment: "desktop-managed" as const,
      authority: "desktop" as const,
      supported: false,
      unsupportedReason: "Managed by Coder Studio Desktop",
    };
    const updateState: UpdateStateView = {
      version: 2,
      currentVersion: "0.5.0",
      currentPublishedAt: null,
      latestVersion: null,
      latestPublishedAt: null,
      availability: "unknown",
      updateStatus: "idle",
      lastCheckedAt: null,
      targetVersion: null,
      startedAt: null,
      finishedAt: null,
      requiresManualStep: false,
      manualCommand: null,
      errorSummary: null,
      supported: false,
      installKind: "unsupported",
      unsupportedReason: runtimeContext.unsupportedReason,
      runtimeContext,
    };
    const productState = createDefaultProductUpdateState(
      {
        environment: "desktop-native",
        authority: "desktop",
        supported: true,
        unsupportedReason: null,
      },
      "0.5.6",
      "2026-08-08T15:41:11.000Z"
    );
    const getUpdateState = vi.fn(async () => productState);
    Object.defineProperty(window, "coderStudioDesktop", {
      configurable: true,
      value: {
        updateApiVersion: 1,
        getUpdateState,
        onUpdateStateChanged: vi.fn(() => () => {}),
      } as unknown as CoderStudioDesktopApi,
    });
    wsState.client!.sendCommand = createWsSendCommandMock(async (op) =>
      op === "updates.getState" ? updateState : undefined
    );
    const store = createStore();
    setVisibilityState("visible");
    renderProviders(store);

    await vi.waitFor(() => expect(wsState.client?.connect).toHaveBeenCalled());
    act(() => wsState.client?.statusHandler?.("connected"));

    await vi.waitFor(() => expect(store.get(serverUpdateStateAtom)).toEqual(updateState));
    await vi.waitFor(() => expect(store.get(updateControllerAtom)?.kind).toBe("desktop"));
    expect(store.get(productUpdateStateAtom)).toEqual(productState);
    expect(
      wsState.client!.sendCommand!.mock.invocationCallOrder.find(
        (_, index) => wsState.client!.sendCommand!.mock.calls[index]?.[0] === "updates.getState"
      )
    ).toBeLessThan(getUpdateState.mock.invocationCallOrder[0]!);
  });

  it("subscribes to update topics so update events stream without a reconnect", async () => {
    const store = createStore();
    setVisibilityState("visible");

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
      expect(wsState.client?.subscribe).toHaveBeenCalled();
    });

    const subscribeCalls = wsState.client?.subscribe.mock.calls ?? [];
    const topics = subscribeCalls[subscribeCalls.length - 1]?.[0];

    expect(topics).toEqual(expect.arrayContaining(["update.*"]));
  });

  it("hydrates update state without emitting a toast when an update becomes available after connect", async () => {
    const updateState: UpdateStateView = {
      version: 2,
      currentVersion: "0.4.0",
      currentPublishedAt: null,
      latestVersion: "0.5.0",
      latestPublishedAt: null,
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
      runtimeContext: {
        environment: "cli-global-npm",
        authority: "cli",
        supported: true,
        unsupportedReason: null,
      },
    };
    wsState.client!.sendCommand = createWsSendCommandMock(async (op) => {
      if (op === "updates.getState") {
        return {
          ...updateState,
          latestVersion: null,
          availability: "unknown" as const,
          lastCheckedAt: null,
        };
      }
      return undefined;
    });
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
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith("updates.getState", {}, undefined);
    });

    act(() => {
      wsState.client?.eventHandler?.("update.state.changed", updateState, 1);
    });

    await vi.waitFor(() => {
      expect(store.get(updateStateAtom)).toEqual(updateState);
    });

    expect(store.get(toastsAtom)).toEqual([]);
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
    });

    await vi.waitFor(() => {
      expect(store.get(activationStatusAtom)).toBe("idle");
    });

    act(() => {
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

  it("refreshes stale git-derived workspace state after websocket reconnect once activation is reclaimed", async () => {
    const store = createStore();
    setVisibilityState("visible");
    seedWorkspaces(store, ["ws-1"], "ws-1");

    let activationClaimed = false;

    act(() => {
      store.set(gitStateAtomFamily("ws-1"), {
        branch: "feature/reconnect",
        ahead: 0,
        behind: 0,
        staged: [],
        modified: Array.from({ length: 20 }, (_, index) => ({ path: `file-${index}.ts` })),
        untracked: [],
        deleted: [],
      });
      store.set(gitBranchListAtomFamily("ws-1"), {
        current: "feature/reconnect",
        branches: [],
        loading: false,
      });
      store.set(worktreeListAtomFamily("ws-1"), {
        items: [],
        loading: false,
      });
    });

    wsState.client!.sendCommand = createWsSendCommandMock(async (op: string) => {
      if (op === "activation.claim") {
        activationClaimed = true;
        return {
          active: true,
          generation: 2,
          recoveryMode: "grace_recover",
        };
      }

      if (op === "workspace.activate") {
        if (!activationClaimed) {
          throw new Error("activation_required");
        }
        return {};
      }

      if (op === "git.status") {
        return {
          branch: "feature/reconnect",
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
          current: "feature/reconnect",
          branches: [{ name: "feature/reconnect", isCurrent: true, isRemote: false }],
        };
      }

      if (op === "worktree.list") {
        return {
          worktrees: [
            {
              name: "feature/reconnect",
              path: "/tmp/ws-1",
              branch: "feature/reconnect",
              commit: "abc123",
              status: "clean" as const,
            },
          ],
        };
      }

      return undefined;
    });

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.sendCommand).toHaveBeenCalledWith("workspace.activate", {
        workspaceId: "ws-1",
      });
    });

    act(() => {
      wsState.client?.statusHandler?.("reconnecting");
    });

    await vi.waitFor(() => {
      expect(store.get(activationStatusAtom)).toBe("idle");
    });

    act(() => {
      wsState.client?.statusHandler?.("connected");
    });

    await vi.waitFor(() => {
      const activateCalls =
        wsState.client?.sendCommand?.mock.calls.filter(
          ([op, args]) => op === "workspace.activate" && args?.workspaceId === "ws-1"
        ) ?? [];
      expect(activateCalls.length).toBeGreaterThanOrEqual(2);
    });

    await vi.waitFor(() => {
      expect(store.get(gitStateAtomFamily("ws-1"))?.modified).toHaveLength(0);
      expect(store.get(gitStateAtomFamily("ws-1"))?.ahead).toBe(1);
      expect(store.get(gitBranchListAtomFamily("ws-1")).current).toBe("feature/reconnect");
      expect(store.get(worktreeListAtomFamily("ws-1")).items).toHaveLength(1);
    });

    const calls = wsState.client?.sendCommand?.mock.calls ?? [];
    expect(calls.filter(([op]) => op === "git.status")).toHaveLength(1);
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

  it("reconciles instead of forcing transport recovery when the page becomes visible again", async () => {
    const probeConnection = vi.fn().mockResolvedValue({ ok: true });
    const sendCommand = createWsSendCommandMock((op) => {
      if (op === "recovery.reconcile") {
        return {
          terminals: [],
        };
      }
      return undefined;
    });

    wsState.client = {
      ...wsState.client!,
      getStatus: vi.fn(() => "connected"),
      probeConnection,
      sendCommand,
    };

    setVisibilityState("hidden");
    renderProviders();

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    act(() => {
      setVisibilityState("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await vi.waitFor(() => {
      expect(probeConnection).toHaveBeenCalledWith("foreground_resume");
    });
    await vi.waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "recovery.reconcile",
        expect.objectContaining({ reason: "foreground_resume" }),
        undefined
      );
    });
    expect(wsState.client?.recoverConnection).not.toHaveBeenCalledWith("visibility_resume");
  });

  it("recovers the websocket when the browser reports network return", () => {
    wsState.client = {
      ...wsState.client!,
      getStatus: vi.fn(() => "connected"),
      sendCommand: createWsSendCommandMock((op) => {
        if (op === "recovery.reconcile") {
          return {
            terminals: [],
          };
        }
        return undefined;
      }),
    };

    renderProviders();

    return vi
      .waitFor(() => {
        expect(wsState.client?.connect).toHaveBeenCalled();
      })
      .then(async () => {
        act(() => {
          window.dispatchEvent(new Event("online"));
        });

        await vi.waitFor(() => {
          expect(wsState.client?.sendCommand).toHaveBeenCalledWith(
            "recovery.reconcile",
            expect.objectContaining({ reason: "network_online" }),
            undefined
          );
        });
      });
  });

  it("asks Desktop to restore authentication and retries immediately after recovery", async () => {
    let authenticationRecovered: (() => void) | undefined;
    const recoverAuthentication = vi.fn(async () => true);
    const unsubscribe = vi.fn();
    Object.defineProperty(window, "coderStudioDesktop", {
      configurable: true,
      value: {
        recoverAuthentication,
        onAuthenticationRecovered: vi.fn((listener: () => void) => {
          authenticationRecovered = listener;
          return unsubscribe;
        }),
      } as unknown as CoderStudioDesktopApi,
    });

    const rendered = renderProviders();
    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });
    wsState.client?.recoverConnection.mockClear();

    act(() => {
      wsState.client?.statusHandler?.("reconnecting");
    });
    await vi.waitFor(() => {
      expect(recoverAuthentication).toHaveBeenCalledTimes(1);
    });

    act(() => authenticationRecovered?.());
    expect(wsState.client?.recoverConnection).toHaveBeenCalledWith("manual_retry");

    rendered.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("probes and reconciles on visibility return instead of forcing replay semantics", async () => {
    const probeConnection = vi.fn().mockResolvedValue({ ok: true });
    const sendCommand = createWsSendCommandMock((op) => {
      if (op === "recovery.reconcile") {
        return {
          terminals: [],
        };
      }
      return undefined;
    });

    wsState.client = {
      ...wsState.client!,
      getStatus: vi.fn(() => "connected"),
      probeConnection,
      sendCommand,
    };

    const store = createStore();
    setVisibilityState("hidden");
    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    act(() => {
      setVisibilityState("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await vi.waitFor(() => {
      expect(probeConnection).toHaveBeenCalledWith("foreground_resume");
    });
    await vi.waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "recovery.reconcile",
        expect.objectContaining({ reason: "foreground_resume" }),
        undefined
      );
    });
  });

  it("defers foreground reconciliation until websocket reconnects when the page returns while disconnected", async () => {
    let connectionStatus:
      | "connecting"
      | "connected"
      | "disconnected"
      | "reconnecting"
      | "rejected" = "disconnected";
    const statusListeners = new Set<(status: string) => void>();
    const probeConnection = vi.fn().mockResolvedValue({ ok: true });
    const setUiMode = vi.fn();
    const sendCommand = createWsSendCommandMock((op) => {
      if (op === "recovery.reconcile") {
        return {
          terminals: [{ terminalId: "term-1", action: "noop", headSeq: 9 }],
        };
      }
      return undefined;
    });

    wsState.client = {
      ...wsState.client!,
      getStatus: vi.fn(() => connectionStatus),
      onStatus: vi.fn((listener) => {
        statusListeners.add(listener);
        return () => {
          statusListeners.delete(listener);
        };
      }),
      probeConnection,
      sendCommand,
    };

    setVisibilityState("hidden");
    renderProviders();

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });
    getGlobalRecoveryCoordinator()?.registerTerminal({
      terminalId: "term-1",
      workspaceId: "ws-1",
      getRenderedSeq: () => 9,
      setUiMode,
    });

    sendCommand.mockClear();
    probeConnection.mockClear();

    await act(async () => {
      setVisibilityState("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(probeConnection).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalledWith(
      "recovery.reconcile",
      expect.anything(),
      undefined
    );

    await act(async () => {
      connectionStatus = "connected";
      for (const listener of statusListeners) {
        listener("connected");
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "recovery.reconcile",
        {
          reason: "socket_reconnected",
          terminals: [{ terminalId: "term-1", renderedSeq: 9 }],
        },
        undefined
      );
    });
    expect(probeConnection).not.toHaveBeenCalled();
    expect(setUiMode).toHaveBeenCalledWith("silent");
  });

  it("does not reconcile on foreground return while activation is gated", async () => {
    const probeConnection = vi.fn().mockResolvedValue({ ok: true });
    wsState.client = {
      ...wsState.client!,
      getStatus: vi.fn(() => "connected"),
      probeConnection,
      sendCommand: createWsSendCommandMock(),
    };

    const store = createStore();
    act(() => {
      store.set(activationStatusAtom, "gated");
    });

    renderProviders(store);

    act(() => {
      setVisibilityState("visible");
      window.dispatchEvent(new Event("focus"));
    });

    await Promise.resolve();
    expect(probeConnection).not.toHaveBeenCalled();
  });

  it("coalesces back-to-back foreground recovery signals", async () => {
    wsState.client = {
      ...wsState.client!,
      getStatus: vi.fn(() => "connected"),
      sendCommand: createWsSendCommandMock((op) => {
        if (op === "recovery.reconcile") {
          return {
            terminals: [],
          };
        }
        return undefined;
      }),
    };

    setVisibilityState("visible");
    renderProviders();

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    wsState.client?.sendCommand?.mockClear();
    vi.useFakeTimers();

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await vi.waitFor(() => {
      expect(wsState.client?.sendCommand).toHaveBeenCalledTimes(1);
      expect(wsState.client?.sendCommand).toHaveBeenLastCalledWith(
        "recovery.reconcile",
        expect.objectContaining({ reason: "foreground_resume" }),
        undefined
      );
    });

    act(() => {
      vi.advanceTimersByTime(100);
      window.dispatchEvent(new Event("pageshow"));
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(wsState.client?.sendCommand).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(250);
      window.dispatchEvent(new Event("focus"));
    });

    await vi.waitFor(() => {
      expect(wsState.client?.sendCommand).toHaveBeenCalledTimes(2);
      expect(wsState.client?.sendCommand).toHaveBeenLastCalledWith(
        "recovery.reconcile",
        expect.objectContaining({ reason: "foreground_resume" }),
        undefined
      );
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

  it("falls back to auth disabled when /auth/status cannot be reached", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    const store = createStore();
    renderProviders(store);

    await vi.waitFor(() => {
      expect(store.get(authEnabledAtom)).toBe(false);
      expect(store.get(authenticatedAtom)).toBe(false);
    });
  });

  it("falls back to auth disabled after a short /auth/status timeout", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn().mockImplementation((_input, init) => {
      const signal = (init as RequestInit | undefined)?.signal;

      return new Promise((_resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }

        signal?.addEventListener(
          "abort",
          () => {
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true }
        );
      });
    }) as unknown as typeof fetch;

    const store = createStore();
    renderProviders(store);

    expect(store.get(authEnabledAtom)).toBeNull();
    expect(wsState.client?.connect).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1199);
    });

    expect(store.get(authEnabledAtom)).toBeNull();
    expect(wsState.client?.connect).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    await vi.waitFor(() => {
      expect(store.get(authEnabledAtom)).toBe(false);
      expect(store.get(authenticatedAtom)).toBe(false);
      expect(wsState.client?.connect).toHaveBeenCalledTimes(1);
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
      store.set(providerListAtom, [
        {
          id: "codex",
          displayName: "Codex",
          badge: "Codex",
          kind: "built_in",
          capability: "full",
          capabilities: [],
          requiredCommands: ["codex"],
        },
      ]);
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
      store.set(expandedDirsAtomFamily("ws-1"), new Set(["src"]));
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
      expect(mockDisposeWorkspace).toHaveBeenCalledWith("/tmp/ws-1");
      expect(store.get(activationStatusAtom)).toBe("gated");
      expect(store.get(activationReasonAtom)).toBe("displaced");
      expect(store.get(activationGenerationAtom)).toBe(2);
      expect(store.get(workspacesLoadStateAtom)).toBe("idle");
      expect(store.get(workspaceOrderAtom)).toEqual([]);
      expect(store.get(workspacesAtom)).toEqual({});
      expect(store.get(activeWorkspaceIdAtom)).toBeNull();
      expect(store.get(fileTreeAtomFamily("ws-1"))).toBeNull();
      expect(Array.from(store.get(loadedDirsAtomFamily("ws-1")))).toEqual([]);
      expect(store.get(expandedDirsAtomFamily("ws-1"))).toBeNull();
      expect(store.get(gitStateAtomFamily("ws-1"))).toBeNull();
      expect(store.get(gitBranchListAtomFamily("ws-1")).current).toBe("");
      expect(store.get(worktreeListAtomFamily("ws-1")).items).toEqual([]);
      expect(store.get(fileTreeStaleAtomFamily("ws-1"))).toBe(false);
      expect(store.get(sessionsAtom)).toEqual({});
      expect(store.get(providerListAtom).map((provider) => provider.id)).toEqual(["codex"]);
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
          "appearance.desktopTerminalFontSize": 17,
          "appearance.mobileTerminalFontSize": 15,
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
        desktopFontSize: 17,
        mobileFontSize: 15,
        fontSize: 17,
      });
    });

    expect(sendCommand).toHaveBeenCalledWith("settings.get", {}, undefined);
  });

  it("preserves a newer local desktop terminal font size update while hydrating untouched copy-on-select", async () => {
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
        desktopFontSize: 14,
        mobileFontSize: 11,
        fontSize: 14,
      });
    });

    await act(async () => {
      settingsGetDeferred.resolve({
        "appearance.terminalCopyOnSelect": true,
        "appearance.desktopTerminalFontSize": 18,
        "appearance.mobileTerminalFontSize": 16,
      });
      await settingsGetDeferred.promise;
    });

    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: true,
      desktopFontSize: 14,
      mobileFontSize: 16,
      fontSize: 18,
    });
  });

  it("hydrates untouched terminal font size fields when another field was updated locally first", async () => {
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
        desktopFontSize: 11,
        mobileFontSize: 11,
        fontSize: 11,
      });
    });

    await act(async () => {
      settingsGetDeferred.resolve({
        "appearance.terminalCopyOnSelect": false,
        "appearance.desktopTerminalFontSize": 18,
        "appearance.mobileTerminalFontSize": 12,
      });
      await settingsGetDeferred.promise;
    });

    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: false,
      desktopFontSize: 18,
      mobileFontSize: 12,
      fontSize: 18,
    });
  });

  it("defaults terminal copy-on-select to enabled when settings.get omits the value", async () => {
    const store = createStore();
    setVisibilityState("visible");

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.desktopTerminalFontSize": 16,
          "appearance.mobileTerminalFontSize": 14,
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
        desktopFontSize: 16,
        mobileFontSize: 14,
        fontSize: 16,
      });
    });
  });

  it("falls back to the default terminal font size when persisted split settings are fractional", async () => {
    const store = createStore();
    setVisibilityState("visible");

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.terminalCopyOnSelect": true,
          "appearance.desktopTerminalFontSize": 11.5,
          "appearance.mobileTerminalFontSize": 12.2,
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
        desktopFontSize: 11,
        mobileFontSize: 11,
        fontSize: 11,
      });
    });
  });

  it("falls back to the legacy shared terminal font size when split settings are absent", async () => {
    const store = createStore();
    setVisibilityState("visible");

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.terminalCopyOnSelect": true,
          "appearance.terminalFontSize": 16,
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
        desktopFontSize: 16,
        mobileFontSize: 16,
        fontSize: 16,
      });
    });
  });

  it("normalizes legacy local terminal preferences into split desktop and mobile font sizes", async () => {
    localStorage.setItem(
      "ui.terminalPreferences",
      JSON.stringify({
        copyOnSelect: true,
        fontSize: 14,
      })
    );

    const store = createStore();

    render(
      <Provider store={store}>
        <TerminalPreferencesProbe />
      </Provider>
    );

    await vi.waitFor(() => {
      expect(store.get(terminalPreferencesAtom)).toEqual({
        copyOnSelect: true,
        desktopFontSize: 14,
        mobileFontSize: 14,
        fontSize: 14,
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

  it("hydrates appearance.personalization from settings.get into the in-memory atom", async () => {
    const store = createStore();
    setVisibilityState("visible");

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.personalization.version": 1,
          "appearance.personalization.common.backgroundMode": "image",
          "appearance.personalization.common.backgroundAssetId": "asset-common",
          "appearance.personalization.common.backgroundFit": "contain",
          "appearance.personalization.common.backgroundDimness": 36,
          "appearance.personalization.common.backgroundBlur": 6,
          "appearance.personalization.common.glassEnabled": false,
          "appearance.personalization.common.glassIntensity": 20,
          "appearance.personalization.common.surfaceOpacity": 90,
          "appearance.personalization.desktop.glassEnabled": true,
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
      expect(store.get(appearancePersonalizationAtom)).toMatchObject({
        version: 1,
        common: expect.objectContaining({
          backgroundMode: "image",
          backgroundAssetId: "asset-common",
          backgroundFit: "contain",
          backgroundDimness: 36,
          backgroundBlur: 6,
          glassEnabled: false,
          glassIntensity: 20,
          surfaceOpacity: 90,
        }),
        desktop: {
          glassEnabled: true,
        },
      });
    });
  });

  it("applies effective desktop personalization as document CSS variables", async () => {
    const store = createStore();
    setVisibilityState("visible");

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.personalization.version": 1,
          "appearance.personalization.common.backgroundMode": "image",
          "appearance.personalization.common.backgroundAssetId": "asset-common",
          "appearance.personalization.common.backgroundFit": "cover",
          "appearance.personalization.common.backgroundDimness": 36,
          "appearance.personalization.common.backgroundBlur": 8,
          "appearance.personalization.common.glassEnabled": false,
          "appearance.personalization.common.glassIntensity": 18,
          "appearance.personalization.common.surfaceOpacity": 88,
          "appearance.personalization.desktop.backgroundAssetId": "asset-desktop",
          "appearance.personalization.desktop.glassEnabled": true,
          "appearance.personalization.desktop.glassIntensity": 30,
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
      expect(document.documentElement.style.getPropertyValue("--app-bg-image")).toBe(
        "url(/api/appearance-assets/asset-desktop)"
      );
      expect(document.documentElement.style.getPropertyValue("--app-bg-fit")).toBe("cover");
      expect(document.documentElement.style.getPropertyValue("--app-bg-dim")).toBe("0.36");
      expect(document.documentElement.style.getPropertyValue("--app-bg-blur")).toBe("8px");
      expect(document.documentElement.style.getPropertyValue("--app-surface-opacity")).toBe("0.88");
      expect(document.documentElement.style.getPropertyValue("--app-surface-backdrop-filter")).toBe(
        "blur(30px)"
      );
      expect(document.documentElement.getAttribute("data-appearance-glass")).toBe("on");
    });
  });

  it("weakens personalization when the active theme is high contrast", async () => {
    const store = createStore();
    setVisibilityState("visible");

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.themeId": "hc-dark",
          "appearance.personalization.version": 1,
          "appearance.personalization.common.backgroundMode": "image",
          "appearance.personalization.common.backgroundAssetId": "asset-common",
          "appearance.personalization.common.backgroundFit": "cover",
          "appearance.personalization.common.backgroundDimness": 20,
          "appearance.personalization.common.backgroundBlur": 18,
          "appearance.personalization.common.glassEnabled": true,
          "appearance.personalization.common.glassIntensity": 28,
          "appearance.personalization.common.surfaceOpacity": 72,
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
      expect(store.get(themeAtom)).toBe("hc-dark");
      expect(document.documentElement.style.getPropertyValue("--app-bg-blur")).toBe("0px");
      expect(document.documentElement.style.getPropertyValue("--app-surface-opacity")).toBe("1");
      expect(document.documentElement.style.getPropertyValue("--app-surface-backdrop-filter")).toBe(
        "none"
      );
      expect(document.documentElement.getAttribute("data-appearance-glass")).toBe("off");
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

  it("still hydrates appearance personalization when a persisted local theme is preserved", async () => {
    const store = createStore();
    setVisibilityState("visible");
    localStorage.setItem("ui.themeId", JSON.stringify("graphite-dark"));

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.themeId": "nord-light",
          "appearance.personalization.version": 1,
          "appearance.personalization.common.backgroundMode": "image",
          "appearance.personalization.common.backgroundAssetId": "asset-common",
          "appearance.personalization.common.backgroundFit": "cover",
          "appearance.personalization.common.backgroundDimness": 36,
          "appearance.personalization.common.backgroundBlur": 8,
          "appearance.personalization.common.glassEnabled": true,
          "appearance.personalization.common.glassIntensity": 30,
          "appearance.personalization.common.surfaceOpacity": 88,
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
      expect(document.documentElement.getAttribute("data-theme")).toBe("graphite-dark");
      expect(store.get(themeAtom)).toBe("graphite-dark");
    });

    act(() => {
      wsState.client?.statusHandler?.("connected");
    });

    await vi.waitFor(() => {
      expect(store.get(appearancePersonalizationAtom)).toMatchObject({
        version: 1,
        common: expect.objectContaining({
          backgroundMode: "image",
          backgroundAssetId: "asset-common",
          backgroundFit: "cover",
          backgroundDimness: 36,
          backgroundBlur: 8,
          glassEnabled: true,
          glassIntensity: 30,
          surfaceOpacity: 88,
        }),
      });
      expect(document.documentElement.style.getPropertyValue("--app-bg-image")).toBe(
        "url(/api/appearance-assets/asset-common)"
      );
      expect(document.documentElement.style.getPropertyValue("--app-surface-backdrop-filter")).toBe(
        "blur(30px)"
      );
      expect(document.documentElement.getAttribute("data-appearance-glass")).toBe("on");
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("graphite-dark");
    expect(store.get(themeAtom)).toBe("graphite-dark");
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
      store.set(terminalPreferencesAtom, {
        copyOnSelect: true,
        desktopFontSize: 11,
        mobileFontSize: 11,
        fontSize: 11,
      });
    });

    await act(async () => {
      resolveSettingsGet?.({});
      await settingsGetPromise;
    });

    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: true,
      desktopFontSize: 11,
      mobileFontSize: 11,
      fontSize: 11,
    });
  });

  it("preserves an ABA local terminal copy-on-select update when startup hydration resolves later", async () => {
    const store = createStore();
    setVisibilityState("visible");

    act(() => {
      store.set(terminalPreferencesAtom, {
        copyOnSelect: true,
        desktopFontSize: 11,
        mobileFontSize: 11,
        fontSize: 11,
      });
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
      store.set(terminalPreferencesAtom, {
        copyOnSelect: false,
        desktopFontSize: 11,
        mobileFontSize: 11,
        fontSize: 11,
      });
      store.set(terminalPreferencesAtom, {
        copyOnSelect: true,
        desktopFontSize: 11,
        mobileFontSize: 11,
        fontSize: 11,
      });
    });

    await act(async () => {
      resolveSettingsGet?.({
        "appearance.terminalCopyOnSelect": false,
      });
      await settingsGetPromise;
    });

    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: true,
      desktopFontSize: 11,
      mobileFontSize: 11,
      fontSize: 11,
    });
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
