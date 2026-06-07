import { describe, expect, it } from "vitest";

import { analyzeWorkBasic } from "../work-analysis/basic-analyzer.js";
import {
  summarizeEfficiency,
  usageTotalsToEfficiencyInput,
} from "../work-analysis/metrics/token-efficiency.js";
import { findHighCostLowYieldSessions } from "../work-analysis/metrics/yield.js";
import { detectOptimizeFindings } from "../work-analysis/optimize/detect-findings.js";

describe("work analysis efficiency helpers", () => {
  it("summarizes token efficiency across sessions", () => {
    const result = summarizeEfficiency([
      usageTotalsToEfficiencyInput({
        sessionId: "s1",
        providerId: "codex",
        taskType: "testing",
        totals: {
          inputTokens: 100,
          outputTokens: 40,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 20,
          cacheReadInputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 160,
        },
        toolUseCount: 2,
        hasCommandSignal: true,
        hasEditSignal: false,
      }),
      usageTotalsToEfficiencyInput({
        sessionId: "s2",
        providerId: "claude",
        taskType: "planning",
        totals: {
          inputTokens: 50,
          outputTokens: 20,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 70,
        },
        toolUseCount: 0,
        hasCommandSignal: false,
        hasEditSignal: false,
      }),
    ]);

    expect(result).toEqual({
      sessionCount: 2,
      averageTokensPerSession: 115,
      averageInputTokensPerSession: 75,
      averageOutputTokensPerSession: 30,
      averageTokensPerToolUse: 115,
      commandSessionRate: 0.5,
      cacheParticipationRate: 0.5,
      editSignalCoverageRate: 0,
      highTokenSessionRate: 0.5,
      toolHeavySessionCount: 0,
      oneShotRate: 0,
      retryRate: 0,
      selfCorrectionRate: 0,
      readToEditRatio: 0,
      commandToEditRatio: 0,
      cacheHitShare: 0,
      gitAwareSessionRate: 0,
    });
  });

  it("uses only analyzable event sessions for event-derived rate denominators", () => {
    const result = summarizeEfficiency([
      usageTotalsToEfficiencyInput({
        sessionId: "s-analyzable",
        providerId: "codex",
        taskType: "testing",
        totals: {
          inputTokens: 100,
          outputTokens: 20,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 120,
        },
        toolUseCount: 1,
        hasCommandSignal: true,
        hasEditSignal: true,
        events: [
          { canonicalEventType: "message_turn", role: "user" },
          { canonicalEventType: "message_turn", role: "assistant" },
          { canonicalEventType: "command" },
          { canonicalEventType: "edit" },
        ],
      }),
      usageTotalsToEfficiencyInput({
        sessionId: "s-missing-events",
        providerId: "claude",
        taskType: "planning",
        totals: {
          inputTokens: 50,
          outputTokens: 10,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 60,
        },
        toolUseCount: 0,
        hasCommandSignal: false,
        hasEditSignal: false,
      }),
    ]);

    expect(result.oneShotRate).toBe(1);
    expect(result.retryRate).toBe(0);
    expect(result.selfCorrectionRate).toBe(0);
    expect(result.gitAwareSessionRate).toBe(1);
  });
});

