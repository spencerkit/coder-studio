# Replace tmux With In-Process PTY + Ring Buffer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 session 终端运行时从 `tmux` 替换为 server 进程内的 `portable-pty` + 环形缓冲 + attach replay，解决滚动历史和跨端依赖两个问题，并删除整个 `tmux.rs`。

**Architecture:** 复用 `terminal.rs` 中已存在的 `TerminalBridgeTarget::Pty` 路径作为统一终端运行时载体；扩大现有 `output: Mutex<String>` 缓冲到 2 MB 作为 ring buffer；新增 `terminal_channel_attach` WS 入站请求和 `terminal://channel_replay` 出站事件；session_runtime 切到 Pty 桥并通过现有 `terminal_write` 注入 boot command；删 `tmux.rs` 及其在 `main.rs`、`session_runtime.rs`、`terminal.rs`、`terminal_gateway.rs` 的所有调用。

**Tech Stack:** Rust（`portable-pty`、`tokio`、`tauri`）+ TypeScript（React、xterm.js）+ Vitest 集成测试。

**Spec:** `docs/superpowers/specs/2026-04-11-replace-tmux-with-inproc-pty-design.md`

---

## File Structure

### 修改

- `apps/server/src/services/terminal.rs` —— 调大 ring buffer 上限；在 `TerminalRuntime` 上记录 `cols` / `rows`；删除 `TerminalBridgeTarget::Tmux` / `TerminalIo::TmuxAttached` / `create_tmux_terminal_runtime`；`terminal_resize` 更新记录的 cols/rows
- `apps/server/src/services/session_runtime.rs` —— 启动会话改用 `TerminalBridgeTarget::Pty`；boot command 走 `terminal_write` 注入；删除 `create_tmux_runtime` / `kill_tmux_session` / `send_tmux_input` / `build_tmux_boot_command` 的调用与函数本身
- `apps/server/src/services/terminal_gateway.rs` —— `GatewayTerminalRuntime` 删除 `tmux_session_name` 与 `tmux_pane_id`，新增 `terminal_id: u64`；`send_input` 改为查 `terminal_id` 后调用 `terminal_write`
- `apps/server/src/ws/protocol.rs` —— `WsClientEnvelope` 新增 `TerminalChannelAttach` 变体
- `apps/server/src/ws/server.rs` —— 新增 `handle_terminal_channel_attach` + dispatch；新增 `emit_terminal_channel_replay`
- `apps/server/src/services/mod.rs` —— 移除 `pub mod tmux`
- `apps/server/src/main.rs` —— 移除 tmux janitor 启动、`configure_tmux_socket_path` 调用、`CODER_STUDIO_TMUX_*` env 解析
- `apps/server/src/services/workspace_runtime.rs` / `workspace.rs` —— 清除 `tmux` 残留引用
- `apps/web/src/services/terminal-channel/client.ts` —— 新增 `sendTerminalChannelAttach` 与 `subscribeTerminalChannelReplay`
- `apps/web/src/types/app.ts` —— 新增 `TerminalChannelReplayEvent` 类型
- `apps/web/src/features/workspace/workspace-sync-hooks.ts` —— 在订阅 `channel_output` 旁挂 `channel_replay` 处理；在 ws 连接 / 重连和 runtime 绑定时主动发 attach
- `tests/workspace-recovery.test.ts` —— 新增 attach replay 场景；删除/调整 tmux 断言

### 删除

- `apps/server/src/services/tmux.rs`

### 不动

- `xterm.js` 渲染层组件（仅消费已 `terminal.write()` 的字节）
- provider adapter 接口

---

## Commit 1 — Ring Buffer + Replay on Pty Path

完成 commit 1 后，workspace 独立终端获得"刷新不丢历史"。Session 终端仍走 tmux，未受影响，是可回滚检查点。

---

### Task 1: 扩大 TERMINAL_RUNTIME_OUTPUT_LIMIT 到 2 MB 并验证 UTF-8 边界裁剪

**Files:**
- Modify: `apps/server/src/services/terminal.rs:8`（常量）+ `apps/server/src/services/terminal.rs:77-86`（裁剪函数）
- Test: `apps/server/src/services/terminal.rs`（同文件 `#[cfg(test)] mod tests`，若不存在则在文件末尾新建）

- [ ] **Step 1: 写一个失败测试 — UTF-8 边界裁剪在新上限下仍正确**

在 `apps/server/src/services/terminal.rs` 文件末尾的测试模块（不存在则新建）追加：

```rust
#[cfg(test)]
mod ring_buffer_tests {
    use super::*;

    #[test]
    fn truncate_terminal_output_keeps_utf8_boundary_at_2mb_limit() {
        // 构造一段 > 2 MB 的字符串，每个字符 3 字节（中文）
        // 末尾刚好使裁剪点落在多字节字符中段
        let one_chunk = "中".repeat(1024); // 3 KB
        let mut buffer = one_chunk.repeat(800); // ~2.4 MB
        let initial_len = buffer.len();
        assert!(initial_len > TERMINAL_RUNTIME_OUTPUT_LIMIT);

        truncate_terminal_output(&mut buffer);

        assert!(buffer.len() <= TERMINAL_RUNTIME_OUTPUT_LIMIT);
        // 关键断言：裁剪后仍是合法 UTF-8（如果切坏了多字节字符，is_char_boundary(0) 仍 true，
        // 但内容会包含 replacement char 或解析失败；这里直接确认整段可被 from_utf8 解析）
        assert!(std::str::from_utf8(buffer.as_bytes()).is_ok());
    }

    #[test]
    fn truncate_terminal_output_2mb_limit_value() {
        assert_eq!(TERMINAL_RUNTIME_OUTPUT_LIMIT, 2 * 1024 * 1024);
    }
}
```

