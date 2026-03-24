use crate::ws::server::ws_handler;
use crate::*;

#[derive(Deserialize)]
struct LaunchWorkspaceRequest {
    source: WorkspaceSource,
}

#[derive(Deserialize)]
struct WorkspaceIdRequest {
    workspace_id: String,
}

#[derive(Deserialize)]
struct SessionCreateRequest {
    workspace_id: String,
    mode: SessionMode,
}

#[derive(Deserialize)]
struct SessionUpdateRequest {
    workspace_id: String,
    session_id: u64,
    patch: SessionPatch,
}

#[derive(Deserialize)]
struct SwitchSessionRequest {
    workspace_id: String,
    session_id: u64,
}

#[derive(Deserialize)]
struct ArchiveSessionRequest {
    workspace_id: String,
    session_id: u64,
}

#[derive(Deserialize)]
struct IdlePolicyRequest {
    workspace_id: String,
    policy: IdlePolicy,
}

#[derive(Deserialize)]
struct WorkspaceViewRequest {
    workspace_id: String,
    patch: WorkspaceViewPatch,
}

#[derive(Deserialize)]
struct WorkbenchLayoutRequest {
    layout: WorkbenchLayout,
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
    workspace_id: String,
    cwd: String,
    target: ExecTarget,
    cols: Option<u16>,
    rows: Option<u16>,
}

#[derive(Deserialize)]
struct TerminalWriteRequest {
    workspace_id: String,
    terminal_id: u64,
    input: String,
}

#[derive(Deserialize)]
struct TerminalResizeRequest {
    workspace_id: String,
    terminal_id: u64,
    cols: u16,
    rows: u16,
}

#[derive(Deserialize)]
struct TerminalCloseRequest {
    workspace_id: String,
    terminal_id: u64,
}

#[derive(Deserialize)]
struct AgentStartRequest {
    workspace_id: String,
    session_id: String,
    provider: String,
    command: String,
    cols: Option<u16>,
    rows: Option<u16>,
}

#[derive(Deserialize)]
struct AgentSendRequest {
    workspace_id: String,
    session_id: String,
    input: String,
    append_newline: Option<bool>,
}

#[derive(Deserialize)]
struct AgentStopRequest {
    workspace_id: String,
    session_id: String,
}

#[derive(Deserialize)]
struct AgentResizeRequest {
    workspace_id: String,
    session_id: String,
    cols: u16,
    rows: u16,
}

#[derive(Deserialize)]
struct LoginRequest {
    password: String,
}

#[derive(Deserialize)]
struct SystemConfigPatchRequest {
    updates: Map<String, Value>,
}

#[derive(Deserialize)]
struct SystemAuthIpUnblockRequest {
    ip: Option<String>,
    all: Option<bool>,
}

struct RpcError {
    status: StatusCode,
    error: String,
}

