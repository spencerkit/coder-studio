import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type NewSession, type NewTerminal, SessionRepo, TerminalRepo } from "../storage/index.js";

describe("SessionRepo", () => {
  let repo: SessionRepo;
  let terminalRepo: TerminalRepo;
  let tempDir: string;
  let testTerminal: NewTerminal;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "session-repo-test-"));
    repo = new SessionRepo({ filePath: join(tempDir, "sessions.json") });
    terminalRepo = new TerminalRepo({ filePath: join(tempDir, "terminals.json") });

    testTerminal = {
      id: "t-1",
      workspaceId: "ws-1",
      kind: "agent",
      cwd: "/path/to/workspace",
      argv: ["node", "server.js"],
      cols: 80,
      rows: 24,
      createdAt: Date.now(),
    };
    terminalRepo.create(testTerminal);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("create", () => {
    it("should create a new session", () => {
      const newSession: NewSession = {
        id: "s-1",
        workspaceId: "ws-1",
        terminalId: "t-1",
        providerId: "claude-cli",
        state: "running",
        capability: "full",
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
      };

      const result = repo.create(newSession);

      expect(result.id).toBe(newSession.id);
      expect(result.workspaceId).toBe(newSession.workspaceId);
      expect(result.terminalId).toBe(newSession.terminalId);
      expect(result.providerId).toBe("claude-cli");
      expect(result.state).toBe("running");
      expect(result.capability).toBe("full");
    });

    it("should create a session with completion percent", () => {
      const result = repo.create({
        id: "s-2",
        workspaceId: "ws-1",
        terminalId: "t-1",
        providerId: "claude-cli",
        state: "running",
        capability: "full",
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
        completionPercent: 50,
      });

      expect(result.completionPercent).toBe(50);
    });
  });

  describe("queries", () => {
    beforeEach(() => {
      terminalRepo.create({
        id: "t-2",
        workspaceId: "ws-1",
        kind: "agent",
        cwd: "/path",
        argv: [],
        cols: 80,
        rows: 24,
        createdAt: Date.now(),
      });

      repo.create({
        id: "s-1",
        workspaceId: "ws-1",
        terminalId: "t-1",
        providerId: "claude-cli",
        state: "running",
        capability: "full",
        startedAt: 1000,
        lastActiveAt: 1000,
      });

      repo.create({
        id: "s-2",
        workspaceId: "ws-1",
        terminalId: "t-2",
        providerId: "claude-cli",
        state: "idle",
        capability: "limited",
        startedAt: 2000,
        lastActiveAt: 2000,
      });
    });

    it("lists all sessions for a workspace", () => {
      expect(repo.listByWorkspace("ws-1").map((session) => session.id)).toEqual(["s-2", "s-1"]);
    });

    it("returns empty array for workspace with no sessions", () => {
      expect(repo.listByWorkspace("missing")).toEqual([]);
    });

    it("finds by id", () => {
      expect(repo.findById("s-1")?.id).toBe("s-1");
      expect(repo.findById("missing")).toBeUndefined();
    });

    it("finds by terminal id", () => {
      expect(repo.findByTerminalId("t-1")?.id).toBe("s-1");
    });

    it("lists only active sessions", () => {
      repo.markEnded("s-2", 3000);
      expect(repo.listActiveByWorkspace("ws-1").map((session) => session.id)).toEqual(["s-1"]);
    });
  });

  describe("updates", () => {
    beforeEach(() => {
      repo.create({
        id: "s-1",
        workspaceId: "ws-1",
        terminalId: "t-1",
        providerId: "claude-cli",
        state: "starting",
        capability: "full",
        startedAt: 1000,
        lastActiveAt: 1000,
      });
    });

    it("updates session state", () => {
      repo.updateState("s-1", "running");
      expect(repo.findById("s-1")?.state).toBe("running");
    });

    it("updates last active timestamp", () => {
      repo.updateLastActive("s-1", 2000);
      expect(repo.findById("s-1")?.lastActiveAt).toBe(2000);
    });

    it("marks a session as ended", () => {
      repo.markEnded("s-1", 3000);
      expect(repo.findById("s-1")).toMatchObject({
        endedAt: 3000,
        state: "ended",
      });
    });

    it("updates completion percent", () => {
      repo.updateCompletionPercent("s-1", 75);
      expect(repo.findById("s-1")?.completionPercent).toBe(75);
    });

    it("sets error reason", () => {
      repo.setError("s-1", "API rate limit exceeded");
      expect(repo.findById("s-1")?.errorReason).toBe("API rate limit exceeded");
    });

    it("persists the full first submitted input when updated", () => {
      repo.update("s-1", {
        title: "hello wor…",
        firstSubmittedUserInput: "hello world this is a test",
      });

      expect(repo.findById("s-1")).toMatchObject({
        title: "hello wor…",
        firstSubmittedUserInput: "hello world this is a test",
      });
    });

    it("archives a session", () => {
      repo.archive("s-1");
      expect(repo.listHydratable()).toEqual([]);
    });
  });

  describe("persistence", () => {
    it("reads sessions directly from the file store", () => {
      repo.insert({
        id: "s-file",
        workspace_id: "ws-1",
        terminal_id: "t-1",
        provider_id: "claude-cli",
        capability: "full",
        state: "running",
        started_at: 1000,
        last_active_at: 1000,
        ended_at: null,
        completion_percent: null,
        error_reason: null,
        archived: 0,
        title: "resume me",
        first_submitted_user_input: "resume me with more context",
        draft: "draft text",
      });

      const restored = new SessionRepo({
        filePath: join(tempDir, "sessions.json"),
      }).findById("s-file");

      expect(restored).toMatchObject({
        id: "s-file",
        workspaceId: "ws-1",
        terminalId: "t-1",
        title: "resume me",
        firstSubmittedUserInput: "resume me with more context",
        draft: "draft text",
      });
    });

    it("lists hydratable sessions from file-backed state", () => {
      terminalRepo.create({
        id: "t-2",
        workspaceId: "ws-1",
        kind: "agent",
        cwd: "/path/to/workspace",
        argv: ["node", "second.js"],
        cols: 80,
        rows: 24,
        createdAt: 1001,
      });

      repo.insert({
        id: "s-running",
        workspace_id: "ws-1",
        terminal_id: "t-1",
        provider_id: "claude-cli",
        capability: "full",
        state: "running",
        started_at: 1000,
        last_active_at: 1000,
        ended_at: null,
        completion_percent: null,
        error_reason: null,
        archived: 0,
        title: null,
        draft: null,
      });

      repo.insert({
        id: "s-ended",
        workspace_id: "ws-1",
        terminal_id: "t-2",
        provider_id: "claude-cli",
        capability: "full",
        state: "ended",
        started_at: 1000,
        last_active_at: 1000,
        ended_at: 1001,
        completion_percent: null,
        error_reason: null,
        archived: 0,
        title: null,
        draft: null,
      });

      expect(repo.listHydratable().map((session) => session.id)).toEqual(["s-running"]);
    });
  });

  describe("delete", () => {
    it("should delete a session by ID", () => {
      repo.create({
        id: "s-1",
        workspaceId: "ws-1",
        terminalId: "t-1",
        providerId: "claude-cli",
        state: "running",
        capability: "full",
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
      });

      repo.delete("s-1");
      expect(repo.findById("s-1")).toBeUndefined();
    });
  });
});
