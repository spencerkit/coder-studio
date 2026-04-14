import type {
  LaunchContext,
  ProviderDefinition,
} from '@coder-studio/core';
import type { ProviderConfig } from '@coder-studio/core';

import { claudeConfigSchema, type ClaudeConfig } from './config-schema.js';
import { claudeHooksDescriptor } from './hooks-template.js';

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

  // ===== Command construction =====
  buildCommand(config: ProviderConfig, ctx: LaunchContext) {
    const cfg = config as ClaudeConfig;

    return {
      argv: ['claude', ...cfg.additionalArgs],
      env: {
        ...cfg.envVars,
        CODER_STUDIO_SESSION_ID: ctx.sessionId,
      },
      cwd: ctx.workspacePath,
    };
  },

  buildResumeCommand(resumeId: string, config: ProviderConfig, ctx: LaunchContext) {
    const cfg = config as ClaudeConfig;

    return {
      argv: ['claude', '--resume', resumeId, ...cfg.additionalArgs],
      env: {
        ...cfg.envVars,
        CODER_STUDIO_SESSION_ID: ctx.sessionId,
      },
      cwd: ctx.workspacePath,
    };
  },

  // ===== Configuration =====
  configSchema: claudeConfigSchema,
  defaultConfig: {
    model: 'claude-sonnet-4-6[1m]',
    maxTurns: null,
    additionalArgs: [],
    envVars: {},
  } satisfies ClaudeConfig,

  // ===== Runtime requirements =====
  requiredCommands: ['claude'],

  // ===== Hooks integration =====
  hooks: claudeHooksDescriptor,
};
