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

    it('should expose install metadata', () => {
      expect(claudeDefinition.install).toEqual({
        prerequisites: ['npm'],
        manualGuideKeys: [
          'provider.install.nodejs.manual',
          'provider.install.claude.manual',
        ],
        docUrls: {
          provider:
            'https://docs.anthropic.com/en/docs/claude-code/getting-started',
          prerequisites: {
            npm: 'https://nodejs.org/en/download',
          },
        },
        strategies: {
          win32: [
            {
              id: 'winget-nodejs-lts',
              kind: 'prerequisite',
              targetCommand: 'npm',
              requiresCommands: ['winget'],
              command: 'winget',
              args: [
                'install',
                '--id',
                'OpenJS.NodeJS.LTS',
                '--exact',
                '--silent',
              ],
            },
            {
              id: 'npm-install-claude-code',
              kind: 'provider',
              targetCommand: 'claude',
              requiresCommands: ['npm'],
              command: 'npm',
              args: ['install', '-g', '@anthropic-ai/claude-code'],
            },
          ],
          darwin: [
            {
              id: 'brew-node',
              kind: 'prerequisite',
              targetCommand: 'npm',
              requiresCommands: ['brew'],
              command: 'brew',
              args: ['install', 'node'],
            },
            {
              id: 'npm-install-claude-code',
              kind: 'provider',
              targetCommand: 'claude',
              requiresCommands: ['npm'],
              command: 'npm',
              args: ['install', '-g', '@anthropic-ai/claude-code'],
            },
          ],
          linux: [
            {
              id: 'npm-install-claude-code',
              kind: 'provider',
              targetCommand: 'claude',
              requiresCommands: ['npm'],
              command: 'npm',
              args: ['install', '-g', '@anthropic-ai/claude-code'],
            },
          ],
        },
      });
    });
  });

  describe('buildCommand', () => {
    it('should build basic command without a model flag when no model is configured', () => {
      const config: ProviderConfig = {};

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
        model: 'claude-sonnet-4-6',
        maxTurns: null,
        additionalArgs: ['--verbose', '--debug'],
        envVars: { API_KEY: 'test' },
      };

      const ctx = {
        sessionId: 'session-123',
        workspacePath: '/workspace',
      };

      const result = claudeDefinition.buildCommand(config, ctx);

      expect(result.argv).toEqual(['claude', '--model', 'claude-sonnet-4-6', '--verbose', '--debug']);
      expect(result.env.API_KEY).toBe('test');
      expect(result.env.CODER_STUDIO_SESSION_ID).toBe('session-123');
    });
  });

  describe('buildResumeCommand', () => {
    it('should build resume command without a model flag when no model is configured', () => {
      const config: ProviderConfig = {};

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

  describe('buildSupervisorEvalCommand', () => {
    it('builds a supervisor eval command with claude -p --output-format json', () => {
      const result = claudeDefinition.buildSupervisorEvalCommand?.(
        {
          model: 'claude-sonnet-4-6',
          maxTurns: null,
          additionalArgs: [],
          envVars: { ANTHROPIC_API_KEY: 'sk-test' },
        },
        {
          prompt: 'Return strict JSON',
          sessionId: 'sess-1',
          workspacePath: '/workspace',
        }
      );

      expect(result?.argv[0]).toBe('claude');
      expect(result?.argv).toContain('-p');
      // We rely on the `--output-format json` envelope to extract the model reply.
      expect(result?.argv).toEqual(expect.arrayContaining(['--output-format', 'json']));
      expect(result?.argv).toEqual(expect.arrayContaining(['--model', 'claude-sonnet-4-6']));
      expect(result?.cwd).toBe('/workspace');
      expect(result?.env?.ANTHROPIC_API_KEY).toBe('sk-test');
    });

    it('omits the model flag for supervisor eval when no model is configured', () => {
      const result = claudeDefinition.buildSupervisorEvalCommand?.(
        {},
        {
          prompt: 'Return strict JSON',
          sessionId: 'sess-1',
          workspacePath: '/workspace',
        }
      );

      expect(result?.argv[0]).toBe('claude');
      expect(result?.argv).not.toContain('--model');
    });
  });

  describe('defaultConfig', () => {
    it('should not inject Claude-specific defaults', () => {
      expect(claudeDefinition.defaultConfig).toBeDefined();
      expect(claudeDefinition.defaultConfig).toEqual({});
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
