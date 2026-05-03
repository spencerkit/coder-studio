import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupervisorManager } from './manager.js';

describe('SupervisorManager', () => {
  let deps: any;

  beforeEach(() => {
    deps = {
      eventBus: { on: vi.fn(() => () => {}), emit: vi.fn() },
      broadcaster: { broadcast: vi.fn() },
      terminalMgr: { write: vi.fn() },
      workspaceMgr: { get: vi.fn(() => ({ id: 'ws-1', path: '/workspace' })) },
      sessionMgr: {
        get: vi.fn(() => ({
          id: 'sess-1',
          terminalId: 'term-1',
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
          buildSupervisorEvalCommand: vi.fn(() => ({
            argv: [
              'node',
              '-e',
              `process.stdout.write(${JSON.stringify('continue with the work')})`,
            ],
            cwd: process.cwd(),
            env: {},
          })),
        },
      ],
      providerConfigRepo: {
        get: vi.fn(() => ({
          model: 'claude-sonnet-4-6',
          additionalArgs: [],
          envVars: {},
        })),
      },
      supervisorRepo: {
        create: vi.fn((value) => ({ ...value, cycles: [] })),
        update: vi.fn((id, patch) => ({
          id,
          sessionId: 'sess-1',
          workspaceId: 'ws-1',
          state: patch.state ?? 'idle',
          objective: patch.objective ?? 'Persist supervisors',
          evaluatorProviderId: patch.evaluatorProviderId ?? 'claude',
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
          supervisorId: 'sup-1',
          sessionId: 'sess-1',
          status: patch.status ?? 'completed',
          trigger: 'manual',
          evidenceSource: 'headless_snapshot',
          objective: 'Persist supervisors',
          evaluatorProviderId: 'claude',
          createdAt: 1,
          completedAt: patch.completedAt ?? 1,
        })),
        listRecentForSupervisor: vi.fn(() => []),
        pruneOldest: vi.fn(),
      },
    };
  });

  it('recovers persisted evaluating supervisors back to idle on hydrate', async () => {
    deps.supervisorRepo.listAll.mockReturnValue([
      {
        id: 'sup-1',
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        state: 'evaluating',
        objective: 'Persist supervisors',
        evaluatorProviderId: 'claude',
        cycles: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const manager = new SupervisorManager(deps);
    await manager.hydrate();

    expect(deps.supervisorRepo.update).toHaveBeenCalledWith(
      'sup-1',
      expect.objectContaining({ state: 'idle', errorReason: null })
    );
  });
});
