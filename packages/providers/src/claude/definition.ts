import type {
  LaunchContext,
  ProviderDefinition,
} from '@coder-studio/core';
import type { ProviderConfig } from '@coder-studio/core';

import { claudeConfigSchema, type ClaudeConfig } from './config-schema.js';
import { claudeHooksDescriptor } from './hooks-template.js';
import { buildClaudeSupervisorEvalCommand } from './supervisor-eval.js';
import { readClaudeTranscriptExcerpt } from './transcript-excerpt.js';

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
    const modelArg = cfg.model ? ['--model', cfg.model] : [];

    return {
      argv: ['claude', ...modelArg, ...cfg.additionalArgs],
      env: {
        ...cfg.envVars,
        CODER_STUDIO_SESSION_ID: ctx.sessionId,
      },
      cwd: ctx.workspacePath,
    };
  },

  buildResumeCommand(resumeId: string, config: ProviderConfig, ctx: LaunchContext) {
    const cfg = config as ClaudeConfig;
    const modelArg = cfg.model ? ['--model', cfg.model] : [];

    return {
      argv: ['claude', '--resume', resumeId, ...modelArg, ...cfg.additionalArgs],
      env: {
        ...cfg.envVars,
        CODER_STUDIO_SESSION_ID: ctx.sessionId,
      },
      cwd: ctx.workspacePath,
    };
  },

  buildSupervisorEvalCommand: buildClaudeSupervisorEvalCommand,
  readTranscriptExcerpt: readClaudeTranscriptExcerpt,

  // ===== Configuration =====
  configSchema: claudeConfigSchema,
  defaultConfig: {
    model: 'claude-sonnet-4-6',
    maxTurns: null,
    additionalArgs: [],
    envVars: {},
  } satisfies ClaudeConfig,

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
