import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type NewWorkspace, WorkspaceRepo } from "../storage/index.js";

describe("WorkspaceRepo", () => {
  let repo: WorkspaceRepo;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "workspace-repo-test-"));
    repo = new WorkspaceRepo({ filePath: join(tempDir, "workspaces.json") });
  });

  afterEach(() => {
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

    it("rejects duplicate ids", () => {
      const workspace: NewWorkspace = {
        id: "ws-1",
        path: "/path/to/workspace",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: { leftPanelWidth: 250, bottomPanelHeight: 150, focusMode: false },
      };

      repo.create(workspace);

      expect(() => repo.create({ ...workspace, path: "/other/path" })).toThrow(/already exists/);
    });

    it("rejects duplicate paths", () => {
      repo.create({
        id: "ws-1",
        path: "/path/to/workspace",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: { leftPanelWidth: 250, bottomPanelHeight: 150, focusMode: false },
      });

      expect(() =>
        repo.create({
          id: "ws-2",
          path: "/path/to/workspace",
          targetRuntime: "native",
          openedAt: 2,
          lastActiveAt: 2,
          uiState: { leftPanelWidth: 250, bottomPanelHeight: 150, focusMode: false },
        })
      ).toThrow(/path already exists/);
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
      expect(workspaces.map((w) => w.id)).toEqual(["ws-2", "ws-1"]);
    });

    it("should return empty array when no workspaces exist", () => {
      expect(repo.list()).toEqual([]);
    });
  });

  describe("finders", () => {
    beforeEach(() => {
      repo.create({
        id: "ws-1",
        path: "/path/to/workspace",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: { leftPanelWidth: 250, bottomPanelHeight: 150, focusMode: false },
      });
    });

    it("finds by id", () => {
      expect(repo.findById("ws-1")?.id).toBe("ws-1");
    });

    it("finds by path", () => {
      expect(repo.findByPath("/path/to/workspace")?.id).toBe("ws-1");
    });

    it("returns undefined for missing records", () => {
      expect(repo.findById("missing")).toBeUndefined();
      expect(repo.findByPath("/missing")).toBeUndefined();
    });
  });

  describe("updates", () => {
    beforeEach(() => {
      repo.create({
        id: "ws-1",
        path: "/path/to/workspace",
        targetRuntime: "native",
        openedAt: 1000,
        lastActiveAt: 1000,
        uiState: { leftPanelWidth: 250, bottomPanelHeight: 150, focusMode: false },
      });
    });

    it("updates UI state", () => {
      repo.updateUiState("ws-1", {
        leftPanelWidth: 300,
        bottomPanelHeight: 200,
        focusMode: true,
        activeSessionId: "session-1",
      });

      expect(repo.findById("ws-1")?.uiState).toMatchObject({
        leftPanelWidth: 300,
        bottomPanelHeight: 200,
        focusMode: true,
        activeSessionId: "session-1",
      });
    });

    it("updates pane layout inside ui state", () => {
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

      expect(repo.findById("ws-1")?.uiState.paneLayout).toEqual({
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
      repo.updateUiState("ws-1", {
        leftPanelWidth: 250,
        bottomPanelHeight: 150,
        focusMode: false,
        fileTreeExpandedDirs: ["src", "src/components"],
      });

      expect(repo.findById("ws-1")?.uiState.fileTreeExpandedDirs).toEqual([
        "src",
        "src/components",
      ]);
    });

    it("updates last active timestamp", () => {
      repo.updateLastActive("ws-1", 2000);
      expect(repo.findById("ws-1")?.lastActiveAt).toBe(2000);
    });
  });

  describe("persistence", () => {
    it("reads workspace metadata directly from the file store", () => {
      const filePath = join(tempDir, "workspaces.json");
      const fileRepo = new WorkspaceRepo({ filePath });

      fileRepo.create({
        id: "ws-file",
        path: "/path/to/file-workspace",
        targetRuntime: "native",
        openedAt: 1000,
        lastActiveAt: 2000,
        uiState: { leftPanelWidth: 250, bottomPanelHeight: 150, focusMode: false },
      });

      const restored = new WorkspaceRepo({ filePath }).findById("ws-file");
      expect(restored).toMatchObject({
        id: "ws-file",
        path: "/path/to/file-workspace",
      });
    });

    it("does not import legacy-shaped file contents", () => {
      const fileRepo = new WorkspaceRepo({
        filePath: join(tempDir, "migrated-workspaces.json"),
      });

      expect(fileRepo.list()).toEqual([]);
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

      expect(repo.findById("ws-1")).toBeUndefined();
    });
  });
});
