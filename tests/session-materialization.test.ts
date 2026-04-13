import test from "node:test";
import assert from "node:assert/strict";

import { createTranslator } from "../apps/web/src/i18n";
import { createWorkspaceSessionActions } from "../apps/web/src/features/workspace/session-actions";
import type { AppSettings, BackendSession, Toast } from "../apps/web/src/types/app";
import type { WorkbenchState } from "../apps/web/src/state/workbench";

const defaultAppSettings = (): AppSettings => ({
  agentProvider: "claude",
  agentCommand: "claude",
  idlePolicy: {
    enabled: true,
    idleMinutes: 10,
    maxActive: 3,
    pressure: true,
  },
  completionNotifications: {
    enabled: true,
    onlyWhenBackground: true,
  },
  terminalCompatibilityMode: "standard",
});

const withMockWindow = async (
  value: Window & typeof globalThis,
  run: () => Promise<void>,
) => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    value,
    configurable: true,
    writable: true,
  });

  return run().finally(() => {
    if (typeof originalWindow === "undefined") {
      Reflect.deleteProperty(globalThis, "window");
      return;
    }

    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
  });
};

const createDraftState = (): WorkbenchState => ({
  activeTabId: "ws-1",
  layout: {
    leftWidth: 320,
    rightWidth: 320,
    rightSplit: 64,
    showCodePanel: false,
    showTerminalPanel: false,
  },
  overlay: {
    visible: false,
    mode: "local",
    input: "",
    target: { type: "native" },
  },
  tabs: [
    {
      id: "ws-1",
      title: "Workspace Alpha",
      status: "ready",
      controller: {
        role: "controller",
        deviceId: "device-a",
        clientId: "client-a",
        fencingToken: 1,
        takeoverPending: false,
        takeoverRequestedBySelf: false,
      },
      agent: {
        provider: "claude",
        command: "claude",
        useWsl: false,
      },
      git: { branch: "main", changes: 0, lastCommit: "abc123" },
      gitChanges: [],
      worktrees: [],
      sessions: [
        {
          id: "draft-1",
          title: "New Session",
          status: "idle",
          mode: "branch",
          provider: "claude",
          autoFeed: true,
          isDraft: true,
          queue: [],
          messages: [],
          unread: 0,
          lastActiveAt: 1,
        },
      ],
      activeSessionId: "draft-1",
      archive: [],
      terminals: [],
      activeTerminalId: "",
      fileTree: [],
      changesTree: [],
      filePreview: {
        path: "",
        content: "",
        mode: "preview",
        originalContent: "",
        modifiedContent: "",
        dirty: false,
      },
      paneLayout: {
        type: "leaf",
        id: "pane-1",
        sessionId: "draft-1",
      },
      activePaneId: "pane-1",
      idlePolicy: {
        enabled: true,
        idleMinutes: 10,
        maxActive: 3,
        pressure: true,
      },
    },
  ],
});

const mockBackendSession = (): BackendSession => ({
  id: "slot_abc12345",
  title: "Session 01",
  status: "idle",
  mode: "branch",
  provider: "claude",
  auto_feed: true,
  queue: [],
  messages: [],
  unread: 0,
  last_active_at: Date.now(),
});

