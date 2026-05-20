import { execFile } from "child_process";
import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { openDatabase, runMigrations } from "../storage/db.js";
import { WorkspaceRepo } from "../storage/repositories/workspace-repo.js";
import { WorkspaceManager } from "../workspace/manager.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";

import "../commands/workspace.js";
import "../commands/worktree.js";

const execFileAsync = promisify(execFile);

async function initRepo(dir: string) {
  await mkdir(dir, { recursive: true });
  await execFileAsync("git", ["init"], { cwd: dir });
  await execFileAsync("git", ["branch", "-M", "main"], { cwd: dir });
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
    workspaceMgr = new WorkspaceManager({ workspaceRepo: new WorkspaceRepo(db), eventBus });
    tempPaths = [];

    const workspace = await workspaceMgr.open({ path: repoDir });
    workspaceId = workspace.id;

    ctx = {
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

  it("creates a new worktree branch when the branch does not already exist", async () => {
    const createdPath = join(
      tmpdir(),
      `worktree-command-new-branch-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    tempPaths.push(createdPath);

    const result = await dispatch(
      {
        kind: "command",
        id: "worktree-create-new-branch",
        op: "worktree.create",
        args: {
          workspaceId,
          branch: "feature/new-worktree-branch",
          path: createdPath,
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        worktree: expect.objectContaining({
          path: createdPath,
          branch: "refs/heads/feature/new-worktree-branch",
        }),
      })
    );
  });

  it("keeps existing start-points detached instead of creating a new local branch", async () => {
    const remoteDir = join(
      tmpdir(),
      `worktree-command-remote-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    tempPaths.push(remoteDir);

    await execFileAsync("git", ["init", "--bare", remoteDir], { cwd: repoDir });
    await execFileAsync("git", ["remote", "add", "origin", remoteDir], { cwd: repoDir });
    await execFileAsync("git", ["push", "-u", "origin", "main"], { cwd: repoDir });
    await execFileAsync("git", ["fetch", "origin"], { cwd: repoDir });
    await execFileAsync("git", ["tag", "v1"], { cwd: repoDir });
    const { stdout: headSha } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: repoDir,
    });

    for (const branch of ["origin/main", "v1", headSha.trim()]) {
      const createdPath = join(
        tmpdir(),
        `worktree-command-start-point-${branch.replace(/[^a-zA-Z0-9]+/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      tempPaths.push(createdPath);

      const result = await dispatch(
        {
          kind: "command",
          id: `worktree-create-start-point-${branch}`,
          op: "worktree.create",
          args: {
            workspaceId,
            branch,
            path: createdPath,
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual(
        expect.objectContaining({
          worktree: expect.objectContaining({
            path: createdPath,
            branch: "detached HEAD",
          }),
        })
      );
    }
  });

  it("rejects removing a worktree that is currently open as a workspace", async () => {
    const linkedPath = join(
      tmpdir(),
      `worktree-command-open-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    tempPaths.push(linkedPath);

    await execFileAsync("git", ["branch", "feature/open-worktree"], { cwd: repoDir });
    await execFileAsync("git", ["worktree", "add", linkedPath, "feature/open-worktree"], {
      cwd: repoDir,
    });

    const linkedWorkspace = await workspaceMgr.open({ path: linkedPath });

    const removeResult = await dispatch(
      {
        kind: "command",
        id: "worktree-remove-open-workspace",
        op: "worktree.remove",
        args: {
          workspaceId,
          worktreePath: linkedPath,
        },
      },
      ctx
    );

    expect(removeResult.ok).toBe(false);
    expect(removeResult.error?.code).toBe("worktree_in_use");
    expect(removeResult.error?.message).toContain(linkedPath);
    expect(workspaceMgr.get(linkedWorkspace.id)?.path).toBe(linkedPath);
  });

  it("does not emit worktreeChanged for related workspaces closed during removal", async () => {
    const createdPath = join(
      tmpdir(),
      `worktree-command-race-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const observerPath = join(
      tmpdir(),
      `worktree-command-observer-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    tempPaths.push(createdPath, observerPath);

    await execFileAsync("git", ["branch", "feature/remove-race-target"], { cwd: repoDir });
    await execFileAsync("git", ["branch", "feature/remove-race"], { cwd: repoDir });
    await execFileAsync("git", ["worktree", "add", createdPath, "feature/remove-race-target"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["worktree", "add", observerPath, "feature/remove-race"], {
      cwd: repoDir,
    });
    const linkedWorkspace = await workspaceMgr.open({ path: observerPath });

    const emitted: Array<{ workspaceId: string; worktreeChanged?: boolean }> = [];
    eventBus.on("git.state.changed", (event) => emitted.push(event));

    const originalGet = workspaceMgr.get.bind(workspaceMgr);
    workspaceMgr.get = ((id: string) =>
      id === linkedWorkspace.id ? undefined : originalGet(id)) as typeof workspaceMgr.get;

    const removeResult = await dispatch(
      {
        kind: "command",
        id: "worktree-remove-closed-related",
        op: "worktree.remove",
        args: {
          workspaceId,
          worktreePath: createdPath,
        },
      },
      ctx
    );

    expect(removeResult.ok).toBe(true);
    expect(emitted).toContainEqual(
      expect.objectContaining({
        workspaceId,
        worktreeChanged: true,
      })
    );
    expect(emitted).not.toContainEqual(
      expect.objectContaining({
        workspaceId: linkedWorkspace.id,
        worktreeChanged: true,
      })
    );
  });
});
