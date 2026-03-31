use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
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

#[derive(Clone, Copy, Serialize, Deserialize, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AgentProvider {
    #[default]
    Claude,
    Codex,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct IdlePolicy {
    pub enabled: bool,
    #[serde(alias = "idleMinutes")]
    pub idle_minutes: u32,
    #[serde(alias = "maxActive")]
    pub max_active: u32,
    pub pressure: bool,
}

fn default_settings_locale() -> String {
    "en".to_string()
}

fn default_terminal_compatibility_mode() -> String {
    "standard".to_string()
}

fn default_completion_notifications_only_when_background() -> bool {
    true
}

fn default_completion_notifications_enabled() -> bool {
    true
}

fn default_idle_policy_settings() -> IdlePolicy {
    IdlePolicy {
        enabled: true,
        idle_minutes: 10,
        max_active: 3,
        pressure: true,
    }
}

fn default_claude_executable() -> String {
    "claude".to_string()
}

fn default_codex_executable() -> String {
    "codex".to_string()
}

fn default_json_object() -> Value {
    Value::Object(Default::default())
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(default)]
pub struct CompletionNotificationSettings {
    #[serde(default = "default_completion_notifications_enabled")]
    pub enabled: bool,
    #[serde(default = "default_completion_notifications_only_when_background")]
    #[serde(alias = "onlyWhenBackground")]
    pub only_when_background: bool,
}

