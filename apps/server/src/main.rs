pub(crate) use std::{
    collections::HashSet,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
};

pub(crate) use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, OriginalUri, Path as AxumPath, State as AxumState,
    },
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
pub(crate) use portable_pty::{native_pty_system, CommandBuilder, PtySize};
pub(crate) use rusqlite::{params, Connection};
pub(crate) use serde::{Deserialize, Serialize};
pub(crate) use serde_json::{json, Map, Value};
pub(crate) use tokio::sync::broadcast;
pub(crate) use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeDir,
};

mod app;
mod auth;
mod command;
mod infra;
mod models;
mod runtime;
mod services;
mod ws;

pub(crate) use app::{
    AgentRuntime, AppState, HttpServerState, TerminalRuntime, WorkspaceWatch,
    WorkspaceWatchSuppression, DEV_BACKEND_PORT, DEV_FRONTEND_URL,
};
pub(crate) use auth::{
    admin_auth_status, admin_blocked_ips, admin_config, admin_unblock_ip, admin_update_config,
    auth_status, ensure_optional_path_allowed, ensure_path_allowed, filesystem_list_public,
    filesystem_roots_public, filter_allowed_worktrees, load_or_initialize_auth_runtime,
    lock as auth_lock, login as auth_login, logout as auth_logout, normalize_path_for_target,
    path_within_root, require_session, select_clone_root_for_target, transport_bind_config,
    AuthorizedRequest, RequestContext,
};
pub(crate) use command::http::start_transport_server;
#[cfg(test)]
pub(crate) use infra::db::set_session_status;
pub(crate) use infra::db::{
    activate_workspace_ui, append_agent_lifecycle_event, append_workspace_terminal_output,
    close_workspace_ui, delete_workspace_terminal, init_db, launch_workspace_record_scoped,
    load_session, load_session_history_records, load_workspace_controller_lease,
    load_workspace_slot_session, mark_active_sessions_interrupted_on_boot,
    patch_workspace_view_state, persist_workspace_terminal,
    remove_workspace_bindings_for_provider_session, remove_workspace_session_binding,
    save_workspace_controller_lease, session_slot_id, set_session_resume_id,
    set_session_runtime_state_if_not_archived, set_session_status_if_not_archived,
    set_workspace_terminal_recoverable, update_workbench_layout as persist_workbench_layout,
    update_workspace_idle_policy, upsert_workspace_attachment, upsert_workspace_session_binding,
    workbench_bootstrap as load_workbench_bootstrap, workspace_access_context,
    workspace_snapshot as load_workspace_snapshot,
};
#[cfg(test)]
pub(crate) use infra::db::{
    launch_workspace_record, read_with_db_call_count, reset_with_db_call_count,
};
pub(crate) use infra::runtime::{
    apply_unix_pty_env_defaults, build_agent_pty_command, build_terminal_pty_command,
    repo_name_from_url, resolve_agent_runtime_cwd, resolve_git_repo_path, resolve_target_path,
    resolve_unix_agent_shell, run_cmd, shell_escape, summarize_status, temp_root,
    terminate_process_tree, trim_branch_name,
};
pub(crate) use infra::support::{
    build_changes_tree, build_tree, build_tree_from_paths, combine_git_diff_sections,
    filesystem_home_for_target, git_cached_diff, git_has_head, git_show_file, git_worktree_diff,
    list_directories_for_target, native_parent_path, parse_git_changes, read_target_file_text,
    resolve_git_command_path, wsl_parent_path,
};
pub(crate) use infra::time::{default_idle_policy, now_label, now_ts, status_label};
#[cfg(test)]
pub(crate) use models::ArchiveEntry;
pub(crate) use models::{
    AgentEvent, AgentLifecycleEvent, AgentLifecycleHistoryEntry, AgentProvider, AgentStartResult,
    AppSettingsPayload, ClaudeRuntimeProfile, CodexRuntimeProfile, CommandAvailability, ExecTarget,
    FileNode, FilePreview, FilesystemEntry, FilesystemListResponse, FilesystemRoot, GitChangeEntry,
    GitFileDiffPayload, GitStatus, IdlePolicy, ProviderId, ProviderWorkspaceSession,
    SessionHistoryRecord, SessionInfo, SessionMessage, SessionMessageRole, SessionMode,
    SessionPatch, SessionRestoreResult, SessionRuntimeBindingInfo, SessionRuntimeLiveness,
    SessionRuntimeStartResult,
    SessionStatus, TerminalEvent, TerminalInfo, TerminalWriteOrigin, TransportEvent,
    WorkbenchBootstrap, WorkbenchLayout, WorkbenchUiState, WorkspaceControllerLease,
    WorkspaceLaunchResult, WorkspaceRuntimeSnapshot, WorkspaceRuntimeStateEvent,
    WorkspaceSessionBinding, WorkspaceSessionState, WorkspaceSnapshot, WorkspaceSource,
    WorkspaceSourceKind, WorkspaceSummary, WorkspaceSupervisorBinding, WorkspaceSupervisorCycle,
    WorkspaceSupervisorCycleStatus, WorkspaceSupervisorStatus, WorkspaceSupervisorViewState,
    WorkspaceTree, WorkspaceViewPatch, WorkspaceViewState, WorktreeDetail, WorktreeInfo,
};
pub(crate) use runtime::{AppHandle, State};
pub(crate) use services::agent::{
    agent_stop, stop_agent_runtime_without_status_update, stop_workspace_agents,
};
pub(crate) use services::app_settings::{
    app_settings_get, app_settings_update, load_or_default_app_settings,
};
pub(crate) use services::filesystem::{
    file_preview, file_save, filesystem_list, filesystem_roots, invalidate_workspace_tree_cache,
    workspace_tree, workspace_tree_cached,
};
pub(crate) use services::git::{
    git_changes_cached, git_commit, git_diff, git_diff_file, git_discard_all, git_discard_file,
    git_file_diff_payload, git_stage_all, git_stage_file, git_status_cached, git_status_label,
    git_unstage_all, git_unstage_file, invalidate_git_artifact_caches, worktree_list_cached,
};
pub(crate) use services::provider_hooks::{
    current_app_bin_for_target, current_hook_endpoint, run_provider_hook_helper,
    start_provider_hook_receiver,
};
pub(crate) use services::session_runtime::{session_runtime_start, SessionRuntimeStartParams};
pub(crate) use services::system::command_exists;
pub(crate) use services::terminal::{
    close_workspace_terminals, terminal_close, terminal_create, terminal_resize, terminal_write,
};
pub(crate) use services::workspace::{
    activate_workspace_scoped, close_session, close_workspace_scoped, create_session,
    delete_provider_session, launch_workspace_internal_scoped, launch_workspace_scoped,
    list_session_history, remove_missing_binding, restore_provider_session, session_update,
    switch_session, sync_session_runtime_state, sync_session_status, update_idle_policy,
    update_workbench_layout_scoped, workbench_bootstrap_scoped, workspace_snapshot,
    workspace_view_update, worktree_inspect,
};
pub(crate) use services::workspace_runtime::{
    assert_workspace_controller_can_mutate, register_workspace_client_connection,
    release_workspace_controller, release_workspace_controller_for_client,
    unregister_workspace_client_connection, workspace_controller_heartbeat,
    workspace_controller_reject_takeover, workspace_controller_takeover, workspace_runtime_attach,
};
pub(crate) use services::workspace_watch::{
    begin_workspace_watch_suppression, end_workspace_watch_suppression, ensure_workspace_watch,
    stop_workspace_watch,
};
pub(crate) use ws::server::{
    agent_key, emit_agent, emit_agent_lifecycle, emit_terminal, emit_workspace_artifacts_dirty,
    terminal_key,
};

