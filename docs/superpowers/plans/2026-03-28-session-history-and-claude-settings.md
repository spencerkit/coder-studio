# Session History And Claude Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a global session history drawer with archive/restore/delete flows, plus a backend-persisted Claude settings center that replaces the old launch-command setting.

**Architecture:** Keep the server as the source of truth for both settings and session history. Add backend RPCs for history and settings, move Claude launch resolution to the backend, then layer focused frontend helpers and UI components on top of existing `WorkspaceScreen`, `TopBar`, and `Settings` surfaces.

**Tech Stack:** Rust (`axum`, `rusqlite`, existing server test harness), React 19 + TypeScript, node:test, Playwright, Vite

---

## File Map

### Create

- `apps/server/src/services/app_settings.rs` — server-side settings CRUD, defaults, legacy migration helpers, and Claude target-profile resolution.
- `apps/web/src/services/http/settings.service.ts` — frontend RPC wrappers for `app_settings_get` and `app_settings_update`.
- `apps/web/src/shared/app/claude-settings.ts` — normalize/merge/serialize Claude settings and target override helpers for the web app.
- `apps/web/src/features/workspace/session-history.ts` — group, sort, and filter global session history records for the drawer and restore chooser.
- `apps/web/src/features/workspace/session-restore-chooser.ts` — pane-local filtering and action selection for “restore into this pane”.
- `apps/web/src/components/HistoryDrawer/HistoryDrawer.tsx` — left drawer UI for grouped session history.
- `apps/web/src/components/HistoryDrawer/index.ts` — barrel export.
- `apps/web/src/components/Settings/ClaudeSettingsPanel.tsx` — dedicated Claude settings panel with structured sections and advanced JSON editors.
- `tests/claude-settings.test.ts` — node tests for Claude settings merge, target override resolution, and advanced JSON preservation.
- `tests/session-history.test.ts` — node tests for history grouping, sorting, active/focus action selection, and recoverable filtering.
- `tests/session-restore-chooser.test.ts` — node tests for “restore from current workspace history” filtering rules.

### Modify

- `apps/server/src/models.rs`
- `apps/server/src/infra/db.rs`
- `apps/server/src/services/agent.rs`
- `apps/server/src/services/claude.rs`
- `apps/server/src/services/workspace.rs`
- `apps/server/src/command/http.rs`
- `apps/server/src/main.rs`
- `apps/web/src/types/app.ts`
- `apps/web/src/shared/app/settings.ts`
- `apps/web/src/features/app/AppController.tsx`
- `apps/web/src/features/app/WorkbenchRuntimeCoordinator.tsx`
- `apps/web/src/components/TopBar/TopBar.tsx`
- `apps/web/src/components/Settings/Settings.tsx`
- `apps/web/src/features/settings/SettingsScreen.tsx`
- `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- `apps/web/src/features/workspace/session-actions.ts`
- `apps/web/src/services/http/agent.service.ts`
- `apps/web/src/services/http/session.service.ts`
- `apps/web/src/services/http/workspace.service.ts`
- `apps/web/src/shared/utils/workspace.ts`
- `apps/web/src/components/icons.tsx`
- `apps/web/src/styles/app.css`
- `tests/app-settings.test.ts`
- `tests/session-actions.test.ts`
- `tests/e2e/e2e.spec.ts`

### Delete

- `apps/web/src/features/app/workbench-settings-sync.ts` — obsolete once app settings stop mutating live workspace tabs.
- `tests/workbench-settings-sync.test.ts` — obsolete with the file above.

## Task 1: Add Server-Side App Settings Storage And RPC

**Files:**
- Create: `apps/server/src/services/app_settings.rs`
- Modify: `apps/server/src/models.rs`
- Modify: `apps/server/src/infra/db.rs`
- Modify: `apps/server/src/command/http.rs`
- Modify: `apps/server/src/main.rs`
- Test: `apps/server/src/command/http.rs`

- [ ] **Step 1: Write the failing server RPC test**

```rust
#[test]
fn app_settings_rpc_round_trips_defaults_and_updates() {
    let app = test_app();
    let authorized = authorized_request();

    let initial = dispatch_rpc(&app, "app_settings_get", json!({}), &authorized)
        .expect("default settings should load");
    let initial: AppSettingsPayload = serde_json::from_value(initial).unwrap();
    assert_eq!(initial.general.terminal_compatibility_mode, "standard");
    assert_eq!(initial.claude.global.executable, "claude");

    let saved = dispatch_rpc(
        &app,
        "app_settings_update",
        json!({
            "settings": {
                "general": {
                    "locale": "zh",
                    "terminal_compatibility_mode": "compatibility",
                    "completion_notifications": {
                        "enabled": true,
                        "only_when_background": false
                    },
                    "idle_policy": {
                        "enabled": true,
                        "idle_minutes": 12,
                        "max_active": 4,
                        "pressure": true
                    }
                },
                "claude": {
                    "global": {
                        "executable": "claude-nightly",
                        "startup_args": ["--dangerously-skip-permissions"],
                        "env": {
                            "ANTHROPIC_BASE_URL": "https://anthropic.example"
                        },
                        "settings_json": {
                            "model": "sonnet"
                        },
                        "global_config_json": {
                            "showTurnDuration": true
                        }
                    },
                    "overrides": {
                        "native": null,
                        "wsl": null
                    }
                }
            }
        }),
        &authorized,
    )
    .expect("settings update should succeed");

    let saved: AppSettingsPayload = serde_json::from_value(saved).unwrap();
    assert_eq!(saved.general.locale, "zh");
    assert_eq!(saved.claude.global.executable, "claude-nightly");
    assert_eq!(
        saved.claude.global.env.get("ANTHROPIC_BASE_URL").map(String::as_str),
        Some("https://anthropic.example")
    );
}
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run:

```bash
cargo test --manifest-path apps/server/Cargo.toml command::http::tests::app_settings_rpc_round_trips_defaults_and_updates -- --exact
```

Expected:

```text
error[E0412]: cannot find type `AppSettingsPayload` in this scope
```

- [ ] **Step 3: Implement settings models, DB storage, and RPC dispatch**

