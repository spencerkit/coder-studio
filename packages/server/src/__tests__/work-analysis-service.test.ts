import { describe, expect, it, vi } from "vitest";

import { WorkAnalysisService } from "../work-analysis/service.js";
import type { WorkAnalysisHourlyIndex } from "../work-analysis/types.js";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

describe("WorkAnalysisService", () => {
  it("refreshes a dashboard projection with token trend and contribution rankings", async () => {
    const collect = vi.fn(async () => ({
      sourceDigest: "source-dashboard",
      providers: [
        {
          providerId: "codex" as const,
          status: "supported" as const,
          sessions: [],
          sourceRefs: [],
          parseErrorCount: 0,
          warnings: [],
        },
        {
          providerId: "claude" as const,
          status: "supported" as const,
          sessions: [],
          sourceRefs: [],
          parseErrorCount: 0,
          warnings: [],
        },
      ],
      sessions: [
        {
          providerId: "codex" as const,
          sessionId: "codex-1",
          workspacePath: "/repo/app",
          startedAt: Date.UTC(2026, 5, 1, 10, 10),
          lastActiveAt: Date.UTC(2026, 5, 1, 10, 40),
          sourceRef: "codex-1",
          modelId: "gpt-5-codex",
          userTurnCount: 2,
          assistantTurnCount: 2,
          toolUseCount: 1,
          usage: {
            inputTokens: 800,
            outputTokens: 150,
            reasoningOutputTokens: 50,
            totalTokens: 1_000,
          },
          usageCoverage: {
            hasUsage: true,
            callCount: 1,
            callsWithTotalTokens: 1,
            estimatedCallCount: 0,
          },
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [
            {
              eventId: "codex-skill-1",
              providerId: "codex" as const,
              sessionId: "codex-1",
              workspacePath: "/repo/app",
              eventType: "tool" as const,
              canonicalEventType: "tool_call" as const,
              occurredAt: Date.UTC(2026, 5, 1, 10, 20),
              toolName: "Skill",
              toolCategory: "skill" as const,
              payload: { input: { skill: "frontend-design" } },
              rawRefs: ["codex-1"],
            },
            {
              eventId: "codex-read-1",
              providerId: "codex" as const,
              sessionId: "codex-1",
              workspacePath: "/repo/app",
              eventType: "tool" as const,
              canonicalEventType: "tool_call" as const,
              occurredAt: Date.UTC(2026, 5, 1, 10, 22),
              toolName: "Read",
              toolCategory: "read" as const,
              rawRefs: ["codex-1"],
            },
            {
              eventId: "codex-skill-2",
              providerId: "codex" as const,
              sessionId: "codex-1",
              workspacePath: "/repo/app",
              eventType: "tool" as const,
              canonicalEventType: "tool_call" as const,
              occurredAt: Date.UTC(2026, 5, 1, 10, 25),
              toolName: "Skill",
              toolCategory: "skill" as const,
              payload: { arguments: JSON.stringify({ skill: "frontend-design" }) },
              rawRefs: ["codex-1"],
            },
          ],
        },
        {
          providerId: "claude" as const,
          sessionId: "claude-1",
          workspacePath: "/repo/lib",
          startedAt: Date.UTC(2026, 5, 1, 11, 5),
          lastActiveAt: Date.UTC(2026, 5, 1, 12, 5),
          sourceRef: "claude-1",
          modelId: "sonnet-4.5",
          userTurnCount: 1,
          assistantTurnCount: 1,
          toolUseCount: 0,
          usage: {
            inputTokens: 400,
            outputTokens: 80,
            cacheReadInputTokens: 20,
            totalTokens: 500,
          },
          usageCoverage: {
            hasUsage: true,
            callCount: 1,
            callsWithTotalTokens: 1,
            estimatedCallCount: 0,
          },
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [
            {
              eventId: "claude-skill-1",
              providerId: "claude" as const,
              sessionId: "claude-1",
              workspacePath: "/repo/lib",
              eventType: "tool" as const,
              canonicalEventType: "tool_call" as const,
              occurredAt: Date.UTC(2026, 5, 1, 11, 25),
              toolName: "Skill",
              toolCategory: "skill" as const,
              payload: { input: { skill: "superpowers:systematic-debugging" } },
              rawRefs: ["claude-1"],
            },
          ],
        },
      ],
    }));

    const service = new WorkAnalysisService({
      repo: {
        findByQueryDigest: vi.fn(() => undefined),
        upsert: vi.fn((record) => record),
      },
      workspaceMgr: { get: vi.fn() },
      workLogCollector: { collect },
      skillLibraryRepo: { list: vi.fn(() => []) },
      skillMountRepo: { list: vi.fn(() => []) },
      deepRunner: {
        run: vi.fn(),
      },
      now: () => Date.UTC(2026, 5, 6, 10),
    });

    const dashboard = await service.refreshDashboard({ timeRange: { preset: "7d" } }, "manual");

    expect(dashboard.scanState.status).toBe("succeeded");
    expect(dashboard.dashboard.kpis.find((item) => item.key === "totalTokens")?.value).toBe(1_500);
    expect(dashboard.dashboard.trends.tokenHourly).toEqual([
      expect.objectContaining({
        hourStart: Date.UTC(2026, 5, 1, 10),
        totalTokens: 1_000,
        sessionCount: 1,
      }),
      expect.objectContaining({
        hourStart: Date.UTC(2026, 5, 1, 11),
        totalTokens: 500,
        sessionCount: 1,
      }),
    ]);
    expect(dashboard.dashboard.rankings.projects.map((entry) => entry.label)).toEqual([
      "/repo/app",
      "/repo/lib",
    ]);
    expect(dashboard.dashboard.rankings.models.map((entry) => entry.label)).toEqual([
      "codex / gpt-5-codex",
      "claude / sonnet-4.5",
    ]);
    expect(dashboard.dashboard.rankings.agents.map((entry) => entry.label)).toEqual([
      "codex",
      "claude",
    ]);
    expect(dashboard.dashboard.breakdowns.skills).toEqual([
      expect.objectContaining({
        key: "frontend-design",
        label: "frontend-design",
        callCount: 2,
        sessionCount: 1,
        shareOfCalls: 2 / 3,
        providerIds: ["codex"],
      }),
      expect.objectContaining({
        key: "superpowers:systematic-debugging",
        label: "superpowers:systematic-debugging",
        callCount: 1,
        sessionCount: 1,
        shareOfCalls: 1 / 3,
        providerIds: ["claude"],
      }),
    ]);
    expect(dashboard.dashboard.breakdowns.tools.map((tool) => tool.key)).not.toContain("Skill");
    expect(dashboard.mode).toBe("manual");
    expect(dashboard.scanState.sourceDigest).toBe("source-dashboard");
  });

  it("only promotes provider parse failures to dashboard warnings", async () => {
    const collect = vi.fn(async () => ({
      sourceDigest: "source-quality",
      providers: [
        {
          providerId: "codex" as const,
          status: "no_logs" as const,
          sessions: [],
          sourceRefs: [],
          parseErrorCount: 0,
          warnings: [],
        },
        {
          providerId: "gemini" as const,
          status: "missing_root" as const,
          sessions: [],
          sourceRefs: [],
          parseErrorCount: 0,
          warnings: [],
        },
        {
          providerId: "opencode" as const,
          status: "unsupported" as const,
          sessions: [],
          sourceRefs: [],
          parseErrorCount: 0,
          warnings: [
            {
              code: "sqlite_unavailable",
              message: "sqlite3 CLI is unavailable",
            },
          ],
        },
        {
          providerId: "cursor" as const,
          status: "partial" as const,
          sessions: [],
          sourceRefs: [],
          parseErrorCount: 2,
          warnings: [
            {
              code: "parse_error",
              message: "Failed to parse Cursor transcript",
            },
          ],
        },
      ],
      sessions: [],
    }));

    const service = new WorkAnalysisService({
      repo: {
        findByQueryDigest: vi.fn(() => undefined),
        upsert: vi.fn((record) => record),
      },
      workspaceMgr: { get: vi.fn() },
      workLogCollector: { collect },
      skillLibraryRepo: { list: vi.fn(() => []) },
      skillMountRepo: { list: vi.fn(() => []) },
      deepRunner: {
        run: vi.fn(),
      },
      now: () => Date.UTC(2026, 5, 6, 10),
    });

    const dashboard = await service.refreshDashboard({ timeRange: { preset: "7d" } }, "manual");

    expect(dashboard.dashboard.quality.providers.map((provider) => provider.status)).toEqual([
      "no_logs",
      "missing_root",
      "unsupported",
      "partial",
    ]);
    expect(
      dashboard.scanState.providerStatuses.find((provider) => provider.providerId === "cursor")
    ).toMatchObject({
      warnings: [
        {
          code: "parse_error",
          message: "Failed to parse Cursor transcript",
        },
      ],
    });
    expect(dashboard.dashboard.quality.warnings).toEqual([
      "cursor: Failed to parse Cursor transcript",
    ]);
  });

  it("builds a filtered dashboard from the hourly index without rescanning provider logs", async () => {
    const collect = vi.fn();
    const service = new WorkAnalysisService({
      repo: {
        findByQueryDigest: vi.fn(() => undefined),
        upsert: vi.fn((record) => record),
        findHourlyIndex: vi.fn(() => ({
          version: 1,
          bucketMode: "hourly_session_slices",
          indexedAt: Date.UTC(2026, 5, 7, 3),
          indexedThroughHourStart: Date.UTC(2026, 5, 7, 3),
          sourceDigest: "hourly-index-1",
          providerStatuses: [
            {
              providerId: "codex",
              status: "supported",
              sessionCount: 2,
              parseErrorCount: 0,
              warningCount: 0,
            },
          ],
          buckets: [
            {
              hourStart: Date.UTC(2026, 5, 7, 1),
              sessions: [
                {
                  providerId: "codex" as const,
                  sessionId: "codex-app",
                  workspacePath: "/repo/app",
                  startedAt: Date.UTC(2026, 5, 7, 1, 10),
                  lastActiveAt: Date.UTC(2026, 5, 7, 1, 40),
                  sourceRef: "codex-app",
                  modelId: "gpt-5-codex",
                  userTurnCount: 1,
                  assistantTurnCount: 1,
                  toolUseCount: 1,
                  usage: {
                    inputTokens: 800,
                    outputTokens: 200,
                    totalTokens: 1_000,
                  },
                  usageCoverage: {
                    hasUsage: true,
                    callCount: 1,
                    callsWithTotalTokens: 1,
                    estimatedCallCount: 0,
                  },
                  parseErrorCount: 0,
                  timestampQuality: "explicit" as const,
                  events: [],
                },
                {
                  providerId: "codex" as const,
                  sessionId: "codex-lib",
                  workspacePath: "/repo/lib",
                  startedAt: Date.UTC(2026, 5, 7, 1, 20),
                  lastActiveAt: Date.UTC(2026, 5, 7, 1, 50),
                  sourceRef: "codex-lib",
                  modelId: "gpt-5-codex",
                  userTurnCount: 1,
                  assistantTurnCount: 1,
                  toolUseCount: 0,
                  usage: {
                    inputTokens: 400,
                    outputTokens: 100,
                    totalTokens: 500,
                  },
                  usageCoverage: {
                    hasUsage: true,
                    callCount: 1,
                    callsWithTotalTokens: 1,
                    estimatedCallCount: 0,
                  },
                  parseErrorCount: 0,
                  timestampQuality: "explicit" as const,
                  events: [],
                },
              ],
            },
          ],
        })),
      },
      workspaceMgr: { get: vi.fn() },
      workLogCollector: { collect },
      skillLibraryRepo: { list: vi.fn(() => []) },
      skillMountRepo: { list: vi.fn(() => []) },
      deepRunner: {
        run: vi.fn(),
      },
      now: () => Date.UTC(2026, 5, 7, 3, 30),
    });

    const dashboard = await service.getDashboard({
      workspacePaths: ["/repo/app"],
      timeRange: {
        startAt: Date.UTC(2026, 5, 7, 1, 30),
        endAt: Date.UTC(2026, 5, 7, 1, 45),
      },
    });

    expect(collect).not.toHaveBeenCalled();
    expect(dashboard.scanState.sourceDigest).toBe("hourly-index-1");
    expect(dashboard.dashboard?.kpis.find((item) => item.key === "totalTokens")?.value).toBe(1_000);
    expect(dashboard.dashboard?.rankings.projects).toEqual([
      expect.objectContaining({
        label: "/repo/app",
        totalTokens: 1_000,
      }),
    ]);
  });

  it("projects dashboard results directly from the hourly index", async () => {
    const repo = {
      findByQueryDigest: vi.fn(() => undefined),
      upsert: vi.fn((record) => record),
      findHourlyIndex: vi.fn(() => ({
        version: 1,
        bucketMode: "hourly_session_slices" as const,
        indexedAt: Date.UTC(2026, 5, 7, 3),
        indexedThroughHourStart: Date.UTC(2026, 5, 7, 2),
        sourceDigest: "hourly-index-live",
        providerStatuses: [
          {
            providerId: "codex",
            status: "supported" as const,
            sessionCount: 1,
            parseErrorCount: 0,
            warningCount: 0,
          },
        ],
        buckets: [
          {
            hourStart: Date.UTC(2026, 5, 7, 2),
            sessions: [
              {
                providerId: "codex" as const,
                sessionId: "codex-live",
                workspacePath: "/repo/app",
                startedAt: Date.UTC(2026, 5, 7, 2, 10),
                lastActiveAt: Date.UTC(2026, 5, 7, 2, 30),
                sourceRef: "codex-live",
                userTurnCount: 1,
                assistantTurnCount: 1,
                toolUseCount: 0,
                usage: {
                  inputTokens: 123,
                  totalTokens: 123,
                },
                usageCoverage: {
                  hasUsage: true,
                  callCount: 1,
                  callsWithTotalTokens: 1,
                  estimatedCallCount: 0,
                },
                parseErrorCount: 0,
                timestampQuality: "explicit" as const,
                events: [],
              },
            ],
          },
        ],
      })),
    };
    const service = new WorkAnalysisService({
      repo,
      workspaceMgr: { get: vi.fn() },
      workLogCollector: { collect: vi.fn() },
      skillLibraryRepo: { list: vi.fn(() => []) },
      skillMountRepo: { list: vi.fn(() => []) },
      deepRunner: {
        run: vi.fn(),
      },
      now: () => Date.UTC(2026, 5, 7, 3, 30),
    });

    const dashboard = await service.getDashboard({ timeRange: { preset: "24h" } });

    expect(dashboard.dashboard?.kpis.find((item) => item.key === "totalTokens")?.value).toBe(123);
  });

  it("refreshes the hourly index from the next unindexed hour before projecting the dashboard", async () => {
    let hourlyIndex = {
      version: 1 as const,
      bucketMode: "hourly_session_slices" as const,
      indexedAt: Date.UTC(2026, 5, 7, 2),
      indexedThroughHourStart: Date.UTC(2026, 5, 7, 1),
      sourceDigest: "hourly-index-old",
      providerStatuses: [
        {
          providerId: "codex",
          status: "supported" as const,
          sessionCount: 1,
          parseErrorCount: 0,
          warningCount: 0,
        },
      ],
      buckets: [
        {
          hourStart: Date.UTC(2026, 5, 7, 1),
          sessions: [
            {
              providerId: "codex" as const,
              sessionId: "codex-1",
              workspacePath: "/repo/app",
              startedAt: Date.UTC(2026, 5, 7, 1, 10),
              lastActiveAt: Date.UTC(2026, 5, 7, 1, 20),
              sourceRef: "codex-1",
              userTurnCount: 1,
              assistantTurnCount: 1,
              toolUseCount: 0,
              usage: {
                inputTokens: 100,
                outputTokens: 0,
                totalTokens: 100,
              },
              usageCoverage: {
                hasUsage: true,
                callCount: 1,
                callsWithTotalTokens: 1,
                estimatedCallCount: 0,
              },
              parseErrorCount: 0,
              timestampQuality: "explicit" as const,
              events: [],
            },
          ],
        },
      ],
    };
    const collect = vi.fn(async () => ({
      sourceDigest: "source-new-hours",
      providers: [
        {
          providerId: "codex" as const,
          status: "supported" as const,
          sessions: [],
          sourceRefs: [],
          parseErrorCount: 0,
          warnings: [],
        },
      ],
      sessions: [
        {
          providerId: "codex" as const,
          sessionId: "codex-2",
          workspacePath: "/repo/app",
          startedAt: Date.UTC(2026, 5, 7, 2, 10),
          lastActiveAt: Date.UTC(2026, 5, 7, 2, 40),
          sourceRef: "codex-2",
          userTurnCount: 1,
          assistantTurnCount: 1,
          toolUseCount: 0,
          usage: {
            inputTokens: 200,
            outputTokens: 0,
            totalTokens: 200,
          },
          usageCoverage: {
            hasUsage: true,
            callCount: 1,
            callsWithTotalTokens: 1,
            estimatedCallCount: 0,
          },
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [],
        },
        {
          providerId: "codex" as const,
          sessionId: "codex-3",
          workspacePath: "/repo/app",
          startedAt: Date.UTC(2026, 5, 7, 3, 5),
          lastActiveAt: Date.UTC(2026, 5, 7, 3, 15),
          sourceRef: "codex-3",
          userTurnCount: 1,
          assistantTurnCount: 1,
          toolUseCount: 0,
          usage: {
            inputTokens: 300,
            outputTokens: 0,
            totalTokens: 300,
          },
          usageCoverage: {
            hasUsage: true,
            callCount: 1,
            callsWithTotalTokens: 1,
            estimatedCallCount: 0,
          },
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [],
        },
      ],
    }));
    const service = new WorkAnalysisService({
      repo: {
        findByQueryDigest: vi.fn(() => undefined),
        upsert: vi.fn((record) => record),
        findHourlyIndex: vi.fn(() => hourlyIndex),
        upsertHourlyIndex: vi.fn((nextIndex) => {
          hourlyIndex = nextIndex;
          return nextIndex;
        }),
      },
      workspaceMgr: { get: vi.fn() },
      workLogCollector: { collect },
      skillLibraryRepo: { list: vi.fn(() => []) },
      skillMountRepo: { list: vi.fn(() => []) },
      deepRunner: {
        run: vi.fn(),
      },
      now: () => Date.UTC(2026, 5, 7, 3, 30),
    });

    const dashboard = await service.refreshDashboard({ timeRange: { preset: "24h" } }, "manual");

    expect(collect).toHaveBeenCalledWith({
      workspacePaths: [],
      timeRange: {
        startAt: Date.UTC(2026, 5, 7, 2),
        endAt: Date.UTC(2026, 5, 7, 3, 30),
        label: "incremental",
      },
    });
    expect(hourlyIndex.buckets.map((bucket) => bucket.hourStart)).toEqual([
      Date.UTC(2026, 5, 7, 1),
      Date.UTC(2026, 5, 7, 2),
      Date.UTC(2026, 5, 7, 3),
    ]);
    expect(hourlyIndex.indexedThroughHourStart).toBe(Date.UTC(2026, 5, 7, 2));
    expect(dashboard.dashboard?.kpis.find((item) => item.key === "totalTokens")?.value).toBe(600);
  });

  it("rebuilds the previously partial hour after crossing into the next hour", async () => {
    let hourlyIndex = {
      version: 1 as const,
      bucketMode: "hourly_session_slices" as const,
      indexedAt: Date.UTC(2026, 5, 7, 3, 45),
      indexedThroughHourStart: Date.UTC(2026, 5, 7, 3),
      sourceDigest: "hourly-index-partial",
      providerStatuses: [
        {
          providerId: "codex",
          status: "supported" as const,
          sessionCount: 1,
          parseErrorCount: 0,
          warningCount: 0,
        },
      ],
      buckets: [
        {
          hourStart: Date.UTC(2026, 5, 7, 2),
          sessions: [
            {
              providerId: "codex" as const,
              sessionId: "codex-2",
              workspacePath: "/repo/app",
              startedAt: Date.UTC(2026, 5, 7, 2, 10),
              lastActiveAt: Date.UTC(2026, 5, 7, 2, 20),
              sourceRef: "codex-2",
              userTurnCount: 1,
              assistantTurnCount: 1,
              toolUseCount: 0,
              usage: {
                inputTokens: 100,
                totalTokens: 100,
              },
              usageCoverage: {
                hasUsage: true,
                callCount: 1,
                callsWithTotalTokens: 1,
                estimatedCallCount: 0,
              },
              parseErrorCount: 0,
              timestampQuality: "explicit" as const,
              events: [],
            },
          ],
        },
        {
          hourStart: Date.UTC(2026, 5, 7, 3),
          sessions: [
            {
              providerId: "codex" as const,
              sessionId: "codex-3-old",
              workspacePath: "/repo/app",
              startedAt: Date.UTC(2026, 5, 7, 3, 20),
              lastActiveAt: Date.UTC(2026, 5, 7, 3, 30),
              sourceRef: "codex-3-old",
              userTurnCount: 1,
              assistantTurnCount: 1,
              toolUseCount: 0,
              usage: {
                inputTokens: 200,
                totalTokens: 200,
              },
              usageCoverage: {
                hasUsage: true,
                callCount: 1,
                callsWithTotalTokens: 1,
                estimatedCallCount: 0,
              },
              parseErrorCount: 0,
              timestampQuality: "explicit" as const,
              events: [],
            },
          ],
        },
      ],
    };
    const collect = vi.fn(async () => ({
      sourceDigest: "source-after-partial",
      providers: [
        {
          providerId: "codex" as const,
          status: "supported" as const,
          sessions: [],
          sourceRefs: [],
          parseErrorCount: 0,
          warnings: [],
        },
      ],
      sessions: [
        {
          providerId: "codex" as const,
          sessionId: "codex-3-new",
          workspacePath: "/repo/app",
          startedAt: Date.UTC(2026, 5, 7, 3, 55),
          lastActiveAt: Date.UTC(2026, 5, 7, 3, 58),
          sourceRef: "codex-3-new",
          userTurnCount: 1,
          assistantTurnCount: 1,
          toolUseCount: 0,
          usage: {
            inputTokens: 300,
            totalTokens: 300,
          },
          usageCoverage: {
            hasUsage: true,
            callCount: 1,
            callsWithTotalTokens: 1,
            estimatedCallCount: 0,
          },
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [],
        },
        {
          providerId: "codex" as const,
          sessionId: "codex-4",
          workspacePath: "/repo/app",
          startedAt: Date.UTC(2026, 5, 7, 4, 5),
          lastActiveAt: Date.UTC(2026, 5, 7, 4, 8),
          sourceRef: "codex-4",
          userTurnCount: 1,
          assistantTurnCount: 1,
          toolUseCount: 0,
          usage: {
            inputTokens: 400,
            totalTokens: 400,
          },
          usageCoverage: {
            hasUsage: true,
            callCount: 1,
            callsWithTotalTokens: 1,
            estimatedCallCount: 0,
          },
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [],
        },
      ],
    }));
    const service = new WorkAnalysisService({
      repo: {
        findByQueryDigest: vi.fn(() => undefined),
        upsert: vi.fn((record) => record),
        findHourlyIndex: vi.fn(() => hourlyIndex),
        upsertHourlyIndex: vi.fn((nextIndex) => {
          hourlyIndex = nextIndex;
          return nextIndex;
        }),
      },
      workspaceMgr: { get: vi.fn() },
      workLogCollector: { collect },
      skillLibraryRepo: { list: vi.fn(() => []) },
      skillMountRepo: { list: vi.fn(() => []) },
      deepRunner: {
        run: vi.fn(),
      },
      now: () => Date.UTC(2026, 5, 7, 4, 10),
    });

    await service.refreshDashboard({ timeRange: { preset: "24h" } }, "manual");

    expect(collect).toHaveBeenCalledWith({
      workspacePaths: [],
      timeRange: {
        startAt: Date.UTC(2026, 5, 7, 3),
        endAt: Date.UTC(2026, 5, 7, 4, 10),
        label: "incremental",
      },
    });
    expect(hourlyIndex.buckets.map((bucket) => bucket.hourStart)).toEqual([
      Date.UTC(2026, 5, 7, 2),
      Date.UTC(2026, 5, 7, 3),
      Date.UTC(2026, 5, 7, 4),
    ]);
    expect(
      hourlyIndex.buckets
        .find((bucket) => bucket.hourStart === Date.UTC(2026, 5, 7, 3))
        ?.sessions.map((session) => session.sessionId)
    ).toEqual(["codex-3-new"]);
  });

  it("attributes indexed usage to event hours when a session spans multiple hours", async () => {
    let hourlyIndex: WorkAnalysisHourlyIndex | undefined;
    const collect = vi.fn(async () => ({
      sourceDigest: "source-spanning-session",
      providers: [
        {
          providerId: "codex" as const,
          status: "supported" as const,
          sessions: [],
          sourceRefs: [],
          parseErrorCount: 0,
          warnings: [],
        },
      ],
      sessions: [
        {
          providerId: "codex" as const,
          sessionId: "spanning-session",
          workspacePath: "/repo/app",
          startedAt: Date.UTC(2026, 5, 7, 1, 50),
          lastActiveAt: Date.UTC(2026, 5, 7, 2, 20),
          sourceRef: "spanning-session",
          userTurnCount: 2,
          assistantTurnCount: 2,
          toolUseCount: 2,
          usage: {
            inputTokens: 300,
            totalTokens: 300,
          },
          usageCoverage: {
            hasUsage: true,
            callCount: 2,
            callsWithTotalTokens: 2,
            estimatedCallCount: 0,
          },
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [
            {
              eventId: "hour-1-read",
              providerId: "codex" as const,
              sessionId: "spanning-session",
              workspacePath: "/repo/app",
              eventType: "tool" as const,
              canonicalEventType: "tool_call" as const,
              occurredAt: Date.UTC(2026, 5, 7, 1, 55),
              toolName: "Read",
              toolCategory: "read" as const,
              tokenUsage: {
                inputTokens: 100,
                totalTokens: 100,
              },
              rawRefs: ["spanning-session"],
            },
            {
              eventId: "hour-2-bash",
              providerId: "codex" as const,
              sessionId: "spanning-session",
              workspacePath: "/repo/app",
              eventType: "tool" as const,
              canonicalEventType: "tool_call" as const,
              occurredAt: Date.UTC(2026, 5, 7, 2, 10),
              toolName: "Bash",
              toolCategory: "bash" as const,
              tokenUsage: {
                inputTokens: 200,
                totalTokens: 200,
              },
              rawRefs: ["spanning-session"],
            },
          ],
        },
      ],
    }));
    const service = new WorkAnalysisService({
      repo: {
        findByQueryDigest: vi.fn(() => undefined),
        upsert: vi.fn((record) => record),
        findHourlyIndex: vi.fn(() => undefined),
        upsertHourlyIndex: vi.fn((nextIndex) => {
          hourlyIndex = nextIndex;
          return nextIndex;
        }),
      },
      workspaceMgr: { get: vi.fn() },
      workLogCollector: { collect },
      skillLibraryRepo: { list: vi.fn(() => []) },
      skillMountRepo: { list: vi.fn(() => []) },
      deepRunner: {
        run: vi.fn(),
      },
      now: () => Date.UTC(2026, 5, 7, 3, 30),
    });

    const dashboard = await service.refreshDashboard({ timeRange: { preset: "24h" } }, "manual");

    expect(hourlyIndex?.buckets.map((bucket) => bucket.hourStart)).toEqual([
      Date.UTC(2026, 5, 7, 1),
      Date.UTC(2026, 5, 7, 2),
    ]);
    expect(hourlyIndex?.buckets.map((bucket) => bucket.sessions[0]?.usage?.totalTokens)).toEqual([
      100, 200,
    ]);
    expect(dashboard.dashboard?.trends.tokenHourly).toEqual([
      expect.objectContaining({
        hourStart: Date.UTC(2026, 5, 7, 1),
        totalTokens: 100,
        sessionCount: 1,
      }),
      expect.objectContaining({
        hourStart: Date.UTC(2026, 5, 7, 2),
        totalTokens: 200,
        sessionCount: 1,
      }),
    ]);
    expect(dashboard.dashboard?.kpis.find((item) => item.key === "sessions")?.value).toBe(1);
  });

  it("stores compact event signals in the hourly index", async () => {
    const longText = "debugging feature work ".repeat(400);
    const longCommand = "pnpm --filter @coder-studio/server test ".repeat(300);
    let hourlyIndex: WorkAnalysisHourlyIndex | undefined;
    const collect = vi.fn(async () => ({
      sourceDigest: "source-large-events",
      providers: [
        {
          providerId: "codex" as const,
          status: "supported" as const,
          sessions: [],
          sourceRefs: [],
          parseErrorCount: 0,
          warnings: [],
        },
      ],
      sessions: [
        {
          providerId: "codex" as const,
          sessionId: "large-session",
          workspacePath: "/repo/app",
          startedAt: Date.UTC(2026, 5, 7, 2, 10),
          lastActiveAt: Date.UTC(2026, 5, 7, 2, 40),
          sourceRef: "large-session",
          userTurnCount: 1,
          assistantTurnCount: 1,
          toolUseCount: 1,
          usage: {
            inputTokens: 200,
            outputTokens: 50,
            totalTokens: 250,
          },
          usageCoverage: {
            hasUsage: true,
            callCount: 1,
            callsWithTotalTokens: 1,
            estimatedCallCount: 0,
          },
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [
            {
              eventId: "large-skill",
              providerId: "codex" as const,
              sessionId: "large-session",
              workspacePath: "/repo/app",
              eventType: "tool" as const,
              canonicalEventType: "tool_call" as const,
              occurredAt: Date.UTC(2026, 5, 7, 2, 20),
              role: "tool" as const,
              toolName: "Skill",
              toolCategory: "skill" as const,
              text: longText,
              commandText: longCommand,
              payload: {
                input: {
                  skill: "frontend-design",
                  transcript: "x".repeat(8_000),
                },
              },
              evidence: ["y".repeat(8_000)],
              rawRefs: ["large-session"],
            },
          ],
        },
      ],
    }));
    const service = new WorkAnalysisService({
      repo: {
        findByQueryDigest: vi.fn(() => undefined),
        upsert: vi.fn((record) => record),
        findHourlyIndex: vi.fn(() => undefined),
        upsertHourlyIndex: vi.fn((nextIndex) => {
          hourlyIndex = nextIndex;
          return nextIndex;
        }),
      },
      workspaceMgr: { get: vi.fn() },
      workLogCollector: { collect },
      skillLibraryRepo: { list: vi.fn(() => []) },
      skillMountRepo: { list: vi.fn(() => []) },
      deepRunner: {
        run: vi.fn(),
      },
      now: () => Date.UTC(2026, 5, 7, 3, 30),
    });

    const dashboard = await service.refreshDashboard({ timeRange: { preset: "24h" } }, "manual");

    const indexedEvent = hourlyIndex?.buckets[0]?.sessions[0]?.events?.[0];
    expect(indexedEvent).toMatchObject({
      eventId: "large-skill",
      toolName: "Skill",
      toolCategory: "skill",
      skillName: "frontend-design",
      rawRefs: ["large-session"],
    });
    expect(indexedEvent?.payload).toBeUndefined();
    expect(indexedEvent?.evidence).toBeUndefined();
    expect(indexedEvent?.text?.length).toBeLessThan(longText.length);
    expect(indexedEvent?.commandText?.length).toBeLessThan(longCommand.length);
    expect(dashboard.dashboard?.breakdowns.skills).toEqual([
      expect.objectContaining({
        key: "frontend-design",
        callCount: 1,
      }),
    ]);
  });

  it("clears previous analysis state before rebuilding the hourly index", async () => {
    const clearAnalysisCache = vi.fn();
    const collect = vi.fn(async () => ({
      sourceDigest: "source-rebuilt",
      providers: [
        {
          providerId: "codex" as const,
          status: "supported" as const,
          sessions: [],
          sourceRefs: [],
          parseErrorCount: 0,
          warnings: [],
        },
      ],
      sessions: [
        {
          providerId: "codex" as const,
          sessionId: "rebuilt-session",
          workspacePath: "/repo/app",
          startedAt: Date.UTC(2026, 5, 7, 2, 10),
          lastActiveAt: Date.UTC(2026, 5, 7, 2, 40),
          sourceRef: "rebuilt-session",
          userTurnCount: 1,
          assistantTurnCount: 1,
          toolUseCount: 0,
          usage: {
            inputTokens: 900,
            outputTokens: 100,
            totalTokens: 1_000,
          },
          usageCoverage: {
            hasUsage: true,
            callCount: 1,
            callsWithTotalTokens: 1,
            estimatedCallCount: 0,
          },
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [],
        },
      ],
    }));
    const service = new WorkAnalysisService({
      repo: {
        findByQueryDigest: vi.fn(() => undefined),
        upsert: vi.fn((record) => record),
        findHourlyIndex: vi.fn(() => undefined),
        upsertHourlyIndex: vi.fn((record) => record),
        clearAnalysisCache,
      },
      workspaceMgr: { get: vi.fn() },
      workLogCollector: { collect },
      skillLibraryRepo: { list: vi.fn(() => []) },
      skillMountRepo: { list: vi.fn(() => []) },
      deepRunner: {
        run: vi.fn(),
      },
      now: () => Date.UTC(2026, 5, 7, 3, 30),
    });

    const dashboard = await service.rebuildDashboardIndex({ timeRange: { preset: "24h" } });

    expect(clearAnalysisCache).toHaveBeenCalledOnce();
    expect(collect).toHaveBeenCalledWith({
      workspacePaths: [],
      timeRange: {
        startAt: 0,
        endAt: Date.UTC(2026, 5, 7, 3, 30),
        label: "all history",
      },
    });
    expect(dashboard.scanState.sourceDigest).toBe("source-rebuilt");
    expect(dashboard.dashboard?.kpis.find((item) => item.key === "totalTokens")?.value).toBe(1_000);
  });

  it("builds a full-history hourly index on first dashboard request so filters project immediately", async () => {
    let hourlyIndex: WorkAnalysisHourlyIndex | undefined;
    const collect = vi.fn(async () => ({
      sourceDigest: "source-filtered",
      providers: [
        {
          providerId: "codex" as const,
          status: "supported" as const,
          sessions: [],
          sourceRefs: [],
          parseErrorCount: 0,
          warnings: [],
        },
      ],
      sessions: [
        {
          providerId: "codex" as const,
          sessionId: "a",
          workspacePath: "/repo/a",
          startedAt: Date.UTC(2026, 5, 1, 10),
          lastActiveAt: Date.UTC(2026, 5, 1, 10, 30),
          sourceRef: "a",
          modelId: "gpt-5-codex",
          userTurnCount: 1,
          assistantTurnCount: 1,
          toolUseCount: 0,
          usage: {
            inputTokens: 400,
            outputTokens: 100,
            totalTokens: 500,
          },
          usageCoverage: {
            hasUsage: true,
            callCount: 1,
            callsWithTotalTokens: 1,
            estimatedCallCount: 0,
          },
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
          events: [],
        },
      ],
    }));

    const service = new WorkAnalysisService({
      repo: {
        findByQueryDigest: vi.fn(() => undefined),
        upsert: vi.fn((record) => record),
        findHourlyIndex: vi.fn(() => hourlyIndex),
        upsertHourlyIndex: vi.fn((nextIndex) => {
          hourlyIndex = nextIndex;
          return nextIndex;
        }),
      },
      workspaceMgr: { get: vi.fn() },
      workLogCollector: { collect },
      skillLibraryRepo: { list: vi.fn(() => []) },
      skillMountRepo: { list: vi.fn(() => []) },
      deepRunner: {
        run: vi.fn(),
      },
      now: () => Date.UTC(2026, 5, 6, 10),
    });

    const dashboard = await service.getDashboard({
      timeRange: { preset: "90d" },
      workspacePaths: ["/repo/a"],
    });

    expect(collect).toHaveBeenCalledWith({
      timeRange: {
        startAt: 0,
        endAt: Date.UTC(2026, 5, 6, 10),
        label: "all history",
      },
      workspacePaths: [],
    });
    expect(hourlyIndex?.buckets.map((bucket) => bucket.hourStart)).toEqual([
      Date.UTC(2026, 5, 1, 10),
    ]);
    expect(dashboard.scanState.status).toBe("succeeded");
    expect(dashboard.dashboard?.rankings.projects).toEqual([
      expect.objectContaining({
        label: "/repo/a",
        totalTokens: 500,
      }),
    ]);
    expect(dashboard.dashboard?.kpis.find((item) => item.key === "totalTokens")?.value).toBe(500);
  });

  it("serializes concurrent dashboard refreshes without returning another query result", async () => {
    const firstCollection = createDeferred<{
      sourceDigest: string;
      providers: [];
      sessions: [];
    }>();
    const collect = vi.fn().mockReturnValueOnce(firstCollection.promise).mockResolvedValueOnce({
      sourceDigest: "source-7d",
      providers: [],
      sessions: [],
    });

    const service = new WorkAnalysisService({
      repo: {
        findByQueryDigest: vi.fn(() => undefined),
        upsert: vi.fn((record) => record),
      },
      workspaceMgr: { get: vi.fn() },
      workLogCollector: { collect },
      skillLibraryRepo: { list: vi.fn(() => []) },
      skillMountRepo: { list: vi.fn(() => []) },
      deepRunner: {
        run: vi.fn(),
      },
      now: vi.fn(() => Date.UTC(2026, 5, 6, 10)),
    });

    const autoRefresh = service.refreshDashboard({ timeRange: { preset: "90d" } }, "auto");
    const manualRefresh = service.refreshDashboard({ timeRange: { preset: "7d" } }, "manual");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(collect).toHaveBeenCalledTimes(1);

    firstCollection.resolve({
      sourceDigest: "source-90d",
      providers: [],
      sessions: [],
    });

    const [autoResult, manualResult] = await Promise.all([autoRefresh, manualRefresh]);

    expect(collect).toHaveBeenCalledTimes(2);
    expect(autoResult.query.timeRange).toEqual({ preset: "90d" });
    expect(autoResult.scanState.sourceDigest).toBe("source-90d");
    expect(manualResult.query.timeRange).toEqual({ preset: "7d" });
    expect(manualResult.scanState.sourceDigest).toBe("source-7d");
  });

  it("filters collected sessions by workspacePaths after discovery", async () => {
    const upsert = vi.fn((record) => record);
    const collect = vi.fn(async () => ({
      sourceDigest: "source-1",
      providers: [],
      sessions: [
        {
          providerId: "codex" as const,
          sessionId: "a",
          workspacePath: "/repo/a",
          startedAt: 1,
          lastActiveAt: 2,
          sourceRef: "a",
          userTurnCount: 1,
          assistantTurnCount: 1,
          toolUseCount: 0,
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
        },
        {
          providerId: "codex" as const,
          sessionId: "b",
          workspacePath: "/repo/b",
          startedAt: 3,
          lastActiveAt: 4,
          sourceRef: "b",
          userTurnCount: 1,
          assistantTurnCount: 1,
          toolUseCount: 0,
          parseErrorCount: 0,
          timestampQuality: "explicit" as const,
        },
      ],
    }));

    const service = new WorkAnalysisService({
      repo: {
        findByQueryDigest: vi.fn(() => undefined),
        upsert,
      },
      workspaceMgr: { get: vi.fn() },
      workLogCollector: { collect },
      skillLibraryRepo: { list: vi.fn(() => []) },
      skillMountRepo: { list: vi.fn(() => []) },
      deepRunner: {
        run: vi.fn(),
      },
      now: () => 1_000,
    });

    const result = await service.runBasic({
      workspacePaths: ["/repo/b"],
      timeRange: { preset: "7d" },
    });

    expect(result.basicResult?.availableWorkspacePaths).toEqual(["/repo/a", "/repo/b"]);
    expect(result.basicResult?.workSurface.workspacePaths).toEqual(["/repo/b"]);
    expect(result.basicResult?.activity.daily).toEqual([
      { day: "1970-01-01", totalTokens: 0, sessionCount: 1 },
    ]);
    expect(result.basicResult?.compare.workspaces).toEqual([
      expect.objectContaining({
        workspacePath: "/repo/b",
        sessionCount: 1,
        totalTokens: 0,
        sharePercent: 0,
      }),
    ]);
    expect(result.basicResult).not.toHaveProperty("budgets");
    expect(collect).toHaveBeenCalledWith({
      workspacePaths: ["/repo/b"],
      timeRange: { startAt: 1_000 - 7 * 24 * 60 * 60 * 1000, endAt: 1_000, label: "7d" },
    });
  });

  it("rescans provider logs when running basic analysis even if a previous result succeeded", async () => {
    const upsert = vi.fn((record) => record);
    const collect = vi.fn(async () => ({
      sourceDigest: "source-1",
      providers: [
        {
          providerId: "codex" as const,
          status: "supported" as const,
          sessions: [],
          sourceRefs: [],
          parseErrorCount: 0,
          warnings: [],
        },
      ],
      sessions: [],
    }));

    const service = new WorkAnalysisService({
      repo: {
        findByQueryDigest: vi.fn(() => ({
          id: "analysis-1",
          queryDigest: "digest-1",
          workspacePaths: ["/repo/app"],
          timeRange: { preset: "7d" as const },
          basicStatus: "succeeded" as const,
          deepStatus: "idle" as const,
        })),
        upsert,
      },
      workspaceMgr: { get: vi.fn() },
      workLogCollector: { collect },
      skillLibraryRepo: { list: vi.fn(() => []) },
      skillMountRepo: { list: vi.fn(() => []) },
      deepRunner: {
        run: vi.fn(),
      },
      now: () => 1_000,
    });

    await service.runBasic({ workspacePaths: ["/repo/app"], timeRange: { preset: "7d" } });

    expect(collect).toHaveBeenCalledWith({
      workspacePaths: ["/repo/app"],
      timeRange: { startAt: 1_000 - 7 * 24 * 60 * 60 * 1000, endAt: 1_000, label: "7d" },
    });
    expect(upsert).toHaveBeenCalled();
  });

  it("persists running and succeeded states around deep analysis", async () => {
    const upsert = vi.fn((record) => record);
    const run = vi.fn(async () => ({
      workSummary: "done",
      repeatedPatterns: [],
      bottlenecks: [],
      workflowSuggestions: [],
      skillCandidates: [],
      openLoops: [],
      followUpSuggestions: [],
      confidence: "high" as const,
    }));

    const service = new WorkAnalysisService({
      repo: {
        findByQueryDigest: vi.fn(() => undefined),
        upsert,
      },
      workspaceMgr: { get: vi.fn() },
      workLogCollector: {
        collect: vi.fn(async () => ({
          sourceDigest: "source-1",
          providers: [
            {
              providerId: "codex" as const,
              status: "supported" as const,
              sessions: [
                {
                  providerId: "codex" as const,
                  sessionId: "sess-1",
                  workspacePath: "/repo/project",
                  startedAt: 100,
                  lastActiveAt: 200,
                  sourceRef: "/logs/sess-1",
                  title: "Fix tests",
                  userTurnCount: 2,
                  assistantTurnCount: 1,
                  toolUseCount: 1,
                  parseErrorCount: 0,
                  timestampQuality: "explicit" as const,
                  evidence: [
                    {
                      providerId: "codex" as const,
                      sessionId: "sess-1",
                      workspacePath: "/repo/project",
                      startedAt: 100,
                      lastActiveAt: 200,
                      excerpts: [{ role: "user" as const, text: "fix tests" }],
                    },
                  ],
                },
              ],
              sourceRefs: [],
              parseErrorCount: 0,
              warnings: [],
            },
          ],
          sessions: [
            {
              providerId: "codex" as const,
              sessionId: "sess-1",
              workspacePath: "/repo/project",
              startedAt: 100,
              lastActiveAt: 200,
              sourceRef: "/logs/sess-1",
              title: "Fix tests",
              userTurnCount: 2,
              assistantTurnCount: 1,
              toolUseCount: 1,
              parseErrorCount: 0,
              timestampQuality: "explicit" as const,
              evidence: [
                {
                  providerId: "codex" as const,
                  sessionId: "sess-1",
                  workspacePath: "/repo/project",
                  startedAt: 100,
                  lastActiveAt: 200,
                  excerpts: [{ role: "user" as const, text: "fix tests" }],
                },
              ],
            },
          ],
        })),
      },
      skillLibraryRepo: { list: vi.fn(() => [{ slug: "review" }]) },
      skillMountRepo: { list: vi.fn(() => [{ skillSlug: "review", enabled: true }]) },
      deepRunner: {
        run,
      },
      now: vi.fn(() => 1_234),
    });

    const result = await service.runDeep({
      workspacePaths: ["/repo/project"],
      timeRange: { preset: "7d" },
    });

    expect(upsert).toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: "/repo/project",
        evidence: expect.objectContaining({
          sessions: [
            expect.objectContaining({
              providerId: "codex",
              sessionId: "sess-1",
              excerpts: [{ role: "user", text: "fix tests" }],
            }),
          ],
        }),
      })
    );
    expect(result.basicStatus).toBe("succeeded");
    expect(result.deepStatus).toBe("succeeded");
    expect(result.deepResult?.workSummary).toBe("done");
  });

  it("persists a failed record when the deep runner throws", async () => {
    const upsert = vi.fn((record) => record);
    const service = new WorkAnalysisService({
      repo: {
        findByQueryDigest: vi.fn(() => undefined),
        upsert,
      },
      workspaceMgr: { get: vi.fn() },
      workLogCollector: {
        collect: vi.fn(async () => ({
          sourceDigest: "source-1",
          providers: [
            {
              providerId: "codex" as const,
              status: "supported" as const,
              sessions: [
                {
                  providerId: "codex" as const,
                  sessionId: "sess-1",
                  workspacePath: "/repo/project",
                  startedAt: 100,
                  lastActiveAt: 200,
                  sourceRef: "/logs/sess-1",
                  userTurnCount: 0,
                  assistantTurnCount: 0,
                  toolUseCount: 0,
                  parseErrorCount: 0,
                  timestampQuality: "explicit" as const,
                  evidence: [],
                },
              ],
              sourceRefs: [],
              parseErrorCount: 0,
              warnings: [],
            },
          ],
          sessions: [
            {
              providerId: "codex" as const,
              sessionId: "sess-1",
              workspacePath: "/repo/project",
              startedAt: 100,
              lastActiveAt: 200,
              sourceRef: "/logs/sess-1",
              userTurnCount: 0,
              assistantTurnCount: 0,
              toolUseCount: 0,
              parseErrorCount: 0,
              timestampQuality: "explicit" as const,
              evidence: [],
            },
          ],
        })),
      },
      skillLibraryRepo: { list: vi.fn(() => []) },
      skillMountRepo: { list: vi.fn(() => []) },
      deepRunner: {
        run: vi.fn(async () => {
          throw new Error("boom");
        }),
      },
      now: vi.fn(() => 1_234),
    });

    const result = await service.runDeep({
      workspacePaths: ["/repo/project"],
      timeRange: { preset: "7d" },
    });

    expect(result.deepStatus).toBe("failed");
    expect(result.deepErrorMessage).toBe("boom");
  });
});
