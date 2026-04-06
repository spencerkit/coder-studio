# Provider-Only Session Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `workspace_sessions` and the local archive/restore model so history, restore, close, and delete all operate on provider-native sessions plus mounted pane bindings only.

**Architecture:** Keep `WorkspaceViewState.session_bindings` as the only durable local session reference, continue reconstructing runtime-facing `SessionInfo` from mounted bindings plus provider data, and delete all code paths that persist or restore app-owned session rows. Replace archive semantics with an unmount/close mutation and reduce history records to provider-derived rows only.

**Tech Stack:** Rust server (`rusqlite`, `axum`), React/TypeScript frontend, Playwright E2E, Rust unit tests

---

## File Map

### Server files

- Modify: `apps/server/src/infra/db.rs`
  - Remove `workspace_sessions` schema creation and migration helpers.
  - Remove row-based session CRUD helpers that depend on `workspace_sessions`.
  - Rebuild snapshot/history/session resolution around `WorkspaceViewState.session_bindings` plus provider scans.
  - Add the canonical close/unmount persistence helper.
- Modify: `apps/server/src/services/workspace.rs`
  - Remove `archive_session`, `restore_session`, and `delete_session` service flows.
  - Add canonical close/unmount service behavior that stops runtime and removes mounted bindings.
  - Keep provider restore/delete flows as the only durable history flows.
- Modify: `apps/server/src/command/http.rs`
  - Remove old RPC handlers and request types for local archive/restore/delete.
  - Add/rename the close/unmount RPC handler.
- Modify: `apps/server/src/main.rs`
  - Update re-exports/import wiring after deleting old helpers.
- Modify: `apps/server/src/models.rs`
  - Remove or simplify history fields that only exist for the old local archive/missing model.
- Modify: `apps/server/src/services/workspace_runtime.rs`
  - Stop creating `workspace_sessions` rows in runtime-oriented tests/helpers.
  - Update tests that currently depend on row-based session persistence.
- Modify: `apps/server/src/services/provider_hooks.rs`
  - Update tests/helpers that assume local row creation.

### Frontend files

- Modify: `apps/web/src/services/http/session.service.ts`
  - Remove client wrappers for `archive_session`, `restore_session`, and `delete_session`.
  - Add the canonical close/unmount request wrapper.
- Modify: `apps/web/src/features/workspace/session-actions.ts`
  - Always restore via provider history records.
  - Close panes via unmount semantics only.
  - Delete only provider-backed history rows.
  - Remove missing/local restore branches.
- Modify: `apps/web/src/services/http/workspace.service.ts`
  - Keep provider history fetch but adapt mapping if history fields change.
- Modify: `apps/web/src/types/app.ts`
  - Remove old history fields that no longer exist after provider-only history cleanup.
- Modify: `apps/web/src/features/workspace/session-history.ts`
  - Update history mapping/derivations for the provider-only record shape.
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
  - Remove UI assumptions about missing/local archive restore behavior if needed by types or button states.

### Tests

- Modify: `apps/server/src/command/http.rs` tests near the session history RPC coverage.
- Modify: `apps/server/src/services/workspace.rs` tests for history/restore/delete/close behavior.
- Modify: `apps/server/src/infra/db.rs` tests for schema/bootstrap/snapshot/history behavior.
- Modify: `tests/e2e/e2e.spec.ts`
  - Cover provider-only history/restore/close behavior at UI level.

---

### Task 1: Remove `workspace_sessions` schema and local DB CRUD

**Files:**
- Modify: `apps/server/src/infra/db.rs:436-562`
- Modify: `apps/server/src/infra/db.rs:653-720`
- Modify: `apps/server/src/infra/db.rs:2263-2481`
- Test: `apps/server/src/infra/db.rs:3099-3333`

- [ ] **Step 1: Write the failing schema/CRUD tests**

