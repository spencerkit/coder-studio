use crate::*;

pub(crate) fn launch_workspace_internal(
    source: WorkspaceSource,
    clone_root_override: Option<String>,
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

    launch_workspace_record(state, source, project_path, default_idle_policy())
}

pub(crate) fn launch_workspace(
    source: WorkspaceSource,
    state: State<'_, AppState>,
) -> Result<WorkspaceLaunchResult, String> {
    launch_workspace_internal(source, None, state)
}

pub(crate) fn workbench_bootstrap(
    state: State<'_, AppState>,
) -> Result<WorkbenchBootstrap, String> {
    load_workbench_bootstrap(state)
}

pub(crate) fn workspace_snapshot(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceSnapshot, String> {
    load_workspace_snapshot(state, &workspace_id)
}

pub(crate) fn activate_workspace(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<WorkbenchUiState, String> {
    activate_workspace_ui(state, &workspace_id)
}

pub(crate) fn close_workspace(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<WorkbenchUiState, String> {
    close_workspace_ui(state, &workspace_id)
}

pub(crate) fn update_workbench_layout(
    layout: WorkbenchLayout,
    state: State<'_, AppState>,
) -> Result<WorkbenchUiState, String> {
    persist_workbench_layout(state, layout)
}

pub(crate) fn workspace_view_update(
    workspace_id: String,
    patch: WorkspaceViewPatch,
    state: State<'_, AppState>,
) -> Result<WorkspaceViewState, String> {
    patch_workspace_view_state(state, &workspace_id, patch)
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
    let key = agent_key(&workspace_id, &session_id.to_string());
    if let Ok(mut agents) = state.agents.lock() {
        if let Some(runtime) = agents.remove(&key) {
            if let Ok(mut child) = runtime.child.lock() {
                let _ = child.kill();
            }
            if let Ok(mut writer) = runtime.writer.lock() {
                *writer = None;
            }
        }
    }
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