```rust
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct AppSettingsPayload {
    pub general: GeneralSettingsPayload,
    pub claude: ClaudeSettingsPayload,
}

pub(crate) fn load_or_default_app_settings(state: State<'_, AppState>) -> Result<AppSettingsPayload, String> {
    with_db(state, |conn| {
        ensure_app_settings_row(conn)?;
        let raw: String = conn.query_row(
            "SELECT payload FROM app_settings WHERE id = 1",
            [],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        parse_json(&raw)
    })
}

pub(crate) fn save_app_settings(
    state: State<'_, AppState>,
    settings: &AppSettingsPayload,
) -> Result<AppSettingsPayload, String> {
    with_db(state, |conn| {
        conn.execute(
            "INSERT INTO app_settings (id, payload, updated_at)
             VALUES (1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
            params![json_string(settings)?, now_ts()],
        ).map_err(|e| e.to_string())?;
        Ok(settings.clone())
    })
}
```

```rust
#[derive(Deserialize)]
struct AppSettingsUpdateRequest {
    settings: AppSettingsPayload,
}

match command {
    "app_settings_get" => serde_json::to_value(app_settings_get(app.state()).map_err(rpc_bad_request)?)
        .map_err(|e| rpc_bad_request(e.to_string())),
    "app_settings_update" => {
        let req: AppSettingsUpdateRequest = parse_payload(payload).map_err(rpc_bad_request)?;
        serde_json::to_value(app_settings_update(req.settings, app.state()).map_err(rpc_bad_request)?)
            .map_err(|e| rpc_bad_request(e.to_string()))
    }
    _ => { /* existing cases */ }
}
```

- [ ] **Step 4: Run the server RPC test and the existing server suite slice**

Run:

```bash
cargo test --manifest-path apps/server/Cargo.toml command::http::tests::app_settings_rpc_round_trips_defaults_and_updates -- --exact
cargo test --manifest-path apps/server/Cargo.toml command::http::tests::dispatches_workspace_runtime_attach_command -- --exact
```

Expected:

```text
test command::http::tests::app_settings_rpc_round_trips_defaults_and_updates ... ok
test command::http::tests::dispatches_workspace_runtime_attach_command ... ok
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/models.rs apps/server/src/infra/db.rs apps/server/src/services/app_settings.rs apps/server/src/command/http.rs apps/server/src/main.rs
git commit -m "feat: persist app settings on the server"
```

## Task 2: Resolve Claude Launch Config On The Backend

**Files:**
- Modify: `apps/server/src/services/app_settings.rs`
- Modify: `apps/server/src/services/claude.rs`
- Modify: `apps/server/src/services/agent.rs`
- Modify: `apps/server/src/command/http.rs`
- Test: `apps/server/src/services/claude.rs`
- Test: `apps/server/src/command/http.rs`

- [ ] **Step 1: Write failing Claude profile resolution tests**

```rust
#[test]
fn resolve_claude_runtime_profile_prefers_enabled_target_override() {
    let settings = AppSettingsPayload {
        general: GeneralSettingsPayload {
            locale: "en".into(),
            terminal_compatibility_mode: "standard".into(),
            completion_notifications: CompletionNotificationSettings {
                enabled: true,
                only_when_background: true,
            },
            idle_policy: default_idle_policy(),
        },
        claude: ClaudeSettingsPayload {
            global: ClaudeRuntimeProfile {
                executable: "claude".into(),
                startup_args: vec!["--verbose".into()],
                env: BTreeMap::new(),
                settings_json: json!({ "model": "sonnet" }),
                global_config_json: json!({}),
            },
            overrides: ClaudeTargetOverrides {
                native: Some(TargetClaudeOverride {
                    enabled: true,
                    profile: ClaudeRuntimeProfile {
                        executable: "claude-native".into(),
                        startup_args: vec!["--dangerously-skip-permissions".into()],
                        env: BTreeMap::new(),
                        settings_json: json!({ "model": "opus" }),
                        global_config_json: json!({}),
                    },
                }),
                wsl: None,
            },
        },
    };

    let resolved = resolve_claude_runtime_profile(&settings, &ExecTarget::Native);
    assert_eq!(resolved.executable, "claude-native");
    assert_eq!(resolved.startup_args, vec!["--dangerously-skip-permissions"]);
    assert_eq!(resolved.settings_json["model"], "opus");
}

#[test]
fn resolve_claude_runtime_profile_keeps_global_when_override_is_disabled() {
    let settings = AppSettingsPayload {
        general: GeneralSettingsPayload {
            locale: "en".into(),
            terminal_compatibility_mode: "standard".into(),
            completion_notifications: CompletionNotificationSettings {
                enabled: true,
                only_when_background: true,
            },
            idle_policy: default_idle_policy(),
        },
        claude: ClaudeSettingsPayload {
            global: ClaudeRuntimeProfile {
                executable: "claude".into(),
                startup_args: vec![],
                env: BTreeMap::new(),
                settings_json: json!({}),
                global_config_json: json!({}),
            },
            overrides: ClaudeTargetOverrides {
                native: None,
                wsl: None,
            },
        },
    };
    let resolved = resolve_claude_runtime_profile(
        &settings,
        &ExecTarget::Wsl { distro: Some("Ubuntu".into()) },
    );
    assert_eq!(resolved.executable, "claude");
}
```

- [ ] **Step 2: Run the new Claude tests and confirm they fail**

Run:

```bash
cargo test --manifest-path apps/server/Cargo.toml services::claude::tests::resolve_claude_runtime_profile_prefers_enabled_target_override -- --exact
```

Expected:

```text
error[E0425]: cannot find function `resolve_claude_runtime_profile` in this scope
```

- [ ] **Step 3: Implement backend Claude profile resolution and stop taking command from the client**

