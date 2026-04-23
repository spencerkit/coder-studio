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

function makeEvaluator(stdout: string, providerId = 'codex') {
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
    evidenceSource: 'terminal_fallback',
    terminalExcerpt: 'build passes',
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
            argv: [
              'node',
              '-e',
              `process.stdout.write(${JSON.stringify(JSON.stringify({ progress: 60, summary: 'codex evaluator', shouldInject: false, confidence: 0.9 }))})`,
            ],
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
        evidenceSource: 'terminal_fallback',
        terminalExcerpt: 'build passes',
      }
    );

    expect(result.summary).toBe('codex evaluator');
    expect(result.progress).toBe(60);
  });

  it('falls back to provider.defaultConfig when evaluator config is missing', async () => {
    const evaluator = new SupervisorEvaluator({
      providerRegistry: [
        {
          id: 'claude',
          defaultConfig: { model: 'claude-sonnet-4-6', additionalArgs: [], envVars: {} },
          buildSupervisorEvalCommand: vi.fn(() => ({
            argv: [
              'node',
              '-e',
              `process.stdout.write(${JSON.stringify(JSON.stringify({ progress: 25, summary: 'default config used', shouldInject: false, confidence: 0.4 }))})`,
            ],
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
        evidenceSource: 'terminal_fallback',
        terminalExcerpt: 'build passes',
      }
    );

    expect(result.summary).toBe('default config used');
    expect(result.progress).toBe(25);
  });

  describe('payload extraction', () => {
    it('parses a codex exec --json JSONL stream via item.completed agent_message', async () => {
      const payload = {
        progress: 72,
        summary: 'Agent is editing parser.ts',
        shouldInject: true,
        guidance: 'Run pnpm vitest parser',
        confidence: 0.8,
      };
      const jsonl = [
        JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
        JSON.stringify({ type: 'turn.started' }),
        JSON.stringify({
          type: 'item.completed',
          item: { id: 'i0', type: 'reasoning', text: '**thinking**' },
        }),
        JSON.stringify({
          type: 'item.completed',
          item: { id: 'i1', type: 'agent_message', text: JSON.stringify(payload) },
        }),
        JSON.stringify({
          type: 'turn.completed',
          usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 20 },
        }),
      ].join('\n');

      const evaluator = makeEvaluator(jsonl, 'codex');
      const result = await evaluator.evaluate(makeSupervisor('codex'), makeContext());

      expect(result.progress).toBe(72);
      expect(result.summary).toBe('Agent is editing parser.ts');
      expect(result.shouldInject).toBe(true);
      expect(result.guidance).toBe('Run pnpm vitest parser');
    });

    it('unwraps a markdown code fence inside the codex agent_message', async () => {
      const payload = {
        progress: 30,
        summary: 'Fenced reply',
        shouldInject: false,
        confidence: 0.5,
      };
      const fenced = '```json\n' + JSON.stringify(payload) + '\n```';
      const jsonl =
        JSON.stringify({ type: 'thread.started', thread_id: 't1' }) +
        '\n' +
        JSON.stringify({ type: 'turn.started' }) +
        '\n' +
        JSON.stringify({
          type: 'item.completed',
          item: { id: 'i1', type: 'agent_message', text: fenced },
        }) +
        '\n' +
        JSON.stringify({ type: 'turn.completed', usage: {} });

      const evaluator = makeEvaluator(jsonl, 'codex');
      const result = await evaluator.evaluate(makeSupervisor('codex'), makeContext());

      expect(result.summary).toBe('Fenced reply');
      expect(result.progress).toBe(30);
    });

    it('parses claude --output-format json envelope (result field holds the JSON)', async () => {
      const payload = {
        progress: 48,
        summary: 'Claude envelope',
        shouldInject: false,
        confidence: 0.6,
      };
      const claudeEnvelope = JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 42,
        result: JSON.stringify(payload),
        session_id: 'uuid',
      });

      const evaluator = makeEvaluator(claudeEnvelope, 'claude');
      const result = await evaluator.evaluate(makeSupervisor('claude'), makeContext());

      expect(result.summary).toBe('Claude envelope');
      expect(result.progress).toBe(48);
    });

    it('unwraps fenced JSON returned at the top level', async () => {
      const payload = {
        progress: 10,
        summary: 'fenced top-level',
        shouldInject: false,
        confidence: 0.2,
      };
      const fenced = 'Here you go:\n```json\n' + JSON.stringify(payload) + '\n```\nthanks!';

      const evaluator = makeEvaluator(fenced);
      const result = await evaluator.evaluate(makeSupervisor(), makeContext());

      expect(result.summary).toBe('fenced top-level');
    });

    it('raises an actionable codex-specific error when the stream has no agent_message', async () => {
      const jsonl =
        JSON.stringify({ type: 'thread.started', thread_id: 't1' }) +
        '\n' +
        JSON.stringify({ type: 'turn.started' }) +
        '\n' +
        JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 370 } });

      const evaluator = makeEvaluator(jsonl, 'codex');

      const err = await evaluator
        .evaluate(makeSupervisor('codex'), makeContext())
        .catch((e) => e);

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/no agent_message/);
      // Output-token count surfaced so users can see tokens were wasted on reasoning.
      expect((err as Error).message).toContain('370 output tokens');
      // Actionable hint so the user knows what to do.
      expect((err as Error).message).toMatch(/claude/i);
    });

    it('falls back to reasoning text when the proxy drops agent_message', async () => {
      const payload = {
        progress: 33,
        summary: 'reasoning carried the payload',
        shouldInject: false,
        confidence: 0.3,
      };
      const jsonl =
        JSON.stringify({ type: 'thread.started', thread_id: 't1' }) +
        '\n' +
        JSON.stringify({ type: 'turn.started' }) +
        '\n' +
        JSON.stringify({
          type: 'item.completed',
          item: { id: 'i0', type: 'reasoning', text: JSON.stringify(payload) },
        }) +
        '\n' +
        JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 50 } });

      const evaluator = makeEvaluator(jsonl, 'codex');
      const result = await evaluator.evaluate(makeSupervisor('codex'), makeContext());

      expect(result.progress).toBe(33);
      expect(result.summary).toBe('reasoning carried the payload');
    });

    it('reports a distinct error when reasoning is present but not JSON', async () => {
      const jsonl =
        JSON.stringify({ type: 'thread.started', thread_id: 't1' }) +
        '\n' +
        JSON.stringify({ type: 'turn.started' }) +
        '\n' +
        JSON.stringify({
          type: 'item.completed',
          item: { id: 'i0', type: 'reasoning', text: '**Thinking about the problem...**' },
        }) +
        '\n' +
        JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 40 } });

      const evaluator = makeEvaluator(jsonl, 'codex');

      await expect(
        evaluator.evaluate(makeSupervisor('codex'), makeContext())
      ).rejects.toThrow(/only reasoning.*not contain a valid JSON payload/i);
    });

    it('accepts assistant_message (older codex builds use item_type too)', async () => {
      const payload = {
        progress: 21,
        summary: 'older codex',
        shouldInject: false,
        confidence: 0.5,
      };
      const jsonl =
        JSON.stringify({ type: 'thread.started', thread_id: 't1' }) +
        '\n' +
        JSON.stringify({
          type: 'item.completed',
          item: { id: 'i0', item_type: 'assistant_message', text: JSON.stringify(payload) },
        }) +
        '\n' +
        JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 40 } });

      const evaluator = makeEvaluator(jsonl, 'codex');
      const result = await evaluator.evaluate(makeSupervisor('codex'), makeContext());

      expect(result.progress).toBe(21);
      expect(result.summary).toBe('older codex');
    });

    it('surfaces codex turn.failed error details', async () => {
      const jsonl =
        JSON.stringify({ type: 'thread.started', thread_id: 't1' }) +
        '\n' +
        JSON.stringify({
          type: 'turn.failed',
          error: { message: 'context length exceeded' },
        });

      const evaluator = makeEvaluator(jsonl, 'codex');

      await expect(
        evaluator.evaluate(makeSupervisor('codex'), makeContext())
      ).rejects.toThrow(/context length exceeded/);
    });

    it('falls back to the generic error for unrecognized stdout', async () => {
      const evaluator = makeEvaluator('just some human banner text with no JSON anywhere');

      await expect(
        evaluator.evaluate(makeSupervisor(), makeContext())
      ).rejects.toThrow(/did not return a recognizable JSON payload/);
    });

    it('extracts the last balanced {...} when it is inline with prose on one line', async () => {
      const payload = {
        progress: 90,
        summary: 'found it',
        shouldInject: false,
        confidence: 0.9,
      };
      // No newlines between prose and JSON so the NDJSON scan can't find it —
      // this forces the final sliceLastJsonObject fallback path.
      const prose = 'Final answer below: ' + JSON.stringify(payload) + ' (that is all)';

      const evaluator = makeEvaluator(prose);
      const result = await evaluator.evaluate(makeSupervisor(), makeContext());

      expect(result.progress).toBe(90);
      expect(result.summary).toBe('found it');
    });
  });
});
