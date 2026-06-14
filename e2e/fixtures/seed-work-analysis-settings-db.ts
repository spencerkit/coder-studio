import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  SettingsRepo,
  WorkAnalysisRepo,
  WorkspaceRepo,
} from "../../packages/server/src/storage/index.ts";
import { buildWorkAnalysisQueryDigest } from "../../packages/server/src/work-analysis/query.ts";

const WORKSPACE_ID = "ws-analysis-e2e";

const [, , stateDir, workspacePath] = process.argv;

if (!stateDir || !workspacePath) {
  throw new Error("Usage: tsx seed-work-analysis-settings-db.ts <state-dir> <workspace-path>");
}

mkdirSync(stateDir, { recursive: true });
rmSync(join(stateDir, "state"), { recursive: true, force: true });

const now = Date.now();
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const latestCompleteHourStart = now - (now % HOUR_MS) - HOUR_MS;
const siblingWorkspacePath = join(join(workspacePath, ".."), "workspace-b");
const externalWorkspacePath = join(join(workspacePath, ".."), "workspace-c");
const availableWorkspacePaths = [workspacePath, siblingWorkspacePath, externalWorkspacePath].sort(
  (left, right) => left.localeCompare(right)
);

const workspaceRepo = new WorkspaceRepo({
  filePath: join(stateDir, "state", "workspaces.json"),
});
const settingsRepo = new SettingsRepo({
  filePath: join(stateDir, "state", "settings.json"),
});
const workAnalysisRepo = new WorkAnalysisRepo({
  filePath: join(stateDir, "state", "work-analysis.sqlite"),
});

const buildIndexedSession = ({
  sessionId,
  workspacePath: targetWorkspacePath,
  hourStart,
  inputTokens,
  outputTokens,
}: {
  sessionId: string;
  workspacePath: string;
  hourStart: number;
  inputTokens: number;
  outputTokens: number;
}) => ({
  providerId: "codex" as const,
  sessionId,
  workspacePath: targetWorkspacePath,
  startedAt: hourStart,
  lastActiveAt: hourStart + 45 * 60 * 1000,
  sourceRef: `codex:${sessionId}`,
  title: `${sessionId} summary`,
  modelId: "gpt-5-codex",
  gitBranch: "develop",
  userTurnCount: 3,
  assistantTurnCount: 4,
  toolUseCount: 2,
  usage: {
    inputTokens,
    outputTokens,
    cachedInputTokens: Math.round(inputTokens * 0.1),
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: Math.round(inputTokens * 0.05),
    reasoningOutputTokens: 0,
    totalTokens: inputTokens + outputTokens,
  },
  usageCoverage: {
    hasUsage: true,
    callCount: 1,
    callsWithTotalTokens: 1,
    estimatedCallCount: 0,
  },
  parseErrorCount: 0,
  timestampQuality: "explicit" as const,
});

workspaceRepo.create({
  id: WORKSPACE_ID,
  path: workspacePath,
  targetRuntime: "native",
  openedAt: now,
  lastActiveAt: now,
  uiState: {
    leftPanelWidth: 280,
    bottomPanelHeight: 200,
    focusMode: false,
  },
});

const query = {
  timeRange: { preset: "7d" as const },
};

