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
const PNG_BYTES = Buffer.from(
  "89504E470D0A1A0A0000000D4948445200000001000000010806000000" +
    "1F15C4890000000A49444154789C63000100000005000157CFC4A30000" +
    "0000049454E44AE426082",
  "hex"
);

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
      expect(diff.renderAs).toBe("text");
      expect(diff.status).toBe("modified");
      expect(diff.originalContent).toBe("initial");
      expect(diff.modifiedContent).toBe("modified");
      expect(diff.diff).toContain("modified");
    });

    it("should get empty diff for unchanged file", async () => {
      const diff = await getFileDiff(testDir, "initial.txt");
      expect(diff.diff).toBe("");
    });

    it("should get staged diff", async () => {
      await writeFile(join(testDir, "initial.txt"), "modified");
      await execFileAsync("git", ["add", "."], { cwd: testDir });
      const diff = await getFileDiff(testDir, "initial.txt", true);
      expect(diff.renderAs).toBe("text");
      expect(diff.status).toBe("modified");
      expect(diff.originalContent).toBe("initial");
      expect(diff.modifiedContent).toBe("modified");
      expect(diff.diff).toContain("modified");
    });

    it("should get new file diff for untracked file", async () => {
      await writeFile(join(testDir, "scratch.txt"), "hello\nworld\n");

      const diff = await getFileDiff(testDir, "scratch.txt");

      expect(diff.renderAs).toBe("text");
      expect(diff.status).toBe("added");
      expect(diff.originalContent).toBe("");
      expect(diff.modifiedContent).toBe("hello\nworld\n");
      expect(diff.diff).toContain("diff --git a/scratch.txt b/scratch.txt");
      expect(diff.diff).toContain("new file mode 100644");
      expect(diff.diff).toContain("--- /dev/null");
      expect(diff.diff).toContain("+++ b/scratch.txt");
      expect(diff.diff).toContain("+hello");
      expect(diff.diff).toContain("+world");
    });

    it("returns image diff metadata when a png file has binary changes", async () => {
      await writeFile(join(testDir, "pixel.png"), PNG_BYTES);
      await execFileAsync("git", ["add", "."], { cwd: testDir });
      await execFileAsync("git", ["commit", "-m", "Add pixel"], { cwd: testDir });

      const nextBytes = Buffer.from(PNG_BYTES);
      nextBytes[nextBytes.length - 1] ^= 0x01;
      await writeFile(join(testDir, "pixel.png"), nextBytes);

      const diff = await getFileDiff(testDir, "pixel.png");

      expect(diff.renderAs).toBe("image");
      expect(diff.status).toBe("modified");
      expect(diff.originalRevision).toBe("INDEX");
      expect(diff.modifiedRevision).toBe("WORKTREE");
      expect(diff.mime).toBe("image/png");
      expect(diff.originalPath).toBe("pixel.png");
      expect(diff.modifiedPath).toBe("pixel.png");
      expect(diff.diff).toContain("Binary files");
    });

    it("returns image diff metadata for untracked png files", async () => {
      await writeFile(join(testDir, "scratch.png"), PNG_BYTES);

      const diff = await getFileDiff(testDir, "scratch.png");

      expect(diff.renderAs).toBe("image");
      expect(diff.status).toBe("added");
      expect(diff.originalRevision).toBe("HEAD");
      expect(diff.modifiedRevision).toBe("WORKTREE");
      expect(diff.mime).toBe("image/png");
      expect(diff.originalPath).toBeUndefined();
      expect(diff.modifiedPath).toBe("scratch.png");
      expect(diff.diff).toContain("diff --git a/scratch.png b/scratch.png");
      expect(diff.diff).toContain("new file mode 100644");
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
