# Work Analysis Token-First Implementation Plan

Date: 2026-06-04
Status: Draft
Owner: spencer
Depends on: [2026-06-04-work-analysis-codeburn-full-alignment-plan.md](/root/workspace/coder-studio/docs/superpowers/plans/2026-06-04-work-analysis-codeburn-full-alignment-plan.md)

## Goal

把 `工作分析` 按 `token = 实际开销单位` 的口径拆成可直接开发的 implementation plan。

这份文档回答 5 个问题：

- 每个 phase 具体做什么
- 要改哪些后端模块
- 前端最终展示哪些数据
- 测试怎么做
- 哪些地方只能部分实现

## Product Target

最终产品不是“设置页里的一个分析块”，而是独立的 analytics surface，至少包含：

- `Overview`
- `Tasks`
- `Models`
- `Optimize`
- `Yield`
- `Compare`
- `Budgets`
- `Exports`

设置页里的 `工作分析` 应退化成入口和轻量摘要，不再承载完整分析产品。

## Milestone Plan

### Milestone A

- Phase 0: Canonical Event Model
- Phase 1: Token Economics Engine
- Phase 2: Task Classification

目标：

- token 分析内核站稳
- task 维度出来
- Overview / Tasks / Models 可以成立

### Milestone B

- Phase 3: Efficiency Metrics
- Phase 4: Optimize

目标：

- 从“统计”升级到“诊断”

### Milestone C

- Phase 5: Compare
- Phase 6: Yield

目标：

- 从“单点观察”升级到“决策支持”

### Milestone D

- Phase 7: Token Budgets
- Phase 8: Reports & Export
- Phase 9: Dedicated Analytics Surface

目标：

- 变成可长期使用的分析产品

## Phase 0: Canonical Event Model

### Purpose

把当前 session summary 模式升级为事件流模式。

没有这一步，后面 task、efficiency、optimize、yield 都会失真。

### Backend Work

新增或扩展：

- `packages/server/src/work-analysis/log-sources/types.ts`
- `packages/server/src/work-analysis/events.ts`
- `packages/server/src/work-analysis/event-normalizer.ts`
- `packages/server/src/work-analysis/event-store.ts`

建议新增核心类型：

- `WorkAnalysisSession`
- `WorkAnalysisEvent`
- `WorkAnalysisMessageEvent`
- `WorkAnalysisToolEvent`
- `WorkAnalysisCommandEvent`
- `WorkAnalysisEditEvent`
- `WorkAnalysisGitEvent`
- `WorkAnalysisPlanEvent`
- `WorkAnalysisAgentEvent`
- `WorkAnalysisUsageEvent`

每个 event 建议字段：

- `eventId`
- `sessionId`
- `providerId`
- `workspacePath`
- `eventType`
- `occurredAt`
- `timestampQuality`
- `modelId`
- `tokenUsage`
- `payload`
- `evidence`

provider adapter 要做的事：

- `codex.ts`
  - 提取 message/tool/command/token_count/agent 事件
- `claude.ts`
  - 提取 user/assistant/tool/use/thinking/usage 事件
- `gemini.ts`
  - 尽可能提取 prompt / response / tool / usage
- `cursor.ts`
  - 从 transcript 里提取 command/tool/edit proxy signals
- `opencode.ts`
  - 从 sqlite session rows 与 action rows 提取结构化事件

### Data To Persist

建议持久化两层：

- raw normalized events
- materialized session summaries

这样可以：

- 快速加载 overview
- 深入分析时再读 events

### Frontend Impact

这一 phase 前台不需要大改，只要给后续页面预留 session timeline drill-down 即可。

### User-Visible Data

Phase 0 完成后，单个 session 至少可以看到：

- 开始/结束时间
- 每轮 message
- 使用过哪些工具
- 执行过哪些命令
- 是否有 edit signal
- 是否有 plan / subagent / git signal
- 每轮或每段 usage

### Tests

新增测试：

- adapter parser fixtures
- event order tests
- timestamp quality fallback tests
- provider-specific extraction tests

验收标准：

- 至少 `Claude`、`Codex` 有真实 turn/event 提取
- event 顺序稳定
- 缺失字段不会导致整 session 报废

