import { mkdtempSync, rmSync } from "node:fs";
import { execFile } from "child_process";
import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { AutoFetchScheduler } from "../git/auto-fetch.js";
import { WorkspaceRepo } from "../storage/repositories/workspace-repo.js";
import { WorkspaceManager } from "../workspace/manager.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";

import "../commands/workspace.js";
import "../commands/git.js";

const execFileAsync = promisify(execFile);
const PNG_BYTES = Buffer.from(
  "89504E470D0A1A0A0000000D4948445200000001000000010806000000" +
    "1F15C4890000000A49444154789C63000100000005000157CFC4A30000" +
    "0000049454E44AE426082",
  "hex"
);

async function createCommitHistoryFixture(
  testDir: string
): Promise<{ headSha: string; parentSha: string }> {
  await execFileAsync("git", ["checkout", "--", "sample.ts"], { cwd: testDir });
  await writeFile(join(testDir, "rename-me.ts"), "export const renamed = true;\n");
  await writeFile(join(testDir, "pixel.png"), PNG_BYTES);
  await execFileAsync("git", ["add", "."], { cwd: testDir });
  await execFileAsync("git", ["commit", "-m", "History base"], { cwd: testDir });

  const { stdout: parentSha } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: testDir,
  });

  await writeFile(join(testDir, "sample.ts"), "export const value = 3;\n");
  await execFileAsync("git", ["mv", "rename-me.ts", "renamed.ts"], { cwd: testDir });
  const nextBytes = Buffer.from(PNG_BYTES);
  nextBytes[nextBytes.length - 1] ^= 0x01;
  await writeFile(join(testDir, "pixel.png"), nextBytes);
  await execFileAsync("git", ["add", "."], { cwd: testDir });
  await execFileAsync("git", ["commit", "-m", "Commit history fixture"], { cwd: testDir });

  const { stdout: headSha } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: testDir,
  });

  return {
    headSha: headSha.trim(),
    parentSha: parentSha.trim(),
  };
}

async function createMergeCommitFixture(
  testDir: string,
  initialBranch: string
): Promise<{ mergeSha: string }> {
  await execFileAsync("git", ["checkout", "-b", "feature/history-merge"], { cwd: testDir });
  await writeFile(join(testDir, "feature.txt"), "feature branch change\n");
  await execFileAsync("git", ["add", "."], { cwd: testDir });
  await execFileAsync("git", ["commit", "-m", "Feature branch change"], { cwd: testDir });

  await execFileAsync("git", ["checkout", initialBranch], { cwd: testDir });
  await writeFile(join(testDir, "main.txt"), "main branch change\n");
  await execFileAsync("git", ["add", "."], { cwd: testDir });
  await execFileAsync("git", ["commit", "-m", "Main branch change"], { cwd: testDir });

  await execFileAsync("git", ["merge", "--no-ff", "feature/history-merge", "-m", "Merge feature"], {
    cwd: testDir,
  });

  const { stdout: mergeSha } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: testDir,
  });

  return {
    mergeSha: mergeSha.trim(),
  };
}

