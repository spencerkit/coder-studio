import type {
  ProviderConfig,
  ProviderDefinition,
  Session,
  Supervisor,
  SupervisorCycle,
} from "@coder-studio/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { SupervisorCycleUpdatePatch } from "../storage/repositories/supervisor-cycle-repo.js";
import type {
  NewSupervisor,
  SupervisorUpdatePatch,
} from "../storage/repositories/supervisor-repo.js";
import type { SupervisorEvaluationContext } from "../supervisor/context-builder.js";
import { SupervisorContextBuilder } from "../supervisor/context-builder.js";
import { SupervisorEvaluator, type SupervisorResult } from "../supervisor/evaluator.js";
import { SupervisorInjector } from "../supervisor/injector.js";
import { SupervisorManager, type SupervisorManagerDeps } from "../supervisor/manager.js";

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
  runEvaluation: (supervisorId: string) => Promise<SupervisorCycle | null>;
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
    ...(patch.lastCycleAt !== undefined ? { lastCycleAt: patch.lastCycleAt ?? undefined } : {}),
    ...(patch.lastEvaluatedTurnId !== undefined
      ? { lastEvaluatedTurnId: patch.lastEvaluatedTurnId ?? undefined }
      : {}),
    ...(patch.errorReason !== undefined ? { errorReason: patch.errorReason ?? undefined } : {}),
    ...(patch.updatedAt !== undefined ? { updatedAt: patch.updatedAt } : {}),
  };
}

function applyCyclePatch(
  current: SupervisorCycle,
  patch: SupervisorCycleUpdatePatch
): SupervisorCycle {
  return {
    ...current,
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.progress !== undefined ? { progress: patch.progress ?? undefined } : {}),
    ...(patch.result !== undefined ? { result: patch.result ?? undefined } : {}),
    ...(patch.injectedGuidance !== undefined
      ? { injectedGuidance: patch.injectedGuidance ?? undefined }
      : {}),
    ...(patch.errorReason !== undefined ? { errorReason: patch.errorReason ?? undefined } : {}),
    ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt ?? undefined } : {}),
  };
}

