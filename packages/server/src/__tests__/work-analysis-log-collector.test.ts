import { describe, expect, it } from "vitest";

import { createWorkLogCollector } from "../work-analysis/log-sources/collector.js";
import type { ProviderWorkLogSource } from "../work-analysis/log-sources/types.js";

function source(
  input: Awaited<ReturnType<ProviderWorkLogSource["discover"]>>
): ProviderWorkLogSource {
  return {
    providerId: input.providerId,
    discover: async () => input,
  };
}

describe("WorkLogCollector", () => {
  it("collects sessions without a workspace path allowlist", async () => {
    const collector = createWorkLogCollector({
      sources: [
        source({
          providerId: "codex",
          status: "supported",
          parseErrorCount: 0,
          warnings: [],
          sourceRefs: [],
          sessions: [
            {
              providerId: "codex",
              sessionId: "s1",
              workspacePath: "/repo/a",
              startedAt: 1,
              lastActiveAt: 2,
              sourceRef: "a",
              userTurnCount: 0,
              assistantTurnCount: 0,
              toolUseCount: 0,
              parseErrorCount: 0,
              timestampQuality: "explicit",
            },
            {
              providerId: "codex",
              sessionId: "s2",
              workspacePath: "/repo/b",
              startedAt: 3,
              lastActiveAt: 4,
              sourceRef: "b",
              userTurnCount: 0,
              assistantTurnCount: 0,
              toolUseCount: 0,
              parseErrorCount: 0,
              timestampQuality: "explicit",
            },
          ],
        }),
      ],
    });

    const result = await collector.collect({
      timeRange: { startAt: 0, endAt: 10, label: "7d" },
    });

    expect(result.sessions.map((session) => session.workspacePath)).toEqual(["/repo/a", "/repo/b"]);
  });

  it("runs sources, sorts sessions, and reports provider statuses", async () => {
    const collector = createWorkLogCollector({
      sources: [
        source({
          providerId: "codex",
          status: "supported",
          parseErrorCount: 0,
          warnings: [],
          sourceRefs: [
            { providerId: "codex", kind: "file", path: "/b", mtimeMs: 2, sizeBytes: 20 },
          ],
          sessions: [
            {
              providerId: "codex",
              sessionId: "b",
              workspacePath: "/repo",
              startedAt: 20,
              lastActiveAt: 30,
              sourceRef: "/b",
              userTurnCount: 0,
              assistantTurnCount: 0,
              toolUseCount: 0,
              parseErrorCount: 0,
              timestampQuality: "explicit",
            },
          ],
        }),
        source({
          providerId: "claude",
          status: "no_logs",
          parseErrorCount: 0,
          warnings: [],
          sourceRefs: [],
          sessions: [],
        }),
      ],
    });

    const result = await collector.collect({
      timeRange: { startAt: 0, endAt: 100, label: "custom" },
    });

    expect(result.sessions.map((session) => session.sessionId)).toEqual(["b"]);
    expect(result.providers.map((provider) => provider.providerId)).toEqual(["codex", "claude"]);
    expect(result.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes sourceDigest when source refs change", async () => {
    const left = await createWorkLogCollector({
      sources: [
        source({
          providerId: "codex",
          status: "supported",
          parseErrorCount: 0,
          warnings: [],
          sourceRefs: [
            { providerId: "codex", kind: "file", path: "/a", mtimeMs: 1, sizeBytes: 10 },
          ],
          sessions: [],
        }),
      ],
    }).collect({ timeRange: { startAt: 0, endAt: 1, label: "x" } });

    const right = await createWorkLogCollector({
      sources: [
        source({
          providerId: "codex",
          status: "supported",
          parseErrorCount: 0,
          warnings: [],
          sourceRefs: [
            { providerId: "codex", kind: "file", path: "/a", mtimeMs: 2, sizeBytes: 10 },
          ],
          sessions: [],
        }),
      ],
    }).collect({ timeRange: { startAt: 0, endAt: 1, label: "x" } });

    expect(left.sourceDigest).not.toBe(right.sourceDigest);
  });
});
