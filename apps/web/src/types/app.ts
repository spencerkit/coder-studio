import type { ReactNode } from "react";
import type {
  AgentMessage,
  ExecTarget,
  FilePreview,
  GitChange,
  IdlePolicy,
  SessionMode,
  SessionStatus,
  Tab,
  Terminal,
  TreeNode,
} from "../state/workbench";

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
  id: number;
  title: string;
  status: SessionStatus;
  mode: SessionMode;
  auto_feed: boolean;
  queue: BackendQueueTask[];
  messages: BackendSessionMessage[];
  stream: string;
  unread: number;
  last_active_at: number;
  claude_session_id?: string | null;
};

export type BackendArchiveEntry = {
  id: number;
  session_id: number;
  mode: SessionMode;
  time: string;
};

export type BackendWorkspaceViewState = {
  active_session_id: string;
  active_pane_id: string;
  pane_layout: Tab["paneLayout"];
  file_preview: FilePreview;
};

export type WorkspaceSnapshot = {
  workspace: WorkspaceSummary;
  sessions: BackendSession[];
  archive: Array<BackendArchiveEntry & { snapshot: BackendSession }>;
  view_state: BackendWorkspaceViewState;
  terminals: { id: number; output: string }[];
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
  stream?: string;
  unread?: number;
  last_active_at?: number;
  claude_session_id?: string;
};

export type WorkspaceViewPatch = {
  active_session_id?: string;
  active_pane_id?: string;
  pane_layout?: BackendWorkspaceViewState["pane_layout"];
  file_preview?: BackendWorkspaceViewState["file_preview"];
};

export type AgentEvent = {
  workspace_id: string;
  session_id: string;
  kind: "stdout" | "stderr" | "exit" | "system";
  data: string;
};

export type AgentLifecycleEvent = {
  workspace_id: string;
  session_id: string;
  kind: "session_started" | "turn_waiting" | "tool_started" | "tool_finished" | "approval_required" | "turn_completed" | "session_ended";
  source_event: string;
  data: string;
};

export type TerminalEvent = {
  workspace_id: string;
  terminal_id: number;
  data: string;
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

export type AgentStartResult = {
  started: boolean;
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

export type ClaudeSlashSkillEntry = {
  id: string;
  command: string;
  description: string;
  scope: "project" | "personal";
  source_kind: "skill" | "command";
  source_path: string;
};

export type ClaudeSlashMenuItem = {
  id: string;
  command: string;
  description: string;
  section: "builtin" | "bundled" | "project" | "personal";
  sourcePath?: string;
  sourceKind?: "skill" | "command";
};

export type ClaudeSlashMenuSection = {
  id: ClaudeSlashMenuItem["section"];
  label: string;
  items: ClaudeSlashMenuItem[];
};

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

export type AppSettings = {
  agentProvider: Tab["agent"]["provider"];
  agentCommand: string;
  idlePolicy: IdlePolicy;
  terminalCompatibilityMode: TerminalCompatibilityMode;
};

export type AgentCommandStatus = {
  loading: boolean;
  available: boolean | null;
  runtimeLabel: string;
  resolvedPath?: string;
  error?: string;
};

export type AppTheme = "dark";
export type AppRoute = "workspace" | "settings";
export type SettingsPanel = "general" | "appearance";

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
