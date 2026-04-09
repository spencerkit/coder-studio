# Terminal Gateway Final Architecture Design

## Context

Coder Studio 当前的 session 输入输出流以“前端 terminal + 后端 PTY + 业务状态同步”组合完成，能工作，但有明显的结构性脆弱点：

- terminal 正文流和业务状态流是并行但不同源的
- session 启动依赖 `session_runtime_start -> boot_input -> terminal_write` 两段式链路
- provider 运行时与当前 terminal/PTTY 生命周期绑定较紧
- 网络断开、页面刷新、runtime attach 切换时，用户容易感知为“流断了”“输入没反应”“任务没了”
- 当前缺少一个独立于前端连接存在的持久 terminal/session 真相源

新的终局架构目标不是继续在现有 PTY + 业务事件模型上打补丁，而是把 terminal 从“一个附属组件”升级为独立的运行时系统：

- `tmux` 负责持久会话保活
- Coder Studio 自建 Terminal Gateway 负责 attach / detach / replay / routing
- `xterm.js` 继续作为前端展示层
- session 成为业务对象，TerminalRuntime 成为运行时真相

本设计是**终局架构**，不是最小迁移方案。它描述目标状态与系统边界，供后续实施计划拆分阶段使用。

---

## Goals

- 为每个 session 提供独立、可恢复、可保活的 terminal runtime
- 让长任务在浏览器断线、页面刷新、前端重连后仍然持续运行
- 让 terminal 数据面与业务状态面分离
- 消除当前 `boot_input` 两段式启动模型
- 让 provider 启动、恢复、输入输出都运行在持久 terminal 层之上
- 让 UI 可以明确区分：静默、断开、stdin 关闭、provider 退出、tmux 缺失

## Non-goals

- 本设计不要求继续把 `ttyd` 或 `Wetty` 作为终局主链路依赖
- 本设计不讨论 provider prompt 语义优化
- 本设计不覆盖 auth / multi-tenant infra 的完整扩展方案
- 本设计不要求一次性替换整个当前架构

---

## Core Principles

### 1. TerminalRuntime 是运行时真相

当前系统中，session 与 terminal 绑定较紧，terminal 更像 session 的从属物。终局里要反过来：

- `Session` 是业务对象
- `TerminalRuntime` 是 IO 和运行时真相源
- Session 通过 `runtime_ref` 引用 TerminalRuntime

这样前端 attach / detach 不再影响运行时是否存在。

### 2. tmux 是持久运行层

`tmux` 负责：

- session 持久化
- detach / reattach
- 长任务持续运行
- 断网、刷新后仍可 attach 回原会话
- 输出历史与 scrollback 的底层来源

这意味着“浏览器没连上”和“会话是否活着”不再是同一个问题。

### 3. xterm.js 只做展示层

前端保留 `xterm.js`，负责：

- 输入采集
- ANSI 渲染
- 滚动与光标体验

但它不再承担会话保活职责，也不再是真正的 terminal 生命周期真相源。

### 4. 数据面与状态面彻底分离

终局必须明确拆成两类链路：

#### Terminal 数据面
- 输入字符流
- 输出字符流
- resize
- attach / detach
- replay / backfill

#### 业务状态面
- session metadata
- runtime state
- lifecycle
- supervisor state
- provider hook 结果

这样可以避免“有状态无正文”或“有正文无状态”的混淆扩散到整个系统。

---

## Domain Model

### Workspace
业务级容器，保留当前角色：
- 工作目录 / target
- tabs / layout / artifacts
- session 集合

### Session
业务对象，负责：
- `session_id`
- `provider`
- `title`
- `resume_id`
- `objective` / supervisor 业务字段
- `runtime_ref`
- `session_state`

Session 不再直接拥有一个临时 terminal，而是引用一个 TerminalRuntime。

### TerminalRuntime
新的运行时核心对象。

建议字段：
- `terminal_runtime_id`
- `workspace_id`
- `session_id`
- `provider`
- `tmux_session_name`
- `tmux_window_id` / `tmux_pane_id`
- `runtime_state`
- `terminal_liveness`
- `attached_clients`
- `created_at`
- `last_active_at`
- `scrollback_head` / `replay_cursor`

### TerminalChannel
前端一次 attach 的连接对象。

建议字段：
- `channel_id`
- `terminal_runtime_id`
- `client_id`
- `attached_at`
- `last_seen_at`

一个 TerminalRuntime 可以有 0..N 个 attached channels。

---

## Runtime Components

### 1. Session Manager

负责业务层：
- 创建/恢复 session
- session 与 TerminalRuntime 的关联
- session 状态切换
- provider metadata / resume_id / lifecycle 管理
- 与 supervisor 等业务功能集成

### 2. Terminal Gateway

这是终局最核心的新服务层。它负责：

- TerminalRuntime 注册
- attach / detach
- 输入路由
- 输出分发
- replay / backfill
- channel 生命周期管理
- liveness 监控

它不负责 provider 业务含义，只负责 terminal runtime 的 transport 和生命周期。

### 3. tmux Adapter

负责与 `tmux` 交互：

- 创建 tmux session
- 创建/定位 pane
- 向 pane 写入 stdin
- 读取 pane 输出
- capture scrollback
- 判断 tmux session/pane 是否存在
- 提供 attach/reattach 所需信息

### 4. Provider Runtime Adapter

保留当前 provider abstraction 的职责，但运行在新的 runtime 模型之上：

- 构造 Claude/Codex 启动命令
- 构造 resume 命令
- 管理 provider hooks
- 读取 provider runtime settings

