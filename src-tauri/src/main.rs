pub(crate) use std::{
    collections::{HashMap, HashSet},
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
};

pub(crate) use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path as AxumPath, State as AxumState,
    },
    http::StatusCode,
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
pub(crate) use portable_pty::{native_pty_system, CommandBuilder, PtySize};
pub(crate) use rusqlite::{params, Connection};
pub(crate) use serde::{Deserialize, Serialize};
pub(crate) use serde_json::{json, Map, Value};
pub(crate) use tauri::{Emitter, Manager, State};
pub(crate) use tauri_plugin_dialog::DialogExt;
pub(crate) use tokio::sync::broadcast;
pub(crate) use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeDir,
};

mod app;
mod command;
mod infra;
mod models;
mod services;
mod ws;

pub(crate) use app::{
    bootstrap_tab_state, AgentRuntime, AppState, HttpServerState, TabState, TerminalRuntime,
    DEV_BACKEND_PORT, DEV_FRONTEND_URL,
};
pub(crate) use command::http::start_transport_server;
pub(crate) use infra::db::{
    delete_session, ensure_tab, init_db, persist_archive, persist_session, snapshot_tab,
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
pub(crate) use infra::time::{mode_label, now_label, now_ts, status_label};
pub(crate) use models::{
    AgentEvent, AgentLifecycleEvent, AgentStartResult, ArchiveEntry, ClaudeSlashSkillEntry,
    CommandAvailability, ExecTarget, FileNode, FilePreview, FilesystemEntry,
    FilesystemListResponse, FilesystemRoot, GitChangeEntry, GitFileDiffPayload, GitStatus,
    IdlePolicy, QueueTask, SessionInfo, SessionMode, SessionPatch, SessionStatus, TabSnapshot,
    TerminalEvent, TerminalInfo, TransportEvent, WorkspaceInfo, WorkspaceSource,
    WorkspaceSourceKind, WorkspaceTree, WorktreeDetail, WorktreeInfo,
};
pub(crate) use services::agent::{agent_resize, agent_send, agent_start, agent_stop};
pub(crate) use services::claude::{
    current_app_bin_for_target, current_hook_endpoint, ensure_claude_hook_settings,
    run_claude_hook_helper, start_claude_hook_receiver,
};
pub(crate) use services::filesystem::{
    dialog_pick_folder, file_preview, file_save, filesystem_list, filesystem_roots, workspace_tree,
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
    archive_session, create_session, init_workspace, queue_add, queue_complete, queue_run,
    session_update, switch_session, tab_snapshot, update_idle_policy, worktree_inspect,
};
pub(crate) use ws::server::{
    agent_key, emit_agent, emit_agent_lifecycle, emit_terminal, terminal_key,
};

fn main() {
    if std::env::args().any(|arg| arg == "--coder-studio-claude-hook") {
        run_claude_hook_helper();
        return;
    }

    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            init_workspace,
            tab_snapshot,
            create_session,
            session_update,
            switch_session,
            archive_session,
            update_idle_policy,
            queue_add,
            queue_run,
            queue_complete,
            git_status,
            git_diff,
            git_changes,
            git_diff_file,
            git_file_diff_payload,
            git_stage_all,
            git_stage_file,
            git_unstage_all,
            git_unstage_file,
            git_discard_all,
            git_discard_file,
            git_commit,
            worktree_list,
            worktree_inspect,
            workspace_tree,
            file_preview,
            file_save,
            filesystem_roots,
            filesystem_list,
            command_exists,
            dialog_pick_folder,
            claude_slash_skills,
            terminal_create,
            terminal_write,
            terminal_resize,
            terminal_close,
            agent_start,
            agent_send,
            agent_stop,
            agent_resize
        ])
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data)?;
            let db_path = app_data.join("agent-workbench.db");
            let conn = Connection::open(db_path)?;
            init_db(&conn)?;
            start_claude_hook_receiver(app.handle()).map_err(std::io::Error::other)?;
            let transport_endpoint =
                start_transport_server(app.handle()).map_err(std::io::Error::other)?;
            let state: State<AppState> = app.state();
            let mut guard = state
                .db
                .lock()
                .map_err(|e| std::io::Error::other(e.to_string()))?;
            *guard = Some(conn);
            if cfg!(debug_assertions) {
                println!("Coder Studio frontend dev server: {DEV_FRONTEND_URL}");
                println!("Coder Studio backend dev server: {transport_endpoint}");
            } else {
                println!("Coder Studio server running at {transport_endpoint}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
