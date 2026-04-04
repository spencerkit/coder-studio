import test from "node:test";
import assert from "node:assert/strict";

import { createTranslator } from "../apps/web/src/i18n";
import { createWorkspaceSessionActions } from "../apps/web/src/features/workspace/session-actions";
import { displaySessionStatus } from "../apps/web/src/shared/utils/session";
import type { AppSettings } from "../apps/web/src/types/app";
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

const createState = (): WorkbenchState => ({
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
          id: "session-1",
          title: "Session 1",
          status: "running",
          mode: "branch",
          autoFeed: true,
          queue: [],
          messages: [],
          unread: 0,
          lastActiveAt: 1,
        },
        {
          id: "session-2",
          title: "Session 2",
          status: "idle",
          mode: "branch",
          autoFeed: true,
          queue: [],
          messages: [],
          unread: 0,
          lastActiveAt: 1,
        },
      ],
      activeSessionId: "session-1",
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
        type: "split",
        id: "split-1",
        axis: "vertical",
        ratio: 0.5,
        first: {
          type: "leaf",
          id: "pane-1",
          sessionId: "session-1",
        },
        second: {
          type: "leaf",
          id: "pane-2",
          sessionId: "session-2",
        },
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

test("displaySessionStatus returns the stored runtime status without deriving background", () => {
  const tab = createState().tabs[0];
  const active = tab.sessions[0];
  const inactive = {
    ...tab.sessions[0],
    id: "session-3",
    status: "running" as const,
  };

  assert.equal(displaySessionStatus(active), "running");
  assert.equal(displaySessionStatus(inactive), "running");
});

test("onSwitchSession does not persist a display-only status patch for the previous session", async () => {
  const locale = "en";
  const t = createTranslator(locale);
  const stateRef = { current: createState() };
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });

    if (url.endsWith("/api/rpc/switch_session")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          data: {
            id: 2,
            title: "Session 2",
            status: "idle",
            mode: "branch",
            auto_feed: true,
            queue: [],
            messages: [],
            unread: 0,
            last_active_at: 2,
            claude_session_id: null,
          },
        }),
      } as Response;
    }

    if (url.endsWith("/api/rpc/session_update")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          data: null,
        }),
      } as Response;
    }

    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    await withMockWindow(
      {
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
          addToast: () => {},
        });

        actions.onSwitchSession(stateRef.current.tabs[0], "session-2");
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const persistedStatuses = calls
    .filter((entry) => entry.url.endsWith("/api/rpc/session_update"))
    .map((entry) => entry.body.patch as { status?: string });

  assert.equal(persistedStatuses.some((patch) => patch.status === "running"), false);
  assert.equal(stateRef.current.tabs[0].sessions.find((session) => session.id === "session-1")?.status, "running");
});
