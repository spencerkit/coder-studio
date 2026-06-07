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
  targetStore: {
    cloneTargetFiles: ReturnType<typeof vi.fn>;
    deleteTarget: ReturnType<typeof vi.fn>;
    listRecoverableTargets: ReturnType<typeof vi.fn>;
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
            mode: "evaluate",
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
    const supervisors = new Map<string, Record<string, unknown>>();
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
        create: vi.fn((value) => {
          const next = {
            ...value,
            targetId: value.id,
            recentTargetCycles: [],
          };
          supervisors.set(value.id, next);
          return next;
        }),
        update: vi.fn((id, patch) => {
          const current = supervisors.get(id);
          if (!current) {
            throw new Error(`Supervisor not found: ${id}`);
          }
          const next = {
            ...current,
            ...(patch.state !== undefined ? { state: patch.state } : {}),
            ...(patch.objective !== undefined ? { objective: patch.objective } : {}),
            ...(patch.evaluatorProviderId !== undefined
              ? { evaluatorProviderId: patch.evaluatorProviderId }
              : {}),
            ...(patch.evaluatorModel !== undefined
              ? { evaluatorModel: patch.evaluatorModel ?? undefined }
              : {}),
            ...(patch.maxSupervisionCount !== undefined
              ? { maxSupervisionCount: patch.maxSupervisionCount }
              : {}),
            ...(patch.completedSupervisionCount !== undefined
              ? { completedSupervisionCount: patch.completedSupervisionCount }
              : {}),
            ...(patch.scheduledAt !== undefined
              ? { scheduledAt: patch.scheduledAt ?? undefined }
              : {}),
            ...(patch.stopReason !== undefined
              ? { stopReason: patch.stopReason ?? undefined }
              : {}),
            ...(patch.lastCycleAt !== undefined
              ? { lastCycleAt: patch.lastCycleAt ?? undefined }
              : {}),
            ...(patch.lastEvaluatedTurnId !== undefined
              ? { lastEvaluatedTurnId: patch.lastEvaluatedTurnId ?? undefined }
              : {}),
            ...(patch.errorReason !== undefined
              ? { errorReason: patch.errorReason ?? undefined }
              : {}),
            ...(patch.updatedAt !== undefined ? { updatedAt: patch.updatedAt } : {}),
          };
          supervisors.set(id, next);
          return next;
        }),
        findById: vi.fn((id) => supervisors.get(id)),
        getBySessionId: vi.fn((sessionId) =>
          [...supervisors.values()].find((value) => value.sessionId === sessionId)
        ),
        listAll: vi.fn(() => [...supervisors.values()]),
        delete: vi.fn((id) => {
          supervisors.delete(id);
        }),
      },
      targetStore: {
        cloneTargetFiles: vi.fn(async () => 0),
        deleteTarget: vi.fn(async () => {}),
        listRecoverableTargets: vi.fn(async () => []),
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
          supervisor: undefined,
        })),
        loadTargetMemory: vi.fn(async () => ({
          targetId: "tgt-1",
          decompositionGenerated: true,
          decompositionMode: "stage",
          items: [
            {
              id: "stage-1",
              kind: "stage",
              title: "Verify the fix",
              objective: "Confirm the fix works",
              deliverable: "A passing focused verification run",
              acceptanceCriteria: ["Focused verification passes"],
              status: "in_progress",
            },
          ],
          activeItemId: "stage-1",
          progressSummary: "Verification in progress",
          lastGuidance: "continue with the work",
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

  it("starts runtime listeners without hydrating persisted supervisors", () => {
    const manager = new SupervisorManager(
      deps as unknown as ConstructorParameters<typeof SupervisorManager>[0]
    );

    manager.start();

    expect(deps.eventBus.on).toHaveBeenCalledWith("session.lifecycle", expect.any(Function));
  });

  it("hydrate only starts runtime listeners and does not auto-load supervisors", async () => {
    const manager = new SupervisorManager(
      deps as unknown as ConstructorParameters<typeof SupervisorManager>[0]
    );
    await manager.hydrate();

    expect(manager.get("sup-1")).toBeUndefined();
    expect(deps.eventBus.on).toHaveBeenCalledWith("session.lifecycle", expect.any(Function));
  });

  it("drops workspace supervisors from memory during workspace teardown", async () => {
    const manager = new SupervisorManager(
      deps as unknown as ConstructorParameters<typeof SupervisorManager>[0]
    );
    await manager.create({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Persist supervisors",
      evaluatorProviderId: "claude",
    });
    vi.mocked(deps.workspaceMgr.get).mockImplementation((workspaceId: string) =>
      workspaceId === "ws-1" ? { id: "ws-1", path: "/workspace" } : { id: "ws-2", path: "/ws-2" }
    );
    vi.mocked(deps.sessionMgr.get).mockImplementation((sessionId: string) => ({
      id: sessionId,
      terminalId: `term-${sessionId}`,
      workspaceId: sessionId === "sess-2" ? "ws-2" : "ws-1",
      providerId: "claude",
      state: "running",
      capability: "full",
      startedAt: 1,
      lastActiveAt: 1,
    }));
    await manager.create({
      sessionId: "sess-2",
      workspaceId: "ws-2",
      objective: "Leave this one alone",
      evaluatorProviderId: "claude",
    });

    await manager.deleteForWorkspace("ws-1");

    expect(manager.getBySession("sess-1")).toBeUndefined();
    expect(manager.getBySession("sess-2")).toBeDefined();
  });
});
