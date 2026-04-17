import { describe, expect, it } from 'vitest';
import {
  extractSessionId,
  detectIdlePrompt,
  isValidSessionId,
  detectCompletion,
} from './stdout-heuristics.js';

describe('Codex Stdout Heuristics', () => {
  describe('extractSessionId', () => {
    it.each([
      ['Session ID: abc-123-def', 'abc-123-def'],
      ['session: abc123', 'abc123'],
      ['[session-abc123]', 'abc123'],
      ['{"session_id": "abc-123"}', 'abc-123'],
    ])('should extract session ID from "%s"', (output, expected) => {
      const result = extractSessionId(output);
      expect(result).toBe(expected);
    });

    it('should return null when no session ID found', () => {
      const result = extractSessionId('No session ID here');
      expect(result).toBeNull();
    });

    it('should parse session ID from last 4096 chars', () => {
      const padding = 'x'.repeat(5000); // Exceed buffer
      const output = `${padding}Session ID: abc123`;

      const result = extractSessionId(output);
      expect(result).toBe('abc123');
    });

    it('should extract first match when multiple patterns match', () => {
      const output = 'Session ID: abc123 and [session-def456]';
      const result = extractSessionId(output);

      expect(result).toBe('abc123');
    });
  });

  describe('detectIdlePrompt', () => {
    it.each([
      ['Output\n> ', true],
      ['Output\n$ ', true],
      ['Output\n>>> ', true],
      ['Output\n█ ', true],
    ])('should detect idle prompt in "%s"', (output, expected) => {
      const result = detectIdlePrompt(output);
      expect(result).toBe(expected);
    });

    it('should return false for no idle prompt', () => {
      const result = detectIdlePrompt('Still processing...');
      expect(result).toBe(false);
    });

    it('should detect from last 4096 chars', () => {
      const padding = 'x'.repeat(5000);
      const output = `${padding}\n> `;

      const result = detectIdlePrompt(output);
      expect(result).toBe(true);
    });
  });

  describe('isValidSessionId', () => {
    it.each([
      ['abc123', true],
      ['abc-123-def', true],
      ['123456', true],
      ['short', false], // Less than 6 chars
      ['invalid!', false], // Contains invalid chars
      ['', false],
    ])('should validate session ID "%s" as %s', (id, expected) => {
      const result = isValidSessionId(id);
      expect(result).toBe(expected);
    });
  });

  describe('detectCompletion', () => {
    it.each([
      ['Output\ncomplete.', true],
      ['Output\nfinished.', true],
      ['Output\ndone.', true],
      ['Output\n✓', true],
      ['Task completed', true],
    ])('should detect completion in "%s"', (output, expected) => {
      const result = detectCompletion(output);
      expect(result).toBe(expected);
    });

    it('should return false for incomplete state', () => {
      const result = detectCompletion('Still processing...');
      expect(result).toBe(false);
    });

    it('should detect from last 2048 chars', () => {
      const padding = 'x'.repeat(3000);
      const output = `${padding}\ncomplete.`;

      const result = detectCompletion(output);
      expect(result).toBe(true);
    });
  });
});