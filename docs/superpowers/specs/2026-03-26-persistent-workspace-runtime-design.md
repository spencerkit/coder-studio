# Persistent Workspace Runtime Design

> Status: Approved in chat, updated to reflect v0.2.4 landed behavior
> Date: 2026-03-26
> Scope: `apps/web` + `apps/server`

## 背景

当前项目的 `workspace`、`agent` 和 `shell` 更接近“当前页面 + 当前后端进程”的临时运行态：

- 前端本地状态承担了较多事实来源职责
- 后端 `agent` / `terminal` runtime 主要保存在内存 map 中
- WebSocket 更像纯实时通道，而不是可重连的状态同步协议
- `agent` 有部分 stream 持久化能力，但生命周期事件和运行时附着关系不完整
- `shell` 基本没有持久 attach / replay 语义，刷新、换浏览器、换设备后无法稳定续连

这导致以下问题：

- 浏览器刷新后不能稳定续上 `shell`
- 换浏览器、关闭重开、换设备时无法把当前工作台视为一个可持续存在的远程会话
- 多端状态不一致，当前共享工作台状态缺少唯一真相源
- `turn_completed` 这类生命周期事件在断线场景下可能丢失
- 现有模型中不存在严格的“单主控”语义

## 目标

把每个 `workspace` 升级为一个真正可持续存在、可重连、可共享的远程工作台。

完成后应满足：

1. 浏览器刷新后能续上同一个工作台
2. 关闭浏览器后重开能续上同一个工作台
3. 切换到另一个浏览器能以观察者身份接入同一个工作台
4. 换设备能以观察者身份接入同一个工作台
5. `workspace` 级别只允许一个主控端，其余端严格只读跟随
6. 观察者可申请接管；当前主控先收到提示，`10` 秒内不响应或已离线则自动转移控制权
7. 共享工作台状态由后端统一裁定并同步到所有端
8. `agent` 和 `shell` 都具备持久 attach / detach / replay 语义
9. 后端应朝“持久化运行时服务”演进，而不是继续依赖页面和单个 WS 连接维持语义

## 非目标

本设计不解决以下问题：

- 多账号、多租户权限模型
- 多人同时协同编辑同一 `workspace`
- 观察者本地临时浏览独立视图
- 无限历史输出保存
- 任意运行时的跨机器迁移

系统假设只有一个逻辑用户，不引入账号模型；只区分不同设备、不同浏览器 profile、不同页面实例。

## 用户约束

本设计基于已确认的产品规则：

- 控制权粒度：`workspace`
- 控制权模式：单主控
- 新端进入默认角色：观察者
- 观察者行为：严格跟随，不能修改共享工作台状态，也不能对 `agent` / `shell` 发输入
- 接管规则：
  - 新端发起接管申请
  - 当前主控收到提示
  - 等待 `10` 秒
  - 当前主控明确拒绝则申请失败
  - 当前主控超时未响应或已离线则申请成功
- 主控明确拒绝后，不允许申请方再强制接管
- 同步范围：共享工作台状态，而不是只同步运行态

## 核心概念

### 1. Workspace Runtime

`workspace runtime` 是一个长期存在的远程工作台实例。它不等价于当前浏览器页面，也不等价于某个临时 WS 连接。

一个 `workspace runtime` 包含：

- 共享工作台状态
- 当前控制权租约
- 一个或多个持久 `agent session`
- 一个或多个持久 `shell session`
- 活跃 attach 客户端集合
- 事件流和重放游标

### 2. Device / Client / Attachment

为了支持刷新、重开、换浏览器、换设备，需要显式区分三层身份：

- `device_id`
  - 存在浏览器 `localStorage`
  - 表示一个浏览器 profile 的长期身份
- `client_id`
  - 存在 `sessionStorage`
  - 表示一个具体 tab / window 实例
- `attachment_id`
  - 每次 attach 某个 `workspace runtime` 时生成
  - 表示一次具体附着会话