- [ ] **Step 2: 跑测试，确认按预期失败**

```bash
cd apps/server && cargo test --lib services::terminal::ring_buffer_tests -- --nocapture
```

预期：`truncate_terminal_output_2mb_limit_value` FAIL（当前值为 `512 * 1024`）。

- [ ] **Step 3: 调整常量**

修改 `apps/server/src/services/terminal.rs:8`：

```rust
const TERMINAL_RUNTIME_OUTPUT_LIMIT: usize = 2 * 1024 * 1024;
```

- [ ] **Step 4: 跑测试，确认通过**

```bash
cd apps/server && cargo test --lib services::terminal::ring_buffer_tests
```

预期：两个测试均 PASS。

- [ ] **Step 5: 跑全量 server 单测确认无回归**

```bash
cd apps/server && cargo test --lib
```

预期：全部通过。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/terminal.rs
git commit -m "feat(terminal): grow ring buffer to 2 MB for replay"
```

---

### Task 2: 在 TerminalRuntime 上记录 cols/rows 并随 resize 更新

**Files:**
- Modify: `apps/server/src/app.rs`（`TerminalRuntime` 结构体）
- Modify: `apps/server/src/services/terminal.rs`（`create_pty_terminal_runtime`、`terminal_resize`）
- Test: `apps/server/src/services/terminal.rs`

> 先确认 `TerminalRuntime` 结构体的实际定义位置：`grep -rn "struct TerminalRuntime" apps/server/src/` —— 通常在 `apps/server/src/app.rs`。如不在该文件，按 grep 结果调整路径。

- [ ] **Step 1: 写一个失败测试 — TerminalRuntime 创建后 cols/rows 反映传入参数**

在 `apps/server/src/services/terminal.rs` 末尾测试模块追加：

```rust
#[test]
fn pty_runtime_records_initial_cols_and_rows() {
    use crate::runtime::RuntimeHandle;
    use std::time::Duration;

    let (app, _shutdown_rx) = RuntimeHandle::new();
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    crate::init_db(&conn).unwrap();
    *app.state().db.lock().unwrap() = Some(conn);

    let info = create_terminal_runtime(
        "ws-1",
        "/tmp",
        &ExecTarget::Native,
        Some(80),
        Some(24),
        TerminalCreateOptions {
            persist_workspace_terminal: false,
            env: BTreeMap::new(),
            launch_command: TerminalLaunchCommand::DefaultShell,
            bridge_target: TerminalBridgeTarget::Pty {
                cwd: "/tmp".to_string(),
                target: ExecTarget::Native,
                cols: Some(80),
                rows: Some(24),
            },
        },
        &app,
        app.state(),
    )
    .expect("create terminal");

    let key = terminal_key("ws-1", info.id);
    let runtime = app
        .state()
        .terminals
        .lock()
        .unwrap()
        .get(&key)
        .cloned()
        .expect("runtime exists");

    let (cols, rows) = *runtime.size.lock().unwrap();
    assert_eq!(cols, 80);
    assert_eq!(rows, 24);

    // tear down to avoid leaking PTY across tests
    let _ = terminate_terminal_runtime(runtime);
    std::thread::sleep(Duration::from_millis(50));
}
```

- [ ] **Step 2: 跑测试，确认编译失败**

```bash
cd apps/server && cargo test --lib services::terminal::ring_buffer_tests::pty_runtime_records_initial_cols_and_rows
```

预期：编译失败 —— `runtime.size` 字段不存在。

- [ ] **Step 3: 在 TerminalRuntime 结构体上加 size 字段**

定位 `TerminalRuntime` 结构体定义（`grep -rn "struct TerminalRuntime" apps/server/src/`），追加：

```rust
pub(crate) struct TerminalRuntime {
    // ...existing fields...
    pub(crate) size: Mutex<(u16, u16)>, // (cols, rows)
}
```

- [ ] **Step 4: 在 `create_pty_terminal_runtime` 中初始化 size**

在 `apps/server/src/services/terminal.rs:236-247` 的 `Arc::new(TerminalRuntime { ... })` 块里追加：

```rust
size: Mutex::new((
    cols.filter(|v| *v > 0).unwrap_or(DEFAULT_PTY_COLS),
    rows.filter(|v| *v > 0).unwrap_or(DEFAULT_PTY_ROWS),
)),
```

如果存在 `create_tmux_terminal_runtime`（`apps/server/src/services/terminal.rs:361`），同样追加（commit 2 会一起删除）：

```rust
size: Mutex::new((
    cols.filter(|v| *v > 0).unwrap_or(DEFAULT_PTY_COLS),
    rows.filter(|v| *v > 0).unwrap_or(DEFAULT_PTY_ROWS),
)),
```

- [ ] **Step 5: 让 `terminal_resize` 同步更新 size**

定位 `terminal_resize` 函数（`grep -n "fn terminal_resize" apps/server/src/services/terminal.rs`），在调 `master.resize(...)` 成功后追加：

```rust
if let Ok(mut size) = runtime.size.lock() {
    *size = (cols, rows);
}
```

- [ ] **Step 6: 跑测试**

```bash
cd apps/server && cargo test --lib services::terminal
```

预期：新测试 PASS，其他测试不受影响。

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/app.rs apps/server/src/services/terminal.rs
git commit -m "feat(terminal): track cols/rows on TerminalRuntime for replay metadata"
```

