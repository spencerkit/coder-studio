import { z } from "zod";

export const geminiConfigSchema = z.object({
  model: z.string().trim().min(1).optional(),
  additionalArgs: z.array(z.string()).default([]),
  envVars: z.record(z.string(), z.string()).default({}),
});

export type GeminiConfig = z.infer<typeof geminiConfigSchema>;