### 3. Controller Lease

控制权不由前端自判，而由后端租约裁定。

租约记录当前：

- 哪个 `device_id`
- 哪个 `client_id`
- 持有当前 `workspace` 的控制权
- 当前租约何时过期
- 当前控制权版本号

### 4. Fencing Token

每次控制权切换时，后端递增 `fencing_token`。

所有会改变共享状态或向运行时写入的请求都必须带上当前 `fencing_token`。后端收到旧 token 的写请求必须拒绝。这用于防止：

- 延迟网络包导致旧主控继续写入
- 页面假死后恢复造成双主控幻觉
- 接管完成后旧端继续向 `agent` / `shell` 发输入

## 总体架构

系统拆成三层：

### 1. 持久工作台层

唯一真相源，负责保存当前共享工作台状态：

- 当前活跃 `workspace runtime`
- 当前 controller / observer 拓扑
- `active_session_id`
- `active_terminal_id`
- `pane_layout`
- `active_pane_id`
- `file_preview`
- `viewing_archive_id`

这一层由后端持久化，不允许前端本地状态成为最终事实来源。

### 2. 持久运行时层

负责托管实际 `agent` / `shell` 运行时：

- 持久 `agent runtime session`
- 持久 `shell runtime session`
- attach / detach
- 输出缓冲
- replay
- 当前状态快照

这层的核心要求是：浏览器断开不等于运行时销毁。

### 3. 实时传输层

继续使用 WebSocket 作为实时通道，但职责变化为：

- 传输快照
- 传输增量事件
- 传输控制权变更
- 传输运行时输出

WebSocket 不再是事实来源，只是状态同步和命令传输层。

## 共享状态边界

### 必须共享的状态

以下状态必须由后端统一存储并广播：

- `active_session_id`
- `active_terminal_id`
- `pane_layout`
- `active_pane_id`
- `file_preview`
- `viewing_archive_id`
- 当前打开的 `workspace runtime`
- 各 session 的标题、状态、未读数

### 不共享的状态

以下状态保持前端本地：

- 当前 app shell 路由（例如当前是不是在 `/settings`）
- `open_workspace_ids`
- `active_workspace_id`
- workbench 外层布局（左右栏宽度、terminal/code panel 显隐）
- command palette 是否展开
- slash menu 是否展开
- 草稿输入框内容
- hover / focus
- 临时 loading 标记

原则：只共享“影响工作上下文和跨端续连语义”的状态，不共享纯瞬时 UI 噪音。

当前版本实现收口：

- `workspace_view_state` 已经是按 `workspace` 共享的后端真相
- `open_workspace_ids` / `layout` 已按 `device_id` 作用域持久化
- `active_workspace_id` 已按 `client_id` 作用域持久化
- 这意味着 app shell state 已不再是“单用户全局一份”，而是拆成设备级与客户端级两层状态
- 当前也没有独立的 `app_ui_state` WS 事件流，更多是依赖 bootstrap 和命令返回做状态收敛
- 现阶段这些状态仍主要通过 bootstrap 和命令返回收敛，而不是独立 WS 广播流

## 控制权状态机

`workspace` 的控制权状态机如下：

### 状态

- `uncontrolled`
  - 当前没有 controller
- `controlled`
  - 当前有有效 controller lease
- `takeover_pending`
  - 有观察者发起了接管申请，等待 controller 响应

### 状态流转

1. `uncontrolled -> controlled`
   - 首个请求控制权的客户端获得控制权

2. `controlled -> controlled`
   - 当前 controller heartbeat 续租

3. `controlled -> takeover_pending`
   - 观察者发起接管申请，后端记录 takeover 请求并通知当前 controller

4. `takeover_pending -> controlled`
   - 当前 controller 明确拒绝，控制权保持不变

5. `takeover_pending -> controlled`
   - 当前 controller `10` 秒内未响应或租约过期，申请方接管成功，`fencing_token + 1`

6. `controlled -> uncontrolled`
   - controller lease 到期且没有及时续租

