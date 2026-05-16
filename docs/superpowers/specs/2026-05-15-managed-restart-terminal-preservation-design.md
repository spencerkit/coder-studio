# Managed Restart Terminal Preservation Design

> Date: 2026-05-15
> Status: Draft for review
> Scope: Make explicit `--restart` preserve active terminals and agent sessions long enough for the next server instance to reattach, while keeping `stop` and crash semantics unchanged

## 1. Overview

当前 `coder-studio serve --restart` / `coder-studio open --restart` 的行为与普通停止没有本质区别：CLI 会先删掉旧 managed server，旧 server 停机时会执行 `terminalMgr.shutdown()`，从而对所有 PTY 发送 `SIGTERM` 并清掉内存中的 ring buffer / snapshot。结果是：

- 不能在 Coder Studio 自己的终端里直接执行 Coder Studio 的主动重启
- shell terminal 会被一起杀掉
- agent session 会因为底层 terminal 消失而在新 server 启动后被 hydrate 为 `ended`

本设计的目标不是改变“服务停止会关闭所有进程”这一默认语义，而是只为显式 `--restart` 增加一个受控例外：让 terminal 和 agent session 在一个很短的重启窗口里暂存，等待新 server 实例接管；如果新实例没有在窗口内完成接管，仍然按“关闭所有进程”收尾。

## 2. Goals

- 只在显式 `--restart` 路径下保留 active shell terminal 和 agent session 对应的 PTY
- 允许用户在 Coder Studio 自己的终端里触发 managed restart，而不把当前终端先杀掉
- 让新 server 启动后恢复同一个 `terminalId` / `sessionId`，而不是新建新的 terminal / session
- 复用现有 websocket 自动重连、`terminal.replay` 和 `terminal.snapshot` 恢复能力
- 确保重启失败时不会留下无限期悬挂的孤儿 PTY

## 3. Non-Goals

- 不改变 `stop` 的当前语义；主动 stop 仍然关闭所有 PTY 和会话
- 不改变进程崩溃、PM2 异常退出、机器重启时的默认行为；这些情况仍然应最终关闭 PTY
- 不实现跨主机或跨机器的会话迁移
- 不保证操作系统重启后的 session 恢复
- 不把 tmux / screen 作为用户可见的新运行时依赖

## 4. Current Behavior

### 4.1 CLI restart path

`startManagedServer()` 在启动新 managed server 之前，会先删除旧 managed server。这个流程与主动 stop 的效果相同，都会先让旧 server 退出。

### 4.2 Server shutdown path

旧 server 退出时会调用 `terminalMgr.shutdown()`。该逻辑会对所有还活着的 terminal 发送 `SIGTERM`，然后立即释放本地 terminal 状态和 snapshot buffer。

### 4.3 Session hydrate path

新 server 启动后，`SessionManager.hydrate()` 只会保留仍然能在 `terminalMgr` 内存里找到、并且 `alive === true` 的 terminal。只要 terminal 不在内存里，原先 `running` / `idle` 的 session 最终都会被收敛成 `ended`。

### 4.4 Frontend recovery baseline

前端已经具备 websocket 自动重连，以及 `terminal.replay` / `terminal.snapshot` 的恢复机制。也就是说，真正缺失的不是浏览器端重连，而是“server 重启期间 terminal 生命周期能否延续到下一实例”。

## 5. Constraints

- 旧 server 进程退出后，当前 `TerminalManager` 持有的 PTY 句柄无法直接被新 server 进程继承
- 仅仅在 `--restart` 时跳过 `terminalMgr.shutdown()` 并不能解决问题，因为新 server 没有办法接回旧进程内存里的 PTY 对象
- 只有显式 `--restart` 才能触发保留；普通 stop 或 crash 不能因为“终端还活着”而改变原有关闭语义
- 重启窗口必须是有限时长；失败重启不能演变成永久保活
- 现有 `session.state` 不能只靠“terminal 还活着”来推断，agent session 在 server 离线窗口里的输出仍然可能改变 `running` / `idle` 状态

## 6. Options Considered

### 6.1 Option A: Skip `terminalMgr.shutdown()` only for `--restart`

