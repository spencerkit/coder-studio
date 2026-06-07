import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderDefinition } from "@coder-studio/core";
import { providerRegistry } from "@coder-studio/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { buildCustomProviderDefinition } from "../provider-runtime/custom-provider.js";
import { SessionManager } from "../session/manager.js";
import type { SessionDatabase } from "../session/types.js";
import { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import { SessionMetadataRepo } from "../storage/repositories/session-metadata-repo.js";
import { SettingsRepo } from "../storage/repositories/settings-repo.js";
import { WorkspaceRepo } from "../storage/repositories/workspace-repo.js";
import type { TerminalManager } from "../terminal/manager.js";
import { WorkspaceManager } from "../workspace/manager.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";
import type { Broadcaster } from "../ws/hub.js";

import "../commands/workspace.js";
import "../commands/session.js";

describe("Session Commands", () => {
  const broadcaster = { broadcast: () => {} } satisfies Broadcaster;
  const createProviderConfigRepo = (filePath: string) =>
    new ProviderConfigRepo({ filePath }) as Pick<ProviderConfigRepo, "get"> as ProviderConfigRepo;

  let ctx: CommandContext;
  let eventBus: EventBus;
  let workspaceMgr: WorkspaceManager;
  let sessionMgr: SessionManager;
  let stateDir: string;
  let tempDirs: string[];
  let sessionMetadataRepo: SessionMetadataRepo;
  let workspaceRepo: WorkspaceRepo;
  let terminalMgrStub: TerminalManager;
  let sessionDbStub: SessionDatabase;

  beforeEach(() => {
    eventBus = new EventBus();
    stateDir = mkdtempSync(join(tmpdir(), "session-command-state-"));
    const providerConfigRepo = createProviderConfigRepo(join(stateDir, "provider-configs.json"));
    const settingsRepo = new SettingsRepo({
      filePath: join(stateDir, "settings.json"),
    });
    workspaceRepo = new WorkspaceRepo({
      filePath: join(stateDir, "workspaces.json"),
    });
    sessionMetadataRepo = new SessionMetadataRepo({
      workspaceRepo,
    });
    terminalMgrStub = {
      create: () => ({ id: "terminal-1" }),
      kill: async () => {},
      close: async () => {},
    } as unknown as TerminalManager;
    sessionDbStub = {
      insert: () => {},
      update: () => {},
      findById: () => undefined,
      findByWorkspaceId: () => [],
      listHydratable: () => [],
      delete: () => {},
    };

    workspaceMgr = new WorkspaceManager({
      workspaceRepo,
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

    ctx = {
      workspaceMgr,
      sessionMgr,
      terminalMgr: {} as never,
      eventBus,
      broadcaster,
      settingsRepo,
      providerRegistry: [],
      fencingMgr: {} as never,
      supervisorMgr: {} as never,
      providerConfigRepo,
      sessionMetadataRepo,
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

    it("publishes agent instructions before session.create starts the agent", async () => {
      const testDir = join(tmpdir(), `coder-studio-session-publish-${Date.now()}`);
      mkdirSync(join(testDir, ".git"), { recursive: true });
      writeFileSync(join(testDir, ".git", "HEAD"), "ref: refs/heads/main\n");

      const calls: string[] = [];
      ctx.providerRegistry = providerRegistry as ProviderDefinition[];
      ctx.providerRuntimeDeps = {
        commandExists: async (command: string) => command === "claude",
      };
      ctx.agentInstructionPublisher = {
        syncWorkspace: vi.fn(async () => {
          calls.push("publish");
        }),
        scheduleWorkspaceSync: vi.fn(),
        syncAllOpenWorkspaces: vi.fn(),
      } as never;

      const createSpy = vi.spyOn(sessionMgr, "create").mockImplementation(async () => {
        calls.push("create");
        return {
          id: "sess-1",
          workspaceId: "ws-1",
          providerId: "claude",
          terminalId: "term-1",
          capability: "full",
          state: "starting",
          startedAt: Date.now(),
          lastActiveAt: Date.now(),
        };
      });

      try {
        const openResult = await dispatch(
          {
            kind: "command",
            id: "workspace-publish-order",
            op: "workspace.open",
            args: { path: testDir },
          },
          ctx
        );

        expect(openResult.ok).toBe(true);
        calls.length = 0;

        const result = await dispatch(
          {
            kind: "command",
            id: "session-publish-order",
            op: "session.create",
            args: {
              workspaceId: openResult.data!.id,
              providerId: "claude",
            },
          },
          ctx
        );

        expect(result.ok).toBe(true);
        expect(calls).toEqual(["publish", "create"]);
      } finally {
        createSpy.mockRestore();
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("injects Coder Studio runtime context into agent terminal env", async () => {
      const testDir = join(tmpdir(), `coder-studio-session-env-${Date.now()}`);
      mkdirSync(join(testDir, ".git"), { recursive: true });
      writeFileSync(join(testDir, ".git", "HEAD"), "ref: refs/heads/main\n");

      const createdSpecs: Array<{ env?: Record<string, string> }> = [];
      terminalMgrStub = {
        create: (spec: { env?: Record<string, string> }) => {
          createdSpecs.push(spec);
          return { id: "terminal-env-1" };
        },
        kill: async () => {},
        close: async () => {},
      } as unknown as TerminalManager;
      sessionMgr = new SessionManager({
        terminalMgr: terminalMgrStub,
        eventBus,
        db: sessionDbStub,
        broadcaster,
        providerRegistry: [],
        providerConfigRepo: createProviderConfigRepo(join(stateDir, "provider-configs-env.json")),
        runtimeContext: {
          apiUrl: "http://127.0.0.1:4173",
        },
      });
      ctx.sessionMgr = sessionMgr;
      ctx.providerRegistry = providerRegistry as ProviderDefinition[];
      ctx.providerRuntimeDeps = {
        commandExists: async (command: string) => command === "claude",
      };

      try {
        const openResult = await dispatch(
          {
            kind: "command",
            id: "workspace-env",
            op: "workspace.open",
            args: { path: testDir },
          },
          ctx
        );

        expect(openResult.ok).toBe(true);

        const result = await dispatch(
          {
            kind: "command",
            id: "session-env",
            op: "session.create",
            args: {
              workspaceId: openResult.data!.id,
              providerId: "claude",
            },
          },
          ctx
        );

        expect(result.ok).toBe(true);
        expect(createdSpecs[0]?.env).toMatchObject({
          CODER_STUDIO: "1",
          CODER_STUDIO_WORKSPACE_ID: openResult.data!.id,
          CODER_STUDIO_SESSION_ID: expect.stringMatching(/^sess_/),
          CODER_STUDIO_PROVIDER_ID: "claude",
          CODER_STUDIO_API_URL: "http://127.0.0.1:4173",
        });
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("launches a custom provider through the existing session.create flow", async () => {
      const testDir = join(tmpdir(), `coder-studio-custom-provider-session-${Date.now()}`);
      mkdirSync(join(testDir, ".git"), { recursive: true });
      writeFileSync(join(testDir, ".git", "HEAD"), "ref: refs/heads/main\n");

      const customProvider = buildCustomProviderDefinition({
        id: "review-bot",
        displayName: "Review Bot",
        command: "review-bot",
        args: ["--stdio"],
        env: { REVIEW_MODE: "strict" },
        cwdMode: "workspace_root",
        sessionMode: "interactive",
        capabilities: [
          { key: "interactive_session", supported: true, label: "Interactive session" },
          { key: "review", supported: true, label: "Review" },
        ],
        startupPrompt: "Review before responding.",
        createdAt: 100,
        updatedAt: 100,
      });

      ctx.providerRegistry = [...providerRegistry, customProvider] as ProviderDefinition[];
      ctx.providerRuntimeDeps = {
        commandExists: async (command: string) => command === "review-bot",
      };

      try {
        const openResult = await dispatch(
          {
            kind: "command",
            id: "workspace-custom-provider",
            op: "workspace.open",
            args: { path: testDir },
          },
          ctx
        );

        expect(openResult.ok).toBe(true);

        const result = await dispatch(
          {
            kind: "command",
            id: "session-custom-provider",
            op: "session.create",
            args: {
              workspaceId: openResult.data!.id,
              providerId: "review-bot",
            },
          },
          ctx
        );

        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({
          providerId: "review-bot",
          capability: "full",
          state: "starting",
        });
        expect(sessionMetadataRepo.get(result.data!.id)).toMatchObject({
          sessionId: result.data!.id,
          workspaceId: openResult.data!.id,
          providerId: "review-bot",
          objective: undefined,
          baselineGitHead: undefined,
          verificationRuns: [],
        });
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it.each([
      { providerId: "gemini", command: "gemini", expectedCapability: "full" },
      { providerId: "cursor", command: "agent", expectedCapability: "full" },
      { providerId: "opencode", command: "opencode", expectedCapability: "limited" },
    ])("launches $providerId through the shared session.create flow", async ({
      providerId,
      command,
      expectedCapability,
    }) => {
      const testDir = join(tmpdir(), `coder-studio-${providerId}-session-${Date.now()}`);
      mkdirSync(join(testDir, ".git"), { recursive: true });
      writeFileSync(join(testDir, ".git", "HEAD"), "ref: refs/heads/main\n");

      ctx.providerRegistry = providerRegistry as ProviderDefinition[];
      ctx.providerRuntimeDeps = {
        commandExists: async (candidate: string) => candidate === command,
      };

      try {
        const openResult = await dispatch(
          {
            kind: "command",
            id: `workspace-${providerId}`,
            op: "workspace.open",
            args: { path: testDir },
          },
          ctx
        );

        expect(openResult.ok).toBe(true);

        const result = await dispatch(
          {
            kind: "command",
            id: `session-${providerId}`,
            op: "session.create",
            args: {
              workspaceId: openResult.data!.id,
              providerId,
            },
          },
          ctx
        );

        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({
          providerId,
          capability: expectedCapability,
          state: "starting",
        });
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("captures session objective and git baseline metadata when available", async () => {
      const testDir = join(tmpdir(), `coder-studio-session-metadata-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      mkdirSync(join(testDir, ".git"), { recursive: true });
      writeFileSync(join(testDir, ".git", "HEAD"), "0123456789abcdef0123456789abcdef01234567\n");

      ctx.providerRegistry = providerRegistry as ProviderDefinition[];
      ctx.providerRuntimeDeps = {
        commandExists: async (command: string) => command === "claude",
      };

      try {
        const openResult = await dispatch(
          {
            kind: "command",
            id: "workspace-metadata",
            op: "workspace.open",
            args: { path: testDir },
          },
          ctx
        );

        expect(openResult.ok).toBe(true);

        const result = await dispatch(
          {
            kind: "command",
            id: "session-metadata",
            op: "session.create",
            args: {
              workspaceId: openResult.data!.id,
              providerId: "claude",
              draft: "Fix the build and run focused verification",
            },
          },
          ctx
        );

        expect(result.ok).toBe(true);
        expect(sessionMetadataRepo.get(result.data!.id)).toMatchObject({
          sessionId: result.data!.id,
          workspaceId: openResult.data!.id,
          providerId: "claude",
          objective: "Fix the build and run focused verification",
          baselineGitHead: "0123456789abcdef0123456789abcdef01234567",
          baselineCapturedAt: expect.any(Number),
          verificationRuns: [],
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

    it("deletes session metadata when removing an ended session", async () => {
      const workspacePath = mkdtempSync(join(tmpdir(), "coder-studio-remove-metadata-"));
      tempDirs.push(workspacePath);
      const workspace = await workspaceMgr.open({ path: workspacePath });
      sessionMetadataRepo.upsert({
        sessionId: "sess-ended",
        workspaceId: workspace.id,
        providerId: "codex",
        verificationRuns: [],
      });

      const deleteSpy = vi.spyOn(sessionMgr, "delete").mockImplementation(() => {});
      vi.spyOn(sessionMgr, "get").mockImplementation((sessionId: string) =>
        sessionId === "sess-ended"
          ? ({
              id: "sess-ended",
              workspaceId: workspace.id,
              terminalId: "term-ended",
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
          id: "test-id-remove-metadata",
          op: "session.remove",
          args: {
            sessionId: "sess-ended",
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(deleteSpy).toHaveBeenCalledWith("sess-ended");
      expect(sessionMetadataRepo.get("sess-ended")).toBeUndefined();
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

    it("preserves non-session leaf kinds when removing a typed session pane", async () => {
      const workspacePath = mkdtempSync(join(tmpdir(), "coder-studio-close-typed-"));
      tempDirs.push(workspacePath);
      const workspace = await workspaceMgr.open({ path: workspacePath });
      workspaceMgr.updateUiState(workspace.id, {
        ...workspace.uiState,
        paneLayout: {
          id: "root",
          type: "split",
          direction: "horizontal",
          children: [
            { id: "left", type: "leaf", leafKind: "draft" },
            { id: "center", type: "leaf", leafKind: "session", sessionId: "sess-typed" },
            { id: "right", type: "leaf", leafKind: "editor" },
          ],
        },
      });

      const deleteSpy = vi.spyOn(sessionMgr, "delete").mockImplementation(() => {});
      vi.spyOn(sessionMgr, "get").mockImplementation((sessionId: string) =>
        sessionId === "sess-typed"
          ? ({
              id: "sess-typed",
              workspaceId: workspace.id,
              terminalId: "term-typed",
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
          id: "test-id-close-typed",
          op: "session.close",
          args: {
            sessionId: "sess-typed",
            paneDisposition: "remove",
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(deleteSpy).toHaveBeenCalledWith("sess-typed");
      expect(workspaceMgr.get(workspace.id)?.uiState.paneLayout).toEqual({
        id: "root",
        type: "split",
        direction: "horizontal",
        children: [
          { id: "left", type: "leaf", leafKind: "draft" },
          { id: "right", type: "leaf", leafKind: "editor" },
        ],
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

    it("deletes session metadata when closing an ended session", async () => {
      const workspacePath = mkdtempSync(join(tmpdir(), "coder-studio-close-metadata-"));
      tempDirs.push(workspacePath);
      const workspace = await workspaceMgr.open({ path: workspacePath });
      sessionMetadataRepo.upsert({
        sessionId: "sess-meta",
        workspaceId: workspace.id,
        providerId: "codex",
        verificationRuns: [],
      });

      const deleteSpy = vi.spyOn(sessionMgr, "delete").mockImplementation(() => {});
      vi.spyOn(sessionMgr, "get").mockImplementation((sessionId: string) =>
        sessionId === "sess-meta"
          ? ({
              id: "sess-meta",
              workspaceId: workspace.id,
              terminalId: "term-meta",
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
          id: "test-id-close-metadata",
          op: "session.close",
          args: {
            sessionId: "sess-meta",
            paneDisposition: "draft",
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(deleteSpy).toHaveBeenCalledWith("sess-meta");
      expect(sessionMetadataRepo.get("sess-meta")).toBeUndefined();
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
