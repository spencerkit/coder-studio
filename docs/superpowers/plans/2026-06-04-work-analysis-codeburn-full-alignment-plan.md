# Work Analysis Full CodeBurn Alignment Plan

Date: 2026-06-04
Status: Draft
Owner: spencer

## Goal

把 Coder Studio 的 `工作分析` 从“基础 usage 面板”升级为与 `CodeBurn` 同等级的本地 AI 编程 token 开销与效率分析产品。

目标不是只补几个统计卡片，而是完整对齐以下能力层：

- 本地日志发现与解析
- token 开销聚合
- 任务分类与效率分析
- waste / optimize 诊断
- model / provider / project / task 对比
- git yield 归因
- export / report / token budget tracking

## External Baseline

对齐基线以 `CodeBurn` 当前公开文档和 README 为准：

- README: https://github.com/getagentseal/codeburn
- Docs: https://codeburn.app/docs

截至 2026-06-04，可确认的核心能力包括：

- token / usage tracking
- 13 deterministic task categories
- daily breakdowns
- models report
- optimize waste scan
- compare
- yield
- plan tracking
- CSV / JSON export
- menu bar / GNOME extension

## Current State In Coder Studio

当前已经具备的基础：

- 多 provider 本地日志扫描
- 时间范围筛选
- 基于分析结果发现 workspace 路径
- usage totals / by provider / by workspace / by model / top sessions
- provider capability matrix
- provider source coverage

当前实现位置：

- [basic-analyzer.ts](/root/workspace/coder-studio/packages/server/src/work-analysis/basic-analyzer.ts)
- [types.ts](/root/workspace/coder-studio/packages/server/src/work-analysis/types.ts)
- [session-analysis-settings.tsx](/root/workspace/coder-studio/packages/web/src/features/settings/components/session-analysis-settings.tsx)

## Gap Map

### Already Aligned Or Partially Aligned

- 本地日志驱动分析
- 时间窗口筛选
- workspace 维度筛选
- provider / model / workspace usage breakdown
- top expensive sessions by tokens
- provider capability transparency

### Not Yet Aligned

- token economics engine
- task categorization
- per-day trend storage and trend charts
- one-shot / retry / self-correction / cache-hit efficiency metrics
- optimize detectors and ranked findings
- compare workflows
- yield analysis against git history
- token budget tracking and overage visualization
- export formats
- separate reports surface
- live refresh / pulse / forecast
- menu bar / desktop companion

## Alignment Architecture

### 1. Canonical Session Event Model

现有 `WorkLogSession` 聚合粒度过粗，只够做 session summary，不够支撑 `CodeBurn` 级分析。

必须新增统一事件层：

- `WorkAnalysisTurn`
- `WorkAnalysisToolEvent`
- `WorkAnalysisEditSignal`
- `WorkAnalysisCommandSignal`
- `WorkAnalysisGitSignal`
- `WorkAnalysisUsageEvent`

每个 session 内至少保留：

- message / tool / command / edit / plan / agent spawn 的顺序
- per-turn usage
- model identity
- explicit vs inferred timestamps
- workspace path

没有这层，就无法稳定做：

- task 分类
- one-shot / retry
- wasted bash output
- read:edit ratio
- yield 归因

### 2. Derived Analytics Layers

在 canonical event model 上分 6 层派生：

1. `Usage Economics Layer`
2. `Task Classification Layer`
3. `Efficiency Metrics Layer`
4. `Optimize Findings Layer`
5. `Compare Layer`
6. `Yield Layer`

### 3. Product Surfaces

建议拆成 4 个前台入口，而不是把所有能力都堆在设置页：

- `Overview`
- `Models`
- `Optimize`
- `Yield`

`Compare` 可以作为独立页，也可以作为 `Models` 的 drill-down 模式。

## Full Alignment Plan

### Phase 0: Rebase The Data Model

#### Deliverables

- 新增细粒度 session event schema
- provider adapter 改为输出 session + ordered events
- repository 层支持 raw events、materialized summaries、analysis snapshots

#### Required Changes

- 扩展 `packages/server/src/work-analysis/log-sources/types.ts`
- 为 Codex / Claude / Gemini / Cursor / OpenCode 增加 event extraction
- 新增 turn-level fixtures 与 parser tests

#### Why This Is Mandatory

当前的 [basic-analyzer.ts](/root/workspace/coder-studio/packages/server/src/work-analysis/basic-analyzer.ts) 只拿到 session summary，无法可靠判断：

- 某次 edit 是否 one-shot 成功
- 某类任务是否在重复 retry
- 某次 bash 输出是否纯浪费
- 某个 agent spawn 是否最终带来交付

### Phase 1: Token Economics Engine

#### Target

对齐 CodeBurn 的 usage pipeline，但不做货币定价：

- input tokens
- output tokens
- cache read tokens
- cache write tokens
- reasoning tokens
- web search tokens if available
- model alias mapping

#### Deliverables

- `usage-economics/model-aliases.ts`
- `usage-economics/token-normalizer.ts`
- `usage-economics/fallbacks.ts`
- `usage-economics/catalog.ts`

