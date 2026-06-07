/**
 * Tests for file-io operations.
 */

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, win32 } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDirectory,
  createFile,
  deleteEntry,
  readFile as readWorkspaceFile,
  resolveSafe,
  writeFile as writeWorkspaceFile,
} from "../../fs/file-io.js";

describe("resolveSafe", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "fileio-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("should resolve safe relative path", () => {
    const result = resolveSafe(testDir, "file.txt");
    expect(result).toBe(join(testDir, "file.txt"));
  });

  it("should resolve safe nested path", () => {
    const result = resolveSafe(testDir, "subdir/file.txt");
    expect(result).toBe(join(testDir, "subdir/file.txt"));
  });

  it("should reject path escape with ..", () => {
    expect(() => resolveSafe(testDir, "../outside.txt")).toThrow();
  });

  it("should reject absolute path escape", () => {
    expect(() => resolveSafe(testDir, "/etc/passwd")).toThrow();
  });

  it("should allow paths when the workspace root is /", () => {
    expect(resolveSafe("/", "tmp/file.txt")).toBe("/tmp/file.txt");
  });

  it("should reject win32 parent traversal that escapes the workspace root", () => {
    expect(() => resolveSafe("C:\\workspace", "..\\outside.txt", win32)).toThrow();
  });
});

describe("readFile", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "fileio-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("should read file content and hash", async () => {
    const filePath = join(testDir, "test.txt");
    await writeFile(filePath, "Hello, World!");

    const result = await readWorkspaceFile("ws-1", testDir, "test.txt");

    expect(result.kind).toBe("text");
    if (result.kind === "text") {
      expect(result.content).toBe("Hello, World!");
      expect(result.baseHash).toBeDefined();
      expect(result.encoding).toBe("utf-8");
    }
  });

  it("should throw for non-existent file", async () => {
    await expect(readWorkspaceFile("ws-1", testDir, "nonexistent.txt")).rejects.toThrow();
  });

  it("should return an image descriptor with a signed-in asset URL for png files", async () => {
    // Minimal 1x1 PNG so we exercise the binary branch without depending on
    // fixture files; exact bytes don't matter since the endpoint just streams
    // them — we only assert the metadata here.
    const pngBytes = Buffer.from(
      "89504E470D0A1A0A0000000D4948445200000001000000010806000000" +
        "1F15C4890000000A49444154789C63000100000005000157CFC4A30000" +
        "0000049454E44AE426082",
      "hex"
    );
    const filePath = join(testDir, "pixel.png");
    await writeFile(filePath, pngBytes);

    const result = await readWorkspaceFile("ws-42", testDir, "pixel.png");

    expect(result.kind).toBe("image");
    if (result.kind === "image") {
      expect(result.mime).toBe("image/png");
      expect(result.size).toBe(pngBytes.length);
      expect(result.isTextBacked).toBe(false);
      expect(result.url).toMatch(/^\/api\/file\?/);
      // Both query params must round-trip correctly since the client feeds
      // the URL straight into <img src>.
      const url = new URL(result.url, "http://local");
      expect(url.searchParams.get("workspaceId")).toBe("ws-42");
      expect(url.searchParams.get("path")).toBe("pixel.png");
    }
  });

  it("should flag svg as image but text-backed so the UI can offer edit-as-text", async () => {
    const filePath = join(testDir, "icon.svg");
    await writeFile(filePath, '<svg xmlns="http://www.w3.org/2000/svg"/>');

    const result = await readWorkspaceFile("ws-1", testDir, "icon.svg");

    expect(result.kind).toBe("image");
    if (result.kind === "image") {
      expect(result.mime).toBe("image/svg+xml");
      expect(result.isTextBacked).toBe(true);
    }
  });
});

describe("writeFile", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "fileio-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("should write new file without baseHash", async () => {
    const result = await writeWorkspaceFile(testDir, "test.txt", "Hello, World!");

    expect(result.newHash).toBeDefined();

    const content = await readFile(join(testDir, "test.txt"), "utf8");
    expect(content).toBe("Hello, World!");
  });

  it("should write file with correct baseHash", async () => {
    const filePath = join(testDir, "test.txt");
    await writeFile(filePath, "Original");

    const read = await readWorkspaceFile("ws-1", testDir, "test.txt");
    if (read.kind !== "text") throw new Error("expected text kind");
    const result = await writeWorkspaceFile(testDir, "test.txt", "Updated", read.baseHash);

    expect(result.newHash).toBeDefined();

    const content = await readFile(filePath, "utf8");
    expect(content).toBe("Updated");
  });

  it("should reject write with wrong baseHash", async () => {
    const filePath = join(testDir, "test.txt");
    await writeFile(filePath, "Original");

    // Someone else changes the file
    await writeFile(filePath, "Changed");

    // Try to write with outdated baseHash
    await expect(writeWorkspaceFile(testDir, "test.txt", "Updated", "wronghash")).rejects.toThrow();
  });
});

describe("createFile", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "fileio-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("creates an empty file", async () => {
    await createFile(testDir, "notes/today.md");

    expect(await readFile(join(testDir, "notes/today.md"), "utf8")).toBe("");
  });

  it("creates parent directories automatically", async () => {
    await createFile(testDir, "src/demo/new-file.ts");

    const stats = await stat(join(testDir, "src/demo"));
    expect(stats.isDirectory()).toBe(true);
  });

  it("rejects when the target already exists", async () => {
    await writeFile(join(testDir, "README.md"), "hello");

    await expect(createFile(testDir, "README.md")).rejects.toMatchObject({
      code: "already_exists",
    });
  });

  it("rejects path escape attempts", async () => {
    await expect(createFile(testDir, "../outside.txt")).rejects.toMatchObject({
      code: "path_escape",
    });
  });
});

describe("createDirectory", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "fileio-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("creates a directory recursively", async () => {
    await createDirectory(testDir, "src/demo/new-dir");

    const stats = await stat(join(testDir, "src/demo/new-dir"));
    expect(stats.isDirectory()).toBe(true);
  });

  it("rejects when the target already exists", async () => {
    await mkdir(join(testDir, "src/demo"), { recursive: true });

    await expect(createDirectory(testDir, "src/demo")).rejects.toMatchObject({
      code: "already_exists",
    });
  });

  it("rejects path escape attempts", async () => {
    await expect(createDirectory(testDir, "../outside-dir")).rejects.toMatchObject({
      code: "path_escape",
    });
  });
});

describe("deleteEntry", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "fileio-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("deletes a file", async () => {
    await mkdir(join(testDir, "src/demo"), { recursive: true });
    await writeFile(join(testDir, "src/demo/remove-me.ts"), "export {};");

    await deleteEntry(testDir, "src/demo/remove-me.ts");

    await expect(readFile(join(testDir, "src/demo/remove-me.ts"), "utf8")).rejects.toThrow();
  });

  it("rejects when the file does not exist", async () => {
    await expect(deleteEntry(testDir, "missing.ts")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("deletes a directory recursively", async () => {
    await mkdir(join(testDir, "src/demo/nested"), { recursive: true });
    await writeFile(join(testDir, "src/demo/nested/file.ts"), "export {};");

    await deleteEntry(testDir, "src/demo");

    await expect(stat(join(testDir, "src/demo"))).rejects.toThrow();
  });

  it("rejects path escape attempts", async () => {
    await expect(deleteEntry(testDir, "../outside.txt")).rejects.toMatchObject({
      code: "path_escape",
    });
  });
});
