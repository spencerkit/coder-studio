import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "../server.js";
import { SessionRepo, TerminalRepo } from "../storage/index.js";
import { dispatch } from "../ws/dispatch.js";

import "../commands/workspace.js";

describe("workspace close state cleanup", () => {
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

  it("removes file-backed sessions and terminals when a workspace is closed", async () => {
    server = await createServer({
      dataDir: dbPath,
      host: "127.0.0.1",
      port: 0,
    });

    const ctx = server.__test__!.commandContext;
    const openResult = await dispatch(
      {
        kind: "command",
        id: "workspace-open",
        op: "workspace.open",
        args: { path: workspaceDir },
      },
      ctx
    );

    expect(openResult.ok).toBe(true);
    const workspaceId = openResult.data!.id;

    const terminalRepo = new TerminalRepo({
      filePath: join(dataDir, "state", "terminals.json"),
      shadowDb: ctx.db,
    });
    const sessionRepo = new SessionRepo({
      filePath: join(dataDir, "state", "sessions.json"),
      shadowDb: ctx.db,
    });

    terminalRepo.insert({
      id: "term-close",
      workspaceId,
      kind: "agent",
      cwd: workspaceDir,
      argv: ["node", "agent.js"],
      cols: 120,
      rows: 30,
      alive: false,
      createdAt: Date.now(),
      endedAt: Date.now(),
      exitCode: 0,
      title: "Agent",
    });
    sessionRepo.insert({
      id: "sess-close",
      workspace_id: workspaceId,
      terminal_id: "term-close",
      provider_id: "claude",
      capability: "full",
      state: "ended",
      started_at: Date.now(),
      ended_at: Date.now(),
      last_active_at: Date.now(),
      completion_percent: null,
      error_reason: null,
      archived: 0,
      title: null,
      draft: null,
    });

    const closeResult = await dispatch(
      {
        kind: "command",
        id: "workspace-close",
        op: "workspace.close",
        args: { id: workspaceId },
      },
      ctx
    );

    expect(closeResult.ok).toBe(true);

    expect(terminalRepo.listByWorkspace(workspaceId)).toEqual([]);
    expect(sessionRepo.listByWorkspace(workspaceId)).toEqual([]);
  });
});