### 控制权写入规则

只有当前 controller 可执行以下操作：

- 切换 session
- 切换 pane
- 切换 terminal
- 更新 `file_preview`
- archive / close session
- 关闭 workspace
- 向 `agent` 发送输入
- 向 `shell` 发送输入

观察者执行这些操作时，后端直接拒绝，前端只显示只读 UI，不做 optimistic update。

## 持久化数据模型

以下是推荐的数据对象边界；可落地为 SQLite 表，也可按后端现有模型封装，但语义必须完整表达。

### 1. `workspace_runtimes`

字段建议：

- `id`
- `workspace_id`
- `status`
  - `active`
  - `closing`
  - `closed`
- `created_at`
- `updated_at`
- `last_attached_at`
- `last_controller_seen_at`

职责：

- 表示一个持久工作台 runtime
- 作为 attach、controller lease、session runtime 的根对象

### 2. `workspace_controller_leases`

字段建议：

- `workspace_runtime_id`
- `controller_device_id`
- `controller_client_id`
- `lease_expires_at`
- `fencing_token`
- `takeover_request_id`
- `takeover_requested_by_device_id`
- `takeover_requested_by_client_id`
- `takeover_deadline_at`
- `updated_at`

职责：

- 表示当前 controller 租约
- 表示正在进行中的 takeover 事务

### 3. `workspace_workbench_state`

字段建议：

- `workspace_runtime_id`
- `active_session_id`
- `active_terminal_id`
- `pane_layout_json`
- `active_pane_id`
- `file_preview_json`
- `viewing_archive_id`
- `updated_at`
- `updated_by_device_id`
- `updated_by_client_id`
- `updated_by_fencing_token`

职责：

- 存共享工作台真相
- 可回溯最近一次写入来源

### 4. `workspace_attachments`

字段建议：

- `attachment_id`
- `workspace_runtime_id`
- `device_id`
- `client_id`
- `role`
  - `controller`
  - `observer`
- `attached_at`
- `last_seen_at`
- `detached_at`

职责：

- 表示当前有哪些客户端附着到该 runtime
- 用于在线状态判断、观察者列表和失联清理

### 5. `agent_runtime_sessions`

字段建议：

- `id`
- `workspace_runtime_id`
- `workspace_session_id`
- `provider`
- `launch_command`
- `runtime_status`
  - `starting`
  - `running`
  - `waiting`
  - `idle`
  - `interrupted`
  - `ended`
- `claude_session_id`
- `process_id`
- `process_group_leader`
- `last_output_seq`
- `last_event_seq`
- `created_at`
- `last_active_at`
- `ended_at`
- `recoverable`

职责：

- 表示持久 agent runtime 会话
- 不再把“当前页是否在线”当作该 runtime 是否存在的标准

### 6. `agent_runtime_events`

字段建议：

- `id`
- `agent_runtime_session_id`
- `seq`
- `kind`
  - `stdout`
  - `stderr`
  - `session_started`
  - `turn_waiting`
  - `tool_started`
  - `tool_finished`
  - `approval_required`
  - `turn_completed`
  - `session_ended`
  - `exit`
- `payload_json`
- `created_at`

职责：

- 持久化 lifecycle 事件和必要输出事件
- 用于断线补偿和新客户端 attach 后的状态恢复

### 7. `shell_runtime_sessions`

字段建议：

- `id`
- `workspace_runtime_id`
- `kind`
  - 第一版可固定为 `main`
- `cwd`
- `exec_target_json`
- `runtime_status`
  - `running`
  - `interrupted`
  - `ended`
- `process_id`
- `process_group_leader`
- `last_output_seq`
- `created_at`
- `last_active_at`
- `ended_at`
- `recoverable`

职责：

- 表示持久 shell 会话
- 替代当前临时 `terminal_id` 语义

### 8. `shell_runtime_chunks`

字段建议：

- `id`
- `shell_runtime_session_id`
- `seq`
- `chunk`
- `created_at`

