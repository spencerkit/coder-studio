import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertNoSymlinkInPath,
  ensureSafeUploadDir,
  generateBucketPath,
  sanitizeOriginalName,
  validateWorkspaceId,
} from "./paths.js";

describe("sanitizeOriginalName", () => {
  it("keeps ascii letters, digits, dot, dash, underscore, space", () => {
    expect(sanitizeOriginalName("My File-1.txt")).toBe("My File-1.txt");
  });

  it("keeps CJK characters", () => {
    expect(sanitizeOriginalName("截屏 2026-05-03.png")).toBe("截屏 2026-05-03.png");
  });

  it("replaces path separators with underscore", () => {
    expect(sanitizeOriginalName("a/b\\c.png")).toBe("a_b_c.png");
  });

  it("replaces control characters", () => {
    expect(sanitizeOriginalName("foo\x00bar\x1fbaz.txt")).toBe("foo_bar_baz.txt");
  });

  it("strips leading dots so output is never a dotfile", () => {
    expect(sanitizeOriginalName("...secret")).toBe("secret");
  });

  it("truncates to 64 chars while preserving extension when possible", () => {
    const longName = `${"a".repeat(80)}.png`;
    const sanitized = sanitizeOriginalName(longName);
    expect(sanitized.length).toBeLessThanOrEqual(64);
    expect(sanitized.endsWith(".png")).toBe(true);
  });

  it('falls back to "file" for empty/whitespace/all-stripped input', () => {
    expect(sanitizeOriginalName("")).toBe("file");
    expect(sanitizeOriginalName("   ")).toBe("file");
    expect(sanitizeOriginalName("///")).toBe("file");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeOriginalName("  hello.txt  ")).toBe("hello.txt");
  });
});

describe("validateWorkspaceId", () => {
  it("accepts ids matching ^[a-zA-Z0-9_-]+$", () => {
    expect(() => validateWorkspaceId("ws_1714723200_abc123def")).not.toThrow();
    expect(() => validateWorkspaceId("plain-id")).not.toThrow();
  });

  it.each(["", "..", "a/b", "a\\b", "a b", "has.dot", "unicode-工作区"])("rejects %p", (bad) => {
    expect(() => validateWorkspaceId(bad)).toThrow(/invalid workspace id/i);
  });
});

describe("generateBucketPath", () => {
  it("builds <uploadsDir>/<wsId>/<yyyy-mm-dd>/<uuid8>-<sanitized>", () => {
    const result = generateBucketPath({
      uploadsDir: "/var/uploads",
      workspaceId: "ws_1",
      originalName: "screenshot.png",
      now: new Date("2026-05-03T10:00:00Z"),
    });

    expect(result.dir).toBe("/var/uploads/ws_1/2026-05-03");
    expect(result.absolutePath).toMatch(
      /^\/var\/uploads\/ws_1\/2026-05-03\/[a-f0-9]{8}-screenshot\.png$/
    );
  });

  it("throws if workspaceId is invalid", () => {
    expect(() =>
      generateBucketPath({
        uploadsDir: "/var/uploads",
        workspaceId: "../escape",
        originalName: "x.png",
        now: new Date(),
      })
    ).toThrow(/invalid workspace id/i);
  });
});

describe("assertNoSymlinkInPath", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("allows normal directories under the uploads root", async () => {
    const uploadsDir = await mkdtemp(join(tmpdir(), "cs-paths-"));
    tempDirs.push(uploadsDir);
    const targetDir = join(uploadsDir, "ws-1", "2026-05-04");
    await mkdir(targetDir, { recursive: true });

    await expect(assertNoSymlinkInPath(uploadsDir, targetDir)).resolves.toBeUndefined();
  });

  it("rejects symlinked path segments under the uploads root", async () => {
    const uploadsDir = await mkdtemp(join(tmpdir(), "cs-paths-"));
    const escapedDir = await mkdtemp(join(tmpdir(), "cs-paths-escape-"));
    tempDirs.push(uploadsDir, escapedDir);
    await mkdir(join(uploadsDir, "ws-1"), { recursive: true });
    const targetDir = join(uploadsDir, "ws-1", "2026-05-04");
    await symlink(escapedDir, targetDir, "dir");

    await expect(assertNoSymlinkInPath(uploadsDir, targetDir)).rejects.toThrow(/symlink/i);
  });
});

describe("ensureSafeUploadDir", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("creates a missing uploads root and nested bucket directories", async () => {
    const uploadsDir = join(tmpdir(), `cs-paths-root-missing-${Date.now()}`);
    tempDirs.push(uploadsDir);
    const targetDir = join(uploadsDir, "ws-1", "2026-05-04");

    await expect(ensureSafeUploadDir(uploadsDir, targetDir)).resolves.toBeUndefined();
  });
});
