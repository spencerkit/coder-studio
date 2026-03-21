use crate::ws::protocol::{WsClientEnvelope, WsEnvelope};
use crate::*;

fn request_forces_public_mode(uri: &axum::http::Uri) -> bool {
    uri.query()
        .map(|query| {
            url::form_urlencoded::parse(query.as_bytes())
                .any(|(key, value)| key == "auth" && value.eq_ignore_ascii_case("force"))
        })
        .unwrap_or(false)
}

pub(crate) async fn ws_handler(
    ws: WebSocketUpgrade,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    ConnectInfo(client_addr): ConnectInfo<std::net::SocketAddr>,
    AxumState(state): AxumState<HttpServerState>,
) -> impl IntoResponse {
    if let Err(error) = require_session(
        &state.app,
        &headers,
        client_addr,
        request_forces_public_mode(&uri),
    ) {
        return error.into_response(&RequestContext {
            ip: client_addr.ip().to_string(),
            user_agent: String::new(),
            is_local_host: client_addr.ip().is_loopback(),
            is_secure_transport: false,
            public_mode: true,
        });
    }
    ws.on_upgrade(move |socket| ws_session(socket, state.app))
}

pub(crate) async fn ws_session(mut socket: WebSocket, app: AppHandle) {
    let state: State<AppState> = app.state();
    let mut rx = state.transport_events.subscribe();

    loop {
        tokio::select! {
            message = socket.recv() => {
                match message {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Text(text))) => {
                        let Ok(envelope) = serde_json::from_str::<WsClientEnvelope>(&text) else {
                            continue;
                        };
                        match envelope {
                            WsClientEnvelope::Ping { ts } => {
                                let Ok(body) = serde_json::to_string(&WsEnvelope::Pong { ts }) else {
                                    continue;
                                };
                                if socket.send(Message::Text(body)).await.is_err() {
                                    break;
                                }
                            }
                            WsClientEnvelope::Pong { .. } => {}
                        }
                    }
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            event = rx.recv() => {
                match event {
                    Ok(event) => {
                        let envelope = WsEnvelope::Event {
                            event: event.event,
                            payload: event.payload,
                        };
                        let Ok(text) = serde_json::to_string(&envelope) else {
                            continue;
                        };
                        if socket.send(Message::Text(text)).await.is_err() {
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

pub(crate) fn agent_key(workspace_id: &str, session_id: &str) -> String {
    format!("{}:{}", workspace_id, session_id)
}

pub(crate) fn terminal_key(workspace_id: &str, terminal_id: u64) -> String {
    format!("{}:{}", workspace_id, terminal_id)
}

pub(crate) fn emit_transport_event(app: &AppHandle, event: &str, payload: Value) {
    let state: State<AppState> = app.state();
    let _ = state.transport_events.send(TransportEvent {
        event: event.to_string(),
        payload,
    });
}

pub(crate) fn emit_agent(
    app: &AppHandle,
    workspace_id: &str,
    session_id: &str,
    kind: &str,
    data: &str,
) {
    emit_transport_event(
        app,
        "agent://event",
        json!({
            "workspace_id": workspace_id,
            "session_id": session_id,
            "kind": kind,
            "data": data,
        }),
    );
    let _ = app.emit(
        "agent://event",
        AgentEvent {
            workspace_id: workspace_id.to_string(),
            session_id: session_id.to_string(),
            kind: kind.to_string(),
            data: data.to_string(),
        },
    );
}

pub(crate) fn emit_terminal(
    app: &AppHandle,
    workspace_id: &str,
    terminal_id: u64,
    data: &str,
) {
    emit_transport_event(
        app,
        "terminal://event",
        json!({
            "workspace_id": workspace_id,
            "terminal_id": terminal_id,
            "data": data,
        }),
    );
    let _ = app.emit(
        "terminal://event",
        TerminalEvent {
            workspace_id: workspace_id.to_string(),
            terminal_id,
            data: data.to_string(),
        },
    );
}

pub(crate) fn emit_agent_lifecycle(
    app: &AppHandle,
    workspace_id: &str,
    session_id: &str,
    kind: &str,
    source_event: &str,
    data: &str,
) {
    emit_transport_event(
        app,
        "agent://lifecycle",
        json!({
            "workspace_id": workspace_id,
            "session_id": session_id,
            "kind": kind,
            "source_event": source_event,
            "data": data,
        }),
    );
    let _ = app.emit(
        "agent://lifecycle",
        AgentLifecycleEvent {
            workspace_id: workspace_id.to_string(),
            session_id: session_id.to_string(),
            kind: kind.to_string(),
            source_event: source_event.to_string(),
            data: data.to_string(),
        },
    );
}
