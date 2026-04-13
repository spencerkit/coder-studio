# Replace tmux With In-Process PTY + Ring Buffer

## Context

Coder Studio 当前的 session 终端链路依赖 `tmux` 作为持久运行层（见 `2026-04-08-terminal-gateway-final-architecture-design.md`）。tmux 在最初被选中是因为它能"独立于 server 进程保活会话"。在实际使用中暴露出两个结构性问题：

1. **滚动历史不可用**：tmux 控制 PTY 的 alternate screen 与 scrollback，xterm.js 的鼠标滚轮事件无法翻看 tmux 内的历史输出，用户必须进 tmux copy-mode 才能滚动，体验破裂。
2. **跨端依赖**：tmux 是 Unix-only 的外部系统组件，Windows 没有，部署/打包必须额外处理；socket / janitor / cleanup 在 `tmux.rs` 里堆出了 881 行专门的运维代码。

经过确认，Coder Studio 的部署模型**不要求** server 进程崩溃后任务继续存活——server 挂了，shell 也允许跟着挂。这意味着 tmux 唯一的独占价值（跨进程保活）在本项目里为零，它的全部成本都是纯负担。

本设计用**进程内 PTY + 环形缓冲 + attach 重放**替换 tmux，目标是同时解决滚动历史和跨端两个问题，并大幅简化运行时代码。

---

## Goals

- 移除 tmux 作为 session 终端链路的运行时依赖
- 让 xterm.js 的鼠标滚轮直接翻看历史，无需进入任何特殊模式
- 跨平台一致：Linux / macOS / Windows 均走同一条 `portable-pty` 抽象
- 前端断线重连 / 页面刷新后能看到任务的近期历史输出
- 删除 `tmux.rs`、tmux janitor、tmux socket 配置、`GatewayTerminalRuntime` 中的 tmux 字段
- 保持 `terminal_gateway` / `TerminalRuntime` 的对外抽象不变，迁移对调用方透明

## Non-goals

- 不要求 server 进程崩溃后任务继续运行（与项目部署模型一致）
- 不实现完整的会话日志落盘 / 长期回看（v1 仅内存 ring buffer）
- 不改动 provider adapter 的接口或 boot 流程
- 不改动 `xterm.js` 渲染层的实现，只影响其接收数据的协议
- 不动 workspace 独立终端的对外行为（它已经在用 `Pty` 路径）

---

## Current State

```
session_runtime.rs:368  create_tmux_runtime(...)        ← 唯一调用
session_runtime.rs:386  TerminalBridgeTarget::Tmux {...}
        │
        ▼
terminal.rs:554   Tmux 分支（attach pty + tmux pipe-pane）
terminal.rs:538   Pty  分支（直接 portable-pty PtyPair）   ← 已在 workspace 终端使用
        │
        ▼
TerminalRuntime { runtime_id, tmux_session_name, tmux_pane_id, ... }
```

关键事实：
- `TerminalBridgeTarget` 已经是双枚举，`Pty` 分支在 `terminal.rs:612` 一带由 workspace 独立终端在用，是**已验证模板**
- tmux 路径**只有一个上游调用点**（`session_runtime.rs:386`）
- `GatewayTerminalRuntime` 暴露的 `runtime_id` 是抽象 ID，外部 API 不依赖任何 tmux 概念
- `terminal.rs:84` 已有 UTF-8 边界裁剪先例（`floor_char_boundary`）
- `terminal.rs:25` 已有 `terminate_process_tree` 处理 process group 清理

---

## Architecture

```
xterm.js  ⇄  WS (terminal://channel_output, terminal_channel_input)
                              │
                              ▼
       Rust server: TerminalRuntime (in-process)
                              │
                              ├─ portable-pty PtyPair
                              │     ├─ writer (stdin)
                              │     └─ reader thread
                              │           └─ append → RingBuffer
                              │           └─ broadcast → WS subscribers
                              ├─ RingBuffer (≤2 MB, UTF-8 safe)
                              ├─ child process (shell → provider CLI)
                              └─ subscribers: Vec<WS handle>
```

