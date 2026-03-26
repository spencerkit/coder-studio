use crate::*;

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

pub(crate) fn workspace_view_update(
    workspace_id: String,
    patch: WorkspaceViewPatch,
    state: State<'_, AppState>,
) -> Result<WorkspaceViewState, String> {
    let view_state = patch_workspace_view_state(state, &workspace_id, patch)?;
    let _ = state.transport_events.send(TransportEvent {
        event: "workspace://runtime_state".to_string(),
        payload: serde_json::to_value(WorkspaceRuntimeStateEvent {
            workspace_id,
            view_state: view_state.clone(),
        })
        .map_err(|e| e.to_string())?,
    });
    Ok(view_state)
}

pub(crate) fn create_session(
    workspace_id: String,
    mode: SessionMode,
    state: State<'_, AppState>,
) -> Result<SessionInfo, String> {
    create_workspace_session(state, &workspace_id, mode)
}

pub(crate) fn session_update(
    workspace_id: String,
    session_id: u64,
    patch: SessionPatch,
    state: State<'_, AppState>,
) -> Result<SessionInfo, String> {
    update_workspace_session(state, &workspace_id, session_id, patch)
}

pub(crate) fn switch_session(
    workspace_id: String,
    session_id: u64,
    state: State<'_, AppState>,
) -> Result<SessionInfo, String> {
    switch_workspace_session(state, &workspace_id, session_id)
}

pub(crate) fn archive_session(
    workspace_id: String,
    session_id: u64,
    state: State<'_, AppState>,
) -> Result<ArchiveEntry, String> {
    let entry = archive_workspace_session(state, &workspace_id, session_id)?;
    let _ = agent_stop(workspace_id.clone(), session_id.to_string(), state);
    Ok(entry)
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
        assert_eq!(payload.view_state.active_terminal_id, "7");
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
}
