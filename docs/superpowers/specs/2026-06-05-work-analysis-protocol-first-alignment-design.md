# Work Analysis Protocol-First Alignment Design

Date: 2026-06-05
Status: Draft
Owner: Codex

## Problem

当前 `/analytics` 已经积累了一批基础能力，但协议仍然偏“页面驱动”：

- `basicResult` 中的数据域来自不同阶段逐步补丁式增加，字段分散、层次不统一。
- 前端页面消费的是一组“够当前卡片用”的聚合字段，而不是稳定的 analytics snapshot。
- session、breakdown、efficiency、yield、budget 等能力之间缺少统一边界，导致页面继续演进时只能不断拼字段。
- 真实日志已经能稳定产出不少高价值 usage 数据，但协议结构还不足以支撑更强的 drill-down 和后续图表化。

这会导致两个问题：

1. 基础分析继续做下去会越来越难维护。
2. 前端即使重做，也会被当前协议天花板卡住。

因此，这一轮改为先补后端大协议，再统一前端消费结构。

## Goal

把 `工作分析` 的基础分析结果升级为一个真正的 `analytics snapshot contract`，让后端先具备完整、统一、可扩展的分析模型，然后前端围绕这份模型重组页面。

本轮目标：

- 建立统一的 `snapshot` 协议边界
- 统一 breakdown / session drill-down / efficiency / optimize / delivery 数据域
- 为后续更强图表和深入分析提供稳定输入
- 让前端从“按页面拼字段”改成“按域消费协议”

## Non-Goals

- 本轮不优先追求最小改动
- 不继续只做前端局部补视觉
- 不做 deep analysis 产品重构
- 不做实时刷新或后台增量索引
- 不做 token 到货币金额的映射
- 不要求所有 provider 立刻达到同等能力

## Why This Direction

相比“继续前端增强”，`protocol-first` 的优势是：

- 上限更高：后续图表、榜单、导出、异常分析都能复用同一份 contract
- 结构更稳：前端不必继续感知后端内部补丁式字段
- 更接近 CodeBurn：先把分析模型做厚，再让 UI 做薄

代价也明确：

- 这轮开发更重
- 需要做一次字段迁移和页面适配
- 短期内比只改前端慢

这是刻意选择，不再把“先把基础分析做扎实”理解成“只补前端表现层”。

## Design Principles

### Snapshot-First

页面只消费一个完整的基础分析快照，不再围绕零散字段做隐式推导。

### Domain-Oriented

协议按分析域拆分，而不是按页面卡片拆分。

### Capability-Transparent

每个域都能表达数据完整性与能力边界，不能假装所有 provider 对称。

### Drill-Down Ready

所有榜单和趋势都必须能追溯到 session 级明细，不允许只有 summary 没有样本。

### Forward-Compatible

本轮新增字段和结构要允许后续接 deep analysis、历史趋势存储、导出报告，而不是下一轮再推翻。

## Architecture

协议重构分三层。

### 1. Canonical Collection Layer

保持当前 provider log collection 入口，但显式把产物视为标准化输入层：

- `provider discoveries`
- `normalized sessions`
- `normalized events`
- `provider capability states`

这一层关注“能稳定拿到什么”，不直接为 UI 负责。

最小输入单元仍然是 `WorkLogSession` 与 `WorkLogEvent`，但要求：

- `usage` 字段标准化
- `workspacePath / providerId / modelId / timestamps` 一致化
- `events` 足够支撑后续效率和产出推导

### 2. Derived Metrics Layer

从标准化 session/event 输入中，派生统一分析域：

- overview
- breakdowns
- sessions
- efficiency
- optimize
- delivery
- capabilities
- dataSources

这一层是本轮后端核心。

### 3. Materialized Snapshot Layer

把基础分析输出固化为单个 `WorkBasicAnalysisSnapshotV2`。

要求：

- query-scoped
- self-contained
- export-friendly
- 前端可以独立消费

页面切 tab 不再依赖对多个历史字段做二次拼接。

