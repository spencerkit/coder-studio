# Supervisor 系统 · 设计文档

> **版本：** 1.0
> **日期：** 2026-04-20
> **状态：** Draft（待评审）
> **关联 PRD：** `docs/PRD.zh-CN.md` §16
> **前置依赖：** `docs/superpowers/specs/2026-04-20-codex-notify-hook-integration-design.md`
> **关联总设：** `docs/superpowers/specs/2026-04-13-coder-studio-design.md` §8
> **作者：** 技术共同设计 — Spencer + Codex

---

## 0. 文档说明

### 0.1 目的

本文档定义 **Supervisor 系统** 的最终实现形态：

- 为单个 Agent session 配置一个可持续运行的目标追踪器
- 在 `turn_completed` 后基于 transcript / terminal / git 上下文评估进展
- 在必要时向运行中的 Agent 注入指导
- 在前端展示 Supervisor 状态、历史周期和操作入口

本文档用于约束后续实现和测试，不等同于当前仓库中已经存在的 MVP 代码。

### 0.2 背景

当前仓库里已经存在一版可运行的 Supervisor MVP：

- `packages/core/src/domain/supervisor.ts` 已定义基础领域模型
- `packages/server/src/supervisor/manager.ts` 已具备 create / pause / resume / trigger / evaluate / inject 主流程
- `packages/web/src/features/supervisor/` 已具备卡片、目标对话框和 atoms

但这版实现仍与 PRD 和依赖 spec 存在明显差距：

- Supervisor 只存在于内存，server 重启后丢失
- Evaluator 当前直接读取 terminal output 并硬编码 Anthropic SDK，不符合后续 transcript 驱动的设计方向
- Injector 当前直接往 terminal 写文本，而不是等价于用户真实输入
- 前端 Supervisor UI 尚未真正挂接进 Agent Pane 完整流程
- “仅 Full capability Provider 可启用 Supervisor” 的约束还未形成强校验

本文档给出的是 **Phase 3 最终收敛方案**。

### 0.3 非目标

本 spec 不覆盖以下内容：

- 不重新设计 session / terminal / workspace 三大主领域模型
- 不改动 Codex / Claude 的交互式启动方式；继续保持 PTY + TUI 主路径
- 不引入多 Agent 协同式 Supervisor；每个 session 最多只有 1 个 Supervisor
- 不做复杂的跨 session 目标编排，不做 workspace 级全局 Supervisor
- 不实现云端托管或远程控制；所有评估与注入都在本地 server 进程内完成
- Phase 3 不实现“无 turn 场景下的周期兜底检测”；该能力延期到下一阶段优化

---

## 1. 范围与交付

### 1.1 交付清单

本 spec 的交付范围包括：

- [ ] 一个持久化的 Supervisor 实体，和一个持久化的 SupervisorCycle 历史表
- [ ] `supervisor.create/get/update/delete/pause/resume/trigger` 命令链路
- [ ] Scheduler、Evaluator、Injector 三个 server 子系统
- [ ] transcript 优先、terminal fallback 的评估上下文构建器
- [ ] 基于 Provider 无头命令的评估执行器
- [ ] Agent Pane 中的 Supervisor 分区、目标/评估器对话框、最近历史展示
- [ ] 通过 WebSocket 推送 Supervisor 状态和周期更新
- [ ] 单测、集成测试、E2E 验收覆盖

### 1.2 成功标准

达到以下条件，视为本 spec 实现完成：

1. 新建一个 Full capability session 后，可以启用 Supervisor，并成功保存目标和 evaluator provider。
2. Supervisor 配置在 server 重启后仍可恢复，且 UI 可重新显示其状态和历史。
3. session 发生新一轮 turn 完成时，Supervisor 能生成一条新的 cycle 记录。
4. Evaluator 能基于 transcript_path 构建评估输入；当 transcript 不可用时，能回退到 terminal tail。
5. Evaluator 判断需要指导时，Injector 能通过等价于用户输入的路径，把指导发给 Agent。
6. 前端 Agent Pane 中可进行启用、编辑、暂停、恢复、重试、触发、禁用，并能在编辑时为每个 Supervisor 单独切换 `claude` / `codex` evaluator provider。
7. Phase 3 相关自动测试全绿，且不破坏既有 session / hooks / terminal 流程。

---

## 2. 关键设计决策

### 2.1 持久化采用独立实体表，而不是塞回 session 元数据

候选方案有两类：

