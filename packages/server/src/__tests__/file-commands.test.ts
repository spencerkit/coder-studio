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
});