```rust
fn merge_json_objects(base: &Value, override_: &Value) -> Value {
    match (base, override_) {
        (Value::Object(base_map), Value::Object(override_map)) => {
            let mut merged = base_map.clone();
            for (key, value) in override_map {
                let next = merged.get(key).map(|existing| merge_json_objects(existing, value)).unwrap_or_else(|| value.clone());
                merged.insert(key.clone(), next);
            }
            Value::Object(merged)
        }
        (_, Value::Null) => base.clone(),
        _ => override_.clone(),
    }
}

fn merge_claude_runtime_profile(
    base: &ClaudeRuntimeProfile,
    override_: &ClaudeRuntimeProfile,
) -> ClaudeRuntimeProfile {
    ClaudeRuntimeProfile {
        executable: if override_.executable.trim().is_empty() {
            base.executable.clone()
        } else {
            override_.executable.clone()
        },
        startup_args: if override_.startup_args.is_empty() {
            base.startup_args.clone()
        } else {
            override_.startup_args.clone()
        },
        env: base
            .env
            .iter()
            .chain(override_.env.iter())
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
        settings_json: merge_json_objects(&base.settings_json, &override_.settings_json),
        global_config_json: merge_json_objects(&base.global_config_json, &override_.global_config_json),
    }
}

pub(crate) fn resolve_claude_runtime_profile(
    settings: &AppSettingsPayload,
    target: &ExecTarget,
) -> ClaudeRuntimeProfile {
    match target {
        ExecTarget::Native => settings
            .claude
            .overrides
            .native
            .as_ref()
            .filter(|override_| override_.enabled)
            .map(|override_| merge_claude_runtime_profile(&settings.claude.global, &override_.profile))
            .unwrap_or_else(|| settings.claude.global.clone()),
        ExecTarget::Wsl { .. } => settings
            .claude
            .overrides
            .wsl
            .as_ref()
            .filter(|override_| override_.enabled)
            .map(|override_| merge_claude_runtime_profile(&settings.claude.global, &override_.profile))
            .unwrap_or_else(|| settings.claude.global.clone()),
    }
}
```

```rust
pub struct AgentStartParams {
    pub workspace_id: String,
    pub session_id: String,
    pub provider: String,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

let settings = load_or_default_app_settings(state)?;
let launch = resolve_claude_runtime_profile(&settings, &target);
let command = launch.executable.clone();
let args = launch.startup_args.clone();
```

```rust
#[derive(Deserialize)]
struct AgentStartRequest {
    #[serde(flatten)]
    controller: WorkspaceControllerMutationRequest,
    session_id: String,
    provider: String,
    cols: Option<u16>,
    rows: Option<u16>,
}
```

- [ ] **Step 4: Run the Claude tests plus the settings RPC regression**

Run:

```bash
cargo test --manifest-path apps/server/Cargo.toml services::claude::tests::resolve_claude_runtime_profile_prefers_enabled_target_override -- --exact
cargo test --manifest-path apps/server/Cargo.toml services::claude::tests::resolve_claude_runtime_profile_keeps_global_when_override_is_disabled -- --exact
cargo test --manifest-path apps/server/Cargo.toml command::http::tests::app_settings_rpc_round_trips_defaults_and_updates -- --exact
```

Expected:

```text
test services::claude::tests::resolve_claude_runtime_profile_prefers_enabled_target_override ... ok
test services::claude::tests::resolve_claude_runtime_profile_keeps_global_when_override_is_disabled ... ok
test command::http::tests::app_settings_rpc_round_trips_defaults_and_updates ... ok
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/app_settings.rs apps/server/src/services/claude.rs apps/server/src/services/agent.rs apps/server/src/command/http.rs
git commit -m "feat: resolve claude launch settings on the backend"
```

## Task 3: Add Session History, Restore, Delete, And Workspace Archive Semantics

**Files:**
- Modify: `apps/server/src/models.rs`
- Modify: `apps/server/src/infra/db.rs`
- Modify: `apps/server/src/services/workspace.rs`
- Modify: `apps/server/src/command/http.rs`
- Modify: `apps/server/src/main.rs`
- Test: `apps/server/src/services/workspace.rs`
- Test: `apps/server/src/command/http.rs`

- [ ] **Step 1: Write failing workspace history lifecycle tests**

```rust
#[test]
fn archive_session_keeps_suspended_status_after_runtime_stop() {
    let app = test_app();
    let workspace_id = launch_test_workspace(&app, "/tmp/ws-history-archive-test");
    let created = create_session(workspace_id.clone(), SessionMode::Branch, app.state()).unwrap();
    set_session_status(app.state(), &workspace_id, created.id, SessionStatus::Running).unwrap();

    let _entry = archive_session(workspace_id.clone(), created.id, app.state()).unwrap();
    let snapshot = workspace_snapshot(workspace_id.clone(), app.state()).unwrap();
    let archived = snapshot.archive.iter().find(|entry| entry.session_id == created.id).unwrap();
    let status = archived.snapshot["status"].as_str().unwrap();
    assert_eq!(status, "suspended");
}

#[test]
fn restore_and_delete_session_round_trip_history_records() {
    let app = test_app();
    let workspace_id = launch_test_workspace(&app, "/tmp/ws-history-restore-test");
    let created = create_session(workspace_id.clone(), SessionMode::Branch, app.state()).unwrap();
    archive_session(workspace_id.clone(), created.id, app.state()).unwrap();

    let history_before = list_session_history(app.state()).unwrap();
    assert!(history_before.iter().any(|record| record.session_id == created.id && record.archived));

    let restored = restore_session(workspace_id.clone(), created.id, app.state()).unwrap();
    assert_eq!(restored.id, created.id);

    delete_session(workspace_id.clone(), created.id, app.state()).unwrap();
    let history_after = list_session_history(app.state()).unwrap();
    assert!(!history_after.iter().any(|record| record.session_id == created.id));
}

#[test]
fn close_workspace_archives_all_sessions_but_keeps_workspace_history_visible() {
    let app = test_app();
    let workspace_id = launch_test_workspace(&app, "/tmp/ws-history-close-test");
    let one = create_session(workspace_id.clone(), SessionMode::Branch, app.state()).unwrap();
    let two = create_session(workspace_id.clone(), SessionMode::Branch, app.state()).unwrap();

    close_workspace_scoped(workspace_id.clone(), None, None, app.state()).unwrap();

    let history = list_session_history(app.state()).unwrap();
    let records: Vec<_> = history.into_iter().filter(|record| record.workspace_id == workspace_id).collect();
    assert_eq!(records.len(), 2);
    assert!(records.iter().all(|record| record.archived));
    assert!(records.iter().any(|record| record.session_id == one.id));
    assert!(records.iter().any(|record| record.session_id == two.id));
}
```

- [ ] **Step 2: Run the failing workspace history tests**

Run:

```bash
cargo test --manifest-path apps/server/Cargo.toml services::workspace::tests::archive_session_keeps_suspended_status_after_runtime_stop -- --exact
```

Expected:

```text
thread 'services::workspace::tests::archive_session_keeps_suspended_status_after_runtime_stop' panicked
assertion `left == right` failed
left: "interrupted"
right: "suspended"
```

