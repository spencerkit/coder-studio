use crate::infra::db::{
    build_snapshot_from_conn, ensure_workspace_exists_from_conn,
    list_workspace_ids_for_workspace_client_from_conn, load_agent_lifecycle_events_from_conn,
    load_workspace_controller_lease_from_conn, mark_workspace_client_detached_from_conn,
    save_workspace_controller_lease_to_conn, upsert_workspace_attachment_to_conn, with_db,
};
use crate::models::WorkspaceSupervisorViewState;
use crate::*;
use std::collections::HashMap;

const WORKSPACE_CONTROLLER_LEASE_SECS: i64 = 30;
const WORKSPACE_TAKEOVER_TIMEOUT_SECS: i64 = 0;
const WORKSPACE_RUNTIME_LIFECYCLE_REPLAY_LIMIT: usize = 128;

fn lease_alive(lease: &WorkspaceControllerLease, now: i64) -> bool {
    lease.controller_device_id.is_some() && lease.lease_expires_at > now
}

fn same_controller(lease: &WorkspaceControllerLease, device_id: &str, client_id: &str) -> bool {
    lease.controller_device_id.as_deref() == Some(device_id)
        && lease.controller_client_id.as_deref() == Some(client_id)
}

fn clear_takeover_request(lease: &mut WorkspaceControllerLease) {
    lease.takeover_request_id = None;
    lease.takeover_requested_by_device_id = None;
    lease.takeover_requested_by_client_id = None;
    lease.takeover_deadline_at = None;
}

fn transfer_controller(
    lease: &mut WorkspaceControllerLease,
    device_id: &str,
    client_id: &str,
    now: i64,
) {
    let current_device = lease.controller_device_id.as_deref();
    if current_device != Some(device_id) {
        lease.fencing_token = lease.fencing_token.saturating_add(1).max(1);
    } else if lease.fencing_token == 0 {
        lease.fencing_token = 1;
    }
    lease.controller_device_id = Some(device_id.to_string());
    lease.controller_client_id = Some(client_id.to_string());
    lease.lease_expires_at = now + WORKSPACE_CONTROLLER_LEASE_SECS;
    clear_takeover_request(lease);
}

fn refresh_controller_lease(lease: &mut WorkspaceControllerLease, client_id: &str, now: i64) {
    if lease.fencing_token == 0 && lease.controller_device_id.is_some() {
        lease.fencing_token = 1;
    }
    lease.controller_client_id = Some(client_id.to_string());
    lease.lease_expires_at = now + WORKSPACE_CONTROLLER_LEASE_SECS;
}

fn finalize_takeover_if_due(lease: &mut WorkspaceControllerLease, now: i64) -> bool {
    let takeover_due = lease
        .takeover_deadline_at
        .is_some_and(|deadline| deadline <= now);
    let controller_expired = !lease_alive(lease, now);
    if (takeover_due || controller_expired)
        && lease.takeover_requested_by_device_id.is_some()
        && lease.takeover_requested_by_client_id.is_some()
    {
        let next_device = lease
            .takeover_requested_by_device_id
            .clone()
            .unwrap_or_default();
        let next_client = lease
            .takeover_requested_by_client_id
            .clone()
            .unwrap_or_default();
        transfer_controller(lease, &next_device, &next_client, now);
        return true;
    }

    if controller_expired
        && lease.controller_device_id.is_some()
        && lease.takeover_requested_by_device_id.is_none()
    {
        lease.controller_device_id = None;
        lease.controller_client_id = None;
        lease.lease_expires_at = 0;
        return true;
    }

    false
}

pub(crate) fn reconcile_workspace_controller_lease(
    lease: &mut WorkspaceControllerLease,
    now: i64,
) -> bool {
    finalize_takeover_if_due(lease, now)
}

pub(crate) fn validate_workspace_controller_mutation(
    lease: &WorkspaceControllerLease,
    device_id: &str,
    client_id: &str,
    fencing_token: i64,
    now: i64,
) -> Result<(), String> {
    if !lease_alive(lease, now)
        || !same_controller(lease, device_id, client_id)
        || lease.fencing_token != fencing_token
    {
        return Err("stale_fencing_token".to_string());
    }

    Ok(())
}

pub(crate) fn emit_workspace_controller_change(app: &AppHandle, lease: &WorkspaceControllerLease) {
    let state: State<AppState> = app.state();
    let _ = state.transport_events.send(TransportEvent {
        event: "workspace://controller".to_string(),
        payload: json!({
            "workspace_id": lease.workspace_id,
            "controller": lease,
        }),
    });
}

fn controller_role(
    lease: &WorkspaceControllerLease,
    device_id: &str,
    client_id: &str,
) -> &'static str {
    if same_controller(lease, device_id, client_id) {
        "controller"
    } else {
        "observer"
    }
}

fn workspace_client_connection_key(device_id: &str, client_id: &str) -> String {
    format!("{device_id}:{client_id}")
}

pub(crate) fn register_workspace_client_connection(
    device_id: &str,
    client_id: &str,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let key = workspace_client_connection_key(device_id, client_id);
    let mut guard = state
        .workspace_client_connections
        .lock()
        .map_err(|e| e.to_string())?;
    let count = guard.entry(key).or_insert(0);
    *count = count.saturating_add(1);
    Ok(*count)
}

pub(crate) fn unregister_workspace_client_connection(
    device_id: &str,
    client_id: &str,
    app: &AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let key = workspace_client_connection_key(device_id, client_id);
    let mut guard = state
        .workspace_client_connections
        .lock()
        .map_err(|e| e.to_string())?;

    let should_detach = match guard.get_mut(&key) {
        Some(count) if *count > 1 => {
            *count -= 1;
            false
        }
        Some(_) => {
            guard.remove(&key);
            true
        }
        None => false,
    };

    drop(guard);
    if !should_detach {
        return Ok(false);
    }

    handle_workspace_client_disconnect(device_id, client_id, app, state)?;
    Ok(true)
}

