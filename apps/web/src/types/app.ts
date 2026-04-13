import type { ReactNode } from "react";
import type { Locale } from "../i18n";
import type {
  AgentMessage,
  AgentProvider,
  ExecTarget,
  FilePreview,
  GitChange,
  IdlePolicy,
  SessionMode,
  SessionRuntimeLiveness,
  SessionStatus,
  SupervisorStatus,
  Tab,
  Terminal,
  TreeNode,
  WorkspaceSupervisorCycle,
  WorkspaceSupervisorCycleStatus,
} from "../state/workbench-core";

export type Toast = { id: string; text: string; sessionId: string };

export type TerminalCompatibilityMode = "standard" | "compatibility";

export type WorkspaceSummary = {
  workspace_id: string;
  title: string;
  project_path: string;
  source_kind: "local" | "remote";
  source_value: string;
  git_url?: string | null;
  target: ExecTarget;
  idle_policy: {
    enabled: boolean;
    idle_minutes: number;
    max_active: number;
    pressure: boolean;
  };
};

export type GitStatus = {
  branch: string;
  changes: number;
  last_commit: string;
};

export type WorkspaceTree = {
  root: TreeNode;
  changes: TreeNode[];
};

export type GitChangeEntry = GitChange;
export type GitChangeAction = "stage" | "unstage" | "discard";

export type GitFileDiffPayload = {
  original_content: string;
  modified_content: string;
  diff: string;
};

export type BackendQueueTask = {
  id: number;
  text: string;
  status: "queued" | "running" | "done";
};

export type BackendSessionMessage = AgentMessage;

export type BackendSession = {
  id: string;
  title: string;
  status: SessionStatus;
  mode: SessionMode;
  provider: AgentProvider;
  auto_feed: boolean;
  queue: BackendQueueTask[];
  messages: BackendSessionMessage[];
  unread: number;
  last_active_at: number;
  resume_id?: string | null;
  unavailable_reason?: string | null;
  runtime_active?: boolean;
  runtime_liveness?: SessionRuntimeLiveness | null;
};

export type SessionHistoryRecordState = "live" | "detached" | "unavailable";

export type BackendSessionHistoryRecord = {
  workspace_id: string;
  workspace_title: string;
  workspace_path: string;
  session_id?: string | null;
  title: string;
  provider: AgentProvider;
  mounted: boolean;
  state: SessionHistoryRecordState;
  created_at: number;
  last_active_at: number;
  resume_id: string;
};

export type SessionHistoryRecord = {
  workspaceId: string;
  workspaceTitle: string;
  workspacePath: string;
  sessionId?: string | null;
  title: string;
  provider: AgentProvider;
  mounted: boolean;
  state: SessionHistoryRecordState;
  createdAt: number;
  lastActiveAt: number;
  resumeId: string;
};


export type SessionHistoryGroup = {
  workspaceId: string;
  workspaceTitle: string;
  workspacePath: string;
  records: SessionHistoryRecord[];
};

export type SessionHistoryExpansionState = Record<string, boolean>;

export interface BackendWorkspaceSupervisorBinding {
  session_id: string;
  provider: AgentProvider;
  objective_text: string;
  objective_prompt: string;
  objective_version: number;
  status: SupervisorStatus;
  auto_inject_enabled: boolean;
  pending_objective_text?: string | null;
  pending_objective_prompt?: string | null;
  pending_objective_version?: number | null;
  created_at: number;
  updated_at: number;
}

export interface BackendWorkspaceSupervisorCycle {
  cycle_id: string;
  session_id: string;
  source_turn_id: string;
  objective_version: number;
  supervisor_input: string;
  supervisor_reply?: string | null;
  injection_message_id?: string | null;
  status: WorkspaceSupervisorCycleStatus;
  error?: string | null;
  started_at: number;
  finished_at?: number | null;
}

export interface BackendWorkspaceSupervisorViewState {
  bindings: BackendWorkspaceSupervisorBinding[];
  cycles: BackendWorkspaceSupervisorCycle[];
}

export type BackendWorkspaceViewState = {
  active_session_id: string;
  active_pane_id: string;
  active_terminal_id: string;
  pane_layout: Tab["paneLayout"];
  file_preview: FilePreview;
  session_bindings: BackendWorkspaceSessionBinding[];
  supervisor: BackendWorkspaceSupervisorViewState;
};

export type BackendWorkspaceSessionBinding = {
  session_id: string;
  provider: AgentProvider;
  resume_id: string | null;
  title_snapshot: string;
  last_seen_at: number;
};

