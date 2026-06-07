import type { ProviderDefinition } from "@coder-studio/core";
import { describe, expect, it, vi } from "vitest";
import { buildWorkDeepAnalysisPrompt } from "../work-analysis/deep-prompt.js";
import { WorkDeepAnalysisRunner } from "../work-analysis/deep-runner.js";
import { workDeepAnalysisResultSchema } from "../work-analysis/deep-schema.js";

describe("work deep analysis prompt", () => {
  it("includes basic analysis and evidence in the prompt", () => {
    const prompt = buildWorkDeepAnalysisPrompt({
      basicResult: {
        availableWorkspacePaths: ["/repo/a", "/repo/b"],
        coverage: {
          workspaceCount: 2,
          sessionCount: 1,
          providerCount: 1,
          timeRangeLabel: "7d",
        },
        activity: {
          sessionCount: 1,
          totalDurationMs: 1000,
          averageDurationMs: 1000,
        },
        workHabits: { hourBuckets: [{ hour: 10, sessionCount: 1 }] },
        skillInventory: { installedCount: 1, mountedCount: 1, unmountedCount: 0 },
        usage: { totalSessions: 1, sessionsByProvider: { codex: 1 } },
        agentModelMix: { providers: [{ providerId: "codex", sessionCount: 1 }] },
        workSurface: { workspacePaths: ["/repo/a", "/repo/b"] },
        executionSignals: {
          sessionsWithActivity: 1,
          userTurnCount: 1,
          assistantTurnCount: 1,
          toolUseCount: 0,
          fileMtimeTimestampCount: 0,
        },
        dataSources: { providers: [] },
        dataQuality: { clampedDurationCount: 0, emptySessionCount: 0 },
      },
      evidence: {
        sessions: [
          {
            providerId: "codex",
            sessionId: "session-1",
            workspacePath: "/repo/project",
            title: "Session",
            startedAt: 100,
            lastActiveAt: 200,
            excerpts: [{ role: "user", text: "investigate" }],
          },
        ],
        skillInventory: {
          installedSkills: [{ slug: "review" }],
          mounts: [{ skillSlug: "review", enabled: true }],
        },
      },
    });

    expect(prompt).toContain("workspaceCount");
    expect(prompt).toContain("excerpts");
  });
});

describe("workDeepAnalysisResultSchema", () => {
  it("accepts valid structured output", () => {
    const result = {
      workSummary: "done",
      repeatedPatterns: [],
      bottlenecks: [],
      workflowSuggestions: [],
      skillCandidates: [],
      openLoops: [],
      followUpSuggestions: [],
      confidence: "high",
    } as const;

    expect(workDeepAnalysisResultSchema.parse(result)).toEqual(result);
  });
});

describe("WorkDeepAnalysisRunner", () => {
  const provider = {
    id: "codex",
    displayName: "Codex",
    badge: "Codex",
    kind: "built_in",
    capability: "full",
    capabilities: [],
    install: {
      prerequisites: [],
      manualGuideKeys: [],
      docUrls: { prerequisites: {} },
      strategies: {},
    },
    buildCommand: () => ({ argv: ["codex"], env: {}, cwd: "/workspace" }),
    configSchema: { parse: (value: unknown) => value } as ProviderDefinition["configSchema"],
    defaultConfig: {},
    requiredCommands: ["codex"],
    headless: {
      supportedScenarios: ["session_analysis"],
      buildCommand: () => ({
        argv: ["codex", "exec"],
        cwd: "/workspace",
        env: {},
      }),
    },
  } satisfies ProviderDefinition;

  const baseInput = {
    providerId: "codex",
    sessionId: "work-analysis-ws-1",
    workspacePath: "/workspace",
    basicResult: {
      availableWorkspacePaths: ["/workspace"],
      coverage: { workspaceCount: 1, sessionCount: 1, providerCount: 1, timeRangeLabel: "7d" },
      activity: { sessionCount: 1, totalDurationMs: 1000, averageDurationMs: 1000 },
      workHabits: { hourBuckets: [{ hour: 10, sessionCount: 1 }] },
      skillInventory: { installedCount: 0, mountedCount: 0, unmountedCount: 0 },
      usage: { totalSessions: 1, sessionsByProvider: { codex: 1 } },
      agentModelMix: { providers: [{ providerId: "codex", sessionCount: 1 }] },
      workSurface: { workspacePaths: ["/workspace"] },
      executionSignals: {
        sessionsWithActivity: 1,
        userTurnCount: 1,
        assistantTurnCount: 1,
        toolUseCount: 0,
        fileMtimeTimestampCount: 0,
      },
      dataSources: { providers: [] },
      dataQuality: { clampedDurationCount: 0, emptySessionCount: 0 },
    },
    evidence: {
      sessions: [
        {
          providerId: "codex",
          sessionId: "session-1",
          workspacePath: "/workspace",
          title: "Session",
          startedAt: 100,
          lastActiveAt: 200,
          excerpts: [{ role: "user", text: "hi" }],
        },
      ],
      skillInventory: { installedSkills: [], mounts: [] },
    },
  };

  it("parses a plain JSON response", async () => {
    const runner = new WorkDeepAnalysisRunner({
      providerRegistry: [provider],
      commandRunner: async () => ({
        stdout: JSON.stringify({
          workSummary: "done",
          repeatedPatterns: [],
          bottlenecks: [],
          workflowSuggestions: [],
          skillCandidates: [],
          openLoops: [],
          followUpSuggestions: [],
          confidence: "high",
        }),
        stderr: "",
      }),
    });

    await expect(runner.run(baseInput)).resolves.toMatchObject({
      workSummary: "done",
      confidence: "high",
    });
  });

  it("parses Codex JSONL output by extracting the completed agent message", async () => {
    const runner = new WorkDeepAnalysisRunner({
      providerRegistry: [provider],
      commandRunner: async () => ({
        stdout: [
          '{"type":"item.started","item":{"type":"agent_message"}}',
          JSON.stringify({
            type: "item.completed",
            item: {
              type: "agent_message",
              text: JSON.stringify({
                workSummary: "done",
                repeatedPatterns: [],
                bottlenecks: [],
                workflowSuggestions: [],
                skillCandidates: [],
                openLoops: [],
                followUpSuggestions: [],
                confidence: "medium",
              }),
            },
          }),
        ].join("\n"),
        stderr: "",
      }),
    });

    await expect(runner.run(baseInput)).resolves.toMatchObject({
      workSummary: "done",
      confidence: "medium",
    });
  });

  it("falls back to the first supported provider when the preferred provider is unsupported", () => {
    const fallbackRunner = new WorkDeepAnalysisRunner({
      providerRegistry: [
        { ...provider, id: "claude" },
        {
          ...provider,
          id: "cursor",
          headless: { supportedScenarios: [], buildCommand: () => null },
        },
      ],
    });

    expect(fallbackRunner.resolveProviderId("cursor")).toBe("claude");
  });
});
