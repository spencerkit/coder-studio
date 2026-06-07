# Work Analysis CodeBurn Alignment Design

Date: 2026-06-04
Status: Draft
Owner: spencer

## Problem

当前 `工作分析` 的实现更像“设置页里的基础摘要”：

- 统计项偏少，缺少 `token`、`cost`、模型维度、目录排行、会话排行等核心观测数据。
- 页面结构偏表单和文本输出，不像一个真正的统计分析面板。
- 基础分析与深入分析的边界不清晰，导致基础分析缺乏独立价值。
- provider 日志里已经存在部分高价值 usage 字段，但当前完全没有提取和归一化。

对照 `CodeBurn`，当前能力差距主要体现在：

- `token / cost` 观测缺失
- 多维拆解能力缺失
- dashboard 产品形态缺失
- 数据完整性与 provider 能力边界缺少显式表达

因此，本轮应把 `工作分析` 重新定义为一个面向本地 agent/provider 日志的 `usage analytics` 产品，而不是继续把它当作一个附着在设置页里的辅助功能。

## Goals

- 在能力上先对齐 `CodeBurn` 的第一层价值：`token / usage / cost / breakdown / coverage`
- 把 `基础分析` 升级为结构化、可观测、可筛选、可比较的 dashboard
- 显式展示 provider 能力差异，而不是假装所有 provider 数据对称
- 保留 Coder Studio 自己的差异化能力：目录维度筛选与本地日志驱动分析
- 把基础分析单独做扎实、做好用，不依赖深入分析补价值

## Non-Goals

- 不复制 `CodeBurn` 的 CLI/TUI 交互形态
- 不在本轮实现长期后台索引服务
- 不保证 5 个 provider 在 v1 中都提供完整 token/cost 能力
- 不在本轮实现全量“任务类型分类”自动标注
- 不在本轮实现跨时间窗口的长期趋势存储
- 不在本轮考虑 `深入分析` 的产品定义、输入重构或界面改造

## External Reference

参考项目：`CodeBurn`

- Repo: https://github.com/getagentseal/codeburn

本设计对齐的是其核心能力方向，而不是 UI 形态照搬：

- 读取本地 agent/provider 日志
- 聚合 token 和 usage
- 做多维拆解
- 输出 cost / efficiency / optimization 视角

## Current State

### What We Already Have

当前 `工作分析` 已经具备：

- provider 本地日志扫描
- 时间范围筛选
- 分析结果驱动的 `workspacePath` 筛选
- 基础会话聚合：
  - session count
  - duration
  - hour buckets
  - provider mix
  - user/assistant/tool count
  - provider source status

### What We Do Not Have

当前完全缺失：

- token usage 聚合
- cache / reasoning token 维度
- cost 估算
- 按 workspace 的 usage 排行
- 按 session 的 usage 排行
- 按 model 的 usage 拆解
- provider capability matrix
- 数据覆盖率与缺失原因说明
- dashboard 级 UI 结构

### Real Provider Findings

基于当前机器上的真实日志样本和现有 adapter 代码，现阶段可以确认：

#### Codex

- 已确认真实日志存在 `token_count` 事件
- 可提取字段：
  - `input_tokens`
  - `cached_input_tokens`
  - `output_tokens`
  - `reasoning_output_tokens`
  - `total_tokens`
- 现有 adapter 尚未提取这些字段

#### Claude

- 已确认真实日志存在 `message.usage`
- 可提取字段：
  - `input_tokens`
  - `output_tokens`
  - `cache_creation_input_tokens`
  - `cache_read_input_tokens`
- 部分记录还包含 server tool usage 元信息
- 现有 adapter 尚未提取这些字段

#### Gemini

- 当前 adapter 仅提取 session/message 粗粒度信息
- 尚未确认稳定 token usage 字段

#### Cursor

- 当前 v1 只依赖 transcript JSONL 和 file mtime
- 尚未确认稳定 token usage 字段

#### OpenCode

- 当前 adapter 只查 session/message/part 计数
- 尚未确认 sqlite schema 中是否存在稳定 usage/cost 字段

## Product Reframe

### Core Positioning

`工作分析` 应重新定义为：

> 一个基于本地 agent/provider 历史日志的工作使用分析面板，用于回答“我在哪些目录上做了多少工作、消耗了多少 token、主要由哪些 provider/model/tool 构成、哪些地方最值得优化”。

### Basic Analysis First

当前迭代只定义并实现 `基础分析`。

基础分析只做结构化统计，不调用 LLM。

特点：

- 快
- 稳
- 可重复
- 可筛选
- 可比较

它应该解决：

- 我最近在哪些目录上工作最多？
- 哪些 provider / model 消耗最多？
- token 消耗是多少？
- 哪些目录最重、哪些 session 最贵？
- 数据是否完整？

本轮要求是：

- 基础分析本身就能回答最关键的使用和消耗问题
- 不能再把核心价值推迟给“以后做的深入分析”

## Alignment Strategy

### What To Align With CodeBurn

本轮优先对齐 `CodeBurn` 的这些能力：

1. usage 聚合
2. token 聚合
3. cost 估算
4. provider/model/project breakdown
5. expensive sessions / hot paths
6. data coverage and provider capability reporting

### What Remains Coder Studio Specific

保留并强化这些差异化能力：

1. 基于真实发现目录的 `workspacePath` 多选筛选
2. 与 skill inventory 结合的工作分析
3. 后续可以做“目录 x token x workflow”混合洞察

## Proposed Data Model

### Provider Capability Matrix

新增 provider 能力矩阵概念：

