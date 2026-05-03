import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupervisorEvaluator } from './evaluator.js';

function nodeEchoCommand(stdout: string) {
  return {
    argv: [
      'node',
      '-e',
      `process.stdout.write(${JSON.stringify(stdout)})`,
    ],
    cwd: process.cwd(),
    env: {},
  };
}

function makeEvaluator(stdout: string, providerId = 'codex', config?: { guidanceMaxChars?: number }) {
  return new SupervisorEvaluator({
    providerRegistry: [
      {
        id: providerId,
        buildSupervisorEvalCommand: vi.fn(() => nodeEchoCommand(stdout)),
      },
    ] as any,
    providerConfigRepo: {
      get: vi.fn(() => ({ additionalArgs: [], envVars: {} })),
    } as any,
    timeoutMs: 5000,
    config: config ? { guidanceMaxChars: config.guidanceMaxChars ?? 2000, guidanceDedupeWindow: 2 } : undefined,
  });
}

function makeSupervisor(evaluatorProviderId = 'codex') {
  return {
    id: 'sup-1',
    sessionId: 'sess-1',
    workspaceId: 'ws-1',
    state: 'idle',
    objective: 'obj',
    evaluatorProviderId,
    cycles: [],
    createdAt: 1,
    updatedAt: 1,
  } as any;
}

function makeContext() {
  return {
    objective: 'obj',
    sessionId: 'sess-1',
    workspaceId: 'ws-1',
    workspacePath: process.cwd(),
    sessionProviderId: 'claude',
    evaluatorProviderId: 'codex',
    sessionState: 'running',
    evidenceSource: 'headless_snapshot',
    terminalExcerpt: 'build passes',
    latestUserInput: 'run the tests',
  } as any;
}