### Partial/Blocked Cases

- 某些 provider 不会显式给 edit event
- 某些 provider 只能恢复 command/tool，不能恢复完整 turn

这些 case 需要在 event 上标 `inferred`.

## Phase 1: Token Economics Engine

### Purpose

统一 token 统计口径，让 token 真正成为“开销单位”。

### Backend Work

新增：

- `packages/server/src/work-analysis/usage-economics/catalog.ts`
- `packages/server/src/work-analysis/usage-economics/model-aliases.ts`
- `packages/server/src/work-analysis/usage-economics/token-normalizer.ts`
- `packages/server/src/work-analysis/usage-economics/fallbacks.ts`
- `packages/server/src/work-analysis/usage-economics/aggregator.ts`

要做的逻辑：

- 统一 input/output/cache/reasoning/web-search token 字段
- 统一 `totalTokens` 计算规则
- 做 model alias normalization
- provider 缺字段时降级
- 输出 capability + confidence

### API Output

建议新增：

- `usage.totals`
- `usage.byProvider`
- `usage.byModel`
- `usage.byWorkspace`
- `usage.byTask`
- `usage.byDay`
- `usage.byHour`
- `usage.topSessions`
- `usage.topCommands`
- `usage.topTools`

### Frontend Pages

#### Overview

展示：

- total tokens
- input tokens
- output tokens
- cache tokens
- reasoning tokens
- sessions
- active days

#### Models

展示：

- model 排行
- model token composition
- model 在不同 task 的消耗

### User-Visible Data

用户会看到：

- 总 token
- 每天 token 趋势
- 每个 provider/model/workspace/task 的 token 排行
- 高消耗 session
- 高消耗 command/tool

### Tests

- usage normalization unit tests
- totalTokens derivation tests
- provider fallback tests
- real-log regression tests

验收标准：

- `Claude`、`Codex` token 聚合稳定
- 没 token 的 provider 不报错，只标 `usage unavailable`
- 页面上不再出现“金额/货币”概念

### Partial/Blocked Cases

- 没 usage 的 provider 只能参与 session count 和 activity，不能参与真实 token economics

## Phase 2: Task Classification

### Purpose

给每个 session 和主要 event 打上任务标签。

### Backend Work

新增：

- `packages/server/src/work-analysis/classification/task-taxonomy.ts`
- `packages/server/src/work-analysis/classification/task-rules.ts`
- `packages/server/src/work-analysis/classification/task-classifier.ts`
- `packages/server/src/work-analysis/classification/task-evidence.ts`

建议 v1 taxonomy：

- `coding`
- `debugging`
- `feature_dev`
- `refactoring`
- `testing`
- `exploration`
- `planning`
- `delegation`
- `git_ops`
- `build_deploy`
- `brainstorming`
- `conversation`
- `general`

分类信号：

- prompt text
- assistant plan text
- tool names
- shell commands
- edit presence
- git activity
- subagent spawn

### API Output

新增：

- `tasks.primaryTask`
- `tasks.secondaryTasks`
- `tasks.evidence`
- `tasks.byType`
- `tasks.byTypeAndModel`
- `tasks.byTypeAndWorkspace`

### Frontend Pages

#### Tasks

展示：

- 各 task 的 session 数
- 各 task 的 token 数
- 各 task 的平均时长
- 各 task 的模型分布
- task 热度趋势

### User-Visible Data

用户会看到：

- 过去 7 天主要在做什么
- 哪类任务最耗 token
- 哪类任务最常切模型
- 哪类任务最容易失败或重试

### Tests

- rule-based classification unit tests
- ambiguous session fallback tests
- evidence rendering tests

验收标准：

- 同一 fixture 多次运行分类结果稳定
- 证据链可解释
- 低置信度时自动落到 `general`

### Partial/Blocked Cases

- 混合任务长会话不可能做到 100% 单标签精确
- 需要接受 primary + secondary 的表达方式

## Phase 3: Efficiency Metrics

### Purpose

把“token 花了多少”升级成“token 花得值不值”。

### Backend Work

新增：

