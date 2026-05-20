import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import type { Database } from "../storage/database.js";
import { closeDatabase, openDatabase } from "../storage/db.js";
import { SessionMetadataRepo } from "../storage/repositories/session-metadata-repo.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";
import "../commands/session-metadata.js";

describe("session metadata commands", () => {
  let db: Database;
  let metadataRepo: SessionMetadataRepo;
  let ctx: CommandContext & { sessionMetadataRepo: SessionMetadataRepo };

  beforeEach(() => {
    db = openDatabase(":memory:");
    metadataRepo = new SessionMetadataRepo(db);
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
    metadataRepo.upsert({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      objective: "Fix the lint errors",
      baselineGitHead: "abc123",
      baselineCapturedAt: 100,
      verificationRuns: [],
    });

    ctx = {
      workspaceMgr: {} as never,
      sessionMgr: {} as never,
      terminalMgr: {} as never,
      eventBus: new EventBus(),
      broadcaster: { broadcast: vi.fn() } as never,
      db,
      providerRegistry: [],
      fencingMgr: {} as never,
      supervisorMgr: {} as never,
      autoFetch: {} as never,
      activationMgr: {} as never,
      sessionMetadataRepo: metadataRepo,
    };
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it("returns stored metadata", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "session-metadata-get",
        op: "session.metadata.get",
        args: {
          sessionId: "sess-1",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      objective: "Fix the lint errors",
      baselineGitHead: "abc123",
      baselineCapturedAt: 100,
      verificationRuns: [],
    });
  });

  it("appends verification runs through dispatch", async () => {
    const added = await dispatch(
      {
        kind: "command",
        id: "session-verification-add",
        op: "session.verification.add",
        args: {
          sessionId: "sess-1",
          command: "pnpm lint",
          status: "passed",
          exitCode: 0,
          summary: "lint clean",
        },
      },
      ctx
    );

    expect(added.ok).toBe(true);
    expect(added.data).toMatchObject({
      sessionId: "sess-1",
      verificationRuns: [
        expect.objectContaining({
          command: "pnpm lint",
          status: "passed",
          exitCode: 0,
          summary: "lint clean",
        }),
      ],
    });
  });
});