- [ ] **Step 3: Implement history DTOs, restore/delete RPCs, and archive-on-close semantics**

```rust
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct SessionHistoryRecord {
    pub workspace_id: String,
    pub workspace_title: String,
    pub workspace_path: String,
    pub session_id: u64,
    pub title: String,
    pub status: SessionStatus,
    pub archived: bool,
    pub mounted: bool,
    pub recoverable: bool,
    pub last_active_at: i64,
    pub archived_at: Option<i64>,
    pub claude_session_id: Option<String>,
}

pub(crate) fn restore_workspace_session(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: u64,
) -> Result<SessionInfo, String> {
    with_db(state, |conn| {
        let row = load_session_row(conn, workspace_id, session_id)?;
        let mut session = session_from_payload(&row.payload)?;
        conn.execute(
            "UPDATE workspace_sessions SET archived_at = NULL, status = ?3, last_active_at = ?4 WHERE workspace_id = ?1 AND id = ?2",
            params![workspace_id, session_id as i64, status_label(&SessionStatus::Idle), now_ts()],
        ).map_err(|e| e.to_string())?;
        session.status = SessionStatus::Idle;
        session.last_active_at = now_ts();
        Ok(session)
    })
}

pub(crate) fn delete_workspace_session(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: u64,
) -> Result<(), String> {
    with_db(state, |conn| {
        conn.execute(
            "DELETE FROM workspace_sessions WHERE workspace_id = ?1 AND id = ?2",
            params![workspace_id, session_id as i64],
        ).map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM agent_lifecycle_history WHERE workspace_id = ?1 AND session_id = ?2",
            params![workspace_id, session_id as i64],
        ).map_err(|e| e.to_string())?;
        Ok(())
    })
}
```

```rust
fn stop_agent_runtime_without_status_mutation(
    workspace_id: &str,
    session_id: u64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = format!("{workspace_id}:{session_id}");
    let mut sessions = state.agent_sessions.lock().map_err(|e| e.to_string())?;
    if let Some(runtime) = sessions.remove(&key) {
        let _ = runtime.stdin.send("\u{3}".into());
    }
    Ok(())
}

pub(crate) fn archive_session(
    workspace_id: String,
    session_id: u64,
    state: State<'_, AppState>,
) -> Result<ArchiveEntry, String> {
    let entry = archive_workspace_session(state, &workspace_id, session_id)?;
    let _ = stop_agent_runtime_without_status_mutation(&workspace_id, session_id, state);
    Ok(entry)
}

pub(crate) fn close_workspace_scoped(
    workspace_id: String,
    device_id: Option<&str>,
    client_id: Option<&str>,
    state: State<'_, AppState>,
) -> Result<WorkbenchUiState, String> {
    archive_workspace_sessions(state, &workspace_id)?;
    let ui_state = close_workspace_ui(state, &workspace_id, device_id, client_id)?;
    release_workspace_controller(&workspace_id, state)?;
    close_workspace_terminals(&workspace_id, state);
    stop_workspace_watch(state, &workspace_id);
    Ok(ui_state)
}
```

- [ ] **Step 4: Run the targeted history tests and the HTTP dispatch regression**

Run:

```bash
cargo test --manifest-path apps/server/Cargo.toml services::workspace::tests::archive_session_keeps_suspended_status_after_runtime_stop -- --exact
cargo test --manifest-path apps/server/Cargo.toml services::workspace::tests::restore_and_delete_session_round_trip_history_records -- --exact
cargo test --manifest-path apps/server/Cargo.toml services::workspace::tests::close_workspace_archives_all_sessions_but_keeps_workspace_history_visible -- --exact
```

Expected:

```text
test services::workspace::tests::archive_session_keeps_suspended_status_after_runtime_stop ... ok
test services::workspace::tests::restore_and_delete_session_round_trip_history_records ... ok
test services::workspace::tests::close_workspace_archives_all_sessions_but_keeps_workspace_history_visible ... ok
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/models.rs apps/server/src/infra/db.rs apps/server/src/services/workspace.rs apps/server/src/command/http.rs apps/server/src/main.rs
git commit -m "feat: add session history restore and delete flows"
```

## Task 4: Move Frontend App Settings To Backend And Add Claude Settings Helpers

**Files:**
- Create: `apps/web/src/services/http/settings.service.ts`
- Create: `apps/web/src/shared/app/claude-settings.ts`
- Modify: `apps/web/src/types/app.ts`
- Modify: `apps/web/src/shared/app/settings.ts`
- Modify: `apps/web/src/features/app/AppController.tsx`
- Modify: `apps/web/src/features/app/WorkbenchRuntimeCoordinator.tsx`
- Modify: `apps/web/src/services/http/agent.service.ts`
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- Delete: `apps/web/src/features/app/workbench-settings-sync.ts`
- Delete: `tests/workbench-settings-sync.test.ts`
- Test: `tests/app-settings.test.ts`
- Test: `tests/claude-settings.test.ts`

- [ ] **Step 1: Write failing frontend settings helper tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultAppSettings,
  mergeLegacySettingsIntoAppSettings,
  resolveClaudeRuntimeProfile,
} from '../apps/web/src/shared/app/claude-settings.ts';

test('mergeLegacySettingsIntoAppSettings migrates launch command into claude global executable', () => {
  const merged = mergeLegacySettingsIntoAppSettings(defaultAppSettings(), {
    agentCommand: 'claude-nightly --verbose',
    completionNotifications: { enabled: true, onlyWhenBackground: true },
  });

  assert.equal(merged.claude.global.executable, 'claude-nightly');
  assert.deepEqual(merged.claude.global.startupArgs, ['--verbose']);
});

test('resolveClaudeRuntimeProfile only uses target override when enabled', () => {
  const settings = defaultAppSettings();
  settings.claude.overrides.native = {
    enabled: true,
    profile: {
      ...settings.claude.global,
      executable: 'claude-native',
      startupArgs: ['--dangerously-skip-permissions'],
    },
  };

  const native = resolveClaudeRuntimeProfile(settings, { type: 'native' });
  const wsl = resolveClaudeRuntimeProfile(settings, { type: 'wsl', distro: 'Ubuntu' });

  assert.equal(native.executable, 'claude-native');
  assert.equal(wsl.executable, 'claude');
});
```

- [ ] **Step 2: Run the helper tests and confirm they fail**

Run:

```bash
node --test tests/claude-settings.test.ts
```

Expected:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '../apps/web/src/shared/app/claude-settings.ts'
```

