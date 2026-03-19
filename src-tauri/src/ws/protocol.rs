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
    Ping { ts: i64 },
    Pong { ts: i64 },
}
