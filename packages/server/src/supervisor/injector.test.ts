import { describe, expect, it, vi } from 'vitest';
import { SupervisorInjector } from './injector.js';

describe('SupervisorInjector', () => {
  it('writes guidance through terminalMgr.write using the session terminalId', async () => {
    const injector = new SupervisorInjector({
      sessionMgr: {
        get: vi.fn(() => ({
          id: 'sess-1',
          terminalId: 'term-1',
          state: 'running',
          workspaceId: 'ws-1',
          providerId: 'claude',
          capability: 'full',
          startedAt: 1,
          lastActiveAt: 1,
        })),
      } as any,
      terminalMgr: { write: vi.fn() } as any,
    });

    await injector.inject(
      {
        id: 'sup-1',
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        state: 'idle',
        objective: 'Finish the repo migration',
        evaluatorProviderId: 'claude',
        cycles: [],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        summary: 'Tables and repos are finished.',
        guidance: 'Wire the repos into SupervisorManager next.',
      },
      []
    );

    expect((injector as any).deps.terminalMgr.write).toHaveBeenCalledWith(
      'term-1',
      expect.any(Buffer)
    );
  });
});