---

### Task 3: 在 ws/protocol.rs 新增 TerminalChannelAttach 入站消息

**Files:**
- Modify: `apps/server/src/ws/protocol.rs`

- [ ] **Step 1: 写一个失败测试 — 解析 attach 消息**

在 `apps/server/src/ws/server.rs` 的 `#[cfg(test)] mod tests` 末尾追加：

```rust
#[test]
fn ws_client_envelope_parses_terminal_channel_attach() {
    let raw = serde_json::json!({
        "type": "terminal_channel_attach",
        "workspace_id": "ws-1",
        "fencing_token": 1,
        "runtime_id": "runtime:ws-1:session-1",
    });
    let envelope: WsClientEnvelope = serde_json::from_value(raw).unwrap();
    match envelope {
        WsClientEnvelope::TerminalChannelAttach {
            workspace_id,
            fencing_token,
            runtime_id,
        } => {
            assert_eq!(workspace_id, "ws-1");
            assert_eq!(fencing_token, 1);
            assert_eq!(runtime_id, "runtime:ws-1:session-1");
        }
        _ => panic!("unexpected variant"),
    }
}
```

- [ ] **Step 2: 跑测试，确认编译失败**

```bash
cd apps/server && cargo test --lib ws::server::tests::ws_client_envelope_parses_terminal_channel_attach
```

预期：编译失败 —— `TerminalChannelAttach` 不存在。

- [ ] **Step 3: 添加变体**

修改 `apps/server/src/ws/protocol.rs:14`，在 `WsClientEnvelope` 末尾追加：

```rust
TerminalChannelAttach {
    workspace_id: String,
    fencing_token: i64,
    runtime_id: String,
},
```

- [ ] **Step 4: 跑测试**

```bash
cd apps/server && cargo test --lib ws::server::tests::ws_client_envelope_parses_terminal_channel_attach
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/ws/protocol.rs apps/server/src/ws/server.rs
git commit -m "feat(ws): add terminal_channel_attach client envelope variant"
```

---

### Task 4: 新增 emit_terminal_channel_replay 与 handler

**Files:**
- Modify: `apps/server/src/ws/server.rs`
- Test: `apps/server/src/ws/server.rs`

- [ ] **Step 1: 写一个失败测试 — handler 触发 channel_replay 事件**

在 `apps/server/src/ws/server.rs` 的 `mod tests` 中追加：

```rust
#[test]
fn handle_terminal_channel_attach_emits_replay_event() {
    use crate::services::terminal_gateway::TerminalRuntime;
    use crate::runtime::RuntimeHandle;

    let (app, _shutdown_rx) = RuntimeHandle::new();
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    crate::init_db(&conn).unwrap();
    *app.state().db.lock().unwrap() = Some(conn);

    // 注册一个 gateway runtime（terminal_id 字段在 Task 7 中加入；
    // 这里先用现有签名，commit 2 会拓宽）
    app.state().terminal_runtimes.lock().unwrap().insert(
        TerminalRuntime::new(
            "runtime-1".to_string(),
            "ws-1".to_string(),
            "session-1".to_string(),
            "claude".to_string(),
            "tmux-fake".to_string(),
            "%1".to_string(),
        ),
    );

    let payload = serde_json::json!({
        "workspace_id": "ws-1",
        "fencing_token": 1,
        "runtime_id": "runtime-1",
    });

    handle_terminal_channel_attach(&app, payload).expect("attach ok");

    // 通过 transport_event 通道断言事件已发出
    let captured = app.state().captured_transport_events.lock().unwrap().clone();
    assert!(captured.iter().any(|(event, _)| event == "terminal://channel_replay"));
}
```

> 备注：`captured_transport_events` 是测试态记录器。如果不存在，参照 `emit_terminal_channel_output_publishes_channel_event`（`apps/server/src/ws/server.rs:630`）使用相同的捕获机制。

- [ ] **Step 2: 跑测试，确认失败**

```bash
cd apps/server && cargo test --lib ws::server::tests::handle_terminal_channel_attach_emits_replay_event
```

预期：编译失败 —— `handle_terminal_channel_attach` 不存在。

- [ ] **Step 3: 实现 emit_terminal_channel_replay**

在 `apps/server/src/ws/server.rs:490` 之后（`emit_terminal_channel_output` 旁边）追加：

