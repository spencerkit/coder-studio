use std::{
    collections::{HashMap, HashSet},
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path as AxumPath, State as AxumState,
    },
    http::StatusCode,
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::broadcast;
use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeDir,
};

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ExecTarget {
    Native,
    Wsl { distro: Option<String> },
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "snake_case")]
pub enum SessionMode {
    Branch,
    GitTree,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Idle,
    Running,
    Background,
    Waiting,
    Suspended,
    Queued,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct IdlePolicy {
    pub enabled: bool,
    pub idle_minutes: u32,
    pub max_active: u32,
    pub pressure: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct QueueTask {
    pub id: u64,
    pub text: String,
    pub status: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct SessionInfo {
    pub id: u64,
    pub status: SessionStatus,
    pub mode: SessionMode,
    pub auto_feed: bool,
    pub queue: Vec<QueueTask>,
    pub last_active_at: i64,
    pub claude_session_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct GitStatus {
    pub branch: String,
    pub changes: u32,
    pub last_commit: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct GitChangeEntry {
    pub path: String,
    pub name: String,
    pub parent: String,
    pub section: String,
    pub status: String,
    pub code: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct GitFileDiffPayload {
    pub original_content: String,
    pub modified_content: String,
    pub diff: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorktreeInfo {
    pub name: String,
    pub path: String,
    pub branch: String,
    pub status: String,
    pub diff: String,
    pub tree: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ArchiveEntry {
    pub id: u64,
    pub session_id: u64,
    pub mode: SessionMode,
    pub time: String,
    pub snapshot: serde_json::Value,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct TabSnapshot {
    pub tab_id: String,
    pub project_path: String,
    pub target: ExecTarget,
    pub idle_policy: IdlePolicy,
    pub sessions: Vec<SessionInfo>,
    pub active_session_id: u64,
    pub archive: Vec<ArchiveEntry>,
    pub terminals: Vec<TerminalInfo>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorkspaceInfo {
    pub tab_id: String,
    pub project_path: String,
    pub target: ExecTarget,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceSourceKind {
    Remote,
    Local,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorkspaceSource {
    pub tab_id: String,
    pub kind: WorkspaceSourceKind,
    pub path_or_url: String,
    pub target: ExecTarget,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FilePreview {
    pub path: String,
    pub content: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub status: Option<String>,
    pub children: Vec<FileNode>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorkspaceTree {
    pub root: FileNode,
    pub changes: Vec<FileNode>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorktreeDetail {
    pub name: String,
    pub path: String,
    pub branch: String,
    pub status: String,
    pub diff: String,
    pub root: FileNode,
    pub changes: Vec<FileNode>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct TerminalInfo {
    pub id: u64,
    pub output: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct AgentEvent {
    pub tab_id: String,
    pub session_id: String,
    pub kind: String,
    pub data: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct AgentLifecycleEvent {
    pub tab_id: String,
    pub session_id: String,
    pub kind: String,
    pub source_event: String,
    pub data: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct TerminalEvent {
    pub tab_id: String,
    pub terminal_id: u64,
    pub data: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ClaudeSlashSkillEntry {
    pub id: String,
    pub command: String,
    pub description: String,
    pub scope: String,
    pub source_kind: String,
    pub source_path: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FilesystemRoot {
    pub id: String,
    pub label: String,
    pub path: String,
    pub description: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FilesystemEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FilesystemListResponse {
    pub current_path: String,
    pub home_path: String,
    pub parent_path: Option<String>,
    pub roots: Vec<FilesystemRoot>,
    pub entries: Vec<FilesystemEntry>,
    pub requested_path: Option<String>,
    pub fallback_reason: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CommandAvailability {
    pub command: String,
    pub available: bool,
    pub resolved_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct TransportEvent {
    pub event: String,
    pub payload: Value,
}

#[derive(Clone)]
struct HttpServerState {
    app: tauri::AppHandle,
}

#[derive(Clone, Deserialize, Debug)]
pub struct SessionPatch {
    pub status: Option<SessionStatus>,
    pub mode: Option<SessionMode>,
    pub auto_feed: Option<bool>,
    pub last_active_at: Option<i64>,
    pub claude_session_id: Option<String>,
}

pub struct AgentRuntime {
    pub child: Mutex<Box<dyn portable_pty::Child + Send>>,
    pub writer: Mutex<Option<Box<dyn Write + Send>>>,
    pub master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
}

pub struct TerminalRuntime {
    pub child: Mutex<Box<dyn portable_pty::Child + Send>>,
    pub writer: Mutex<Option<Box<dyn Write + Send>>>,
    pub master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct TabState {
    pub tab_id: String,
    pub project_path: String,
    pub target: ExecTarget,
    pub idle_policy: IdlePolicy,
    pub sessions: Vec<SessionInfo>,
    pub active_session_id: u64,
    pub archive: Vec<ArchiveEntry>,
    pub terminals: Vec<TerminalInfo>,
    pub next_session_id: u64,
    pub next_task_id: u64,
    pub next_terminal_id: u64,
}

pub struct AppState {
    pub tabs: Mutex<HashMap<String, TabState>>,
    pub db: Mutex<Option<Connection>>,
    pub agents: Mutex<HashMap<String, Arc<AgentRuntime>>>,
    pub terminals: Mutex<HashMap<String, Arc<TerminalRuntime>>>,
    pub hook_endpoint: Mutex<Option<String>>,
    pub http_endpoint: Mutex<Option<String>>,
    pub transport_events: broadcast::Sender<TransportEvent>,
}

impl Default for AppState {
    fn default() -> Self {
        let (transport_events, _) = broadcast::channel(1024);
        Self {
            tabs: Mutex::new(HashMap::new()),
            db: Mutex::new(None),
            agents: Mutex::new(HashMap::new()),
            terminals: Mutex::new(HashMap::new()),
            hook_endpoint: Mutex::new(None),
            http_endpoint: Mutex::new(None),
            transport_events,
        }
    }
}

fn now_ts() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn now_label() -> String {
    use chrono::Local;
    Local::now().format("%H:%M").to_string()
}

fn default_idle_policy() -> IdlePolicy {
    IdlePolicy {
        enabled: true,
        idle_minutes: 10,
        max_active: 3,
        pressure: true,
    }
}

fn user_home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
}

fn is_ignored_scan_dir(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|value| value.to_str()),
        Some(".git")
            | Some("node_modules")
            | Some("target")
            | Some("dist")
            | Some("build")
            | Some(".next")
            | Some(".turbo")
            | Some("coverage")
    )
}

fn strip_frontmatter(markdown: &str) -> &str {
    if !markdown.starts_with("---\n") {
        return markdown;
    }
    let remainder = &markdown[4..];
    if let Some(index) = remainder.find("\n---\n") {
        &remainder[(index + 5)..]
    } else {
        markdown
    }
}

fn parse_markdown_frontmatter(markdown: &str) -> (Option<String>, Option<String>, bool) {
    if !markdown.starts_with("---\n") {
        return (None, None, true);
    }
    let remainder = &markdown[4..];
    let Some(index) = remainder.find("\n---\n") else {
        return (None, None, true);
    };
    let header = &remainder[..index];
    let mut name = None;
    let mut description = None;
    let mut user_invocable = true;

    for line in header.lines() {
        let Some((raw_key, raw_value)) = line.split_once(':') else {
            continue;
        };
        let key = raw_key.trim();
        let value = raw_value.trim().trim_matches('"').trim_matches('\'');
        match key {
            "name" if !value.is_empty() => name = Some(value.to_string()),
            "description" if !value.is_empty() => description = Some(value.to_string()),
            "user-invocable" => {
                user_invocable = !matches!(value, "false" | "False" | "FALSE");
            }
            _ => {}
        }
    }

    (name, description, user_invocable)
}

fn first_markdown_summary(markdown: &str) -> Option<String> {
    let content = strip_frontmatter(markdown);
    let mut lines = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if !lines.is_empty() {
                break;
            }
            continue;
        }
        if trimmed.starts_with('#') {
            continue;
        }
        lines.push(trimmed.to_string());
        if lines.len() >= 3 {
            break;
        }
    }

    if lines.is_empty() {
        None
    } else {
        Some(lines.join(" "))
    }
}

fn source_path_label(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn push_slash_entry(
    entries: &mut Vec<ClaudeSlashSkillEntry>,
    seen_commands: &mut HashSet<String>,
    command_name: String,
    description: String,
    scope: &str,
    source_kind: &str,
    source_path: &Path,
) {
    let trimmed_command = command_name.trim().trim_start_matches('/');
    if trimmed_command.is_empty() {
        return;
    }
    let command = format!("/{}", trimmed_command);
    if !seen_commands.insert(command.clone()) {
        return;
    }

    entries.push(ClaudeSlashSkillEntry {
        id: format!("{}:{}:{}", scope, source_kind, trimmed_command),
        command,
        description,
        scope: scope.to_string(),
        source_kind: source_kind.to_string(),
        source_path: source_path_label(source_path),
    });
}

fn scan_skill_dir(
    skills_dir: &Path,
    scope: &str,
    entries: &mut Vec<ClaudeSlashSkillEntry>,
    seen_commands: &mut HashSet<String>,
) {
    let Ok(skill_dirs) = std::fs::read_dir(skills_dir) else {
        return;
    };

    for dir in skill_dirs.flatten() {
        let path = dir.path();
        if !path.is_dir() {
            continue;
        }
        let markdown_path = path.join("SKILL.md");
        let Ok(markdown) = std::fs::read_to_string(&markdown_path) else {
            continue;
        };
        let (name, description, user_invocable) = parse_markdown_frontmatter(&markdown);
        if !user_invocable {
            continue;
        }
        let command_name = name.unwrap_or_else(|| {
            path.file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string()
        });
        let summary = description
            .or_else(|| first_markdown_summary(&markdown))
            .unwrap_or_else(|| "Claude skill".to_string());
        push_slash_entry(
            entries,
            seen_commands,
            command_name,
            summary,
            scope,
            "skill",
            &markdown_path,
        );
    }
}

fn scan_command_dir(
    commands_dir: &Path,
    scope: &str,
    entries: &mut Vec<ClaudeSlashSkillEntry>,
    seen_commands: &mut HashSet<String>,
) {
    let Ok(dir_entries) = std::fs::read_dir(commands_dir) else {
        return;
    };

    for entry in dir_entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_command_dir(&path, scope, entries, seen_commands);
            continue;
        }
        if path.extension().and_then(|value| value.to_str()) != Some("md") {
            continue;
        }
        let Ok(markdown) = std::fs::read_to_string(&path) else {
            continue;
        };
        let (name, description, user_invocable) = parse_markdown_frontmatter(&markdown);
        if !user_invocable {
            continue;
        }
        let command_name = name.unwrap_or_else(|| {
            path.file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string()
        });
        let summary = description
            .or_else(|| first_markdown_summary(&markdown))
            .unwrap_or_else(|| "Claude command".to_string());
        push_slash_entry(
            entries,
            seen_commands,
            command_name,
            summary,
            scope,
            "command",
            &path,
        );
    }
}

fn scan_claude_root(
    claude_dir: &Path,
    scope: &str,
    entries: &mut Vec<ClaudeSlashSkillEntry>,
    seen_commands: &mut HashSet<String>,
) {
    scan_skill_dir(&claude_dir.join("skills"), scope, entries, seen_commands);
    scan_command_dir(&claude_dir.join("commands"), scope, entries, seen_commands);
}

fn walk_project_claude_roots(
    current: &Path,
    roots: &mut Vec<PathBuf>,
    seen_roots: &mut HashSet<PathBuf>,
) {
    if is_ignored_scan_dir(current) {
        return;
    }

    if current.file_name().and_then(|value| value.to_str()) == Some(".claude") {
        if seen_roots.insert(current.to_path_buf()) {
            roots.push(current.to_path_buf());
        }
        return;
    }

    let Ok(entries) = std::fs::read_dir(current) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_project_claude_roots(&path, roots, seen_roots);
        }
    }
}

#[tauri::command]
fn claude_slash_skills(cwd: String) -> Result<Vec<ClaudeSlashSkillEntry>, String> {
    let mut entries = Vec::new();
    let mut seen_commands = HashSet::new();

    if let Some(home_dir) = user_home_dir() {
        scan_claude_root(
            &home_dir.join(".claude"),
            "personal",
            &mut entries,
            &mut seen_commands,
        );
    }

    if !cwd.trim().is_empty() {
        let root = PathBuf::from(cwd);
        if root.exists() {
            let mut claude_roots = Vec::new();
            let mut seen_roots = HashSet::new();
            walk_project_claude_roots(&root, &mut claude_roots, &mut seen_roots);
            claude_roots.sort();
            for claude_root in claude_roots {
                scan_claude_root(&claude_root, "project", &mut entries, &mut seen_commands);
            }
        }
    }

    entries.sort_by(|left, right| left.command.cmp(&right.command));
    Ok(entries)
}

const DEV_FRONTEND_URL: &str = "http://127.0.0.1:5174";
const DEV_BACKEND_PORT: u16 = 41033;

#[derive(Deserialize)]
struct InitWorkspaceRequest {
    source: WorkspaceSource,
}

#[derive(Deserialize)]
struct TabIdRequest {
    tab_id: String,
}

#[derive(Deserialize)]
struct SessionCreateRequest {
    tab_id: String,
    mode: SessionMode,
}

#[derive(Deserialize)]
struct SessionUpdateRequest {
    tab_id: String,
    session_id: u64,
    patch: SessionPatch,
}

#[derive(Deserialize)]
struct SwitchSessionRequest {
    tab_id: String,
    session_id: u64,
}

#[derive(Deserialize)]
struct ArchiveSessionRequest {
    tab_id: String,
    session_id: u64,
}

#[derive(Deserialize)]
struct IdlePolicyRequest {
    tab_id: String,
    policy: IdlePolicy,
}

#[derive(Deserialize)]
struct QueueAddRequest {
    tab_id: String,
    session_id: u64,
    text: String,
}

#[derive(Deserialize)]
struct QueueRunRequest {
    tab_id: String,
    session_id: u64,
    task_id: u64,
}

#[derive(Deserialize)]
struct QueueCompleteRequest {
    tab_id: String,
    session_id: u64,
    task_id: u64,
}

#[derive(Deserialize)]
struct PathTargetRequest {
    path: String,
    target: ExecTarget,
}

#[derive(Deserialize)]
struct GitFileRequest {
    path: String,
    target: ExecTarget,
    file_path: String,
}

#[derive(Deserialize)]
struct GitFileSectionRequest {
    path: String,
    target: ExecTarget,
    file_path: String,
    section: String,
}

#[derive(Deserialize)]
struct GitDiffFileRequest {
    path: String,
    target: ExecTarget,
    file_path: String,
    staged: Option<bool>,
}

#[derive(Deserialize)]
struct GitDiscardFileRequest {
    path: String,
    target: ExecTarget,
    file_path: String,
    section: Option<String>,
}

#[derive(Deserialize)]
struct GitCommitRequest {
    path: String,
    target: ExecTarget,
    message: String,
}

#[derive(Deserialize)]
struct WorktreeInspectRequest {
    path: String,
    target: ExecTarget,
    depth: usize,
}

#[derive(Deserialize)]
struct WorkspaceTreeRequest {
    path: String,
    target: ExecTarget,
    depth: usize,
}

#[derive(Deserialize)]
struct FilePreviewRequest {
    path: String,
}

#[derive(Deserialize)]
struct FileSaveRequest {
    path: String,
    content: String,
}

#[derive(Deserialize)]
struct FilesystemRootsRequest {
    target: ExecTarget,
}

#[derive(Deserialize)]
struct FilesystemListRequest {
    target: ExecTarget,
    path: Option<String>,
}

#[derive(Deserialize)]
struct CommandAvailabilityRequest {
    command: String,
    target: ExecTarget,
    cwd: Option<String>,
}

#[derive(Deserialize)]
struct EmptyRequest {}

#[derive(Deserialize)]
struct ClaudeSlashSkillsRequest {
    cwd: String,
}

#[derive(Deserialize)]
struct TerminalCreateRequest {
    tab_id: String,
    cwd: String,
    target: ExecTarget,
}

#[derive(Deserialize)]
struct TerminalWriteRequest {
    tab_id: String,
    terminal_id: u64,
    input: String,
}

#[derive(Deserialize)]
struct TerminalResizeRequest {
    tab_id: String,
    terminal_id: u64,
    cols: u16,
    rows: u16,
}

#[derive(Deserialize)]
struct TerminalCloseRequest {
    tab_id: String,
    terminal_id: u64,
}

#[derive(Deserialize)]
struct AgentStartRequest {
    tab_id: String,
    session_id: String,
    provider: String,
    command: String,
    claude_session_id: Option<String>,
    cwd: String,
    target: ExecTarget,
}

#[derive(Deserialize)]
struct AgentSendRequest {
    tab_id: String,
    session_id: String,
    input: String,
    append_newline: Option<bool>,
}

#[derive(Deserialize)]
struct AgentStopRequest {
    tab_id: String,
    session_id: String,
}

#[derive(Deserialize)]
struct AgentResizeRequest {
    tab_id: String,
    session_id: String,
    cols: u16,
    rows: u16,
}

fn camel_to_snake(key: &str) -> String {
    let mut out = String::with_capacity(key.len());
    for ch in key.chars() {
        if ch.is_uppercase() {
            if !out.is_empty() {
                out.push('_');
            }
            out.extend(ch.to_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

fn normalize_json_keys(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let next = map
                .into_iter()
                .map(|(key, value)| (camel_to_snake(&key), normalize_json_keys(value)))
                .collect::<Map<String, Value>>();
            Value::Object(next)
        }
        Value::Array(items) => Value::Array(items.into_iter().map(normalize_json_keys).collect()),
        other => other,
    }
}

fn parse_payload<T: for<'de> Deserialize<'de>>(payload: Value) -> Result<T, String> {
    serde_json::from_value(normalize_json_keys(payload)).map_err(|e| e.to_string())
}

fn json_success(data: Value) -> Response {
    Json(json!({
        "ok": true,
        "data": data
    }))
    .into_response()
}

fn json_error(status: StatusCode, error: String) -> Response {
    (
        status,
        Json(json!({
            "ok": false,
            "error": error
        })),
    )
        .into_response()
}

fn dispatch_rpc(app: &tauri::AppHandle, command: &str, payload: Value) -> Result<Value, String> {
    match command {
        "init_workspace" => {
            let req: InitWorkspaceRequest = parse_payload(payload)?;
            serde_json::to_value(init_workspace(req.source, app.state())?).map_err(|e| e.to_string())
        }
        "tab_snapshot" => {
            let req: TabIdRequest = parse_payload(payload)?;
            serde_json::to_value(tab_snapshot(req.tab_id, app.state())?).map_err(|e| e.to_string())
        }
        "create_session" => {
            let req: SessionCreateRequest = parse_payload(payload)?;
            serde_json::to_value(create_session(req.tab_id, req.mode, app.state())?).map_err(|e| e.to_string())
        }
        "session_update" => {
            let req: SessionUpdateRequest = parse_payload(payload)?;
            session_update(req.tab_id, req.session_id, req.patch, app.state())?;
            Ok(Value::Null)
        }
        "switch_session" => {
            let req: SwitchSessionRequest = parse_payload(payload)?;
            switch_session(req.tab_id, req.session_id, app.state())?;
            Ok(Value::Null)
        }
        "archive_session" => {
            let req: ArchiveSessionRequest = parse_payload(payload)?;
            serde_json::to_value(archive_session(req.tab_id, req.session_id, app.state())?).map_err(|e| e.to_string())
        }
        "update_idle_policy" => {
            let req: IdlePolicyRequest = parse_payload(payload)?;
            update_idle_policy(req.tab_id, req.policy, app.state())?;
            Ok(Value::Null)
        }
        "queue_add" => {
            let req: QueueAddRequest = parse_payload(payload)?;
            serde_json::to_value(queue_add(req.tab_id, req.session_id, req.text, app.state())?).map_err(|e| e.to_string())
        }
        "queue_run" => {
            let req: QueueRunRequest = parse_payload(payload)?;
            serde_json::to_value(queue_run(req.tab_id, req.session_id, req.task_id, app.state())?).map_err(|e| e.to_string())
        }
        "queue_complete" => {
            let req: QueueCompleteRequest = parse_payload(payload)?;
            queue_complete(req.tab_id, req.session_id, req.task_id, app.state())?;
            Ok(Value::Null)
        }
        "git_status" => {
            let req: PathTargetRequest = parse_payload(payload)?;
            serde_json::to_value(git_status(req.path, req.target)?).map_err(|e| e.to_string())
        }
        "git_diff" => {
            let req: PathTargetRequest = parse_payload(payload)?;
            serde_json::to_value(git_diff(req.path, req.target)?).map_err(|e| e.to_string())
        }
        "git_changes" => {
            let req: PathTargetRequest = parse_payload(payload)?;
            serde_json::to_value(git_changes(req.path, req.target)?).map_err(|e| e.to_string())
        }
        "git_diff_file" => {
            let req: GitDiffFileRequest = parse_payload(payload)?;
            serde_json::to_value(git_diff_file(req.path, req.target, req.file_path, req.staged)?).map_err(|e| e.to_string())
        }
        "git_file_diff_payload" => {
            let req: GitFileSectionRequest = parse_payload(payload)?;
            serde_json::to_value(git_file_diff_payload(req.path, req.target, req.file_path, req.section)?).map_err(|e| e.to_string())
        }
        "git_stage_all" => {
            let req: PathTargetRequest = parse_payload(payload)?;
            git_stage_all(req.path, req.target)?;
            Ok(Value::Null)
        }
        "git_stage_file" => {
            let req: GitFileRequest = parse_payload(payload)?;
            git_stage_file(req.path, req.target, req.file_path)?;
            Ok(Value::Null)
        }
        "git_unstage_all" => {
            let req: PathTargetRequest = parse_payload(payload)?;
            git_unstage_all(req.path, req.target)?;
            Ok(Value::Null)
        }
        "git_unstage_file" => {
            let req: GitFileRequest = parse_payload(payload)?;
            git_unstage_file(req.path, req.target, req.file_path)?;
            Ok(Value::Null)
        }
        "git_discard_all" => {
            let req: PathTargetRequest = parse_payload(payload)?;
            git_discard_all(req.path, req.target)?;
            Ok(Value::Null)
        }
        "git_discard_file" => {
            let req: GitDiscardFileRequest = parse_payload(payload)?;
            git_discard_file(req.path, req.target, req.file_path, req.section)?;
            Ok(Value::Null)
        }
        "git_commit" => {
            let req: GitCommitRequest = parse_payload(payload)?;
            serde_json::to_value(git_commit(req.path, req.target, req.message)?).map_err(|e| e.to_string())
        }
        "worktree_list" => {
            let req: PathTargetRequest = parse_payload(payload)?;
            serde_json::to_value(worktree_list(req.path, req.target)?).map_err(|e| e.to_string())
        }
        "worktree_inspect" => {
            let req: WorktreeInspectRequest = parse_payload(payload)?;
            serde_json::to_value(worktree_inspect(req.path, req.target, Some(req.depth))?).map_err(|e| e.to_string())
        }
        "workspace_tree" => {
            let req: WorkspaceTreeRequest = parse_payload(payload)?;
            serde_json::to_value(workspace_tree(req.path, req.target, Some(req.depth))?).map_err(|e| e.to_string())
        }
        "file_preview" => {
            let req: FilePreviewRequest = parse_payload(payload)?;
            serde_json::to_value(file_preview(req.path)?).map_err(|e| e.to_string())
        }
        "file_save" => {
            let req: FileSaveRequest = parse_payload(payload)?;
            serde_json::to_value(file_save(req.path, req.content)?).map_err(|e| e.to_string())
        }
        "filesystem_roots" => {
            let req: FilesystemRootsRequest = parse_payload(payload)?;
            serde_json::to_value(filesystem_roots(req.target)?).map_err(|e| e.to_string())
        }
        "filesystem_list" => {
            let req: FilesystemListRequest = parse_payload(payload)?;
            serde_json::to_value(filesystem_list(req.target, req.path)?).map_err(|e| e.to_string())
        }
        "command_exists" => {
            let req: CommandAvailabilityRequest = parse_payload(payload)?;
            serde_json::to_value(command_exists(req.command, req.target, req.cwd)?)
                .map_err(|e| e.to_string())
        }
        "dialog_pick_folder" => {
            let _req: EmptyRequest = parse_payload(payload)?;
            serde_json::to_value(dialog_pick_folder(app.clone())?).map_err(|e| e.to_string())
        }
        "claude_slash_skills" => {
            let req: ClaudeSlashSkillsRequest = parse_payload(payload)?;
            serde_json::to_value(claude_slash_skills(req.cwd)?).map_err(|e| e.to_string())
        }
        "terminal_create" => {
            let req: TerminalCreateRequest = parse_payload(payload)?;
            serde_json::to_value(terminal_create(req.tab_id, req.cwd, req.target, app.clone(), app.state())?).map_err(|e| e.to_string())
        }
        "terminal_write" => {
            let req: TerminalWriteRequest = parse_payload(payload)?;
            terminal_write(req.tab_id, req.terminal_id, req.input, app.state())?;
            Ok(Value::Null)
        }
        "terminal_resize" => {
            let req: TerminalResizeRequest = parse_payload(payload)?;
            terminal_resize(req.tab_id, req.terminal_id, req.cols, req.rows, app.state())?;
            Ok(Value::Null)
        }
        "terminal_close" => {
            let req: TerminalCloseRequest = parse_payload(payload)?;
            terminal_close(req.tab_id, req.terminal_id, app.state())?;
            Ok(Value::Null)
        }
        "agent_start" => {
            let req: AgentStartRequest = parse_payload(payload)?;
            agent_start(
                req.tab_id,
                req.session_id,
                req.provider,
                req.command,
                req.claude_session_id,
                req.cwd,
                req.target,
                app.clone(),
                app.state(),
            )?;
            Ok(Value::Null)
        }
        "agent_send" => {
            let req: AgentSendRequest = parse_payload(payload)?;
            agent_send(
                req.tab_id,
                req.session_id,
                req.input,
                req.append_newline,
                app.state(),
            )?;
            Ok(Value::Null)
        }
        "agent_stop" => {
            let req: AgentStopRequest = parse_payload(payload)?;
            agent_stop(req.tab_id, req.session_id, app.state())?;
            Ok(Value::Null)
        }
        "agent_resize" => {
            let req: AgentResizeRequest = parse_payload(payload)?;
            agent_resize(req.tab_id, req.session_id, req.cols, req.rows, app.state())?;
            Ok(Value::Null)
        }
        _ => Err(format!("unsupported_command:{command}")),
    }
}

async fn rpc_handler(
    AxumPath(command): AxumPath<String>,
    AxumState(state): AxumState<HttpServerState>,
    Json(payload): Json<Value>,
) -> Response {
    match dispatch_rpc(&state.app, &command, payload) {
        Ok(data) => json_success(data),
        Err(error) => json_error(StatusCode::BAD_REQUEST, error),
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    AxumState(state): AxumState<HttpServerState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| ws_session(socket, state.app))
}

async fn ws_session(mut socket: WebSocket, app: tauri::AppHandle) {
    let state: State<AppState> = app.state();
    let mut rx = state.transport_events.subscribe();

    loop {
        tokio::select! {
            message = socket.recv() => {
                match message {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            event = rx.recv() => {
                match event {
                    Ok(event) => {
                        let Ok(text) = serde_json::to_string(&event) else {
                            continue;
                        };
                        if socket.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }
        }
    }
}

async fn health_handler() -> impl IntoResponse {
    Json(json!({ "ok": true }))
}

fn frontend_dist_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist")
}

fn frontend_assets_dir() -> PathBuf {
    frontend_dist_dir().join("assets")
}

async fn spa_shell_handler() -> impl IntoResponse {
    let index_file = frontend_dist_dir().join("index.html");
    let html = std::fs::read_to_string(index_file).unwrap_or_else(|_| {
        r#"<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Agent Workbench</title></head><body><div id="root"></div></body></html>"#.to_string()
    });
    Html(html)
}

fn build_transport_router(app: &tauri::AppHandle) -> Router {
    let shared = HttpServerState { app: app.clone() };
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);
    let api_router = Router::new()
        .route("/ws", get(ws_handler))
        .route("/health", get(health_handler))
        .route("/api/rpc/:command", post(rpc_handler))
        .layer(cors);

    if cfg!(debug_assertions) {
        api_router.with_state(shared)
    } else {
        api_router
            .nest_service("/assets", ServeDir::new(frontend_assets_dir()))
            .route("/", get(spa_shell_handler))
            .route("/*path", get(spa_shell_handler))
            .with_state(shared)
    }
}

fn start_transport_server(app: &tauri::AppHandle) -> Result<String, String> {
    let bind_port = if cfg!(debug_assertions) { DEV_BACKEND_PORT } else { 0 };
    let listener = std::net::TcpListener::bind(("127.0.0.1", bind_port)).map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let address = listener.local_addr().map_err(|e| e.to_string())?;
    let endpoint = format!("http://127.0.0.1:{}", address.port());
    {
        let state: State<AppState> = app.state();
        let mut guard = state.http_endpoint.lock().map_err(|e| e.to_string())?;
        *guard = Some(endpoint.clone());
    }
    let router = build_transport_router(app);
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => listener,
            Err(_) => return,
        };
        let _ = axum::serve(listener, router).await;
    });
    Ok(endpoint)
}

fn agent_key(tab_id: &str, session_id: &str) -> String {
    format!("{}:{}", tab_id, session_id)
}

fn terminal_key(tab_id: &str, terminal_id: u64) -> String {
    format!("{}:{}", tab_id, terminal_id)
}

fn emit_transport_event(app: &tauri::AppHandle, event: &str, payload: Value) {
    let state: State<AppState> = app.state();
    let _ = state.transport_events.send(TransportEvent {
        event: event.to_string(),
        payload,
    });
}

fn emit_agent(app: &tauri::AppHandle, tab_id: &str, session_id: &str, kind: &str, data: &str) {
    emit_transport_event(
        app,
        "agent://event",
        json!({
            "tab_id": tab_id,
            "session_id": session_id,
            "kind": kind,
            "data": data,
        }),
    );
    let _ = app.emit(
        "agent://event",
        AgentEvent {
            tab_id: tab_id.to_string(),
            session_id: session_id.to_string(),
            kind: kind.to_string(),
            data: data.to_string(),
        },
    );
}

fn emit_terminal(app: &tauri::AppHandle, tab_id: &str, terminal_id: u64, data: &str) {
    emit_transport_event(
        app,
        "terminal://event",
        json!({
            "tab_id": tab_id,
            "terminal_id": terminal_id,
            "data": data,
        }),
    );
    let _ = app.emit(
        "terminal://event",
        TerminalEvent {
            tab_id: tab_id.to_string(),
            terminal_id,
            data: data.to_string(),
        },
    );
}

fn emit_agent_lifecycle(
    app: &tauri::AppHandle,
    tab_id: &str,
    session_id: &str,
    kind: &str,
    source_event: &str,
    data: &str,
) {
    emit_transport_event(
        app,
        "agent://lifecycle",
        json!({
            "tab_id": tab_id,
            "session_id": session_id,
            "kind": kind,
            "source_event": source_event,
            "data": data,
        }),
    );
    let _ = app.emit(
        "agent://lifecycle",
        AgentLifecycleEvent {
            tab_id: tab_id.to_string(),
            session_id: session_id.to_string(),
            kind: kind.to_string(),
            source_event: source_event.to_string(),
            data: data.to_string(),
        },
    );
}

fn mode_label(mode: &SessionMode) -> &'static str {
    match mode {
        SessionMode::Branch => "branch",
        SessionMode::GitTree => "git_tree",
    }
}

fn status_label(status: &SessionStatus) -> &'static str {
    match status {
        SessionStatus::Idle => "idle",
        SessionStatus::Running => "running",
        SessionStatus::Background => "background",
        SessionStatus::Waiting => "waiting",
        SessionStatus::Suspended => "suspended",
        SessionStatus::Queued => "queued",
    }
}

#[derive(Deserialize)]
struct ClaudeHookEnvelope {
    tab_id: String,
    session_id: String,
    payload: Value,
}

fn parse_http_endpoint(endpoint: &str) -> Option<(String, u16, String)> {
    let trimmed = endpoint.trim();
    let without_scheme = trimmed.strip_prefix("http://")?;
    let (host_port, path) = without_scheme
        .split_once('/')
        .unwrap_or((without_scheme, ""));
    let (host, port_raw) = host_port.rsplit_once(':')?;
    let port = port_raw.parse::<u16>().ok()?;
    Some((host.to_string(), port, format!("/{}", path)))
}

fn respond_http(mut stream: TcpStream, status: &str, body: &str) {
    let response = format!(
    "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
    body.len()
  );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn parse_http_json(stream: &TcpStream) -> Result<Value, String> {
    let cloned = stream.try_clone().map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(cloned);

    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .map_err(|e| e.to_string())?;
    if !request_line.starts_with("POST ") {
        return Err("method_not_allowed".to_string());
    }

    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if line == "\r\n" || line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse::<usize>().unwrap_or(0);
            }
        }
    }

    let mut body = vec![0u8; content_length];
    reader.read_exact(&mut body).map_err(|e| e.to_string())?;
    serde_json::from_slice::<Value>(&body).map_err(|e| e.to_string())
}

fn normalize_claude_lifecycle(payload: &Value) -> Option<(&'static str, String)> {
    let hook_event = payload.get("hook_event_name")?.as_str()?;
    let normalized = match hook_event {
        "SessionStart" => "session_started",
        "UserPromptSubmit" => "turn_waiting",
        "PreToolUse" => "tool_started",
        "PostToolUse" | "PostToolUseFailure" => "tool_finished",
        "Notification" => "approval_required",
        "Stop" => "turn_completed",
        "SessionEnd" => "session_ended",
        _ => return None,
    };
    Some((normalized, hook_event.to_string()))
}

fn handle_claude_hook_payload(app: &tauri::AppHandle, envelope: ClaudeHookEnvelope) {
    if let Some(claude_session_id) = envelope
        .payload
        .get("session_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
    {
        let state: State<AppState> = app.state();
        let mut snapshot_to_persist: Option<SessionInfo> = None;
        if let Ok(mut tabs) = state.tabs.lock() {
            if let Some(tab) = tabs.get_mut(&envelope.tab_id) {
                if let Ok(internal_session_id) = envelope.session_id.parse::<u64>() {
                    if let Some(session) = tab.sessions.iter_mut().find(|session| session.id == internal_session_id) {
                        if session.claude_session_id.as_deref() != Some(claude_session_id.as_str()) {
                            session.claude_session_id = Some(claude_session_id);
                            snapshot_to_persist = Some(session.clone());
                        }
                    }
                }
            }
        };
        if let Some(snapshot) = snapshot_to_persist.as_ref() {
            persist_session(&state, &envelope.tab_id, snapshot);
        }
    }

    if let Some((kind, source_event)) = normalize_claude_lifecycle(&envelope.payload) {
        let data = serde_json::to_string(&envelope.payload).unwrap_or_default();
        emit_agent_lifecycle(
            app,
            &envelope.tab_id,
            &envelope.session_id,
            kind,
            &source_event,
            &data,
        );
    }
}

fn start_claude_hook_receiver(app: &tauri::AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let endpoint = format!(
        "http://127.0.0.1:{}/claude-hook",
        listener.local_addr().map_err(|e| e.to_string())?.port()
    );

    {
        let state: State<AppState> = app.state();
        let mut guard = state.hook_endpoint.lock().map_err(|e| e.to_string())?;
        *guard = Some(endpoint);
    }

    let app_handle = app.clone();
    std::thread::spawn(move || {
        for incoming in listener.incoming() {
            let stream = match incoming {
                Ok(stream) => stream,
                Err(_) => continue,
            };
            let payload = parse_http_json(&stream);
            match payload {
                Ok(body) => {
                    if let Ok(envelope) = serde_json::from_value::<ClaudeHookEnvelope>(body) {
                        handle_claude_hook_payload(&app_handle, envelope);
                        respond_http(stream, "200 OK", "ok");
                    } else {
                        respond_http(stream, "400 Bad Request", "invalid_payload");
                    }
                }
                Err(err) if err == "method_not_allowed" => {
                    respond_http(stream, "405 Method Not Allowed", "method_not_allowed");
                }
                Err(_) => {
                    respond_http(stream, "400 Bad Request", "invalid_request");
                }
            }
        }
    });

    Ok(())
}

fn current_hook_endpoint(app: &tauri::AppHandle) -> Result<String, String> {
    let state: State<AppState> = app.state();
    let guard = state.hook_endpoint.lock().map_err(|e| e.to_string())?;
    guard.clone().ok_or("hook_endpoint_not_ready".to_string())
}

fn build_claude_hook_command(target: &ExecTarget) -> String {
    if matches!(target, ExecTarget::Wsl { .. }) {
        "\"$CODER_STUDIO_APP_BIN\" --coder-studio-claude-hook".to_string()
    } else {
        #[cfg(target_os = "windows")]
        {
            "\"%CODER_STUDIO_APP_BIN%\" --coder-studio-claude-hook".to_string()
        }
        #[cfg(not(target_os = "windows"))]
        {
            "\"$CODER_STUDIO_APP_BIN\" --coder-studio-claude-hook".to_string()
        }
    }
}

fn is_coder_studio_hook_group(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .map(|hooks| {
            hooks.iter().any(|hook| {
                hook.get("type").and_then(Value::as_str) == Some("command")
                    && hook
                        .get("command")
                        .and_then(Value::as_str)
                        .map(|command| command.contains("--coder-studio-claude-hook"))
                        .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn build_hook_group(command: &str, matcher: Option<&str>) -> Value {
    let mut group = Map::new();
    if let Some(value) = matcher {
        group.insert("matcher".to_string(), Value::String(value.to_string()));
    }
    group.insert(
        "hooks".to_string(),
        Value::Array(vec![json!({
          "type": "command",
          "command": command
        })]),
    );
    Value::Object(group)
}

fn upsert_hook_groups(
    hooks_root: &mut Map<String, Value>,
    event_name: &str,
    matcher: Option<&str>,
    command: &str,
) {
    let entry = hooks_root
        .entry(event_name.to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    if !entry.is_array() {
        *entry = Value::Array(Vec::new());
    }
    let groups = entry.as_array_mut().expect("array");
    groups.retain(|group| !is_coder_studio_hook_group(group));
    groups.push(build_hook_group(command, matcher));
}

fn ensure_claude_hook_settings(cwd: &str, target: &ExecTarget) -> Result<(), String> {
    let current = if matches!(target, ExecTarget::Wsl { .. }) {
        run_cmd(
      target,
      cwd,
      &[
        "/bin/sh",
        "-lc",
        "if [ -f .claude/settings.local.json ]; then cat .claude/settings.local.json; else printf '{}'; fi",
      ],
    )
    .unwrap_or_else(|_| "{}".to_string())
    } else {
        let settings_path = PathBuf::from(cwd)
            .join(".claude")
            .join("settings.local.json");
        if settings_path.exists() {
            std::fs::read_to_string(&settings_path).map_err(|e| e.to_string())?
        } else {
            "{}".to_string()
        }
    };

    let mut root =
        serde_json::from_str::<Value>(&current).unwrap_or_else(|_| Value::Object(Map::new()));
    if !root.is_object() {
        root = Value::Object(Map::new());
    }
    let root_obj = root.as_object_mut().expect("object");
    let hooks_value = root_obj
        .entry("hooks".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !hooks_value.is_object() {
        *hooks_value = Value::Object(Map::new());
    }
    let hooks_obj = hooks_value.as_object_mut().expect("object");
    let command = build_claude_hook_command(target);

    upsert_hook_groups(hooks_obj, "SessionStart", Some(".*"), &command);
    upsert_hook_groups(hooks_obj, "UserPromptSubmit", None, &command);
    upsert_hook_groups(hooks_obj, "PreToolUse", Some(".*"), &command);
    upsert_hook_groups(hooks_obj, "PostToolUse", Some(".*"), &command);
    upsert_hook_groups(
        hooks_obj,
        "Notification",
        Some("permission_prompt"),
        &command,
    );
    upsert_hook_groups(hooks_obj, "Stop", None, &command);
    upsert_hook_groups(hooks_obj, "SessionEnd", Some(".*"), &command);

    let serialized = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    if matches!(target, ExecTarget::Wsl { .. }) {
        let script = format!(
            "mkdir -p .claude && printf %s {} > .claude/settings.local.json",
            shell_escape(&serialized)
        );
        run_cmd(target, cwd, &["/bin/sh", "-lc", &script]).map(|_| ())
    } else {
        let settings_dir = PathBuf::from(cwd).join(".claude");
        std::fs::create_dir_all(&settings_dir).map_err(|e| e.to_string())?;
        let settings_path = settings_dir.join("settings.local.json");
        std::fs::write(settings_path, serialized).map_err(|e| e.to_string())
    }
}

fn current_app_bin_for_target(target: &ExecTarget) -> Result<String, String> {
    let current = std::env::current_exe().map_err(|e| e.to_string())?;
    let raw = current.to_string_lossy().to_string();
    resolve_target_path(&raw, target)
}

fn run_claude_hook_helper() {
    let _ = (|| -> Result<(), String> {
        let endpoint = std::env::var("CODER_STUDIO_HOOK_ENDPOINT").map_err(|e| e.to_string())?;
        let tab_id = std::env::var("CODER_STUDIO_TAB_ID").map_err(|e| e.to_string())?;
        let session_id = std::env::var("CODER_STUDIO_SESSION_ID").map_err(|e| e.to_string())?;
        let (host, port, path) = parse_http_endpoint(&endpoint).ok_or("invalid_hook_endpoint")?;

        let mut stdin = String::new();
        std::io::stdin()
            .read_to_string(&mut stdin)
            .map_err(|e| e.to_string())?;
        let payload = serde_json::from_str::<Value>(&stdin).map_err(|e| e.to_string())?;
        let body = json!({
          "tab_id": tab_id,
          "session_id": session_id,
          "payload": payload
        })
        .to_string();

        let mut stream = TcpStream::connect((host.as_str(), port)).map_err(|e| e.to_string())?;
        let request = format!(
      "POST {path} HTTP/1.1\r\nHost: {host}:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
      body.len()
    );
        stream
            .write_all(request.as_bytes())
            .map_err(|e| e.to_string())?;
        stream.flush().map_err(|e| e.to_string())?;
        Ok(())
    })();
}

fn init_db(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY,
        tab_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        auto_feed INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        payload TEXT NOT NULL
     );
     CREATE TABLE IF NOT EXISTS archives (
        id INTEGER PRIMARY KEY,
        tab_id TEXT NOT NULL,
        session_id INTEGER NOT NULL,
        time TEXT NOT NULL,
        mode TEXT NOT NULL,
        payload TEXT NOT NULL
     );",
    )
}

fn with_db<T>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<Option<T>, String> {
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(conn) = guard.as_ref() {
        f(conn).map(Some)
    } else {
        Ok(None)
    }
}

fn persist_session(state: &State<'_, AppState>, tab_id: &str, session: &SessionInfo) {
    let payload = serde_json::to_string(session).unwrap_or_default();
    let _ = with_db(state, |conn| {
        conn.execute(
      "INSERT OR REPLACE INTO sessions (id, tab_id, mode, status, auto_feed, last_active_at, payload)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      params![
        session.id as i64,
        tab_id,
        mode_label(&session.mode),
        status_label(&session.status),
        if session.auto_feed { 1 } else { 0 },
        session.last_active_at,
        payload
      ],
    ).map_err(|e| e.to_string())?;
        Ok(())
    });
}

fn persist_archive(state: &State<'_, AppState>, tab_id: &str, entry: &ArchiveEntry) {
    let payload = serde_json::to_string(&entry.snapshot).unwrap_or_default();
    let _ = with_db(state, |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO archives (id, tab_id, session_id, time, mode, payload)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                entry.id as i64,
                tab_id,
                entry.session_id as i64,
                entry.time,
                mode_label(&entry.mode),
                payload
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    });
}

fn delete_session(state: &State<'_, AppState>, tab_id: &str, session_id: u64) {
    let _ = with_db(state, |conn| {
        conn.execute(
            "DELETE FROM sessions WHERE id = ?1 AND tab_id = ?2",
            params![session_id as i64, tab_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    });
}

fn snapshot_tab(tab: &TabState) -> TabSnapshot {
    TabSnapshot {
        tab_id: tab.tab_id.clone(),
        project_path: tab.project_path.clone(),
        target: tab.target.clone(),
        idle_policy: tab.idle_policy.clone(),
        sessions: tab.sessions.clone(),
        active_session_id: tab.active_session_id,
        archive: tab.archive.clone(),
        terminals: tab.terminals.clone(),
    }
}

fn ensure_tab<'a>(
    state: &'a mut HashMap<String, TabState>,
    tab_id: &str,
    target: &ExecTarget,
) -> &'a mut TabState {
    if !state.contains_key(tab_id) {
        state.insert(
            tab_id.to_string(),
            TabState {
                tab_id: tab_id.to_string(),
                project_path: String::new(),
                target: target.clone(),
                idle_policy: default_idle_policy(),
                sessions: vec![SessionInfo {
                    id: 1,
                    status: SessionStatus::Idle,
                    mode: SessionMode::Branch,
                    auto_feed: true,
                    queue: vec![],
                    last_active_at: now_ts(),
                    claude_session_id: None,
                }],
                active_session_id: 1,
                archive: vec![],
                terminals: vec![],
                next_session_id: 2,
                next_task_id: 1,
                next_terminal_id: 1,
            },
        );
    }
    state.get_mut(tab_id).unwrap()
}

fn trim_branch_name(raw: &str) -> String {
    raw.trim()
        .trim_start_matches("refs/heads/")
        .trim_start_matches("branch ")
        .to_string()
}

fn summarize_status(path: &str, target: &ExecTarget) -> String {
    let status = run_cmd(target, path, &["git", "status", "--short"]).unwrap_or_default();
    let changes = status
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count();
    if changes == 0 {
        "Clean".to_string()
    } else if changes == 1 {
        "1 changed file".to_string()
    } else {
        format!("{} changed files", changes)
    }
}

#[tauri::command]
fn init_workspace(
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
fn tab_snapshot(tab_id: String, state: State<'_, AppState>) -> Result<TabSnapshot, String> {
    let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
    let tab = ensure_tab(&mut tabs, &tab_id, &ExecTarget::Native);
    Ok(snapshot_tab(tab))
}

#[tauri::command]
fn create_session(
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
fn session_update(
    tab_id: String,
    session_id: u64,
    patch: SessionPatch,
    state: State<'_, AppState>,
) -> Result<SessionInfo, String> {
    let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
    let tab = ensure_tab(&mut tabs, &tab_id, &ExecTarget::Native);
    let session = tab
        .sessions
        .iter_mut()
        .find(|s| s.id == session_id)
        .ok_or("session_not_found")?;

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

    let snapshot = session.clone();
    persist_session(&state, &tab_id, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn switch_session(
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
fn archive_session(
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
fn update_idle_policy(
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
fn queue_add(
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
fn queue_complete(
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
fn queue_run(
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
fn worktree_inspect(
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

fn shell_escape(value: &str) -> String {
    if value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "-_./:@".contains(c))
    {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\"'\"'"))
    }
}

fn shell_escape_windows(value: &str) -> String {
    if value.is_empty() {
        "\"\"".to_string()
    } else {
        format!("\"{}\"", value.replace('"', "\"\""))
    }
}

fn run_cmd(target: &ExecTarget, cwd: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = if let ExecTarget::Wsl { distro } = target {
        let mut c = Command::new("wsl.exe");
        if let Some(d) = distro {
            c.args(["-d", d]);
        }
        let mut shell_cmd = String::new();
        if !cwd.is_empty() {
            shell_cmd.push_str("cd ");
            shell_cmd.push_str(&shell_escape(cwd));
            shell_cmd.push_str(" && ");
        }
        for (i, a) in args.iter().enumerate() {
            if i > 0 {
                shell_cmd.push(' ');
            }
            shell_cmd.push_str(&shell_escape(a));
        }
        c.args(["--", "/bin/sh", "-lc", &shell_cmd]);
        c
    } else {
        let mut c = std::process::Command::new(args[0]);
        c.args(&args[1..]);
        if !cwd.is_empty() {
            c.current_dir(cwd);
        }
        c
    };

    let out = cmd
        .stderr(Stdio::piped())
        .stdout(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout)
            .trim_end_matches(['\r', '\n'])
            .to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr)
            .trim_end_matches(['\r', '\n'])
            .to_string())
    }
}

fn run_command_output(mut cmd: Command) -> Result<String, String> {
    let out = cmd
        .stderr(Stdio::piped())
        .stdout(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout)
            .trim_end_matches(['\r', '\n'])
            .to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr)
            .trim_end_matches(['\r', '\n'])
            .to_string())
    }
}

#[cfg(not(target_os = "windows"))]
fn run_native_shell_command(cwd: &str, script: &str) -> Result<String, String> {
    let (shell, flag) = resolve_unix_agent_shell();
    let mut cmd = Command::new(shell);
    cmd.arg(flag).arg(script);
    if !cwd.is_empty() {
        cmd.current_dir(cwd);
    }
    run_command_output(cmd)
}

fn run_wsl_shell_command(target: &ExecTarget, cwd: &str, script: &str) -> Result<String, String> {
    let mut cmd = Command::new("wsl.exe");
    if let ExecTarget::Wsl { distro } = target {
        if let Some(d) = distro {
            cmd.args(["-d", d]);
        }
    }
    let shell_cmd = if cwd.is_empty() {
        script.to_string()
    } else {
        format!("cd {} && {}", shell_escape(cwd), script)
    };
    cmd.args(["--", "/bin/sh", "-lc", &shell_cmd]);
    run_command_output(cmd)
}

fn parse_command_binary(command: &str) -> Option<String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut token = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;

    for ch in trimmed.chars() {
        if escaped {
            token.push(ch);
            escaped = false;
            continue;
        }

        match ch {
            '\\' if !in_single => {
                escaped = true;
            }
            '\'' if !in_double => {
                in_single = !in_single;
            }
            '"' if !in_single => {
                in_double = !in_double;
            }
            ch if ch.is_whitespace() && !in_single && !in_double => {
                if !token.is_empty() {
                    break;
                }
            }
            _ => token.push(ch),
        }
    }

    let normalized = token.trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

fn command_uses_explicit_path(command: &str) -> bool {
    command.contains(std::path::MAIN_SEPARATOR)
        || command.contains('/')
        || command.contains('\\')
        || command.starts_with('.')
}

#[cfg(target_os = "windows")]
fn probe_native_command(command_name: &str, cwd: Option<&str>) -> Result<String, String> {
    if command_uses_explicit_path(command_name) {
        let candidate = PathBuf::from(command_name);
        let resolved = if candidate.is_absolute() {
            candidate
        } else if let Some(base) = cwd.filter(|value| !value.is_empty()) {
            PathBuf::from(base).join(candidate)
        } else {
            std::env::current_dir()
                .map_err(|e| e.to_string())?
                .join(candidate)
        };
        if resolved.exists() {
            return Ok(resolved.to_string_lossy().to_string());
        }
        return Err(format!("`{command_name}` was not found"));
    }

    let mut cmd = Command::new("cmd");
    cmd.args(["/C", "where", command_name]);
    if let Some(base) = cwd.filter(|value| !value.is_empty()) {
        cmd.current_dir(base);
    }
    let output = run_command_output(cmd)?;
    output
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().to_string())
        .ok_or_else(|| format!("`{command_name}` was not found in PATH"))
}

#[cfg(not(target_os = "windows"))]
fn probe_native_command(command_name: &str, cwd: Option<&str>) -> Result<String, String> {
    if command_uses_explicit_path(command_name) {
        let candidate = PathBuf::from(command_name);
        let resolved = if candidate.is_absolute() {
            candidate
        } else if let Some(base) = cwd.filter(|value| !value.is_empty()) {
            PathBuf::from(base).join(candidate)
        } else {
            std::env::current_dir()
                .map_err(|e| e.to_string())?
                .join(candidate)
        };
        if resolved.exists() {
            return Ok(resolved.to_string_lossy().to_string());
        }
        return Err(format!("`{command_name}` was not found"));
    }

    run_native_shell_command(
        cwd.unwrap_or_default(),
        &format!("command -v {}", shell_escape(command_name)),
    )
}

fn probe_wsl_command(command_name: &str, target: &ExecTarget, cwd: Option<&str>) -> Result<String, String> {
    if command_uses_explicit_path(command_name) {
        let script = format!(
            "base_dir={cwd}; candidate={candidate}; if [ -e \"$candidate\" ]; then printf '%s' \"$candidate\"; elif [ -n \"$base_dir\" ] && [ -e \"$base_dir/$candidate\" ]; then printf '%s' \"$base_dir/$candidate\"; else exit 1; fi",
            candidate = shell_escape(command_name),
            cwd = shell_escape(cwd.unwrap_or_default())
        );
        return run_wsl_shell_command(target, "", &script);
    }

    run_wsl_shell_command(
        target,
        cwd.unwrap_or_default(),
        &format!("command -v {}", shell_escape(command_name)),
    )
}

#[tauri::command]
fn command_exists(
    command: String,
    target: ExecTarget,
    cwd: Option<String>,
) -> Result<CommandAvailability, String> {
    let trimmed = command.trim().to_string();
    let Some(binary) = parse_command_binary(&trimmed) else {
        return Ok(CommandAvailability {
            command: trimmed,
            available: false,
            resolved_path: None,
            error: Some("empty_command".to_string()),
        });
    };

    let cwd_ref = cwd.as_deref().map(str::trim).filter(|value| !value.is_empty());
    let result = match &target {
        ExecTarget::Native => probe_native_command(&binary, cwd_ref),
        ExecTarget::Wsl { .. } => probe_wsl_command(&binary, &target, cwd_ref),
    };

    Ok(match result {
        Ok(resolved_path) => CommandAvailability {
            command: trimmed,
            available: true,
            resolved_path: Some(resolved_path),
            error: None,
        },
        Err(error) => CommandAvailability {
            command: trimmed,
            available: false,
            resolved_path: None,
            error: Some(if error.trim().is_empty() {
                format!("`{binary}` was not found")
            } else {
                error
            }),
        },
    })
}

fn build_agent_shell_command(cwd: &str, command: &str, windows: bool) -> String {
    if cwd.is_empty() {
        return command.to_string();
    }
    if windows {
        format!("cd /d {} && {}", shell_escape_windows(cwd), command)
    } else {
        format!("cd {} && {}", shell_escape(cwd), command)
    }
}

#[cfg(not(target_os = "windows"))]
fn resolve_unix_agent_shell() -> (String, String) {
    let shell = std::env::var("SHELL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "/bin/sh".to_string());
    let shell_name = Path::new(&shell)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("sh")
        .to_ascii_lowercase();
    // Prefer interactive shell so user-level PATH/runtimes are loaded (nvm/asdf/homebrew, etc.).
    let flag = if shell_name == "sh" || shell_name == "dash" {
        "-lc".to_string()
    } else {
        "-ic".to_string()
    };
    (shell, flag)
}

fn build_claude_resume_command(command: &str, claude_session_id: Option<&str>) -> String {
    let Some(claude_session_id) = claude_session_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return command.to_string();
    };

    if command.contains("--resume") || command.contains(" -r ") {
        return command.to_string();
    }

    format!("{command} --resume {claude_session_id}")
}

fn build_agent_pty_command(target: &ExecTarget, cwd: &str, command: &str) -> (String, Vec<String>) {
    if let ExecTarget::Wsl { distro } = target {
        let mut args = Vec::new();
        if let Some(d) = distro {
            args.push("-d".to_string());
            args.push(d.clone());
        }
        let shell_cmd = build_agent_shell_command(cwd, command, false);
        args.push("--".to_string());
        args.push("/bin/sh".to_string());
        args.push("-lc".to_string());
        args.push(shell_cmd);
        ("wsl.exe".to_string(), args)
    } else {
        #[cfg(target_os = "windows")]
        {
            let shell_cmd = build_agent_shell_command(cwd, command, true);
            ("cmd".to_string(), vec!["/C".to_string(), shell_cmd])
        }
        #[cfg(not(target_os = "windows"))]
        {
            let shell_cmd = build_agent_shell_command(cwd, command, false);
            let (shell, flag) = resolve_unix_agent_shell();
            (shell, vec![flag, shell_cmd])
        }
    }
}

fn build_terminal_pty_command(target: &ExecTarget, cwd: &str) -> CommandBuilder {
    if let ExecTarget::Wsl { distro } = target {
        let mut cmd = CommandBuilder::new("wsl.exe");
        if let Some(d) = distro {
            cmd.arg("-d");
            cmd.arg(d);
        }
        let shell = "/bin/sh";
        let mut shell_cmd = String::new();
        if !cwd.is_empty() {
            shell_cmd.push_str("cd ");
            shell_cmd.push_str(&shell_escape(cwd));
            shell_cmd.push_str(" && ");
        }
        shell_cmd.push_str("TERM=xterm-256color exec ");
        shell_cmd.push_str(shell);
        cmd.arg("--");
        cmd.arg("/bin/sh");
        cmd.arg("-lc");
        cmd.arg(shell_cmd);
        cmd
    } else {
        #[cfg(target_os = "windows")]
        {
            let mut cmd = CommandBuilder::new("cmd");
            if !cwd.is_empty() {
                cmd.cwd(cwd);
            }
            cmd
        }
        #[cfg(not(target_os = "windows"))]
        {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
            let mut cmd = CommandBuilder::new(shell);
            if !cwd.is_empty() {
                cmd.cwd(cwd);
            }
            cmd.env("TERM", "xterm-256color");
            cmd
        }
    }
}

fn resolve_target_path(path: &str, target: &ExecTarget) -> Result<String, String> {
    if matches!(target, ExecTarget::Wsl { .. }) && (path.contains(':') || path.contains('\\')) {
        let output = run_cmd(target, "", &["wslpath", "-a", path])?;
        return Ok(output.trim().to_string());
    }
    Ok(path.to_string())
}

fn resolve_git_repo_path(path: &str, target: &ExecTarget) -> Result<String, String> {
    let resolved = resolve_target_path(path, target)?;
    match run_cmd(target, &resolved, &["git", "rev-parse", "--show-toplevel"]) {
        Ok(root) if !root.trim().is_empty() => Ok(root.trim().to_string()),
        _ => Ok(resolved),
    }
}

fn temp_root(target: &ExecTarget) -> Result<String, String> {
    if matches!(target, ExecTarget::Wsl { .. }) {
        Ok("/tmp/agent-workbench".to_string())
    } else {
        let root = std::env::temp_dir().join("agent-workbench");
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        Ok(root.to_string_lossy().to_string())
    }
}

fn repo_name_from_url(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    let name = trimmed.split('/').last().unwrap_or("repo");
    name.trim_end_matches(".git").to_string()
}

fn build_tree(path: &Path, depth: usize, limit: &mut usize) -> FileNode {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    let kind = if path.is_dir() { "dir" } else { "file" };
    let mut node = FileNode {
        name,
        path: path.to_string_lossy().to_string(),
        kind: kind.to_string(),
        status: None,
        children: vec![],
    };

    if kind == "file" || depth == 0 || *limit == 0 {
        return node;
    }

    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if *limit == 0 {
                break;
            }
            let file_name = entry.file_name().to_string_lossy().to_string();
            if file_name == ".git" {
                continue;
            }
            let child_path = entry.path();
            *limit = limit.saturating_sub(1);
            if child_path.is_dir() {
                node.children
                    .push(build_tree(&child_path, depth - 1, limit));
            } else {
                node.children.push(FileNode {
                    name: file_name,
                    path: child_path.to_string_lossy().to_string(),
                    kind: "file".to_string(),
                    status: None,
                    children: vec![],
                });
            }
        }
    }
    node
}

fn insert_change(nodes: &mut Vec<FileNode>, parts: &[&str], prefix: &str, status: &str) {
    if parts.is_empty() {
        return;
    }
    let name = parts[0];
    let path = if prefix.is_empty() {
        name.to_string()
    } else {
        format!("{}/{}", prefix, name)
    };
    let is_file = parts.len() == 1;

    let pos = nodes.iter().position(|node| node.name == name);
    let idx = if let Some(index) = pos {
        index
    } else {
        nodes.push(FileNode {
            name: name.to_string(),
            path: path.clone(),
            kind: if is_file {
                "file".to_string()
            } else {
                "dir".to_string()
            },
            status: if is_file && !status.is_empty() {
                Some(status.to_string())
            } else {
                None
            },
            children: vec![],
        });
        nodes.len() - 1
    };

    if !is_file {
        insert_change(&mut nodes[idx].children, &parts[1..], &path, status);
    }
}

fn build_changes_tree(changes: Vec<(String, String)>) -> Vec<FileNode> {
    let mut root: Vec<FileNode> = vec![];
    for (path, status) in changes {
        let parts: Vec<&str> = path.split('/').collect();
        insert_change(&mut root, &parts, "", &status);
    }
    root
}

fn build_tree_from_paths(paths: Vec<String>) -> FileNode {
    let mut root = FileNode {
        name: ".".to_string(),
        path: ".".to_string(),
        kind: "dir".to_string(),
        status: None,
        children: vec![],
    };

    for file_path in paths {
        let trimmed = file_path.trim();
        if trimmed.is_empty() {
            continue;
        }
        let clean = trimmed.trim_start_matches("./");
        let parts: Vec<&str> = clean.split('/').collect();
        insert_change(&mut root.children, &parts, "", "");
    }

    root
}

fn split_git_path(path: &str) -> (String, String) {
    if let Some((parent, name)) = path.rsplit_once('/') {
        (name.to_string(), parent.to_string())
    } else {
        (path.to_string(), String::new())
    }
}

fn git_status_label(code: char) -> &'static str {
    match code {
        'M' => "Modified",
        'A' => "Added",
        'D' => "Deleted",
        'R' => "Renamed",
        'C' => "Copied",
        'T' => "Type Changed",
        'U' => "Unmerged",
        '?' => "Untracked",
        _ => "Changed",
    }
}

fn git_status_code(code: char) -> String {
    match code {
        '?' => "U".to_string(),
        ' ' => "".to_string(),
        other => other.to_string(),
    }
}

fn parse_git_changes(raw: &str) -> Vec<GitChangeEntry> {
    let mut entries = Vec::new();

    for line in raw.lines() {
        if line.trim().is_empty() || line.len() < 3 {
            continue;
        }

        let chars: Vec<char> = line.chars().collect();
        let index_code = chars.first().copied().unwrap_or(' ');
        let worktree_code = chars.get(1).copied().unwrap_or(' ');
        let mut file_path = line.get(3..).unwrap_or("").trim().to_string();

        if let Some((_, target_path)) = file_path.split_once(" -> ") {
            file_path = target_path.to_string();
        }

        if file_path.is_empty() {
            continue;
        }

        let (name, parent) = split_git_path(&file_path);

        if index_code == '?' && worktree_code == '?' {
            entries.push(GitChangeEntry {
                path: file_path,
                name,
                parent,
                section: "untracked".to_string(),
                status: git_status_label('?').to_string(),
                code: git_status_code('?'),
            });
            continue;
        }

        if index_code != ' ' {
            entries.push(GitChangeEntry {
                path: file_path.clone(),
                name: name.clone(),
                parent: parent.clone(),
                section: "staged".to_string(),
                status: git_status_label(index_code).to_string(),
                code: git_status_code(index_code),
            });
        }

        if worktree_code != ' ' {
            entries.push(GitChangeEntry {
                path: file_path,
                name,
                parent,
                section: "changes".to_string(),
                status: git_status_label(worktree_code).to_string(),
                code: git_status_code(worktree_code),
            });
        }
    }

    entries
}

fn relative_git_path(repo_root: &str, file_path: &str) -> String {
    let normalized_repo = repo_root.replace('\\', "/").trim_end_matches('/').to_string();
    let normalized_path = file_path
        .replace('\\', "/")
        .trim()
        .trim_start_matches("file://")
        .to_string();
    let cleaned_path = normalized_path
        .trim_start_matches(":/")
        .trim_start_matches(':')
        .trim_start_matches('/')
        .to_string();

    if let Some(stripped) = cleaned_path.strip_prefix(&(normalized_repo.clone() + "/")) {
        stripped.to_string()
    } else {
        cleaned_path.trim_start_matches("./").to_string()
    }
}

fn git_worktree_path_exists(path: &str, target: &ExecTarget, relative: &str) -> bool {
    if relative.is_empty() {
        return false;
    }
    if matches!(target, ExecTarget::Wsl { .. }) {
        return run_cmd(target, path, &["test", "-e", relative]).is_ok();
    }
    PathBuf::from(path).join(relative).exists()
}

fn git_index_path_exists(path: &str, target: &ExecTarget, relative: &str) -> bool {
    if relative.is_empty() {
        return false;
    }
    run_cmd(target, path, &["git", "ls-files", "--error-unmatch", "--", relative]).is_ok()
}

fn git_known_change_paths(path: &str, target: &ExecTarget) -> Vec<String> {
    let raw = run_cmd(target, path, &["git", "status", "--porcelain"]).unwrap_or_default();
    let mut paths = Vec::new();
    for entry in parse_git_changes(&raw) {
        if !entry.path.is_empty() {
            paths.push(entry.path);
        }
    }
    paths.sort();
    paths.dedup();
    paths
}

fn git_known_repo_paths(path: &str, target: &ExecTarget) -> Vec<String> {
    let raw =
        run_cmd(target, path, &["git", "ls-files", "--cached", "--others", "--exclude-standard"])
            .unwrap_or_default();
    let mut paths = raw
        .lines()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    paths.sort();
    paths.dedup();
    paths
}

fn recover_git_relative_path_from_paths(candidate: &str, known: &[String]) -> Option<String> {
    if candidate.is_empty() || known.is_empty() {
        return None;
    }

    if let Some(exact) = known.iter().find(|value| *value == candidate) {
        return Some(exact.clone());
    }

    let suffix_matches: Vec<&String> = known
        .iter()
        .filter(|value| value.ends_with(candidate))
        .collect();
    if suffix_matches.len() == 1 {
        return Some(suffix_matches[0].clone());
    }

    let single_char_shift_matches: Vec<&String> = known
        .iter()
        .filter(|value| {
            value.len() == candidate.len() + 1
                && value
                    .chars()
                    .next()
                    .map(|_| value.ends_with(candidate))
                    .unwrap_or(false)
        })
        .collect();
    if single_char_shift_matches.len() == 1 {
        return Some(single_char_shift_matches[0].clone());
    }

    None
}

fn collect_repo_relative_paths(root: &Path, current: &Path, paths: &mut Vec<String>) {
    let entries = match std::fs::read_dir(current) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let entry_path = entry.path();
        let file_name = entry.file_name();
        if file_name.to_string_lossy() == ".git" {
            continue;
        }

        if entry_path.is_dir() {
            collect_repo_relative_paths(root, &entry_path, paths);
            continue;
        }

        if let Ok(relative) = entry_path.strip_prefix(root) {
            let normalized = relative.to_string_lossy().replace('\\', "/");
            if !normalized.is_empty() {
                paths.push(normalized);
            }
        }
    }
}

fn recover_git_relative_path_from_fs(path: &str, candidate: &str) -> Option<String> {
    if candidate.is_empty() {
        return None;
    }

    let root = PathBuf::from(path);
    if !root.exists() {
        return None;
    }

    let mut paths = Vec::new();
    collect_repo_relative_paths(&root, &root, &mut paths);
    paths.sort();
    paths.dedup();
    recover_git_relative_path_from_paths(candidate, &paths)
}

fn resolve_git_command_path(path: &str, target: &ExecTarget, file_path: &str) -> String {
    let candidate = relative_git_path(path, file_path);
    if git_worktree_path_exists(path, target, &candidate) || git_index_path_exists(path, target, &candidate) {
        return candidate;
    }

    if !candidate.starts_with('.') {
        let dotted = format!(".{}", candidate);
        if git_worktree_path_exists(path, target, &dotted) || git_index_path_exists(path, target, &dotted) {
            return dotted;
        }
    }

    if let Some(recovered) =
        recover_git_relative_path_from_paths(&candidate, &git_known_change_paths(path, target))
    {
        return recovered;
    }

    if let Some(recovered) =
        recover_git_relative_path_from_paths(&candidate, &git_known_repo_paths(path, target))
    {
        return recovered;
    }

    if let Some(recovered) = recover_git_relative_path_from_fs(path, &candidate) {
        return recovered;
    }

    candidate
}

fn read_file_text(path: &Path) -> String {
    std::fs::read(path)
        .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
        .unwrap_or_default()
}

fn read_target_file_text(path: &str, target: &ExecTarget, relative: &str) -> String {
    if matches!(target, ExecTarget::Wsl { .. }) {
        return run_cmd(target, path, &["cat", relative]).unwrap_or_default();
    }
    read_file_text(&PathBuf::from(path).join(relative))
}

fn git_show_file(path: &str, target: &ExecTarget, spec: &str, relative: &str) -> String {
    let object = if spec == ":" {
        format!(":{}", relative)
    } else {
        format!("{}:{}", spec, relative)
    };
    run_cmd(target, path, &["git", "show", &object]).unwrap_or_default()
}

fn git_cached_diff(path: &str, target: &ExecTarget, relative: Option<&str>) -> String {
    let mut args = vec!["git", "diff", "--cached"];
    if let Some(value) = relative {
        args.push("--");
        args.push(value);
    }
    run_cmd(target, path, &args).unwrap_or_default()
}

fn git_worktree_diff(path: &str, target: &ExecTarget, relative: Option<&str>) -> String {
    let mut args = vec!["git", "diff"];
    if let Some(value) = relative {
        args.push("--");
        args.push(value);
    }
    run_cmd(target, path, &args).unwrap_or_default()
}

fn combine_git_diff_sections(sections: &[String]) -> String {
    let mut merged = Vec::new();
    for section in sections {
        if section.trim().is_empty() {
            continue;
        }
        if !merged.is_empty() {
            merged.push(String::new());
        }
        merged.push(section.trim_end().to_string());
    }
    merged.join("\n")
}

#[tauri::command]
fn git_status(path: String, target: ExecTarget) -> Result<GitStatus, String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let branch = run_cmd(
        &target,
        &resolved,
        &["git", "rev-parse", "--abbrev-ref", "HEAD"],
    )
    .unwrap_or_else(|_| "unknown".to_string());
    let changes = run_cmd(&target, &resolved, &["git", "status", "--porcelain"]).unwrap_or_default();
    let change_count = changes.lines().filter(|l| !l.trim().is_empty()).count() as u32;
    let last_commit = run_cmd(&target, &resolved, &["git", "log", "-1", "--pretty=format:%s"])
        .unwrap_or_else(|_| "—".to_string());
    Ok(GitStatus {
        branch,
        changes: change_count,
        last_commit,
    })
}

#[tauri::command]
fn git_diff(path: String, target: ExecTarget) -> Result<String, String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    if git_has_head(&resolved, &target) {
        return run_cmd(&target, &resolved, &["git", "diff", "HEAD", "--"]).map_err(|e| e.to_string());
    }
    Ok(combine_git_diff_sections(&[
        git_cached_diff(&resolved, &target, None),
        git_worktree_diff(&resolved, &target, None),
    ]))
}

#[tauri::command]
fn git_changes(path: String, target: ExecTarget) -> Result<Vec<GitChangeEntry>, String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let raw = run_cmd(&target, &resolved, &["git", "status", "--porcelain"]).unwrap_or_default();
    Ok(parse_git_changes(&raw))
}

#[tauri::command]
fn git_diff_file(
    path: String,
    target: ExecTarget,
    file_path: String,
    staged: Option<bool>,
) -> Result<String, String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let relative = resolve_git_command_path(&resolved, &target, &file_path);
    if staged.unwrap_or(false) {
        let diff = git_cached_diff(&resolved, &target, Some(&relative));
        if !diff.trim().is_empty() {
            return Ok(diff);
        }
        Ok(git_worktree_diff(&resolved, &target, Some(&relative)))
    } else {
        let diff = git_worktree_diff(&resolved, &target, Some(&relative));
        if !diff.trim().is_empty() {
            return Ok(diff);
        }
        Ok(git_cached_diff(&resolved, &target, Some(&relative)))
    }
}

#[tauri::command]
fn git_file_diff_payload(
    path: String,
    target: ExecTarget,
    file_path: String,
    section: String,
) -> Result<GitFileDiffPayload, String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let relative = resolve_git_command_path(&resolved, &target, &file_path);
    let working_content = read_target_file_text(&resolved, &target, &relative);
    let head_content = git_show_file(&resolved, &target, "HEAD", &relative);
    let index_content = git_show_file(&resolved, &target, ":", &relative);

    let (original_content, modified_content, diff) = match section.as_str() {
        "staged" => (
            head_content,
            index_content,
            git_cached_diff(&resolved, &target, Some(&relative)),
        ),
        "untracked" => (
            String::new(),
            working_content,
            git_worktree_diff(&resolved, &target, Some(&relative)),
        ),
        _ => {
            let original = if index_content.is_empty() { head_content } else { index_content };
            (
                original,
                working_content,
                git_worktree_diff(&resolved, &target, Some(&relative)),
            )
        }
    };

    Ok(GitFileDiffPayload {
        original_content,
        modified_content,
        diff,
    })
}

fn git_has_head(path: &str, target: &ExecTarget) -> bool {
    run_cmd(target, path, &["git", "rev-parse", "--verify", "HEAD"]).is_ok()
}

#[tauri::command]
fn git_stage_all(path: String, target: ExecTarget) -> Result<(), String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    run_cmd(&target, &resolved, &["git", "add", "-A"]).map(|_| ())
}

#[tauri::command]
fn git_stage_file(path: String, target: ExecTarget, file_path: String) -> Result<(), String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let relative = resolve_git_command_path(&resolved, &target, &file_path);
    run_cmd(&target, &resolved, &["git", "add", "--", &relative])
        .map(|_| ())
        .map_err(|error| format!("{} (input: {}, resolved: {})", error, file_path, relative))
}

#[tauri::command]
fn git_unstage_all(path: String, target: ExecTarget) -> Result<(), String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    if git_has_head(&resolved, &target) {
        run_cmd(&target, &resolved, &["git", "reset", "HEAD", "--", "."]).map(|_| ())
    } else {
        run_cmd(&target, &resolved, &["git", "rm", "--cached", "-r", "."]).map(|_| ())
    }
}

#[tauri::command]
fn git_unstage_file(path: String, target: ExecTarget, file_path: String) -> Result<(), String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let relative = resolve_git_command_path(&resolved, &target, &file_path);
    if git_has_head(&resolved, &target) {
        run_cmd(&target, &resolved, &["git", "restore", "--staged", "--", &relative])
            .map(|_| ())
            .map_err(|error| format!("{} (input: {}, resolved: {})", error, file_path, relative))
    } else {
        run_cmd(&target, &resolved, &["git", "rm", "--cached", "--", &relative])
            .map(|_| ())
            .map_err(|error| format!("{} (input: {}, resolved: {})", error, file_path, relative))
    }
}

#[tauri::command]
fn git_discard_all(path: String, target: ExecTarget) -> Result<(), String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    if git_has_head(&resolved, &target) {
        run_cmd(&target, &resolved, &["git", "reset", "--hard", "HEAD"])?;
    } else {
        let _ = run_cmd(&target, &resolved, &["git", "rm", "--cached", "-r", "."]);
    }
    let _ = run_cmd(&target, &resolved, &["git", "clean", "-fd"]);
    Ok(())
}

#[tauri::command]
fn git_discard_file(
    path: String,
    target: ExecTarget,
    file_path: String,
    section: Option<String>,
) -> Result<(), String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let relative = resolve_git_command_path(&resolved, &target, &file_path);
    let is_untracked = section.as_deref() == Some("untracked");

    if is_untracked {
        let _ = run_cmd(&target, &resolved, &["git", "clean", "-fd", "--", &relative]);
        if matches!(target, ExecTarget::Wsl { .. }) {
            let _ = run_cmd(&target, &resolved, &["rm", "-rf", &relative]);
        } else {
            let absolute = PathBuf::from(&resolved).join(&relative);
            if absolute.is_dir() {
                let _ = std::fs::remove_dir_all(&absolute);
            } else if absolute.exists() {
                let _ = std::fs::remove_file(&absolute);
            }
        }
        return Ok(());
    }

    if git_has_head(&resolved, &target) {
        run_cmd(
            &target,
            &resolved,
            &["git", "restore", "--worktree", "--", &relative],
        )
        .map(|_| ())
        .map_err(|error| format!("{} (input: {}, resolved: {})", error, file_path, relative))
    } else if matches!(target, ExecTarget::Wsl { .. }) {
        run_cmd(&target, &resolved, &["rm", "-rf", &relative])
            .map(|_| ())
            .map_err(|error| format!("{} (input: {}, resolved: {})", error, file_path, relative))
    } else {
        let absolute = PathBuf::from(&resolved).join(&relative);
        if absolute.is_dir() {
            std::fs::remove_dir_all(&absolute).map_err(|e| e.to_string())
        } else if absolute.exists() {
            std::fs::remove_file(&absolute).map_err(|e| e.to_string())
        } else {
            Ok(())
        }
    }
}

#[tauri::command]
fn git_commit(path: String, target: ExecTarget, message: String) -> Result<String, String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err("commit message required".to_string());
    }
    let resolved = resolve_git_repo_path(&path, &target)?;
    run_cmd(&target, &resolved, &["git", "commit", "-m", trimmed])
}

#[tauri::command]
fn worktree_list(path: String, target: ExecTarget) -> Result<Vec<WorktreeInfo>, String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let raw =
        run_cmd(&target, &resolved, &["git", "worktree", "list", "--porcelain"]).unwrap_or_default();
    let mut list = Vec::new();
    let mut current = WorktreeInfo {
        name: "".to_string(),
        path: "".to_string(),
        branch: "".to_string(),
        status: "".to_string(),
        diff: "".to_string(),
        tree: "".to_string(),
    };
    for line in raw.lines() {
        if line.starts_with("worktree ") {
            if !current.path.is_empty() {
                current.status = summarize_status(&current.path, &target);
                list.push(current.clone());
            }
            current = WorktreeInfo {
                name: "".to_string(),
                path: "".to_string(),
                branch: "".to_string(),
                status: "".to_string(),
                diff: "".to_string(),
                tree: "".to_string(),
            };
            current.path = line.replace("worktree ", "");
            current.name = current
                .path
                .split('/')
                .last()
                .unwrap_or("worktree")
                .to_string();
        } else if line.starts_with("branch ") {
            current.branch = trim_branch_name(line);
        }
    }
    if !current.path.is_empty() {
        current.status = summarize_status(&current.path, &target);
        list.push(current);
    }
    Ok(list)
}

#[tauri::command]
fn workspace_tree(
    path: String,
    target: ExecTarget,
    depth: Option<usize>,
) -> Result<WorkspaceTree, String> {
    let resolved = resolve_git_repo_path(&path, &target)?;
    let depth = depth.unwrap_or(4);
    let mut limit: usize = 800;
    let git_files = run_cmd(
        &target,
        &resolved,
        &[
            "git",
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
        ],
    )
    .unwrap_or_default();
    let root = if !git_files.trim().is_empty() {
        build_tree_from_paths(git_files.lines().map(|l| l.to_string()).collect())
    } else if matches!(target, ExecTarget::Wsl { .. }) {
        let find_output = run_cmd(
            &target,
            &resolved,
            &["find", ".", "-maxdepth", &depth.to_string(), "-type", "f"],
        )
        .unwrap_or_default();
        if !find_output.trim().is_empty() {
            build_tree_from_paths(find_output.lines().map(|l| l.to_string()).collect())
        } else {
            FileNode {
                name: ".".to_string(),
                path: resolved.clone(),
                kind: "dir".to_string(),
                status: None,
                children: vec![],
            }
        }
    } else {
        build_tree(&PathBuf::from(&resolved), depth, &mut limit)
    };

    let changes_raw =
        run_cmd(&target, &resolved, &["git", "status", "--porcelain"]).unwrap_or_default();
    let mut changes: Vec<(String, String)> = vec![];
    for line in changes_raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let status = line.chars().take(2).collect::<String>().trim().to_string();
        let mut file_path = line.get(3..).unwrap_or("").trim().to_string();
        if let Some((_, target_path)) = file_path.split_once(" -> ") {
            file_path = target_path.to_string();
        }
        if !file_path.is_empty() {
            changes.push((file_path, status));
        }
    }
    let changes_tree = build_changes_tree(changes);
    Ok(WorkspaceTree {
        root,
        changes: changes_tree,
    })
}

