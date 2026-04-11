use std::{
    collections::HashMap,
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Instant,
};

use notify::RecommendedWatcher;
use portable_pty::{Child, ChildKiller, MasterPty};
use rusqlite::Connection;
use tokio::sync::broadcast;

use crate::{
    auth::{ip_guard::IpGuardMap, AuthRuntime},
    models::{
        ExecTarget, GitChangeEntry, GitStatus, SessionInfo, TransportEvent, WorkspaceTree,
        WorktreeInfo,
    },
    services::artifact_cache::TimedCache,
    AppHandle,
};

#[derive(Clone)]
pub(crate) struct HttpServerState {
    pub app: AppHandle,
}

pub(crate) struct AgentRuntime {
    pub child: Mutex<Box<dyn Child + Send>>,
    pub killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pub writer: Mutex<Option<Box<dyn Write + Send>>>,
    pub master: Mutex<Box<dyn MasterPty + Send>>,
    pub process_id: Option<u32>,
    pub process_group_leader: Option<i32>,
}

pub(crate) enum TerminalIo {
    Pty {
        writer: Mutex<Option<Box<dyn Write + Send>>>,
        master: Mutex<Box<dyn MasterPty + Send>>,
    },
    TmuxAttached {
        session_name: String,
        pane_id: String,
        writer: Mutex<Option<Box<dyn Write + Send>>>,
        master: Mutex<Box<dyn MasterPty + Send>>,
    },
}

pub(crate) struct TerminalRuntime {
    pub io: TerminalIo,
    pub output: Mutex<String>,
    pub persist_workspace_terminal: bool,
    pub child: Option<Mutex<Box<dyn Child + Send>>>,
    pub killer: Option<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
    pub process_id: Option<u32>,
    pub process_group_leader: Option<i32>,
}

pub(crate) struct WorkspaceWatch {
    pub root_path: String,
    pub target: ExecTarget,
    pub watched_path: PathBuf,
    pub _watcher: RecommendedWatcher,
}

pub(crate) struct WorkspaceWatchSuppression {
    pub active_requests: usize,
    pub until: Instant,
}

#[derive(Clone)]
pub(crate) struct ArtifactCaches {
    pub git_status: TimedCache<GitStatus>,
    pub git_changes: TimedCache<Vec<GitChangeEntry>>,
    pub workspace_tree: TimedCache<WorkspaceTree>,
    pub worktree_list: TimedCache<Vec<WorktreeInfo>>,
}

impl Default for ArtifactCaches {
    fn default() -> Self {
        Self {
            git_status: Arc::new(Mutex::new(HashMap::new())),
            git_changes: Arc::new(Mutex::new(HashMap::new())),
            workspace_tree: Arc::new(Mutex::new(HashMap::new())),
            worktree_list: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

pub(crate) struct AppState {
    pub db: Mutex<Option<Connection>>,
    pub auth: Mutex<AuthRuntime>,
    pub agents: Mutex<HashMap<String, Arc<AgentRuntime>>>,
    pub terminals: Mutex<HashMap<String, Arc<TerminalRuntime>>>,
    pub live_sessions: Mutex<HashMap<String, SessionInfo>>,
    pub session_runtime_bindings: Mutex<HashMap<String, u64>>,
    pub terminal_runtime_bindings: Mutex<HashMap<u64, String>>,
    pub terminal_runtimes: Mutex<crate::services::terminal_gateway::TerminalRuntimeRegistry>,
    pub workspace_client_connections: Mutex<HashMap<String, usize>>,
    pub workspace_watches: Mutex<HashMap<String, WorkspaceWatch>>,
    pub workspace_watch_suppressions: Arc<Mutex<HashMap<String, WorkspaceWatchSuppression>>>,
    pub next_terminal_id: Mutex<u64>,
    pub ip_guard: Mutex<IpGuardMap>,
    pub hook_endpoint: Mutex<Option<String>>,
    pub http_endpoint: Mutex<Option<String>>,
    pub artifact_caches: ArtifactCaches,
    pub transport_events: broadcast::Sender<TransportEvent>,
    #[cfg(test)]
    pub terminal_write_log: Mutex<Vec<(String, u64, String, crate::models::TerminalWriteOrigin)>>,
}

impl Default for AppState {
    fn default() -> Self {
        let (transport_events, _) = broadcast::channel(1024);
        Self {
            db: Mutex::new(None),
            auth: Mutex::new(AuthRuntime::default()),
            agents: Mutex::new(HashMap::new()),
            terminals: Mutex::new(HashMap::new()),
            live_sessions: Mutex::new(HashMap::new()),
            session_runtime_bindings: Mutex::new(HashMap::new()),
            terminal_runtime_bindings: Mutex::new(HashMap::new()),
            terminal_runtimes: Mutex::new(Default::default()),
            workspace_client_connections: Mutex::new(HashMap::new()),
            workspace_watches: Mutex::new(HashMap::new()),
            workspace_watch_suppressions: Arc::new(Mutex::new(HashMap::new())),
            next_terminal_id: Mutex::new(1),
            ip_guard: Mutex::new(HashMap::new()),
            hook_endpoint: Mutex::new(None),
            http_endpoint: Mutex::new(None),
            artifact_caches: ArtifactCaches::default(),
            transport_events,
            #[cfg(test)]
            terminal_write_log: Mutex::new(Vec::new()),
        }
    }
}

pub(crate) const DEV_FRONTEND_URL: &str = "http://127.0.0.1:5174";
pub(crate) const DEV_BACKEND_PORT: u16 = 41033;