这个方案最小，但不可行。问题不在于“是否 kill”，而在于 PTY 对象当前完全属于旧 server 进程。一旦旧进程退出，新进程接不回这些 PTY，也接不回 ring buffer 与 snapshot。

### 6.2 Option B: Host terminals inside tmux / screen

这个方案可以快速验证“terminal 重启后仍然存在”的体验，但语义不符合本需求。tmux 更接近“即便 server crash 也继续保活”，而本需求要求只有显式 `--restart` 例外，其余 stop / crash 仍然关闭。它还会把 session 状态同步和 terminal 历史恢复复杂度转嫁给外部工具。

### 6.3 Option C: Introduce a dedicated PTY broker plus explicit restart intent

推荐方案。把 PTY 生命周期从 server 进程中拆出来，由独立 broker 持有 PTY、ring buffer 和 snapshot。旧 server 只在显式 `--restart` 时把 terminal 从“attached”转换到短时“preserved”，新 server 在 TTL 内重新 claim；普通 stop 和 crash 仍然由 broker 负责收尾并 kill PTY。

## 7. Chosen Design

采用 `restart intent + PTY broker + lease/TTL` 模型。

核心原则：

- PTY 的真实生命周期不再由 `TerminalManager` 进程内对象决定，而由 broker 决定
- “保留 terminal” 不再等价于“旧 server 不 kill”，而等价于“旧 server 把 terminal lease 交给 broker 的短时 preserved 状态”
- broker 在 owner 断开连接时默认 kill PTY；只有存在有效 preserve lease 时才短时保留
- 新 server 必须在 listen 之前先完成 terminal reattach / hydrate，这样前端 websocket 恢复后看到的仍是同一组 terminal 和 session

## 8. Architecture

### 8.1 Restart intent

CLI 在显式 `--restart` 路径下，先写一个本地 `restart-intent` 文件，再停止旧 server、启动新 server。

推荐字段：

- `requestId`
- `expectedServerInstanceId`
- `createdAt`
- `expiresAt`
- `mode: "preserve_terminals"`

约束：

- 只有 `--restart` 写 intent；普通 `stop` 不写
- intent 必须绑定旧 server 的 `serverInstanceId`，防止陈旧 intent 让后续无关退出误入 preserve 路径
- intent 过期后无效；broker 和 server 都不得接受过期 intent

### 8.2 PTY broker

新增独立本地 broker 进程，负责持有：

- PTY 进程本身
- terminal 元数据：`terminalId`、`workspaceId`、`kind`、`argv`、`cwd`、`cols`、`rows`、`title`
- ring buffer
- headless snapshot buffer
- 序列号与 `lastOutputAt`
- 当前 lease 状态

broker 仅提供本机 IPC，不开放远程网络访问。实现层可按平台封装为：

- POSIX：Unix domain socket
- Windows：named pipe

Server 通过 broker client 与其通信；`TerminalManager` 从“直接拥有 PTY”改为“对 broker 的本地适配层”。

### 8.3 Terminal lease state machine

每个 terminal 都处于以下状态之一：

- `attached`
  归某个 `serverInstanceId` 所有；正常收发 output、write、resize、replay、snapshot
- `preserved`
  仅在显式 `--restart` 触发；旧 owner 已退出或即将退出，terminal 保留到 `expiresAt`
- `ended`
  PTY 已退出或被 broker 杀掉

状态迁移规则：

- `attached -> preserved`
  只有旧 server 在看到匹配自己的有效 restart intent 后，显式调用 `detachForRestart(requestId, ttlMs)` 才允许发生
- `attached -> ended`
  主动 stop、terminal.close、workspace teardown、owner crash 且无有效 preserve lease 时进入
- `preserved -> attached`
  新 server 在 TTL 内用同一个 `requestId` claim 成功
- `preserved -> ended`
  TTL 到期、claim 失败清理、或 broker 检测到 terminal 本身已退出

### 8.4 Owner crash semantics

这是本设计最重要的边界之一。

broker 必须维护 owner 连接或 heartbeat。当 owner server 断开时：

