import { describe, expect, it } from 'vitest';
import { codexDefinition } from './definition.js';
import type { ProviderConfig } from '@coder-studio/core';

describe('Codex Provider Definition', () => {
  describe('metadata', () => {
    it('should have correct id and displayName', () => {
      expect(codexDefinition.id).toBe('codex');
      expect(codexDefinition.displayName).toBe('Codex');
      expect(codexDefinition.badge).toBe('Codex');
    });

    it('should have full capability', () => {
      expect(codexDefinition.capability).toBe('full');
    });

    it('should require codex command', () => {
      expect(codexDefinition.requiredCommands).toEqual(['codex']);
    });
  });

  describe('buildCommand', () => {
    it('should build basic command', () => {
      const config: ProviderConfig = {
        additionalArgs: [],
        envVars: {},
      };

      const ctx = {
        sessionId: 'session-123',
        workspacePath: '/workspace',
      };

      const result = codexDefinition.buildCommand(config, ctx);

      expect(result.argv).toEqual(['codex']);
      expect(result.env.CODER_STUDIO_SESSION_ID).toBe('session-123');
      expect(result.cwd).toBe('/workspace');
    });

    it('should include -c notify when bridgeScriptPath is provided', () => {
      const config: ProviderConfig = { additionalArgs: [], envVars: {} };
      const ctx = {
        sessionId: 'session-123',
        workspacePath: '/workspace',
        bridgeScriptPath: '/path/to/codex-bridge.js',
      };

      const result = codexDefinition.buildCommand(config, ctx);

      expect(result.argv).toContain('-c');
      const notifyArg = result.argv.find((a: string) => a.startsWith('notify='));
      expect(notifyArg).toContain('node');
      expect(notifyArg).toContain('/path/to/codex-bridge.js');
    });

    it('should include additional arguments and env vars', () => {
      const config: ProviderConfig = {
        additionalArgs: ['--flag'],
        envVars: { TOKEN: 'abc' },
      };

      const ctx = {
        sessionId: 'session-123',
        workspacePath: '/workspace',
      };

      const result = codexDefinition.buildCommand(config, ctx);

      expect(result.argv).toEqual(['codex', '--flag']);
      expect(result.env.TOKEN).toBe('abc');
      expect(result.env.CODER_STUDIO_SESSION_ID).toBe('session-123');
    });

    it('should use custom cwd if specified', () => {
      const config: ProviderConfig = {
        additionalArgs: [],
        envVars: {},
        cwd: '/custom/path',
      };

      const ctx = {
        sessionId: 'session-123',
        workspacePath: '/workspace',
      };

      const result = codexDefinition.buildCommand(config, ctx);

      expect(result.cwd).toBe('/custom/path');
    });
  });

  describe('buildResumeCommand', () => {
    it('should not have resume command', () => {
      expect(codexDefinition.buildResumeCommand).toBeUndefined();
    });
  });

  describe('defaultConfig', () => {
    it('should have valid default config', () => {
      expect(codexDefinition.defaultConfig).toBeDefined();
      expect(codexDefinition.defaultConfig.additionalArgs).toEqual([]);
      expect(codexDefinition.defaultConfig.envVars).toEqual({});
    });
  });

  describe('hooks', () => {
    it('should have real hooks descriptor with completion enabled', () => {
      expect(codexDefinition.hooks).toBeDefined();
      expect(codexDefinition.hooks.markerVersion).toBe('cs-v1');
      expect(codexDefinition.hooks.events.sessionStart).toBe(false);
      expect(codexDefinition.hooks.events.completion).toBe(true);
      expect(codexDefinition.hooks.events.progress).toBe(false);
    });

    it('should have stdout heuristics as fallback', () => {
      expect(codexDefinition.hooks.stdoutHeuristics).toBeDefined();
      expect(codexDefinition.hooks.stdoutHeuristics?.sessionIdPatterns).toBeDefined();
      expect(codexDefinition.hooks.stdoutHeuristics?.idlePromptPatterns).toBeDefined();
      expect(codexDefinition.hooks.stdoutHeuristics?.idleDebounceMs).toBe(3000);
    });

    it('should parse agent-turn-complete events', () => {
      const result = codexDefinition.hooks.parseEvent('agent-turn-complete', {
        'thread-id': 'uuid-1',
        'turn-id': 'turn-42',
      });

      expect(result).toBeDefined();
      expect(result?.type).toBe('turn_completed');
      expect(result?.payload.resumeId).toBe('uuid-1');
      expect(result?.payload.turnId).toBe('turn-42');
    });

    it('should return null for unknown events', () => {
      const result = codexDefinition.hooks.parseEvent('unknown', {});
      expect(result).toBeNull();
    });

    it('should have resolveTranscriptPath', () => {
      expect(codexDefinition.resolveTranscriptPath).toBeDefined();
    });
  });
});
