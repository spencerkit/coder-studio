import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "../server.js";
import { SessionRepo, TerminalRepo } from "../storage/index.js";
import { dispatch } from "../ws/dispatch.js";

import "../commands/workspace.js";
import "../commands/session.js";

describe("session hydrate restart", () => {
  let server: Server | undefined;
  let stateDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "coder-studio-state-"));
    workspaceDir = mkdtempSync(join(tmpdir(), "coder-studio-workspace-"));
    mkdirSync(join(workspaceDir, ".git"), { recursive: true });
    writeFileSync(join(workspaceDir, ".git", "HEAD"), "ref: refs/heads/main\n");
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = undefined;
    }
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("restores persisted sessions into session.list after server restart", async () => {
    server = await createServer({
      stateDir,
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
      filePath: join(stateDir, "state", "terminals.json"),
    });
    const sessionRepo = new SessionRepo({
      filePath: join(stateDir, "state", "sessions.json"),
    });

    terminalRepo.insert({
      id: "term-hydrated",
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
      id: "sess-hydrated",
      workspace_id: workspaceId,
      terminal_id: "term-hydrated",
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

    await server.stop();
    server = undefined;

    server = await createServer({
      stateDir,
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
