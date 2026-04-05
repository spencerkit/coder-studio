import test from "node:test";
import assert from "node:assert/strict";
import { listRestoreCandidatesForWorkspace } from "../apps/web/src/features/workspace/session-restore-chooser";
import type { SessionHistoryRecord } from "../apps/web/src/types/app";

const createRecord = (overrides: Partial<SessionHistoryRecord>): SessionHistoryRecord => ({
  workspaceId: "ws-1",
  workspaceTitle: "Workspace One",
  workspacePath: "/tmp/ws-1",
  title: "Session 1",
  provider: "claude",
  mounted: false,
  createdAt: 0,
  lastActiveAt: 1,
  resumeId: "resume-1",
  ...overrides,
});

test("listRestoreCandidatesForWorkspace only returns current workspace detached provider sessions", () => {
  const candidates = listRestoreCandidatesForWorkspace({
    workspaceId: "ws-1",
    mountedProviders: new Set(["claude:resume-2", "claude:resume-3"]),
    records: [
      createRecord({ resumeId: "resume-1" }),
      createRecord({ resumeId: "resume-2" }),
      createRecord({ resumeId: "resume-3", mounted: true }),
      createRecord({ resumeId: "resume-4", workspaceId: "ws-2", workspaceTitle: "Workspace Two", workspacePath: "/tmp/ws-2" }),
    ],
  });

  assert.deepEqual(candidates.map((record) => record.resumeId), ["resume-1"]);
});
