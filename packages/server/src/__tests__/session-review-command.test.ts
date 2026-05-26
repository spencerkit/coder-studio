import { execFile } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { SessionMetadataRepo } from "../storage/repositories/session-metadata-repo.js";
import { WorkspaceRepo } from "../storage/repositories/workspace-repo.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";
import "../commands/session-review.js";

const execFileAsync = promisify(execFile);

describe("session review commands", () => {
  let repoDir: string;
  let stateDir: string;
  let metadataRepo: SessionMetadataRepo;
  let workspaceRepo: WorkspaceRepo;
  let ctx: CommandContext & { sessionMetadataRepo: SessionMetadataRepo };

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "session-review-command-"));
    stateDir = await mkdtemp(join(tmpdir(), "session-review-command-state-"));
    workspaceRepo = new WorkspaceRepo({
      filePath: join(stateDir, "workspaces.json"),
    });
    workspaceRepo.create({
      id: "ws-1",
      path: repoDir,
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: { leftPanelWidth: 1, bottomPanelHeight: 1, focusMode: false },
    });
    metadataRepo = new SessionMetadataRepo({
      workspaceRepo,
    });

    await execFileAsync("git", ["init"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    await writeFile(join(repoDir, "sample.ts"), "export const value = 1;\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "Initial commit"], { cwd: repoDir });
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoDir });
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
      db: {} as never,
      providerRegistry: [],
      fencingMgr: {} as never,
      supervisorMgr: {} as never,
      autoFetch: {} as never,
      activationMgr: {} as never,
      sessionMetadataRepo: metadataRepo,
    };
  });

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true });
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
