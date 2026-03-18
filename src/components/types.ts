// ==========================================================================
// Coder Studio - Component Types
// ==========================================================================

import type { SessionStatus, SessionMode, Tab, Session, TreeNode, SessionPaneNode, FilePreview, GitChange, WorktreeInfo } from "../state/workbench";
import type { Translator, Locale } from "../i18n";
import type { ReactNode, MouseEvent, KeyboardEvent } from "react";

// --- Theme & Locale ---

export type AppTheme = "dark" | "light";

export type AppRoute = "workspace" | "settings";

export type SettingsPanel = "general" | "appearance";

// --- Workspace Types ---

export type WorkspaceTabItem = {
  id: string;
  label: string;
  active: boolean;
  hasRunning: boolean;
  unread: number;
};

// --- Session Types ---

export type QueueTask = {
  id: number;
  text: string;
  status: "queued" | "running" | "done";
};

export type SessionStatusInfo = {
  status: SessionStatus;
  mode: SessionMode;
  title: string;
  isDraft: boolean;
  unread: number;
  queue: QueueTask[];
  stream: string;
};

// --- Git Types ---

export type GitSummary = {
  changes: number;
  staged: number;
  untracked: number;
};

export type GitChangeGroup = {
  key: string;
  label: string;
  items: GitChange[];
};

// --- File Tree Types ---

export type TreeNodeProps = {
  nodes: TreeNode[];
  depth?: number;
  onSelect: (node: TreeNode) => void;
  collapsedPaths: Set<string>;
  onToggleCollapse: (path: string) => void;
  locale?: Locale;
};

// --- Settings Types ---

export type AppSettings = {
  agentProvider: Tab["agent"]["provider"];
  agentCommand: string;
  idlePolicy: Tab["idlePolicy"];
};

export type SettingsNavItem = {
  id: SettingsPanel;
  label: string;
  icon: ReactNode;
};

// --- Component Props ---

export type TopBarProps = {
  theme: AppTheme;
  locale: Locale;
  route: AppRoute;
  workspaceTabs: WorkspaceTabItem[];
  onSwitchWorkspace: (id: string) => void;
  onAddTab: () => void;
  onRemoveTab: (id: string) => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onToggleTheme: () => void;
  onToggleLocale: () => void;
  t: Translator;
};

export type SidebarProps = {
  locale: Locale;
  sessions: Session[];
  activeSession: Session;
  fileTree: TreeNode[];
  collapsedPaths: Set<string>;
  leftRailView: string;
  railItems: Array<{ id: string; label: string; icon: ReactNode }>;
  queueSession: SessionStatusInfo;
  queueInput: string;
  queueAutoFeed: boolean;
  gitBranch: string;
  gitChanges: number;
  gitSummary: GitSummary;
  gitChangeGroups: GitChangeGroup[];
  worktrees: WorktreeInfo[];
  isArchiveView: boolean;
  onSwitchSession: (id: string) => void;
  onNewSession: () => void;
  onToggleAutoFeed: () => void;
  onQueueInputChange: (value: string) => void;
  onQueueAdd: () => void;
  onQueueRun: () => void;
  onFileSelect: (node: TreeNode) => void;
  onToggleCollapse: (path: string) => void;
  onLeftRailViewChange: (view: string) => void;
  onGitChangeSelect: (change: GitChange) => void;
  onGitChangeAction: (change: GitChange, action: "stage" | "unstage" | "discard") => void;
  onOpenWorktree: (tree: WorktreeInfo) => void;
  onRefreshWorkspace: () => void;
  t: Translator;
};

export type WorkspaceProps = {
  theme: AppTheme;
  locale: Locale;
  activeTab: Tab;
  activeSession: Session;
  paneLayout: SessionPaneNode;
  showCodePanel: boolean;
  showTerminalPanel: boolean;
  isArchiveView: boolean;
  archiveSession: Session | null;
  queuePlainStream: string;
  editorMetrics: {
    terminalFontSize: number;
  };
  onSplitPane: (paneId: string, direction: "horizontal" | "vertical") => void;
  onClosePane: (paneId: string) => void;
  onToggleRightPane: (pane: "code" | "terminal") => void;
  onExitArchive: () => void;
  t: Translator;
};

export type InspectorProps = {
  theme: AppTheme;
  locale: Locale;
  activeTab: Tab;
  filePreview: FilePreview;
  fileProgressPercent: number;
  fileProgressTone: "loading" | "error" | "";
  onFileClose: () => void;
  t: Translator;
};

export type SettingsProps = {
  theme: AppTheme;
  locale: Locale;
  settings: AppSettings;
  settingsNavItems: SettingsNavItem[];
  activeSettingsPanel: SettingsPanel;
  settingsDraft: AppSettings;
  onSettingsChange: (settings: Partial<AppSettings>) => void;
  onSettingsIdlePolicyChange: (policy: Partial<AppSettings["idlePolicy"]>) => void;
  onSettingsPanelChange: (panel: SettingsPanel) => void;
  onThemeChange: (theme: AppTheme) => void;
  onLocaleChange: (locale: Locale) => void;
  onCloseSettings: () => void;
  t: Translator;
};

// --- Event Handlers ---

export type EventHandlers = {
  onSwitchWorkspace: (id: string) => void;
  onRemoveTab: (id: string) => void;
  onAddTab: () => void;
  onOpenSettings: () => void;
  onSwitchSession: (id: string) => void;
  onNewSession: () => void;
  onToggleAutoFeed: () => void;
  onQueueAdd: () => void;
  onQueueRun: () => void;
  onQueueInputChange: (value: string) => void;
  onFileSelect: (node: TreeNode) => void;
  onToggleCollapse: (path: string) => void;
  onLeftRailViewChange: (view: string) => void;
  onGitChangeSelect: (change: GitChange) => void;
  onGitChangeAction: (change: GitChange, action: "stage" | "unstage" | "discard") => void;
  onGitStageAll: () => void;
  onGitUnstageAll: () => void;
  onGitDiscardAll: () => void;
  onGitCommit: () => void;
  onOpenWorktree: (tree: WorktreeInfo) => void;
  onRefreshWorkspace: () => void;
  onSplitPane: (paneId: string, direction: "horizontal" | "vertical") => void;
  onClosePane: (paneId: string) => void;
  onToggleRightPane: (pane: "code" | "terminal") => void;
  onFileClose: () => void;
  onExitArchive: () => void;
  onSettingsChange: (settings: Partial<AppSettings>) => void;
  onSettingsIdlePolicyChange: (policy: Partial<AppSettings["idlePolicy"]>) => void;
  onSettingsPanelChange: (panel: SettingsPanel) => void;
  onThemeChange: (theme: AppTheme) => void;
  onLocaleChange: (locale: Locale) => void;
};