workAnalysisRepo.upsert({
  id: "analysis-legacy-e2e",
  queryDigest: buildWorkAnalysisQueryDigest(query),
  timeRange: query.timeRange,
  requestedAt: now,
  basicCompletedAt: now,
  basicStatus: "succeeded",
  deepStatus: "idle",
  basicResult: {
    availableWorkspacePaths,
    capabilityMatrix: {
      providers: [],
    },
    coverage: {
      workspaceCount: 3,
      sessionCount: 4,
      providerCount: 1,
      timeRangeLabel: "7d",
    },
    activity: {
      sessionCount: 4,
      totalDurationMs: 3 * 60 * 60 * 1000,
      averageDurationMs: 45 * 60 * 1000,
      daily: [
        { day: "2026-06-01", totalTokens: 420, sessionCount: 1 },
        { day: "2026-06-02", totalTokens: 620, sessionCount: 1 },
        { day: "2026-06-03", totalTokens: 310, sessionCount: 1 },
        { day: "2026-06-04", totalTokens: 850, sessionCount: 1 },
      ],
    },
    workHabits: {
      hourBuckets: [
        { hour: 10, sessionCount: 1 },
        { hour: 14, sessionCount: 2 },
        { hour: 18, sessionCount: 1 },
      ],
    },
    skillInventory: {
      installedCount: 4,
      mountedCount: 2,
      unmountedCount: 2,
    },
    usage: {
      totalSessions: 4,
      sessionsByProvider: { codex: 4 },
      totals: {
        inputTokens: 1320,
        outputTokens: 880,
        cachedInputTokens: 140,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 80,
        reasoningOutputTokens: 0,
        totalTokens: 2200,
      },
      byDay: [
        {
          day: "2026-06-01",
          sessionCount: 1,
          totals: {
            inputTokens: 220,
            outputTokens: 200,
            cachedInputTokens: 20,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 10,
            reasoningOutputTokens: 0,
            totalTokens: 420,
          },
        },
        {
          day: "2026-06-02",
          sessionCount: 1,
          totals: {
            inputTokens: 360,
            outputTokens: 260,
            cachedInputTokens: 40,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 20,
            reasoningOutputTokens: 0,
            totalTokens: 620,
          },
        },
        {
          day: "2026-06-03",
          sessionCount: 1,
          totals: {
            inputTokens: 210,
            outputTokens: 100,
            cachedInputTokens: 20,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 10,
            reasoningOutputTokens: 0,
            totalTokens: 310,
          },
        },
        {
          day: "2026-06-04",
          sessionCount: 1,
          totals: {
            inputTokens: 530,
            outputTokens: 320,
            cachedInputTokens: 60,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 40,
            reasoningOutputTokens: 0,
            totalTokens: 850,
          },
        },
      ],
      byHour: [],
      byProvider: [
        {
          providerId: "codex",
          sessionCount: 4,
          totals: {
            inputTokens: 1320,
            outputTokens: 880,
            cachedInputTokens: 140,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 80,
            reasoningOutputTokens: 0,
            totalTokens: 2200,
          },
        },
      ],
      byWorkspace: [
        {
          workspacePath,
          sessionCount: 2,
          totals: {
            inputTokens: 580,
            outputTokens: 460,
            cachedInputTokens: 60,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 30,
            reasoningOutputTokens: 0,
            totalTokens: 1040,
          },
        },
        {
          workspacePath: siblingWorkspacePath,
          sessionCount: 1,
          totals: {
            inputTokens: 210,
            outputTokens: 100,
            cachedInputTokens: 20,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 10,
            reasoningOutputTokens: 0,
            totalTokens: 310,
          },
        },
        {
          workspacePath: externalWorkspacePath,
          sessionCount: 1,
          totals: {
            inputTokens: 530,
            outputTokens: 320,
            cachedInputTokens: 60,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 40,
            reasoningOutputTokens: 0,
            totalTokens: 850,
          },
        },
      ],
      byModel: [
        {
          modelId: "gpt-5-codex",
          providerId: "codex",
          sessionCount: 4,
          totals: {
            inputTokens: 1320,
            outputTokens: 880,
            cachedInputTokens: 140,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 80,
            reasoningOutputTokens: 0,
            totalTokens: 2200,
          },
        },
      ],
      byTool: [],
      byCommand: [],
      topSessionsByTotalTokens: [
        {
          sessionId: "sess-4",
          providerId: "codex",
          workspacePath: externalWorkspacePath,
          modelId: "gpt-5-codex",
          totalTokens: 850,
        },
        {
          sessionId: "sess-2",
          providerId: "codex",
          workspacePath,
          modelId: "gpt-5-codex",
          totalTokens: 620,
        },
      ],
    },
    tasks: {
      byType: [
        {
          taskType: "coding",
          sessionCount: 2,
          totals: {
            inputTokens: 580,
            outputTokens: 460,
            cachedInputTokens: 60,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 30,
            reasoningOutputTokens: 0,
            totalTokens: 1040,
          },
          providerIds: ["codex"],
          modelIds: ["gpt-5-codex"],
          workspacePaths: [workspacePath],
        },
        {
          taskType: "exploration",
          sessionCount: 2,
          totals: {
            inputTokens: 740,
            outputTokens: 420,
            cachedInputTokens: 80,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 50,
            reasoningOutputTokens: 0,
            totalTokens: 1160,
          },
          providerIds: ["codex"],
          modelIds: ["gpt-5-codex"],
          workspacePaths: [siblingWorkspacePath, externalWorkspacePath],
        },
      ],
      sessions: [],
    },
    compare: {
      topDimension: "workspace",
      workspaces: [
        {
          key: externalWorkspacePath,
          label: externalWorkspacePath,
          workspacePath: externalWorkspacePath,
          sessionCount: 1,
          totalTokens: 850,
          shareOfTokens: 850 / 2200,
          sharePercent: (850 / 2200) * 100,
          averageTokensPerSession: 850,
          averageOutputShare: 320 / 530,
        },
        {
          key: workspacePath,
          label: workspacePath,
          workspacePath,
          sessionCount: 2,
          totalTokens: 1040,
          shareOfTokens: 1040 / 2200,
          sharePercent: (1040 / 2200) * 100,
          averageTokensPerSession: 520,
          averageOutputShare: 460 / 580,
        },
      ],
      providers: [
        {
          key: "codex",
          label: "codex",
          providerId: "codex",
          sessionCount: 4,
          totalTokens: 2200,
          shareOfTokens: 1,
          sharePercent: 100,
          averageTokensPerSession: 550,
          averageOutputShare: 880 / 1320,
        },
      ],
      models: [
        {
          key: "codex\u0000gpt-5-codex",
          label: "codex / gpt-5-codex",
          providerId: "codex",
          modelId: "gpt-5-codex",
          sessionCount: 4,
          totalTokens: 2200,
          shareOfTokens: 1,
          sharePercent: 100,
          averageTokensPerSession: 550,
          averageOutputShare: 880 / 1320,
        },
      ],
      tasks: [
        {
          key: "coding",
          label: "coding",
          taskType: "coding",
          sessionCount: 2,
          totalTokens: 1040,
          shareOfTokens: 1040 / 2200,
          sharePercent: (1040 / 2200) * 100,
          averageTokensPerSession: 520,
          averageOutputShare: 460 / 580,
        },
        {
          key: "exploration",
          label: "exploration",
          taskType: "exploration",
          sessionCount: 2,
          totalTokens: 1160,
          shareOfTokens: 1160 / 2200,
          sharePercent: (1160 / 2200) * 100,
          averageTokensPerSession: 580,
          averageOutputShare: 420 / 740,
        },
      ],
      dimensions: {
        workspace: [],
        provider: [],
        model: [],
        task: [],
      },
    },
    yield: {
      overall: {
        sessionCount: 4,
        shippedSessionCount: 2,
        shippedSessionRate: 0.5,
        editSessionCount: 2,
        commandSessionCount: 4,
        gitSessionCount: 2,
        artifactSessionCount: 2,
        shippedTokens: 1470,
        shippedTokenShare: 1470 / 2200,
        averageTokensPerShippedSession: 735,
        averageTokensPerNonShippedSession: 365,
        outputToInputRatio: 880 / 1320,
        artifactSignalPerThousandTokens: 0.909,
        gitAwareSessionRate: 0.5,
      },
      byWorkspace: [],
      byTask: [],
      topShippedSessions: [
        {
          sessionId: "sess-4",
          providerId: "codex",
          workspacePath: externalWorkspacePath,
          taskType: "exploration",
          totalTokens: 850,
          shippedSignals: ["edit", "git"],
        },
      ],
      lowYieldSessions: [
        {
          sessionId: "sess-3",
          providerId: "codex",
          workspacePath: siblingWorkspacePath,
          taskType: "exploration",
          totalTokens: 310,
          missedSignals: ["no_git", "no_artifact"],
        },
      ],
      limitations: [],
    },
    workSurface: {
      workspacePaths: availableWorkspacePaths,
    },
    executionSignals: {
      sessionsWithActivity: 4,
      userTurnCount: 12,
      assistantTurnCount: 15,
      toolUseCount: 8,
      fileMtimeTimestampCount: 0,
    },
    dataQuality: {
      clampedDurationCount: 0,
      emptySessionCount: 0,
    },
  },
});

