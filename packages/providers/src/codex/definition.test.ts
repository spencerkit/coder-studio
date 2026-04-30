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

    it('should expose install metadata', () => {
      expect(codexDefinition.install).toEqual({
        prerequisites: ['npm'],
        manualGuideKeys: [
          'provider.install.nodejs.manual',
          'provider.install.codex.manual',
        ],
        docUrls: {
          provider:
            'https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started',
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
              id: 'npm-install-codex',
              kind: 'provider',
              targetCommand: 'codex',
              requiresCommands: ['npm'],
              command: 'npm',
              args: ['install', '-g', '@openai/codex'],
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
              id: 'npm-install-codex',
              kind: 'provider',
              targetCommand: 'codex',
              requiresCommands: ['npm'],
              command: 'npm',
              args: ['install', '-g', '@openai/codex'],
            },
          ],
          linux: [
            {
              id: 'npm-install-codex',
              kind: 'provider',
              targetCommand: 'codex',
              requiresCommands: ['npm'],
              command: 'npm',
              args: ['install', '-g', '@openai/codex'],
            },
          ],
        },
      });
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
  });

  describe('buildResumeCommand', () => {
    it('should not have resume command', () => {
      expect(codexDefinition.buildResumeCommand).toBeUndefined();
    });
  });

  describe('buildSupervisorEvalCommand', () => {
    it('builds a supervisor eval command with codex exec --json', () => {
      const result = codexDefinition.buildSupervisorEvalCommand?.(
        {
          additionalArgs: [],
          envVars: { OPENAI_API_KEY: 'sk-openai' },
        },
        {
          prompt: 'Return strict JSON',
          sessionId: 'sess-1',
          workspacePath: '/workspace',
        }
      );

      expect(result?.argv.slice(0, 2)).toEqual(['codex', 'exec']);
      // --json produces a JSONL event stream we can actually parse.
      expect(result?.argv).toContain('--json');
      // Evaluations must never mutate the workspace.
      expect(result?.argv).toEqual(expect.arrayContaining(['-s', 'read-only']));
      // Don't choke when the evaluator is pointed at a non-git dir.
      expect(result?.argv).toContain('--skip-git-repo-check');
      // The prompt is the last argv entry so it's treated as the positional prompt.
      expect(result?.argv[result.argv.length - 1]).toBe('Return strict JSON');
      expect(result?.cwd).toBe('/workspace');
      expect(result?.env?.OPENAI_API_KEY).toBe('sk-openai');
    });

    it('places additionalArgs before the prompt positional', () => {
      const result = codexDefinition.buildSupervisorEvalCommand?.(
        {
          additionalArgs: ['-c', 'model_reasoning_effort="low"'],
          envVars: {},
        },
        {
          prompt: 'Return strict JSON',
          sessionId: 'sess-1',
          workspacePath: '/workspace',
        }
      );

      const argv = result?.argv ?? [];
      const configIdx = argv.indexOf('-c');
      const promptIdx = argv.indexOf('Return strict JSON');
      expect(configIdx).toBeGreaterThan(-1);
      expect(promptIdx).toBe(argv.length - 1);
      expect(configIdx).toBeLessThan(promptIdx);
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
