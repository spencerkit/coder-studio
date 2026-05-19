import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  SupervisorCycleTargetRecord,
  SupervisorDecompositionMode,
  SupervisorTargetMemory,
  SupervisorWorkItem,
  SupervisorWorkItemKind,
  SupervisorWorkItemStatus,
} from "@coder-studio/core";

export interface SupervisorTargetMeta {
  targetId: string;
  sessionId: string;
  workspaceId: string;
  objective: string;
  status: "active" | "completed" | "cancelled" | "superseded";
  createdAt: number;
  updatedAt: number;
  supersededBy: string | null;
  completedAt: number | null;
}

function targetDir(workspacePath: string, targetId: string): string {
  return join(workspacePath, ".coder-studio", "supervisor", "targets", targetId);
}

function metaPath(workspacePath: string, targetId: string): string {
  return join(targetDir(workspacePath, targetId), "meta.json");
}

function memoryPath(workspacePath: string, targetId: string): string {
  return join(targetDir(workspacePath, targetId), "memory.json");
}

function cyclesPath(workspacePath: string, targetId: string): string {
  return join(targetDir(workspacePath, targetId), "cycles.jsonl");
}

function metaFilePath(dirPath: string): string {
  return join(dirPath, "meta.json");
}

function memoryFilePath(dirPath: string): string {
  return join(dirPath, "memory.json");
}

function cyclesFilePath(dirPath: string): string {
  return join(dirPath, "cycles.jsonl");
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === code
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === "string") {
      return value;
    }
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const next = value.trim();
  return next ? next : undefined;
}

function readStatus(value: unknown): SupervisorWorkItemStatus {
  return value === "in_progress" || value === "done" || value === "pending" ? value : "pending";
}

function readDecompositionMode(value: unknown): SupervisorDecompositionMode | undefined {
  return value === "stage" || value === "subtarget" ? value : undefined;
}

function readNonNegativeInteger(value: unknown, fallback: number): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 0) {
    return fallback;
  }
  return value;
}

function readTimestamp(value: unknown, fallback: number): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number") {
    return fallback;
  }
  return value;
}

function fallbackAcceptanceCriteria(title: string): string[] {
  return [`${title} is complete`];
}

function normalizeItem(
  value: unknown,
  fallbackKind?: SupervisorWorkItemKind
): SupervisorWorkItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readNonEmptyString(value.id);
  const title = readNonEmptyString(value.title);
  if (!id || !title) {
    return null;
  }

  const kind = readDecompositionMode(value.kind) ?? fallbackKind ?? "stage";
  const objective = readNonEmptyString(value.objective) ?? title;
  const deliverable = readNonEmptyString(value.deliverable) ?? `${title} completed`;
  const acceptanceCriteria = Array.isArray(value.acceptanceCriteria)
    ? value.acceptanceCriteria.flatMap<string>((entry) => {
        const next = readNonEmptyString(entry);
        return next ? [next] : [];
      })
    : [];

  return {
    id,
    kind,
    title,
    objective,
    deliverable,
    acceptanceCriteria:
      acceptanceCriteria.length > 0 ? acceptanceCriteria : fallbackAcceptanceCriteria(title),
    status: readStatus(value.status),
  };
}

function normalizeLegacyPlanItems(plan: unknown): SupervisorWorkItem[] {
  if (!Array.isArray(plan)) {
    return [];
  }

  return plan.flatMap<SupervisorWorkItem>((value) => {
    const item = normalizeItem(
      isRecord(value)
        ? {
            id: value.id,
            kind: "stage",
            title: value.title,
            objective: value.title,
            deliverable: `${readNonEmptyString(value.title) ?? "Legacy step"} completed`,
            acceptanceCriteria: fallbackAcceptanceCriteria(
              readNonEmptyString(value.title) ?? "Legacy step"
            ),
            status: value.status,
          }
        : value,
      "stage"
    );

    return item ? [item] : [];
  });
}