function createManagerDeps() {
  const supervisors = new Map<string, Supervisor>();
  const cyclesBySupervisor = new Map<string, SupervisorCycle[]>();
  const logger: TestLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const codexBuildSupervisorEvalCommand = vi.fn(() => ({
    argv: ["node", "-e", `process.stdout.write(${JSON.stringify("Run the focused parser test.")})`],
    cwd: process.cwd(),
    env: {},
  }));

  const hydrateSupervisor = (supervisor: Supervisor): Supervisor => ({
    ...supervisor,
    cycles: [...(cyclesBySupervisor.get(supervisor.id) ?? [])],
  });

  const providerConfigRepo = {
    get: vi.fn((providerId: string): ProviderConfig | undefined =>
      providerId === "codex" ? { additionalArgs: [], envVars: {} } : undefined
    ),
  };

  const supervisorRepo = {
    create: vi.fn((value: NewSupervisor) => {
      const supervisor: Supervisor = { ...value, cycles: [] };
      supervisors.set(supervisor.id, { ...supervisor, cycles: [] });
      return hydrateSupervisor(supervisor);
    }),
    update: vi.fn((id: string, patch: SupervisorUpdatePatch) => {
      const current = supervisors.get(id);
      if (!current) {
        throw new Error(`Supervisor not found: ${id}`);
      }
      const next = applySupervisorPatch(current, patch);
      supervisors.set(id, next);
      return hydrateSupervisor(next);
    }),
    findById: vi.fn((id: string) => {
      const supervisor = supervisors.get(id);
      return supervisor ? hydrateSupervisor(supervisor) : undefined;
    }),
    getBySessionId: vi.fn((sessionId: string) => {
      const supervisor = [...supervisors.values()].find((value) => value.sessionId === sessionId);
      return supervisor ? hydrateSupervisor(supervisor) : undefined;
    }),
    listAll: vi.fn(() => [...supervisors.values()].map(hydrateSupervisor)),
    delete: vi.fn((id: string) => {
      supervisors.delete(id);
      cyclesBySupervisor.delete(id);
    }),
  };

  const cycleRepo = {
    create: vi.fn((cycle: SupervisorCycle) => {
      const next = [cycle, ...(cyclesBySupervisor.get(cycle.supervisorId) ?? [])];
      cyclesBySupervisor.set(cycle.supervisorId, next);
      return cycle;
    }),
    update: vi.fn((id: string, patch: SupervisorCycleUpdatePatch) => {
      for (const [supervisorId, cycles] of cyclesBySupervisor.entries()) {
        const index = cycles.findIndex((cycle) => cycle.id === id);
        if (index === -1) {
          continue;
        }
        const updated = applyCyclePatch(cycles[index]!, patch);
        const next = [...cycles];
        next[index] = updated;
        cyclesBySupervisor.set(supervisorId, next);
        return updated;
      }
      throw new Error(`Cycle not found: ${id}`);
    }),
    listRecentForSupervisor: vi.fn((supervisorId: string, _limit: number) => [
      ...(cyclesBySupervisor.get(supervisorId) ?? []),
    ]),
    pruneOldest: vi.fn(),
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
    logger,
    supervisorRepo,
    cycleRepo,
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
  });

  it("passes the provided logger to context builder and evaluator", () => {
    const managerInternals = getManagerInternals();

    expect(managerInternals.logger).toBe(deps.logger);
    expect(managerInternals.contextBuilder.logger).toBe(deps.logger);
    expect(managerInternals.evaluator.logger).toBe(deps.logger);
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
      const latest = current?.cycles.find((entry) => entry.id === cycle.id);
      if (!latest || latest.status === "evaluating") {
        throw new Error("cycle still in flight");
      }
    });

    const finished = manager.get(supervisor.id)?.cycles.find((entry) => entry.id === cycle.id);
    expect(finished?.status).toBe("injected");
    expect(finished?.result).toBe("[Supervisor] Run the focused parser test.");
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
    expect(updated?.cycles).toHaveLength(1);
    expect(updated?.cycles[0]?.trigger).toBe("turn_completed");
    expect(updated?.cycles[0]?.status).toBe("injected");
  });

  it("persists duplicate-suppressed guidance as a cycle result without marking it injected", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-dedupe",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
    });
    const managerInternals = getManagerInternals();

    vi.spyOn(managerInternals.evaluator, "evaluate").mockResolvedValueOnce({
      message: "Run the focused parser test.",
    });
    vi.spyOn(managerInternals.injector, "inject").mockResolvedValueOnce({
      injected: false,
      text: "[Supervisor] Run the focused parser test.",
    });

    const finished = await managerInternals.runEvaluation(supervisor.id);

    expect(finished?.status).toBe("completed");
    expect(finished?.result).toBe("Skipped duplicate: [Supervisor] Run the focused parser test.");
    expect(finished?.injectedGuidance).toBeUndefined();
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

    expect(manager.get(supervisor.id)?.cycles).toHaveLength(0);
    expect(deps.codexBuildSupervisorEvalCommand).not.toHaveBeenCalled();
  });

  it("marks orphaned cycles as failed during hydrate", async () => {
    const supervisor = await manager.create({
      sessionId: "sess-orphan",
      workspaceId: "ws-1",
      objective: "Ship the fix",
      evaluatorProviderId: "codex",
    });

    deps.cycleRepo.create({
      id: "legacy-queued",
      supervisorId: supervisor.id,
      sessionId: "sess-orphan",
      status: "queued",
      trigger: "manual",
      evidenceSource: "headless_snapshot",
      objective: supervisor.objective,
      evaluatorProviderId: supervisor.evaluatorProviderId,
      createdAt: Date.now(),
    });

    await manager.hydrate();

    const recovered = deps.cycleRepo.listRecentForSupervisor(supervisor.id, 10);
    const legacy = recovered.find((cycle) => cycle.id === "legacy-queued");
    expect(legacy?.status).toBe("failed");
    expect(legacy?.errorReason).toBeTruthy();
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
    expect(updated?.cycles[0]?.status).toBe("failed");
    expect(updated?.cycles[0]?.errorReason).toBe("Evaluator exploded");
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
    expect(updated?.cycles).toHaveLength(0);
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
        await new Promise<SupervisorResult>((_resolve, reject) => {
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
