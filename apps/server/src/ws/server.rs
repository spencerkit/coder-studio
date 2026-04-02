use std::{pin::Pin, time::Duration};

use futures_util::{Sink, SinkExt, StreamExt};
use tokio::sync::{oneshot, Mutex as AsyncMutex, Notify};

use crate::ws::outbound_batcher::{OutboundBatcher, OutboundSendQueue};
use crate::ws::protocol::{WsClientEnvelope, WsEnvelope};
use crate::*;

const WS_OUTBOUND_BATCH_INTERVAL_MS: u64 = 16;
const WS_OUTBOUND_BATCH_FLUSH_THRESHOLD_BYTES: usize = 32 * 1024;
const WS_OUTBOUND_PENDING_STREAM_CAP_BYTES: usize = 256 * 1024;

fn request_forces_public_mode(uri: &axum::http::Uri) -> bool {
    uri.query()
        .map(|query| {
            url::form_urlencoded::parse(query.as_bytes())
                .any(|(key, value)| key == "auth" && value.eq_ignore_ascii_case("force"))
        })
        .unwrap_or(false)
}

fn workspace_client_from_uri(uri: &axum::http::Uri) -> Option<(String, String)> {
    let mut device_id = None;
    let mut client_id = None;
    for (key, value) in url::form_urlencoded::parse(uri.query()?.as_bytes()) {
        if key == "device_id" && !value.is_empty() {
            device_id = Some(value.to_string());
        } else if key == "client_id" && !value.is_empty() {
            client_id = Some(value.to_string());
        }
    }
    Some((device_id?, client_id?))
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
    let workspace_client = workspace_client_from_uri(&uri);
    ws.on_upgrade(move |socket| ws_session(socket, state.app, workspace_client))
}

