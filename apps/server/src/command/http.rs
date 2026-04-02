use crate::infra::db::{
    load_workspace_controller_lease_from_conn, save_workspace_controller_lease_to_conn,
    with_db_mapped, workspace_access_context_from_conn,
};
use crate::services::workspace_runtime::{
    emit_workspace_controller_change, reconcile_workspace_controller_lease,
    validate_workspace_controller_mutation,
};
use crate::ws::server::ws_handler;
use crate::*;

#[derive(Deserialize)]
struct LaunchWorkspaceRequest {
    source: WorkspaceSource,
    device_id: Option<String>,
    client_id: Option<String>,
}

#[derive(Deserialize)]
struct WorkspaceIdRequest {
    workspace_id: String,
}

#[derive(Deserialize)]
struct ScopedWorkspaceIdRequest {
    workspace_id: String,
    device_id: Option<String>,
    client_id: Option<String>,
}

#[derive(Deserialize)]
struct WorkbenchBootstrapRequest {
    device_id: Option<String>,
    client_id: Option<String>,
}

#[derive(Deserialize)]
struct WorkspaceControllerRequest {
    workspace_id: String,
    device_id: String,
    client_id: String,
}

#[derive(Deserialize)]
struct WorkspaceControllerMutationRequest {
    workspace_id: String,
    device_id: String,
    client_id: String,
    fencing_token: i64,
}

#[derive(Deserialize)]
struct SessionCreateRequest {
    #[serde(flatten)]
    controller: WorkspaceControllerMutationRequest,
    mode: SessionMode,
    provider: AgentProvider,
}

#[derive(Deserialize)]
struct SessionUpdateRequest {
    #[serde(flatten)]
    controller: WorkspaceControllerMutationRequest,
    session_id: u64,
    patch: SessionPatch,
}

#[derive(Deserialize)]
struct SwitchSessionRequest {
    #[serde(flatten)]
    controller: WorkspaceControllerMutationRequest,
    session_id: u64,
}

#[derive(Deserialize)]
struct ArchiveSessionRequest {
    #[serde(flatten)]
    controller: WorkspaceControllerMutationRequest,
    session_id: u64,
}

#[derive(Deserialize)]
struct SessionHistoryMutationRequest {
    workspace_id: String,
    session_id: u64,
    device_id: Option<String>,
    client_id: Option<String>,
    fencing_token: Option<i64>,
}

#[derive(Deserialize)]
struct IdlePolicyRequest {
    #[serde(flatten)]
    controller: WorkspaceControllerMutationRequest,
    policy: IdlePolicy,
}

#[derive(Deserialize)]
struct WorkspaceViewRequest {
    #[serde(flatten)]
    controller: WorkspaceControllerMutationRequest,
    patch: WorkspaceViewPatch,
}

#[derive(Deserialize)]
struct WorkbenchLayoutRequest {
    layout: WorkbenchLayout,
    device_id: Option<String>,
    client_id: Option<String>,
}

#[derive(Deserialize)]
struct AppSettingsUpdateRequest {
    settings: Value,
}

#[derive(Deserialize)]
struct PathTargetRequest {
    path: String,
    target: ExecTarget,
}

#[derive(Deserialize)]
struct WorkspacePathControllerMutationRequest {
    #[serde(flatten)]
    controller: WorkspaceControllerMutationRequest,
    path: String,
    target: ExecTarget,
}

