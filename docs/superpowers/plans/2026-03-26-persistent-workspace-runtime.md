# Persistent Workspace Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a `workspace` reattachable across refresh/browser/device with a single controller, strict observers, replayable `agent`/`shell` state, and backend-owned shared workbench state.

**Architecture:** Introduce a backend workspace-runtime control plane that persists controller leases, attachments, shared workbench view state, shell replay buffers, and agent lifecycle replay metadata. Then move the frontend to bootstrap from runtime snapshots and treat controller/observer role as a first-class state constraint for every mutating workspace action.

**Tech Stack:** Rust (`axum`, `rusqlite`, `tokio`, `portable_pty`), React/TypeScript, Relax State, Node test runner, Playwright.

---

## File Structure

**Backend**
- Modify: `apps/server/src/models.rs`
- Modify: `apps/server/src/app.rs`
- Modify: `apps/server/src/command/http.rs`
- Modify: `apps/server/src/ws/server.rs`
- Modify: `apps/server/src/infra/db.rs`
- Modify: `apps/server/src/services/workspace.rs`
- Modify: `apps/server/src/services/agent.rs`
- Modify: `apps/server/src/services/terminal.rs`
- Create: `apps/server/src/services/workspace_runtime.rs`
- Create: `apps/server/tests/workspace_runtime_state.rs`
- Create: `apps/server/tests/workspace_runtime_controller.rs`

**Frontend**
- Modify: `apps/web/src/types/app.ts`
- Modify: `apps/web/src/services/http/workspace.service.ts`
- Modify: `apps/web/src/command/workspace.command.ts`
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- Modify: `apps/web/src/features/workspace/workspace-sync-hooks.ts`
- Modify: `apps/web/src/shared/utils/workspace.ts`
- Modify: `apps/web/src/state/workbench-core.ts`
- Create: `apps/web/src/features/workspace/workspace-controller.ts`
- Create: `tests/workspace-runtime-controller.test.ts`

**End-to-end**
- Modify: `tests/e2e/transport.spec.ts`

## Constraints

- Do **not** create git commits during execution; the user asked to defer commits.
- Backend is the shared truth source for controller state and runtime snapshots.
- This rollout must finish the user-visible continuity path while the backend remains alive.
- If true post-restart shell process reattachment is not technically possible without a daemon/multiplexer, land explicit `recoverable` / `unrecoverable` runtime state instead of silently fabricating continuity.

### Task 1: Add Workspace Runtime Persistence And Replay Tables

**Files:**
- Modify: `apps/server/src/models.rs`
- Modify: `apps/server/src/infra/db.rs`
- Create: `apps/server/src/services/workspace_runtime.rs`
- Create: `apps/server/tests/workspace_runtime_state.rs`

- [ ] **Step 1: Write the failing Rust integration test for runtime persistence**

```rust
use coder_studio::infra::db::init_db;
use coder_studio::services::workspace_runtime::{
    append_shell_runtime_chunk_for_test,
    ensure_workspace_runtime_for_test,
    load_shell_runtime_chunks_for_test,
    load_workspace_controller_lease_for_test,
    save_workspace_controller_lease_for_test,
};

#[test]
fn workspace_runtime_persists_controller_lease_and_shell_chunks() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    init_db(&conn).unwrap();

    let runtime = ensure_workspace_runtime_for_test(&conn, "ws-1").unwrap();
    save_workspace_controller_lease_for_test(&conn, runtime.id.as_str(), "device-a", "client-a", 2).unwrap();
    append_shell_runtime_chunk_for_test(&conn, "shell-main", 1, "hello").unwrap();

    let lease = load_workspace_controller_lease_for_test(&conn, runtime.id.as_str()).unwrap().unwrap();
    let chunks = load_shell_runtime_chunks_for_test(&conn, "shell-main", 16).unwrap();

    assert_eq!(lease.fencing_token, 2);
    assert_eq!(chunks[0].chunk, "hello");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path apps/server/Cargo.toml workspace_runtime_persists_controller_lease_and_shell_chunks`
Expected: FAIL with missing runtime helpers or missing tables.

