import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../storage/database.js";
import { closeDatabase, type NewWorkspace, openDatabase, WorkspaceRepo } from "../storage/index.js";

describe("WorkspaceRepo", () => {
  let db: Database;
  let repo: WorkspaceRepo;
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for the test database
    tempDir = mkdtempSync(join(tmpdir(), "workspace-repo-test-"));
    const dbPath = join(tempDir, "test.db");
    db = openDatabase(dbPath);
    repo = new WorkspaceRepo(db);
  });

  afterEach(() => {
    closeDatabase(db);
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("create", () => {
    it("should create a new workspace", () => {
      const newWorkspace: NewWorkspace = {
        id: "ws-1",
        path: "/path/to/workspace",
        targetRuntime: "native",
        openedAt: Date.now(),
        lastActiveAt: Date.now(),
        uiState: {
          leftPanelWidth: 250,
          bottomPanelHeight: 150,
          focusMode: false,
        },
      };

      const result = repo.create(newWorkspace);

      expect(result.id).toBe(newWorkspace.id);
      expect(result.path).toBe(newWorkspace.path);
      expect(result.targetRuntime).toBe(newWorkspace.targetRuntime);
      expect(result.uiState.leftPanelWidth).toBe(250);
    });

    it("should support WSL workspaces", () => {
      const newWorkspace: NewWorkspace = {
        id: "ws-2",
        path: "\\\\wsl$\\Ubuntu\\home\\user\\project",
        targetRuntime: "wsl",
        wslDistro: "Ubuntu",
        openedAt: Date.now(),
        lastActiveAt: Date.now(),
        uiState: {
          leftPanelWidth: 300,
          bottomPanelHeight: 200,
          focusMode: true,
        },
      };

      const result = repo.create(newWorkspace);

      expect(result.targetRuntime).toBe("wsl");
      expect(result.wslDistro).toBe("Ubuntu");
    });

    it("persists pane layout in ui state", () => {
      const newWorkspace: NewWorkspace = {
        id: "ws-pane",
        path: "/path/to/pane-workspace",
        targetRuntime: "native",
        openedAt: Date.now(),
        lastActiveAt: Date.now(),
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 180,
          focusMode: false,
          paneLayout: {
            id: "root",
            type: "split",
            direction: "horizontal",
            children: [
              {
                id: "left",
                type: "leaf",
                sessionId: "sess-1",
              },
              {
                id: "right",
                type: "leaf",
                sessionId: "sess-2",
              },
            ],
          },
        },
      };

      const result = repo.create(newWorkspace);

      expect(result.uiState.paneLayout).toEqual(newWorkspace.uiState.paneLayout);
    });
  });

  describe("list", () => {
    it("should list all workspaces", () => {
      repo.create({
        id: "ws-1",
        path: "/path/1",
        targetRuntime: "native",
        openedAt: 1000,
        lastActiveAt: 2000,
        uiState: { leftPanelWidth: 250, bottomPanelHeight: 150, focusMode: false },
      });

      repo.create({
        id: "ws-2",
        path: "/path/2",
        targetRuntime: "wsl",
        wslDistro: "Ubuntu",
        openedAt: 3000,
        lastActiveAt: 4000,
        uiState: { leftPanelWidth: 300, bottomPanelHeight: 200, focusMode: true },
      });

      const workspaces = repo.list();

      expect(workspaces).toHaveLength(2);
      expect(workspaces.map((w) => w.id)).toEqual(expect.arrayContaining(["ws-1", "ws-2"]));
    });

    it("should return empty array when no workspaces exist", () => {
      const workspaces = repo.list();
      expect(workspaces).toHaveLength(0);
    });
  });

  describe("findById", () => {
    it("should find a workspace by ID", () => {
      repo.create({
        id: "ws-1",
        path: "/path/to/workspace",
        targetRuntime: "native",
        openedAt: Date.now(),
        lastActiveAt: Date.now(),
        uiState: { leftPanelWidth: 250, bottomPanelHeight: 150, focusMode: false },
      });

      const result = repo.findById("ws-1");

      expect(result).toBeDefined();
      expect(result?.id).toBe("ws-1");
    });

    it("should return undefined for non-existent ID", () => {
      const result = repo.findById("non-existent");
      expect(result).toBeUndefined();
    });
  });

  describe("findByPath", () => {
    it("should find a workspace by path", () => {
      repo.create({
        id: "ws-1",
        path: "/path/to/workspace",
        targetRuntime: "native",
        openedAt: Date.now(),
        lastActiveAt: Date.now(),
        uiState: { leftPanelWidth: 250, bottomPanelHeight: 150, focusMode: false },
      });

      const result = repo.findByPath("/path/to/workspace");

      expect(result).toBeDefined();
      expect(result?.id).toBe("ws-1");
    });

    it("should return undefined for non-existent path", () => {
      const result = repo.findByPath("/non/existent/path");
      expect(result).toBeUndefined();
    });
  });

  describe("updateUiState", () => {
    it("should update UI state for a workspace", () => {
      repo.create({
        id: "ws-1",
        path: "/path/to/workspace",
        targetRuntime: "native",
        openedAt: Date.now(),
        lastActiveAt: Date.now(),
        uiState: { leftPanelWidth: 250, bottomPanelHeight: 150, focusMode: false },
      });

      repo.updateUiState("ws-1", {
        leftPanelWidth: 300,
        bottomPanelHeight: 200,
        focusMode: true,
        activeSessionId: "session-1",
      });

      const result = repo.findById("ws-1");
      expect(result?.uiState.leftPanelWidth).toBe(300);
      expect(result?.uiState.focusMode).toBe(true);
      expect(result?.uiState.activeSessionId).toBe("session-1");
    });

    it("updates pane layout inside ui state", () => {
      repo.create({
        id: "ws-1",
        path: "/path/to/workspace",
        targetRuntime: "native",
        openedAt: Date.now(),
        lastActiveAt: Date.now(),
        uiState: { leftPanelWidth: 250, bottomPanelHeight: 150, focusMode: false },
      });

      repo.updateUiState("ws-1", {
        leftPanelWidth: 300,
        bottomPanelHeight: 220,
        focusMode: false,
        paneLayout: {
          id: "root",
          type: "split",
          direction: "vertical",
          children: [
            { id: "top", type: "leaf", sessionId: "sess-top" },
            { id: "bottom", type: "leaf" },
          ],
        },
      });

      const result = repo.findById("ws-1");
      expect(result?.uiState.paneLayout).toEqual({
        id: "root",
        type: "split",
        direction: "vertical",
        children: [
          { id: "top", type: "leaf", sessionId: "sess-top" },
          { id: "bottom", type: "leaf" },
        ],
      });
    });

    it("updates fileTreeExpandedDirs inside ui state", () => {
      repo.create({
        id: "ws-expanded",
        path: "/path/to/workspace",
        targetRuntime: "native",
        openedAt: Date.now(),
        lastActiveAt: Date.now(),
        uiState: { leftPanelWidth: 250, bottomPanelHeight: 150, focusMode: false },
      });

      repo.updateUiState("ws-expanded", {
        leftPanelWidth: 250,
        bottomPanelHeight: 150,
        focusMode: false,
        fileTreeExpandedDirs: ["src", "src/components"],
      });

      expect(repo.findById("ws-expanded")?.uiState.fileTreeExpandedDirs).toEqual([
        "src",
        "src/components",
      ]);
    });
  });

  describe("updateLastActive", () => {
    it("should update last active timestamp", () => {
      repo.create({
        id: "ws-1",
        path: "/path/to/workspace",
        targetRuntime: "native",
        openedAt: 1000,
        lastActiveAt: 1000,
        uiState: { leftPanelWidth: 250, bottomPanelHeight: 150, focusMode: false },
      });

      const newTime = Date.now();
      repo.updateLastActive("ws-1", newTime);

      const result = repo.findById("ws-1");
      expect(result?.lastActiveAt).toBe(newTime);
    });
  });

  describe("file-backed persistence", () => {
    it("reads workspace metadata directly from the file store", () => {
      const filePath = join(tempDir, "workspaces.json");
      const fileRepo = new WorkspaceRepo({
        filePath,
      });

      fileRepo.create({
        id: "ws-file",
        path: "/path/to/file-workspace",
        targetRuntime: "native",
        openedAt: 1000,
        lastActiveAt: 2000,
        uiState: { leftPanelWidth: 250, bottomPanelHeight: 150, focusMode: false },
      });

      const restored = fileRepo.findById("ws-file");

      expect(restored).toMatchObject({
        id: "ws-file",
        path: "/path/to/file-workspace",
      });
    });

    it("does not import legacy database workspaces when the file is missing", () => {
      repo.create({
        id: "ws-legacy",
        path: "/path/to/legacy-workspace",
        targetRuntime: "native",
        openedAt: 1000,
        lastActiveAt: 2000,
        uiState: { leftPanelWidth: 250, bottomPanelHeight: 150, focusMode: false },
      });

      const fileRepo = new WorkspaceRepo({
        filePath: join(tempDir, "migrated-workspaces.json"),
      });

      expect(fileRepo.list()).toEqual([]);
    });

    it("does not mirror file-backed workspaces into sqlite", () => {
      const fileRepo = new WorkspaceRepo({
        filePath: join(tempDir, "no-shadow-workspaces.json"),
      });

      fileRepo.create({
        id: "ws-no-shadow",
        path: "/path/to/no-shadow-workspace",
        targetRuntime: "native",
        openedAt: 1000,
        lastActiveAt: 2000,
        uiState: { leftPanelWidth: 250, bottomPanelHeight: 150, focusMode: false },
      });

      expect(
        db.prepare("SELECT * FROM workspaces WHERE id = ?").get("ws-no-shadow")
      ).toBeUndefined();
    });
  });

  describe("delete", () => {
    it("should delete a workspace by ID", () => {
      repo.create({
        id: "ws-1",
        path: "/path/to/workspace",
        targetRuntime: "native",
        openedAt: Date.now(),
        lastActiveAt: Date.now(),
        uiState: { leftPanelWidth: 250, bottomPanelHeight: 150, focusMode: false },
      });

      repo.delete("ws-1");

      const result = repo.findById("ws-1");
      expect(result).toBeUndefined();
    });

    it("should cascade delete related terminals and sessions", () => {
      // Create workspace
      repo.create({
        id: "ws-1",
        path: "/path/to/workspace",
        targetRuntime: "native",
        openedAt: Date.now(),
        lastActiveAt: Date.now(),
        uiState: { leftPanelWidth: 250, bottomPanelHeight: 150, focusMode: false },
      });

      // Create terminal
      db.prepare(
        `INSERT INTO terminals (id, workspace_id, kind, cwd, argv, cols, rows, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run("t-1", "ws-1", "agent", "/path", "[]", 80, 24, Date.now());

      // Delete workspace
      repo.delete("ws-1");

      // Verify terminal was deleted
      const terminal = db.prepare("SELECT * FROM terminals WHERE id = ?").get("t-1");
      expect(terminal).toBeUndefined();
    });
  });
});