pub(crate) fn assert_workspace_controller_can_mutate(
    workspace_id: &str,
    device_id: &str,
    client_id: &str,
    fencing_token: i64,
    app: &AppHandle,
    state: State<'_, AppState>,
) -> Result<WorkspaceControllerLease, String> {
    let now = now_ts();
    let mut lease = load_workspace_controller_lease(state, workspace_id)?;
    let before = lease.clone();
    reconcile_workspace_controller_lease(&mut lease, now);

    if lease != before {
        save_workspace_controller_lease(state, &lease)?;
        emit_workspace_controller_change(app, &lease);
    }

    validate_workspace_controller_mutation(&lease, device_id, client_id, fencing_token, now)?;
    Ok(lease)
}

pub(crate) fn release_workspace_controller(
    workspace_id: &str,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut lease = load_workspace_controller_lease(state, workspace_id)?;
    let before = lease.clone();

    lease.controller_device_id = None;
    lease.controller_client_id = None;
    lease.lease_expires_at = 0;
    clear_takeover_request(&mut lease);

    if lease != before {
        save_workspace_controller_lease(state, &lease)?;
        let _ = state.transport_events.send(TransportEvent {
            event: "workspace://controller".to_string(),
            payload: json!({
                "workspace_id": workspace_id,
                "controller": lease,
            }),
        });
    }

    Ok(())
}

