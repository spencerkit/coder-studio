import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dispatch } from '../ws/dispatch.js';
import { createServer, type Server } from '../server.js';

describe('Supervisor integration', () => {
  let server: Server;

  beforeEach(async () => {
    server = await createServer({
      dataDir: ':memory:',
      host: '127.0.0.1',
      port: 0,
    } as any);

    const ctx = server.__test__!.commandContext;

    ctx.db
      .prepare(
        'INSERT INTO workspaces (id, path, target_runtime, opened_at, last_active_at, ui_state) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run('ws-1', process.cwd(), 'native', 1, 1, '{}');
    ctx.db
      .prepare(
        'INSERT INTO terminals (id, workspace_id, kind, cwd, argv, cols, rows, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run('term-1', 'ws-1', 'agent', process.cwd(), '[]', 120, 30, 1);
    ctx.db
      .prepare(
        'INSERT INTO sessions (id, workspace_id, terminal_id, provider_id, capability, state, started_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run('sess-1', 'ws-1', 'term-1', 'claude', 'full', 'running', 1, 1);

    ctx.workspaceMgr.get = () => ({ id: 'ws-1', path: process.cwd() });
    ctx.sessionMgr.get = () => ({
      id: 'sess-1',
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      providerId: 'claude',
      state: 'running',
      capability: 'full',
      startedAt: 1,
      lastActiveAt: 1,
    });
    ctx.sessionMgr.getRenderedSnapshot = async () =>
      'assistant: built the persistent supervisor repos';
    ctx.sessionMgr.getLatestSubmittedUserInput = () => 'run the tests';

    (ctx.supervisorMgr as any).deps.providerConfigRepo.get = () => ({
      model: 'claude-sonnet-4-6',
      additionalArgs: [],
      envVars: {},
    });
    (ctx.supervisorMgr as any).contextBuilder = {
      build: async () => ({
        objective: 'Verify end-to-end persistence',
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        workspacePath: process.cwd(),
        sessionProviderId: 'claude',
        evaluatorProviderId: 'claude',
        sessionState: 'running',
        terminalExcerpt: 'assistant: built the persistent supervisor repos',
        evidenceSource: 'headless_snapshot',
        latestUserInput: 'run the tests',
      }),
    };
    (ctx.supervisorMgr as any).evaluator = {
      evaluate: async () => ({
        message: '',
      }),
    };
  });

  afterEach(async () => {
    await server?.stop();
  });

  it('creates a cycle on manual trigger and persists it into supervisor.get', async () => {
    const ctx = server.__test__!.commandContext;

    const created = await ctx.supervisorMgr.create({
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
      objective: 'Verify end-to-end persistence',
      evaluatorProviderId: 'claude',
    });

    const cycle = await ctx.supervisorMgr.triggerEvaluation(created.id);
    // `triggerEvaluation` now returns as soon as the in-flight cycle is
    // created and broadcast — the evaluator + repo writes finish in the
    // background. Wait for the cycle to drain before checking persistence.
    expect(cycle.trigger).toBe('manual');
    expect(cycle.status).toBe('evaluating');
    await waitFor(async () => {
      const current = ctx.supervisorMgr.get(created.id);
      const latest = current?.cycles.find((c: any) => c.id === cycle.id);
      if (!latest || latest.status === 'evaluating') {
        throw new Error('cycle still in flight');
      }
    });

    const fetched = await dispatch<{ supervisor: any | null }>(
      {
        kind: 'command',
        id: 'cmd-supervisor-get',
        op: 'supervisor.get',
        args: { sessionId: 'sess-1' },
      },
      ctx
    );

    expect(fetched.ok).toBe(true);
    expect(fetched.data?.supervisor?.cycles).toHaveLength(1);
    expect(fetched.data?.supervisor?.cycles[0]?.evaluatorProviderId).toBe('claude');
    expect(fetched.data?.supervisor?.cycles[0]?.evidenceSource).toBe('headless_snapshot');
    expect(fetched.data?.supervisor?.cycles[0]).toEqual(
      expect.objectContaining({
        trigger: 'manual',
        status: 'completed',
        result: undefined,
        errorReason: undefined,
      })
    );
  });

  it('wires supervisor manager to the shared Fastify logger', () => {
    const ctx = server.__test__!.commandContext;

    expect((ctx.supervisorMgr as any).logger).toBe(server.app.log);
  });
});

async function waitFor(
  fn: () => Promise<void> | void,
  { timeoutMs = 1000, intervalMs = 10 } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await fn();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('waitFor timed out');
}