## Proposed Contract

### Top-Level Structure

新的基础分析结果建议组织为：

```ts
interface WorkBasicAnalysisResultV2 {
  version: 2;
  query: {
    timeRangeLabel: string;
    selectedWorkspacePaths: string[];
    availableWorkspacePaths: string[];
  };
  overview: WorkAnalysisOverviewDomain;
  breakdowns: WorkAnalysisBreakdownsDomain;
  sessions: WorkAnalysisSessionsDomain;
  efficiency: WorkAnalysisEfficiencyDomain;
  optimize: WorkAnalysisOptimizeDomain;
  delivery: WorkAnalysisDeliveryDomain;
  capabilities: WorkAnalysisCapabilitiesDomain;
  dataSources: WorkAnalysisDataSourcesDomain;
  exports: WorkAnalysisExportsDomain;
}
```

这里的重点不是名字，而是：

- 前端以后按域消费
- 域内自己闭环
- 域间字段命名统一

### 1. `overview`

回答“总量、覆盖、趋势、基础概况是什么”。

```ts
interface WorkAnalysisOverviewDomain {
  totals: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    reasoningOutputTokens: number;
    sessionCount: number;
    workspaceCount: number;
    providerCount: number;
    taskTypeCount: number;
  };
  activity: {
    totalDurationMs: number;
    averageDurationMs: number;
    byDay: Array<{
      day: string;
      sessionCount: number;
      totals: WorkAnalysisUsageTotals;
    }>;
    byHour: Array<{
      hour: number;
      sessionCount: number;
      totals: WorkAnalysisUsageTotals;
    }>;
  };
  shares: {
    topDimension: "workspace" | "provider" | "model" | "task";
    items: Array<{
      key: string;
      label: string;
      shareOfTokens: number;
      totalTokens: number;
    }>;
  };
  coverage: {
    sessionCount: number;
    workspaceCount: number;
    providerCount: number;
    timeRangeLabel: string;
  };
}
```

说明：

- 当前 `coverage + activity + usage.totals + compare.topDimension` 会折叠进这里
- 页面概览区只读 `overview`

### 2. `breakdowns`

回答“不同维度怎么拆、怎么排、怎么比”。

```ts
interface WorkAnalysisBreakdownsDomain {
  byWorkspace: WorkAnalysisDimensionBreakdown[];
  byProvider: WorkAnalysisDimensionBreakdown[];
  byModel: WorkAnalysisDimensionBreakdown[];
  byTask: WorkAnalysisDimensionBreakdown[];
  byTool: WorkAnalysisToolBreakdown[];
  byCommand: WorkAnalysisCommandBreakdown[];
}

interface WorkAnalysisDimensionBreakdown {
  key: string;
  label: string;
  sessionCount: number;
  totals: WorkAnalysisUsageTotals;
  shareOfTokens: number;
  averageTokensPerSession: number;
  averageOutputShare: number;
  relatedProviders?: string[];
  relatedModels?: string[];
  relatedWorkspacePaths?: string[];
}
```

说明：

- 当前 `usage.byX + compare + tasks.byType` 中重叠的结构统一在这里
- 前端所有排行榜、表格、趋势切片以后都从 `breakdowns` 取数

### 3. `sessions`

回答“具体哪些 session 值得看”。

```ts
interface WorkAnalysisSessionsDomain {
  featured: {
    topByTotalTokens: WorkAnalysisSessionInsight[];
    topByOutputTokens: WorkAnalysisSessionInsight[];
    lowYield: WorkAnalysisSessionInsight[];
    shippedCandidates: WorkAnalysisSessionInsight[];
    retryHeavy: WorkAnalysisSessionInsight[];
  };
  table: WorkAnalysisSessionInsight[];
}

interface WorkAnalysisSessionInsight {
  sessionId: string;
  providerId: string;
  workspacePath: string;
  modelId?: string;
  taskType?: WorkAnalysisTaskType;
  startedAt: number;
  lastActiveAt: number;
  totals: WorkAnalysisUsageTotals;
  eventCounts: {
    userTurns: number;
    assistantTurns: number;
    toolUses: number;
    commands: number;
    edits: number;
    gitSignals: number;
  };
  derivedSignals: string[];
  ranks: {
    byTotalTokens?: number;
    byOutputTokens?: number;
    byWasteRisk?: number;
  };
}
```