#[tauri::command]
fn file_preview(path: String) -> Result<FilePreview, String> {
    const MAX_PREVIEW_BYTES: usize = 200_000;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let mut content = String::from_utf8_lossy(&bytes).to_string();
    if bytes.len() > MAX_PREVIEW_BYTES {
        content = String::from_utf8_lossy(&bytes[..MAX_PREVIEW_BYTES]).to_string();
        content.push_str("\n\n[preview truncated]");
    }
    Ok(FilePreview { path, content })
}

#[tauri::command]
fn file_save(path: String, content: String) -> Result<FilePreview, String> {
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(FilePreview { path, content })
}

#[cfg(target_os = "windows")]
fn windows_drive_roots() -> Vec<FilesystemRoot> {
    let mut roots = Vec::new();
    for letter in 'C'..='Z' {
        let path = format!("{letter}:\\");
        if Path::new(&path).exists() {
            roots.push(FilesystemRoot {
                id: format!("drive-{letter}"),
                label: format!("{letter}:"),
                path,
                description: "Windows drive".to_string(),
            });
        }
    }
    roots
}

fn filesystem_home_for_target(target: &ExecTarget) -> Result<String, String> {
    match target {
        ExecTarget::Native => user_home_dir()
            .map(|path| path.to_string_lossy().to_string())
            .ok_or("home_directory_not_found".to_string()),
        ExecTarget::Wsl { .. } => {
            let home = run_cmd(target, "", &["printenv", "HOME"])?;
            let trimmed = home.trim();
            if trimmed.is_empty() {
                Err("wsl_home_directory_not_found".to_string())
            } else {
                Ok(trimmed.to_string())
            }
        }
    }
}

