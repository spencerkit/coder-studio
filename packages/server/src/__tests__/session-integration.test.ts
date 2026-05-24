/**
 * Session Integration Tests
 *
 * Tests the complete workflow:
 * 1. Open workspace
 * 2. Create session with provider
 * 3. Verify terminal creation
 * 4. Test session state transitions
 * 5. Test terminal input/output
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DomainEvent, Session } from "@coder-studio/core";
import { providerRegistry } from "@coder-studio/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { ProviderInstallManager } from "../provider-runtime/install-manager.js";
import { SessionManager } from "../session/manager.js";
import type { SessionDatabase } from "../session/types.js";
import { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import { WorkspaceRepo } from "../storage/repositories/workspace-repo.js";
import { TerminalManager } from "../terminal/manager.js";
import type { Broadcaster, PtyHost, PtyProcess } from "../terminal/types.js";
import { WorkspaceManager } from "../workspace/manager.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";

// Import command handlers to register them
import "../commands/workspace.js";
import "../commands/session.js";
import "../commands/terminal.js";
import "../commands/provider.js";

type MutableSessionManager = SessionManager & {
  sessions: Map<string, Session & { state: string }>;
};

type MockSessionDatabase = SessionDatabase & {
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  findByWorkspaceId: ReturnType<typeof vi.fn>;
  listHydratable: ReturnType<typeof vi.fn>;
};

/**
 * Mock PtyHost for testing without spawning real processes
 */
function createMockPtyHost(spawnCalls: Array<{ argv: string[]; options: unknown }>): {
  ptyHost: PtyHost;
  triggerDataForProcessIndex: (processIndex: number, data: string) => void;
} {
  const terminals = new Map<
    string,
    {
      onDataCallbacks: Array<(data: string) => void>;
      onExitCallbacks: Array<(event: { exitCode: number }) => void>;
    }
  >();

  return {
    ptyHost: {
      spawn: (argv: string[], options) => {
        spawnCalls.push({ argv, options });
        const id = `mock-pty-${Date.now()}`;
        const state = {
          onDataCallbacks: [] as Array<(data: string) => void>,
          onExitCallbacks: [] as Array<(event: { exitCode: number }) => void>,
        };

        const pty: PtyProcess = {
          onData: (callback) => {
            const term = terminals.get(id);
            if (term) term.onDataCallbacks.push(callback);
          },
          onExit: (callback) => {
            const term = terminals.get(id);
            if (term) term.onExitCallbacks.push(callback);
          },
          write: vi.fn(),
          resize: vi.fn(),
          kill: vi.fn(async () => {
            const term = terminals.get(id);
            if (!term) {
              return;
            }
            for (const cb of term.onExitCallbacks) {
              cb({ exitCode: 0 });
            }
          }),
        };

        terminals.set(id, state);

        // Simulate startup output
        setTimeout(() => {
          const term = terminals.get(id);
          if (term) {
            for (const cb of term.onDataCallbacks) {
              cb("\x1b[32mMock Agent Started\x1b[0m\n");
            }
          }
        }, 50);

        return pty;
      },
    },
    triggerDataForProcessIndex: (processIndex: number, data: string) => {
      const id = Array.from(terminals.keys())[processIndex];
      const term = id ? terminals.get(id) : undefined;
      if (!term) {
        return;
      }

      for (const cb of term.onDataCallbacks) {
        cb(data);
      }
    },
  };
}