1. 把 objective / state 全部塞进 `sessions` 表或 session 元数据 JSON
2. 增加独立 `supervisors` / `supervisor_cycles` 表

本 spec 选择 **方案 2**。

原因：

- PRD §16 有明确的“周期历史”需求，天然需要独立的 history 结构
- Supervisor 生命周期与 Session 相关，但不是 Session 本体字段的一部分
- 独立表更容易做恢复、清理、索引和测试
- 当前 core 已经有 `Supervisor` / `SupervisorCycle` 独立领域类型，和此方案天然一致

### 2.2 Evaluator 采用“transcript 优先 + Provider 无头命令”路径

存在三种实现方向：

1. 直接把 terminal output 发给 LLM SDK
2. 直接读 transcript，然后用 Anthropic / OpenAI SDK 评估
3. 直接读 transcript，然后通过 Provider 的无头命令执行评估

本 spec 选择 **方案 3**，并保留 terminal fallback。

原因：

- 它与 `2026-04-20-codex-notify-hook-integration-design.md` 中明确预留的“Spec 2”方向一致
- transcript 比 terminal output 更结构化，噪声更低，适合作为评估主输入
- 通过 Provider 无头命令，可以把“评估执行方式”收敛到 provider 抽象层，而不是在 server 里硬编码第三方 SDK 细节
- 每个 Supervisor 都可以独立选择 evaluator provider（如 `claude` / `codex`）；server 通过对应 provider config 注入运行所需环境变量，而不是依赖交互式 session 本身的认证状态

### 2.3 Scheduler 采用纯事件驱动模型

存在两种实现方向：

1. 纯 `setInterval` 轮询
2. 只在 `turn_completed` 时评估

本 spec 在 Phase 3 选择 **方案 2**：

- `turn_completed` 到达时，触发一次“立即评估资格检查”
- 不做定时轮询，不做“无新证据”的定期探测
- 人工 `trigger` 仍然保留，作为显式重评估入口

原因：

- 当前架构已经具备稳定的 `turn_completed` 生命周期事件，Phase 3 应先建立在明确信号之上
- “无 turn 场景下的兜底检测”需要先定义证据新鲜度判定，否则很容易制造误评估和误打断
- PRD 里的 Supervisor 主要交互仍围绕 objective、manual trigger、pause/resume，不要求当前阶段暴露评估频率配置

下一阶段优化目标：

- 在长任务、无显式 turn 结束的场景下补充周期兜底检查
- 重新设计内部 `intervalMs` 与证据新鲜度判定，再决定是否恢复该能力

---

## 3. 系统概览

### 3.1 逻辑角色

```text
┌──────────────────────────────────────────────┐
│              SupervisorManager              │
│ create/update/pause/resume/delete/trigger   │
│ load persisted state / gate capability      │
└──────────────┬──────────────────────────────┘
               │
     ┌─────────┼─────────┐
     ↓         ↓         ↓
┌──────────┐ ┌──────────┐ ┌─────────────┐
│Scheduler │ │Evaluator │ │  Injector   │
│event-driven│ │headless  │ │terminal.input│
└────┬─────┘ └────┬─────┘ └──────┬──────┘
     │            │               │
     ↓            ↓               ↓
┌──────────┐ ┌──────────────┐ ┌──────────────┐
│Cycle Repo│ │ContextBuilder │ │TerminalManager│
└──────────┘ └──────┬───────┘ └──────────────┘
                    ↓
         ┌──────────────────────┐
         │ transcript / terminal │
         │ git summary / session │
         └──────────────────────┘
```

### 3.2 职责划分

- `SupervisorManager`
  - 对外暴露命令级 API
  - 管理 Supervisor 状态机
  - 保证单 session 最多 1 个 Supervisor
  - 在 server 启动时恢复持久化状态
  - 协调 Scheduler / Evaluator / Injector / Repo / Broadcaster

- `SupervisorScheduler`
  - 订阅 `session.lifecycle`
  - 处理 `turn_completed` 触发
  - 对重复 turn 和 busy 场景做保护

- `SupervisorContextBuilder`
  - 读取 transcript_path
  - 解析 provider-specific transcript
  - 回退 terminal recent output
  - 追加 git status / diff stat 等上下文
  - 裁剪为有上限的结构化评估输入

- `SupervisorEvaluator`
  - 生成评估 prompt
  - 通过 provider 无头命令拿到 JSON 结果
  - 解析、校验和归一化输出

