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

    it('should have limited capability', () => {
      expect(codexDefinition.capability).toBe('limited');
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
    it('should not have resume command (limited mode)', () => {
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
    it('should have no-op hooks descriptor', () => {
      expect(codexDefinition.hooks).toBeDefined();
      expect(codexDefinition.hooks.markerVersion).toBe('none');
      expect(codexDefinition.hooks.events.sessionStart).toBe(false);
      expect(codexDefinition.hooks.events.completion).toBe(false);
      expect(codexDefinition.hooks.events.progress).toBe(false);
    });

    it('should have stdout heuristics', () => {
      expect(codexDefinition.hooks.stdoutHeuristics).toBeDefined();
      expect(codexDefinition.hooks.stdoutHeuristics?.sessionIdPatterns).toBeDefined();
      expect(codexDefinition.hooks.stdoutHeuristics?.idlePromptPatterns).toBeDefined();
      expect(codexDefinition.hooks.stdoutHeuristics?.idleDebounceMs).toBe(3000);
    });

    it('should not modify config in mergeInto', () => {
      const existing = { some: 'config' };
      const managed = { commands: { SessionStart: 'cmd' } };

      const result = codexDefinition.hooks.mergeInto(existing, managed);

      expect(result).toEqual(existing);
    });

    it('should return null in extractManaged', () => {
      const result = codexDefinition.hooks.extractManaged({ hooks: {} });
      expect(result).toBeNull();
    });

    it('should return null in parseEvent', () => {
      const result = codexDefinition.hooks.parseEvent('SessionStart', {});
      expect(result).toBeNull();
    });
  });
});