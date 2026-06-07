import type {
  ProviderConfig,
  ProviderDefinition,
  Session,
  Supervisor,
  SupervisorCycle,
  SupervisorCycleTargetRecord,
  SupervisorTargetMemory,
} from "@coder-studio/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type {
  NewSupervisor,
  SupervisorUpdatePatch,
} from "../storage/repositories/supervisor-repo.js";
import type { SupervisorEvaluationContext } from "../supervisor/context-builder.js";
import { SupervisorContextBuilder } from "../supervisor/context-builder.js";
import { type SupervisorEvaluationResult, SupervisorEvaluator } from "../supervisor/evaluator.js";
import { SupervisorInjector } from "../supervisor/injector.js";
import { SupervisorManager, type SupervisorManagerDeps } from "../supervisor/manager.js";
import type { SupervisorTargetMeta } from "../supervisor/target-store.js";

type TestLogger = {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

type MutableSupervisorManager = SupervisorManager & {
  deps: SupervisorManagerDeps;
  logger: TestLogger;
  contextBuilder: SupervisorContextBuilder & { logger: TestLogger };
  evaluator: SupervisorEvaluator & { logger: TestLogger };
  injector: SupervisorInjector;
  runEvaluation: (
    supervisorId: string,
    trigger?: "turn_completed" | "scheduled"
  ) => Promise<SupervisorCycle | null>;
};

const PROVIDER_INSTALL = {
  prerequisites: [],
  manualGuideKeys: [],
  docUrls: {
    provider: "https://example.test/provider",
    prerequisites: {},
  },
  strategies: {},
};

function createProvider(
  overrides: Partial<ProviderDefinition> & Pick<ProviderDefinition, "id" | "capability">
): ProviderDefinition {
  return {
    id: overrides.id,
    displayName: overrides.id,
    badge: overrides.id,
    capability: overrides.capability,
    install: PROVIDER_INSTALL,
    buildCommand: () => ({
      argv: ["node", "-e", 'process.stdout.write("noop")'],
      cwd: process.cwd(),
      env: {},
    }),
    configSchema: z.record(z.string(), z.unknown()),
    defaultConfig: {},
    requiredCommands: [],
    ...overrides,
  };
}

function createSessionRecord(sessionId: string, overrides?: Partial<Session>): Session {
  return {
    id: sessionId,
    terminalId: `term-${sessionId}`,
    workspaceId: "ws-1",
    providerId: "claude",
    state: "running",
    capability: "full",
    startedAt: 1,
    lastActiveAt: 1,
    ...overrides,
  };
}

function applySupervisorPatch(current: Supervisor, patch: SupervisorUpdatePatch): Supervisor {
  return {
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
    ...(patch.scheduledAt !== undefined ? { scheduledAt: patch.scheduledAt ?? undefined } : {}),
    ...(patch.stopReason !== undefined ? { stopReason: patch.stopReason ?? undefined } : {}),
    ...(patch.lastCycleAt !== undefined ? { lastCycleAt: patch.lastCycleAt ?? undefined } : {}),
    ...(patch.lastEvaluatedTurnId !== undefined
      ? { lastEvaluatedTurnId: patch.lastEvaluatedTurnId ?? undefined }
      : {}),
    ...(patch.errorReason !== undefined ? { errorReason: patch.errorReason ?? undefined } : {}),
    ...(patch.updatedAt !== undefined ? { updatedAt: patch.updatedAt } : {}),
  };
}

function createManagerDeps() {
  const supervisors = new Map<string, Supervisor>();
  const targetMetaById = new Map<string, SupervisorTargetMeta>();
  const targetMemoryById = new Map<string, SupervisorTargetMemory>();
  const targetCyclesById = new Map<string, SupervisorCycleTargetRecord[]>();
  const logger: TestLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const defaultTargetMemory: SupervisorTargetMemory = {
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
    lastGuidance: "Run the focused parser test.",
    stalledCount: 0,
    updatedAt: 1,
  };

  const codexBuildSupervisorEvalCommand = vi.fn(() => ({
    argv: [
      "node",
      "-e",
      `process.stdout.write(${JSON.stringify(
        JSON.stringify({
          mode: "evaluate",
          status: "continue",
          reason: "Need more work",
          guidance: "Run the focused parser test.",
        })
      )})`,
    ],
    cwd: process.cwd(),
    env: {},
  }));
  const cloneMemory = (memory: SupervisorTargetMemory): SupervisorTargetMemory => ({
    ...memory,
    items: memory.items.map((item) => ({
      ...item,
      acceptanceCriteria: [...item.acceptanceCriteria],
    })),
  });
  const cloneCycleRecord = (record: SupervisorCycleTargetRecord): SupervisorCycleTargetRecord => ({
    ...record,
    itemUpdates: record.itemUpdates?.map((item) => ({ ...item })),
  });
  const cloneMeta = (meta: SupervisorTargetMeta): SupervisorTargetMeta => ({ ...meta });
  const persistedSupervisor = (supervisor: Supervisor): Supervisor => ({
    ...supervisor,
    currentTargetMemory: undefined,
    recentTargetCycles: [],
  });
  const buildTargetMeta = (input: {
    targetId: string;
    sessionId: string;
    workspaceId: string;
    objective: string;
    createdAt: number;
  }): SupervisorTargetMeta => ({
    targetId: input.targetId,
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    objective: input.objective,
    status: "active",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    supersededBy: null,
    completedAt: null,
  });
  const buildTargetMemory = (targetId: string, createdAt: number): SupervisorTargetMemory => ({
    targetId,
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
    lastGuidance: "Run the focused parser test.",
    stalledCount: 0,
    updatedAt: createdAt,
  });
  const getTargetCycles = (targetId: string, limit = 20): SupervisorCycleTargetRecord[] =>
    [...(targetCyclesById.get(targetId) ?? [])].slice(-limit).reverse().map(cloneCycleRecord);

  const providerConfigRepo = {
    get: vi.fn((providerId: string): ProviderConfig | undefined =>
      providerId === "codex" ? { additionalArgs: [], envVars: {} } : undefined
    ),
  };
  const settingsRepo = {
    get: vi.fn(() => undefined),
  };

  const supervisorRepo = {
    create: vi.fn((value: NewSupervisor) => {
      const supervisor: Supervisor = {
        ...value,
        targetId: value.id,
        maxSupervisionCount: value.maxSupervisionCount ?? 0,
        completedSupervisionCount: value.completedSupervisionCount ?? 0,
        currentTargetMemory: undefined,
        recentTargetCycles: [],
      };
      const next = persistedSupervisor(supervisor);
      supervisors.set(supervisor.id, next);
      return { ...next };
    }),
    update: vi.fn((id: string, patch: SupervisorUpdatePatch) => {
      const current = supervisors.get(id);
      if (!current) {
        throw new Error(`Supervisor not found: ${id}`);
      }
      const next = persistedSupervisor(applySupervisorPatch(current, patch));
      supervisors.set(id, next);
      return { ...next };
    }),
    findById: vi.fn((id: string) => {
      const supervisor = supervisors.get(id);
      return supervisor ? { ...supervisor } : undefined;
    }),
    getBySessionId: vi.fn((sessionId: string) => {
      const supervisor = [...supervisors.values()].find((value) => value.sessionId === sessionId);
      return supervisor ? { ...supervisor } : undefined;
    }),
    listAll: vi.fn(() => [...supervisors.values()].map((supervisor) => ({ ...supervisor }))),
    delete: vi.fn((id: string) => {
      supervisors.delete(id);
      targetMetaById.delete(id);
      targetMemoryById.delete(id);
      targetCyclesById.delete(id);
    }),
  };
  const targetStore = {
    createTargetFiles: vi.fn(async (_workspacePath: string, input) => {
      if (!targetMetaById.has(input.targetId)) {
        targetMetaById.set(input.targetId, buildTargetMeta(input));
      }
      if (!targetMemoryById.has(input.targetId)) {
        targetMemoryById.set(input.targetId, buildTargetMemory(input.targetId, input.createdAt));
      }
      if (!targetCyclesById.has(input.targetId)) {
        targetCyclesById.set(input.targetId, []);
      }
    }),
    cloneTargetFiles: vi.fn(async (_workspacePath: string, input) => {
      const sourceMemory = targetMemoryById.get(input.sourceTargetId);
      if (!sourceMemory) {
        throw Object.assign(new Error(`Target ${input.sourceTargetId} not found`), {
          code: "ENOENT",
        });
      }

      const sourceCycles = targetCyclesById.get(input.sourceTargetId) ?? [];
      targetMetaById.set(input.targetId, buildTargetMeta(input));
      targetMemoryById.set(input.targetId, {
        ...cloneMemory(sourceMemory),
        targetId: input.targetId,
      });
      targetCyclesById.set(
        input.targetId,
        sourceCycles.map((record) => ({
          ...cloneCycleRecord(record),
          targetId: input.targetId,
        }))
      );
      return sourceCycles.length;
    }),
    deleteTarget: vi.fn(async (_workspacePath: string, targetId: string) => {
      targetMetaById.delete(targetId);
      targetMemoryById.delete(targetId);
      targetCyclesById.delete(targetId);
    }),
    listRecoverableTargets: vi.fn(async () =>
      [...targetMetaById.values()]
        .map((meta) => ({
          targetId: meta.targetId,
          sessionId: meta.sessionId,
          workspaceId: meta.workspaceId,
          objective: meta.objective,
          status: meta.status,
          updatedAt: meta.updatedAt,
          progressSummary: targetMemoryById.get(meta.targetId)?.progressSummary,
          cycleCount: (targetCyclesById.get(meta.targetId) ?? []).length,
        }))
        .sort((left, right) => right.updatedAt - left.updatedAt)
    ),
    resetTargetFiles: vi.fn(async (_workspacePath: string, input) => {
      targetMetaById.set(input.targetId, buildTargetMeta(input));
      targetMemoryById.set(input.targetId, buildTargetMemory(input.targetId, input.createdAt));
      targetCyclesById.set(input.targetId, []);
    }),
    readTargetMeta: vi.fn(async (_workspacePath: string, targetId: string) => {
      const meta = targetMetaById.get(targetId);
      if (!meta) {
        throw Object.assign(new Error(`Target ${targetId} not found`), { code: "ENOENT" });
      }
      return cloneMeta(meta);
    }),
    loadTargetMemory: vi.fn(async (_workspacePath: string, targetId: string) => {
      const memory = targetMemoryById.get(targetId);
      if (!memory) {
        throw Object.assign(new Error(`Target ${targetId} not found`), { code: "ENOENT" });
      }
      return cloneMemory(memory);
    }),
    saveTargetMeta: vi.fn(async (_workspacePath: string, targetId: string, meta) => {
      targetMetaById.set(targetId, cloneMeta(meta));
    }),
    saveTargetMemory: vi.fn(async (_workspacePath: string, targetId: string, memory) => {
      targetMemoryById.set(targetId, cloneMemory(memory));
    }),
    appendTargetCycleRecord: vi.fn(async (_workspacePath: string, targetId: string, record) => {
      const cycles = targetCyclesById.get(targetId) ?? [];
      cycles.push(cloneCycleRecord(record));
      targetCyclesById.set(targetId, cycles);
    }),
    markTargetSuperseded: vi.fn(
      async (_workspacePath: string, targetId: string, nextTargetId: string, updatedAt: number) => {
        const current = targetMetaById.get(targetId);
        if (!current) {
          throw Object.assign(new Error(`Target ${targetId} not found`), { code: "ENOENT" });
        }
        targetMetaById.set(targetId, {
          ...current,
          status: "superseded",
          supersededBy: nextTargetId,
          updatedAt,
        });
      }
    ),
    readTargetCycleRecords: vi.fn(async (_workspacePath: string, targetId: string, limit = 20) =>
      getTargetCycles(targetId, limit)
    ),
  };

  return {
    eventBus: { on: vi.fn(() => () => {}), emit: vi.fn() },
    broadcaster: { broadcast: vi.fn() },
    terminalMgr: {
      write: vi.fn(),
      get: vi.fn(() => ({
        ringBuffer: { snapshot: () => Buffer.from("terminal fallback output") },
      })),
    },
    workspaceMgr: { get: vi.fn(() => ({ id: "ws-1", path: process.cwd() })) },
    sessionMgr: {
      get: vi.fn((sessionId: string) => createSessionRecord(sessionId)),
      getRenderedSnapshot: vi.fn(async () => "headless snapshot output"),
      getLatestSubmittedUserInput: vi.fn(() => "run the tests"),
      sendInput: vi.fn(),
    },
    git: {
      getStatusSummary: vi.fn(async () => ""),
      getDiffStatSummary: vi.fn(async () => ""),
    },
    providerRegistry: [
      createProvider({
        id: "claude",
        capability: "full",
      }),
      createProvider({
        id: "codex",
        capability: "full",
        buildSupervisorEvalCommand: codexBuildSupervisorEvalCommand,
      }),
    ],
    providerConfigRepo,
    settingsRepo,
    logger,
    supervisorRepo,
    targetStore,
    getTargetCycles,
    codexBuildSupervisorEvalCommand,
  };
}

describe("SupervisorManager cycle triggers", () => {
  let deps: ReturnType<typeof createManagerDeps>;
  let manager: SupervisorManager;

  const getManagerInternals = (): MutableSupervisorManager =>
    manager as unknown as MutableSupervisorManager;

  beforeEach(async () => {
    deps = createManagerDeps();
    manager = new SupervisorManager(deps as unknown as SupervisorManagerDeps);
    await manager.hydrate();
    vi.useRealTimers();
  });

  it("passes the provided logger to context builder and evaluator", () => {
    const managerInternals = getManagerInternals();

    expect(managerInternals.logger).toBe(deps.logger);
    expect(managerInternals.contextBuilder.logger).toBe(deps.logger);
    expect(managerInternals.evaluator.logger).toBe(deps.logger);
  });

  it("deletes the persisted supervisor when create target files fails", async () => {
    const createTargetFilesError = new Error("disk full");
    deps.targetStore.createTargetFiles.mockImplementationOnce(async () => {
      throw createTargetFilesError;
    });

    await expect(
      manager.create({
        sessionId: "sess-create-fails",
        workspaceId: "ws-1",
        objective: "Ship the fix",
        evaluatorProviderId: "codex",
      })
    ).rejects.toThrow("disk full");

    expect(deps.supervisorRepo.delete).toHaveBeenCalledWith(expect.any(String));
    expect(manager.getBySession("sess-create-fails")).toBeUndefined();
    expect(deps.supervisorRepo.getBySessionId("sess-create-fails")).toBeUndefined();
  });

  it("does not pass targetId into supervisor repo create", async () => {
    await manager.create({
      sessionId: "sess-create-shape",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
    });

    expect(deps.supervisorRepo.create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        targetId: expect.anything(),
      })
    );
  });

  it("restores a previous target into a newly created supervisor", async () => {
    deps.targetStore.listRecoverableTargets.mockResolvedValueOnce([
      {
        targetId: "tgt-restore",
        sessionId: "sess-old",
        workspaceId: "ws-1",
        objective: "Restore old work",
        status: "cancelled",
        updatedAt: 10,
        progressSummary: "Halfway there",
        cycleCount: 2,
      },
    ]);
    deps.targetStore.cloneTargetFiles.mockResolvedValueOnce(2);

    const restored = await (
      manager as unknown as SupervisorManager & {
        restore: (input: {
          sessionId: string;
          workspaceId: string;
          sourceTargetId: string;
          evaluatorProviderId: string;
          evaluatorModel?: string;
          maxSupervisionCount?: number;
          scheduledAt?: number;
        }) => Promise<Supervisor>;
      }
    ).restore({
      sessionId: "sess-restore",
      workspaceId: "ws-1",
      sourceTargetId: "tgt-restore",
      evaluatorProviderId: "codex",
      maxSupervisionCount: 5,
    });

    expect(deps.targetStore.cloneTargetFiles).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({
        sourceTargetId: "tgt-restore",
        sessionId: "sess-restore",
        workspaceId: "ws-1",
        targetId: restored.targetId,
        objective: "Restore old work",
      })
    );
    expect(deps.targetStore.deleteTarget).toHaveBeenCalledWith(process.cwd(), "tgt-restore");
    expect(restored.completedSupervisionCount).toBe(2);
  });

  it("restores a previous target into an existing supervisor for the same session", async () => {
    const existing = await manager.create({
      sessionId: "sess-existing-restore",
      workspaceId: "ws-1",
      objective: "Current objective",
      evaluatorProviderId: "codex",
      maxSupervisionCount: 1,
    });

    deps.targetStore.listRecoverableTargets.mockResolvedValueOnce([
      {
        targetId: "tgt-restore-existing",
        sessionId: "sess-old",
        workspaceId: "ws-1",
        objective: "Recovered objective",
        status: "cancelled",
        updatedAt: 10,
        progressSummary: "Recovered progress",
        cycleCount: 3,
      },
    ]);
    deps.targetStore.cloneTargetFiles.mockResolvedValueOnce(3);

    const restored = await (
      manager as unknown as SupervisorManager & {
        restore: (input: {
          sessionId: string;
          workspaceId: string;
          sourceTargetId: string;
          evaluatorProviderId: string;
          evaluatorModel?: string;
          maxSupervisionCount?: number;
          scheduledAt?: number;
        }) => Promise<Supervisor>;
      }
    ).restore({
      sessionId: "sess-existing-restore",
      workspaceId: "ws-1",
      sourceTargetId: "tgt-restore-existing",
      evaluatorProviderId: "codex",
      maxSupervisionCount: 8,
    });

    expect(restored.id).toBe(existing.id);
    expect(restored.targetId).toBe(existing.targetId);
    expect(restored.objective).toBe("Recovered objective");
    expect(restored.evaluatorProviderId).toBe("codex");
    expect(restored.maxSupervisionCount).toBe(8);
    expect(restored.completedSupervisionCount).toBe(3);
    expect(deps.targetStore.cloneTargetFiles).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({
        sourceTargetId: "tgt-restore-existing",
        targetId: existing.targetId,
        sessionId: "sess-existing-restore",
        workspaceId: "ws-1",
        objective: "Recovered objective",
      })
    );
    expect(deps.targetStore.deleteTarget).toHaveBeenCalledWith(
      process.cwd(),
      "tgt-restore-existing"
    );
    expect(deps.supervisorRepo.create).toHaveBeenCalledTimes(1);
  });

  it("rejects restore when the source target matches the existing supervisor target", async () => {
    const existing = await manager.create({
      sessionId: "sess-existing-self-restore",
      workspaceId: "ws-1",
      objective: "Current objective",
      evaluatorProviderId: "codex",
      maxSupervisionCount: 1,
    });

    deps.targetStore.listRecoverableTargets.mockResolvedValueOnce([
      {
        targetId: existing.targetId,
        sessionId: "sess-existing-self-restore",
        workspaceId: "ws-1",
        objective: "Current objective",
        status: "active",
        updatedAt: 10,
        progressSummary: "Current target should not restore into itself",
        cycleCount: 3,
      },
    ]);

    await expect(
      (
        manager as unknown as SupervisorManager & {
          restore: (input: {
            sessionId: string;
            workspaceId: string;
            sourceTargetId: string;
            evaluatorProviderId: string;
            evaluatorModel?: string;
            maxSupervisionCount?: number;
            scheduledAt?: number;
          }) => Promise<Supervisor>;
        }
      ).restore({
        sessionId: "sess-existing-self-restore",
        workspaceId: "ws-1",
        sourceTargetId: existing.targetId,
        evaluatorProviderId: "codex",
        maxSupervisionCount: 8,
      })
    ).rejects.toMatchObject({
      code: "supervisor_restore_same_target",
    });

    expect(deps.targetStore.cloneTargetFiles).not.toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({
        sourceTargetId: existing.targetId,
        targetId: existing.targetId,
      })
    );
    expect(deps.targetStore.deleteTarget).not.toHaveBeenCalledWith(
      process.cwd(),
      existing.targetId
    );
  });

  it("returns an in-flight cycle immediately on manual triggerEvaluation", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-manual",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
    });

    const cycle = await manager.triggerEvaluation(supervisor.id);

    expect(cycle.trigger).toBe("manual");
    expect(cycle.status).toBe("evaluating");

    await waitFor(() => {
      const current = manager.get(supervisor.id);
      const latest = current?.recentTargetCycles?.find((entry) => entry.cycleId === cycle.id);
      if (!latest || latest.status === "evaluating") {
        throw new Error("cycle still in flight");
      }
    });

    const finished = manager
      .get(supervisor.id)
      ?.recentTargetCycles?.find((entry) => entry.cycleId === cycle.id);
    expect(finished?.result).toBe("continue");
    expect(finished?.guidance).toBe("[Supervisor] Run the focused parser test.");
    expect(finished?.injected).toBe(true);
  });

  it("queues scheduler evaluations with turn_completed trigger", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-auto",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
    });

    await getManagerInternals().runEvaluation(supervisor.id);

    const updated = manager.get(supervisor.id);
    expect(updated?.recentTargetCycles).toHaveLength(1);
    expect(updated?.recentTargetCycles?.[0]?.result).toBe("continue");
    expect(updated?.recentTargetCycles?.[0]?.injected).toBe(true);
  });

  it("runs decompose before evaluate on the first cycle when target memory is empty", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-bootstrap",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
    });
    const managerInternals = getManagerInternals();

    deps.targetStore.loadTargetMemory.mockResolvedValueOnce({
      targetId: supervisor.targetId,
      decompositionGenerated: false,
      items: [],
      stalledCount: 0,
      updatedAt: 1,
    });

    const evaluateSpy = vi.spyOn(managerInternals.evaluator, "evaluate");
    evaluateSpy
      .mockResolvedValueOnce({
        mode: "decompose",
        decompositionMode: "stage",
        items: [
          {
            id: "stage-1",
            kind: "stage",
            title: "Inspect current behavior",
            objective: "Understand the current implementation",
            deliverable: "A verified behavior summary",
            acceptanceCriteria: ["Behavior summary is captured"],
            status: "in_progress",
          },
        ],
        activeItemId: "stage-1",
        progressSummary: "Decomposition complete",
      })
      .mockResolvedValueOnce({
        mode: "evaluate",
        status: "continue",
        reason: "Need more work",
        guidance: "Run the focused parser test.",
        activeItemId: "stage-1",
        itemUpdates: [{ id: "stage-1", status: "in_progress" }],
      });

    const finished = await managerInternals.runEvaluation(supervisor.id, "turn_completed");

    expect(finished?.status).toBe("injected");
    expect(evaluateSpy).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        targetMemory: expect.objectContaining({
          decompositionGenerated: false,
          items: [],
        }),
      }),
      expect.objectContaining({ mode: "decompose" })
    );
    expect(evaluateSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        targetMemory: expect.objectContaining({
          decompositionGenerated: true,
          decompositionMode: "stage",
          items: [
            expect.objectContaining({
              id: "stage-1",
              title: "Inspect current behavior",
            }),
          ],
        }),
      }),
      expect.objectContaining({ mode: "evaluate" })
    );
    expect(deps.targetStore.saveTargetMemory).toHaveBeenCalledWith(
      expect.any(String),
      supervisor.targetId,
      expect.objectContaining({
        decompositionGenerated: true,
        decompositionMode: "stage",
        items: [
          expect.objectContaining({
            id: "stage-1",
            title: "Inspect current behavior",
          }),
        ],
      })
    );
  });

  it("stops the supervisor when evaluator returns objective complete", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-stop",
      workspaceId: "ws-1",
      objective: "Finish the migration",
      evaluatorProviderId: "codex",
      maxSupervisionCount: 0,
    });

    vi.spyOn(getManagerInternals().evaluator, "evaluate").mockResolvedValueOnce({
      status: "stop",
      stopReason: "objective_complete",
      reason: "[objective complete]",
    });

    const finished = await getManagerInternals().runEvaluation(supervisor.id, "turn_completed");

    expect(finished?.status).toBe("completed");
    expect(finished?.result).toBe("[objective complete]");
    expect(manager.get(supervisor.id)?.state).toBe("stopped");
    expect(manager.get(supervisor.id)?.stopReason).toBe("objective_complete");
  });

  it("resets runtime stop state and counters when the objective changes", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-objective-reset",
      workspaceId: "ws-1",
      objective: "Finish the migration",
      evaluatorProviderId: "codex",
      maxSupervisionCount: 1,
    });

    vi.spyOn(getManagerInternals().evaluator, "evaluate").mockResolvedValueOnce({
      status: "stop",
      stopReason: "objective_complete",
      reason: "done",
    });

    await getManagerInternals().runEvaluation(supervisor.id, "turn_completed");

    const updated = await manager.update(supervisor.id, {
      objective: "Start the follow-up migration",
    });

    expect(updated.targetId).toBe(supervisor.targetId);
    expect(updated.state).toBe("idle");
    expect(updated.stopReason).toBeUndefined();
    expect(updated.completedSupervisionCount).toBe(0);
    expect(deps.targetStore.resetTargetFiles).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        targetId: supervisor.targetId,
        sessionId: supervisor.sessionId,
        workspaceId: supervisor.workspaceId,
        objective: "Start the follow-up migration",
      })
    );

    vi.spyOn(getManagerInternals().evaluator, "evaluate").mockResolvedValueOnce({
      status: "continue",
      reason: "keep going",
      guidance: "do the next step",
    });

    const nextCycle = await getManagerInternals().runEvaluation(updated.id, "turn_completed");
    expect(nextCycle?.status).toBe("injected");
  });

  it("cancels an in-flight cycle and resets the same target when the objective changes", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-objective-race",
      workspaceId: "ws-1",
      objective: "Initial objective",
      evaluatorProviderId: "codex",
    });

    let observedSignal: AbortSignal | undefined;
    vi.spyOn(getManagerInternals().evaluator, "evaluate").mockImplementationOnce(
      async (_supervisor, _context, options) =>
        await new Promise<SupervisorEvaluationResult>((_resolve, reject) => {
          observedSignal = options?.signal;
          options?.signal?.addEventListener(
            "abort",
            () => {
              reject({
                code: "supervisor_eval_aborted",
                message: "Supervisor evaluator aborted",
              });
            },
            { once: true }
          );
        })
    );

    const cycle = await manager.triggerEvaluation(supervisor.id);

    await waitFor(() => {
      expect(observedSignal).toBeDefined();
      expect(manager.get(supervisor.id)?.state).toBe("evaluating");
    });

    const updatedPromise = manager.update(supervisor.id, {
      objective: "New objective",
    });

    await waitFor(() => {
      expect(observedSignal?.aborted).toBe(true);
    });

    const updated = await updatedPromise;

    expect(updated.targetId).toBe(supervisor.targetId);
    expect(updated.objective).toBe("New objective");
    expect(manager.get(supervisor.id)?.state).toBe("idle");
    expect(manager.get(supervisor.id)?.completedSupervisionCount).toBe(0);
    expect(deps.targetStore.resetTargetFiles).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        targetId: supervisor.targetId,
        objective: "New objective",
      })
    );
    const finished = await waitForSupervisor(() =>
      manager.get(supervisor.id)?.state === "idle" ? manager.get(supervisor.id) : undefined
    );
    expect(finished?.recentTargetCycles).toHaveLength(0);
    expect(deps.sessionMgr.sendInput).not.toHaveBeenCalled();
  });

  it("marks the aborted attempt as cancelled when the objective changes", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-objective-attempt-cancelled",
      workspaceId: "ws-1",
      objective: "Initial objective",
      evaluatorProviderId: "codex",
    });

    let observedSignal: AbortSignal | undefined;
    vi.spyOn(getManagerInternals().evaluator, "evaluate").mockImplementationOnce(
      async (_supervisor, _context, options) =>
        await new Promise<SupervisorEvaluationResult>((_resolve, reject) => {
          observedSignal = options?.signal;
          options?.signal?.addEventListener(
            "abort",
            () => {
              reject({
                code: "supervisor_eval_aborted",
                message: "Supervisor evaluator aborted",
              });
            },
            { once: true }
          );
        })
    );

    const cycle = await manager.triggerEvaluation(supervisor.id);

    await waitFor(() => {
      expect(observedSignal).toBeDefined();
      expect(manager.get(supervisor.id)?.state).toBe("evaluating");
    });

    const updatedPromise = manager.update(supervisor.id, {
      objective: "New objective",
    });

    await waitFor(() => {
      expect(observedSignal?.aborted).toBe(true);
    });

    await updatedPromise;

    expect(manager.get(supervisor.id)?.recentTargetCycles).toHaveLength(0);
  });

  it("marks supervisor_uncertain stops as cancelled instead of completed target meta", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-uncertain-stop",
      workspaceId: "ws-1",
      objective: "Investigate the flaky state",
      evaluatorProviderId: "codex",
    });

    vi.spyOn(getManagerInternals().evaluator, "evaluate").mockResolvedValueOnce({
      status: "stop",
      stopReason: "supervisor_uncertain",
      reason: "I cannot determine the next step safely",
    });

    await getManagerInternals().runEvaluation(supervisor.id, "turn_completed");

    expect(deps.targetStore.saveTargetMeta).toHaveBeenCalledWith(
      expect.any(String),
      supervisor.targetId,
      expect.objectContaining({
        status: "cancelled",
      })
    );
    expect(deps.targetStore.saveTargetMeta).not.toHaveBeenCalledWith(
      expect.any(String),
      supervisor.targetId,
      expect.objectContaining({
        status: "completed",
      })
    );
  });

  it("keeps the supervisor idle after an in-flight evaluation fails during objective reset", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-objective-error-race",
      workspaceId: "ws-1",
      objective: "Initial objective",
      evaluatorProviderId: "codex",
    });

    let rejectEvaluation: ((error: unknown) => void) | null = null;
    vi.spyOn(getManagerInternals().evaluator, "evaluate").mockImplementationOnce(
      async () =>
        await new Promise<SupervisorEvaluationResult>((_resolve, reject) => {
          rejectEvaluation = reject;
        })
    );

    const cycle = await manager.triggerEvaluation(supervisor.id);

    await waitFor(() => {
      expect(rejectEvaluation).not.toBeNull();
      expect(manager.get(supervisor.id)?.state).toBe("evaluating");
    });

    const updatedPromise = manager.update(supervisor.id, {
      objective: "New objective",
    });

    queueMicrotask(() => {
      rejectEvaluation?.(new Error("old target eval failed"));
    });

    const updated = await updatedPromise;
    expect(manager.get(supervisor.id)?.recentTargetCycles).toHaveLength(0);
    expect(updated.targetId).toBe(supervisor.targetId);
    expect(updated.objective).toBe("New objective");
    expect(updated.state).toBe("idle");
    expect(updated.errorReason).toBeUndefined();
    expect(deps.targetStore.resetTargetFiles).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        targetId: supervisor.targetId,
        objective: "New objective",
      })
    );
  });

  it("resets target files in place instead of superseding them on objective change", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-objective-meta-reset",
      workspaceId: "ws-1",
      objective: "Initial objective",
      evaluatorProviderId: "codex",
    });

    const updated = await manager.update(supervisor.id, {
      objective: "New objective",
    });

    expect(updated.targetId).toBe(supervisor.targetId);
    expect(deps.targetStore.resetTargetFiles).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        targetId: supervisor.targetId,
        objective: "New objective",
      })
    );
    expect(deps.targetStore.markTargetSuperseded).not.toHaveBeenCalled();
  });

  it("keeps the current target unchanged when resetting target files fails", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-objective-create-fails",
      workspaceId: "ws-1",
      objective: "Initial objective",
      evaluatorProviderId: "codex",
    });

    const resetTargetFilesError = new Error("disk full");
    deps.targetStore.resetTargetFiles.mockImplementation(async () => {
      throw resetTargetFilesError;
    });

    await expect(
      manager.update(supervisor.id, {
        objective: "New objective",
      })
    ).rejects.toThrow("disk full");

    expect(manager.get(supervisor.id)?.targetId).toBe(supervisor.targetId);
    expect(manager.get(supervisor.id)?.objective).toBe("Initial objective");
    expect(deps.targetStore.resetTargetFiles).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        targetId: supervisor.targetId,
        objective: "New objective",
      })
    );
  });

  it("rolls back persisted supervisor changes when resetting target files fails", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-objective-rollback",
      workspaceId: "ws-1",
      objective: "Initial objective",
      evaluatorProviderId: "codex",
    });

    deps.targetStore.resetTargetFiles.mockImplementation(async () => {
      throw new Error("disk full");
    });

    await expect(
      manager.update(supervisor.id, {
        objective: "New objective",
      })
    ).rejects.toThrow("disk full");

    const updatesForSupervisor = deps.supervisorRepo.update.mock.calls.filter(
      ([id]: [string, SupervisorUpdatePatch]) => id === supervisor.id
    );

    expect(updatesForSupervisor).toHaveLength(1);
    expect(updatesForSupervisor[0]?.[1]).toEqual(
      expect.objectContaining({
        objective: "Initial objective",
      })
    );
    expect(deps.supervisorRepo.findById(supervisor.id)?.objective).toBe("Initial objective");
  });

  it("preserves a pause request while a target reset update is still persisting", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-objective-reset-pause-race",
      workspaceId: "ws-1",
      objective: "Initial objective",
      evaluatorProviderId: "codex",
    });

    let releaseReset: (() => void) | null = null;
    deps.targetStore.resetTargetFiles.mockImplementation(
      async () =>
        await new Promise<void>((resolve) => {
          releaseReset = resolve;
        })
    );

    const updatedPromise = manager.update(supervisor.id, {
      objective: "New objective",
    });

    await waitFor(() => {
      expect(deps.targetStore.resetTargetFiles).toHaveBeenCalledTimes(1);
      expect(releaseReset).not.toBeNull();
    });

    const paused = await manager.pause(supervisor.id);
    releaseReset?.();

    const updated = await updatedPromise;

    expect(paused.state).toBe("paused");
    expect(updated.state).toBe("idle");
    expect(updated.objective).toBe("New objective");
    expect(manager.get(supervisor.id)?.state).toBe("idle");
  });

  it("does not resurrect a supervisor deleted during target reset persistence", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-objective-reset-delete-race",
      workspaceId: "ws-1",
      objective: "Initial objective",
      evaluatorProviderId: "codex",
    });

    let releaseReset: (() => void) | null = null;
    deps.targetStore.resetTargetFiles.mockImplementation(
      async () =>
        await new Promise<void>((resolve) => {
          releaseReset = resolve;
        })
    );

    const updatedPromise = manager.update(supervisor.id, {
      objective: "New objective",
    });

    await waitFor(() => {
      expect(deps.targetStore.resetTargetFiles).toHaveBeenCalledTimes(1);
      expect(releaseReset).not.toBeNull();
    });

    await manager.delete(supervisor.id);
    releaseReset?.();

    await expect(updatedPromise).rejects.toThrow(/Supervisor not found/);
    expect(manager.get(supervisor.id)).toBeUndefined();
    expect(deps.supervisorRepo.findById(supervisor.id)).toBeUndefined();
  });

  it("preserves a pause request while an objective change abort is in flight", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-objective-pause-race",
      workspaceId: "ws-1",
      objective: "Initial objective",
      evaluatorProviderId: "codex",
    });

    let observedSignal: AbortSignal | undefined;
    vi.spyOn(getManagerInternals().evaluator, "evaluate").mockImplementationOnce(
      async (_supervisor, _context, options) =>
        await new Promise<SupervisorEvaluationResult>((_resolve, reject) => {
          observedSignal = options?.signal;
          options?.signal?.addEventListener(
            "abort",
            () => {
              reject({
                code: "supervisor_eval_aborted",
                message: "Supervisor evaluator aborted",
              });
            },
            { once: true }
          );
        })
    );

    await manager.triggerEvaluation(supervisor.id);

    await waitFor(() => {
      expect(observedSignal).toBeDefined();
      expect(manager.get(supervisor.id)?.state).toBe("evaluating");
    });

    const updatedPromise = manager.update(supervisor.id, {
      objective: "New objective",
    });
    const paused = await manager.pause(supervisor.id);

    await waitFor(() => {
      expect(observedSignal?.aborted).toBe(true);
    });

    const updated = await updatedPromise;

    expect(paused.state).toBe("paused");
    expect(updated.state).toBe("paused");
    expect(updated.objective).toBe("New objective");
    expect(manager.get(supervisor.id)?.state).toBe("paused");
  });

  it("retries evaluator timeout up to the global retry budget", async () => {
    vi.useFakeTimers();
    deps.settingsRepo.get = vi.fn((key: string) => {
      switch (key) {
        case "supervisor.retryEnabled":
          return true;
        case "supervisor.retryMaxCount":
          return 2;
        case "supervisor.retryDelaySec":
          return 1;
        case "supervisor.retryOnTimeout":
          return true;
        case "supervisor.retryOnEvaluatorError":
          return false;
        default:
          return undefined;
      }
    });

    const supervisor = await manager.create({
      sessionId: "sess-retry-timeout",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
    });

    vi.spyOn(getManagerInternals().evaluator, "evaluate")
      .mockRejectedValueOnce({ code: "supervisor_eval_timeout", message: "timed out" })
      .mockResolvedValueOnce({
        status: "continue",
        reason: "Run tests",
        guidance: "Run tests",
      });

    const pending = getManagerInternals().runEvaluation(supervisor.id, "turn_completed");
    await vi.advanceTimersByTimeAsync(1000);
    const finished = await pending;

    expect(finished?.status).toBe("injected");
    expect(manager.get(supervisor.id)?.recentTargetCycles?.[0]?.attemptCount).toBe(2);
  });

  it("retries evaluator process errors when retryOnEvaluatorError is enabled", async () => {
    deps.settingsRepo.get = vi.fn((key: string) => {
      switch (key) {
        case "supervisor.retryEnabled":
          return true;
        case "supervisor.retryMaxCount":
          return 1;
        case "supervisor.retryDelaySec":
          return 1;
        case "supervisor.retryOnTimeout":
          return false;
        case "supervisor.retryOnEvaluatorError":
          return true;
        default:
          return undefined;
      }
    });

    const supervisor = await manager.create({
      sessionId: "sess-retry-error",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
    });

    vi.spyOn(getManagerInternals().evaluator, "evaluate")
      .mockRejectedValueOnce({
        code: "supervisor_eval_failed",
        message: "spawn failed",
      })
      .mockResolvedValueOnce({
        status: "continue",
        reason: "Run tests",
        guidance: "Run tests",
      });

    const finished = await getManagerInternals().runEvaluation(supervisor.id, "turn_completed");

    expect(finished?.status).toBe("injected");
    expect(manager.get(supervisor.id)?.recentTargetCycles?.[0]?.attemptCount).toBe(2);
  });

  it("stops before starting an extra cycle when maxSupervisionCount is reached", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-max-count",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
      maxSupervisionCount: 1,
    });

    const first = await getManagerInternals().runEvaluation(supervisor.id, "turn_completed");
    expect(first?.status).toBe("injected");

    const second = await getManagerInternals().runEvaluation(supervisor.id, "turn_completed");
    expect(second).toBeNull();
    expect(manager.get(supervisor.id)?.state).toBe("stopped");
    expect(manager.get(supervisor.id)?.stopReason).toBe("max_supervision_count_reached");
  });

  it("does not consume maxSupervisionCount when an in-flight cycle is paused and cancelled", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-max-count-paused",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
      maxSupervisionCount: 1,
    });
    const managerInternals = getManagerInternals();

    const evaluate = vi.spyOn(managerInternals.evaluator, "evaluate").mockImplementation(
      async (
        _supervisor: Supervisor,
        _context: SupervisorEvaluationContext,
        options?: { signal?: AbortSignal }
      ) =>
        await new Promise<SupervisorEvaluationResult>((_resolve, reject) => {
          const signal = options?.signal;
          const abort = () =>
            reject({
              code: "supervisor_eval_aborted",
              message: "Supervisor evaluator aborted",
            });

          if (!signal) {
            reject(new Error("Missing abort signal"));
            return;
          }
          if (signal.aborted) {
            abort();
            return;
          }

          signal.addEventListener("abort", abort, { once: true });
        })
    );

    const cycle = await manager.triggerEvaluation(supervisor.id);
    await waitFor(() => {
      expect(evaluate).toHaveBeenCalledTimes(1);
    });

    await manager.pause(supervisor.id);
    await waitFor(() => {
      expect(manager.get(supervisor.id)?.state).toBe("paused");
    });
    await waitFor(() => {
      expect(
        (managerInternals as unknown as { inFlight: Set<string> }).inFlight.has(supervisor.id)
      ).toBe(false);
    });

    expect(manager.get(supervisor.id)?.completedSupervisionCount).toBe(0);

    await manager.resume(supervisor.id);
    evaluate.mockResolvedValueOnce({
      status: "continue",
      reason: "Run tests",
      guidance: "Run tests",
    });

    const finished = await managerInternals.runEvaluation(supervisor.id, "turn_completed");

    expect(finished?.status).toBe("injected");
    expect(manager.get(supervisor.id)?.completedSupervisionCount).toBe(1);
    expect(manager.get(supervisor.id)?.stopReason).toBeUndefined();
  });

  it("creates scheduled cycles and consumes scheduledAt once the cycle starts", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-scheduled",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
      scheduledAt: Date.now() - 1_000,
    });

    const finished = await getManagerInternals().runEvaluation(supervisor.id, "scheduled");

    expect(finished?.trigger).toBe("scheduled");
    expect(manager.get(supervisor.id)?.scheduledAt).toBeUndefined();
  });

  it("consumes an overdue scheduledAt when turn_completed runs first", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-overdue-turn-completed",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
      scheduledAt: Date.now() - 1_000,
    });

    const managerInternals = getManagerInternals();
    const evaluate = vi.spyOn(managerInternals.evaluator, "evaluate");

    const first = await managerInternals.runEvaluation(supervisor.id, "turn_completed");
    const second = await managerInternals.runEvaluation(supervisor.id, "scheduled");

    expect(first?.trigger).toBe("turn_completed");
    expect(second).toBeNull();
    expect(manager.get(supervisor.id)?.scheduledAt).toBeUndefined();
    expect(manager.get(supervisor.id)?.recentTargetCycles).toHaveLength(1);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("retries a due scheduled run until the session becomes runnable", async () => {
    vi.useFakeTimers();
    let sessionState: Session["state"] = "starting";
    vi.mocked(deps.sessionMgr.get).mockImplementation((sessionId: string) =>
      createSessionRecord(sessionId, { state: sessionState })
    );
    vi.spyOn(getManagerInternals().evaluator, "evaluate").mockResolvedValueOnce({
      status: "continue",
      reason: "Run tests",
      guidance: "Run tests",
    });

    const supervisor = await manager.create({
      sessionId: "sess-scheduled-retry",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
      scheduledAt: Date.now() + 1_000,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(manager.get(supervisor.id)?.recentTargetCycles).toHaveLength(0);

    sessionState = "running";
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.get(supervisor.id)?.recentTargetCycles?.[0]?.result).toBe("continue");
    expect(manager.get(supervisor.id)?.recentTargetCycles?.[0]?.injected).toBe(true);

    expect(manager.get(supervisor.id)?.scheduledAt).toBeUndefined();
  });

  it("injects repeated guidance instead of suppressing it", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-dedupe",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
    });
    const managerInternals = getManagerInternals();

    vi.spyOn(managerInternals.evaluator, "evaluate").mockResolvedValueOnce({
      status: "continue",
      reason: "Run the focused parser test.",
      guidance: "Run the focused parser test.",
    });
    vi.spyOn(managerInternals.injector, "inject").mockResolvedValueOnce({
      injected: true,
      text: "[Supervisor] Run the focused parser test.",
    });

    const finished = await managerInternals.runEvaluation(supervisor.id);

    expect(finished?.status).toBe("injected");
    expect(finished?.result).toBe("[Supervisor] Run the focused parser test.");
    expect(finished?.injectedGuidance).toBe("[Supervisor] Run the focused parser test.");
  });

  it("rejects manual triggerEvaluation when the session is still starting", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-starting",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
    });

    vi.mocked(deps.sessionMgr.get).mockImplementation((sessionId: string) =>
      createSessionRecord(sessionId, { state: "starting" })
    );

    await expect(manager.triggerEvaluation(supervisor.id)).rejects.toMatchObject({
      code: "supervisor_session_not_ready",
      message: expect.stringContaining("starting up"),
    });

    expect(manager.get(supervisor.id)?.recentTargetCycles).toHaveLength(0);
    expect(deps.codexBuildSupervisorEvalCommand).not.toHaveBeenCalled();
  });

  it("does not try to recover orphaned cycle runtime state during hydrate", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-orphan",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
    });

    await deps.targetStore.appendTargetCycleRecord(process.cwd(), supervisor.targetId, {
      cycleId: "legacy-queued",
      targetId: supervisor.targetId,
      startedAt: Date.now(),
      completedAt: Date.now(),
      result: "error",
      errorReason: "legacy queued cycle",
      attemptCount: 1,
    });

    await manager.hydrate();

    expect(manager.get(supervisor.id)).toBeUndefined();
  });

  it("rejects supervisor creation when the session provider capability is limited", async () => {
    vi.mocked(deps.sessionMgr.get).mockImplementation((sessionId: string) =>
      createSessionRecord(sessionId, {
        capability: "limited",
      })
    );
    deps.providerRegistry[0] = {
      ...deps.providerRegistry[0],
      capability: "limited",
    };

    await expect(
      manager.create({
        sessionId: "sess-limited-label",
        workspaceId: "ws-1",
        objective: "Ship the fix",
        evaluatorProviderId: "codex",
      })
    ).rejects.toMatchObject({
      code: "supervisor_unsupported_provider",
      message: "Provider claude does not support supervisor-driven sessions",
    });
  });

  it("logs evaluation failures with the original error and keeps the persisted reason concise", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-eval-error",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
    });
    const managerInternals = getManagerInternals();

    const evaluationError = new Error("Evaluator exploded");
    vi.spyOn(managerInternals.evaluator, "evaluate").mockRejectedValueOnce(evaluationError);

    await expect(managerInternals.runEvaluation(supervisor.id)).rejects.toThrow(
      "Evaluator exploded"
    );

    const updated = manager.get(supervisor.id);
    expect(updated?.state).toBe("error");
    expect(updated?.errorReason).toBe("Evaluator exploded");
    expect(deps.targetStore.readTargetCycleRecords).toHaveBeenCalledWith(
      expect.any(String),
      supervisor.targetId,
      20
    );
    expect(
      await deps.targetStore.readTargetCycleRecords(process.cwd(), supervisor.targetId)
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          result: "error",
          errorReason: "Evaluator exploded",
        }),
      ])
    );
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: evaluationError,
        supervisorId: supervisor.id,
        cycleId: expect.any(String),
      }),
      "Supervisor evaluation failed"
    );
  });

  it("logs pre-cycle failures with the original error and leaves the persisted reason concise", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-context-error",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
    });
    const managerInternals = getManagerInternals();

    const contextError = new Error("Context build exploded");
    vi.spyOn(managerInternals.contextBuilder, "build").mockRejectedValueOnce(contextError);

    await expect(managerInternals.runEvaluation(supervisor.id)).rejects.toThrow(
      "Context build exploded"
    );

    const updated = manager.get(supervisor.id);
    expect(updated?.state).toBe("error");
    expect(updated?.errorReason).toBe("Context build exploded");
    expect(updated?.recentTargetCycles).toHaveLength(0);
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: contextError,
        supervisorId: supervisor.id,
      }),
      "Supervisor evaluation failed before cycle creation"
    );
  });

  it("aborts in-flight evaluation during workspace teardown without persisting an error state", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-close",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
    });
    const managerInternals = getManagerInternals();

    const evaluate = vi.spyOn(managerInternals.evaluator, "evaluate").mockImplementation(
      async (
        _supervisor: Supervisor,
        _context: SupervisorEvaluationContext,
        options?: { signal?: AbortSignal }
      ) =>
        await new Promise<SupervisorEvaluationResult>((_resolve, reject) => {
          const signal = options?.signal;
          const abort = () =>
            reject({
              code: "supervisor_eval_aborted",
              message: "Supervisor evaluator aborted",
            });

          if (!signal) {
            reject(new Error("Missing abort signal"));
            return;
          }
          if (signal.aborted) {
            abort();
            return;
          }

          signal.addEventListener("abort", abort, { once: true });
        })
    );

    const runEvaluation = managerInternals.runEvaluation(supervisor.id);

    await waitFor(() => {
      expect(evaluate).toHaveBeenCalledTimes(1);
    });

    const deleteWorkspace = manager.deleteForWorkspace("ws-1");

    await expect(runEvaluation).resolves.toMatchObject({
      supervisorId: supervisor.id,
      status: "failed",
      errorReason: "Supervisor evaluator aborted",
    });
    await expect(deleteWorkspace).resolves.toBeUndefined();

    expect(manager.get(supervisor.id)).toBeUndefined();
    expect(deps.supervisorRepo.delete).toHaveBeenCalledWith(supervisor.id);
    expect(
      deps.supervisorRepo.update.mock.calls.some(
        ([id, patch]: [string, SupervisorUpdatePatch]) =>
          id === supervisor.id && patch.state === "error"
      )
    ).toBe(false);
    expect(deps.logger.error).not.toHaveBeenCalled();
  });

  it("marks deleted active targets as cancelled with a completion timestamp", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-delete-completed-at",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
    });

    const activeMeta = {
      targetId: supervisor.targetId,
      sessionId: supervisor.sessionId,
      workspaceId: supervisor.workspaceId,
      objective: supervisor.objective,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
      supersededBy: null,
      completedAt: null,
    };
    deps.targetStore.readTargetMeta.mockResolvedValue(activeMeta);

    await manager.delete(supervisor.id);

    await waitFor(() => {
      expect(deps.targetStore.saveTargetMeta).toHaveBeenCalledWith(
        expect.any(String),
        supervisor.targetId,
        expect.objectContaining({
          targetId: supervisor.targetId,
          status: "cancelled",
          completedAt: expect.any(Number),
        })
      );
    });
  });

  it("pauses an in-flight evaluation by cancelling the cycle", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-pause",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
    });
    const managerInternals = getManagerInternals();

    const evaluate = vi.spyOn(managerInternals.evaluator, "evaluate").mockImplementation(
      async (
        _supervisor: Supervisor,
        _context: SupervisorEvaluationContext,
        options?: { signal?: AbortSignal }
      ) =>
        await new Promise<SupervisorEvaluationResult>((_resolve, reject) => {
          const signal = options?.signal;
          const abort = () =>
            reject({
              code: "supervisor_eval_aborted",
              message: "Supervisor evaluator aborted",
            });

          if (!signal) {
            reject(new Error("Missing abort signal"));
            return;
          }
          if (signal.aborted) {
            abort();
            return;
          }

          signal.addEventListener("abort", abort, { once: true });
        })
    );

    const cycle = await manager.triggerEvaluation(supervisor.id);
    await waitFor(() => {
      expect(evaluate).toHaveBeenCalledTimes(1);
    });

    await manager.pause(supervisor.id);
    await waitFor(() => {
      expect(manager.get(supervisor.id)?.state).toBe("paused");
    });

    expect(manager.get(supervisor.id)?.state).toBe("paused");
  });

  it("does not inject guidance when pause lands after evaluation but before sendInput", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-pause-race",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
    });
    const managerInternals = getManagerInternals();
    const originalUpdate = deps.supervisorRepo.update.getMockImplementation();
    let pauseTriggered = false;

    if (!originalUpdate) {
      throw new Error("Missing supervisorRepo.update implementation");
    }

    deps.supervisorRepo.update.mockImplementation((id: string, patch: SupervisorUpdatePatch) => {
      const updated = originalUpdate(id, patch);
      if (!pauseTriggered && id === supervisor.id && patch.state === "injecting") {
        pauseTriggered = true;
        void manager.pause(supervisor.id);
      }
      return updated;
    });

    vi.spyOn(managerInternals.evaluator, "evaluate").mockResolvedValueOnce({
      status: "continue",
      reason: "Run tests",
      guidance: "Run tests",
    });

    const finished = await managerInternals.runEvaluation(supervisor.id, "turn_completed");

    expect(finished?.status).toBe("cancelled");
    expect(manager.get(supervisor.id)?.state).toBe("paused");
    expect(deps.sessionMgr.sendInput).not.toHaveBeenCalled();
  });
});

async function waitFor(fn: () => void, { timeoutMs = 500, intervalMs = 5 } = {}): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      fn();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("waitFor timed out");
}

async function waitForSupervisor<T>(
  fn: () => T | undefined,
  { timeoutMs = 500, intervalMs = 5 } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = fn();
      if (value !== undefined) {
        return value;
      }
      throw new Error("waitForSupervisor timed out");
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("waitForSupervisor timed out");
}
