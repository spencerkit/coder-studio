/**
 * Tests for file system commands.
 */

import { execFile } from "child_process";
import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { openDatabase, runMigrations } from "../storage/db.js";
import { WorkspaceManager } from "../workspace/manager.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";

import "../commands/file.js";
import "../commands/workspace.js";

const execFileAsync = promisify(execFile);

describe("File Commands", () => {
  let testDir: string;
  let ctx: CommandContext;
  let workspaceMgr: WorkspaceManager;
  let eventBus: EventBus;
  let db: ReturnType<typeof openDatabase>;
  let workspaceId: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `file-command-test-${Date.now()}`);
    await mkdir(testDir);

    await execFileAsync("git", ["init"], { cwd: testDir });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: testDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: testDir });

    await writeFile(join(testDir, "README.md"), "readme\n");
    await writeFile(join(testDir, "src.ts"), "export const src = true;\n");
    await mkdir(join(testDir, "docs"));
    await writeFile(join(testDir, "docs", "src-note.md"), "note\n");
    await writeFile(join(testDir, "docs", "readme-copy.md"), "copy\n");
    await writeFile(join(testDir, "docs", "readme-again.md"), "again\n");
    await writeFile(join(testDir, "docs", "README-notes.md"), "notes\n");
    await writeFile(join(testDir, "docs", "a-readme.md"), "a\n");
    await writeFile(join(testDir, "docs", "b-readme.md"), "b\n");
    await writeFile(join(testDir, "docs", "c-readme.md"), "c\n");
    await writeFile(join(testDir, "docs", "d-readme.md"), "d\n");
    await writeFile(join(testDir, "docs", "e-readme.md"), "e\n");
    await writeFile(join(testDir, "docs", "f-readme.md"), "f\n");
    await writeFile(join(testDir, "docs", "g-readme.md"), "g\n");

    db = openDatabase(":memory:");
    runMigrations(db);
    eventBus = new EventBus();
    vi.spyOn(eventBus, "emit");
    workspaceMgr = new WorkspaceManager({ db, eventBus });

    const workspace = await workspaceMgr.open({
      path: testDir,
    });
    workspaceId = workspace.id;

    ctx = {
      db,
      workspaceMgr,
      sessionMgr: {},
      terminalMgr: {},
      eventBus,
      broadcaster: { broadcast: () => {} },
      providerRegistry: [],
      fencingMgr: {},
      supervisorMgr: {},
    } as CommandContext;
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("searches files across the workspace by filename with a default limit of 10", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "file-search-1",
        op: "file.search",
        args: {
          workspaceId,
          query: "readme",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    const files = (result.data as { files: Array<{ path: string }> }).files;
    expect(files).toHaveLength(10);
    expect(files.every((item) => item.path.toLowerCase().endsWith(".md"))).toBe(true);
    expect(files.some((item) => item.path === "README.md")).toBe(true);
    expect(files.some((item) => item.path === "src.ts")).toBe(false);
  });

  it("matches by filename only and ignores directory names", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "file-search-2",
        op: "file.search",
        args: {
          workspaceId,
          query: "docs",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    const files = (result.data as { files: Array<{ path: string }> }).files;
    expect(files).toHaveLength(0);
  });

  it("keeps .gitignore filtering for search results", async () => {
    await writeFile(join(testDir, ".gitignore"), "ignored-note.md\n");
    await writeFile(join(testDir, "ignored-note.md"), "hidden from search\n");

    const result = await dispatch(
      {
        kind: "command",
        id: "file-search-3",
        op: "file.search",
        args: {
          workspaceId,
          query: "ignored",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    const files = (result.data as { files: Array<{ path: string }> }).files;
    expect(files).toHaveLength(0);
  });

  it("shows dotfiles and node_modules in file.readTree while still hiding .git", async () => {
    await writeFile(join(testDir, ".gitignore"), "*.log\nnode_modules/\n");
    await writeFile(join(testDir, ".env"), "secret\n");
    await writeFile(join(testDir, "ignored.log"), "log\n");
    await mkdir(join(testDir, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(testDir, ".git"), { recursive: true });

    const result = await dispatch(
      {
        kind: "command",
        id: "file-tree-1",
        op: "file.readTree",
        args: {
          workspaceId,
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    const children = (result.data as { children: Array<{ name: string }> }).children;
    expect(children.some((item) => item.name === ".env")).toBe(true);
    expect(children.some((item) => item.name === "ignored.log")).toBe(true);
    expect(children.some((item) => item.name === "node_modules")).toBe(true);
    expect(children.some((item) => item.name === ".git")).toBe(false);
  });

  it("emits fs.dirty after file writes", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "file-write-1",
        op: "file.write",
        args: {
          workspaceId,
          path: "README.md",
          content: "updated\n",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(eventBus.emit).toHaveBeenCalledWith({
      type: "fs.dirty",
      workspaceId,
      reason: "file_content",
    });
  });

  it("returns image version metadata from file.read", async () => {
    await writeFile(join(testDir, "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');

    const result = await dispatch(
      {
        kind: "command",
        id: "file-read-image-1",
        op: "file.read",
        args: {
          workspaceId,
          path: "logo.svg",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      kind: "image",
      mime: "image/svg+xml",
      url: `/api/file?workspaceId=${workspaceId}&path=logo.svg`,
      isTextBacked: true,
      version: expect.any(String),
    });
  });

  it("changes image version metadata when contents change even if the file size stays the same", async () => {
    const imagePath = join(testDir, "logo.svg");
    await writeFile(
      imagePath,
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'
    );

    const first = await dispatch(
      {
        kind: "command",
        id: "file-read-image-version-1",
        op: "file.read",
        args: {
          workspaceId,
          path: "logo.svg",
        },
      },
      ctx
    );

    expect(first.ok).toBe(true);

    await writeFile(
      imagePath,
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20"/></svg>'
    );

    const second = await dispatch(
      {
        kind: "command",
        id: "file-read-image-version-2",
        op: "file.read",
        args: {
          workspaceId,
          path: "logo.svg",
        },
      },
      ctx
    );

    expect(second.ok).toBe(true);
    expect((first.data as { kind: "image"; size: number; version: string }).kind).toBe("image");
    expect((second.data as { kind: "image"; size: number; version: string }).kind).toBe("image");
    expect((first.data as { kind: "image"; size: number; version: string }).size).toBe(
      (second.data as { kind: "image"; size: number; version: string }).size
    );
    expect((first.data as { kind: "image"; size: number; version: string }).version).not.toBe(
      (second.data as { kind: "image"; size: number; version: string }).version
    );
  });
});