- `packages/server/src/work-analysis/metrics/one-shot.ts`
- `packages/server/src/work-analysis/metrics/retry.ts`
- `packages/server/src/work-analysis/metrics/self-correction.ts`
- `packages/server/src/work-analysis/metrics/cache.ts`
- `packages/server/src/work-analysis/metrics/read-edit.ts`
- `packages/server/src/work-analysis/metrics/session-efficiency.ts`

核心指标定义：

- `oneShotRate`
- `retryRate`
- `selfCorrectionRate`
- `tokensPerSession`
- `tokensPerEdit`
- `tokensPerSuccessfulTask`
- `cacheHitRate`
- `readEditRatio`
- `toolHeavyLowYieldRate`

### API Output

新增：

- `efficiency.overall`
- `efficiency.byModel`
- `efficiency.byProvider`
- `efficiency.byTask`
- `efficiency.byWorkspace`
- `efficiency.flaggedSessions`

### Frontend Pages

#### Overview

展示：

- one-shot rate
- retry rate
- average tokens per session
- cache hit rate

#### Models

展示：

- model efficiency table
- token vs one-shot scatter

#### Tasks

展示：

- task efficiency matrix

### User-Visible Data

用户会看到：

- 哪个模型 token 高但成功率低
- 哪类任务 retry 最多
- 哪类任务平均每次成功要消耗更多 token
- 哪些 session 工具调用很多但交付很弱

### Tests

- metric definition tests
- session replay fixtures
- low-signal provider fallback tests

验收标准：

- 所有指标都带明确定义
- 没有 edit signal 的 provider 指标会降级，不输出伪精度

### Partial/Blocked Cases

- `one-shot` 和 `tokensPerEdit` 强依赖 edit signal
- 对 Cursor/Gemini 等弱结构 transcript 可能只能部分支持

## Phase 4: Optimize

### Purpose

把分析结果转成“明确的浪费诊断和优化建议”。

### Backend Work

新增：

- `packages/server/src/work-analysis/optimize/detectors/repeated-rereads.ts`
- `packages/server/src/work-analysis/optimize/detectors/low-read-edit.ts`
- `packages/server/src/work-analysis/optimize/detectors/wasted-bash-output.ts`
- `packages/server/src/work-analysis/optimize/detectors/cache-overhead.ts`
- `packages/server/src/work-analysis/optimize/detectors/token-heavy-low-yield.ts`
- `packages/server/src/work-analysis/optimize/detectors/instruction-bloat.ts`
- `packages/server/src/work-analysis/optimize/detectors/idle-skills.ts`
- `packages/server/src/work-analysis/optimize/ranker.ts`
- `packages/server/src/work-analysis/optimize/finding-history.ts`

finding schema 建议字段：

- `id`
- `type`
- `severity`
- `title`
- `summary`
- `estimatedWastedTokens`
- `confidence`
- `affectedSessions`
- `affectedWorkspaces`
- `evidence`
- `suggestion`
- `status`

### API Output

新增：

- `optimize.findings`
- `optimize.summary`
- `optimize.byWorkspace`
- `optimize.byTask`
- `optimize.byModel`

### Frontend Pages

#### Optimize

展示：

- 问题列表
- 严重度过滤
- 按 workspace/task/model 筛选
- 预计浪费 token 排行
- 最近改善/恶化趋势

### User-Visible Data

用户会看到：

- 哪些行为最浪费 token
- 哪些 workspace 的问题最多
- 哪些模型在某类任务上反复返工
- 哪些 instruction 文件太胖
- 哪些 skills/subagents 装了但没带来收益

### Tests

- detector unit tests
- regression fixtures
- ranking stability tests

验收标准：

- 每条 finding 都必须带证据和建议
- 不允许只有“你可能有问题”这种空 finding

### Partial/Blocked Cases

- 跨 provider 的 config 检测只能 best-effort
- 对外部工具生态无法保证 100% 配置发现率

## Phase 5: Compare

### Purpose

把 token、效率、yield 变成可比较能力。

### Backend Work

新增：

- `packages/server/src/work-analysis/compare/compare-schema.ts`
- `packages/server/src/work-analysis/compare/compare-service.ts`
- `packages/server/src/work-analysis/compare/normalizers.ts`