function resolveActiveItemId(items: SupervisorWorkItem[], candidate: unknown): string | undefined {
  const next = readNonEmptyString(candidate);
  if (next && items.some((item) => item.id === next)) {
    return next;
  }

  return (
    items.find((item) => item.status === "in_progress")?.id ??
    items.find((item) => item.status === "pending")?.id ??
    items[0]?.id
  );
}

function normalizeTargetMemory(raw: unknown, targetId: string): SupervisorTargetMemory {
  if (!isRecord(raw)) {
    return buildTargetMemory(targetId, 0);
  }

  const updatedAt = readTimestamp(raw.updatedAt, 0);
  const declaredMode = readDecompositionMode(raw.decompositionMode);

  let items = Array.isArray(raw.items)
    ? raw.items.flatMap<SupervisorWorkItem>((value) => {
        const item = normalizeItem(value, declaredMode);
        return item ? [item] : [];
      })
    : [];
  let decompositionMode = declaredMode ?? items[0]?.kind;

  if (items.length === 0) {
    items = normalizeLegacyPlanItems(raw.plan);
    decompositionMode = items.length > 0 ? "stage" : undefined;
  }

  return {
    targetId: readNonEmptyString(raw.targetId) ?? targetId,
    decompositionGenerated: items.length > 0,
    decompositionMode,
    items,
    activeItemId: resolveActiveItemId(items, raw.activeItemId ?? raw.activeStepId),
    progressSummary: readNonEmptyString(raw.progressSummary),
    lastGuidance: readNonEmptyString(raw.lastGuidance),
    stalledCount: readNonNegativeInteger(raw.stalledCount, 0),
    updatedAt,
  };
}

async function writeJsonIfMissing(path: string, value: unknown): Promise<void> {
  try {
    await writeFile(path, JSON.stringify(value, null, 2) + "\n", {
      encoding: "utf-8",
      flag: "wx",
    });
  } catch (error) {
    if (!hasCode(error, "EEXIST")) {
      throw error;
    }
  }
}

function buildTargetMeta(input: {
  targetId: string;
  sessionId: string;
  workspaceId: string;
  objective: string;
  createdAt: number;
}): SupervisorTargetMeta {
  return {
    targetId: input.targetId,
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    objective: input.objective,
    status: "active",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    supersededBy: null,
    completedAt: null,
  };
}

function buildTargetMemory(targetId: string, createdAt: number): SupervisorTargetMemory {
  return {
    targetId,
    decompositionGenerated: false,
    decompositionMode: undefined,
    items: [],
    activeItemId: undefined,
    progressSummary: undefined,
    lastGuidance: undefined,
    stalledCount: 0,
    updatedAt: createdAt,
  };
}

async function writeResetTargetFiles(
  dirPath: string,
  input: {
    targetId: string;
    sessionId: string;
    workspaceId: string;
    objective: string;
    createdAt: number;
  }
): Promise<void> {
  await mkdir(dirPath, { recursive: true });
  await writeFile(
    metaFilePath(dirPath),
    JSON.stringify(buildTargetMeta(input), null, 2) + "\n",
    "utf-8"
  );
  await writeFile(
    memoryFilePath(dirPath),
    JSON.stringify(buildTargetMemory(input.targetId, input.createdAt), null, 2) + "\n",
    "utf-8"
  );
  await writeFile(cyclesFilePath(dirPath), "", "utf-8");
}

export async function createTargetFiles(
  workspacePath: string,
  input: {
    targetId: string;
    sessionId: string;
    workspaceId: string;
    objective: string;
    createdAt: number;
  }
): Promise<void> {
  const dir = targetDir(workspacePath, input.targetId);
  await mkdir(dir, { recursive: true });
  await writeJsonIfMissing(metaPath(workspacePath, input.targetId), buildTargetMeta(input));
  await writeJsonIfMissing(
    memoryPath(workspacePath, input.targetId),
    buildTargetMemory(input.targetId, input.createdAt)
  );
}

