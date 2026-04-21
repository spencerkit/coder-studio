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

  it('queues manual triggerEvaluation cycles with manual trigger', async () => {
    const supervisor = await manager.create({
      sessionId: 'sess-manual',
      workspaceId: 'ws-1',
      objective: 'Ship the fix',
      evaluatorProviderId: 'codex',
    });

    const cycle = await manager.triggerEvaluation(supervisor.id);

    expect(cycle.trigger).toBe('manual');
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
  });
});
