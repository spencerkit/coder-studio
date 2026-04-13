# Terminal Gateway Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production-ready slice of the terminal gateway architecture by introducing tmux-backed terminal runtimes, a dedicated terminal channel path, and removing the current `boot_input` session startup model.

**Architecture:** This plan intentionally scopes the final-architecture spec into a first shippable migration slice. Phase 1 introduces a backend terminal gateway and tmux-backed runtime registry, shifts session startup to backend-owned boot orchestration, and adds a dedicated terminal channel transport while keeping existing business-state events (`workspace://runtime_state`, `agent://lifecycle`) intact. It does **not** yet implement every final-state health/replay nuance from the spec; instead it creates the stable runtime truth (`TerminalRuntime`) the rest of the architecture can build on.

**Tech Stack:** Rust server services, tmux CLI integration, Axum/WS transport, React + TypeScript + xterm.js frontend, existing workspace/session/provider models, cargo tests, web unit tests.

---

## Scope Decomposition

The final architecture spec covers multiple subsystems. To keep this executable and testable, this plan implements the **foundation slice** only:

1. tmux-backed `TerminalRuntime` registry and gateway service
2. terminal channel WS path for input/output
3. backend-owned provider boot (remove `boot_input`)
4. session-to-runtime association
5. frontend attach/send/render over terminal channel

Deferred to later plans:
- advanced replay backfill beyond a bounded recent buffer
- terminal health UI taxonomy (`silent`, `stdin_closed`, `tmux_missing`)
- multi-attach policy beyond “last active client + optional observers”
- full terminal history persistence redesign

This keeps Phase 1 coherent and shippable.

---

## File Structure

### Server core runtime and gateway
- Create: `apps/server/src/services/terminal_gateway.rs`
  - Own `TerminalRuntime`, channel attach state, recent output buffer, input routing, tmux runtime lifecycle.
- Create: `apps/server/src/services/tmux.rs`
  - Wrap tmux command execution: create session, send keys, capture pane, kill session, inspect liveness.
- Modify: `apps/server/src/services/mod.rs`
  - Export new gateway/tmux modules.
- Modify: `apps/server/src/app.rs`
  - Add runtime registry state for terminal gateway.

### Server session/runtime integration
- Modify: `apps/server/src/services/session_runtime.rs`
  - Replace `boot_input`-based startup with backend-owned boot orchestration into tmux.
- Modify: `apps/server/src/services/workspace.rs`
  - Persist / resolve `runtime_ref`-style session association if needed through existing session bindings.
- Modify: `apps/server/src/models.rs`
  - Add `terminal_runtime_id`/channel-facing response fields.
- Modify: `apps/server/src/command/http.rs`
  - Add RPC(s) for terminal channel attach bootstrap if needed; remove `boot_input` assumptions in tests.
- Modify: `apps/server/src/ws/server.rs`
  - Add terminal channel WS message/event types.

### Provider integration
- Modify: `apps/server/src/services/provider_registry.rs`
  - Expose boot command generation in a form terminal gateway can use.
- Modify: `apps/server/src/services/claude.rs`
- Modify: `apps/server/src/services/codex.rs`
  - Ensure start/resume commands can be injected directly into tmux-backed terminal runtime.

### Frontend terminal channel
- Create: `apps/web/src/services/terminal-channel/client.ts`
  - Dedicated terminal channel send/subscribe client.
- Modify: `apps/web/src/components/terminal/XtermBase.tsx`
  - Continue UI ownership, but route user input to terminal channel client.
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
  - Replace `boot_input` write path; attach to terminal runtime channel after backend startup.
- Modify: `apps/web/src/features/workspace/workspace-sync-hooks.ts`
  - Subscribe to terminal channel output events instead of legacy terminal event path for session runtimes.
- Modify: `apps/web/src/services/http/session-runtime.service.ts`
  - New startup response shape (runtime/channel info, no `boot_input`).
- Modify: `apps/web/src/types/app.ts`
  - Add terminal runtime/channel payload types.

### Tests
- Modify/Create server tests near:
  - `apps/server/src/services/session_runtime.rs`
  - `apps/server/src/services/terminal_gateway.rs`
  - `apps/server/src/services/tmux.rs`
  - `apps/server/src/command/http.rs`
  - `apps/server/src/ws/server.rs`
