use std::collections::VecDeque;

use crate::ws::protocol::WsEnvelope;
use crate::*;

#[derive(Debug, Clone, PartialEq, Eq)]
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

enum QueuedEnvelope {
    Transport(TransportEvent),
    Envelope(WsEnvelope),
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct OutboundQueueStats {
    pub pending_stream_bytes: usize,
    pub flush_count: usize,
    pub collapse_count: usize,
    pub drop_count: usize,
}

#[derive(Debug)]
pub(crate) struct OutboundBatcher {
    pending: Vec<TransportEvent>,
    pending_bytes: usize,
    flush_threshold_bytes: usize,
}

pub(crate) struct OutboundSendQueue {
    pending: VecDeque<QueuedEnvelope>,
    pending_stream_bytes: usize,
    pending_stream_byte_cap: usize,
    flush_count: usize,
    collapse_count: usize,
    drop_count: usize,
    closed: bool,
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

    pub(crate) fn pending_stream_bytes(&self) -> usize {
        self.pending_bytes
    }

    pub(crate) fn push(&mut self, event: TransportEvent) -> Vec<TransportEvent> {
        if let Some(key) = batch_key(&event) {
            let data_len = transport_event_data_len(&event);
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

impl OutboundSendQueue {
    pub(crate) fn new(pending_stream_byte_cap: usize) -> Self {
        Self {
            pending: VecDeque::new(),
            pending_stream_bytes: 0,
            pending_stream_byte_cap,
            flush_count: 0,
            collapse_count: 0,
            drop_count: 0,
            closed: false,
        }
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.closed
    }

    pub(crate) fn close(&mut self) {
        self.closed = true;
    }

    pub(crate) fn enqueue_transport_events(&mut self, events: Vec<TransportEvent>) {
        if events.is_empty() {
            return;
        }

        let contains_stream = events.iter().any(is_batchable_transport_event);
        for event in events {
            self.push_transport_event(event);
        }
        if contains_stream {
            self.flush_count = self.flush_count.saturating_add(1);
        }
    }

    pub(crate) fn enqueue_ws_envelope(&mut self, envelope: WsEnvelope) {
        self.pending.push_back(QueuedEnvelope::Envelope(envelope));
    }

    pub(crate) fn pop_front(&mut self) -> Option<WsEnvelope> {
        let item = self.pending.pop_front()?;
        let stream_bytes = match &item {
            QueuedEnvelope::Transport(event) if is_batchable_transport_event(event) => {
                transport_event_data_len(event)
            }
            _ => 0,
        };
        self.pending_stream_bytes = self.pending_stream_bytes.saturating_sub(stream_bytes);
        Some(match item {
            QueuedEnvelope::Transport(event) => WsEnvelope::Event {
                event: event.event,
                payload: event.payload,
            },
            QueuedEnvelope::Envelope(envelope) => envelope,
        })
    }

    pub(crate) fn stats(&self) -> OutboundQueueStats {
        OutboundQueueStats {
            pending_stream_bytes: self.pending_stream_bytes,
            flush_count: self.flush_count,
            collapse_count: self.collapse_count,
            drop_count: self.drop_count,
        }
    }

    fn push_transport_event(&mut self, event: TransportEvent) {
        if let Some(key) = batch_key(&event) {
            let data_len = transport_event_data_len(&event);
            if let Some(QueuedEnvelope::Transport(last)) = self.pending.back_mut() {
                if batch_key(last).as_ref() == Some(&key) {
                    append_event_data(last, &event);
                    self.pending_stream_bytes = self.pending_stream_bytes.saturating_add(data_len);
                    self.apply_stream_backpressure();
                    return;
                }
            }

            self.pending.push_back(QueuedEnvelope::Transport(event));
            self.pending_stream_bytes = self.pending_stream_bytes.saturating_add(data_len);
            self.apply_stream_backpressure();
            return;
        }

        self.pending.push_back(QueuedEnvelope::Transport(event));
    }

    fn apply_stream_backpressure(&mut self) {
        if self.pending_stream_bytes <= self.pending_stream_byte_cap {
            return;
        }

        self.collapse_pending_stream_groups();
        if self.pending_stream_bytes <= self.pending_stream_byte_cap {
            return;
        }

        self.trim_pending_streams_to_cap();
    }

    fn collapse_pending_stream_groups(&mut self) {
        let original = std::mem::take(&mut self.pending);
        let mut collapsed = VecDeque::new();
        let mut group = Vec::new();

        for item in original {
            match item {
                QueuedEnvelope::Transport(event) if is_batchable_transport_event(&event) => {
                    group.push(event);
                }
                other => {
                    self.flush_collapsed_group(&mut collapsed, &mut group);
                    collapsed.push_back(other);
                }
            }
        }

        self.flush_collapsed_group(&mut collapsed, &mut group);
        self.pending = collapsed;
        self.pending_stream_bytes = queued_pending_stream_bytes(&self.pending);
    }

    fn flush_collapsed_group(
        &mut self,
        target: &mut VecDeque<QueuedEnvelope>,
        group: &mut Vec<TransportEvent>,
    ) {
        if group.is_empty() {
            return;
        }

        let mut merged = Vec::new();
        let mut merged_keys: Vec<(BatchKey, usize)> = Vec::new();

        for event in group.drain(..) {
            let key = batch_key(&event).expect("stream group only stores batchable events");
            if let Some((_, index)) = merged_keys.iter().find(|(existing, _)| existing == &key) {
                append_event_data(&mut merged[*index], &event);
                self.collapse_count = self.collapse_count.saturating_add(1);
            } else {
                merged_keys.push((key, merged.len()));
                merged.push(event);
            }
        }

        for event in merged {
            target.push_back(QueuedEnvelope::Transport(event));
        }
    }

    fn trim_pending_streams_to_cap(&mut self) {
        let mut overflow = self
            .pending_stream_bytes
            .saturating_sub(self.pending_stream_byte_cap);
        if overflow == 0 {
            return;
        }

        let mut retained = VecDeque::with_capacity(self.pending.len());
        while let Some(mut item) = self.pending.pop_front() {
            if overflow == 0 {
                retained.push_back(item);
                continue;
            }

            match &mut item {
                QueuedEnvelope::Transport(event) if is_batchable_transport_event(event) => {
                    let data_len = transport_event_data_len(event);
                    if data_len <= overflow {
                        overflow -= data_len;
                        self.drop_count = self.drop_count.saturating_add(1);
                        continue;
                    }

                    trim_event_data_front(event, overflow);
                    self.drop_count = self.drop_count.saturating_add(1);
                    overflow = 0;
                    retained.push_back(item);
                }
                _ => retained.push_back(item),
            }
        }

        self.pending = retained;
        self.pending_stream_bytes = queued_pending_stream_bytes(&self.pending);
    }
}

fn transport_event_data_len(event: &TransportEvent) -> usize {
    event_data_len(&event.payload)
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

fn trim_event_data_front(event: &mut TransportEvent, bytes_to_remove: usize) {
    let Some(payload) = event.payload.as_object_mut() else {
        return;
    };
    let Some(data) = payload.get("data").and_then(Value::as_str) else {
        return;
    };
    if bytes_to_remove == 0 {
        return;
    }

    let split_index = if bytes_to_remove >= data.len() {
        data.len()
    } else {
        data.char_indices()
            .find_map(|(index, ch)| {
                let next = index + ch.len_utf8();
                (next >= bytes_to_remove).then_some(next)
            })
            .unwrap_or(data.len())
    };

    payload.insert(
        "data".to_string(),
        Value::String(data.get(split_index..).unwrap_or_default().to_string()),
    );
}

fn queued_pending_stream_bytes(pending: &VecDeque<QueuedEnvelope>) -> usize {
    pending
        .iter()
        .map(|item| match item {
            QueuedEnvelope::Transport(event) if is_batchable_transport_event(event) => {
                transport_event_data_len(event)
            }
            _ => 0,
        })
        .sum()
}

fn is_batchable_transport_event(event: &TransportEvent) -> bool {
    batch_key(event).is_some()
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
    use super::{OutboundBatcher, OutboundSendQueue};
    use crate::ws::protocol::WsEnvelope;
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

    fn drain_events(queue: &mut OutboundSendQueue) -> Vec<(String, Value)> {
        let mut drained = Vec::new();
        while let Some(envelope) = queue.pop_front() {
            match envelope {
                WsEnvelope::Event { event, payload } => drained.push((event, payload)),
                _ => panic!("expected event envelope"),
            }
        }
        drained
    }

    #[test]
    fn outbound_batcher_merges_adjacent_agent_stdout_chunks_for_same_session() {
        let mut batcher = OutboundBatcher::new(32 * 1024);

        assert!(
            batcher
                .push(agent_stream_event("ws-1", "session-1", "stdout", "hello "))
                .is_empty()
        );
        assert!(
            batcher
                .push(agent_stream_event("ws-1", "session-1", "stdout", "world"))
                .is_empty()
        );

        let flushed = batcher.flush();
        assert_eq!(flushed.len(), 1);
        assert_eq!(flushed[0].event, "agent://event");
        assert_eq!(
            flushed[0].payload["data"],
            Value::String("hello world".to_string())
        );
    }

    #[test]
    fn outbound_batcher_merges_adjacent_terminal_chunks_for_same_terminal() {
        let mut batcher = OutboundBatcher::new(32 * 1024);

        assert!(
            batcher
                .push(terminal_stream_event("ws-1", 7, "abc"))
                .is_empty()
        );
        assert!(
            batcher
                .push(terminal_stream_event("ws-1", 7, "def"))
                .is_empty()
        );

        let flushed = batcher.flush();
        assert_eq!(flushed.len(), 1);
        assert_eq!(flushed[0].event, "terminal://event");
        assert_eq!(flushed[0].payload["data"], Value::String("abcdef".to_string()));
    }

    #[test]
    fn outbound_batcher_flushes_pending_streams_before_control_events() {
        let mut batcher = OutboundBatcher::new(32 * 1024);

        assert!(
            batcher
                .push(agent_stream_event("ws-1", "session-1", "stdout", "hello"))
                .is_empty()
        );

        let flushed = batcher.push(control_event("ws-1"));
        assert_eq!(flushed.len(), 2);
        assert_eq!(flushed[0].event, "agent://event");
        assert_eq!(flushed[1].event, "workspace://runtime_state");
    }

    #[test]
    fn outbound_batcher_does_not_merge_different_sessions() {
        let mut batcher = OutboundBatcher::new(32 * 1024);

        assert!(
            batcher
                .push(agent_stream_event("ws-1", "session-1", "stdout", "hello"))
                .is_empty()
        );
        assert!(
            batcher
                .push(agent_stream_event("ws-1", "session-2", "stdout", "world"))
                .is_empty()
        );

        let flushed = batcher.flush();
        assert_eq!(flushed.len(), 2);
        assert_eq!(
            flushed[0].payload["session_id"],
            Value::String("session-1".to_string())
        );
        assert_eq!(
            flushed[1].payload["session_id"],
            Value::String("session-2".to_string())
        );
    }

    #[test]
    fn outbound_send_queue_collapses_stream_groups_and_trims_oldest_bytes_under_pressure() {
        let mut queue = OutboundSendQueue::new(4);

        queue.enqueue_transport_events(vec![
            agent_stream_event("ws-1", "session-1", "stdout", "ab"),
            terminal_stream_event("ws-1", 7, "cd"),
            agent_stream_event("ws-1", "session-1", "stdout", "ef"),
        ]);

        let stats = queue.stats();
        assert_eq!(stats.pending_stream_bytes, 4);
        assert_eq!(stats.flush_count, 1);
        assert_eq!(stats.collapse_count, 1);
        assert_eq!(stats.drop_count, 1);

        let drained = drain_events(&mut queue);
        assert_eq!(drained.len(), 2);
        assert_eq!(drained[0].0, "agent://event");
        assert_eq!(drained[0].1["data"], Value::String("ef".to_string()));
        assert_eq!(drained[1].0, "terminal://event");
        assert_eq!(drained[1].1["data"], Value::String("cd".to_string()));
    }

    #[test]
    fn outbound_send_queue_preserves_control_events_when_trimming_stream_backlog() {
        let mut queue = OutboundSendQueue::new(4);

        queue.enqueue_transport_events(vec![
            agent_stream_event("ws-1", "session-1", "stdout", "abcd"),
            control_event("ws-1"),
            terminal_stream_event("ws-1", 7, "ef"),
            agent_stream_event("ws-1", "session-2", "stdout", "gh"),
        ]);

        let stats = queue.stats();
        assert_eq!(stats.pending_stream_bytes, 4);
        assert_eq!(stats.drop_count, 2);

        let drained = drain_events(&mut queue);
        assert_eq!(
            drained
                .iter()
                .map(|(event, _)| event.as_str())
                .collect::<Vec<_>>(),
            vec!["workspace://runtime_state", "terminal://event", "agent://event"]
        );
    }

    #[test]
    fn outbound_send_queue_updates_pending_stream_bytes_as_events_are_sent() {
        let mut queue = OutboundSendQueue::new(32);

        queue.enqueue_transport_events(vec![agent_stream_event(
            "ws-1",
            "session-1",
            "stdout",
            "hello",
        )]);
        assert_eq!(queue.stats().pending_stream_bytes, 5);

        let _ = queue.pop_front();
        assert_eq!(queue.stats().pending_stream_bytes, 0);
        assert!(queue.pop_front().is_none());
    }
}
