use crate::infra::db::{
    build_snapshot_from_conn, ensure_workspace_exists_from_conn,
    list_workspace_ids_for_workspace_client_from_conn, load_agent_lifecycle_events_from_conn,
    load_workspace_controller_lease_from_conn, mark_workspace_client_detached_from_conn,
    save_workspace_controller_lease_to_conn, upsert_workspace_attachment_to_conn, with_db,
};
use crate::*;

const WORKSPACE_CONTROLLER_LEASE_SECS: i64 = 30;
const WORKSPACE_TAKEOVER_TIMEOUT_SECS: i64 = 10;
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

pub(crate) fn workspace_runtime_attach(
    workspace_id: String,
    device_id: String,
    client_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WorkspaceRuntimeSnapshot, String> {
    let (lease, snapshot, lifecycle_events, controller_changed) = with_db(state, |conn| {
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

    Ok(WorkspaceRuntimeSnapshot {
        snapshot,
        controller: lease,
        lifecycle_events,
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
    use std::sync::OnceLock;

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
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-lifecycle-replay-test");
        let session = create_workspace_session(
            app.state(),
            &workspace_id,
            SessionMode::Branch,
            AgentProvider::Claude,
        )
        .expect("session should be created");

        emit_agent_lifecycle(
            &app,
            &workspace_id,
            &session.id.to_string(),
            "tool_started",
            "PreToolUse",
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
        assert_eq!(runtime.lifecycle_events[0].kind, "tool_started");
        assert_eq!(runtime.lifecycle_events[0].source_event, "PreToolUse");
        assert_eq!(runtime.lifecycle_events[0].seq, 1);
    }

    #[test]
    fn workspace_runtime_attach_keeps_created_session_view_and_claude_id() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-session-view-test");
        let session = create_workspace_session(
            app.state(),
            &workspace_id,
            SessionMode::Branch,
            AgentProvider::Claude,
        )
        .expect("session should be created");

        patch_workspace_view_state(
            app.state(),
            &workspace_id,
            WorkspaceViewPatch {
                active_session_id: Some(session.id.to_string()),
                active_pane_id: Some(format!("pane-{}", session.id)),
                active_terminal_id: None,
                pane_layout: Some(json!({
                    "type": "leaf",
                    "id": format!("pane-{}", session.id),
                    "sessionId": session.id.to_string(),
                })),
                file_preview: None,
            },
        )
        .expect("view state should be updated");
        update_workspace_session(
            app.state(),
            &workspace_id,
            session.id,
            SessionPatch {
                title: None,
                status: Some(SessionStatus::Interrupted),
                mode: None,
                auto_feed: None,
                queue: None,
                messages: None,
                stream: None,
                unread: None,
                last_active_at: None,
                resume_id: Some("claude-runtime-attach".to_string()),
            },
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
}
