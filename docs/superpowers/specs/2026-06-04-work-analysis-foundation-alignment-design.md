# Work Analysis Foundation Alignment Design

Date: 2026-06-04
Status: Draft
Owner: Codex

## Goal

把 Coder Studio 的工作分析能力升级到接近 CodeBurn 核心层的产品形态，但本轮只聚焦基础分析能力，不追求一次性覆盖所有高级配套能力。

本轮目标是：

- 用真实 provider 日志构建统一、可解释的 token-first 分析模型
- 让 workspace 成为分析结果筛选项，而不是前置约束
- 把基础分析页面升级成可读、可钻取的 analytics surface
- 为后续更深的优化诊断、历史趋势、实时刷新和桌面伴随能力打下稳定 contract

本轮不做：

- 货币金额换算
- menu bar / desktop companion
- team aggregation
- live pulse / realtime refresh
- 保证所有 provider 都有完整 token 口径

## Product Outcome

用户打开 `/analytics` 后，应能完成以下工作：

- 看最近 7 / 30 / 90 天 token 消耗趋势
- 看真实日志里发现的 workspace 列表并按其筛选
- 看 provider / model / workspace / task 四个维度的消耗分布与排行
- 看效率信号和高浪费会话
- 看基础 yield 信号和低产出高消耗样本
- 看 token 预算状态、投射值和导出结果

这意味着页面不再只是若干 summary 卡片，而要具备：

- chart
- ranking table
- drill-down oriented sections
- capability transparency

## Design Principles

### Token-first

token 是唯一成本单位。所有“成本”表达都只围绕 token 展开，不映射货币价值。

### Event-driven

分析不再建立在粗粒度 session summary 上，而要建立在有顺序、可派生、可归因的事件流上。

### Capability-transparent

如果某个 provider 的日志缺 token 或缺 turn-level 结构，前端必须明确展示 `supported`、`partial` 或 `unsupported`，不能伪装成完整统计。

### Result-filtered workspace selection

workspace 列表来自 provider log 中真实发现的路径。用户可以在这些路径里筛选关注对象，但系统不能拿“当前已打开 workspace”去屏蔽其它路径。

### Shared contract

所有图表和表格都只能消费统一的分析 contract，不允许页面直接拼 raw session summary。

## Architecture

### 1. Canonical Event Layer

每个 provider 的本地日志在解析后都要输出统一事件流。建议事件类型：

- `session_boundary`
- `message_turn`
- `tool_call`
- `tool_result`
- `command`
- `edit`
- `plan`
- `agent_spawn`
- `git_signal`
- `usage`

每个事件最少包含：

- `sessionId`
- `providerId`
- `modelId`
- `workspacePath`
- `timestamp`
- `timestampSource`
- `usage`
- `capabilities`
- `rawRefs`

其中：

- `timestampSource` 用于区分显式时间与推断时间
- `usage` 允许为空，但必须能表达 unavailable
- `capabilities` 标明该 provider 在 token、model、timestamps、turn-order 上的支持度
- `rawRefs` 允许后续排查错误归因

这层的目的不是直接给 UI 用，而是让后续派生指标有可靠输入。

### 2. Derived Metrics Layer

在事件层之上派生六大指标域：

#### Usage

- total tokens
- by day
- by provider
- by model
- by workspace
- by task
- per-session distribution

#### Efficiency

- one-shot rate
- retry rate
- self-correction rate
- read:edit ratio
- command-to-edit ratio
- cache-hit share
- git-aware session rate

#### Optimize

- high-cost no-edit sessions
- high-cost no-command sessions
- retry-heavy sessions
- context thrashing patterns
- over-delegation patterns
- large-output low-yield sessions

#### Compare

- workspace ranking
- provider ranking
- model ranking
- task ranking
- share percentages

#### Yield

- git-aware session share
- edit-heavy session share
- shipped-session proxy
- token per shipped-session proxy
- token per edit-heavy session

#### Budgets

- rolling 7d
- rolling 30d
- active-day average
- 30-day forecast
- threshold status for focus / current / stretch

### 3. Materialized Snapshot Layer

分析结果按 query 落成 snapshot，避免每次切 tab 重扫原始日志。

建议保留：

- `basic snapshot`
- `deep snapshot`
- `export snapshot`

每个 snapshot 都带：

- query
- generatedAt
- provider capability summary
- workspace discovery summary
- metrics payload

这层同时服务：

