import { execFile } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { closeDatabase, openDatabase } from "../storage/db.js";
import { SessionMetadataRepo } from "../storage/repositories/session-metadata-repo.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";
import "../commands/session-review.js";

const execFileAsync = promisify(execFile);

describe("session review commands", () => {
  let db: ReturnType<typeof openDatabase>;
  let repoDir: string;
  let metadataRepo: SessionMetadataRepo;
  let ctx: CommandContext & { sessionMetadataRepo: SessionMetadataRepo };

  beforeEach(async () => {
    db = openDatabase(":memory:");
    repoDir = await mkdtemp(join(tmpdir(), "session-review-command-"));
    metadataRepo = new SessionMetadataRepo(db);

    await execFileAsync("git", ["init"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    await writeFile(join(repoDir, "sample.ts"), "export const value = 1;\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "Initial commit"], { cwd: repoDir });
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoDir });

    db.prepare(
      `INSERT INTO workspaces (id, path, target_runtime, opened_at, last_active_at, ui_state)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      "ws-1",
      repoDir,
      "native",
      1,
      1,
      JSON.stringify({ leftPanelWidth: 1, bottomPanelHeight: 1, focusMode: false })
    );
    db.prepare(
      `INSERT INTO terminals (id, workspace_id, kind, cwd, argv, cols, rows, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("term-1", "ws-1", "agent", repoDir, JSON.stringify(["codex"]), 80, 24, 1);
    db.prepare(
      `INSERT INTO sessions (id, workspace_id, terminal_id, provider_id, capability, state, started_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("sess-1", "ws-1", "term-1", "codex", "full", "starting", 1, 1);
    metadataRepo.upsert({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      baselineGitHead: stdout.trim(),
      baselineCapturedAt: 1,
      verificationRuns: [],
    });

    ctx = {
      workspaceMgr: {
        get(id: string) {
          return id === "ws-1"
            ? {
                id,
                path: repoDir,
                targetRuntime: "native",
                openedAt: 1,
                lastActiveAt: 1,
                uiState: { leftPanelWidth: 1, bottomPanelHeight: 1, focusMode: false },
              }
            : undefined;
        },
      } as never,
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

  afterEach(async () => {
    closeDatabase(db);
    await rm(repoDir, { recursive: true, force: true });
  });

  it("returns summary through dispatch", async () => {
    await writeFile(join(repoDir, "sample.ts"), "export const value = 2;\n");

    const result = await dispatch(
      {
        kind: "command",
        id: "session-review-summary",
        op: "sessionReview.summary",
        args: {
          sessionId: "sess-1",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      changedFiles: [{ path: "sample.ts", status: "modified" }],
    });
  });

  it("returns diff through dispatch", async () => {
    await writeFile(join(repoDir, "sample.ts"), "export const value = 2;\n");

    const result = await dispatch(
      {
        kind: "command",
        id: "session-review-diff",
        op: "sessionReview.diff",
        args: {
          sessionId: "sess-1",
          path: "sample.ts",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      path: "sample.ts",
      diff: expect.stringContaining("+export const value = 2;"),
    });
  });
});
