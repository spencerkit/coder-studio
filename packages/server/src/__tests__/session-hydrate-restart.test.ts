import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "../server.js";
import { dispatch } from "../ws/dispatch.js";

import "../commands/workspace.js";
import "../commands/session.js";

describe("session hydrate restart", () => {
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

  it("restores persisted sessions into session.list after server restart", async () => {
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
    firstCtx.db
      .prepare(
        "INSERT INTO terminals (id, workspace_id, kind, cwd, argv, cols, rows, created_at, ended_at, exit_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run("term-hydrated", workspaceId, "agent", workspaceDir, "[]", 120, 30, now, now, 0);
    firstCtx.db
      .prepare(
        "INSERT INTO sessions (id, workspace_id, terminal_id, provider_id, capability, state, started_at, last_active_at, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)"
      )
      .run("sess-hydrated", workspaceId, "term-hydrated", "claude", "full", "running", now, now);

    await server.stop();
    server = undefined;

    server = await createServer({
      dataDir: dbPath,
      host: "127.0.0.1",
      port: 0,
    });

    const secondCtx = server.__test__!.commandContext;
    const listResult = await dispatch(
      {
        kind: "command",
        id: "session-list",
        op: "session.list",
        args: { workspaceId },
      },
      secondCtx
    );

    expect(listResult.ok).toBe(true);
    expect(listResult.data).toEqual([
      expect.objectContaining({
        id: "sess-hydrated",
        workspaceId,
        terminalId: "term-hydrated",
        state: "ended",
      }),
    ]);
  });
});
