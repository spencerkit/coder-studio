use crate::ws::server::ws_handler;
use crate::*;

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

pub(crate) fn dispatch_rpc(
    app: &tauri::AppHandle,
    command: &str,
    payload: Value,
) -> Result<Value, String> {
    match command {
        "init_workspace" => {
            let req: InitWorkspaceRequest = parse_payload(payload)?;
            serde_json::to_value(init_workspace(req.source, app.state())?)
                .map_err(|e| e.to_string())
        }
        "tab_snapshot" => {
            let req: TabIdRequest = parse_payload(payload)?;
            serde_json::to_value(tab_snapshot(req.tab_id, app.state())?).map_err(|e| e.to_string())
        }
        "create_session" => {
            let req: SessionCreateRequest = parse_payload(payload)?;
            serde_json::to_value(create_session(req.tab_id, req.mode, app.state())?)
                .map_err(|e| e.to_string())
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
            serde_json::to_value(archive_session(req.tab_id, req.session_id, app.state())?)
                .map_err(|e| e.to_string())
        }
        "update_idle_policy" => {
            let req: IdlePolicyRequest = parse_payload(payload)?;
            update_idle_policy(req.tab_id, req.policy, app.state())?;
            Ok(Value::Null)
        }
        "queue_add" => {
            let req: QueueAddRequest = parse_payload(payload)?;
            serde_json::to_value(queue_add(
                req.tab_id,
                req.session_id,
                req.text,
                app.state(),
            )?)
            .map_err(|e| e.to_string())
        }
        "queue_run" => {
            let req: QueueRunRequest = parse_payload(payload)?;
            serde_json::to_value(queue_run(
                req.tab_id,
                req.session_id,
                req.task_id,
                app.state(),
            )?)
            .map_err(|e| e.to_string())
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
            serde_json::to_value(git_diff_file(
                req.path,
                req.target,
                req.file_path,
                req.staged,
            )?)
            .map_err(|e| e.to_string())
        }
        "git_file_diff_payload" => {
            let req: GitFileSectionRequest = parse_payload(payload)?;
            serde_json::to_value(git_file_diff_payload(
                req.path,
                req.target,
                req.file_path,
                req.section,
            )?)
            .map_err(|e| e.to_string())
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
            serde_json::to_value(git_commit(req.path, req.target, req.message)?)
                .map_err(|e| e.to_string())
        }
        "worktree_list" => {
            let req: PathTargetRequest = parse_payload(payload)?;
            serde_json::to_value(worktree_list(req.path, req.target)?).map_err(|e| e.to_string())
        }
        "worktree_inspect" => {
            let req: WorktreeInspectRequest = parse_payload(payload)?;
            serde_json::to_value(worktree_inspect(req.path, req.target, Some(req.depth))?)
                .map_err(|e| e.to_string())
        }
        "workspace_tree" => {
            let req: WorkspaceTreeRequest = parse_payload(payload)?;
            serde_json::to_value(workspace_tree(req.path, req.target, Some(req.depth))?)
                .map_err(|e| e.to_string())
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
            serde_json::to_value(terminal_create(
                req.tab_id,
                req.cwd,
                req.target,
                app.clone(),
                app.state(),
            )?)
            .map_err(|e| e.to_string())
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
            serde_json::to_value(agent_start(
                req.tab_id,
                req.session_id,
                req.provider,
                req.command,
                req.claude_session_id,
                req.cwd,
                req.target,
                app.clone(),
                app.state(),
            )?)
            .map_err(|e| e.to_string())
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

pub(crate) async fn rpc_handler(
    AxumPath(command): AxumPath<String>,
    AxumState(state): AxumState<HttpServerState>,
    Json(payload): Json<Value>,
) -> Response {
    match dispatch_rpc(&state.app, &command, payload) {
        Ok(data) => json_success(data),
        Err(error) => json_error(StatusCode::BAD_REQUEST, error),
    }
}

pub(crate) async fn health_handler() -> impl IntoResponse {
    Json(json!({ "ok": true }))
}

pub(crate) fn frontend_dist_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist")
}

pub(crate) fn frontend_assets_dir() -> PathBuf {
    frontend_dist_dir().join("assets")
}

pub(crate) async fn spa_shell_handler() -> impl IntoResponse {
    let index_file = frontend_dist_dir().join("index.html");
    let html = std::fs::read_to_string(index_file).unwrap_or_else(|_| {
        r#"<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Agent Workbench</title></head><body><div id="root"></div></body></html>"#.to_string()
    });
    Html(html)
}

pub(crate) fn build_transport_router(app: &tauri::AppHandle) -> Router {
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

pub(crate) fn start_transport_server(app: &tauri::AppHandle) -> Result<String, String> {
    let bind_port = if cfg!(debug_assertions) {
        DEV_BACKEND_PORT
    } else {
        0
    };
    let listener =
        std::net::TcpListener::bind(("127.0.0.1", bind_port)).map_err(|e| e.to_string())?;
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
