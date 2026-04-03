use crate::*;

pub(crate) fn parse_http_endpoint(endpoint: &str) -> Option<(String, u16, String)> {
    let trimmed = endpoint.trim();
    let without_scheme = trimmed.strip_prefix("http://")?;
    let (host_port, path) = without_scheme
        .split_once('/')
        .unwrap_or((without_scheme, ""));
    let (host, port_raw) = host_port.rsplit_once(':')?;
    let port = port_raw.parse::<u16>().ok()?;
    Some((host.to_string(), port, format!("/{}", path)))
}

#[derive(Deserialize)]
pub(crate) struct ProviderHookEnvelope {
    pub(crate) workspace_id: String,
    pub(crate) session_id: String,
    pub(crate) payload: Value,
}

fn resume_debug_enabled() -> bool {
    std::env::var("CODER_STUDIO_DEBUG_RESUME")
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            !normalized.is_empty() && normalized != "0" && normalized != "false"
        })
        .unwrap_or(false)
}

fn resume_debug_log(message: impl AsRef<str>) {
    if resume_debug_enabled() {
        eprintln!("[resume-debug] {}", message.as_ref());
    }
}

fn lifecycle_status_for_hook(kind: &str) -> Option<SessionStatus> {
    match kind {
        "session_started" | "tool_started" | "tool_finished" => Some(SessionStatus::Running),
        "turn_waiting" | "approval_required" => Some(SessionStatus::Waiting),
        "turn_completed" | "session_ended" => Some(SessionStatus::Idle),
        _ => None,
    }
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

pub(crate) fn process_provider_hook_payload(
    app: &AppHandle,
    value: Value,
) -> Result<AgentLifecycleEvent, String> {
    let envelope: ProviderHookEnvelope =
        serde_json::from_value(value).map_err(|e| e.to_string())?;
    let session_id_num = envelope
        .session_id
        .parse::<u64>()
        .map_err(|_| "invalid_session_id".to_string())?;
    let state: State<AppState> = app.state();
    let session = load_session(state, &envelope.workspace_id, session_id_num)?;
    let adapter =
        crate::services::provider_registry::resolve_provider_adapter(session.provider.as_str())
            .ok_or_else(|| format!("unknown_provider:{}", session.provider.as_str()))?;

    if let Some(resume_id) = adapter.extract_resume_id(&envelope.payload) {
        let _ = set_session_resume_id(state, &envelope.workspace_id, session_id_num, resume_id);
        resume_debug_log(format!(
            "provider_hook saved resume_id workspace_id={} session_id={} provider={}",
            envelope.workspace_id, envelope.session_id, session.provider.as_str()
        ));
    }

    let mut normalized = adapter
        .normalize_hook_payload(&envelope.payload)
        .ok_or_else(|| "unsupported_hook_payload".to_string())?;
    normalized.workspace_id = envelope.workspace_id.clone();
    normalized.session_id = envelope.session_id.clone();

    if let Some(status) = lifecycle_status_for_hook(normalized.kind.as_str()) {
        let updated = set_session_status_if_not_archived(
            state,
            &normalized.workspace_id,
            session_id_num,
            status.clone(),
        )?;
        resume_debug_log(format!(
            "provider_hook synced status workspace_id={} session_id={} kind={} status={} updated={}",
            normalized.workspace_id,
            normalized.session_id,
            normalized.kind,
            status_label(&status),
            updated
        ));
    } else {
        resume_debug_log(format!(
            "provider_hook received lifecycle without status mapping workspace_id={} session_id={} kind={}",
            normalized.workspace_id, normalized.session_id, normalized.kind
        ));
    }

    emit_agent_lifecycle(
        app,
        &normalized.workspace_id,
        &normalized.session_id,
        &normalized.kind,
        &normalized.source_event,
        &normalized.data,
    );

    Ok(normalized)
}

pub(crate) fn start_provider_hook_receiver(app: &AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let endpoint = format!(
        "http://127.0.0.1:{}/agent-hook",
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
                Ok(body) => match process_provider_hook_payload(&app_handle, body) {
                    Ok(_) => respond_http(stream, "200 OK", "ok"),
                    Err(_) => respond_http(stream, "400 Bad Request", "invalid_payload"),
                },
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

pub(crate) fn current_hook_endpoint(app: &AppHandle) -> Result<String, String> {
    let state: State<AppState> = app.state();
    let guard = state.hook_endpoint.lock().map_err(|e| e.to_string())?;
    guard.clone().ok_or("hook_endpoint_not_ready".to_string())
}

pub(crate) fn build_shared_hook_command(target: &ExecTarget) -> String {
    if matches!(target, ExecTarget::Wsl { .. }) {
        "\"$CODER_STUDIO_APP_BIN\" --coder-studio-agent-hook".to_string()
    } else {
        #[cfg(target_os = "windows")]
        {
            "\"%CODER_STUDIO_APP_BIN%\" --coder-studio-agent-hook".to_string()
        }
        #[cfg(not(target_os = "windows"))]
        {
            "\"$CODER_STUDIO_APP_BIN\" --coder-studio-agent-hook".to_string()
        }
    }
}

pub(crate) fn current_app_bin_for_target(target: &ExecTarget) -> Result<String, String> {
    let current = std::env::current_exe().map_err(|e| e.to_string())?;
    let raw = current.to_string_lossy().to_string();
    resolve_target_path(&raw, target)
}

pub(crate) fn run_provider_hook_helper() {
    let _ = (|| -> Result<(), String> {
        let endpoint = std::env::var("CODER_STUDIO_HOOK_ENDPOINT").map_err(|e| e.to_string())?;
        let workspace_id = std::env::var("CODER_STUDIO_WORKSPACE_ID").map_err(|e| e.to_string())?;
        let session_id = std::env::var("CODER_STUDIO_SESSION_ID").map_err(|e| e.to_string())?;
        let (host, port, path) = parse_http_endpoint(&endpoint).ok_or("invalid_hook_endpoint")?;

        let mut stdin = String::new();
        std::io::stdin()
            .read_to_string(&mut stdin)
            .map_err(|e| e.to_string())?;
        let payload = serde_json::from_str::<Value>(&stdin).map_err(|e| e.to_string())?;
        let body = json!({
            "workspace_id": workspace_id,
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
    fn shared_hook_processor_uses_session_provider_to_normalize_payload() {
        let app = test_app();
        let workspace = launch_workspace_record(
            app.state(),
            WorkspaceSource {
                kind: WorkspaceSourceKind::Local,
                path_or_url: "/tmp/ws-hook-provider".to_string(),
                target: ExecTarget::Native,
            },
            "/tmp/ws-hook-provider".to_string(),
            default_idle_policy(),
        )
        .unwrap();
        let state: State<AppState> = app.state();
        let workspace_id = workspace.snapshot.workspace.workspace_id;
        let session = create_workspace_session(
            state,
            &workspace_id,
            SessionMode::Branch,
            ProviderId::claude(),
        )
        .unwrap();

        let payload = json!({
            "workspace_id": workspace_id,
            "session_id": session.id.to_string(),
            "payload": {
                "hook_event_name": "SessionStart",
                "session_id": "claude-resume-1"
            }
        });

        let normalized = process_provider_hook_payload(&app, payload).unwrap();
        assert_eq!(normalized.kind, "session_started");
        assert_eq!(normalized.session_id, session.id.to_string());
    }

    #[test]
    fn shared_hook_processor_persists_resume_id_and_runtime_status() {
        let app = test_app();
        let workspace = launch_workspace_record(
            app.state(),
            WorkspaceSource {
                kind: WorkspaceSourceKind::Local,
                path_or_url: "/tmp/ws-hook-status".to_string(),
                target: ExecTarget::Native,
            },
            "/tmp/ws-hook-status".to_string(),
            default_idle_policy(),
        )
        .unwrap();
        let state: State<AppState> = app.state();
        let workspace_id = workspace.snapshot.workspace.workspace_id;
        let session = create_workspace_session(
            state,
            &workspace_id,
            SessionMode::Branch,
            ProviderId::codex(),
        )
        .unwrap();

        let session_start_payload = json!({
            "workspace_id": workspace_id,
            "session_id": session.id.to_string(),
            "payload": {
                "hook_event_name": "SessionStart",
                "session_id": "codex-resume-1"
            }
        });

        let normalized = process_provider_hook_payload(&app, session_start_payload).unwrap();
        assert_eq!(normalized.kind, "session_started");

        let running = load_session(app.state(), &workspace_id, session.id).unwrap();
        assert_eq!(running.resume_id.as_deref(), Some("codex-resume-1"));
        assert_eq!(running.status, SessionStatus::Running);

        let waiting_payload = json!({
            "workspace_id": workspace_id,
            "session_id": session.id.to_string(),
            "payload": {
                "hook_event_name": "UserPromptSubmit"
            }
        });

        process_provider_hook_payload(&app, waiting_payload).unwrap();
        let waiting = load_session(app.state(), &workspace_id, session.id).unwrap();
        assert_eq!(waiting.status, SessionStatus::Waiting);

        let stop_payload = json!({
            "workspace_id": workspace_id,
            "session_id": session.id.to_string(),
            "payload": {
                "hook_event_name": "Stop"
            }
        });

        process_provider_hook_payload(&app, stop_payload).unwrap();
        let stopped = load_session(app.state(), &workspace_id, session.id).unwrap();
        assert_eq!(stopped.status, SessionStatus::Idle);
    }
}