职责：

- 持久化 shell 输出缓冲
- 支持 attach 后 replay

## 运行时管理职责

后端逻辑应整理为以下职责边界。

### Workspace Runtime Manager

负责：

- 创建 / 加载 / 关闭 `workspace runtime`
- attach / detach 客户端
- controller lease 续租
- takeover 请求、拒绝、超时接管
- `fencing_token` 检查
- 共享 `workbench_state` 更新和广播
- snapshot 生成
- replay 协调

### Agent Runtime Service

负责：

- 创建 / attach / detach 持久 agent runtime
- 底层进程管理
- lifecycle 事件记录
- 输出缓冲记录
- Claude `session_id` 持久化
- recoverable 状态判定

### Shell Runtime Service

负责：

- 创建 / attach / detach 持久 shell runtime
- 底层 shell 进程管理
- shell 输出缓冲记录
- shell replay
- recoverable 状态判定

## 连接与同步协议

### 首次 attach

客户端进入某个 `workspace runtime` 时，后端必须返回完整快照，而不是只依赖当前前端内存状态。

建议返回：

- `workspace_runtime_snapshot`
- `controller_state`
- `workbench_state`
- `agent_sessions_snapshot`
- `shell_sessions_snapshot`
- 每个活跃 runtime 最近输出缓冲
- 每个 runtime 当前 `last_seq`

### 增量事件

建议定义统一事件族：

- `controller.lease_updated`
- `controller.takeover_requested`
- `controller.takeover_rejected`
- `controller.transferred`
- `workbench.state_updated`
- `agent.output`
- `agent.lifecycle`
- `agent.status_changed`
- `shell.output`
- `shell.status_changed`
- `workspace.artifacts_dirty`

### 重连恢复

客户端重连时带上：

- `workspace_runtime_id`
- 各事件流 `last_seen_seq`
- `device_id`
- `client_id`

后端策略：

1. 能补增量就补增量
2. 发现 replay 缺口时，直接返回全量 snapshot
3. 恢复后再进入实时事件流

不能继续依赖“WS 重连后刷新一遍 workspace snapshot”这种弱语义。

## Agent 行为设计

### 持久语义

`agent session` 必须具备：

- 稳定 runtime id
- attach / detach
- 输出 replay
- lifecycle replay
- 当前状态快照

当前版本实现收口：

- 已落地的是 `stream`、`status`、`claude_session_id` 的持久化与 attach 后恢复
- 已落地最近 `agent://lifecycle` 历史的持久化与 attach snapshot replay
- 前端会按 replay 把 session 状态重新收敛到最近的 `waiting / running / idle` 阶段
- 当前 replay 是有界历史，不承诺无限生命周期日志保留

### 输出与事件

所有输出和生命周期事件都要赋予递增序号。

必须持久化的 lifecycle：

- `session_started`
- `turn_waiting`
- `tool_started`
- `tool_finished`
- `approval_required`
- `turn_completed`
- `session_ended`
- `exit`

原因：

- 这些事件不能只靠 WS 临时广播，否则断线时会丢关键状态
- 新客户端 attach 时必须能恢复“当前 agent 到底处于什么阶段”

### Claude 恢复语义

若底层 provider 是 Claude，则继续持久化 `claude_session_id`。

但恢复策略需要明确：

- 若 agent 仍在运行，则新客户端只需 attach
- 若 agent 因服务重启失去活动进程，但保留 `claude_session_id` 且判定为 `recoverable`，前端应展示“可恢复”状态，由 controller 决定是否恢复

默认不在用户无感知情况下自动继续执行任务。

当前版本实现收口：

- 服务存活期间，attach 会恢复最近 `stream`、`status` 和 `claude_session_id`
- 服务重启后，运行中的 session 会被显式标记为 `interrupted`
- 当前没有独立 runtime daemon，因此不会把旧 agent 进程静默声明为“仍可 attach”

## Shell 行为设计

