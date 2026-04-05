use crate::*;

fn live_session_key(workspace_id: &str, session_id: &str) -> String {
    format!("{workspace_id}:{session_id}")
}

fn remember_live_session(
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
    load_workbench_bootstrap(state, device_id, client_id)
}

pub(crate) fn workspace_snapshot(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceSnapshot, String> {
    let snapshot = load_workspace_snapshot(state, &workspace_id)?;
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
    archive_workspace_sessions(state, &workspace_id)?;
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
    let updated =
        set_session_status_if_not_archived(state, workspace_id, session_id.clone(), status)?;
    if !updated {
        return Ok(false);
    }
    let session = load_session(state, workspace_id, session_id)?;
    emit_workspace_runtime_state(
        state,
        workspace_id,
        None,
        Some(session_state_payload(&session)),
    )?;
    Ok(true)
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
        status,
        runtime_active,
    )?;
    if !updated {
        return Ok(false);
    }
    let session = load_session(state, workspace_id, session_id)?;
    emit_workspace_runtime_state(
        state,
        workspace_id,
        None,
        Some(session_state_payload(&session)),
    )?;
    Ok(true)
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
    let session = create_workspace_session(state, &workspace_id, mode, provider)?;
    remember_live_session(state, &workspace_id, &session)?;
    Ok(session)
}

pub(crate) fn session_update<S: ToString>(
    workspace_id: String,
    session_id: S,
    patch: SessionPatch,
    state: State<'_, AppState>,
) -> Result<SessionInfo, String> {
    let session = update_workspace_session(state, &workspace_id, session_id, patch)?;
    remember_live_session(state, &workspace_id, &session)?;
    Ok(session)
}

pub(crate) fn switch_session<S: ToString>(
    workspace_id: String,
    session_id: S,
    state: State<'_, AppState>,
) -> Result<SessionInfo, String> {
    let session = switch_workspace_session(state, &workspace_id, session_id)?;
    remember_live_session(state, &workspace_id, &session)?;
    Ok(session)
}

pub(crate) fn archive_session<S: ToString>(
    workspace_id: String,
    session_id: S,
    state: State<'_, AppState>,
) -> Result<ArchiveEntry, String> {
    let session_id = session_id.to_string();
    let entry = archive_workspace_session(state, &workspace_id, &session_id)?;
    let _ = forget_live_session(state, &workspace_id, &entry.session_id);
    let _ = stop_agent_runtime_without_status_update(&workspace_id, &session_id, state);
    Ok(entry)
}

pub(crate) fn list_session_history(
    state: State<'_, AppState>,
) -> Result<Vec<SessionHistoryRecord>, String> {
    load_session_history_records(state)
}

pub(crate) fn restore_session<S: ToString>(
    workspace_id: String,
    session_id: S,
    state: State<'_, AppState>,
) -> Result<SessionRestoreResult, String> {
    let restored = restore_workspace_session(state, &workspace_id, session_id)?;
    remember_live_session(state, &workspace_id, &restored.session)?;
    Ok(restored)
}