#[tauri::command]
fn filesystem_roots(target: ExecTarget) -> Result<Vec<FilesystemRoot>, String> {
    match target {
        ExecTarget::Native => {
            let home = filesystem_home_for_target(&ExecTarget::Native)?;
            let mut roots = vec![FilesystemRoot {
                id: "home".to_string(),
                label: "Home".to_string(),
                path: home.clone(),
                description: "User home directory".to_string(),
            }];
            #[cfg(target_os = "windows")]
            {
                roots.extend(windows_drive_roots());
            }
            #[cfg(not(target_os = "windows"))]
            {
                roots.push(FilesystemRoot {
                    id: "root".to_string(),
                    label: "/".to_string(),
                    path: "/".to_string(),
                    description: "System root".to_string(),
                });
            }
            Ok(roots)
        }
        ExecTarget::Wsl { distro } => {
            let exec_target = ExecTarget::Wsl { distro };
            let home = filesystem_home_for_target(&exec_target)?;
            Ok(vec![
                FilesystemRoot {
                    id: "wsl-home".to_string(),
                    label: "Home".to_string(),
                    path: home,
                    description: "WSL home directory".to_string(),
                },
                FilesystemRoot {
                    id: "wsl-root".to_string(),
                    label: "/".to_string(),
                    path: "/".to_string(),
                    description: "WSL filesystem root".to_string(),
                },
                FilesystemRoot {
                    id: "wsl-mnt".to_string(),
                    label: "/mnt".to_string(),
                    path: "/mnt".to_string(),
                    description: "Mounted host drives".to_string(),
                },
            ])
        }
    }
}