### 持久语义

`shell` 不能再等同于当前页面里的 `terminal` 组件。

应改为：

- `workspace` 下有稳定的 `shell runtime session`
- 前端 attach 到 shell session，而不是创建即新开 shell
- 若已存在 `main shell`，新客户端优先 attach，而不是再创建

当前版本实现收口：

- 已落地的是 `workspace_terminals` 输出缓冲持久化与 attach snapshot 回放
- 当前 terminal 仍由本服务进程内存中的 PTY runtime 驱动，不是独立 daemon 化 shell runtime

### 输出 replay

shell 输出必须像 agent 一样具有：

- 递增 `seq`
- 持久缓冲
- attach 后 replay

至少支持：

- 页面刷新后恢复最近输出
- 新浏览器、新设备 attach 后看到当前 shell 最近上下文

当前版本实现收口：

- 以上 replay 保证成立的前提是后端服务仍然存活
- 服务重启后保留最近输出快照，但不会自动续接旧 shell 进程

### 写入规则

只有 controller 可以向 shell 写入数据。

所有 shell 输入必须带：

- `workspace_runtime_id`
- `shell_runtime_session_id`
- `fencing_token`

旧 token 直接拒绝。

当前版本实现收口：

- 正常 UI 路径下，只有 controller 能操作 shell
- 后端已对 `workspace / session / terminal / agent / git / file_save` 这批共享写入统一升级为 controller lease + `fencing_token` 强校验
- controller 控制面命令（`attach / heartbeat / takeover / reject_takeover`）仍按 `device_id + client_id` 身份语义裁定，不走 `fencing_token`

## 前端行为设计

### Controller 模式

controller 可以：

- 修改共享工作台状态
- 向 `agent` / `shell` 发输入
- 关闭和管理 runtime

但前端不直接把本地状态当真相，而是：

1. 发送意图到后端
2. 后端校验 lease + fencing token
3. 后端更新持久状态
4. 后端广播结果
5. 所有端基于广播收敛

当前版本实现收口：

- `workspace_view_state` 与 controller 事件已经以后端为真相源
- observer 只读门禁已落在前端入口层
- 后端已对 `workspace / session / terminal / agent / git / file_save` 共享写入统一做 lease + fencing 拒绝
- `git` / `file_save` 额外会校验 `workspace_id + path + target` 一致性，拒绝把别的路径伪装成当前 workspace 的写入
- `terminal_create` 也会校验 `cwd` 必须属于当前 `workspace_id` 对应的 workspace root

### Observer 模式

observer 必须严格只读。

前端应禁用以下入口：

- 切换 session
- 切换 pane
- 切换 terminal
- 修改文件预览状态
- archive / close session
- 关闭 workspace
- 发送 agent 输入
- 发送 shell 输入

observer 看到的是 controller 当前工作台状态，不允许本地维持偏离视图。

### 刷新与重开

controller 刷新或关闭重开后：

- 旧 WS 断开
- 后端应基于 WS disconnect 立即处理 controller lease
- 新页面带着 `device_id` 重新 attach
- 若原 controller 仍是当前有效租约，则恢复 controller 身份
- 新页面获取完整 snapshot + replay

用户感知应接近“页面重新连接到原工作台”，而不是“开了一个新的工作台实例”。

当前版本实现收口：

- 同一页面刷新会保留 `sessionStorage client_id`，因此可以直接续回 controller 身份
- 当旧 controller 仍在线时，新 tab、切换浏览器或换设备生成的新 `client_id` 会先以 observer 身份 attach
- 当旧 controller WS 下线时，后端会立即释放 lease；若此时已有 pending takeover，则直接把 controller 转给申请方
- 因此“关闭浏览器后还要等 lease 自然过期才能接回”的问题已消除；首个重新 attach 的 client 可以立即重新拿到 controller
- 页面 `pagehide` 还会额外发送一次 best-effort release，作为 WS disconnect 之外的补充兜底

## 后端重启恢复