说明：

- 当前 `usage.topSessionsByTotalTokens`、`tasks.sessions`、`yield.topShippedSessions`、`yield.lowYieldSessions` 会合并到这一个域
- 页面不再分散地读取多个 session 列表

### 4. `efficiency`

回答“token 花得值不值”。

```ts
interface WorkAnalysisEfficiencyDomain {
  overall: WorkAnalysisEfficiencySummary;
  byProvider: Array<{
    providerId: string;
    summary: WorkAnalysisEfficiencySummary;
  }>;
  byTask: Array<{
    taskType: WorkAnalysisTaskType;
    summary: WorkAnalysisEfficiencySummary;
  }>;
}
```

说明：

- 保留当前指标模型
- 结构上只允许 `overall / byProvider / byTask`
- 后续如需按 workspace 扩展，可以在同域新增，不再散落

### 5. `optimize`

回答“浪费和异常在哪里”。

```ts
interface WorkAnalysisOptimizeDomain {
  summary: {
    findingCount: number;
    estimatedWastedTokens: number;
  };
  findings: WorkAnalysisOptimizeFinding[];
}
```

说明：

- 当前 optimize 域已经接近目标
- 这轮主要做结构固化和与 `sessions` 的关联统一

### 6. `delivery`

回答“有没有产出、预算情况如何、能不能导出”。

```ts
interface WorkAnalysisDeliveryDomain {
  yield: {
    overall: WorkAnalysisYieldSummary;
    byWorkspace: Array<{
      workspacePath: string;
      sessionCount: number;
      shippedSessionRate: number;
      shippedTokenShare: number;
    }>;
    byTask: Array<{
      taskType: WorkAnalysisTaskType;
      sessionCount: number;
      shippedSessionRate: number;
      shippedTokenShare: number;
    }>;
  };
  budgets: {
    periodLabel: string;
    observedDays: number;
    activeDays: number;
    totalTokens: number;
    averageTokensPerActiveDay: number;
    projected30DayTokens: number;
    targets: WorkAnalysisBudgetTarget[];
    byWorkspace: Array<{
      workspacePath: string;
      tokenBudget: number;
      consumedTokens: number;
      utilizationRate: number;
    }>;
  };
}
```

说明：

- 当前 `yield + budgets` 合并进同一域
- “产出”和“预算”本质都是回答 token 是否有效使用

### 7. `capabilities`

回答“哪些 provider 的哪些维度可信、哪些不可信”。

```ts
interface WorkAnalysisCapabilitiesDomain {
  providers: WorkAnalysisProviderCapability[];
  coverageNotes: string[];
}
```

说明：

- 当前 `capabilityMatrix` 升级为独立分析域
- 允许后续加入解释文案或自动生成 notes

### 8. `dataSources`

回答“数据从哪里来、完整性如何”。

```ts
interface WorkAnalysisDataSourcesDomain {
  providers: Array<{
    providerId: string;
    status: "supported" | "no_logs" | "missing_root" | "partial" | "unsupported";
    sessionCount: number;
    parseErrorCount: number;
    warningCount: number;
  }>;
}
```

说明：

- 保留当前形态
- 作为独立域保留下来，不再挂在页面边角

## Migration Strategy

### Phase 1. Introduce V2 In Parallel

先在后端引入 `WorkBasicAnalysisResultV2`，但保留当前 `basicResult` 读取路径。

策略：

- analyzer 输出新域结构
- schema 同时支持旧字段和新字段过渡
- 页面先做双读兼容，优先消费 V2

### Phase 2. Move Frontend To Domain Consumption

前端改成：