- Modify/Create frontend tests near:
  - `tests/workspace-runtime-controller.test.ts`
  - `tests/agent-pane-session.test.ts`
  - new `tests/terminal-channel.test.ts`

---

### Task 1: Introduce tmux adapter and terminal runtime registry

**Files:**
- Create: `apps/server/src/services/tmux.rs`
- Create: `apps/server/src/services/terminal_gateway.rs`
- Modify: `apps/server/src/services/mod.rs`
- Modify: `apps/server/src/app.rs`
- Test: `apps/server/src/services/tmux.rs`
- Test: `apps/server/src/services/terminal_gateway.rs`

- [ ] **Step 1: Write the failing tmux adapter test for creating a persistent session**

Add to `apps/server/src/services/tmux.rs`:

```rust
#[test]
fn create_tmux_runtime_returns_session_identity() {
    let runtime = create_tmux_runtime(
        "ws-1",
        "session-1",
        "/tmp/project-a",
        &ExecTarget::Native,
    )
    .expect("tmux runtime should be created");

    assert!(runtime.session_name.starts_with("coder-studio-"));
    assert!(!runtime.pane_id.is_empty());
}
```

- [ ] **Step 2: Run the tmux adapter test to verify it fails**

Run: `cargo test --manifest-path /home/spencer/workspace/coder-studio/apps/server/Cargo.toml create_tmux_runtime_returns_session_identity -- --nocapture`
Expected: FAIL because `create_tmux_runtime` does not exist.

- [ ] **Step 3: Write the failing runtime registry test**

Add to `apps/server/src/services/terminal_gateway.rs`:

```rust
#[test]
fn terminal_runtime_registry_tracks_runtime_by_workspace_and_session() {
    let mut registry = TerminalRuntimeRegistry::default();
    let runtime = TerminalRuntime::new(
        "runtime-1".to_string(),
        "ws-1".to_string(),
        "session-1".to_string(),
        "claude".to_string(),
        "coder-studio-ws-1-session-1".to_string(),
        "%1".to_string(),
    );

    registry.insert(runtime.clone());

    let stored = registry.by_session("ws-1", "session-1").expect("runtime should exist");
    assert_eq!(stored.runtime_id, "runtime-1");
    assert_eq!(stored.provider, "claude");
}
```

- [ ] **Step 4: Run the registry test to verify it fails**

Run: `cargo test --manifest-path /home/spencer/workspace/coder-studio/apps/server/Cargo.toml terminal_runtime_registry_tracks_runtime_by_workspace_and_session -- --nocapture`
Expected: FAIL because `TerminalRuntimeRegistry`/`TerminalRuntime::new` do not exist.

- [ ] **Step 5: Implement the minimal tmux adapter**

Create `apps/server/src/services/tmux.rs` with this minimal surface:

```rust
use crate::*;
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TmuxRuntime {
    pub(crate) session_name: String,
    pub(crate) pane_id: String,
}

pub(crate) fn create_tmux_runtime(
    workspace_id: &str,
    session_id: &str,
    cwd: &str,
    target: &ExecTarget,
) -> Result<TmuxRuntime, String> {
    let session_name = format!(
        "coder-studio-{}-{}-{}",
        workspace_id,
        session_id,
        Uuid::new_v4().simple()
    );
    let pane_id = create_tmux_session(&session_name, cwd, target)?;
    Ok(TmuxRuntime { session_name, pane_id })
}

fn create_tmux_session(session_name: &str, cwd: &str, _target: &ExecTarget) -> Result<String, String> {
    let output = std::process::Command::new("tmux")
        .args(["new-session", "-d", "-P", "-c", cwd, "-s", session_name, "-F", "#{pane_id}"])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
```

- [ ] **Step 6: Implement the minimal runtime registry**

Create `apps/server/src/services/terminal_gateway.rs` with:

