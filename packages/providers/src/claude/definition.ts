import type {
  LaunchContext,
  ProviderDefinition,
} from '@coder-studio/core';
import type { ProviderConfig } from '@coder-studio/core';

import { claudeConfigSchema } from './config-schema.js';
import { claudeHooksDescriptor } from './hooks-template.js';
import { buildClaudeSupervisorEvalCommand } from './supervisor-eval.js';
import { readClaudeTranscriptExcerpt } from './transcript-excerpt.js';

export const claudeInstallMetadata = {
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
        id: 'npm-install-claude',
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
        id: 'npm-install-claude',
        kind: 'provider',
        targetCommand: 'claude',
        requiresCommands: ['npm'],
        command: 'npm',
        args: ['install', '-g', '@anthropic-ai/claude-code'],
      },
    ],
    linux: [
      {
        id: 'npm-install-claude',
        kind: 'provider',
        targetCommand: 'claude',
        requiresCommands: ['npm'],
        command: 'npm',
        args: ['install', '-g', '@anthropic-ai/claude-code'],
      },
    ],
  },
} satisfies ProviderDefinition['install'];

/**
 * Claude Code provider definition
 * Full capability provider with hooks support
 */
export const claudeDefinition: ProviderDefinition = {
  // ===== Metadata =====
  id: 'claude',
  displayName: 'Claude Code',
  badge: 'Claude',
  capability: 'full',
  install: claudeInstallMetadata,

  // ===== Command construction =====
  buildCommand(config: ProviderConfig, ctx: LaunchContext) {
    const cfg = claudeConfigSchema.parse(config);
    const modelArg = cfg.model ? ['--model', cfg.model] : [];

    return {
      argv: ['claude', ...modelArg, ...(cfg.additionalArgs ?? [])],
      env: {
        ...(cfg.envVars ?? {}),
        CODER_STUDIO_SESSION_ID: ctx.sessionId,
      },
      cwd: ctx.workspacePath,
    };
  },

  buildResumeCommand(resumeId: string, config: ProviderConfig, ctx: LaunchContext) {
    const cfg = claudeConfigSchema.parse(config);
    const modelArg = cfg.model ? ['--model', cfg.model] : [];

    return {
      argv: ['claude', '--resume', resumeId, ...modelArg, ...(cfg.additionalArgs ?? [])],
      env: {
        ...(cfg.envVars ?? {}),
        CODER_STUDIO_SESSION_ID: ctx.sessionId,
      },
      cwd: ctx.workspacePath,
    };
  },

  buildSupervisorEvalCommand: buildClaudeSupervisorEvalCommand,
  readTranscriptExcerpt: readClaudeTranscriptExcerpt,

  // ===== Configuration =====
  configSchema: claudeConfigSchema,
  defaultConfig: {},

  // ===== Runtime requirements =====
  requiredCommands: ['claude'],

  // ===== Hooks integration =====
  hooks: claudeHooksDescriptor,

  // ===== Transcript resolution =====
  async resolveTranscriptPath(session): Promise<string | null> {
    // Claude stores transcripts at the path reported in the SessionStart hook payload.
    return session.transcriptPath ?? null;
  },
};
