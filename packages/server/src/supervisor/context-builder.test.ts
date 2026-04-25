import { describe, expect, it, vi } from 'vitest';
import { SupervisorContextBuilder } from './context-builder.js';

describe('SupervisorContextBuilder', () => {
  it('prefers transcript excerpts over terminal fallback', async () => {
    const builder = new SupervisorContextBuilder({
      workspaceMgr: {
        get: vi.fn(() => ({ id: 'ws-1', path: '/workspace' })),
      } as any,
      sessionMgr: {
        get: vi.fn(() => ({
          id: 'sess-1',
          workspaceId: 'ws-1',
          providerId: 'claude',
          terminalId: 'term-1',
          state: 'running',
          capability: 'full',
          startedAt: 1,
          lastActiveAt: 1,
          transcriptPath: '/tmp/session.jsonl',
        })),
        getOutputTail: vi.fn(() => Buffer.from('terminal fallback')),
      } as any,
      terminalMgr: {} as any,
      providerRegistry: [
        {
          id: 'claude',
          readTranscriptExcerpt: vi.fn(async () => ({
            excerpt: 'assistant: repo ready',
            lastTurnId: 'turn-2',
          })),
        },
      ] as any,
      git: {
        getStatusSummary: vi.fn(async () => 'M packages/server/src/supervisor/manager.ts'),
        getDiffStatSummary: vi.fn(async () => '1 file changed, 42 insertions(+)'),
      },
    });

    const context = await builder.build({
      id: 'sup-1',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
      state: 'idle',
      objective: 'Persist supervisors',
      evaluatorProviderId: 'codex',
      cycles: [],
      createdAt: 1,
      updatedAt: 1,
    });

    expect(context.evidenceSource).toBe('transcript');
    expect(context.transcriptExcerpt).toContain('repo ready');
    expect(context.lastTurnId).toBe('turn-2');
  });

  it('falls back to terminal output when transcript is unavailable', async () => {
    const builder = new SupervisorContextBuilder({
      workspaceMgr: {
        get: vi.fn(() => ({ id: 'ws-1', path: '/workspace' })),
      } as any,
      sessionMgr: {
        get: vi.fn(() => ({
          id: 'sess-1',
          workspaceId: 'ws-1',
          providerId: 'claude',
          terminalId: 'term-1',
          state: 'running',
          capability: 'full',
          startedAt: 1,
          lastActiveAt: 1,
        })),
        getOutputTail: vi.fn(() => Buffer.from('npm test\nPASS')),
      } as any,
      terminalMgr: {} as any,
      providerRegistry: [{ id: 'claude', readTranscriptExcerpt: vi.fn(async () => null) }] as any,
      git: {
        getStatusSummary: vi.fn(async () => ''),
        getDiffStatSummary: vi.fn(async () => ''),
      },
    });

    const context = await builder.build({
      id: 'sup-1',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
      state: 'idle',
      objective: 'Persist supervisors',
      evaluatorProviderId: 'claude',
      cycles: [],
      createdAt: 1,
      updatedAt: 1,
    });

    expect(context.evidenceSource).toBe('terminal_fallback');
    expect(context.terminalExcerpt).toContain('PASS');
  });
});
