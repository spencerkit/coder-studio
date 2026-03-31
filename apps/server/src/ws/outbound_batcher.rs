use crate::*;

#[derive(Debug, PartialEq, Eq)]
enum BatchKey {
    Agent {
        workspace_id: String,
        session_id: String,
        kind: String,
    },
    Terminal {
        workspace_id: String,
        terminal_id: u64,
    },
}

#[derive(Debug)]
pub(crate) struct OutboundBatcher {
    pending: Vec<TransportEvent>,
    pending_bytes: usize,
    flush_threshold_bytes: usize,
}

impl OutboundBatcher {
    pub(crate) fn new(flush_threshold_bytes: usize) -> Self {
        Self {
            pending: Vec::new(),
            pending_bytes: 0,
            flush_threshold_bytes,
        }
    }

    pub(crate) fn has_pending(&self) -> bool {
        !self.pending.is_empty()
    }

    pub(crate) fn push(&mut self, event: TransportEvent) -> Vec<TransportEvent> {
        if let Some(key) = batch_key(&event) {
            let data_len = event_data_len(&event.payload);
            if let Some(last) = self.pending.last_mut() {
                if batch_key(last).as_ref() == Some(&key) {
                    append_event_data(last, &event);
                    self.pending_bytes = self.pending_bytes.saturating_add(data_len);
                    if self.pending_bytes >= self.flush_threshold_bytes {
                        return self.flush();
                    }
                    return Vec::new();
                }
            }

            self.pending_bytes = self.pending_bytes.saturating_add(data_len);
            self.pending.push(event);
            if self.pending_bytes >= self.flush_threshold_bytes {
                return self.flush();
            }
            return Vec::new();
        }

        let mut ready = self.flush();
        ready.push(event);
        ready
    }

    pub(crate) fn flush(&mut self) -> Vec<TransportEvent> {
        self.pending_bytes = 0;
        std::mem::take(&mut self.pending)
    }
}

fn event_data_len(payload: &Value) -> usize {
    payload
        .as_object()
        .and_then(|map| map.get("data"))
        .and_then(Value::as_str)
        .map(str::len)
        .unwrap_or_default()
}

fn append_event_data(target: &mut TransportEvent, source: &TransportEvent) {
    let Some(source_data) = source
        .payload
        .as_object()
        .and_then(|map| map.get("data"))
        .and_then(Value::as_str)
    else {
        return;
    };

    let Some(target_payload) = target.payload.as_object_mut() else {
        return;
    };
    let mut merged = target_payload
        .get("data")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    merged.push_str(source_data);
    target_payload.insert("data".to_string(), Value::String(merged));
}

fn batch_key(event: &TransportEvent) -> Option<BatchKey> {
    match event.event.as_str() {
        "agent://event" => {
            let payload = event.payload.as_object()?;
            let kind = payload.get("kind")?.as_str()?;
            if kind != "stdout" && kind != "stderr" {
                return None;
            }
            Some(BatchKey::Agent {
                workspace_id: payload.get("workspace_id")?.as_str()?.to_string(),
                session_id: payload.get("session_id")?.as_str()?.to_string(),
                kind: kind.to_string(),
            })
        }
        "terminal://event" => {
            let payload = event.payload.as_object()?;
            Some(BatchKey::Terminal {
                workspace_id: payload.get("workspace_id")?.as_str()?.to_string(),
                terminal_id: payload.get("terminal_id")?.as_u64()?,
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::OutboundBatcher;
    use crate::*;

    fn agent_stream_event(
        workspace_id: &str,
        session_id: &str,
        kind: &str,
        data: &str,
    ) -> TransportEvent {
        TransportEvent {
            event: "agent://event".to_string(),
            payload: json!({
                "workspace_id": workspace_id,
                "session_id": session_id,
                "kind": kind,
                "data": data,
            }),
        }
    }

    fn terminal_stream_event(workspace_id: &str, terminal_id: u64, data: &str) -> TransportEvent {
        TransportEvent {
            event: "terminal://event".to_string(),
            payload: json!({
                "workspace_id": workspace_id,
                "terminal_id": terminal_id,
                "data": data,
            }),
        }
    }

    fn control_event(workspace_id: &str) -> TransportEvent {
        TransportEvent {
            event: "workspace://runtime_state".to_string(),
            payload: json!({
                "workspace_id": workspace_id,
            }),
        }
    }

    #[test]
    fn outbound_batcher_merges_adjacent_agent_stdout_chunks_for_same_session() {
        let mut batcher = OutboundBatcher::new(32 * 1024);

        assert!(batcher.push(agent_stream_event("ws-1", "session-1", "stdout", "hello ")).is_empty());
        assert!(batcher.push(agent_stream_event("ws-1", "session-1", "stdout", "world")).is_empty());

        let flushed = batcher.flush();
        assert_eq!(flushed.len(), 1);
        assert_eq!(flushed[0].event, "agent://event");
        assert_eq!(flushed[0].payload["data"], Value::String("hello world".to_string()));
    }

    #[test]
    fn outbound_batcher_merges_adjacent_terminal_chunks_for_same_terminal() {
        let mut batcher = OutboundBatcher::new(32 * 1024);

        assert!(batcher.push(terminal_stream_event("ws-1", 7, "abc")).is_empty());
        assert!(batcher.push(terminal_stream_event("ws-1", 7, "def")).is_empty());

        let flushed = batcher.flush();
        assert_eq!(flushed.len(), 1);
        assert_eq!(flushed[0].event, "terminal://event");
        assert_eq!(flushed[0].payload["data"], Value::String("abcdef".to_string()));
    }

    #[test]
    fn outbound_batcher_flushes_pending_streams_before_control_events() {
        let mut batcher = OutboundBatcher::new(32 * 1024);

        assert!(batcher.push(agent_stream_event("ws-1", "session-1", "stdout", "hello")).is_empty());

        let flushed = batcher.push(control_event("ws-1"));
        assert_eq!(flushed.len(), 2);
        assert_eq!(flushed[0].event, "agent://event");
        assert_eq!(flushed[1].event, "workspace://runtime_state");
    }

    #[test]
    fn outbound_batcher_does_not_merge_different_sessions() {
        let mut batcher = OutboundBatcher::new(32 * 1024);

        assert!(batcher.push(agent_stream_event("ws-1", "session-1", "stdout", "hello")).is_empty());
        assert!(batcher.push(agent_stream_event("ws-1", "session-2", "stdout", "world")).is_empty());

        let flushed = batcher.flush();
        assert_eq!(flushed.len(), 2);
        assert_eq!(flushed[0].payload["session_id"], Value::String("session-1".to_string()));
        assert_eq!(flushed[1].payload["session_id"], Value::String("session-2".to_string()));
    }
}