```rust
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TerminalRuntime {
    pub(crate) runtime_id: String,
    pub(crate) workspace_id: String,
    pub(crate) session_id: String,
    pub(crate) provider: String,
    pub(crate) tmux_session_name: String,
    pub(crate) tmux_pane_id: String,
}

impl TerminalRuntime {
    pub(crate) fn new(
        runtime_id: String,
        workspace_id: String,
        session_id: String,
        provider: String,
        tmux_session_name: String,
        tmux_pane_id: String,
    ) -> Self {
        Self { runtime_id, workspace_id, session_id, provider, tmux_session_name, tmux_pane_id }
    }
}

#[derive(Default)]
pub(crate) struct TerminalRuntimeRegistry {
    by_session_key: BTreeMap<String, TerminalRuntime>,
}

impl TerminalRuntimeRegistry {
    pub(crate) fn insert(&mut self, runtime: TerminalRuntime) {
        self.by_session_key
            .insert(format!("{}:{}", runtime.workspace_id, runtime.session_id), runtime);
    }

    pub(crate) fn by_session(&self, workspace_id: &str, session_id: &str) -> Option<&TerminalRuntime> {
        self.by_session_key.get(&format!("{workspace_id}:{session_id}"))
    }
}
```

- [ ] **Step 7: Add registry state to AppState**

In `apps/server/src/app.rs`, add:

```rust
pub terminal_runtimes: Mutex<crate::services::terminal_gateway::TerminalRuntimeRegistry>,
```

and initialize it with `Default::default()`.

- [ ] **Step 8: Run the focused tests to verify they pass**

Run:
```bash
cargo test --manifest-path /home/spencer/workspace/coder-studio/apps/server/Cargo.toml create_tmux_runtime_returns_session_identity -- --nocapture
cargo test --manifest-path /home/spencer/workspace/coder-studio/apps/server/Cargo.toml terminal_runtime_registry_tracks_runtime_by_workspace_and_session -- --nocapture
```
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/services/tmux.rs apps/server/src/services/terminal_gateway.rs apps/server/src/services/mod.rs apps/server/src/app.rs
git commit -m "feat: add tmux-backed terminal runtime foundation"
```

---

### Task 2: Move session startup to backend-owned terminal boot

**Files:**
- Modify: `apps/server/src/services/session_runtime.rs`
- Modify: `apps/server/src/services/provider_registry.rs`
- Modify: `apps/server/src/models.rs`
- Test: `apps/server/src/services/session_runtime.rs`
- Test: `apps/server/src/command/http.rs`

- [ ] **Step 1: Write the failing test that startup no longer returns boot_input**

Add/update `apps/server/src/services/session_runtime.rs` tests:

```rust
#[test]
fn session_runtime_start_creates_runtime_and_does_not_return_boot_input() {
    let app = test_app();
    let workspace_id = launch_test_workspace(&app, "/tmp/runtime-backend-boot");
    let session = create_session(
        workspace_id.clone(),
        SessionMode::Branch,
        ProviderId::claude(),
        app.state(),
    )
    .unwrap();

    let result = session_runtime_start(
        SessionRuntimeStartParams {
            workspace_id,
            session_id: session.id.clone(),
            cols: Some(120),
            rows: Some(30),
        },
        app.clone(),
        app.state(),
    )
    .expect("session runtime should start");

    assert!(result.started);
    assert!(result.boot_input.is_none());
    assert!(result.terminal_runtime_id.is_some());
}
```

- [ ] **Step 2: Run the startup test to verify it fails**

Run: `cargo test --manifest-path /home/spencer/workspace/coder-studio/apps/server/Cargo.toml session_runtime_start_creates_runtime_and_does_not_return_boot_input -- --nocapture`
Expected: FAIL because `boot_input` is still present and `terminal_runtime_id` does not exist.

- [ ] **Step 3: Add a provider boot command helper**

In `apps/server/src/services/provider_registry.rs`, add:

```rust
pub(crate) fn provider_boot_command(
    settings: &AppSettingsPayload,
    provider: &ProviderId,
    target: &ExecTarget,
    resume_id: Option<&str>,
) -> Result<String, String> {
    let adapter = resolve_provider_adapter(provider.as_str())
        .ok_or_else(|| format!("unknown_provider:{}", provider.as_str()))?;
    let launch = match resume_id {
        Some(id) => adapter.build_resume(settings, target, id)?,
        None => adapter.build_start(settings, target)?,
    };
    Ok(crate::services::session_runtime::launch_spec_display_command(&launch.launch_spec))
}
```

- [ ] **Step 4: Replace `boot_input` startup with direct tmux injection**

In `apps/server/src/services/session_runtime.rs`, replace the current terminal-create + returned `boot_input` path with:

```rust
let tmux_runtime = crate::services::tmux::create_tmux_runtime(
    &params.workspace_id,
    &params.session_id,
    &workspace_cwd,
    &workspace_target,
)?;

