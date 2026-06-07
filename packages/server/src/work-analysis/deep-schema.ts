import { z } from "zod";

export const workDeepAnalysisResultSchema = z.object({
  workSummary: z.string(),
  repeatedPatterns: z.array(
    z.object({
      title: z.string(),
      whyItRepeated: z.string(),
      evidence: z.array(z.string()),
    })
  ),
  bottlenecks: z.array(
    z.object({
      title: z.string(),
      impact: z.string(),
      evidence: z.array(z.string()),
      suggestion: z.string(),
    })
  ),
  workflowSuggestions: z.array(z.string()),
  skillCandidates: z.array(
    z.object({
      title: z.string(),
      why: z.string(),
      suggestedScope: z.string(),
      evidence: z.array(z.string()),
    })
  ),
  openLoops: z.array(z.string()),
  followUpSuggestions: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]),
});
