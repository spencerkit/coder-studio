import type { SessionAnalysisContext } from "./types.js";

export interface BuildSessionAnalysisPromptInput {
  transcript: string;
  context: SessionAnalysisContext;
}

export function buildSessionAnalysisPrompt(input: BuildSessionAnalysisPromptInput): string {
  return [
    "Analyze the session transcript and context for delivery progress, repeated themes, and likely blockers.",
    "",
    "Return JSON only.",
    "No prose before or after the JSON.",
    "",
    "Use this exact output schema:",
    "{",
    '  "summary": string,',
    '  "recentWork": string[],',
    '  "repeatedTopics": [{ "topic": string, "whyItRepeated": string, "evidence": string[] }],',
    '  "bottlenecks": [{ "title": string, "impact": string, "evidence": string[], "suggestion": string }],',
    '  "skillCandidates": [{ "title": string, "why": string, "suggestedScope": string, "evidence": string[] }],',
    '  "openLoops": string[],',
    '  "wrapUpSuggestions": string[],',
    '  "confidence": "low" | "medium" | "high"',
    "}",
    "",
    "Guidance:",
    "- Ground every section in the provided transcript and context.",
    "- Keep evidence concise and concrete.",
    "- Do not invent work that is not supported by the inputs.",
    "- Prefer repeated themes that show actual back-and-forth effort over one-off mentions.",
    "- Suggest skill candidates only when the repeated work looks reusable beyond this single session.",
    "",
    "Context:",
    JSON.stringify(input.context, null, 2),
    "",
    "Transcript:",
    input.transcript,
  ].join("\n");
}