- [ ] **Step 3: Add backend models for runtime, controller lease, attachment, and shell replay chunks**

```rust
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorkspaceRuntimeRecord {
    pub id: String,
    pub workspace_id: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_attached_at: i64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorkspaceControllerLease {
    pub workspace_runtime_id: String,
    pub controller_device_id: Option<String>,
    pub controller_client_id: Option<String>,
    pub lease_expires_at: i64,
    pub fencing_token: i64,
    pub takeover_request_id: Option<String>,
    pub takeover_requested_by_device_id: Option<String>,
    pub takeover_requested_by_client_id: Option<String>,
    pub takeover_deadline_at: Option<i64>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ShellRuntimeChunk {
    pub shell_runtime_session_id: String,
    pub seq: i64,
    pub chunk: String,
}
```

- [ ] **Step 4: Extend `init_db` with runtime persistence tables**

```rust
conn.execute_batch(
    "
    CREATE TABLE IF NOT EXISTS workspace_runtimes (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_attached_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_controller_leases (
        workspace_runtime_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_attachments (
        attachment_id TEXT PRIMARY KEY,
        workspace_runtime_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        role TEXT NOT NULL,
        attached_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        detached_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS shell_runtime_chunks (
        shell_runtime_session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        chunk TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(shell_runtime_session_id, seq)
    );
    CREATE TABLE IF NOT EXISTS agent_runtime_events (
        agent_runtime_session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(agent_runtime_session_id, seq)
    );
    "
).map_err(|e| e.to_string())?;
```

- [ ] **Step 5: Implement storage helpers in `workspace_runtime.rs`**

```rust
pub(crate) fn ensure_workspace_runtime(state: State<'_, AppState>, workspace_id: &str) -> Result<WorkspaceRuntimeRecord, String>;
pub(crate) fn load_workspace_controller_lease(state: State<'_, AppState>, workspace_runtime_id: &str) -> Result<Option<WorkspaceControllerLease>, String>;
pub(crate) fn save_workspace_controller_lease(state: State<'_, AppState>, lease: &WorkspaceControllerLease) -> Result<(), String>;
pub(crate) fn append_shell_runtime_chunk(state: State<'_, AppState>, shell_runtime_session_id: &str, seq: i64, chunk: &str) -> Result<(), String>;
pub(crate) fn load_shell_runtime_chunks(state: State<'_, AppState>, shell_runtime_session_id: &str, limit: usize) -> Result<Vec<ShellRuntimeChunk>, String>;
```

- [ ] **Step 6: Re-run the persistence test and verify it passes**

Run: `cargo test --manifest-path apps/server/Cargo.toml workspace_runtime_persists_controller_lease_and_shell_chunks`
Expected: PASS

### Task 2: Add Controller Acquire / Heartbeat / Takeover APIs And WS Events

**Files:**
- Create: `apps/server/tests/workspace_runtime_controller.rs`
- Modify: `apps/server/src/models.rs`
- Modify: `apps/server/src/command/http.rs`
- Modify: `apps/server/src/ws/server.rs`
- Modify: `apps/server/src/services/workspace.rs`
- Create: `apps/server/src/services/workspace_runtime.rs`

- [ ] **Step 1: Write the failing Rust integration test for timeout-based takeover**

```rust
use coder_studio::infra::db::init_db;
use coder_studio::services::workspace_runtime::{
    acquire_workspace_controller_for_test,
    ensure_workspace_runtime_for_test,
    expire_workspace_controller_lease_for_test,
    load_workspace_controller_lease_for_test,
    maybe_finalize_workspace_takeover_for_test,
    request_workspace_takeover_for_test,
};

#[test]
fn workspace_controller_times_out_and_transfers_to_requester() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    init_db(&conn).unwrap();

    let runtime = ensure_workspace_runtime_for_test(&conn, "ws-1").unwrap();
    acquire_workspace_controller_for_test(&conn, runtime.id.as_str(), "device-a", "client-a", 10).unwrap();
    request_workspace_takeover_for_test(&conn, runtime.id.as_str(), "device-b", "client-b", 10).unwrap();
    expire_workspace_controller_lease_for_test(&conn, runtime.id.as_str()).unwrap();
    maybe_finalize_workspace_takeover_for_test(&conn, runtime.id.as_str(), 20).unwrap();

    let lease = load_workspace_controller_lease_for_test(&conn, runtime.id.as_str()).unwrap().unwrap();
    assert_eq!(lease.controller_device_id.as_deref(), Some("device-b"));
    assert_eq!(lease.fencing_token, 2);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path apps/server/Cargo.toml workspace_controller_times_out_and_transfers_to_requester`