#### UI

- KPI: total tokens
- by provider tokens
- by model tokens
- by workspace tokens
- tokens per session
- tokens per task

#### Feasibility

- `Claude` / `Codex`: feasible now, but Codex token extraction still needs real-log validation expansion
- `Gemini` / `Cursor` / `OpenCode`: partially feasible; depends on whether local logs expose usage fields

#### Cannot Fully Guarantee

- 对于日志里根本没有 token 字段的 provider，无法“准确统计 token 开销”
- 只能显示 `unsupported` 或 `usage unavailable`

原因：

- token 开销统计的前提是 token 粒度 usage 存在
- 当前 research 已确认多个 provider 在现有本地日志中没有稳定 token usage 字段

参考：

- [2026-06-04-work-analysis-provider-usage-capability-matrix.md](/root/workspace/coder-studio/docs/superpowers/research/2026-06-04-work-analysis-provider-usage-capability-matrix.md)

### Phase 2: Deterministic Task Classification

#### Target

对齐 CodeBurn 的 deterministic 分类思路，但分类规则应适配 Coder Studio 自己的工具生态。

建议 v1 分类：

- coding
- debugging
- feature_dev
- refactoring
- testing
- exploration
- planning
- delegation
- git_ops
- build_deploy
- brainstorming
- conversation
- general

#### Detection Inputs

- tool names
- command names
- user prompt keywords
- edit presence
- plan mode events
- subagent spawn events
- git command events

#### Deliverables

- `classification/task-rules.ts`
- `classification/task-classifier.ts`
- explainable classification evidence

#### UI

- by task tokens
- by task tokens
- by task session count
- by task one-shot rate
- task vs model matrix

#### Feasibility

- feasible

#### Risk

- provider event fidelity不一致，导致分类质量不对称
- 需要把“无证据时降级到 general”作为硬规则

### Phase 3: Efficiency Metrics

#### Target

补齐 `CodeBurn` 的性能/效率核心：

- one-shot rate
- retry rate
- self-correction rate
- average tokens per session
- average tokens per edit
- cache-hit rate
- read:edit ratio
- tool-heavy vs output-light sessions

#### Deliverables

- `metrics/one-shot.ts`
- `metrics/retry.ts`
- `metrics/cache.ts`
- `metrics/read-edit.ts`
- `metrics/session-efficiency.ts`

#### Feasibility

- partially feasible now
- fully feasible after Phase 0 event model

#### Cannot Fully Guarantee

- `one-shot rate` 在没有稳定 edit signal 的 provider 上只能做近似估计

原因：

- 若 provider transcript 不显式记录 edit/write/file-change 事件，只能从工具名或文本推断
- 推断结果无法达到 “完全准确”

### Phase 4: Optimize

#### Target

完整对齐 `CodeBurn optimize` 的价值方向：

- repeated file rereads
- low read:edit ratio
- wasted bash output
- unused MCP servers
- ghost agents / unused skills / dead slash commands
- bloated instruction files
- cache creation overhead
- junk directory reads
- token-heavy but low-yield sessions

#### Deliverables

- `optimize/detectors/*`
- `optimize/ranker.ts`
- `optimize/finding-history.ts`
- `optimize/fix-renderers.ts`

每条 finding 需要：

- title
- severity
- impacted sessions
- estimated token waste
- estimated token waste severity
- fix suggestion
- confidence
- new / improving / resolved state

#### Extra Coder Studio Opportunity

除了对齐 CodeBurn，还可以多做：

- 针对 workspace 配置的 `.codex` / `CLAUDE.md` / `AGENTS.md` 冗余扫描
- subagent delegation 使用质量分析
- skill 安装但不使用的冗余检测

#### Feasibility

- mostly feasible

#### Cannot Fully Guarantee

- `unused MCP servers`、`ghost agents`、`dead slash commands` 这类检测依赖各 provider 的本地配置文件格式

原因：

- Coder Studio 不是所有 provider 的配置主控面
- 某些外部工具的配置路径、schema、启用语义并不统一

策略：

- 对本工具自身生态做 `full`
- 对外部 provider config 做 `best-effort`

### Phase 5: Compare

#### Target

支持 side-by-side compare：

- model vs model
- provider vs provider
- task vs task
- workspace vs workspace

比较指标：

- total tokens
- tokens per session
- tokens per edit
- one-shot rate
- retry rate
- cache-hit rate
- yield rate

#### Deliverables

- `compare/compare-service.ts`
- compare query schema
- compare dashboard with normalized rankings and percentile hints

#### Feasibility

- feasible after Phases 1 to 3

### Phase 6: Yield

#### Target

对齐 `CodeBurn yield`：

- productive
- reverted
- abandoned

#### Required Inputs

- git repo discovery
- commit timestamps
- branch / merge status
- revert detection
- session-to-commit time correlation

#### Deliverables

- `yield/git-scanner.ts`
- `yield/session-correlator.ts`
- `yield/status-classifier.ts`

#### UI