describe("work analysis optimize detectors", () => {
  it("detects missing provider usage and token-heavy low-yield sessions", () => {
    const findings = detectOptimizeFindings({
      providers: [
        {
          providerId: "codex",
          sessionCount: 3,
          totals: {
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 0,
          },
        },
      ],
      sessions: [
        {
          sessionId: "s-heavy",
          providerId: "claude",
          workspacePath: "/repo/app",
          taskType: "debugging",
          supportsLowYieldInference: true,
          toolUseCount: 4,
          parseErrorCount: 0,
          hasCommandSignal: true,
          hasEditSignal: false,
          hasGitSignal: false,
          totals: {
            inputTokens: 120_000,
            outputTokens: 10_000,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 130_000,
          },
        },
      ],
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "high-cost-low-yield",
          type: "high_cost_low_yield",
          severity: "high",
        }),
        expect.objectContaining({
          type: "tool_heavy_low_output",
        }),
        expect.objectContaining({
          type: "provider_missing_usage",
        }),
      ])
    );
    expect(
      findings.find((finding) => finding.type === "tool_heavy_low_output")?.estimatedWastedTokens
    ).toBeGreaterThan(0);
  });

  it("detects expensive low-yield sessions using the same shipped-session rules as yield", () => {
    const lowYieldSessions = findHighCostLowYieldSessions([
      {
        sessionId: "sess-edit-no-ship",
        providerId: "codex",
        workspacePath: "/repo/app",
        taskType: "debugging",
        totals: {
          inputTokens: 45_000,
          outputTokens: 0,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 5_000,
          cacheReadInputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 50_000,
        },
        hasEditSignal: true,
        hasCommandSignal: false,
        hasGitSignal: false,
      },
    ]);

    expect(lowYieldSessions).toEqual([
      expect.objectContaining({
        sessionId: "sess-edit-no-ship",
        totalTokens: 50_000,
      }),
    ]);
  });

  it("flags high-cost low-yield sessions in optimize findings", () => {
    const result = runBasicAnalysis(makeLowYieldFixture());

    expect(result.optimize.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "high-cost-low-yield",
          type: "high_cost_low_yield",
          severity: "high",
        }),
      ])
    );
    expect(result.yield.lowYieldSessions.length).toBeGreaterThan(0);
  });

  it("does not emit high-cost low-yield findings when the source is only partial", () => {
    const result = runBasicAnalysis(makeLowYieldFixture(), "partial");

    expect(result.optimize.findings.some((finding) => finding.type === "high_cost_low_yield")).toBe(
      false
    );
    expect(result.yield.lowYieldSessions).toEqual([
      expect.objectContaining({
        sessionId: "sess-expensive-low-yield",
      }),
    ]);
  });

  it("does not emit high-cost low-yield findings for sessions with parse errors", () => {
    const findings = detectOptimizeFindings({
      providers: [],
      sessions: [
        {
          sessionId: "s-parse-errors",
          providerId: "codex",
          workspacePath: "/repo/app",
          taskType: "debugging",
          supportsLowYieldInference: true,
          toolUseCount: 1,
          parseErrorCount: 2,
          hasCommandSignal: false,
          hasEditSignal: false,
          hasGitSignal: false,
          totals: {
            inputTokens: 45_000,
            outputTokens: 0,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 5_000,
            cacheReadInputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 50_000,
          },
        },
      ],
    });

    expect(findings.some((finding) => finding.type === "high_cost_low_yield")).toBe(false);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "parse_error_hotspot",
        }),
      ])
    );
  });
});

function runBasicAnalysis(
  sessions: Parameters<typeof analyzeWorkBasic>[0]["sessions"],
  providerStatus: "supported" | "partial" = "supported"
): ReturnType<typeof analyzeWorkBasic> {
  return analyzeWorkBasic({
    query: { timeRange: { preset: "7d" } },
    timeRange: {
      startAt: Date.UTC(2026, 5, 1, 0, 0, 0),
      endAt: Date.UTC(2026, 5, 7, 0, 0, 0),
      label: "7d",
    },
    availableWorkspacePaths: ["/repo/app"],
    sessions,
    dataSources: {
      providers: [
        {
          providerId: "codex",
          status: providerStatus,
          sessionCount: sessions.length,
          parseErrorCount: 0,
          warningCount: 0,
        },
      ],
    },
    skillInventory: {
      installedSkills: [],
      mounts: [],
    },
  });
}

function makeLowYieldFixture(): Parameters<typeof analyzeWorkBasic>[0]["sessions"] {
  return [
    {
      sessionId: "sess-expensive-low-yield",
      workspacePath: "/repo/app",
      providerId: "codex",
      modelId: "gpt-5-codex",
      startedAt: Date.UTC(2026, 5, 2, 10, 0, 0),
      lastActiveAt: Date.UTC(2026, 5, 2, 10, 45, 0),
      usage: {
        inputTokens: 40_000,
        outputTokens: 0,
        cacheCreationInputTokens: 10_000,
        totalTokens: 50_000,
      },
      userTurnCount: 2,
      assistantTurnCount: 2,
      toolUseCount: 1,
      parseErrorCount: 0,
      timestampQuality: "explicit" as const,
      events: [
        {
          eventId: "evt-1",
          providerId: "codex",
          sessionId: "sess-expensive-low-yield",
          workspacePath: "/repo/app",
          eventType: "message",
          canonicalEventType: "message_turn",
          occurredAt: Date.UTC(2026, 5, 2, 10, 0, 0),
          role: "user",
          text: "investigate the codebase",
          rawRefs: [],
        },
        {
          eventId: "evt-2",
          providerId: "codex",
          sessionId: "sess-expensive-low-yield",
          workspacePath: "/repo/app",
          eventType: "edit",
          canonicalEventType: "edit",
          occurredAt: Date.UTC(2026, 5, 2, 10, 10, 0),
          text: "updated notes without producing output",
          rawRefs: [],
        },
        {
          eventId: "evt-3",
          providerId: "codex",
          sessionId: "sess-expensive-low-yield",
          workspacePath: "/repo/app",
          eventType: "usage",
          canonicalEventType: "usage",
          occurredAt: Date.UTC(2026, 5, 2, 10, 12, 0),
          tokenUsage: {
            inputTokens: 40_000,
            outputTokens: 0,
            cacheCreationInputTokens: 10_000,
            totalTokens: 50_000,
          },
          rawRefs: [],
        },
      ],
    },
  ];
}