支持 compare 维度：

- model vs model
- provider vs provider
- workspace vs workspace
- task vs task
- period vs period

### API Output

新增：

- `compare.baseline`
- `compare.candidate`
- `compare.deltas`
- `compare.percentiles`
- `compare.flags`

### Frontend Pages

#### Compare

展示：

- side-by-side cards
- delta arrows
- efficiency vs token matrices
- best/worst dimensions

### User-Visible Data

用户会看到：

- 哪个模型在 debugging 上更省 token
- 哪个 provider 在 testing 上 one-shot 更高
- 哪个 workspace 明显更低效
- 当前 7 天相比上一个 7 天是否改善

### Tests

- compare schema tests
- period-over-period fixtures
- missing-metric fallback tests

验收标准：

- compare 结果明确区分“完整口径”和“部分口径”

### Partial/Blocked Cases

- 若一侧 provider 缺 token 或 edit signal，对应 delta 只能显示 `partial`

## Phase 6: Yield

### Purpose

把 token 消耗和 git 结果连接起来。

### Backend Work

新增：

- `packages/server/src/work-analysis/yield/git-scanner.ts`
- `packages/server/src/work-analysis/yield/repo-discovery.ts`
- `packages/server/src/work-analysis/yield/session-correlator.ts`
- `packages/server/src/work-analysis/yield/status-classifier.ts`
- `packages/server/src/work-analysis/yield/file-overlap.ts`

建议 yield 状态：

- `productive`
- `reverted`
- `abandoned`
- `uncommitted`
- `unknown`

### API Output

新增：

- `yield.summary`
- `yield.byModel`
- `yield.byProvider`
- `yield.byTask`
- `yield.byWorkspace`
- `yield.flaggedSessions`

### Frontend Pages

#### Yield

展示：

- productive/reverted/abandoned token
- yield rate
- low-yield session list
- reverted-heavy workspaces

### User-Visible Data

用户会看到：

- 哪些 token 最终进入交付
- 哪些 token 花在被回滚的工作上
- 哪些任务看起来一直在忙但没沉淀到 git

### Tests

- git fixture repos
- revert detection tests
- delayed commit correlation tests

验收标准：

- git-backed workspace 至少能稳定输出 productive / reverted / abandoned / uncommitted

### Partial/Blocked Cases

- 非 git 目录只能输出 `unknown`
- squash merge 和跨机器提交只能启发式归因

## Phase 7: Token Budgets

### Purpose

把 token 消耗和“预算”联系起来，做长期控制。

### Backend Work

新增：

- `packages/server/src/work-analysis/budget/budget-store.ts`
- `packages/server/src/work-analysis/budget/overage.ts`
- `packages/server/src/work-analysis/budget/forecast.ts`
- `packages/server/src/work-analysis/budget/budget-schema.ts`

预算维度：

- by provider
- by model
- by workspace
- monthly global budget

### API Output

新增：

- `budget.currentPeriod`
- `budget.byProvider`
- `budget.byWorkspace`
- `budget.forecast`
- `budget.alerts`

### Frontend Pages

#### Budgets

展示：

- 当前 period token 使用量
- 剩余 token budget
- burn rate
- forecast overage
- top budget consumers

### User-Visible Data

用户会看到：

- 本月 token 已经用了多少
- 哪个 workspace 正在吃掉最多预算
- 按当前速度月底是否会超

### Tests

- budget rollover tests
- forecast tests
- alert threshold tests

验收标准：

- 所有预算逻辑都只基于 token，不出现货币字段

### Partial/Blocked Cases

- 预算是用户定义，不是 provider 官方真值

## Phase 8: Reports And Export

### Purpose

把分析结果变成稳定可流出的数据产品。

### Backend Work

新增：

- `packages/server/src/work-analysis/export/export-schema.ts`
- `packages/server/src/work-analysis/export/serializers/json.ts`
- `packages/server/src/work-analysis/export/serializers/csv.ts`
- `packages/server/src/work-analysis/export/serializers/markdown.ts`

导出对象：

