/**
 * Tests for SessionManager.delete method
 */

import type { ProviderDefinition, Session } from "@coder-studio/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventBus } from "../bus/event-bus.js";
import { SessionManager, type SessionManagerDeps } from "../session/manager.js";
import type { SessionDatabase } from "../session/types.js";
import type { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import type { TerminalManager } from "../terminal/manager.js";
import type { Broadcaster } from "../ws/hub.js";

type MutableSessionManager = SessionManager & {
  sessions: Map<string, Session & { state: string }>;
  detectors: Map<string, unknown>;
  comparators: Map<string, unknown>;
  detectorUnsubscribes: Map<string, unknown>;
};

const providerConfigRepoStub = {
  get: vi.fn(() => undefined),
} as unknown as ProviderConfigRepo;

const createProvider = (overrides?: Partial<ProviderDefinition>): ProviderDefinition =>
  ({
    id: "test-provider",
    displayName: "Test Provider",
    capability: "full",
    buildCommand: () => ({ argv: ["test"], cwd: "/test" }),
    ...overrides,
  }) as ProviderDefinition;

describe("SessionManager.delete", () => {
  let sessionMgr: SessionManager;
  let mockDb: {
    insert: vi.Mock;
    update: vi.Mock;
    findById: vi.Mock;
    findByWorkspaceId: vi.Mock;
    delete: vi.Mock;
  };
  let mockEventBus: {
    emit: vi.Mock;
    on: vi.Mock;
  };
  let mockTerminalMgr: {
    create: vi.Mock;
    kill: vi.Mock;
    close: vi.Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      insert: vi.fn(),
      update: vi.fn(),
      findById: vi.fn(),
      findByWorkspaceId: vi.fn(),
      delete: vi.fn(),
    };

    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(() => vi.fn()),
    };

    mockTerminalMgr = {
      create: vi.fn().mockReturnValue({
        id: "terminal-1",
        workspaceId: "ws-1",
        kind: "agent",
      }),
      kill: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const deps: SessionManagerDeps = {
      terminalMgr: mockTerminalMgr as unknown as TerminalManager,
      eventBus: mockEventBus as unknown as EventBus,
      db: mockDb as unknown as SessionDatabase,
      broadcaster: {} as Broadcaster,
      providerRegistry: [],
      providerConfigRepo: providerConfigRepoStub,
    };

    sessionMgr = new SessionManager(deps);
  });

  it("should delete ended session from memory and database", async () => {
    // Create a session first
    mockDb.insert.mockImplementation(() => {});
    mockDb.update.mockImplementation(() => {});

    const session = await sessionMgr.create({
      workspaceId: "ws-1",
      workspacePath: "/test/path",
      providerId: "test-provider",
      provider: createProvider(),
    });

    // Manually set state to ended
    // First get the internal session
    const internalSession = (sessionMgr as MutableSessionManager).sessions.get(session.id);
    internalSession.state = "ended";

    // Now delete
    sessionMgr.delete(session.id);

    expect(mockDb.delete).toHaveBeenCalledWith(session.id);
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.lifecycle",
        sessionId: session.id,
        event: "removed",
      })
    );

    // Verify session is removed from memory
    expect(sessionMgr.get(session.id)).toBeUndefined();
  });

  it("should throw error when deleting non-existent session", () => {
    expect(() => sessionMgr.delete("non-existent")).toThrow("Session not found: non-existent");
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it("should throw error when deleting an active session", async () => {
    mockDb.insert.mockImplementation(() => {});
    mockDb.update.mockImplementation(() => {});

    const session = await sessionMgr.create({
      workspaceId: "ws-1",
      workspacePath: "/test/path",
      providerId: "test-provider",
      provider: createProvider(),
    });

    expect(sessionMgr.get(session.id)?.state).toBe("starting");
    expect(() => sessionMgr.delete(session.id)).toThrow("Cannot delete session in state: starting");
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it("cleans up PTY detector subscriptions when deleting a terminal session", async () => {
    mockDb.insert.mockImplementation(() => {});
    mockDb.update.mockImplementation(() => {});

    const session = await sessionMgr.create({
      workspaceId: "ws-1",
      workspacePath: "/test/path",
      providerId: "codex",
      provider: createProvider({
        id: "codex",
        displayName: "Codex",
        defaultConfig: {},
        idleHeuristics: {
          idlePromptPatterns: [],
          idleDebounceMs: 3000,
        },
        buildCommand: () => ({ argv: ["codex"], cwd: "/test", env: {} }),
        hooks: {
          events: {
            sessionStart: false,
            completion: true,
            progress: false,
          },
        },
      }),
    });

    const internalSession = (sessionMgr as MutableSessionManager).sessions.get(session.id);
    internalSession.state = "ended";

    expect((sessionMgr as MutableSessionManager).detectors.get(session.id)).toBeDefined();
    expect((sessionMgr as MutableSessionManager).comparators.get(session.id)).toBeDefined();
    expect((sessionMgr as MutableSessionManager).detectorUnsubscribes.get(session.id)).toBeTypeOf(
      "function"
    );

    sessionMgr.delete(session.id);

    expect((sessionMgr as MutableSessionManager).detectors.has(session.id)).toBe(false);
    expect((sessionMgr as MutableSessionManager).comparators.has(session.id)).toBe(false);
    expect((sessionMgr as MutableSessionManager).detectorUnsubscribes.has(session.id)).toBe(false);
  });

  it("stops and removes all workspace sessions during workspace teardown", async () => {
    mockDb.insert.mockImplementation(() => {});
    mockDb.update.mockImplementation(() => {});

    const first = await sessionMgr.create({
      workspaceId: "ws-1",
      workspacePath: "/test/path",
      providerId: "test-provider",
      provider: createProvider(),
    });
    const second = await sessionMgr.create({
      workspaceId: "ws-1",
      workspacePath: "/test/path",
      providerId: "test-provider",
      provider: createProvider(),
    });
    const otherWorkspace = await sessionMgr.create({
      workspaceId: "ws-2",
      workspacePath: "/test/path-2",
      providerId: "test-provider",
      provider: createProvider(),
    });

    await sessionMgr.stopForWorkspace("ws-1");
    sessionMgr.deleteEndedForWorkspace("ws-1");

    expect(mockTerminalMgr.close).toHaveBeenCalledTimes(2);
    expect(mockTerminalMgr.close).toHaveBeenNthCalledWith(1, "terminal-1");
    expect(mockTerminalMgr.close).toHaveBeenNthCalledWith(2, "terminal-1");
    expect(sessionMgr.get(first.id)).toBeUndefined();
    expect(sessionMgr.get(second.id)).toBeUndefined();
    expect(sessionMgr.get(otherWorkspace.id)).toBeDefined();
  });

  it("awaits terminal close completion before stopForWorkspace resolves", async () => {
    mockDb.insert.mockImplementation(() => {});
    mockDb.update.mockImplementation(() => {});

    let resolveClose: (() => void) | undefined;
    mockTerminalMgr.close.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveClose = resolve;
        })
    );

    const session = await sessionMgr.create({
      workspaceId: "ws-1",
      workspacePath: "/test/path",
      providerId: "test-provider",
      provider: createProvider(),
    });

    const stopPromise = sessionMgr.stopForWorkspace("ws-1");
    let resolved = false;
    void stopPromise.then(() => {
      resolved = true;
    });

    await Promise.resolve();

    expect(mockTerminalMgr.close).toHaveBeenCalledWith("terminal-1");
    expect(resolved).toBe(false);

    resolveClose?.();
    await stopPromise;

    expect(resolved).toBe(true);
    expect(sessionMgr.get(session.id)?.state).toBe("ended");
  });
});
