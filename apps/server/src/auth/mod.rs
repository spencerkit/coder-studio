pub(crate) mod ip_guard;

use std::{
    ffi::OsString,
    net::SocketAddr,
    path::{Path, PathBuf},
};

use axum::http::{
    header::{COOKIE, HOST, ORIGIN, REFERER, USER_AGENT},
    HeaderMap,
};
use chrono::{TimeZone, Utc};
use getrandom::getrandom;
use sha2::{Digest, Sha256};
use url::Url;

use crate::*;

const DEFAULT_SESSION_IDLE_MINUTES: u64 = 15;
const DEFAULT_SESSION_MAX_HOURS: u64 = 12;
const DEFAULT_BIND_HOST: &str = "127.0.0.1";
const DEFAULT_BIND_PORT: u16 = 41033;
const SESSION_COOKIE_NAME: &str = "cs_session";
const SESSION_TOUCH_SAVE_INTERVAL_MS: i64 = 60 * 1000;

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthSessionRecord {
    pub id: String,
    pub token_hash: String,
    pub created_at: String,
    pub last_seen_at: String,
    pub expires_at: String,
    pub revoked: bool,
    pub ip: String,
    pub user_agent: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthFile {
    pub version: u32,
    #[serde(default = "default_public_mode")]
    pub public_mode: bool,
    #[serde(default)]
    pub password: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub root_path: String,
    #[serde(default, skip_serializing)]
    pub allowed_roots: Vec<String>,
    #[serde(default = "default_bind_host")]
    pub bind_host: String,
    #[serde(default = "default_bind_port")]
    pub bind_port: u16,
    #[serde(default = "default_session_idle_minutes")]
    pub session_idle_minutes: u64,
    #[serde(default = "default_session_max_hours")]
    pub session_max_hours: u64,
    #[serde(default)]
    pub sessions: Vec<AuthSessionRecord>,
}

pub(crate) struct AuthRuntime {
    pub path: PathBuf,
    pub file: AuthFile,
}

impl Default for AuthRuntime {
    fn default() -> Self {
        Self {
            path: PathBuf::new(),
            file: AuthFile {
                version: 1,
                public_mode: default_public_mode(),
                password: String::new(),
                root_path: String::new(),
                allowed_roots: Vec::new(),
                bind_host: default_bind_host(),
                bind_port: default_bind_port(),
                session_idle_minutes: DEFAULT_SESSION_IDLE_MINUTES,
                session_max_hours: DEFAULT_SESSION_MAX_HOURS,
                sessions: Vec::new(),
            },
        }
    }
}

#[derive(Clone, Serialize, Debug)]
pub(crate) struct AuthStatusResponse {
    pub public_mode: bool,
    pub authenticated: bool,
    pub password_configured: bool,
    pub local_host: bool,
    pub secure_transport_required: bool,
    pub secure_transport_ok: bool,
    pub session_idle_minutes: u64,
    pub session_max_hours: u64,
    pub allowed_roots: Vec<String>,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdminServerConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdminRootConfig {
    pub path: Option<String>,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdminAuthConfig {
    pub public_mode: bool,
    pub password_configured: bool,
    pub session_idle_minutes: u64,
    pub session_max_hours: u64,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdminConfigResponse {
    pub server: AdminServerConfig,
    pub root: AdminRootConfig,
    pub auth: AdminAuthConfig,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdminConfigUpdateResponse {
    pub config: AdminConfigResponse,
    pub changed_keys: Vec<String>,
    pub restart_required: bool,
    pub sessions_reset: bool,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BlockedIpEntry {
    pub ip: String,
    pub fail_count: u32,
    pub first_failed_at: Option<String>,
    pub last_failed_at: Option<String>,
    pub blocked_until: String,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdminAuthStatusResponse {
    pub server: AdminServerConfig,
    pub root: AdminRootConfig,
    pub auth: AdminAuthConfig,
    pub blocked_ip_count: usize,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdminIpUnblockResponse {
    pub removed: usize,
    pub entries: Vec<BlockedIpEntry>,
}

#[derive(Clone, Debug)]
pub(crate) struct RequestContext {
    pub ip: String,
    pub user_agent: String,
    pub is_local_host: bool,
    pub is_secure_transport: bool,
    pub public_mode: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct AuthorizedRequest {
    pub request: RequestContext,
    pub allowed_roots: Vec<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct AuthFailure {
    pub status: StatusCode,
    pub code: String,
    pub blocked_until: Option<String>,
    pub clear_cookie: bool,
}

impl AuthFailure {
    pub(crate) fn new(status: StatusCode, code: impl Into<String>) -> Self {
        Self {
            status,
            code: code.into(),
            blocked_until: None,
            clear_cookie: false,
        }
    }

    pub(crate) fn clear_cookie(mut self) -> Self {
        self.clear_cookie = true;
        self
    }

    pub(crate) fn with_blocked_until_ms(mut self, blocked_until_ms: i64) -> Self {
        self.blocked_until = Some(format_rfc3339(blocked_until_ms));
        self
    }

    pub(crate) fn internal(error: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, error)
    }

    pub(crate) fn into_response(self, request: &RequestContext) -> Response {
        let mut body = Map::new();
        body.insert("ok".to_string(), Value::Bool(false));
        body.insert("error".to_string(), Value::String(self.code));
        if let Some(blocked_until) = self.blocked_until {
            body.insert("blocked_until".to_string(), Value::String(blocked_until));
        }
        let mut response = (self.status, Json(Value::Object(body))).into_response();
        if self.clear_cookie {
            if let Ok(value) = axum::http::HeaderValue::from_str(&clear_session_cookie(request)) {
                response
                    .headers_mut()
                    .append(axum::http::header::SET_COOKIE, value);
            }
        }
        response
    }
}

fn default_public_mode() -> bool {
    true
}

fn default_session_idle_minutes() -> u64 {
    DEFAULT_SESSION_IDLE_MINUTES
}

fn default_session_max_hours() -> u64 {
    DEFAULT_SESSION_MAX_HOURS
}

fn default_bind_host() -> String {
    DEFAULT_BIND_HOST.to_string()
}

fn default_bind_port() -> u16 {
    DEFAULT_BIND_PORT
}

pub(crate) fn load_or_initialize_auth_runtime(app_data_dir: &Path) -> Result<AuthRuntime, String> {
    let path = app_data_dir.join("auth.json");
    if path.exists() {
        let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let mut file: AuthFile = serde_json::from_str(&data).map_err(|e| e.to_string())?;
        sanitize_auth_file(&mut file);
        prune_expired_sessions(&mut file, now_epoch_ms());
        save_auth_file(&path, &file)?;
        return Ok(AuthRuntime { path, file });
    }

    let file = build_default_auth_file()?;
    save_auth_file(&path, &file)?;
    Ok(AuthRuntime { path, file })
}

pub(crate) fn auth_status(
    app: &AppHandle,
    headers: &HeaderMap,
    client_addr: SocketAddr,
    force_public: bool,
) -> Result<AuthStatusResponse, AuthFailure> {
    let state: State<AppState> = app.state();
    let mut auth = state
        .auth
        .lock()
        .map_err(|e| AuthFailure::internal(e.to_string()))?;
    let request = request_context(headers, client_addr, auth.file.public_mode, force_public);
    ensure_ip_not_blocked(app, &request.ip)?;
    let password_configured = password_configured(&auth.file);

    if !request.public_mode {
        return Ok(status_response(&auth.file, &request, true));
    }

    let authenticated = if let Some(token) = read_cookie_token(headers) {
        authenticate_session(&mut auth, &token, true)
            .map_err(AuthFailure::internal)?
            .is_some()
    } else {
        false
    };

    Ok(status_response(
        &auth.file,
        &request,
        authenticated && password_configured,
    ))
}

pub(crate) fn transport_bind_config(app: &AppHandle) -> Result<(String, u16), String> {
    if let Ok(host) = std::env::var("CODER_STUDIO_HOST") {
        let port = std::env::var("CODER_STUDIO_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(crate::DEV_BACKEND_PORT);
        return Ok((host, port));
    }

    let state: State<AppState> = app.state();
    let auth = state.auth.lock().map_err(|e| e.to_string())?;
    Ok((auth.file.bind_host.clone(), auth.file.bind_port))
}

pub(crate) fn admin_config(app: &AppHandle) -> Result<AdminConfigResponse, String> {
    let state: State<AppState> = app.state();
    let auth = state.auth.lock().map_err(|e| e.to_string())?;
    Ok(admin_config_response(&auth.file))
}

pub(crate) fn admin_update_config(
    app: &AppHandle,
    updates: &Map<String, Value>,
) -> Result<AdminConfigUpdateResponse, String> {
    let state: State<AppState> = app.state();
    let mut auth = state.auth.lock().map_err(|e| e.to_string())?;
    let mut changed_keys = Vec::new();
    let mut restart_required = false;
    let mut sessions_reset = false;

    for (key, value) in updates {
        match key.as_str() {
            "server.host" => {
                let next = parse_admin_string(value, "server_host")?;
                if auth.file.bind_host != next {
                    auth.file.bind_host = next;
                    changed_keys.push(key.clone());
                    restart_required = true;
                }
            }
            "server.port" => {
                let next = parse_admin_port(value)?;
                if auth.file.bind_port != next {
                    auth.file.bind_port = next;
                    changed_keys.push(key.clone());
                    restart_required = true;
                }
            }
            "root.path" => {
                let next = parse_admin_root_path(value)?;
                if effective_root_path(&auth.file) != next {
                    set_root_path(&mut auth.file, next);
                    changed_keys.push(key.clone());
                }
            }
            "auth.publicMode" => {
                let next = parse_admin_bool(value, "auth_public_mode")?;
                if auth.file.public_mode != next {
                    auth.file.public_mode = next;
                    changed_keys.push(key.clone());
                    sessions_reset = true;
                }
            }
            "auth.password" => {
                let next = parse_admin_optional_string(value)?.unwrap_or_default();
                if auth.file.password != next {
                    auth.file.password = next;
                    changed_keys.push(key.clone());
                    sessions_reset = true;
                }
            }
            "auth.sessionIdleMinutes" => {
                let next = parse_admin_positive_u64(value, "auth_session_idle_minutes")?;
                if auth.file.session_idle_minutes != next {
                    auth.file.session_idle_minutes = next;
                    changed_keys.push(key.clone());
                }
            }
            "auth.sessionMaxHours" => {
                let next = parse_admin_positive_u64(value, "auth_session_max_hours")?;
                if auth.file.session_max_hours != next {
                    auth.file.session_max_hours = next;
                    changed_keys.push(key.clone());
                }
            }
            other => return Err(format!("unsupported_config_key:{other}")),
        }
    }

    sanitize_auth_file(&mut auth.file);
    if sessions_reset {
        auth.file.sessions.clear();
    }
    save_runtime(&mut auth)?;

    Ok(AdminConfigUpdateResponse {
        config: admin_config_response(&auth.file),
        changed_keys,
        restart_required,
        sessions_reset,
    })
}

pub(crate) fn admin_auth_status(app: &AppHandle) -> Result<AdminAuthStatusResponse, String> {
    let state: State<AppState> = app.state();
    let auth = state.auth.lock().map_err(|e| e.to_string())?;
    let blocked_ip_count = {
        let mut ip_guard = state.ip_guard.lock().map_err(|e| e.to_string())?;
        ip_guard::list_blocked(&mut ip_guard, now_epoch_ms()).len()
    };

    Ok(AdminAuthStatusResponse {
        server: AdminServerConfig {
            host: auth.file.bind_host.clone(),
            port: auth.file.bind_port,
        },
        root: AdminRootConfig {
            path: effective_root_path(&auth.file),
        },
        auth: AdminAuthConfig {
            public_mode: auth.file.public_mode,
            password_configured: password_configured(&auth.file),
            session_idle_minutes: auth.file.session_idle_minutes,
            session_max_hours: auth.file.session_max_hours,
        },
        blocked_ip_count,
    })
}

pub(crate) fn admin_blocked_ips(app: &AppHandle) -> Result<Vec<BlockedIpEntry>, String> {
    let state: State<AppState> = app.state();
    let mut ip_guard = state.ip_guard.lock().map_err(|e| e.to_string())?;
    Ok(ip_guard::list_blocked(&mut ip_guard, now_epoch_ms())
        .into_iter()
        .map(blocked_ip_entry)
        .collect())
}

pub(crate) fn admin_unblock_ip(
    app: &AppHandle,
    ip: Option<&str>,
    clear_all: bool,
) -> Result<AdminIpUnblockResponse, String> {
    let state: State<AppState> = app.state();
    let mut ip_guard = state.ip_guard.lock().map_err(|e| e.to_string())?;
    let now_ms = now_epoch_ms();
    let removed = if clear_all {
        ip_guard::unblock_all(&mut ip_guard, now_ms)
    } else if let Some(ip) = ip.map(str::trim).filter(|value| !value.is_empty()) {
        usize::from(ip_guard::unblock_ip(&mut ip_guard, ip))
    } else {
        return Err("missing_ip".to_string());
    };
    let entries = ip_guard::list_blocked(&mut ip_guard, now_ms)
        .into_iter()
        .map(blocked_ip_entry)
        .collect();
    Ok(AdminIpUnblockResponse { removed, entries })
}

pub(crate) fn login(
    app: &AppHandle,
    headers: &HeaderMap,
    client_addr: SocketAddr,
    force_public: bool,
    password: &str,
) -> Result<(AuthStatusResponse, String), AuthFailure> {
    let state: State<AppState> = app.state();
    let now_ms = now_epoch_ms();

    let mut auth = state
        .auth
        .lock()
        .map_err(|e| AuthFailure::internal(e.to_string()))?;
    let request = request_context(headers, client_addr, auth.file.public_mode, force_public);
    ensure_ip_not_blocked(app, &request.ip)?;
    if !request.public_mode {
        return Ok((status_response(&auth.file, &request, true), String::new()));
    }
    if !password_configured(&auth.file) {
        return Err(AuthFailure::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "auth_not_configured",
        ));
    }

    {
        let mut guard = state
            .ip_guard
            .lock()
            .map_err(|e| AuthFailure::internal(e.to_string()))?;
        if let Some(blocked_until_ms) = ip_guard::blocked_until(&mut guard, &request.ip, now_ms) {
            return Err(
                AuthFailure::new(StatusCode::TOO_MANY_REQUESTS, "ip_blocked")
                    .with_blocked_until_ms(blocked_until_ms),
            );
        }
    }

    if auth.file.password != password {
        let mut guard = state
            .ip_guard
            .lock()
            .map_err(|e| AuthFailure::internal(e.to_string()))?;
        let failure = if let Some(blocked_until_ms) =
            ip_guard::record_failure(&mut guard, &request.ip, now_ms)
        {
            AuthFailure::new(StatusCode::TOO_MANY_REQUESTS, "ip_blocked")
                .with_blocked_until_ms(blocked_until_ms)
        } else {
            AuthFailure::new(StatusCode::UNAUTHORIZED, "invalid_credentials")
        };
        return Err(failure);
    }

    {
        let mut guard = state
            .ip_guard
            .lock()
            .map_err(|e| AuthFailure::internal(e.to_string()))?;
        ip_guard::clear_failures(&mut guard, &request.ip);
    }

    prune_expired_sessions(&mut auth.file, now_ms);
    let token = random_hex(32).map_err(AuthFailure::internal)?;
    let created_at = format_rfc3339(now_ms);
    let expires_at_ms =
        now_ms.saturating_add((auth.file.session_max_hours as i64) * 60 * 60 * 1000);
    let expires_at = format_rfc3339(expires_at_ms);
    auth.file.sessions.push(AuthSessionRecord {
        id: format!("sess_{}", random_hex(8).map_err(AuthFailure::internal)?),
        token_hash: sha256_hex(&token),
        created_at: created_at.clone(),
        last_seen_at: created_at,
        expires_at: expires_at.clone(),
        revoked: false,
        ip: request.ip.clone(),
        user_agent: request.user_agent.clone(),
    });
    save_runtime(&mut auth).map_err(AuthFailure::internal)?;

    Ok((
        status_response(&auth.file, &request, true),
        build_session_cookie(&token, expires_at_ms, &request),
    ))
}

pub(crate) fn logout(
    app: &AppHandle,
    headers: &HeaderMap,
    client_addr: SocketAddr,
    force_public: bool,
) -> Result<(AuthStatusResponse, String), AuthFailure> {
    let state: State<AppState> = app.state();
    let mut auth = state
        .auth
        .lock()
        .map_err(|e| AuthFailure::internal(e.to_string()))?;
    let request = request_context(headers, client_addr, auth.file.public_mode, force_public);
    ensure_ip_not_blocked(app, &request.ip)?;
    if let Some(token) = read_cookie_token(headers) {
        revoke_session(&mut auth, &token).map_err(AuthFailure::internal)?;
    }
    Ok((
        status_response(&auth.file, &request, !request.public_mode),
        clear_session_cookie(&request),
    ))
}

pub(crate) fn lock(
    app: &AppHandle,
    headers: &HeaderMap,
    client_addr: SocketAddr,
    force_public: bool,
) -> Result<(AuthStatusResponse, String), AuthFailure> {
    logout(app, headers, client_addr, force_public)
}

pub(crate) fn require_session(
    app: &AppHandle,
    headers: &HeaderMap,
    client_addr: SocketAddr,
    force_public: bool,
) -> Result<AuthorizedRequest, AuthFailure> {
    let state: State<AppState> = app.state();
    let mut auth = state
        .auth
        .lock()
        .map_err(|e| AuthFailure::internal(e.to_string()))?;
    let request = request_context(headers, client_addr, auth.file.public_mode, force_public);
    ensure_ip_not_blocked(app, &request.ip)?;
    if !request.public_mode {
        return Ok(AuthorizedRequest {
            request,
            allowed_roots: auth.file.allowed_roots.clone(),
        });
    }

    let token = read_cookie_token(headers).ok_or_else(|| {
        AuthFailure::new(StatusCode::UNAUTHORIZED, "session_missing").clear_cookie()
    })?;
    let authenticated =
        authenticate_session(&mut auth, &token, true).map_err(AuthFailure::internal)?;
    if authenticated.is_none() {
        return Err(AuthFailure::new(StatusCode::UNAUTHORIZED, "session_expired").clear_cookie());
    }

    Ok(AuthorizedRequest {
        request,
        allowed_roots: auth.file.allowed_roots.clone(),
    })
}

pub(crate) fn ensure_path_allowed(
    path: &str,
    target: &ExecTarget,
    allowed_roots: &[String],
) -> Result<(), String> {
    let requested = normalize_path_for_target(path, target)?;
    let allowed = normalized_allowed_roots(target, allowed_roots)?;
    if allowed.is_empty() {
        return Err("no_allowed_roots_configured".to_string());
    }
    if allowed
        .iter()
        .any(|root| path_within_root(&requested, root, target))
    {
        return Ok(());
    }
    Err("path_not_allowed".to_string())
}

pub(crate) fn ensure_optional_path_allowed(
    path: Option<&str>,
    target: &ExecTarget,
    allowed_roots: &[String],
) -> Result<(), String> {
    if let Some(path) = path {
        ensure_path_allowed(path, target, allowed_roots)?;
    }
    Ok(())
}

pub(crate) fn select_clone_root_for_target(
    target: &ExecTarget,
    allowed_roots: &[String],
) -> Result<String, String> {
    let roots = normalized_allowed_roots(target, allowed_roots)?;
    let Some(root) = roots.first() else {
        return Err("no_allowed_roots_configured".to_string());
    };
    ensure_directory_exists(target, root)?;
    Ok(root.clone())
}

pub(crate) fn filesystem_list_public(
    target: ExecTarget,
    path: Option<String>,
    allowed_roots: &[String],
) -> Result<FilesystemListResponse, String> {
    let roots = filesystem_roots_public(&target, allowed_roots)?;
    let first_root = roots
        .first()
        .ok_or_else(|| "no_allowed_roots_configured".to_string())?;

    let requested = path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| normalize_path_for_target(value, &target))
        .transpose()?;

    let mut candidates = Vec::new();
    if let Some(requested) = requested.clone() {
        candidates.push(requested);
    }
    for root in &roots {
        if !candidates.iter().any(|candidate| candidate == &root.path) {
            candidates.push(root.path.clone());
        }
    }

    let mut selected: Option<(String, Vec<FilesystemEntry>)> = None;
    let mut first_error: Option<String> = None;

    for candidate in candidates {
        if ensure_path_allowed(&candidate, &target, allowed_roots).is_err() {
            continue;
        }
        match list_directories_for_target(&target, &candidate) {
            Ok(entries) => {
                selected = Some((candidate, entries));
                break;
            }
            Err(error) => {
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
    }

    let (current_path, entries) = selected.ok_or_else(|| {
        first_error.unwrap_or_else(|| "unable_to_read_allowed_directories".to_string())
    })?;
    let parent_candidate = match target {
        ExecTarget::Native => native_parent_path(&current_path),
        ExecTarget::Wsl { .. } => wsl_parent_path(&current_path, &target),
    };
    let parent_path = parent_candidate
        .filter(|candidate| ensure_path_allowed(candidate, &target, allowed_roots).is_ok());
    let fallback_reason = requested
        .as_ref()
        .filter(|requested| *requested != &current_path)
        .map(|_| "requested_path_outside_allowed_roots".to_string());

    Ok(FilesystemListResponse {
        current_path,
        home_path: first_root.path.clone(),
        parent_path,
        roots,
        entries,
        requested_path: requested,
        fallback_reason,
    })
}

pub(crate) fn filesystem_roots_public(
    target: &ExecTarget,
    allowed_roots: &[String],
) -> Result<Vec<FilesystemRoot>, String> {
    let roots = normalized_allowed_roots(target, allowed_roots)?;
    if roots.is_empty() {
        return Err("no_allowed_roots_configured".to_string());
    }
    Ok(roots
        .iter()
        .enumerate()
        .map(|(index, root)| FilesystemRoot {
            id: format!("allowed-root-{index}"),
            label: path_label(root),
            path: root.clone(),
            description: "Allowed workspace root".to_string(),
        })
        .collect())
}

pub(crate) fn filter_allowed_worktrees(
    worktrees: Vec<WorktreeInfo>,
    target: &ExecTarget,
    allowed_roots: &[String],
) -> Vec<WorktreeInfo> {
    worktrees
        .into_iter()
        .filter(|worktree| ensure_path_allowed(&worktree.path, target, allowed_roots).is_ok())
        .collect()
}

pub(crate) fn ensure_ip_not_blocked(app: &AppHandle, ip: &str) -> Result<(), AuthFailure> {
    let state: State<AppState> = app.state();
    let mut guard = state
        .ip_guard
        .lock()
        .map_err(|e| AuthFailure::internal(e.to_string()))?;
    if let Some(blocked_until_ms) = ip_guard::blocked_until(&mut guard, ip, now_epoch_ms()) {
        return Err(
            AuthFailure::new(StatusCode::TOO_MANY_REQUESTS, "ip_blocked")
                .with_blocked_until_ms(blocked_until_ms),
        );
    }
    Ok(())
}

fn build_default_auth_file() -> Result<AuthFile, String> {
    let mut root_path = String::new();
    if let Ok(home) = filesystem_home_for_target(&ExecTarget::Native) {
        let root = PathBuf::from(home).join("coder-studio-workspaces");
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        root_path = root.to_string_lossy().to_string();
    }
    Ok(AuthFile {
        version: 1,
        public_mode: default_public_mode(),
        password: String::new(),
        root_path: root_path.clone(),
        allowed_roots: if root_path.is_empty() {
            Vec::new()
        } else {
            vec![root_path]
        },
        bind_host: default_bind_host(),
        bind_port: default_bind_port(),
        session_idle_minutes: DEFAULT_SESSION_IDLE_MINUTES,
        session_max_hours: DEFAULT_SESSION_MAX_HOURS,
        sessions: Vec::new(),
    })
}

fn sanitize_auth_file(file: &mut AuthFile) {
    if file.version == 0 {
        file.version = 1;
    }
    file.password = file.password.trim().to_string();
    if file.session_idle_minutes == 0 {
        file.session_idle_minutes = DEFAULT_SESSION_IDLE_MINUTES;
    }
    if file.session_max_hours == 0 {
        file.session_max_hours = DEFAULT_SESSION_MAX_HOURS;
    }
    file.bind_host = {
        let trimmed = file.bind_host.trim();
        if trimmed.is_empty() {
            default_bind_host()
        } else {
            trimmed.to_string()
        }
    };
    if file.bind_port == 0 {
        file.bind_port = DEFAULT_BIND_PORT;
    }
    let root_path = if let Some(root) = trim_to_option(&file.root_path) {
        Some(root)
    } else {
        std::mem::take(&mut file.allowed_roots)
            .into_iter()
            .find_map(|root| trim_to_option(&root))
    };
    set_root_path(file, root_path);
}

fn trim_to_option(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn set_root_path(file: &mut AuthFile, root_path: Option<String>) {
    let root_path = root_path.unwrap_or_default();
    file.root_path = root_path.clone();
    file.allowed_roots = if root_path.is_empty() {
        Vec::new()
    } else {
        vec![root_path]
    };
}

fn effective_root_path(file: &AuthFile) -> Option<String> {
    trim_to_option(&file.root_path)
}

fn admin_config_response(file: &AuthFile) -> AdminConfigResponse {
    AdminConfigResponse {
        server: AdminServerConfig {
            host: file.bind_host.clone(),
            port: file.bind_port,
        },
        root: AdminRootConfig {
            path: effective_root_path(file),
        },
        auth: AdminAuthConfig {
            public_mode: file.public_mode,
            password_configured: password_configured(file),
            session_idle_minutes: file.session_idle_minutes,
            session_max_hours: file.session_max_hours,
        },
    }
}

fn blocked_ip_entry(record: ip_guard::IpBlockRecord) -> BlockedIpEntry {
    BlockedIpEntry {
        ip: record.ip,
        fail_count: record.fail_count,
        first_failed_at: format_optional_rfc3339(record.first_failed_at_ms),
        last_failed_at: format_optional_rfc3339(record.last_failed_at_ms),
        blocked_until: format_rfc3339(record.blocked_until_ms),
    }
}

fn format_optional_rfc3339(value: i64) -> Option<String> {
    if value <= 0 {
        None
    } else {
        Some(format_rfc3339(value))
    }
}

fn parse_admin_string(value: &Value, key: &str) -> Result<String, String> {
    parse_admin_optional_string(value)?.ok_or_else(|| format!("invalid_{key}"))
}

fn parse_admin_optional_string(value: &Value) -> Result<Option<String>, String> {
    match value {
        Value::Null => Ok(None),
        Value::String(text) => Ok(trim_to_option(text)),
        other => Err(format!("invalid_string:{other}")),
    }
}

fn parse_admin_bool(value: &Value, key: &str) -> Result<bool, String> {
    value.as_bool().ok_or_else(|| format!("invalid_{key}"))
}

fn parse_admin_positive_u64(value: &Value, key: &str) -> Result<u64, String> {
    value
        .as_u64()
        .filter(|candidate| *candidate > 0)
        .ok_or_else(|| format!("invalid_{key}"))
}

fn parse_admin_port(value: &Value) -> Result<u16, String> {
    let number = value
        .as_u64()
        .ok_or_else(|| "invalid_server_port".to_string())?;
    if number == 0 || number > u16::MAX as u64 {
        return Err("invalid_server_port".to_string());
    }
    Ok(number as u16)
}

fn parse_admin_root_path(value: &Value) -> Result<Option<String>, String> {
    let Some(path) = parse_admin_optional_string(value)? else {
        return Ok(None);
    };
    let normalized = normalize_native_path(&path)?;
    ensure_directory_exists(&ExecTarget::Native, &normalized)?;
    Ok(Some(normalized))
}

fn save_runtime(runtime: &mut AuthRuntime) -> Result<(), String> {
    save_auth_file(&runtime.path, &runtime.file)
}

fn save_auth_file(path: &Path, file: &AuthFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    let file_name = path
        .file_name()
        .map(|value| value.to_os_string())
        .unwrap_or_else(|| OsString::from("auth.json"));
    let temp_path = path.with_file_name(format!(
        ".{}.tmp-{}",
        file_name.to_string_lossy(),
        now_epoch_ms()
    ));
    std::fs::write(&temp_path, content).map_err(|e| e.to_string())?;
    std::fs::rename(&temp_path, path).map_err(|e| e.to_string())
}

fn password_configured(file: &AuthFile) -> bool {
    !file.password.trim().is_empty()
}

fn status_response(
    file: &AuthFile,
    request: &RequestContext,
    authenticated: bool,
) -> AuthStatusResponse {
    AuthStatusResponse {
        public_mode: request.public_mode,
        authenticated,
        password_configured: password_configured(file),
        local_host: request.is_local_host,
        secure_transport_required: false,
        secure_transport_ok: request.is_local_host || request.is_secure_transport,
        session_idle_minutes: file.session_idle_minutes,
        session_max_hours: file.session_max_hours,
        allowed_roots: file.allowed_roots.clone(),
    }
}

fn request_context(
    headers: &HeaderMap,
    client_addr: SocketAddr,
    public_mode_config: bool,
    force_public: bool,
) -> RequestContext {
    let host = request_host(headers);
    let is_local_host = host
        .as_deref()
        .map(is_local_host)
        .unwrap_or(client_addr.ip().is_loopback());
    let user_agent = header_string(headers, USER_AGENT).unwrap_or_default();
    RequestContext {
        ip: request_ip(headers, client_addr),
        user_agent,
        is_local_host,
        is_secure_transport: request_uses_secure_transport(headers),
        public_mode: public_mode_config && (!is_local_host || force_public),
    }
}

fn request_ip(headers: &HeaderMap, client_addr: SocketAddr) -> String {
    if let Some(forwarded_for) = header_name_string(headers, "x-forwarded-for") {
        if let Some(ip) = forwarded_for
            .split(',')
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return ip.to_string();
        }
    }
    if let Some(real_ip) = header_name_string(headers, "x-real-ip") {
        let trimmed = real_ip.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    client_addr.ip().to_string()
}

fn request_host(headers: &HeaderMap) -> Option<String> {
    header_name_string(headers, "x-forwarded-host")
        .or_else(|| forwarded_token(headers, "host"))
        .or_else(|| header_string(headers, HOST))
        .or_else(|| header_url_host(headers, ORIGIN))
        .or_else(|| header_url_host(headers, REFERER))
        .map(|value| normalize_host(&value))
        .filter(|value| !value.is_empty())
}

fn request_uses_secure_transport(headers: &HeaderMap) -> bool {
    header_name_string(headers, "x-forwarded-proto")
        .or_else(|| forwarded_token(headers, "proto"))
        .map(|value| value.eq_ignore_ascii_case("https"))
        .or_else(|| header_url_scheme(headers, ORIGIN).map(|value| value == "https"))
        .or_else(|| header_url_scheme(headers, REFERER).map(|value| value == "https"))
        .unwrap_or(false)
}

fn forwarded_token(headers: &HeaderMap, key: &str) -> Option<String> {
    let forwarded = header_name_string(headers, "forwarded")?;
    for entry in forwarded.split(',') {
        for pair in entry.split(';') {
            let trimmed = pair.trim();
            if let Some(value) = trimmed.strip_prefix(&format!("{key}=")) {
                return Some(value.trim_matches('"').to_string());
            }
        }
    }
    None
}

fn header_string(headers: &HeaderMap, key: axum::http::header::HeaderName) -> Option<String> {
    headers
        .get(key)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string())
}

fn header_name_string(headers: &HeaderMap, key: &str) -> Option<String> {
    headers
        .get(key)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string())
}

fn header_url_scheme(headers: &HeaderMap, key: axum::http::header::HeaderName) -> Option<String> {
    let url = headers.get(key)?.to_str().ok()?;
    Url::parse(url)
        .ok()
        .map(|parsed| parsed.scheme().to_string())
}

fn header_url_host(headers: &HeaderMap, key: axum::http::header::HeaderName) -> Option<String> {
    let url = headers.get(key)?.to_str().ok()?;
    Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(|value| value.to_string()))
}

fn normalize_host(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if let Ok(parsed) = Url::parse(trimmed) {
        return parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    }
    if trimmed.starts_with('[') {
        if let Some(end) = trimmed.find(']') {
            return trimmed[1..end].to_ascii_lowercase();
        }
    }
    if trimmed.matches(':').count() == 1 {
        return trimmed
            .split_once(':')
            .map(|(host, _)| host.to_ascii_lowercase())
            .unwrap_or_else(|| trimmed.to_ascii_lowercase());
    }
    trimmed
        .trim_matches('[')
        .trim_matches(']')
        .to_ascii_lowercase()
}

fn is_local_host(value: &str) -> bool {
    matches!(
        normalize_host(value).as_str(),
        "localhost" | "127.0.0.1" | "::1"
    )
}

fn read_cookie_token(headers: &HeaderMap) -> Option<String> {
    let header = headers.get(COOKIE)?.to_str().ok()?;
    header
        .split(';')
        .map(str::trim)
        .find_map(|entry| entry.split_once('='))
        .and_then(|(name, value)| {
            if name == SESSION_COOKIE_NAME {
                Some(value.to_string())
            } else {
                None
            }
        })
}

fn authenticate_session(
    runtime: &mut AuthRuntime,
    token: &str,
    touch: bool,
) -> Result<Option<AuthSessionRecord>, String> {
    let now_ms = now_epoch_ms();
    let mut changed = prune_expired_sessions(&mut runtime.file, now_ms);
    let token_hash = sha256_hex(token);
    let Some(index) = runtime
        .file
        .sessions
        .iter()
        .position(|session| !session.revoked && session.token_hash == token_hash)
    else {
        if changed {
            save_runtime(runtime)?;
        }
        return Ok(None);
    };

    let last_seen_ms =
        parse_rfc3339_ms(&runtime.file.sessions[index].last_seen_at).unwrap_or_default();
    if touch && now_ms.saturating_sub(last_seen_ms) >= SESSION_TOUCH_SAVE_INTERVAL_MS {
        runtime.file.sessions[index].last_seen_at = format_rfc3339(now_ms);
        changed = true;
    }
    let session = runtime.file.sessions[index].clone();
    if changed {
        save_runtime(runtime)?;
    }
    Ok(Some(session))
}

fn revoke_session(runtime: &mut AuthRuntime, token: &str) -> Result<(), String> {
    let token_hash = sha256_hex(token);
    let before = runtime.file.sessions.len();
    runtime
        .file
        .sessions
        .retain(|session| session.token_hash != token_hash);
    if runtime.file.sessions.len() != before {
        save_runtime(runtime)?;
    }
    Ok(())
}

fn prune_expired_sessions(file: &mut AuthFile, now_ms: i64) -> bool {
    let before = file.sessions.len();
    let idle_window_ms = (file.session_idle_minutes as i64) * 60 * 1000;
    file.sessions.retain(|session| {
        if session.revoked {
            return false;
        }
        let expires_at_ms = parse_rfc3339_ms(&session.expires_at).unwrap_or_default();
        let last_seen_ms = parse_rfc3339_ms(&session.last_seen_at).unwrap_or_default();
        expires_at_ms > now_ms && last_seen_ms.saturating_add(idle_window_ms) > now_ms
    });
    before != file.sessions.len()
}

fn build_session_cookie(token: &str, expires_at_ms: i64, request: &RequestContext) -> String {
    let max_age = expires_at_ms.saturating_sub(now_epoch_ms()) / 1000;
    format!(
        "{SESSION_COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}; Expires={}{}",
        max_age.max(0),
        format_cookie_time(expires_at_ms),
        if !request.is_local_host && request.is_secure_transport {
            "; Secure"
        } else {
            ""
        }
    )
}

fn clear_session_cookie(request: &RequestContext) -> String {
    format!(
        "{SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT{}",
        if !request.is_local_host && request.is_secure_transport {
            "; Secure"
        } else {
            ""
        }
    )
}

fn random_hex(bytes_len: usize) -> Result<String, String> {
    let mut bytes = vec![0u8; bytes_len];
    getrandom(&mut bytes).map_err(|e| e.to_string())?;
    Ok(hex_encode(&bytes))
}

fn sha256_hex(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hex_encode(hasher.finalize())
}

fn hex_encode(bytes: impl AsRef<[u8]>) -> String {
    bytes
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn now_epoch_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn parse_rfc3339_ms(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|parsed| parsed.timestamp_millis())
}

fn format_rfc3339(value: i64) -> String {
    Utc.timestamp_millis_opt(value)
        .single()
        .unwrap_or_else(Utc::now)
        .to_rfc3339()
}

fn format_cookie_time(value: i64) -> String {
    Utc.timestamp_millis_opt(value)
        .single()
        .unwrap_or_else(Utc::now)
        .format("%a, %d %b %Y %H:%M:%S GMT")
        .to_string()
}

fn normalized_allowed_roots(
    target: &ExecTarget,
    allowed_roots: &[String],
) -> Result<Vec<String>, String> {
    let mut roots = Vec::new();
    for root in allowed_roots {
        let normalized = match normalize_path_for_target(root, target) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if !roots.iter().any(|existing| existing == &normalized) {
            roots.push(normalized);
        }
    }
    Ok(roots)
}

fn normalize_path_for_target(path: &str, target: &ExecTarget) -> Result<String, String> {
    match target {
        ExecTarget::Native => normalize_native_path(path),
        ExecTarget::Wsl { .. } => normalize_wsl_path(path, target),
    }
}

fn normalize_native_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("empty_path".to_string());
    }
    let mut current = {
        let candidate = PathBuf::from(trimmed);
        if candidate.is_absolute() {
            candidate
        } else {
            std::env::current_dir()
                .map_err(|e| e.to_string())?
                .join(candidate)
        }
    };
    let mut suffix = Vec::<OsString>::new();
    while !current.exists() {
        let name = current
            .file_name()
            .map(|value| value.to_os_string())
            .ok_or_else(|| "path_has_no_existing_parent".to_string())?;
        suffix.push(name);
        current = current
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "path_has_no_existing_parent".to_string())?;
    }
    let mut normalized = std::fs::canonicalize(&current).map_err(|e| e.to_string())?;
    for component in suffix.iter().rev() {
        normalized.push(component);
    }
    Ok(normalized.to_string_lossy().to_string())
}

fn normalize_wsl_path(path: &str, target: &ExecTarget) -> Result<String, String> {
    let resolved = resolve_target_path(path, target)?;
    run_cmd(target, "", &["realpath", "-m", &resolved]).map(|value| value.trim().to_string())
}

fn path_within_root(path: &str, root: &str, target: &ExecTarget) -> bool {
    let normalize = |value: &str| {
        let value = value.replace('\\', "/");
        let trimmed = value.trim_end_matches('/').to_string();
        if cfg!(windows) && matches!(target, ExecTarget::Native) {
            trimmed.to_ascii_lowercase()
        } else {
            trimmed
        }
    };
    let path = normalize(path);
    let root = normalize(root);
    if root == "/" {
        return path.starts_with('/');
    }
    path == root || path.starts_with(&(root + "/"))
}

fn ensure_directory_exists(target: &ExecTarget, path: &str) -> Result<(), String> {
    match target {
        ExecTarget::Native => std::fs::create_dir_all(path).map_err(|e| e.to_string()),
        ExecTarget::Wsl { .. } => run_cmd(target, "", &["mkdir", "-p", path]).map(|_| ()),
    }
}

fn path_label(path: &str) -> String {
    PathBuf::from(path)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| path.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_auth_file_migrates_allowed_roots_to_root_path() {
        let mut file = AuthFile {
            version: 1,
            public_mode: true,
            password: String::new(),
            root_path: String::new(),
            allowed_roots: vec!["/tmp/workspaces".to_string(), "/tmp/other".to_string()],
            bind_host: String::new(),
            bind_port: 0,
            session_idle_minutes: 0,
            session_max_hours: 0,
            sessions: Vec::new(),
        };

        sanitize_auth_file(&mut file);

        assert_eq!(file.root_path, "/tmp/workspaces");
        assert_eq!(file.allowed_roots, vec!["/tmp/workspaces".to_string()]);
        assert_eq!(file.bind_host, DEFAULT_BIND_HOST);
        assert_eq!(file.bind_port, DEFAULT_BIND_PORT);
        assert_eq!(file.session_idle_minutes, DEFAULT_SESSION_IDLE_MINUTES);
        assert_eq!(file.session_max_hours, DEFAULT_SESSION_MAX_HOURS);
    }

    #[test]
    fn set_root_path_keeps_single_effective_root() {
        let mut file = AuthFile {
            version: 1,
            public_mode: true,
            password: String::new(),
            root_path: String::new(),
            allowed_roots: vec!["/tmp/workspaces".to_string()],
            bind_host: DEFAULT_BIND_HOST.to_string(),
            bind_port: DEFAULT_BIND_PORT,
            session_idle_minutes: DEFAULT_SESSION_IDLE_MINUTES,
            session_max_hours: DEFAULT_SESSION_MAX_HOURS,
            sessions: Vec::new(),
        };

        set_root_path(&mut file, Some("/srv/coder-studio".to_string()));
        assert_eq!(
            effective_root_path(&file),
            Some("/srv/coder-studio".to_string())
        );
        assert_eq!(file.allowed_roots, vec!["/srv/coder-studio".to_string()]);

        set_root_path(&mut file, None);
        assert_eq!(effective_root_path(&file), None);
        assert!(file.allowed_roots.is_empty());
    }

    #[test]
    fn insecure_remote_public_mode_is_allowed_in_status_response() {
        let file = AuthFile {
            version: 1,
            public_mode: true,
            password: "demo-passphrase".to_string(),
            root_path: "/srv/coder-studio".to_string(),
            allowed_roots: vec!["/srv/coder-studio".to_string()],
            bind_host: DEFAULT_BIND_HOST.to_string(),
            bind_port: DEFAULT_BIND_PORT,
            session_idle_minutes: DEFAULT_SESSION_IDLE_MINUTES,
            session_max_hours: DEFAULT_SESSION_MAX_HOURS,
            sessions: Vec::new(),
        };
        let request = RequestContext {
            ip: "203.0.113.10".to_string(),
            user_agent: "test".to_string(),
            is_local_host: false,
            is_secure_transport: false,
            public_mode: true,
        };

        let status = status_response(&file, &request, false);

        assert!(status.public_mode);
        assert!(!status.authenticated);
        assert!(!status.local_host);
        assert!(!status.secure_transport_required);
        assert!(!status.secure_transport_ok);
    }

    #[test]
    fn remote_http_sessions_use_non_secure_cookies() {
        let expires_at_ms = now_epoch_ms() + 60_000;
        let insecure_request = RequestContext {
            ip: "203.0.113.10".to_string(),
            user_agent: "test".to_string(),
            is_local_host: false,
            is_secure_transport: false,
            public_mode: true,
        };
        let secure_request = RequestContext {
            is_secure_transport: true,
            ..insecure_request.clone()
        };

        let insecure_cookie = build_session_cookie("token", expires_at_ms, &insecure_request);
        let secure_cookie = build_session_cookie("token", expires_at_ms, &secure_request);

        assert!(!insecure_cookie.contains("; Secure"));
        assert!(secure_cookie.contains("; Secure"));
    }
}
