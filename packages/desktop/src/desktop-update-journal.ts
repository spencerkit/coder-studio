import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { UpdateCompatibilityResult, UpdateComponentId } from "@coder-studio/core";
import { lock } from "proper-lockfile";
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
  ownerId: string;
}

export const DESKTOP_UPDATE_OWNER_STALE_MS = 10_000;
const OWNER_HEARTBEAT_MS = DESKTOP_UPDATE_OWNER_STALE_MS / 2;

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

function journalConflict(message: string): Error {
  return Object.assign(new Error(message), { code: "desktop_update_plan_conflict" });
}

export class DesktopUpdateJournal {
  private activeOwnerId: string | null = null;
  private ownerCompromised: Error | null = null;
  private releaseOwnerLock: (() => Promise<void>) | null = null;

  constructor(private readonly options: DesktopUpdateJournalOptions) {}

  async read(): Promise<DesktopUpdateJournalRecord | null> {
    return this.readUnlocked();
  }

  async acquireOwner(ownerId: string): Promise<boolean> {
    this.assertOwnerId(ownerId);
    if (this.activeOwnerId) {
      if (this.activeOwnerId !== ownerId) {
        throw new Error("Desktop update journal already has a different local owner");
      }
      this.assertOwned(ownerId);
      return true;
    }
    await mkdir(dirname(this.options.filePath), { recursive: true });
    let compromised: Error | null = null;
    try {
      const release = await lock(this.options.filePath, {
        realpath: false,
        stale: DESKTOP_UPDATE_OWNER_STALE_MS,
        update: OWNER_HEARTBEAT_MS,
        retries: 0,
        onCompromised: (error) => {
          compromised = error;
          this.ownerCompromised = error;
          this.options.onWarning?.(`Desktop update owner lease was compromised: ${error.message}`);
        },
      });
      this.activeOwnerId = ownerId;
      this.ownerCompromised = compromised;
      this.releaseOwnerLock = release;
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ELOCKED") return false;
      throw journalConflict(
        `Unable to acquire Desktop update owner lease: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async releaseOwner(ownerId: string): Promise<void> {
    this.assertOwnerId(ownerId);
    if (this.activeOwnerId !== ownerId) return;
    const release = this.releaseOwnerLock;
    this.activeOwnerId = null;
    this.ownerCompromised = null;
    this.releaseOwnerLock = null;
    if (!release) return;
    await release().catch((error) => {
      this.options.onWarning?.(
        `Unable to release Desktop update owner lease: ${error instanceof Error ? error.message : String(error)}`
      );
    });
  }

  isOwner(ownerId: string): boolean {
    return this.activeOwnerId === ownerId && !this.ownerCompromised;
  }

  async write(
    record: DesktopUpdateJournalRecord,
    mutation: DesktopUpdateJournalMutation
  ): Promise<void> {
    const parsed = parseJournal(record);
    this.assertMutation(mutation);
    this.assertOwned(mutation.ownerId);
    const current = await this.readUnlocked();
    this.assertExpectedPlan(current, mutation);
    this.assertOwned(mutation.ownerId);
    await writeJsonFileAtomic(this.options.filePath, parsed);
    this.assertOwned(mutation.ownerId);
  }

  async clear(mutation: DesktopUpdateJournalMutation): Promise<void> {
    this.assertMutation(mutation);
    this.assertOwned(mutation.ownerId);
    const current = await this.readUnlocked();
    this.assertExpectedPlan(current, mutation);
    this.assertOwned(mutation.ownerId);
    await rm(this.options.filePath, { force: true });
    this.assertOwned(mutation.ownerId);
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
    mutation: DesktopUpdateJournalMutation | undefined
  ): asserts mutation is DesktopUpdateJournalMutation {
    if (
      !mutation ||
      (mutation.expectedPlanId !== null &&
        (typeof mutation.expectedPlanId !== "string" || !mutation.expectedPlanId.trim())) ||
      typeof mutation.ownerId !== "string" ||
      !mutation.ownerId.trim()
    ) {
      throw new Error("Desktop update journal mutation ownership is invalid");
    }
  }

  private assertOwnerId(ownerId: string): void {
    if (typeof ownerId !== "string" || !ownerId.trim()) {
      throw new Error("Desktop update journal owner ID is invalid");
    }
  }

  private assertOwned(ownerId: string): void {
    if (this.activeOwnerId !== ownerId || !this.releaseOwnerLock) {
      throw Object.assign(new Error("Desktop update owner lease is held by another process"), {
        code: "desktop_update_owner_unavailable",
      });
    }
    if (this.ownerCompromised) {
      throw Object.assign(
        new Error(`Desktop update owner lease was compromised: ${this.ownerCompromised.message}`),
        { code: "desktop_update_owner_unavailable" }
      );
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
  }
}
