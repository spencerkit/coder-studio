// Core domain types (spec §12.1)

export interface Workspace {
  name?: string;
  isActive?: boolean;
  unreadCount?: number;
  id: string;
  path: string;
  targetRuntime: 'native' | 'wsl';
  wslDistro?: string;
  openedAt: number;
  lastActiveAt: number;
  uiState: UiState;
}

export interface UiState {
  leftPanelWidth: number;
  bottomPanelHeight: number;
  focusMode: boolean;
  activeSessionId?: string;
}

export interface Terminal {
  id: string;
  workspaceId: string;
  kind: 'agent' | 'shell';
  title: string;
  cwd: string;
  argv: string[];
  cols: number;
  rows: number;
  alive: boolean;
  createdAt: number;
  endedAt?: number;
  exitCode?: number;
}

export interface Session {
  id: string;
  workspaceId: string;
  terminalId: string;
  providerId: string;
  state: SessionState;
  resumeId?: string;
  capability: 'full' | 'limited' | 'unsupported';
  startedAt: number;
  lastActiveAt: number;
  endedAt?: number;
  completionPercent?: number;
  errorReason?: string;
  transcriptPath?: string;
}

export type SessionState =
  | 'draft'
  | 'starting'
  | 'running'
  | 'idle'
  | 'interrupted'
  | 'unavailable'
  | 'ended';

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: GitFileChange[];
  modified: GitFileChange[];
  untracked: GitFileChange[];
  deleted: GitFileChange[];
}

export interface GitFileChange {
  path: string;
  oldPath?: string; // for renames
}

export interface FileNode {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  children?: FileNode[];
  size?: number;
  mtime?: number;
}

export interface Settings {
  defaultProviderId: string;
  notifications: {
    enabled: boolean;
    onlyWhenBackgrounded: boolean;
  };
  appearance: {
    theme: 'dark';
    terminalRenderer: 'standard' | 'compatibility';
    locale: 'zh' | 'en';
  };
  providerConfigs: Record<string, ProviderConfig>;
}

export interface ProviderConfig {
  [key: string]: unknown;
}