fn native_parent_path(path: &str) -> Option<String> {
    let candidate = PathBuf::from(path);
    let parent = candidate.parent()?.to_path_buf();
    let rendered = parent.to_string_lossy().to_string();
    if rendered.is_empty() || rendered == path {
        None
    } else {
        Some(rendered)
    }
}

fn wsl_parent_path(path: &str, target: &ExecTarget) -> Option<String> {
    if path.trim().is_empty() || path == "/" {
        return None;
    }
    run_cmd(target, "", &["dirname", path])
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != path)
}

fn list_native_directories(path: &str) -> Result<Vec<FilesystemEntry>, String> {
    let mut entries = std::fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            if !metadata.is_dir() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            Some(FilesystemEntry {
                name,
                path: entry.path().to_string_lossy().to_string(),
                kind: "dir".to_string(),
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(entries)
}

fn list_wsl_directories(path: &str, target: &ExecTarget) -> Result<Vec<FilesystemEntry>, String> {
    let output = run_cmd(
        target,
        "",
        &[
            "find",
            path,
            "-mindepth",
            "1",
            "-maxdepth",
            "1",
            "-type",
            "d",
            "-printf",
            "%f\t%p\n",
        ],
    )?;
    let mut entries = output
        .lines()
        .filter_map(|line| {
            let (name, full_path) = line.split_once('\t')?;
            Some(FilesystemEntry {
                name: name.to_string(),
                path: full_path.to_string(),
                kind: "dir".to_string(),
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(entries)
}

fn list_directories_for_target(target: &ExecTarget, path: &str) -> Result<Vec<FilesystemEntry>, String> {
    match target {
        ExecTarget::Native => list_native_directories(path),
        ExecTarget::Wsl { .. } => list_wsl_directories(path, target),
    }
}

#[tauri::command]
fn filesystem_list(
    target: ExecTarget,
    path: Option<String>,
) -> Result<FilesystemListResponse, String> {
    let roots = filesystem_roots(target.clone())?;
    let home_path = filesystem_home_for_target(&target)?;
    let requested_path = path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| resolve_target_path(value, &target))
        .transpose()?;

    let mut candidate_paths = Vec::new();
    if let Some(requested) = requested_path.clone() {
        candidate_paths.push(requested);
    }
    candidate_paths.push(home_path.clone());
    for root in &roots {
        if !candidate_paths.iter().any(|existing| existing == &root.path) {
            candidate_paths.push(root.path.clone());
        }
    }

    let mut first_error: Option<String> = None;
    let mut resolved_listing: Option<(String, Vec<FilesystemEntry>)> = None;

    for candidate in candidate_paths {
        match list_directories_for_target(&target, &candidate) {
            Ok(entries) => {
                resolved_listing = Some((candidate, entries));
                break;
            }
            Err(error) => {
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
    }

    let (current_path, entries) = resolved_listing.ok_or_else(|| {
        first_error.unwrap_or_else(|| "unable_to_read_server_directories".to_string())
    })?;
    let parent_path = match target {
        ExecTarget::Native => native_parent_path(&current_path),
        ExecTarget::Wsl { .. } => wsl_parent_path(&current_path, &target),
    };
    let fallback_reason = requested_path
        .as_ref()
        .filter(|requested| *requested != &current_path)
        .map(|_| "requested_path_unavailable".to_string());

    Ok(FilesystemListResponse {
        current_path,
        home_path,
        parent_path,
        roots,
        entries,
        requested_path,
        fallback_reason,
    })
}

#[tauri::command]
fn dialog_pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(app
        .dialog()
        .file()
        .blocking_pick_folder()
        .map(|path| path.into_path())
        .transpose()
        .map_err(|e| e.to_string())?
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn terminal_create(
    tab_id: String,
    cwd: String,
    target: ExecTarget,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<TerminalInfo, String> {
    let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
    let tab = ensure_tab(&mut tabs, &tab_id, &target);
    let terminal_id = tab.next_terminal_id;
    tab.next_terminal_id += 1;

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let cmd = build_terminal_pty_command(&target, &cwd);
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let runtime = Arc::new(TerminalRuntime {
        child: Mutex::new(child),
        writer: Mutex::new(Some(writer)),
        master: Mutex::new(pair.master),
    });

    let key = terminal_key(&tab_id, terminal_id);
    {
        let mut terms = state.terminals.lock().map_err(|e| e.to_string())?;
        terms.insert(key.clone(), runtime.clone());
    }

    tab.terminals.push(TerminalInfo {
        id: terminal_id,
        output: "".to_string(),
    });

    let app_handle = app.clone();
    let tab_id_out = tab_id.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    if text.is_empty() {
                        continue;
                    }
                    emit_terminal(&app_handle, &tab_id_out, terminal_id, &text);
                }
                Err(_) => break,
            }
        }
    });

    let app_handle = app.clone();
    let state_handle = app.clone();
    std::thread::spawn(move || {
        if let Ok(mut child) = runtime.child.lock() {
            let _ = child.wait();
        }
        emit_terminal(&app_handle, &tab_id, terminal_id, "\n[terminal exited]\n");
        let state: State<AppState> = state_handle.state();
        if let Ok(mut terms) = state.terminals.lock() {
            terms.remove(&key);
        };
    });

    Ok(TerminalInfo {
        id: terminal_id,
        output: "".to_string(),
    })
}

#[tauri::command]
fn terminal_write(
    tab_id: String,
    terminal_id: u64,
    input: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = terminal_key(&tab_id, terminal_id);
    let terms = state.terminals.lock().map_err(|e| e.to_string())?;
    let runtime = terms.get(&key).ok_or("terminal_not_found")?.clone();
    let mut writer = runtime.writer.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = writer.as_mut() {
        handle
            .write_all(input.as_bytes())
            .map_err(|e| e.to_string())?;
        handle.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("terminal_stdin_closed".to_string())
    }
}

#[tauri::command]
fn terminal_resize(
    tab_id: String,
    terminal_id: u64,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = terminal_key(&tab_id, terminal_id);
    let terms = state.terminals.lock().map_err(|e| e.to_string())?;
    let runtime = terms.get(&key).ok_or("terminal_not_found")?.clone();
    let master = runtime.master.lock().map_err(|e| e.to_string())?;
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn terminal_close(
    tab_id: String,
    terminal_id: u64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = terminal_key(&tab_id, terminal_id);

    let runtime = {
        let mut terms = state.terminals.lock().map_err(|e| e.to_string())?;
        terms.remove(&key)
    };

    if let Some(runtime) = runtime {
        if let Ok(mut writer) = runtime.writer.lock() {
            writer.take();
        }
        if let Ok(mut child) = runtime.child.lock() {
            let _ = child.kill();
        }
    }

    let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
    if let Some(tab) = tabs.get_mut(&tab_id) {
        tab.terminals.retain(|terminal| terminal.id != terminal_id);
    }

    Ok(())
}

#[tauri::command]
fn agent_start(
    tab_id: String,
    session_id: String,
    provider: String,
    command: String,
    claude_session_id: Option<String>,
    cwd: String,
    target: ExecTarget,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = agent_key(&tab_id, &session_id);
    {
        let agents = state.agents.lock().map_err(|e| e.to_string())?;
        if agents.contains_key(&key) {
            return Ok(());
        }
    }

    let stored_claude_session_id = {
        let tabs = state.tabs.lock().map_err(|e| e.to_string())?;
        tabs.get(&tab_id)
            .and_then(|tab| session_id.parse::<u64>().ok().and_then(|session_id_num| {
                tab.sessions
                    .iter()
                    .find(|session| session.id == session_id_num)
                    .and_then(|session| session.claude_session_id.clone())
            }))
    };

    let effective_claude_session_id = claude_session_id.or(stored_claude_session_id);

    let command = if provider == "claude" {
        build_claude_resume_command(&command, effective_claude_session_id.as_deref())
    } else {
        command
    };

    let (program, args) = build_agent_pty_command(&target, &cwd, &command);
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new(program);
    for arg in args {
        cmd.arg(arg);
    }

    if provider == "claude" {
        ensure_claude_hook_settings(&cwd, &target)?;
        let app_bin = current_app_bin_for_target(&target)?;
        let hook_endpoint = current_hook_endpoint(&app)?;
        cmd.env("CODER_STUDIO_APP_BIN", app_bin);
        cmd.env("CODER_STUDIO_HOOK_ENDPOINT", hook_endpoint);
        cmd.env("CODER_STUDIO_TAB_ID", tab_id.clone());
        cmd.env("CODER_STUDIO_SESSION_ID", session_id.clone());
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| {
        let raw = e.to_string();
        if raw.to_ascii_lowercase().contains("no such file") {
            return format!(
                "failed to start agent command: {} (command: `{}`; check PATH or set full binary path in settings)",
                raw, command
            );
        }
        format!("failed to start agent command: {} (command: `{}`)", raw, command)
    })?;
    drop(pair.slave);
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let runtime = Arc::new(AgentRuntime {
        child: Mutex::new(child),
        writer: Mutex::new(Some(writer)),
        master: Mutex::new(pair.master),
    });

    {
        let mut agents = state.agents.lock().map_err(|e| e.to_string())?;
        agents.insert(key.clone(), runtime.clone());
    }

    emit_agent(
        &app,
        &tab_id,
        &session_id,
        "system",
        "Agent started / 智能体已启动",
    );

    let tab_id_out = tab_id.clone();
    let session_out = session_id.clone();
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    if text.is_empty() {
                        continue;
                    }
                    if text.trim().is_empty() {
                        continue;
                    }
                    emit_agent(&app_handle, &tab_id_out, &session_out, "stdout", &text);
                }
                Err(_) => break,
            }
        }
    });

    let app_handle = app.clone();
    let state_handle = app.clone();
    std::thread::spawn(move || {
        if let Ok(mut child) = runtime.child.lock() {
            let _ = child.wait();
        }
        emit_agent(&app_handle, &tab_id, &session_id, "exit", "exited");
        let state: State<AppState> = state_handle.state();
        if let Ok(mut agents) = state.agents.lock() {
            agents.remove(&key);
        };
    });

    Ok(())
}

