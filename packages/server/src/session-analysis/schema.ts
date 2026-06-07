import { z } from "zod";

export const sessionAnalysisResultSchema = z.object({
  summary: z.string(),
  recentWork: z.array(z.string()),
  repeatedTopics: z.array(
    z.object({
      topic: z.string(),
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
  skillCandidates: z.array(
    z.object({
      title: z.string(),
      why: z.string(),
      suggestedScope: z.string(),
      evidence: z.array(z.string()),
    })
  ),
  openLoops: z.array(z.string()),
  wrapUpSuggestions: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]),
});
