import { execFile } from "child_process";
import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { openDatabase, runMigrations } from "../storage/db.js";
import { WorkspaceManager } from "../workspace/manager.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";

import "../commands/workspace.js";
import "../commands/worktree.js";

const execFileAsync = promisify(execFile);

async function initRepo(dir: string) {
  await mkdir(dir, { recursive: true });
  await execFileAsync("git", ["init"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await writeFile(join(dir, "README.md"), "# repo\n");
  await execFileAsync("git", ["add", "."], { cwd: dir });
  await execFileAsync("git", ["commit", "-m", "Initial commit"], { cwd: dir });
}

describe("Worktree Commands", () => {
  let repoDir: string;
  let otherRepoDir: string;
  let ctx: CommandContext;
  let workspaceMgr: WorkspaceManager;
  let eventBus: EventBus;
  let db: ReturnType<typeof openDatabase>;
  let workspaceId: string;
  let tempPaths: string[];

  beforeEach(async () => {
    repoDir = join(
      tmpdir(),
      `worktree-command-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    otherRepoDir = join(
      tmpdir(),
      `worktree-command-other-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );

    await initRepo(repoDir);
    await initRepo(otherRepoDir);

    db = openDatabase(":memory:");
    runMigrations(db);
    eventBus = new EventBus();
    workspaceMgr = new WorkspaceManager({ db, eventBus });
    tempPaths = [];

    const workspace = await workspaceMgr.open({ path: repoDir });
    workspaceId = workspace.id;

    ctx = {
      db,
      workspaceMgr,
      sessionMgr: {},
      terminalMgr: {},
      eventBus,
      broadcaster: { broadcast: () => {} },
      providerRegistry: [],
      fencingMgr: {},
      supervisorMgr: {},
    } as CommandContext;
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
    await rm(otherRepoDir, { recursive: true, force: true });
    await Promise.all(tempPaths.map((tempPath) => rm(tempPath, { recursive: true, force: true })));
  });

  it("returns status for a worktree belonging to the workspace repo", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "worktree-status-ok",
        op: "worktree.status",
        args: {
          workspaceId,
          worktreePath: repoDir,
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        status: expect.objectContaining({
          branch: expect.any(String),
        }),
      })
    );
  });

  it.each([
    "worktree.status",
    "worktree.diff",
    "worktree.tree",
  ] as const)("rejects %s for a git repo outside the workspace worktree set", async (op) => {
    const result = await dispatch(
      {
        kind: "command",
        id: `${op}-external`,
        op,
        args: {
          workspaceId,
          worktreePath: otherRepoDir,
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("worktree_not_found");
  });

  it("emits worktreeChanged after create and remove", async () => {
    const createdPath = join(
      tmpdir(),
      `worktree-command-created-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const linkedPath = join(
      tmpdir(),
      `worktree-command-linked-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    tempPaths.push(createdPath, linkedPath);

    await execFileAsync("git", ["branch", "feature/existing-worktree"], { cwd: repoDir });
    await execFileAsync("git", ["worktree", "add", linkedPath, "feature/existing-worktree"], {
      cwd: repoDir,
    });
    const linkedWorkspace = await workspaceMgr.open({ path: linkedPath });
    await execFileAsync("git", ["branch", "feature/worktree-manager"], { cwd: repoDir });

    const emitted: Array<{ workspaceId: string; worktreeChanged?: boolean }> = [];
    eventBus.on("git.state.changed", (event) => emitted.push(event));

    const createResult = await dispatch(
      {
        kind: "command",
        id: "worktree-create-event",
        op: "worktree.create",
        args: {
          workspaceId,
          branch: "feature/worktree-manager",
          path: createdPath,
        },
      },
      ctx
    );

    expect(createResult.ok).toBe(true);
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspaceId,
          worktreeChanged: true,
        }),
        expect.objectContaining({
          workspaceId: linkedWorkspace.id,
          worktreeChanged: true,
        }),
      ])
    );

    emitted.length = 0;

    const removeResult = await dispatch(
      {
        kind: "command",
        id: "worktree-remove-event",
        op: "worktree.remove",
        args: {
          workspaceId,
          worktreePath: createdPath,
        },
      },
      ctx
    );

    expect(removeResult.ok).toBe(true);
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspaceId,
          worktreeChanged: true,
        }),
        expect.objectContaining({
          workspaceId: linkedWorkspace.id,
          worktreeChanged: true,
        }),
      ])
    );
  });
});
