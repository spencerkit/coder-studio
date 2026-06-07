import type { WorkLogSession } from "./log-sources/types.js";
import type { WorkAnalysisEvidence } from "./types.js";

interface SampleInput {
  sessions: WorkLogSession[];
  skillInventory: WorkAnalysisEvidence["skillInventory"];
  maxSessions?: number;
  maxExcerptsPerSession?: number;
  maxTextChars?: number;
}

function truncateText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

export function sampleWorkLogEvidence(input: SampleInput): WorkAnalysisEvidence {
  const maxSessions = input.maxSessions ?? 12;
  const maxExcerptsPerSession = input.maxExcerptsPerSession ?? 8;
  const maxTextChars = input.maxTextChars ?? 1_000;
  const newestFirst = [...input.sessions].sort(
    (left, right) => right.lastActiveAt - left.lastActiveAt
  );
  const newestByProvider = new Map<string, WorkLogSession>();

  for (const session of newestFirst) {
    if (!newestByProvider.has(session.providerId)) {
      newestByProvider.set(session.providerId, session);
    }
  }

  const selected = [...newestByProvider.values()];
  for (const session of newestFirst) {
    if (selected.length >= maxSessions) {
      break;
    }
    if (!selected.includes(session)) {
      selected.push(session);
    }
  }

  return {
    sessions: selected.slice(0, maxSessions).map((session) => {
      const evidence = session.evidence?.[0];
      return {
        providerId: session.providerId,
        sessionId: session.sessionId,
        workspacePath: session.workspacePath,
        title: session.title,
        startedAt: session.startedAt,
        lastActiveAt: session.lastActiveAt,
        excerpts: (evidence?.excerpts ?? []).slice(0, maxExcerptsPerSession).map((excerpt) => ({
          ...excerpt,
          text:
            typeof excerpt.text === "string" ? truncateText(excerpt.text, maxTextChars) : undefined,
        })),
      };
    }),
    skillInventory: input.skillInventory,
  };
}
