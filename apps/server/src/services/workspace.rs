use std::collections::HashMap;

use crate::infra::time::now_ts_ms;
use crate::*;

fn live_session_key(workspace_id: &str, session_id: &str) -> String {
    format!("{workspace_id}:{session_id}")
}

pub(crate) fn remember_live_session(
    state: State<'_, AppState>,
    workspace_id: &str,
    session: &SessionInfo,
) -> Result<(), String> {
    state
        .live_sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(live_session_key(workspace_id, &session.id), session.clone());
    Ok(())
}

pub(crate) fn resolve_session_for_slot(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: &str,
) -> Result<SessionInfo, String> {
    if let Some(session) = state
        .live_sessions
        .lock()
        .map_err(|e| e.to_string())?
        .get(&live_session_key(workspace_id, session_id))
        .cloned()
    {
        return Ok(session);
    }
    crate::load_workspace_slot_session(state, workspace_id, session_id)
}

pub(crate) fn refresh_live_session(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: &str,
) -> Result<SessionInfo, String> {
    let session = load_session(state, workspace_id, session_id)?;
    remember_live_session(state, workspace_id, &session)?;
    Ok(session)
}

fn forget_live_session(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: &str,
) -> Result<(), String> {
    state
        .live_sessions
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&live_session_key(workspace_id, session_id));
    Ok(())
}

fn collect_visible_session_ids(
    value: &Value,
    ordered: &mut Vec<String>,
    seen: &mut HashSet<String>,
) {
    let Value::Object(map) = value else {
        return;
    };
    let Some(Value::String(kind)) = map.get("type") else {
        return;
    };

    if kind == "leaf" {
        if let Some(Value::String(session_id)) =
            map.get("session_id").or_else(|| map.get("sessionId"))
        {
            if seen.insert(session_id.clone()) {
                ordered.push(session_id.clone());
            }
        }
        return;
    }

    if kind == "split" {
        if let Some(next) = map.get("first") {
            collect_visible_session_ids(next, ordered, seen);
        }
        if let Some(next) = map.get("second") {
            collect_visible_session_ids(next, ordered, seen);
        }
    }
}

fn pane_id_for_session(value: &Value, session_id: &str) -> Option<String> {
    let Value::Object(map) = value else {
        return None;
    };
    let Some(Value::String(kind)) = map.get("type") else {
        return None;
    };

    if kind == "leaf" {
        let leaf_session_id = map
            .get("session_id")
            .or_else(|| map.get("sessionId"))
            .and_then(Value::as_str)?;
        if leaf_session_id == session_id {
            return map.get("id").and_then(Value::as_str).map(str::to_string);
        }
        return None;
    }

    if kind == "split" {
        if let Some(next) = map.get("first") {
            if let Some(pane_id) = pane_id_for_session(next, session_id) {
                return Some(pane_id);
            }
        }
        if let Some(next) = map.get("second") {
            if let Some(pane_id) = pane_id_for_session(next, session_id) {
                return Some(pane_id);
            }
        }
    }

    None
}

fn visible_session_ids(view_state: &WorkspaceViewState) -> Vec<String> {
    let mut ordered = Vec::new();
    let mut seen = HashSet::new();
    if seen.insert(view_state.active_session_id.clone()) {
        ordered.push(view_state.active_session_id.clone());
    }
    collect_visible_session_ids(&view_state.pane_layout, &mut ordered, &mut seen);
    ordered
}

fn load_live_workspace_sessions(
    state: State<'_, AppState>,
    workspace_id: &str,
) -> Result<HashMap<String, SessionInfo>, String> {
    let prefix = format!("{workspace_id}:");
    let guard = state.live_sessions.lock().map_err(|e| e.to_string())?;
    Ok(guard
        .iter()
        .filter_map(|(key, session)| {
            key.strip_prefix(&prefix)
                .map(|_| (session.id.clone(), session.clone()))
        })
        .collect())
}

pub(crate) fn hydrate_snapshot_with_live_sessions(
    state: State<'_, AppState>,
    mut snapshot: WorkspaceSnapshot,
) -> Result<WorkspaceSnapshot, String> {
    let live_sessions = load_live_workspace_sessions(state, &snapshot.workspace.workspace_id)?;
    if live_sessions.is_empty() {
        return Ok(snapshot);
    }

    for session in &mut snapshot.sessions {
        if let Some(live) = live_sessions.get(&session.id) {
            *session = live.clone();
        }
    }

    let visible_session_ids = visible_session_ids(&snapshot.view_state);
    for session_id in visible_session_ids {
        if snapshot
            .sessions
            .iter()
            .any(|session| session.id == session_id)
        {
            continue;
        }
        if let Some(live) = live_sessions.get(&session_id) {
            snapshot.sessions.push(live.clone());
        }
    }

    Ok(snapshot)
}

pub(crate) fn launch_workspace_internal_scoped(
    source: WorkspaceSource,
    clone_root_override: Option<String>,
    device_id: Option<&str>,
    client_id: Option<&str>,
    state: State<'_, AppState>,
) -> Result<WorkspaceLaunchResult, String> {
    let project_path = match source.kind {
        WorkspaceSourceKind::Remote => {
            let root = clone_root_override.unwrap_or(temp_root(&source.target)?);
            if matches!(source.target, ExecTarget::Wsl { .. }) {
                let _ = run_cmd(&source.target, "", &["mkdir", "-p", &root]);
            } else {
                std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
            }
            let name = repo_name_from_url(&source.path_or_url);
            let target_path = if matches!(source.target, ExecTarget::Wsl { .. }) {
                format!("{root}/{name}-{}", now_ts())
            } else {
                PathBuf::from(&root)
                    .join(format!("{name}-{}", now_ts()))
                    .to_string_lossy()
                    .to_string()
            };
            run_cmd(
                &source.target,
                &root,
                &["git", "clone", &source.path_or_url, &target_path],
            )?;
            target_path
        }
        WorkspaceSourceKind::Local => resolve_git_repo_path(&source.path_or_url, &source.target)?,
    };

    let result = launch_workspace_record_scoped(
        state,
        source,
        project_path,
        default_idle_policy(),
        device_id,
        client_id,
    )?;
    if let Err(error) = ensure_workspace_watch(
        state,
        &result.snapshot.workspace.workspace_id,
        &result.snapshot.workspace.project_path,
        &result.snapshot.workspace.target,
    ) {
        eprintln!(
            "failed to watch workspace {} after launch: {error}",
            result.snapshot.workspace.workspace_id
        );
    }
    Ok(result)
}

pub(crate) fn launch_workspace_scoped(
    source: WorkspaceSource,
    device_id: Option<&str>,
    client_id: Option<&str>,
    state: State<'_, AppState>,
) -> Result<WorkspaceLaunchResult, String> {
    launch_workspace_internal_scoped(source, None, device_id, client_id, state)
}

