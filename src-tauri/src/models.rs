use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ExecTarget {
    Native,
    Wsl { distro: Option<String> },
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "snake_case")]
pub enum SessionMode {
    Branch,
    GitTree,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Idle,
    Running,
    Background,
    Waiting,
    Suspended,
    Queued,
    Interrupted,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct IdlePolicy {
    pub enabled: bool,
    pub idle_minutes: u32,
    pub max_active: u32,
    pub pressure: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct QueueTask {
    pub id: u64,
    pub text: String,
    pub status: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "snake_case")]
pub enum SessionMessageRole {
    System,
    User,
    Agent,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct SessionMessage {
    pub id: String,
    pub role: SessionMessageRole,
    pub content: String,
    pub time: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct SessionInfo {
    pub id: u64,
    pub title: String,
    pub status: SessionStatus,
    pub mode: SessionMode,
    pub auto_feed: bool,
    pub queue: Vec<QueueTask>,
    pub messages: Vec<SessionMessage>,
    pub stream: String,
    pub unread: u32,
    pub last_active_at: i64,
    pub claude_session_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct AgentStartResult {
    pub started: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct GitStatus {
    pub branch: String,
    pub changes: u32,
    pub last_commit: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct GitChangeEntry {
    pub path: String,
    pub name: String,
    pub parent: String,
    pub section: String,
    pub status: String,
    pub code: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct GitFileDiffPayload {
    pub original_content: String,
    pub modified_content: String,
    pub diff: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorktreeInfo {
    pub name: String,
    pub path: String,
    pub branch: String,
    pub status: String,
    pub diff: String,
    pub tree: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ArchiveEntry {
    pub id: u64,
    pub session_id: u64,
    pub mode: SessionMode,
    pub time: String,
    pub snapshot: Value,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceSourceKind {
    Remote,
    Local,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorkspaceSource {
    pub kind: WorkspaceSourceKind,
    pub path_or_url: String,
    pub target: ExecTarget,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FilePreview {
    pub path: String,
    pub content: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub status: Option<String>,
    pub children: Vec<FileNode>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorkspaceTree {
    pub root: FileNode,
    pub changes: Vec<FileNode>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorktreeDetail {
    pub name: String,
    pub path: String,
    pub branch: String,
    pub status: String,
    pub diff: String,
    pub root: FileNode,
    pub changes: Vec<FileNode>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct TerminalInfo {
    pub id: u64,
    pub output: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct AgentEvent {
    pub workspace_id: String,
    pub session_id: String,
    pub kind: String,
    pub data: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct AgentLifecycleEvent {
    pub workspace_id: String,
    pub session_id: String,
    pub kind: String,
    pub source_event: String,
    pub data: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct TerminalEvent {
    pub workspace_id: String,
    pub terminal_id: u64,
    pub data: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ClaudeSlashSkillEntry {
    pub id: String,
    pub command: String,
    pub description: String,
    pub scope: String,
    pub source_kind: String,
    pub source_path: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FilesystemRoot {
    pub id: String,
    pub label: String,
    pub path: String,
    pub description: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FilesystemEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FilesystemListResponse {
    pub current_path: String,
    pub home_path: String,
    pub parent_path: Option<String>,
    pub roots: Vec<FilesystemRoot>,
    pub entries: Vec<FilesystemEntry>,
    pub requested_path: Option<String>,
    pub fallback_reason: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CommandAvailability {
    pub command: String,
    pub available: bool,
    pub resolved_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct TransportEvent {
    pub event: String,
    pub payload: Value,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorkbenchLayout {
    pub left_width: f64,
    pub right_width: f64,
    pub right_split: f64,
    pub show_code_panel: bool,
    pub show_terminal_panel: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorkspaceSummary {
    pub workspace_id: String,
    pub title: String,
    pub project_path: String,
    pub source_kind: WorkspaceSourceKind,
    pub source_value: String,
    pub git_url: Option<String>,
    pub target: ExecTarget,
    pub idle_policy: IdlePolicy,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorkspaceViewState {
    pub active_session_id: String,
    pub active_pane_id: String,
    pub pane_layout: Value,
    pub file_preview: Value,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorkspaceSnapshot {
    pub workspace: WorkspaceSummary,
    pub sessions: Vec<SessionInfo>,
    pub archive: Vec<ArchiveEntry>,
    pub view_state: WorkspaceViewState,
    pub terminals: Vec<TerminalInfo>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorkbenchUiState {
    pub open_workspace_ids: Vec<String>,
    pub active_workspace_id: Option<String>,
    pub layout: WorkbenchLayout,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorkbenchBootstrap {
    pub ui_state: WorkbenchUiState,
    pub workspaces: Vec<WorkspaceSnapshot>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorkspaceLaunchResult {
    pub ui_state: WorkbenchUiState,
    pub snapshot: WorkspaceSnapshot,
    pub created: bool,
    pub already_open: bool,
}

#[derive(Clone, Deserialize, Debug)]
pub struct SessionPatch {
    pub title: Option<String>,
    pub status: Option<SessionStatus>,
    pub mode: Option<SessionMode>,
    pub auto_feed: Option<bool>,
    pub queue: Option<Vec<QueueTask>>,
    pub messages: Option<Vec<SessionMessage>>,
    pub stream: Option<String>,
    pub unread: Option<u32>,
    pub last_active_at: Option<i64>,
    pub claude_session_id: Option<String>,
}

#[derive(Clone, Deserialize, Debug)]
pub struct WorkspaceViewPatch {
    pub active_session_id: Option<String>,
    pub active_pane_id: Option<String>,
    pub pane_layout: Option<Value>,
    pub file_preview: Option<Value>,
}
