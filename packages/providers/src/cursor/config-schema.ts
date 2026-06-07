import { z } from "zod";

export const cursorConfigSchema = z.object({
  model: z.string().trim().min(1).optional(),
  additionalArgs: z.array(z.string()).default([]),
  envVars: z.record(z.string(), z.string()).default({}),
});

export type CursorConfig = z.infer<typeof cursorConfigSchema>;