export type SessionRuntimeBindingInfo = {
  session_id: string;
  terminal_id: string;
  terminal_runtime_id?: string;
  workspace_terminal_id?: string;
};

export type TerminalChannelOutputEvent = {
  runtime_id: string;
  data: string;
};

export interface TerminalChannelReplayEvent {
  runtime_id: string;
  data: string;
  cols: number;
  rows: number;
}

export type SessionRuntimeStartResult = {
  terminal_id: number;
  started: boolean;
  terminal_runtime_id?: string | null;
};

export type WorkspaceControllerLease = {
  workspace_id: string;
  controller_device_id?: string | null;
  controller_client_id?: string | null;
  lease_expires_at: number;
  fencing_token: number;
  takeover_request_id?: string | null;
  takeover_requested_by_device_id?: string | null;
  takeover_requested_by_client_id?: string | null;
  takeover_deadline_at?: number | null;
};

export type WorkspaceSnapshot = {
  workspace: WorkspaceSummary;
  sessions: BackendSession[];
  view_state: BackendWorkspaceViewState;
  terminals: { id: number; output: string; recoverable: boolean }[];
};

export type WorkspaceRuntimeSnapshot = {
  snapshot: WorkspaceSnapshot;
  controller: WorkspaceControllerLease;
  lifecycle_events?: AgentLifecycleHistoryEntry[];
  session_runtime_bindings?: SessionRuntimeBindingInfo[];
};

export type WorkspaceRuntimeControllerEvent = {
  workspace_id: string;
  controller: WorkspaceControllerLease;
};

export type WorkspaceSessionState = {
  session_id: string;
  status: SessionStatus;
  last_active_at: number;
  resume_id?: string | null;
  runtime_liveness?: SessionRuntimeLiveness | null;
};

export type WorkspaceRuntimeStateEvent = {
  workspace_id: string;
  view_state?: BackendWorkspaceViewState;
  session_state?: WorkspaceSessionState;
};

export type WorkspaceInputErrorEvent = {
  workspace_id: string;
  kind: string;
  error: string;
};

export type WorkbenchLayout = {
  left_width: number;
  right_width: number;
  right_split: number;
  show_code_panel: boolean;
  show_terminal_panel: boolean;
};

export type WorkbenchUiState = {
  open_workspace_ids: string[];
  active_workspace_id?: string | null;
  layout: WorkbenchLayout;
};

export type WorkbenchBootstrap = {
  ui_state: WorkbenchUiState;
  workspaces: WorkspaceSnapshot[];
};

export type WorkspaceLaunchResult = {
  ui_state: WorkbenchUiState;
  snapshot: WorkspaceSnapshot;
  created: boolean;
  already_open: boolean;
};

export type SessionPatch = {
  title?: string;
  status?: SessionStatus;
  mode?: SessionMode;
  auto_feed?: boolean;
  queue?: BackendQueueTask[];
  messages?: BackendSessionMessage[];
  unread?: number;
  last_active_at?: number;
  resume_id?: string;
};

export type WorkspaceViewPatch = {
  active_session_id?: string;
  active_pane_id?: string;
  active_terminal_id?: string;
  pane_layout?: BackendWorkspaceViewState["pane_layout"];
  file_preview?: BackendWorkspaceViewState["file_preview"];
  supervisor?: BackendWorkspaceSupervisorViewState;
};

export type AgentEvent = {
  workspace_id: string;
  session_id: string;
  kind: "stdout" | "stderr" | "exit" | "system";
  data: string;
  raw_data?: string;
};

export type AgentLifecycleEvent = {
  workspace_id: string;
  session_id: string;
  kind: "session_started" | "turn_completed";
  source_event: string;
  data: string;
};

export type AgentLifecycleHistoryEntry = AgentLifecycleEvent & {
  seq: number;
};

export type TerminalEvent = {
  workspace_id: string;
  terminal_id: number;
  data: string;
};

export type ArtifactsDirtyEvent = {
  path: string;
  target: ExecTarget;
  reason: string;
  categories?: Array<"git" | "worktrees" | "tree" | "full">;
};

export type WorktreeDetail = {
  name: string;
  path: string;
  branch: string;
  status: string;
  diff: string;
  root: TreeNode;
  changes: TreeNode[];
};

export type FilesystemRoot = {
  id: string;
  label: string;
  path: string;
  description: string;
};

export type FilesystemEntry = {
  name: string;
  path: string;
  kind: "dir" | "file";
};