Expected: FAIL with missing controller helpers.

- [ ] **Step 3: Add request/response models for runtime attach and controller mutation**

```rust
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorkspaceAttachment {
    pub attachment_id: String,
    pub workspace_runtime_id: String,
    pub device_id: String,
    pub client_id: String,
    pub role: String,
    pub attached_at: i64,
    pub last_seen_at: i64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorkspaceRuntimeSnapshot {
    pub runtime: WorkspaceRuntimeRecord,
    pub controller: WorkspaceControllerLease,
    pub attachments: Vec<WorkspaceAttachment>,
    pub workbench_state: WorkspaceViewState,
    pub shell_replay: Vec<ShellRuntimeChunk>,
}
```

- [ ] **Step 4: Implement acquire/heartbeat/takeover/reject/finalize helpers**

```rust
pub(crate) fn acquire_workspace_controller(
    state: State<'_, AppState>,
    workspace_id: &str,
    device_id: &str,
    client_id: &str,
) -> Result<WorkspaceControllerLease, String>;

pub(crate) fn heartbeat_workspace_controller(
    state: State<'_, AppState>,
    workspace_id: &str,
    device_id: &str,
    client_id: &str,
) -> Result<WorkspaceControllerLease, String>;

pub(crate) fn request_workspace_takeover(
    state: State<'_, AppState>,
    workspace_id: &str,
    device_id: &str,
    client_id: &str,
) -> Result<WorkspaceControllerLease, String>;
```

- [ ] **Step 5: Add RPC dispatch and WS event emission**

```rust
match command.as_str() {
    "workspace_runtime_attach" => serde_json::to_value(workspace_runtime_attach(req.workspace_id, req.device_id, req.client_id, app.state()))?,
    "workspace_controller_acquire" => serde_json::to_value(workspace_controller_acquire(req.workspace_id, req.device_id, req.client_id, app.state()))?,
    "workspace_controller_heartbeat" => serde_json::to_value(workspace_controller_heartbeat(req.workspace_id, req.device_id, req.client_id, app.state()))?,
    "workspace_controller_takeover" => serde_json::to_value(workspace_controller_takeover(req.workspace_id, req.device_id, req.client_id, app.state()))?,
    "workspace_controller_reject_takeover" => serde_json::to_value(workspace_controller_reject_takeover(req.workspace_id, req.device_id, req.client_id, app.state()))?,
    _ => existing_dispatch(command, payload, app)?,
}
```

- [ ] **Step 6: Re-run the takeover test and verify it passes**

Run: `cargo test --manifest-path apps/server/Cargo.toml workspace_controller_times_out_and_transfers_to_requester`
Expected: PASS

### Task 3: Persist Shell Replay And Agent Lifecycle Replay Into Runtime Snapshots

**Files:**
- Modify: `apps/server/src/services/terminal.rs`
- Modify: `apps/server/src/services/agent.rs`
- Modify: `apps/server/src/services/workspace.rs`
- Create: `apps/server/src/services/workspace_runtime.rs`
- Modify: `apps/server/src/infra/db.rs`
- Modify: `tests/e2e/transport.spec.ts`

- [ ] **Step 1: Add the failing Playwright test for refresh reattach replay**

