use std::{
    collections::HashMap,
    io::Write,
    sync::{Arc, Mutex},
};

use portable_pty::{Child, MasterPty};
use rusqlite::Connection;
use tokio::sync::broadcast;

use crate::{
    auth::{ip_guard::IpGuardMap, AuthRuntime},
    models::TransportEvent,
    AppHandle,
};

#[derive(Clone)]
pub(crate) struct HttpServerState {
    pub app: AppHandle,
}

pub(crate) struct AgentRuntime {
    pub child: Mutex<Box<dyn Child + Send>>,
    pub writer: Mutex<Option<Box<dyn Write + Send>>>,
    pub master: Mutex<Box<dyn MasterPty + Send>>,
}

pub(crate) struct TerminalRuntime {
    pub child: Mutex<Box<dyn Child + Send>>,
    pub writer: Mutex<Option<Box<dyn Write + Send>>>,
    pub master: Mutex<Box<dyn MasterPty + Send>>,
}

pub(crate) struct AppState {
    pub db: Mutex<Option<Connection>>,
    pub auth: Mutex<AuthRuntime>,
    pub agents: Mutex<HashMap<String, Arc<AgentRuntime>>>,
    pub terminals: Mutex<HashMap<String, Arc<TerminalRuntime>>>,
    pub next_terminal_id: Mutex<u64>,
    pub ip_guard: Mutex<IpGuardMap>,
    pub hook_endpoint: Mutex<Option<String>>,
    pub http_endpoint: Mutex<Option<String>>,
    pub transport_events: broadcast::Sender<TransportEvent>,
}

impl Default for AppState {
    fn default() -> Self {
        let (transport_events, _) = broadcast::channel(1024);
        Self {
            db: Mutex::new(None),
            auth: Mutex::new(AuthRuntime::default()),
            agents: Mutex::new(HashMap::new()),
            terminals: Mutex::new(HashMap::new()),
            next_terminal_id: Mutex::new(1),
            ip_guard: Mutex::new(HashMap::new()),
            hook_endpoint: Mutex::new(None),
            http_endpoint: Mutex::new(None),
            transport_events,
        }
    }
}

pub(crate) const DEV_FRONTEND_URL: &str = "http://127.0.0.1:5174";
pub(crate) const DEV_BACKEND_PORT: u16 = 41033;