describe('SupervisorEvaluator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('uses supervisor.evaluatorProviderId instead of the session provider', async () => {
    const evaluator = new SupervisorEvaluator({
      providerRegistry: [
        {
          id: 'codex',
          buildSupervisorEvalCommand: vi.fn(() => ({
            argv: ['node', '-e', 'process.stdout.write("next step: run tests")'],
            cwd: process.cwd(),
            env: {},
          })),
        },
      ] as any,
      providerConfigRepo: {
        get: vi.fn(() => ({ additionalArgs: [], envVars: {} })),
      } as any,
      timeoutMs: 5000,
    });

    const result = await evaluator.evaluate(
      {
        id: 'sup-1',
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        state: 'idle',
        objective: 'Finish the evaluator runner',
        evaluatorProviderId: 'codex',
        cycles: [],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        objective: 'Finish the evaluator runner',
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        workspacePath: process.cwd(),
        sessionProviderId: 'claude',
        evaluatorProviderId: 'codex',
        sessionState: 'running',
        evidenceSource: 'headless_snapshot',
        terminalExcerpt: 'build passes',
        latestUserInput: 'run the tests',
      }
    );

    expect(result.message).toBe('next step: run tests');
  });

  it('falls back to provider.defaultConfig when evaluator config is missing', async () => {
    const evaluator = new SupervisorEvaluator({
      providerRegistry: [
        {
          id: 'claude',
          defaultConfig: { model: 'claude-sonnet-4-6', additionalArgs: [], envVars: {} },
          buildSupervisorEvalCommand: vi.fn(() => ({
            argv: ['node', '-e', 'process.stdout.write("proceed with review")'],
            cwd: process.cwd(),
            env: {},
          })),
        },
      ] as any,
      providerConfigRepo: { get: vi.fn(() => undefined) } as any,
      timeoutMs: 5000,
    });

    const result = await evaluator.evaluate(
      {
        id: 'sup-1',
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        state: 'idle',
        objective: 'Finish the evaluator runner',
        evaluatorProviderId: 'claude',
        cycles: [],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        objective: 'Finish the evaluator runner',
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        workspacePath: process.cwd(),
        sessionProviderId: 'codex',
        evaluatorProviderId: 'claude',
        sessionState: 'running',
        evidenceSource: 'headless_snapshot',
        terminalExcerpt: 'build passes',
        latestUserInput: 'run the tests',
      }
    );

    expect(result.message).toBe('proceed with review');
  });

  it('builds a natural language prompt matching the develop supervisor pattern', async () => {
    const logger = { warn: vi.fn(), error: vi.fn() } as any;
    const evaluator = new SupervisorEvaluator({
      providerRegistry: [
        {
          id: 'codex',
          buildSupervisorEvalCommand: vi.fn(() => ({
            argv: ['node', '-e', 'process.stdout.write("")'],
            cwd: process.cwd(),
            env: {},
          })),
        },
      ] as any,
      providerConfigRepo: {
        get: vi.fn(() => ({ additionalArgs: [], envVars: {} })),
      } as any,
      timeoutMs: 5000,
      logger,
    });

    await expect(
      evaluator.evaluate(makeSupervisor('codex'), {
        ...makeContext(),
        objective: 'Ship the fix',
        terminalExcerpt: 'latest output',
      })
    ).rejects.toThrow();

    const prompt = (logger.warn.mock.calls[0]?.[0] as { prompt?: string } | undefined)?.prompt;
    expect(prompt).toContain('You are the supervisor for a business agent terminal session.');
    expect(prompt).toContain('generate the next concrete task');
    expect(prompt).toContain('Current objective:');
    expect(prompt).toContain('Ship the fix');
    expect(prompt).toContain('Latest user input:');
    expect(prompt).toContain('run the tests');
    expect(prompt).toContain('Latest business agent output:');
    expect(prompt).toContain('latest output');
    expect(prompt).toContain('[objective complete]');
    expect(prompt).toContain('Your response must be one of');
  });

  describe('message extraction', () => {
    it('parses agent_message text from codex JSONL stream', async () => {
      const jsonl = [
        JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
        JSON.stringify({ type: 'turn.started' }),
        JSON.stringify({
          type: 'item.completed',
          item: { id: 'i1', type: 'agent_message', text: 'Run pnpm vitest to verify' },
        }),
        JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 20 } }),
      ].join('\n');

      const evaluator = makeEvaluator(jsonl, 'codex');
      const result = await evaluator.evaluate(makeSupervisor('codex'), makeContext());

      expect(result.message).toBe('Run pnpm vitest to verify');
    });

    it('falls back to reasoning text when agent_message is missing', async () => {
      const jsonl = [
        JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
        JSON.stringify({ type: 'turn.started' }),
        JSON.stringify({
          type: 'item.completed',
          item: { id: 'i0', type: 'reasoning', text: 'Continue with the tests' },
        }),
        JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 50 } }),
      ].join('\n');

      const evaluator = makeEvaluator(jsonl, 'codex');
      const result = await evaluator.evaluate(makeSupervisor('codex'), makeContext());

      expect(result.message).toBe('Continue with the tests');
    });

    it('accepts assistant_message (older codex builds)', async () => {
      const jsonl = [
        JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
        JSON.stringify({
          type: 'item.completed',
          item: { id: 'i0', item_type: 'assistant_message', text: 'All good' },
        }),
        JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 40 } }),
      ].join('\n');

      const evaluator = makeEvaluator(jsonl, 'codex');
      const result = await evaluator.evaluate(makeSupervisor('codex'), makeContext());

      expect(result.message).toBe('All good');
    });

    it('strips markdown code fence from agent_message text', async () => {
      const fenced = '```json\nRun the tests\n```';
      const jsonl = [
        JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
        JSON.stringify({ type: 'turn.started' }),
        JSON.stringify({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: fenced } }),
        JSON.stringify({ type: 'turn.completed', usage: {} }),
      ].join('\n');

      const evaluator = makeEvaluator(jsonl, 'codex');
      const result = await evaluator.evaluate(makeSupervisor('codex'), makeContext());

      expect(result.message).toBe('Run the tests');
    });

    it('parses claude --output-format json envelope (result field)', async () => {
      const claudeEnvelope = JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 42,
        result: 'Proceed to the next step',
        session_id: 'uuid',
      });

      const evaluator = makeEvaluator(claudeEnvelope, 'claude');
      const result = await evaluator.evaluate(makeSupervisor('claude'), makeContext());

      expect(result.message).toBe('Proceed to the next step');
    });

    it('surfaces codex turn.failed error details', async () => {
      const jsonl = JSON.stringify({
        type: 'turn.failed',
        error: { message: 'context length exceeded' },
      });

      const evaluator = makeEvaluator(jsonl, 'codex');

      await expect(
        evaluator.evaluate(makeSupervisor('codex'), makeContext())
      ).rejects.toThrow('context length exceeded');
    });

    it('raises when codex stream has no agent_message or reasoning', async () => {
      const jsonl =
        JSON.stringify({ type: 'thread.started', thread_id: 't1' }) +
        '\n' +
        JSON.stringify({ type: 'turn.started' }) +
        '\n' +
        JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 191 } });

      const evaluator = makeEvaluator(jsonl, 'codex');

      await expect(
        evaluator.evaluate(makeSupervisor('codex'), makeContext())
      ).rejects.toThrow(/completed without returning a message/i);
    });

    it('truncates message to guidanceMaxChars', async () => {
      const longMessage = 'A'.repeat(500);
      const jsonl = [
        JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
        JSON.stringify({ type: 'turn.started' }),
        JSON.stringify({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: longMessage } }),
        JSON.stringify({ type: 'turn.completed', usage: {} }),
      ].join('\n');

      const evaluator = makeEvaluator(jsonl, 'codex', { guidanceMaxChars: 100 });
      const result = await evaluator.evaluate(makeSupervisor(), makeContext());

      expect(result.message).toHaveLength(100);
    });
  });
});
