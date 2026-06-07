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
import { atom } from "jotai";
import { atomFamily } from "jotai-family";

const statusPillStates = new Set<string>(WORKSPACE_STATUS_PILL_STATES);
const logLevels = new Set<string>(WORKSPACE_LOG_LEVELS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sanitizeStatusPill(value: unknown): WorkspaceStatusPillView | null {
  if (!isRecord(value)) {
    return null;
  }

  const key = readString(value.key);
  const label = readString(value.label);
  const state = readString(value.state);
  const updatedAt = readNumber(value.updatedAt);

  if (!key || !label || !state || !statusPillStates.has(state) || updatedAt === undefined) {
    return null;
  }

  return {
    key,
    label,
    state: state as WorkspaceStatusPillView["state"],
    detail: readString(value.detail),
    updatedAt,
  };
}

function sanitizeProgress(value: unknown): WorkspaceProgressView | null {
  if (!isRecord(value)) {
    return null;
  }

  const key = readString(value.key);
  const label = readString(value.label);
  const updatedAt = readNumber(value.updatedAt);

  if (!key || !label || updatedAt === undefined) {
    return null;
  }

  return {
    key,
    label,
    value: readNumber(value.value),
    max: readNumber(value.max),
    detail: readString(value.detail),
    updatedAt,
  };
}

function sanitizeLogEntry(value: unknown): WorkspaceLogEntryView | null {
  if (!isRecord(value)) {
    return null;
  }

  const key = readString(value.key);
  const level = readString(value.level);
  const message = readString(value.message);
  const timestamp = readNumber(value.timestamp);

  if (!key || !level || !logLevels.has(level) || !message || timestamp === undefined) {
    return null;
  }

  return {
    key,
    level: level as WorkspaceLogEntryView["level"],
    message,
    timestamp,
  };
}

function sanitizeQuickAction(value: unknown): WorkspaceQuickActionView | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const label = readString(value.label);
  const command = readString(value.command);

  if (!id || !label || !command) {
    return null;
  }

  return {
    id,
    label,
    command,
    description: readString(value.description),
  };
}

function sanitizeArray<T>(value: unknown, sanitize: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(sanitize).filter((item): item is T => item !== null);
}

export function normalizeWorkspaceExtensionStateView(
  workspaceId: string,
  value: unknown
): WorkspaceExtensionStateView {
  const candidate = isRecord(value) ? value : {};

  return {
    workspaceId,
    statusPills: sanitizeArray(candidate.statusPills, sanitizeStatusPill),
    progress: sanitizeArray(candidate.progress, sanitizeProgress),
    logs: sanitizeArray(candidate.logs, sanitizeLogEntry),
    quickActions: sanitizeArray(candidate.quickActions, sanitizeQuickAction),
    updatedAt: readNumber(candidate.updatedAt) ?? Date.now(),
  };
}

export const workspaceExtensionStateAtomFamily = atomFamily((workspaceId: string) =>
  atom<WorkspaceExtensionStateView>(createEmptyWorkspaceExtensionStateView(workspaceId))
);

export const workspaceExtensionStateStatusPillsAtomFamily = atomFamily((workspaceId: string) =>
  atom((get) => get(workspaceExtensionStateAtomFamily(workspaceId)).statusPills)
);

export const workspaceExtensionStateProgressAtomFamily = atomFamily((workspaceId: string) =>
  atom((get) => get(workspaceExtensionStateAtomFamily(workspaceId)).progress)
);

export const workspaceExtensionStateLogsAtomFamily = atomFamily((workspaceId: string) =>
  atom((get) => get(workspaceExtensionStateAtomFamily(workspaceId)).logs)
);

export const workspaceExtensionStateQuickActionsAtomFamily = atomFamily((workspaceId: string) =>
  atom((get) => get(workspaceExtensionStateAtomFamily(workspaceId)).quickActions)
);

export const setWorkspaceExtensionStateAtom = atom(
  null,
  (_get, set, state: WorkspaceExtensionStateView) => {
    set(
      workspaceExtensionStateAtomFamily(state.workspaceId),
      normalizeWorkspaceExtensionStateView(state.workspaceId, state)
    );
  }
);