let runtime_id = format!("runtime:{}:{}", params.workspace_id, params.session_id);
let runtime = crate::services::terminal_gateway::TerminalRuntime::new(
    runtime_id.clone(),
    params.workspace_id.clone(),
    params.session_id.clone(),
    session.provider.as_str().to_string(),
    tmux_runtime.session_name.clone(),
    tmux_runtime.pane_id.clone(),
);

app.state().terminal_runtimes.lock().unwrap().insert(runtime);

let boot_command = crate::services::provider_registry::provider_boot_command(
    &settings,
    &session.provider,
    &workspace_target,
    session.resume_id.as_deref(),
)?;
crate::services::tmux::send_tmux_input(&tmux_runtime.session_name, &boot_command)?;
```

Return shape should become:

```rust
Ok(SessionRuntimeStartResult {
    terminal_id: terminal.id,
    started: true,
    boot_input: None,
    terminal_runtime_id: Some(runtime_id),
})
```

- [ ] **Step 5: Extend the response model**

In `apps/server/src/models.rs`, extend `SessionRuntimeStartResult`:

```rust
pub struct SessionRuntimeStartResult {
    pub terminal_id: u64,
    pub started: bool,
    pub boot_input: Option<String>,
    pub terminal_runtime_id: Option<String>,
}
```

Keep `boot_input` temporarily for compatibility but return `None` in the new path.

- [ ] **Step 6: Run focused tests to verify they pass**

Run:
```bash
cargo test --manifest-path /home/spencer/workspace/coder-studio/apps/server/Cargo.toml session_runtime_start_creates_runtime_and_does_not_return_boot_input -- --nocapture
cargo test --manifest-path /home/spencer/workspace/coder-studio/apps/server/Cargo.toml session_runtime_start -- --nocapture
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/services/session_runtime.rs apps/server/src/services/provider_registry.rs apps/server/src/models.rs
git commit -m "feat: boot sessions from terminal gateway runtime"
```

---

### Task 3: Add terminal channel WS protocol on the server

**Files:**
- Modify: `apps/server/src/ws/server.rs`
- Modify: `apps/server/src/services/terminal_gateway.rs`
- Modify: `apps/server/src/types` via `apps/server/src/models.rs` if needed
- Test: `apps/server/src/ws/server.rs`

- [ ] **Step 1: Write the failing WS test for terminal channel input**

Add a focused test in `apps/server/src/ws/server.rs`:

```rust
#[test]
fn terminal_channel_input_routes_to_runtime() {
    let app = test_app();
    let runtime = TerminalRuntime::new(
        "runtime-1".into(),
        "ws-1".into(),
        "session-1".into(),
        "claude".into(),
        "tmux-session-1".into(),
        "%1".into(),
    );
    app.state().terminal_runtimes.lock().unwrap().insert(runtime);

    let result = handle_terminal_channel_input(
        &app,
        json!({
            "runtime_id": "runtime-1",
            "input": "hello"
        }),
    );

    assert!(result.is_ok());
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path /home/spencer/workspace/coder-studio/apps/server/Cargo.toml terminal_channel_input_routes_to_runtime -- --nocapture`
Expected: FAIL because the handler does not exist.

- [ ] **Step 3: Add server-side terminal channel messages**

In `apps/server/src/ws/server.rs`, define a small handler path:

```rust
fn handle_terminal_channel_input(app: &AppHandle, payload: Value) -> Result<(), String> {
    let runtime_id = payload.get("runtime_id").and_then(Value::as_str).ok_or("runtime_id_missing")?;
    let input = payload.get("input").and_then(Value::as_str).ok_or("input_missing")?;
    crate::services::terminal_gateway::send_input(runtime_id, input, app.state())
}
```

Wire a new WS message type, for example:

```rust
"terminal_channel_input" => {
    handle_terminal_channel_input(app, payload).map_err(|error| {
        ws_input_error_envelope(workspace_id, "terminal_channel_input", &error)
    })?;
}
```

- [ ] **Step 4: Add terminal gateway send_input and output publish**

In `apps/server/src/services/terminal_gateway.rs`:

```rust
pub(crate) fn send_input(
    runtime_id: &str,
    input: &str,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let runtime = state
        .terminal_runtimes
        .lock()
        .map_err(|e| e.to_string())?
        .by_runtime_id(runtime_id)
        .cloned()
        .ok_or_else(|| "terminal_runtime_not_found".to_string())?;

    crate::services::tmux::send_tmux_input(&runtime.tmux_session_name, input)
}
```

Also add a helper to emit terminal channel output events when tmux output is read.

- [ ] **Step 5: Run focused WS tests to verify they pass**

Run:
```bash
cargo test --manifest-path /home/spencer/workspace/coder-studio/apps/server/Cargo.toml terminal_channel_input_routes_to_runtime -- --nocapture
cargo test --manifest-path /home/spencer/workspace/coder-studio/apps/server/Cargo.toml ws -- --nocapture
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/ws/server.rs apps/server/src/services/terminal_gateway.rs
git commit -m "feat: add terminal channel websocket transport"
```

---

### Task 4: Cut frontend session terminals over to terminal channel

**Files:**
- Create: `apps/web/src/services/terminal-channel/client.ts`
- Modify: `apps/web/src/services/http/session-runtime.service.ts`
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- Modify: `apps/web/src/features/workspace/workspace-sync-hooks.ts`
- Modify: `apps/web/src/types/app.ts`
- Test: `tests/terminal-channel.test.ts`
- Test: `tests/workspace-runtime-controller.test.ts`

- [ ] **Step 1: Write the failing frontend channel client test**

Create `tests/terminal-channel.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildTerminalChannelInput } from "../apps/web/src/services/terminal-channel/client";

