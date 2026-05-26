import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../storage/database.js";
import { closeDatabase, openDatabase } from "../storage/db.js";
import { SessionMetadataRepo } from "../storage/repositories/session-metadata-repo.js";

describe("SessionMetadataRepo", () => {
  let db: Database;
  let repo: SessionMetadataRepo;

  beforeEach(() => {
    db = openDatabase(":memory:");
    repo = new SessionMetadataRepo(db);
    db.prepare(
      `INSERT INTO workspaces (id, path, target_runtime, opened_at, last_active_at, ui_state)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      "ws-1",
      "/tmp/ws-1",
      "native",
      1,
      1,
      JSON.stringify({ leftPanelWidth: 1, bottomPanelHeight: 1, focusMode: false })
    );
    db.prepare(
      `INSERT INTO terminals (id, workspace_id, kind, cwd, argv, cols, rows, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("term-1", "ws-1", "agent", "/tmp/ws-1", JSON.stringify(["codex"]), 80, 24, 1);
    db.prepare(
      `INSERT INTO sessions (id, workspace_id, terminal_id, provider_id, capability, state, started_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("sess-1", "ws-1", "term-1", "codex", "full", "starting", 1, 1);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it("creates and reads session metadata without verification runs", () => {
    repo.upsert({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      objective: "Fix the failing tests",
      baselineGitHead: "abc123",
      baselineCapturedAt: 1000,
      verificationRuns: [],
    });

    expect(repo.get("sess-1")).toEqual({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      objective: "Fix the failing tests",
      baselineGitHead: "abc123",
      baselineCapturedAt: 1000,
      verificationRuns: [],
    });
  });

  it("appends verification runs in created order", () => {
    repo.upsert({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      verificationRuns: [],
    });

    repo.addVerificationRun("sess-1", {
      id: "verify-1",
      command: "pnpm test",
      status: "failed",
      exitCode: 1,
      summary: "2 tests failing",
      createdAt: 100,
    });
    repo.addVerificationRun("sess-1", {
      id: "verify-2",
      command: "pnpm test",
      status: "passed",
      exitCode: 0,
      summary: "all green",
      createdAt: 200,
    });

    expect(repo.get("sess-1")?.verificationRuns).toEqual([
      {
        id: "verify-1",
        command: "pnpm test",
        status: "failed",
        exitCode: 1,
        summary: "2 tests failing",
        createdAt: 100,
      },
      {
        id: "verify-2",
        command: "pnpm test",
        status: "passed",
        exitCode: 0,
        summary: "all green",
        createdAt: 200,
      },
    ]);
  });
});
