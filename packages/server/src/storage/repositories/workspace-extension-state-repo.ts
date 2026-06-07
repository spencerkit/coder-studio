import {
  createEmptyWorkspaceExtensionStateView,
  WORKSPACE_LOG_LEVELS,
  WORKSPACE_STATUS_PILL_STATES,
  type WorkspaceExtensionStateView,
  type WorkspaceLogEntryView,
  type WorkspaceProgressView,
  type WorkspaceQuickActionView,
  type WorkspaceStatusPillView,
} from "@coder-studio/core";
import {
  resolveWorkspaceStateFilePath,
  WORKSPACE_EXTENSION_STATE_FILE_NAME,
} from "../../workspace/workspace-state.js";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

interface WorkspaceExtensionStateFileRecord {
  version: 1;
  state: WorkspaceExtensionStateView;
}

interface WorkspaceExtensionStateWorkspace {
  id: string;
  path: string;
}

interface WorkspaceExtensionStateWorkspaceRepo {
  findById(id: string): WorkspaceExtensionStateWorkspace | undefined;
}

export interface WorkspaceExtensionStateRepoOptions {
  workspaceRepo: WorkspaceExtensionStateWorkspaceRepo;
  now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStatusPillState(value: unknown): value is WorkspaceStatusPillView["state"] {
  return typeof value === "string" && WORKSPACE_STATUS_PILL_STATES.includes(value as never);
}

function isLogLevel(value: unknown): value is WorkspaceLogEntryView["level"] {
  return typeof value === "string" && WORKSPACE_LOG_LEVELS.includes(value as never);
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeStatusPill(value: unknown, now: () => number): WorkspaceStatusPillView | null {
  if (!isRecord(value) || typeof value.key !== "string" || typeof value.label !== "string") {
    return null;
  }

  if (!isStatusPillState(value.state)) {
    return null;
  }

  return {
    key: value.key,
    label: value.label,
    state: value.state,
    detail: normalizeOptionalString(value.detail),
    updatedAt: normalizeOptionalNumber(value.updatedAt) ?? now(),
  };
}

function normalizeProgress(value: unknown, now: () => number): WorkspaceProgressView | null {
  if (!isRecord(value) || typeof value.key !== "string" || typeof value.label !== "string") {
    return null;
  }

  return {
    key: value.key,
    label: value.label,
    value: normalizeOptionalNumber(value.value),
    max: normalizeOptionalNumber(value.max),
    detail: normalizeOptionalString(value.detail),
    updatedAt: normalizeOptionalNumber(value.updatedAt) ?? now(),
  };
}

function normalizeLogEntry(value: unknown, now: () => number): WorkspaceLogEntryView | null {
  if (!isRecord(value) || typeof value.key !== "string" || typeof value.message !== "string") {
    return null;
  }

  if (!isLogLevel(value.level)) {
    return null;
  }

  return {
    key: value.key,
    level: value.level,
    message: value.message,
    timestamp: normalizeOptionalNumber(value.timestamp) ?? now(),
  };
}

function normalizeQuickAction(value: unknown): WorkspaceQuickActionView | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.label !== "string" ||
    typeof value.command !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    label: value.label,
    command: value.command,
    description: normalizeOptionalString(value.description),
  };
}

function normalizeState(
  workspaceId: string,
  value: unknown,
  now: () => number
): WorkspaceExtensionStateView {
  if (!isRecord(value)) {
    return createEmptyWorkspaceExtensionStateView(workspaceId, { now });
  }

  return {
    workspaceId,
    statusPills: Array.isArray(value.statusPills)
      ? value.statusPills
          .map((item) => normalizeStatusPill(item, now))
          .filter((item): item is WorkspaceStatusPillView => item !== null)
      : [],
    progress: Array.isArray(value.progress)
      ? value.progress
          .map((item) => normalizeProgress(item, now))
          .filter((item): item is WorkspaceProgressView => item !== null)
      : [],
    logs: Array.isArray(value.logs)
      ? value.logs
          .map((item) => normalizeLogEntry(item, now))
          .filter((item): item is WorkspaceLogEntryView => item !== null)
      : [],
    quickActions: Array.isArray(value.quickActions)
      ? value.quickActions
          .map(normalizeQuickAction)
          .filter((item): item is WorkspaceQuickActionView => item !== null)
      : [],
    updatedAt: normalizeOptionalNumber(value.updatedAt) ?? now(),
  };
}

function normalizeFileState(
  workspaceId: string,
  value: unknown,
  now: () => number
): WorkspaceExtensionStateView {
  if (isRecord(value) && value.version === 1 && isRecord(value.state)) {
    return normalizeState(workspaceId, value.state, now);
  }

  return normalizeState(workspaceId, value, now);
}

export class WorkspaceExtensionStateRepo {
  private readonly workspaceRepo: WorkspaceExtensionStateWorkspaceRepo;
  private readonly now: () => number;

  constructor(input: WorkspaceExtensionStateRepoOptions) {
    this.workspaceRepo = input.workspaceRepo;
    this.now = input.now ?? (() => Date.now());
  }

  get(workspaceId: string): WorkspaceExtensionStateView {
    const workspace = this.requireWorkspace(workspaceId);
    const parsed = readJsonFile<WorkspaceExtensionStateFileRecord | WorkspaceExtensionStateView>(
      resolveWorkspaceStateFilePath(workspace.path, WORKSPACE_EXTENSION_STATE_FILE_NAME)
    );

    if (parsed === undefined) {
      return createEmptyWorkspaceExtensionStateView(workspace.id, { now: this.now });
    }

    return normalizeFileState(workspace.id, parsed, this.now);
  }

  save(state: WorkspaceExtensionStateView): WorkspaceExtensionStateView {
    const workspace = this.requireWorkspace(state.workspaceId);
    const normalized = normalizeState(workspace.id, state, this.now);
    writeJsonFileAtomic(
      resolveWorkspaceStateFilePath(workspace.path, WORKSPACE_EXTENSION_STATE_FILE_NAME),
      {
        version: 1,
        state: normalized,
      }
    );
    return normalized;
  }

  private requireWorkspace(workspaceId: string): WorkspaceExtensionStateWorkspace {
    const workspace = this.workspaceRepo.findById(workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${workspaceId}` };
    }

    return workspace;
  }
}
