import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveAgentPaneRenderState,
  resolveAgentPaneStream,
  resolveAgentPaneTerminalBinding,
} from "../apps/web/src/features/agents/agent-pane-render.ts";
import type { Session } from "../apps/web/src/state/workbench.ts";

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

test("draft launcher only renders for draft placeholder sessions", () => {
  assert.deepEqual(
    resolveAgentPaneRenderState(createSession({ isDraft: true }), true),
    { kind: "draft" },
  );

  assert.deepEqual(
    resolveAgentPaneRenderState(createSession({ isDraft: false }), true),
    { kind: "terminal", terminalMode: "interactive" },
  );
});

test("resolveAgentPaneStream prefers the live terminal stream over the transcript", () => {
  assert.equal(
    resolveAgentPaneStream(createSession({
      stream: "transcript output",
      liveTerminalStream: "\rworking\rworking.",
    })),
    "\rworking\rworking.",
  );

  assert.equal(
    resolveAgentPaneStream(createSession({
      stream: "transcript output",
    })),
    "transcript output",
  );
});

test("resolveAgentPaneTerminalBinding prefers bound terminal output before transcript fallback", () => {
  const session = createSession({
    id: "session-live",
    status: "running",
    stream: "persisted transcript",
    terminalId: "term-17",
  });
  const terminals = [
    { id: "term-17", title: "Terminal 17", output: "live terminal output", recoverable: true },
  ];

  assert.deepEqual(
    resolveAgentPaneTerminalBinding(session, "interactive", terminals as never),
    {
      stream: "live terminal output",
      streamId: "term-17",
      syncStrategy: "incremental",
    },
  );
});
