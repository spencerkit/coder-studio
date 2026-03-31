import test from "node:test";
import assert from "node:assert/strict";

import { resolveAgentPaneRenderState } from "../apps/web/src/features/agents/agent-pane-render.ts";
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
