/**
 * Tests for file tree builder (lazy loading version).
 */

import { mkdir, mkdir as mkdirAsync, rmdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTree } from "../../fs/tree.js";

describe("readTree", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `tree-test-${Date.now()}`);
    await mkdir(testDir);
  });

  afterEach(async () => {
    try {
      await rmdir(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should return empty children array for empty directory", async () => {
    const result = await readTree(testDir);
    expect(result.path).toBe(".");
    expect(result.children).toEqual([]);
  });

  it("should list files and directories at root level", async () => {
    await writeFile(join(testDir, "file.txt"), "content");
    await mkdirAsync(join(testDir, "subdir"));
    await writeFile(join(testDir, "subdir", "nested.txt"), "nested");

    const result = await readTree(testDir);

    expect(result.children).toHaveLength(2);

    const dir = result.children.find((n) => n.name === "subdir");
    expect(dir).toBeDefined();
    expect(dir?.kind).toBe("dir");
    expect(dir?.children).toBeUndefined(); // Lazy loading: children undefined

    const file = result.children.find((n) => n.name === "file.txt");
    expect(file).toBeDefined();
    expect(file?.kind).toBe("file");
    expect(file?.size).toBe(7);
    expect(file?.mtime).toBeDefined();
  });

  it("should return children of subdir when subPath specified", async () => {
    await mkdirAsync(join(testDir, "subdir"));
    await writeFile(join(testDir, "subdir", "nested.txt"), "nested");
    await writeFile(join(testDir, "subdir", "another.txt"), "another");

    const result = await readTree(testDir, "subdir");

    expect(result.path).toBe("subdir");
    expect(result.children).toHaveLength(2);
    // Paths are relative to root, include subdir prefix
    expect(result.children[0].path).toBe("subdir/another.txt");
    expect(result.children[1].path).toBe("subdir/nested.txt");
  });

  it("should sort directories before files", async () => {
    await writeFile(join(testDir, "z-file.txt"), "content");
    await mkdirAsync(join(testDir, "a-dir"));

    const result = await readTree(testDir);

    expect(result.children[0].name).toBe("a-dir");
    expect(result.children[0].kind).toBe("dir");
    expect(result.children[1].name).toBe("z-file.txt");
    expect(result.children[1].kind).toBe("file");
  });

  it("should sort items alphabetically within same kind", async () => {
    await mkdirAsync(join(testDir, "b-dir"));
    await mkdirAsync(join(testDir, "a-dir"));
    await writeFile(join(testDir, "b-file.txt"), "b");
    await writeFile(join(testDir, "a-file.txt"), "a");

    const result = await readTree(testDir);

    expect(result.children[0].name).toBe("a-dir");
    expect(result.children[1].name).toBe("b-dir");
    expect(result.children[2].name).toBe("a-file.txt");
    expect(result.children[3].name).toBe("b-file.txt");
  });

  it("should skip hidden files", async () => {
    await writeFile(join(testDir, ".hidden"), "hidden");
    await writeFile(join(testDir, "visible.txt"), "visible");

    const result = await readTree(testDir);

    expect(result.children).toHaveLength(1);
    expect(result.children[0].name).toBe("visible.txt");
  });

  it("should skip node_modules and .git", async () => {
    await mkdirAsync(join(testDir, "node_modules"));
    await mkdirAsync(join(testDir, ".git"));
    await writeFile(join(testDir, "file.txt"), "content");

    const result = await readTree(testDir);

    expect(result.children).toHaveLength(1);
    expect(result.children[0].name).toBe("file.txt");
  });

  it("should use relative paths", async () => {
    await mkdirAsync(join(testDir, "subdir"));
    await writeFile(join(testDir, "subdir", "file.txt"), "content");

    const result = await readTree(testDir);

    expect(result.children[0].path).toBe("subdir");
    // Subdir children are undefined (lazy loading)
  });

  it("should respect .gitignore rules", async () => {
    await writeFile(join(testDir, ".gitignore"), "*.log\ndist/");
    await writeFile(join(testDir, "app.log"), "log content");
    await writeFile(join(testDir, "app.txt"), "text content");
    await mkdirAsync(join(testDir, "dist"));
    await mkdirAsync(join(testDir, "src"));

    const result = await readTree(testDir);

    expect(result.children.some((n) => n.name === "app.log")).toBe(false);
    expect(result.children.some((n) => n.name === "dist")).toBe(false);
    expect(result.children.some((n) => n.name === "app.txt")).toBe(true);
    expect(result.children.some((n) => n.name === "src")).toBe(true);
  });

  it("should show dotfiles when .gitignore does not ignore them", async () => {
    await writeFile(join(testDir, ".gitignore"), "*.log");
    await writeFile(join(testDir, ".env"), "secret");
    await writeFile(join(testDir, ".hidden-config"), "hidden");
    await writeFile(join(testDir, "visible.txt"), "visible");

    const result = await readTree(testDir);

    expect(result.children.some((n) => n.name === ".env")).toBe(true);
    expect(result.children.some((n) => n.name === ".gitignore")).toBe(true);
    expect(result.children.some((n) => n.name === ".hidden-config")).toBe(true);
    expect(result.children.some((n) => n.name === "visible.txt")).toBe(true);
  });
});