- 如果 terminal 仍是普通 `attached`，broker 立即 kill PTY
- 只有 terminal 已经被显式切到 `preserved`，broker 才允许它继续活到 `expiresAt`

这保证：

- 主动 `stop` 保持现状
- 非预期 crash 保持现状
- 只有显式 `--restart` 才有例外

### 8.5 TerminalManager responsibilities after refactor

`TerminalManager` 不再直接 `spawn()` 本地 PTY。它改为：

- `create(spec)` 时请求 broker 创建 terminal
- 订阅 broker 输出事件并继续向 event bus 发 `terminal.output`
- 通过 broker 执行 `write` / `resize` / `close` / `replay` / `snapshot`
- 在 server 启动时从 broker `hydrateAttached()` / `claimPreserved()` 恢复 active terminals
- 在普通 stop 时调用 broker close-all
- 在 restart-preserve stop 时调用 broker detach-for-restart，而不是 close-all

### 8.6 SessionManager recovery model

仅仅把 terminal 接回来还不够，因为 agent session 在 server 离线期间可能继续输出，状态可能从 `running` 变成 `idle`。

因此，新 server 在 claim 完 terminal 后，`SessionManager.hydrate()` 需要分两类处理：

- `shell terminal`
  只要求 terminal 仍然存活，前端恢复后可继续交互
- `agent session`
  除了判断 terminal 是否存活，还必须恢复 PTY state detector 的上下文

推荐做法：

- broker 为每个 terminal 记录 `lastOutputAt` 和一段最近输出 tail
- 新 server 为 hydrated agent session 重新创建 `PtyStateDetector`
- 如果 session 原状态是 `running` / `starting`，则向 detector 回放 preserve 窗口内的输出或 recent tail
- 如果窗口内无新输出，且 `now - lastOutputAt` 已超过 provider 的 `idleDebounceMs`，则可直接把 session 纠正为 `idle`
- 如果 terminal 在 preserve 窗口内自然退出，则 session 仍按现有语义转为 `ended`

这一步的目标不是完美重放所有历史，而是保证 server 重启不会让一个已经闲置的 agent session 永久卡在 `running`。

## 9. Lifecycle

### 9.1 Normal stop

1. CLI 执行 stop，不写 restart intent
2. server 收到终止信号
3. `TerminalManager` 走普通 shutdown 路径
4. broker 关闭并 kill 所有 attached terminals
5. session 按现有规则结束

### 9.2 Explicit `--restart`

1. CLI 读取当前 runtime，写入带 `expectedServerInstanceId` 的 restart intent
2. CLI 停掉旧 managed server
3. 旧 server 收到终止信号，检测到与自己匹配的有效 intent
4. `TerminalManager` 不执行普通 shutdown，而是对 active terminals 调用 `detachForRestart(requestId, ttlMs)`
5. broker 把 terminals 标记为 `preserved`
6. 新 server 启动，连接 broker，并用 `requestId` claim preserved terminals
7. 新 server 先 hydrate terminals，再 hydrate sessions，最后开始监听 HTTP / WS
8. CLI 观察到新 runtime 就绪后清理 restart intent

### 9.3 Restart failure

1. CLI 已写 intent，旧 server 已 detach terminals
2. 新 server 未在 TTL 内成功启动并 claim
3. broker 在 `expiresAt` 后 kill preserved terminals
4. 结果退化为“重启失败即关闭 terminal / session”

### 9.4 Unexpected crash

1. server 进程崩溃，没有机会执行 `detachForRestart()`
2. broker 发现 owner 断开，terminal 仍为 `attached`
3. broker 立即 kill terminals
4. 行为与当前 crash 语义一致

## 10. Data and API Surface

### 10.1 Broker API surface

最小需要的 broker 操作包括：

- `createTerminal(spec, ownerServerInstanceId)`
- `attachTerminal(terminalId, ownerServerInstanceId)`
- `claimPreservedTerminals(requestId, newServerInstanceId)`
- `detachForRestart(ownerServerInstanceId, requestId, ttlMs)`
- `write(terminalId, bytes)`
- `resize(terminalId, cols, rows)`
- `replay(terminalId, lastSeq)`
- `snapshot(terminalId)`
- `close(terminalId)`
- `closeAllForOwner(serverInstanceId)`
- `subscribeOutput(ownerServerInstanceId)`

