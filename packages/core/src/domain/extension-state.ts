export const WORKSPACE_STATUS_PILL_STATES = [
  "idle",
  "running",
  "success",
  "warning",
  "error",
] as const;

export const WORKSPACE_LOG_LEVELS = ["info", "warning", "error"] as const;

export type WorkspaceStatusPillState = (typeof WORKSPACE_STATUS_PILL_STATES)[number];
export type WorkspaceLogLevel = (typeof WORKSPACE_LOG_LEVELS)[number];

export interface WorkspaceStatusPillView {
  key: string;
  label: string;
  state: WorkspaceStatusPillState;
  detail?: string;
  updatedAt: number;
}

export interface WorkspaceProgressView {
  key: string;
  label: string;
  value?: number;
  max?: number;
  detail?: string;
  updatedAt: number;
}

export interface WorkspaceLogEntryView {
  key: string;
  level: WorkspaceLogLevel;
  message: string;
  timestamp: number;
}

export interface WorkspaceQuickActionView {
  id: string;
  label: string;
  command: string;
  description?: string;
}

export interface WorkspaceExtensionStateView {
  workspaceId: string;
  statusPills: WorkspaceStatusPillView[];
  progress: WorkspaceProgressView[];
  logs: WorkspaceLogEntryView[];
  quickActions: WorkspaceQuickActionView[];
  updatedAt: number;
}

export interface CreateWorkspaceExtensionStateViewOptions {
  now?: () => number;
}

export function createEmptyWorkspaceExtensionStateView(
  workspaceId: string,
  options: CreateWorkspaceExtensionStateViewOptions = {}
): WorkspaceExtensionStateView {
  return {
    workspaceId,
    statusPills: [],
    progress: [],
    logs: [],
    quickActions: [],
    updatedAt: options.now?.() ?? Date.now(),
  };
}
