import { describe, expect, it } from 'vitest';
import { claudeConfigSchema } from './config-schema.js';

describe('Claude Config Schema', () => {
  it('should parse valid config with defaults', () => {
    const result = claudeConfigSchema.parse({});

    expect(result.model).toBe('claude-sonnet-4-6[1m]');
    expect(result.maxTurns).toBeNull();
    expect(result.additionalArgs).toEqual([]);
    expect(result.envVars).toEqual({});
  });

  it('should parse config with custom values', () => {
    const input = {
      model: 'claude-sonnet-4-5',
      maxTurns: 10,
      additionalArgs: ['--verbose', '--debug'],
      envVars: { ANTHROPIC_API_KEY: 'test-key' },
    };

    const result = claudeConfigSchema.parse(input);

    expect(result.model).toBe('claude-sonnet-4-5');
    expect(result.maxTurns).toBe(10);
    expect(result.additionalArgs).toEqual(['--verbose', '--debug']);
    expect(result.envVars.ANTHROPIC_API_KEY).toBe('test-key');
  });

  it('should reject invalid model', () => {
    const input = { model: 'invalid-model' };

    expect(() => claudeConfigSchema.parse(input)).toThrow();
  });

  it('should reject negative maxTurns', () => {
    const input = { maxTurns: -5 };

    expect(() => claudeConfigSchema.parse(input)).toThrow();
  });

  it('should accept null maxTurns', () => {
    const result = claudeConfigSchema.parse({ maxTurns: null });

    expect(result.maxTurns).toBeNull();
  });
});