test("materializeSession creates a backend session and uses the server-generated ID", async () => {
  const locale = "en";
  const t = createTranslator(locale);
  const stateRef = { current: createDraftState() };
  const toasts: Toast[] = [];
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, body });

    if (url.includes("/api/rpc/create_session")) {
      return new Response(JSON.stringify({ ok: true, data: mockBackendSession() }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    await withMockWindow(
      {
        fetch: globalThis.fetch,
        setTimeout,
        clearTimeout,
        requestAnimationFrame: ((callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)) as typeof requestAnimationFrame,
        cancelAnimationFrame: ((handle: number) => clearTimeout(handle)) as typeof cancelAnimationFrame,
        location: {
          origin: "http://127.0.0.1:41033",
          protocol: "http:",
          hostname: "127.0.0.1",
          port: "41033",
          search: "",
        },
      } as Window & typeof globalThis,
      async () => {
        const actions = createWorkspaceSessionActions({
          appSettings: defaultAppSettings(),
          locale,
          t,
          stateRef,
          updateTab: (tabId, updater) => {
            stateRef.current = {
              ...stateRef.current,
              tabs: stateRef.current.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab)),
            };
          },
          withServiceFallback: async (operation, fallback) => {
            try {
              return await operation();
            } catch {
              return fallback;
            }
          },
          addToast: (toast) => {
            toasts.push(toast);
          },
        });

        await actions.materializeSession("ws-1", "draft-1", "Investigate auth flow");
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(toasts.length, 0);
  // Verify backend was called to create the session
  assert.equal(calls.length, 1, `Expected 1 backend call, got: ${JSON.stringify(calls)}`);
  assert.match(calls[0].url, /create_session/);
  assert.equal(calls[0].body.workspaceId, "ws-1");
  // Verify title was updated
  assert.equal(stateRef.current.tabs[0]?.sessions[0]?.title, "Investigate auth flow");
  // Verify session ID was updated to server-generated ID
  assert.equal(stateRef.current.tabs[0]?.sessions[0]?.id, "slot_abc12345");
  // Verify isDraft was set to false
  assert.equal(stateRef.current.tabs[0]?.sessions[0]?.isDraft, false);
});

test("materializeSession preserves the placeholder title when startup input is empty but still creates a backend session", async () => {
  const locale = "en";
  const t = createTranslator(locale);
  const stateRef = { current: createDraftState() };
  const toasts: Toast[] = [];
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, body });

    if (url.includes("/api/rpc/create_session")) {
      return new Response(JSON.stringify({ ok: true, data: mockBackendSession() }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    await withMockWindow(
      {
        fetch: globalThis.fetch,
        setTimeout,
        clearTimeout,
        requestAnimationFrame: ((callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)) as typeof requestAnimationFrame,
        cancelAnimationFrame: ((handle: number) => clearTimeout(handle)) as typeof cancelAnimationFrame,
        location: {
          origin: "http://127.0.0.1:41033",
          protocol: "http:",
          hostname: "127.0.0.1",
          port: "41033",
          search: "",
        },
      } as Window & typeof globalThis,
      async () => {
        const actions = createWorkspaceSessionActions({
          appSettings: defaultAppSettings(),
          locale,
          t,
          stateRef,
          updateTab: (tabId, updater) => {
            stateRef.current = {
              ...stateRef.current,
              tabs: stateRef.current.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab)),
            };
          },
          withServiceFallback: async (operation, fallback) => {
            try {
              return await operation();
            } catch {
              return fallback;
            }
          },
          addToast: (toast) => {
            toasts.push(toast);
          },
        });

        await actions.materializeSession("ws-1", "draft-1", "");
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(toasts.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(stateRef.current.tabs[0]?.sessions[0]?.title, "New Session");
  assert.equal(stateRef.current.tabs[0]?.sessions[0]?.id, "slot_abc12345");
});

test("materializeSession returns null when backend session creation fails", async () => {
  const locale = "en";
  const t = createTranslator(locale);
  const stateRef = { current: createDraftState() };
  const toasts: Toast[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error("network error");
  }) as typeof fetch;

  try {
    await withMockWindow(
      {
        fetch: globalThis.fetch,
        setTimeout,
        clearTimeout,
        requestAnimationFrame: ((callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)) as typeof requestAnimationFrame,
        cancelAnimationFrame: ((handle: number) => clearTimeout(handle)) as typeof cancelAnimationFrame,
        location: {
          origin: "http://127.0.0.1:41033",
          protocol: "http:",
          hostname: "127.0.0.1",
          port: "41033",
          search: "",
        },
      } as Window & typeof globalThis,
      async () => {
        const actions = createWorkspaceSessionActions({
          appSettings: defaultAppSettings(),
          locale,
          t,
          stateRef,
          updateTab: (tabId, updater) => {
            stateRef.current = {
              ...stateRef.current,
              tabs: stateRef.current.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab)),
            };
          },
          withServiceFallback: async (operation, fallback) => {
            try {
              return await operation();
            } catch {
              return fallback;
            }
          },
          addToast: (toast) => {
            toasts.push(toast);
          },
        });

        const result = await actions.materializeSession("ws-1", "draft-1", "Investigate auth flow");
        assert.equal(result, null);
        // Session should still be a draft
        assert.equal(stateRef.current.tabs[0]?.sessions[0]?.isDraft, true);
        assert.equal(stateRef.current.tabs[0]?.sessions[0]?.id, "draft-1");
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
