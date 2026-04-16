import { describe, it, expect, vi } from 'vitest';
import { evaluateProgress, type EvaluationResult } from './evaluator.js';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              progress: 50,
              summary: 'Test is progressing',
              shouldInject: false,
            }),
          },
        ],
      }),
    };
  },
}));

describe('evaluateProgress', () => {
  it('returns evaluation result with progress percentage', async () => {
    const result = await evaluateProgress(
      'Complete the login feature',
      'Last 10 lines of terminal output...',
      'diff --git a/login.ts'
    );

    expect(result).toHaveProperty('progress');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('shouldInject');
    expect(typeof result.progress).toBe('number');
    expect(result.progress).toBeGreaterThanOrEqual(0);
    expect(result.progress).toBeLessThanOrEqual(100);
  });

  it('returns shouldInject=false when progress is adequate', async () => {
    const result = await evaluateProgress(
      'Complete the login feature',
      'Login feature implemented successfully'
    );

    expect(result.shouldInject).toBe(false);
  });
});