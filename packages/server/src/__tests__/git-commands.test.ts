import { execFile } from "child_process";
import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { AutoFetchScheduler } from "../git/auto-fetch.js";
import { openDatabase, runMigrations } from "../storage/db.js";
import { WorkspaceRepo } from "../storage/repositories/workspace-repo.js";
import { WorkspaceManager } from "../workspace/manager.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";

import "../commands/workspace.js";
import "../commands/git.js";

const execFileAsync = promisify(execFile);

describe("Git Commands", () => {
  let testDir: string;
  let ctx: CommandContext;
  let workspaceMgr: WorkspaceManager;
  let eventBus: EventBus;
  let db: ReturnType<typeof openDatabase>;
  let workspaceId: string;
  let recordFetchSpy: ReturnType<typeof vi.spyOn>;
  let autoFetch: AutoFetchScheduler;
  let workspaceLookup: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    testDir = join(tmpdir(), `git-command-test-${Date.now()}`);
    await mkdir(testDir);

    await execFileAsync("git", ["init"], { cwd: testDir });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: testDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: testDir });

    await writeFile(join(testDir, "sample.ts"), "export const value = 1;\n");
    await execFileAsync("git", ["add", "."], { cwd: testDir });
    await execFileAsync("git", ["commit", "-m", "Initial commit"], { cwd: testDir });
    await writeFile(join(testDir, "sample.ts"), "export const value = 2;\n");

    db = openDatabase(":memory:");
    runMigrations(db);
    eventBus = new EventBus();
    vi.spyOn(eventBus, "emit");
    workspaceLookup = vi.fn();
    autoFetch = new AutoFetchScheduler({
      workspaceMgr: { get: workspaceLookup },
      eventBus,
      settingsRepo: { get: vi.fn(() => 180) } as never,
      runFetch: vi.fn(async () => {}),
    });
    workspaceMgr = new WorkspaceManager({
      workspaceRepo: new WorkspaceRepo(db),
      eventBus,
      autoFetch,
    });
    recordFetchSpy = vi.spyOn(workspaceMgr, "recordFetch");

    const workspace = await workspaceMgr.open({
      path: testDir,
    });
    workspaceId = workspace.id;
    workspaceLookup.mockImplementation((id: string) => workspaceMgr.get(id));

    ctx = {
      db,
      workspaceMgr,
      sessionMgr: {},
      terminalMgr: {},
      eventBus,
      broadcaster: { broadcast: () => {} },
      providerRegistry: [],
      autoFetch,
      fencingMgr: {},
      supervisorMgr: {},
    } as CommandContext;
  });

  afterEach(async () => {
    autoFetch.stop();
    await rm(testDir, { recursive: true, force: true });
  });

  it("returns file diff for git.diff", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "git-diff-1",
        op: "git.diff",
        args: {
          workspaceId,
          path: "sample.ts",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        diff: expect.stringContaining("-export const value = 1;"),
      })
    );
    expect((result.data as { diff: string }).diff).toContain("+export const value = 2;");
  });

  it("returns new file diff for untracked files via git.diff", async () => {
    await writeFile(join(testDir, "scratch.txt"), "temporary\nnotes\n");

    const result = await dispatch(
      {
        kind: "command",
        id: "git-diff-untracked",
        op: "git.diff",
        args: {
          workspaceId,
          path: "scratch.txt",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        diff: expect.stringContaining("diff --git a/scratch.txt b/scratch.txt"),
      })
    );
    expect((result.data as { diff: string }).diff).toContain("new file mode 100644");
    expect((result.data as { diff: string }).diff).toContain("--- /dev/null");
    expect((result.data as { diff: string }).diff).toContain("+++ b/scratch.txt");
    expect((result.data as { diff: string }).diff).toContain("+temporary");
    expect((result.data as { diff: string }).diff).toContain("+notes");
  });

  it("returns recent commit history for git.log", async () => {
    await execFileAsync("git", ["add", "."], { cwd: testDir });
    await execFileAsync("git", ["commit", "-m", "Refresh command surface"], { cwd: testDir });

    const result = await dispatch(
      {
        kind: "command",
        id: "git-log-1",
        op: "git.log",
        args: {
          workspaceId,
          limit: 5,
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        entries: expect.arrayContaining([
          expect.objectContaining({
            subject: "Refresh command surface",
            authorName: "Test",
          }),
        ]),
      })
    );
  });

  it("returns a commit patch for git.show", async () => {
    await execFileAsync("git", ["add", "."], { cwd: testDir });
    await execFileAsync("git", ["commit", "-m", "Refresh command surface"], { cwd: testDir });
    const { stdout: headSha } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: testDir });

    const result = await dispatch(
      {
        kind: "command",
        id: "git-show-1",
        op: "git.show",
        args: {
          workspaceId,
          sha: headSha.trim(),
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        diff: expect.stringContaining("Refresh command surface"),
      })
    );
    expect((result.data as { diff: string }).diff).toContain("+export const value = 2;");
    expect((result.data as { diff: string }).diff).toContain("-export const value = 1;");
  });

  it("rejects git.show revisions that are not commit SHAs", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "git-show-invalid",
        op: "git.show",
        args: {
          workspaceId,
          sha: "--stat",
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation_error");
  });

  it("discards modified tracked files", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "git-discard-modified",
        op: "git.discard",
        args: {
          workspaceId,
          paths: ["sample.ts"],
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    const { stdout } = await execFileAsync("git", ["status", "--short"], { cwd: testDir });
    expect(stdout.trim()).toBe("");
    expect(eventBus.emit).toHaveBeenCalledWith({
      type: "git.state.changed",
      workspaceId,
      treeChanged: true,
      branchChanged: undefined,
      worktreeChanged: undefined,
    });
  });

  it("discards untracked files", async () => {
    await writeFile(join(testDir, "scratch.txt"), "temporary\n");

    const result = await dispatch(
      {
        kind: "command",
        id: "git-discard-untracked",
        op: "git.discard",
        args: {
          workspaceId,
          paths: ["scratch.txt"],
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    const { stdout } = await execFileAsync("git", ["status", "--short"], { cwd: testDir });
    expect(stdout).not.toContain("scratch.txt");
  });

  it("fetches remote refs and emits branchChanged via git.fetch", async () => {
    const remoteDir = join(tmpdir(), `git-fetch-remote-${Date.now()}`);
    const contributorDir = join(tmpdir(), `git-fetch-contributor-${Date.now()}`);
    await mkdir(remoteDir);
    await execFileAsync("git", ["init", "--bare"], { cwd: remoteDir });
    await execFileAsync("git", ["remote", "add", "origin", remoteDir], { cwd: testDir });
    const defaultBranch = (
      await execFileAsync("git", ["branch", "--show-current"], { cwd: testDir })
    ).stdout.trim();
    await execFileAsync("git", ["push", "-u", "origin", defaultBranch], { cwd: testDir });

    await execFileAsync("git", ["clone", remoteDir, contributorDir]);
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: contributorDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: contributorDir,
    });
    await execFileAsync("git", ["checkout", "-b", "feature/fetch-cmd"], { cwd: contributorDir });
    await writeFile(join(contributorDir, "feature.txt"), "feature\n");
    await execFileAsync("git", ["add", "."], { cwd: contributorDir });
    await execFileAsync("git", ["commit", "-m", "feature commit"], { cwd: contributorDir });
    await execFileAsync("git", ["push", "-u", "origin", "feature/fetch-cmd"], {
      cwd: contributorDir,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "git-fetch-1",
        op: "git.fetch",
        args: { workspaceId },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    const data = result.data as { success: boolean; updatedRefs: string[] };
    expect(data.success).toBe(true);
    expect(data.updatedRefs).toContain("origin/feature/fetch-cmd");
    expect(recordFetchSpy).toHaveBeenCalledWith(workspaceId);
    expect(eventBus.emit).toHaveBeenCalledWith({
      type: "git.state.changed",
      workspaceId,
      treeChanged: undefined,
      branchChanged: true,
      worktreeChanged: undefined,
    });

    await rm(remoteDir, { recursive: true, force: true });
    await rm(contributorDir, { recursive: true, force: true });
  });

  it("returns success:false instead of throwing when background fetch hits auth failure", async () => {
    await execFileAsync("git", ["remote", "add", "origin", "https://example.com/openai/demo.git"], {
      cwd: testDir,
    });

    const wrapperDir = join(testDir, "bin-fetch-auth");
    await mkdir(wrapperDir, { recursive: true });
    const realGit = (await execFileAsync("sh", ["-lc", "command -v git"])).stdout.trim();
    await writeFile(
      join(wrapperDir, "git"),
      [
        "#!/bin/sh",
        'for arg in "$@"; do',
        '  if [ "$arg" = "fetch" ]; then',
        '    printf "fatal: Authentication failed for https://example.com/openai/demo.git/\\n" >&2',
        "    exit 128",
        "  fi",
        "done",
        `exec ${JSON.stringify(realGit)} "$@"`,
        "",
      ].join("\n"),
      { mode: 0o700 }
    );

    const originalPath = process.env.PATH ?? "";
    vi.stubEnv("PATH", `${wrapperDir}:${originalPath}`);

    try {
      const result = await dispatch(
        {
          kind: "command",
          id: "git-fetch-bg",
          op: "git.fetch",
          args: { workspaceId, remote: "origin", background: true },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      const data = result.data as { success: boolean; message: string };
      expect(data.success).toBe(false);
      expect(data.message.toLowerCase()).toMatch(/auth|credential|password/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rethrows GitAuthError on non-background fetch path", async () => {
    await execFileAsync("git", ["remote", "add", "origin", "https://example.com/openai/demo.git"], {
      cwd: testDir,
    });

    const wrapperDir = join(testDir, "bin-fetch-auth-fg");
    await mkdir(wrapperDir, { recursive: true });
    const realGit = (await execFileAsync("sh", ["-lc", "command -v git"])).stdout.trim();
    await writeFile(
      join(wrapperDir, "git"),
      [
        "#!/bin/sh",
        'for arg in "$@"; do',
        '  if [ "$arg" = "fetch" ]; then',
        '    printf "fatal: Authentication failed for https://example.com/openai/demo.git/\\n" >&2',
        "    exit 128",
        "  fi",
        "done",
        `exec ${JSON.stringify(realGit)} "$@"`,
        "",
      ].join("\n"),
      { mode: 0o700 }
    );

    const originalPath = process.env.PATH ?? "";
    vi.stubEnv("PATH", `${wrapperDir}:${originalPath}`);

    try {
      const result = await dispatch(
        {
          kind: "command",
          id: "git-fetch-fg",
          op: "git.fetch",
          args: { workspaceId, remote: "origin" },
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toMatch(/git_auth_/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("serializes foreground fetch behind an in-flight foreground operation", async () => {
    const pushWrapperDir = join(testDir, "bin-fetch-serialize");
    await mkdir(pushWrapperDir, { recursive: true });
    const realGit = (await execFileAsync("sh", ["-lc", "command -v git"])).stdout.trim();
    await writeFile(
      join(pushWrapperDir, "git"),
      [
        "#!/bin/sh",
        'if [ "$1" = "push" ]; then',
        '  while [ ! -f "$CODER_STUDIO_RELEASE_PUSH_FILE" ]; do',
        "    sleep 0.05",
        "  done",
        '  printf "push ok\\n"',
        "  exit 0",
        "fi",
        'if [ "$1" = "fetch" ]; then',
        '  if [ ! -f "$CODER_STUDIO_RELEASE_PUSH_FILE" ]; then',
        '    printf "fetch raced with push\\n" >&2',
        "    exit 99",
        "  fi",
        '  printf "fetch ok\\n"',
        "  exit 0",
        "fi",
        `exec ${JSON.stringify(realGit)} "$@"`,
        "",
      ].join("\n"),
      { mode: 0o700 }
    );

    const releaseFile = join(testDir, "release-push");
    await execFileAsync("git", ["remote", "add", "origin", "https://example.com/openai/demo.git"], {
      cwd: testDir,
    });

    const originalPath = process.env.PATH ?? "";
    vi.stubEnv("PATH", `${pushWrapperDir}:${originalPath}`);
    vi.stubEnv("CODER_STUDIO_RELEASE_PUSH_FILE", releaseFile);

    try {
      const pushPromise = dispatch(
        {
          kind: "command",
          id: "git-push-lock",
          op: "git.push",
          args: { workspaceId, remote: "origin" },
        },
        ctx
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const fetchPromise = dispatch(
        {
          kind: "command",
          id: "git-fetch-lock",
          op: "git.fetch",
          args: { workspaceId, remote: "origin" },
        },
        ctx
      );

      await writeFile(releaseFile, "ok");

      const [pushResult, fetchResult] = await Promise.all([pushPromise, fetchPromise]);
      expect(pushResult.ok).toBe(true);
      expect(fetchResult.ok).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("serializes background fetch behind an in-flight foreground operation", async () => {
    const pushWrapperDir = join(testDir, "bin-fetch-bg-serialize");
    await mkdir(pushWrapperDir, { recursive: true });
    const realGit = (await execFileAsync("sh", ["-lc", "command -v git"])).stdout.trim();
    await writeFile(
      join(pushWrapperDir, "git"),
      [
        "#!/bin/sh",
        'if [ "$1" = "push" ]; then',
        '  while [ ! -f "$CODER_STUDIO_RELEASE_PUSH_FILE" ]; do',
        "    sleep 0.05",
        "  done",
        '  printf "push ok\\n"',
        "  exit 0",
        "fi",
        'if [ "$1" = "fetch" ]; then',
        '  if [ ! -f "$CODER_STUDIO_RELEASE_PUSH_FILE" ]; then',
        '    printf "fetch raced with push\\n" >&2',
        "    exit 99",
        "  fi",
        '  printf "fetch ok\\n"',
        "  exit 0",
        "fi",
        `exec ${JSON.stringify(realGit)} "$@"`,
        "",
      ].join("\n"),
      { mode: 0o700 }
    );

    const releaseFile = join(testDir, "release-push-bg");
    await execFileAsync("git", ["remote", "add", "origin", "https://example.com/openai/demo.git"], {
      cwd: testDir,
    }).catch(() => {});

    const originalPath = process.env.PATH ?? "";
    vi.stubEnv("PATH", `${pushWrapperDir}:${originalPath}`);
    vi.stubEnv("CODER_STUDIO_RELEASE_PUSH_FILE", releaseFile);

    try {
      const pushPromise = dispatch(
        {
          kind: "command",
          id: "git-push-lock-bg",
          op: "git.push",
          args: { workspaceId, remote: "origin" },
        },
        ctx
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const fetchPromise = dispatch(
        {
          kind: "command",
          id: "git-fetch-lock-bg",
          op: "git.fetch",
          args: { workspaceId, remote: "origin", background: true },
        },
        ctx,
        "client-1"
      );

      await writeFile(releaseFile, "ok");

      const [pushResult, fetchResult] = await Promise.all([pushPromise, fetchPromise]);
      expect(pushResult.ok).toBe(true);
      expect(fetchResult.ok).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("emits branch refresh hints after checkout", async () => {
    await execFileAsync("git", ["checkout", "-b", "feature/test"], { cwd: testDir });
    await execFileAsync("git", ["checkout", "master"], { cwd: testDir }).catch(async () => {
      await execFileAsync("git", ["checkout", "main"], { cwd: testDir });
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "git-checkout-1",
        op: "git.checkout",
        args: {
          workspaceId,
          ref: "feature/test",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(eventBus.emit).toHaveBeenCalledWith({
      type: "git.state.changed",
      workspaceId,
      treeChanged: true,
      branchChanged: true,
      worktreeChanged: true,
    });
  });
});
