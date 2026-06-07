import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { analyzeWorkBasic } from "../work-analysis/basic-analyzer.js";
import { createClaudeWorkLogSource } from "../work-analysis/log-sources/claude.js";
import { createCodexWorkLogSource } from "../work-analysis/log-sources/codex.js";

describe("analyzeWorkBasic", () => {
  it("builds snapshotV2 domains from discovered workspaces and session usage", () => {
    const result = analyzeWorkBasic({
      query: { workspacePaths: ["/repo/app"], timeRange: { preset: "7d" as const } },
      timeRange: { startAt: 0, endAt: 10_000, label: "Last 7 days" },
      availableWorkspacePaths: ["/repo/app", "/repo/lib"],
      sessions: [
        {
          sessionId: "session-1",
          workspacePath: "/repo/app",
          providerId: "codex",
          modelId: "gpt-5-codex",
          startedAt: Date.UTC(2026, 5, 1, 12, 0, 0),
          lastActiveAt: Date.UTC(2026, 5, 1, 12, 30, 0),
          usage: {
            inputTokens: 120,
            outputTokens: 55,
            totalTokens: 175,
          },
          usageCoverage: {
            hasUsage: true,
            callCount: 2,
            callsWithTotalTokens: 2,
            estimatedCallCount: 0,
          },
          userTurnCount: 1,
          assistantTurnCount: 1,
          toolUseCount: 1,
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [
            {
              eventId: "event-1",
              providerId: "codex",
              sessionId: "session-1",
              workspacePath: "/repo/app",
              eventType: "command",
              occurredAt: Date.UTC(2026, 5, 1, 12, 5, 0),
              toolName: "shell",
              commandText: "pnpm test",
            },
          ],
        },
      ],
      dataSources: {
        providers: [
          {
            providerId: "codex",
            status: "supported" as const,
            sessionCount: 1,
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

    expect(result.snapshotV2).toMatchObject({
      version: 2,
      query: {
        timeRangeLabel: "Last 7 days",
        selectedWorkspacePaths: ["/repo/app"],
        availableWorkspacePaths: ["/repo/app", "/repo/lib"],
      },
      overview: {
        totals: {
          totalTokens: 175,
          sessionCount: 1,
          workspaceCount: 1,
          providerCount: 1,
          taskTypeCount: 1,
        },
        coverage: {
          usage: {
            sessionCount: 1,
            callCount: 2,
            callsWithTotalTokens: 2,
            estimatedCallCount: 0,
            sessionCoverageRate: 1,
          },
        },
      },
      dataSources: {
        providers: [
          expect.objectContaining({
            providerId: "codex",
            status: "supported",
            sessionCount: 1,
          }),
        ],
      },
    });
    expect(result.snapshotV2?.breakdowns.byWorkspace[0]).toMatchObject({
      key: "/repo/app",
      label: "/repo/app",
      sessionCount: 1,
    });
    expect(result.snapshotV2?.sessions.featured.topByTotalTokens[0]).toMatchObject({
      sessionId: "session-1",
      providerId: "codex",
      workspacePath: "/repo/app",
      totalTokens: 175,
    });
    expect(result.tasks.turns?.[0]).toMatchObject({
      turnId: "session-1:turn:0",
      primaryTask: "testing",
      hasEdits: false,
      retries: 0,
      evidence: expect.arrayContaining(["tool_pattern:test_command"]),
    });
    expect(result.snapshotV2?.tasks).toMatchObject({
      turns: expect.any(Array),
      byTypeAndModel: expect.any(Array),
      byTypeAndWorkspace: expect.any(Array),
    });
    expect(result).not.toHaveProperty("budgets");
    expect(result.snapshotV2?.delivery).not.toHaveProperty("budgets");
    expect(result.coverage.usage).toEqual({
      sessionCount: 1,
      callCount: 2,
      callsWithTotalTokens: 2,
      estimatedCallCount: 0,
      sessionCoverageRate: 1,
    });
  });

  it("computes coverage, durations, ordered hour buckets, and installed-skill mount summaries", () => {
    const result = analyzeWorkBasic({
      query: { workspacePaths: ["/repo/app", "/repo/lib"], timeRange: { preset: "7d" as const } },
      timeRange: { startAt: 0, endAt: 10_000, label: "7d" },
      availableWorkspacePaths: ["/repo/app", "/repo/lib"],
      sessions: [
        {
          sessionId: "sess-1",
          workspacePath: "/repo/app",
          providerId: "codex",
          modelId: "gpt-5-codex",
          startedAt: Date.UTC(2026, 0, 1, 18, 0, 0),
          lastActiveAt: Date.UTC(2026, 0, 1, 18, 30, 0),
          usage: {
            inputTokens: 100,
            cachedInputTokens: 20,
            outputTokens: 60,
            reasoningOutputTokens: 10,
            totalTokens: 190,
          },
          userTurnCount: 2,
          assistantTurnCount: 2,
          toolUseCount: 1,
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [
            {
              eventId: "e1",
              providerId: "codex",
              sessionId: "sess-1",
              workspacePath: "/repo/app",
              eventType: "message",
              occurredAt: Date.UTC(2026, 0, 1, 18, 0, 0),
              role: "user",
              text: "fix failing tests",
            },
            {
              eventId: "e2",
              providerId: "codex",
              sessionId: "sess-1",
              workspacePath: "/repo/app",
              eventType: "command",
              occurredAt: Date.UTC(2026, 0, 1, 18, 5, 0),
              toolName: "shell",
              commandText: "pnpm test",
            },
          ],
        },
        {
          sessionId: "sess-2",
          workspacePath: "/repo/lib",
          providerId: "claude",
          modelId: "claude-sonnet-4-5",
          startedAt: Date.UTC(2026, 0, 1, 3, 15, 0),
          lastActiveAt: Date.UTC(2026, 0, 1, 4, 15, 0),
          usage: {
            inputTokens: 80,
            outputTokens: 50,
            cacheCreationInputTokens: 30,
            cacheReadInputTokens: 40,
          },
          userTurnCount: 2,
          assistantTurnCount: 1,
          toolUseCount: 1,
          parseErrorCount: 0,
          timestampQuality: "file_mtime" as const,
          events: [
            {
              eventId: "e3",
              providerId: "claude",
              sessionId: "sess-2",
              workspacePath: "/repo/lib",
              eventType: "plan",
              occurredAt: Date.UTC(2026, 0, 1, 3, 15, 0),
              role: "assistant",
              text: "plan the refactor and investigate errors",
            },
            {
              eventId: "e4",
              providerId: "claude",
              sessionId: "sess-2",
              workspacePath: "/repo/lib",
              eventType: "tool",
              occurredAt: Date.UTC(2026, 0, 1, 3, 20, 0),
              toolName: "grep",
            },
          ],
        },
        {
          sessionId: "sess-3",
          workspacePath: "/repo/app",
          providerId: "codex",
          modelId: "gpt-5-codex",
          startedAt: Date.UTC(2026, 0, 1, 18, 45, 0),
          lastActiveAt: Date.UTC(2026, 0, 1, 19, 0, 0),
          usage: {
            inputTokens: 40,
            outputTokens: 25,
            totalTokens: 65,
          },
          userTurnCount: 1,
          assistantTurnCount: 1,
          toolUseCount: 0,
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [
            {
              eventId: "e5",
              providerId: "codex",
              sessionId: "sess-3",
              workspacePath: "/repo/app",
              eventType: "message",
              occurredAt: Date.UTC(2026, 0, 1, 18, 45, 0),
              role: "user",
              text: "implement new feature",
            },
          ],
        },
      ],
      dataSources: {
        providers: [
          {
            providerId: "codex",
            status: "supported" as const,
            sessionCount: 2,
            parseErrorCount: 0,
            warningCount: 0,
          },
          {
            providerId: "cursor",
            status: "no_logs" as const,
            sessionCount: 0,
            parseErrorCount: 0,
            warningCount: 0,
          },
          {
            providerId: "opencode",
            status: "supported" as const,
            sessionCount: 0,
            parseErrorCount: 0,
            warningCount: 0,
          },
        ],
      },
      skillInventory: {
        installedSkills: [{ slug: "review" }, { slug: "build" }, { slug: "ship" }],
        mounts: [
          { skillSlug: "review", enabled: true },
          { skillSlug: "review", enabled: true },
          { skillSlug: "build", enabled: false },
          { skillSlug: "ghost", enabled: true },
        ],
      },
    });

    expect(result.coverage.workspaceCount).toBe(2);
    expect(result.coverage.sessionCount).toBe(3);
    expect(result.coverage.providerCount).toBe(2);
    expect(result.activity.sessionCount).toBe(3);
    expect(result.activity.totalDurationMs).toBe(6_300_000);
    expect(result.activity.averageDurationMs).toBe(2_100_000);
    expect(result.workHabits.hourBuckets).toEqual([
      { hour: 3, sessionCount: 1 },
      { hour: 18, sessionCount: 2 },
    ]);
    expect(result.skillInventory.installedCount).toBe(3);
    expect(result.skillInventory.mountedCount).toBe(1);
    expect(result.skillInventory.unmountedCount).toBe(2);
    expect(result.capabilityMatrix.providers).toEqual([
      {
        providerId: "codex",
        workspacePath: "full",
        timestamps: "full",
        sessionCounts: "full",
        toolCounts: "full",
        modelIdentity: "full",
        tokenUsage: "partial",
        cacheUsage: "partial",
        reasoningUsage: "partial",
        costEstimation: "none",
      },
      {
        providerId: "cursor",
        workspacePath: "full",
        timestamps: "partial",
        sessionCounts: "full",
        toolCounts: "full",
        modelIdentity: "none",
        tokenUsage: "none",
        cacheUsage: "none",
        reasoningUsage: "none",
        costEstimation: "none",
      },
      {
        providerId: "opencode",
        workspacePath: "full",
        timestamps: "full",
        sessionCounts: "full",
        toolCounts: "full",
        modelIdentity: "full",
        tokenUsage: "partial",
        cacheUsage: "partial",
        reasoningUsage: "partial",
        costEstimation: "partial",
      },
    ]);
    expect(result.usage).toEqual({
      totalSessions: 3,
      sessionsByProvider: {
        claude: 1,
        codex: 2,
      },
      totals: {
        inputTokens: 220,
        outputTokens: 135,
        cachedInputTokens: 20,
        cacheCreationInputTokens: 30,
        cacheReadInputTokens: 40,
        reasoningOutputTokens: 10,
        totalTokens: 455,
      },
      byDay: [
        {
          day: "2026-01-01",
          sessionCount: 3,
          totals: {
            inputTokens: 220,
            outputTokens: 135,
            cachedInputTokens: 20,
            cacheCreationInputTokens: 30,
            cacheReadInputTokens: 40,
            reasoningOutputTokens: 10,
            totalTokens: 455,
          },
        },
      ],
      byHour: [
        {
          hour: 3,
          sessionCount: 1,
          totals: {
            inputTokens: 80,
            outputTokens: 50,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 30,
            cacheReadInputTokens: 40,
            reasoningOutputTokens: 0,
            totalTokens: 200,
          },
        },
        {
          hour: 18,
          sessionCount: 2,
          totals: {
            inputTokens: 140,
            outputTokens: 85,
            cachedInputTokens: 20,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            reasoningOutputTokens: 10,
            totalTokens: 255,
          },
        },
      ],
      byProvider: [
        {
          providerId: "codex",
          sessionCount: 2,
          totals: {
            inputTokens: 140,
            outputTokens: 85,
            cachedInputTokens: 20,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            reasoningOutputTokens: 10,
            totalTokens: 255,
          },
        },
        {
          providerId: "claude",
          sessionCount: 1,
          totals: {
            inputTokens: 80,
            outputTokens: 50,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 30,
            cacheReadInputTokens: 40,
            reasoningOutputTokens: 0,
            totalTokens: 200,
          },
        },
      ],
      byWorkspace: [
        {
          workspacePath: "/repo/app",
          sessionCount: 2,
          totals: {
            inputTokens: 140,
            outputTokens: 85,
            cachedInputTokens: 20,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            reasoningOutputTokens: 10,
            totalTokens: 255,
          },
        },
        {
          workspacePath: "/repo/lib",
          sessionCount: 1,
          totals: {
            inputTokens: 80,
            outputTokens: 50,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 30,
            cacheReadInputTokens: 40,
            reasoningOutputTokens: 0,
            totalTokens: 200,
          },
        },
      ],
      byModel: [
        {
          modelId: "gpt-5-codex",
          providerId: "codex",
          sessionCount: 2,
          totals: {
            inputTokens: 140,
            outputTokens: 85,
            cachedInputTokens: 20,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            reasoningOutputTokens: 10,
            totalTokens: 255,
          },
        },
        {
          modelId: "claude-sonnet-4-5",
          providerId: "claude",
          sessionCount: 1,
          totals: {
            inputTokens: 80,
            outputTokens: 50,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 30,
            cacheReadInputTokens: 40,
            reasoningOutputTokens: 0,
            totalTokens: 200,
          },
        },
      ],
      byTool: [
        {
          toolName: "grep",
          sessionCount: 1,
          useCount: 1,
          totals: {
            inputTokens: 80,
            outputTokens: 50,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 30,
            cacheReadInputTokens: 40,
            reasoningOutputTokens: 0,
            totalTokens: 200,
          },
        },
        {
          toolName: "shell",
          sessionCount: 1,
          useCount: 1,
          totals: {
            inputTokens: 100,
            outputTokens: 60,
            cachedInputTokens: 20,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            reasoningOutputTokens: 10,
            totalTokens: 190,
          },
        },
      ],
      byCommand: [
        {
          commandLabel: "pnpm test",
          sessionCount: 1,
          useCount: 1,
          totals: {
            inputTokens: 100,
            outputTokens: 60,
            cachedInputTokens: 20,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            reasoningOutputTokens: 10,
            totalTokens: 190,
          },
        },
      ],
      topSessionsByTotalTokens: [
        {
          sessionId: "sess-2",
          providerId: "claude",
          workspacePath: "/repo/lib",
          modelId: "claude-sonnet-4-5",
          totalTokens: 200,
        },
        {
          sessionId: "sess-1",
          providerId: "codex",
          workspacePath: "/repo/app",
          modelId: "gpt-5-codex",
          totalTokens: 190,
        },
        {
          sessionId: "sess-3",
          providerId: "codex",
          workspacePath: "/repo/app",
          modelId: "gpt-5-codex",
          totalTokens: 65,
        },
      ],
    });
    expect(result.tasks).toMatchObject({
      byType: [
        {
          taskType: "planning",
          turnCount: 1,
          sessionCount: 1,
          totals: {
            inputTokens: 80,
            outputTokens: 50,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 30,
            cacheReadInputTokens: 40,
            reasoningOutputTokens: 0,
            totalTokens: 200,
          },
          providerIds: ["claude"],
          modelIds: ["claude-sonnet-4-5"],
          workspacePaths: ["/repo/lib"],
        },
        {
          taskType: "testing",
          turnCount: 1,
          sessionCount: 1,
          totals: {
            inputTokens: 100,
            outputTokens: 60,
            cachedInputTokens: 20,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            reasoningOutputTokens: 10,
            totalTokens: 190,
          },
          providerIds: ["codex"],
          modelIds: ["gpt-5-codex"],
          workspacePaths: ["/repo/app"],
        },
        {
          taskType: "feature_dev",
          turnCount: 1,
          sessionCount: 1,
          totals: {
            inputTokens: 40,
            outputTokens: 25,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 65,
          },
          providerIds: ["codex"],
          modelIds: ["gpt-5-codex"],
          workspacePaths: ["/repo/app"],
        },
      ],
      turns: expect.any(Array),
      byTypeAndModel: expect.any(Array),
      byTypeAndWorkspace: expect.any(Array),
      sessions: [
        {
          sessionId: "sess-2",
          providerId: "claude",
          workspacePath: "/repo/lib",
          modelId: "claude-sonnet-4-5",
          primaryTask: "planning",
          signals: [
            "plan_event",
            "refactor_language",
            "planning_language",
            "exploration_language",
            "tool_activity",
          ],
          totalTokens: 200,
        },
        {
          sessionId: "sess-1",
          providerId: "codex",
          workspacePath: "/repo/app",
          modelId: "gpt-5-codex",
          primaryTask: "testing",
          signals: ["test_command", "debug_language"],
          totalTokens: 190,
        },
        {
          sessionId: "sess-3",
          providerId: "codex",
          workspacePath: "/repo/app",
          modelId: "gpt-5-codex",
          primaryTask: "feature_dev",
          signals: ["feature_language"],
          totalTokens: 65,
        },
      ],
    });
    expect(result.efficiency).toEqual({
      overall: {
        sessionCount: 3,
        averageTokensPerSession: 152,
        averageInputTokensPerSession: 73,
        averageOutputTokensPerSession: 45,
        averageTokensPerToolUse: 228,
        commandSessionRate: 0.333,
        cacheParticipationRate: 0.667,
        editSignalCoverageRate: 0,
        highTokenSessionRate: 0.667,
        toolHeavySessionCount: 0,
        oneShotRate: 0,
        retryRate: 0,
        selfCorrectionRate: 0,
        readToEditRatio: 0,
        commandToEditRatio: 0,
        cacheHitShare: 0,
        gitAwareSessionRate: 0.5,
      },
      byProvider: [
        {
          providerId: "claude",
          summary: {
            sessionCount: 1,
            averageTokensPerSession: 200,
            averageInputTokensPerSession: 80,
            averageOutputTokensPerSession: 50,
            averageTokensPerToolUse: 200,
            commandSessionRate: 0,
            cacheParticipationRate: 1,
            editSignalCoverageRate: 0,
            highTokenSessionRate: 1,
            toolHeavySessionCount: 0,
            oneShotRate: 0,
            retryRate: 0,
            selfCorrectionRate: 0,
            readToEditRatio: 0,
            commandToEditRatio: 0,
            cacheHitShare: 0,
            gitAwareSessionRate: 0,
          },
        },
        {
          providerId: "codex",
          summary: {
            sessionCount: 2,
            averageTokensPerSession: 128,
            averageInputTokensPerSession: 70,
            averageOutputTokensPerSession: 43,
            averageTokensPerToolUse: 255,
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
            gitAwareSessionRate: 0.5,
          },
        },
      ],
      byTask: [
        {
          taskType: "feature_dev",
          summary: {
            sessionCount: 1,
            averageTokensPerSession: 65,
            averageInputTokensPerSession: 40,
            averageOutputTokensPerSession: 25,
            averageTokensPerToolUse: 65,
            commandSessionRate: 0,
            cacheParticipationRate: 0,
            editSignalCoverageRate: 0,
            highTokenSessionRate: 1,
            toolHeavySessionCount: 0,
            oneShotRate: 0,
            retryRate: 0,
            selfCorrectionRate: 0,
            readToEditRatio: 0,
            commandToEditRatio: 0,
            cacheHitShare: 0,
            gitAwareSessionRate: 0,
          },
        },
        {
          taskType: "planning",
          summary: {
            sessionCount: 1,
            averageTokensPerSession: 200,
            averageInputTokensPerSession: 80,
            averageOutputTokensPerSession: 50,
            averageTokensPerToolUse: 200,
            commandSessionRate: 0,
            cacheParticipationRate: 1,
            editSignalCoverageRate: 0,
            highTokenSessionRate: 1,
            toolHeavySessionCount: 0,
            oneShotRate: 0,
            retryRate: 0,
            selfCorrectionRate: 0,
            readToEditRatio: 0,
            commandToEditRatio: 0,
            cacheHitShare: 0,
            gitAwareSessionRate: 0,
          },
        },
        {
          taskType: "testing",
          summary: {
            sessionCount: 1,
            averageTokensPerSession: 190,
            averageInputTokensPerSession: 100,
            averageOutputTokensPerSession: 60,
            averageTokensPerToolUse: 190,
            commandSessionRate: 1,
            cacheParticipationRate: 1,
            editSignalCoverageRate: 0,
            highTokenSessionRate: 1,
            toolHeavySessionCount: 0,
            oneShotRate: 0,
            retryRate: 0,
            selfCorrectionRate: 0,
            readToEditRatio: 0,
            commandToEditRatio: 0,
            cacheHitShare: 0,
            gitAwareSessionRate: 1,
          },
        },
      ],
    });
    expect(result.optimize).toEqual({
      totalFindings: 0,
      totalEstimatedWastedTokens: 0,
      findings: [],
    });
    expect(result.compare).toMatchObject({
      topDimension: "workspace",
      dimensions: {
        workspace: [
          { key: "/repo/app", shareOfTokens: 0.56, averageTokensPerSession: 128 },
          { key: "/repo/lib", shareOfTokens: 0.44, averageTokensPerSession: 200 },
        ],
        provider: [
          { key: "codex", shareOfTokens: 0.56 },
          { key: "claude", shareOfTokens: 0.44 },
        ],
        task: [
          { key: "planning", shareOfTokens: 0.44 },
          { key: "testing", shareOfTokens: 0.418 },
          { key: "feature_dev", shareOfTokens: 0.143 },
        ],
      },
    });
    expect(result.yield?.overall).toMatchObject({
      sessionCount: 3,
      shippedSessionCount: 0,
      shippedSessionRate: 0,
      commandSessionCount: 1,
      averageTokensPerNonShippedSession: 152,
      artifactSessionCount: 1,
      artifactSignalPerThousandTokens: 8.791,
      outputToInputRatio: 0.614,
      gitAwareSessionRate: 0.333,
    });
    expect(result.yield?.topShippedSessions).toEqual([]);
    expect(result.yield?.lowYieldSessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "claude",
          sessionId: "sess-2",
          workspacePath: "/repo/lib",
          taskType: "planning",
          totalTokens: 200,
          missedSignals: ["no_edit", "no_command", "no_git"],
        }),
        expect.objectContaining({
          providerId: "codex",
          sessionId: "sess-1",
          workspacePath: "/repo/app",
          taskType: "testing",
          totalTokens: 190,
          missedSignals: ["no_edit", "no_git"],
        }),
        expect.objectContaining({
          providerId: "codex",
          sessionId: "sess-3",
          workspacePath: "/repo/app",
          taskType: "feature_dev",
          totalTokens: 65,
          missedSignals: ["no_edit", "no_command", "no_git"],
        }),
      ])
    );
    expect(result).not.toHaveProperty("budgets");
    expect(result.agentModelMix.providers).toEqual([
      { providerId: "claude", sessionCount: 1 },
      { providerId: "codex", sessionCount: 2 },
    ]);
    expect(result.availableWorkspacePaths).toEqual(["/repo/app", "/repo/lib"]);
    expect(result.workSurface.workspacePaths).toEqual(["/repo/app", "/repo/lib"]);
    expect(result.executionSignals).toEqual({
      sessionsWithActivity: 3,
      userTurnCount: 5,
      assistantTurnCount: 4,
      toolUseCount: 2,
      fileMtimeTimestampCount: 1,
    });
    expect(result.dataSources.providers).toEqual([
      {
        providerId: "codex",
        status: "supported",
        sessionCount: 2,
        parseErrorCount: 0,
        warningCount: 0,
      },
      {
        providerId: "cursor",
        status: "no_logs",
        sessionCount: 0,
        parseErrorCount: 0,
        warningCount: 0,
      },
      {
        providerId: "opencode",
        status: "supported",
        sessionCount: 0,
        parseErrorCount: 0,
        warningCount: 0,
      },
    ]);
    expect(result.dataQuality).toEqual({
      clampedDurationCount: 0,
      emptySessionCount: 0,
    });
  });

  it("attributes session tokens across tool calls without duplicating totals", () => {
    const result = analyzeWorkBasic({
      query: { timeRange: { preset: "7d" as const } },
      timeRange: { startAt: 0, endAt: 10_000, label: "7d" },
      availableWorkspacePaths: ["/repo/app"],
      sessions: [
        {
          sessionId: "tool-heavy-session",
          workspacePath: "/repo/app",
          providerId: "codex",
          modelId: "gpt-5-codex",
          startedAt: Date.UTC(2026, 5, 1, 10, 0, 0),
          lastActiveAt: Date.UTC(2026, 5, 1, 10, 30, 0),
          usage: {
            inputTokens: 600,
            outputTokens: 400,
            totalTokens: 1_000,
          },
          userTurnCount: 1,
          assistantTurnCount: 1,
          toolUseCount: 3,
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [
            {
              eventId: "tool-1",
              providerId: "codex",
              sessionId: "tool-heavy-session",
              workspacePath: "/repo/app",
              eventType: "tool",
              occurredAt: Date.UTC(2026, 5, 1, 10, 1, 0),
              toolName: "Edit",
            },
            {
              eventId: "tool-2",
              providerId: "codex",
              sessionId: "tool-heavy-session",
              workspacePath: "/repo/app",
              eventType: "command",
              occurredAt: Date.UTC(2026, 5, 1, 10, 2, 0),
              toolName: "Bash",
              commandText: "pnpm test",
            },
            {
              eventId: "tool-3",
              providerId: "codex",
              sessionId: "tool-heavy-session",
              workspacePath: "/repo/app",
              eventType: "tool",
              occurredAt: Date.UTC(2026, 5, 1, 10, 3, 0),
              toolName: "Edit",
            },
          ],
        },
      ],
      skillInventory: {
        installedSkills: [],
        mounts: [],
      },
    });

    const toolTotals = Object.fromEntries(
      result.usage.byTool.map((tool) => [tool.toolName, tool.totals.totalTokens])
    );
    expect(toolTotals).toEqual({
      Edit: 667,
      Bash: 333,
    });
    expect(result.usage.byTool.reduce((sum, tool) => sum + tool.totals.totalTokens, 0)).toBe(
      result.usage.totals.totalTokens
    );

    expect(result.usage.byCommand).toMatchObject([
      {
        commandLabel: "pnpm test",
        totals: {
          totalTokens: 333,
        },
      },
    ]);
  });

  it("surfaces task-3 efficiency metrics in analyzer output", () => {
    const result = analyzeWorkBasic({
      query: { timeRange: { preset: "7d" as const } },
      timeRange: {
        startAt: Date.UTC(2026, 5, 1, 0, 0, 0),
        endAt: Date.UTC(2026, 5, 7, 0, 0, 0),
        label: "7d",
      },
      availableWorkspacePaths: ["/repo/app"],
      sessions: [
        {
          sessionId: "sess-one-shot",
          workspacePath: "/repo/app",
          providerId: "codex",
          modelId: "gpt-5-codex",
          startedAt: Date.UTC(2026, 5, 2, 10, 0, 0),
          lastActiveAt: Date.UTC(2026, 5, 2, 10, 15, 0),
          usage: {
            inputTokens: 100,
            outputTokens: 900,
            cachedInputTokens: 25,
            totalTokens: 1_000,
          },
          userTurnCount: 1,
          assistantTurnCount: 1,
          toolUseCount: 1,
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [
            {
              eventId: "eff-1",
              providerId: "codex",
              sessionId: "sess-one-shot",
              workspacePath: "/repo/app",
              eventType: "message",
              canonicalEventType: "message_turn",
              occurredAt: Date.UTC(2026, 5, 2, 10, 0, 0),
              role: "user",
              rawRefs: [],
            },
            {
              eventId: "eff-2",
              providerId: "codex",
              sessionId: "sess-one-shot",
              workspacePath: "/repo/app",
              eventType: "command",
              canonicalEventType: "command",
              occurredAt: Date.UTC(2026, 5, 2, 10, 5, 0),
              commandText: "pnpm test",
              rawRefs: [],
            },
            {
              eventId: "eff-3",
              providerId: "codex",
              sessionId: "sess-one-shot",
              workspacePath: "/repo/app",
              eventType: "edit",
              canonicalEventType: "edit",
              occurredAt: Date.UTC(2026, 5, 2, 10, 10, 0),
              rawRefs: [],
            },
            {
              eventId: "eff-4",
              providerId: "codex",
              sessionId: "sess-one-shot",
              workspacePath: "/repo/app",
              eventType: "git",
              canonicalEventType: "git_signal",
              occurredAt: Date.UTC(2026, 5, 2, 10, 12, 0),
              rawRefs: [],
            },
            {
              eventId: "eff-usage-1",
              providerId: "codex",
              sessionId: "sess-one-shot",
              workspacePath: "/repo/app",
              eventType: "usage",
              canonicalEventType: "usage",
              occurredAt: Date.UTC(2026, 5, 2, 10, 14, 0),
              tokenUsage: {
                inputTokens: 100,
                outputTokens: 900,
                totalTokens: 1_000,
                cachedInputTokens: 25,
              },
              rawRefs: [],
            },
          ],
        },
        {
          sessionId: "sess-retry-fix",
          workspacePath: "/repo/app",
          providerId: "claude",
          modelId: "claude-sonnet-4-5",
          startedAt: Date.UTC(2026, 5, 2, 11, 0, 0),
          lastActiveAt: Date.UTC(2026, 5, 2, 11, 20, 0),
          usage: {
            inputTokens: 50,
            outputTokens: 900,
            cacheCreationInputTokens: 20,
            cacheReadInputTokens: 30,
            totalTokens: 1_000,
          },
          userTurnCount: 2,
          assistantTurnCount: 2,
          toolUseCount: 1,
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [
            {
              eventId: "eff-5",
              providerId: "claude",
              sessionId: "sess-retry-fix",
              workspacePath: "/repo/app",
              eventType: "message",
              canonicalEventType: "message_turn",
              occurredAt: Date.UTC(2026, 5, 2, 11, 0, 0),
              role: "user",
              rawRefs: [],
            },
            {
              eventId: "eff-6",
              providerId: "claude",
              sessionId: "sess-retry-fix",
              workspacePath: "/repo/app",
              eventType: "message",
              canonicalEventType: "message_turn",
              occurredAt: Date.UTC(2026, 5, 2, 11, 5, 0),
              role: "assistant",
              rawRefs: [],
            },
            {
              eventId: "eff-6b",
              providerId: "claude",
              sessionId: "sess-retry-fix",
              workspacePath: "/repo/app",
              eventType: "message",
              canonicalEventType: "message_turn",
              occurredAt: Date.UTC(2026, 5, 2, 11, 7, 0),
              role: "user",
              rawRefs: [],
            },
            {
              eventId: "eff-6c",
              providerId: "claude",
              sessionId: "sess-retry-fix",
              workspacePath: "/repo/app",
              eventType: "message",
              canonicalEventType: "message_turn",
              occurredAt: Date.UTC(2026, 5, 2, 11, 8, 0),
              role: "assistant",
              rawRefs: [],
            },
            {
              eventId: "eff-7",
              providerId: "claude",
              sessionId: "sess-retry-fix",
              workspacePath: "/repo/app",
              eventType: "command",
              canonicalEventType: "command",
              occurredAt: Date.UTC(2026, 5, 2, 11, 10, 0),
              commandText: "pnpm lint",
              rawRefs: [],
            },
            {
              eventId: "eff-8",
              providerId: "claude",
              sessionId: "sess-retry-fix",
              workspacePath: "/repo/app",
              eventType: "edit",
              canonicalEventType: "edit",
              occurredAt: Date.UTC(2026, 5, 2, 11, 12, 0),
              rawRefs: [],
            },
            {
              eventId: "eff-usage-2",
              providerId: "claude",
              sessionId: "sess-retry-fix",
              workspacePath: "/repo/app",
              eventType: "usage",
              canonicalEventType: "usage",
              occurredAt: Date.UTC(2026, 5, 2, 11, 14, 0),
              tokenUsage: {
                inputTokens: 50,
                outputTokens: 900,
                totalTokens: 1_000,
                cacheCreationInputTokens: 20,
                cacheReadInputTokens: 30,
              },
              rawRefs: [],
            },
          ],
        },
        {
          sessionId: "sess-retry-readonly",
          workspacePath: "/repo/app",
          providerId: "codex",
          modelId: "gpt-5-codex",
          startedAt: Date.UTC(2026, 5, 2, 12, 0, 0),
          lastActiveAt: Date.UTC(2026, 5, 2, 12, 10, 0),
          usage: {
            inputTokens: 100,
            outputTokens: 900,
            cachedInputTokens: 0,
            totalTokens: 1_000,
          },
          userTurnCount: 1,
          assistantTurnCount: 1,
          toolUseCount: 1,
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [
            {
              eventId: "eff-9",
              providerId: "codex",
              sessionId: "sess-retry-readonly",
              workspacePath: "/repo/app",
              eventType: "message",
              canonicalEventType: "message_turn",
              occurredAt: Date.UTC(2026, 5, 2, 12, 0, 0),
              role: "user",
              rawRefs: [],
            },
            {
              eventId: "eff-10",
              providerId: "codex",
              sessionId: "sess-retry-readonly",
              workspacePath: "/repo/app",
              eventType: "message",
              canonicalEventType: "message_turn",
              occurredAt: Date.UTC(2026, 5, 2, 12, 5, 0),
              role: "assistant",
              rawRefs: [],
            },
            {
              eventId: "eff-11",
              providerId: "codex",
              sessionId: "sess-retry-readonly",
              workspacePath: "/repo/app",
              eventType: "command",
              canonicalEventType: "command",
              occurredAt: Date.UTC(2026, 5, 2, 12, 7, 0),
              commandText: "rg TODO src",
              rawRefs: [],
            },
            {
              eventId: "eff-usage-3",
              providerId: "codex",
              sessionId: "sess-retry-readonly",
              workspacePath: "/repo/app",
              eventType: "usage",
              canonicalEventType: "usage",
              occurredAt: Date.UTC(2026, 5, 2, 12, 8, 0),
              tokenUsage: { inputTokens: 100, outputTokens: 900, totalTokens: 1_000 },
              rawRefs: [],
            },
          ],
        },
        {
          sessionId: "sess-no-events",
          workspacePath: "/repo/app",
          providerId: "codex",
          modelId: "gpt-5-codex",
          startedAt: Date.UTC(2026, 5, 2, 13, 0, 0),
          lastActiveAt: Date.UTC(2026, 5, 2, 13, 10, 0),
          usage: {
            inputTokens: 80,
            outputTokens: 20,
            totalTokens: 100,
          },
          userTurnCount: 1,
          assistantTurnCount: 1,
          toolUseCount: 0,
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: undefined,
        },
      ],
      dataSources: {
        providers: [
          {
            providerId: "claude",
            status: "supported" as const,
            sessionCount: 1,
            parseErrorCount: 0,
            warningCount: 0,
          },
          {
            providerId: "codex",
            status: "supported" as const,
            sessionCount: 3,
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

    expect(result.efficiency?.overall).toMatchObject({
      oneShotRate: 0.333,
      retryRate: 0.333,
      selfCorrectionRate: 0.333,
      readToEditRatio: 2,
      commandToEditRatio: 1.5,
      cacheHitShare: 0.231,
      gitAwareSessionRate: 1,
    });
    expect(result.efficiency?.byProvider).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "claude",
          summary: expect.objectContaining({
            retryRate: 1,
            selfCorrectionRate: 1,
            readToEditRatio: 2,
            commandToEditRatio: 1,
            cacheHitShare: 0.5,
            gitAwareSessionRate: 1,
          }),
        }),
        expect.objectContaining({
          providerId: "codex",
          summary: expect.objectContaining({
            oneShotRate: 0.5,
            retryRate: 0,
            selfCorrectionRate: 0,
            readToEditRatio: 2,
            commandToEditRatio: 2,
            cacheHitShare: 0.111,
            gitAwareSessionRate: 1,
          }),
        }),
      ])
    );
    expect(result.tasks.turns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: "sess-one-shot",
          hasEdits: true,
          retries: 0,
        }),
        expect.objectContaining({
          sessionId: "sess-retry-fix",
          hasEdits: true,
          retries: 0,
        }),
      ])
    );
  });

  it("derives retry and per-task one-shot metrics from task turns instead of session-level fallbacks", () => {
    const result = analyzeWorkBasic({
      query: { timeRange: { preset: "7d" as const } },
      timeRange: {
        startAt: Date.UTC(2026, 5, 1, 0, 0, 0),
        endAt: Date.UTC(2026, 5, 7, 0, 0, 0),
        label: "7d",
      },
      availableWorkspacePaths: ["/repo/app"],
      sessions: [
        {
          sessionId: "sess-mixed-turns",
          workspacePath: "/repo/app",
          providerId: "codex",
          modelId: "gpt-5-codex",
          startedAt: Date.UTC(2026, 5, 3, 9, 0, 0),
          lastActiveAt: Date.UTC(2026, 5, 3, 9, 30, 0),
          usage: {
            inputTokens: 120,
            outputTokens: 80,
            totalTokens: 200,
          },
          userTurnCount: 2,
          assistantTurnCount: 2,
          toolUseCount: 4,
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [
            {
              eventId: "mixed-1",
              providerId: "codex",
              sessionId: "sess-mixed-turns",
              workspacePath: "/repo/app",
              eventType: "message",
              canonicalEventType: "message_turn",
              occurredAt: Date.UTC(2026, 5, 3, 9, 0, 0),
              role: "user",
              text: "fix the failing test in foo",
              rawRefs: [],
            },
            {
              eventId: "mixed-2",
              providerId: "codex",
              sessionId: "sess-mixed-turns",
              workspacePath: "/repo/app",
              eventType: "tool",
              canonicalEventType: "tool_call",
              occurredAt: Date.UTC(2026, 5, 3, 9, 1, 0),
              toolName: "Edit",
              filePath: "src/foo.ts",
              rawRefs: [],
            },
            {
              eventId: "mixed-3",
              providerId: "codex",
              sessionId: "sess-mixed-turns",
              workspacePath: "/repo/app",
              eventType: "command",
              canonicalEventType: "command",
              occurredAt: Date.UTC(2026, 5, 3, 9, 2, 0),
              toolName: "Bash",
              commandText: "pnpm test src/foo.test.ts",
              rawRefs: [],
            },
            {
              eventId: "mixed-4",
              providerId: "codex",
              sessionId: "sess-mixed-turns",
              workspacePath: "/repo/app",
              eventType: "tool",
              canonicalEventType: "tool_call",
              occurredAt: Date.UTC(2026, 5, 3, 9, 3, 0),
              toolName: "Edit",
              filePath: "src/foo.ts",
              rawRefs: [],
            },
            {
              eventId: "mixed-5",
              providerId: "codex",
              sessionId: "sess-mixed-turns",
              workspacePath: "/repo/app",
              eventType: "message",
              canonicalEventType: "message_turn",
              occurredAt: Date.UTC(2026, 5, 3, 9, 10, 0),
              role: "user",
              text: "add a new profile card component",
              rawRefs: [],
            },
            {
              eventId: "mixed-6",
              providerId: "codex",
              sessionId: "sess-mixed-turns",
              workspacePath: "/repo/app",
              eventType: "tool",
              canonicalEventType: "tool_call",
              occurredAt: Date.UTC(2026, 5, 3, 9, 11, 0),
              toolName: "Edit",
              filePath: "src/profile-card.tsx",
              rawRefs: [],
            },
          ],
        },
      ],
      dataSources: {
        providers: [
          {
            providerId: "codex",
            status: "supported" as const,
            sessionCount: 1,
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

    expect(result.tasks.turns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: "sess-mixed-turns",
          primaryTask: "debugging",
          hasEdits: true,
          retries: 1,
        }),
        expect.objectContaining({
          sessionId: "sess-mixed-turns",
          primaryTask: "feature_dev",
          hasEdits: true,
          retries: 0,
        }),
      ])
    );
    expect(result.efficiency?.byTask).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskType: "debugging",
          summary: expect.objectContaining({
            oneShotRate: 0,
            retryRate: 1,
          }),
        }),
        expect.objectContaining({
          taskType: "feature_dev",
          summary: expect.objectContaining({
            oneShotRate: 1,
            retryRate: 0,
          }),
        }),
      ])
    );
    expect(result.yield?.byTask).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskType: "debugging",
          turnBehavior: expect.objectContaining({
            turnCount: 1,
            editTurnCount: 1,
            oneShotTurnCount: 0,
            retryTurnCount: 1,
            oneShotRate: 0,
            retryRate: 1,
          }),
        }),
        expect.objectContaining({
          taskType: "feature_dev",
          turnBehavior: expect.objectContaining({
            turnCount: 1,
            editTurnCount: 1,
            oneShotTurnCount: 1,
            retryTurnCount: 0,
            oneShotRate: 1,
            retryRate: 0,
          }),
        }),
      ])
    );
  });

  it("accepts by-task retry rates greater than 1 when a single edit turn retries multiple times", () => {
    const result = analyzeWorkBasic({
      query: { timeRange: { preset: "7d" as const } },
      timeRange: {
        startAt: Date.UTC(2026, 5, 1, 0, 0, 0),
        endAt: Date.UTC(2026, 5, 5, 0, 0, 0),
        label: "7d",
      },
      availableWorkspacePaths: ["/repo/app"],
      sessions: [
        {
          sessionId: "sess-multi-retry",
          providerId: "codex",
          workspacePath: "/repo/app",
          modelId: "gpt-5-codex",
          startedAt: Date.UTC(2026, 5, 3, 10, 0, 0),
          lastActiveAt: Date.UTC(2026, 5, 3, 10, 15, 0),
          usage: {
            inputTokens: 120,
            outputTokens: 55,
            totalTokens: 175,
          },
          userTurnCount: 1,
          assistantTurnCount: 1,
          toolUseCount: 5,
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [
            {
              eventId: "multi-retry-1",
              providerId: "codex",
              sessionId: "sess-multi-retry",
              workspacePath: "/repo/app",
              eventType: "message",
              canonicalEventType: "message_turn",
              role: "user",
              text: "fix the flaky profile card flow",
              occurredAt: Date.UTC(2026, 5, 3, 10, 0, 0),
              rawRefs: [],
            },
            {
              eventId: "multi-retry-2",
              providerId: "codex",
              sessionId: "sess-multi-retry",
              workspacePath: "/repo/app",
              eventType: "tool",
              canonicalEventType: "tool_call",
              occurredAt: Date.UTC(2026, 5, 3, 10, 1, 0),
              toolName: "Edit",
              filePath: "src/profile-card.tsx",
              rawRefs: [],
            },
            {
              eventId: "multi-retry-3",
              providerId: "codex",
              sessionId: "sess-multi-retry",
              workspacePath: "/repo/app",
              eventType: "tool",
              canonicalEventType: "tool_call",
              occurredAt: Date.UTC(2026, 5, 3, 10, 2, 0),
              toolName: "Bash",
              commandText: "pnpm vitest src/profile-card.test.tsx",
              rawRefs: [],
            },
            {
              eventId: "multi-retry-4",
              providerId: "codex",
              sessionId: "sess-multi-retry",
              workspacePath: "/repo/app",
              eventType: "tool",
              canonicalEventType: "tool_call",
              occurredAt: Date.UTC(2026, 5, 3, 10, 3, 0),
              toolName: "Edit",
              filePath: "src/profile-card.tsx",
              rawRefs: [],
            },
            {
              eventId: "multi-retry-5",
              providerId: "codex",
              sessionId: "sess-multi-retry",
              workspacePath: "/repo/app",
              eventType: "tool",
              canonicalEventType: "tool_call",
              occurredAt: Date.UTC(2026, 5, 3, 10, 4, 0),
              toolName: "Bash",
              commandText: "pnpm vitest src/profile-card.test.tsx",
              rawRefs: [],
            },
            {
              eventId: "multi-retry-6",
              providerId: "codex",
              sessionId: "sess-multi-retry",
              workspacePath: "/repo/app",
              eventType: "tool",
              canonicalEventType: "tool_call",
              occurredAt: Date.UTC(2026, 5, 3, 10, 5, 0),
              toolName: "Edit",
              filePath: "src/profile-card.tsx",
              rawRefs: [],
            },
          ],
        },
      ],
      dataSources: {
        providers: [
          {
            providerId: "codex",
            status: "supported" as const,
            sessionCount: 1,
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

    expect(result.tasks.turns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: "sess-multi-retry",
          primaryTask: "debugging",
          retries: 2,
        }),
      ])
    );
    expect(result.efficiency?.byTask).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskType: "debugging",
          summary: expect.objectContaining({
            retryRate: 2,
          }),
        }),
      ])
    );
  });

  it("returns chart-friendly trend and share payloads", () => {
    const result = analyzeWorkBasic({
      query: { timeRange: { preset: "7d" as const } },
      timeRange: {
        startAt: Date.UTC(2026, 5, 1, 0, 0, 0),
        endAt: Date.UTC(2026, 5, 5, 0, 0, 0),
        label: "7d",
      },
      availableWorkspacePaths: ["/repo/a", "/repo/b"],
      sessions: [
        {
          sessionId: "sess-a1",
          workspacePath: "/repo/a",
          providerId: "claude",
          modelId: "anthropic:claude-sonnet-4-5",
          startedAt: Date.UTC(2026, 5, 1, 10, 0, 0),
          lastActiveAt: Date.UTC(2026, 5, 1, 10, 20, 0),
          usage: {
            inputTokens: 120,
            outputTokens: 80,
            totalTokens: 200,
          },
          userTurnCount: 1,
          assistantTurnCount: 1,
          toolUseCount: 0,
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [],
        },
        {
          sessionId: "sess-b1",
          workspacePath: "/repo/b",
          providerId: "codex",
          modelId: "gpt-5-codex",
          startedAt: Date.UTC(2026, 5, 2, 11, 0, 0),
          lastActiveAt: Date.UTC(2026, 5, 2, 11, 30, 0),
          usage: {
            inputTokens: 180,
            outputTokens: 120,
            totalTokens: 300,
          },
          userTurnCount: 1,
          assistantTurnCount: 1,
          toolUseCount: 1,
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [],
        },
        {
          sessionId: "sess-a2",
          workspacePath: "/repo/a",
          providerId: "claude",
          modelId: "anthropic:claude-sonnet-4-5",
          startedAt: Date.UTC(2026, 5, 3, 9, 0, 0),
          lastActiveAt: Date.UTC(2026, 5, 3, 9, 45, 0),
          usage: {
            inputTokens: 240,
            outputTokens: 160,
            totalTokens: 400,
          },
          userTurnCount: 2,
          assistantTurnCount: 2,
          toolUseCount: 1,
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [],
        },
      ],
      skillInventory: {
        installedSkills: [],
        mounts: [],
      },
    });

    expect(result.activity.daily).toEqual([
      { day: "2026-06-01", totalTokens: 200, sessionCount: 1 },
      { day: "2026-06-02", totalTokens: 300, sessionCount: 1 },
      { day: "2026-06-03", totalTokens: 400, sessionCount: 1 },
    ]);
    expect(result.compare.workspaces[0]).toEqual(
      expect.objectContaining({
        workspacePath: "/repo/a",
        totalTokens: 600,
        sharePercent: 66.7,
        sessionCount: 2,
      })
    );
    expect(result.compare.providers[0]).toEqual(
      expect.objectContaining({
        providerId: "claude",
        totalTokens: 600,
        sharePercent: 66.7,
      })
    );
    expect(result.compare.models[0]).toEqual(
      expect.objectContaining({
        providerId: "claude",
        modelId: "anthropic:claude-sonnet-4-5",
        totalTokens: 600,
        sharePercent: 66.7,
      })
    );
    expect(result).not.toHaveProperty("budgets");
  });

  it("clamps negative durations and returns empty aggregates without sessions", () => {
    const result = analyzeWorkBasic({
      query: { timeRange: { preset: "24h" as const } },
      timeRange: { startAt: 100, endAt: 200, label: "24h" },
      availableWorkspacePaths: ["/repo/app"],
      sessions: [
        {
          sessionId: "sess-1",
          workspacePath: "/repo/app",
          providerId: "codex",
          startedAt: 1_000,
          lastActiveAt: 500,
          userTurnCount: 0,
          assistantTurnCount: 0,
          toolUseCount: 0,
          parseErrorCount: 1,
          timestampQuality: "mixed" as const,
        },
      ],
      dataSources: {
        providers: [
          {
            providerId: "codex",
            status: "partial" as const,
            sessionCount: 1,
            parseErrorCount: 1,
            warningCount: 1,
          },
        ],
      },
      skillInventory: {
        installedSkills: [{ slug: "review" }],
        mounts: [{ skillSlug: "review", enabled: false }],
      },
    });

    expect(result.activity.totalDurationMs).toBe(0);
    expect(result.activity.averageDurationMs).toBe(0);
    expect(result.workHabits.hourBuckets).toEqual([{ hour: 0, sessionCount: 1 }]);
    expect(result.skillInventory.mountedCount).toBe(0);
    expect(result.skillInventory.unmountedCount).toBe(1);
    expect(result.executionSignals).toEqual({
      sessionsWithActivity: 0,
      userTurnCount: 0,
      assistantTurnCount: 0,
      toolUseCount: 0,
      fileMtimeTimestampCount: 0,
    });
    expect(result.dataQuality).toEqual({
      clampedDurationCount: 1,
      emptySessionCount: 0,
    });
    expect(result.compare?.dimensions.workspace[0]).toMatchObject({
      key: "/repo/app",
      shareOfTokens: 0,
      averageTokensPerSession: 0,
    });
    expect(result.yield?.overall).toMatchObject({
      sessionCount: 1,
      shippedSessionCount: 0,
      averageTokensPerNonShippedSession: 0,
    });
    expect(result).not.toHaveProperty("budgets");
  });

  it("returns zeroed activity and no hour buckets when there are no sessions", () => {
    const result = analyzeWorkBasic({
      query: { workspacePaths: ["/repo/app"], timeRange: { preset: "7d" as const } },
      timeRange: { startAt: 0, endAt: 10_000, label: "7d" },
      availableWorkspacePaths: ["/repo/app"],
      sessions: [],
      dataSources: {
        providers: [],
      },
      skillInventory: {
        installedSkills: [{ slug: "review" }],
        mounts: [{ skillSlug: "review", enabled: true }],
      },
    });

    expect(result.coverage.sessionCount).toBe(0);
    expect(result.coverage.providerCount).toBe(0);
    expect(result.activity.totalDurationMs).toBe(0);
    expect(result.activity.averageDurationMs).toBe(0);
    expect(result.workHabits.hourBuckets).toEqual([]);
    expect(result.skillInventory.mountedCount).toBe(1);
    expect(result.skillInventory.unmountedCount).toBe(0);
    expect(result.usage).toEqual({
      totalSessions: 0,
      sessionsByProvider: {},
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
      },
      byDay: [],
      byHour: [],
      byProvider: [],
      byWorkspace: [],
      byModel: [],
      byTool: [],
      byCommand: [],
      topSessionsByTotalTokens: [],
    });
    expect(result.tasks).toMatchObject({
      turns: [],
      byType: [],
      byTypeAndModel: [],
      byTypeAndWorkspace: [],
      sessions: [],
    });
    expect(result.efficiency).toEqual({
      overall: {
        sessionCount: 0,
        averageTokensPerSession: 0,
        averageInputTokensPerSession: 0,
        averageOutputTokensPerSession: 0,
        averageTokensPerToolUse: 0,
        commandSessionRate: 0,
        cacheParticipationRate: 0,
        editSignalCoverageRate: 0,
        highTokenSessionRate: 0,
        toolHeavySessionCount: 0,
        oneShotRate: 0,
        retryRate: 0,
        selfCorrectionRate: 0,
        readToEditRatio: 0,
        commandToEditRatio: 0,
        cacheHitShare: 0,
        gitAwareSessionRate: 0,
      },
      byProvider: [],
      byTask: [],
    });
    expect(result.optimize).toEqual({
      totalFindings: 0,
      totalEstimatedWastedTokens: 0,
      findings: [],
    });
    expect(result.compare?.topDimension).toBe("workspace");
    expect(result.yield?.overall).toMatchObject({
      sessionCount: 0,
      shippedSessionCount: 0,
      shippedSessionRate: 0,
      editSessionCount: 0,
      commandSessionCount: 0,
      gitSessionCount: 0,
      artifactSessionCount: 0,
      shippedTokens: 0,
      shippedTokenShare: 0,
      averageTokensPerShippedSession: 0,
      averageTokensPerNonShippedSession: 0,
      outputToInputRatio: 0,
      artifactSignalPerThousandTokens: 0,
      gitAwareSessionRate: 0,
    });
    expect(result).not.toHaveProperty("budgets");
    expect(result.agentModelMix.providers).toEqual([]);
    expect(result.executionSignals).toEqual({
      sessionsWithActivity: 0,
      userTurnCount: 0,
      assistantTurnCount: 0,
      toolUseCount: 0,
      fileMtimeTimestampCount: 0,
    });
    expect(result.dataSources.providers).toEqual([]);
    expect(result.dataQuality).toEqual({
      clampedDurationCount: 0,
      emptySessionCount: 1,
    });
  });

  it("collects ordered canonical events and discovered workspace paths from provider logs", async () => {
    const home = await mkdtemp(join(tmpdir(), "work-analysis-canonical-events-"));

    try {
      const claudeProjectDir = join(home, ".claude", "projects", "project-a");
      const codexSessionDir = join(home, ".codex", "sessions", "2026", "06", "01");
      await mkdir(claudeProjectDir, { recursive: true });
      await mkdir(codexSessionDir, { recursive: true });

      await writeFile(
        join(claudeProjectDir, "claude-session.jsonl"),
        [
          JSON.stringify({
            sessionId: "claude-session",
            cwd: "/root/workspace/a",
            type: "assistant",
            timestamp: "2026-06-02T00:00:03.000Z",
            message: {
              role: "assistant",
              model: "claude-sonnet-4-5",
              usage: { input_tokens: 80, output_tokens: 40 },
              content: [{ type: "text", text: "Working on it" }],
            },
          }),
          JSON.stringify({
            sessionId: "claude-session",
            cwd: "/root/workspace/a",
            type: "user",
            timestamp: "2026-06-02T00:00:01.000Z",
            message: {
              role: "user",
              model: "claude-sonnet-4-5",
              content: [{ type: "text", text: "Fix tests" }],
            },
          }),
          JSON.stringify({
            sessionId: "claude-session",
            cwd: "/root/workspace/a",
            type: "tool",
            timestamp: "2026-06-02T00:00:02.000Z",
            toolUse: { name: "shell", command: "pnpm test" },
          }),
          JSON.stringify({
            sessionId: "claude-session",
            cwd: "/root/workspace/a",
            type: "assistant",
            timestamp: "2026-06-02T00:00:02.000Z",
            message: {
              role: "assistant",
              model: "claude-sonnet-4-5",
              content: [{ type: "text", text: "same-time follow-up" }],
            },
          }),
        ].join("\n")
      );

      await writeFile(
        join(codexSessionDir, "codex-session.jsonl"),
        [
          JSON.stringify({
            timestamp: "2026-06-03T00:00:02.000Z",
            type: "tool_call",
            payload: {
              id: "codex-session",
              cwd: "/root/workspace/b",
              name: "grep",
              text: "src",
              model: "gpt-5-codex",
            },
          }),
          JSON.stringify({
            timestamp: "2026-06-03T00:00:01.000Z",
            type: "user_message",
            payload: {
              id: "codex-session",
              cwd: "/root/workspace/b",
              text: "Investigate regression",
              model: "gpt-5-codex",
            },
          }),
          JSON.stringify({
            timestamp: "2026-06-03T00:00:03.000Z",
            type: "event_msg",
            event: "token_count",
            payload: {
              id: "codex-session",
              cwd: "/root/workspace/b",
              model: "gpt-5-codex",
              input_tokens: 60,
              output_tokens: 20,
              total_tokens: 80,
            },
          }),
          JSON.stringify({
            timestamp: "2026-06-03T00:00:02.000Z",
            type: "assistant_message",
            payload: {
              id: "codex-session",
              cwd: "/root/workspace/b",
              text: "same-time summary",
              model: "gpt-5-codex",
            },
          }),
        ].join("\n")
      );

      const [claudeResult, codexResult] = await Promise.all([
        createClaudeWorkLogSource({ home }).discover({
          timeRange: {
            startAt: Date.UTC(2026, 5, 1),
            endAt: Date.UTC(2026, 5, 4),
            label: "3d",
          },
        }),
        createCodexWorkLogSource({ home }).discover({
          timeRange: {
            startAt: Date.UTC(2026, 5, 1),
            endAt: Date.UTC(2026, 5, 4),
            label: "3d",
          },
        }),
      ]);

      const sessions = [...claudeResult.sessions, ...codexResult.sessions];
      const discoveredWorkspacePaths = [
        ...new Set(sessions.map((session) => session.workspacePath)),
      ].sort();
      const result = analyzeWorkBasic({
        query: { timeRange: { preset: "7d" as const } },
        timeRange: { startAt: Date.UTC(2026, 5, 1), endAt: Date.UTC(2026, 5, 4), label: "3d" },
        availableWorkspacePaths: discoveredWorkspacePaths,
        sessions,
        dataSources: {
          providers: [
            {
              providerId: "claude",
              status: claudeResult.status,
              sessionCount: claudeResult.sessions.length,
              parseErrorCount: claudeResult.parseErrorCount,
              warningCount: claudeResult.warnings.length,
            },
            {
              providerId: "codex",
              status: codexResult.status,
              sessionCount: codexResult.sessions.length,
              parseErrorCount: codexResult.parseErrorCount,
              warningCount: codexResult.warnings.length,
            },
          ],
        },
        skillInventory: {
          installedSkills: [],
          mounts: [],
        },
      });

      expect(discoveredWorkspacePaths).toEqual(["/root/workspace/a", "/root/workspace/b"]);
      expect(result.availableWorkspacePaths).toEqual(["/root/workspace/a", "/root/workspace/b"]);
      expect(result.usage.byDay).toEqual([
        expect.objectContaining({ day: "2026-06-02", sessionCount: 1 }),
        expect.objectContaining({ day: "2026-06-03", sessionCount: 1 }),
      ]);
      expect(result.capabilityMatrix.providers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ providerId: "claude" }),
          expect.objectContaining({ providerId: "codex" }),
        ])
      );

      expect(claudeResult.sessions[0]?.events?.map((event) => event.canonicalEventType)).toEqual([
        "message_turn",
        "command",
        "message_turn",
        "message_turn",
        "usage",
      ]);
      expect(codexResult.sessions[0]?.events?.map((event) => event.canonicalEventType)).toEqual([
        "message_turn",
        "tool_call",
        "message_turn",
        "usage",
      ]);
      expect(
        claudeResult.sessions[0]?.events?.map((event) => event.text ?? event.commandText)
      ).toEqual(["Fix tests", "pnpm test", "same-time follow-up", "Working on it", undefined]);
      expect(codexResult.sessions[0]?.events?.map((event) => event.text ?? event.toolName)).toEqual(
        ["Investigate regression", "Grep", "same-time summary", undefined]
      );
      expect(claudeResult.sessions[0]?.events?.every((event) => event.rawRefs?.length === 1)).toBe(
        true
      );
      expect(codexResult.sessions[0]?.events?.every((event) => event.rawRefs?.length === 1)).toBe(
        true
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
