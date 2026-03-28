import test from "node:test";
import assert from "node:assert/strict";
import { resolveAgentPaneRenderState } from "../apps/web/src/features/agents/agent-pane-render.ts";
import type { Session } from "../apps/web/src/state/workbench.ts";

const createSession = (overrides: Partial<Session> = {}): Session => ({
  id: "session-1",
  title: "Session 1",
  status: "idle",
  mode: "branch",
  autoFeed: true,
  isDraft: false,
  queue: [],
  messages: [],
  stream: "hello\n",
  unread: 0,
  lastActiveAt: 1,
  ...overrides,
});

test("resolveAgentPaneRenderState keeps hidden draft placeholders in draft mode", () => {
  const state = resolveAgentPaneRenderState(createSession({
    isDraft: true,
    stream: "",
    queue: [],
    messages: [{ id: "msg-1", role: "system", content: "placeholder", time: "10:00" }],
  }), true);

  assert.deepEqual(state, { kind: "draft" });
});

test("resolveAgentPaneRenderState returns interactive mode for the active non-draft pane", () => {
  const state = resolveAgentPaneRenderState(createSession(), true);

  assert.deepEqual(state, {
    kind: "terminal",
    terminalMode: "interactive",
  });
});

test("resolveAgentPaneRenderState returns readonly mode for inactive non-draft panes", () => {
  const state = resolveAgentPaneRenderState(createSession(), false);

  assert.deepEqual(state, {
    kind: "terminal",
    terminalMode: "readonly",
  });
});