本设计选择方案 3，因此后端不能把“服务重启 == 所有 runtime 语义丢失”当默认结论。

目标态要求：

1. `workspace runtime`
   - 可从持久层重建
2. `controller lease`
   - 可恢复为无 controller 或等待新 attach 重建
3. `workbench_state`
   - 可完整恢复
4. `agent runtime`
   - 若底层进程仍存在，应重新接入
   - 若底层进程不存在但具备 `recoverable` 条件，应恢复为“可恢复”状态
5. `shell runtime`
   - 若底层进程仍存在，应重新接入
   - 若不存在，则不能静默当作从未存在；必须明确状态为 `interrupted` 或 `unrecoverable`

实现上可以先在当前服务进程内完成协议和持久化，但对外语义必须按“持久会话服务”定义，不能把“内存 map 即 runtime 真相”继续暴露给上层。

当前版本实际保证：

1. refresh / 浏览器 / 设备 attach 能续上同一个 workspace snapshot，前提是后端服务持续存活
2. 后端重启后会恢复 workspace、view state、controller lease，以及按 `device_id` / `client_id` 作用域持久化的 app shell state 元数据
3. 后端重启后运行中的 agent session 会被显式标记为 `interrupted`
4. 后端重启后 terminal 输出快照仍保留，但所有 persisted terminal 会被标记为 `recoverable = false`
5. 现阶段不宣称旧 agent / shell 进程在后端重启后仍能被静默重新 attach
6. 后端启动时不会尝试扫描并重新接入旧 PTY / agent 进程；内存中的 `agents` / `terminals` runtime map 会从空开始
7. 若服务是快速重启，旧的 controller lease 记录会继续保留到过期或被后续 attach / takeover 流程覆盖；它不会在 boot 时被主动清空
8. Claude 场景下，`claude_session_id` 会保留，因此 controller 后续手动重新启动 agent 时可以走 `--resume`；但这不是对旧进程的透明 re-attach

## 错误模型

建议标准化这些错误：

### 控制权相关

- `controller_conflict`
- `controller_offline`
- `takeover_pending`
- `takeover_rejected`
- `stale_fencing_token`

### attach / replay 相关

- `workspace_runtime_not_found`
- `runtime_session_not_found`
- `replay_gap_requires_snapshot`
- `runtime_attach_failed`

### 运行时相关

- `agent_runtime_unrecoverable`
- `shell_runtime_unrecoverable`
- `runtime_write_denied`

### 前端处理原则

- `stale_fencing_token`
  - 立即刷新 controller 状态
  - 把本端 UI 降级为 observer
- `replay_gap_requires_snapshot`
  - 重新请求全量 snapshot
- `*_unrecoverable`
  - 明确显示错误和恢复入口
  - 不允许静默创建新 runtime 覆盖旧状态

## 一致性原则

系统目标态应遵守以下原则：

1. 后端是共享状态唯一真相源
2. 前端不能对共享状态做不可验证的 optimistic 真相写入
3. 所有共享态写入都必须通过 controller lease + fencing token 校验
4. 所有输出都必须有递增序号
5. 所有重连都遵循“先补状态，再进实时流”
6. 发现 replay 缺口时必须升级为全量 snapshot，而不是假装无事发生

## 观测与审计

为了排查续连、主控切换和状态错乱问题，建议记录以下日志 / 指标：

- workspace attach / detach
- controller lease 获取 / 续租 / 过期
- takeover 请求 / 拒绝 / 超时 / 接管成功
- runtime attach / replay / snapshot fallback
- `stale_fencing_token` 拒绝次数
- shell / agent 输出缓冲裁剪次数
- `recoverable` / `unrecoverable` runtime 数量

## 测试策略

### 后端单元测试

- controller lease 获取、续租、过期
- takeover 请求、拒绝、超时接管
- fencing token 拒绝旧写入
- snapshot / replay 回退
- agent lifecycle 序号递增
- shell output 序号递增

### 后端集成测试