- `SupervisorInjector`
  - 把 guidance 转成等价于用户输入的文本
  - 通过 `TerminalManager` 的输入路径送入会话
  - 做重复注入保护和基本的格式约束

- `SupervisorRepo` / `SupervisorCycleRepo`
  - 负责持久化和恢复
  - 提供 list/get/create/update/delete/prune

---

## 4. 数据模型

### 4.1 领域模型

保留现有 `packages/core/src/domain/supervisor.ts` 的基础结构，并做以下扩展：

```ts
export type SupervisorState =
  | 'inactive'
  | 'idle'
  | 'evaluating'
  | 'injecting'
  | 'paused'
  | 'error';

export type CycleStatus =
  | 'queued'
  | 'evaluating'
  | 'completed'
  | 'injected'
  | 'failed';

export type CycleTrigger =
  | 'turn_completed'
  | 'manual';

export type EvidenceSource =
  | 'transcript'
  | 'terminal_fallback';

export interface SupervisorCycle {
  id: string;
  supervisorId: string;
  sessionId: string;
  status: CycleStatus;
  trigger: CycleTrigger;
  evidenceSource: EvidenceSource;
  objective: string;
  evaluatorProviderId: string;
  turnId?: string;
  progress?: number;
  result?: string;
  injectedGuidance?: string;
  errorReason?: string;
  createdAt: number;
  completedAt?: number;
}

export interface Supervisor {
  id: string;
  sessionId: string;
  workspaceId: string;
  state: SupervisorState;
  objective: string;
  evaluatorProviderId: string;
  cycles: SupervisorCycle[];
  lastCycleAt?: number;
  lastEvaluatedTurnId?: string;
  errorReason?: string;
  createdAt: number;
  updatedAt: number;
}
```

决策说明：

- `trigger` 和 `evidenceSource` 对调试和 UI 历史很重要，不能只存在日志里
- `lastEvaluatedTurnId` 用于去重，避免同一轮 transcript 被重复评估
- `evaluatorProviderId` 同时存进 supervisor 和 cycle，确保切换 provider 后历史记录仍可追溯

### 4.2 持久化表结构

新增迁移：`packages/server/src/storage/migrations/003_supervisors.sql`

```sql
CREATE TABLE supervisors (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  objective TEXT NOT NULL,
  evaluator_provider_id TEXT NOT NULL,
  last_cycle_at INTEGER,
  last_evaluated_turn_id TEXT,
  error_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_supervisors_workspace ON supervisors(workspace_id);
CREATE INDEX idx_supervisors_session ON supervisors(session_id);

CREATE TABLE supervisor_cycles (
  id TEXT PRIMARY KEY,
  supervisor_id TEXT NOT NULL REFERENCES supervisors(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  evidence_source TEXT NOT NULL,
  objective TEXT NOT NULL,
  evaluator_provider_id TEXT NOT NULL,
  turn_id TEXT,
  progress INTEGER,
  result TEXT,
  injected_guidance TEXT,
  error_reason TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX idx_supervisor_cycles_supervisor ON supervisor_cycles(supervisor_id, created_at DESC);
CREATE INDEX idx_supervisor_cycles_session ON supervisor_cycles(session_id, created_at DESC);
```

### 4.3 历史保留策略

保留现有 `DEFAULT_SUPERVISOR_CONFIG.maxCyclesPerSession = 100` 的语义。

实现规则：

- 每次插入新 cycle 后，若该 supervisor 的历史数量超过 100，删除最老记录
- 前端默认只展示最近 5 条 cycle
- `supervisor.get` 默认返回最近 20 条；更多历史不在 Phase 3 UI 中暴露

### 4.4 配置来源

Supervisor 相关配置分两层：

1. **session 级 Supervisor 配置**
   - `objective`
   - `evaluatorProviderId`
   - `paused / active`

2. **provider 运行配置**
   - 对应 provider 的 `apiKey/model` 从现有 provider 配置读取
   - `evaluatorProviderId` 只决定“用哪个 provider 来做评估”，不复制一份独立 credentials

决策：

- `evaluatorProviderId` 属于 Supervisor 实体本身，必须在 enable / edit 对话框中可见并可修改
- 不为 Supervisor 单独新增一套 API key 存储表
- 直接复用已有 provider config；这样能保持“Supervisor 独立于 Agent 会话本身”，但不引入重复配置系统
- Phase 3 不支持 per-supervisor 的 model / apiKey override；用户只选择 `claude` / `codex` provider，具体 model 仍来自该 provider 的现有配置