- sessions
- tasks
- models
- providers
- workspaces
- optimize findings
- yield summaries
- budget summaries

### Frontend Pages

#### Exports

展示：

- export type 选择
- period/filter 选择
- file format 选择
- preview summary

### User-Visible Data

用户会看到：

- 可下载的 JSON / CSV / Markdown 报表
- 每份导出里包含哪些字段

### Tests

- schema snapshot tests
- CSV column tests
- markdown rendering tests

验收标准：

- schema 稳定
- 字段命名一致
- 大结果导出不会阻塞主线程

## Phase 9: Dedicated Analytics Surface

### Purpose

把能力从设置页迁出去，做成真正可用的分析产品。

### Frontend Work

新增或改造：

- `packages/web/src/features/work-analysis/pages/overview-page.tsx`
- `packages/web/src/features/work-analysis/pages/tasks-page.tsx`
- `packages/web/src/features/work-analysis/pages/models-page.tsx`
- `packages/web/src/features/work-analysis/pages/optimize-page.tsx`
- `packages/web/src/features/work-analysis/pages/yield-page.tsx`
- `packages/web/src/features/work-analysis/pages/compare-page.tsx`
- `packages/web/src/features/work-analysis/pages/budgets-page.tsx`
- `packages/web/src/features/work-analysis/pages/exports-page.tsx`

共享组件建议：

- `TokenKpiGrid`
- `TrendChart`
- `BreakdownTable`
- `SessionList`
- `FindingList`
- `CompareMatrix`
- `BudgetProgress`

### IA

建议入口：

- 左侧主导航新增 `分析`
- 设置页里的 `工作分析` 保留“入口 + 运行状态 + 最近摘要”

### User-Visible Data

最终用户能在一个地方看到：

- token 总览
- task 结构
- model 效率
- 浪费问题
- yield
- compare
- budget
- export

### Tests

- page rendering tests
- filter state tests
- routing tests
- large dataset rendering tests
- e2e acceptance with real logs

验收标准：

- 不再依赖设置页承载完整分析体验
- real-data 页面在 7d 范围内可稳定渲染

## Cross-Cutting Data Fields

下面这些字段建议成为跨页面通用字段：

- `providerId`
- `modelId`
- `workspacePath`
- `taskType`
- `sessionId`
- `startedAt`
- `lastActiveAt`
- `totalTokens`
- `inputTokens`
- `outputTokens`
- `cacheTokens`
- `reasoningTokens`
- `oneShotRate`
- `retryRate`
- `yieldStatus`
- `estimatedWastedTokens`
- `budgetUsedTokens`
- `budgetRemainingTokens`

## Delivery Order Inside The Repo

推荐代码实施顺序：

1. `packages/server/src/work-analysis/log-sources/*`
2. `packages/server/src/work-analysis/events*`
3. `packages/server/src/work-analysis/usage-economics/*`
4. `packages/server/src/work-analysis/classification/*`
5. `packages/server/src/work-analysis/metrics/*`
6. `packages/server/src/work-analysis/optimize/*`
7. `packages/server/src/work-analysis/compare/*`
8. `packages/server/src/work-analysis/yield/*`
9. `packages/server/src/work-analysis/budget/*`
10. `packages/server/src/work-analysis/export/*`
11. `packages/web/src/features/work-analysis/*`

## Success Criteria By Milestone

### Milestone A Success

- 能看到 token 趋势、task 分布、model 排行
- Claude/Codex 的 token 和 task 基本可信

### Milestone B Success

- 能指出浪费点，不只是展示排行
- 至少 5 类 optimize finding 有真实价值

### Milestone C Success

- 能直接比较模型和 workspace
- 能判断哪些 token 转成了交付

### Milestone D Success

- 有预算控制
- 有稳定导出
- 有独立 analytics surface

## Explicit Non-Guarantees

下面这些点仍然不是 100% 可保证真值：

- 全 provider 完整 token 字段
- 全 provider 精确 one-shot/edit metrics
- 非 git workspace 的 yield
- 外部工具配置生态的完整浪费发现

这些都应在 UI 中明确标 `partial`、`inferred` 或 `unavailable`，不能假装精确。