- productive tokens
- reverted tokens
- abandoned tokens
- yield by model/provider/task

#### Feasibility

- feasible for git-backed workspaces

#### Cannot Fully Guarantee

- 对非 git workspace 无法做完整 yield
- 对 squash merge、跨机器提交、延迟提交的会话，归因精度有限

原因：

- 本地只有 session 时间和 git 历史，无法知道“真实作者意图”
- 某些交付发生在别的机器或别的 repo

### Phase 7: Token Budgets And Overage

#### Target

对齐 CodeBurn 的 tracking 目标，但统一用 token budget，不做币种和真实结算：

- provider-specific token budgets
- custom token budgets
- monthly token usage vs budget
- overage visualization

#### Deliverables

- `budget/budget-store.ts`
- `budget/overage.ts`
- `budget/forecast.ts`

#### Feasibility

- mostly feasible

#### Cannot Fully Guarantee

- 无法精确模拟 Claude Pro / Max 这类未公开 token allowance 的真实边界

原因：

- 厂商没有公开精确 token 配额或 throttle 规则

策略：

- 按“用户定义 token budget / observed token usage”建模
- 明确标注为 token budget tracking，不宣称真实供应商结算结果

### Phase 8: Reports And Export

#### Target

对齐 CodeBurn 的 export/report 能力：

- sessions export
- models export
- tools export
- projects export
- daily summaries export
- optimize findings export
- yield export
- JSON / CSV / Markdown

#### Deliverables

- `export/serializers/*`
- downloadable reports in web
- stable schemas for automation

#### Feasibility

- feasible

### Phase 9: Live Surfaces

#### Target

补齐更产品化的展示层：

- dedicated analytics page
- daily trend
- forecast
- pulse view
- auto refresh

#### Feasibility

- web dashboard: feasible
- native menu bar / GNOME extension: feasible but not aligned with current product shape

#### Cannot Fully Justify Right Now

- `macOS menu bar`
- `GNOME extension`
- `TUI dashboard`

原因：

- Coder Studio 当前主产品是桌面工作台 + web shell，不是 CLI first 产品
- 做这些 surface 成本高，但不会显著提升分析内核本身

结论：

- 如果目标是“能力完全对齐”，应优先对齐分析内核和数据产出
- 如果目标是“形态也完全照搬”，则需要单独立项，不建议混入当前工作分析主线

## What Cannot Be Fully Matched

下面这些项，即使投入开发，也无法承诺“100% 等同 CodeBurn”：

### 1. All Providers Have Full Accurate Token Accounting

无法完全实现。

原因：

- 某些 provider 的本地日志就是没有 token / cache 粒度
- 没有 usage 就没有准确 token 开销统计

### 2. Exact Consumer Subscription Overage Truth

无法完全实现。

原因：

- 厂商没有公开真实 allowance 与 throttle 规则
- 只能做 token budget approximation

### 3. Perfect Yield Attribution

无法完全实现。

原因：

- git correlation 本质上是启发式，不是 ground truth
- squash merge、跨仓库、跨机器、延迟提交都会干扰

### 4. Perfect One-Shot / Retry Metrics Across Every Provider

无法完全实现。

原因：

- 不是所有 provider transcript 都有稳定 edit / patch / apply signal
- 部分只能依据工具名或文本语义推断

### 5. Full External Config Waste Detection For Every Tool

无法完全实现。

原因：

- 不同 provider 的配置格式、目录、启用方式不统一
- 某些配置甚至不保存在本机标准路径

## Recommended Scope Decision

如果要求“完全对齐 CodeBurn 的核心产品价值”，建议定义为：

- 必做：tokens, tasks, efficiency, optimize, compare, yield, budgets, export
- 选做：forecast, pulse, daily trend persistence
- 不纳入主线：menu bar, GNOME extension, TUI

这样可以做到：

- 核心分析能力基本对齐
- 结果形式更适合 Coder Studio
- 避免为了对齐表面形态而偏离主产品

## Execution Order

推荐分 4 个大里程碑：

### Milestone A

- Phase 0
- Phase 1
- Phase 2

结果：

- 有 tokens
- 有 task
- 有 daily/model/provider/workspace breakdown

### Milestone B

- Phase 3
- Phase 4

结果：

- 有 efficiency
- 有 optimize

### Milestone C

- Phase 5
- Phase 6

结果：

- 有 compare
- 有 yield

### Milestone D

- Phase 7
- Phase 8
- Phase 9 partial

结果：

- 有 plans
- 有 export
- 有 dedicated analytics surface

## Success Bar

当下面这组问题都能在产品里直接回答时，才算真正对齐到位：

- 这个月哪个 provider token 消耗最高？
- 哪个 model token 消耗最高但 one-shot rate 最低？
- 哪类任务最容易 retry？
- 哪些 session token 消耗很高但没有形成交付？
- 哪些配置和习惯在系统性浪费 tokens？
- 某个 workspace 的 token 消耗是否健康？
- 当前 token 消耗是否逼近预算？
- 哪些 sessions / models / tasks 值得替换或收敛？