---

## 5. Provider 抽象扩展

### 5.1 新增无头评估命令接口

在 `packages/core/src/provider/definition.ts` 中为 ProviderDefinition 增加可选能力：

```ts
export interface SupervisorEvalCommandRequest {
  prompt: string;
  sessionId: string;
  workspacePath: string;
  apiKey?: string;
  model?: string;
}

export interface TranscriptExcerptRequest {
  transcriptPath: string;
  maxChars: number;
  maxTurns: number;
}

export interface ProviderDefinition {
  // ...现有字段...
  buildSupervisorEvalCommand?: (
    config: ProviderConfig,
    req: SupervisorEvalCommandRequest
  ) => {
    argv: string[];
    cwd?: string;
    env?: Record<string, string>;
  } | null;

  readTranscriptExcerpt?: (
    req: TranscriptExcerptRequest
  ) => Promise<{
    excerpt: string;
    lastTurnId?: string;
  } | null>;
}
```

### 5.2 Claude / Codex 实现

- `claude`
  - 提供 `buildSupervisorEvalCommand`
  - 提供 `readTranscriptExcerpt`
- `codex`
  - 提供 `buildSupervisorEvalCommand`
  - 提供 `readTranscriptExcerpt`

约束：

- 只有 `capability === 'full'` 的 provider 才允许作为 session provider 启用 Supervisor
- 只有实现了 `buildSupervisorEvalCommand` 的 provider 才允许作为 evaluator provider

### 5.3 兼容性决策

这一步会让 `packages/server/src/supervisor/evaluator.ts` 从“直接调用 Anthropic SDK”迁移到“通过 provider 抽象执行 headless eval”。

因此，当前代码中的 SDK 直连实现视为过渡实现，不作为最终形态保留。

---

## 6. 服务端详细设计

### 6.1 Manager 依赖

`SupervisorManagerDeps` 扩展为：

```ts
export interface SupervisorManagerDeps {
  eventBus: EventBus;
  broadcaster: Broadcaster;
  terminalMgr: TerminalManager;
  workspaceMgr: WorkspaceManager;
  sessionMgr: SessionManager;
  providerRegistry: ProviderDefinition[];
  providerConfigRepo: ProviderConfigRepo;
  supervisorRepo: SupervisorRepo;
  cycleRepo: SupervisorCycleRepo;
}
```

### 6.2 启动恢复

server 启动时，`SupervisorManager` 要执行：

1. 从 `supervisors` 表读取所有记录
2. 对 state 做崩溃恢复归一化：
   - `evaluating` -> `idle`
   - `injecting` -> `idle`
   - `idle` 保持 `idle`
   - `paused` 保持 `paused`
   - `error` 保持 `error`
3. 把恢复后的实体装入内存索引
4. 恢复后继续响应后续 `turn_completed` 事件和手动 `trigger`

原因：

- 进程崩溃后，不应把一个已经中断的“评估中 / 注入中”状态永久保留
- 但也不能静默删除或重置 objective / history

### 6.3 创建 / 更新 / 删除规则

#### create

输入：`sessionId`, `workspaceId`, `objective`, `evaluatorProviderId`

校验：

- session 必须存在
- session 不能是 draft
- session.provider.capability 必须是 `full`
- 同一 session 不允许重复创建 supervisor
- objective trim 后不能为空
- `evaluatorProviderId` 必须存在于 provider registry 中
- 对应 provider 必须实现 `buildSupervisorEvalCommand`
- 对应 provider config 必须存在且满足最小运行要求；否则直接拒绝 create，返回 `missing_evaluator_config`

副作用：

- 落库 `supervisors`
- 装入内存索引
- 广播 `supervisor.state` created 事件

#### update

允许更新：

- `objective`
- `evaluatorProviderId`

规则：

- 若 evaluator provider 变化，后续新 cycle 立即使用新 provider；历史 cycle 不被重写
- 更新不会清空历史 cycle
- 若 state 为 `error` 且 `objective` 或 `evaluatorProviderId` 被修改，state 会重置为 `idle`，`errorReason` 清空
- 若更新后的 evaluator provider 无效或未配置，直接拒绝 update

#### delete

规则：

- 删除 `supervisors` + `supervisor_cycles`
- 广播 `supervisor.state` deleted 事件

### 6.4 Pause / Resume / Trigger

#### pause

