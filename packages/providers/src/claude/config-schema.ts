import { z } from 'zod';

/**
 * Claude Code configuration schema
 * Validates provider-specific settings
 */
export const claudeConfigSchema = z.object({
  // Model selection
  model: z.enum(['claude-sonnet-4-5', 'claude-sonnet-4-6[1m]']).default('claude-sonnet-4-6[1m]'),

  // Maximum turns (null = unlimited)
  maxTurns: z.number().int().positive().nullable().default(null),

  // Additional CLI arguments
  additionalArgs: z.array(z.string()).default([]),

  // Environment variables to pass to Claude CLI
  envVars: z.record(z.string()).default({}),
});

export type ClaudeConfig = z.infer<typeof claudeConfigSchema>;
