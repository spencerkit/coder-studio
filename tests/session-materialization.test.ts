import test from "node:test";
import assert from "node:assert/strict";

import { createTranslator } from "../apps/web/src/i18n";
import { createWorkspaceSessionActions } from "../apps/web/src/features/workspace/session-actions";
import type { AppSettings, Toast } from "../apps/web/src/types/app";
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

test("materializeSession keeps workbench-local state and does not create a backend session row", async () => {
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
  assert.deepEqual(calls, []);
  assert.equal(stateRef.current.tabs[0]?.sessions[0]?.title, "Investigate auth flow");
});

test("materializeSession replaces the draft placeholder title even when startup input is empty", async () => {
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
  assert.deepEqual(calls, []);
  assert.notEqual(stateRef.current.tabs[0]?.sessions[0]?.title, "New Session");
});