- [ ] **Step 3: Implement backend-backed settings bootstrap, legacy migration, and frontend Claude helpers**

```ts
export type ClaudeRuntimeProfile = {
  executable: string;
  startupArgs: string[];
  env: Record<string, string>;
  settingsJson: Record<string, unknown>;
  globalConfigJson: Record<string, unknown>;
};

export const resolveClaudeRuntimeProfile = (
  settings: AppSettings,
  target: ExecTarget,
): ClaudeRuntimeProfile => {
  if (target.type === 'native' && settings.claude.overrides.native?.enabled) {
    return mergeClaudeRuntimeProfile(settings.claude.global, settings.claude.overrides.native.profile);
  }
  if (target.type === 'wsl' && settings.claude.overrides.wsl?.enabled) {
    return mergeClaudeRuntimeProfile(settings.claude.global, settings.claude.overrides.wsl.profile);
  }
  return settings.claude.global;
};

export const mergeLegacySettingsIntoAppSettings = (
  base: AppSettings,
  legacy: {
    agentCommand?: string;
    completionNotifications?: { enabled?: boolean; onlyWhenBackground?: boolean };
    terminalCompatibilityMode?: 'standard' | 'compatibility';
  },
): AppSettings => {
  const [executable = base.claude.global.executable, ...startupArgs] = (legacy.agentCommand ?? '').trim().split(/\s+/).filter(Boolean);
  return {
    ...base,
    general: {
      ...base.general,
      terminalCompatibilityMode: legacy.terminalCompatibilityMode ?? base.general.terminalCompatibilityMode,
      completionNotifications: {
        enabled: legacy.completionNotifications?.enabled ?? base.general.completionNotifications.enabled,
        onlyWhenBackground: legacy.completionNotifications?.onlyWhenBackground ?? base.general.completionNotifications.onlyWhenBackground,
      },
    },
    claude: {
      ...base.claude,
      global: {
        ...base.claude.global,
        executable,
        startupArgs: startupArgs.length > 0 ? startupArgs : base.claude.global.startupArgs,
      },
    },
  };
};
```

```ts
export const getAppSettings = () =>
  invokeRpc<AppSettings>('app_settings_get', {});

export const updateAppSettings = (settings: AppSettings) =>
  invokeRpc<AppSettings>('app_settings_update', { settings });
```

```tsx
useEffect(() => {
  let cancelled = false;

  getAppSettings()
    .then((serverSettings) => {
      if (cancelled) return;
      setAppSettings(serverSettings);
      setLocale(serverSettings.general.locale === 'zh' ? 'zh' : 'en');
    })
    .catch(async () => {
      const legacy = readStoredAppSettings();
      if (!legacy) return;
      const migrated = mergeLegacySettingsIntoAppSettings(defaultAppSettings(), legacy);
      const saved = await updateAppSettings(migrated);
      if (cancelled) return;
      setAppSettings(saved);
    });

  return () => {
    cancelled = true;
  };
}, []);
```

```ts
export const startAgent = (args: {
  workspaceId: string;
  controller: WorkspaceControllerState;
  sessionId: string;
  provider: 'claude';
  cols?: TerminalGridSize['cols'];
  rows?: TerminalGridSize['rows'];
}) => invokeRpc<AgentStartResult>('agent_start', createWorkspaceControllerRpcPayload(args.workspaceId, args.controller, {
  sessionId: args.sessionId,
  provider: args.provider,
  cols: args.cols,
  rows: args.rows,
}));
```

- [ ] **Step 4: Run the frontend settings tests and the production build**

Run:

```bash
node --test tests/app-settings.test.ts tests/claude-settings.test.ts
pnpm build:web
```

Expected:

```text
# pass
✓ built in
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/http/settings.service.ts apps/web/src/shared/app/claude-settings.ts apps/web/src/types/app.ts apps/web/src/shared/app/settings.ts apps/web/src/features/app/AppController.tsx apps/web/src/features/app/WorkbenchRuntimeCoordinator.tsx apps/web/src/services/http/agent.service.ts apps/web/src/features/workspace/WorkspaceScreen.tsx tests/app-settings.test.ts tests/claude-settings.test.ts
git rm apps/web/src/features/app/workbench-settings-sync.ts tests/workbench-settings-sync.test.ts
git commit -m "feat: hydrate app settings from backend claude config"
```

## Task 5: Build History Grouping Logic And The Global Drawer Shell

**Files:**
- Create: `apps/web/src/features/workspace/session-history.ts`
- Create: `apps/web/src/components/HistoryDrawer/HistoryDrawer.tsx`
- Create: `apps/web/src/components/HistoryDrawer/index.ts`
- Modify: `apps/web/src/types/app.ts`
- Modify: `apps/web/src/components/TopBar/TopBar.tsx`
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- Modify: `apps/web/src/services/http/workspace.service.ts`
- Modify: `apps/web/src/components/icons.tsx`
- Modify: `apps/web/src/styles/app.css`
- Test: `tests/session-history.test.ts`

- [ ] **Step 1: Write failing history grouping tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupSessionHistory,
  selectHistoryPrimaryAction,
} from '../apps/web/src/features/workspace/session-history.ts';

test('groupSessionHistory sorts records by workspace then recent activity, hiding empty groups', () => {
  const groups = groupSessionHistory([
    {
      workspaceId: 'ws-a',
      workspaceTitle: 'Alpha',
      workspacePath: '/tmp/a',
      sessionId: '1',
      title: 'Live session',
      status: 'running',
      archived: false,
      mounted: true,
      recoverable: false,
      lastActiveAt: 30,
      archivedAt: null,
      claudeSessionId: 'claude-1',
    },
    {
      workspaceId: 'ws-a',
      workspaceTitle: 'Alpha',
      workspacePath: '/tmp/a',
      sessionId: '2',
      title: 'Archived session',
      status: 'suspended',
      archived: true,
      mounted: false,
      recoverable: true,
      lastActiveAt: 20,
      archivedAt: 25,
      claudeSessionId: 'claude-2',
    },
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].records.map((record) => record.sessionId), ['1', '2']);
});

