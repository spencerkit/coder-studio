import test from "node:test";
import assert from "node:assert/strict";
import {
  createInitialHistoryExpansion,
  groupSessionHistory,
  mapSessionHistoryRecord,
  selectHistoryPrimaryActionBadge,
  selectHistoryPrimaryAction,
} from "../apps/web/src/features/workspace/session-history";
import type { BackendSessionHistoryRecord, SessionHistoryRecord } from "../apps/web/src/types/app";

const createRecord = (overrides: Partial<SessionHistoryRecord>): SessionHistoryRecord => ({
  workspaceId: "ws-1",
  workspaceTitle: "Workspace One",
  workspacePath: "/tmp/ws-1",
  sessionId: "1",
  title: "Session 1",
  status: "idle",
  provider: "claude",
  archived: false,
  mounted: false,
  recoverable: true,
  lastActiveAt: 1,
  archivedAt: null,
  resumeId: null,
  ...overrides,
});

test("mapSessionHistoryRecord normalizes backend payload fields", () => {
  const backendRecord: BackendSessionHistoryRecord = {
    workspace_id: "ws-1",
    workspace_title: "Workspace One",
    workspace_path: "/tmp/ws-1",
    session_id: 42,
    title: "Session 42",
    status: "suspended",
    provider: "claude",
    archived: true,
    mounted: false,
    recoverable: true,
    last_active_at: 1730000000000,
    archived_at: 1730000001000,
    resume_id: "claude-42",
  };

  assert.deepEqual(mapSessionHistoryRecord(backendRecord), {
    workspaceId: "ws-1",
    workspaceTitle: "Workspace One",
    workspacePath: "/tmp/ws-1",
    sessionId: "42",
    title: "Session 42",
    status: "suspended",
    provider: "claude",
    archived: true,
    mounted: false,
    recoverable: true,
    lastActiveAt: 1730000000000,
    archivedAt: 1730000001000,
    resumeId: "claude-42",
  });
});

test("groupSessionHistory keeps the current workspace first and sorts records by recent activity", () => {
  const groups = groupSessionHistory([
    createRecord({ workspaceId: "ws-1", workspaceTitle: "Workspace One", lastActiveAt: 100, sessionId: "1" }),
    createRecord({ workspaceId: "ws-2", workspaceTitle: "Workspace Two", workspacePath: "/tmp/ws-2", lastActiveAt: 300, sessionId: "2" }),
    createRecord({ workspaceId: "ws-1", workspaceTitle: "Workspace One", lastActiveAt: 200, sessionId: "3" }),
  ], "ws-1");

  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.workspaceId, "ws-1");
  assert.deepEqual(groups[0]?.records.map((record) => record.sessionId), ["3", "1"]);
  assert.equal(groups[1]?.workspaceId, "ws-2");
});

test("selectHistoryPrimaryAction distinguishes focus restore and noop", () => {
  assert.equal(selectHistoryPrimaryAction(createRecord({ mounted: true, archived: false, recoverable: true })), "focus");
  assert.equal(selectHistoryPrimaryAction(createRecord({ mounted: false, archived: true, recoverable: true })), "restore");
  assert.equal(selectHistoryPrimaryAction(createRecord({ mounted: false, archived: false, recoverable: false })), "noop");
});

test("selectHistoryPrimaryActionBadge hides redundant focus badges and keeps restore actions", () => {
  assert.equal(
    selectHistoryPrimaryActionBadge(createRecord({ mounted: true, archived: false, recoverable: true })),
    null,
  );
  assert.equal(
    selectHistoryPrimaryActionBadge(createRecord({ mounted: false, archived: true, recoverable: true })),
    "restore",
  );
  assert.equal(
    selectHistoryPrimaryActionBadge(createRecord({ mounted: false, archived: false, recoverable: false })),
    "open",
  );
});

test("createInitialHistoryExpansion expands only the current workspace by default", () => {
  const expansion = createInitialHistoryExpansion([
    {
      workspaceId: "ws-1",
      workspaceTitle: "Workspace One",
      workspacePath: "/tmp/ws-1",
      records: [],
    },
    {
      workspaceId: "ws-2",
      workspaceTitle: "Workspace Two",
      workspacePath: "/tmp/ws-2",
      records: [],
    },
  ], "ws-2");

  assert.deepEqual(expansion, {
    "ws-1": false,
    "ws-2": true,
  });
});
