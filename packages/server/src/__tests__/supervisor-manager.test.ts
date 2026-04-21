import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supervisor/evaluator.js', () => ({
  evaluateProgress: vi.fn(async () => ({
    progress: 50,
    summary: 'in progress',
    shouldInject: false,
  })),
}));

vi.mock('../supervisor/injector.js', () => ({
  injectGuidance: vi.fn(async () => {}),
}));

import { SupervisorManager } from '../supervisor/manager.js';

describe('SupervisorManager cycle triggers', () => {
  let manager: SupervisorManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SupervisorManager({
      eventBus: { on: vi.fn(), emit: vi.fn() } as any,
      broadcaster: { broadcast: vi.fn() } as any,
      terminalMgr: {
        writeToSession: vi.fn(),
        getSessionOutput: vi.fn().mockReturnValue(''),
      } as any,
    });
  });

  afterEach(async () => {
    const supervisors = ['sess-manual', 'sess-auto']
      .map((sessionId) => manager.getBySession(sessionId))
      .filter(Boolean);

    for (const supervisor of supervisors) {
      await manager.delete(supervisor!.id);
    }
  });

  it('queues manual triggerEvaluation cycles with manual trigger', async () => {
    const supervisor = await manager.create({
      sessionId: 'sess-manual',
      workspaceId: 'ws-1',
      objective: 'Ship the fix',
      evaluatorProviderId: 'claude',
    });

    const cycle = await manager.triggerEvaluation(supervisor.id);

    expect(cycle.trigger).toBe('manual');
  });

  it('queues scheduler evaluations with turn_completed trigger', async () => {
    const supervisor = await manager.create({
      sessionId: 'sess-auto',
      workspaceId: 'ws-1',
      objective: 'Ship the fix',
      evaluatorProviderId: 'claude',
    });

    await (manager as any).runEvaluation(supervisor.id);

    const updated = manager.get(supervisor.id);
    expect(updated?.cycles).toHaveLength(1);
    expect(updated?.cycles[0]?.trigger).toBe('turn_completed');
  });
});