test('selectHistoryPrimaryAction returns focus for mounted records and restore for archived ones', () => {
  assert.equal(
    selectHistoryPrimaryAction({ archived: false, mounted: true, recoverable: false } as any),
    'focus',
  );
  assert.equal(
    selectHistoryPrimaryAction({ archived: true, mounted: false, recoverable: true } as any),
    'restore',
  );
});
```

- [ ] **Step 2: Run the history tests and confirm they fail**

Run:

```bash
node --test tests/session-history.test.ts
```

Expected:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '../apps/web/src/features/workspace/session-history.ts'
```

- [ ] **Step 3: Implement the history grouping helpers, drawer component, and topbar entry point**

```ts
export const groupSessionHistory = (records: SessionHistoryRecord[]): SessionHistoryGroup[] => {
  const byWorkspace = new Map<string, SessionHistoryGroup>();

  for (const record of records) {
    const existing = byWorkspace.get(record.workspaceId) ?? {
      workspaceId: record.workspaceId,
      workspaceTitle: record.workspaceTitle,
      workspacePath: record.workspacePath,
      records: [],
    };
    existing.records.push(record);
    byWorkspace.set(record.workspaceId, existing);
  }

  return [...byWorkspace.values()]
    .map((group) => ({
      ...group,
      records: group.records.sort((left, right) => right.lastActiveAt - left.lastActiveAt),
    }))
    .filter((group) => group.records.length > 0)
    .sort((left, right) => right.records[0].lastActiveAt - left.records[0].lastActiveAt);
};

export const selectHistoryPrimaryAction = (record: Pick<SessionHistoryRecord, 'archived' | 'mounted' | 'recoverable'>) => {
  if (record.mounted && !record.archived) return 'focus';
  if (record.recoverable) return 'restore';
  return 'noop';
};
```

```tsx
<button
  type="button"
  className={`session-top-history ${historyOpen ? 'active' : ''}`}
  onClick={onToggleHistory}
  aria-label={t('history')}
  title={t('history')}
>
  <SettingsArchiveIcon />
</button>
```

```tsx
<HistoryDrawer
  open={historyOpen}
  groups={historyGroups}
  onClose={() => setHistoryOpen(false)}
  onSelectRecord={handleHistoryRecordSelect}
  onDeleteRecord={handleHistoryRecordDelete}
  t={t}
/>
```

- [ ] **Step 4: Run the history helper tests and the web build**

Run:

```bash
node --test tests/session-history.test.ts
pnpm build:web
```

Expected:

```text
# pass
✓ built in
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace/session-history.ts apps/web/src/components/HistoryDrawer/HistoryDrawer.tsx apps/web/src/components/HistoryDrawer/index.ts apps/web/src/types/app.ts apps/web/src/components/TopBar/TopBar.tsx apps/web/src/features/workspace/WorkspaceScreen.tsx apps/web/src/services/http/workspace.service.ts apps/web/src/components/icons.tsx apps/web/src/styles/app.css tests/session-history.test.ts
git commit -m "feat: add global session history drawer shell"
```

## Task 6: Wire Restore/Delete Actions And The Draft-Pane Restore Chooser

**Files:**
- Create: `apps/web/src/features/workspace/session-restore-chooser.ts`
- Modify: `apps/web/src/features/workspace/session-actions.ts`
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- Modify: `apps/web/src/services/http/session.service.ts`
- Modify: `apps/web/src/services/http/workspace.service.ts`
- Modify: `apps/web/src/shared/utils/workspace.ts`
- Modify: `apps/web/src/state/workbench-core.ts`
- Test: `tests/session-actions.test.ts`
- Test: `tests/session-restore-chooser.test.ts`

- [ ] **Step 1: Write failing restore/delete chooser tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { listRestoreCandidatesForWorkspace } from '../apps/web/src/features/workspace/session-restore-chooser.ts';

test('listRestoreCandidatesForWorkspace excludes mounted and cross-workspace sessions', () => {
  const candidates = listRestoreCandidatesForWorkspace({
    workspaceId: 'ws-1',
    mountedSessionIds: new Set(['session-live']),
    records: [
      {
        workspaceId: 'ws-1',
        sessionId: 'session-archived',
        title: 'Archived',
        archived: true,
        mounted: false,
        recoverable: true,
      },
      {
        workspaceId: 'ws-1',
        sessionId: 'session-live',
        title: 'Live',
        archived: false,
        mounted: true,
        recoverable: false,
      },
      {
        workspaceId: 'ws-2',
        sessionId: 'session-other',
        title: 'Other workspace',
        archived: true,
        mounted: false,
        recoverable: true,
      },
    ] as any,
  });

  assert.deepEqual(candidates.map((record) => record.sessionId), ['session-archived']);
});
```

```ts
test('archiveSessionForTab keeps an empty workspace alive by inserting a draft pane after delete', async () => {
  const state = createState();
  state.tabs[0].sessions = [state.tabs[0].sessions[0]];
  state.tabs[0].activeSessionId = 'session-active';

  const actions = createWorkspaceSessionActions(/* existing helpers */);
  await actions.deleteSessionFromHistory('ws-1', 'session-active');

  assert.equal(stateRef.current.tabs[0].sessions.length, 1);
  assert.equal(stateRef.current.tabs[0].sessions[0].isDraft, true);
});
```

- [ ] **Step 2: Run the chooser/action tests and confirm they fail**

Run:

```bash
node --test tests/session-restore-chooser.test.ts tests/session-actions.test.ts
```

Expected:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '../apps/web/src/features/workspace/session-restore-chooser.ts'
```

- [ ] **Step 3: Implement restore/delete RPC clients, chooser filtering, and session action handlers**

```ts
export const restoreSession = (
  workspaceId: string,
  sessionId: number,
  controller: WorkspaceControllerState,
) => invokeRpc<BackendSession>(
  'restore_session',
  createWorkspaceControllerRpcPayload(workspaceId, controller, { sessionId }),
);

export const deleteSession = (
  workspaceId: string,
  sessionId: number,
  controller: WorkspaceControllerState,
) => invokeRpc<void>(
  'delete_session',
  createWorkspaceControllerRpcPayload(workspaceId, controller, { sessionId }),
);
```