use runtime::RuntimeHandle;

fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var_os(key).map(PathBuf::from)
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        env_path("USERPROFILE").or_else(|| {
            let drive = std::env::var_os("HOMEDRIVE")?;
            let path = std::env::var_os("HOMEPATH")?;
            Some(PathBuf::from(format!(
                "{}{}",
                drive.to_string_lossy(),
                path.to_string_lossy()
            )))
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        env_path("HOME")
    }
}

fn resolve_state_dir() -> Result<PathBuf, std::io::Error> {
    if let Some(path) = env_path("CODER_STUDIO_HOME") {
        return Ok(path);
    }

    #[cfg(target_os = "macos")]
    {
        let home = home_dir().ok_or_else(|| std::io::Error::other("missing home directory"))?;
        return Ok(home
            .join("Library/Application Support")
            .join("coder-studio"));
    }

    #[cfg(target_os = "windows")]
    {
        let home = home_dir().ok_or_else(|| std::io::Error::other("missing home directory"))?;
        let local_app_data = env_path("LOCALAPPDATA").unwrap_or_else(|| home.join("AppData/Local"));
        return Ok(local_app_data.join("coder-studio"));
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        if let Some(path) = env_path("XDG_STATE_HOME") {
            return Ok(path.join("coder-studio"));
        }

        let home = home_dir().ok_or_else(|| std::io::Error::other("missing home directory"))?;
        Ok(home.join(".local/state").join("coder-studio"))
    }
}

fn resolve_app_data_dir() -> Result<PathBuf, std::io::Error> {
    if let Some(path) = env_path("CODER_STUDIO_DATA_DIR") {
        return Ok(path);
    }

    Ok(resolve_state_dir()?.join("data"))
}

