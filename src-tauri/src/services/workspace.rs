use crate::*;

#[tauri::command]
pub(crate) fn init_workspace(
    source: WorkspaceSource,
    state: State<'_, AppState>,
) -> Result<WorkspaceInfo, String> {
    let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
    let tab = ensure_tab(&mut tabs, &source.tab_id, &source.target);
    let project_path = match source.kind {
        WorkspaceSourceKind::Remote => {
            let root = temp_root(&source.target)?;
            if matches!(source.target, ExecTarget::Wsl { .. }) {
                let _ = run_cmd(&source.target, "", &["mkdir", "-p", &root]);
            }
            let name = repo_name_from_url(&source.path_or_url);
            let target_path = if matches!(source.target, ExecTarget::Wsl { .. }) {
                format!("{}/{}-{}", root, name, now_ts())
            } else {
                PathBuf::from(&root)
                    .join(format!("{}-{}", name, now_ts()))
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

    tab.project_path = project_path.clone();
    tab.target = source.target.clone();
    Ok(WorkspaceInfo {
        tab_id: tab.tab_id.clone(),
        project_path,
        target: tab.target.clone(),
    })
}

#[tauri::command]
pub(crate) fn tab_snapshot(
    tab_id: String,
    state: State<'_, AppState>,
) -> Result<TabSnapshot, String> {
    let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
    let tab = ensure_tab(&mut tabs, &tab_id, &ExecTarget::Native);
    Ok(snapshot_tab(tab))
}

#[tauri::command]
pub(crate) fn create_session(
    tab_id: String,
    mode: SessionMode,
    state: State<'_, AppState>,
) -> Result<SessionInfo, String> {
    let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
    let tab = ensure_tab(&mut tabs, &tab_id, &ExecTarget::Native);

    let status = if tab
        .sessions
        .iter()
        .filter(|s| !matches!(s.status, SessionStatus::Suspended | SessionStatus::Queued))
        .count() as u32
        >= tab.idle_policy.max_active
    {
        SessionStatus::Queued
    } else {
        SessionStatus::Idle
    };

    let session = SessionInfo {
        id: tab.next_session_id,
        status,
        mode,
        auto_feed: true,
        queue: vec![],
        last_active_at: now_ts(),
        claude_session_id: None,
    };
    tab.active_session_id = session.id;
    tab.next_session_id += 1;
    tab.sessions.insert(0, session.clone());
    persist_session(&state, &tab_id, &session);
    Ok(session)
}

#[tauri::command]
pub(crate) fn session_update(
    tab_id: String,
    session_id: u64,
    patch: SessionPatch,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
    let tab = ensure_tab(&mut tabs, &tab_id, &ExecTarget::Native);
    let Some(session) = tab.sessions.iter_mut().find(|s| s.id == session_id) else {
        // Frontend session patches are best-effort and can arrive after a draft
        // session has been materialized, switched away, or archived.
        return Ok(());
    };

    if let Some(status) = patch.status {
        session.status = status;
    }
    if let Some(mode) = patch.mode {
        session.mode = mode;
    }
    if let Some(auto_feed) = patch.auto_feed {
        session.auto_feed = auto_feed;
    }
    if let Some(last_active_at) = patch.last_active_at {
        session.last_active_at = last_active_at;
    }
    if let Some(claude_session_id) = patch.claude_session_id {
        session.claude_session_id = Some(claude_session_id);
    }

    persist_session(&state, &tab_id, session);
    Ok(())
}

#[tauri::command]
pub(crate) fn switch_session(
    tab_id: String,
    session_id: u64,
    state: State<'_, AppState>,
) -> Result<SessionInfo, String> {
    let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
    let tab = ensure_tab(&mut tabs, &tab_id, &ExecTarget::Native);
    if let Some(session) = tab.sessions.iter_mut().find(|s| s.id == session_id) {
        tab.active_session_id = session_id;
        session.last_active_at = now_ts();
        let snapshot = session.clone();
        persist_session(&state, &tab_id, &snapshot);
        return Ok(snapshot);
    }
    Err("session_not_found".to_string())
}

#[tauri::command]
pub(crate) fn archive_session(
    tab_id: String,
    session_id: u64,
    state: State<'_, AppState>,
) -> Result<ArchiveEntry, String> {
    let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
    let tab = ensure_tab(&mut tabs, &tab_id, &ExecTarget::Native);
    let index = tab
        .sessions
        .iter()
        .position(|s| s.id == session_id)
        .ok_or("session_not_found")?;
    let session = tab.sessions.remove(index);
    let snapshot = serde_json::to_value(&session).map_err(|e| e.to_string())?;
    let entry = ArchiveEntry {
        id: now_ts() as u64,
        session_id: session.id,
        mode: session.mode,
        time: now_label(),
        snapshot,
    };
    tab.archive.push(entry.clone());
    persist_archive(&state, &tab_id, &entry);
    delete_session(&state, &tab_id, session.id);
    if tab.active_session_id == session_id {
        if let Some(first) = tab.sessions.first() {
            tab.active_session_id = first.id;
        }
    }
    let key = agent_key(&tab_id, &session_id.to_string());
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

#[tauri::command]
pub(crate) fn update_idle_policy(
    tab_id: String,
    policy: IdlePolicy,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
    let tab = ensure_tab(&mut tabs, &tab_id, &ExecTarget::Native);
    tab.idle_policy = policy;
    Ok(())
}

#[tauri::command]
pub(crate) fn queue_add(
    tab_id: String,
    session_id: u64,
    text: String,
    state: State<'_, AppState>,
) -> Result<QueueTask, String> {
    let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
    let tab = ensure_tab(&mut tabs, &tab_id, &ExecTarget::Native);
    if let Some(session) = tab.sessions.iter_mut().find(|s| s.id == session_id) {
        let task = QueueTask {
            id: tab.next_task_id,
            text,
            status: "queued".to_string(),
        };
        tab.next_task_id += 1;
        session.queue.push(task.clone());
        persist_session(&state, &tab_id, session);
        return Ok(task);
    }
    Err("session_not_found".to_string())
}

#[tauri::command]
pub(crate) fn queue_complete(
    tab_id: String,
    session_id: u64,
    task_id: u64,
    state: State<'_, AppState>,
) -> Result<SessionInfo, String> {
    let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
    let tab = ensure_tab(&mut tabs, &tab_id, &ExecTarget::Native);
    if let Some(session) = tab.sessions.iter_mut().find(|s| s.id == session_id) {
        if let Some(task) = session.queue.iter_mut().find(|t| t.id == task_id) {
            task.status = "done".to_string();
            session.status = SessionStatus::Idle;
            session.last_active_at = now_ts();
            let snapshot = session.clone();
            persist_session(&state, &tab_id, &snapshot);
            return Ok(snapshot);
        }
    }
    Err("task_not_found".to_string())
}

#[tauri::command]
pub(crate) fn queue_run(
    tab_id: String,
    session_id: u64,
    task_id: u64,
    state: State<'_, AppState>,
) -> Result<SessionInfo, String> {
    let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
    let tab = ensure_tab(&mut tabs, &tab_id, &ExecTarget::Native);
    if let Some(session) = tab.sessions.iter_mut().find(|s| s.id == session_id) {
        for task in session.queue.iter_mut() {
            if task.id == task_id {
                task.status = "running".to_string();
            } else if task.status == "running" {
                task.status = "queued".to_string();
            }
        }
        session.status = SessionStatus::Running;
        session.last_active_at = now_ts();
        let snapshot = session.clone();
        persist_session(&state, &tab_id, &snapshot);
        return Ok(snapshot);
    }
    Err("task_not_found".to_string())
}

#[tauri::command]
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
