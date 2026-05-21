import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type NewTerminal, TerminalRepo } from "../storage/index.js";

describe("TerminalRepo", () => {
  let repo: TerminalRepo;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "terminal-repo-test-"));
    repo = new TerminalRepo({ filePath: join(tempDir, "terminals.json") });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("create", () => {
    it("should create a new terminal", () => {
      const newTerminal: NewTerminal = {
        id: "t-1",
        workspaceId: "ws-1",
        kind: "agent",
        cwd: "/path/to/workspace",
        argv: ["node", "server.js"],
        cols: 80,
        rows: 24,
        createdAt: Date.now(),
      };

      const result = repo.create(newTerminal);

      expect(result.id).toBe(newTerminal.id);
      expect(result.workspaceId).toBe(newTerminal.workspaceId);
      expect(result.kind).toBe("agent");
      expect(result.argv).toEqual(["node", "server.js"]);
      expect(result.alive).toBe(true);
    });

    it("should create a terminal with environment and title", () => {
      const result = repo.create({
        id: "t-2",
        workspaceId: "ws-1",
        kind: "shell",
        cwd: "/path/to/workspace",
        argv: ["/bin/bash"],
        env: { NODE_ENV: "development", PATH: "/usr/bin" },
        title: "My Terminal",
        cols: 120,
        rows: 30,
        createdAt: Date.now(),
      });

      expect(result.env).toEqual({ NODE_ENV: "development", PATH: "/usr/bin" });
      expect(result.title).toBe("My Terminal");
    });
  });

  describe("queries", () => {
    beforeEach(() => {
      repo.create({
        id: "t-1",
        workspaceId: "ws-1",
        kind: "agent",
        cwd: "/path",
        argv: [],
        cols: 80,
        rows: 24,
        createdAt: 1000,
      });
      repo.create({
        id: "t-2",
        workspaceId: "ws-1",
        kind: "shell",
        cwd: "/path",
        argv: [],
        cols: 80,
        rows: 24,
        createdAt: 2000,
      });
    });

    it("lists terminals by workspace ordered by createdAt desc", () => {
      expect(repo.listByWorkspace("ws-1").map((terminal) => terminal.id)).toEqual(["t-2", "t-1"]);
    });

    it("returns empty list for unknown workspace", () => {
      expect(repo.listByWorkspace("missing")).toEqual([]);
    });

    it("finds by id", () => {
      expect(repo.findById("t-1")?.id).toBe("t-1");
      expect(repo.findById("missing")).toBeUndefined();
    });

    it("lists only active terminals", () => {
      repo.markEnded("t-2", 3000, 0);
      expect(repo.listActiveByWorkspace("ws-1").map((terminal) => terminal.id)).toEqual(["t-1"]);
    });
  });

  describe("updates", () => {
    beforeEach(() => {
      repo.create({
        id: "t-1",
        workspaceId: "ws-1",
        kind: "agent",
        cwd: "/path",
        argv: [],
        cols: 80,
        rows: 24,
        createdAt: 1000,
        title: "Old Title",
      });
    });

    it("marks terminal ended", () => {
      repo.markEnded("t-1", 2000, 1);
      expect(repo.findById("t-1")).toMatchObject({
        alive: false,
        endedAt: 2000,
        exitCode: 1,
      });
    });

    it("updates dimensions", () => {
      repo.updateDimensions("t-1", 120, 30);
      expect(repo.findById("t-1")).toMatchObject({
        cols: 120,
        rows: 30,
      });
    });

    it("updates title", () => {
      repo.updateTitle("t-1", "New Title");
      expect(repo.findById("t-1")?.title).toBe("New Title");
    });
  });

  describe("persistence", () => {
    it("reads terminal metadata directly from the file store", () => {
      repo.insert({
        id: "t-file",
        workspaceId: "ws-1",
        kind: "shell",
        cwd: "/path/to/workspace",
        argv: ["/bin/bash"],
        cols: 120,
        rows: 30,
        alive: true,
        createdAt: 1000,
        title: "bash",
      });

      const restored = new TerminalRepo({
        filePath: join(tempDir, "terminals.json"),
      }).findById("t-file");

      expect(restored).toMatchObject({
        id: "t-file",
        workspaceId: "ws-1",
        kind: "shell",
        cwd: "/path/to/workspace",
      });
    });
  });

  describe("delete", () => {
    it("should delete a terminal by ID", () => {
      repo.create({
        id: "t-1",
        workspaceId: "ws-1",
        kind: "agent",
        cwd: "/path",
        argv: [],
        cols: 80,
        rows: 24,
        createdAt: Date.now(),
      });

      repo.delete("t-1");
      expect(repo.findById("t-1")).toBeUndefined();
    });
  });
});