```ts
export const listRestoreCandidatesForWorkspace = ({
  workspaceId,
  mountedSessionIds,
  records,
}: {
  workspaceId: string;
  mountedSessionIds: Set<string>;
  records: SessionHistoryRecord[];
}) => records.filter((record) =>
  record.workspaceId === workspaceId
  && record.recoverable
  && !mountedSessionIds.has(record.sessionId)
);
```

```ts
const restoreSessionIntoPane = async (tabId: string, paneId: string, sessionId: string) => {
  const numericId = parseNumericId(sessionId);
  if (numericId === null) return;
  const restored = await withServiceFallback(
    () => restoreSessionRequest(tabId, numericId, controllerForTab(tabId)!),
    null,
  );
  if (!restored) return;

  updateTab(tabId, (tab) => ({
    ...tab,
    sessions: [createSessionFromBackend(restored, locale), ...tab.sessions.filter((session) => session.id !== sessionId)],
    paneLayout: replacePaneNode(tab.paneLayout, paneId, (leaf) => ({ ...leaf, sessionId })),
    activePaneId: paneId,
    activeSessionId: sessionId,
  }));
};
```

- [ ] **Step 4: Run the node tests and the production build**

Run:

```bash
node --test tests/session-restore-chooser.test.ts tests/session-actions.test.ts tests/session-history.test.ts
pnpm build:web
```

Expected:

```text
# pass
✓ built in
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace/session-restore-chooser.ts apps/web/src/features/workspace/session-actions.ts apps/web/src/features/workspace/WorkspaceScreen.tsx apps/web/src/services/http/session.service.ts apps/web/src/services/http/workspace.service.ts apps/web/src/shared/utils/workspace.ts apps/web/src/state/workbench-core.ts tests/session-actions.test.ts tests/session-restore-chooser.test.ts
git commit -m "feat: restore and delete sessions from history"
```

## Task 7: Build The Claude Settings Panel And Remove The Old Launch Command UI

**Files:**
- Create: `apps/web/src/components/Settings/ClaudeSettingsPanel.tsx`
- Modify: `apps/web/src/components/Settings/Settings.tsx`
- Modify: `apps/web/src/features/settings/SettingsScreen.tsx`
- Modify: `apps/web/src/types/app.ts`
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- Modify: `apps/web/src/styles/app.css`
- Test: `tests/claude-settings.test.ts`

- [ ] **Step 1: Extend the Claude settings test with advanced JSON preservation and target override behavior**

```ts
test('updating structured Claude fields preserves advanced JSON content', () => {
  const settings = defaultAppSettings();
  settings.claude.global.globalConfigJson = { showTurnDuration: true };

  const next = patchClaudeStructuredSettings(settings, {
    scope: 'global',
    executable: 'claude-enterprise',
    startupArgs: ['--verbose'],
  });

  assert.equal(next.claude.global.executable, 'claude-enterprise');
  assert.deepEqual(next.claude.global.startupArgs, ['--verbose']);
  assert.deepEqual(next.claude.global.globalConfigJson, { showTurnDuration: true });
});

test('disabling a target override falls back to inherited global config', () => {
  const settings = defaultAppSettings();
  settings.claude.overrides.native = {
    enabled: false,
    profile: { ...settings.claude.global, executable: 'claude-native', startupArgs: [] },
  };

  const resolved = resolveClaudeRuntimeProfile(settings, { type: 'native' });
  assert.equal(resolved.executable, 'claude');
});
```

- [ ] **Step 2: Run the Claude settings tests and confirm they fail on missing UI-state helpers**

Run:

```bash
node --test tests/claude-settings.test.ts
```

Expected:

```text
not ok 1 - updating structured Claude fields preserves advanced JSON content
```

- [ ] **Step 3: Implement the Claude panel, remove the launch-command field, and reuse runtime validation per target**

```tsx
export const ClaudeSettingsPanel = ({
  settings,
  activeScope,
  runtimeValidation,
  onScopeChange,
  onStructuredChange,
  onAdvancedJsonChange,
}: ClaudeSettingsPanelProps) => {
  const profile =
    activeScope === 'global'
      ? settings.claude.global
      : activeScope === 'native'
        ? settings.claude.overrides.native?.profile ?? settings.claude.global
        : settings.claude.overrides.wsl?.profile ?? settings.claude.global;

  return (
    <section className="claude-settings-panel">
      <header className="claude-settings-header">
        <div>
          <span className="section-kicker">Claude</span>
          <h2>Claude Runtime</h2>
        </div>
        <div className={`claude-settings-validation ${runtimeValidation.state}`}>
          {runtimeValidation.text}
        </div>
      </header>

      <div className="claude-scope-tabs">
        {(['global', 'native', 'wsl'] as const).map((scope) => (
          <button key={scope} type="button" className={scope === activeScope ? 'active' : ''} onClick={() => onScopeChange(scope)}>
            {scope}
          </button>
        ))}
      </div>

      <label className="settings-stack-field">
        <span>Executable</span>
        <input
          value={profile.executable}
          onChange={(event) => onStructuredChange(activeScope, { executable: event.target.value })}
        />
      </label>

      <label className="settings-stack-field">
        <span>Startup Args</span>
        <textarea
          value={profile.startupArgs.join('\n')}
          onChange={(event) => onStructuredChange(activeScope, { startupArgs: event.target.value.split('\n').filter(Boolean) })}
        />
      </label>

      <label className="settings-stack-field">
        <span>settings.json advanced</span>
        <textarea
          value={JSON.stringify(profile.settingsJson, null, 2)}
          onChange={(event) => onAdvancedJsonChange(activeScope, 'settingsJson', event.target.value)}
        />
      </label>

      <label className="settings-stack-field">
        <span>~/.claude.json advanced</span>
        <textarea
          value={JSON.stringify(profile.globalConfigJson, null, 2)}
          onChange={(event) => onAdvancedJsonChange(activeScope, 'globalConfigJson', event.target.value)}
        />
      </label>
    </section>
  );
};
```

```tsx
const settingsNavItems = (t: Translator) => [
  { id: 'general' as const, label: t('settingsGeneral'), icon: <SettingsGeneralIcon /> },
  { id: 'claude' as const, label: 'Claude', icon: <SettingsConfigIcon /> },
  { id: 'appearance' as const, label: t('settingsAppearance'), icon: <SettingsAppearanceIcon /> },
];
```