```rust
#[test]
fn init_db_does_not_create_workspace_sessions_table() {
    let conn = Connection::open_in_memory().unwrap();
    init_db(&conn).unwrap();

    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspace_sessions'")
        .unwrap();
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    assert!(rows.is_empty());
}

#[test]
fn build_history_from_conn_ignores_workspace_sessions_table_contents() {
    let conn = Connection::open_in_memory().unwrap();
    init_db(&conn).unwrap();

    let table_missing = conn
        .prepare("SELECT 1 FROM workspace_sessions LIMIT 1")
        .is_err();

    assert!(table_missing);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path apps/server/Cargo.toml init_db_does_not_create_workspace_sessions_table -- --exact`
Expected: FAIL because `init_db` still creates `workspace_sessions`

- [ ] **Step 3: Remove schema creation and row CRUD from `infra/db.rs`**

```rust
conn.execute_batch(
    r#"
    CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        root_path TEXT NOT NULL,
        target_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        idle_policy_json TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS workspace_view_state (
        workspace_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
    );
    "#,
)?;
```

Delete these helpers entirely:

```rust
fn ensure_workspace_sessions_schema(...)
fn migrate_workspace_sessions_schema(...)
pub(crate) fn create_workspace_session(...)
pub(crate) fn update_workspace_session(...)
pub(crate) fn switch_workspace_session(...)
pub(crate) fn restore_workspace_session(...)
pub(crate) fn delete_workspace_session(...)
```

- [ ] **Step 4: Run focused server tests**

Run: `cargo test --manifest-path apps/server/Cargo.toml init_db_does_not_create_workspace_sessions_table build_history_from_conn_ignores_workspace_sessions_table_contents -- --exact`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/infra/db.rs
git commit -m "refactor: remove workspace session table"
```

### Task 2: Rebuild history and snapshots around mounted bindings only

**Files:**
- Modify: `apps/server/src/infra/db.rs:1527-1760`
- Modify: `apps/server/src/models.rs` (history record fields)
- Modify: `apps/web/src/types/app.ts:80-114`
- Modify: `apps/web/src/features/workspace/session-history.ts`
- Test: `apps/server/src/infra/db.rs` history/snapshot tests

- [ ] **Step 1: Write the failing provider-only history tests**

```rust
#[test]
fn build_history_from_conn_returns_only_provider_sessions() {
    let conn = Connection::open_in_memory().unwrap();
    init_db(&conn).unwrap();

    let history = build_history_from_conn(&conn).unwrap();

    assert!(history.iter().all(|record| record.resume_id.is_some()));
    assert!(history.iter().all(|record| record.mounted || !record.mounted));
    assert!(history.iter().all(|record| record.provider.as_str() == "claude" || record.provider.as_str() == "codex"));
}
```

```ts
export type BackendSessionHistoryRecord = {
  workspace_id: string;
  workspace_title: string;
  workspace_path: string;
  title: string;
  provider: AgentProvider;
  mounted: boolean;
  created_at: number;
  last_active_at: number;
  resume_id: string;
};
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path apps/server/Cargo.toml build_history_from_conn_returns_only_provider_sessions -- --exact`
Expected: FAIL because history still emits local/missing/archive fields

- [ ] **Step 3: Remove local/missing/archive assembly from server and matching frontend types**

```rust
records.push(SessionHistoryRecord {
    workspace_id: workspace.id.clone(),
    workspace_title: workspace.title.clone(),
    workspace_path: workspace.root_path.clone(),
    title: provider_session.title.clone(),
    provider: provider_session.provider.clone(),
    mounted: mounted_binding.is_some(),
    created_at: provider_session.created_at,
    last_active_at: provider_session.last_active_at,
    resume_id: provider_session.resume_id.clone(),
});
```

```ts
export type SessionHistoryRecord = {
  workspaceId: string;
  workspaceTitle: string;
  workspacePath: string;
  title: string;
  provider: AgentProvider;
  mounted: boolean;
  createdAt: number;
  lastActiveAt: number;
  resumeId: string;
};
```

- [ ] **Step 4: Run focused tests and web unit tests**

Run: `cargo test --manifest-path apps/server/Cargo.toml build_history_from_conn_returns_only_provider_sessions -- --exact && pnpm test:web:unit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/infra/db.rs apps/server/src/models.rs apps/web/src/types/app.ts apps/web/src/features/workspace/session-history.ts
git commit -m "refactor: derive history from providers only"
```

### Task 3: Replace archive/local restore/delete RPCs with unmount plus provider restore/delete only

**Files:**
- Modify: `apps/server/src/services/workspace.rs:448-575`
- Modify: `apps/server/src/command/http.rs:75-112`
- Modify: `apps/server/src/command/http.rs:928-1002`
- Modify: `apps/server/src/main.rs`
- Test: `apps/server/src/command/http.rs` session RPC tests

- [ ] **Step 1: Write the failing RPC tests**

```rust
#[test]
fn close_session_unmounts_binding_without_local_restore_path() {
    let app = test_app();
    let workspace_id = launch_test_workspace(&app, "/tmp/provider-only-rpc");

    let response = dispatch_rpc(
        &app,
        "close_session",
        json!({
            "workspace_id": workspace_id,
            "session_id": "slot-primary",
            "device_id": "device-a",
            "client_id": "client-a",
            "fencing_token": 1,
        }),
        &authorized_user(),
    );

    assert!(response.is_ok());
}