workAnalysisRepo.upsertHourlyIndex({
  version: 1,
  bucketMode: "hourly_session_slices",
  indexedAt: now,
  indexedThroughHourStart: latestCompleteHourStart,
  sourceDigest: "analysis-e2e-source",
  providerStatuses: [
    {
      providerId: "codex",
      status: "supported",
      sessionCount: 4,
      parseErrorCount: 0,
      warningCount: 0,
    },
  ],
  buckets: [
    {
      hourStart: latestCompleteHourStart - 4 * DAY_MS,
      sessions: [
        buildIndexedSession({
          sessionId: "sess-1",
          workspacePath,
          hourStart: latestCompleteHourStart - 4 * DAY_MS,
          inputTokens: 360,
          outputTokens: 260,
        }),
      ],
    },
    {
      hourStart: latestCompleteHourStart - 3 * DAY_MS,
      sessions: [
        buildIndexedSession({
          sessionId: "sess-2",
          workspacePath,
          hourStart: latestCompleteHourStart - 3 * DAY_MS,
          inputTokens: 220,
          outputTokens: 200,
        }),
      ],
    },
    {
      hourStart: latestCompleteHourStart - 2 * DAY_MS,
      sessions: [
        buildIndexedSession({
          sessionId: "sess-3",
          workspacePath: siblingWorkspacePath,
          hourStart: latestCompleteHourStart - 2 * DAY_MS,
          inputTokens: 210,
          outputTokens: 100,
        }),
      ],
    },
    {
      hourStart: latestCompleteHourStart - DAY_MS,
      sessions: [
        buildIndexedSession({
          sessionId: "sess-4",
          workspacePath: externalWorkspacePath,
          hourStart: latestCompleteHourStart - DAY_MS,
          inputTokens: 530,
          outputTokens: 320,
        }),
      ],
    },
  ],
});

settingsRepo.set("workspace.lastViewedTarget", {
  workspaceId: WORKSPACE_ID,
  updatedAt: now,
});

console.log(
  JSON.stringify({
    stateDir,
    workspaceId: WORKSPACE_ID,
    query,
  })
);