describe("Session Integration", () => {
  let ctx: CommandContext;
  let eventBus: EventBus;
  let workspaceMgr: WorkspaceManager;
  let sessionMgr: SessionManager;
  let terminalMgr: TerminalManager;
  let mockPtyHost: PtyHost;
  let triggerDataForProcessIndex: (processIndex: number, data: string) => void;
  let broadcastEvents: Array<{ topic: string; payload: unknown }>;
  let spawnCalls: Array<{ argv: string[]; options: unknown }>;
  let sessionDb: MockSessionDatabase;
  let testDir: string;
  let stateDir: string;
  let providerConfigRepo: ProviderConfigRepo;

  beforeEach(() => {
    // Create event bus
    eventBus = new EventBus();

    // Create mock PTY host
    spawnCalls = [];
    const mockPtyHostSetup = createMockPtyHost(spawnCalls);
    mockPtyHost = mockPtyHostSetup.ptyHost;
    triggerDataForProcessIndex = mockPtyHostSetup.triggerDataForProcessIndex;

    // Track broadcast events
    broadcastEvents = [];
    const mockBroadcaster: Broadcaster = {
      broadcast: (topic, payload) => {
        broadcastEvents.push({ topic, payload });
      },
    };

    // Create terminal manager with mock PTY
    terminalMgr = new TerminalManager({
      ptyHost: mockPtyHost,
      eventBus,
      db: {
        insert: () => {},
        markEnded: () => {},
      },
    });

    // Create workspace manager
    stateDir = mkdtempSync(join(tmpdir(), "session-integration-state-"));
    workspaceMgr = new WorkspaceManager({
      workspaceRepo: new WorkspaceRepo({
        filePath: join(stateDir, "workspaces.json"),
      }),
      eventBus,
    });

    // Create test directory with .git folder
    testDir = join(tmpdir(), `coder-studio-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, ".git"), { recursive: true });
    writeFileSync(join(testDir, ".git", "HEAD"), "ref: refs/heads/main\n");

    sessionDb = {
      insert: vi.fn(),
      update: vi.fn(),
      findById: vi.fn(),
      findByWorkspaceId: vi.fn().mockReturnValue([]),
      listHydratable: vi.fn().mockReturnValue([]),
      delete: vi.fn(),
    };

    // Create session manager
    providerConfigRepo = new ProviderConfigRepo({
      filePath: join(stateDir, "provider-configs.json"),
    });
    sessionMgr = new SessionManager({
      terminalMgr,
      eventBus,
      db: sessionDb,
      broadcaster: mockBroadcaster,
      providerRegistry,
      providerConfigRepo,
    });

    // Create context
    ctx = {
      workspaceMgr,
      sessionMgr,
      terminalMgr,
      eventBus,
      broadcaster: mockBroadcaster,
      providerRegistry,
      fencingMgr: {} as CommandContext["fencingMgr"],
      supervisorMgr: {} as CommandContext["supervisorMgr"],
      providerRuntimeDeps: {
        commandExists: async () => true,
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(stateDir, { recursive: true, force: true });
    // Clean up test directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("exposes provider.runtimeStatus and provider.install.get via dispatch", async () => {
    ctx.providerRuntimeDeps = {
      commandExists: async (command: string) => command === "winget",
    };
    ctx.providerInstallMgr = new ProviderInstallManager(providerRegistry, {
      platform: "win32",
      commandExists: async (command: string) => command === "winget",
      runCommand: async () => ({ stdout: "", stderr: "" }),
    });

    const status = await dispatch(
      {
        kind: "command",
        id: "provider-status",
        op: "provider.runtimeStatus",
        args: {},
      },
      ctx
    );

    expect(status.ok).toBe(true);
    expect(status.data).toHaveProperty("providers");

    const start = await dispatch(
      {
        kind: "command",
        id: "install-start",
        op: "provider.install.start",
        args: { providerId: "codex" },
      },
      ctx
    );

    expect(start.ok).toBe(true);
    expect(start.data?.providerId).toBe("codex");

    const get = await dispatch(
      {
        kind: "command",
        id: "install-get",
        op: "provider.install.get",
        args: { jobId: (start.data as { jobId: string }).jobId },
      },
      ctx
    );

    expect(get.ok).toBe(true);
    expect(get.data?.jobId).toBe((start.data as { jobId: string }).jobId);
  });

  describe("Complete workflow: workspace.open -> session.create", () => {
    it("should open workspace and create session successfully", async () => {
      // Step 1: Open workspace
      const openResult = await dispatch(
        {
          kind: "command",
          id: "test-1",
          op: "workspace.open",
          args: { path: testDir },
        },
        ctx
      );

      expect(openResult.ok).toBe(true);
      expect(openResult.data).toBeDefined();
      expect(openResult.data?.id).toBeDefined();
      expect(openResult.data?.path).toBe(testDir);

      const workspaceId = openResult.data!.id;

      // Step 2: List workspaces to verify
      const listResult = await dispatch(
        {
          kind: "command",
          id: "test-2",
          op: "workspace.list",
          args: {},
        },
        ctx
      );

      expect(listResult.ok).toBe(true);
      expect(listResult.data).toHaveLength(1);
      expect(listResult.data?.[0]?.id).toBe(workspaceId);

      // Step 3: Create session with claude provider
      const sessionResult = await dispatch(
        {
          kind: "command",
          id: "test-3",
          op: "session.create",
          args: {
            workspaceId,
            providerId: "claude",
          },
        },
        ctx
      );

      expect(sessionResult.ok).toBe(true);
      expect(sessionResult.data).toBeDefined();
      expect(sessionResult.data?.id).toBeDefined();
      expect(sessionResult.data?.workspaceId).toBe(workspaceId);
      expect(sessionResult.data?.providerId).toBe("claude");
      expect(sessionResult.data?.state).toBe("starting");

      // Verify terminal was created
      expect(sessionResult.data?.terminalId).toBeDefined();
      expect(sessionResult.data?.terminalId).not.toBe("");
    });

    it("should fail session.create if workspace does not exist", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "test-4",
          op: "session.create",
          args: {
            workspaceId: "non-existent-workspace",
            providerId: "claude",
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("workspace_not_found");
    });

    it("should fail session.create if provider does not exist", async () => {
      // First open workspace
      const openResult = await dispatch(
        {
          kind: "command",
          id: "test-5",
          op: "workspace.open",
          args: { path: testDir },
        },
        ctx
      );

      const workspaceId = openResult.data!.id;

      // Try to create session with invalid provider
      const result = await dispatch(
        {
          kind: "command",
          id: "test-6",
          op: "session.create",
          args: {
            workspaceId,
            providerId: "non-existent-provider",
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("unknown_provider");
    });

    it("should use saved provider config when creating a session", async () => {
      providerConfigRepo.set("claude", {
        additionalArgs: ["--verbose"],
      });

      const openResult = await dispatch(
        {
          kind: "command",
          id: "test-provider-config-open",
          op: "workspace.open",
          args: { path: testDir },
        },
        ctx
      );

      const workspaceId = openResult.data!.id;

      const sessionResult = await dispatch(
        {
          kind: "command",
          id: "test-provider-config-create",
          op: "session.create",
          args: {
            workspaceId,
            providerId: "claude",
          },
        },
        ctx
      );

      expect(sessionResult.ok).toBe(true);
      expect(spawnCalls.at(-1)?.argv).toContain("--verbose");
    });

    it("should ignore legacy provider cwd overrides when creating a codex session", async () => {
      providerConfigRepo.set("codex", {
        additionalArgs: ["--sandbox"],
        cwd: "/tmp/legacy-cwd",
      });

      const openResult = await dispatch(
        {
          kind: "command",
          id: "test-provider-config-codex-open",
          op: "workspace.open",
          args: { path: testDir },
        },
        ctx
      );

      const workspaceId = openResult.data!.id;

      const sessionResult = await dispatch(
        {
          kind: "command",
          id: "test-provider-config-codex-create",
          op: "session.create",
          args: {
            workspaceId,
            providerId: "codex",
          },
        },
        ctx
      );

      expect(sessionResult.ok).toBe(true);
      expect(spawnCalls.at(-1)?.argv).toContain("--sandbox");
      expect((spawnCalls.at(-1)?.options as { cwd?: string } | undefined)?.cwd).toBe(testDir);
    });

    it("passes the provider-built argv and session id env through to PTY spawn", async () => {
      providerConfigRepo.set("claude", {
        additionalArgs: ["--verbose"],
        envVars: {
          TASK3_PROVIDER_ENV: "task3-value",
        },
      });

      const openResult = await dispatch(
        {
          kind: "command",
          id: "test-provider-handoff-open",
          op: "workspace.open",
          args: { path: testDir },
        },
        ctx
      );

      expect(openResult.ok).toBe(true);
      const workspaceId = openResult.data!.id;

      const sessionResult = await dispatch(
        {
          kind: "command",
          id: "test-provider-handoff-create",
          op: "session.create",
          args: {
            workspaceId,
            providerId: "claude",
          },
        },
        ctx
      );

      expect(sessionResult.ok).toBe(true);

      const sessionId = sessionResult.data!.id;
      const claudeProvider = providerRegistry.find((provider) => provider.id === "claude");
      expect(claudeProvider).toBeDefined();

      const expectedCommand = claudeProvider!.buildCommand(
        {
          ...claudeProvider!.defaultConfig,
          additionalArgs: ["--verbose"],
          envVars: {
            TASK3_PROVIDER_ENV: "task3-value",
          },
        },
        {
          workspacePath: testDir,
          sessionId,
        }
      );

      const lastSpawn = spawnCalls.at(-1);
      expect(lastSpawn?.argv).toEqual(expectedCommand.argv);
      expect((lastSpawn?.options as { env?: Record<string, string> } | undefined)?.env).toEqual(
        expect.objectContaining({
          CODER_STUDIO_SESSION_ID: sessionId,
          TASK3_PROVIDER_ENV: "task3-value",
        })
      );
    });
  });

  describe("Session state transitions", () => {
    it("should emit state change events when session is created", async () => {
      // Track events via session.state.changed
      const stateChanges: Array<{ from: string; to: string }> = [];
      eventBus.on(
        "session.state.changed",
        (event: Extract<DomainEvent, { type: "session.state.changed" }>) => {
          stateChanges.push({ from: event.from, to: event.to });
        }
      );

      // Open workspace
      const openResult = await dispatch(
        {
          kind: "command",
          id: "test-7",
          op: "workspace.open",
          args: { path: testDir },
        },
        ctx
      );

      const workspaceId = openResult.data!.id;

      // Create session
      await dispatch(
        {
          kind: "command",
          id: "test-8",
          op: "session.create",
          args: {
            workspaceId,
            providerId: "claude",
          },
        },
        ctx
      );

      // Verify state change event was emitted
      expect(stateChanges.length).toBeGreaterThan(0);
      expect(stateChanges[0]).toEqual({ from: "draft", to: "starting" });
    });
  });

  describe("Terminal operations", () => {
    let workspaceId: string;
    let terminalId: string;

    beforeEach(async () => {
      // Setup: open workspace and create session
      const openResult = await dispatch(
        {
          kind: "command",
          id: "setup-1",
          op: "workspace.open",
          args: { path: testDir },
        },
        ctx
      );

      workspaceId = openResult.data!.id;

      const sessionResult = await dispatch(
        {
          kind: "command",
          id: "setup-2",
          op: "session.create",
          args: {
            workspaceId,
            providerId: "claude",
          },
        },
        ctx
      );

      terminalId = sessionResult.data!.terminalId;
    });

    it("should handle terminal.input command", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "test-9",
          op: "terminal.input",
          args: {
            terminalId,
            bytes: btoa("Hello Agent\n"),
            activity: "submit",
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
    });

    it("should handle terminal.resize command", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "test-10",
          op: "terminal.resize",
          args: {
            terminalId,
            cols: 120,
            rows: 40,
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
    });

    it("should fail terminal.input for non-existent terminal", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "test-11",
          op: "terminal.input",
          args: {
            terminalId: "non-existent-terminal",
            bytes: btoa("test\n"),
            activity: "submit",
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
    });
  });

  describe("Session stop and resume", () => {
    let workspaceId: string;
    let sessionId: string;

    beforeEach(async () => {
      // Setup
      const openResult = await dispatch(
        {
          kind: "command",
          id: "setup-3",
          op: "workspace.open",
          args: { path: testDir },
        },
        ctx
      );

      workspaceId = openResult.data!.id;

      const sessionResult = await dispatch(
        {
          kind: "command",
          id: "setup-4",
          op: "session.create",
          args: {
            workspaceId,
            providerId: "claude",
          },
        },
        ctx
      );

      sessionId = sessionResult.data!.id;
    });

    it("should stop session successfully", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "test-12",
          op: "session.stop",
          args: { sessionId },
        },
        ctx
      );

      expect(result.ok).toBe(true);

      // Verify session state changed to ended
      const session = sessionMgr.get(sessionId);
      expect(session?.state).toBe("ended");
    });

    it("should fail session.stop for non-existent session", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "test-13",
          op: "session.stop",
          args: { sessionId: "non-existent-session" },
        },
        ctx
      );

      expect(result.ok).toBe(false);
    });

    it("rejects session.resume because the command has been removed", async () => {
      const sessions = sessionMgr.getForWorkspace(workspaceId);
      const activeSession = sessions.find((s) => s.id === sessionId);
      expect(activeSession).toBeDefined();

      // Stop the session
      await dispatch(
        {
          kind: "command",
          id: "test-14",
          op: "session.stop",
          args: { sessionId },
        },
        ctx
      );

      // Resume the session
      const result = await dispatch(
        {
          kind: "command",
          id: "test-15",
          op: "session.resume",
          args: { sessionId },
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("unknown_op");
    });
  });

  describe("Idle state transitions", () => {
    let workspaceId: string;
    let sessionId: string;
    let terminalId: string;

    beforeEach(async () => {
      vi.useFakeTimers();
      const openResult = await dispatch(
        {
          kind: "command",
          id: "setup-idle-1",
          op: "workspace.open",
          args: { path: testDir },
        },
        ctx
      );

      workspaceId = openResult.data!.id;

      const sessionResult = await dispatch(
        {
          kind: "command",
          id: "setup-idle-2",
          op: "session.create",
          args: {
            workspaceId,
            providerId: "codex",
          },
        },
        ctx
      );

      sessionId = sessionResult.data!.id;
      terminalId = sessionResult.data!.terminalId;
    });

    it("moves a session to idle when PTY output goes quiet after startup", () => {
      vi.advanceTimersByTime(3050);

      const session = sessionMgr.get(sessionId);
      expect(session?.state).toBe("idle");
    });

    it("keeps Codex-style sessions in starting until PTY output settles", () => {
      expect(sessionMgr.get(sessionId)?.state).toBe("starting");

      vi.advanceTimersByTime(3050);

      expect(sessionMgr.get(sessionId)?.state).toBe("idle");
    });

    it("moves a session to idle when a submitted turn quiets down after output", async () => {
      vi.advanceTimersByTime(3050);

      const result = await dispatch(
        {
          kind: "command",
          id: "idle-test-cycle-submit",
          op: "terminal.input",
          args: {
            terminalId,
            bytes: btoa("next turn\n"),
            activity: "submit",
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      triggerDataForProcessIndex(0, "assistant working\n");
      vi.advanceTimersByTime(3000);
      const session = sessionMgr.get(sessionId);
      expect(session?.state).toBe("idle");
    });

    it("does not move an idle session back to running on typing input", async () => {
      const internalSession = (sessionMgr as MutableSessionManager).sessions.get(sessionId);
      expect(internalSession).toBeDefined();
      if (!internalSession) {
        throw new Error(`Expected session ${sessionId} to exist`);
      }
      internalSession.state = "idle";

      const result = await dispatch(
        {
          kind: "command",
          id: "idle-test-input",
          op: "terminal.input",
          args: {
            terminalId,
            bytes: btoa("next turn\n"),
            activity: "typing",
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(sessionMgr.get(sessionId)?.state).toBe("idle");
    });

    it("moves an idle session back to running when the user submits input", async () => {
      const internalSession = (sessionMgr as MutableSessionManager).sessions.get(sessionId);
      expect(internalSession).toBeDefined();
      if (!internalSession) {
        throw new Error(`Expected session ${sessionId} to exist`);
      }
      internalSession.state = "idle";

      const result = await dispatch(
        {
          kind: "command",
          id: "idle-test-submit",
          op: "terminal.input",
          args: {
            terminalId,
            bytes: btoa("next turn\n"),
            activity: "submit",
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(sessionMgr.get(sessionId)?.state).toBe("running");
    });

    it("ignores typing echo but restores running when real PTY output follows", async () => {
      vi.advanceTimersByTime(3050);
      expect(sessionMgr.get(sessionId)?.state).toBe("idle");

      const typingResult = await dispatch(
        {
          kind: "command",
          id: "idle-test-typing-echo",
          op: "terminal.input",
          args: {
            terminalId,
            bytes: btoa("g"),
            activity: "typing",
          },
        },
        ctx
      );

      expect(typingResult.ok).toBe(true);

      triggerDataForProcessIndex(0, "g");
      expect(sessionMgr.get(sessionId)?.state).toBe("idle");

      triggerDataForProcessIndex(0, "assistant working\n");
      expect(sessionMgr.get(sessionId)?.state).toBe("running");
    });

    it("restores running when a recovered PTY stream mixes typing echo with real output", async () => {
      vi.advanceTimersByTime(3050);
      expect(sessionMgr.get(sessionId)?.state).toBe("idle");

      const typingResult = await dispatch(
        {
          kind: "command",
          id: "idle-test-mixed-typing-output",
          op: "terminal.input",
          args: {
            terminalId,
            bytes: btoa("g"),
            activity: "typing",
          },
        },
        ctx
      );

      expect(typingResult.ok).toBe(true);

      triggerDataForProcessIndex(0, "gassistant working\n");
      expect(sessionMgr.get(sessionId)?.state).toBe("running");
    });
  });

  describe("Session hydration", () => {
    it("marks persisted stale sessions as ended when hydrating without a live terminal", async () => {
      sessionDb.listHydratable = vi.fn().mockReturnValue([
        {
          id: "sess-hydrate-1",
          workspaceId: "ws-1",
          terminalId: "term-stale",
          providerId: "claude",
          state: "running",
          capability: "full",
          startedAt: 100,
          lastActiveAt: 200,
          title: "resume me",
        },
      ]);

      await sessionMgr.hydrate();

      expect(sessionMgr.get("sess-hydrate-1")).toEqual(
        expect.objectContaining({
          id: "sess-hydrate-1",
          terminalId: "term-stale",
          state: "ended",
          title: "resume me",
        })
      );
      expect(sessionDb.update).toHaveBeenCalledWith("sess-hydrate-1", {
        state: "ended",
      });
    });

    it("preserves persisted error reason when hydrating a stale session", async () => {
      sessionDb.listHydratable = vi.fn().mockReturnValue([
        {
          id: "sess-hydrate-error",
          workspaceId: "ws-1",
          terminalId: "term-stale",
          providerId: "claude",
          state: "running",
          capability: "full",
          startedAt: 100,
          lastActiveAt: 200,
          errorReason: "Orphaned before restart",
        },
      ]);

      await sessionMgr.hydrate();

      expect(sessionMgr.get("sess-hydrate-error")).toEqual(
        expect.objectContaining({
          id: "sess-hydrate-error",
          state: "ended",
          errorReason: "Orphaned before restart",
        })
      );
    });

    it("marks persisted non-resumable sessions as ended when hydrating without a live terminal", async () => {
      sessionDb.listHydratable = vi.fn().mockReturnValue([
        {
          id: "sess-hydrate-2",
          workspaceId: "ws-1",
          terminalId: "term-dead",
          providerId: "codex",
          state: "idle",
          capability: "full",
          startedAt: 100,
          lastActiveAt: 200,
        },
      ]);

      await sessionMgr.hydrate();

      expect(sessionMgr.get("sess-hydrate-2")).toEqual(
        expect.objectContaining({
          id: "sess-hydrate-2",
          terminalId: "term-dead",
          state: "ended",
        })
      );
      expect(sessionDb.update).toHaveBeenCalledWith("sess-hydrate-2", {
        state: "ended",
      });
    });

    it("keeps hydrated ended sessions bound to their persisted terminal id", async () => {
      sessionDb.listHydratable = vi.fn().mockReturnValue([
        {
          id: "sess-hydrate-3",
          workspaceId: "ws-1",
          terminalId: "term-old",
          providerId: "claude",
          state: "running",
          capability: "full",
          startedAt: 100,
          lastActiveAt: 200,
        },
      ]);

      await sessionMgr.hydrate();
      expect(sessionMgr.get("sess-hydrate-3")).toEqual(
        expect.objectContaining({
          id: "sess-hydrate-3",
          terminalId: "term-old",
          state: "ended",
        })
      );
    });
  });

  describe("Multiple sessions", () => {
    it("should support creating multiple sessions in same workspace", async () => {
      // Open workspace
      const openResult = await dispatch(
        {
          kind: "command",
          id: "test-16",
          op: "workspace.open",
          args: { path: testDir },
        },
        ctx
      );

      const workspaceId = openResult.data!.id;

      // Create first session
      const session1Result = await dispatch(
        {
          kind: "command",
          id: "test-17",
          op: "session.create",
          args: {
            workspaceId,
            providerId: "claude",
          },
        },
        ctx
      );

      // Create second session
      const session2Result = await dispatch(
        {
          kind: "command",
          id: "test-18",
          op: "session.create",
          args: {
            workspaceId,
            providerId: "codex",
          },
        },
        ctx
      );

      expect(session1Result.ok).toBe(true);
      expect(session2Result.ok).toBe(true);

      // Verify both sessions have different IDs and terminal IDs
      expect(session1Result.data?.id).not.toBe(session2Result.data?.id);
      expect(session1Result.data?.terminalId).not.toBe(session2Result.data?.terminalId);
    }, 10000);
  });

  describe("Provider command construction", () => {
    it("should build correct command for claude provider", async () => {
      const claudeProvider = providerRegistry.find((p) => p.id === "claude");
      expect(claudeProvider).toBeDefined();

      const cmd = claudeProvider!.buildCommand(claudeProvider!.defaultConfig, {
        workspacePath: testDir,
        sessionId: "test-session-123",
      });

      expect(cmd.argv[0]).toBe("claude");
      expect(cmd.cwd).toBe(testDir);
      expect(cmd.env.CODER_STUDIO_SESSION_ID).toBe("test-session-123");
    });
  });
});