```rust
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

- [ ] **Step 4: 实现 handle_terminal_channel_attach**

在 `handle_terminal_channel_input`（`apps/server/src/ws/server.rs:282`）之后追加：

```rust
fn handle_terminal_channel_attach(app: &AppHandle, payload: Value) -> Result<(), String> {
    let workspace_id = payload
        .get("workspace_id")
        .and_then(Value::as_str)
        .ok_or_else(|| "workspace_id_missing".to_string())?;
    let runtime_id = payload
        .get("runtime_id")
        .and_then(Value::as_str)
        .ok_or_else(|| "runtime_id_missing".to_string())?;

    let state = app.state();

    // 1) 找到 gateway runtime → 拿到 (workspace_id, session_id)
    let gateway_runtime = state
        .terminal_runtimes
        .lock()
        .map_err(|e| e.to_string())?
        .by_runtime_id(runtime_id)
        .cloned()
        .ok_or_else(|| "terminal_runtime_not_found".to_string())?;

    if gateway_runtime.workspace_id != workspace_id {
        return Err("workspace_runtime_mismatch".to_string());
    }

    // 2) 通过 session_runtime_binding 找到 terminal_id
    let binding = crate::services::session_runtime::session_runtime_binding_by_session(
        &gateway_runtime.workspace_id,
        &gateway_runtime.session_id,
        state,
    )
    .ok_or_else(|| "session_runtime_unbound".to_string())?;
    let terminal_id = binding;

    // 3) 从 terminals 注册表里取 TerminalRuntime → clone output + size
    let key = crate::services::terminal::terminal_key(workspace_id, terminal_id);
    let (data, cols, rows) = {
        let terms = state.terminals.lock().map_err(|e| e.to_string())?;
        let runtime = terms
            .get(&key)
            .cloned()
            .ok_or_else(|| "terminal_runtime_missing".to_string())?;
        let data = runtime
            .output
            .lock()
            .map_err(|e| e.to_string())?
            .clone();
        let (cols, rows) = *runtime.size.lock().map_err(|e| e.to_string())?;
        (data, cols, rows)
    };

    emit_terminal_channel_replay(app, runtime_id, &data, cols, rows);
    Ok(())
}
```

> `session_runtime_binding_by_session` 如果不存在，按 `grep -n "session_runtime_binding" apps/server/src/services/session_runtime.rs` 找到现有最接近的辅助函数（如 `session_runtime_binding_for_terminal`），并新增一个根据 (workspace_id, session_id) 反查 terminal_id 的镜像函数。函数体最多 10 行，调一次现有 BTreeMap 查询即可。

- [ ] **Step 5: 在 dispatch 中接入新变体**

在 `handle_ws_client_envelope`（`apps/server/src/ws/server.rs:319`）的 match 中追加分支，与 `TerminalChannelInput` 相邻：

```rust
WsClientEnvelope::TerminalChannelAttach {
    workspace_id,
    fencing_token,
    runtime_id,
} => {
    require_ws_workspace_controller_mutation(
        &workspace_id,
        fencing_token,
        workspace_client,
        app,
    )
    .map_err(|error| {
        ws_input_error_envelope(&workspace_id, "terminal_channel_attach", &error)
    })?;
    handle_terminal_channel_attach(
        app,
        json!({
            "workspace_id": workspace_id,
            "fencing_token": fencing_token,
            "runtime_id": runtime_id,
        }),
    )
    .map_err(|error| {
        ws_input_error_envelope(&workspace_id, "terminal_channel_attach", &error)
    })?;
    Ok(None)
}
```

- [ ] **Step 6: 跑测试**

```bash
cd apps/server && cargo test --lib ws::server
```

预期：新测试 PASS；现有 ws::server 测试不受影响。

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/ws/server.rs apps/server/src/services/session_runtime.rs
git commit -m "feat(ws): handle terminal_channel_attach and emit channel_replay"
```

---

### Task 5: 前端新增 sendTerminalChannelAttach 与 subscribeTerminalChannelReplay

**Files:**
- Modify: `apps/web/src/types/app.ts`
- Modify: `apps/web/src/services/terminal-channel/client.ts`

- [ ] **Step 1: 添加事件类型**

在 `apps/web/src/types/app.ts` 找到 `TerminalChannelOutputEvent` 定义旁边追加：

```typescript
export interface TerminalChannelReplayEvent {
  runtime_id: string;
  data: string;
  cols: number;
  rows: number;
}
```

- [ ] **Step 2: 添加 attach 构造器与发送函数**

在 `apps/web/src/services/terminal-channel/client.ts` 末尾追加：

```typescript
export const buildTerminalChannelAttach = (
  workspaceId: string,
  fencingToken: number,
  runtimeId: string,
) => ({
  type: "terminal_channel_attach" as const,
  workspace_id: workspaceId,
  fencing_token: fencingToken,
  runtime_id: runtimeId,
});

export const sendTerminalChannelAttach = (
  workspaceId: string,
  fencingToken: number,
  runtimeId: string,
) => {
  void import("../../ws/client.ts").then(({ sendWsMessage }) => {
    sendWsMessage(buildTerminalChannelAttach(workspaceId, fencingToken, runtimeId));
  });
};

export const subscribeTerminalChannelReplay = (
  handler: (payload: TerminalChannelReplayEvent) => void,
) => {
  let unsubscribe = () => {};
  void import("../../ws/client.ts").then(({ subscribeWsEvent }) => {
    unsubscribe = subscribeWsEvent<TerminalChannelReplayEvent>(
      "terminal://channel_replay",
      handler,
    );
  });
  return () => unsubscribe();
};
```

需要在文件顶部 `import type { TerminalChannelOutputEvent }` 行追加 `TerminalChannelReplayEvent` 引入。

- [ ] **Step 3: 跑前端类型检查**

```bash
cd apps/web && pnpm typecheck
```