impl Default for CompletionNotificationSettings {
    fn default() -> Self {
        Self {
            enabled: default_completion_notifications_enabled(),
            only_when_background: default_completion_notifications_only_when_background(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(default)]
pub struct GeneralSettingsPayload {
    #[serde(default = "default_settings_locale")]
    pub locale: String,
    #[serde(default = "default_terminal_compatibility_mode")]
    #[serde(alias = "terminalCompatibilityMode")]
    pub terminal_compatibility_mode: String,
    #[serde(alias = "completionNotifications")]
    pub completion_notifications: CompletionNotificationSettings,
    #[serde(default = "default_idle_policy_settings")]
    #[serde(alias = "idlePolicy")]
    pub idle_policy: IdlePolicy,
}

impl Default for GeneralSettingsPayload {
    fn default() -> Self {
        Self {
            locale: default_settings_locale(),
            terminal_compatibility_mode: default_terminal_compatibility_mode(),
            completion_notifications: CompletionNotificationSettings::default(),
            idle_policy: default_idle_policy_settings(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(default)]
pub struct ClaudeRuntimeProfile {
    #[serde(default = "default_claude_executable")]
    pub executable: String,
    #[serde(alias = "startupArgs")]
    pub startup_args: Vec<String>,
    pub env: BTreeMap<String, String>,
    #[serde(default = "default_json_object")]
    #[serde(alias = "settingsJson")]
    pub settings_json: Value,
    #[serde(default = "default_json_object")]
    #[serde(alias = "globalConfigJson")]
    pub global_config_json: Value,
}

impl Default for ClaudeRuntimeProfile {
    fn default() -> Self {
        Self {
            executable: default_claude_executable(),
            startup_args: Vec::new(),
            env: BTreeMap::new(),
            settings_json: default_json_object(),
            global_config_json: default_json_object(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq, Default)]
#[serde(default)]
pub struct TargetClaudeOverride {
    pub enabled: bool,
    pub profile: ClaudeRuntimeProfile,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq, Default)]
#[serde(default)]
pub struct ClaudeTargetOverrides {
    pub native: Option<TargetClaudeOverride>,
    pub wsl: Option<TargetClaudeOverride>,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq, Default)]
#[serde(default)]
pub struct ClaudeSettingsPayload {
    pub global: ClaudeRuntimeProfile,
    pub overrides: ClaudeTargetOverrides,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq, Default)]
#[serde(default)]
pub struct AgentDefaultsPayload {
    pub provider: AgentProvider,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(default)]
pub struct CodexRuntimeProfile {
    #[serde(default = "default_codex_executable")]
    pub executable: String,
    #[serde(alias = "extraArgs")]
    pub extra_args: Vec<String>,
    pub model: String,
    #[serde(alias = "approvalPolicy")]
    pub approval_policy: String,
    #[serde(alias = "sandboxMode")]
    pub sandbox_mode: String,
    #[serde(alias = "webSearch")]
    pub web_search: String,
    #[serde(alias = "modelReasoningEffort")]
    pub model_reasoning_effort: String,
    pub env: BTreeMap<String, String>,
}

impl Default for CodexRuntimeProfile {
    fn default() -> Self {
        Self {
            executable: default_codex_executable(),
            extra_args: Vec::new(),
            model: String::new(),
            approval_policy: String::new(),
            sandbox_mode: String::new(),
            web_search: String::new(),
            model_reasoning_effort: String::new(),
            env: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq, Default)]
#[serde(default)]
pub struct TargetCodexOverride {
    pub enabled: bool,
    pub profile: CodexRuntimeProfile,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq, Default)]
#[serde(default)]
pub struct CodexTargetOverrides {
    pub native: Option<TargetCodexOverride>,
    pub wsl: Option<TargetCodexOverride>,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq, Default)]
#[serde(default)]
pub struct CodexSettingsPayload {
    pub global: CodexRuntimeProfile,
    pub overrides: CodexTargetOverrides,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq, Default)]
#[serde(default)]
pub struct AppSettingsPayload {
    pub general: GeneralSettingsPayload,
    #[serde(alias = "agentDefaults")]
    pub agent_defaults: AgentDefaultsPayload,
    pub claude: ClaudeSettingsPayload,
    pub codex: CodexSettingsPayload,
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
    pub provider: AgentProvider,
    pub auto_feed: bool,
    pub queue: Vec<QueueTask>,
    pub messages: Vec<SessionMessage>,
    pub stream: String,
    pub unread: u32,
    pub last_active_at: i64,
    pub resume_id: Option<String>,
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
pub struct SessionHistoryRecord {
    pub workspace_id: String,
    pub workspace_title: String,
    pub workspace_path: String,
    pub session_id: u64,
    pub title: String,
    pub status: SessionStatus,
    pub provider: AgentProvider,
    pub archived: bool,
    pub mounted: bool,
    pub recoverable: bool,
    pub last_active_at: i64,
    pub archived_at: Option<i64>,
    pub resume_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct SessionRestoreResult {
    pub session: SessionInfo,
    pub already_active: bool,
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
    pub recoverable: bool,
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
pub struct AgentLifecycleHistoryEntry {
    pub workspace_id: String,
    pub session_id: String,
    pub seq: i64,
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
    #[serde(default)]
    pub active_terminal_id: String,
    pub pane_layout: Value,
    pub file_preview: Value,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct WorkspaceControllerLease {
    pub workspace_id: String,
    pub controller_device_id: Option<String>,
    pub controller_client_id: Option<String>,
    pub lease_expires_at: i64,
    pub fencing_token: i64,
    pub takeover_request_id: Option<String>,
    pub takeover_requested_by_device_id: Option<String>,
    pub takeover_requested_by_client_id: Option<String>,
    pub takeover_deadline_at: Option<i64>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorkspaceRuntimeSnapshot {
    pub snapshot: WorkspaceSnapshot,
    pub controller: WorkspaceControllerLease,
    #[serde(default)]
    pub lifecycle_events: Vec<AgentLifecycleHistoryEntry>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WorkspaceRuntimeStateEvent {
    pub workspace_id: String,
    pub view_state: WorkspaceViewState,
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
    pub resume_id: Option<String>,
}

#[derive(Clone, Deserialize, Debug)]
pub struct WorkspaceViewPatch {
    pub active_session_id: Option<String>,
    pub active_pane_id: Option<String>,
    pub active_terminal_id: Option<String>,
    pub pane_layout: Option<Value>,
    pub file_preview: Option<Value>,
}