pub(crate) fn workbench_bootstrap_scoped(
    device_id: Option<&str>,
    client_id: Option<&str>,
    state: State<'_, AppState>,
) -> Result<WorkbenchBootstrap, String> {
    let mut bootstrap = load_workbench_bootstrap(state, device_id, client_id)?;
    bootstrap.workspaces = bootstrap
        .workspaces
        .into_iter()
        .map(|snapshot| hydrate_snapshot_with_live_sessions(state, snapshot))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(bootstrap)
}

pub(crate) fn workspace_snapshot(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceSnapshot, String> {
    let snapshot =
        hydrate_snapshot_with_live_sessions(state, load_workspace_snapshot(state, &workspace_id)?)?;
    if let Err(error) = ensure_workspace_watch(
        state,
        &snapshot.workspace.workspace_id,
        &snapshot.workspace.project_path,
        &snapshot.workspace.target,
    ) {
        eprintln!(
            "failed to watch workspace {} while loading snapshot: {error}",
            snapshot.workspace.workspace_id
        );
    }
    Ok(snapshot)
}

pub(crate) fn activate_workspace_scoped(
    workspace_id: String,
    device_id: Option<&str>,
    client_id: Option<&str>,
    state: State<'_, AppState>,
) -> Result<WorkbenchUiState, String> {
    if let Ok((project_path, target)) = workspace_access_context(state, &workspace_id) {
        if let Err(error) = ensure_workspace_watch(state, &workspace_id, &project_path, &target) {
            eprintln!("failed to watch workspace {workspace_id} on activate: {error}");
        }
    }
    activate_workspace_ui(state, &workspace_id, device_id, client_id)
}

#[cfg(test)]
pub(crate) fn close_workspace(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<WorkbenchUiState, String> {
    close_workspace_scoped(workspace_id, None, None, state)
}

pub(crate) fn close_workspace_scoped(
    workspace_id: String,
    device_id: Option<&str>,
    client_id: Option<&str>,
    state: State<'_, AppState>,
) -> Result<WorkbenchUiState, String> {
    let visible_session_ids = load_workspace_snapshot(state, &workspace_id)
        .map(|snapshot| visible_session_ids(&snapshot.view_state))?;
    for session_id in visible_session_ids {
        close_session(workspace_id.clone(), session_id, state)?;
    }
    let ui_state = close_workspace_ui(state, &workspace_id, device_id, client_id)?;
    release_workspace_controller(&workspace_id, state)?;
    close_workspace_terminals(&workspace_id, state);
    stop_workspace_agents(&workspace_id, state);
    stop_workspace_watch(state, &workspace_id);
    Ok(ui_state)
}

pub(crate) fn update_workbench_layout_scoped(
    layout: WorkbenchLayout,
    device_id: Option<&str>,
    client_id: Option<&str>,
    state: State<'_, AppState>,
) -> Result<WorkbenchUiState, String> {
    persist_workbench_layout(state, layout, device_id, client_id)
}

fn emit_workspace_runtime_state(
    state: State<'_, AppState>,
    workspace_id: &str,
    view_state: Option<WorkspaceViewState>,
    session_state: Option<WorkspaceSessionState>,
) -> Result<(), String> {
    let payload = serde_json::to_value(WorkspaceRuntimeStateEvent {
        workspace_id: workspace_id.to_string(),
        view_state,
        session_state,
    })
    .map_err(|e| e.to_string())?;
    let _ = state.transport_events.send(TransportEvent {
        event: "workspace://runtime_state".to_string(),
        payload,
    });
    Ok(())
}

fn session_state_payload(session: &SessionInfo) -> WorkspaceSessionState {
    WorkspaceSessionState {
        session_id: session.id.clone(),
        status: session.status.clone(),
        last_active_at: session.last_active_at,
        resume_id: session.resume_id.clone(),
    }
}

pub(crate) fn sync_session_status<S: ToString>(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: S,
    status: SessionStatus,
) -> Result<bool, String> {
    let session_id = session_id.to_string();
    let updated = set_session_status_if_not_archived(
        state,
        workspace_id,
        session_id.clone(),
        status.clone(),
    )?;
    let mut session = resolve_session_for_slot(state, workspace_id, &session_id)?;
    session.status = status;
    session.last_active_at = now_ts_ms();
    remember_live_session(state, workspace_id, &session)?;
    emit_workspace_runtime_state(
        state,
        workspace_id,
        None,
        Some(session_state_payload(&session)),
    )?;
    Ok(updated)
}

pub(crate) fn sync_session_runtime_state<S: ToString>(
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: S,
    status: SessionStatus,
    runtime_active: bool,
) -> Result<bool, String> {
    let session_id = session_id.to_string();
    let updated = set_session_runtime_state_if_not_archived(
        state,
        workspace_id,
        session_id.clone(),
        status.clone(),
        runtime_active,
    )?;
    let mut session = resolve_session_for_slot(state, workspace_id, &session_id)?;
    session.status = status;
    session.runtime_active = runtime_active;
    session.last_active_at = now_ts_ms();
    remember_live_session(state, workspace_id, &session)?;
    emit_workspace_runtime_state(
        state,
        workspace_id,
        None,
        Some(session_state_payload(&session)),
    )?;
    Ok(updated)
}

pub(crate) fn workspace_view_update(
    workspace_id: String,
    patch: WorkspaceViewPatch,
    state: State<'_, AppState>,
) -> Result<WorkspaceViewState, String> {
    let view_state = patch_workspace_view_state(state, &workspace_id, patch)?;
    emit_workspace_runtime_state(state, &workspace_id, Some(view_state.clone()), None)?;
    Ok(view_state)
}

pub(crate) fn create_session(
    workspace_id: String,
    mode: SessionMode,
    provider: AgentProvider,
    state: State<'_, AppState>,
) -> Result<SessionInfo, String> {
    let session_id = session_slot_id()?;
    let last_active_at = now_ts_ms();
    upsert_workspace_session_binding(
        state,
        &workspace_id,
        WorkspaceSessionBinding {
            session_id: session_id.clone(),
            provider: provider.clone(),
            mode: mode.clone(),
            resume_id: None,
            title_snapshot: session_title(&session_id),
            last_seen_at: last_active_at,
        },
    )?;
    let session = load_session(state, &workspace_id, &session_id)?;
    remember_live_session(state, &workspace_id, &session)?;
    Ok(session)
}

pub(crate) fn session_update<S: ToString>(
    workspace_id: String,
    session_id: S,
    patch: SessionPatch,
    state: State<'_, AppState>,
) -> Result<SessionInfo, String> {
    let session_id = session_id.to_string();
    let mut session = resolve_session_for_slot(state, &workspace_id, &session_id)?;
    if let Some(title) = patch.title {
        session.title = title;
    }
    if let Some(status) = patch.status {
        session.status = status;
    }
    if let Some(mode) = patch.mode {
        session.mode = mode;
    }
    if let Some(auto_feed) = patch.auto_feed {
        session.auto_feed = auto_feed;
    }
    if let Some(queue) = patch.queue {
        session.queue = queue;
    }
    if let Some(messages) = patch.messages {
        session.messages = messages;
    }
    if let Some(unread) = patch.unread {
        session.unread = unread;
    }
    if let Some(last_active_at) = patch.last_active_at {
        session.last_active_at = last_active_at;
    }
    if let Some(resume_id) = patch.resume_id {
        session.resume_id = Some(resume_id.clone());
        let current_title = if session.title.trim().is_empty() {
            session_title(&session_id)
        } else {
            session.title.clone()
        };
        upsert_workspace_session_binding(
            state,
            &workspace_id,
            WorkspaceSessionBinding {
                session_id: session_id.clone(),
                provider: session.provider.clone(),
                mode: session.mode.clone(),
                resume_id: Some(resume_id),
                title_snapshot: current_title,
                last_seen_at: session.last_active_at,
            },
        )?;
    }
    remember_live_session(state, &workspace_id, &session)?;
    Ok(session)
}

pub(crate) fn switch_session<S: ToString>(
    workspace_id: String,
    session_id: S,
    state: State<'_, AppState>,
) -> Result<SessionInfo, String> {
    let session_id = session_id.to_string();
    let session = resolve_session_for_slot(state, &workspace_id, &session_id)?;
    let snapshot = load_workspace_snapshot(state, &workspace_id)?;
    let active_pane_id = pane_id_for_session(&snapshot.view_state.pane_layout, &session_id)
        .unwrap_or(snapshot.view_state.active_pane_id);
    patch_workspace_view_state(
        state,
        &workspace_id,
        WorkspaceViewPatch {
            active_session_id: Some(session_id),
            active_pane_id: Some(active_pane_id),
            ..WorkspaceViewPatch::default()
        },
    )?;
    remember_live_session(state, &workspace_id, &session)?;
    Ok(session)
}

pub(crate) fn close_session<S: ToString>(
    workspace_id: String,
    session_id: S,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session_id = session_id.to_string();
    let _ = stop_agent_runtime_without_status_update(&workspace_id, &session_id, state);
    let _ = forget_live_session(state, &workspace_id, &session_id);
    let _ = crate::services::supervisor::disable_supervisor_mode(&workspace_id, &session_id, state);
    remove_workspace_session_binding(state, &workspace_id, &session_id).map(|_| ())
}

pub(crate) fn list_session_history(
    state: State<'_, AppState>,
) -> Result<Vec<SessionHistoryRecord>, String> {
    load_session_history_records(state)
}

fn session_title(session_id: &str) -> String {
    format!("Session {session_id}")
}

fn load_provider_workspace_session(
    workspace_id: &str,
    provider: &AgentProvider,
    resume_id: &str,
    state: State<'_, AppState>,
) -> Result<ProviderWorkspaceSession, String> {
    let (workspace_path, _) = workspace_access_context(state, workspace_id)?;
    let adapter = crate::services::provider_registry::resolve_provider_adapter(provider.as_str())
        .ok_or_else(|| format!("unknown_provider:{}", provider.as_str()))?;
    adapter
        .list_workspace_sessions(&workspace_path)?
        .into_iter()
        .find(|session| session.provider == *provider && session.resume_id == resume_id)
        .ok_or_else(|| "provider_session_not_found".to_string())
}

pub(crate) fn restore_provider_session(
    workspace_id: String,
    session_id: String,
    provider: AgentProvider,
    resume_id: String,
    state: State<'_, AppState>,
) -> Result<SessionRestoreResult, String> {
    let provider_session =
        load_provider_workspace_session(&workspace_id, &provider, &resume_id, state)?;
    let existing = load_session(state, &workspace_id, &session_id)?;
    upsert_workspace_session_binding(
        state,
        &workspace_id,
        WorkspaceSessionBinding {
            session_id: session_id.clone(),
            provider: provider.clone(),
            mode: existing.mode.clone(),
            resume_id: Some(resume_id),
            title_snapshot: provider_session.title.clone(),
            last_seen_at: provider_session.last_active_at,
        },
    )?;
    let session = load_session(state, &workspace_id, &session_id)?;
    remember_live_session(state, &workspace_id, &session)?;
    Ok(SessionRestoreResult {
        session,
        already_active: false,
    })
}

pub(crate) fn delete_provider_session(
    workspace_id: String,
    provider: AgentProvider,
    resume_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (workspace_path, _) = workspace_access_context(state, &workspace_id)?;
    let adapter = crate::services::provider_registry::resolve_provider_adapter(provider.as_str())
        .ok_or_else(|| format!("unknown_provider:{}", provider.as_str()))?;
    let removed_session_ids = remove_workspace_bindings_for_provider_session(
        state,
        &workspace_id,
        &provider,
        &resume_id,
    )?;
    for session_id in &removed_session_ids {
        let _ = stop_agent_runtime_without_status_update(&workspace_id, session_id, state);
        let _ = forget_live_session(state, &workspace_id, session_id);
    }
    adapter.delete_workspace_session(&workspace_path, &resume_id)
}

pub(crate) fn remove_missing_binding(
    workspace_id: String,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let _ = stop_agent_runtime_without_status_update(&workspace_id, &session_id, state);
    let _ = forget_live_session(state, &workspace_id, &session_id);
    remove_workspace_session_binding(state, &workspace_id, &session_id).map(|_| ())
}

pub(crate) fn update_idle_policy(
    workspace_id: String,
    policy: IdlePolicy,
    state: State<'_, AppState>,
) -> Result<(), String> {
    update_workspace_idle_policy(state, &workspace_id, policy)
}

pub(crate) fn worktree_inspect(
    path: String,
    target: ExecTarget,
    depth: Option<usize>,
) -> Result<WorktreeDetail, String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let tree = workspace_tree(resolved.clone(), target.clone(), depth)?;
    let branch = run_cmd(
        &target,
        &resolved,
        &["git", "rev-parse", "--abbrev-ref", "HEAD"],
    )
    .map(|value| trim_branch_name(&value))
    .unwrap_or_else(|_| "unknown".to_string());
    let diff = run_cmd(&target, &resolved, &["git", "diff"]).unwrap_or_default();
    Ok(WorktreeDetail {
        name: PathBuf::from(&resolved)
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "worktree".to_string()),
        path: resolved.clone(),
        branch,
        status: summarize_status(&resolved, &target),
        diff,
        root: tree.root,
        changes: tree.changes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::RuntimeHandle;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    const TIMESTAMP_MILLIS_THRESHOLD: i64 = 1_000_000_000_000;

    fn test_app() -> AppHandle {
        let (app, _shutdown_rx) = RuntimeHandle::new();
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        *app.state().db.lock().unwrap() = Some(conn);
        app
    }

    fn launch_test_workspace(app: &AppHandle, root: &str) -> String {
        let result = launch_workspace_record(
            app.state(),
            WorkspaceSource {
                kind: WorkspaceSourceKind::Local,
                path_or_url: root.to_string(),
                target: ExecTarget::Native,
            },
            root.to_string(),
            default_idle_policy(),
        )
        .unwrap();
        result.snapshot.workspace.workspace_id
    }

    fn init_codex_state_db(path: &Path) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE threads (
                id TEXT PRIMARY KEY,
                rollout_path TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                source TEXT NOT NULL,
                model_provider TEXT NOT NULL,
                cwd TEXT NOT NULL,
                title TEXT NOT NULL,
                sandbox_policy TEXT NOT NULL,
                approval_mode TEXT NOT NULL,
                tokens_used INTEGER NOT NULL DEFAULT 0,
                has_user_event INTEGER NOT NULL DEFAULT 0,
                archived INTEGER NOT NULL DEFAULT 0,
                archived_at INTEGER,
                git_sha TEXT,
                git_branch TEXT,
                git_origin_url TEXT,
                cli_version TEXT NOT NULL DEFAULT '',
                first_user_message TEXT NOT NULL DEFAULT '',
                agent_nickname TEXT,
                agent_role TEXT,
                memory_mode TEXT NOT NULL DEFAULT 'enabled',
                model TEXT,
                reasoning_effort TEXT,
                agent_path TEXT
            );
            CREATE TABLE logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts INTEGER NOT NULL,
                ts_nanos INTEGER NOT NULL,
                level TEXT NOT NULL,
                target TEXT NOT NULL,
                message TEXT,
                module_path TEXT,
                file TEXT,
                line INTEGER,
                thread_id TEXT,
                process_uuid TEXT,
                estimated_bytes INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE thread_spawn_edges (
                parent_thread_id TEXT NOT NULL,
                child_thread_id TEXT NOT NULL PRIMARY KEY,
                status TEXT NOT NULL
            );
            "#,
        )
        .unwrap();
    }

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should move forward")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "coder-studio-{prefix}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("temp dir should be created");
        path
    }

    fn with_claude_home<T>(home_root: &Path, run: impl FnOnce() -> T) -> T {
        let _guard = crate::services::provider_registry::provider_env_test_lock()
            .lock()
            .unwrap();
        let previous = std::env::var_os("CODER_STUDIO_CLAUDE_HOME");
        std::env::set_var("CODER_STUDIO_CLAUDE_HOME", home_root);
        let result = run();
        if let Some(value) = previous {
            std::env::set_var("CODER_STUDIO_CLAUDE_HOME", value);
        } else {
            std::env::remove_var("CODER_STUDIO_CLAUDE_HOME");
        }
        result
    }

    fn with_provider_homes<T>(
        claude_home_root: Option<&Path>,
        codex_home_root: Option<&Path>,
        run: impl FnOnce() -> T,
    ) -> T {
        let _guard = crate::services::provider_registry::provider_env_test_lock()
            .lock()
            .unwrap();
        let previous_claude = std::env::var_os("CODER_STUDIO_CLAUDE_HOME");
        let previous_codex = std::env::var_os("CODER_STUDIO_CODEX_HOME");
        if let Some(path) = claude_home_root {
            std::env::set_var("CODER_STUDIO_CLAUDE_HOME", path);
        } else {
            std::env::remove_var("CODER_STUDIO_CLAUDE_HOME");
        }
        if let Some(path) = codex_home_root {
            std::env::set_var("CODER_STUDIO_CODEX_HOME", path);
        } else {
            std::env::remove_var("CODER_STUDIO_CODEX_HOME");
        }

        let result = run();

        if let Some(value) = previous_claude {
            std::env::set_var("CODER_STUDIO_CLAUDE_HOME", value);
        } else {
            std::env::remove_var("CODER_STUDIO_CLAUDE_HOME");
        }
        if let Some(value) = previous_codex {
            std::env::set_var("CODER_STUDIO_CODEX_HOME", value);
        } else {
            std::env::remove_var("CODER_STUDIO_CODEX_HOME");
        }
        result
    }

    #[test]
    fn workspace_view_update_broadcasts_runtime_state() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-state-test");
        let mut rx = app.state().transport_events.subscribe();

        let view_state = workspace_view_update(
            workspace_id.clone(),
            WorkspaceViewPatch {
                active_terminal_id: Some("7".to_string()),
                ..WorkspaceViewPatch::default()
            },
            app.state(),
        )
        .unwrap();

        assert_eq!(view_state.active_terminal_id, "7");

        let event = rx.try_recv().expect("expected runtime state event");
        assert_eq!(event.event, "workspace://runtime_state");
        let payload: WorkspaceRuntimeStateEvent = serde_json::from_value(event.payload).unwrap();
        assert_eq!(payload.workspace_id, workspace_id);
        assert_eq!(
            payload
                .view_state
                .as_ref()
                .map(|view_state| view_state.active_terminal_id.as_str()),
            Some("7")
        );
        assert!(payload.session_state.is_none());
    }

    #[test]
    fn close_workspace_releases_controller_lease() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-close-release-test");

        workspace_runtime_attach(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        close_workspace(workspace_id.clone(), app.state()).unwrap();

        let lease = load_workspace_controller_lease(app.state(), &workspace_id).unwrap();
        assert_eq!(lease.controller_device_id, None);
        assert_eq!(lease.controller_client_id, None);
        assert_eq!(lease.lease_expires_at, 0);
        assert_eq!(lease.takeover_request_id, None);
    }

    #[test]
    fn close_session_unmounts_provider_binding_and_keeps_provider_history_record() {
        let app = test_app();
        let workspace_root = unique_temp_dir("ws-history-close-test");
        let workspace_id = launch_test_workspace(&app, workspace_root.to_str().unwrap());
        let claude_home = unique_temp_dir("ws-history-close-home");
        let claude_dir = claude_home.join(".claude");
        let project_slug = workspace_root
            .to_string_lossy()
            .replace(['/', '\\', ':'], "-");
        let project_dir = claude_dir.join("projects").join(project_slug);
        fs::create_dir_all(&project_dir).unwrap();
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            project_dir.join("session-a.jsonl"),
            concat!(
                "{\"timestamp\":\"2026-04-05T10:00:00.000Z\"}\n",
                "{\"timestamp\":\"2026-04-05T11:00:00.000Z\"}\n"
            ),
        )
        .unwrap();
        fs::write(
            claude_dir.join("history.jsonl"),
            format!(
                "{{\"display\":\"Archived Provider Session\",\"timestamp\":2,\"project\":\"{}\",\"sessionId\":\"session-a\"}}\n",
                workspace_root.to_string_lossy()
            ),
        )
        .unwrap();

        with_claude_home(&claude_home, || {
            restore_provider_session(
                workspace_id.clone(),
                "slot-primary".to_string(),
                AgentProvider::claude(),
                "session-a".to_string(),
                app.state(),
            )
        })
        .expect("provider restore should succeed");

        close_session(workspace_id.clone(), "slot-primary", app.state()).unwrap();

        let snapshot = workspace_snapshot(workspace_id.clone(), app.state()).unwrap();
        assert!(!snapshot
            .sessions
            .iter()
            .any(|session| session.id == "slot-primary"));

        let history = with_claude_home(&claude_home, || list_session_history(app.state()))
            .expect("history should load");
        let archived = history
            .iter()
            .find(|record| record.resume_id == "session-a")
            .expect("provider record should remain visible");
        assert!(!archived.mounted);

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(claude_home);
    }

    #[test]
    fn close_workspace_clears_provider_bindings_and_keeps_provider_history_records_unmounted() {
        let app = test_app();
        let workspace_root = unique_temp_dir("ws-close-archive-workspace");
        let workspace_id = launch_test_workspace(&app, workspace_root.to_str().unwrap());
        let claude_home = unique_temp_dir("ws-close-archive-home");
        let broken_codex_home = unique_temp_dir("ws-close-archive-codex-home");
        let claude_dir = claude_home.join(".claude");
        fs::create_dir_all(broken_codex_home.join(".codex").join("state_5.sqlite")).unwrap();
        let project_slug = workspace_root
            .to_string_lossy()
            .replace(['/', '\\', ':'], "-");
        let project_dir = claude_dir.join("projects").join(project_slug);
        fs::create_dir_all(&project_dir).unwrap();
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            project_dir.join("session-a.jsonl"),
            concat!(
                "{\"timestamp\":\"2026-04-05T10:00:00.000Z\"}\n",
                "{\"timestamp\":\"2026-04-05T11:00:00.000Z\"}\n"
            ),
        )
        .unwrap();
        fs::write(
            claude_dir.join("history.jsonl"),
            format!(
                "{{\"display\":\"Archived On Close\",\"timestamp\":2,\"project\":\"{}\",\"sessionId\":\"session-a\"}}\n",
                workspace_root.to_string_lossy()
            ),
        )
        .unwrap();

        with_provider_homes(Some(&claude_home), Some(&broken_codex_home), || {
            restore_provider_session(
                workspace_id.clone(),
                "slot-primary".to_string(),
                AgentProvider::claude(),
                "session-a".to_string(),
                app.state(),
            )
        })
        .expect("provider restore should succeed");

        close_workspace(workspace_id.clone(), app.state()).unwrap();

        let history = with_provider_homes(Some(&claude_home), Some(&broken_codex_home), || {
            list_session_history(app.state())
        })
        .expect("history should load");
        let archived = history
            .iter()
            .find(|record| record.resume_id == "session-a")
            .expect("provider record should remain visible");
        assert!(!archived.mounted);

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(claude_home);
        let _ = fs::remove_dir_all(broken_codex_home);
    }

    #[test]
    fn provider_history_lists_provider_records_and_missing_bindings() {
        let app = test_app();
        let workspace_root = unique_temp_dir("ws-provider-history-workspace");
        let workspace_id = launch_test_workspace(&app, workspace_root.to_str().unwrap());
        let claude_home = unique_temp_dir("ws-provider-history-home");
        let claude_dir = claude_home.join(".claude");
        let project_slug = workspace_root
            .to_string_lossy()
            .replace(['/', '\\', ':'], "-");
        let project_dir = claude_dir.join("projects").join(project_slug);
        fs::create_dir_all(&project_dir).unwrap();
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            project_dir.join("session-a.jsonl"),
            concat!(
                "{\"timestamp\":\"2026-04-05T10:00:00.000Z\"}\n",
                "{\"timestamp\":\"2026-04-05T11:00:00.000Z\"}\n"
            ),
        )
        .unwrap();
        fs::write(
            claude_dir.join("history.jsonl"),
            format!(
                "{{\"display\":\"Archived Provider Session\",\"timestamp\":2,\"project\":\"{}\",\"sessionId\":\"session-a\"}}\n",
                workspace_root.to_string_lossy()
            ),
        )
        .unwrap();
        upsert_workspace_session_binding(
            app.state(),
            &workspace_id,
            WorkspaceSessionBinding {
                session_id: "slot-primary".to_string(),
                provider: AgentProvider::claude(),
                mode: SessionMode::Branch,
                resume_id: Some("missing-session".to_string()),
                title_snapshot: "Deleted Session".to_string(),
                last_seen_at: 42,
            },
        )
        .unwrap();

        let history = with_claude_home(&claude_home, || list_session_history(app.state()))
            .expect("history should load");
        let archived = history
            .iter()
            .find(|record| record.resume_id == "session-a")
            .expect("provider record should exist");
        assert!(!archived.mounted);
        assert_eq!(archived.state, "detached");
        assert_eq!(archived.title, "Archived Provider Session");

        let missing = history
            .iter()
            .find(|record| record.resume_id == "missing-session")
            .expect("missing binding should exist");
        assert!(!missing.mounted);
        assert_eq!(missing.state, "unavailable");
        assert_eq!(missing.session_id.as_deref(), Some("slot-primary"));
        assert_eq!(missing.title, "Deleted Session");

        assert!(history
            .iter()
            .all(|record| !record.resume_id.trim().is_empty()));

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(claude_home);
    }

    #[test]
    fn provider_history_omits_codex_subagent_threads() {
        let app = test_app();
        let workspace_root = unique_temp_dir("ws-provider-history-codex-workspace");
        let workspace_id = launch_test_workspace(&app, workspace_root.to_str().unwrap());
        let codex_home = unique_temp_dir("ws-provider-history-codex-home");
        let codex_dir = codex_home.join(".codex");
        fs::create_dir_all(&codex_dir).unwrap();
        init_codex_state_db(&codex_dir.join("state_5.sqlite"));

        let top_rollout_path = codex_home.join("rollout-top.jsonl");
        let subagent_rollout_path = codex_home.join("rollout-subagent.jsonl");
        fs::write(&top_rollout_path, "{\"kind\":\"user\"}\n").unwrap();
        fs::write(&subagent_rollout_path, "{\"kind\":\"user\"}\n").unwrap();

        let conn = Connection::open(codex_dir.join("state_5.sqlite")).unwrap();
        conn.execute(
            "INSERT INTO threads (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title, sandbox_policy, approval_mode)
             VALUES (?1, ?2, ?3, ?4, 'cli', 'openai', ?5, ?6, 'workspace-write', 'never')",
            rusqlite::params![
                "thread-top",
                top_rollout_path.to_string_lossy().to_string(),
                1775383200_i64,
                1775388600_i64,
                workspace_root.to_string_lossy().to_string(),
                "Top Level Session"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO threads (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title, sandbox_policy, approval_mode, agent_nickname, agent_role)
             VALUES (?1, ?2, ?3, ?4, ?5, 'openai', ?6, ?7, 'workspace-write', 'never', ?8, ?9)",
            rusqlite::params![
                "thread-subagent",
                subagent_rollout_path.to_string_lossy().to_string(),
                1775383300_i64,
                1775388700_i64,
                "{\"subagent\":{\"thread_spawn\":{\"parent_thread_id\":\"thread-top\",\"depth\":1,\"agent_nickname\":\"Hilbert\",\"agent_role\":\"worker\"}}}",
                workspace_root.to_string_lossy().to_string(),
                "Subagent Session",
                "Hilbert",
                "worker"
            ],
        )
        .unwrap();

        let history = with_provider_homes(None, Some(&codex_home), || {
            list_session_history(app.state())
        })
        .expect("history should load");
        let codex_records = history
            .iter()
            .filter(|record| {
                record.workspace_id == workspace_id && record.provider == AgentProvider::codex()
            })
            .collect::<Vec<_>>();

        assert_eq!(codex_records.len(), 1);
        assert_eq!(codex_records[0].resume_id, "thread-top");
        assert_eq!(codex_records[0].title, "Top Level Session");
        assert!(!codex_records[0].mounted);

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(codex_home);
    }

    #[test]
    fn restore_provider_session_binds_slot_and_delete_provider_session_removes_history_record() {
        let app = test_app();
        let workspace_root = unique_temp_dir("ws-provider-restore-workspace");
        let workspace_id = launch_test_workspace(&app, workspace_root.to_str().unwrap());
        let claude_home = unique_temp_dir("ws-provider-restore-home");
        let claude_dir = claude_home.join(".claude");
        let project_slug = workspace_root
            .to_string_lossy()
            .replace(['/', '\\', ':'], "-");
        let project_dir = claude_dir.join("projects").join(project_slug);
        fs::create_dir_all(&project_dir).unwrap();
        fs::create_dir_all(&claude_dir).unwrap();
        let transcript_path = project_dir.join("session-a.jsonl");
        fs::write(
            &transcript_path,
            concat!(
                "{\"timestamp\":\"2026-04-05T10:00:00.000Z\"}\n",
                "{\"timestamp\":\"2026-04-05T11:00:00.000Z\"}\n"
            ),
        )
        .unwrap();
        fs::write(
            claude_dir.join("history.jsonl"),
            format!(
                "{{\"display\":\"Restorable Provider Session\",\"timestamp\":2,\"project\":\"{}\",\"sessionId\":\"session-a\"}}\n",
                workspace_root.to_string_lossy()
            ),
        )
        .unwrap();

        let restored = with_claude_home(&claude_home, || {
            restore_provider_session(
                workspace_id.clone(),
                "slot-primary".to_string(),
                AgentProvider::claude(),
                "session-a".to_string(),
                app.state(),
            )
        })
        .expect("provider restore should succeed");
        assert_eq!(restored.session.id, "slot-primary");
        assert_eq!(restored.session.resume_id.as_deref(), Some("session-a"));
        assert_eq!(restored.session.title, "Restorable Provider Session");

        let history_before = with_claude_home(&claude_home, || list_session_history(app.state()))
            .expect("history should load");
        let mounted = history_before
            .iter()
            .find(|record| record.resume_id == "session-a")
            .expect("provider record should exist");
        assert!(mounted.mounted);

        with_claude_home(&claude_home, || {
            delete_provider_session(
                workspace_id.clone(),
                AgentProvider::claude(),
                "session-a".to_string(),
                app.state(),
            )
        })
        .expect("provider delete should succeed");
        assert!(!transcript_path.exists());

        let history_after = with_claude_home(&claude_home, || list_session_history(app.state()))
            .expect("history should reload");
        assert!(!history_after
            .iter()
            .any(|record| record.resume_id == "session-a"));

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(claude_home);
    }

    #[test]
    fn create_session_persists_provider_as_session_truth() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-provider-persist-test");

        let created = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            AgentProvider::codex(),
            app.state(),
        )
        .unwrap();

        assert_eq!(created.provider, AgentProvider::codex());
        assert_eq!(created.resume_id, None);

        let snapshot = workspace_snapshot(workspace_id.clone(), app.state()).unwrap();
        let restored = snapshot
            .sessions
            .into_iter()
            .find(|session| session.id == created.id)
            .expect("session should exist in snapshot");
        assert_eq!(restored.provider, AgentProvider::codex());
        assert_eq!(restored.resume_id, None);
    }

    #[test]
    fn create_session_preserves_requested_mode() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-session-mode-test");

        let created = create_session(
            workspace_id.clone(),
            SessionMode::GitTree,
            AgentProvider::claude(),
            app.state(),
        )
        .unwrap();

        assert!(matches!(created.mode, SessionMode::GitTree));

        let snapshot = workspace_snapshot(workspace_id, app.state()).unwrap();
        let restored = snapshot
            .sessions
            .into_iter()
            .find(|session| session.id == created.id)
            .expect("session should exist in snapshot");
        assert!(matches!(restored.mode, SessionMode::GitTree));
    }

    #[test]
    fn create_session_allocates_slot_ids() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-slot-id-test");

        let created = create_session(
            workspace_id,
            SessionMode::Branch,
            AgentProvider::claude(),
            app.state(),
        )
        .unwrap();

        assert!(created.id.starts_with("slot_"));
    }

    #[test]
    fn switch_session_keeps_existing_pane_layout() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-switch-layout-test");
        let created = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            AgentProvider::claude(),
            app.state(),
        )
        .unwrap();
        let pane_layout = json!({
            "type": "split",
            "id": "split-root",
            "axis": "vertical",
            "ratio": 0.5,
            "first": {
                "type": "leaf",
                "id": "pane-left",
                "sessionId": "slot-primary",
            },
            "second": {
                "type": "leaf",
                "id": "pane-right",
                "sessionId": created.id.clone(),
            },
        });
        workspace_view_update(
            workspace_id.clone(),
            WorkspaceViewPatch {
                active_session_id: Some("slot-primary".to_string()),
                active_pane_id: Some("pane-left".to_string()),
                pane_layout: Some(pane_layout.clone()),
                ..WorkspaceViewPatch::default()
            },
            app.state(),
        )
        .unwrap();

        switch_session(workspace_id.clone(), &created.id, app.state()).unwrap();

        let snapshot = workspace_snapshot(workspace_id, app.state()).unwrap();
        assert_eq!(snapshot.view_state.pane_layout, pane_layout);
        assert_eq!(snapshot.view_state.active_session_id, created.id);
        assert_eq!(snapshot.view_state.active_pane_id, "pane-right");
    }

    #[test]
    fn restore_provider_session_updates_snapshot_title_for_bound_slot() {
        let app = test_app();
        let workspace_root = unique_temp_dir("ws-provider-restore-snapshot-title");
        let workspace_id = launch_test_workspace(&app, workspace_root.to_str().unwrap());
        let claude_home = unique_temp_dir("ws-provider-restore-snapshot-home");
        let claude_dir = claude_home.join(".claude");
        let project_slug = workspace_root
            .to_string_lossy()
            .replace(['/', '\\', ':'], "-");
        let project_dir = claude_dir.join("projects").join(project_slug);
        fs::create_dir_all(&project_dir).unwrap();
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            project_dir.join("session-title.jsonl"),
            concat!(
                "{\"timestamp\":\"2026-04-05T10:00:00.000Z\"}\n",
                "{\"timestamp\":\"2026-04-05T11:00:00.000Z\"}\n"
            ),
        )
        .unwrap();
        fs::write(
            claude_dir.join("history.jsonl"),
            format!(
                "{{\"display\":\"Snapshot Restore Title\",\"timestamp\":2,\"project\":\"{}\",\"sessionId\":\"session-title\"}}\n",
                workspace_root.to_string_lossy()
            ),
        )
        .unwrap();

        let restored = with_claude_home(&claude_home, || {
            restore_provider_session(
                workspace_id.clone(),
                "slot-primary".to_string(),
                AgentProvider::claude(),
                "session-title".to_string(),
                app.state(),
            )
        })
        .unwrap();

        assert_eq!(restored.session.title, "Snapshot Restore Title");

        let snapshot = with_claude_home(&claude_home, || workspace_snapshot(workspace_id.clone(), app.state()))
            .unwrap();
        let session = snapshot
            .sessions
            .into_iter()
            .find(|session| session.id == "slot-primary")
            .expect("restored slot should exist in snapshot");
        assert_eq!(session.title, "Snapshot Restore Title");
        assert_eq!(session.resume_id.as_deref(), Some("session-title"));

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(claude_home);
    }

    #[test]
    fn restore_provider_session_preserves_existing_slot_mode() {
        let app = test_app();
        let workspace_root = unique_temp_dir("ws-restore-mode-test");
        let workspace_id = launch_test_workspace(&app, workspace_root.to_str().unwrap());
        let created = create_session(
            workspace_id.clone(),
            SessionMode::GitTree,
            AgentProvider::claude(),
            app.state(),
        )
        .unwrap();
        let claude_home = unique_temp_dir("ws-restore-mode-home");
        let claude_dir = claude_home.join(".claude");
        let project_slug = workspace_root
            .to_string_lossy()
            .replace(['/', '\\', ':'], "-");
        let project_dir = claude_dir.join("projects").join(project_slug);
        fs::create_dir_all(&project_dir).unwrap();
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            project_dir.join("session-a.jsonl"),
            concat!(
                "{\"timestamp\":\"2026-04-05T10:00:00.000Z\"}\n",
                "{\"timestamp\":\"2026-04-05T11:00:00.000Z\"}\n"
            ),
        )
        .unwrap();
        fs::write(
            claude_dir.join("history.jsonl"),
            format!(
                "{{\"display\":\"Restorable Provider Session\",\"timestamp\":2,\"project\":\"{}\",\"sessionId\":\"session-a\"}}\n",
                workspace_root.to_string_lossy()
            ),
        )
        .unwrap();

        let restored = with_claude_home(&claude_home, || {
            restore_provider_session(
                workspace_id.clone(),
                created.id.clone(),
                AgentProvider::claude(),
                "session-a".to_string(),
                app.state(),
            )
        })
        .unwrap();

        assert!(matches!(restored.session.mode, SessionMode::GitTree));

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(claude_home);
    }

    #[test]
    fn runtime_state_sync_refreshes_live_session_cache() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-live-session-refresh-test");
        let created = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            AgentProvider::claude(),
            app.state(),
        )
        .unwrap();

        app.state().live_sessions.lock().unwrap().insert(
            super::live_session_key(&workspace_id, &created.id),
            SessionInfo {
                status: SessionStatus::Idle,
                runtime_active: false,
                ..created.clone()
            },
        );

        sync_session_runtime_state(
            app.state(),
            &workspace_id,
            &created.id,
            SessionStatus::Running,
            true,
        )
        .unwrap();

        let snapshot = workspace_snapshot(workspace_id, app.state()).unwrap();
        let session = snapshot
            .sessions
            .into_iter()
            .find(|session| session.id == created.id)
            .expect("session should exist in snapshot");
        assert_eq!(session.status, SessionStatus::Running);
        assert!(session.runtime_active);
    }

    #[test]
    fn workspace_snapshot_prefers_live_session_state_for_visible_sessions() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-live-session-snapshot-test");
        let created = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            AgentProvider::claude(),
            app.state(),
        )
        .unwrap();

        let live_session = SessionInfo {
            title: "Live Snapshot Title".to_string(),
            status: SessionStatus::Running,
            provider: AgentProvider::codex(),
            resume_id: Some("resume-live-snapshot".to_string()),
            runtime_active: true,
            ..created.clone()
        };
        app.state().live_sessions.lock().unwrap().insert(
            super::live_session_key(&workspace_id, &created.id),
            live_session.clone(),
        );

        let snapshot = workspace_snapshot(workspace_id.clone(), app.state()).unwrap();
        let session = snapshot
            .sessions
            .into_iter()
            .find(|session| session.id == created.id)
            .expect("session should exist in snapshot");
        assert_eq!(session.title, live_session.title);
        assert_eq!(session.status, live_session.status);
        assert_eq!(session.provider, live_session.provider);
        assert_eq!(session.resume_id, live_session.resume_id);
        assert!(session.runtime_active);
    }

    #[test]
    fn resolve_session_for_slot_uses_live_session_before_db_lookup() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-live-session-resolver-test");
        let live_session = SessionInfo {
            id: "slot-live-only".to_string(),
            title: "Live Only Session".to_string(),
            status: SessionStatus::Running,
            mode: SessionMode::Branch,
            provider: AgentProvider::claude(),
            auto_feed: true,
            queue: Vec::new(),
            messages: Vec::new(),
            unread: 0,
            last_active_at: now_ts_ms(),
            resume_id: Some("resume-live-only".to_string()),
            unavailable_reason: None,
            runtime_active: true,
        };
        app.state().live_sessions.lock().unwrap().insert(
            super::live_session_key(&workspace_id, &live_session.id),
            live_session.clone(),
        );

        reset_with_db_call_count();
        let resolved = resolve_session_for_slot(app.state(), &workspace_id, &live_session.id).unwrap();
        let db_calls = read_with_db_call_count();

        assert_eq!(resolved.id, live_session.id);
        assert_eq!(resolved.title, live_session.title);
        assert_eq!(resolved.status, live_session.status);
        assert_eq!(resolved.resume_id, live_session.resume_id);
        assert!(resolved.runtime_active);
        assert_eq!(db_calls, 0);
    }

    #[test]
    fn resolve_session_for_slot_falls_back_to_binding_snapshot_without_live_session() {
        let app = test_app();
        let workspace_root = unique_temp_dir("ws-binding-session-resolver-test");
        let workspace_id = launch_test_workspace(&app, workspace_root.to_str().unwrap());
        let claude_home = unique_temp_dir("ws-binding-session-resolver-home");
        let claude_dir = claude_home.join(".claude");
        let project_slug = workspace_root
            .to_string_lossy()
            .replace(['/', '\\', ':'], "-");
        let project_dir = claude_dir.join("projects").join(project_slug);
        fs::create_dir_all(&project_dir).unwrap();
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            project_dir.join("session-a.jsonl"),
            concat!(
                "{\"timestamp\":\"2026-04-05T10:00:00.000Z\"}\n",
                "{\"timestamp\":\"2026-04-05T11:00:00.000Z\"}\n"
            ),
        )
        .unwrap();
        fs::write(
            claude_dir.join("history.jsonl"),
            format!(
                "{{\"display\":\"Restorable Provider Session\",\"timestamp\":2,\"project\":\"{}\",\"sessionId\":\"session-a\"}}\n",
                workspace_root.to_string_lossy()
            ),
        )
        .unwrap();

        with_claude_home(&claude_home, || {
            restore_provider_session(
                workspace_id.clone(),
                "slot-primary".to_string(),
                AgentProvider::claude(),
                "session-a".to_string(),
                app.state(),
            )
        })
        .expect("provider restore should succeed");
        app.state()
            .live_sessions
            .lock()
            .unwrap()
            .remove(&super::live_session_key(&workspace_id, "slot-primary"));

        let resolved = with_claude_home(&claude_home, || {
            resolve_session_for_slot(app.state(), &workspace_id, "slot-primary")
        })
        .unwrap();

        assert_eq!(resolved.id, "slot-primary");
        assert_eq!(resolved.title, "Restorable Provider Session");
        assert_eq!(resolved.provider, AgentProvider::claude());
        assert_eq!(resolved.resume_id.as_deref(), Some("session-a"));
        assert_eq!(resolved.status, SessionStatus::Interrupted);
        assert!(!resolved.runtime_active);

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(claude_home);
    }

    #[test]
    fn bootstrap_and_runtime_attach_reuse_live_session_state() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-live-session-bootstrap-test");
        let created = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            AgentProvider::claude(),
            app.state(),
        )
        .unwrap();

        let live_session = SessionInfo {
            title: "Live Bootstrap Title".to_string(),
            status: SessionStatus::Interrupted,
            resume_id: Some("resume-live-bootstrap".to_string()),
            runtime_active: true,
            ..created.clone()
        };
        app.state().live_sessions.lock().unwrap().insert(
            super::live_session_key(&workspace_id, &created.id),
            live_session.clone(),
        );

        let bootstrap = workbench_bootstrap_scoped(None, None, app.state()).unwrap();
        let bootstrap_session = bootstrap
            .workspaces
            .into_iter()
            .find(|snapshot| snapshot.workspace.workspace_id == workspace_id)
            .and_then(|snapshot| {
                snapshot
                    .sessions
                    .into_iter()
                    .find(|session| session.id == created.id)
            })
            .expect("session should exist in bootstrap");
        assert_eq!(bootstrap_session.title, live_session.title);
        assert_eq!(bootstrap_session.status, live_session.status);
        assert_eq!(bootstrap_session.resume_id, live_session.resume_id);

        let runtime = workspace_runtime_attach(
            workspace_id.clone(),
            "device-live".to_string(),
            "client-live".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();
        let runtime_session = runtime
            .snapshot
            .sessions
            .into_iter()
            .find(|session| session.id == created.id)
            .expect("session should exist in runtime snapshot");
        assert_eq!(runtime_session.title, live_session.title);
        assert_eq!(runtime_session.status, live_session.status);
        assert_eq!(runtime_session.resume_id, live_session.resume_id);
    }

    #[test]
    fn session_last_active_at_is_persisted_in_millis_for_create_switch_and_provider_restore() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-last-active-ms-test");

        let created = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            AgentProvider::claude(),
            app.state(),
        )
        .unwrap();
        let created_id = created.id.clone();
        assert!(
            created.last_active_at >= TIMESTAMP_MILLIS_THRESHOLD,
            "create_session should use millisecond timestamps"
        );

        let switched = switch_session(workspace_id.clone(), &created_id, app.state()).unwrap();
        assert!(
            switched.last_active_at >= TIMESTAMP_MILLIS_THRESHOLD,
            "switch_session should use millisecond timestamps"
        );

        let claude_home = unique_temp_dir("ws-last-active-ms-home");
        let claude_dir = claude_home.join(".claude");
        let workspace_root = PathBuf::from("/tmp/ws-last-active-ms-test");
        let project_slug = workspace_root.to_string_lossy().replace(['/', '\\', ':'], "-");
        let project_dir = claude_dir.join("projects").join(project_slug);
        fs::create_dir_all(&project_dir).unwrap();
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            project_dir.join("session-a.jsonl"),
            concat!(
                "{\"timestamp\":\"2026-04-05T10:00:00.000Z\"}\n",
                "{\"timestamp\":\"2026-04-05T11:00:00.000Z\"}\n"
            ),
        )
        .unwrap();
        fs::write(
            claude_dir.join("history.jsonl"),
            format!(
                "{{\"display\":\"Restorable Provider Session\",\"timestamp\":2,\"project\":\"{}\",\"sessionId\":\"session-a\"}}\n",
                workspace_root.to_string_lossy()
            ),
        )
        .unwrap();

        let restored = with_claude_home(&claude_home, || {
            restore_provider_session(
                workspace_id.clone(),
                created_id.clone(),
                AgentProvider::claude(),
                "session-a".to_string(),
                app.state(),
            )
        })
        .unwrap();
        assert!(
            restored.session.last_active_at >= TIMESTAMP_MILLIS_THRESHOLD,
            "restore_provider_session should use millisecond timestamps"
        );

        let _ = fs::remove_dir_all(claude_home);
    }

    #[test]
    fn launch_workspace_starts_without_persisted_sessions() {
        let app = test_app();

        let result = launch_workspace_record(
            app.state(),
            WorkspaceSource {
                kind: WorkspaceSourceKind::Local,
                path_or_url: "/tmp/ws-empty-session-launch-test".to_string(),
                target: ExecTarget::Native,
            },
            "/tmp/ws-empty-session-launch-test".to_string(),
            default_idle_policy(),
        )
        .unwrap();

        assert!(result.snapshot.sessions.is_empty());
    }
}
