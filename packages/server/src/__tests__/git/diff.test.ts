/**
 * Tests for git diff operations.
 */

import { execFile } from "child_process";
import { mkdir, rmdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDiff, getFileDiff } from "../../git/diff.js";

const execFileAsync = promisify(execFile);

describe("git diff operations", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `git-diff-test-${Date.now()}`);
    await mkdir(testDir);

    // Initialize git repo
    await execFileAsync("git", ["init"], { cwd: testDir });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: testDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: testDir });

    // Create initial commit
    await writeFile(join(testDir, "initial.txt"), "initial");
    await execFileAsync("git", ["add", "."], { cwd: testDir });
    await execFileAsync("git", ["commit", "-m", "Initial commit"], { cwd: testDir });
  });

  afterEach(async () => {
    try {
      await rmdir(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("getFileDiff", () => {
    it("should get diff for modified file", async () => {
      await writeFile(join(testDir, "initial.txt"), "modified");
      const diff = await getFileDiff(testDir, "initial.txt");
      expect(diff).toContain("modified");
    });

    it("should get empty diff for unchanged file", async () => {
      const diff = await getFileDiff(testDir, "initial.txt");
      expect(diff).toBe("");
    });

    it("should get staged diff", async () => {
      await writeFile(join(testDir, "initial.txt"), "modified");
      await execFileAsync("git", ["add", "."], { cwd: testDir });
      const diff = await getFileDiff(testDir, "initial.txt", true);
      expect(diff).toContain("modified");
    });

    it("should get new file diff for untracked file", async () => {
      await writeFile(join(testDir, "scratch.txt"), "hello\nworld\n");

      const diff = await getFileDiff(testDir, "scratch.txt");

      expect(diff).toContain("diff --git a/scratch.txt b/scratch.txt");
      expect(diff).toContain("new file mode 100644");
      expect(diff).toContain("--- /dev/null");
      expect(diff).toContain("+++ b/scratch.txt");
      expect(diff).toContain("+hello");
      expect(diff).toContain("+world");
    });
  });

  describe("getDiff", () => {
    it("should get diff for all changes", async () => {
      await writeFile(join(testDir, "initial.txt"), "modified");
      // Note: git diff does not show untracked files, only tracked changes
      const diff = await getDiff(testDir);
      expect(diff).toContain("modified");
    });

    it("should get staged diff for all files", async () => {
      await writeFile(join(testDir, "initial.txt"), "modified");
      await execFileAsync("git", ["add", "."], { cwd: testDir });
      const diff = await getDiff(testDir, true);
      expect(diff).toContain("modified");
    });
  });
});