pub(crate) fn delete_session<S: ToString>(
    workspace_id: String,
    session_id: S,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session_id = session_id.to_string();
    let _ = stop_agent_runtime_without_status_update(&workspace_id, &session_id, state);
    let result = delete_workspace_session(state, &workspace_id, session_id.clone());
    let _ = forget_live_session(state, &workspace_id, &session_id);
    result
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

    #[test]
    fn workspace_view_update_broadcasts_runtime_state() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-state-test");
        let mut rx = app.state().transport_events.subscribe();

        let view_state = workspace_view_update(
            workspace_id.clone(),
            WorkspaceViewPatch {
                active_session_id: None,
                active_pane_id: None,
                active_terminal_id: Some("7".to_string()),
                pane_layout: None,
                file_preview: None,
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
            payload.view_state.as_ref().map(|view_state| view_state.active_terminal_id.as_str()),
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
    fn archive_session_keeps_an_idle_runtime_status_inside_archive_snapshot() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-history-archive-test");
        let created = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            AgentProvider::claude(),
            app.state(),
        )
        .unwrap();
        let created_id = created.id.clone();
        set_session_runtime_state_if_not_archived(
            app.state(),
            &workspace_id,
            &created_id,
            SessionStatus::Running,
            true,
        )
        .unwrap();

        let _entry = archive_session(workspace_id.clone(), &created_id, app.state()).unwrap();
        let snapshot = workspace_snapshot(workspace_id.clone(), app.state()).unwrap();
        let archived = snapshot
            .archive
            .iter()
            .find(|entry| entry.session_id == created_id)
            .unwrap();
        let status = archived.snapshot["status"].as_str().unwrap();
        assert_eq!(status, "idle");
        assert!(archived.snapshot.get("runtime_active").is_none());
    }

    #[test]
    fn restore_and_delete_session_round_trip_history_records() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-history-restore-test");
        let created = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            AgentProvider::claude(),
            app.state(),
        )
        .unwrap();
        let created_id = created.id.clone();
        archive_session(workspace_id.clone(), &created_id, app.state()).unwrap();

        let history_before = list_session_history(app.state()).unwrap();
        assert!(history_before
            .iter()
            .any(|record| record.session_id == created_id && record.archived));

        let restored = restore_session(workspace_id.clone(), &created_id, app.state()).unwrap();
        assert_eq!(restored.session.id, created_id);
        assert!(!restored.already_active);

        delete_session(workspace_id.clone(), &created_id, app.state()).unwrap();
        let history_after = list_session_history(app.state()).unwrap();
        assert!(!history_after
            .iter()
            .any(|record| record.session_id == created_id));
    }

    #[test]
    fn close_workspace_archives_all_sessions_but_keeps_workspace_history_visible() {
        let app = test_app();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-history-close-test");
        let extra = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            AgentProvider::claude(),
            app.state(),
        )
        .unwrap();
        let live_ids = workspace_snapshot(workspace_id.clone(), app.state())
            .unwrap()
            .sessions
            .into_iter()
            .map(|session| session.id)
            .collect::<Vec<_>>();

        close_workspace_scoped(workspace_id.clone(), None, None, app.state()).unwrap();

        let history = list_session_history(app.state()).unwrap();
        let records = history
            .into_iter()
            .filter(|record| record.workspace_id == workspace_id)
            .collect::<Vec<_>>();
        assert_eq!(records.len(), live_ids.len());
        assert!(records.iter().all(|record| record.archived));
        assert!(records.iter().any(|record| record.session_id == extra.id));
        for live_id in live_ids {
            assert!(records.iter().any(|record| record.session_id == live_id));
        }
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
    fn session_last_active_at_is_persisted_in_millis_for_create_switch_archive_and_restore() {
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

        let archived = archive_session(workspace_id.clone(), &created_id, app.state()).unwrap();
        let archived_last_active_at = archived
            .snapshot
            .get("last_active_at")
            .and_then(Value::as_i64)
            .expect("archive snapshot should contain last_active_at");
        assert!(
            archived_last_active_at >= TIMESTAMP_MILLIS_THRESHOLD,
            "archive_session should use millisecond timestamps"
        );

        let restored = restore_session(workspace_id.clone(), &created_id, app.state()).unwrap();
        assert!(
            restored.session.last_active_at >= TIMESTAMP_MILLIS_THRESHOLD,
            "restore_session should use millisecond timestamps"
        );

        let history = list_session_history(app.state()).unwrap();
        let restored_record = history
            .into_iter()
            .find(|record| record.workspace_id == workspace_id && record.session_id == created_id)
            .expect("history record should exist");
        assert!(
            restored_record.last_active_at >= TIMESTAMP_MILLIS_THRESHOLD,
            "history should read millisecond last_active_at values"
        );
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
