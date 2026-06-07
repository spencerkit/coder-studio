import { describe, expect, it, vi } from "vitest";
import { buildSessionAnalysisDigest } from "../session-analysis/runner.js";
import { SessionAnalysisService } from "../session-analysis/service.js";
import type { SessionAnalysisContext, SessionAnalysisResult } from "../session-analysis/types.js";

function createContext(): SessionAnalysisContext {
  return {
    sessionId: "sess-1",
    workspaceId: "ws-1",
    workspacePath: "/repo/project",
    providerId: "codex",
    sessionState: "ended",
    sessionTitle: "fix tests",
    startedAt: 100,
    lastActiveAt: 200,
    changedFiles: ["a.ts"],
    gitStatus: " M a.ts",
    diffSummary: "1 file changed",
    latestUserInput: "fix tests",
  };
}

function createResult(): SessionAnalysisResult {
  return {
    summary: "summary",
    recentWork: ["did work"],
    repeatedTopics: [],
    bottlenecks: [],
    skillCandidates: [],
    openLoops: [],
    wrapUpSuggestions: [],
    confidence: "medium",
  };
}

describe("SessionAnalysisService", () => {
  it("returns a cached succeeded record when the digest is unchanged", async () => {
    const context = createContext();
    const transcript = "same transcript";
    const repo = {
      findBySessionId: vi.fn(() => ({
        sessionId: "sess-1",
        workspaceId: "ws-1",
        providerId: "codex",
        status: "succeeded" as const,
        inputDigest: buildSessionAnalysisDigest({
          context,
          transcript,
        }),
        result: createResult(),
      })),
      upsert: vi.fn(),
    };

    const service = new SessionAnalysisService({
      repo,
      sessionMgr: {} as never,
      workspaceMgr: {} as never,
      runner: { run: vi.fn() },
      collectContext: vi.fn(async () => context),
      readTranscript: vi.fn(async () => ({
        providerId: "codex",
        sessionId: "sess-1",
        path: "/tmp/sess-1.jsonl",
        content: transcript,
      })),
    });

    const result = await service.run({ sessionId: "sess-1" });
    expect(result.status).toBe("succeeded");
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it("persists running and succeeded states around the headless analysis", async () => {
    const upsert = vi.fn((record) => record);
    const runner = { run: vi.fn(async () => createResult()) };
    const service = new SessionAnalysisService({
      repo: {
        findBySessionId: vi.fn(() => undefined),
        upsert,
      },
      sessionMgr: {} as never,
      workspaceMgr: {} as never,
      runner,
      now: vi.fn(() => 1234),
      collectContext: vi.fn(async () => createContext()),
      readTranscript: vi.fn(async () => ({
        providerId: "codex",
        sessionId: "sess-1",
        path: "/tmp/sess-1.jsonl",
        content: "transcript",
      })),
    });

    const result = await service.run({ sessionId: "sess-1" });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("succeeded");
    expect(result.result).toEqual(createResult());
    expect(runner.run).toHaveBeenCalledOnce();
  });

  it("persists a failed record when the runner throws", async () => {
    const upsert = vi.fn((record) => record);
    const service = new SessionAnalysisService({
      repo: {
        findBySessionId: vi.fn(() => undefined),
        upsert,
      },
      sessionMgr: {} as never,
      workspaceMgr: {} as never,
      runner: {
        run: vi.fn(async () => {
          throw new Error("boom");
        }),
      },
      now: vi.fn(() => 1234),
      collectContext: vi.fn(async () => createContext()),
      readTranscript: vi.fn(async () => ({
        providerId: "codex",
        sessionId: "sess-1",
        path: "/tmp/sess-1.jsonl",
        content: "transcript",
      })),
    });

    const result = await service.run({ sessionId: "sess-1" });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("boom");
  });
});