---

## Data Flow

## 1. Session startup flow

当前模型：
- 前端调用 `session_runtime_start`
- 后端返回 `boot_input`
- 前端再调用 `terminal_write(boot_input)`

终局模型：

```text
UI 请求启动 Session
-> Session Manager 创建/恢复 TerminalRuntime
-> Terminal Gateway 创建 tmux session/pane
-> Provider Runtime Adapter 生成 provider 启动命令
-> 后端直接向 tmux pane 注入启动命令
-> 前端 attach 到 TerminalRuntime channel
```

### 关键变化
- 前端不再发送 `boot_input`
- provider 启动变成后端原子操作的一部分
- “terminal 已建好但 provider 还没真正启动”的窗口被消除

## 2. Input flow

```text
xterm.js onData
-> terminal_channel_input
-> Terminal Gateway
-> route to TerminalRuntime
-> tmux Adapter writes pane stdin
```

输入不再经过当前的 `terminal_write` 混合 RPC/WS fallback 模型，而是统一走 terminal channel。

## 3. Output flow

```text
tmux pane output
-> tmux Adapter reader
-> Terminal Gateway append buffer
-> publish terminal_output event
-> attached channel(s)
-> xterm.js render
```

输出首先进入后端 runtime buffer，再 fanout 给前端，而不是只依赖当前前端连接作为唯一消费端。

## 4. Detach / reconnect flow

```text
浏览器断线
-> TerminalChannel 断开
-> TerminalRuntime 保持存活
-> tmux session 继续运行

浏览器重连
-> attach channel
-> Gateway replay buffered output
-> 恢复实时输出
```

---

## State Model

终局架构里必须明确区分三个层次的状态。

### 1. SessionState（业务态）
- `idle`
- `running`
- `interrupted`
- `archived`

### 2. TerminalLiveness（terminal 运行态）
- `attached`
- `detached`
- `stdin_closed`
- `provider_exited`
- `tmux_missing`
- `silent`

### 3. ProviderLifecycle（语义态）
- `session_started`
- `turn_completed`
- `resume_id_updated`

### 为什么必须拆开
当前系统里，用户看到“没有输出”“输入没反应”，很难判断到底是：
- provider 静默
- terminal writer 关闭
- tmux 不存在
- 前端未 attach
- session 真正 interrupted

终局里这三类状态必须分别维护，并在 UI 中有清晰映射。

---

## Recovery Semantics

### Network disconnected
- 不销毁 TerminalRuntime
- 不销毁 tmux session
- 只移除当前 TerminalChannel
- 恢复后允许重新 attach

### Page refresh
- 重新建立 TerminalChannel
- replay 最近 buffer
- 恢复实时流

### Provider silent
- TerminalRuntime 状态应允许表示 `running + silent`
- 不把“长时间无输出”误判成 interrupted

### Provider exited
- 标记 `provider_exited`
- Session 进入 `interrupted`
- UI 提供 recover / restart

### tmux missing
- 标记 `tmux_missing`
- 这与 provider exited 是不同的故障类别

---

## API Shape (Conceptual)

### Terminal data-plane commands/events

#### Commands
- `terminal_channel_attach`
- `terminal_channel_detach`
- `terminal_channel_input`
- `terminal_channel_resize`
- `terminal_channel_replay`

#### Events
- `terminal_channel_output`
- `terminal_channel_status`
- `terminal_channel_replay_chunk`

### Business-plane commands/events
继续保留现有业务层命令/事件思路：
- workspace/session metadata mutation
- runtime state updates
- lifecycle events
- supervisor events

但 terminal 高频 IO 不再混入这一层。

---

## What Gets Removed in the Final State

终局里应删除或废弃以下旧模型：

1. `boot_input` 两段式启动
2. `session -> 临时 terminal binding` 作为运行时核心模型
3. `terminal_write` 的 HTTP fallback 作为主输入通道
4. 依赖当前前端 attach 的输出真相
5. 把 terminal exit 直接近似成 session 真相

这些都属于当前架构下“会造成断流感”的核心结构来源。

---

## What This Final Architecture Solves

### Solves
- 长任务期间页面断开导致的“会话像死了”
- 前端刷新后难以恢复 terminal 输出
- 输入输出流和业务状态互相污染
- provider CLI 生命周期与当前 attach 连接强耦合
- 对“静默”和“断流”缺乏清晰区分

### Does Not Automatically Solve
- provider 自身崩溃
- hook 语义不可靠
- supervisor 业务逻辑问题
- 权限/控制器模型设计错误

这些仍需要在业务层解决。

---

## Trade-offs

### Benefits
- 持久性强
- reconnect 语义清晰
- terminal 流和业务流解耦
- 更容易做 replay / backfill / health 状态
- 更接近成熟远程开发产品的终局形态

### Costs
- 需要引入新的 Terminal Gateway 抽象
- 需要引入 tmux 作为系统依赖
- 需要重构当前 session_runtime / terminal_write / terminal event 模型
- 需要重新定义 attach/detach 与状态同步语义

---

## Recommendation

终局架构建议定为：

- **展示层**：`xterm.js`
- **持久运行层**：`tmux`
- **终端传输核心**：Coder Studio 自建 `Terminal Gateway`
- **业务层**：保留现有 workspace/session/provider/supervisor 抽象，但让 Session 引用 TerminalRuntime 而不是直接绑定临时 terminal

这是比“继续 patch 当前 PTY 模型”更系统、更稳定的终局方向。
