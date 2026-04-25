import { z } from 'zod';

/**
 * Codex configuration schema
 */
export const codexConfigSchema = z.object({
  additionalArgs: z.array(z.string()).default([]),
  envVars: z.record(z.string(), z.string()).default({}),
});

export type CodexConfig = z.infer<typeof codexConfigSchema>;