```ts
type WorkAnalysisCapabilityLevel = "full" | "partial" | "none";

interface WorkAnalysisProviderCapability {
  providerId: string;
  workspacePath: WorkAnalysisCapabilityLevel;
  timestamps: WorkAnalysisCapabilityLevel;
  sessionCounts: WorkAnalysisCapabilityLevel;
  toolCounts: WorkAnalysisCapabilityLevel;
  modelIdentity: WorkAnalysisCapabilityLevel;
  tokenUsage: WorkAnalysisCapabilityLevel;
  cacheUsage: WorkAnalysisCapabilityLevel;
  reasoningUsage: WorkAnalysisCapabilityLevel;
  costEstimation: WorkAnalysisCapabilityLevel;
}
```

这个矩阵既用于后端聚合，也用于前端说明“为什么某些数字缺失”。

### Normalized Usage

在 `WorkLogSession` 层引入统一 usage 结构：

```ts
interface WorkLogUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
}
```

说明：

- 所有字段均可选
- provider 只填自己能稳定提供的字段
- `estimatedCostUsd` 来自本地价格表，不写回原始 provider 日志

### Basic Result V2

基础分析结果扩展为：

```ts
interface WorkBasicAnalysisResultV2 {
  availableWorkspacePaths: string[];
  capabilityMatrix: {
    providers: WorkAnalysisProviderCapability[];
  };
  coverage: { ... };
  activity: { ... };
  usage: {
    totalSessions: number;
    sessionsByProvider: Record<string, number>;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCachedInputTokens: number;
    totalReasoningTokens: number;
    totalTokens: number;
    estimatedCostUsd?: number;
  };
  breakdowns: {
    providers: Array<{
      providerId: string;
      sessionCount: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostUsd?: number;
    }>;
    workspaces: Array<{
      workspacePath: string;
      sessionCount: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostUsd?: number;
    }>;
    models: Array<{
      modelId: string;
      providerId: string;
      sessionCount: number;
      totalTokens: number;
      estimatedCostUsd?: number;
    }>;
  };
  rankings: {
    topSessionsByTokens: Array<{
      sessionId: string;
      providerId: string;
      workspacePath: string;
      totalTokens: number;
      estimatedCostUsd?: number;
      startedAt: number;
      lastActiveAt: number;
    }>;
  };
  workSurface: { workspacePaths: string[] };
  dataSources: { ... };
  dataQuality: { ... };
}
```

### Cost Estimation

cost 采用显式估算模型：

- 每个 provider/model 对应一张本地 price table
- 仅对已知价格的 usage 做估算
- 价格不可用时，不生成 cost，总是标注为 unavailable

这意味着：

- token 统计和 cost 统计分离
- token 可以先上线，cost 可以部分 provider 后补

## UI Direction

### Product Shape

当前设置页内联文本输出不再成立。

基础分析应重构成 dashboard 结构：

1. 顶部 KPI 区
2. breakdown 区
3. trend / distribution 区
4. provider coverage / quality 区
5. 排行和明细区

### Recommended Sections

#### 1. KPI Summary

- 工作目录数
- 会话数
- 总 token
- 输入 token
- 输出 token
- 工具调用数
- 估算 cost

#### 2. Workspace Breakdown

- 按目录列出 session / token / cost
- 支持从排行点击回筛选

#### 3. Provider / Model Breakdown

- 按 provider 的 token/cost 占比
- 按 model 的 token/cost 占比

#### 4. Activity Distribution

- 按小时分布
- 按天趋势

#### 5. Top Sessions

- 最重 session
- 最长 session
- 高 token 低交互 session

#### 6. Coverage & Quality

- 哪些 provider 有 token
- 哪些 provider 只有 session 统计
- 哪些数据依赖 mtime fallback

### UX Principle

界面应是“分析 dashboard”，不是“设置表单 + 输出块”：

- 筛选器放顶部，但不占据主体叙事
- 结果区应以 KPI 和 breakdown 为主
- 说明性文字压缩到次要位置
- provider 状态和质量信息用 badge/table 表达，而不是长句堆叠

## Rollout Strategy

### Phase 1: Capability Survey

先做 provider usage 能力普查，不直接承诺 5 provider 完整对齐。

交付物：

- 每个 provider 的 usage/token/cost 能力表
- 对应测试夹具
- 真实日志抽样验证

### Phase 2: Codex + Claude Usage

先把已确认可做的两类 provider 做完整：

- token 提取
- cache/reasoning usage
- model 维度
- workspace/provider/session breakdown

这是第一批真正能让产品“像分析功能”的数据。

### Phase 3: Dashboard V2

把基础分析 UI 从设置风格改成 dashboard。

### Phase 4: Remaining Providers

补齐 Gemini / Cursor / OpenCode 的 usage 能力，能做多少做多少，并用 capability matrix 真实表达边界。

## Risks

### Risk 1: Provider Usage Asymmetry

不同 provider 的 usage 字段并不对称。

Mitigation:

- 不做伪统一
- 用 capability matrix 显式标注

### Risk 2: Cost Table Drift

价格表会变化。

Mitigation:

- 先把 price table 视为可更新配置
- 前端始终标明为 estimated

### Risk 3: UI Complexity Explosion

如果直接把所有 breakdown 一次塞进页面，复杂度会失控。

Mitigation:

- 先做 KPI + workspace/provider/model 三个核心区
- 其他区按 phase 逐步加

## Success Criteria

- 基础分析页面能展示真实 token 统计，而不是只有 session/duration 摘要
- 用户能直接看出“哪些目录/哪些 provider 消耗最大”
- provider 数据缺口被显式表达，不再隐含失败
- 页面整体像 dashboard，而不是设置项详情页
- 基础分析不再依赖深入分析承担本应由自己提供的硬统计职责
