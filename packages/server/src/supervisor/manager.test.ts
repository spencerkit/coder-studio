import type { ProviderDefinition } from "@coder-studio/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SupervisorManager } from "./manager.js";

type MockSupervisorManagerDeps = {
  eventBus: { on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn> };
  broadcaster: { broadcast: ReturnType<typeof vi.fn> };
  terminalMgr: { write: ReturnType<typeof vi.fn> };
  workspaceMgr: { get: ReturnType<typeof vi.fn> };
  sessionMgr: { get: ReturnType<typeof vi.fn> };
  providerRegistry: ProviderDefinition[];
  providerConfigRepo: { get: ReturnType<typeof vi.fn> };
  settingsRepo: { get: ReturnType<typeof vi.fn> };
  supervisorRepo: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    getBySessionId: ReturnType<typeof vi.fn>;
    listAll: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  cycleRepo: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    listRecentForSupervisor: ReturnType<typeof vi.fn>;
    pruneOldest: ReturnType<typeof vi.fn>;
  };
  cycleAttemptRepo: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    listForCycle: ReturnType<typeof vi.fn>;
    deleteForCycle: ReturnType<typeof vi.fn>;
  };
  targetStore: {
    createTargetFiles: ReturnType<typeof vi.fn>;
    resetTargetFiles: ReturnType<typeof vi.fn>;
    readTargetMeta: ReturnType<typeof vi.fn>;
    loadTargetMemory: ReturnType<typeof vi.fn>;
    saveTargetMeta: ReturnType<typeof vi.fn>;
    saveTargetMemory: ReturnType<typeof vi.fn>;
    appendTargetCycleRecord: ReturnType<typeof vi.fn>;
    markTargetSuperseded: ReturnType<typeof vi.fn>;
    readTargetCycleRecords: ReturnType<typeof vi.fn>;
  };
};

function createProvider(): ProviderDefinition {
  return {
    id: "claude",
    capability: "full",
    buildSupervisorEvalCommand: vi.fn(() => ({
      argv: [
        "node",
        "-e",
        `process.stdout.write(${JSON.stringify(
          JSON.stringify({
            status: "continue",
            reason: "Need more work",
            guidance: "continue with the work",
          })
        )})`,
      ],
      cwd: process.cwd(),
      env: {},
    })),
  } as unknown as ProviderDefinition;
}

describe("SupervisorManager", () => {
  let deps: MockSupervisorManagerDeps;

  beforeEach(() => {
    deps = {
      eventBus: { on: vi.fn(() => () => {}), emit: vi.fn() },
      broadcaster: { broadcast: vi.fn() },
      terminalMgr: { write: vi.fn() },
      workspaceMgr: { get: vi.fn(() => ({ id: "ws-1", path: "/workspace" })) },
      sessionMgr: {
        get: vi.fn(() => ({
          id: "sess-1",
          terminalId: "term-1",
          workspaceId: "ws-1",
          providerId: "claude",
          state: "running",
          capability: "full",
          startedAt: 1,
          lastActiveAt: 1,
        })),
      },
      providerRegistry: [createProvider()],
      providerConfigRepo: {
        get: vi.fn(() => ({
          model: "claude-sonnet-4-6",
          additionalArgs: [],
          envVars: {},
        })),
      },
      settingsRepo: {
        get: vi.fn(() => undefined),
      },
      supervisorRepo: {
        create: vi.fn((value) => ({ ...value, targetId: value.id, cycles: [] })),
        update: vi.fn((id, patch) => ({
          id,
          sessionId: "sess-1",
          workspaceId: "ws-1",
          targetId: id,
          state: patch.state ?? "idle",
          objective: patch.objective ?? "Persist supervisors",
          evaluatorProviderId: patch.evaluatorProviderId ?? "claude",
          cycles: [],
          createdAt: 1,
          updatedAt: patch.updatedAt ?? 1,
          lastEvaluatedTurnId: patch.lastEvaluatedTurnId,
        })),
        findById: vi.fn(() => undefined),
        getBySessionId: vi.fn(() => undefined),
        listAll: vi.fn(() => []),
        delete: vi.fn(),
      },
      cycleRepo: {
        create: vi.fn((cycle) => cycle),
        update: vi.fn((id, patch) => ({
          id,
          supervisorId: "sup-1",
          sessionId: "sess-1",
          status: patch.status ?? "completed",
          trigger: "manual",
          evidenceSource: "headless_snapshot",
          objective: "Persist supervisors",
          evaluatorProviderId: "claude",
          createdAt: 1,
          completedAt: patch.completedAt ?? 1,
        })),
        listRecentForSupervisor: vi.fn(() => []),
        pruneOldest: vi.fn(),
      },
      cycleAttemptRepo: {
        create: vi.fn((attempt) => attempt),
        update: vi.fn((id, patch) => ({
          id,
          cycleId: "cycle-1",
          attemptIndex: 0,
          status: patch.status ?? "completed",
          startedAt: 1,
        })),
        listForCycle: vi.fn(() => []),
        deleteForCycle: vi.fn(),
      },
      targetStore: {
        createTargetFiles: vi.fn(async () => {}),
        resetTargetFiles: vi.fn(async () => {}),
        readTargetMeta: vi.fn(async () => ({
          targetId: "tgt-1",
          sessionId: "sess-1",
          workspaceId: "ws-1",
          objective: "Persist supervisors",
          status: "active",
          createdAt: 1,
          updatedAt: 1,
          supersededBy: null,
          completedAt: null,
        })),
        loadTargetMemory: vi.fn(async () => ({
          targetId: "tgt-1",
          planGenerated: false,
          plan: [],
          stalledCount: 0,
          updatedAt: 1,
        })),
        saveTargetMeta: vi.fn(async () => {}),
        saveTargetMemory: vi.fn(async () => {}),
        appendTargetCycleRecord: vi.fn(async () => {}),
        markTargetSuperseded: vi.fn(async () => {}),
        readTargetCycleRecords: vi.fn(async () => []),
      },
    };
  });

  it("recovers persisted evaluating supervisors back to idle on hydrate", async () => {
    deps.supervisorRepo.listAll.mockReturnValue([
      {
        id: "sup-1",
        sessionId: "sess-1",
        workspaceId: "ws-1",
        state: "evaluating",
        objective: "Persist supervisors",
        evaluatorProviderId: "claude",
        cycles: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const manager = new SupervisorManager(
      deps as unknown as ConstructorParameters<typeof SupervisorManager>[0]
    );
    await manager.hydrate();

    expect(deps.supervisorRepo.update).toHaveBeenCalledWith(
      "sup-1",
      expect.objectContaining({ state: "idle", errorReason: null })
    );
  });

  it("drops workspace supervisors from memory during workspace teardown", async () => {
    deps.supervisorRepo.listAll.mockReturnValue([
      {
        id: "sup-1",
        sessionId: "sess-1",
        workspaceId: "ws-1",
        state: "idle",
        objective: "Persist supervisors",
        evaluatorProviderId: "claude",
        cycles: [],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "sup-2",
        sessionId: "sess-2",
        workspaceId: "ws-2",
        state: "idle",
        objective: "Leave this one alone",
        evaluatorProviderId: "claude",
        cycles: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const manager = new SupervisorManager(
      deps as unknown as ConstructorParameters<typeof SupervisorManager>[0]
    );
    await manager.hydrate();

    await manager.deleteForWorkspace("ws-1");

    expect(manager.get("sup-1")).toBeUndefined();
    expect(manager.get("sup-2")).toBeDefined();
    expect(deps.supervisorRepo.delete).toHaveBeenCalledWith("sup-1");
  });
});
