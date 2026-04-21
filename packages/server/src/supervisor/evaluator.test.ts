import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupervisorEvaluator } from './evaluator.js';

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
});
