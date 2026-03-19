use std::{
    collections::HashMap,
    io::Write,
    sync::{Arc, Mutex},
};

use portable_pty::{Child, MasterPty};
use rusqlite::Connection;
use tauri::AppHandle;
use tokio::sync::broadcast;

use crate::{
    infra::time::{default_idle_policy, now_ts},
    models::{
        ArchiveEntry, ExecTarget, IdlePolicy, SessionInfo, SessionMode, SessionStatus,
        TerminalInfo, TransportEvent,
    },
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

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
pub(crate) struct TabState {
    pub tab_id: String,
    pub project_path: String,
    pub target: ExecTarget,
    pub idle_policy: IdlePolicy,
    pub sessions: Vec<SessionInfo>,
    pub active_session_id: u64,
    pub archive: Vec<ArchiveEntry>,
    pub terminals: Vec<TerminalInfo>,
    pub next_session_id: u64,
    pub next_task_id: u64,
    pub next_terminal_id: u64,
}

pub(crate) struct AppState {
    pub tabs: Mutex<HashMap<String, TabState>>,
    pub db: Mutex<Option<Connection>>,
    pub agents: Mutex<HashMap<String, Arc<AgentRuntime>>>,
    pub terminals: Mutex<HashMap<String, Arc<TerminalRuntime>>>,
    pub hook_endpoint: Mutex<Option<String>>,
    pub http_endpoint: Mutex<Option<String>>,
    pub transport_events: broadcast::Sender<TransportEvent>,
}

impl Default for AppState {
    fn default() -> Self {
        let (transport_events, _) = broadcast::channel(1024);
        Self {
            tabs: Mutex::new(HashMap::new()),
            db: Mutex::new(None),
            agents: Mutex::new(HashMap::new()),
            terminals: Mutex::new(HashMap::new()),
            hook_endpoint: Mutex::new(None),
            http_endpoint: Mutex::new(None),
            transport_events,
        }
    }
}

pub(crate) const DEV_FRONTEND_URL: &str = "http://127.0.0.1:5174";
pub(crate) const DEV_BACKEND_PORT: u16 = 41033;

pub(crate) fn bootstrap_tab_state(tab_id: &str, target: &ExecTarget) -> TabState {
    TabState {
        tab_id: tab_id.to_string(),
        project_path: String::new(),
        target: target.clone(),
        idle_policy: default_idle_policy(),
        sessions: vec![SessionInfo {
            id: 1,
            status: SessionStatus::Idle,
            mode: SessionMode::Branch,
            auto_feed: true,
            queue: vec![],
            last_active_at: now_ts(),
            claude_session_id: None,
        }],
        active_session_id: 1,
        archive: vec![],
        terminals: vec![],
        next_session_id: 2,
        next_task_id: 1,
        next_terminal_id: 1,
    }
}
