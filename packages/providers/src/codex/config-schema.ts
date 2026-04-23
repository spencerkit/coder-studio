import { z } from 'zod';

/**
 * Codex configuration schema
 */
export const codexConfigSchema = z.object({
  additionalArgs: z.array(z.string()).default([]),
  envVars: z.record(z.string()).default({}),
  cwd: z.string().optional(),
});

export type CodexConfig = z.infer<typeof codexConfigSchema>;
