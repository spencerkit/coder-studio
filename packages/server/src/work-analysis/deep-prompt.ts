import type { WorkAnalysisEvidence, WorkBasicAnalysisResult } from "./types.js";

export function buildWorkDeepAnalysisPrompt(input: {
  basicResult: WorkBasicAnalysisResult;
  evidence: WorkAnalysisEvidence;
}): string {
  return [
    "Analyze the selected work activity and return JSON only.",
    "",
    "No prose before or after the JSON.",
    "",
    "Use this exact output schema:",
    "{",
    '  "workSummary": string,',
    '  "repeatedPatterns": [{ "title": string, "whyItRepeated": string, "evidence": string[] }],',
    '  "bottlenecks": [{ "title": string, "impact": string, "evidence": string[], "suggestion": string }],',
    '  "workflowSuggestions": string[],',
    '  "skillCandidates": [{ "title": string, "why": string, "suggestedScope": string, "evidence": string[] }],',
    '  "openLoops": string[],',
    '  "followUpSuggestions": string[],',
    '  "confidence": "low" | "medium" | "high"',
    "}",
    "",
    "Guidance:",
    "- Ground every conclusion in the provided analysis and evidence.",
    "- Prefer repeated work patterns over one-off events.",
    "- Suggest skills only when the workflow looks reusable.",
    "- If evidence is weak, lower confidence instead of filling gaps with guesses.",
    "",
    "Basic analysis:",
    JSON.stringify(input.basicResult, null, 2),
    "",
    "Evidence:",
    JSON.stringify(input.evidence, null, 2),
  ].join("\n");
}