```ts
test('refresh reattaches to the same shell replay and controller state', async ({ page }) => {
  const workspace = await openWorkspace(page);
  await invokeRpc(page, 'workspace_runtime_attach', {
    workspaceId: workspace.workspaceId,
    deviceId: 'device-a',
    clientId: 'client-a',
  });
  const terminal = await invokeRpc<{ id: number }>(page, 'terminal_create', {
    workspaceId: workspace.workspaceId,
    cwd: workspace.workspacePath,
    target: workspace.target,
  });
  await invokeRpc(page, 'terminal_write', {
    workspaceId: workspace.workspaceId,
    terminalId: terminal.id,
    input: 'echo refresh-reattach\n',
  });
  await page.reload();
  const snapshot = await invokeRpc<any>(page, 'workspace_runtime_attach', {
    workspaceId: workspace.workspaceId,
    deviceId: 'device-a',
    clientId: 'client-b',
  });
  expect(JSON.stringify(snapshot.shell_replay)).toContain('refresh-reattach');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm playwright test tests/e2e/transport.spec.ts --grep "refresh reattaches to the same shell replay and controller state"`
Expected: FAIL because runtime snapshots do not yet include replay buffers.

- [ ] **Step 3: Persist shell output chunks from terminal reader threads**

```rust
let next_seq = next_shell_output_seq(state, &shell_runtime_id)?;
append_shell_runtime_chunk(state, &shell_runtime_id, next_seq, &text)?;
emit_terminal(&app_handle, &workspace_id_out, terminal_id, &text);
```

- [ ] **Step 4: Persist agent lifecycle events together with stream updates**

```rust
append_agent_runtime_event(state, &agent_runtime_id, next_seq, kind, data)?;
emit_agent_lifecycle(app, &workspace_id, &session_id, kind, source_event, data);
```

- [ ] **Step 5: Build runtime snapshots with shell replay and latest agent lifecycle state**

```rust
WorkspaceRuntimeSnapshot {
    runtime,
    controller,
    attachments,
    workbench_state,
    shell_replay: load_shell_runtime_chunks(state, main_shell_runtime_id.as_str(), 256)?,
}
```

- [ ] **Step 6: Re-run the replay test and verify it passes**

Run: `pnpm playwright test tests/e2e/transport.spec.ts --grep "refresh reattaches to the same shell replay and controller state"`
Expected: PASS

### Task 4: Make Frontend Runtime-Attached And Enforce Observer Read-Only Mode

**Files:**
- Modify: `apps/web/src/types/app.ts`
- Modify: `apps/web/src/services/http/workspace.service.ts`
- Modify: `apps/web/src/command/workspace.command.ts`
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- Modify: `apps/web/src/features/workspace/workspace-sync-hooks.ts`
- Modify: `apps/web/src/shared/utils/workspace.ts`
- Modify: `apps/web/src/state/workbench-core.ts`
- Create: `apps/web/src/features/workspace/workspace-controller.ts`
- Create: `tests/workspace-runtime-controller.test.ts`

- [ ] **Step 1: Write the failing frontend unit test for observer write blocking**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { canMutateWorkspace, createWorkspaceControllerState } from '../apps/web/src/features/workspace/workspace-controller.ts';

