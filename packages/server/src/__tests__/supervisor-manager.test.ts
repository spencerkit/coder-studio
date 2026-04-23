import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupervisorManager } from '../supervisor/manager.js';

function createManagerDeps() {
  const supervisors = new Map<string, any>();
  const cyclesBySupervisor = new Map<string, any[]>();

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
    },
    providerRegistry: [
      {
        id: 'claude',
        capability: 'full',
        readTranscriptExcerpt: vi.fn(async () => null),
      },
      {
        id: 'codex',
        capability: 'full',
        buildSupervisorEvalCommand: vi.fn(() => ({
          argv: [
            'node',
            '-e',
            `process.stdout.write(${JSON.stringify(JSON.stringify({ progress: 50, summary: 'on track', shouldInject: false, confidence: 0.8 }))})`,
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
          const updated = { ...cycles[index], ...patch };
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
    expect(finished?.status).toBe('completed');
    expect(finished?.result).toBe('on track');
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
    expect(updated?.cycles[0]?.status).toBe('completed');
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
      evidenceSource: 'terminal_fallback',
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