每个 `TerminalRuntime` 是 server 进程内的一个对象，持有 PTY、ring buffer 和当前订阅者集合。它的生命周期跟 server 进程绑死。

### 三个核心行为

| 行为 | 说明 |
|------|------|
| **Attach** | 客户端建立 WS 订阅时，server 先发一条 `terminal://channel_replay` 把整个 ring buffer 一次性投递，再开始正常 `terminal://channel_output` 流式 |
| **Detach** | 客户端断开仅从 subscribers 列表里摘除，PTY / child / reader 线程继续，输出继续写 ring buffer |
| **Resize** | xterm.js 上报 cols/rows，server 调 `PtyPair.resize()`，新尺寸记录在 ring buffer 元数据里以便 attach 重放时一并下发 |

### Ring Buffer 设计

- **容量**：单 session **2 MB**（约 1 万–2 万行典型 ANSI 输出，覆盖绝大多数 agent 任务的近期历史）
- **结构**：`Mutex<String>`，到达容量时从前端裁剪
- **裁剪规则**：复用 `terminal.rs:84` 的 `floor_char_boundary` 模式，按 UTF-8 字符边界裁，避免半个多字节字符或截断的 ANSI 转义序列
- **不做的事**：v1 不做按行 chunk、不做 ANSI 状态机重建、不做落盘 journal。这些后续如果需要"完整历史回看"再加，不阻塞本次迁移
- **后果坦白**：超出 2 MB 的早期输出会丢。对 agent 交互场景（用户主要看最近几屏）这是可接受 trade-off

> **Trade-off 理由**：完整 ANSI 状态机重建（让重放后光标 / 颜色 / alternate screen 状态完全等价）成本很高且容易出错；按行裁剪需要解析字节流。直接按字节滚动 + 字符边界对齐，xterm.js 在 attach 时把整段 ANSI 序列完整跑一遍，最终视觉状态在绝大多数情况下与原始流一致。极端情况（缓冲区中间被截断的 alternate screen 进入序列）会有视觉残留，但用户清屏即可恢复，不影响任务本身。

### Replay 协议

**现状约束**：前端 `apps/web/src/services/terminal-channel/client.ts:147` 直接订阅 WS 广播事件 `terminal://channel_output`，没有显式的 attach 握手。要实现"重连先看到历史"必须新增一次显式请求/响应交互——server 不可能知道某个 WS 客户端关心哪个 runtime 的历史。

新增一个 attach 请求与一个 replay 响应事件：

**Client → Server 请求**（现有 `handle_terminal_channel_input` 同一入口风格，新增 type）：
```json
{
  "type": "terminal_channel_attach",
  "runtime_id": "runtime:<workspace_id>:<session_id>",
  "fencing_token": <number>
}
```

**Server → Client 响应**（新增事件，与 `emit_terminal_channel_output` 同风格）：
```rust
// ws/server.rs
pub(crate) fn emit_terminal_channel_replay(
    app: &AppHandle,
    runtime_id: &str,
    data: &str,
    cols: u16,
    rows: u16,
) {
    emit_transport_event(
        app,
        "terminal://channel_replay",
        json!({
            "runtime_id": runtime_id,
            "data": data,
            "cols": cols,
            "rows": rows,
        }),
    );
}
```

**协议保证**：
- Server 收到 `terminal_channel_attach` → 在 runtime 的 output buffer 锁内 clone 当前内容 + 当前 cols/rows → 调 `emit_terminal_channel_replay` 投递。
- 同一个 runtime 后续的 `channel_output` 由 reader 线程继续广播，与 replay 之间在锁内"克隆 + 释放"的瞬间切换；可能丢极小窗口的几个字节，对终端展示无影响（reader 线程持续追加 buffer，下一次 attach 自动包含）。
- 前端 attach 调用方：在 WS 连接建立 / 重连 / 切换 runtime 时主动发 `terminal_channel_attach`，收到 `channel_replay` 时先 `terminal.clear()` 再 `terminal.write(data)`，之后对 `channel_output` 正常追加。
- 多客户端同时 attach 同一 runtime：每次 attach 都独立产生一条 replay 事件；事件字段 `runtime_id` 让客户端按需过滤。
- 现有 `terminal://channel_output` 广播语义不变，未发送 attach 请求的客户端表现与今天一致。

