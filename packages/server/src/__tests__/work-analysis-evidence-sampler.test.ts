import { describe, expect, it } from "vitest";

import { sampleWorkLogEvidence } from "../work-analysis/evidence-sampler.js";
import type { WorkLogSession } from "../work-analysis/log-sources/types.js";

function session(
  id: string,
  providerId: WorkLogSession["providerId"],
  lastActiveAt: number
): WorkLogSession {
  return {
    providerId,
    sessionId: id,
    workspacePath: "/repo/app",
    startedAt: lastActiveAt - 100,
    lastActiveAt,
    sourceRef: `/logs/${id}`,
    title: id,
    userTurnCount: 1,
    assistantTurnCount: 1,
    toolUseCount: 1,
    parseErrorCount: 0,
    timestampQuality: "explicit",
    evidence: [
      {
        providerId,
        sessionId: id,
        workspacePath: "/repo/app",
        startedAt: lastActiveAt - 100,
        lastActiveAt,
        excerpts: [
          { role: "user", text: "x".repeat(1000) },
          { role: "tool", toolName: "shell", commandKind: "test" },
        ],
      },
    ],
  };
}

describe("sampleWorkLogEvidence", () => {
  it("caps excerpts and truncates long text", () => {
    const result = sampleWorkLogEvidence({
      sessions: [session("s1", "codex", 100)],
      skillInventory: { installedSkills: [], mounts: [] },
      maxSessions: 1,
      maxExcerptsPerSession: 1,
      maxTextChars: 20,
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.excerpts).toHaveLength(1);
    expect(result.sessions[0]?.excerpts?.[0]?.text?.length).toBeLessThanOrEqual(20);
  });

  it("keeps provider diversity before filling remaining slots", () => {
    const result = sampleWorkLogEvidence({
      sessions: [
        session("old-codex", "codex", 10),
        session("new-codex", "codex", 30),
        session("claude", "claude", 20),
      ],
      skillInventory: { installedSkills: [], mounts: [] },
      maxSessions: 2,
      maxExcerptsPerSession: 2,
      maxTextChars: 100,
    });

    expect(new Set(result.sessions.map((entry) => entry.providerId))).toEqual(
      new Set(["codex", "claude"])
    );
  });
});
