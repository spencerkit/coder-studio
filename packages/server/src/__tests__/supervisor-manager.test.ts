import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupervisorManager } from '../supervisor/manager.js';

function createManagerDeps() {
  const supervisors = new Map<string, any>();
  const cyclesBySupervisor = new Map<string, any[]>();
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const hydrateSupervisor = (supervisor: any) => ({
    ...supervisor,
    cycles: [...(cyclesBySupervisor.get(supervisor.id) ?? [])],
  });

  return {
    eventBus: { on: vi.fn(() => () => {}), emit: vi.fn() },
    broadcaster: { broadcast: vi.fn() },
    terminalMgr: {
      write: vi.fn(),
      get: vi.fn(() => ({
        ringBuffer: { snapshot: () => Buffer.from('terminal fallback output') },
      })),
    },
    workspaceMgr: { get: vi.fn(() => ({ id: 'ws-1', path: process.cwd() })) },
    sessionMgr: {
      get: vi.fn((sessionId: string) => ({
        id: sessionId,
        terminalId: `term-${sessionId}`,
        workspaceId: 'ws-1',
        providerId: 'claude',
        state: 'running',
        capability: 'full',
        startedAt: 1,
        lastActiveAt: 1,
      })),
      getRenderedSnapshot: vi.fn(async () => 'headless snapshot output'),
      getLatestSubmittedUserInput: vi.fn(() => 'run the tests'),
      sendInput: vi.fn(),
    },
    providerRegistry: [
      {
        id: 'claude',
        capability: 'full',
        hooks: {
          events: {
            sessionStart: true,
            completion: true,
            progress: false,
          },
        },
      },
      {
        id: 'codex',
        capability: 'full',
        hooks: {
          events: {
            sessionStart: false,
            completion: true,
            progress: false,
          },
        },
        buildSupervisorEvalCommand: vi.fn(() => ({
          argv: [
            'node',
            '-e',
            `process.stdout.write(${JSON.stringify('Run the focused parser test.')})`,
          ],
          cwd: process.cwd(),
          env: {},
        })),
      },
    ],
    providerConfigRepo: {
      get: vi.fn((providerId: string) =>
        providerId === 'codex' ? { additionalArgs: [], envVars: {} } : undefined
      ),
    },
    logger,
    supervisorRepo: {
      create: vi.fn((value: any) => {
        const supervisor = { ...value, cycles: [] };
        supervisors.set(supervisor.id, { ...supervisor });
        return hydrateSupervisor(supervisor);
      }),
      update: vi.fn((id: string, patch: any) => {
        const current = supervisors.get(id);
        if (!current) {
          throw new Error(`Supervisor not found: ${id}`);
        }
        const next = { ...current, ...patch };
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
      listAll: vi.fn(() => [...supervisors.values()].map((value) => hydrateSupervisor(value))),
      delete: vi.fn((id: string) => {
        supervisors.delete(id);
        cyclesBySupervisor.delete(id);
      }),
    },
    cycleRepo: {
      create: vi.fn((cycle: any) => {
        const next = [cycle, ...(cyclesBySupervisor.get(cycle.supervisorId) ?? [])];
        cyclesBySupervisor.set(cycle.supervisorId, next);
        return cycle;
      }),
      update: vi.fn((id: string, patch: any) => {
        for (const [supervisorId, cycles] of cyclesBySupervisor.entries()) {
          const index = cycles.findIndex((cycle) => cycle.id === id);
          if (index === -1) {
            continue;
          }
          const normalizedPatch = {
            ...patch,
            progress: patch.progress ?? undefined,
            result: patch.result ?? undefined,
            injectedGuidance: patch.injectedGuidance ?? undefined,
          };
          const updated = { ...cycles[index], ...normalizedPatch };
          const next = [...cycles];
          next[index] = updated;
          cyclesBySupervisor.set(supervisorId, next);
          return updated;
        }
        throw new Error(`Cycle not found: ${id}`);
      }),
      listRecentForSupervisor: vi.fn((supervisorId: string) => [
        ...(cyclesBySupervisor.get(supervisorId) ?? []),
      ]),
      pruneOldest: vi.fn(),
    },
  };
}

describe('SupervisorManager cycle triggers', () => {
  let deps: ReturnType<typeof createManagerDeps>;
  let manager: SupervisorManager;

  beforeEach(async () => {
    deps = createManagerDeps();
    manager = new SupervisorManager(deps as any);
    await manager.hydrate();
  });

  it('passes the provided logger to context builder and evaluator', () => {
    expect((manager as any).logger).toBe(deps.logger);
    expect((manager as any).contextBuilder.logger).toBe(deps.logger);
    expect((manager as any).evaluator.logger).toBe(deps.logger);
  });

  it('returns an in-flight cycle immediately on manual triggerEvaluation', async () => {
    const supervisor = await manager.create({
      sessionId: 'sess-manual',
      workspaceId: 'ws-1',
      objective: 'Ship the fix',
      evaluatorProviderId: 'codex',
    });

    const cycle = await manager.triggerEvaluation(supervisor.id);

    expect(cycle.trigger).toBe('manual');
    expect(cycle.status).toBe('evaluating');

    // Wait for the background finishCycle to drain.
    await waitFor(() => {
      const current = manager.get(supervisor.id);
      const latest = current?.cycles.find((c) => c.id === cycle.id);
      if (!latest || latest.status === 'evaluating') {
        throw new Error('cycle still in flight');
      }
    });

    const finished = manager.get(supervisor.id)?.cycles.find((c) => c.id === cycle.id);
    expect(finished?.status).toBe('injected');
    expect(finished?.result).toBe('[Supervisor] Run the focused parser test.');
  });

  it('queues scheduler evaluations with turn_completed trigger', async () => {
    const supervisor = await manager.create({
      sessionId: 'sess-auto',
      workspaceId: 'ws-1',
      objective: 'Ship the fix',
      evaluatorProviderId: 'codex',
    });

    await (manager as any).runEvaluation(supervisor.id);

    const updated = manager.get(supervisor.id);
    expect(updated?.cycles).toHaveLength(1);
    expect(updated?.cycles[0]?.trigger).toBe('turn_completed');
    expect(updated?.cycles[0]?.status).toBe('injected');
  });

  it('persists duplicate-suppressed guidance as a cycle result without marking it injected', async () => {
    const supervisor = await manager.create({
      sessionId: 'sess-dedupe',
      workspaceId: 'ws-1',
      objective: 'Ship the fix',
      evaluatorProviderId: 'codex',
    });

    vi.spyOn((manager as any).evaluator, 'evaluate').mockResolvedValueOnce({
      message: 'Run the focused parser test.',
    });
    vi.spyOn((manager as any).injector, 'inject').mockResolvedValueOnce({
      injected: false,
      text: '[Supervisor] Run the focused parser test.',
    });

    const finished = await (manager as any).runEvaluation(supervisor.id);

    expect(finished?.status).toBe('completed');
    expect(finished?.result).toBe(
      'Skipped duplicate: [Supervisor] Run the focused parser test.'
    );
    expect(finished?.injectedGuidance).toBeUndefined();
  });

  it('rejects manual triggerEvaluation when the session is still starting', async () => {
    const supervisor = await manager.create({
      sessionId: 'sess-starting',
      workspaceId: 'ws-1',
      objective: 'Ship the fix',
      evaluatorProviderId: 'codex',
    });

    // Flip the session to "starting" — the real-world case where the provider
    // CLI hasn't finished its first turn, so the injector cannot deliver
    // guidance yet. We must fail fast instead of burning evaluator tokens.
    deps.sessionMgr.get.mockImplementation((sessionId: string) => ({
      id: sessionId,
      terminalId: `term-${sessionId}`,
      workspaceId: 'ws-1',
      providerId: 'claude',
      state: 'starting',
      capability: 'full',
      startedAt: 1,
      lastActiveAt: 1,
    }));

    await expect(manager.triggerEvaluation(supervisor.id)).rejects.toMatchObject({
      code: 'supervisor_session_not_ready',
      message: expect.stringContaining('starting up'),
    });

    // No cycle should have been recorded, and no evaluator command should
    // have been built — we bailed before either side-effect.
    expect(manager.get(supervisor.id)?.cycles).toHaveLength(0);
    const codexProvider = deps.providerRegistry.find((p) => p.id === 'codex');
    expect(codexProvider?.buildSupervisorEvalCommand).not.toHaveBeenCalled();
  });

  it('marks orphaned cycles as failed during hydrate', async () => {
    const supervisor = await manager.create({
      sessionId: 'sess-orphan',
      workspaceId: 'ws-1',
      objective: 'Ship the fix',
      evaluatorProviderId: 'codex',
    });

    // Simulate a cycle left behind by a crashed process: directly insert a
    // "queued" cycle into the cycle repo and re-hydrate.
    deps.cycleRepo.create({
      id: 'legacy-queued',
      supervisorId: supervisor.id,
      sessionId: 'sess-orphan',
      status: 'queued',
      trigger: 'manual',
      evidenceSource: 'headless_snapshot',
      objective: supervisor.objective,
      evaluatorProviderId: supervisor.evaluatorProviderId,
      createdAt: Date.now(),
    });

    await manager.hydrate();

    const recovered = deps.cycleRepo.listRecentForSupervisor(supervisor.id, 10);
    const legacy = recovered.find((c) => c.id === 'legacy-queued');
    expect(legacy?.status).toBe('failed');
    expect(legacy?.errorReason).toBeTruthy();
  });

  it('rejects supervisor creation when the session provider capability is limited', async () => {
    deps.sessionMgr.get.mockImplementation((sessionId: string) => ({
      id: sessionId,
      terminalId: `term-${sessionId}`,
      workspaceId: 'ws-1',
      providerId: 'claude',
      state: 'running',
      capability: 'limited',
      startedAt: 1,
      lastActiveAt: 1,
    }));
    deps.providerRegistry[0] = {
      ...deps.providerRegistry[0],
      capability: 'limited',
    };

    await expect(
      manager.create({
        sessionId: 'sess-limited-label',
        workspaceId: 'ws-1',
        objective: 'Ship the fix',
        evaluatorProviderId: 'codex',
      })
    ).rejects.toMatchObject({
      code: 'supervisor_unsupported_provider',
      message: 'Provider claude does not support supervisor-driven sessions',
    });
  });

  it('logs evaluation failures with the original error and keeps the persisted reason concise', async () => {
    const supervisor = await manager.create({
      sessionId: 'sess-eval-error',
      workspaceId: 'ws-1',
      objective: 'Ship the fix',
      evaluatorProviderId: 'codex',
    });

    const evaluationError = new Error('Evaluator exploded');
    vi.spyOn((manager as any).evaluator, 'evaluate').mockRejectedValueOnce(evaluationError);

    await expect((manager as any).runEvaluation(supervisor.id)).rejects.toThrow(
      'Evaluator exploded'
    );

    const updated = manager.get(supervisor.id);
    expect(updated?.state).toBe('error');
    expect(updated?.errorReason).toBe('Evaluator exploded');
    expect(updated?.cycles[0]?.status).toBe('failed');
    expect(updated?.cycles[0]?.errorReason).toBe('Evaluator exploded');
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: evaluationError,
        supervisorId: supervisor.id,
        cycleId: expect.any(String),
      }),
      'Supervisor evaluation failed'
    );
  });

  it('logs pre-cycle failures with the original error and leaves the persisted reason concise', async () => {
    const supervisor = await manager.create({
      sessionId: 'sess-context-error',
      workspaceId: 'ws-1',
      objective: 'Ship the fix',
      evaluatorProviderId: 'codex',
    });

    const contextError = new Error('Context build exploded');
    vi.spyOn((manager as any).contextBuilder, 'build').mockRejectedValueOnce(contextError);

    await expect((manager as any).runEvaluation(supervisor.id)).rejects.toThrow(
      'Context build exploded'
    );

    const updated = manager.get(supervisor.id);
    expect(updated?.state).toBe('error');
    expect(updated?.errorReason).toBe('Context build exploded');
    expect(updated?.cycles).toHaveLength(0);
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: contextError,
        supervisorId: supervisor.id,
      }),
      'Supervisor evaluation failed before cycle creation'
    );
  });

  it('aborts in-flight evaluation during workspace teardown without persisting an error state', async () => {
    const supervisor = await manager.create({
      sessionId: 'sess-close',
      workspaceId: 'ws-1',
      objective: 'Ship the fix',
      evaluatorProviderId: 'codex',
    });

    const evaluate = vi
      .spyOn((manager as any).evaluator, 'evaluate')
      .mockImplementation(
        async (
          _supervisor: any,
          _context: any,
          options?: { signal?: AbortSignal }
        ) =>
          await new Promise((resolve, reject) => {
            const signal = options?.signal;
            const abort = () =>
              reject({
                code: 'supervisor_eval_aborted',
                message: 'Supervisor evaluator aborted',
              });

            if (!signal) {
              reject(new Error('Missing abort signal'));
              return;
            }
            if (signal.aborted) {
              abort();
              return;
            }

            signal.addEventListener('abort', abort, { once: true });
          })
      );

    const runEvaluation = (manager as any).runEvaluation(supervisor.id);

    await waitFor(() => {
      expect(evaluate).toHaveBeenCalledTimes(1);
    });

    const deleteWorkspace = manager.deleteForWorkspace('ws-1');

    await expect(runEvaluation).resolves.toMatchObject({
      supervisorId: supervisor.id,
      status: 'failed',
      errorReason: 'Supervisor evaluator aborted',
    });
    await expect(deleteWorkspace).resolves.toBeUndefined();

    expect(manager.get(supervisor.id)).toBeUndefined();
    expect(deps.supervisorRepo.delete).toHaveBeenCalledWith(supervisor.id);
    expect(
      deps.supervisorRepo.update.mock.calls.some(
        ([id, patch]: [string, { state?: string }]) =>
          id === supervisor.id && patch.state === 'error'
      )
    ).toBe(false);
    expect(deps.logger.error).not.toHaveBeenCalled();
  });
});

async function waitFor(
  fn: () => void,
  { timeoutMs = 500, intervalMs = 5 } = {}
): Promise<void> {
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
  throw lastError instanceof Error ? lastError : new Error('waitFor timed out');
}