- 只允许在 `idle` / `error` / `evaluating` / `injecting` 等可控状态调用
- 对于 `evaluating` / `injecting` 中的 pause，不中断当前 in-flight 操作；仅阻止后续新 cycle
- 结果状态设为 `paused`

#### resume

- `paused` -> `idle`
- 不做自动 catch-up evaluation；等待下一次 `turn_completed` 或人工 `trigger`

#### trigger

- 作为人工强制触发入口
- 若当前已有 in-flight evaluation，返回 `supervisor_busy`
- 手动触发不会忽略 pause；`paused` 状态下调用 trigger 会被拒绝

### 6.5 Scheduler

Scheduler 只有一类输入：

1. `session.lifecycle.turn_completed`

内部维护：

- `inFlight: Set<supervisorId>`

评估资格判断：

- supervisor.state 必须是 `idle`
- session.state 必须是 `running` 或 `idle`
- 若 `turnId === lastEvaluatedTurnId`，则跳过
- Phase 3 不做周期轮询，也不做无 turn 场景下的补偿检查

### 6.6 ContextBuilder

每次 evaluation 前构造如下输入：

```ts
interface SupervisorEvaluationContext {
  objective: string;
  sessionId: string;
  workspaceId: string;
  workspacePath: string;
  sessionProviderId: string;
  evaluatorProviderId: string;
  sessionState: SessionState;
  transcriptExcerpt?: string;
  terminalExcerpt?: string;
  gitStatusSummary?: string;
  gitDiffStat?: string;
  lastTurnId?: string;
  evidenceSource: 'transcript' | 'terminal_fallback';
}
```

构建顺序：

1. 若 session.transcriptPath 存在，尝试调用 session provider 的 `readTranscriptExcerpt`
2. 若拿到 excerpt，则 evidenceSource = `transcript`
3. 否则读取 `TerminalManager.getSessionOutput(sessionId)` 的最近 N 行，evidenceSource = `terminal_fallback`
4. 从 workspace 路径读取简化 git 信息：
   - `git status --short`
   - `git diff --stat`
5. 对 transcript / terminal / git 内容做长度裁剪，避免 prompt 失控

### 6.7 Evaluator

#### 输入 prompt 结构

Evaluator prompt 由三部分组成：

1. 固定 system instruction
2. objective + session state + history summary
3. transcript / terminal / git 证据块

要求输出严格 JSON：

```json
{
  "progress": 42,
  "summary": "实现了登录 API，前端表单仍未接线。",
  "shouldInject": true,
  "guidance": "先补齐表单提交和错误处理，再跑相关测试。",
  "confidence": 0.79
}
```

#### 结果校验

server 侧使用 Zod 做二次校验：

- `progress` 必须裁剪到 `0..100`
- `summary` 不能为空
- `guidance` 仅在 `shouldInject=true` 时允许存在
- 若解析失败，cycle 记为 `failed`

#### evaluator provider 选择

- 直接读取当前 `supervisor.evaluatorProviderId`
- 读取该 provider 的配置作为 headless eval 的运行配置
- `create/update` 时做前置校验，避免把不可运行的 provider 保存进实体
- 若 provider 后续被移除、失去 headless eval 能力、或配置被删除，则此次 cycle 失败并记录 `missing_evaluator_config`

### 6.8 Injector

最终注入路径必须满足“等价于用户手动输入”。

因此，本 spec 明确要求：

- 不允许通过 `writeToSession()` 仅把文本打印到 terminal 屏幕
- 必须调用 terminal input 语义对应的方法，把 guidance 作为真实输入送入 PTY

注入文案格式：

```text
Supervisor guidance:
Objective: <objective>
Assessment: <summary>
Next step: <guidance>
```

行为约束：

- 自动在末尾补一个换行，确保 Agent 真正收到提交
- 若 guidance 与上一条注入 guidance 哈希一致，且间隔小于 2 个 cycle，则跳过注入并把 cycle 标为 `completed` 而非 `injected`
- 若 session 已 ended / unavailable，则禁止注入并把 cycle 标为 `failed`

### 6.9 WS 广播契约

沿用现有 topic 设计：

- `workspace.{workspaceId}.session.{sessionId}.supervisor.state`
- `workspace.{workspaceId}.session.{sessionId}.supervisor.cycle`

状态 topic payload：

```ts
{ supervisor: Supervisor, event: 'created' | 'updated' | 'state_changed' }
{ supervisorId: string, event: 'deleted' }
```

周期 topic payload：

