import test from "node:test";
import assert from "node:assert/strict";
import {
  applySessionRuntimeBindings,
  collectSessionBoundTerminalIds,
  filterWorkspacePanelTerminals,
  resolveSessionBoundTerminal,
  resolveSessionTerminalIdByRuntimeId,
} from "../apps/web/src/features/workspace/session-runtime-bindings.ts";

const sessions = [
  {
    id: "1",
    title: "Session 1",
    status: "idle",
    mode: "branch",
    provider: "claude",
    autoFeed: true,
    queue: [],
    messages: [],
    unread: 0,
    lastActiveAt: 1,
  },
  {
    id: "2",
    title: "Session 2",
    status: "running",
    mode: "branch",
    provider: "codex",
    autoFeed: true,
    queue: [],
    messages: [],
    unread: 0,
    lastActiveAt: 2,
  },
] as const;

test("applySessionRuntimeBindings keeps session-backed bindings runtime-first when no workspace terminal id is available", () => {
  const next = applySessionRuntimeBindings(sessions as never, [
    { session_id: "2", terminal_id: "17", terminal_runtime_id: "runtime-17" },
  ]);
  assert.equal(next[0].terminalId, undefined);
  assert.equal(next[0].terminalRuntimeId, undefined);
  assert.equal(next[1].terminalId, undefined);
  assert.equal(next[1].terminalRuntimeId, "runtime-17");
});

test("applySessionRuntimeBindings preserves an existing runtime id when a recovered binding omits it without repopulating legacy terminal ids", () => {
  const next = applySessionRuntimeBindings([
    {
      ...sessions[1],
      terminalId: "term-17",
      terminalRuntimeId: "runtime-17",
    },
  ] as never, [
    { session_id: "2", terminal_id: "17" },
  ]);

  assert.equal(next[0]?.terminalId, undefined);
  assert.equal(next[0]?.terminalRuntimeId, "runtime-17");
});

test("applySessionRuntimeBindings still stores workspace terminal ids only for compatibility when provided", () => {
  const next = applySessionRuntimeBindings(sessions as never, [
    { session_id: "2", terminal_id: "17", terminal_runtime_id: "runtime-17", workspace_terminal_id: "17" },
  ]);

  assert.equal(next[1]?.terminalId, "term-17");
  assert.equal(next[1]?.terminalRuntimeId, "runtime-17");
});

test("applySessionRuntimeBindings clears terminal linkage when a binding disappears", () => {
  const next = applySessionRuntimeBindings([
    {
      ...sessions[1],
      terminalId: "term-17",
      terminalRuntimeId: "runtime-17",
    },
  ] as never, []);

  assert.equal(next[0]?.terminalId, undefined);
  assert.equal(next[0]?.terminalRuntimeId, undefined);
  assert.equal(next[0]?.title, sessions[1].title);
  assert.equal(next[0]?.status, sessions[1].status);
});

test("resolveSessionTerminalIdByRuntimeId prefers the runtime binding over a stale terminal id", () => {
  const terminalId = resolveSessionTerminalIdByRuntimeId([
    {
      ...sessions[1],
      terminalId: "term-17",
      terminalRuntimeId: "runtime-17",
    },
  ] as never, "runtime-17");

  assert.equal(terminalId, "term-17");
});

test("resolveSessionTerminalIdByRuntimeId returns no terminal when the runtime is unknown", () => {
  const terminalId = resolveSessionTerminalIdByRuntimeId([
    {
      ...sessions[1],
      terminalId: "term-17",
      terminalRuntimeId: "runtime-17",
    },
  ] as never, "runtime-missing");

  assert.equal(terminalId, undefined);
});

test("resolveSessionTerminalIdByRuntimeId resolves a session terminal after the legacy terminal id changes only when compatibility ids are present", () => {
  const reboundSessions = applySessionRuntimeBindings([
    {
      ...sessions[1],
      terminalId: "term-17",
      terminalRuntimeId: "runtime-17",
    },
  ] as never, [
    { session_id: "2", terminal_id: "42", terminal_runtime_id: "runtime-17", workspace_terminal_id: "42" },
  ]);

  assert.equal(resolveSessionTerminalIdByRuntimeId(reboundSessions as never, "runtime-17"), "term-42");
  assert.equal(reboundSessions[0]?.terminalId, "term-42");
  assert.equal(reboundSessions[0]?.terminalRuntimeId, "runtime-17");
});

test("filterWorkspacePanelTerminals excludes terminals already bound to sessions only when compatibility ids are present", () => {
  const boundSessions = applySessionRuntimeBindings(sessions as never, [
    { session_id: "2", terminal_id: "17", workspace_terminal_id: "17" },
  ]);
  assert.deepEqual(Array.from(collectSessionBoundTerminalIds(boundSessions)).sort(), ["term-17"]);
  const visible = filterWorkspacePanelTerminals(
    [
      { id: "term-7", title: "Term 1", output: "workspace", recoverable: true },
      { id: "term-17", title: "Term 2", output: "session", recoverable: true },
    ] as never,
    boundSessions as never,
  );
  assert.deepEqual(visible.map((terminal) => terminal.id), ["term-7"]);
});

test("collectSessionBoundTerminalIds stays empty for runtime-only session bindings", () => {
  const boundSessions = applySessionRuntimeBindings(sessions as never, [
    { session_id: "2", terminal_id: "17", terminal_runtime_id: "runtime-17" },
  ]);

  assert.deepEqual(Array.from(collectSessionBoundTerminalIds(boundSessions)), []);
});

test("resolveSessionBoundTerminal prefers runtime-keyed terminal entries before legacy terminal ids", () => {
  const boundSessions = applySessionRuntimeBindings([
    {
      ...sessions[1],
      terminalId: "term-17",
      terminalRuntimeId: "runtime-17",
    },
  ] as never, [
    { session_id: "2", terminal_id: "17", terminal_runtime_id: "runtime-17" },
  ]);

  const boundTerminal = resolveSessionBoundTerminal(
    boundSessions as never,
    "runtime-17",
    [
      { id: "runtime-17", title: "Runtime 17", output: "runtime stream", recoverable: true },
      { id: "term-17", title: "Legacy 17", output: "legacy stream", recoverable: true },
    ] as never,
  );

  assert.equal(boundTerminal?.id, "runtime-17");
  assert.equal(boundTerminal?.output, "runtime stream");
});

test("resolveSessionBoundTerminal falls back to the legacy terminal id when runtime-keyed entries are unavailable", () => {
  const boundTerminal = resolveSessionBoundTerminal([
    {
      ...sessions[1],
      terminalId: "term-42",
      terminalRuntimeId: "runtime-17",
    },
  ] as never, "runtime-17", [
    { id: "term-42", title: "Legacy 42", output: "legacy stream", recoverable: true },
  ] as never);

  assert.equal(boundTerminal?.id, "term-42");
  assert.equal(boundTerminal?.output, "legacy stream");
});