- 一个 controller + 一个 observer attach 同一 workspace
- controller 刷新后自动续控
- observer 申请接管，controller 拒绝
- observer 申请接管，controller 超时
- agent attach 后恢复 lifecycle + stream
- shell attach 后恢复输出缓冲

### 前端集成测试

- observer UI 全部只读
- controller 切 session / pane / file preview，observer 同步变化
- 接管成功后旧 controller 被降级
- 刷新后恢复 controller 身份和共享工作台视图

### E2E 测试

- 单浏览器刷新续上
- 浏览器关闭后重开续上
- 双浏览器同步
- 双设备模拟同步
- 接管申请 `10` 秒超时成功
- 当前主控拒绝接管
- shell 长输出后新端 attach 重放
- agent 完成事件在多端一致可见

## 迁移策略

虽然目标态一次定义完整，但实现仍需分阶段落地，顺序建议如下：

### 阶段 1：协议与模型成型

- 引入 `workspace runtime`
- 引入 controller lease 和 fencing token
- 引入共享 `workbench_state`
- 让前端基于后端共享状态工作

### 阶段 2：Agent 持久运行时

- `agent` 从临时 WS 语义升级为持久 attach / replay 模式
- lifecycle 事件持久化
- `claude_session_id` 恢复语义标准化

### 阶段 3：Shell 持久运行时

- `shell` 从临时 terminal 模式升级为持久 `shell session`
- attach / replay 完整落地
- 消除刷新和换设备场景下 shell orphan 问题

### 阶段 4：重启恢复强化

- 明确 runtime manager 的恢复路径
- 标准化 `recoverable` / `unrecoverable`
- 为未来独立 runtime daemon 预留接口边界

## 风险

主要风险如下：

1. 当前前端大量逻辑默认认为本地状态可直接修改，迁移为后端真相源后需要系统性收敛
2. `shell` 的持久 attach / replay 是当前缺口最大处，改动会显著大于 `agent`
3. 后端若仍强耦合当前进程内存，方案 3 容易在实现上退化回方案 2
4. 若不尽早引入 fencing token，后续会长期残留双主控竞争问题

## 成功标准

当前版本（v0.2.4）已落地的成功标准：

- controller 刷新页面后，仍回到同一个 `workspace runtime`
- 新浏览器、新设备或新 client 进入时默认是 observer
- observer 能看到 controller 当前共享工作台上下文
- observer 接管时，controller 能收到提示
- controller 明确拒绝后，observer 不可强制接管
- controller 超时 `10` 秒或离线后，observer 自动接管成功
- controller WS 断开时，lease 会立即释放或立即转移给 pending takeover requester
- 后端会基于 controller lease + `fencing_token` 拒绝旧 controller 对 `workspace / session / terminal / agent / git / file_save` 的写入
- `shell` 输出能在 attach 后恢复最近上下文，前提是后端服务仍然存活
- `agent` 最近输出、状态和 `claude_session_id` 能在 attach 后恢复，前提是后端服务仍然存活
- `agent://lifecycle` 最近历史能在 attach snapshot 中 replay，并用于恢复 session 当前阶段
- 后端重启行为是显式的：running session 会变成 `interrupted`，persisted terminal 会变成 `recoverable = false`

目标态但当前尚未完全落地的项：

- `shell` 仍不是独立 daemon 化 runtime，服务重启后不能重新 attach 旧 PTY 进程
- 后端重启后对旧 agent / shell 进程的真正重新 attach

## 结论

这次改造的本质不是“修一下刷新重连”，而是把当前项目从“页面驱动的临时控制台”升级为“持久化远程工作台”。

若只做补丁式修复，`shell` 生命周期、跨设备续连、主控切换和状态一致性问题会继续反复出现。只有把：

- 共享工作台状态
- controller lease
- agent / shell 持久运行时
- replay 协议

统一为后端真相源，才能稳定满足刷新、换浏览器、关闭重开、换设备续上的目标。