```tsx
const onClaudeStructuredChange = (scope: ClaudeSettingsScope, patch: Partial<ClaudeRuntimeProfile>) => {
  onSettingsChange(patchClaudeStructuredSettings(settingsDraft, scope, patch));
};

const onClaudeAdvancedJsonChange = (
  scope: ClaudeSettingsScope,
  field: 'settingsJson' | 'globalConfigJson',
  value: string,
) => {
  onSettingsChange(patchClaudeAdvancedJson(settingsDraft, scope, field, value));
};

const patchClaudeStructuredSettings = (
  settings: AppSettings,
  scope: ClaudeSettingsScope,
  patch: Partial<ClaudeRuntimeProfile>,
) => {
  const next = structuredClone(settings);
  const target =
    scope === 'global'
      ? next.claude.global
      : scope === 'native'
        ? (next.claude.overrides.native ??= { enabled: true, profile: structuredClone(next.claude.global) }).profile
        : (next.claude.overrides.wsl ??= { enabled: true, profile: structuredClone(next.claude.global) }).profile;
  Object.assign(target, patch);
  return next;
};

const patchClaudeAdvancedJson = (
  settings: AppSettings,
  scope: ClaudeSettingsScope,
  field: 'settingsJson' | 'globalConfigJson',
  value: string,
) => {
  const next = structuredClone(settings);
  const target =
    scope === 'global'
      ? next.claude.global
      : scope === 'native'
        ? (next.claude.overrides.native ??= { enabled: true, profile: structuredClone(next.claude.global) }).profile
        : (next.claude.overrides.wsl ??= { enabled: true, profile: structuredClone(next.claude.global) }).profile;
  target[field] = JSON.parse(value) as Record<string, unknown>;
  return next;
};

{activeSettingsPanel === 'claude' ? (
  <ClaudeSettingsPanel
    settings={settingsDraft}
    activeScope={activeClaudeScope}
    runtimeValidation={runtimeValidation}
    onScopeChange={setActiveClaudeScope}
    onStructuredChange={onClaudeStructuredChange}
    onAdvancedJsonChange={onClaudeAdvancedJsonChange}
  />
) : null}
```

- [ ] **Step 4: Run the Claude tests and the production build**

Run:

```bash
node --test tests/claude-settings.test.ts tests/app-settings.test.ts
pnpm build:web
```

Expected:

```text
# pass
✓ built in
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Settings/ClaudeSettingsPanel.tsx apps/web/src/components/Settings/Settings.tsx apps/web/src/features/settings/SettingsScreen.tsx apps/web/src/types/app.ts apps/web/src/features/workspace/WorkspaceScreen.tsx apps/web/src/styles/app.css tests/claude-settings.test.ts
git commit -m "feat: add claude settings center"
```

## Task 8: Add End-To-End Coverage And Run Full Verification

**Files:**
- Modify: `tests/e2e/e2e.spec.ts`
- Test: `tests/e2e/e2e.spec.ts`

- [ ] **Step 1: Add failing Playwright scenarios for history restore and Claude settings persistence**

```ts
test('history drawer restores an archived session into the selected workspace pane', async ({ page }) => {
  const workspaceLabel = await launchLocalWorkspace(page);
  await page.getByRole('button', { name: 'New session' }).click();
  await page.getByPlaceholder('Type to start a new task').fill('history restore task');
  await page.keyboard.press('Enter');
  await page.locator('.session-top-close').first().click();
  await page.getByRole('button', { name: 'History' }).click();
  await page.getByRole('button', { name: /history restore task/i }).click();
  await expect(page.getByText('history restore task')).toBeVisible();
  await expect(page.getByText(workspaceLabel)).toBeVisible();
});

test('claude settings persist after refresh', async ({ page }) => {
  await gotoWorkspaceRoot(page);
  await page.getByTestId('settings-open').click();
  await page.getByRole('button', { name: 'Claude' }).click();
  await page.getByLabel('Executable').fill('claude-enterprise');
  await page.reload();
  await page.getByTestId('settings-open').click();
  await page.getByRole('button', { name: 'Claude' }).click();
  await expect(page.getByLabel('Executable')).toHaveValue('claude-enterprise');
});
```

- [ ] **Step 2: Run the new Playwright grep and confirm it fails**

Run:

```bash
pnpm exec playwright test tests/e2e/e2e.spec.ts --grep "history drawer|claude settings persist"
```

Expected:

```text
1 failed
```

- [ ] **Step 3: Finish selectors/fixtures, then run the full verification stack**

```bash
node --test tests/app-settings.test.ts tests/claude-settings.test.ts tests/session-history.test.ts tests/session-restore-chooser.test.ts tests/session-actions.test.ts
cargo test --manifest-path apps/server/Cargo.toml
pnpm build:web
pnpm exec playwright test tests/e2e/e2e.spec.ts --grep "history drawer|claude settings persist"
```

Expected:

```text
# pass
test result: ok.
✓ built in
2 passed
```

- [ ] **Step 4: Run one manual smoke pass against the shipped flows**

Checklist:

```text
1. Close a session and verify it appears in the left history drawer under its workspace.
2. Click an archived record and verify the same session id is restored and focused.
3. Delete the last visible session in an open workspace and verify a fresh draft pane appears.
4. Split a pane, open "从历史恢复", and verify only current-workspace recoverable records appear.
5. Change Claude executable, startup args, and one advanced JSON key, refresh, and verify the values survive.
```

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/e2e.spec.ts
git commit -m "test: cover history drawer and claude settings persistence"
```

## Spec Coverage Check

- History drawer entry point, grouping, and workspace organization: Tasks 5 and 6
- Archive semantics for close session and close workspace: Task 3
- Restore same session identity and focus live sessions: Tasks 3 and 6
- Hard delete semantics: Tasks 3 and 6
- Draft pane “new vs restore from current workspace history”: Task 6
- Backend settings truth source and legacy migration: Tasks 1 and 4
- Claude structured settings, target overrides, and advanced JSON: Tasks 2, 4, and 7
- Verification across backend, frontend, and e2e: Task 8

## Verification Commands

```bash
node --test tests/app-settings.test.ts tests/claude-settings.test.ts tests/session-history.test.ts tests/session-restore-chooser.test.ts tests/session-actions.test.ts
cargo test --manifest-path apps/server/Cargo.toml
pnpm build:web
pnpm exec playwright test tests/e2e/e2e.spec.ts --grep "history drawer|claude settings persist"
```
