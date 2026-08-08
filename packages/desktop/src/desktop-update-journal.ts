import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
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
  environmentId: string;
  compatibility: UpdateCompatibilityResult;
  restartIntent: boolean;
  components: DesktopUpdateJournalComponent[];
  lastError: { componentId: UpdateComponentId; phase: string; summary: string } | null;
}

export interface DesktopUpdateJournalOptions {
  filePath: string;
  onWarning?: (message: string) => void;
}

export interface DesktopUpdateJournalMutation {
  expectedPlanId: string | null;
  environmentId: string;
}

interface DesktopUpdateJournalLockRecord {
  pid: number;
  token: string;
  startedAt: number;
}

const LOCK_RETRY_MS = 20;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;

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
    environmentId: readString(candidate.environmentId, "environmentId"),
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

function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function journalConflict(message: string): Error {
  return Object.assign(new Error(message), { code: "desktop_update_plan_conflict" });
}

export class DesktopUpdateJournal {
  constructor(private readonly options: DesktopUpdateJournalOptions) {}

  async read(): Promise<DesktopUpdateJournalRecord | null> {
    return this.readUnlocked();
  }

  async write(
    record: DesktopUpdateJournalRecord,
    mutation: DesktopUpdateJournalMutation
  ): Promise<void> {
    const parsed = parseJournal(record);
    this.assertMutation(mutation, parsed.environmentId);
    await this.withExclusiveLock(async () => {
      const current = await this.readUnlocked();
      this.assertExpectedPlan(current, mutation);
      await writeJsonFileAtomic(this.options.filePath, parsed);
    });
  }

  async clear(mutation: DesktopUpdateJournalMutation): Promise<void> {
    this.assertMutation(mutation, mutation.environmentId);
    await this.withExclusiveLock(async () => {
      const current = await this.readUnlocked();
      this.assertExpectedPlan(current, mutation);
      await rm(this.options.filePath, { force: true });
    });
  }

  private async readUnlocked(): Promise<DesktopUpdateJournalRecord | null> {
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

  private assertMutation(
    mutation: DesktopUpdateJournalMutation | undefined,
    recordEnvironmentId: string
  ): asserts mutation is DesktopUpdateJournalMutation {
    if (
      !mutation ||
      (mutation.expectedPlanId !== null &&
        (typeof mutation.expectedPlanId !== "string" || !mutation.expectedPlanId.trim())) ||
      typeof mutation.environmentId !== "string" ||
      !mutation.environmentId.trim()
    ) {
      throw new Error("Desktop update journal mutation ownership is invalid");
    }
    if (mutation.environmentId !== recordEnvironmentId) {
      throw journalConflict("Desktop update journal owner does not match the update plan");
    }
  }

  private assertExpectedPlan(
    current: DesktopUpdateJournalRecord | null,
    mutation: DesktopUpdateJournalMutation
  ): void {
    const currentPlanId = current?.planId ?? null;
    if (currentPlanId !== mutation.expectedPlanId) {
      throw journalConflict(
        `Desktop update plan changed from ${mutation.expectedPlanId ?? "none"} to ${currentPlanId ?? "none"}`
      );
    }
    if (current && current.environmentId !== mutation.environmentId) {
      throw journalConflict(
        `Desktop update plan is owned by another environment: ${current.environmentId}`
      );
    }
  }

  private async withExclusiveLock<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquireLock();
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  private async acquireLock(): Promise<() => Promise<void>> {
    await mkdir(dirname(this.options.filePath), { recursive: true });
    const lockPath = `${this.options.filePath}.lock`;
    const startedWaitingAt = Date.now();
    const record: DesktopUpdateJournalLockRecord = {
      pid: process.pid,
      token: randomUUID(),
      startedAt: Date.now(),
    };
    while (Date.now() - startedWaitingAt < LOCK_TIMEOUT_MS) {
      let createdLock = false;
      try {
        const handle = await open(lockPath, "wx", 0o600);
        createdLock = true;
        try {
          await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        return async () => {
          const current = await this.readLock(lockPath);
          if (current?.token === record.token) await rm(lockPath, { force: true });
        };
      } catch (error) {
        if (createdLock) {
          await rm(lockPath, { force: true });
          throw error;
        }
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (await this.isStaleLock(lockPath)) {
          await rm(lockPath, { force: true });
          continue;
        }
        await wait(LOCK_RETRY_MS);
      }
    }
    throw journalConflict(`Timed out waiting for Desktop update journal lock: ${lockPath}`);
  }

  private async readLock(path: string): Promise<DesktopUpdateJournalLockRecord | null> {
    try {
      const candidate = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      if (
        !Number.isInteger(candidate.pid) ||
        typeof candidate.token !== "string" ||
        typeof candidate.startedAt !== "number"
      ) {
        return null;
      }
      return candidate as unknown as DesktopUpdateJournalLockRecord;
    } catch {
      return null;
    }
  }

  private async isStaleLock(path: string): Promise<boolean> {
    const record = await this.readLock(path);
    if (record) {
      return !isProcessRunning(record.pid) || Date.now() - record.startedAt > LOCK_STALE_MS;
    }
    try {
      const metadata = await stat(path);
      return Date.now() - metadata.mtimeMs > LOCK_STALE_MS;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT";
    }
  }
}
