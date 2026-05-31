/**
 * Tests for file system commands.
 */

import { execFile } from "child_process";
import { readFile as fsReadFile, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { WorkspaceRepo } from "../storage/repositories/workspace-repo.js";
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
  let workspaceId: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `file-command-test-${Date.now()}`);
    await mkdir(testDir);

    await execFileAsync("git", ["init"], { cwd: testDir });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: testDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: testDir });

    await writeFile(join(testDir, "README.md"), "readme\n");
    await writeFile(join(testDir, "src.ts"), "export const src = true;\n");
    await mkdir(join(testDir, "src"));
    await writeFile(join(testDir, "src", "guide.md"), "guide\n");
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

    eventBus = new EventBus();
    vi.spyOn(eventBus, "emit");
    workspaceMgr = new WorkspaceManager({
      workspaceRepo: new WorkspaceRepo({
        filePath: join(testDir, ".state", "workspaces.json"),
      }),
      eventBus,
    });

    const workspace = await workspaceMgr.open({
      path: testDir,
    });
    workspaceId = workspace.id;

    ctx = {
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

  it("matches directory paths while keeping filename hits ahead of path-only matches", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "file-search-2",
        op: "file.search",
        args: {
          workspaceId,
          query: "src",
          limit: 10,
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    const files = (result.data as { files: Array<{ path: string }> }).files;
    expect(files[0]?.path).toBe("src.ts");
    expect(files.some((item) => item.path === "src/guide.md")).toBe(true);

    const directoryResult = await dispatch(
      {
        kind: "command",
        id: "file-search-2-path",
        op: "file.search",
        args: {
          workspaceId,
          query: "docs",
          limit: 10,
        },
      },
      ctx
    );

    expect(directoryResult.ok).toBe(true);
    const directoryFiles = (directoryResult.data as { files: Array<{ path: string }> }).files;
    expect(directoryFiles.length).toBeGreaterThan(0);
    expect(directoryFiles.every((item) => item.path.startsWith("docs/"))).toBe(true);
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

  it("dispatches file.searchContent and returns grouped content matches", async () => {
    await writeFile(join(testDir, "alpha.ts"), "const hit = 'match';\nconst second = 'match';\n");
    await writeFile(join(testDir, "notes.md"), "match in docs\n");

    const result = await dispatch(
      {
        kind: "command",
        id: "file-search-content-1",
        op: "file.searchContent",
        args: {
          workspaceId,
          query: "match",
          maxFiles: 1,
          maxMatchesPerFile: 1,
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      totalMatchCount: 3,
      hasMoreFiles: true,
      truncatedMatchFileCount: 1,
      files: [
        {
          path: "alpha.ts",
          name: "alpha.ts",
          matchCount: 2,
          hasMoreMatches: true,
          matches: [
            {
              line: 1,
              column: 14,
              endColumn: 19,
              preview: "const hit = 'match';",
              previewColumnStart: 14,
              previewColumnEnd: 19,
            },
          ],
        },
      ],
    });
  });

  it("starts search sessions and returns replacement-aware results", async () => {
    await writeFile(join(testDir, "alpha.ts"), "const match = 'match';\n");

    const result = await dispatch(
      {
        kind: "command",
        id: "file-search-session-start-1",
        op: "file.searchSession.start",
        args: {
          workspaceId,
          query: "match",
          replace: "rename",
          isRegex: false,
          matchCase: true,
          matchWholeWord: false,
          preserveCase: false,
          includeGlobs: [],
          excludeGlobs: [],
          useIgnoreFiles: true,
          useExcludeSettings: true,
          onlyOpenEditors: false,
          openEditorPaths: [],
          maxFiles: 20,
          maxMatchesPerFile: 20,
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      sessionId: expect.any(String),
      totalMatchCount: 2,
      totalFileCount: 1,
    });
    expect(
      (result.data as { files: Array<{ path: string; matchCount: number }> }).files[0]
    ).toMatchObject({
      path: "alpha.ts",
      matchCount: 2,
    });
    expect(
      (
        result.data as {
          files: Array<{ matches: Array<{ replacementPreview: string }> }>;
        }
      ).files[0]?.matches
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          replacementPreview: "const rename = 'match';",
        }),
      ])
    );
  });

  it("previews one search-session file and applies replacements with fs.dirty emission", async () => {
    await writeFile(join(testDir, "alpha.ts"), "match match\n");

    const startResult = await dispatch(
      {
        kind: "command",
        id: "file-search-session-start-2",
        op: "file.searchSession.start",
        args: {
          workspaceId,
          query: "match",
          replace: "rename",
          isRegex: false,
          matchCase: true,
          matchWholeWord: false,
          preserveCase: false,
          includeGlobs: [],
          excludeGlobs: [],
          useIgnoreFiles: true,
          useExcludeSettings: true,
          onlyOpenEditors: false,
          openEditorPaths: [],
          maxFiles: 20,
          maxMatchesPerFile: 20,
        },
      },
      ctx
    );

    expect(startResult.ok).toBe(true);
    const startData = startResult.data as {
      sessionId: string;
      files: Array<{ path: string; matches: Array<{ id: string }> }>;
    };

    const previewResult = await dispatch(
      {
        kind: "command",
        id: "file-search-session-preview-1",
        op: "file.searchSession.previewFile",
        args: {
          workspaceId,
          sessionId: startData.sessionId,
          path: "alpha.ts",
        },
      },
      ctx
    );

    expect(previewResult.ok).toBe(true);
    expect(previewResult.data).toMatchObject({
      kind: "search-replace-file-diff",
      path: "alpha.ts",
      originalContent: "match match\n",
      modifiedContent: "rename rename\n",
    });

    const applyResult = await dispatch(
      {
        kind: "command",
        id: "file-search-session-apply-1",
        op: "file.searchSession.apply",
        args: {
          workspaceId,
          sessionId: startData.sessionId,
          scope: {
            kind: "match",
            path: "alpha.ts",
            matchId: startData.files[0]?.matches[0]?.id,
          },
        },
      },
      ctx
    );

    expect(applyResult.ok).toBe(true);
    expect(applyResult.data).toMatchObject({
      status: "ok",
      appliedFileCount: 1,
      results: [{ path: "alpha.ts", status: "applied", replacedMatchCount: 1 }],
    });
    expect(eventBus.emit).toHaveBeenCalledWith({
      type: "fs.dirty",
      workspaceId,
      reason: "file_content",
    });
  });

  it("returns stale_session for missing search sessions", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "file-search-session-apply-2",
        op: "file.searchSession.apply",
        args: {
          workspaceId,
          sessionId: "missing-session",
          scope: {
            kind: "all",
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      sessionId: "missing-session",
      status: "stale_session",
    });
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
    const children = (result.data as { children: Array<{ name: string; isGitIgnored?: boolean }> })
      .children;
    expect(children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: ".env", isGitIgnored: false }),
        expect.objectContaining({ name: "ignored.log", isGitIgnored: true }),
        expect.objectContaining({ name: "node_modules", isGitIgnored: true }),
      ])
    );
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

  it("renames files and emits fs.dirty", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "file-rename-1",
        op: "file.rename",
        args: {
          workspaceId,
          fromPath: "README.md",
          toPath: "GUIDE.md",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(await fsReadFile(join(testDir, "GUIDE.md"), "utf-8")).toBe("readme\n");
    expect(eventBus.emit).toHaveBeenCalledWith({
      type: "fs.dirty",
      workspaceId,
      reason: "fs_change",
    });
  });

  it("renames directories recursively", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "file-rename-2",
        op: "file.rename",
        args: {
          workspaceId,
          fromPath: "docs",
          toPath: "guides",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(await fsReadFile(join(testDir, "guides", "src-note.md"), "utf-8")).toBe("note\n");
  });

  it("allows same-directory renames when equivalent paths use different syntax", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "file-rename-2b",
        op: "file.rename",
        args: {
          workspaceId,
          fromPath: "./README.md",
          toPath: "docs/../GUIDE.md",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(await fsReadFile(join(testDir, "GUIDE.md"), "utf-8")).toBe("readme\n");
  });

  it("rejects colliding, cross-directory, or escaping rename targets", async () => {
    const collision = await dispatch(
      {
        kind: "command",
        id: "file-rename-3",
        op: "file.rename",
        args: {
          workspaceId,
          fromPath: "README.md",
          toPath: "src.ts",
        },
      },
      ctx
    );

    const crossDirectory = await dispatch(
      {
        kind: "command",
        id: "file-rename-4",
        op: "file.rename",
        args: {
          workspaceId,
          fromPath: "README.md",
          toPath: "docs/README.md",
        },
      },
      ctx
    );

    const escaped = await dispatch(
      {
        kind: "command",
        id: "file-rename-5",
        op: "file.rename",
        args: {
          workspaceId,
          fromPath: "README.md",
          toPath: "../outside.md",
        },
      },
      ctx
    );

    const escapedSource = await dispatch(
      {
        kind: "command",
        id: "file-rename-6",
        op: "file.rename",
        args: {
          workspaceId,
          fromPath: "../README.md",
          toPath: "GUIDE.md",
        },
      },
      ctx
    );

    expect(collision.ok).toBe(false);
    expect(collision.error).toMatchObject({ code: "already_exists" });
    expect(crossDirectory.ok).toBe(false);
    expect(crossDirectory.error).toMatchObject({
      code: "rename_across_directories_not_supported",
    });
    expect(escaped.ok).toBe(false);
    expect(escaped.error).toMatchObject({ code: "path_escape" });
    expect(escapedSource.ok).toBe(false);
    expect(escapedSource.error).toMatchObject({ code: "path_escape" });
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
