import { describe, expect, it } from 'vitest';
import { claudeDefinition } from './definition.js';
import type { ProviderConfig } from '@coder-studio/core';

describe('Claude Provider Definition', () => {
  describe('metadata', () => {
    it('should have correct id and displayName', () => {
      expect(claudeDefinition.id).toBe('claude');
      expect(claudeDefinition.displayName).toBe('Claude Code');
      expect(claudeDefinition.badge).toBe('Claude');
    });

    it('should have full capability', () => {
      expect(claudeDefinition.capability).toBe('full');
    });

    it('should require claude command', () => {
      expect(claudeDefinition.requiredCommands).toEqual(['claude']);
    });
  });

  describe('buildCommand', () => {
    it('should build basic command', () => {
      const config: ProviderConfig = {
        model: 'claude-sonnet-4-6[1m]',
        maxTurns: null,
        additionalArgs: [],
        envVars: {},
      };

      const ctx = {
        sessionId: 'session-123',
        workspacePath: '/workspace',
      };

      const result = claudeDefinition.buildCommand(config, ctx);

      expect(result.argv).toEqual(['claude']);
      expect(result.env.CODER_STUDIO_SESSION_ID).toBe('session-123');
      expect(result.cwd).toBe('/workspace');
    });

    it('should include additional arguments', () => {
      const config: ProviderConfig = {
        model: 'claude-sonnet-4-6[1m]',
        maxTurns: null,
        additionalArgs: ['--verbose', '--debug'],
        envVars: { API_KEY: 'test' },
      };

      const ctx = {
        sessionId: 'session-123',
        workspacePath: '/workspace',
      };

      const result = claudeDefinition.buildCommand(config, ctx);

      expect(result.argv).toEqual(['claude', '--verbose', '--debug']);
      expect(result.env.API_KEY).toBe('test');
      expect(result.env.CODER_STUDIO_SESSION_ID).toBe('session-123');
    });
  });

  describe('buildResumeCommand', () => {
    it('should build resume command', () => {
      const config: ProviderConfig = {
        model: 'claude-sonnet-4-6[1m]',
        maxTurns: null,
        additionalArgs: [],
        envVars: {},
      };

      const ctx = {
        sessionId: 'session-123',
        workspacePath: '/workspace',
      };

      const result = claudeDefinition.buildResumeCommand?.(
        'resume-id-456',
        config,
        ctx
      );

      expect(result?.argv).toEqual(['claude', '--resume', 'resume-id-456']);
      expect(result?.env.CODER_STUDIO_SESSION_ID).toBe('session-123');
      expect(result?.cwd).toBe('/workspace');
    });
  });

  describe('defaultConfig', () => {
    it('should have valid default config', () => {
      expect(claudeDefinition.defaultConfig).toBeDefined();
      expect(claudeDefinition.defaultConfig.model).toBe('claude-sonnet-4-6[1m]');
      expect(claudeDefinition.defaultConfig.maxTurns).toBeNull();
      expect(claudeDefinition.defaultConfig.additionalArgs).toEqual([]);
      expect(claudeDefinition.defaultConfig.envVars).toEqual({});
    });
  });

  describe('hooks', () => {
    it('should have hooks descriptor', () => {
      expect(claudeDefinition.hooks).toBeDefined();
      expect(claudeDefinition.hooks.markerVersion).toBe('cs-v1');
      expect(claudeDefinition.hooks.events.sessionStart).toBe(true);
      expect(claudeDefinition.hooks.events.completion).toBe(true);
      expect(claudeDefinition.hooks.events.progress).toBe(false);
    });
  });
});