fn install_provider_hooks_on_startup(app: &AppHandle) -> Vec<(String, String)> {
    let state: State<AppState> = app.state();
    let settings = match load_or_default_app_settings(state) {
        Ok(settings) => settings,
        Err(error) => return vec![("settings".to_string(), error)],
    };
    crate::services::provider_registry::install_missing_provider_hooks(
        &settings,
        "",
        &ExecTarget::Native,
    )
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

    #[test]
    fn install_provider_hooks_on_startup_returns_settings_error_without_panicking() {
        let app = test_app();
        *app.state().db.lock().unwrap() = None;

        let errors = install_provider_hooks_on_startup(&app);

        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].0, "settings");
    }

    #[test]
    fn install_provider_hooks_on_startup_only_reports_missing_provider_install_failures() {
        let app = test_app();
        let _guard = crate::services::provider_registry::provider_env_test_lock()
            .lock()
            .unwrap();
        let claude_home = std::env::temp_dir().join(format!(
            "coder-studio-main-startup-hooks-claude-{}",
            now_ts()
        ));
        let codex_home = std::env::temp_dir().join(format!(
            "coder-studio-main-startup-hooks-codex-{}",
            now_ts()
        ));
        std::fs::create_dir_all(&claude_home).unwrap();
        std::fs::create_dir_all(codex_home.join(".codex")).unwrap();
        std::fs::write(
            codex_home.join(".codex/hooks.json"),
            serde_json::to_string_pretty(&json!({
                "hooks": {
                    "SessionStart": [{
                        "matcher": "startup|resume",
                        "hooks": [{
                            "type": "command",
                            "command": "/bin/sh -lc 'exec \"/tmp/app\" --coder-studio-agent-hook'"
                        }]
                    }],
                    "Stop": [{
                        "hooks": [{
                            "type": "command",
                            "command": "/bin/sh -lc 'exec \"/tmp/app\" --coder-studio-agent-hook'"
                        }]
                    }]
                }
            }))
            .unwrap(),
        )
        .unwrap();
        std::fs::write(claude_home.join(".claude"), "blocking file").unwrap();

        let previous_claude = std::env::var_os("CODER_STUDIO_CLAUDE_HOME");
        let previous_codex = std::env::var_os("CODER_STUDIO_CODEX_HOME");
        std::env::set_var("CODER_STUDIO_CLAUDE_HOME", &claude_home);
        std::env::set_var("CODER_STUDIO_CODEX_HOME", &codex_home);

        let errors = install_provider_hooks_on_startup(&app);

        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].0, "claude");
        assert!(!claude_home.join(".claude/settings.json").exists());
        assert!(codex_home.join(".codex/hooks.json").exists());

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
        let _ = std::fs::remove_dir_all(claude_home);
        let _ = std::fs::remove_dir_all(codex_home);
    }
}

#[tokio::main]
async fn main() {
    if std::env::args().any(|arg| arg == "--coder-studio-agent-hook") {
        run_provider_hook_helper();
        return;
    }

    if let Err(error) = run().await {
        eprintln!("failed to start coder-studio: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let app_data = resolve_app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;

    let auth_runtime = load_or_initialize_auth_runtime(&app_data)?;
    let db_path = app_data.join("coder-studio.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    init_db(&conn).map_err(|e| e.to_string())?;
    mark_active_sessions_interrupted_on_boot(&conn)?;

    let (app, mut shutdown_rx) = RuntimeHandle::new();
    start_provider_hook_receiver(&app)?;

    let state: State<AppState> = app.state();
    {
        let mut auth_guard = state.auth.lock().map_err(|e| e.to_string())?;
        *auth_guard = auth_runtime;
    }
    {
        let mut db_guard = state.db.lock().map_err(|e| e.to_string())?;
        *db_guard = Some(conn);
    }

    for (provider_id, error) in install_provider_hooks_on_startup(&app) {
        eprintln!("warning: failed to install provider hooks for {provider_id}: {error}");
    }

    let transport_server = start_transport_server(&app)?;
    if cfg!(debug_assertions) {
        println!("Coder Studio web dev server: {DEV_FRONTEND_URL}");
        println!("Coder Studio local server: {}", transport_server.endpoint);
    } else {
        println!(
            "Coder Studio server running at {}",
            transport_server.endpoint
        );
    }

    axum::serve(
        transport_server.listener,
        transport_server
            .router
            .into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(async move {
        tokio::select! {
            _ = shutdown_rx.changed() => {}
            _ = tokio::signal::ctrl_c() => {}
        }
    })
    .await
    .map_err(|e| e.to_string())
}