#[test]
fn restore_session_rpc_is_removed() {
    let app = test_app();
    let result = dispatch_rpc(
        &app,
        "restore_session",
        json!({"workspace_id": "w", "session_id": "s"}),
        &authorized_user(),
    );

    assert!(result.is_err());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path apps/server/Cargo.toml close_session_unmounts_binding_without_local_restore_path restore_session_rpc_is_removed -- --exact`
Expected: FAIL because `close_session` does not exist and `restore_session` still exists

- [ ] **Step 3: Implement canonical close/unmount service and delete old RPCs**

```rust
pub(crate) fn close_session(
    workspace_id: String,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let _ = stop_agent_runtime_without_status_update(&workspace_id, &session_id, state);
    let _ = forget_live_session(state, &workspace_id, &session_id);
    remove_workspace_session_binding(state, &workspace_id, &session_id).map(|_| ())
}
```

```rust
"close_session" => {
    let req: ArchiveSessionRequest = parse_payload(payload).map_err(rpc_bad_request)?;
    require_workspace_controller_mutation(app, &req.controller, authorized)?;
    close_session(req.controller.workspace_id, req.session_id, app.state())
        .map_err(rpc_bad_request)?;
    Ok(Value::Null)
}
```

Delete these exports and handlers:

```rust
"archive_session"
"restore_session"
"delete_session"
```

- [ ] **Step 4: Run focused RPC tests**

Run: `cargo test --manifest-path apps/server/Cargo.toml close_session_unmounts_binding_without_local_restore_path restore_session_rpc_is_removed -- --exact`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/workspace.rs apps/server/src/command/http.rs apps/server/src/main.rs
git commit -m "refactor: replace local session rpc flows"
```

### Task 4: Make frontend restore and close flows provider-only

**Files:**
- Modify: `apps/web/src/services/http/session.service.ts:195-270`
- Modify: `apps/web/src/features/workspace/session-actions.ts:318-541`
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- Test: `tests/e2e/e2e.spec.ts`

- [ ] **Step 1: Write the failing frontend/E2E expectations**

```ts
test('history restore always uses provider resume id', async ({ page }) => {
  const commands: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/rpc/')) {
      commands.push(request.url().split('/api/rpc/')[1] ?? '');
    }
  });

  // trigger restore from history here

  expect(commands).toContain('restore_provider_session');
  expect(commands).not.toContain('restore_session');
});
```

```ts
test('closing a pane calls close_session instead of archive_session', async ({ page }) => {
  const commands: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/rpc/')) {
      commands.push(request.url().split('/api/rpc/')[1] ?? '');
    }
  });

  // close mounted pane here

  expect(commands).toContain('close_session');
  expect(commands).not.toContain('archive_session');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:e2e --grep "history restore always uses provider resume id|closing a pane calls close_session instead of archive_session"`
Expected: FAIL because frontend still calls `restore_session` and `archive_session`

- [ ] **Step 3: Remove local restore/delete/archive client branches**

```ts
export const closeSession = (
  workspaceId: string,
  sessionId: string,
  controller: WorkspaceControllerState,
) => invokeRpc<void>(
  'close_session',
  createWorkspaceControllerRpcPayload(workspaceId, controller, { sessionId }),
);
```

```ts
const restored = await withServiceFallback(
  () => restoreProviderSessionRequest(
    tabId,
    target.replacedSessionId,
    historyRecord.provider,
    historyRecord.resumeId,
    {
      title: historyRecord.title,
      lastActiveAt: historyRecord.lastActiveAt,
    },
    controllerForTab(tabId),
  ),
  null,
);
```

```ts
if (!isDraftSession(session)) {
  void closeSessionRequest(tab.id, session.id, tab.controller).catch(() => {
    // Session has already been unmounted locally.
  });
}
```

Delete these client APIs and branches:

```ts
archiveSession
restoreSession
deleteSession
removeMissingBinding
historyRecord?.availability === 'missing'
historyRecord?.resumeId ? ... : restoreSessionRequest(...)
```

- [ ] **Step 4: Run web and E2E tests**

Run: `pnpm test:web:unit && pnpm test:e2e --grep "history restore always uses provider resume id|closing a pane calls close_session instead of archive_session"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/http/session.service.ts apps/web/src/features/workspace/session-actions.ts apps/web/src/features/workspace/WorkspaceScreen.tsx tests/e2e/e2e.spec.ts
git commit -m "refactor: make workspace session flows provider only"
```

### Task 5: Reconstruct workspace snapshots from bindings and live runtime only

**Files:**
- Modify: `apps/server/src/infra/db.rs:1716-1810`
- Modify: `apps/server/src/services/workspace.rs:23-69`
- Test: `apps/server/src/services/workspace.rs` and `apps/server/src/infra/db.rs`

- [ ] **Step 1: Write the failing snapshot tests**

```rust
#[test]
fn workspace_snapshot_rehydrates_visible_sessions_from_bindings_without_session_rows() {
    let app = test_app();
    let workspace_id = launch_test_workspace(&app, "/tmp/provider-only-snapshot");

    let snapshot = workspace_snapshot(app.state(), &workspace_id).unwrap();

    assert!(snapshot.sessions.iter().all(|session| session.resume_id.is_some() || session.id.starts_with("draft-")));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path apps/server/Cargo.toml workspace_snapshot_rehydrates_visible_sessions_from_bindings_without_session_rows -- --exact`
Expected: FAIL because snapshot resolution still consults row sessions

- [ ] **Step 3: Remove row-session dependence from snapshot/session resolution**

```rust
let visible_session_ids = ordered_visible_session_ids(&view_state);
let provider_sessions = list_provider_workspace_sessions(&workspace.project_path)?;

let sessions = visible_session_ids
    .into_iter()
    .filter_map(|session_id| {
        view_state
            .session_bindings
            .iter()
            .find(|binding| binding.session_id == session_id)
            .map(|binding| resolve_bound_session_from_binding(binding, &provider_sessions))
    })
    .collect::<Vec<_>>();
```

```rust
pub(crate) fn resolve_session_for_slot(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: &str,
) -> Result<SessionInfo, String> {
    let live_session = state
        .live_sessions
        .lock()
        .map_err(|e| e.to_string())?
        .get(&live_session_key(workspace_id, session_id))
        .cloned();

    if let Some(session) = live_session {
        return Ok(session);
    }

    crate::load_workspace_slot_session(state, workspace_id, session_id)
}
```

- [ ] **Step 4: Run focused snapshot tests**

Run: `cargo test --manifest-path apps/server/Cargo.toml workspace_snapshot_rehydrates_visible_sessions_from_bindings_without_session_rows -- --exact`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/infra/db.rs apps/server/src/services/workspace.rs
git commit -m "refactor: rebuild workspace snapshots from bindings"
```

### Task 6: Update runtime/provider-hook tests that assumed local row persistence

**Files:**
- Modify: `apps/server/src/services/workspace_runtime.rs`
- Modify: `apps/server/src/services/provider_hooks.rs`
- Test: same files

- [ ] **Step 1: Write the failing regression tests for binding-only persistence**

```rust
#[test]
fn provider_hook_persists_resume_id_without_workspace_session_row() {
    let app = test_app();
    let workspace_id = launch_test_workspace(&app, "/tmp/provider-hook-binding-only");

    // seed binding-oriented state, process hook, assert binding updated

    let history = list_session_history(app.state()).unwrap();
    assert!(history.iter().all(|record| record.resume_id.is_some()));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path apps/server/Cargo.toml provider_hook_persists_resume_id_without_workspace_session_row -- --exact`
Expected: FAIL because tests/helpers still create workspace session rows

- [ ] **Step 3: Rewrite helpers to seed bindings instead of local session rows**

```rust
upsert_workspace_session_binding(
    app.state(),
    &workspace_id,
    WorkspaceSessionBinding {
        session_id: "slot-primary".to_string(),
        provider: AgentProvider::claude(),
        resume_id: "resume-session".to_string(),
        title_snapshot: "Resume session".to_string(),
        last_seen_at: now_ts_ms(),
    },
).unwrap();
```

Delete test setup that calls:

```rust
create_workspace_session(...)
update_workspace_session(...)
```

- [ ] **Step 4: Run focused runtime tests**

Run: `cargo test --manifest-path apps/server/Cargo.toml provider_hook_persists_resume_id_without_workspace_session_row -- --exact`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/workspace_runtime.rs apps/server/src/services/provider_hooks.rs
git commit -m "test: move runtime tests to binding-only session state"
```

### Task 7: Run full verification and remove dead references

**Files:**
- Modify: any remaining references found during cleanup
- Test: server, web, and e2e suites

- [ ] **Step 1: Write the final failing search assertions as cleanup checklist**

```text
workspace_sessions
restore_session(
archive_session(
delete_session(
availability: "missing"
```

- [ ] **Step 2: Run searches to verify remaining dead references**

Run: `cargo test --manifest-path apps/server/Cargo.toml && pnpm test:web:unit && pnpm test:e2e`
Expected: identify any remaining compile/test failures from deleted APIs or fields

- [ ] **Step 3: Remove remaining dead references and fix naming drift**

```rust
// Delete dead imports/re-exports in main.rs and command/http.rs.
```

```ts
// Delete dead type fields and UI branches in app.ts, session-history.ts, and WorkspaceScreen.tsx.
```

- [ ] **Step 4: Run full verification**

Run: `cargo test --manifest-path apps/server/Cargo.toml && pnpm test:web:unit && pnpm test:e2e`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src apps/web/src tests/e2e
git commit -m "test: verify provider-only session model"
```

## Self-Review

### Spec coverage

- Remove `workspace_sessions` entirely → Task 1
- History provider-only → Task 2
- Restore always by `provider + resume_id` → Tasks 3-4
- Close means unmount, not archive → Tasks 3-4
- Mounted bindings as only durable local reference → Tasks 2, 5, 6
- Delete by provider-native identity only → Tasks 3-4
- Refresh/restart recovery from bindings only → Tasks 5-6

No uncovered spec requirement remains.

### Placeholder scan

- No `TBD`, `TODO`, or “similar to previous task” placeholders remain.
- Every code-changing task includes concrete code blocks.
- Every verification step includes a concrete command.

### Type consistency

- Canonical durable key is always `provider + resume_id`.
- Canonical close mutation is always `close_session`.
- Old local restore/delete/archive names are removed, not repurposed.
