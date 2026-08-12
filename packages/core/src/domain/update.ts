import type { UpdateRuntimeContext } from "./product-update";

export const UPDATE_CHECK_INTERVAL_OPTIONS = [3600, 21600, 43200, 86400] as const;

export const DEFAULT_UPDATE_CHECK_INTERVAL_SEC = 3600;
export const DEFAULT_UPDATE_AUTO_CHECK_ENABLED = true;

export type UpdateCheckIntervalSec = (typeof UPDATE_CHECK_INTERVAL_OPTIONS)[number];
export type UpdateAvailability = "unknown" | "up_to_date" | "update_available" | "check_failed";
export type UpdateStatus =
  | "idle"
  | "checking"
  | "installing"
  | "restarting"
  | "succeeded"
  | "failed"
  | "manual_required";

export interface UpdateStateFields {
  currentVersion: string;
  latestVersion: string | null;
  availability: UpdateAvailability;
  updateStatus: UpdateStatus;
  lastCheckedAt: number | null;
  targetVersion: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  requiresManualStep: boolean;
  manualCommand: string | null;
  errorSummary: string | null;
}

export interface UpdateStateSnapshotV1 extends UpdateStateFields {
  version: 1;
}

export interface UpdateStateSnapshot extends UpdateStateFields {
  version: 2;
  currentPublishedAt: string | null;
  latestPublishedAt: string | null;
}

export type ReadableUpdateStateSnapshot = UpdateStateSnapshotV1 | UpdateStateSnapshot;

export interface UpdateActivitySummary {
  runningTerminalCount: number;
  runningSessionCount: number;
  runningSupervisorCount: number;
  hasActiveWork: boolean;
}

export interface UpdateSupportInfo {
  supported: boolean;
  installKind: "global_npm" | "unsupported";
  unsupportedReason: string | null;
  runtimeContext: UpdateRuntimeContext;
}

export interface UpdateStateView extends UpdateStateSnapshot, UpdateSupportInfo {}

export interface UpdatePrepareInstallResponse extends UpdateStateView {
  canStartInstall: boolean;
  activity: UpdateActivitySummary;
}

export interface UpdateSettings {
  autoCheckEnabled: boolean;
  checkIntervalSec: UpdateCheckIntervalSec;
}

export function isUpdateCheckIntervalSec(value: unknown): value is UpdateCheckIntervalSec {
  return (
    typeof value === "number" &&
    UPDATE_CHECK_INTERVAL_OPTIONS.includes(value as UpdateCheckIntervalSec)
  );
}

export function resolveUpdateCheckIntervalSec(value: unknown): UpdateCheckIntervalSec {
  return isUpdateCheckIntervalSec(value) ? value : DEFAULT_UPDATE_CHECK_INTERVAL_SEC;
}

export function resolveUpdateAutoCheckEnabled(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_UPDATE_AUTO_CHECK_ENABLED;
}

export function createDefaultUpdateState(
  currentVersion: string,
  currentPublishedAt: string | null = null
): UpdateStateSnapshot {
  return {
    version: 2,
    currentVersion,
    currentPublishedAt,
    latestVersion: null,
    latestPublishedAt: null,
    availability: "unknown",
    updateStatus: "idle",
    lastCheckedAt: null,
    targetVersion: null,
    startedAt: null,
    finishedAt: null,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
  };
}

export function createDefaultUpdateSettings(): UpdateSettings {
  return {
    autoCheckEnabled: DEFAULT_UPDATE_AUTO_CHECK_ENABLED,
    checkIntervalSec: DEFAULT_UPDATE_CHECK_INTERVAL_SEC,
  };
}
