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
  env?: Record<string, string>;
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
  /**
   * Human-friendly title derived from the user's first submitted instruction
   * (trimmed/truncated to SESSION_TITLE_MAX_LENGTH). Assigned once on first
   * submit and never overwritten afterwards. Undefined until the user sends
   * their first message.
   */
  title?: string;
}

/**
 * Maximum character length for {@link Session.title}. The first submitted
 * instruction is trimmed and truncated to this length (with an ellipsis when
 * clipped) before being persisted.
 */
export const SESSION_TITLE_MAX_LENGTH = 10;

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

export interface GitBranch {
  name: string;        // Branch name (e.g., "main", "origin/feature")
  isRemote: boolean;   // Whether it's a remote branch
  isCurrent: boolean;  // Whether it's the current branch
  remote?: string;     // Remote name (e.g., "origin")
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
    soundEnabled: boolean;
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

export interface ProviderRuntimeStatusEntry {
  command: string;
  installed: boolean;
  version?: string;
  path?: string;
  error?: string;
}

export interface ProviderRuntimeStatusResponse {
  providerId: string;
  entries: ProviderRuntimeStatusEntry[];
}

export interface ProviderInstallStepSnapshot {
  id: string;
  kind: 'prerequisite' | 'provider';
  targetCommand: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  command: string;
  args: string[];
  requiresCommands: string[];
  startedAt?: number;
  completedAt?: number;
  exitCode?: number;
  error?: string;
}

export interface ProviderInstallFailure {
  stepId: string;
  message: string;
  code?: string;
  retryable?: boolean;
}

export interface ProviderInstallJobSnapshot {
  providerId: string;
  platform: NodeJS.Platform;
  status: 'pending' | 'running' | 'completed' | 'failed';
  steps: ProviderInstallStepSnapshot[];
  failure?: ProviderInstallFailure;
  startedAt?: number;
  completedAt?: number;
}

/**
 * Derive a compact session title from a raw input buffer (the bytes a user
 * just submitted to the agent terminal). Returns undefined when the buffer
 * contains nothing meaningful after trimming.
 *
 * Rules:
 *   - Collapse all whitespace (including newlines) into single spaces.
 *   - Trim leading/trailing whitespace.
 *   - Truncate to SESSION_TITLE_MAX_LENGTH; if clipped, the final character is
 *     replaced with an ellipsis ("…") so the total length is still at most
 *     SESSION_TITLE_MAX_LENGTH.
 */
export function deriveSessionTitle(raw: string): string | undefined {
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;

  if (normalized.length <= SESSION_TITLE_MAX_LENGTH) {
    return normalized;
  }

  // Reserve the last slot for the ellipsis so we stay within the budget.
  return normalized.slice(0, SESSION_TITLE_MAX_LENGTH - 1) + '…';
}
