import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "../server.js";
import { closeDatabase, openDatabase, SessionRepo, TerminalRepo } from "../storage/index.js";
import { createTargetFiles } from "../supervisor/target-store.js";
import { dispatch } from "../ws/dispatch.js";

import "../commands/workspace.js";
import "../commands/supervisor.js";

describe("supervisor hydrate restart", () => {
  let server: Server | undefined;
  let dataDir: string;
  let dbPath: string;
  let workspaceDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "coder-studio-data-"));
    dbPath = join(dataDir, "coder-studio.db");
    workspaceDir = mkdtempSync(join(tmpdir(), "coder-studio-workspace-"));
    mkdirSync(join(workspaceDir, ".git"), { recursive: true });
    writeFileSync(join(workspaceDir, ".git", "HEAD"), "ref: refs/heads/main\n");
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = undefined;
    }
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("does not auto-restore persisted supervisors after server restart", async () => {
    server = await createServer({
      dataDir: dbPath,
      host: "127.0.0.1",
      port: 0,
    });

    const firstCtx = server.__test__!.commandContext;
    const openResult = await dispatch(
      {
        kind: "command",
        id: "workspace-open",
        op: "workspace.open",
        args: { path: workspaceDir },
      },
      firstCtx
    );

    expect(openResult.ok).toBe(true);
    const workspaceId = openResult.data!.id;
    const now = Date.now();

    const terminalRepo = new TerminalRepo({
      filePath: join(dataDir, "state", "terminals.json"),
      shadowDb: firstCtx.db,
    });
    const sessionRepo = new SessionRepo({
      filePath: join(dataDir, "state", "sessions.json"),
      shadowDb: firstCtx.db,
    });

    terminalRepo.insert({
      id: "term-supervisor",
      workspaceId,
      kind: "agent",
      cwd: workspaceDir,
      argv: [],
      cols: 120,
      rows: 30,
      alive: false,
      createdAt: now,
      endedAt: now,
      exitCode: 0,
      title: "",
    });
    sessionRepo.insert({
      id: "sess-supervisor",
      workspace_id: workspaceId,
      terminal_id: "term-supervisor",
      provider_id: "claude",
      capability: "full",
      state: "running",
      started_at: now,
      ended_at: null,
      last_active_at: now,
      completion_percent: null,
      error_reason: null,
      archived: 0,
      title: null,
      draft: null,
    });
    firstCtx.db
      .prepare(
        `INSERT INTO supervisors (
          id,
          session_id,
          workspace_id,
          state,
          objective,
          evaluator_provider_id,
          evaluator_model,
          max_supervision_count,
          completed_supervision_count,
          scheduled_at,
          stop_reason,
          last_cycle_at,
          last_evaluated_turn_id,
          error_reason,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "sup-persisted",
        "sess-supervisor",
        workspaceId,
        "idle",
        "Recover this later",
        "claude",
        null,
        0,
        0,
        null,
        null,
        null,
        null,
        null,
        now,
        now
      );

    await createTargetFiles(workspaceDir, {
      targetId: "sup-persisted",
      sessionId: "sess-supervisor",
      workspaceId,
      objective: "Recover this later",
      createdAt: now,
    });

    await server.stop();
    server = undefined;

    const shadowDb = openDatabase(dbPath);
    try {
      shadowDb.prepare("DELETE FROM sessions WHERE id = ?").run("sess-supervisor");
      shadowDb.prepare("DELETE FROM terminals WHERE id = ?").run("term-supervisor");
    } finally {
      closeDatabase(shadowDb);
    }

    server = await createServer({
      dataDir: dbPath,
      host: "127.0.0.1",
      port: 0,
    });

    const secondCtx = server.__test__!.commandContext;
    const getResult = await dispatch(
      {
        kind: "command",
        id: "supervisor-get",
        op: "supervisor.get",
        args: { sessionId: "sess-supervisor" },
      },
      secondCtx
    );

    expect(getResult.ok).toBe(true);
    expect(getResult.data).toEqual({ supervisor: null });

    const recoverableResult = await dispatch(
      {
        kind: "command",
        id: "supervisor-list-recoverable",
        op: "supervisor.listRecoverableTargets",
        args: { workspaceId },
      },
      secondCtx
    );

    expect(recoverableResult.ok).toBe(true);
    expect(recoverableResult.data).toEqual({
      targets: [
        expect.objectContaining({
          targetId: "sup-persisted",
          sessionId: "sess-supervisor",
          workspaceId,
          objective: "Recover this later",
        }),
      ],
    });
  });
});