### 10.2 Persistence expectations

不要求把 broker 的 terminal 状态写入数据库。broker 是短生命周期的本地运行时组件，不是持久化存储层。

数据库仍然是：

- terminal / session 身份的持久化来源
- workspace 与 session 关联关系的持久化来源

broker 提供的是跨 server 进程重启窗口的“运行时延续”，不是长期持久化。

## 11. Frontend Impact

前端改动应尽量小。

因为 websocket client 已经具备：

- 自动重连
- reconnect 状态追踪
- replay / snapshot 恢复

所以关键要求是：新 server 必须在对外 accept websocket 之前先完成 terminal/session hydrate。只要这点成立，前端通常不需要新增专门的“restart preserve”协议。

可选增强：

- 在 terminal 恢复期间维持现有 reconnect UI，不新增“session ended”误导文案
- 若个别 terminal 在 claim 前短暂返回 `unknown`，前端可继续使用现有 reconnect/backoff 机制等待下一次恢复

## 12. Risks

### 12.1 Broker complexity

这会引入新的本地守护进程和 IPC 层，复杂度高于单进程 terminal manager。但不这样拆，就无法满足“旧 server 退出后，新 server 接回同一 PTY”的硬约束。

### 12.2 Session state drift

agent session 在 server 离线窗口里继续输出，会让 `running` / `idle` 状态恢复变复杂。如果不补 detector catch-up，terminal 看似保住了，但 session 状态会长期错误。

### 12.3 Stale intent or stale preserved terminals

必须用 `expectedServerInstanceId + requestId + expiresAt` 三重约束，避免陈旧 intent 误命中；broker 也必须在 TTL 到期后强制 kill preserved terminals，不能让它们无限存活。

## 13. Testing Strategy

### 13.1 Broker unit tests

- attached terminal 在 owner crash 时立即被 kill
- preserved terminal 在 TTL 内不会被 kill
- preserved terminal 在 TTL 到期后被 kill
- stale / mismatched intent 无法触发 preserve

### 13.2 Server integration tests

- `stop` 仍然结束 shell terminal 和 agent session
- `--restart` 可让 shell terminal 在新 server 启动后继续 write / replay / snapshot
- `--restart` 可让 hydrated session 保持原 `sessionId` / `terminalId`
- running agent session 在重启窗口结束后可被纠正回 `idle` 或 `ended`
- restart 失败时，preserved terminal 会在 TTL 后被清理

### 13.3 Web recovery tests

- websocket reconnect 后，terminal panel 对 preserved terminal 不显示 ended 状态
- reconnect 恢复仍走现有 replay / snapshot 流程
- preserved terminal claim 失败时，前端最终表现为正常断开，而不是假恢复

## 14. Rollout Plan

建议分两阶段落地：

### Phase 1: Shell-first preservation

- 引入 broker、restart intent、lease/TTL
- 先让 shell terminal 在 `--restart` 后可继续存活和恢复
- 验证 stop/crash 语义未变

### Phase 2: Agent session state recovery

- 补齐 `PtyStateDetector` 的 restart catch-up 逻辑
- 让 preserved agent session 在新 server 启动后恢复正确的 `running` / `idle` / `ended` 状态

分阶段的原因是：shell continuity 解决的是“能不能在自己的终端里重启自己”，而 agent session state recovery 解决的是“恢复后状态是否仍然正确”。两者相关，但风险和验证面不同。

## 15. Final Decision

本设计明确采纳以下产品语义：

- 只有显式 `--restart` 会临时保留 terminals / sessions
- 主动 `stop` 仍然关闭所有进程
- 非预期 crash 仍然关闭所有进程
- `--restart` 失败时，TTL 到期后也仍然关闭所有进程

换句话说，本次不是把 Coder Studio 改造成“terminal 永久托管器”，而只是给 managed restart 增加一个严格受控、自动回收的短时保留窗口。
