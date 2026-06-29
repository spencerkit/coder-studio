import type { UpdateStateSnapshot } from "@coder-studio/core";

export interface DesktopUpdateStartInstallInput {
  targetVersion: string;
  currentVersion: string;
}

export interface DesktopUpdateCheckForUpdatesInput {
  currentVersion: string;
}

export interface DesktopUpdateCheckForUpdatesResult {
  latestVersion: string | null;
}

export type DesktopUpdateStatePatch = Partial<
  Pick<
    UpdateStateSnapshot,
    | "currentVersion"
    | "latestVersion"
    | "availability"
    | "updateStatus"
    | "lastCheckedAt"
    | "targetVersion"
    | "startedAt"
    | "finishedAt"
    | "requiresManualStep"
    | "manualCommand"
    | "errorSummary"
  >
>;

export interface DesktopUpdateStateController {
  applyPatch(patch: DesktopUpdateStatePatch): void;
}

export interface DesktopUpdateAdapter {
  startInstall(input: DesktopUpdateStartInstallInput): Promise<void>;
  checkForUpdates?(
    input: DesktopUpdateCheckForUpdatesInput
  ): Promise<DesktopUpdateCheckForUpdatesResult>;
  bindStateController?(controller: DesktopUpdateStateController): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAvailability(value: unknown): value is UpdateStateSnapshot["availability"] {
  return (
    value === "unknown" ||
    value === "up_to_date" ||
    value === "update_available" ||
    value === "check_failed"
  );
}

function isStatus(value: unknown): value is UpdateStateSnapshot["updateStatus"] {
  return (
    value === "idle" ||
    value === "checking" ||
    value === "installing" ||
    value === "restarting" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "manual_required"
  );
}

function assignNullableString(
  patch: DesktopUpdateStatePatch,
  key: "latestVersion" | "targetVersion" | "manualCommand" | "errorSummary",
  value: unknown
): void {
  if (value === null || typeof value === "string") {
    patch[key] = value;
    return;
  }

  throw new Error(`Desktop update state patch field "${key}" must be a string or null`);
}

function assignNullableNumber(
  patch: DesktopUpdateStatePatch,
  key: "lastCheckedAt" | "startedAt" | "finishedAt",
  value: unknown
): void {
  if (value === null || typeof value === "number") {
    patch[key] = value;
    return;
  }

  throw new Error(`Desktop update state patch field "${key}" must be a number or null`);
}

export function normalizeDesktopUpdateStatePatch(value: unknown): DesktopUpdateStatePatch {
  if (!isRecord(value)) {
    throw new Error("Desktop update state patch must be an object");
  }

  const patch: DesktopUpdateStatePatch = {};

  if ("currentVersion" in value) {
    if (typeof value.currentVersion !== "string") {
      throw new Error('Desktop update state patch field "currentVersion" must be a string');
    }
    patch.currentVersion = value.currentVersion;
  }
  if ("latestVersion" in value) {
    assignNullableString(patch, "latestVersion", value.latestVersion);
  }
  if ("availability" in value) {
    if (!isAvailability(value.availability)) {
      throw new Error('Desktop update state patch field "availability" is invalid');
    }
    patch.availability = value.availability;
  }
  if ("updateStatus" in value) {
    if (!isStatus(value.updateStatus)) {
      throw new Error('Desktop update state patch field "updateStatus" is invalid');
    }
    patch.updateStatus = value.updateStatus;
  }
  if ("lastCheckedAt" in value) {
    assignNullableNumber(patch, "lastCheckedAt", value.lastCheckedAt);
  }
  if ("targetVersion" in value) {
    assignNullableString(patch, "targetVersion", value.targetVersion);
  }
  if ("startedAt" in value) {
    assignNullableNumber(patch, "startedAt", value.startedAt);
  }
  if ("finishedAt" in value) {
    assignNullableNumber(patch, "finishedAt", value.finishedAt);
  }
  if ("requiresManualStep" in value) {
    if (typeof value.requiresManualStep !== "boolean") {
      throw new Error('Desktop update state patch field "requiresManualStep" must be a boolean');
    }
    patch.requiresManualStep = value.requiresManualStep;
  }
  if ("manualCommand" in value) {
    assignNullableString(patch, "manualCommand", value.manualCommand);
  }
  if ("errorSummary" in value) {
    assignNullableString(patch, "errorSummary", value.errorSummary);
  }

  return patch;
}
