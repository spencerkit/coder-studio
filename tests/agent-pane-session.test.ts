import test from "node:test";
import assert from "node:assert/strict";
import type { MutableRefObject } from "react";

import {
  resolveAgentPaneRuntimeSession,
  type AgentRuntimeRefs,
} from "../apps/web/src/features/agents/agent-runtime-actions";
import type { Session, Tab } from "../apps/web/src/state/workbench";

const ref = <T,>(value: T): MutableRefObject<T> => ({ current: value });

const createRuntimeRefs = (): AgentRuntimeRefs => ({
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

const createSession = (overrides: Partial<Session> = {}): Session => ({
  id: "session-1",
  title: "Session 1",
  status: "idle",
  mode: "branch",
  autoFeed: true,
  queue: [],
  messages: [],
  stream: "",
  unread: 0,
  lastActiveAt: 0,
  provider: "claude",
  ...overrides,
});

const createTab = (session: Session): Tab => ({
  id: "ws-1",
  title: "Workspace",
  status: "ready",
  controller: {
    role: "controller",
    deviceId: "device-a",
    clientId: "client-a",
    fencingToken: 1,
    takeoverPending: false,
    takeoverRequestedBySelf: false,
  },
  project: {
    kind: "local",
    path: "/tmp/ws-1",
    target: { type: "native" },
  },
  agent: {
    provider: session.provider,
    command: session.provider,
    useWsl: false,
  },
  git: { branch: "main", changes: 0, lastCommit: "HEAD" },
  gitChanges: [],
  worktrees: [],
  sessions: [session],
  activeSessionId: session.id,
  archive: [],
  terminals: [],
  activeTerminalId: "",
  fileTree: [],
  changesTree: [],
  filePreview: {
    path: "",
    content: "",
    mode: "preview",
    diff: "",
    originalContent: "",
    modifiedContent: "",
    dirty: false,
  },
  paneLayout: {
    type: "leaf",
    id: "pane-1",
    sessionId: session.id,
  },
  activePaneId: "pane-1",
  idlePolicy: {
    enabled: true,
    idleMinutes: 10,
    maxActive: 3,
    pressure: true,
  },
});

test("resolveAgentPaneRuntimeSession ignores draft panes", () => {
  const refs = createRuntimeRefs();
  refs.runningAgentKeysRef.current.add("ws-1:session-1");
  const session = createSession({ isDraft: true });
  const resolved = resolveAgentPaneRuntimeSession(refs, createTab(session), "pane-1");

  assert.equal(resolved, null);
});

test("resolveAgentPaneRuntimeSession ignores panes without a running runtime", () => {
  const refs = createRuntimeRefs();
  const session = createSession();
  const resolved = resolveAgentPaneRuntimeSession(refs, createTab(session), "pane-1");

  assert.equal(resolved, null);
});

test("resolveAgentPaneRuntimeSession returns the active non-draft session once runtime is started", () => {
  const refs = createRuntimeRefs();
  refs.runningAgentKeysRef.current.add("ws-1:session-1");
  const session = createSession();
  const resolved = resolveAgentPaneRuntimeSession(refs, createTab(session), "pane-1");

  assert.equal(resolved?.id, "session-1");
});
