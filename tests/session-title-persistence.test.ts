import test from "node:test";
import assert from "node:assert/strict";

import type { MutableRefObject } from "react";
import { createTranslator } from "../apps/web/src/i18n";
import {
  commitAgentSessionTitle,
  trackAgentInitialTitleInput,
  type AgentRuntimeRefs,
} from "../apps/web/src/features/agents/agent-runtime-actions";
import { createWorkspaceSessionActions } from "../apps/web/src/features/workspace/session-actions";
import { createSessionFromBackend } from "../apps/web/src/shared/utils/session";
import type { Session } from "../apps/web/src/state/workbench";
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
          autoFeed: true,
          isDraft: true,
          queue: [],
          messages: [],
          stream: "",
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

const ref = <T,>(value: T): MutableRefObject<T> => ({ current: value });

const createAgentRuntimeRefs = (): AgentRuntimeRefs => ({
  draftPromptInputRefs: ref(new Map()),
  agentTerminalRefs: ref(new Map()),
  agentTerminalQueueRef: ref(new Map()),
  agentPaneSizeRef: ref(new Map()),
  agentRuntimeSizeRef: ref(new Map()),
  agentResizeStateRef: ref(new Map()),
  agentTitleTrackerRef: ref(new Map()),
  runningAgentKeysRef: ref(new Set()),
  agentStartupStateRef: ref(new Map()),
  agentStartupTokenRef: ref(0),
});

const createLiveSession = (title = "Session 04"): Session => ({
  id: "4",
  title,
  status: "idle",
  mode: "branch",
  autoFeed: true,
  queue: [],
  messages: [],
  stream: "",
  unread: 0,
  lastActiveAt: 1,
});

test("trackAgentInitialTitleInput only materializes a title after the first line is committed", () => {
  const refs = createAgentRuntimeRefs();
  const session = createDraftState().tabs[0].sessions[0];

  assert.deepEqual(trackAgentInitialTitleInput(refs, "pane-1", session, "hel"), {
    committedTitle: null,
    materializeTitle: "",
  });
  assert.deepEqual(trackAgentInitialTitleInput(refs, "pane-1", session, "lo\r"), {
    committedTitle: "hello",
    materializeTitle: "hello",
  });
});

test("commitAgentSessionTitle returns the applied title for persistence", () => {
  const locale = "en";
  const t = createTranslator(locale);
  const refs = createAgentRuntimeRefs();
  const stateRef = {
    current: {
      ...createDraftState(),
      tabs: [
        {
          ...createDraftState().tabs[0],
          sessions: [createLiveSession()],
          activeSessionId: "4",
        },
      ],
    },
  };

  const appliedTitle = commitAgentSessionTitle({
    refs,
    paneId: "pane-1",
    tabId: "ws-1",
    sessionId: "4",
    rawInput: "hello world",
    locale,
    t,
    updateTab: (tabId, updater) => {
      stateRef.current = {
        ...stateRef.current,
        tabs: stateRef.current.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab)),
      };
    },
  });

  assert.equal(appliedTitle, "hello world");
  assert.equal(stateRef.current.tabs[0]?.sessions[0]?.title, "hello world");
});

test("commitAgentSessionTitle replaces unpadded generated backend titles", () => {
  const locale = "en";
  const t = createTranslator(locale);
  const refs = createAgentRuntimeRefs();
  const stateRef = {
    current: {
      ...createDraftState(),
      tabs: [
        {
          ...createDraftState().tabs[0],
          sessions: [
            {
              ...createLiveSession("Session 1"),
              id: "1",
            },
          ],
          activeSessionId: "1",
        },
      ],
    },
  };

  const appliedTitle = commitAgentSessionTitle({
    refs,
    paneId: "pane-1",
    tabId: "ws-1",
    sessionId: "1",
    rawInput: "title derived from first prompt",
    locale,
    t,
    updateTab: (tabId, updater) => {
      stateRef.current = {
        ...stateRef.current,
        tabs: stateRef.current.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab)),
      };
    },
  });

  assert.equal(appliedTitle, "title derived from first prompt");
  assert.equal(stateRef.current.tabs[0]?.sessions[0]?.title, "title derived from first prompt");
});

test("createSessionFromBackend preserves an existing custom title over a generic backend title", () => {
  const session = createSessionFromBackend(
    {
      id: 4,
      title: "Session 4",
      status: "idle",
      mode: "branch",
      auto_feed: true,
      queue: [],
      messages: [],
      stream: "",
      unread: 0,
      last_active_at: 1,
      claude_session_id: null,
    },
    "en",
    {
      id: "4",
      title: "test session duplication",
      status: "idle",
      mode: "branch",
      autoFeed: true,
      queue: [],
      messages: [],
      stream: "",
      unread: 0,
      lastActiveAt: 1,
      claudeSessionId: undefined,
    },
  );

  assert.equal(session.title, "test session duplication");
});

test("createSessionFromBackend sanitizes persisted agent stream control sequences", () => {
  const session = createSessionFromBackend(
    {
      id: 5,
      title: "Session 5",
      status: "idle",
      mode: "branch",
      auto_feed: true,
      queue: [],
      messages: [],
      stream: "hello\n\x1b[1A\x1b[2K\rworking\x1b[31m red\x1b[0m\n",
      unread: 0,
      last_active_at: 1,
      claude_session_id: null,
    },
    "en",
  );

  assert.equal(session.stream, "hello\nworking\x1b[31m red\x1b[0m\n");
});

test("materializeSession persists the derived first-input title to the backend session", async () => {
  const locale = "en";
  const t = createTranslator(locale);
  const stateRef = { current: createDraftState() };
  const toasts: Toast[] = [];
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });

    if (url.endsWith("/api/rpc/create_session")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          data: {
            id: 4,
            title: "Session 4",
            status: "idle",
            mode: "branch",
            auto_feed: true,
            queue: [],
            messages: [],
            stream: "",
            unread: 0,
            last_active_at: 1,
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
          data: {
            id: 4,
            title: "test session duplication",
            status: "idle",
            mode: "branch",
            auto_feed: true,
            queue: [],
            messages: [],
            stream: "",
            unread: 0,
            last_active_at: 1,
            claude_session_id: null,
          },
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
          addToast: (toast) => {
            toasts.push(toast);
          },
        });

        await actions.materializeSession("ws-1", "draft-1", "test session duplication");
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(toasts.length, 0);
  assert.deepEqual(
    calls.map((entry) => entry.url.replace("http://127.0.0.1:41033", "")),
    ["/api/rpc/create_session", "/api/rpc/session_update"],
  );
  assert.deepEqual(calls[1]?.body.patch, {
    title: "test session duplication",
  });
});