fn request_forces_public_mode(uri: &axum::http::Uri) -> bool {
    uri.query()
        .map(|query| {
            url::form_urlencoded::parse(query.as_bytes())
                .any(|(key, value)| key == "auth" && value.eq_ignore_ascii_case("force"))
        })
        .unwrap_or(false)
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

fn json_success_with_cookie(data: Value, cookie: &str) -> Response {
    let mut response = json_success(data);
    if !cookie.is_empty() {
        if let Ok(value) = axum::http::HeaderValue::from_str(cookie) {
            response
                .headers_mut()
                .append(axum::http::header::SET_COOKIE, value);
        }
    }
    response
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

fn rpc_bad_request(error: impl Into<String>) -> RpcError {
    RpcError {
        status: StatusCode::BAD_REQUEST,
        error: error.into(),
    }
}

fn rpc_forbidden(error: impl Into<String>) -> RpcError {
    RpcError {
        status: StatusCode::FORBIDDEN,
        error: error.into(),
    }
}

fn require_path_access(
    path: &str,
    target: &ExecTarget,
    authorized: &AuthorizedRequest,
) -> Result<(), RpcError> {
    if authorized.request.public_mode {
        ensure_path_allowed(path, target, &authorized.allowed_roots).map_err(rpc_forbidden)?;
    }
    Ok(())
}

fn require_optional_path_access(
    path: Option<&str>,
    target: &ExecTarget,
    authorized: &AuthorizedRequest,
) -> Result<(), RpcError> {
    if authorized.request.public_mode {
        ensure_optional_path_allowed(path, target, &authorized.allowed_roots)
            .map_err(rpc_forbidden)?;
    }
    Ok(())
}

fn require_workspace_access(
    app: &AppHandle,
    workspace_id: &str,
    authorized: &AuthorizedRequest,
) -> Result<(String, ExecTarget), RpcError> {
    let context = workspace_access_context(app.state(), workspace_id).map_err(rpc_bad_request)?;
    require_path_access(&context.0, &context.1, authorized)?;
    Ok(context)
}

fn filter_bootstrap_for_public_mode(
    bootstrap: WorkbenchBootstrap,
    authorized: &AuthorizedRequest,
) -> WorkbenchBootstrap {
    if !authorized.request.public_mode {
        return bootstrap;
    }

    let mut allowed_ids = Vec::new();
    let workspaces = bootstrap
        .workspaces
        .into_iter()
        .filter(|snapshot| {
            let allowed = ensure_path_allowed(
                &snapshot.workspace.project_path,
                &snapshot.workspace.target,
                &authorized.allowed_roots,
            )
            .is_ok();
            if allowed {
                allowed_ids.push(snapshot.workspace.workspace_id.clone());
            }
            allowed
        })
        .collect::<Vec<_>>();

    let active_workspace_id = bootstrap
        .ui_state
        .active_workspace_id
        .filter(|id| allowed_ids.iter().any(|item| item == id))
        .or_else(|| allowed_ids.first().cloned());

    WorkbenchBootstrap {
        ui_state: WorkbenchUiState {
            open_workspace_ids: allowed_ids,
            active_workspace_id,
            layout: bootstrap.ui_state.layout,
        },
        workspaces,
    }
}

fn dispatch_rpc(
    app: &AppHandle,
    command: &str,
    payload: Value,
    authorized: &AuthorizedRequest,
) -> Result<Value, RpcError> {
    match command {
        "launch_workspace" => {
            let req: LaunchWorkspaceRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            if authorized.request.public_mode {
                if matches!(&req.source.kind, WorkspaceSourceKind::Local) {
                    require_path_access(&req.source.path_or_url, &req.source.target, authorized)?;
                }
                let clone_root = if matches!(&req.source.kind, WorkspaceSourceKind::Remote) {
                    Some(
                        select_clone_root_for_target(&req.source.target, &authorized.allowed_roots)
                            .map_err(rpc_forbidden)?,
                    )
                } else {
                    None
                };
                serde_json::to_value(
                    launch_workspace_internal(req.source, clone_root, app.state())
                        .map_err(rpc_bad_request)?,
                )
                .map_err(|e| rpc_bad_request(e.to_string()))
            } else {
                serde_json::to_value(
                    launch_workspace(req.source, app.state()).map_err(rpc_bad_request)?,
                )
                .map_err(|e| rpc_bad_request(e.to_string()))
            }
        }
        "workbench_bootstrap" => {
            let _req: EmptyRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            let bootstrap = workbench_bootstrap(app.state()).map_err(rpc_bad_request)?;
            serde_json::to_value(filter_bootstrap_for_public_mode(bootstrap, authorized))
                .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "workspace_snapshot" => {
            let req: WorkspaceIdRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            serde_json::to_value(
                workspace_snapshot(req.workspace_id.clone(), app.state())
                    .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "activate_workspace" => {
            let req: WorkspaceIdRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            serde_json::to_value(
                activate_workspace(req.workspace_id, app.state()).map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "close_workspace" => {
            let req: WorkspaceIdRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            serde_json::to_value(
                close_workspace(req.workspace_id, app.state()).map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "update_workbench_layout" => {
            let req: WorkbenchLayoutRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            serde_json::to_value(
                update_workbench_layout(req.layout, app.state()).map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "workspace_view_update" => {
            let req: WorkspaceViewRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            serde_json::to_value(
                workspace_view_update(req.workspace_id, req.patch, app.state())
                    .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "create_session" => {
            let req: SessionCreateRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            serde_json::to_value(
                create_session(req.workspace_id, req.mode, app.state()).map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "session_update" => {
            let req: SessionUpdateRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            serde_json::to_value(
                session_update(req.workspace_id, req.session_id, req.patch, app.state())
                    .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "switch_session" => {
            let req: SwitchSessionRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            serde_json::to_value(
                switch_session(req.workspace_id, req.session_id, app.state())
                    .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "archive_session" => {
            let req: ArchiveSessionRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            serde_json::to_value(
                archive_session(req.workspace_id, req.session_id, app.state())
                    .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "update_idle_policy" => {
            let req: IdlePolicyRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            update_idle_policy(req.workspace_id, req.policy, app.state())
                .map_err(rpc_bad_request)?;
            Ok(Value::Null)
        }
        "git_status" => {
            let req: PathTargetRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_path_access(&req.path, &req.target, authorized)?;
            let suppressed = begin_workspace_watch_suppression(app.state(), &req.path, &req.target);
            let result = git_status(req.path, req.target).map_err(rpc_bad_request);
            end_workspace_watch_suppression(app.state(), &suppressed);
            serde_json::to_value(result?).map_err(|e| rpc_bad_request(e.to_string()))
        }
        "git_diff" => {
            let req: PathTargetRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_path_access(&req.path, &req.target, authorized)?;
            let suppressed = begin_workspace_watch_suppression(app.state(), &req.path, &req.target);
            let result = git_diff(req.path, req.target).map_err(rpc_bad_request);
            end_workspace_watch_suppression(app.state(), &suppressed);
            serde_json::to_value(result?).map_err(|e| rpc_bad_request(e.to_string()))
        }
        "git_changes" => {
            let req: PathTargetRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_path_access(&req.path, &req.target, authorized)?;
            let suppressed = begin_workspace_watch_suppression(app.state(), &req.path, &req.target);
            let result = git_changes(req.path, req.target).map_err(rpc_bad_request);
            end_workspace_watch_suppression(app.state(), &suppressed);
            serde_json::to_value(result?).map_err(|e| rpc_bad_request(e.to_string()))
        }
        "git_diff_file" => {
            let req: GitDiffFileRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_path_access(&req.path, &req.target, authorized)?;
            let suppressed = begin_workspace_watch_suppression(app.state(), &req.path, &req.target);
            let result = git_diff_file(req.path, req.target, req.file_path, req.staged)
                .map_err(rpc_bad_request);
            end_workspace_watch_suppression(app.state(), &suppressed);
            serde_json::to_value(result?).map_err(|e| rpc_bad_request(e.to_string()))
        }
        "git_file_diff_payload" => {
            let req: GitFileSectionRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_path_access(&req.path, &req.target, authorized)?;
            let suppressed = begin_workspace_watch_suppression(app.state(), &req.path, &req.target);
            let result = git_file_diff_payload(req.path, req.target, req.file_path, req.section)
                .map_err(rpc_bad_request);
            end_workspace_watch_suppression(app.state(), &suppressed);
            serde_json::to_value(result?).map_err(|e| rpc_bad_request(e.to_string()))
        }
        "git_stage_all" => {
            let req: PathTargetRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_path_access(&req.path, &req.target, authorized)?;
            git_stage_all(req.path.clone(), req.target.clone()).map_err(rpc_bad_request)?;
            emit_workspace_artifacts_dirty(app, &req.path, &req.target, "git_stage_all");
            Ok(Value::Null)
        }
        "git_stage_file" => {
            let req: GitFileRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_path_access(&req.path, &req.target, authorized)?;
            git_stage_file(req.path.clone(), req.target.clone(), req.file_path)
                .map_err(rpc_bad_request)?;
            emit_workspace_artifacts_dirty(app, &req.path, &req.target, "git_stage_file");
            Ok(Value::Null)
        }
        "git_unstage_all" => {
            let req: PathTargetRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_path_access(&req.path, &req.target, authorized)?;
            git_unstage_all(req.path.clone(), req.target.clone()).map_err(rpc_bad_request)?;
            emit_workspace_artifacts_dirty(app, &req.path, &req.target, "git_unstage_all");
            Ok(Value::Null)
        }
        "git_unstage_file" => {
            let req: GitFileRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_path_access(&req.path, &req.target, authorized)?;
            git_unstage_file(req.path.clone(), req.target.clone(), req.file_path)
                .map_err(rpc_bad_request)?;
            emit_workspace_artifacts_dirty(app, &req.path, &req.target, "git_unstage_file");
            Ok(Value::Null)
        }
        "git_discard_all" => {
            let req: PathTargetRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_path_access(&req.path, &req.target, authorized)?;
            git_discard_all(req.path.clone(), req.target.clone()).map_err(rpc_bad_request)?;
            emit_workspace_artifacts_dirty(app, &req.path, &req.target, "git_discard_all");
            Ok(Value::Null)
        }
        "git_discard_file" => {
            let req: GitDiscardFileRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_path_access(&req.path, &req.target, authorized)?;
            git_discard_file(
                req.path.clone(),
                req.target.clone(),
                req.file_path,
                req.section,
            )
            .map_err(rpc_bad_request)?;
            emit_workspace_artifacts_dirty(app, &req.path, &req.target, "git_discard_file");
            Ok(Value::Null)
        }
        "git_commit" => {
            let req: GitCommitRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_path_access(&req.path, &req.target, authorized)?;
            let result = serde_json::to_value(
                git_commit(req.path.clone(), req.target.clone(), req.message)
                    .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))?;
            emit_workspace_artifacts_dirty(app, &req.path, &req.target, "git_commit");
            Ok(result)
        }
        "worktree_list" => {
            let req: PathTargetRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_path_access(&req.path, &req.target, authorized)?;
            let suppressed = begin_workspace_watch_suppression(app.state(), &req.path, &req.target);
            let worktrees = worktree_list(req.path, req.target.clone()).map_err(rpc_bad_request);
            end_workspace_watch_suppression(app.state(), &suppressed);
            let worktrees = worktrees?;
            let filtered = if authorized.request.public_mode {
                filter_allowed_worktrees(worktrees, &req.target, &authorized.allowed_roots)
            } else {
                worktrees
            };
            serde_json::to_value(filtered).map_err(|e| rpc_bad_request(e.to_string()))
        }
        "worktree_inspect" => {
            let req: WorktreeInspectRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_path_access(&req.path, &req.target, authorized)?;
            let suppressed = begin_workspace_watch_suppression(app.state(), &req.path, &req.target);
            let result =
                worktree_inspect(req.path, req.target, Some(req.depth)).map_err(rpc_bad_request);
            end_workspace_watch_suppression(app.state(), &suppressed);
            serde_json::to_value(result?).map_err(|e| rpc_bad_request(e.to_string()))
        }
        "workspace_tree" => {
            let req: WorkspaceTreeRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_path_access(&req.path, &req.target, authorized)?;
            let suppressed = begin_workspace_watch_suppression(app.state(), &req.path, &req.target);
            let result =
                workspace_tree(req.path, req.target, Some(req.depth)).map_err(rpc_bad_request);
            end_workspace_watch_suppression(app.state(), &suppressed);
            serde_json::to_value(result?).map_err(|e| rpc_bad_request(e.to_string()))
        }
        "file_preview" => {
            let req: FilePreviewRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_path_access(&req.path, &ExecTarget::Native, authorized)?;
            serde_json::to_value(file_preview(req.path).map_err(rpc_bad_request)?)
                .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "file_save" => {
            let req: FileSaveRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_path_access(&req.path, &ExecTarget::Native, authorized)?;
            let saved = serde_json::to_value(
                file_save(req.path.clone(), req.content).map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))?;
            emit_workspace_artifacts_dirty(app, &req.path, &ExecTarget::Native, "file_save");
            Ok(saved)
        }
        "filesystem_roots" => {
            let req: FilesystemRootsRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            let roots = if authorized.request.public_mode {
                filesystem_roots_public(&req.target, &authorized.allowed_roots)
                    .map_err(rpc_forbidden)?
            } else {
                filesystem_roots(req.target).map_err(rpc_bad_request)?
            };
            serde_json::to_value(roots).map_err(|e| rpc_bad_request(e.to_string()))
        }
        "filesystem_list" => {
            let req: FilesystemListRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            let listing = if authorized.request.public_mode {
                filesystem_list_public(req.target, req.path, &authorized.allowed_roots)
                    .map_err(rpc_forbidden)?
            } else {
                filesystem_list(req.target, req.path).map_err(rpc_bad_request)?
            };
            serde_json::to_value(listing).map_err(|e| rpc_bad_request(e.to_string()))
        }
        "command_exists" => {
            let req: CommandAvailabilityRequest =
                parse_payload(payload).map_err(rpc_bad_request)?;
            require_optional_path_access(req.cwd.as_deref(), &req.target, authorized)?;
            serde_json::to_value(
                command_exists(req.command, req.target, req.cwd).map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "claude_slash_skills" => {
            let req: ClaudeSlashSkillsRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_path_access(&req.cwd, &ExecTarget::Native, authorized)?;
            serde_json::to_value(claude_slash_skills(req.cwd).map_err(rpc_bad_request)?)
                .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "terminal_create" => {
            let req: TerminalCreateRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            require_path_access(&req.cwd, &req.target, authorized)?;
            serde_json::to_value(
                terminal_create(
                    req.workspace_id,
                    req.cwd,
                    req.target,
                    req.cols,
                    req.rows,
                    app.clone(),
                    app.state(),
                )
                .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "terminal_write" => {
            let req: TerminalWriteRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            terminal_write(req.workspace_id, req.terminal_id, req.input, app.state())
                .map_err(rpc_bad_request)?;
            Ok(Value::Null)
        }
        "terminal_resize" => {
            let req: TerminalResizeRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            terminal_resize(
                req.workspace_id,
                req.terminal_id,
                req.cols,
                req.rows,
                app.state(),
            )
            .map_err(rpc_bad_request)?;
            Ok(Value::Null)
        }
        "terminal_close" => {
            let req: TerminalCloseRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            terminal_close(req.workspace_id, req.terminal_id, app.state())
                .map_err(rpc_bad_request)?;
            Ok(Value::Null)
        }
        "agent_start" => {
            let req: AgentStartRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            serde_json::to_value(
                agent_start(
                    crate::services::agent::AgentStartParams {
                        workspace_id: req.workspace_id,
                        session_id: req.session_id,
                        provider: req.provider,
                        command: req.command,
                        cols: req.cols,
                        rows: req.rows,
                    },
                    app.clone(),
                    app.state(),
                )
                .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "agent_send" => {
            let req: AgentSendRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            agent_send(
                req.workspace_id,
                req.session_id,
                req.input,
                req.append_newline,
                app.state(),
            )
            .map_err(rpc_bad_request)?;
            Ok(Value::Null)
        }
        "agent_stop" => {
            let req: AgentStopRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            agent_stop(req.workspace_id, req.session_id, app.state()).map_err(rpc_bad_request)?;
            Ok(Value::Null)
        }
        "agent_resize" => {
            let req: AgentResizeRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            agent_resize(
                req.workspace_id,
                req.session_id,
                req.cols,
                req.rows,
                app.state(),
            )
            .map_err(rpc_bad_request)?;
            Ok(Value::Null)
        }
        _ => Err(rpc_bad_request(format!("unsupported_command:{command}"))),
    }
}

fn require_loopback(client_addr: std::net::SocketAddr) -> Option<Response> {
    if client_addr.ip().is_loopback() {
        None
    } else {
        Some(json_error(
            StatusCode::FORBIDDEN,
            "loopback_required".to_string(),
        ))
    }
}

pub(crate) async fn system_config_handler(
    ConnectInfo(client_addr): ConnectInfo<std::net::SocketAddr>,
    AxumState(state): AxumState<HttpServerState>,
) -> Response {
    if let Some(response) = require_loopback(client_addr) {
        return response;
    }

    match admin_config(&state.app) {
        Ok(data) => json_success(serde_json::to_value(data).unwrap_or(Value::Null)),
        Err(error) => json_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

pub(crate) async fn system_config_patch_handler(
    ConnectInfo(client_addr): ConnectInfo<std::net::SocketAddr>,
    AxumState(state): AxumState<HttpServerState>,
    Json(payload): Json<Value>,
) -> Response {
    if let Some(response) = require_loopback(client_addr) {
        return response;
    }

    let req: SystemConfigPatchRequest = match parse_payload(payload) {
        Ok(req) => req,
        Err(error) => return json_error(StatusCode::BAD_REQUEST, error),
    };

    match admin_update_config(&state.app, &req.updates) {
        Ok(data) => json_success(serde_json::to_value(data).unwrap_or(Value::Null)),
        Err(error) => json_error(StatusCode::BAD_REQUEST, error),
    }
}

pub(crate) async fn system_auth_status_handler(
    ConnectInfo(client_addr): ConnectInfo<std::net::SocketAddr>,
    AxumState(state): AxumState<HttpServerState>,
) -> Response {
    if let Some(response) = require_loopback(client_addr) {
        return response;
    }

    match admin_auth_status(&state.app) {
        Ok(data) => json_success(serde_json::to_value(data).unwrap_or(Value::Null)),
        Err(error) => json_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

pub(crate) async fn system_auth_ip_blocks_handler(
    ConnectInfo(client_addr): ConnectInfo<std::net::SocketAddr>,
    AxumState(state): AxumState<HttpServerState>,
) -> Response {
    if let Some(response) = require_loopback(client_addr) {
        return response;
    }

    match admin_blocked_ips(&state.app) {
        Ok(data) => json_success(serde_json::to_value(data).unwrap_or(Value::Null)),
        Err(error) => json_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

pub(crate) async fn system_auth_ip_unblock_handler(
    ConnectInfo(client_addr): ConnectInfo<std::net::SocketAddr>,
    AxumState(state): AxumState<HttpServerState>,
    Json(payload): Json<Value>,
) -> Response {
    if let Some(response) = require_loopback(client_addr) {
        return response;
    }

    let req: SystemAuthIpUnblockRequest = match parse_payload(payload) {
        Ok(req) => req,
        Err(error) => return json_error(StatusCode::BAD_REQUEST, error),
    };

    match admin_unblock_ip(&state.app, req.ip.as_deref(), req.all.unwrap_or(false)) {
        Ok(data) => json_success(serde_json::to_value(data).unwrap_or(Value::Null)),
        Err(error) => json_error(StatusCode::BAD_REQUEST, error),
    }
}

pub(crate) async fn auth_status_handler(
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    ConnectInfo(client_addr): ConnectInfo<std::net::SocketAddr>,
    AxumState(state): AxumState<HttpServerState>,
) -> Response {
    match auth_status(
        &state.app,
        &headers,
        client_addr,
        request_forces_public_mode(&uri),
    ) {
        Ok(data) => json_success(serde_json::to_value(data).unwrap_or(Value::Null)),
        Err(error) => error.into_response(&RequestContext {
            ip: client_addr.ip().to_string(),
            user_agent: String::new(),
            is_local_host: client_addr.ip().is_loopback(),
            is_secure_transport: false,
            public_mode: true,
        }),
    }
}

pub(crate) async fn auth_login_handler(
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    ConnectInfo(client_addr): ConnectInfo<std::net::SocketAddr>,
    AxumState(state): AxumState<HttpServerState>,
    Json(payload): Json<Value>,
) -> Response {
    let req: LoginRequest = match parse_payload(payload) {
        Ok(req) => req,
        Err(error) => return json_error(StatusCode::BAD_REQUEST, error),
    };
    match auth_login(
        &state.app,
        &headers,
        client_addr,
        request_forces_public_mode(&uri),
        &req.password,
    ) {
        Ok((data, cookie)) => {
            json_success_with_cookie(serde_json::to_value(data).unwrap_or(Value::Null), &cookie)
        }
        Err(error) => error.into_response(&RequestContext {
            ip: client_addr.ip().to_string(),
            user_agent: String::new(),
            is_local_host: client_addr.ip().is_loopback(),
            is_secure_transport: false,
            public_mode: true,
        }),
    }
}

pub(crate) async fn auth_logout_handler(
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    ConnectInfo(client_addr): ConnectInfo<std::net::SocketAddr>,
    AxumState(state): AxumState<HttpServerState>,
) -> Response {
    match auth_logout(
        &state.app,
        &headers,
        client_addr,
        request_forces_public_mode(&uri),
    ) {
        Ok((data, cookie)) => {
            json_success_with_cookie(serde_json::to_value(data).unwrap_or(Value::Null), &cookie)
        }
        Err(error) => error.into_response(&RequestContext {
            ip: client_addr.ip().to_string(),
            user_agent: String::new(),
            is_local_host: client_addr.ip().is_loopback(),
            is_secure_transport: false,
            public_mode: true,
        }),
    }
}

pub(crate) async fn auth_lock_handler(
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    ConnectInfo(client_addr): ConnectInfo<std::net::SocketAddr>,
    AxumState(state): AxumState<HttpServerState>,
) -> Response {
    match auth_lock(
        &state.app,
        &headers,
        client_addr,
        request_forces_public_mode(&uri),
    ) {
        Ok((data, cookie)) => {
            json_success_with_cookie(serde_json::to_value(data).unwrap_or(Value::Null), &cookie)
        }
        Err(error) => error.into_response(&RequestContext {
            ip: client_addr.ip().to_string(),
            user_agent: String::new(),
            is_local_host: client_addr.ip().is_loopback(),
            is_secure_transport: false,
            public_mode: true,
        }),
    }
}

pub(crate) async fn rpc_handler(
    AxumPath(command): AxumPath<String>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    ConnectInfo(client_addr): ConnectInfo<std::net::SocketAddr>,
    AxumState(state): AxumState<HttpServerState>,
    Json(payload): Json<Value>,
) -> Response {
    let authorized = match require_session(
        &state.app,
        &headers,
        client_addr,
        request_forces_public_mode(&uri),
    ) {
        Ok(authorized) => authorized,
        Err(error) => {
            return error.into_response(&RequestContext {
                ip: client_addr.ip().to_string(),
                user_agent: String::new(),
                is_local_host: client_addr.ip().is_loopback(),
                is_secure_transport: false,
                public_mode: true,
            })
        }
    };

    match dispatch_rpc(&state.app, &command, payload, &authorized) {
        Ok(data) => json_success(data),
        Err(error) => json_error(error.status, error.error),
    }
}

pub(crate) async fn health_handler() -> impl IntoResponse {
    Json(json!({
        "ok": true,
        "product": "coder-studio",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

pub(crate) struct TransportServer {
    pub endpoint: String,
    pub listener: tokio::net::TcpListener,
    pub router: Router,
}

pub(crate) fn frontend_dist_dir() -> PathBuf {
    if let Ok(path) = std::env::var("CODER_STUDIO_DIST_DIR") {
        return PathBuf::from(path);
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            let sibling_dist = exe_dir.join("../dist");
            if sibling_dist.exists() {
                return sibling_dist;
            }

            let local_dist = exe_dir.join("dist");
            if local_dist.exists() {
                return local_dist;
            }
        }
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist")
}

pub(crate) fn frontend_assets_dir() -> PathBuf {
    frontend_dist_dir().join("assets")
}

pub(crate) async fn spa_shell_handler() -> impl IntoResponse {
    let index_file = frontend_dist_dir().join("index.html");
    let html = std::fs::read_to_string(index_file).unwrap_or_else(|_| {
        r#"<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Coder Studio</title></head><body><div id="root"></div></body></html>"#.to_string()
    });
    Html(html)
}

pub(crate) async fn shutdown_handler(
    ConnectInfo(client_addr): ConnectInfo<std::net::SocketAddr>,
    AxumState(state): AxumState<HttpServerState>,
) -> Response {
    if !client_addr.ip().is_loopback() {
        return json_error(
            StatusCode::FORBIDDEN,
            "shutdown_requires_loopback".to_string(),
        );
    }

    let app = state.app.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        app.exit(0);
    });

    json_success(json!({ "ok": true }))
}

pub(crate) fn build_transport_router(app: &AppHandle) -> Router {
    let shared = HttpServerState { app: app.clone() };
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);
    let api_router = Router::new()
        .route("/ws", get(ws_handler))
        .route("/health", get(health_handler))
        .route("/api/system/shutdown", post(shutdown_handler))
        .route(
            "/api/system/config",
            get(system_config_handler).patch(system_config_patch_handler),
        )
        .route("/api/system/auth/status", get(system_auth_status_handler))
        .route(
            "/api/system/auth/ip-blocks",
            get(system_auth_ip_blocks_handler),
        )
        .route(
            "/api/system/auth/ip-blocks/unblock",
            post(system_auth_ip_unblock_handler),
        )
        .route("/api/auth/status", get(auth_status_handler))
        .route("/api/auth/login", post(auth_login_handler))
        .route("/api/auth/logout", post(auth_logout_handler))
        .route("/api/auth/lock", post(auth_lock_handler))
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

pub(crate) fn start_transport_server(app: &AppHandle) -> Result<TransportServer, String> {
    let (bind_host, bind_port) = if cfg!(debug_assertions) {
        ("127.0.0.1".to_string(), DEV_BACKEND_PORT)
    } else {
        transport_bind_config(app)?
    };
    let listener =
        std::net::TcpListener::bind((bind_host.as_str(), bind_port)).map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let address = listener.local_addr().map_err(|e| e.to_string())?;
    let endpoint = format!("http://{}:{}", bind_host, address.port());
    {
        let state: State<AppState> = app.state();
        let mut guard = state.http_endpoint.lock().map_err(|e| e.to_string())?;
        *guard = Some(endpoint.clone());
    }
    let router = build_transport_router(app);
    let listener = tokio::net::TcpListener::from_std(listener).map_err(|e| e.to_string())?;
    Ok(TransportServer {
        endpoint,
        listener,
        router,
    })
}