```ts
{ cycle: SupervisorCycle, event: 'created' | 'updated' }
```

---

## 7. 命令接口

### 7.1 命令列表

保留并固化当前命令名：

- `supervisor.create`
- `supervisor.get`
- `supervisor.update`
- `supervisor.delete`
- `supervisor.pause`
- `supervisor.resume`
- `supervisor.trigger`

关键入参约束：

- `supervisor.create` 必须包含 `objective` 和 `evaluatorProviderId`
- `supervisor.update` 允许更新 `objective`、`evaluatorProviderId`
- 前端 enable / edit 对话框提交时，不允许省略 `evaluatorProviderId`

### 7.2 返回约定

- `supervisor.create/get/update/pause/resume` 返回 `{ supervisor }`
- `supervisor.delete` 返回 `{}`
- `supervisor.trigger` 返回 `{ cycle }`

### 7.3 `supervisor.get` 语义

输入：`{ sessionId }`

返回：

```ts
{
  supervisor: Supervisor | null;
}
```

约束：

- 若存在 supervisor，返回对象中包含最近 20 条 cycle
- 若不存在，返回 `null`
- 前端不需要单独的 `history.get` 命令

---

## 8. 前端详细设计

### 8.1 状态来源

前端 Supervisor 状态遵循“server authoritative”：

- Jotai atoms 只做投影缓存
- create/update/pause/resume/trigger/delete 之后不做本地乐观写入
- 所有状态最终依赖 command result + WS event 收敛

### 8.2 Atom 设计

保留现有：

- `supervisorsAtom: Map<sessionId, Supervisor>`
- `supervisorCyclesAtom: Map<supervisorId, SupervisorCycle[]>`
- `supervisorDialogAtom`

扩展点：

- `supervisorDialogAtom.mode` 从 `enable | edit` 扩为 `enable | edit | disable`
- `supervisorDialogAtom` 需要承载 `draftObjective` 和 `draftEvaluatorProviderId`
- 增加 `supervisorHydratedAtomFamily(sessionId)`，标记某个 session 是否已跑过 `supervisor.get`

### 8.3 初始 hydration

当前 `AppProviders` 已开始接收 supervisor event，但还不够。

最终流程：

1. `SessionCard` 挂载时，如果 session 不是 draft 且 capability 为 `full`
2. 调用 `supervisor.get(sessionId)`
3. 若返回 supervisor，则写入 `supervisorsAtom` 和 `supervisorCyclesAtom`
4. 后续全部靠 WS event 增量更新

这样可以覆盖“页面刷新后 server 已有 supervisor，但前端缓存为空”的场景。

### 8.4 Agent Pane 结构

`SessionCard` 最终结构调整为：

1. session progress bar
2. session header
3. **supervisor card 区域**
4. terminal area
5. session input

即 Supervisor 卡片位于 header 与 terminal 之间，而不是脱离 Agent Pane 单独展示。

### 8.5 Supervisor 卡片

卡片分四个区：

1. **Header**
   - BadgeCheck 图标
   - `Supervisor` 标签
   - state tag

2. **Objective Row**
   - 展示目标的单行摘要，超出省略

3. **Progress / History**
   - progress bar：
     - `evaluating` / `injecting` 时显示动效条
     - 其他状态显示最近一次成功 cycle 的 progress
   - recent history：最近 5 条 cycle，展示状态、触发方式、时间、progress

4. **Actions**
   - edit
   - pause / resume
   - retry（仅 error 时可见，本质调用 trigger）
   - trigger
   - disable

### 8.6 Enable / Disable 规则

- session 为 draft：不显示 supervisor 区
- session.provider.capability != `full`：显示禁用态按钮和 tooltip
- session 为 full 且无 supervisor：显示 enable 按钮
- disable 动作进入 `disable` 模式对话框确认，而不是直接删

### 8.7 Objective Dialog

对话框模式：

- `enable`
- `edit`
- `disable`

布局：

- `enable/edit`
  - 5 行 textarea
  - evaluator provider 单选或下拉：
    - 列出实现了 `buildSupervisorEvalCommand` 的 provider
    - 当前 Phase 3 预期至少包含 `claude` / `codex`
  - provider status/helper text：
    - 显示该 provider 是否已配置可用
    - 说明“将复用该 provider 当前已配置的 API key / model”
  - preview `<pre>`
  - Cancel / Confirm
- `disable`
  - 只读显示当前 objective
  - 辅助说明：禁用会停止评估并清空历史
  - Cancel / Disable

