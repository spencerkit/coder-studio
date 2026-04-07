use crate::infra::time::now_ts_ms;
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
        "turn_completed" => Some(SessionStatus::Idle),
        _ => None,
    }
}

fn latest_user_input_for_session(session: &SessionInfo) -> String {
    session
        .messages
        .iter()
        .rev()
        .find(|message| matches!(message.role, SessionMessageRole::User))
        .map(|message| message.content.trim().to_string())
        .filter(|content| !content.is_empty())
        .unwrap_or_default()
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
    let state: State<AppState> = app.state();
    let mut session = crate::services::workspace::resolve_session_for_slot(
        state,
        &envelope.workspace_id,
        &envelope.session_id,
    )?;
    let adapter =
        crate::services::provider_registry::resolve_provider_adapter(session.provider.as_str())
            .ok_or_else(|| format!("unknown_provider:{}", session.provider.as_str()))?;

    if let Some(resume_id) = adapter.extract_resume_id(&envelope.payload) {
        session.resume_id = Some(resume_id.clone());
        session.last_active_at = now_ts_ms();
        let _ = upsert_workspace_session_binding(
            state,
            &envelope.workspace_id,
            WorkspaceSessionBinding {
                session_id: envelope.session_id.clone(),
                provider: session.provider.clone(),
                mode: session.mode.clone(),
                resume_id: Some(resume_id),
                title_snapshot: session.title.clone(),
                last_seen_at: session.last_active_at,
            },
        );
        let _ = crate::services::workspace::remember_live_session(
            state,
            &envelope.workspace_id,
            &session,
        );
        resume_debug_log(format!(
            "provider_hook saved resume_id workspace_id={} session_id={} provider={}",
            envelope.workspace_id,
            envelope.session_id,
            session.provider.as_str()
        ));
    }

    let mut normalized = adapter
        .normalize_hook_payload(&envelope.payload)
        .ok_or_else(|| "unsupported_hook_payload".to_string())?;
    normalized.workspace_id = envelope.workspace_id.clone();
    normalized.session_id = envelope.session_id.clone();
    let latest_user_input = latest_user_input_for_session(&session);

    if let Some(status) = lifecycle_status_for_hook(normalized.kind.as_str()) {
        let updated = sync_session_status(
            state,
            &normalized.workspace_id,
            &normalized.session_id,
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

    if normalized.kind == "turn_completed" {
        let _ = crate::services::supervisor::handle_supervisor_turn_completed(
            app,
            &normalized.workspace_id,
            &normalized.session_id,
            &format!("{}:{}", normalized.source_event, normalized.kind),
            &latest_user_input,
            &normalized.data,
        );
    }

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
        "/bin/sh -lc '[ -n \"${CODER_STUDIO_APP_BIN:-}\" ] || exit 0; exec \"$CODER_STUDIO_APP_BIN\" --coder-studio-agent-hook'".to_string()
    } else {
        #[cfg(target_os = "windows")]
        {
            "cmd /d /c \"if not defined CODER_STUDIO_APP_BIN exit /b 0 & \\\"%CODER_STUDIO_APP_BIN%\\\" --coder-studio-agent-hook\"".to_string()
        }
        #[cfg(not(target_os = "windows"))]
        {
            "/bin/sh -lc '[ -n \"${CODER_STUDIO_APP_BIN:-}\" ] || exit 0; exec \"$CODER_STUDIO_APP_BIN\" --coder-studio-agent-hook'".to_string()
        }
    }
}

pub(crate) fn build_shared_hook_command_for_current_env() -> String {
    build_shared_hook_command(&ExecTarget::Native)
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
    use crate::infra::db::with_db;
    use crate::runtime::RuntimeHandle;
    use std::process::Command;

    fn test_app() -> AppHandle {
        let (app, _shutdown_rx) = RuntimeHandle::new();
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        *app.state().db.lock().unwrap() = Some(conn);
        app
    }

    fn drain_transport_events(rx: &mut broadcast::Receiver<TransportEvent>) -> Vec<TransportEvent> {
        let mut events = Vec::new();
        while let Ok(event) = rx.try_recv() {
            events.push(event);
        }
        events
    }

    fn load_view_state_for_test(app: &AppHandle, workspace_id: &str) -> WorkspaceViewState {
        with_db(app.state(), |conn| {
            let payload: String = conn
                .query_row(
                    "SELECT payload FROM workspace_view_state WHERE workspace_id = ?1",
                    params![workspace_id],
                    |row: &rusqlite::Row<'_>| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            serde_json::from_str(&payload).map_err(|e| e.to_string())
        })
        .expect("view state should load")
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
        let session = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            ProviderId::claude(),
            state,
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
    fn shared_hook_processor_persists_resume_id_without_changing_status_and_stop_drives_idle() {
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
        let session = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            ProviderId::codex(),
            state,
        )
        .unwrap();
        patch_workspace_view_state(
            app.state(),
            &workspace_id,
            WorkspaceViewPatch {
                active_session_id: Some(session.id.clone()),
                active_pane_id: Some(format!("pane-{}", session.id)),
                pane_layout: Some(json!({
                    "type": "leaf",
                    "id": format!("pane-{}", session.id),
                    "sessionId": session.id.clone(),
                })),
                ..WorkspaceViewPatch::default()
            },
        )
        .expect("view state should track the session slot");

        let session_id = session.id.clone();
        let original = load_session(app.state(), &workspace_id, &session_id).unwrap();

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

        let after_start = load_session(app.state(), &workspace_id, &session_id).unwrap();
        assert_eq!(after_start.resume_id.as_deref(), Some("codex-resume-1"));
        assert_eq!(after_start.status, original.status);
        let view_state = load_view_state_for_test(&app, &workspace_id);
        assert_eq!(view_state.session_bindings.len(), 1);
        assert_eq!(view_state.session_bindings[0].session_id, session_id);
        assert_eq!(
            view_state.session_bindings[0].provider,
            AgentProvider::codex()
        );
        assert_eq!(
            view_state.session_bindings[0].resume_id.as_deref(),
            Some("codex-resume-1")
        );
        assert_eq!(view_state.session_bindings[0].title_snapshot, after_start.title);

        set_session_status(
            app.state(),
            &workspace_id,
            &session_id,
            SessionStatus::Running,
        )
        .unwrap();
        let mut rx = app.state().transport_events.subscribe();
        let _ = drain_transport_events(&mut rx);

        let stop_payload = json!({
            "workspace_id": workspace_id,
            "session_id": session.id.to_string(),
            "payload": {
                "hook_event_name": "Stop"
            }
        });

        process_provider_hook_payload(&app, stop_payload).unwrap();
        let stopped = load_session(app.state(), &workspace_id, &session_id).unwrap();
        assert_eq!(stopped.status, SessionStatus::Interrupted);
        let events = drain_transport_events(&mut rx);
        let payload = events
            .iter()
            .find(|event| event.event == "workspace://runtime_state")
            .map(|event| &event.payload)
            .expect("expected runtime state transport event");
        assert_eq!(payload["workspace_id"], workspace_id);
        assert_eq!(payload["session_state"]["session_id"], session_id);
        assert_eq!(payload["session_state"]["status"], "idle");
    }

    #[test]
    fn shared_hook_processor_rejects_removed_provider_lifecycle_events() {
        let app = test_app();
        let workspace = launch_workspace_record(
            app.state(),
            WorkspaceSource {
                kind: WorkspaceSourceKind::Local,
                path_or_url: "/tmp/ws-hook-unsupported".to_string(),
                target: ExecTarget::Native,
            },
            "/tmp/ws-hook-unsupported".to_string(),
            default_idle_policy(),
        )
        .unwrap();
        let state: State<AppState> = app.state();
        let workspace_id = workspace.snapshot.workspace.workspace_id;
        let session = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            ProviderId::claude(),
            state,
        )
        .unwrap();

        for hook_event_name in [
            "SessionEnd",
            "UserPromptSubmit",
            "PreToolUse",
            "PostToolUse",
            "Notification",
        ] {
            let payload = json!({
                "workspace_id": workspace_id,
                "session_id": session.id.to_string(),
                "payload": {
                    "hook_event_name": hook_event_name
                }
            });
            let error = process_provider_hook_payload(&app, payload).unwrap_err();
            assert_eq!(error, "unsupported_hook_payload");
        }
    }

    #[test]
    fn shared_hook_processor_uses_latest_user_message_for_supervisor_turns() {
        let _guard = crate::services::supervisor::supervisor_reply_test_lock()
            .lock()
            .unwrap();
        let app = test_app();
        let workspace = launch_workspace_record(
            app.state(),
            WorkspaceSource {
                kind: WorkspaceSourceKind::Local,
                path_or_url: "/tmp/ws-hook-supervisor-input".to_string(),
                target: ExecTarget::Native,
            },
            "/tmp/ws-hook-supervisor-input".to_string(),
            default_idle_policy(),
        )
        .unwrap();
        let state: State<AppState> = app.state();
        let workspace_id = workspace.snapshot.workspace.workspace_id;
        let session = create_session(
            workspace_id.clone(),
            SessionMode::Branch,
            ProviderId::claude(),
            state,
        )
        .unwrap();
        session_update(
            workspace_id.clone(),
            session.id.clone(),
            SessionPatch {
                title: None,
                status: None,
                mode: None,
                auto_feed: None,
                queue: None,
                messages: Some(vec![SessionMessage {
                    id: "msg-user-1".to_string(),
                    role: SessionMessageRole::User,
                    content: "Please keep the business agent focused on xterm.".to_string(),
                    time: "2026-04-06T00:00:00.000Z".to_string(),
                }]),
                unread: None,
                last_active_at: None,
                resume_id: None,
            },
            state,
        )
        .unwrap();
        crate::services::supervisor::seed_supervisor_binding_for_test(
            state,
            &workspace_id,
            &session.id,
            "Keep using xterm",
        );
        crate::services::supervisor::bind_terminal_for_session_for_test(
            state,
            &workspace_id,
            &session.id,
            91,
        );
        crate::services::supervisor::install_supervisor_adapter_reply_for_test("Use xterm only.");

        let payload = json!({
            "workspace_id": workspace_id,
            "session_id": session.id,
            "payload": {
                "hook_event_name": "Stop"
            }
        });

        let result = process_provider_hook_payload(&app, payload);
        crate::services::supervisor::clear_supervisor_adapter_reply_for_test();
        result.unwrap();

        let view_state = load_view_state_for_test(&app, &workspace_id);
        assert_eq!(view_state.supervisor.cycles.len(), 1);
        assert!(view_state.supervisor.cycles[0]
            .supervisor_input
            .contains("Please keep the business agent focused on xterm."));
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn shared_hook_command_is_noop_when_app_bin_is_missing() {
        let command = build_shared_hook_command(&ExecTarget::Native);
        let status = Command::new("/bin/sh")
            .arg("-lc")
            .arg(&command)
            .env_remove("CODER_STUDIO_APP_BIN")
            .status()
            .expect("shell should run hook command");

        assert!(
            status.success(),
            "hook command should no-op when app bin is missing"
        );
    }
}
