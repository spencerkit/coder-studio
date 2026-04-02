import test from "node:test";
import assert from "node:assert/strict";
import {
  applySessionRuntimeBindings,
  collectSessionBoundTerminalIds,
  filterWorkspacePanelTerminals,
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
    stream: "persisted one",
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
    stream: "persisted two",
    unread: 0,
    lastActiveAt: 2,
  },
] as const;

test("applySessionRuntimeBindings hydrates runtime-only terminal ids onto sessions", () => {
  const next = applySessionRuntimeBindings(sessions as never, [
    { session_id: "2", terminal_id: "17" },
  ]);
  assert.equal(next[0].terminalId, undefined);
  assert.equal(next[1].terminalId, "term-17");
});

test("filterWorkspacePanelTerminals excludes terminals already bound to sessions", () => {
  const boundSessions = applySessionRuntimeBindings(sessions as never, [
    { session_id: "2", terminal_id: "17" },
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
