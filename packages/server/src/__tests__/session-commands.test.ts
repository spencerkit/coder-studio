import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderDefinition } from "@coder-studio/core";
import { providerRegistry } from "@coder-studio/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { SessionManager } from "../session/manager.js";
import type { SessionDatabase } from "../session/types.js";
import { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import { WorkspaceRepo } from "../storage/repositories/workspace-repo.js";
import type { TerminalManager } from "../terminal/manager.js";
import { WorkspaceManager } from "../workspace/manager.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";
import type { Broadcaster } from "../ws/hub.js";

// Import command handlers to register them
import "../commands/workspace.js";
import "../commands/session.js";

describe("Session Commands", () => {
  const broadcaster = { broadcast: () => {} } satisfies Broadcaster;
  const createProviderConfigRepo = (filePath: string) =>
    new ProviderConfigRepo({ filePath }) as Pick<ProviderConfigRepo, "get"> as ProviderConfigRepo;
  const terminalMgrStub = {
    create: () => ({ id: "terminal-1" }),
    kill: async () => {},
    close: async () => {},
  } as unknown as TerminalManager;
  const sessionDbStub = {
    insert: () => {},
    update: () => {},
    delete: () => {},
  } as unknown as SessionDatabase;

  let ctx: CommandContext;
  let eventBus: EventBus;
  let workspaceMgr: WorkspaceManager;
  let sessionMgr: SessionManager;
  let stateDir: string;
  let tempDirs: string[];

  beforeEach(() => {
    // Create event bus
    eventBus = new EventBus();
    stateDir = mkdtempSync(join(tmpdir(), "session-command-state-"));
    const providerConfigRepo = createProviderConfigRepo(join(stateDir, "provider-configs.json"));

    // Create managers
    workspaceMgr = new WorkspaceManager({
      workspaceRepo: new WorkspaceRepo({
        filePath: join(stateDir, "workspaces.json"),
      }),
      eventBus,
    });
    sessionMgr = new SessionManager({
      terminalMgr: terminalMgrStub,
      eventBus,
      db: sessionDbStub,
      broadcaster,
      providerRegistry: [],
      providerConfigRepo,
    });

    // Create context with required dependencies
    ctx = {
      workspaceMgr,
      sessionMgr,
      terminalMgr: {},
      eventBus,
      broadcaster,
      providerRegistry: [],
      fencingMgr: {},
      supervisorMgr: {},
      providerConfigRepo,
    } as unknown as CommandContext;
    tempDirs = [];
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("session.create", () => {
    it("should error if workspace not found", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "test-id-2",
          op: "session.create",
          args: {
            workspaceId: "non-existent-id",
            providerId: "claude-code",
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
    });

    it("returns provider_cli_missing before terminal spawn when the CLI is absent", async () => {
      const testDir = join(tmpdir(), `coder-studio-session-command-${Date.now()}`);
      mkdirSync(join(testDir, ".git"), { recursive: true });
      writeFileSync(join(testDir, ".git", "HEAD"), "ref: refs/heads/main\n");

      ctx.providerRegistry = providerRegistry as ProviderDefinition[];
      ctx.providerRuntimeDeps = {
        commandExists: async (command: string) => command !== "claude",
      };

      try {
        const openResult = await dispatch(
          {
            kind: "command",
            id: "workspace-id",
            op: "workspace.open",
            args: { path: testDir },
          },
          ctx
        );

        expect(openResult.ok).toBe(true);

        const result = await dispatch(
          {
            kind: "command",
            id: "session-id",
            op: "session.create",
            args: {
              workspaceId: openResult.data!.id,
              providerId: "claude",
            },
          },
          ctx
        );

        expect(result.ok).toBe(false);
        expect(result.error).toEqual({
          code: "provider_cli_missing",
          message: "Provider CLI is not installed",
          details: {
            providerId: "claude",
            missingCommands: ["claude"],
          },
        });
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("session.stop", () => {
    it("should error if session not found", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "test-id-5",
          op: "session.stop",
          args: {
            sessionId: "non-existent-id",
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
    });
  });

  describe("session.remove", () => {
    it("should error if session not found", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "test-id-6",
          op: "session.remove",
          args: {
            sessionId: "non-existent-id",
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
    });
  });

  describe("session.close", () => {
    it("removes the mobile pane from persisted workspace ui state", async () => {
      const workspacePath = mkdtempSync(join(tmpdir(), "coder-studio-close-mobile-"));
      tempDirs.push(workspacePath);
      const workspace = await workspaceMgr.open({ path: workspacePath });
      workspaceMgr.updateUiState(workspace.id, {
        ...workspace.uiState,
        paneLayout: {
          id: "root",
          type: "split",
          direction: "horizontal",
          children: [
            { id: "left", type: "leaf", sessionId: "sess-1" },
            { id: "right", type: "leaf", sessionId: "sess-2" },
          ],
        },
      });

      const deleteSpy = vi.spyOn(sessionMgr, "delete").mockImplementation(() => {});
      const getSpy = vi.spyOn(sessionMgr, "get").mockImplementation((sessionId: string) =>
        sessionId === "sess-1"
          ? ({
              id: "sess-1",
              workspaceId: workspace.id,
              terminalId: "term-1",
              providerId: "codex",
              capability: "full",
              state: "ended",
              startedAt: 1,
              lastActiveAt: 1,
              endedAt: 2,
            } as const)
          : undefined
      );

      const result = await dispatch(
        {
          kind: "command",
          id: "test-id-close-mobile",
          op: "session.close",
          args: {
            sessionId: "sess-1",
            paneDisposition: "remove",
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(deleteSpy).toHaveBeenCalledWith("sess-1");
      expect(getSpy).toHaveBeenCalled();
      expect(workspaceMgr.get(workspace.id)?.uiState.paneLayout).toEqual({
        id: "right",
        type: "leaf",
        sessionId: "sess-2",
      });
    });

    it("keeps the pane as a draft leaf for desktop disposition", async () => {
      const workspacePath = mkdtempSync(join(tmpdir(), "coder-studio-close-desktop-"));
      tempDirs.push(workspacePath);
      const workspace = await workspaceMgr.open({ path: workspacePath });
      workspaceMgr.updateUiState(workspace.id, {
        ...workspace.uiState,
        paneLayout: {
          id: "root",
          type: "split",
          direction: "horizontal",
          children: [
            { id: "left", type: "leaf", sessionId: "sess-1" },
            { id: "right", type: "leaf", sessionId: "sess-2" },
          ],
        },
      });

      vi.spyOn(sessionMgr, "delete").mockImplementation(() => {});
      vi.spyOn(sessionMgr, "get").mockImplementation((sessionId: string) =>
        sessionId === "sess-1"
          ? ({
              id: "sess-1",
              workspaceId: workspace.id,
              terminalId: "term-1",
              providerId: "codex",
              capability: "full",
              state: "ended",
              startedAt: 1,
              lastActiveAt: 1,
              endedAt: 2,
            } as const)
          : undefined
      );

      const result = await dispatch(
        {
          kind: "command",
          id: "test-id-close-desktop",
          op: "session.close",
          args: {
            sessionId: "sess-1",
            paneDisposition: "draft",
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(workspaceMgr.get(workspace.id)?.uiState.paneLayout).toEqual({
        id: "root",
        type: "split",
        direction: "horizontal",
        children: [
          { id: "left", type: "leaf" },
          { id: "right", type: "leaf", sessionId: "sess-2" },
        ],
      });
    });
  });

  describe("session.resume", () => {
    it("should return unknown_op because the command has been removed", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "test-id-8",
          op: "session.resume",
          args: {
            sessionId: "non-existent-id",
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("unknown_op");
    });
  });
});
