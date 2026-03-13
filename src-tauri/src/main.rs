use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{Emitter, Manager, State};

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
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct GitStatus {
    pub branch: String,
    pub changes: u32,
    pub last_commit: String,
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

#[derive(Clone, Deserialize, Debug)]
pub struct SessionPatch {
    pub status: Option<SessionStatus>,
    pub mode: Option<SessionMode>,
    pub auto_feed: Option<bool>,
    pub last_active_at: Option<i64>,
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

#[derive(Default)]
pub struct AppState {
    pub tabs: Mutex<HashMap<String, TabState>>,
    pub db: Mutex<Option<Connection>>,
    pub agents: Mutex<HashMap<String, Arc<AgentRuntime>>>,
    pub terminals: Mutex<HashMap<String, Arc<TerminalRuntime>>>,
    pub hook_endpoint: Mutex<Option<String>>,
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

fn agent_key(tab_id: &str, session_id: &str) -> String {
    format!("{}:{}", tab_id, session_id)
}

fn terminal_key(tab_id: &str, terminal_id: u64) -> String {
    format!("{}:{}", tab_id, terminal_id)
}

fn emit_agent(app: &tauri::AppHandle, tab_id: &str, session_id: &str, kind: &str, data: &str) {
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
        WorkspaceSourceKind::Local => resolve_target_path(&source.path_or_url, &source.target)?,
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
                let _ = child.wait();
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
    let resolved = resolve_target_path(&path, &target)?;
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
        let mut c = std::process::Command::new("wsl.exe");
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
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
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
            ("/bin/sh".to_string(), vec!["-lc".to_string(), shell_cmd])
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

#[tauri::command]
fn git_status(path: String, target: ExecTarget) -> Result<GitStatus, String> {
    let branch = run_cmd(
        &target,
        &path,
        &["git", "rev-parse", "--abbrev-ref", "HEAD"],
    )
    .unwrap_or_else(|_| "unknown".to_string());
    let changes = run_cmd(&target, &path, &["git", "status", "--porcelain"]).unwrap_or_default();
    let change_count = changes.lines().filter(|l| !l.trim().is_empty()).count() as u32;
    let last_commit = run_cmd(&target, &path, &["git", "log", "-1", "--pretty=format:%s"])
        .unwrap_or_else(|_| "—".to_string());
    Ok(GitStatus {
        branch,
        changes: change_count,
        last_commit,
    })
}

#[tauri::command]
fn git_diff(path: String, target: ExecTarget) -> Result<String, String> {
    run_cmd(&target, &path, &["git", "diff"]).map_err(|e| e.to_string())
}

#[tauri::command]
fn worktree_list(path: String, target: ExecTarget) -> Result<Vec<WorktreeInfo>, String> {
    let raw =
        run_cmd(&target, &path, &["git", "worktree", "list", "--porcelain"]).unwrap_or_default();
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
    let resolved = resolve_target_path(&path, &target)?;
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
fn agent_start(
    tab_id: String,
    session_id: String,
    provider: String,
    command: String,
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

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
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
            worktree_list,
            worktree_inspect,
            workspace_tree,
            file_preview,
            file_save,
            terminal_create,
            terminal_write,
            terminal_resize,
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
            let state: State<AppState> = app.state();
            let mut guard = state
                .db
                .lock()
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
            *guard = Some(conn);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
