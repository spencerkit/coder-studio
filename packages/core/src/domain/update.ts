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

export interface UpdateStateSnapshot {
  version: 1;
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

export interface UpdateActivitySummary {
  runningTerminalCount: number;
  runningSessionCount: number;
  runningSupervisorCount: number;
  hasActiveWork: boolean;
}

export interface UpdateSupportInfo {
  supported: boolean;
  installKind: "global_npm" | "desktop_managed" | "unsupported";
  unsupportedReason: string | null;
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

export function createDefaultUpdateState(currentVersion: string): UpdateStateSnapshot {
  return {
    version: 1,
    currentVersion,
    latestVersion: null,
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