决策：

- `evaluatorProviderId` 在 Phase 3 UI 中必须暴露，且 enable / edit 都可修改
- 不提供 per-supervisor 的 model / API key 高级配置面板，保持启用动作足够轻量
- 不提供任何评估频率配置；Phase 3 没有周期兜底检测能力
- 当所选 provider 未配置时，Confirm 必须禁用或在提交时返回明确错误

---

## 9. 状态机与时序

### 9.1 Supervisor 状态机

```text
inactive
  └─ create ─> idle

idle
  ├─ turn_completed / trigger ─> evaluating
  ├─ pause ─> paused
  ├─ delete ─> inactive
  └─ internal error ─> error

evaluating
  ├─ result without guidance ─> idle
  ├─ result with guidance ─> injecting
  ├─ parse/runtime failure ─> error
  └─ delete request ─> mark for deletion after in-flight completes

injecting
  ├─ injection success ─> idle
  └─ injection failure ─> error

paused
  ├─ resume ─> idle
  └─ delete ─> inactive

error
  ├─ trigger retry ─> evaluating
  ├─ update objective / evaluator provider ─> idle
  ├─ pause ─> paused
  └─ delete ─> inactive
```

### 9.2 Cycle 状态流

```text
queued
  └─ start ─> evaluating

evaluating
  ├─ success no guidance ─> completed
  ├─ success with guidance ─> injected
  └─ error ─> failed
```

### 9.3 典型时序：自动评估

```text
turn_completed
  ↓
Scheduler 收到 lifecycle event
  ↓
检查 supervisor 是否 active / 非 paused / 非 busy
  ↓
创建 cycle(status=queued, trigger=turn_completed)
  ↓
ContextBuilder 读取 transcript excerpt
  ↓
Evaluator 调用 headless provider
  ↓
若 shouldInject=false
  → cycle=completed → supervisor=idle

若 shouldInject=true
  → supervisor=injecting
  → Injector 发送真实输入
  → cycle=injected
  → supervisor=idle
```

---

## 10. 错误处理与保护策略

### 10.1 典型错误码

命令层需要归一化以下错误：

- `supervisor_not_found`
- `supervisor_already_exists`
- `supervisor_unsupported_provider`
- `supervisor_invalid_evaluator_provider`
- `supervisor_busy`
- `supervisor_paused`
- `missing_evaluator_config`
- `transcript_unavailable`
- `inject_target_unavailable`

### 10.2 fallback 策略

- transcript 读取失败 -> fallback terminal
- terminal 也不可用 -> cycle failed
- evaluator provider 不可用 -> cycle failed，state error
- injection 失败 -> cycle failed，state error

### 10.3 去重与并发

- 每个 supervisor 同时最多 1 个 in-flight cycle
- 同一 `turnId` 只允许成功评估一次
- 删除 / pause 在 in-flight 时不做 hard cancel，只更新期望状态，等当前 cycle 结束后收敛

### 10.4 安全边界

- guidance 文本最大长度限制为 2000 chars
- objective 存储最大长度限制为 4000 chars
- transcript / terminal / git 上下文构建必须做 size cap，避免 headless eval 卡死
- 所有 headless command 执行必须有 timeout，默认 30s

---

## 11. 文件影响面

### 11.1 Core

- Modify: `packages/core/src/domain/supervisor.ts`
- Modify: `packages/core/src/provider/definition.ts`
- Modify: `packages/core/src/protocol/topics.ts`（若 topic helper 需要补类型）

### 11.2 Providers

- Modify: `packages/providers/src/claude/definition.ts`
- Modify/Create: `packages/providers/src/claude/*` transcript excerpt 读取逻辑
- Modify: `packages/providers/src/codex/definition.ts`
- Modify/Create: `packages/providers/src/codex/*` transcript excerpt 读取逻辑

### 11.3 Server

- Create: `packages/server/src/storage/migrations/003_supervisors.sql`
- Create: `packages/server/src/storage/repositories/supervisor-repo.ts`
- Create: `packages/server/src/storage/repositories/supervisor-cycle-repo.ts`
- Modify: `packages/server/src/ws/dispatch.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/commands/supervisor.ts`
- Refactor: `packages/server/src/supervisor/manager.ts`
- Refactor: `packages/server/src/supervisor/scheduler.ts`
- Refactor: `packages/server/src/supervisor/evaluator.ts`
- Refactor: `packages/server/src/supervisor/injector.ts`
- Create: `packages/server/src/supervisor/context-builder.ts`

