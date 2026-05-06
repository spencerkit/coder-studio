import type { DomainEvent, ProviderDefinition } from "@coder-studio/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { SessionManager } from "../session/manager.js";
import type { SessionDatabase } from "../session/types.js";
import type { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import type { TerminalManager } from "../terminal/manager.js";
import type { Broadcaster } from "../ws/hub.js";

const providerConfigRepoStub = {
  get: vi.fn(() => undefined),
} as unknown as ProviderConfigRepo;

type MutableSessionManager = SessionManager & {
  sessions: Map<string, { exitCode?: number }>;
};

const createProvider = (): ProviderDefinition =>
  ({
    id: "test-provider",
    displayName: "Test Provider",
    capability: "full",
    buildCommand: () => ({ argv: ["test"], cwd: "/test", env: {} }),
  }) as ProviderDefinition;

describe("SessionManager.stop", () => {
  let eventBus: EventBus;
  let sessionMgr: SessionManager;
  let mockDb: {
    insert: vi.Mock;
    update: vi.Mock;
    findById: vi.Mock;
    findByWorkspaceId: vi.Mock;
    listHydratable: vi.Mock;
    delete: vi.Mock;
  };
  let mockTerminalMgr: {
    create: vi.Mock;
    close: vi.Mock;
    get: vi.Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    eventBus = new EventBus();
    mockDb = {
      insert: vi.fn(),
      update: vi.fn(),
      findById: vi.fn(),
      findByWorkspaceId: vi.fn(),
      listHydratable: vi.fn().mockReturnValue([]),
      delete: vi.fn(),
    };
    mockTerminalMgr = {
      create: vi.fn().mockReturnValue({
        id: "terminal-1",
        workspaceId: "ws-1",
        kind: "agent",
      }),
      close: vi.fn(async (terminalId: string) => {
        eventBus.emit({
          type: "terminal.exited",
          workspaceId: "ws-1",
          terminalId,
          exitCode: 7,
        } satisfies DomainEvent);
      }),
      get: vi.fn(),
    };

    sessionMgr = new SessionManager({
      terminalMgr: mockTerminalMgr as unknown as TerminalManager,
      eventBus,
      db: mockDb as unknown as SessionDatabase,
      broadcaster: { broadcast: vi.fn() } as Broadcaster,
      providerRegistry: [],
      providerConfigRepo: providerConfigRepoStub,
    });
  });

  it("does not finish the same session twice when close emits terminal.exited before resolving", async () => {
    const provider = createProvider();
    const stateChanges: Array<{ from: string; to: string }> = [];
    eventBus.on(
      "session.state.changed",
      (event: Extract<DomainEvent, { type: "session.state.changed" }>) => {
        stateChanges.push({ from: event.from, to: event.to });
      }
    );

    const session = await sessionMgr.create({
      workspaceId: "ws-1",
      workspacePath: "/test/path",
      providerId: provider.id,
      provider,
    });

    mockDb.update.mockClear();
    stateChanges.length = 0;

    await sessionMgr.stop(session.id);

    expect(sessionMgr.get(session.id)?.state).toBe("ended");
    expect((sessionMgr as MutableSessionManager).sessions.get(session.id)?.exitCode).toBe(7);
    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(mockDb.update).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        state: "ended",
        endedAt: expect.any(Number),
      })
    );
    expect(stateChanges).toEqual([{ from: "starting", to: "ended" }]);
  });
});
