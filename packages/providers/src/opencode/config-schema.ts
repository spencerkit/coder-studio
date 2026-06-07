import { z } from "zod";

export const opencodeConfigSchema = z.object({
  model: z.string().trim().min(1).optional(),
  additionalArgs: z.array(z.string()).default([]),
  envVars: z.record(z.string(), z.string()).default({}),
});

export type OpenCodeConfig = z.infer<typeof opencodeConfigSchema>;