预期：通过。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/types/app.ts apps/web/src/services/terminal-channel/client.ts
git commit -m "feat(web): add terminal channel attach + replay client primitives"
```

---

### Task 6: 前端在 ws 连接 / runtime 绑定时发送 attach，并把 replay 写入 xterm

**Files:**
- Modify: `apps/web/src/features/workspace/workspace-sync-hooks.ts`

- [ ] **Step 1: 订阅 channel_replay → 写入对应 terminal**

在 `workspace-sync-hooks.ts:270` 的 `useEffect(() => { ... subscribeTerminalChannelOutput ... })` 旁追加一个并列的 `useEffect`：

```typescript
useEffect(() => {
  const unsubscribe = subscribeTerminalChannelReplay(({ runtime_id, data }) => {
    const currentState = stateRefLatest.current;
    const matchedTab = currentState.tabs.find((tab) => (
      tab.sessions.some((session) => session.terminalRuntimeId === runtime_id)
    ));
    if (!matchedTab) return;
    const terminalId = resolveSessionTerminalIdByRuntimeId(
      matchedTab.sessions,
      runtime_id,
      matchedTab.terminals,
    );
    if (!terminalId) return;
    // 关键：先 clear 再 write 完整快照，避免重连后上下混叠
    clearTerminalAndWrite(matchedTab.id, terminalId, data);
  });
  return unsubscribe;
}, [stateRefLatest]);
```

> `clearTerminalAndWrite` 如果尚不存在，按现有 `recordPendingTerminalStream` 模式新增一个工具：先派发一个 `clear` 动作，再走与 chunk 相同的写入路径。具体放置位置参考 `pendingStreamIndexRef` 所在工具文件，函数体不超过 10 行。

文件顶部 `import` 区追加：

```typescript
import {
  subscribeTerminalChannelOutput,
  subscribeTerminalChannelReplay,
  sendTerminalChannelAttach,
} from "../../services/terminal-channel/client.ts";
```

- [ ] **Step 2: 在 ws 连接/重连时对所有已绑定 runtime 发 attach**

定位 `subscribeWsConnectionState`（`workspace-sync-hooks.ts:316`）的 `useEffect`，在 `void resyncWorkspaceSnapshots(...)` 之后追加：

```typescript
const currentState = stateRefLatest.current;
for (const tab of currentState.tabs) {
  for (const session of tab.sessions) {
    if (session.terminalRuntimeId) {
      sendTerminalChannelAttach(tab.id, fencingToken, session.terminalRuntimeId);
    }
  }
}
```

> `fencingToken` 的来源参照同文件已有的 controller mutation 模式（通常通过 `controllerFencingToken` 或类似 ref 获得）。如果在该 callback 上下文不便取，把 attach 调用挪到一个能拿到 token 的同级 `useEffect`，依赖 `[fencingToken, bootstrapReady]`。

- [ ] **Step 3: 在 session 首次绑定 runtime 时立即 attach**

定位 `terminalRuntimeId` 被赋值的 reducer 路径（`grep -rn "terminalRuntimeId" apps/web/src/`），找到状态从 `undefined → string` 的转换点。在该转换发生的同一 effect 中，对新 runtime 发一次 attach：

```typescript
if (previous?.terminalRuntimeId !== current.terminalRuntimeId && current.terminalRuntimeId) {
  sendTerminalChannelAttach(tabId, fencingToken, current.terminalRuntimeId);
}
```

- [ ] **Step 4: 跑前端类型检查 + 单测**

```bash
cd apps/web && pnpm typecheck && pnpm test
```

预期：通过。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace/workspace-sync-hooks.ts
git commit -m "feat(web): attach terminal channel on connect and runtime bind"
```

---

### Task 7: 集成测试 — workspace 终端刷新后通过 attach 拿到历史

**Files:**
- Modify: `tests/workspace-recovery.test.ts`

- [ ] **Step 1: 阅读现有测试结构**

```bash
head -80 tests/workspace-recovery.test.ts
```

了解测试如何起 server、起 workspace terminal、写入并读取输出。

- [ ] **Step 2: 添加新场景**

在 `tests/workspace-recovery.test.ts` 中新增一个 `describe("terminal channel attach replay")`：

```typescript
describe("terminal channel attach replay", () => {
  it("returns the ring buffer snapshot for a workspace terminal after reconnect", async () => {
    const { client, workspaceId } = await startTestEnv();
    const terminalId = await createWorkspaceTerminal(client, workspaceId);
    await writeTerminal(client, workspaceId, terminalId, "echo hello-world\n");
    await waitForTerminalContains(client, workspaceId, terminalId, "hello-world");

    const runtimeId = await resolveRuntimeIdForTerminal(client, workspaceId, terminalId);

    // 模拟前端重连：关闭 ws → 重开 → 发 attach
    await client.reconnectWs();
    const replay = await client.requestTerminalChannelAttach(workspaceId, runtimeId);

    expect(replay.data).toContain("hello-world");
    expect(replay.cols).toBeGreaterThan(0);
    expect(replay.rows).toBeGreaterThan(0);
  });
});
```

> 如果 `client` 测试 helper 没有 `requestTerminalChannelAttach`，按现有 `client.sendWs` / `client.waitForEvent` 模式新增一个：发 `terminal_channel_attach` 消息 → `waitForEvent("terminal://channel_replay")` → 返回 payload。

