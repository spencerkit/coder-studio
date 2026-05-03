import { describe, expect, it, vi } from 'vitest';
import { SupervisorContextBuilder, stripAnsi } from './context-builder.js';

describe('stripAnsi', () => {
  it('removes bracketed paste markers', () => {
    expect(stripAnsi('\x1b[?2004htext\x1b[200~')).toBe('text');
  });

  it('removes cursor position reports', () => {
    expect(stripAnsi('\x1b[6n\x1b[?u')).toBe('');
  });

  it('removes CSI sequences including colors', () => {
    expect(stripAnsi('\x1b[31mmessage\x1b[0m')).toBe('message');
  });

  it('removes screen clearing sequences', () => {
    expect(stripAnsi('\x1b[2Jclear\x1b[H')).toBe('clear');
  });

  it('removes terminal mode sequences with > prefix', () => {
    expect(stripAnsi('\x1b[>7utext')).toBe('text');
  });

  it('strips real terminal excerpt with mixed sequences', () => {
    const raw =
      '\x1b[?2004h\x1b[>7u\x1b[?1004h\x1b[6n' +
      'npm test\nPASS\n' +
      '\x1b[?u';
    expect(stripAnsi(raw)).toBe('npm test\nPASS');
  });

  it('preserves plain text', () => {
    expect(stripAnsi('hello world\nbuild passes')).toBe('hello world\nbuild passes');
  });
});

describe('SupervisorContextBuilder', () => {
  it('uses headless snapshot as primary evidence source', async () => {
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
        getOutputTail: vi.fn(() => Buffer.from('terminal fallback')),
        getRenderedSnapshot: vi.fn(async () => 'rendered terminal content here'),
        getLatestSubmittedUserInput: vi.fn(() => 'run the tests'),
      } as any,
      terminalMgr: {} as any,
      providerRegistry: [] as any,
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

    expect(context.evidenceSource).toBe('headless_snapshot');
    expect(context.terminalExcerpt).toContain('rendered terminal content here');
    expect(context.transcriptExcerpt).toBeUndefined();
    expect(context.lastTurnId).toBeUndefined();
  });

  it('returns an empty headless snapshot when no rendered terminal content is available', async () => {
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
        getRenderedSnapshot: vi.fn(async () => ''),
        getLatestSubmittedUserInput: vi.fn(() => undefined),
      } as any,
      terminalMgr: {} as any,
      providerRegistry: [] as any,
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

    expect(context.evidenceSource).toBe('headless_snapshot');
    expect(context.terminalExcerpt).toBe('');
    expect(context.transcriptExcerpt).toBeUndefined();
  });

  it('reads latestUserInput from the session manager', async () => {
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
        getOutputTail: vi.fn(() => Buffer.from('terminal fallback')),
        getRenderedSnapshot: vi.fn(async () => 'headless shadow'),
        getLatestSubmittedUserInput: vi.fn(() => 'run the tests'),
      } as any,
      terminalMgr: {} as any,
      providerRegistry: [] as any,
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
      objective: 'Ship the fix',
      evaluatorProviderId: 'claude',
      cycles: [],
      createdAt: 1,
      updatedAt: 1,
    });

    expect(context.latestUserInput).toBe('run the tests');
  });

  it('does not set latestUserInput when the session manager has no submitted input', async () => {
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
        getRenderedSnapshot: vi.fn(async () => 'headless shadow'),
        getLatestSubmittedUserInput: vi.fn(() => undefined),
      } as any,
      terminalMgr: {} as any,
      providerRegistry: [] as any,
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

    expect(context.latestUserInput).toBeUndefined();
  });

  it('logs a headless snapshot evidence metric', async () => {
    const logger = {
      child: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      info: vi.fn(),
      level: 'silent',
      silent: vi.fn(),
      trace: vi.fn(),
      warn: vi.fn(),
    } as any;

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
        getOutputTail: vi.fn(() => Buffer.from('terminal fallback')),
        getRenderedSnapshot: vi.fn(async () => 'headless snapshot output'),
        getLatestSubmittedUserInput: vi.fn(() => 'run the tests'),
      } as any,
      terminalMgr: {} as any,
      providerRegistry: [] as any,
      git: {
        getStatusSummary: vi.fn(async () => ''),
        getDiffStatSummary: vi.fn(async () => ''),
      },
      logger,
    });

    await builder.build({
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

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        metric: 'supervisor.evidence.built',
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        evidenceSource: 'headless_snapshot',
        terminalCharCount: 'headless snapshot output'.length,
      }),
      'supervisor evidence built'
    );
  });
});