describe("Git Commands", () => {
  let testDir: string;
  let ctx: CommandContext;
  let workspaceMgr: WorkspaceManager;
  let eventBus: EventBus;
  let workspaceId: string;
  let initialBranch: string;
  let recordFetchSpy: ReturnType<typeof vi.spyOn>;
  let autoFetch: AutoFetchScheduler;
  let workspaceLookup: ReturnType<typeof vi.fn>;
  let stateDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `git-command-test-${Date.now()}`);
    await mkdir(testDir);

    await execFileAsync("git", ["init"], { cwd: testDir });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: testDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: testDir });

    await writeFile(join(testDir, "sample.ts"), "export const value = 1;\n");
    await execFileAsync("git", ["add", "."], { cwd: testDir });
    await execFileAsync("git", ["commit", "-m", "Initial commit"], { cwd: testDir });
    const { stdout: initialBranchStdout } = await execFileAsync(
      "git",
      ["branch", "--show-current"],
      { cwd: testDir }
    );
    initialBranch = initialBranchStdout.trim();
    await writeFile(join(testDir, "sample.ts"), "export const value = 2;\n");
    stateDir = mkdtempSync(join(tmpdir(), "git-command-state-"));

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
      workspaceRepo: new WorkspaceRepo({
        filePath: join(stateDir, "workspaces.json"),
      }),
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
    rmSync(stateDir, { recursive: true, force: true });
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
        renderAs: "text",
        status: "modified",
        originalContent: "export const value = 1;\n",
        modifiedContent: "export const value = 2;\n",
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
        renderAs: "text",
        status: "added",
        originalContent: "",
        modifiedContent: "temporary\nnotes\n",
      })
    );
    expect((result.data as { diff: string }).diff).toContain("new file mode 100644");
    expect((result.data as { diff: string }).diff).toContain("--- /dev/null");
    expect((result.data as { diff: string }).diff).toContain("+++ b/scratch.txt");
    expect((result.data as { diff: string }).diff).toContain("+temporary");
    expect((result.data as { diff: string }).diff).toContain("+notes");
  });

  it("returns image diff metadata when a png file has binary changes", async () => {
    await writeFile(join(testDir, "pixel.png"), PNG_BYTES);
    await execFileAsync("git", ["add", "."], { cwd: testDir });
    await execFileAsync("git", ["commit", "-m", "Add pixel"], { cwd: testDir });

    const nextBytes = Buffer.from(PNG_BYTES);
    nextBytes[nextBytes.length - 1] ^= 0x01;
    await writeFile(join(testDir, "pixel.png"), nextBytes);

    const result = await dispatch(
      {
        kind: "command",
        id: "git-diff-image",
        op: "git.diff",
        args: {
          workspaceId,
          path: "pixel.png",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        renderAs: "image",
        status: "modified",
        originalRevision: "INDEX",
        modifiedRevision: "WORKTREE",
        mime: "image/png",
        originalPath: "pixel.png",
        modifiedPath: "pixel.png",
        diff: expect.stringContaining("Binary files"),
      })
    );
  });

  it("returns image diff metadata for untracked png files via git.diff", async () => {
    await writeFile(join(testDir, "scratch.png"), PNG_BYTES);

    const result = await dispatch(
      {
        kind: "command",
        id: "git-diff-image-untracked",
        op: "git.diff",
        args: {
          workspaceId,
          path: "scratch.png",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        renderAs: "image",
        status: "added",
        originalRevision: "HEAD",
        modifiedRevision: "WORKTREE",
        mime: "image/png",
        originalPath: undefined,
        modifiedPath: "scratch.png",
        diff: expect.stringContaining("diff --git a/scratch.png b/scratch.png"),
      })
    );
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

  it("returns structured commit files for git.commitDetail", async () => {
    const { headSha, parentSha } = await createCommitHistoryFixture(testDir);

    const result = await dispatch(
      {
        kind: "command",
        id: "git-commit-detail-1",
        op: "git.commitDetail",
        args: {
          workspaceId,
          sha: headSha,
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        commit: expect.objectContaining({
          sha: headSha,
          shortSha: expect.any(String),
          subject: "Commit history fixture",
          parentSha,
        }),
        files: expect.arrayContaining([
          expect.objectContaining({
            path: "sample.ts",
            status: "modified",
            renderAs: "text",
          }),
          expect.objectContaining({
            path: "renamed.ts",
            oldPath: "rename-me.ts",
            status: "renamed",
            renderAs: "text",
          }),
          expect.objectContaining({
            path: "pixel.png",
            status: "modified",
            renderAs: "image",
          }),
        ]),
      })
    );
  });

  it("returns commit file diffs for git.commitFileDiff", async () => {
    const { headSha } = await createCommitHistoryFixture(testDir);

    const textResult = await dispatch(
      {
        kind: "command",
        id: "git-commit-file-diff-text",
        op: "git.commitFileDiff",
        args: {
          workspaceId,
          sha: headSha,
          path: "sample.ts",
        },
      },
      ctx
    );

    expect(textResult.ok).toBe(true);
    expect(textResult.data).toEqual(
      expect.objectContaining({
        renderAs: "text",
        status: "modified",
        originalContent: "export const value = 1;\n",
        modifiedContent: "export const value = 3;\n",
      })
    );

    const imageResult = await dispatch(
      {
        kind: "command",
        id: "git-commit-file-diff-image",
        op: "git.commitFileDiff",
        args: {
          workspaceId,
          sha: headSha,
          path: "pixel.png",
        },
      },
      ctx
    );

    expect(imageResult.ok).toBe(true);
    expect(imageResult.data).toEqual(
      expect.objectContaining({
        renderAs: "image",
        status: "modified",
        mime: "image/png",
        originalRevision: expect.any(String),
        modifiedRevision: headSha,
        originalPath: "pixel.png",
        modifiedPath: "pixel.png",
      })
    );
  });

  it("rejects git.commitFileDiff when the requested file is not part of the target commit", async () => {
    const { headSha } = await createCommitHistoryFixture(testDir);

    const result = await dispatch(
      {
        kind: "command",
        id: "git-commit-file-diff-invalid-selection",
        op: "git.commitFileDiff",
        args: {
          workspaceId,
          sha: headSha,
          path: "missing-from-commit.ts",
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error).toEqual(
      expect.objectContaining({
        code: "git_commit_file_not_found",
      })
    );
  });

  it("rejects structured history commands for merge commits", async () => {
    const { mergeSha } = await createMergeCommitFixture(testDir, initialBranch);

    const detailResult = await dispatch(
      {
        kind: "command",
        id: "git-commit-detail-merge",
        op: "git.commitDetail",
        args: {
          workspaceId,
          sha: mergeSha,
        },
      },
      ctx
    );

    expect(detailResult.ok).toBe(false);
    expect(detailResult.error).toEqual(
      expect.objectContaining({
        code: "git_merge_commit_unsupported",
      })
    );

    const fileDiffResult = await dispatch(
      {
        kind: "command",
        id: "git-commit-file-diff-merge",
        op: "git.commitFileDiff",
        args: {
          workspaceId,
          sha: mergeSha,
          path: "feature.txt",
        },
      },
      ctx
    );

    expect(fileDiffResult.ok).toBe(false);
    expect(fileDiffResult.error).toEqual(
      expect.objectContaining({
        code: "git_merge_commit_unsupported",
      })
    );
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