- [ ] **Step 3: 跑集成测试**

```bash
pnpm vitest run tests/workspace-recovery.test.ts
```

预期：新场景 PASS。

- [ ] **Step 4: Commit**

```bash
git add tests/workspace-recovery.test.ts
git commit -m "test(workspace): cover terminal channel attach replay path"
```

---

### Task 8: Commit 1 手动验收（含 Windows）

- [ ] **Step 1: macOS / Linux 验收**

```bash
pnpm dev
```

操作清单：
1. 起 workspace，打开独立终端
2. 跑 `for i in $(seq 1 200); do echo "line $i"; done`
3. 刷新页面
4. 终端应**重新出现**完整输出
5. 用鼠标滚轮向上滚 → 直接进入 xterm.js scrollback，无任何特殊模式
6. 滚动 200 行无卡顿、无错位

- [ ] **Step 2: Windows 验收**

在 Windows 机器上同样跑 `pnpm dev`，重复 Step 1 的清单。重点确认 ConPTY 路径下 `portable-pty` 工作正常。

- [ ] **Step 3: 记录验收结果**

如果三平台都通过，进入 Commit 2。如果 Windows 失败，**不要进入 Commit 2** —— 先解决 ConPTY 问题再继续，避免 commit 2 同时引入新平台 + 新链路两个变量。

---

## Commit 2 — Switch session_runtime to Pty and Delete tmux

完成后 `tmux.rs` 不再存在，二进制完全不调用任何外部 `tmux` 命令。

---

### Task 9: GatewayTerminalRuntime 增加 terminal_id 字段，send_input 走 terminal_write

**Files:**
- Modify: `apps/server/src/services/terminal_gateway.rs`
- Modify: `apps/server/src/services/session_runtime.rs`（构造 GatewayTerminalRuntime 处）

- [ ] **Step 1: 写一个失败测试 — send_input 经由 terminal_write_log**

修改 `apps/server/src/services/terminal_gateway.rs:226` 起的 `send_input_marks_bound_session_running`，让它进一步断言 `state.terminal_write_log` 中收到了 `"hello"`：

```rust
let log = app.state().terminal_write_log.lock().unwrap();
assert!(log.iter().any(|(ws, _, input, _)| ws == &workspace_id && input == "hello"));
```

并在测试中把 `TerminalRuntime::new` 的 tmux 字段参数替换为新签名（cf. Step 3）。

- [ ] **Step 2: 跑测试，确认失败**

```bash
cd apps/server && cargo test --lib services::terminal_gateway::tests::send_input_marks_bound_session_running
```

预期：编译失败或断言失败。

- [ ] **Step 3: 调整 GatewayTerminalRuntime 结构**

修改 `apps/server/src/services/terminal_gateway.rs:7-36`：

```rust
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct GatewayTerminalRuntime {
    pub(crate) runtime_id: String,
    pub(crate) workspace_id: String,
    pub(crate) session_id: String,
    pub(crate) provider: String,
    pub(crate) terminal_id: u64,
}

pub(crate) type TerminalRuntime = GatewayTerminalRuntime;

impl GatewayTerminalRuntime {
    pub(crate) fn new(
        runtime_id: String,
        workspace_id: String,
        session_id: String,
        provider: String,
        terminal_id: u64,
    ) -> Self {
        Self {
            runtime_id,
            workspace_id,
            session_id,
            provider,
            terminal_id,
        }
    }
}
```

- [ ] **Step 4: 改写 send_input**

替换 `apps/server/src/services/terminal_gateway.rs:85-125`：

```rust
pub(crate) fn send_input(
    runtime_id: &str,
    input: &str,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let runtime = state
        .terminal_runtimes
        .lock()
        .map_err(|error| error.to_string())?
        .by_runtime_id(runtime_id)
        .cloned()
        .ok_or_else(|| "terminal_runtime_not_found".to_string())?;

    crate::services::terminal::terminal_write(
        runtime.workspace_id.clone(),
        runtime.terminal_id,
        input.to_string(),
        crate::TerminalWriteOrigin::User,
        state,
    )?;

    let _ = sync_session_runtime_state(
        state,
        &runtime.workspace_id,
        &runtime.session_id,
        SessionStatus::Running,
        true,
        Some(SessionRuntimeLiveness::Attached),
    );
    Ok(())
}
```

注意：移除 `#[cfg(test)]` 与 `#[cfg(not(test))]` 分支 —— `terminal_write` 自身已具备 test fallback（写入 `terminal_write_log`），不需要 gateway 再做条件分支。

- [ ] **Step 5: 同步 session_runtime.rs 中的构造调用**

修改 `apps/server/src/services/session_runtime.rs:404-411`：

```rust
let runtime = crate::services::terminal_gateway::TerminalRuntime::new(
    runtime_id.clone(),
    params.workspace_id.clone(),
    params.session_id.clone(),
    session.provider.as_str().to_string(),
    terminal.id,
);
```

同步修改 `session_runtime.rs` 测试模块中所有 `TerminalRuntime::new(...)` 调用，把多余的 tmux 字符串参数换成 `terminal_id: u64`。

- [ ] **Step 6: 跑测试**

```bash
cd apps/server && cargo test --lib services::terminal_gateway services::session_runtime
```