pub(crate) async fn ws_session(
    socket: WebSocket,
    app: AppHandle,
    workspace_client: Option<(String, String)>,
) {
    let state: State<AppState> = app.state();
    if let Some((device_id, client_id)) = workspace_client.as_ref() {
        let _ = register_workspace_client_connection(device_id, client_id, state);
    }
    let (socket_tx, mut socket_rx) = socket.split();
    let mut rx = state.transport_events.subscribe();
    let mut batcher = OutboundBatcher::new(WS_OUTBOUND_BATCH_FLUSH_THRESHOLD_BYTES);
    let outbound_queue = Arc::new(AsyncMutex::new(OutboundSendQueue::new(
        WS_OUTBOUND_PENDING_STREAM_CAP_BYTES,
    )));
    let outbound_notify = Arc::new(Notify::new());
    let (sender_done_tx, mut sender_done_rx) = oneshot::channel();
    let sender_queue = outbound_queue.clone();
    let sender_notify = outbound_notify.clone();
    let sender_task = tokio::spawn(async move {
        run_ws_sender(socket_tx, sender_queue, sender_notify).await;
        let _ = sender_done_tx.send(());
    });
    let mut flush_timer: Pin<Box<tokio::time::Sleep>> =
        Box::pin(tokio::time::sleep(Duration::from_secs(24 * 60 * 60)));
    let mut flush_timer_armed = false;
    let mut sender_running = true;

    loop {
        tokio::select! {
            _ = &mut sender_done_rx, if sender_running => {
                sender_running = false;
                break;
            }
            message = socket_rx.next() => {
                match message {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Text(text))) => {
                        let Ok(envelope) = serde_json::from_str::<WsClientEnvelope>(&text) else {
                            continue;
                        };
                        let response = match handle_ws_client_envelope(
                            envelope,
                            &app,
                            workspace_client.as_ref(),
                        ) {
                            Ok(response) => response,
                            Err(response) => Some(response),
                        };
                        if let Some(response) = response {
                            if flush_timer_armed {
                                enqueue_transport_events(
                                    &outbound_queue,
                                    &outbound_notify,
                                    batcher.flush(),
                                ).await;
                            }
                            flush_timer_armed = false;
                            enqueue_ws_envelope(&outbound_queue, &outbound_notify, response).await;
                        }
                    }
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            event = rx.recv() => {
                match event {
                    Ok(event) => {
                        let outbound = batcher.push(event);
                        if batcher.has_pending() && !flush_timer_armed {
                            flush_timer.as_mut().reset(tokio::time::Instant::now() + Duration::from_millis(WS_OUTBOUND_BATCH_INTERVAL_MS));
                            flush_timer_armed = true;
                        }
                        if !outbound.is_empty() {
                            flush_timer_armed = false;
                            enqueue_transport_events(&outbound_queue, &outbound_notify, outbound).await;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }
            _ = &mut flush_timer, if flush_timer_armed => {
                flush_timer_armed = false;
                enqueue_transport_events(&outbound_queue, &outbound_notify, batcher.flush()).await;
            }
        }
    }

    if sender_running {
        if batcher.has_pending() {
            enqueue_transport_events(&outbound_queue, &outbound_notify, batcher.flush()).await;
        }
        let stats = {
            let mut queue = outbound_queue.lock().await;
            queue.close();
            let mut stats = queue.stats();
            stats.pending_stream_bytes = stats
                .pending_stream_bytes
                .saturating_add(batcher.pending_stream_bytes());
            stats
        };
        outbound_notify.notify_waiters();
        let _ = sender_task.await;
        if stats.collapse_count > 0 || stats.drop_count > 0 {
            eprintln!(
                "ws outbound backpressure: flushes={} collapses={} drops={} pending_stream_bytes={}",
                stats.flush_count,
                stats.collapse_count,
                stats.drop_count,
                stats.pending_stream_bytes
            );
        }
    } else {
        let _ = sender_task.await;
    }

    if let Some((device_id, client_id)) = workspace_client {
        let _ = unregister_workspace_client_connection(&device_id, &client_id, &app, app.state());
    }
}

async fn enqueue_transport_events(
    queue: &Arc<AsyncMutex<OutboundSendQueue>>,
    notify: &Notify,
    events: Vec<TransportEvent>,
) {
    if events.is_empty() {
        return;
    }
    {
        let mut queue = queue.lock().await;
        queue.enqueue_transport_events(events);
    }
    notify.notify_one();
}

async fn enqueue_ws_envelope(
    queue: &Arc<AsyncMutex<OutboundSendQueue>>,
    notify: &Notify,
    envelope: WsEnvelope,
) {
    {
        let mut queue = queue.lock().await;
        queue.enqueue_ws_envelope(envelope);
    }
    notify.notify_one();
}

async fn run_ws_sender<S>(
    mut socket_tx: S,
    queue: Arc<AsyncMutex<OutboundSendQueue>>,
    notify: Arc<Notify>,
) where
    S: Sink<Message> + Unpin,
{
    loop {
        let next = {
            let mut queue = queue.lock().await;
            if let Some(envelope) = queue.pop_front() {
                Some(envelope)
            } else if queue.is_closed() {
                None
            } else {
                drop(queue);
                notify.notified().await;
                continue;
            }
        };

        let Some(envelope) = next else {
            return;
        };
        if send_ws_envelope(&mut socket_tx, envelope).await.is_err() {
            return;
        }
    }
}

async fn send_ws_envelope<S>(socket: &mut S, envelope: WsEnvelope) -> Result<(), ()>
where
    S: Sink<Message> + Unpin,
{
    let Ok(body) = serde_json::to_string(&envelope) else {
        return Ok(());
    };
    if socket.send(Message::Text(body)).await.is_err() {
        return Err(());
    }
    Ok(())
}

fn require_ws_workspace_controller_mutation(
    workspace_id: &str,
    fencing_token: i64,
    workspace_client: Option<&(String, String)>,
    app: &AppHandle,
) -> Result<(), String> {
    let (device_id, client_id) = workspace_client.ok_or("workspace_client_missing")?;
    assert_workspace_controller_can_mutate(
        workspace_id,
        device_id,
        client_id,
        fencing_token,
        app,
        app.state(),
    )
    .map(|_| ())
}

fn ws_input_error_envelope(workspace_id: &str, kind: &str, error: &str) -> WsEnvelope {
    WsEnvelope::Event {
        event: "workspace://input_error".to_string(),
        payload: json!({
            "workspace_id": workspace_id,
            "kind": kind,
            "error": error,
        }),
    }
}

fn handle_ws_client_envelope(
    envelope: WsClientEnvelope,
    app: &AppHandle,
    workspace_client: Option<&(String, String)>,
) -> Result<Option<WsEnvelope>, WsEnvelope> {
    match envelope {
        WsClientEnvelope::Ping { ts } => Ok(Some(WsEnvelope::Pong { ts })),
        WsClientEnvelope::Pong { .. } => Ok(None),
        WsClientEnvelope::TerminalWrite {
            workspace_id,
            terminal_id,
            input,
            fencing_token,
        } => {
            require_ws_workspace_controller_mutation(
                &workspace_id,
                fencing_token,
                workspace_client,
                app,
            )
            .map_err(|error| ws_input_error_envelope(&workspace_id, "terminal_write", &error))?;
            terminal_write(workspace_id.clone(), terminal_id, input, app.state()).map_err(
                |error| ws_input_error_envelope(&workspace_id, "terminal_write", &error),
            )?;
            Ok(None)
        }
        WsClientEnvelope::TerminalResize {
            workspace_id,
            terminal_id,
            cols,
            rows,
            fencing_token,
        } => {
            require_ws_workspace_controller_mutation(
                &workspace_id,
                fencing_token,
                workspace_client,
                app,
            )
            .map_err(|error| ws_input_error_envelope(&workspace_id, "terminal_resize", &error))?;
            terminal_resize(workspace_id.clone(), terminal_id, cols, rows, app.state()).map_err(
                |error| ws_input_error_envelope(&workspace_id, "terminal_resize", &error),
            )?;
            Ok(None)
        }
        WsClientEnvelope::SessionUpdate {
            workspace_id,
            session_id,
            patch,
            fencing_token,
        } => {
            require_ws_workspace_controller_mutation(
                &workspace_id,
                fencing_token,
                workspace_client,
                app,
            )
            .map_err(|error| ws_input_error_envelope(&workspace_id, "session_update", &error))?;
            session_update(workspace_id.clone(), session_id, patch, app.state()).map_err(
                |error| ws_input_error_envelope(&workspace_id, "session_update", &error),
            )?;
            Ok(None)
        }
        WsClientEnvelope::WorkspaceControllerHeartbeat { workspace_id } => {
            let (device_id, client_id) = workspace_client.ok_or_else(|| {
                ws_input_error_envelope(
                    &workspace_id,
                    "workspace_controller_heartbeat",
                    "workspace_client_missing",
                )
            })?;
            workspace_controller_heartbeat(
                workspace_id.clone(),
                device_id.clone(),
                client_id.clone(),
                app.clone(),
                app.state(),
            )
            .map_err(|error| {
                ws_input_error_envelope(&workspace_id, "workspace_controller_heartbeat", &error)
            })?;
            Ok(None)
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
    raw_data: Option<&str>,
) {
    emit_transport_event(
        app,
        "agent://event",
        json!({
            "workspace_id": workspace_id,
            "session_id": session_id,
            "kind": kind,
            "data": data,
            "raw_data": raw_data,
        }),
    );
    let _ = app.emit(
        "agent://event",
        AgentEvent {
            workspace_id: workspace_id.to_string(),
            session_id: session_id.to_string(),
            kind: kind.to_string(),
            data: data.to_string(),
            raw_data: raw_data.map(str::to_string),
        },
    );
}

pub(crate) fn emit_terminal(app: &AppHandle, workspace_id: &str, terminal_id: u64, data: &str) {
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
    let state: State<AppState> = app.state();
    let _ = append_agent_lifecycle_event(state, workspace_id, session_id, kind, source_event, data);
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

pub(crate) fn emit_workspace_artifacts_dirty(
    app: &AppHandle,
    path: &str,
    target: &ExecTarget,
    reason: &str,
) {
    let categories = artifact_dirty_categories(reason);
    emit_transport_event(
        app,
        "workspace://artifacts_dirty",
        json!({
            "path": path,
            "target": target,
            "reason": reason,
            "categories": categories,
        }),
    );
}

fn artifact_dirty_categories(reason: &str) -> Vec<&'static str> {
    match reason {
        "git_stage_all" | "git_stage_file" | "git_unstage_all" | "git_unstage_file" => {
            vec!["git", "worktrees"]
        }
        "git_discard_all" | "git_discard_file" | "git_commit" => {
            vec!["git", "worktrees", "tree"]
        }
        _ => vec!["full"],
    }
}

#[cfg(test)]
mod tests {
    use super::artifact_dirty_categories;

    #[test]
    fn artifact_dirty_categories_keep_tree_off_for_index_only_git_changes() {
        assert_eq!(
            artifact_dirty_categories("git_stage_all"),
            vec!["git", "worktrees"]
        );
    }

    #[test]
    fn artifact_dirty_categories_include_tree_for_git_mutations_that_change_sidebar_paths() {
        assert_eq!(
            artifact_dirty_categories("git_commit"),
            vec!["git", "worktrees", "tree"]
        );
        assert_eq!(
            artifact_dirty_categories("git_discard_all"),
            vec!["git", "worktrees", "tree"]
        );
        assert_eq!(
            artifact_dirty_categories("git_discard_file"),
            vec!["git", "worktrees", "tree"]
        );
    }
}