pub(crate) fn release_workspace_controller_for_client(
    workspace_id: String,
    device_id: String,
    client_id: String,
    fencing_token: i64,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WorkspaceControllerLease, String> {
    let mut changed_lease = None;
    let result = with_db(state, |conn| {
        let now = now_ts();
        let mut lease = load_workspace_controller_lease_from_conn(conn, &workspace_id)?;
        let before = lease.clone();
        finalize_takeover_if_due(&mut lease, now);

        if lease != before {
            save_workspace_controller_lease_to_conn(conn, &lease)?;
            changed_lease = Some(lease.clone());
        }

        if !lease_alive(&lease, now)
            || !same_controller(&lease, &device_id, &client_id)
            || lease.fencing_token != fencing_token
        {
            return Err("stale_fencing_token".to_string());
        }

        let before_release = lease.clone();
        lease.controller_device_id = None;
        lease.controller_client_id = None;
        lease.lease_expires_at = 0;
        clear_takeover_request(&mut lease);

        if lease != before_release {
            save_workspace_controller_lease_to_conn(conn, &lease)?;
            changed_lease = Some(lease.clone());
        }

        Ok(lease)
    });

    if let Some(lease) = changed_lease.as_ref() {
        emit_workspace_controller_change(&app, lease);
    }

    result
}

pub(crate) fn handle_workspace_client_disconnect(
    device_id: &str,
    client_id: &str,
    app: &AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let changed_leases = with_db(state, |conn| {
        let workspace_ids =
            list_workspace_ids_for_workspace_client_from_conn(conn, device_id, client_id)?;
        let _ = mark_workspace_client_detached_from_conn(conn, device_id, client_id);
        let now = now_ts();
        let mut changed_leases = Vec::new();

        for workspace_id in workspace_ids {
            let mut lease = load_workspace_controller_lease_from_conn(conn, &workspace_id)?;
            if !same_controller(&lease, device_id, client_id) {
                continue;
            }
            let before = lease.clone();
            if let (Some(next_device), Some(next_client)) = (
                lease.takeover_requested_by_device_id.clone(),
                lease.takeover_requested_by_client_id.clone(),
            ) {
                transfer_controller(&mut lease, &next_device, &next_client, now);
            } else {
                lease.controller_device_id = None;
                lease.controller_client_id = None;
                lease.lease_expires_at = 0;
                clear_takeover_request(&mut lease);
            }

            if lease != before {
                save_workspace_controller_lease_to_conn(conn, &lease)?;
                changed_leases.push(lease);
            }
        }

        Ok(changed_leases)
    })?;

    for lease in changed_leases {
        emit_workspace_controller_change(app, &lease);
    }

    Ok(())
}

pub(crate) fn session_runtime_liveness_for_binding(
    workspace_id: &str,
    binding: &SessionRuntimeBindingInfo,
    state: State<'_, AppState>,
) -> Option<SessionRuntimeLiveness> {
    if binding.terminal_runtime_id.is_none() {
        return Some(SessionRuntimeLiveness::ProviderExited);
    }

    let runtime_id = binding.terminal_runtime_id.as_deref()?;
    let runtime = state
        .terminal_runtimes
        .lock()
        .ok()?
        .by_runtime_id(runtime_id)
        .cloned()?;

    if runtime.workspace_id != workspace_id || runtime.session_id != binding.session_id {
        return Some(SessionRuntimeLiveness::ProviderExited);
    }

    let key = crate::ws::server::terminal_key(&runtime.workspace_id, runtime.terminal_id);
    if state
        .terminals
        .lock()
        .ok()
        .map(|terms| terms.contains_key(&key))
        .unwrap_or(false)
    {
        Some(SessionRuntimeLiveness::Attached)
    } else {
        Some(SessionRuntimeLiveness::TmuxMissing)
    }
}

pub(crate) fn session_runtime_liveness_for_session(
    workspace_id: &str,
    session_id: &str,
    state: State<'_, AppState>,
) -> Option<SessionRuntimeLiveness> {
    let bindings = crate::services::session_runtime::collect_workspace_session_runtime_bindings(
        workspace_id,
        state,
    )
    .ok()?;
    bindings.iter().find_map(|binding| {
        (binding.session_id == session_id)
            .then(|| session_runtime_liveness_for_binding(workspace_id, binding, state))
            .flatten()
    })
}

pub(crate) fn apply_runtime_liveness_to_snapshot(
    workspace_id: &str,
    snapshot: &mut WorkspaceSnapshot,
    bindings: &[SessionRuntimeBindingInfo],
    state: State<'_, AppState>,
) {
    let liveness_by_session = bindings
        .iter()
        .filter_map(|binding| {
            session_runtime_liveness_for_binding(workspace_id, binding, state)
                .map(|liveness| (binding.session_id.as_str(), liveness))
        })
        .collect::<HashMap<_, _>>();

    for session in &mut snapshot.sessions {
        session.runtime_liveness = liveness_by_session.get(session.id.as_str()).cloned();
    }
}

pub(crate) fn workspace_runtime_attach(
    workspace_id: String,
    device_id: String,
    client_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WorkspaceRuntimeSnapshot, String> {
    let (lease, mut snapshot, lifecycle_events, controller_changed) = with_db(state, |conn| {
        ensure_workspace_exists_from_conn(conn, &workspace_id)?;
        let now = now_ts();
        let mut lease = load_workspace_controller_lease_from_conn(conn, &workspace_id)?;
        let before = lease.clone();
        finalize_takeover_if_due(&mut lease, now);

        if same_controller(&lease, &device_id, &client_id) {
            refresh_controller_lease(&mut lease, &client_id, now);
        } else if !lease_alive(&lease, now) {
            transfer_controller(&mut lease, &device_id, &client_id, now);
        }

        let role = controller_role(&lease, &device_id, &client_id);
        upsert_workspace_attachment_to_conn(conn, &workspace_id, &device_id, &client_id, role)?;
        save_workspace_controller_lease_to_conn(conn, &lease)?;
        let snapshot = build_snapshot_from_conn(conn, &workspace_id)?;
        let lifecycle_events = load_agent_lifecycle_events_from_conn(
            conn,
            &workspace_id,
            WORKSPACE_RUNTIME_LIFECYCLE_REPLAY_LIMIT,
        )?;
        let controller_changed = lease != before;
        Ok((lease, snapshot, lifecycle_events, controller_changed))
    })?;

    if controller_changed {
        emit_workspace_controller_change(&app, &lease);
    }

    let existing_runtime_bindings =
        crate::services::session_runtime::collect_workspace_session_runtime_bindings(
            &workspace_id,
            state,
        )?;
    let mut runtime_bound_session_ids = existing_runtime_bindings
        .iter()
        .map(|binding| binding.session_id.clone())
        .collect::<HashSet<_>>();
    let auto_resume_bindings = snapshot.view_state.session_bindings.clone();
    for binding in auto_resume_bindings {
        if runtime_bound_session_ids.contains(&binding.session_id) {
            continue;
        }
        let Some(session) = snapshot
            .sessions
            .iter()
            .find(|session| session.id == binding.session_id)
        else {
            continue;
        };
        if session.unavailable_reason.is_some() {
            continue;
        }
        let started = crate::services::session_runtime::session_runtime_start(
            SessionRuntimeStartParams {
                workspace_id: workspace_id.clone(),
                session_id: binding.session_id.clone(),
                cols: None,
                rows: None,
            },
            app.clone(),
            state,
        )?;
        if started.started {
            runtime_bound_session_ids.insert(binding.session_id);
        }
    }

    let runtime_terminals = crate::services::session_runtime::collect_workspace_runtime_terminals(
        &workspace_id,
        state,
    )?;
    for runtime_terminal in runtime_terminals {
        if !snapshot
            .terminals
            .iter()
            .any(|terminal| terminal.id == runtime_terminal.id)
        {
            snapshot.terminals.push(runtime_terminal);
        }
    }
    snapshot = crate::services::workspace::hydrate_snapshot_with_live_sessions(state, snapshot)?;

    let session_runtime_bindings =
        crate::services::session_runtime::collect_workspace_session_runtime_bindings(
            &workspace_id,
            state,
        )?;
    apply_runtime_liveness_to_snapshot(
        &workspace_id,
        &mut snapshot,
        &session_runtime_bindings,
        state,
    );

    Ok(WorkspaceRuntimeSnapshot {
        snapshot,
        controller: lease,
        lifecycle_events,
        session_runtime_bindings,
    })
}

pub(crate) fn workspace_controller_heartbeat(
    workspace_id: String,
    device_id: String,
    client_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WorkspaceControllerLease, String> {
    let (lease, controller_changed) = with_db(state, |conn| {
        let now = now_ts();
        let mut lease = load_workspace_controller_lease_from_conn(conn, &workspace_id)?;
        let before = lease.clone();
        finalize_takeover_if_due(&mut lease, now);

        if same_controller(&lease, &device_id, &client_id) {
            refresh_controller_lease(&mut lease, &client_id, now);
        } else if !lease_alive(&lease, now) {
            transfer_controller(&mut lease, &device_id, &client_id, now);
        }

        save_workspace_controller_lease_to_conn(conn, &lease)?;
        let _ = upsert_workspace_attachment_to_conn(
            conn,
            &workspace_id,
            &device_id,
            &client_id,
            controller_role(&lease, &device_id, &client_id),
        );

        let controller_changed = lease != before;
        Ok((lease, controller_changed))
    })?;

    if controller_changed {
        emit_workspace_controller_change(&app, &lease);
    }
    Ok(lease)
}

pub(crate) fn workspace_controller_takeover(
    workspace_id: String,
    device_id: String,
    client_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WorkspaceControllerLease, String> {
    let now = now_ts();
    let mut lease = load_workspace_controller_lease(state, &workspace_id)?;
    let before = lease.clone();
    finalize_takeover_if_due(&mut lease, now);

    if same_controller(&lease, &device_id, &client_id) {
        refresh_controller_lease(&mut lease, &client_id, now);
    } else if !lease_alive(&lease, now) {
        transfer_controller(&mut lease, &device_id, &client_id, now);
    } else if lease.takeover_requested_by_device_id.as_deref() == Some(device_id.as_str()) {
        if lease
            .takeover_deadline_at
            .is_some_and(|deadline| deadline <= now)
        {
            transfer_controller(&mut lease, &device_id, &client_id, now);
        }
    } else {
        lease.takeover_request_id = Some(format!("takeover-{}", now));
        lease.takeover_requested_by_device_id = Some(device_id.clone());
        lease.takeover_requested_by_client_id = Some(client_id.clone());
        lease.takeover_deadline_at = Some(now + WORKSPACE_TAKEOVER_TIMEOUT_SECS);
    }

    save_workspace_controller_lease(state, &lease)?;
    upsert_workspace_attachment(
        state,
        &workspace_id,
        &device_id,
        &client_id,
        controller_role(&lease, &device_id, &client_id),
    )
    .ok();
    if lease != before {
        emit_workspace_controller_change(&app, &lease);
    }
    Ok(lease)
}

pub(crate) fn workspace_controller_reject_takeover(
    workspace_id: String,
    device_id: String,
    client_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WorkspaceControllerLease, String> {
    let now = now_ts();
    let mut lease = load_workspace_controller_lease(state, &workspace_id)?;
    let before = lease.clone();
    finalize_takeover_if_due(&mut lease, now);

    if same_controller(&lease, &device_id, &client_id) {
        refresh_controller_lease(&mut lease, &client_id, now);
        clear_takeover_request(&mut lease);
    }
    save_workspace_controller_lease(state, &lease)?;
    upsert_workspace_attachment(
        state,
        &workspace_id,
        &device_id,
        &client_id,
        controller_role(&lease, &device_id, &client_id),
    )
    .ok();
    if lease != before {
        emit_workspace_controller_change(&app, &lease);
    }

    Ok(lease)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::RuntimeHandle;
    use crate::services::session_runtime::session_runtime_key;
    use std::fs;
    use std::sync::OnceLock;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn with_db_count_test_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn lock_with_db_count_tests() -> std::sync::MutexGuard<'static, ()> {
        with_db_count_test_lock()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }

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

    fn replace_view_state_for_test(
        app: &AppHandle,
        workspace_id: &str,
        mutate: impl FnOnce(&mut WorkspaceViewState),
    ) {
        let mut view_state = crate::load_workspace_snapshot(app.state(), workspace_id)
            .map(|snapshot| snapshot.view_state)
            .unwrap_or(WorkspaceViewState {
                active_session_id: "slot-primary".to_string(),
                active_pane_id: "pane-slot-primary".to_string(),
                active_terminal_id: String::new(),
                pane_layout: json!({
                    "type": "leaf",
                    "id": "pane-slot-primary",
                    "sessionId": "slot-primary",
                }),
                file_preview: json!({
                    "path": "",
                    "content": "",
                    "mode": "preview",
                    "originalContent": "",
                    "modifiedContent": "",
                    "dirty": false
                }),
                session_bindings: Vec::new(),
                supervisor: WorkspaceSupervisorViewState::default(),
            });
        mutate(&mut view_state);
        with_db(app.state(), |conn| {
            conn.execute(
                "INSERT INTO workspace_view_state (workspace_id, payload, updated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(workspace_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
                params![
                    workspace_id,
                    serde_json::to_string(&view_state).map_err(|e| e.to_string())?,
                    now_ts()
                ],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })
        .expect("view state should persist");
    }

    fn start_bound_session_for_test<S: ToString>(
        app: &AppHandle,
        workspace_id: &str,
        session_id: S,
    ) -> SessionRuntimeStartResult {
        *app.state().hook_endpoint.lock().unwrap() = Some("http://127.0.0.1:1/claude-hook".into());
        let session_id = session_id.to_string();

        let runtime = workspace_runtime_attach(
            workspace_id.to_string(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        session_runtime_start(
            SessionRuntimeStartParams {
                workspace_id: workspace_id.to_string(),
                session_id: session_id.to_string(),
                cols: Some(100),
                rows: Some(24),
            },
            app.clone(),
            app.state(),
        )
        .unwrap_or_else(|error| {
            panic!(
                "start failed with fencing token {}: {error}",
                runtime.controller.fencing_token
            )
        })
    }

    #[test]
    fn workspace_runtime_attach_uses_single_with_db_critical_section() {
        let _guard = lock_with_db_count_tests();
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-attach-db-count");

        reset_with_db_call_count();
        workspace_runtime_attach(
            workspace_id,
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        assert_eq!(read_with_db_call_count(), 1);
    }

    #[test]
    fn workspace_controller_heartbeat_uses_single_with_db_critical_section() {
        let _guard = lock_with_db_count_tests();
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-heartbeat-db-count");

        workspace_runtime_attach(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        reset_with_db_call_count();
        workspace_controller_heartbeat(
            workspace_id,
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        assert_eq!(read_with_db_call_count(), 1);
    }

    #[test]
    fn assert_workspace_controller_can_mutate_uses_single_with_db_critical_section() {
        let _guard = lock_with_db_count_tests();
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-assert-db-count");

        let runtime = workspace_runtime_attach(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        reset_with_db_call_count();
        assert_workspace_controller_can_mutate(
            &workspace_id,
            "device-a",
            "client-a",
            runtime.controller.fencing_token,
            &app,
            app.state(),
        )
        .unwrap();

        assert_eq!(read_with_db_call_count(), 1);
    }

    #[test]
    fn release_workspace_controller_for_client_uses_single_with_db_critical_section() {
        let _guard = lock_with_db_count_tests();
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-release-db-count");

        let runtime = workspace_runtime_attach(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        reset_with_db_call_count();
        release_workspace_controller_for_client(
            workspace_id,
            "device-a".to_string(),
            "client-a".to_string(),
            runtime.controller.fencing_token,
            app.clone(),
            app.state(),
        )
        .unwrap();

        assert_eq!(read_with_db_call_count(), 1);
    }

    #[test]
    fn handle_workspace_client_disconnect_uses_single_with_db_critical_section() {
        let _guard = lock_with_db_count_tests();
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-disconnect-db-count");

        register_workspace_client_connection("device-a", "client-a", app.state()).unwrap();
        workspace_runtime_attach(
            workspace_id,
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        reset_with_db_call_count();
        handle_workspace_client_disconnect("device-a", "client-a", &app, app.state()).unwrap();

        assert_eq!(read_with_db_call_count(), 1);
    }

    #[test]
    fn workspace_runtime_attach_assigns_controller_and_observer_roles() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-attach-test");

        let controller = workspace_runtime_attach(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();
        let observer = workspace_runtime_attach(
            workspace_id.clone(),
            "device-b".to_string(),
            "client-b".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        assert_eq!(
            controller.controller.controller_device_id.as_deref(),
            Some("device-a")
        );
        assert_eq!(
            controller.controller.controller_client_id.as_deref(),
            Some("client-a")
        );
        assert_eq!(controller.controller.fencing_token, 1);
        assert_eq!(
            observer.controller.controller_device_id.as_deref(),
            Some("device-a")
        );
        assert_eq!(observer.controller.takeover_requested_by_device_id, None);
    }

    #[test]
    fn workspace_controller_takeover_transfers_after_timeout() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-takeover-test");

        workspace_runtime_attach(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        let lease = workspace_controller_takeover(
            workspace_id.clone(),
            "device-b".to_string(),
            "client-b".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();
        assert_eq!(
            lease.takeover_requested_by_device_id.as_deref(),
            Some("device-b")
        );

        let mut expired = load_workspace_controller_lease(app.state(), &workspace_id).unwrap();
        expired.lease_expires_at = now_ts() - 1;
        expired.takeover_deadline_at = Some(now_ts() - 1);
        save_workspace_controller_lease(app.state(), &expired).unwrap();

        let transferred = workspace_controller_heartbeat(
            workspace_id,
            "device-b".to_string(),
            "client-b".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        assert_eq!(
            transferred.controller_device_id.as_deref(),
            Some("device-b")
        );
        assert_eq!(
            transferred.controller_client_id.as_deref(),
            Some("client-b")
        );
        assert_eq!(transferred.fencing_token, 2);
    }

    #[test]
    fn controller_reattach_keeps_pending_takeover_request() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-reattach-takeover-test");

        workspace_runtime_attach(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        workspace_controller_takeover(
            workspace_id.clone(),
            "device-b".to_string(),
            "client-b".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        let reattached = workspace_runtime_attach(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        assert_eq!(
            reattached.controller.controller_device_id.as_deref(),
            Some("device-a")
        );
        assert_eq!(
            reattached
                .controller
                .takeover_requested_by_device_id
                .as_deref(),
            Some("device-b")
        );
        assert_eq!(
            reattached
                .controller
                .takeover_requested_by_client_id
                .as_deref(),
            Some("client-b")
        );
        assert!(reattached.controller.takeover_request_id.is_some());
        assert!(reattached.controller.takeover_deadline_at.is_some());

        let lease = load_workspace_controller_lease(app.state(), &workspace_id).unwrap();
        assert_eq!(
            lease.takeover_requested_by_device_id.as_deref(),
            Some("device-b")
        );
        assert_eq!(
            lease.takeover_requested_by_client_id.as_deref(),
            Some("client-b")
        );
        assert!(lease.takeover_request_id.is_some());
        assert!(lease.takeover_deadline_at.is_some());
    }

    #[test]
    fn workspace_runtime_attach_keeps_same_device_second_client_as_observer() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-same-device-test");

        let controller = workspace_runtime_attach(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();
        let observer = workspace_runtime_attach(
            workspace_id,
            "device-a".to_string(),
            "client-b".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        assert_eq!(
            controller.controller.controller_client_id.as_deref(),
            Some("client-a")
        );
        assert_eq!(
            observer.controller.controller_client_id.as_deref(),
            Some("client-a")
        );
        assert_eq!(
            observer.controller.controller_device_id.as_deref(),
            Some("device-a")
        );
    }

    #[test]
    fn releasing_controller_allows_same_device_new_client_to_take_over_immediately() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-release-test");

        let controller = workspace_runtime_attach(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        release_workspace_controller_for_client(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            controller.controller.fencing_token,
            app.clone(),
            app.state(),
        )
        .unwrap();

        let reattached = workspace_runtime_attach(
            workspace_id,
            "device-a".to_string(),
            "client-b".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        assert_eq!(
            reattached.controller.controller_device_id.as_deref(),
            Some("device-a")
        );
        assert_eq!(
            reattached.controller.controller_client_id.as_deref(),
            Some("client-b")
        );
        assert_eq!(reattached.controller.fencing_token, 2);
    }

    #[test]
    fn disconnecting_controller_client_releases_matching_workspace_leases() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-disconnect-test");

        workspace_runtime_attach(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        handle_workspace_client_disconnect("device-a", "client-a", &app, app.state()).unwrap();

        let lease = load_workspace_controller_lease(app.state(), &workspace_id).unwrap();
        assert_eq!(lease.controller_device_id, None);
        assert_eq!(lease.controller_client_id, None);
    }

    #[test]
    fn disconnecting_controller_with_pending_takeover_promotes_requester_immediately() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-disconnect-takeover-test");

        workspace_runtime_attach(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        workspace_controller_takeover(
            workspace_id.clone(),
            "device-b".to_string(),
            "client-b".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        handle_workspace_client_disconnect("device-a", "client-a", &app, app.state()).unwrap();

        let lease = load_workspace_controller_lease(app.state(), &workspace_id).unwrap();
        assert_eq!(lease.controller_device_id.as_deref(), Some("device-b"));
        assert_eq!(lease.controller_client_id.as_deref(), Some("client-b"));
        assert_eq!(lease.takeover_request_id, None);
    }

    #[test]
    fn stale_socket_disconnect_does_not_release_live_same_client_controller() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-same-client-sockets");

        register_workspace_client_connection("device-a", "client-a", app.state()).unwrap();
        workspace_runtime_attach(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        register_workspace_client_connection("device-a", "client-a", app.state()).unwrap();

        let released =
            unregister_workspace_client_connection("device-a", "client-a", &app, app.state())
                .unwrap();
        assert!(!released);

        let lease = load_workspace_controller_lease(app.state(), &workspace_id).unwrap();
        assert_eq!(lease.controller_device_id.as_deref(), Some("device-a"));
        assert_eq!(lease.controller_client_id.as_deref(), Some("client-a"));
        assert!(lease.lease_expires_at > 0);

        let released =
            unregister_workspace_client_connection("device-a", "client-a", &app, app.state())
                .unwrap();
        assert!(released);

        let lease = load_workspace_controller_lease(app.state(), &workspace_id).unwrap();
        assert_eq!(lease.controller_device_id, None);
        assert_eq!(lease.controller_client_id, None);
        assert_eq!(lease.lease_expires_at, 0);
    }

    #[test]
    fn workspace_runtime_attach_includes_agent_lifecycle_replay() {
        let app = test_app();
        *app.state().hook_endpoint.lock().unwrap() = Some("http://127.0.0.1:1/claude-hook".into());
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-lifecycle-replay-test");
        let session = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            AgentProvider::claude(),
            app.state(),
        )
        .expect("session should be created");

        emit_agent_lifecycle(
            &app,
            &workspace_id,
            &session.id.to_string(),
            "session_started",
            "SessionStart",
            r#"{"session_id":"claude-lifecycle"}"#,
        );

        let runtime = workspace_runtime_attach(
            workspace_id,
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .expect("runtime attach should succeed");

        assert_eq!(runtime.lifecycle_events.len(), 1);
        assert_eq!(
            runtime.lifecycle_events[0].session_id,
            session.id.to_string()
        );
        assert_eq!(runtime.lifecycle_events[0].kind, "session_started");
        assert_eq!(runtime.lifecycle_events[0].source_event, "SessionStart");
        assert_eq!(runtime.lifecycle_events[0].seq, 1);
    }

    #[test]
    fn workspace_runtime_attach_keeps_created_session_view_and_claude_id() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-session-view-test");
        let session = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            AgentProvider::claude(),
            app.state(),
        )
        .expect("session should be created");

        patch_workspace_view_state(
            app.state(),
            &workspace_id,
            WorkspaceViewPatch {
                active_session_id: Some(session.id.to_string()),
                active_pane_id: Some(format!("pane-{}", session.id)),
                pane_layout: Some(json!({
                    "type": "leaf",
                    "id": format!("pane-{}", session.id),
                    "sessionId": session.id.to_string(),
                })),
                ..WorkspaceViewPatch::default()
            },
        )
        .expect("view state should be updated");
        session_update(
            workspace_id.clone(),
            session.id.clone(),
            SessionPatch {
                title: None,
                status: Some(SessionStatus::Interrupted),
                mode: None,
                auto_feed: None,
                queue: None,
                messages: None,
                unread: None,
                last_active_at: None,
                resume_id: Some("claude-runtime-attach".to_string()),
            },
            app.state(),
        )
        .expect("session should be updated");

        let runtime = workspace_runtime_attach(
            workspace_id,
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .expect("runtime attach should succeed");

        let restored = runtime
            .snapshot
            .sessions
            .iter()
            .find(|candidate| candidate.id == session.id)
            .expect("created session should be present");
        assert_eq!(restored.status, SessionStatus::Interrupted);
        assert_eq!(restored.resume_id.as_deref(), Some("claude-runtime-attach"));
        assert_eq!(
            runtime.snapshot.view_state.active_session_id,
            session.id.to_string()
        );
        assert_eq!(
            runtime.snapshot.view_state.active_pane_id,
            format!("pane-{}", session.id)
        );
        assert_eq!(
            runtime.snapshot.view_state.pane_layout["sessionId"].as_str(),
            Some(session.id.to_string().as_str())
        );
    }

    #[test]
    fn workspace_runtime_attach_includes_runtime_bound_terminal_and_binding() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-session-binding");
        let session = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            AgentProvider::claude(),
            app.state(),
        )
        .unwrap();

        let started = start_bound_session_for_test(&app, &workspace_id, session.id.clone());
        let runtime = workspace_runtime_attach(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        assert_eq!(runtime.session_runtime_bindings.len(), 1);
        assert_eq!(
            runtime.session_runtime_bindings[0].session_id,
            session.id.to_string()
        );
        assert_eq!(
            runtime.session_runtime_bindings[0].terminal_id,
            started.terminal_runtime_id.clone().unwrap()
        );
        assert_eq!(
            runtime.session_runtime_bindings[0].workspace_terminal_id,
            Some(started.terminal_id.to_string())
        );
        assert_eq!(
            runtime.session_runtime_bindings[0].terminal_runtime_id,
            started.terminal_runtime_id
        );
        assert!(runtime
            .snapshot
            .terminals
            .iter()
            .any(|terminal| terminal.id == started.terminal_id));
        assert!(runtime.snapshot.sessions.iter().any(|candidate| {
            candidate.id == session.id
                && candidate.runtime_active
                && candidate.runtime_liveness == Some(SessionRuntimeLiveness::Attached)
        }));
    }

    #[test]
    fn session_runtime_liveness_for_session_ignores_other_bound_sessions() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-session-liveness-targeted");
        let target = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            AgentProvider::claude(),
            app.state(),
        )
        .unwrap();
        let other = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            AgentProvider::claude(),
            app.state(),
        )
        .unwrap();

        app.state()
            .session_runtime_bindings
            .lock()
            .unwrap()
            .insert(session_runtime_key(&workspace_id, &other.id), 99);
        app.state()
            .terminal_runtime_bindings
            .lock()
            .unwrap()
            .insert(99, session_runtime_key(&workspace_id, &other.id));
        app.state().terminal_runtimes.lock().unwrap().insert(
            crate::services::terminal_gateway::TerminalRuntime::new(
                "runtime-missing-other".to_string(),
                workspace_id.clone(),
                other.id.to_string(),
                "claude".to_string(),
                99,
            ),
        );

        assert_eq!(
            session_runtime_liveness_for_session(&workspace_id, &target.id, app.state()),
            None
        );
        assert_eq!(
            session_runtime_liveness_for_session(&workspace_id, &other.id, app.state()),
            Some(SessionRuntimeLiveness::TmuxMissing)
        );
    }

    #[test]
    fn workspace_runtime_attach_reports_tmux_missing_for_bound_session_when_tmux_session_is_gone() {
        let app = test_app();
        let workspace_id =
            launch_test_workspace(&app, "/tmp/ws-runtime-session-binding-tmux-missing");
        let session = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            AgentProvider::claude(),
            app.state(),
        )
        .unwrap();

        app.state()
            .session_runtime_bindings
            .lock()
            .unwrap()
            .insert(session_runtime_key(&workspace_id, &session.id), 99);
        app.state()
            .terminal_runtime_bindings
            .lock()
            .unwrap()
            .insert(99, session_runtime_key(&workspace_id, &session.id));
        app.state().terminal_runtimes.lock().unwrap().insert(
            crate::services::terminal_gateway::TerminalRuntime::new(
                "runtime-missing".to_string(),
                workspace_id.clone(),
                session.id.to_string(),
                "claude".to_string(),
                99,
            ),
        );

        let runtime = workspace_runtime_attach(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        let bound = runtime
            .snapshot
            .sessions
            .iter()
            .find(|candidate| candidate.id == session.id)
            .expect("bound session should be present");
        assert_eq!(
            bound.runtime_liveness,
            Some(SessionRuntimeLiveness::TmuxMissing)
        );
        assert!(runtime.session_runtime_bindings.iter().any(|binding| {
            binding.session_id == session.id.to_string()
                && binding.terminal_runtime_id.as_deref() == Some("runtime-missing")
        }));
    }

    #[test]
    fn workspace_runtime_attach_auto_resumes_bound_claude_session_from_binding() {
        let app = test_app();
        let workspace_root = unique_temp_dir("runtime-attach-provider-workspace");
        let workspace_id = launch_test_workspace(&app, workspace_root.to_str().unwrap());
        let claude_home = unique_temp_dir("runtime-attach-provider-home");
        let claude_dir = claude_home.join(".claude");
        let project_slug = workspace_root
            .to_string_lossy()
            .replace(['/', '\\', ':'], "-");
        let project_dir = claude_dir.join("projects").join(project_slug);
        fs::create_dir_all(&project_dir).unwrap();
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            project_dir.join("resume-session.jsonl"),
            concat!(
                "{\"timestamp\":\"2026-04-05T10:00:00.000Z\"}\n",
                "{\"timestamp\":\"2026-04-05T11:00:00.000Z\"}\n"
            ),
        )
        .unwrap();
        fs::write(
            claude_dir.join("history.jsonl"),
            format!(
                "{{\"display\":\"Claude native title\",\"timestamp\":2,\"project\":\"{}\",\"sessionId\":\"resume-session\"}}\n",
                workspace_root.to_string_lossy()
            ),
        )
        .unwrap();
        replace_view_state_for_test(&app, &workspace_id, |view_state| {
            view_state.session_bindings = vec![WorkspaceSessionBinding {
                session_id: "slot-primary".to_string(),
                provider: AgentProvider::claude(),
                mode: SessionMode::Branch,
                resume_id: Some("resume-session".to_string()),
                title_snapshot: "Old title".to_string(),
                last_seen_at: 1,
            }];
        });
        *app.state().hook_endpoint.lock().unwrap() = Some("http://127.0.0.1:1/claude-hook".into());

        let runtime = with_claude_home(&claude_home, || {
            workspace_runtime_attach(
                workspace_id.clone(),
                "device-a".to_string(),
                "client-a".to_string(),
                app.clone(),
                app.state(),
            )
        })
        .expect("runtime attach should succeed");

        let restored = runtime
            .snapshot
            .sessions
            .iter()
            .find(|session| session.id == "slot-primary")
            .expect("bound slot should resolve");
        assert_eq!(restored.provider, AgentProvider::claude());
        assert_eq!(restored.resume_id.as_deref(), Some("resume-session"));
        assert_eq!(restored.title, "Claude native title");
        assert!(restored.runtime_active);
        assert_eq!(
            restored.runtime_liveness,
            Some(SessionRuntimeLiveness::Attached)
        );
        assert_eq!(runtime.session_runtime_bindings.len(), 1);
        assert_eq!(
            runtime.session_runtime_bindings[0].session_id,
            "slot-primary"
        );
        assert_eq!(runtime.snapshot.view_state.session_bindings.len(), 1);
        assert_eq!(
            runtime.snapshot.view_state.session_bindings[0].title_snapshot,
            "Claude native title"
        );
        assert_eq!(
            runtime.snapshot.view_state.session_bindings[0].last_seen_at,
            1775386800000
        );

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(claude_home);
    }

    #[test]
    fn workspace_runtime_attach_keeps_missing_binding_as_unavailable_placeholder() {
        let app = test_app();
        let workspace_root = unique_temp_dir("runtime-attach-missing-workspace");
        let workspace_id = launch_test_workspace(&app, workspace_root.to_str().unwrap());
        let claude_home = unique_temp_dir("runtime-attach-missing-home");
        replace_view_state_for_test(&app, &workspace_id, |view_state| {
            view_state.session_bindings = vec![WorkspaceSessionBinding {
                session_id: "slot-primary".to_string(),
                provider: AgentProvider::claude(),
                mode: SessionMode::Branch,
                resume_id: Some("missing-session".to_string()),
                title_snapshot: "Deleted Session".to_string(),
                last_seen_at: 123,
            }];
        });

        let runtime = with_claude_home(&claude_home, || {
            workspace_runtime_attach(
                workspace_id.clone(),
                "device-a".to_string(),
                "client-a".to_string(),
                app.clone(),
                app.state(),
            )
        })
        .expect("runtime attach should succeed");

        let missing = runtime
            .snapshot
            .sessions
            .iter()
            .find(|session| session.id == "slot-primary")
            .expect("missing placeholder should remain visible");
        assert_eq!(missing.provider, AgentProvider::claude());
        assert_eq!(missing.title, "Deleted Session");
        assert_eq!(missing.resume_id.as_deref(), Some("missing-session"));
        assert_eq!(missing.status, SessionStatus::Interrupted);
        assert!(!missing.runtime_active);
        assert_eq!(
            missing.unavailable_reason.as_deref(),
            Some("该会话已经被删除，无法恢复")
        );
        assert!(runtime.session_runtime_bindings.is_empty());

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(claude_home);
    }

    #[test]
    fn workspace_runtime_attach_replays_lifecycle_for_bound_runtime_sessions() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-bound-lifecycle-replay");
        let session = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            AgentProvider::claude(),
            app.state(),
        )
        .unwrap();

        emit_agent_lifecycle(
            &app,
            &workspace_id,
            &session.id.to_string(),
            "session_started",
            "SessionStart",
            r#"{"session_id":"claude-bound-replay"}"#,
        );
        let started = start_bound_session_for_test(&app, &workspace_id, session.id.clone());

        let runtime = workspace_runtime_attach(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        assert!(runtime.lifecycle_events.iter().any(|event| {
            event.session_id == session.id.to_string()
                && event.kind == "session_started"
                && event.source_event == "SessionStart"
        }));
        assert!(runtime.session_runtime_bindings.iter().any(|binding| {
            binding.session_id == session.id.to_string()
                && binding.terminal_id == started.terminal_runtime_id.clone().unwrap()
                && binding.workspace_terminal_id == Some(started.terminal_id.to_string())
        }));
        assert!(runtime
            .snapshot
            .terminals
            .iter()
            .any(|terminal| terminal.id == started.terminal_id));
    }

    #[test]
    fn workspace_runtime_attach_keeps_bound_terminal_output_after_runtime_close() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-session-binding-persist");
        let session = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            AgentProvider::claude(),
            app.state(),
        )
        .unwrap();

        let started = start_bound_session_for_test(&app, &workspace_id, session.id.clone());
        #[cfg(target_os = "windows")]
        let input = "echo bound-terminal-persist\r";
        #[cfg(not(target_os = "windows"))]
        let input = "printf 'bound-terminal-persist\\n'\r";

        crate::services::terminal::terminal_write(
            workspace_id.clone(),
            started.terminal_id,
            input.to_string(),
            TerminalWriteOrigin::User,
            app.state(),
        )
        .unwrap();

        let terminal_key = format!("{workspace_id}:{}", started.terminal_id);
        let mut saw_output = false;
        for _ in 0..40 {
            if app
                .state()
                .terminals
                .lock()
                .unwrap()
                .get(&terminal_key)
                .and_then(|runtime| runtime.output.lock().ok().map(|output| output.clone()))
                .is_some_and(|output| output.contains("bound-terminal-persist"))
            {
                saw_output = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        assert!(saw_output, "expected bound terminal output before close");

        crate::services::terminal::terminal_close(
            workspace_id.clone(),
            started.terminal_id,
            app.state(),
        )
        .unwrap();

        let runtime = workspace_runtime_attach(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        assert!(runtime.snapshot.terminals.iter().any(|terminal| {
            terminal.id == started.terminal_id && terminal.output.contains("bound-terminal-persist")
        }));
        assert!(runtime.session_runtime_bindings.iter().any(|binding| {
            binding.session_id == session.id.to_string()
                && binding.terminal_id == started.terminal_id.to_string()
                && binding.terminal_runtime_id.is_none()
                && binding.workspace_terminal_id == Some(started.terminal_id.to_string())
        }));
    }

    #[test]
    fn workspace_runtime_attach_keeps_bound_terminal_after_runtime_exits_naturally() {
        let app = test_app();
        let workspace_id =
            launch_test_workspace(&app, "/tmp/ws-runtime-session-binding-natural-exit");
        let session = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            AgentProvider::claude(),
            app.state(),
        )
        .unwrap();

        app_settings_update(
            serde_json::json!({
                "providers": {
                    "claude": {
                        "global": {
                            "executable": "/bin/sh",
                            "startupArgs": [
                                "-lc",
                                "sleep 0.1"
                            ]
                        }
                    }
                }
            }),
            app.state(),
        )
        .expect("settings update should succeed");

        let started = start_bound_session_for_test(&app, &workspace_id, session.id.clone());

        let terminal_key = format!("{workspace_id}:{}", started.terminal_id);
        let mut exited = false;
        for _ in 0..80 {
            if !app
                .state()
                .terminals
                .lock()
                .unwrap()
                .contains_key(&terminal_key)
            {
                exited = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        assert!(exited, "expected bound terminal runtime to exit");

        let runtime = workspace_runtime_attach(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        assert!(runtime.snapshot.terminals.iter().any(|terminal| {
            terminal.id == started.terminal_id && terminal.output.contains("terminal exited")
        }));
        let binding = runtime
            .session_runtime_bindings
            .iter()
            .find(|binding| binding.session_id == session.id.to_string())
            .expect("runtime binding should remain after natural exit");
        assert_eq!(binding.terminal_id, started.terminal_id.to_string());
        assert_eq!(
            binding.workspace_terminal_id,
            Some(started.terminal_id.to_string())
        );
        assert_eq!(binding.terminal_runtime_id, None);
        let restored_session = runtime
            .snapshot
            .sessions
            .iter()
            .find(|candidate| candidate.id == session.id)
            .expect("bound session should remain visible after natural exit");
        assert_eq!(restored_session.status, SessionStatus::Interrupted);
        assert!(!restored_session.runtime_active);
        assert_eq!(
            restored_session.runtime_liveness,
            Some(SessionRuntimeLiveness::ProviderExited)
        );
    }

    #[test]
    fn workspace_runtime_turn_completed_triggers_supervisor() {
        let _guard = crate::services::supervisor::supervisor_reply_test_lock()
            .lock()
            .unwrap();
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-supervisor-hook");
        crate::services::supervisor::seed_supervisor_binding_for_test(
            app.state(),
            &workspace_id,
            "slot-primary",
            "Keep using xterm",
        );
        crate::services::supervisor::bind_terminal_for_session_for_test(
            app.state(),
            &workspace_id,
            "slot-primary",
            88,
        );
        crate::services::supervisor::install_supervisor_adapter_reply_for_test("Use xterm only.");

        let payload = json!({
            "workspace_id": workspace_id.clone(),
            "session_id": "slot-primary",
            "payload": {
                "hook_event_name": "Stop",
                "transcript_path": "/tmp/transcript.jsonl"
            }
        });

        let result = crate::services::provider_hooks::process_provider_hook_payload(&app, payload);
        crate::services::supervisor::clear_supervisor_adapter_reply_for_test();
        result.unwrap();

        let writes = crate::services::supervisor::take_terminal_writes_for_test(
            app.state(),
            &workspace_id,
            88,
        );
        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0].1, TerminalWriteOrigin::Supervisor);
    }
}