#[tauri::command]
fn agent_send(
    tab_id: String,
    session_id: String,
    input: String,
    append_newline: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = agent_key(&tab_id, &session_id);
    let agents = state.agents.lock().map_err(|e| e.to_string())?;
    let runtime = agents.get(&key).ok_or("agent_not_running")?.clone();
    let mut writer = runtime.writer.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = writer.as_mut() {
        handle
            .write_all(input.as_bytes())
            .map_err(|e| e.to_string())?;
        if append_newline.unwrap_or(true) {
            handle.write_all(b"\r").map_err(|e| e.to_string())?;
        }
        handle.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("agent_stdin_closed".to_string())
    }
}

#[tauri::command]
fn agent_stop(
    tab_id: String,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = agent_key(&tab_id, &session_id);
    let mut agents = state.agents.lock().map_err(|e| e.to_string())?;
    if let Some(runtime) = agents.remove(&key) {
        if let Ok(mut child) = runtime.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Ok(mut writer) = runtime.writer.lock() {
            *writer = None;
        }
    }
    Ok(())
}

#[tauri::command]
fn agent_resize(
    tab_id: String,
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = agent_key(&tab_id, &session_id);
    let agents = state.agents.lock().map_err(|e| e.to_string())?;
    let runtime = agents.get(&key).ok_or("agent_not_running")?.clone();
    let master = runtime.master.lock().map_err(|e| e.to_string())?;
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

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
            let transport_endpoint = start_transport_server(app.handle()).map_err(std::io::Error::other)?;
            let state: State<AppState> = app.state();
            let mut guard = state
                .db
                .lock()
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
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