### 进程组与清理

- child 通过 `setsid` 起新 process group（`portable-pty` 在 \*nix 默认即如此；Windows ConPTY 走自己的 job object）
- server 退出时遍历 `TerminalRuntimeRegistry`，对每个 runtime 走 `terminate_process_tree`（`terminal.rs:25` 已存在）
- runtime drop 路径同 PTY drop，reader 线程读到 EOF 自然退出

### 滚动历史的真正落点

迁移后，"看历史"的责任完全落在 xterm.js 自身的 scrollback 上：

- xterm.js 默认 scrollback 1000 行，可配置到几万行
- 鼠标滚轮 = 浏览器原生滚动 = 没人跟它抢
- ring buffer 只负责"重连后能看到早前内容"，不参与正常运行时滚动

---

## Migration Plan

走**一次性切换**，但在同一个 PR 里拆成两个 commit，留一个中间检查点：

### Commit 1: 给 Pty 分支加 ring buffer + replay

**改动范围**：`terminal.rs`、`ws/server.rs`、前端 xterm.js 接收逻辑

- `terminal.rs`：把 `TERMINAL_RUNTIME_OUTPUT_LIMIT` 从 `512 * 1024` 调到 `2 * 1024 * 1024`，复用现有 `output: Mutex<String>` 作为 ring buffer（避免双缓冲）；reader 线程的 `append_runtime_output` 路径不变
- `terminal.rs`：在 `TerminalRuntime` 上记录最近一次 `cols` / `rows`（resize 时更新），供 attach 响应使用
- `ws/server.rs` 新增 `emit_terminal_channel_replay`
- `ws/server.rs` 新增 `terminal_channel_attach` 入站消息分支：解析 `runtime_id` → 在 runtime 的 output 锁内 clone 内容 + cols/rows → `emit_terminal_channel_replay`
- 前端 `apps/web/src/services/terminal-channel/client.ts` 新增 `subscribeTerminalChannelReplay` + `sendTerminalChannelAttach`，xterm 展示层（workspace 终端使用方）在订阅 `channel_output` 之前调一次 attach；replay handler 行为：`terminal.clear()` → `terminal.write(data)`
- `tests/workspace-recovery.test.ts` 新增场景：刷新页面后通过 attach 拿到 ring buffer 内容

**完成后状态**：workspace 独立终端立即获得"刷新不丢历史"。session 终端仍走 tmux，未受影响。**这是中间可回滚检查点**。

### Commit 2: session_runtime 切到 Pty，删 tmux

**改动范围**：`session_runtime.rs`、`terminal_gateway.rs`、`terminal.rs`、删 `tmux.rs`

- `session_runtime.rs:368-411`：删除 `create_tmux_runtime` 调用，`TerminalBridgeTarget::Tmux {...}` 改为 `TerminalBridgeTarget::Pty { cwd, target, cols, rows }`，`shell_env` 通过 `TerminalCreateOptions.env` 传入
- provider boot command 走 PTY stdin（已经是 `boot_input` → `terminal_write` 的现有路径，无需新增）
- `GatewayTerminalRuntime`：删除 `tmux_session_name` 和 `tmux_pane_id` 字段，删除构造参数，更新 `terminal_gateway.rs` 测试
- `terminal.rs`：删除 `TerminalBridgeTarget::Tmux` 变体、`TerminalIo::TmuxAttached` 变体、`terminal.rs:554` 的 Tmux 分支、相关 `send_tmux_raw_input` 调用
- `terminal_gateway.rs::send_input`：从 `crate::services::tmux::send_tmux_raw_input` 改为直接 PTY 写入（通过现有 `terminal_write` 路径）
- 删除文件：`apps/server/src/services/tmux.rs`
- `services/mod.rs`：移除 `pub mod tmux`
- `main.rs`：移除 tmux janitor 启动、`configure_tmux_socket_path`、`CODER_STUDIO_TMUX_*` 环境变量解析
- `workspace_runtime.rs` / `workspace.rs`：grep `tmux` 清理残留引用
- `tests/workspace-recovery.test.ts`：调整断言，去掉对 tmux session 存在性的检查