test("buildTerminalChannelInput creates terminal channel message", () => {
  assert.deepEqual(
    buildTerminalChannelInput("runtime-1", "pwd\r"),
    {
      type: "terminal_channel_input",
      runtime_id: "runtime-1",
      input: "pwd\r",
    },
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/terminal-channel.test.ts`
Expected: FAIL because the client file does not exist.

- [ ] **Step 3: Implement the frontend channel client**

Create `apps/web/src/services/terminal-channel/client.ts`:

```ts
import { sendWsMessage, subscribeWsEvent } from "../../ws/client";

export const buildTerminalChannelInput = (runtimeId: string, input: string) => ({
  type: "terminal_channel_input" as const,
  runtime_id: runtimeId,
  input,
});

export const sendTerminalChannelInput = (runtimeId: string, input: string) =>
  sendWsMessage(buildTerminalChannelInput(runtimeId, input));

export const subscribeTerminalChannelOutput = (handler: (payload: {
  runtime_id: string;
  data: string;
}) => void) => subscribeWsEvent("terminal://channel_output", handler);
```

- [ ] **Step 4: Extend the runtime start result type**

In `apps/web/src/types/app.ts`:

```ts
export type SessionRuntimeStartResult = {
  terminal_id: number;
  started: boolean;
  boot_input?: string | null;
  terminal_runtime_id?: string | null;
};
```

- [ ] **Step 5: Cut WorkspaceScreen over from `boot_input` to runtime channel**

In `apps/web/src/features/workspace/WorkspaceScreen.tsx`, replace:

```ts
if (result.boot_input) {
  writeWorkspaceTerminalData(tab.id, tab.controller, terminalId, result.boot_input);
}
```

with logic that stores the returned `terminal_runtime_id` on the session and sends future xterm input via `sendTerminalChannelInput(...)`.

Use a minimal shape like:

```ts
if (result.terminal_runtime_id) {
  updateState((current) => ({
    ...current,
    tabs: current.tabs.map((item) => item.id !== tab.id ? item : {
      ...item,
      sessions: item.sessions.map((entry) => entry.id !== session.id ? entry : {
        ...entry,
        terminalRuntimeId: result.terminal_runtime_id,
      }),
    }),
  }));
}
```

- [ ] **Step 6: Subscribe to terminal channel output in workspace sync hooks**

In `apps/web/src/features/workspace/workspace-sync-hooks.ts`, add a subscription that records channel output into the existing pending stream index using `runtime_id -> terminalId/session` mapping.

- [ ] **Step 7: Run focused frontend tests to verify they pass**

Run:
```bash
node --test tests/terminal-channel.test.ts
pnpm test workspace-runtime-controller.test.ts
```
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/services/terminal-channel/client.ts apps/web/src/services/http/session-runtime.service.ts apps/web/src/features/workspace/WorkspaceScreen.tsx apps/web/src/features/workspace/workspace-sync-hooks.ts apps/web/src/types/app.ts tests/terminal-channel.test.ts tests/workspace-runtime-controller.test.ts
git commit -m "feat: attach session terminals through terminal channel"
```

---

### Task 5: Remove obsolete boot-input assumptions and verify integration

**Files:**
- Modify: `apps/server/src/command/http.rs`
- Modify: `apps/server/src/services/terminal.rs`
- Modify: `apps/server/src/services/workspace_runtime.rs`
- Modify: tests already touched above

- [ ] **Step 1: Write the failing integration test for backend-owned boot**

Add/update a server test:

```rust
#[test]
fn session_runtime_start_boots_provider_without_frontend_boot_input_write() {
    let app = test_app();
    let workspace_id = launch_test_workspace(&app, "/tmp/gateway-boot");
    let session = create_session(
        workspace_id.clone(),
        SessionMode::Branch,
        ProviderId::codex(),
        app.state(),
    )
    .unwrap();

    let result = session_runtime_start(
        SessionRuntimeStartParams {
            workspace_id,
            session_id: session.id.clone(),
            cols: Some(120),
            rows: Some(30),
        },
        app.clone(),
        app.state(),
    )
    .expect("runtime should start");

    assert!(result.boot_input.is_none());
    assert!(result.terminal_runtime_id.is_some());
}
```

- [ ] **Step 2: Run the test to verify it fails if old assumptions remain**

Run: `cargo test --manifest-path /home/spencer/workspace/coder-studio/apps/server/Cargo.toml session_runtime_start_boots_provider_without_frontend_boot_input_write -- --nocapture`
Expected: FAIL until old boot-input assumptions are removed.

- [ ] **Step 3: Remove stale boot-input test paths and compatibility-only logic**

Clean up code/tests that still assume the frontend must write the startup command. Keep `boot_input` in the type only if necessary for compatibility, but make all session-runtime tests assert `None` in the new path.

- [ ] **Step 4: Run focused regression**

Run:
```bash
cargo test --manifest-path /home/spencer/workspace/coder-studio/apps/server/Cargo.toml command::http -- --nocapture
cargo test --manifest-path /home/spencer/workspace/coder-studio/apps/server/Cargo.toml session_runtime -- --nocapture
pnpm test agent-pane-session.test.ts
pnpm test workspace-runtime-controller.test.ts
node --test tests/terminal-channel.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/command/http.rs apps/server/src/services/terminal.rs apps/server/src/services/workspace_runtime.rs apps/server/src/services/session_runtime.rs apps/web/src/features/workspace/WorkspaceScreen.tsx apps/web/src/features/workspace/workspace-sync-hooks.ts
git commit -m "refactor: remove boot input startup path"
```

---

## Self-Review

### Spec coverage
- Final architecture requirement “TerminalRuntime becomes runtime truth” → Task 1
- Backend-owned provider boot / remove `boot_input` → Task 2 and Task 5
- Dedicated terminal channel transport → Task 3 and Task 4
- xterm.js remains display layer → Task 4
- tmux as persistence layer → Task 1 and Task 2
- session references runtime instead of direct terminal semantics → Task 2 and Task 4

No major spec requirement in the scoped foundation slice is uncovered.

### Placeholder scan
- No `TODO`, `TBD`, or vague “implement later” markers remain inside task steps.
- Every task contains exact file paths, commands, and concrete code snippets.

### Type consistency
- `TerminalRuntime`, `TerminalRuntimeRegistry`, `TmuxRuntime`, `terminal_runtime_id`, and `terminal_channel_input` are named consistently across tasks.
- `boot_input` remains temporary compatibility output but is explicitly driven to `None` in the new path.