- `overview` tab 只消费 `overview`
- `compare` tab 只消费 `breakdowns`
- `yield` tab 只消费 `sessions + delivery + efficiency`
- `optimize` tab 只消费 `optimize + sessions`

这样就能删掉大量页面内派生逻辑。

### Phase 3. Remove Redundant Legacy Fields

在页面完全切到 V2 后，再移除旧字段镜像，避免长期维护两套 contract。

## Real Provider Capability Mapping

基于当前真实日志与现有解析能力，本轮能力等级定义如下。

### Claude

- workspacePath: full
- timestamps: full
- sessionCounts: full
- toolCounts: partial
- modelIdentity: full
- tokenUsage: full
- cacheUsage: full
- reasoningUsage: partial
- costEstimation: none

### Codex

- workspacePath: full
- timestamps: full
- sessionCounts: full
- toolCounts: partial
- modelIdentity: partial
- tokenUsage: full
- cacheUsage: partial
- reasoningUsage: full
- costEstimation: none

### Gemini

- workspacePath: partial
- timestamps: partial
- sessionCounts: full
- toolCounts: partial
- modelIdentity: partial
- tokenUsage: none
- cacheUsage: none
- reasoningUsage: none
- costEstimation: none

### Cursor

- workspacePath: partial
- timestamps: partial
- sessionCounts: full
- toolCounts: partial
- modelIdentity: none
- tokenUsage: none
- cacheUsage: none
- reasoningUsage: none
- costEstimation: none

### OpenCode

- workspacePath: partial
- timestamps: partial
- sessionCounts: full
- toolCounts: partial
- modelIdentity: partial
- tokenUsage: none
- cacheUsage: none
- reasoningUsage: none
- costEstimation: none

## Frontend Consequences

当前页面将做一次结构统一，不再继续以“现有 tab 下补几个卡片”为主。

前端后续应遵守：

- 不直接读取旧 `usage.byX / compare / tasks / yield` 的散字段组合
- 不在页面内重新计算 session featured lists
- 不在页面内手写 domain 合并逻辑

页面组件建议对应分析域拆分：

- `overview-surface`
- `breakdown-surface`
- `session-insight-surface`
- `efficiency-surface`
- `optimize-surface`
- `delivery-surface`

## Testing Strategy

### Backend

新增或重写测试覆盖：

- V2 snapshot schema validation
- breakdown domain consistency
- session featured list derivation
- capability mapping correctness
- delivery domain correctness
- legacy-to-v2 migration compatibility

### Frontend

页面测试改为断言域消费结果，而不是散字段文本。

重点验证：

- overview 使用 V2 totals/activity/shares
- compare 使用 V2 breakdowns
- yield 使用 V2 sessions/delivery
- optimize 使用 V2 optimize/sessions

### E2E

真实数据验收至少验证：

- 发现多个真实 workspace
- overview 显示真实 token/session 总量
- compare 显示真实多目录排行
- yield 显示真实 session 样本

## Risks

### Contract Inflation

一次引入太多字段，可能让 schema 和页面迁移变重。

控制方法：

- 只引入有真实消费目标的域
- 避免纯理论字段

### Dual-Read Complexity

过渡期前后端可能要兼容两套结构。

控制方法：

- 明确 `version: 2`
- 前端优先读 V2，旧结构只做短期兜底

### Provider Asymmetry

不同 provider 的能力差异会放大。

控制方法：

- 通过 `capabilities` 和 `dataSources` 显式展示
- 不把缺失能力假装成 0

## Acceptance

这一轮完成后，应满足：

1. 基础分析结果能以单个 V2 snapshot 覆盖 overview / breakdown / sessions / efficiency / optimize / delivery 主要视图。
2. 前端主页面可以按域消费数据，而不是继续拼散字段。
3. 使用真实日志运行时，workspace、token、session、provider coverage、top sessions 都能通过新协议稳定表达。
4. 后续继续做更强图表、导出和 drill-down 时，不需要再先改一次大协议。
