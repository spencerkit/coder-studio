import type { ReactNode } from "react";
import type { ExecTarget, GitChange, SessionMode, SessionStatus, Tab, TreeNode } from "../state/workbench";

export type Toast = { id: string; text: string; sessionId: string };

export type WorkspaceInfo = {
  tab_id: string;
  project_path: string;
  target: ExecTarget;
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

export type BackendSession = {
  id: number;
  status: SessionStatus;
  mode: SessionMode;
  auto_feed: boolean;
  queue: BackendQueueTask[];
  last_active_at: number;
  claude_session_id?: string | null;
};

export type BackendArchiveEntry = {
  id: number;
  session_id: number;
  mode: SessionMode;
  time: string;
};

export type TabSnapshot = {
  tab_id: string;
  project_path: string;
  target: ExecTarget;
  idle_policy: {
    enabled: boolean;
    idle_minutes: number;
    max_active: number;
    pressure: boolean;
  };
  sessions: BackendSession[];
  active_session_id: number;
  archive: BackendArchiveEntry[];
  terminals: { id: number; output: string }[];
};

export type SessionPatch = {
  status?: SessionStatus;
  mode?: SessionMode;
  auto_feed?: boolean;
  last_active_at?: number;
  claude_session_id?: string;
};

export type AgentEvent = {
  tab_id: string;
  session_id: string;
  kind: "stdout" | "stderr" | "exit" | "system";
  data: string;
};

export type AgentLifecycleEvent = {
  tab_id: string;
  session_id: string;
  kind: "session_started" | "turn_waiting" | "tool_started" | "tool_finished" | "approval_required" | "turn_completed" | "session_ended";
  source_event: string;
  data: string;
};

export type TerminalEvent = {
  tab_id: string;
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
  idlePolicy: Tab["idlePolicy"];
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
  icon: ReactNode;
};