预期：全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/services/terminal_gateway.rs apps/server/src/services/session_runtime.rs
git commit -m "refactor(terminal-gateway): route send_input via terminal_write"
```

---

### Task 10: session_runtime 切到 TerminalBridgeTarget::Pty

**Files:**
- Modify: `apps/server/src/services/session_runtime.rs`

- [ ] **Step 1: 替换 Tmux 创建 + 桥接为 Pty**

替换 `apps/server/src/services/session_runtime.rs:368-401`：

```rust
let terminal = match create_terminal_runtime(
    &params.workspace_id,
    &workspace_cwd,
    &workspace_target,
    params.cols,
    params.rows,
    TerminalCreateOptions {
        persist_workspace_terminal: true,
        env: shell_env.clone(),
        launch_command: TerminalLaunchCommand::DefaultShell,
        bridge_target: TerminalBridgeTarget::Pty {
            cwd: workspace_cwd.clone(),
            target: workspace_target.clone(),
            cols: params.cols,
            rows: params.rows,
        },
    },
    &app,
    state,
) {
    Ok(terminal) => terminal,
    Err(error) => return Err(error),
};
```

删除上方的 `let tmux_runtime = crate::services::tmux::create_tmux_runtime(...)`。

- [ ] **Step 2: 改写 boot command 注入路径**

替换 `apps/server/src/services/session_runtime.rs:418-445`：

```rust
let boot_command = match crate::services::provider_registry::provider_boot_command(
    &settings,
    &session.provider,
    &workspace_target,
    session.resume_id.as_deref(),
) {
    Ok(command) => command,
    Err(error) => {
        let _ = remove_terminal_runtime_registration(
            &params.workspace_id,
            &params.session_id,
            state,
        );
        remove_failed_terminal_runtime(&params.workspace_id, terminal.id, state);
        return Err(error);
    }
};

if let Err(error) = crate::services::terminal::terminal_write(
    params.workspace_id.clone(),
    terminal.id,
    format!("{}\r", boot_command),
    crate::TerminalWriteOrigin::User,
    state,
) {
    let _ = remove_terminal_runtime_registration(
        &params.workspace_id,
        &params.session_id,
        state,
    );
    remove_failed_terminal_runtime(&params.workspace_id, terminal.id, state);
    return Err(error);
}
```

> 关键：boot command 末尾需要 `\r` 触发 enter；这取代了原 `tmux send-keys` 的 `Enter` 行为。如果 provider 启动命令可能含 dash 前缀（参考最近 commit `d6b9561`），保留现有的 dash 处理函数；若该函数与 tmux 强耦合，把它折叠到这一段调用之前。

- [ ] **Step 3: 删除 build_tmux_boot_command 函数与测试**

`grep -n "build_tmux_boot_command" apps/server/src/services/session_runtime.rs` —— 删除函数定义和单元测试 `build_tmux_boot_command_passes_command_through`。

- [ ] **Step 4: 跑全量 server 测试**

```bash
cd apps/server && cargo test --lib
```

预期：全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/session_runtime.rs
git commit -m "refactor(session-runtime): start sessions on in-process PTY bridge"
```

---

### Task 11: 删除 TerminalBridgeTarget::Tmux / TerminalIo::TmuxAttached / create_tmux_terminal_runtime

**Files:**
- Modify: `apps/server/src/services/terminal.rs`
- Modify: `apps/server/src/app.rs`（`TerminalIo` 枚举所在处）

- [ ] **Step 1: 移除枚举变体**

修改 `apps/server/src/services/terminal.rs:48-61`，将 `TerminalBridgeTarget` 简化为单变体（如果只剩一个变体，可以变成 struct，但保留 enum 形态便于将来扩展）：

```rust
#[derive(Clone)]
pub(crate) enum TerminalBridgeTarget {
    Pty {
        cwd: String,
        target: ExecTarget,
        cols: Option<u16>,
        rows: Option<u16>,
    },
}
```

定位 `TerminalIo` 枚举（通常在 `app.rs`），删除 `TmuxAttached` 变体。

- [ ] **Step 2: 删除 create_tmux_terminal_runtime**

删除 `apps/server/src/services/terminal.rs:361-...`（整个 `create_tmux_terminal_runtime` 函数体）。

- [ ] **Step 3: 简化 create_terminal_runtime 的 match**

修改 `apps/server/src/services/terminal.rs:537-570`：

```rust
let runtime = match bridge_target {
    TerminalBridgeTarget::Pty {
        cwd,
        target,
        cols,
        rows,
    } => create_pty_terminal_runtime(
        terminal_id,
        workspace_id,
        &cwd,
        &target,
        cols,
        rows,
        options,
        app,
        state,
    )?,
};
```

- [ ] **Step 4: 修整 terminal_write 中的 io 分支**

修改 `apps/server/src/services/terminal.rs:656-679`，删除 `TerminalIo::TmuxAttached { writer, .. }` 分支，只保留 `Pty` 分支。

- [ ] **Step 5: 修整 terminate_terminal_runtime**

修改 `apps/server/src/services/terminal.rs:33-39`，删除 `TmuxAttached` 分支。

- [ ] **Step 6: 跑全量 server 测试**

```bash
cd apps/server && cargo test --lib
```