### 11.4 Web

- Modify: `packages/web/src/app/providers.tsx`
- Modify: `packages/web/src/features/agent-panes/components/session-card.tsx`
- Modify: `packages/web/src/features/supervisor/atoms.ts`
- Modify: `packages/web/src/features/supervisor/components/supervisor-card.tsx`
- Modify: `packages/web/src/features/supervisor/components/objective-dialog.tsx`
- Create: `packages/web/src/features/supervisor/hooks/use-supervisor.ts`

---

## 12. 测试与验收

### 12.1 Server 单测

必须新增或补强：

- `supervisor-repo.test.ts`
  - CRUD
  - session 级唯一约束
  - cycle retention prune
- `manager.test.ts`
  - create / update / delete / pause / resume / trigger
  - evaluator provider 校验
  - 切换 evaluator provider 后下一轮生效
  - startup recovery
  - duplicate turn dedupe
  - pause during in-flight
- `scheduler.test.ts`
  - turn_completed 触发
  - duplicate turn 跳过
  - paused / busy 时不触发
  - busy 防重入
- `context-builder.test.ts`
  - transcript primary
  - terminal fallback
  - git summary 截断
- `evaluator.test.ts`
  - prompt 生成
  - 使用 supervisor 自身的 evaluator provider，而非全局设置
  - JSON parse / zod 校验
  - timeout / provider unavailable
- `injector.test.ts`
  - terminal input 路径
  - dedupe guidance
  - ended session 拒绝注入

### 12.2 集成测试

必须覆盖：

1. `TurnCompleted` -> 创建自动 cycle -> completed
2. `TurnCompleted` -> shouldInject=true -> injected
3. server 重启恢复 supervisor
4. transcript 不存在时 fallback terminal
5. edit supervisor 从 `claude` 切到 `codex` 后，下一次 cycle 使用新 provider
6. delete session 时 supervisor 级联删除

### 12.3 Web 测试

必须覆盖：

- `SessionCard` 中显示 enable / active / paused / error 四类 supervisor 状态
- `ObjectiveDialog` 的 enable / edit / disable 三种模式
- `AppProviders` 正确路由 `supervisor.state` / `supervisor.cycle`
- 页面刷新后通过 `supervisor.get` 成功 hydration

### 12.4 E2E 验收

最小验收链路：

1. 启动一个 full-capability session
2. 启用 supervisor 并输入 objective
3. 手动触发一次 `supervisor.trigger`
4. UI 出现一条 cycle 记录
5. pause / resume 可操作
6. disable 后卡片回到 enable 态

---

## 13. 下一阶段优化目标

当前明确延期到下一阶段、**不属于 Phase 3 实现范围** 的能力：

- 无 turn 长任务场景下的周期兜底检查
- 基于 transcript / terminal 证据新鲜度的自动补偿评估
- 内部 `intervalMs` 设计，以及与 UI / API 是否暴露该参数的重新评估

这些能力只有在以下前提明确后才应重新引入：

1. 什么算“有新证据”
2. 什么场景允许自动打断或重新指导 Agent
3. 如何避免在长时间命令输出或噪声日志下频繁误触发

---

## 14. 与当前实现的收敛关系

以下现有实现会被保留：

- 现有 command 名称
- 现有 WS topic 命名
- 现有 core 基础类型命名
- 现有 web supervisor 模块目录结构

以下现有实现会被替换或重构：

- `packages/server/src/supervisor/evaluator.ts` 的 Anthropic SDK 直连
- `packages/server/src/supervisor/injector.ts` 的 `writeToSession()` 直写
- `packages/server/src/supervisor/manager.ts` 的纯内存存储与未接入 lifecycle 事件的纯 `setInterval` 调度
- `packages/web/src/features/supervisor/components/*` 的“组件存在但未完整挂接 Agent Pane”现状

---

## 15. 结论

本 spec 的核心目标不是“再做一版会跑的 Supervisor”，而是把当前 MVP 收敛成一套：

- 可恢复
- 可解释
- 可测试
- 与 transcript / hook 基础设施一致
- 与 Agent Pane 真正整合

的 Phase 3 正式实现。

实现时应优先保证：

1. 持久化和恢复正确
2. transcript 优先的评估输入正确
3. guidance 注入路径真实有效
4. 前端刷新和重连后的状态同步正确

在这四点成立前，不应把当前 MVP 视为“功能完成”。