test('observer role blocks session switches and shell input', () => {
  const controller = createWorkspaceControllerState({ role: 'observer', fencingToken: 1 });
  assert.equal(canMutateWorkspace(controller, 'switch_session'), false);
  assert.equal(canMutateWorkspace(controller, 'shell_input'), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/workspace-runtime-controller.test.ts`
Expected: FAIL because controller helpers do not exist yet.

- [ ] **Step 3: Add runtime/controller types and HTTP helpers**

```ts
export type WorkspaceControllerState = {
  role: 'controller' | 'observer';
  deviceId: string;
  clientId: string;
  fencingToken: number;
  takeoverPending: boolean;
};

export const attachWorkspaceRuntime = (workspaceId: string, deviceId: string, clientId: string) =>
  invokeRpc<WorkspaceRuntimeSnapshot>('workspace_runtime_attach', { workspaceId, deviceId, clientId });
```

- [ ] **Step 4: Store controller metadata on tabs and gate mutating UI/actions**

```ts
export type Tab = {
  id: string;
  title: string;
  controller: WorkspaceControllerState;
  // existing tab fields remain below
};

export const canMutateWorkspace = (
  controller: WorkspaceControllerState,
  action: 'switch_session' | 'shell_input' | 'agent_input' | 'switch_pane'
) => controller.role === 'controller';
```

- [ ] **Step 5: Bootstrap from runtime attach snapshots and subscribe to controller WS events**

```ts
const runtimeSnapshot = await attachWorkspaceRuntime(routeWorkspaceId, deviceId, clientId);
updateState((current) => applyWorkspaceRuntimeSnapshot(current, runtimeSnapshot, locale, appSettings));

const unsubscribe = subscribeWorkspaceController((payload) => {
  updateState((current) => applyWorkspaceControllerEvent(current, payload));
});
```

- [ ] **Step 6: Re-run the frontend controller test and affected session tests**

Run: `node --test tests/workspace-runtime-controller.test.ts tests/session-actions.test.ts`
Expected: PASS

### Task 5: Add Multi-Page E2E Coverage And Run Targeted Verification

**Files:**
- Modify: `tests/e2e/transport.spec.ts`
- Create: `tests/workspace-runtime-controller.test.ts`
- Create: `apps/server/tests/workspace_runtime_state.rs`
- Create: `apps/server/tests/workspace_runtime_controller.rs`

- [ ] **Step 1: Add the failing multi-page E2E scenario for observer sync and takeover**

```ts
test('observer follows controller and takeover succeeds after timeout', async ({ browser }) => {
  const controller = await browser.newPage();
  const observer = await browser.newPage();
  const workspace = await openWorkspace(controller);

  await invokeRpc(controller, 'workspace_runtime_attach', {
    workspaceId: workspace.workspaceId,
    deviceId: 'device-a',
    clientId: 'client-a',
  });
  await invokeRpc(observer, 'workspace_runtime_attach', {
    workspaceId: workspace.workspaceId,
    deviceId: 'device-b',
    clientId: 'client-b',
  });

  await expect(observer.getByTestId('workspace-read-only-banner')).toBeVisible();
  await invokeRpc(observer, 'workspace_controller_takeover', {
    workspaceId: workspace.workspaceId,
    deviceId: 'device-b',
    clientId: 'client-b',
  });
  await controller.close();
  await expect.poll(() => invokeRpc(observer, 'workbench_bootstrap', {})).toBeTruthy();
});
```

- [ ] **Step 2: Run the new E2E test and verify it passes**

Run: `pnpm playwright test tests/e2e/transport.spec.ts --grep "observer follows controller and takeover succeeds after timeout"`
Expected: PASS

- [ ] **Step 3: Run the targeted backend, frontend, and transport verification suite**

Run: `cargo test --manifest-path apps/server/Cargo.toml workspace_runtime_`
Expected: PASS

Run: `node --test tests/workspace-runtime-controller.test.ts tests/session-actions.test.ts tests/app-settings.test.ts tests/completion-reminders.test.ts tests/workbench-settings-sync.test.ts`
Expected: PASS

Run: `pnpm playwright test tests/e2e/transport.spec.ts`
Expected: PASS

Run: `pnpm build:web`
Expected: PASS

### Task 6: Reconcile Runtime Recovery Semantics With The Approved Spec

**Files:**
- Modify: `docs/superpowers/specs/2026-03-26-persistent-workspace-runtime-design.md`
  - Only if implementation proves a narrower guarantee.

- [ ] **Step 1: Compare shipped behavior with the spec checklist**

```md
- Refresh/browser/device attach works
- Single controller semantics enforced
- Observer strict-follow mode enforced
- Shell replay persists across reattach
- Agent lifecycle replay persists across reattach
- Backend restart behavior is explicit, never silent
```

- [ ] **Step 2: If true post-restart shell process reattachment is not shipped, record the exact current guarantee**

```md
Current guarantee example:
- Reattach across refresh/browser/device is supported while the backend stays alive.
- Backend restart restores runtime metadata and explicit `recoverable` / `unrecoverable` state.
- Existing shell processes are not silently claimed to survive restart if no durable runtime daemon exists.
```

- [ ] **Step 3: Re-run the most relevant verification after any clarification**

Run: `cargo test --manifest-path apps/server/Cargo.toml workspace_runtime_`
Expected: PASS