export type FilesystemListResponse = {
  current_path: string;
  home_path: string;
  parent_path?: string | null;
  roots: FilesystemRoot[];
  entries: FilesystemEntry[];
  requested_path?: string | null;
  fallback_reason?: string | null;
};

export type FolderBrowserState = {
  loading: boolean;
  currentPath: string;
  homePath: string;
  parentPath?: string;
  roots: FilesystemRoot[];
  entries: FilesystemEntry[];
  error?: string;
  notice?: string;
};

export type CommandAvailability = {
  command: string;
  available: boolean;
  resolved_path?: string | null;
  error?: string | null;
};

export type ProviderRuntimePreview = {
  provider: string;
  display_command: string;
};

export type AgentStartResult = {
  started: boolean;
};

export type BackendSessionRestoreResult = {
  session: BackendSession;
  already_active: boolean;
};

export type SessionRestoreResult = {
  session: BackendSession;
  alreadyActive: boolean;
};

export type AuthStatus = {
  public_mode: boolean;
  authenticated: boolean;
  password_configured: boolean;
  local_host: boolean;
  secure_transport_required: boolean;
  secure_transport_ok: boolean;
  session_idle_minutes: number;
  session_max_hours: number;
  allowed_roots: string[];
};

export type WorktreeModalState = {
  name: string;
  path: string;
  branch: string;
  status: string;
  diff?: string;
  tree?: TreeNode[];
  changes?: TreeNode[];
  loading?: boolean;
};

export type WorktreeView = "status" | "diff" | "tree";

export type CommandPaletteAction = {
  id: string;
  label: string;
  description: string;
  shortcut?: string;
  keywords: string;
  run: () => void;
};

export type WorkspaceTabItem = {
  id: string;
  label: string;
  active: boolean;
  hasRunning: boolean;
  unread: number;
};

export type BrowserNotificationSupport = "allowed" | "not-enabled" | "unsupported";

export type CompletionNotificationSettings = {
  enabled: boolean;
  onlyWhenBackground: boolean;
};

export type ClaudeRuntimeProfile = {
  executable: string;
  startupArgs: string[];
  env: Record<string, string>;
  settingsJson: Record<string, unknown>;
};

export type CodexRuntimeProfile = {
  executable: string;
  extraArgs: string[];
  model: string;
  apiKey: string;
  baseUrl: string;
};

export type ProviderSettingsPayload = {
  global: Record<string, unknown>;
};

export type AppSettingsPayload = {
  general: {
    locale: Locale;
    terminalCompatibilityMode: TerminalCompatibilityMode;
    completionNotifications: CompletionNotificationSettings;
    idlePolicy: IdlePolicy;
  };
  agentDefaults: {
    provider: string;
  };
  providers: Record<string, ProviderSettingsPayload>;
};

export type LegacyAppSettings = {
  general?: Partial<AppSettingsPayload["general"]>;
  agentDefaults?: Partial<AppSettingsPayload["agentDefaults"]>;
  providers?: Record<string, Partial<ProviderSettingsPayload> | undefined>;
  claude?: {
    global?: Partial<ClaudeRuntimeProfile>;
    overrides?: unknown;
  };
  codex?: {
    global?: Partial<CodexRuntimeProfile>;
    overrides?: unknown;
  };
  locale?: Locale;
  agentCommand?: string;
  idlePolicy?: Partial<IdlePolicy>;
  completionNotifications?: Partial<CompletionNotificationSettings>;
  terminalCompatibilityMode?: TerminalCompatibilityMode;
};

export type AppSettings = AppSettingsPayload;

export type AppSettingsUpdater = (settings: AppSettings) => AppSettings;

export type AgentCommandStatus = {
  loading: boolean;
  available: boolean | null;
  runtimeLabel: string;
  resolvedPath?: string;
  error?: string;
};

export type AppTheme = "dark";
export type AppRoute = "workspace" | "settings";
export type SettingsPanel = "general" | "appearance" | `provider:${string}`;

export type SettingsNavItem = {
  id: SettingsPanel;
  label: string;
  description: string;
  icon: ReactNode;
};

export type SettingsSection = {
  id: SettingsPanel;
  title: string;
  description: string;
  items: SettingsNavItem[];
};

export type WorkspaceHydration = {
  tabs: Tab[];
  activeTabId?: string;
  layout: {
    leftWidth: number;
    rightWidth: number;
    rightSplit: number;
    showCodePanel: boolean;
    showTerminalPanel: boolean;
  };
};

export type TerminalRecord = Terminal;
