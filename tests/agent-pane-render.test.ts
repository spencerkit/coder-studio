import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../apps/web/src/features/agents/agent-pane-render.ts", import.meta.url),
  "utf8",
);

const createSession = (patch = {}) => ({
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
  unread: 0,
  lastActiveAt: 1,
  ...patch,
});

const createTerminal = (patch = {}) => ({
  id: "term-1",
  title: "Terminal 1",
  output: "",
  recoverable: true,
  ...patch,
});

const resolveTerminalInteractionMode = (isPaneActive, inputEnabled = true) => (
  isPaneActive && inputEnabled ? "interactive" : "readonly"
);

const resolveAgentPaneRenderState = (session, isPaneActive, inputEnabled = true) => {
  if (session.isDraft) {
    return { kind: "draft" };
  }

  return {
    kind: "terminal",
    terminalMode: resolveTerminalInteractionMode(isPaneActive, inputEnabled),
  };
};

const resolveAgentPaneTerminalBinding = (session, _terminalMode, terminals = []) => {
  const boundTerminal = session.terminalRuntimeId
    ? terminals.find((terminal) => terminal.id === session.terminalRuntimeId)
      ?? (session.terminalId
        ? terminals.find((terminal) => terminal.id === session.terminalId)
        : undefined)
    : (session.terminalId
      ? terminals.find((terminal) => terminal.id === session.terminalId)
      : undefined);

  return {
    stream: boundTerminal?.output ?? "",
    streamId: session.terminalRuntimeId ?? boundTerminal?.id ?? session.id,
    syncStrategy: boundTerminal ? "snapshot" : "incremental",
    renderMode: "terminal",
  };
};

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

test("resolveAgentPaneTerminalBinding prefers bound terminal output before transcript fallback", () => {
  const session = createSession({
    id: "session-bound",
    status: "running",
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
      syncStrategy: "snapshot",
      renderMode: "terminal",
    },
  );
});

test("resolveAgentPaneTerminalBinding prefers runtime identity before legacy terminal fallback", () => {
  const session = createSession({
    id: "session-runtime-bound",
    status: "running",
    terminalRuntimeId: "runtime-17",
    terminalId: "term-17",
  });
  const terminals = [
    createTerminal({ id: "term-17", title: "Terminal 17", output: "live terminal output" }),
  ];

  assert.deepEqual(
    resolveAgentPaneTerminalBinding(session, "interactive", terminals),
    {
      stream: "live terminal output",
      streamId: "runtime-17",
      syncStrategy: "snapshot",
      renderMode: "terminal",
    },
  );
});

test("resolveAgentPaneTerminalBinding keeps runtime-first identity even when only the runtime binding remains", () => {
  const session = createSession({
    id: "session-runtime-bound",
    status: "running",
    terminalRuntimeId: "runtime-17",
  });

  assert.deepEqual(
    resolveAgentPaneTerminalBinding(session, "interactive", []),
    {
      stream: "",
      streamId: "runtime-17",
      syncStrategy: "incremental",
      renderMode: "terminal",
    },
  );
});

test("agent-pane-render source only uses legacy terminal ids as a fallback after terminal runtime identity", () => {
  assert.match(source, /const runtimeTerminal = session\.terminalRuntimeId/);
  assert.match(source, /const legacyTerminal = !runtimeTerminal && session\.terminalId/);
  assert.match(source, /stream: runtimeTerminal\?\.output \?\? legacyTerminal\?\.output \?\? ""/);
  assert.match(source, /streamId: session\.terminalRuntimeId \?\? runtimeTerminal\?\.id \?\? legacyTerminal\?\.id \?\? session\.id/);
});

test("AgentPaneLeaf rerenders when bound terminal snapshots change", () => {
  const featureSource = readFileSync(
    new URL("../apps/web/src/features/agents/AgentWorkspaceFeature.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    featureSource,
    /previous\.terminals === next\.terminals/,
  );
});
