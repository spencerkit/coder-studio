import { readFile, rm } from "node:fs/promises";
import type { UpdateCompatibilityResult, UpdateComponentId } from "@coder-studio/core";
import { writeJsonFileAtomic } from "./atomic-json-file.js";
import { normalizeUtcTimestamp } from "./build-info.js";

export interface DesktopUpdateJournalComponent {
  id: UpdateComponentId;
  currentVersion: string;
  targetVersion: string;
  currentPublishedAt: string | null;
  targetPublishedAt: string;
  downloaded: boolean;
  verified: boolean;
  installed: boolean;
  errorSummary: string | null;
}

export interface DesktopUpdateJournalRecord {
  schemaVersion: 1;
  planId: string;
  status: "available" | "downloading" | "ready" | "restarting" | "failed";
  createdAt: string;
  updatedAt: string;
  runtimeTarget: "win32-x64" | "linux-x64";
  compatibility: UpdateCompatibilityResult;
  restartIntent: boolean;
  components: DesktopUpdateJournalComponent[];
  lastError: { componentId: UpdateComponentId; phase: string; summary: string } | null;
}

export interface DesktopUpdateJournalOptions {
  filePath: string;
  onWarning?: (message: string) => void;
}

const COMPONENT_IDS = new Set<UpdateComponentId>([
  "shell",
  "runtime:win32-x64",
  "runtime:linux-x64",
  "cli",
]);
const STATUSES = new Set<DesktopUpdateJournalRecord["status"]>([
  "available",
  "downloading",
  "ready",
  "restarting",
  "failed",
]);

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is invalid`);
  return value.trim();
}

function readNullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return readString(value, label);
}

function readComponent(value: unknown): DesktopUpdateJournalComponent {
  if (!value || typeof value !== "object") throw new Error("journal component is invalid");
  const candidate = value as Record<string, unknown>;
  if (!COMPONENT_IDS.has(candidate.id as UpdateComponentId)) {
    throw new Error("journal component id is invalid");
  }
  for (const field of ["downloaded", "verified", "installed"] as const) {
    if (typeof candidate[field] !== "boolean") throw new Error(`journal ${field} is invalid`);
  }
  return {
    id: candidate.id as UpdateComponentId,
    currentVersion: readString(candidate.currentVersion, "currentVersion"),
    targetVersion: readString(candidate.targetVersion, "targetVersion"),
    currentPublishedAt:
      candidate.currentPublishedAt === null
        ? null
        : normalizeUtcTimestamp(candidate.currentPublishedAt, "currentPublishedAt"),
    targetPublishedAt: normalizeUtcTimestamp(candidate.targetPublishedAt, "targetPublishedAt"),
    downloaded: candidate.downloaded as boolean,
    verified: candidate.verified as boolean,
    installed: candidate.installed as boolean,
    errorSummary: readNullableString(candidate.errorSummary, "errorSummary"),
  };
}

function parseJournal(value: unknown): DesktopUpdateJournalRecord {
  if (!value || typeof value !== "object") throw new Error("journal must be an object");
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) throw new Error("journal schema is unsupported");
  if (!STATUSES.has(candidate.status as DesktopUpdateJournalRecord["status"])) {
    throw new Error("journal status is invalid");
  }
  if (candidate.runtimeTarget !== "win32-x64" && candidate.runtimeTarget !== "linux-x64") {
    throw new Error("journal Runtime target is invalid");
  }
  if (!Array.isArray(candidate.components) || candidate.components.length === 0) {
    throw new Error("journal components are invalid");
  }
  if (!candidate.compatibility || typeof candidate.compatibility !== "object") {
    throw new Error("journal compatibility is invalid");
  }
  const compatibility = candidate.compatibility as Record<string, unknown>;
  if (typeof compatibility.compatible !== "boolean") {
    throw new Error("journal compatibility is invalid");
  }
  if (typeof candidate.restartIntent !== "boolean") {
    throw new Error("journal restart intent is invalid");
  }
  let lastError: DesktopUpdateJournalRecord["lastError"] = null;
  if (candidate.lastError !== null) {
    if (!candidate.lastError || typeof candidate.lastError !== "object") {
      throw new Error("journal last error is invalid");
    }
    const error = candidate.lastError as Record<string, unknown>;
    if (!COMPONENT_IDS.has(error.componentId as UpdateComponentId)) {
      throw new Error("journal last error component is invalid");
    }
    lastError = {
      componentId: error.componentId as UpdateComponentId,
      phase: readString(error.phase, "lastError.phase"),
      summary: readString(error.summary, "lastError.summary"),
    };
  }
  return {
    schemaVersion: 1,
    planId: readString(candidate.planId, "planId"),
    status: candidate.status as DesktopUpdateJournalRecord["status"],
    createdAt: normalizeUtcTimestamp(candidate.createdAt, "createdAt"),
    updatedAt: normalizeUtcTimestamp(candidate.updatedAt, "updatedAt"),
    runtimeTarget: candidate.runtimeTarget,
    compatibility: {
      compatible: compatibility.compatible,
      code: readNullableString(compatibility.code, "compatibility.code"),
      summary: readNullableString(compatibility.summary, "compatibility.summary"),
    },
    restartIntent: candidate.restartIntent,
    components: candidate.components.map(readComponent),
    lastError,
  };
}

export class DesktopUpdateJournal {
  constructor(private readonly options: DesktopUpdateJournalOptions) {}

  async read(): Promise<DesktopUpdateJournalRecord | null> {
    try {
      return parseJournal(JSON.parse(await readFile(this.options.filePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.options.onWarning?.(
          `Unable to read desktop-update-plan.json: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      return null;
    }
  }

  async write(record: DesktopUpdateJournalRecord): Promise<void> {
    await writeJsonFileAtomic(this.options.filePath, parseJournal(record));
  }

  async clear(): Promise<void> {
    await rm(this.options.filePath, { force: true });
  }
}