#[derive(Deserialize)]
struct WorkspaceGitFileMutationRequest {
    #[serde(flatten)]
    mutation: WorkspacePathControllerMutationRequest,
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
struct WorkspaceGitDiscardFileMutationRequest {
    #[serde(flatten)]
    mutation: WorkspacePathControllerMutationRequest,
    file_path: String,
    section: Option<String>,
}

#[derive(Deserialize)]
struct WorkspaceGitCommitMutationRequest {
    #[serde(flatten)]
    mutation: WorkspacePathControllerMutationRequest,
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
struct WorkspaceFileSaveRequest {
    #[serde(flatten)]
    controller: WorkspaceControllerMutationRequest,
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
struct ClaudeSlashSkillsRequest {
    cwd: String,
}

#[derive(Deserialize)]
struct TerminalCreateRequest {
    #[serde(flatten)]
    controller: WorkspaceControllerMutationRequest,
    cwd: String,
    target: ExecTarget,
    cols: Option<u16>,
    rows: Option<u16>,
}

#[derive(Deserialize)]
struct TerminalWriteRequest {
    #[serde(flatten)]
    controller: WorkspaceControllerMutationRequest,
    terminal_id: u64,
    input: String,
}

#[derive(Deserialize)]
struct TerminalResizeRequest {
    #[serde(flatten)]
    controller: WorkspaceControllerMutationRequest,
    terminal_id: u64,
    cols: u16,
    rows: u16,
}

#[derive(Deserialize)]
struct TerminalCloseRequest {
    #[serde(flatten)]
    controller: WorkspaceControllerMutationRequest,
    terminal_id: u64,
}

#[derive(Deserialize)]
struct SessionRuntimeStartRequest {
    #[serde(flatten)]
    controller: WorkspaceControllerMutationRequest,
    session_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentStartRequest {
    #[serde(flatten)]
    controller: WorkspaceControllerMutationRequest,
    session_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
}

#[derive(Deserialize)]
struct AgentSendRequest {
    #[serde(flatten)]
    controller: WorkspaceControllerMutationRequest,
    session_id: String,
    input: String,
    append_newline: Option<bool>,
}

#[derive(Deserialize)]
struct AgentStopRequest {
    #[serde(flatten)]
    controller: WorkspaceControllerMutationRequest,
    session_id: String,
}

#[derive(Deserialize)]
struct AgentResizeRequest {
    #[serde(flatten)]
    controller: WorkspaceControllerMutationRequest,
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

#[derive(Debug)]
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
    require_workspace_context(app, workspace_id, None, authorized, |_, _| Ok(()))
}

fn require_workspace_context<F>(
    app: &AppHandle,
    workspace_id: &str,
    controller: Option<(&str, &str, i64)>,
    authorized: &AuthorizedRequest,
    extra_check: F,
) -> Result<(String, ExecTarget), RpcError>
where
    F: FnOnce(&str, &ExecTarget) -> Result<(), RpcError>,
{
    let mut changed_lease = None;
    let context = with_db_mapped(app.state(), rpc_bad_request, |conn| {
        let context =
            workspace_access_context_from_conn(conn, workspace_id).map_err(rpc_bad_request)?;
        require_path_access(&context.0, &context.1, authorized)?;
        extra_check(&context.0, &context.1)?;

        if let Some((device_id, client_id, fencing_token)) = controller {
            let now = now_ts();
            let mut lease = load_workspace_controller_lease_from_conn(conn, workspace_id)
                .map_err(rpc_bad_request)?;
            let before = lease.clone();
            reconcile_workspace_controller_lease(&mut lease, now);

            if lease != before {
                save_workspace_controller_lease_to_conn(conn, &lease).map_err(rpc_bad_request)?;
                changed_lease = Some(lease.clone());
            }

            validate_workspace_controller_mutation(
                &lease,
                device_id,
                client_id,
                fencing_token,
                now,
            )
            .map_err(rpc_forbidden)?;
        }

        Ok(context)
    })?;

    if let Some(lease) = changed_lease.as_ref() {
        emit_workspace_controller_change(app, lease);
    }

    Ok(context)
}

fn require_workspace_controller_mutation(
    app: &AppHandle,
    controller: &WorkspaceControllerMutationRequest,
    authorized: &AuthorizedRequest,
) -> Result<(), RpcError> {
    require_workspace_context(
        app,
        &controller.workspace_id,
        Some((
            &controller.device_id,
            &controller.client_id,
            controller.fencing_token,
        )),
        authorized,
        |_, _| Ok(()),
    )
    .map(|_| ())?;
    Ok(())
}

fn require_optional_workspace_history_mutation(
    app: &AppHandle,
    request: &SessionHistoryMutationRequest,
    authorized: &AuthorizedRequest,
) -> Result<(), RpcError> {
    match (
        request.device_id.as_deref(),
        request.client_id.as_deref(),
        request.fencing_token,
    ) {
        (Some(device_id), Some(client_id), Some(fencing_token)) => {
            require_workspace_context(
                app,
                &request.workspace_id,
                Some((device_id, client_id, fencing_token)),
                authorized,
                |_, _| Ok(()),
            )
            .map(|_| ())?;
            Ok(())
        }
        (None, None, None) => {
            require_workspace_access(app, &request.workspace_id, authorized)?;
            Ok(())
        }
        _ => Err(rpc_bad_request(
            "incomplete_workspace_controller".to_string(),
        )),
    }
}

fn require_workspace_path_controller_mutation(
    app: &AppHandle,
    controller: &WorkspaceControllerMutationRequest,
    path: &str,
    target: &ExecTarget,
    authorized: &AuthorizedRequest,
) -> Result<(), RpcError> {
    require_workspace_context(
        app,
        &controller.workspace_id,
        Some((
            &controller.device_id,
            &controller.client_id,
            controller.fencing_token,
        )),
        authorized,
        |workspace_path, workspace_target| {
            if *workspace_target != *target {
                return Err(rpc_bad_request("workspace_path_mismatch".to_string()));
            }

            let normalized_path =
                normalize_path_for_target(path, target).map_err(rpc_bad_request)?;
            let normalized_workspace = normalize_path_for_target(workspace_path, workspace_target)
                .map_err(rpc_bad_request)?;
            if !path_within_root(&normalized_path, &normalized_workspace, target) {
                return Err(rpc_bad_request("workspace_path_mismatch".to_string()));
            }

            Ok(())
        },
    )
    .map(|_| ())?;
    Ok(())
}

fn require_workspace_native_file_mutation(
    app: &AppHandle,
    controller: &WorkspaceControllerMutationRequest,
    path: &str,
    authorized: &AuthorizedRequest,
) -> Result<(), RpcError> {
    require_workspace_path_controller_mutation(
        app,
        controller,
        path,
        &ExecTarget::Native,
        authorized,
    )
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

fn filter_session_history_for_public_mode(
    app: &AppHandle,
    records: Vec<SessionHistoryRecord>,
    authorized: &AuthorizedRequest,
) -> Vec<SessionHistoryRecord> {
    if !authorized.request.public_mode {
        return records;
    }

    records
        .into_iter()
        .filter(|record| {
            workspace_access_context(app.state(), &record.workspace_id)
                .and_then(|(path, target)| {
                    ensure_path_allowed(&path, &target, &authorized.allowed_roots)
                        .map_err(|e| e.to_string())
                })
                .is_ok()
        })
        .collect()
}

fn dispatch_rpc(
    app: &AppHandle,
    command: &str,
    payload: Value,
    authorized: &AuthorizedRequest,
) -> Result<Value, RpcError> {
    match command {
        "app_settings_get" => {
            serde_json::to_value(app_settings_get(app.state()).map_err(rpc_bad_request)?)
                .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "app_settings_update" => {
            let req: AppSettingsUpdateRequest =
                serde_json::from_value(payload).map_err(|e| rpc_bad_request(e.to_string()))?;
            serde_json::to_value(
                app_settings_update(req.settings, app.state()).map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
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
                    launch_workspace_internal_scoped(
                        req.source,
                        clone_root,
                        req.device_id.as_deref(),
                        req.client_id.as_deref(),
                        app.state(),
                    )
                    .map_err(rpc_bad_request)?,
                )
                .map_err(|e| rpc_bad_request(e.to_string()))
            } else {
                serde_json::to_value(
                    launch_workspace_scoped(
                        req.source,
                        req.device_id.as_deref(),
                        req.client_id.as_deref(),
                        app.state(),
                    )
                    .map_err(rpc_bad_request)?,
                )
                .map_err(|e| rpc_bad_request(e.to_string()))
            }
        }
        "workbench_bootstrap" => {
            let req: WorkbenchBootstrapRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            let bootstrap = workbench_bootstrap_scoped(
                req.device_id.as_deref(),
                req.client_id.as_deref(),
                app.state(),
            )
            .map_err(rpc_bad_request)?;
            serde_json::to_value(filter_bootstrap_for_public_mode(bootstrap, authorized))
                .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "list_session_history" => serde_json::to_value(filter_session_history_for_public_mode(
            app,
            list_session_history(app.state()).map_err(rpc_bad_request)?,
            authorized,
        ))
        .map_err(|e| rpc_bad_request(e.to_string())),
        "workspace_snapshot" => {
            let req: WorkspaceIdRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            serde_json::to_value(
                workspace_snapshot(req.workspace_id.clone(), app.state())
                    .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "workspace_runtime_attach" => {
            let req: WorkspaceControllerRequest =
                parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            serde_json::to_value(
                workspace_runtime_attach(
                    req.workspace_id,
                    req.device_id,
                    req.client_id,
                    app.clone(),
                    app.state(),
                )
                .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "workspace_controller_heartbeat" => {
            let req: WorkspaceControllerRequest =
                parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            serde_json::to_value(
                workspace_controller_heartbeat(
                    req.workspace_id,
                    req.device_id,
                    req.client_id,
                    app.clone(),
                    app.state(),
                )
                .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "workspace_controller_takeover" => {
            let req: WorkspaceControllerRequest =
                parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            serde_json::to_value(
                workspace_controller_takeover(
                    req.workspace_id,
                    req.device_id,
                    req.client_id,
                    app.clone(),
                    app.state(),
                )
                .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "workspace_controller_reject_takeover" => {
            let req: WorkspaceControllerRequest =
                parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            serde_json::to_value(
                workspace_controller_reject_takeover(
                    req.workspace_id,
                    req.device_id,
                    req.client_id,
                    app.clone(),
                    app.state(),
                )
                .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "workspace_controller_release" => {
            let req: WorkspaceControllerMutationRequest =
                parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            serde_json::to_value(
                release_workspace_controller_for_client(
                    req.workspace_id,
                    req.device_id,
                    req.client_id,
                    req.fencing_token,
                    app.clone(),
                    app.state(),
                )
                .map_err(rpc_forbidden)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "activate_workspace" => {
            let req: ScopedWorkspaceIdRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_access(app, &req.workspace_id, authorized)?;
            serde_json::to_value(
                activate_workspace_scoped(
                    req.workspace_id,
                    req.device_id.as_deref(),
                    req.client_id.as_deref(),
                    app.state(),
                )
                .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "close_workspace" => {
            let req: WorkspaceControllerMutationRequest =
                parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_controller_mutation(app, &req, authorized)?;
            serde_json::to_value(
                close_workspace_scoped(
                    req.workspace_id,
                    Some(req.device_id.as_str()),
                    Some(req.client_id.as_str()),
                    app.state(),
                )
                .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "update_workbench_layout" => {
            let req: WorkbenchLayoutRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            serde_json::to_value(
                update_workbench_layout_scoped(
                    req.layout,
                    req.device_id.as_deref(),
                    req.client_id.as_deref(),
                    app.state(),
                )
                .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "workspace_view_update" => {
            let req: WorkspaceViewRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_controller_mutation(app, &req.controller, authorized)?;
            serde_json::to_value(
                workspace_view_update(req.controller.workspace_id, req.patch, app.state())
                    .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "create_session" => {
            let req: SessionCreateRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_controller_mutation(app, &req.controller, authorized)?;
            serde_json::to_value(
                create_session(
                    req.controller.workspace_id,
                    req.mode,
                    req.provider,
                    app.state(),
                )
                .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "session_update" => {
            let req: SessionUpdateRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_controller_mutation(app, &req.controller, authorized)?;
            serde_json::to_value(
                session_update(
                    req.controller.workspace_id,
                    req.session_id,
                    req.patch,
                    app.state(),
                )
                .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "switch_session" => {
            let req: SwitchSessionRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_controller_mutation(app, &req.controller, authorized)?;
            serde_json::to_value(
                switch_session(req.controller.workspace_id, req.session_id, app.state())
                    .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "archive_session" => {
            let req: ArchiveSessionRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_controller_mutation(app, &req.controller, authorized)?;
            serde_json::to_value(
                archive_session(req.controller.workspace_id, req.session_id, app.state())
                    .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "restore_session" => {
            let req: SessionHistoryMutationRequest =
                parse_payload(payload).map_err(rpc_bad_request)?;
            require_optional_workspace_history_mutation(app, &req, authorized)?;
            serde_json::to_value(
                restore_session(req.workspace_id, req.session_id, app.state())
                    .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))
        }
        "delete_session" => {
            let req: SessionHistoryMutationRequest =
                parse_payload(payload).map_err(rpc_bad_request)?;
            require_optional_workspace_history_mutation(app, &req, authorized)?;
            delete_session(req.workspace_id, req.session_id, app.state())
                .map_err(rpc_bad_request)?;
            Ok(Value::Null)
        }
        "update_idle_policy" => {
            let req: IdlePolicyRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_controller_mutation(app, &req.controller, authorized)?;
            update_idle_policy(req.controller.workspace_id, req.policy, app.state())
                .map_err(rpc_bad_request)?;
            Ok(Value::Null)
        }
        "git_status" => {
            let req: PathTargetRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_path_access(&req.path, &req.target, authorized)?;
            let suppressed = begin_workspace_watch_suppression(app.state(), &req.path, &req.target);
            let result = git_status_cached(req.path, req.target, &app.state().artifact_caches)
                .map_err(rpc_bad_request);
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
            let result = git_changes_cached(req.path, req.target, &app.state().artifact_caches)
                .map_err(rpc_bad_request);
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
            let req: WorkspacePathControllerMutationRequest =
                parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_path_controller_mutation(
                app,
                &req.controller,
                &req.path,
                &req.target,
                authorized,
            )?;
            git_stage_all(req.path.clone(), req.target.clone()).map_err(rpc_bad_request)?;
            invalidate_git_artifact_caches(&app.state().artifact_caches, &req.path, &req.target);
            invalidate_workspace_tree_cache(&app.state().artifact_caches, &req.path, &req.target);
            emit_workspace_artifacts_dirty(app, &req.path, &req.target, "git_stage_all");
            Ok(Value::Null)
        }
        "git_stage_file" => {
            let req: WorkspaceGitFileMutationRequest =
                parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_path_controller_mutation(
                app,
                &req.mutation.controller,
                &req.mutation.path,
                &req.mutation.target,
                authorized,
            )?;
            git_stage_file(
                req.mutation.path.clone(),
                req.mutation.target.clone(),
                req.file_path,
            )
            .map_err(rpc_bad_request)?;
            invalidate_git_artifact_caches(
                &app.state().artifact_caches,
                &req.mutation.path,
                &req.mutation.target,
            );
            invalidate_workspace_tree_cache(
                &app.state().artifact_caches,
                &req.mutation.path,
                &req.mutation.target,
            );
            emit_workspace_artifacts_dirty(
                app,
                &req.mutation.path,
                &req.mutation.target,
                "git_stage_file",
            );
            Ok(Value::Null)
        }
        "git_unstage_all" => {
            let req: WorkspacePathControllerMutationRequest =
                parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_path_controller_mutation(
                app,
                &req.controller,
                &req.path,
                &req.target,
                authorized,
            )?;
            git_unstage_all(req.path.clone(), req.target.clone()).map_err(rpc_bad_request)?;
            invalidate_git_artifact_caches(&app.state().artifact_caches, &req.path, &req.target);
            invalidate_workspace_tree_cache(&app.state().artifact_caches, &req.path, &req.target);
            emit_workspace_artifacts_dirty(app, &req.path, &req.target, "git_unstage_all");
            Ok(Value::Null)
        }
        "git_unstage_file" => {
            let req: WorkspaceGitFileMutationRequest =
                parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_path_controller_mutation(
                app,
                &req.mutation.controller,
                &req.mutation.path,
                &req.mutation.target,
                authorized,
            )?;
            git_unstage_file(
                req.mutation.path.clone(),
                req.mutation.target.clone(),
                req.file_path,
            )
            .map_err(rpc_bad_request)?;
            invalidate_git_artifact_caches(
                &app.state().artifact_caches,
                &req.mutation.path,
                &req.mutation.target,
            );
            invalidate_workspace_tree_cache(
                &app.state().artifact_caches,
                &req.mutation.path,
                &req.mutation.target,
            );
            emit_workspace_artifacts_dirty(
                app,
                &req.mutation.path,
                &req.mutation.target,
                "git_unstage_file",
            );
            Ok(Value::Null)
        }
        "git_discard_all" => {
            let req: WorkspacePathControllerMutationRequest =
                parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_path_controller_mutation(
                app,
                &req.controller,
                &req.path,
                &req.target,
                authorized,
            )?;
            git_discard_all(req.path.clone(), req.target.clone()).map_err(rpc_bad_request)?;
            invalidate_git_artifact_caches(&app.state().artifact_caches, &req.path, &req.target);
            invalidate_workspace_tree_cache(&app.state().artifact_caches, &req.path, &req.target);
            emit_workspace_artifacts_dirty(app, &req.path, &req.target, "git_discard_all");
            Ok(Value::Null)
        }
        "git_discard_file" => {
            let req: WorkspaceGitDiscardFileMutationRequest =
                parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_path_controller_mutation(
                app,
                &req.mutation.controller,
                &req.mutation.path,
                &req.mutation.target,
                authorized,
            )?;
            git_discard_file(
                req.mutation.path.clone(),
                req.mutation.target.clone(),
                req.file_path,
                req.section,
            )
            .map_err(rpc_bad_request)?;
            invalidate_git_artifact_caches(
                &app.state().artifact_caches,
                &req.mutation.path,
                &req.mutation.target,
            );
            invalidate_workspace_tree_cache(
                &app.state().artifact_caches,
                &req.mutation.path,
                &req.mutation.target,
            );
            emit_workspace_artifacts_dirty(
                app,
                &req.mutation.path,
                &req.mutation.target,
                "git_discard_file",
            );
            Ok(Value::Null)
        }
        "git_commit" => {
            let req: WorkspaceGitCommitMutationRequest =
                parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_path_controller_mutation(
                app,
                &req.mutation.controller,
                &req.mutation.path,
                &req.mutation.target,
                authorized,
            )?;
            let result = serde_json::to_value(
                git_commit(
                    req.mutation.path.clone(),
                    req.mutation.target.clone(),
                    req.message,
                )
                .map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))?;
            invalidate_git_artifact_caches(
                &app.state().artifact_caches,
                &req.mutation.path,
                &req.mutation.target,
            );
            invalidate_workspace_tree_cache(
                &app.state().artifact_caches,
                &req.mutation.path,
                &req.mutation.target,
            );
            emit_workspace_artifacts_dirty(
                app,
                &req.mutation.path,
                &req.mutation.target,
                "git_commit",
            );
            Ok(result)
        }
        "worktree_list" => {
            let req: PathTargetRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_path_access(&req.path, &req.target, authorized)?;
            let suppressed = begin_workspace_watch_suppression(app.state(), &req.path, &req.target);
            let worktrees =
                worktree_list_cached(req.path, req.target.clone(), &app.state().artifact_caches)
                    .map_err(rpc_bad_request);
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
            let result = workspace_tree_cached(
                req.path,
                req.target,
                Some(req.depth),
                &app.state().artifact_caches,
            )
            .map_err(rpc_bad_request);
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
            let req: WorkspaceFileSaveRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_native_file_mutation(app, &req.controller, &req.path, authorized)?;
            let saved = serde_json::to_value(
                file_save(req.path.clone(), req.content).map_err(rpc_bad_request)?,
            )
            .map_err(|e| rpc_bad_request(e.to_string()))?;
            invalidate_git_artifact_caches(
                &app.state().artifact_caches,
                &req.path,
                &ExecTarget::Native,
            );
            invalidate_workspace_tree_cache(
                &app.state().artifact_caches,
                &req.path,
                &ExecTarget::Native,
            );
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
            require_workspace_path_controller_mutation(
                app,
                &req.controller,
                &req.cwd,
                &req.target,
                authorized,
            )?;
            serde_json::to_value(
                terminal_create(
                    req.controller.workspace_id,
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
        "session_runtime_start" => {
            let req: SessionRuntimeStartRequest =
                parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_controller_mutation(app, &req.controller, authorized)?;
            serde_json::to_value(
                session_runtime_start(
                    SessionRuntimeStartParams {
                        workspace_id: req.controller.workspace_id,
                        session_id: req.session_id,
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
        "terminal_write" => {
            let req: TerminalWriteRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_controller_mutation(app, &req.controller, authorized)?;
            terminal_write(
                req.controller.workspace_id,
                req.terminal_id,
                req.input,
                app.state(),
            )
            .map_err(rpc_bad_request)?;
            Ok(Value::Null)
        }
        "terminal_resize" => {
            let req: TerminalResizeRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_controller_mutation(app, &req.controller, authorized)?;
            terminal_resize(
                req.controller.workspace_id,
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
            require_workspace_controller_mutation(app, &req.controller, authorized)?;
            terminal_close(req.controller.workspace_id, req.terminal_id, app.state())
                .map_err(rpc_bad_request)?;
            Ok(Value::Null)
        }
        "agent_start" => {
            let req: AgentStartRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_controller_mutation(app, &req.controller, authorized)?;
            serde_json::to_value(
                agent_start(
                    crate::services::agent::AgentStartParams {
                        workspace_id: req.controller.workspace_id,
                        session_id: req.session_id,
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
            require_workspace_controller_mutation(app, &req.controller, authorized)?;
            agent_send(
                req.controller.workspace_id,
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
            require_workspace_controller_mutation(app, &req.controller, authorized)?;
            agent_stop(req.controller.workspace_id, req.session_id, app.state())
                .map_err(rpc_bad_request)?;
            Ok(Value::Null)
        }
        "agent_resize" => {
            let req: AgentResizeRequest = parse_payload(payload).map_err(rpc_bad_request)?;
            require_workspace_controller_mutation(app, &req.controller, authorized)?;
            agent_resize(
                req.controller.workspace_id,
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
    let dev_backend_port = std::env::var("CODER_STUDIO_DEV_BACKEND_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEV_BACKEND_PORT);
    let (bind_host, bind_port) = if cfg!(debug_assertions) {
        ("127.0.0.1".to_string(), dev_backend_port)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::RuntimeHandle;
    use std::sync::OnceLock;
    use std::time::Duration;

    fn with_db_count_test_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn lock_with_db_count_tests() -> std::sync::MutexGuard<'static, ()> {
        with_db_count_test_lock()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }

    fn test_app() -> AppHandle {
        let (app, _shutdown_rx) = RuntimeHandle::new();
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        *app.state().db.lock().unwrap() = Some(conn);
        app
    }

    fn claude_profile(settings: &AppSettingsPayload) -> ClaudeRuntimeProfile {
        settings.provider_profile("claude").unwrap_or_default()
    }

    fn codex_profile(settings: &AppSettingsPayload) -> CodexRuntimeProfile {
        settings.provider_profile("codex").unwrap_or_default()
    }

    fn authorized_request() -> AuthorizedRequest {
        AuthorizedRequest {
            request: RequestContext {
                ip: "127.0.0.1".to_string(),
                user_agent: String::new(),
                is_local_host: true,
                is_secure_transport: false,
                public_mode: false,
            },
            allowed_roots: Vec::new(),
        }
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

    fn create_temp_workspace_root(name: &str) -> String {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("coder-studio-{name}-{unique}"));
        std::fs::create_dir_all(&root).unwrap();
        root.to_string_lossy().to_string()
    }

    fn attach_controller(
        app: &AppHandle,
        authorized: &AuthorizedRequest,
        workspace_id: &str,
    ) -> WorkspaceRuntimeSnapshot {
        let value = dispatch_rpc(
            app,
            "workspace_runtime_attach",
            json!({
                "workspace_id": workspace_id,
                "device_id": "device-a",
                "client_id": "client-a",
            }),
            authorized,
        )
        .unwrap();

        serde_json::from_value(value).unwrap()
    }

    fn test_agent_launch_profile() -> (String, Vec<String>) {
        #[cfg(target_os = "windows")]
        {
            (
                "cmd".to_string(),
                vec![
                    "/D".to_string(),
                    "/S".to_string(),
                    "/C".to_string(),
                    "echo %TEST_MARKER%".to_string(),
                ],
            )
        }
        #[cfg(not(target_os = "windows"))]
        {
            (
                "sh".to_string(),
                vec!["-lc".to_string(), "printf %s \"$TEST_MARKER\"".to_string()],
            )
        }
    }

    fn test_agent_marker_profile(marker_file: &str) -> (String, Vec<String>) {
        #[cfg(target_os = "windows")]
        {
            (
                "cmd".to_string(),
                vec![
                    "/D".to_string(),
                    "/S".to_string(),
                    "/C".to_string(),
                    format!("echo %TEST_MARKER%> {marker_file}"),
                ],
            )
        }
        #[cfg(not(target_os = "windows"))]
        {
            (
                "sh".to_string(),
                vec![
                    "-lc".to_string(),
                    format!("printf %s \"$TEST_MARKER\" > {marker_file}"),
                ],
            )
        }
    }

    #[test]
    fn dispatches_workspace_runtime_attach_command() {
        let app = test_app();
        let authorized = authorized_request();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-rpc-test");

        let value = dispatch_rpc(
            &app,
            "workspace_runtime_attach",
            json!({
                "workspace_id": workspace_id,
                "device_id": "device-a",
                "client_id": "client-a",
            }),
            &authorized,
        )
        .expect("attach rpc should be dispatched");

        let snapshot: WorkspaceRuntimeSnapshot = serde_json::from_value(value).unwrap();
        assert_eq!(
            snapshot.controller.controller_device_id.as_deref(),
            Some("device-a")
        );
        assert_eq!(
            snapshot.controller.controller_client_id.as_deref(),
            Some("client-a")
        );
    }

    #[test]
    fn require_workspace_controller_mutation_uses_single_with_db_critical_section() {
        let _guard = lock_with_db_count_tests();
        let app = test_app();
        let authorized = authorized_request();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-http-controller-guard-db-count");

        let runtime = workspace_runtime_attach(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        reset_with_db_call_count();
        require_workspace_controller_mutation(
            &app,
            &WorkspaceControllerMutationRequest {
                workspace_id,
                device_id: "device-a".to_string(),
                client_id: "client-a".to_string(),
                fencing_token: runtime.controller.fencing_token,
            },
            &authorized,
        )
        .unwrap();

        assert_eq!(read_with_db_call_count(), 1);
    }

    #[test]
    fn require_workspace_path_controller_mutation_uses_single_with_db_critical_section() {
        let _guard = lock_with_db_count_tests();
        let app = test_app();
        let authorized = authorized_request();
        let root = create_temp_workspace_root("http-path-guard-db-count");
        let workspace_id = launch_test_workspace(&app, &root);

        let runtime = workspace_runtime_attach(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        reset_with_db_call_count();
        require_workspace_path_controller_mutation(
            &app,
            &WorkspaceControllerMutationRequest {
                workspace_id,
                device_id: "device-a".to_string(),
                client_id: "client-a".to_string(),
                fencing_token: runtime.controller.fencing_token,
            },
            &root,
            &ExecTarget::Native,
            &authorized,
        )
        .unwrap();

        assert_eq!(read_with_db_call_count(), 1);
    }

    #[test]
    fn require_optional_workspace_history_mutation_uses_single_with_db_critical_section() {
        let _guard = lock_with_db_count_tests();
        let app = test_app();
        let authorized = authorized_request();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-http-history-guard-db-count");

        let runtime = workspace_runtime_attach(
            workspace_id.clone(),
            "device-a".to_string(),
            "client-a".to_string(),
            app.clone(),
            app.state(),
        )
        .unwrap();

        reset_with_db_call_count();
        require_optional_workspace_history_mutation(
            &app,
            &SessionHistoryMutationRequest {
                workspace_id,
                session_id: 1,
                device_id: Some("device-a".to_string()),
                client_id: Some("client-a".to_string()),
                fencing_token: Some(runtime.controller.fencing_token),
            },
            &authorized,
        )
        .unwrap();

        assert_eq!(read_with_db_call_count(), 1);
    }

    #[test]
    fn rejects_workspace_view_update_from_stale_controller() {
        let app = test_app();
        let authorized = authorized_request();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-stale-view-test");

        dispatch_rpc(
            &app,
            "workspace_runtime_attach",
            json!({
                "workspace_id": workspace_id,
                "device_id": "device-a",
                "client_id": "client-a",
            }),
            &authorized,
        )
        .unwrap();

        let error = dispatch_rpc(
            &app,
            "workspace_view_update",
            json!({
                "workspace_id": workspace_id,
                "device_id": "device-b",
                "client_id": "client-b",
                "fencing_token": 1,
                "patch": {
                    "active_session_id": "1",
                    "active_pane_id": "pane-1",
                    "active_terminal_id": "",
                    "pane_layout": {
                        "type": "leaf",
                        "id": "pane-1",
                        "session_id": "1",
                    },
                    "file_preview": {
                        "path": "",
                        "content": "",
                        "mode": "preview",
                        "original_content": "",
                        "modified_content": "",
                        "dirty": false,
                    },
                },
            }),
            &authorized,
        )
        .expect_err("observer write should be rejected");

        assert_eq!(error.status, StatusCode::FORBIDDEN);
        assert_eq!(error.error, "stale_fencing_token");
    }

    #[test]
    fn rejects_git_stage_all_from_stale_controller() {
        let app = test_app();
        let authorized = authorized_request();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-stale-git-test");

        dispatch_rpc(
            &app,
            "workspace_runtime_attach",
            json!({
                "workspace_id": workspace_id,
                "device_id": "device-a",
                "client_id": "client-a",
            }),
            &authorized,
        )
        .unwrap();

        let error = dispatch_rpc(
            &app,
            "git_stage_all",
            json!({
                "workspace_id": workspace_id,
                "path": "/tmp/ws-runtime-stale-git-test",
                "target": { "type": "native" },
                "device_id": "device-b",
                "client_id": "client-b",
                "fencing_token": 1,
            }),
            &authorized,
        )
        .expect_err("observer git mutation should be rejected");

        assert_eq!(error.status, StatusCode::FORBIDDEN);
        assert_eq!(error.error, "stale_fencing_token");
    }

    #[test]
    fn rejects_file_save_for_path_outside_workspace() {
        let app = test_app();
        let authorized = authorized_request();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-file-save-test");
        let outside_path = std::env::temp_dir()
            .join("coder-studio-controller-mismatch.txt")
            .to_string_lossy()
            .to_string();

        let attach = dispatch_rpc(
            &app,
            "workspace_runtime_attach",
            json!({
                "workspace_id": workspace_id,
                "device_id": "device-a",
                "client_id": "client-a",
            }),
            &authorized,
        )
        .unwrap();
        let runtime: WorkspaceRuntimeSnapshot = serde_json::from_value(attach).unwrap();

        let error = dispatch_rpc(
            &app,
            "file_save",
            json!({
                "workspace_id": workspace_id,
                "path": outside_path,
                "content": "hello",
                "device_id": "device-a",
                "client_id": "client-a",
                "fencing_token": runtime.controller.fencing_token,
            }),
            &authorized,
        )
        .expect_err("file save outside workspace should be rejected");

        assert_eq!(error.status, StatusCode::BAD_REQUEST);
        assert_eq!(error.error, "workspace_path_mismatch");
    }

    #[test]
    fn rejects_terminal_create_for_cwd_outside_workspace() {
        let app = test_app();
        let authorized = authorized_request();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-runtime-terminal-cwd-test");
        let outside_cwd = std::env::temp_dir().to_string_lossy().to_string();

        let attach = dispatch_rpc(
            &app,
            "workspace_runtime_attach",
            json!({
                "workspace_id": workspace_id,
                "device_id": "device-a",
                "client_id": "client-a",
            }),
            &authorized,
        )
        .unwrap();
        let runtime: WorkspaceRuntimeSnapshot = serde_json::from_value(attach).unwrap();

        let error = dispatch_rpc(
            &app,
            "terminal_create",
            json!({
                "workspace_id": workspace_id,
                "device_id": "device-a",
                "client_id": "client-a",
                "fencing_token": runtime.controller.fencing_token,
                "cwd": outside_cwd,
                "target": { "type": "native" },
                "cols": 120,
                "rows": 30,
            }),
            &authorized,
        )
        .expect_err("terminal create outside workspace should be rejected");

        assert_eq!(error.status, StatusCode::BAD_REQUEST);
        assert_eq!(error.error, "workspace_path_mismatch");
    }

    #[test]
    fn workbench_bootstrap_isolates_open_workspaces_by_device() {
        let app = test_app();
        let authorized = authorized_request();

        let first = dispatch_rpc(
            &app,
            "launch_workspace",
            json!({
                "source": {
                    "kind": "local",
                    "path_or_url": "/tmp/ws-ui-scope-device-a",
                    "target": { "type": "native" },
                },
                "device_id": "device-a",
                "client_id": "client-a",
            }),
            &authorized,
        )
        .unwrap();
        let first_launch: WorkspaceLaunchResult = serde_json::from_value(first).unwrap();

        let second = dispatch_rpc(
            &app,
            "launch_workspace",
            json!({
                "source": {
                    "kind": "local",
                    "path_or_url": "/tmp/ws-ui-scope-device-b",
                    "target": { "type": "native" },
                },
                "device_id": "device-b",
                "client_id": "client-b",
            }),
            &authorized,
        )
        .unwrap();
        let second_launch: WorkspaceLaunchResult = serde_json::from_value(second).unwrap();

        let bootstrap = dispatch_rpc(
            &app,
            "workbench_bootstrap",
            json!({
                "device_id": "device-a",
                "client_id": "client-a",
            }),
            &authorized,
        )
        .unwrap();
        let scoped: WorkbenchBootstrap = serde_json::from_value(bootstrap).unwrap();

        assert_eq!(
            scoped.ui_state.open_workspace_ids,
            vec![first_launch.snapshot.workspace.workspace_id.clone()]
        );
        assert_eq!(
            scoped.ui_state.active_workspace_id.as_deref(),
            Some(first_launch.snapshot.workspace.workspace_id.as_str())
        );
        assert!(scoped
            .workspaces
            .iter()
            .all(|snapshot| snapshot.workspace.workspace_id
                != second_launch.snapshot.workspace.workspace_id));
    }

    #[test]
    fn workbench_bootstrap_scopes_active_workspace_by_client() {
        let app = test_app();
        let authorized = authorized_request();

        let first = dispatch_rpc(
            &app,
            "launch_workspace",
            json!({
                "source": {
                    "kind": "local",
                    "path_or_url": "/tmp/ws-ui-scope-client-a",
                    "target": { "type": "native" },
                },
                "device_id": "device-a",
                "client_id": "client-a",
            }),
            &authorized,
        )
        .unwrap();
        let first_launch: WorkspaceLaunchResult = serde_json::from_value(first).unwrap();

        let second = dispatch_rpc(
            &app,
            "launch_workspace",
            json!({
                "source": {
                    "kind": "local",
                    "path_or_url": "/tmp/ws-ui-scope-client-b",
                    "target": { "type": "native" },
                },
                "device_id": "device-a",
                "client_id": "client-b",
            }),
            &authorized,
        )
        .unwrap();
        let second_launch: WorkspaceLaunchResult = serde_json::from_value(second).unwrap();

        let bootstrap_a = dispatch_rpc(
            &app,
            "workbench_bootstrap",
            json!({
                "device_id": "device-a",
                "client_id": "client-a",
            }),
            &authorized,
        )
        .unwrap();
        let scoped_a: WorkbenchBootstrap = serde_json::from_value(bootstrap_a).unwrap();
        assert_eq!(
            scoped_a.ui_state.active_workspace_id.as_deref(),
            Some(first_launch.snapshot.workspace.workspace_id.as_str())
        );

        let bootstrap_b = dispatch_rpc(
            &app,
            "workbench_bootstrap",
            json!({
                "device_id": "device-a",
                "client_id": "client-b",
            }),
            &authorized,
        )
        .unwrap();
        let scoped_b: WorkbenchBootstrap = serde_json::from_value(bootstrap_b).unwrap();
        assert_eq!(
            scoped_b.ui_state.open_workspace_ids,
            vec![
                first_launch.snapshot.workspace.workspace_id.clone(),
                second_launch.snapshot.workspace.workspace_id.clone(),
            ]
        );
        assert_eq!(
            scoped_b.ui_state.active_workspace_id.as_deref(),
            Some(second_launch.snapshot.workspace.workspace_id.as_str())
        );
    }

    #[test]
    fn workbench_layout_isolated_by_device() {
        let app = test_app();
        let authorized = authorized_request();

        dispatch_rpc(
            &app,
            "update_workbench_layout",
            json!({
                "device_id": "device-a",
                "client_id": "client-a",
                "layout": {
                    "left_width": 444,
                    "right_width": 555,
                    "right_split": 70,
                    "show_code_panel": true,
                    "show_terminal_panel": true,
                },
            }),
            &authorized,
        )
        .unwrap();

        let bootstrap_a = dispatch_rpc(
            &app,
            "workbench_bootstrap",
            json!({
                "device_id": "device-a",
                "client_id": "client-a",
            }),
            &authorized,
        )
        .unwrap();
        let scoped_a: WorkbenchBootstrap = serde_json::from_value(bootstrap_a).unwrap();
        assert_eq!(scoped_a.ui_state.layout.left_width, 444.0);
        assert!(scoped_a.ui_state.layout.show_code_panel);

        let bootstrap_b = dispatch_rpc(
            &app,
            "workbench_bootstrap",
            json!({
                "device_id": "device-b",
                "client_id": "client-z",
            }),
            &authorized,
        )
        .unwrap();
        let scoped_b: WorkbenchBootstrap = serde_json::from_value(bootstrap_b).unwrap();
        assert_eq!(scoped_b.ui_state.layout.left_width, 320.0);
        assert!(!scoped_b.ui_state.layout.show_code_panel);
    }

    #[test]
    fn session_history_rpc_lists_restores_and_deletes_records() {
        let app = test_app();
        let authorized = authorized_request();
        let workspace_id = launch_test_workspace(&app, "/tmp/ws-history-rpc-test");
        let created = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            AgentProvider::claude(),
            app.state(),
        )
        .unwrap();
        archive_session(workspace_id.clone(), created.id, app.state()).unwrap();

        let history = dispatch_rpc(&app, "list_session_history", json!({}), &authorized)
            .expect("history rpc should load");
        let history: Vec<SessionHistoryRecord> = serde_json::from_value(history).unwrap();
        assert!(history
            .iter()
            .any(|record| record.workspace_id == workspace_id
                && record.session_id == created.id
                && record.archived));

        let restored = dispatch_rpc(
            &app,
            "restore_session",
            json!({
                "workspace_id": workspace_id.clone(),
                "session_id": created.id,
            }),
            &authorized,
        )
        .expect("restore rpc should succeed");
        let restored: SessionRestoreResult = serde_json::from_value(restored).unwrap();
        assert_eq!(restored.session.id, created.id);
        assert!(!restored.already_active);

        dispatch_rpc(
            &app,
            "delete_session",
            json!({
                "workspace_id": workspace_id.clone(),
                "session_id": created.id,
            }),
            &authorized,
        )
        .expect("delete rpc should succeed");

        let history = dispatch_rpc(&app, "list_session_history", json!({}), &authorized)
            .expect("history rpc should reload");
        let history: Vec<SessionHistoryRecord> = serde_json::from_value(history).unwrap();
        assert!(!history.iter().any(|record| record.session_id == created.id));
    }

    #[test]
    fn app_settings_rpc_round_trips_defaults_and_updates() {
        let app = test_app();
        let authorized = authorized_request();

        let initial = dispatch_rpc(&app, "app_settings_get", json!({}), &authorized)
            .expect("default settings should load");
        assert_eq!(
            initial["general"]["terminal_compatibility_mode"],
            "standard"
        );
        assert_eq!(
            initial["providers"]["claude"]["global"]["executable"],
            "claude"
        );
        assert!(initial.get("claude").is_none());
        assert!(initial.get("codex").is_none());

        let saved = dispatch_rpc(
            &app,
            "app_settings_update",
            json!({
                "settings": {
                    "general": {
                        "locale": "zh",
                        "terminal_compatibility_mode": "compatibility",
                        "completion_notifications": {
                            "enabled": true,
                            "only_when_background": false
                        },
                        "idle_policy": {
                            "enabled": true,
                            "idle_minutes": 12,
                            "max_active": 4,
                            "pressure": true
                        }
                    },
                    "claude": {
                        "global": {
                            "executable": "claude-nightly",
                            "startup_args": ["--dangerously-skip-permissions"],
                            "env": {
                                "ANTHROPIC_BASE_URL": "https://anthropic.example"
                            },
                            "settings_json": {
                                "model": "sonnet"
                            },
                            "global_config_json": {
                                "showTurnDuration": true
                            }
                        }
                    }
                }
            }),
            &authorized,
        )
        .expect("settings update should succeed");

        assert_eq!(saved["general"]["locale"], "zh");
        assert_eq!(
            saved["providers"]["claude"]["global"]["executable"],
            "claude-nightly"
        );
        assert_eq!(
            saved["providers"]["claude"]["global"]["env"]["ANTHROPIC_BASE_URL"],
            "https://anthropic.example"
        );
        assert!(saved.get("claude").is_none());
        assert!(saved.get("codex").is_none());
    }

    #[test]
    fn app_settings_update_merges_partial_payload_without_resetting_other_fields() {
        let app = test_app();
        let authorized = authorized_request();
        let (executable, startup_args) = test_agent_launch_profile();

        dispatch_rpc(
            &app,
            "app_settings_update",
            json!({
                "settings": {
                    "general": {
                        "locale": "zh"
                    },
                    "claude": {
                        "global": {
                            "executable": "claude-nightly",
                            "startup_args": [],
                            "env": {
                                "TEST_MARKER": "persisted-value"
                            },
                            "settings_json": {
                                "model": "opus"
                            },
                            "global_config_json": {}
                        }
                    }
                }
            }),
            &authorized,
        )
        .unwrap();

        let updated = dispatch_rpc(
            &app,
            "app_settings_update",
            json!({
                "settings": {
                    "claude": {
                        "global": {
                            "executable": executable,
                            "startup_args": startup_args
                        }
                    }
                }
            }),
            &authorized,
        )
        .expect("partial settings update should succeed");
        let updated: AppSettingsPayload = serde_json::from_value(updated).unwrap();
        let claude = claude_profile(&updated);

        assert_eq!(updated.general.locale, "zh");
        assert_eq!(
            claude.env.get("TEST_MARKER").map(String::as_str),
            Some("persisted-value")
        );
        assert_eq!(claude.settings_json["model"], "opus");
    }

    #[test]
    fn app_settings_update_normalizes_camel_case_payloads_before_merge() {
        let app = test_app();
        let authorized = authorized_request();

        dispatch_rpc(
            &app,
            "app_settings_update",
            json!({
                "settings": {
                    "general": {
                        "completion_notifications": {
                            "enabled": true,
                            "only_when_background": false
                        }
                    },
                    "claude": {
                        "global": {
                            "startup_args": ["--existing"],
                            "settings_json": {
                                "model": "opus"
                            },
                            "global_config_json": {
                                "showTurnDuration": true
                            }
                        }
                    }
                }
            }),
            &authorized,
        )
        .unwrap();

        let updated = dispatch_rpc(
            &app,
            "app_settings_update",
            json!({
                "settings": {
                    "general": {
                        "completionNotifications": {
                            "enabled": false
                        }
                    },
                    "claude": {
                        "global": {
                            "startupArgs": ["--verbose"],
                            "settingsJson": {
                                "model": "opus",
                                "permissionMode": "acceptEdits"
                            },
                            "globalConfigJson": {
                                "showTurnDuration": true,
                                "theme": "dark"
                            }
                        }
                    }
                }
            }),
            &authorized,
        )
        .expect("camelCase settings update should succeed");
        let updated: AppSettingsPayload = serde_json::from_value(updated).unwrap();
        let claude = claude_profile(&updated);

        assert!(!updated.general.completion_notifications.enabled);
        assert!(
            !updated
                .general
                .completion_notifications
                .only_when_background
        );
        assert_eq!(claude.startup_args, vec!["--verbose"]);
        assert_eq!(claude.settings_json["model"], "opus");
        assert_eq!(claude.settings_json["permissionMode"], "acceptEdits");
        assert_eq!(claude.global_config_json["theme"], "dark");
        assert_eq!(claude.global_config_json["showTurnDuration"], true);
    }

    #[test]
    fn app_settings_update_normalizes_root_agent_defaults_camel_case_key() {
        let app = test_app();
        let authorized = authorized_request();

        let updated = dispatch_rpc(
            &app,
            "app_settings_update",
            json!({
                "settings": {
                    "agentDefaults": {
                        "provider": "codex"
                    }
                }
            }),
            &authorized,
        )
        .expect("camelCase root agent defaults update should succeed");
        let updated: AppSettingsPayload = serde_json::from_value(updated).unwrap();

        assert_eq!(updated.agent_defaults.provider, AgentProvider::codex());
    }

    #[test]
    fn app_settings_update_replaces_object_fields_so_cleared_keys_stay_cleared() {
        let app = test_app();
        let authorized = authorized_request();

        dispatch_rpc(
            &app,
            "app_settings_update",
            json!({
                "settings": {
                    "claude": {
                        "global": {
                            "env": {
                                "TEST_MARKER": "persisted-value",
                                "ANTHROPIC_BASE_URL": "https://anthropic.example"
                            },
                            "settings_json": {
                                "model": "opus",
                                "permissionMode": "acceptEdits"
                            },
                            "global_config_json": {
                                "showTurnDuration": true
                            }
                        }
                    }
                }
            }),
            &authorized,
        )
        .unwrap();

        let updated = dispatch_rpc(
            &app,
            "app_settings_update",
            json!({
                "settings": {
                    "claude": {
                        "global": {
                            "env": {
                                "ANTHROPIC_BASE_URL": "https://next.example"
                            },
                            "settings_json": {
                                "permissionMode": "plan"
                            },
                            "global_config_json": {}
                        }
                    }
                }
            }),
            &authorized,
        )
        .expect("object field replacement should succeed");
        let updated: AppSettingsPayload = serde_json::from_value(updated).unwrap();
        let claude = claude_profile(&updated);

        assert_eq!(
            claude.env.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("https://next.example")
        );
        assert_eq!(claude.env.get("TEST_MARKER"), None);
        assert_eq!(
            claude.settings_json.get("permissionMode"),
            Some(&json!("plan"))
        );
        assert_eq!(claude.settings_json.get("model"), None);
        assert_eq!(
            claude
                .global_config_json
                .as_object()
                .map(|value| value.is_empty()),
            Some(true)
        );
    }

    #[test]
    fn app_settings_update_normalizes_camel_case_codex_payloads_before_merge() {
        let app = test_app();
        let authorized = authorized_request();

        let updated = dispatch_rpc(
            &app,
            "app_settings_update",
            json!({
                "settings": {
                    "codex": {
                        "global": {
                            "model": "gpt-5.4",
                            "approvalPolicy": "on-request",
                            "sandboxMode": "workspace-write",
                            "webSearch": "live",
                            "modelReasoningEffort": "high",
                            "extraArgs": ["--full-auto"]
                        }
                    }
                }
            }),
            &authorized,
        )
        .expect("camelCase codex settings update should succeed");
        let updated: AppSettingsPayload = serde_json::from_value(updated).unwrap();
        let codex = codex_profile(&updated);

        assert_eq!(codex.model, "gpt-5.4");
        assert_eq!(codex.approval_policy, "on-request");
        assert_eq!(codex.sandbox_mode, "workspace-write");
        assert_eq!(codex.web_search, "live");
        assert_eq!(codex.model_reasoning_effort, "high");
        assert_eq!(codex.extra_args, vec!["--full-auto"]);
    }

    #[test]
    fn agent_start_uses_server_resolved_settings_from_storage() {
        let app = test_app();
        let authorized = authorized_request();
        let root = create_temp_workspace_root("agent-start-settings");
        let workspace_id = launch_test_workspace(&app, &root);
        let marker_path = PathBuf::from(&root).join(".agent-start-marker");
        *app.state().hook_endpoint.lock().unwrap() = Some("http://127.0.0.1:1/claude-hook".into());

        dispatch_rpc(
            &app,
            "app_settings_update",
            json!({
                "settings": {
                    "general": {
                        "locale": "zh"
                    },
                    "claude": {
                        "global": {
                            "executable": "claude-nightly",
                            "startup_args": [],
                            "env": {
                                "TEST_MARKER": "server-resolved"
                            }
                        }
                    }
                }
            }),
            &authorized,
        )
        .unwrap();

        let (executable, startup_args) = test_agent_marker_profile(".agent-start-marker");
        dispatch_rpc(
            &app,
            "app_settings_update",
            json!({
                "settings": {
                    "claude": {
                        "global": {
                            "executable": executable,
                            "startup_args": startup_args
                        }
                    }
                }
            }),
            &authorized,
        )
        .unwrap();

        let attach = dispatch_rpc(
            &app,
            "workspace_runtime_attach",
            json!({
                "workspace_id": workspace_id,
                "device_id": "device-a",
                "client_id": "client-a",
            }),
            &authorized,
        )
        .unwrap();
        let runtime: WorkspaceRuntimeSnapshot = serde_json::from_value(attach).unwrap();
        let created = dispatch_rpc(
            &app,
            "create_session",
            json!({
                "workspace_id": workspace_id,
                "device_id": "device-a",
                "client_id": "client-a",
                "fencing_token": runtime.controller.fencing_token,
                "mode": "branch",
                "provider": "claude",
            }),
            &authorized,
        )
        .expect("create_session should succeed for marker launch test");
        let created: SessionInfo = serde_json::from_value(created).unwrap();

        let started = dispatch_rpc(
            &app,
            "agent_start",
            json!({
                "workspace_id": workspace_id,
                "device_id": "device-a",
                "client_id": "client-a",
                "fencing_token": runtime.controller.fencing_token,
                "session_id": created.id.to_string(),
                "cols": 80,
                "rows": 24,
            }),
            &authorized,
        )
        .expect("agent_start should succeed with server-resolved settings");
        let started: AgentStartResult = serde_json::from_value(started).unwrap();

        assert!(started.started);
        let mut marker_value = String::new();
        for _ in 0..100 {
            if let Ok(value) = std::fs::read_to_string(&marker_path) {
                marker_value = value;
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        assert!(
            marker_value.contains("server-resolved"),
            "expected marker file to contain server value, got: {marker_value:?}"
        );
    }

    #[test]
    fn agent_start_rejects_client_supplied_command() {
        let app = test_app();
        let authorized = authorized_request();

        let error = dispatch_rpc(
            &app,
            "agent_start",
            json!({
                "workspace_id": "ws_test",
                "device_id": "device-a",
                "client_id": "client-a",
                "fencing_token": 1,
                "session_id": "1",
                "command": "claude"
            }),
            &authorized,
        )
        .expect_err("agent_start should reject legacy command payloads");

        assert_eq!(error.status, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn agent_start_uses_session_provider_from_storage() {
        let app = test_app();
        let authorized = authorized_request();
        let root = create_temp_workspace_root("agent-start-provider");
        let workspace_id = launch_test_workspace(&app, &root);
        let marker_path = PathBuf::from(&root).join(".agent-start-provider-marker");
        *app.state().hook_endpoint.lock().unwrap() = Some("http://127.0.0.1:1/claude-hook".into());

        dispatch_rpc(
            &app,
            "app_settings_update",
            json!({
                "settings": {
                    "codex": {
                        "global": {
                            "executable": test_agent_marker_profile(".agent-start-provider-marker").0,
                            "extra_args": test_agent_marker_profile(".agent-start-provider-marker").1,
                            "env": {
                                "TEST_MARKER": "codex-provider"
                            }
                        }
                    }
                }
            }),
            &authorized,
        )
        .unwrap();

        let attach = dispatch_rpc(
            &app,
            "workspace_runtime_attach",
            json!({
                "workspace_id": workspace_id,
                "device_id": "device-a",
                "client_id": "client-a",
            }),
            &authorized,
        )
        .unwrap();
        let runtime: WorkspaceRuntimeSnapshot = serde_json::from_value(attach).unwrap();

        let created = dispatch_rpc(
            &app,
            "create_session",
            json!({
                "workspace_id": workspace_id,
                "device_id": "device-a",
                "client_id": "client-a",
                "fencing_token": runtime.controller.fencing_token,
                "mode": "branch",
                "provider": "codex",
            }),
            &authorized,
        )
        .expect("create_session should persist codex provider");
        let created: SessionInfo = serde_json::from_value(created).unwrap();
        assert_eq!(created.provider, AgentProvider::codex());

        let started = dispatch_rpc(
            &app,
            "agent_start",
            json!({
                "workspace_id": workspace_id,
                "device_id": "device-a",
                "client_id": "client-a",
                "fencing_token": runtime.controller.fencing_token,
                "session_id": created.id.to_string(),
                "cols": 80,
                "rows": 24,
            }),
            &authorized,
        )
        .expect("agent_start should read provider from stored session");
        let started: AgentStartResult = serde_json::from_value(started).unwrap();
        assert!(started.started);

        let mut marker_value = String::new();
        for _ in 0..100 {
            if let Ok(value) = std::fs::read_to_string(&marker_path) {
                marker_value = value;
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        assert_eq!(marker_value, "codex-provider");
    }

    #[test]
    fn dispatches_session_runtime_start_and_returns_terminal_id() {
        let app = test_app();
        let authorized = authorized_request();
        let root = create_temp_workspace_root("session-runtime-start");
        let workspace_id = launch_test_workspace(&app, &root);
        let marker_path = PathBuf::from(&root).join(".session-runtime-start-marker");
        *app.state().hook_endpoint.lock().unwrap() = Some("http://127.0.0.1:1/claude-hook".into());

        dispatch_rpc(
            &app,
            "app_settings_update",
            json!({
                "settings": {
                    "claude": {
                        "global": {
                            "executable": test_agent_marker_profile(".session-runtime-start-marker").0,
                            "startup_args": test_agent_marker_profile(".session-runtime-start-marker").1,
                            "env": {
                                "TEST_MARKER": "session-runtime-started"
                            }
                        }
                    }
                }
            }),
            &authorized,
        )
        .unwrap();

        let runtime = attach_controller(&app, &authorized, &workspace_id);
        let created = dispatch_rpc(
            &app,
            "create_session",
            json!({
                "workspace_id": workspace_id,
                "device_id": "device-a",
                "client_id": "client-a",
                "fencing_token": runtime.controller.fencing_token,
                "mode": "branch",
                "provider": "claude",
            }),
            &authorized,
        )
        .unwrap();
        let created: SessionInfo = serde_json::from_value(created).unwrap();

        let started = dispatch_rpc(
            &app,
            "session_runtime_start",
            json!({
                "workspace_id": workspace_id,
                "device_id": "device-a",
                "client_id": "client-a",
                "fencing_token": runtime.controller.fencing_token,
                "session_id": created.id.to_string(),
                "cols": 120,
                "rows": 30,
            }),
            &authorized,
        )
        .unwrap();
        let started: SessionRuntimeStartResult = serde_json::from_value(started).unwrap();

        assert!(started.started);
        assert!(started.terminal_id > 0);

        let mut marker_value = String::new();
        for _ in 0..100 {
            if let Ok(value) = std::fs::read_to_string(&marker_path) {
                marker_value = value;
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        assert_eq!(marker_value, "session-runtime-started");
    }

    #[test]
    fn session_runtime_start_mirrors_bound_terminal_output_into_session_stream() {
        let app = test_app();
        let authorized = authorized_request();
        let root = create_temp_workspace_root("session-runtime-transcript");
        let workspace_id = launch_test_workspace(&app, &root);
        *app.state().hook_endpoint.lock().unwrap() = Some("http://127.0.0.1:1/claude-hook".into());

        dispatch_rpc(
            &app,
            "app_settings_update",
            json!({
                "settings": {
                    "claude": {
                        "global": {
                            "executable": test_agent_launch_profile().0,
                            "startup_args": test_agent_launch_profile().1,
                            "env": {
                                "TEST_MARKER": "resume-77"
                            }
                        }
                    }
                }
            }),
            &authorized,
        )
        .unwrap();

        let runtime = attach_controller(&app, &authorized, &workspace_id);
        let created = dispatch_rpc(
            &app,
            "create_session",
            json!({
                "workspace_id": workspace_id,
                "device_id": "device-a",
                "client_id": "client-a",
                "fencing_token": runtime.controller.fencing_token,
                "mode": "branch",
                "provider": "claude",
            }),
            &authorized,
        )
        .unwrap();
        let created: SessionInfo = serde_json::from_value(created).unwrap();
        set_session_resume_id(app.state(), &workspace_id, created.id, "resume-77".to_string()).unwrap();

        let started = dispatch_rpc(
            &app,
            "session_runtime_start",
            json!({
                "workspace_id": workspace_id,
                "device_id": "device-a",
                "client_id": "client-a",
                "fencing_token": runtime.controller.fencing_token,
                "session_id": created.id.to_string(),
                "cols": 100,
                "rows": 24,
            }),
            &authorized,
        )
        .unwrap();
        let started: SessionRuntimeStartResult = serde_json::from_value(started).unwrap();
        assert!(started.terminal_id > 0);

        std::thread::sleep(Duration::from_millis(150));
        let refreshed = load_session(app.state(), &workspace_id, created.id).unwrap();
        assert!(refreshed.stream.contains("resume-77"));
    }

    #[test]
    fn bound_terminal_exit_marks_session_interrupted_and_clears_binding() {
        let app = test_app();
        let authorized = authorized_request();
        let root = create_temp_workspace_root("session-runtime-exit");
        let workspace_id = launch_test_workspace(&app, &root);
        *app.state().hook_endpoint.lock().unwrap() = Some("http://127.0.0.1:1/claude-hook".into());
        let runtime = attach_controller(&app, &authorized, &workspace_id);

        let created = dispatch_rpc(
            &app,
            "create_session",
            json!({
                "workspace_id": workspace_id,
                "device_id": "device-a",
                "client_id": "client-a",
                "fencing_token": runtime.controller.fencing_token,
                "mode": "branch",
                "provider": "claude",
            }),
            &authorized,
        )
        .unwrap();
        let created: SessionInfo = serde_json::from_value(created).unwrap();

        let started = dispatch_rpc(
            &app,
            "session_runtime_start",
            json!({
                "workspace_id": workspace_id,
                "device_id": "device-a",
                "client_id": "client-a",
                "fencing_token": runtime.controller.fencing_token,
                "session_id": created.id.to_string(),
                "cols": 80,
                "rows": 24,
            }),
            &authorized,
        )
        .unwrap();
        let started: SessionRuntimeStartResult = serde_json::from_value(started).unwrap();

        dispatch_rpc(
            &app,
            "terminal_close",
            json!({
                "workspace_id": workspace_id,
                "device_id": "device-a",
                "client_id": "client-a",
                "fencing_token": runtime.controller.fencing_token,
                "terminal_id": started.terminal_id,
            }),
            &authorized,
        )
        .unwrap();

        std::thread::sleep(Duration::from_millis(150));
        let refreshed = load_session(app.state(), &workspace_id, created.id).unwrap();
        assert_eq!(refreshed.status, SessionStatus::Interrupted);
    }
}
