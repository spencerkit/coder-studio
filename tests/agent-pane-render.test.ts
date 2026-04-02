import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  resolveAgentPaneRenderState,
  resolveAgentPaneTerminalBinding,
  resolveAgentPaneStream,
} from "../apps/web/src/features/agents/agent-pane-render";
import { resolveTerminalInteractionMode } from "../apps/web/src/shared/utils/terminal-interaction";
import type { Session, Terminal } from "../apps/web/src/state/workbench";

const createSession = (patch: Partial<Session> = {}): Session => ({
  id: "session-1",
  title: "Session 1",
  status: "idle",
  mode: "branch",
  provider: "claude",
  autoFeed: true,
  queue: [],
  messages: [
    {
      id: "msg-1",
      role: "system",
      content: "ready",
      time: "10:00",
    },
  ],
  stream: "",
  unread: 0,
  lastActiveAt: 1,
  ...patch,
});

const createTerminal = (patch: Partial<Terminal> = {}): Terminal => ({
  id: "term-1",
  title: "Terminal 1",
  output: "",
  recoverable: true,
  ...patch,
});

test("draft launcher only renders for draft placeholder sessions", () => {
  assert.deepEqual(
    resolveAgentPaneRenderState(createSession({ isDraft: true }), true),
    { kind: "draft" },
  );

  assert.deepEqual(
    resolveAgentPaneRenderState(createSession({ isDraft: false }), true),
    { kind: "terminal", terminalMode: "interactive" },
  );

  assert.deepEqual(
    resolveAgentPaneRenderState(createSession({ isDraft: false }), true, false),
    { kind: "terminal", terminalMode: "readonly" },
  );
});

test("resolveTerminalInteractionMode disables focused terminals when workspace input is read-only", () => {
  assert.equal(resolveTerminalInteractionMode(true, true), "interactive");
  assert.equal(resolveTerminalInteractionMode(true, false), "readonly");
  assert.equal(resolveTerminalInteractionMode(false, true), "readonly");
});

test("resolveAgentPaneStream returns the persisted transcript for archive rendering", () => {
  assert.equal(
    resolveAgentPaneStream(createSession({
      status: "running",
      stream: "transcript output",
    })),
    "transcript output",
  );

  assert.equal(
    resolveAgentPaneStream(createSession({
      status: "running",
      stream: "transcript output",
    })),
    "transcript output",
  );
});

test("resolveAgentPaneTerminalBinding prefers bound terminal output before transcript fallback", () => {
  const session = createSession({
    id: "session-bound",
    status: "running",
    stream: "transcript output",
    terminalId: "term-17",
  });
  const terminals = [
    createTerminal({ id: "term-17", title: "Terminal 17", output: "live terminal output" }),
  ];

  assert.deepEqual(
    resolveAgentPaneTerminalBinding(session, "interactive", terminals),
    {
      stream: "live terminal output",
      streamId: "term-17",
      syncStrategy: "snapshot",
      renderMode: "terminal",
    },
  );
});

test("resolveAgentPaneTerminalBinding keeps bound codex terminals on the live terminal path", () => {
  const session = createSession({
    id: "session-codex",
    status: "running",
    provider: "codex",
    stream: "transcript output",
    terminalId: "term-17",
  });
  const terminals = [
    createTerminal({
      id: "term-17",
      title: "Terminal 17",
      output: "\u001b[1;1H>\u001b[1;3HYou are in /tmp/demo",
    }),
  ];

  assert.deepEqual(
    resolveAgentPaneTerminalBinding(session, "interactive", terminals),
    {
      stream: "\u001b[1;1H>\u001b[1;3HYou are in /tmp/demo",
      streamId: "term-17",
      syncStrategy: "incremental",
      renderMode: "terminal",
    },
  );
});

test("AgentPaneLeaf rerenders when bound terminal snapshots change", () => {
  const source = readFileSync(
    new URL("../apps/web/src/features/agents/AgentWorkspaceFeature.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /previous\.terminals === next\.terminals/,
  );
});
