/**
 * Tests for runGitFetch — manual + background remote fetch helper.
 */

import { execFile } from "child_process";
import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGitFetch } from "../../git/cli.js";

const execFileAsync = promisify(execFile);

async function getCurrentBranch(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["branch", "--show-current"], { cwd });
  return stdout.trim();
}

describe("runGitFetch", () => {
  let primaryDir: string;
  let contributorDir: string;
  let remoteDir: string;
  let defaultBranch: string;

  beforeEach(async () => {
    primaryDir = join(tmpdir(), `git-fetch-primary-${Date.now()}`);
    contributorDir = join(tmpdir(), `git-fetch-contributor-${Date.now()}`);
    remoteDir = join(tmpdir(), `git-fetch-remote-${Date.now()}`);
    await mkdir(primaryDir);
    await mkdir(remoteDir);

    await execFileAsync("git", ["init"], { cwd: primaryDir });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: primaryDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: primaryDir });
    await execFileAsync("git", ["init", "--bare"], { cwd: remoteDir });

    await writeFile(join(primaryDir, "README.md"), "init\n");
    await execFileAsync("git", ["add", "."], { cwd: primaryDir });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: primaryDir });
    await execFileAsync("git", ["remote", "add", "origin", remoteDir], { cwd: primaryDir });
    defaultBranch = await getCurrentBranch(primaryDir);
    await execFileAsync("git", ["push", "-u", "origin", defaultBranch], { cwd: primaryDir });

    // contributor pushes a new branch so primary's fetch has something to discover
    await execFileAsync("git", ["clone", remoteDir, contributorDir]);
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: contributorDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: contributorDir,
    });
    await execFileAsync("git", ["checkout", "-b", "feature/remote-only"], { cwd: contributorDir });
    await writeFile(join(contributorDir, "feature.txt"), "feature\n");
    await execFileAsync("git", ["add", "."], { cwd: contributorDir });
    await execFileAsync("git", ["commit", "-m", "feature commit"], { cwd: contributorDir });
    await execFileAsync("git", ["push", "-u", "origin", "feature/remote-only"], {
      cwd: contributorDir,
    });
  });

  afterEach(async () => {
    await rm(primaryDir, { recursive: true, force: true });
    await rm(contributorDir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
  });

  it("fetches all remotes by default and reports the new ref", async () => {
    const result = await runGitFetch(primaryDir);

    expect(result.success).toBe(true);
    expect(result.updatedRefs).toContain("origin/feature/remote-only");

    // Ref should be present locally now
    const { stdout } = await execFileAsync(
      "git",
      ["for-each-ref", "--format=%(refname)", "refs/remotes/origin/feature/remote-only"],
      { cwd: primaryDir }
    );
    expect(stdout.trim()).toBe("refs/remotes/origin/feature/remote-only");
  });

  it("limits the fetch to a single remote when remote is provided", async () => {
    const result = await runGitFetch(primaryDir, { remote: "origin" });

    expect(result.success).toBe(true);
    expect(result.updatedRefs).toContain("origin/feature/remote-only");
  });

  it("prunes deleted remote refs by default", async () => {
    // Pre-seed primary's tracking refs
    await runGitFetch(primaryDir);

    // Contributor deletes the branch on remote
    await execFileAsync("git", ["push", "origin", "--delete", "feature/remote-only"], {
      cwd: contributorDir,
    });

    const result = await runGitFetch(primaryDir);

    expect(result.success).toBe(true);
    const { stdout } = await execFileAsync(
      "git",
      ["for-each-ref", "--format=%(refname)", "refs/remotes/origin/feature/remote-only"],
      { cwd: primaryDir }
    );
    expect(stdout.trim()).toBe("");
  });

  it("does not prune when prune is set to false", async () => {
    await runGitFetch(primaryDir);
    await execFileAsync("git", ["push", "origin", "--delete", "feature/remote-only"], {
      cwd: contributorDir,
    });

    await runGitFetch(primaryDir, { prune: false });

    const { stdout } = await execFileAsync(
      "git",
      ["for-each-ref", "--format=%(refname)", "refs/remotes/origin/feature/remote-only"],
      { cwd: primaryDir }
    );
    expect(stdout.trim()).toBe("refs/remotes/origin/feature/remote-only");
  });

  it("returns success with no updatedRefs when remote has no changes", async () => {
    await runGitFetch(primaryDir); // sync once
    const result = await runGitFetch(primaryDir); // second fetch is a no-op

    expect(result.success).toBe(true);
    expect(result.updatedRefs).toEqual([]);
  });
});
