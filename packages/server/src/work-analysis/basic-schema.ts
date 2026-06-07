import { z } from "zod";

const nonNegativeIntegerSchema = z.number().int().nonnegative();
const taskTypeSchema = z.enum([
  "coding",
  "debugging",
  "feature_dev",
  "refactoring",
  "testing",
  "exploration",
  "planning",
  "delegation",
  "git_ops",
  "build_deploy",
  "brainstorming",
  "conversation",
  "general",
]);
const usageTotalsSchema = z.object({
  inputTokens: nonNegativeIntegerSchema,
  outputTokens: nonNegativeIntegerSchema,
  cachedInputTokens: nonNegativeIntegerSchema,
  cacheCreationInputTokens: nonNegativeIntegerSchema,
  cacheReadInputTokens: nonNegativeIntegerSchema,
  reasoningOutputTokens: nonNegativeIntegerSchema,
  totalTokens: nonNegativeIntegerSchema,
});
const usageCoverageSchema = z.object({
  sessionCount: nonNegativeIntegerSchema,
  callCount: nonNegativeIntegerSchema,
  callsWithTotalTokens: nonNegativeIntegerSchema,
  estimatedCallCount: nonNegativeIntegerSchema,
  sessionCoverageRate: z.number().min(0).max(1),
});
const efficiencySummarySchema = z.object({
  sessionCount: nonNegativeIntegerSchema,
  averageTokensPerSession: nonNegativeIntegerSchema,
  averageInputTokensPerSession: nonNegativeIntegerSchema,
  averageOutputTokensPerSession: nonNegativeIntegerSchema,
  averageTokensPerToolUse: nonNegativeIntegerSchema,
  commandSessionRate: z.number().min(0).max(1),
  cacheParticipationRate: z.number().min(0).max(1),
  editSignalCoverageRate: z.number().min(0).max(1),
  highTokenSessionRate: z.number().min(0).max(1),
  toolHeavySessionCount: nonNegativeIntegerSchema,
  oneShotRate: z.number().min(0).max(1),
  retryRate: z.number().min(0).max(1),
  selfCorrectionRate: z.number().min(0).max(1),
  readToEditRatio: z.number().min(0),
  commandToEditRatio: z.number().min(0),
  cacheHitShare: z.number().min(0).max(1),
  gitAwareSessionRate: z.number().min(0).max(1),
});
const taskEfficiencySummarySchema = efficiencySummarySchema.extend({
  retryRate: z.number().min(0),
});
const optimizeFindingSchema = z.object({
  id: z.string(),
  type: z.enum([
    "provider_missing_usage",
    "tool_heavy_low_output",
    "cache_heavy_session",
    "high_cost_low_yield",
    "high_token_no_command",
    "parse_error_hotspot",
  ]),
  severity: z.enum(["high", "medium", "low"]),
  title: z.string(),
  summary: z.string(),
  estimatedWastedTokens: nonNegativeIntegerSchema,
  confidence: z.enum(["high", "medium", "low"]),
  affectedSessionIds: z.array(z.string()),
  affectedWorkspacePaths: z.array(z.string()),
  affectedProviderIds: z.array(z.string()),
  suggestion: z.string(),
  status: z.enum(["new"]),
});
const compareDimensionSummarySchema = z.object({
  key: z.string(),
  label: z.string(),
  sessionCount: nonNegativeIntegerSchema,
  totals: usageTotalsSchema,
  shareOfTokens: z.number().min(0).max(1),
  averageTokensPerSession: nonNegativeIntegerSchema,
  averageOutputShare: z.number().min(0).max(1),
});
const dailyActivityBucketSchema = z.object({
  day: z.string(),
  totalTokens: nonNegativeIntegerSchema,
  sessionCount: nonNegativeIntegerSchema,
});
const compareRankingEntrySchema = z.object({
  key: z.string(),
  label: z.string(),
  sessionCount: nonNegativeIntegerSchema,
  totalTokens: nonNegativeIntegerSchema,
  shareOfTokens: z.number().min(0).max(1),
  sharePercent: z.number().min(0),
  averageTokensPerSession: nonNegativeIntegerSchema,
  averageOutputShare: z.number().min(0).max(1),
});
const providerWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  sourceRef: z.string().optional(),
});
const dataSourceProviderSchema = z.object({
  providerId: z.string(),
  status: z.enum(["supported", "no_logs", "missing_root", "partial", "unsupported"]),
  sessionCount: nonNegativeIntegerSchema,
  parseErrorCount: nonNegativeIntegerSchema,
  warningCount: nonNegativeIntegerSchema,
  warnings: z.array(providerWarningSchema).optional(),
});
const yieldSummarySchema = z.object({
  sessionCount: nonNegativeIntegerSchema,
  shippedSessionCount: nonNegativeIntegerSchema,
  shippedSessionRate: z.number().min(0).max(1),
  editSessionCount: nonNegativeIntegerSchema,
  commandSessionCount: nonNegativeIntegerSchema,
  gitSessionCount: nonNegativeIntegerSchema,
  artifactSessionCount: nonNegativeIntegerSchema,
  shippedTokens: nonNegativeIntegerSchema,
  shippedTokenShare: z.number().min(0).max(1),
  averageTokensPerShippedSession: nonNegativeIntegerSchema,
  averageTokensPerNonShippedSession: nonNegativeIntegerSchema,
  outputToInputRatio: z.number().min(0),
  artifactSignalPerThousandTokens: z.number().min(0),
  gitAwareSessionRate: z.number().min(0).max(1),
});
const turnBehaviorSummarySchema = z.object({
  turnCount: nonNegativeIntegerSchema,
  editTurnCount: nonNegativeIntegerSchema,
  oneShotTurnCount: nonNegativeIntegerSchema,
  retryTurnCount: nonNegativeIntegerSchema,
  oneShotRate: z.number().min(0),
  retryRate: z.number().min(0),
});
const dimensionBreakdownSchema = z.object({
  key: z.string(),
  label: z.string(),
  sessionCount: nonNegativeIntegerSchema,
  totals: usageTotalsSchema,
  shareOfTokens: z.number().min(0).max(1),
  averageTokensPerSession: nonNegativeIntegerSchema,
  averageOutputShare: z.number().min(0).max(1),
  relatedProviders: z.array(z.string()).optional(),
  relatedModels: z.array(z.string()).optional(),
  relatedWorkspacePaths: z.array(z.string()).optional(),
});
const toolBreakdownSchema = z.object({
  key: z.string(),
  label: z.string(),
  sessionCount: nonNegativeIntegerSchema,
  useCount: nonNegativeIntegerSchema,
  totals: usageTotalsSchema,
});
const sessionInsightSchema = z.object({
  sessionId: z.string(),
  providerId: z.string(),
  workspacePath: z.string(),
  modelId: z.string().optional(),
  taskType: taskTypeSchema.optional(),
  totalTokens: nonNegativeIntegerSchema,
  outputTokens: nonNegativeIntegerSchema.optional(),
  durationMs: nonNegativeIntegerSchema.optional(),
  shippedSignals: z.array(z.string()).optional(),
  missedSignals: z.array(z.string()).optional(),
});
const taskTurnSchema = z.object({
  turnId: z.string(),
  sessionId: z.string(),
  providerId: z.string(),
  workspacePath: z.string(),
  modelId: z.string().optional(),
  primaryTask: taskTypeSchema,
  secondaryTasks: z.array(taskTypeSchema),
  evidence: z.array(z.string()),
  userMessage: z.string().nullable().optional(),
  toolNames: z.array(z.string()),
  commandTexts: z.array(z.string()),
  hasEdits: z.boolean(),
  retries: nonNegativeIntegerSchema,
  totalTokens: nonNegativeIntegerSchema,
  startedAt: nonNegativeIntegerSchema.optional(),
});
const taskSummaryByModelSchema = z.object({
  taskType: taskTypeSchema,
  providerId: z.string(),
  modelId: z.string(),
  turnCount: nonNegativeIntegerSchema,
  sessionCount: nonNegativeIntegerSchema,
  totals: usageTotalsSchema,
});
const taskSummaryByWorkspaceSchema = z.object({
  taskType: taskTypeSchema,
  workspacePath: z.string(),
  turnCount: nonNegativeIntegerSchema,
  sessionCount: nonNegativeIntegerSchema,
  totals: usageTotalsSchema,
});
const snapshotV2Schema = z.object({
  version: z.literal(2),
  query: z.object({
    timeRangeLabel: z.string(),
    selectedWorkspacePaths: z.array(z.string()),
    availableWorkspacePaths: z.array(z.string()),
  }),
  overview: z.object({
    totals: usageTotalsSchema.extend({
      sessionCount: nonNegativeIntegerSchema,
      workspaceCount: nonNegativeIntegerSchema,
      providerCount: nonNegativeIntegerSchema,
      taskTypeCount: nonNegativeIntegerSchema,
    }),
    activity: z.object({
      totalDurationMs: nonNegativeIntegerSchema,
      averageDurationMs: nonNegativeIntegerSchema,
      byDay: z.array(
        z.object({
          day: z.string(),
          sessionCount: nonNegativeIntegerSchema,
          totals: usageTotalsSchema,
        })
      ),
      byHour: z.array(
        z.object({
          hour: z.number().int().min(0).max(23),
          sessionCount: nonNegativeIntegerSchema,
          totals: usageTotalsSchema,
        })
      ),
    }),
    shares: z.object({
      topDimension: z.enum(["workspace", "provider", "model", "task"]),
      items: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          shareOfTokens: z.number().min(0).max(1),
          totalTokens: nonNegativeIntegerSchema,
        })
      ),
    }),
    coverage: z.object({
      sessionCount: nonNegativeIntegerSchema,
      workspaceCount: nonNegativeIntegerSchema,
      providerCount: nonNegativeIntegerSchema,
      timeRangeLabel: z.string(),
      usage: usageCoverageSchema.optional(),
    }),
  }),
  breakdowns: z.object({
    byWorkspace: z.array(dimensionBreakdownSchema),
    byProvider: z.array(dimensionBreakdownSchema),
    byModel: z.array(dimensionBreakdownSchema),
    byTask: z.array(dimensionBreakdownSchema),
    byTool: z.array(toolBreakdownSchema),
    byCommand: z.array(toolBreakdownSchema),
  }),
  sessions: z.object({
    featured: z.object({
      topByTotalTokens: z.array(sessionInsightSchema),
      topByOutputTokens: z.array(sessionInsightSchema),
      lowYield: z.array(sessionInsightSchema),
      topShipped: z.array(sessionInsightSchema),
    }),
  }),
  tasks: z.object({
    turns: z.array(taskTurnSchema),
    byType: z.array(
      z.object({
        taskType: taskTypeSchema,
        turnCount: nonNegativeIntegerSchema.optional(),
        sessionCount: nonNegativeIntegerSchema,
        totals: usageTotalsSchema,
        providerIds: z.array(z.string()),
        modelIds: z.array(z.string()),
        workspacePaths: z.array(z.string()),
      })
    ),
    byTypeAndModel: z.array(taskSummaryByModelSchema),
    byTypeAndWorkspace: z.array(taskSummaryByWorkspaceSchema),
  }),
  efficiency: z.object({
    overall: efficiencySummarySchema,
    byProvider: z.array(
      z.object({
        providerId: z.string(),
        summary: efficiencySummarySchema,
      })
    ),
    byTask: z.array(
      z.object({
        taskType: taskTypeSchema,
        summary: taskEfficiencySummarySchema,
      })
    ),
  }),
  optimize: z.object({
    totalFindings: nonNegativeIntegerSchema,
    totalEstimatedWastedTokens: nonNegativeIntegerSchema,
    findings: z.array(optimizeFindingSchema),
  }),
  delivery: z.object({
    yield: z
      .object({
        overall: yieldSummarySchema,
        byWorkspace: z.array(
          z.object({
            workspacePath: z.string(),
            summary: yieldSummarySchema,
          })
        ),
        byTask: z.array(
          z.object({
            taskType: taskTypeSchema,
            summary: yieldSummarySchema,
            turnBehavior: turnBehaviorSummarySchema.optional(),
          })
        ),
        topShippedSessions: z.array(
          z.object({
            sessionId: z.string(),
            providerId: z.string(),
            workspacePath: z.string(),
            taskType: taskTypeSchema,
            totalTokens: nonNegativeIntegerSchema,
            shippedSignals: z.array(z.string()),
          })
        ),
        lowYieldSessions: z.array(
          z.object({
            sessionId: z.string(),
            providerId: z.string(),
            workspacePath: z.string(),
            taskType: taskTypeSchema,
            totalTokens: nonNegativeIntegerSchema,
            missedSignals: z.array(z.string()),
          })
        ),
        limitations: z.array(z.string()),
      })
      .optional(),
  }),
  capabilities: z.object({
    providers: z.array(
      z.object({
        providerId: z.string(),
        workspacePath: z.enum(["full", "partial", "none"]),
        timestamps: z.enum(["full", "partial", "none"]),
        sessionCounts: z.enum(["full", "partial", "none"]),
        toolCounts: z.enum(["full", "partial", "none"]),
        modelIdentity: z.enum(["full", "partial", "none"]),
        tokenUsage: z.enum(["full", "partial", "none"]),
        cacheUsage: z.enum(["full", "partial", "none"]),
        reasoningUsage: z.enum(["full", "partial", "none"]),
        costEstimation: z.enum(["full", "partial", "none"]),
      })
    ),
    skillInventory: z.object({
      installedCount: nonNegativeIntegerSchema,
      mountedCount: nonNegativeIntegerSchema,
      unmountedCount: nonNegativeIntegerSchema,
    }),
  }),
  dataSources: z.object({
    providers: z.array(dataSourceProviderSchema),
    dataQuality: z.object({
      clampedDurationCount: nonNegativeIntegerSchema,
      emptySessionCount: nonNegativeIntegerSchema,
    }),
  }),
});

