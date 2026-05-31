/**
 * Tests for gitignore filter module.
 */

import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createGitignoreFilter,
  createGitignoreMatcher,
  createTreeVisibilityFilter,
  createWatcherIgnoreFilter,
  isPathGitignored,
} from "../../fs/gitignore.js";

describe("createGitignoreFilter", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `gitignore-test-${Date.now()}`);
    await mkdir(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("skips dotfiles, node_modules, .git when no .gitignore exists", () => {
    const filter = createGitignoreFilter(testDir, testDir);
    expect(filter("file.txt")).toBe(true);
    expect(filter("src")).toBe(true);
    expect(filter(".hidden")).toBe(false);
    expect(filter(".gitignore")).toBe(false);
    expect(filter("node_modules")).toBe(false);
    expect(filter(".git")).toBe(false);
  });

  it("respects .gitignore rules for patterns", async () => {
    await writeFile(join(testDir, ".gitignore"), "*.log\n*.tmp\nbuild/\n.env");

    const filter = createGitignoreFilter(testDir, testDir);
    expect(filter("app.log")).toBe(false);
    expect(filter("error.tmp")).toBe(false);
    expect(filter("file.txt")).toBe(true);
    expect(filter("build")).toBe(false);
    expect(filter(".env")).toBe(false);
    expect(filter(".env.local")).toBe(true);
  });

  it("respects negation patterns", async () => {
    await writeFile(join(testDir, ".gitignore"), "*.log\n!important.log");

    const filter = createGitignoreFilter(testDir, testDir);
    expect(filter("error.log")).toBe(false);
    expect(filter("important.log")).toBe(true);
  });

  it("applies root .gitignore rules relative to subdirectories", async () => {
    await writeFile(join(testDir, ".gitignore"), "src/generated/\n/root-only.txt");
    await mkdir(join(testDir, "src"));

    const filter = createGitignoreFilter(testDir, join(testDir, "src"));

    expect(filter("generated")).toBe(false);
    expect(filter("root-only.txt")).toBe(true);
  });

  it("keeps required repository and dependency ignores when .gitignore exists", async () => {
    await writeFile(join(testDir, ".gitignore"), "*.log");

    const filter = createGitignoreFilter(testDir, testDir);

    expect(filter(".git")).toBe(false);
    expect(filter(".hidden")).toBe(true);
    expect(filter(".gitignore")).toBe(true);
    expect(filter("node_modules")).toBe(false);
    expect(filter("app.log")).toBe(false);
    expect(filter("file.txt")).toBe(true);
  });

  it("shows dotfiles when .gitignore does not ignore them", async () => {
    await writeFile(join(testDir, ".gitignore"), "*.log\n!.env\n!.gitignore");

    const filter = createGitignoreFilter(testDir, testDir);

    expect(filter(".env")).toBe(true);
    expect(filter(".gitignore")).toBe(true);
    expect(filter(".hidden")).toBe(true);
    expect(filter("node_modules")).toBe(false);
    expect(filter(".git")).toBe(false);
  });
});

describe("createTreeVisibilityFilter", () => {
  it("hides only .git entries from the directory tree", () => {
    const filter = createTreeVisibilityFilter();

    expect(filter(".git")).toBe(false);
    expect(filter(".gitignore")).toBe(true);
    expect(filter(".env")).toBe(true);
    expect(filter("node_modules")).toBe(true);
    expect(filter("src")).toBe(true);
  });
});

describe("gitignore matcher helpers", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `gitignore-matcher-test-${Date.now()}`);
    await mkdir(join(testDir, "src"), { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("matches paths against the root .gitignore while keeping .git visible", async () => {
    await writeFile(join(testDir, ".gitignore"), "*.log\ndist/\n!important.log");
    await writeFile(join(testDir, "src", "index.ts"), "export {};\n");

    const matcher = createGitignoreMatcher(testDir);

    expect(isPathGitignored(matcher, "app.log")).toBe(true);
    expect(isPathGitignored(matcher, "dist")).toBe(true);
    expect(isPathGitignored(matcher, "important.log")).toBe(false);
    expect(isPathGitignored(matcher, ".git")).toBe(false);
    expect(isPathGitignored(matcher, "src/index.ts")).toBe(false);
  });
});

describe("createWatcherIgnoreFilter", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `watcher-gitignore-test-${Date.now()}`);
    await mkdir(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("keeps .git/ watched but ignores node_modules, .DS_Store, Thumbs.db when no .gitignore", () => {
    const filter = createWatcherIgnoreFilter(testDir);
    expect(filter(join(testDir, ".git/config"))).toBe(false);
    expect(filter(join(testDir, "node_modules/package"))).toBe(true);
    expect(filter(join(testDir, ".DS_Store"))).toBe(true);
    expect(filter(join(testDir, "Thumbs.db"))).toBe(true);
    expect(filter(join(testDir, "file.txt"))).toBe(false);
  });

  it("does not apply .gitignore rules to watcher filtering", async () => {
    await writeFile(join(testDir, ".gitignore"), "*.log\n*.tmp\nbuild/");

    const filter = createWatcherIgnoreFilter(testDir);
    expect(filter(join(testDir, "app.log"))).toBe(false);
    expect(filter(join(testDir, "error.tmp"))).toBe(false);
    expect(filter(join(testDir, "build", "bundle.js"))).toBe(false);
    expect(filter(join(testDir, "file.txt"))).toBe(false);
  });

  it("keeps hard watcher ignores even when .gitignore exists", async () => {
    await writeFile(join(testDir, ".gitignore"), "*.log");

    const filter = createWatcherIgnoreFilter(testDir);

    expect(filter(join(testDir, ".git/config"))).toBe(false);
    expect(filter(join(testDir, "node_modules/package"))).toBe(true);
    expect(filter(join(testDir, ".playwright-mcp/page.yml"))).toBe(true);
    expect(filter(join(testDir, "app.log"))).toBe(false);
    expect(filter(join(testDir, "src/index.ts"))).toBe(false);
  });
});
