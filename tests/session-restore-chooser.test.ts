import test from "node:test";
import assert from "node:assert/strict";
import { listRestoreCandidatesForWorkspace } from "../apps/web/src/features/workspace/session-restore-chooser.ts";
import type { SessionHistoryRecord } from "../apps/web/src/types/app.ts";

const createRecord = (overrides: Partial<SessionHistoryRecord>): SessionHistoryRecord => ({
  workspaceId: "ws-1",
  workspaceTitle: "Workspace One",
  workspacePath: "/tmp/ws-1",
  sessionId: "1",
  title: "Session 1",
  status: "idle",
  archived: true,
  mounted: false,
  recoverable: true,
  lastActiveAt: 1,
  archivedAt: 1,
  claudeSessionId: null,
  ...overrides,
});

test("listRestoreCandidatesForWorkspace only returns current workspace recoverable unmounted sessions", () => {
  const candidates = listRestoreCandidatesForWorkspace({
    workspaceId: "ws-1",
    mountedSessionIds: new Set(["2"]),
    records: [
      createRecord({ sessionId: "1" }),
      createRecord({ sessionId: "2" }),
      createRecord({ sessionId: "3", recoverable: false }),
      createRecord({ sessionId: "4", workspaceId: "ws-2", workspaceTitle: "Workspace Two", workspacePath: "/tmp/ws-2" }),
    ],
  });

  assert.deepEqual(candidates.map((record) => record.sessionId), ["1"]);
});