- 页面切 tab
- drill-down 表格
- export
- 后续趋势历史或报告中心

## Data Contract

基础 contract 必须覆盖：

- `coverage`
- `activity`
- `usage`
- `tasks`
- `efficiency`
- `optimize`
- `compare`
- `yield`
- `budgets`
- `exports`
- `capabilityMatrix`
- `dataSources`

约束如下：

- 每个域都要支持 `supported / partial / unsupported`
- 每个需要排序的域都同时提供 chart-friendly 和 table-friendly 数据
- workspace / provider / model / task 的维度命名在整个 contract 中保持一致
- 所有百分比都提供原始数值，由前端格式化

## Product Surface

基础分析页面保留统一入口，但升级为五个功能区：

### Overview

回答“总量、趋势、占比、覆盖范围是什么”。

包含：

- KPI cards
- daily tokens / sessions trend
- workspace share
- provider share
- model share
- coverage summary

### Usage / Compare

回答“谁最贵、谁占比最高、不同维度怎么比”。

包含：

- workspace ranking
- provider ranking
- model ranking
- task ranking
- compare drill-down view

### Efficiency / Optimize

回答“token 花得值不值、浪费在哪里”。

包含：

- one-shot / retry / self-correction scorecards
- read:edit / command-to-edit / cache-hit metrics
- optimize findings board
- expensive low-yield session table

### Yield / Delivery

回答“这些 token 有没有转成产出”。

包含：

- git-aware share
- edit-heavy share
- shipped-session proxy
- workspace delivery table
- high-yield / low-yield session samples

### Budgets / Exports

回答“后续怎么控量、怎么导出”。

包含：

- rolling budgets
- forecast
- threshold state
- export actions

## UX Rules

- 顶部只保留全局 query：时间范围、workspace、provider
- workspace 列表只来自真实日志发现
- 所有 tab 共享同一 query state
- 每个图表都必须能落到对应表格或列表
- 不展示没有口径定义的数据
- mobile 保留核心卡片、趋势和 top lists，不追求和 desktop 完全等价

## Implementation Scope

### Phase A: Analytics Foundation

本阶段只解决“算得准”和“contract 稳定”。

交付：

- canonical event schema
- provider event extraction
- derived metrics contracts
- snapshot persistence contract
- capability signaling cleanup

### Phase B: Foundation Product Alignment

本阶段是本轮主交付。

交付：

- overview trend + share charts
- compare charts + ranking tables
- efficiency scorecards
- optimize findings board
- yield summary + sample tables
- budgets gauges + forecast
- export polish
- real-log acceptance coverage

完成后，这一轮可视为“基础分析能力全面对齐到 CodeBurn 核心层”。

### Phase C: Later Enhancements

不纳入本轮承诺，但设计上要预留接口：

- snapshot history
- live refresh / pulse
- scheduled reports
- richer optimize detectors
- desktop companion
- cross-run history compare

## Risks And Explicit Non-Goals

### Provider completeness is bounded by local logs

如果 provider 日志没有稳定 token usage 字段，就无法做准确 token 统计。此时系统只能展示 partial 或 unsupported。

### Yield is proxy-based

yield 只能做到 signal / proxy，不应表述为绝对真实交付价值。

### Efficiency depends on event quality

如果 turn order、tool result、edit signal 缺失，one-shot、retry、self-correction 只能做 observed + inferred 混合结果。

### Mobile is intentionally reduced

移动端不做 desktop 级密度的完整分析台，只保留核心摘要和重点列表。

## Success Criteria

本轮完成后，应满足：

- 所有核心分析页面都能用真实日志跑出非 mock 数据
- workspace 不再由当前打开状态做前置筛选
- 页面包含趋势图、占比图、排行表和样本表，而不是只剩卡片和文字
- token budget、efficiency、yield、optimize 都进入基础分析主界面
- provider capability 差异在 UI 上清晰可见
- 新图表和后续 detector 可以继续在同一 contract 上扩展，而不需要推倒重做

## Verification Strategy

- parser tests for provider event extraction
- derived metric unit tests
- snapshot contract tests
- page rendering tests for chart and table states
- Playwright acceptance on seeded data
- real-log manual verification on local machine

## Recommendation

采用“共享 contract 的双线并进”推进方式：

- 先定统一 analytics schema
- 服务端并行补 event-driven metrics
- 前端并行升级 analytics surface

这样可以同时推进可视化和分析能力，但避免前端先发明一套不稳定的数据结构。
