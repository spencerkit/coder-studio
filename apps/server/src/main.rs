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
    lock as auth_lock, login as auth_login, logout as auth_logout, require_session,
    select_clone_root_for_target, transport_bind_config, AuthorizedRequest, RequestContext,
};
pub(crate) use command::http::start_transport_server;
pub(crate) use infra::db::{
    activate_workspace_ui, append_session_stream, archive_workspace_session, close_workspace_ui,
    create_workspace_session, init_db, launch_workspace_record, load_session,
    mark_active_sessions_interrupted_on_boot, patch_workspace_view_state, set_session_claude_id,
    set_session_status, switch_workspace_session,
    update_workbench_layout as persist_workbench_layout, update_workspace_idle_policy,
    update_workspace_session, workbench_bootstrap as load_workbench_bootstrap,
    workspace_access_context, workspace_snapshot as load_workspace_snapshot,
};
pub(crate) use infra::runtime::{
    build_agent_pty_command, build_claude_resume_command, build_terminal_pty_command,
    repo_name_from_url, resolve_git_repo_path, resolve_target_path, run_cmd, shell_escape,
    summarize_status, temp_root, trim_branch_name,
};
pub(crate) use infra::support::{
    build_changes_tree, build_tree, build_tree_from_paths, combine_git_diff_sections,
    filesystem_home_for_target, git_cached_diff, git_has_head, git_show_file, git_worktree_diff,
    list_directories_for_target, native_parent_path, parse_git_changes, read_target_file_text,
    resolve_git_command_path, wsl_parent_path,
};
pub(crate) use infra::time::{default_idle_policy, now_label, now_ts, status_label};
pub(crate) use models::{
    AgentEvent, AgentLifecycleEvent, AgentStartResult, ArchiveEntry, ClaudeSlashSkillEntry,
    CommandAvailability, ExecTarget, FileNode, FilePreview, FilesystemEntry,
    FilesystemListResponse, FilesystemRoot, GitChangeEntry, GitFileDiffPayload, GitStatus,
    IdlePolicy, SessionInfo, SessionMessage, SessionMessageRole, SessionMode, SessionPatch,
    SessionStatus, TerminalEvent, TerminalInfo, TransportEvent, WorkbenchBootstrap,
    WorkbenchLayout, WorkbenchUiState, WorkspaceLaunchResult, WorkspaceSnapshot, WorkspaceSource,
    WorkspaceSourceKind, WorkspaceSummary, WorkspaceTree, WorkspaceViewPatch, WorkspaceViewState,
    WorktreeDetail, WorktreeInfo,
};
pub(crate) use runtime::{AppHandle, State};
pub(crate) use services::agent::{agent_resize, agent_send, agent_start, agent_stop};
pub(crate) use services::claude::{
    current_app_bin_for_target, current_hook_endpoint, ensure_claude_hook_settings,
    run_claude_hook_helper, start_claude_hook_receiver,
};
pub(crate) use services::filesystem::{
    file_preview, file_save, filesystem_list, filesystem_roots, workspace_tree,
};
pub(crate) use services::git::{
    git_changes, git_commit, git_diff, git_diff_file, git_discard_all, git_discard_file,
    git_file_diff_payload, git_stage_all, git_stage_file, git_status, git_status_label,
    git_unstage_all, git_unstage_file, worktree_list,
};
pub(crate) use services::system::{claude_slash_skills, command_exists};
pub(crate) use services::terminal::{
    terminal_close, terminal_create, terminal_resize, terminal_write,
};
pub(crate) use services::workspace::{
    activate_workspace, archive_session, close_workspace, create_session, launch_workspace,
    launch_workspace_internal, session_update, switch_session, update_idle_policy,
    update_workbench_layout, workbench_bootstrap, workspace_snapshot, workspace_view_update,
    worktree_inspect,
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

#[tokio::main]
async fn main() {
    if std::env::args().any(|arg| arg == "--coder-studio-claude-hook") {
        run_claude_hook_helper();
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
    start_claude_hook_receiver(&app)?;

    let state: State<AppState> = app.state();
    {
        let mut auth_guard = state.auth.lock().map_err(|e| e.to_string())?;
        *auth_guard = auth_runtime;
    }
    {
        let mut db_guard = state.db.lock().map_err(|e| e.to_string())?;
        *db_guard = Some(conn);
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