export async function resetTargetFiles(
  workspacePath: string,
  input: {
    targetId: string;
    sessionId: string;
    workspaceId: string;
    objective: string;
    createdAt: number;
  }
): Promise<void> {
  const dir = targetDir(workspacePath, input.targetId);
  const parentDir = dirname(dir);
  const backupDir = `${dir}.backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await mkdir(parentDir, { recursive: true });
  const stagingDir = await mkdtemp(join(parentDir, `${input.targetId}.reset-`));

  let backupCreated = false;
  let promoted = false;
  let restored = false;

  try {
    await writeResetTargetFiles(stagingDir, input);

    try {
      await rename(dir, backupDir);
      backupCreated = true;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) {
        throw error;
      }
    }

    try {
      await rename(stagingDir, dir);
      promoted = true;
    } catch (promoteError) {
      if (backupCreated) {
        try {
          await rename(backupDir, dir);
          backupCreated = false;
          restored = true;
        } catch (restoreError) {
          throw new Error(
            `Failed to promote target reset (${errorMessage(
              promoteError,
              "unknown promote error"
            )}); restore also failed (${errorMessage(restoreError, "unknown restore error")})`
          );
        }
      }
      throw promoteError;
    }
  } catch (error) {
    if (restored || !backupCreated) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
    throw error;
  }

  if (backupCreated) {
    await rm(backupDir, { recursive: true, force: true }).catch(() => {});
  }
  if (!promoted) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function readTargetMeta(
  workspacePath: string,
  targetId: string
): Promise<SupervisorTargetMeta> {
  return JSON.parse(
    await readFile(metaPath(workspacePath, targetId), "utf-8")
  ) as SupervisorTargetMeta;
}

export async function loadTargetMemory(
  workspacePath: string,
  targetId: string
): Promise<SupervisorTargetMemory> {
  return normalizeTargetMemory(
    JSON.parse(await readFile(memoryPath(workspacePath, targetId), "utf-8")),
    targetId
  );
}

export async function saveTargetMemory(
  workspacePath: string,
  targetId: string,
  memory: SupervisorTargetMemory
): Promise<void> {
  await mkdir(dirname(memoryPath(workspacePath, targetId)), { recursive: true });
  await writeFile(
    memoryPath(workspacePath, targetId),
    JSON.stringify(memory, null, 2) + "\n",
    "utf-8"
  );
}

export async function appendTargetCycleRecord(
  workspacePath: string,
  targetId: string,
  record: SupervisorCycleTargetRecord
): Promise<void> {
  await mkdir(dirname(cyclesPath(workspacePath, targetId)), { recursive: true });
  await writeFile(cyclesPath(workspacePath, targetId), JSON.stringify(record) + "\n", {
    encoding: "utf-8",
    flag: "a",
  });
}

export async function saveTargetMeta(
  workspacePath: string,
  targetId: string,
  meta: SupervisorTargetMeta
): Promise<void> {
  await mkdir(dirname(metaPath(workspacePath, targetId)), { recursive: true });
  await writeFile(metaPath(workspacePath, targetId), JSON.stringify(meta, null, 2) + "\n", "utf-8");
}

export async function readTargetCycleRecords(
  workspacePath: string,
  targetId: string,
  limit = 20
): Promise<SupervisorCycleTargetRecord[]> {
  const content = await readFile(cyclesPath(workspacePath, targetId), "utf-8").catch(() => "");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SupervisorCycleTargetRecord)
    .slice(-limit)
    .reverse();
}

export async function markTargetSuperseded(
  workspacePath: string,
  targetId: string,
  nextTargetId: string,
  updatedAt: number
): Promise<void> {
  const meta = await readTargetMeta(workspacePath, targetId);
  await saveTargetMeta(workspacePath, targetId, {
    ...meta,
    status: "superseded",
    supersededBy: nextTargetId,
    updatedAt,
  });
}
