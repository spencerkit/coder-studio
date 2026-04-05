import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  resolveAgentRecoveryAction,
} from "../apps/web/src/features/workspace/workspace-recovery";
import { createWorkspaceControllerState } from "../apps/web/src/features/workspace/workspace-controller";
import { replaceWorkspaceTerminalEntry } from "../apps/web/src/features/workspace/terminal-actions";

test("controller gets resume action for interrupted session with resume id", () => {
  const action = resolveAgentRecoveryAction(
    createWorkspaceControllerState({
      role: "controller",
      deviceId: "device-a",
      clientId: "client-a",
      fencingToken: 1,
    }),
    {
      id: "1",
      title: "Session 1",
      status: "interrupted",
      mode: "branch",
      provider: "claude",
      autoFeed: true,
      queue: [],
      messages: [],
      unread: 0,
      lastActiveAt: 1,
      resumeId: "resume-77",
    },
  );

  assert.equal(action?.kind, "resume");
});

test("controller gets restart action for interrupted session without resume id", () => {
  const action = resolveAgentRecoveryAction(
    createWorkspaceControllerState({
      role: "controller",
      deviceId: "device-a",
      clientId: "client-a",
      fencingToken: 1,
    }),
    {
      id: "1",
      title: "Session 1",
      status: "interrupted",
      mode: "branch",
      provider: "codex",
      autoFeed: true,
      queue: [],
      messages: [],
      unread: 0,
      lastActiveAt: 1,
    },
  );

  assert.equal(action?.kind, "restart");
});

test("controller does not get recovery action once interrupted session is rebound to a live terminal", () => {
  const action = resolveAgentRecoveryAction(
    createWorkspaceControllerState({
      role: "controller",
      deviceId: "device-a",
      clientId: "client-a",
      fencingToken: 1,
    }),
    {
      id: "1",
      title: "Session 1",
      status: "interrupted",
      mode: "branch",
      provider: "codex",
      autoFeed: true,
      queue: [],
      messages: [],
      unread: 0,
      lastActiveAt: 1,
      resumeId: "resume-77",
      terminalId: "term-1",
    },
  );

  assert.equal(action, null);
});

test("controller does not get recovery action for unavailable missing sessions", () => {
  const action = resolveAgentRecoveryAction(
    createWorkspaceControllerState({
      role: "controller",
      deviceId: "device-a",
      clientId: "client-a",
      fencingToken: 1,
    }),
    {
      id: "1",
      title: "Session 1",
      status: "interrupted",
      mode: "branch",
      provider: "claude",
      autoFeed: true,
      queue: [],
      messages: [],
      unread: 0,
      lastActiveAt: 1,
      resumeId: "resume-77",
      unavailableReason: "该会话已经被删除，无法恢复",
    },
  );

  assert.equal(action, null);
});

test("observer does not get agent recovery action", () => {
  const action = resolveAgentRecoveryAction(
    createWorkspaceControllerState({
      role: "observer",
      deviceId: "device-a",
      clientId: "client-a",
      fencingToken: 1,
    }),
    {
      id: "1",
      title: "Session 1",
      status: "interrupted",
      mode: "branch",
      provider: "claude",
      autoFeed: true,
      queue: [],
      messages: [],
      unread: 0,
      lastActiveAt: 1,
      resumeId: "resume-77",
    },
  );

  assert.equal(action, null);
});

test("replaceWorkspaceTerminalEntry swaps the current terminal in place", () => {
  const next = replaceWorkspaceTerminalEntry({
    id: "ws-1",
    title: "Workspace 1",
    status: "ready",
    controller: createWorkspaceControllerState({
      role: "controller",
      deviceId: "device-a",
      clientId: "client-a",
      fencingToken: 1,
    }),
    project: {
      kind: "local",
      path: "/tmp/project",
      target: { type: "native" },
    },
    git: {
      branch: "main",
      changes: 0,
      lastCommit: "abc123",
    },
    gitChanges: [],
    worktrees: [],
    sessions: [],
    activeSessionId: "session-1",
    archive: [],
    terminals: [
      {
        id: "term-1",
        title: "Terminal 1",
        output: "[terminal exited]",
        recoverable: false,
      },
      {
        id: "term-2",
        title: "Terminal 2",
        output: "live",
        recoverable: true,
      },
    ],
    activeTerminalId: "term-1",
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
      sessionId: "session-1",
    },
    activePaneId: "pane-1",
    idlePolicy: {
      enabled: true,
      idleMinutes: 10,
      maxActive: 3,
      pressure: true,
    },
  }, "term-1", {
    id: "term-7",
    title: "Terminal 1",
    output: "",
    recoverable: true,
  });

  assert.equal(next.activeTerminalId, "term-7");
  assert.deepEqual(next.terminals.map((terminal) => terminal.id), ["term-7", "term-2"]);
  assert.equal(next.terminals[0]?.title, "Terminal 1");
  assert.equal(next.terminals[0]?.recoverable, true);
});

test("workspace screen auto-replaces dead shell terminals instead of rendering a recovery banner", async () => {
  const source = await fs.readFile(
    new URL("../apps/web/src/features/workspace/WorkspaceScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /workspace-terminal-recovery-banner/);
  assert.match(source, /replaceWorkspaceTerminal\(/);
});

test("terminal recovery banner copy is removed from i18n and replacement errors use create wording", async () => {
  const [i18nSource, terminalActionsSource] = await Promise.all([
    fs.readFile(new URL("../apps/web/src/i18n.ts", import.meta.url), "utf8"),
    fs.readFile(new URL("../apps/web/src/features/workspace/terminal-actions.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(i18nSource, /workspaceTerminalRecoveryTitle/);
  assert.doesNotMatch(i18nSource, /workspaceTerminalRecoveryBody/);
  assert.doesNotMatch(terminalActionsSource, /workspaceTerminalRecoveryAction/);
  assert.match(terminalActionsSource, /workspaceTerminalCreateFailed/);
});
