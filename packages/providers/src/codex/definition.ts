import { z } from 'zod';
import type {
  HooksDescriptor,
  LaunchContext,
  ProviderDefinition,
} from '@coder-studio/core';
import type { ProviderConfig } from '@coder-studio/core';

import {
  idleDebounceMs,
  idlePromptPatterns,
  sessionIdPatterns,
} from './stdout-heuristics.js';

/**
 * Codex configuration schema
 * Limited capability provider with basic settings
 */
const codexConfigSchema = z.object({
  // Additional CLI arguments
  additionalArgs: z.array(z.string()).default([]),

  // Environment variables
  envVars: z.record(z.string()).default({}),

  // Working directory override
  cwd: z.string().optional(),
});

type CodexConfig = z.infer<typeof codexConfigSchema>;

/**
 * No-op hooks descriptor for limited providers
 * Does not write to global config, relies on stdout heuristics
 */
const noopHooksDescriptor: HooksDescriptor = {
  markerVersion: 'none',

  resolveGlobalConfigPath(): string {
    // No global config for limited providers
    return '';
  },

  mergeInto(existing: unknown): unknown {
    // No-op: don't modify any config
    return existing;
  },

  extractManaged(): null {
    // No managed hooks
    return null;
  },

  bridgeCommand(): string[] {
    // No bridge commands for limited providers
    return [];
  },

  parseEvent(): null {
    // No event parsing for limited providers
    return null;
  },

  events: {
    sessionStart: false,
    completion: false,
    progress: false,
  },

  // Limited mode: stdout heuristics for session detection
  stdoutHeuristics: {
    sessionIdPatterns,
    idlePromptPatterns,
    idleDebounceMs,
  },
};

/**
 * Codex provider definition
 * Limited capability provider relying on stdout heuristics
 */
export const codexDefinition: ProviderDefinition = {
  // ===== Metadata =====
  id: 'codex',
  displayName: 'Codex',
  badge: 'Codex',
  capability: 'limited', // Phase 1: limited; Phase 2: investigate full capability

  // ===== Command construction =====
  buildCommand(config: ProviderConfig, ctx: LaunchContext) {
    const cfg = config as CodexConfig;

    return {
      argv: ['codex', ...cfg.additionalArgs],
      env: {
        ...cfg.envVars,
        CODER_STUDIO_SESSION_ID: ctx.sessionId,
      },
      cwd: cfg.cwd ?? ctx.workspacePath,
    };
  },

  // Limited mode: no resume support
  buildResumeCommand: undefined,

  // ===== Configuration =====
  configSchema: codexConfigSchema,
  defaultConfig: {
    additionalArgs: [],
    envVars: {},
  } satisfies CodexConfig,

  // ===== Runtime requirements =====
  requiredCommands: ['codex'],

  // ===== Hooks integration =====
  hooks: noopHooksDescriptor,
};