export const workBasicAnalysisResultSchema = z.object({
  availableWorkspacePaths: z.array(z.string()),
  snapshotV2: snapshotV2Schema.optional(),
  capabilityMatrix: z.object({
    providers: z.array(
      z.object({
        providerId: z.string(),
        workspacePath: z.enum(["full", "partial", "none"]),
        timestamps: z.enum(["full", "partial", "none"]),
        sessionCounts: z.enum(["full", "partial", "none"]),
        toolCounts: z.enum(["full", "partial", "none"]),
        modelIdentity: z.enum(["full", "partial", "none"]),
        tokenUsage: z.enum(["full", "partial", "none"]),
        cacheUsage: z.enum(["full", "partial", "none"]),
        reasoningUsage: z.enum(["full", "partial", "none"]),
        costEstimation: z.enum(["full", "partial", "none"]),
      })
    ),
  }),
  coverage: z.object({
    workspaceCount: nonNegativeIntegerSchema,
    sessionCount: nonNegativeIntegerSchema,
    providerCount: nonNegativeIntegerSchema,
    timeRangeLabel: z.string(),
    usage: usageCoverageSchema.optional(),
  }),
  activity: z.object({
    sessionCount: nonNegativeIntegerSchema,
    totalDurationMs: nonNegativeIntegerSchema,
    averageDurationMs: nonNegativeIntegerSchema,
    daily: z.array(dailyActivityBucketSchema),
  }),
  workHabits: z.object({
    hourBuckets: z.array(
      z.object({
        hour: z.number().int().min(0).max(23),
        sessionCount: nonNegativeIntegerSchema,
      })
    ),
  }),
  skillInventory: z.object({
    installedCount: nonNegativeIntegerSchema,
    mountedCount: nonNegativeIntegerSchema,
    unmountedCount: nonNegativeIntegerSchema,
  }),
  usage: z.object({
    totalSessions: nonNegativeIntegerSchema,
    sessionsByProvider: z.record(z.string(), nonNegativeIntegerSchema),
    totals: usageTotalsSchema,
    byDay: z.array(
      z.object({
        day: z.string(),
        sessionCount: nonNegativeIntegerSchema,
        totals: usageTotalsSchema,
      })
    ),
    byHour: z.array(
      z.object({
        hour: z.number().int().min(0).max(23),
        sessionCount: nonNegativeIntegerSchema,
        totals: usageTotalsSchema,
      })
    ),
    byProvider: z.array(
      z.object({
        providerId: z.string(),
        sessionCount: nonNegativeIntegerSchema,
        totals: usageTotalsSchema,
      })
    ),
    byWorkspace: z.array(
      z.object({
        workspacePath: z.string(),
        sessionCount: nonNegativeIntegerSchema,
        totals: usageTotalsSchema,
      })
    ),
    byModel: z.array(
      z.object({
        modelId: z.string(),
        providerId: z.string(),
        sessionCount: nonNegativeIntegerSchema,
        totals: usageTotalsSchema,
      })
    ),
    byTool: z.array(
      z.object({
        toolName: z.string(),
        sessionCount: nonNegativeIntegerSchema,
        useCount: nonNegativeIntegerSchema,
        totals: usageTotalsSchema,
      })
    ),
    byCommand: z.array(
      z.object({
        commandLabel: z.string(),
        sessionCount: nonNegativeIntegerSchema,
        useCount: nonNegativeIntegerSchema,
        totals: usageTotalsSchema,
      })
    ),
    topSessionsByTotalTokens: z.array(
      z.object({
        sessionId: z.string(),
        providerId: z.string(),
        workspacePath: z.string(),
        modelId: z.string().optional(),
        totalTokens: nonNegativeIntegerSchema,
      })
    ),
  }),
  tasks: z.object({
    turns: z.array(taskTurnSchema).optional(),
    byType: z.array(
      z.object({
        taskType: taskTypeSchema,
        turnCount: nonNegativeIntegerSchema.optional(),
        sessionCount: nonNegativeIntegerSchema,
        totals: usageTotalsSchema,
        providerIds: z.array(z.string()),
        modelIds: z.array(z.string()),
        workspacePaths: z.array(z.string()),
      })
    ),
    byTypeAndModel: z.array(taskSummaryByModelSchema).optional(),
    byTypeAndWorkspace: z.array(taskSummaryByWorkspaceSchema).optional(),
    sessions: z.array(
      z.object({
        sessionId: z.string(),
        providerId: z.string(),
        workspacePath: z.string(),
        modelId: z.string().optional(),
        primaryTask: taskTypeSchema,
        signals: z.array(z.string()),
        totalTokens: nonNegativeIntegerSchema,
      })
    ),
  }),
  efficiency: z.object({
    overall: efficiencySummarySchema,
    byProvider: z.array(
      z.object({
        providerId: z.string(),
        summary: efficiencySummarySchema,
      })
    ),
    byTask: z.array(
      z.object({
        taskType: taskTypeSchema,
        summary: taskEfficiencySummarySchema,
      })
    ),
  }),
  optimize: z.object({
    totalFindings: nonNegativeIntegerSchema,
    totalEstimatedWastedTokens: nonNegativeIntegerSchema,
    findings: z.array(optimizeFindingSchema),
  }),
  compare: z.object({
    topDimension: z.enum(["workspace", "provider", "model", "task"]),
    workspaces: z.array(compareRankingEntrySchema.extend({ workspacePath: z.string() })),
    providers: z.array(compareRankingEntrySchema.extend({ providerId: z.string() })),
    models: z.array(
      compareRankingEntrySchema.extend({
        providerId: z.string(),
        modelId: z.string(),
      })
    ),
    tasks: z.array(compareRankingEntrySchema.extend({ taskType: taskTypeSchema })),
    dimensions: z.object({
      workspace: z.array(compareDimensionSummarySchema),
      provider: z.array(compareDimensionSummarySchema),
      model: z.array(compareDimensionSummarySchema),
      task: z.array(compareDimensionSummarySchema),
    }),
  }),
  yield: z.object({
    overall: yieldSummarySchema,
    byWorkspace: z.array(
      z.object({
        workspacePath: z.string(),
        summary: yieldSummarySchema,
      })
    ),
    byTask: z.array(
      z.object({
        taskType: taskTypeSchema,
        summary: yieldSummarySchema,
        turnBehavior: turnBehaviorSummarySchema.optional(),
      })
    ),
    topShippedSessions: z.array(
      z.object({
        sessionId: z.string(),
        providerId: z.string(),
        workspacePath: z.string(),
        taskType: taskTypeSchema,
        totalTokens: nonNegativeIntegerSchema,
        shippedSignals: z.array(z.string()),
      })
    ),
    lowYieldSessions: z.array(
      z.object({
        sessionId: z.string(),
        providerId: z.string(),
        workspacePath: z.string(),
        taskType: taskTypeSchema,
        totalTokens: nonNegativeIntegerSchema,
        missedSignals: z.array(z.string()),
      })
    ),
    limitations: z.array(z.string()),
  }),
  agentModelMix: z.object({
    providers: z.array(
      z.object({
        providerId: z.string(),
        sessionCount: nonNegativeIntegerSchema,
      })
    ),
  }),
  workSurface: z.object({
    workspacePaths: z.array(z.string()),
  }),
  executionSignals: z.object({
    sessionsWithActivity: nonNegativeIntegerSchema,
    userTurnCount: nonNegativeIntegerSchema,
    assistantTurnCount: nonNegativeIntegerSchema,
    toolUseCount: nonNegativeIntegerSchema,
    fileMtimeTimestampCount: nonNegativeIntegerSchema,
  }),
  dataSources: z.object({
    providers: z.array(dataSourceProviderSchema),
  }),
  dataQuality: z.object({
    clampedDurationCount: nonNegativeIntegerSchema,
    emptySessionCount: nonNegativeIntegerSchema,
  }),
});