预期：全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/services/terminal.rs apps/server/src/app.rs
git commit -m "refactor(terminal): drop tmux bridge variants from TerminalIo and BridgeTarget"
```

---

### Task 12: 删除 tmux.rs 与所有调用点

**Files:**
- Delete: `apps/server/src/services/tmux.rs`
- Modify: `apps/server/src/services/mod.rs`
- Modify: `apps/server/src/main.rs`
- Modify: `apps/server/src/services/workspace_runtime.rs`
- Modify: `apps/server/src/services/workspace.rs`

- [ ] **Step 1: 找出剩余调用点**

```bash
grep -rn "services::tmux\|tmux::\|CODER_STUDIO_TMUX" apps/server/src/
```

记录每个命中。

- [ ] **Step 2: 在 main.rs 移除 janitor 与 socket 配置**

`grep -n "tmux_janitor\|configure_tmux_socket_path\|CODER_STUDIO_TMUX" apps/server/src/main.rs` —— 删除对应行（一般在 `setup` 或服务初始化块内）。

- [ ] **Step 3: 在 mod.rs 移除模块**

修改 `apps/server/src/services/mod.rs`，删除 `pub mod tmux;` 一行。

- [ ] **Step 4: 清理 workspace_runtime.rs / workspace.rs**

对 Step 1 命中的每个文件，把 `crate::services::tmux::*` 调用替换为对应的 PTY 等价路径或直接删除（这些文件通常只是在 cleanup 路径上 `kill_tmux_session`，PTY 路径下由 `terminate_terminal_runtime` 负责，等价 = 删除）。

- [ ] **Step 5: 删除文件**

```bash
git rm apps/server/src/services/tmux.rs
```

- [ ] **Step 6: 编译 + 测试**

```bash
cd apps/server && cargo build && cargo test --lib
```

预期：编译通过、测试全 PASS。任何残余 `tmux` 引用会被编译器抓出来。

- [ ] **Step 7: 终极 grep 复检**

```bash
grep -rn "tmux" apps/server/src/
```

预期：零命中。如有命中，是 doc / comment 残留，一并清除。

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/services/mod.rs apps/server/src/main.rs apps/server/src/services/workspace_runtime.rs apps/server/src/services/workspace.rs
git commit -m "refactor(server): delete tmux module and all references"
```

---

### Task 13: 调整 tests/workspace-recovery.test.ts 与其他集成测试

**Files:**
- Modify: `tests/workspace-recovery.test.ts`

- [ ] **Step 1: 找出 tmux 相关断言**

```bash
grep -n "tmux" tests/workspace-recovery.test.ts
```

- [ ] **Step 2: 删除/调整**

对每个命中：
- 如果断言"tmux session 存在 / 不存在"——删除整条断言（PTY 路径下没有外部 session 概念）
- 如果断言"tmux output 包含 X"——改为对 terminal channel replay 的断言（参考 Task 7 新加场景的写法）

- [ ] **Step 3: 跑集成测试**

```bash
pnpm vitest run tests/workspace-recovery.test.ts
```

预期：通过。

- [ ] **Step 4: 跑全量 vitest**

```bash
pnpm vitest run
```

预期：全部通过。

- [ ] **Step 5: Commit**

```bash
git add tests/workspace-recovery.test.ts
git commit -m "test(workspace): drop tmux assertions from recovery suite"
```

---

### Task 14: 三平台手动验收

- [ ] **Step 1: macOS — claude session 完整流程**

```bash
pnpm dev
```

清单：
1. 起 workspace → 起 claude session
2. 让 claude 跑一个产生大量输出的指令（如 `ls -la /` 或要它写一段长说明）
3. 等待响应完整结束
4. 刷新页面
5. 终端**重新出现**完整历史
6. 鼠标滚轮可正常滚动
7. 在 session 里发新消息 → claude 正常响应
8. 创建 branch session → 同样验证

- [ ] **Step 2: Linux —— 同上**

- [ ] **Step 3: Windows —— 同上**

特别确认 ConPTY 路径下 session 启动 + boot command 注入 + reader 线程都正常。

- [ ] **Step 4: dash-prefixed 输入回归**

测试历史 fix `d6b9561` 的场景：在 session 里输入以 `-` 开头的内容（如 `-help`），确认正常发送、不被 PTY/shell 解析为参数。

- [ ] **Step 5: 鼠标滚轮场景对照**

在迁移后的 session 终端里，向上滚 → 应直接进入 xterm.js scrollback，无任何"copy mode"或类似拦截。这是迁移核心收益的回归确认。

- [ ] **Step 6: 全量验收通过后做最终 commit（如有清理）**

```bash
git status
```

如有未提交的小 fix，单独 commit。否则进入 PR 阶段。

---

## Self-Review Checklist（写完后由实施者勾选）

- [ ] Spec 中的每个 Goal 都有对应任务
- [ ] Spec 中的 Replay 协议字段（runtime_id / data / cols / rows）在 Task 4 实现
- [ ] Ring buffer 容量 2 MB 在 Task 1 落地
- [ ] tmux.rs 在 Task 12 删除
- [ ] commit 1 完成后 workspace 独立终端可以验收（Task 8）
- [ ] commit 2 完成后没有任何 `tmux` grep 命中（Task 12 Step 7）
- [ ] 三平台手动验收（Task 14）
- [ ] 所有 TDD 步骤都先写测试再实现
- [ ] 没有 "TODO" / "implement later" 占位