**完成后状态**：tmux 完全离开运行时，`tmux.rs` 不存在，二进制不再调用任何外部 `tmux` 命令。

### 不做的迁移辅助

- **不加 feature flag**：tmux 与 PTY 双轨成本 > 收益（GatewayTerminalRuntime 字段要变 `Option`、janitor 还要继续维护、测试矩阵 ×2、心智负担 ×2）。一次性切换 + commit 拆分已经提供回滚点
- **不保留 tmux 兼容字段**：`tmux_session_name` / `tmux_pane_id` 是内部字段，没有外部消费者，没有兼容性顾虑

---

## Testing Plan

### 单元测试（Rust）

- `terminal.rs`：ring buffer 容量到上限后裁剪正确、UTF-8 边界对齐、超长 ANSI 序列不被切坏
- `terminal_gateway.rs`：`send_input` 走 PTY 路径后仍正确触发 `sync_session_runtime_state`（已有测试 `send_input_marks_bound_session_running` 需要更新断言去除 tmux 字段）
- `session_runtime.rs`：start → reader 线程产出 → ring buffer 累积 → 模拟 attach 拿到完整 replay
- 新增：reader 线程在 child 退出后写入 EOF 标记不导致 panic
- 新增：runtime drop 时 process group 被清理（复用 `terminate_process_tree` 的现有覆盖）

### 集成测试

- `tests/workspace-recovery.test.ts`：
  - 启动 session → 跑一段输出 → 模拟前端断开 → 重新 attach → 断言 replay 包含先前输出
  - 容量超出 2 MB → 断言裁剪发生在 UTF-8 边界
  - 删除原本依赖 tmux session 存在性的断言

### 手动验收

- macOS：起 claude session、跑一个长输出任务、刷新页面、确认看到历史 + 鼠标滚轮可滚
- Linux：同上
- Windows：起 claude session、确认 ConPTY 路径工作、滚动正常
- 鼠标滚轮在 xterm.js 视区内向上滚 → 直接进入 scrollback，无 tmux copy-mode 提示

---

## Risks & Open Questions

### 已识别风险

1. **Ring buffer 中段被裁的 ANSI 序列**：如上文 trade-off 段所述，极端情况下 attach 后可能有视觉残留，用户清屏可恢复。可接受。
2. **2 MB 是否够用**：对 claude / codex 这类 agent，2 MB ≈ 几小时的常规交互。若实际使用中反馈不够，调大到 4 MB 不需要架构改动。
3. **Provider boot command 时序**：tmux 路径下 boot command 通过 `tmux send-keys` 注入，PTY 路径下走 `terminal_write` → PTY stdin。两条路径在 `boot_input` 抽象后理论上等价，但需要在 commit 2 验收时确认 dash-prefixed 输入（`d6b9561`）等历史 fix 仍然生效。
4. **Windows 首次启用**：仓库历史里 PTY 路径有没有真正在 Windows 上跑过未知。`portable-pty` 的 ConPTY 后端是成熟实现，但首次接触可能踩坑。**建议在 commit 1 完成后做一次 Windows 手动验收**，避免 commit 2 同时引入新平台 + 新链路两个变量。

### Open Questions

无。两个由作者裁定的细节（buffer 大小 = 2 MB；replay 协议 = 单条 `terminal://channel_replay` 在订阅首条投递）已在上文锁定。

---

## Out of Scope / Future Work

- 完整会话日志落盘 + 按需拉取（"完整历史"而非"近期 2 MB"）
- 跨 server 重启的会话恢复（与项目当前部署模型不一致，明确非目标）
- ANSI 状态机重建以达成 100% 视觉等价的 replay
- 多客户端同时 attach 同一 session 的输入冲突仲裁（当前架构允许，但不在本次重点）
