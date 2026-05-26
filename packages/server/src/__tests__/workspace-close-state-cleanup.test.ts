import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "../server.js";
import { SessionRepo, TerminalRepo } from "../storage/index.js";
import { SessionMetadataRepo } from "../storage/repositories/session-metadata-repo.js";
import { WorkspaceRepo } from "../storage/repositories/workspace-repo.js";
import { dispatch } from "../ws/dispatch.js";

import "../commands/workspace.js";

describe("workspace close state cleanup", () => {
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

  it("removes file-backed sessions and terminals when a workspace is closed", async () => {
    server = await createServer({
      stateDir,
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
      filePath: join(stateDir, "state", "terminals.json"),
    });
    const sessionRepo = new SessionRepo({
      filePath: join(stateDir, "state", "sessions.json"),
    });
    const workspaceRepo = new WorkspaceRepo({
      filePath: join(stateDir, "state", "workspaces.json"),
    });
    const sessionMetadataRepo = new SessionMetadataRepo({
      workspaceRepo,
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
    sessionMetadataRepo.upsert({
      sessionId: "sess-close",
      workspaceId,
      providerId: "claude",
      verificationRuns: [],
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
    expect(sessionMetadataRepo.get("sess-close")).toBeUndefined();
  });
});
