import {
  createDefaultUpdateState,
  type ReadableUpdateStateSnapshot,
  type UpdateStateSnapshot,
} from "@coder-studio/core";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

export interface UpdateStateRepoOptions {
  filePath: string;
  currentVersion: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePublishedAt(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeUpdateState(value: unknown, currentVersion: string): UpdateStateSnapshot {
  const defaults = createDefaultUpdateState(currentVersion);
  if (!isRecord(value)) {
    return defaults;
  }

  return {
    version: 2,
    currentVersion:
      typeof value.currentVersion === "string" ? value.currentVersion : defaults.currentVersion,
    currentPublishedAt: normalizePublishedAt(value.currentPublishedAt),
    latestVersion: typeof value.latestVersion === "string" ? value.latestVersion : null,
    latestPublishedAt: normalizePublishedAt(value.latestPublishedAt),
    availability:
      value.availability === "unknown" ||
      value.availability === "up_to_date" ||
      value.availability === "update_available" ||
      value.availability === "check_failed"
        ? value.availability
        : defaults.availability,
    updateStatus:
      value.updateStatus === "idle" ||
      value.updateStatus === "checking" ||
      value.updateStatus === "installing" ||
      value.updateStatus === "restarting" ||
      value.updateStatus === "succeeded" ||
      value.updateStatus === "failed" ||
      value.updateStatus === "manual_required"
        ? value.updateStatus
        : defaults.updateStatus,
    lastCheckedAt: typeof value.lastCheckedAt === "number" ? value.lastCheckedAt : null,
    targetVersion: typeof value.targetVersion === "string" ? value.targetVersion : null,
    startedAt: typeof value.startedAt === "number" ? value.startedAt : null,
    finishedAt: typeof value.finishedAt === "number" ? value.finishedAt : null,
    requiresManualStep:
      typeof value.requiresManualStep === "boolean" ? value.requiresManualStep : false,
    manualCommand: typeof value.manualCommand === "string" ? value.manualCommand : null,
    errorSummary: typeof value.errorSummary === "string" ? value.errorSummary : null,
  };
}

export class UpdateStateRepo {
  private readonly filePath: string;
  private readonly currentVersion: string;

  constructor(options: UpdateStateRepoOptions) {
    this.filePath = options.filePath;
    this.currentVersion = options.currentVersion;
  }

  get(): UpdateStateSnapshot {
    const parsed = readJsonFile<ReadableUpdateStateSnapshot>(this.filePath);
    return normalizeUpdateState(parsed, this.currentVersion);
  }

  getFilePath(): string {
    return this.filePath;
  }

  set(next: UpdateStateSnapshot): UpdateStateSnapshot {
    const normalized = { ...next, version: 2 as const };
    writeJsonFileAtomic(this.filePath, normalized);
    return normalized;
  }

  update(
    patch:
      | Partial<UpdateStateSnapshot>
      | ((current: UpdateStateSnapshot) => Partial<UpdateStateSnapshot>)
  ): UpdateStateSnapshot {
    const current = this.get();
    const resolvedPatch = typeof patch === "function" ? patch(current) : patch;
    const next: UpdateStateSnapshot = {
      ...current,
      ...resolvedPatch,
      version: 2,
    };
    writeJsonFileAtomic(this.filePath, next);
    return next;
  }

  reset(currentVersion = this.currentVersion): UpdateStateSnapshot {
    const next = createDefaultUpdateState(currentVersion);
    writeJsonFileAtomic(this.filePath, next);
    return next;
  }
}
