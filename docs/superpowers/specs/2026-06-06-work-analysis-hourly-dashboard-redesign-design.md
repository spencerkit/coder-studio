# Work Analysis Hourly Dashboard Redesign

Date: 2026-06-06
Status: Approved for first implementation
Owner: Codex

## Problem

当前工作分析仍然像一个需要手动触发的报告页：

- 用户进入页面时经常没有现成结果，需要先点击运行基础分析。
- `WorkAnalysisRecord` 以 `queryDigest` 缓存一次性快照，不适合作为长期趋势和自动刷新基础。
- 页面直接消费复杂 `basicResult/snapshotV2`，前端需要大量兼容映射，信息层级混乱。
- token 趋势、项目贡献、模型贡献、agent 贡献不够直观。

## Goals

- 工作分析默认展示已有缓存数据，用户不需要先手动运行基础分析。
- 支持手动刷新和自动刷新两种扫描方式。
- 自动扫描每小时运行一次，刷新 provider 本地日志索引。
- 基础扫描以小时维度聚合 token、会话数、活跃时间、项目、模型、agent、provider 等数据。
- 概览页采用扁平化专业仪表盘布局：
  - KPI 状态条
  - Token 趋势独占一整行
  - 下一行三列展示项目、模型、agent token 贡献排行
  - 继续展示任务/工具大头、小时热力图、数据质量和扫描状态
- 不要求兼容旧页面结构；可以推翻当前工作分析 UI。

## Non-Goals

- 不在第一版引入远程服务或云同步。
- 不在第一版做真实费用金额估算。
- 不要求所有 provider 立即达到完整 usage coverage。
- 不把深入分析作为概览页核心依赖。
- 不在第一版实现无限 drill-down；先保证 dashboard 可用。

## Product Model

`基础分析` 的产品语义改为 `刷新索引`：

- 自动刷新：服务启动后后台调度，每小时运行一次。
- 手动刷新：用户点击 `立即刷新索引`，强制扫描当前时间范围并更新缓存。
- 页面读取：`work.analysis.dashboard` 直接返回 dashboard projection。
- 深入分析：后续基于缓存中的 sessions/events 抽样生成洞察，作为可选二级能力。

## Data Model

第一版采用本地 JSON repo，结构按索引库设计，后续可迁移 SQLite。

```ts
interface WorkAnalysisDashboardCache {
  version: 1;
  scanState: WorkAnalysisScanState;
  dashboard: WorkAnalysisDashboardProjection;
}

interface WorkAnalysisScanState {
  mode: "manual" | "auto";
  status: "idle" | "running" | "succeeded" | "failed";
  lastStartedAt?: number;
  lastCompletedAt?: number;
  nextScheduledAt?: number;
  errorMessage?: string;
  sourceDigest?: string;
  providerStatuses: WorkAnalysisProviderStatus[];
}

interface WorkAnalysisDashboardProjection {
  generatedAt: number;
  timeRange: ResolvedWorkAnalysisTimeRange;
  filters: WorkAnalysisDashboardQuery;
  kpis: WorkAnalysisDashboardKpi[];
  trends: {
    tokenHourly: WorkAnalysisTokenTrendPoint[];
    tokenDaily: WorkAnalysisTokenTrendPoint[];
    hourHeatmap: WorkAnalysisHourHeatPoint[];
  };
  rankings: {
    projects: WorkAnalysisContributionRank[];
    models: WorkAnalysisContributionRank[];
    agents: WorkAnalysisContributionRank[];
  };
  breakdowns: {
    tasks: WorkAnalysisContributionRank[];
    tools: WorkAnalysisContributionRank[];
  };
  quality: WorkAnalysisDataQualitySummary;
}
```

Hourly aggregation uses absolute `hourStart` timestamps rather than `0-23` buckets. This lets the UI render real trends across days and still derive the hour heatmap.

## Backend Design

Add a dashboard-oriented service path beside the existing basic/deep commands:

- `work.analysis.dashboard.get`
  - returns cached dashboard projection when available
  - if no cache exists, returns an empty projection with scan state
- `work.analysis.dashboard.refresh`
  - runs a manual scan for the requested range/filter
  - updates the dashboard cache
  - returns the new projection

The first implementation may reuse the existing `workLogCollector.collect()` and `analyzeWorkBasic()` instead of introducing a full normalized fact store immediately. The important contract change is that the service materializes dashboard projection and scan state separately from query snapshot records.

Automatic scanning is owned by `WorkAnalysisService`:

- `startAutoScan()` schedules a scan every hour.
- The scheduler avoids overlapping scans.
- The default query is `90d` with all known workspaces.
- Manual refresh can run independently but should share the same scan lock.

## Frontend Design

Replace the current tab-heavy work analysis page with an overview-first dashboard.

Primary layout:

1. Top status strip: auto scan enabled, last scan, next scan, coverage warnings.
2. Filter bar: time range, projects, provider, model, agent, metric.
3. KPI row: total tokens, input/output, sessions, active time, top project share.
4. Token trend row: full-width chart.
5. Contribution row: three columns:
   - project token contribution ranking
   - model token contribution ranking
   - agent token contribution ranking
6. Secondary row: model/agent/task/tool highlights and hour heatmap.
7. Operational row: scan pipeline and data quality.

The visual direction is flat and professional:

- light background
- white panels
- fine borders
- low shadow
- table-based rankings
- restrained blue accent

## Error Handling

- If dashboard cache is absent, show empty state with `立即刷新索引`.
- If refresh fails, keep the last successful dashboard and show scan error in the status strip.
- If some providers are partial, show data quality warning without blocking the dashboard.
- If a selected filter yields no data, show zeroed KPI cards and empty ranking panels.

## Testing

Backend tests:

- dashboard refresh builds token trend and three contribution rankings
- cached dashboard can be read without rescanning
- refresh failure updates scan state but does not erase prior dashboard

Frontend tests:

- page renders token trend before contribution rankings
- contribution section renders project/model/agent rankings as three separate groups
- refresh button dispatches dashboard refresh command

## First Slice

The first implementation should land a working dashboard path using the existing collector/analyzer data rather than building the full future fact store in one step. This gives users the visible product improvement now while keeping the protocol shaped for hourly indexing.
