import { execFile as execFileCallback } from "child_process";
import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchFileContents } from "../../fs/content-search.js";

const execFile = promisify(execFileCallback);

describe("searchFileContents", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `content-search-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });

    await execFile("git", ["init"], { cwd: testDir });
    await execFile("git", ["config", "user.name", "Test"], { cwd: testDir });
    await execFile("git", ["config", "user.email", "test@example.com"], { cwd: testDir });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("groups matches by file and returns preview highlight metadata", async () => {
    await writeFile(
      join(testDir, "alpha.ts"),
      [
        "const alpha = 'alpha';",
        "const beta = alpha + '-match';",
        "const gamma = 'done';",
        "",
      ].join("\n")
    );
    await writeFile(join(testDir, "notes.md"), "match on the first line\n");

    const result = await searchFileContents(testDir, {
      query: "match",
      maxFiles: 10,
      maxMatchesPerFile: 10,
    });

    expect(result.totalMatchCount).toBe(2);
    expect(result.hasMoreFiles).toBe(false);
    expect(result.truncatedMatchFileCount).toBe(0);
    expect(result.files.map((file) => file.path)).toEqual(["alpha.ts", "notes.md"]);

    expect(result.files[0]).toMatchObject({
      path: "alpha.ts",
      name: "alpha.ts",
      matchCount: 1,
      hasMoreMatches: false,
    });
    expect(result.files[0]?.matches).toEqual([
      {
        line: 2,
        column: 24,
        endColumn: 29,
        preview: "const beta = alpha + '-match';",
        previewColumnStart: 24,
        previewColumnEnd: 29,
      },
    ]);
    expect(result.files[1]?.matches[0]).toMatchObject({
      line: 1,
      column: 1,
      endColumn: 6,
      preview: "match on the first line",
      previewColumnStart: 1,
      previewColumnEnd: 6,
    });
  });

  it("falls back to Node scanner when rg unavailable", async () => {
    await writeFile(join(testDir, "fallback.txt"), "plain text fallback match\n");
    vi.stubEnv("PATH", "");

    const result = await searchFileContents(testDir, {
      query: "fallback",
      maxFiles: 10,
      maxMatchesPerFile: 10,
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      path: "fallback.txt",
      matchCount: 1,
      hasMoreMatches: false,
    });
    expect(result.totalMatchCount).toBe(1);
  });

  it("reports Unicode-aware columns from the ripgrep path", async () => {
    await writeFile(join(testDir, "unicode.txt"), "cafematch\ncafematch\ncafematch\n");
    await writeFile(join(testDir, "utf8.txt"), "咖啡match\n");

    const result = await searchFileContents(testDir, {
      query: "match",
      maxFiles: 10,
      maxMatchesPerFile: 10,
    });

    expect(result.files.find((file) => file.path === "utf8.txt")?.matches[0]).toMatchObject({
      line: 1,
      column: 3,
      endColumn: 8,
      previewColumnStart: 3,
      previewColumnEnd: 8,
    });
  });

  it("keeps .gitignore filtering on the ripgrep path outside a git repository", async () => {
    const plainDir = join(
      tmpdir(),
      `content-search-plain-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(plainDir, { recursive: true });

    try {
      await writeFile(join(plainDir, ".gitignore"), "ignored.txt\n");
      await writeFile(join(plainDir, "ignored.txt"), "match\n");
      await writeFile(join(plainDir, "visible.txt"), "match\n");

      const result = await searchFileContents(plainDir, {
        query: "match",
        maxFiles: 10,
        maxMatchesPerFile: 10,
      });

      expect(result.files.map((file) => file.path)).toEqual(["visible.txt"]);
    } finally {
      await rm(plainDir, { recursive: true, force: true });
    }
  });

  it("respects .gitignore, skips binary files, and reports truncation", async () => {
    await writeFile(join(testDir, ".gitignore"), "ignored.txt\n");
    await writeFile(join(testDir, "ignored.txt"), "match should be hidden\n");
    await writeFile(join(testDir, "first.txt"), "match one\nmatch two\nmatch three\n");
    await writeFile(join(testDir, "second.txt"), "match four\n");
    await writeFile(
      join(testDir, "binary.bin"),
      Buffer.from([0x00, 0x01, 0x6d, 0x61, 0x74, 0x63, 0x68])
    );

    const result = await searchFileContents(testDir, {
      query: "match",
      maxFiles: 1,
      maxMatchesPerFile: 2,
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      path: "first.txt",
      matchCount: 3,
      hasMoreMatches: true,
    });
    expect(result.files[0]?.matches).toHaveLength(2);
    expect(result.totalMatchCount).toBe(4);
    expect(result.hasMoreFiles).toBe(true);
    expect(result.truncatedMatchFileCount).toBe(1);
    expect(result.files.some((file) => file.path === "ignored.txt")).toBe(false);
    expect(result.files.some((file) => file.path === "binary.bin")).toBe(false);
  });

  it("skips oversized files in the Node fallback scanner", async () => {
    await writeFile(join(testDir, "large.txt"), "x".repeat(1_000_001) + "match");
    await writeFile(join(testDir, "small.txt"), "match\n");
    vi.stubEnv("PATH", "");

    const result = await searchFileContents(testDir, {
      query: "match",
      maxFiles: 10,
      maxMatchesPerFile: 10,
    });

    expect(result.files.map((file) => file.path)).toEqual(["small.txt"]);
  });
});
