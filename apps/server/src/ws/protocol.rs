use crate::*;

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum WsEnvelope {
    Event { event: String, payload: Value },
    Pong { ts: i64 },
}

#[allow(dead_code)]
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum WsClientEnvelope {
    Ping {
        ts: i64,
    },
    Pong {
        ts: i64,
    },
    TerminalWrite {
        workspace_id: String,
        terminal_id: u64,
        input: String,
        fencing_token: i64,
    },
    TerminalResize {
        workspace_id: String,
        terminal_id: u64,
        cols: u16,
        rows: u16,
        fencing_token: i64,
    },
    SessionUpdate {
        workspace_id: String,
        session_id: String,
        patch: SessionPatch,
        fencing_token: i64,
    },
    WorkspaceControllerHeartbeat {
        workspace_id: String,
    },
}
