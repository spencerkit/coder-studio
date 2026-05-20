import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  Supervisor,
  SupervisorCycleTargetRecord,
  SupervisorDecompositionMode,
  SupervisorState,
  SupervisorStopReason,
  SupervisorTargetMemory,
  SupervisorWorkItem,
  SupervisorWorkItemKind,
  SupervisorWorkItemStatus,
} from "@coder-studio/core";

export type PersistedSupervisor = Omit<Supervisor, "currentTargetMemory" | "recentTargetCycles">;

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
  supervisor?: PersistedSupervisor;
}

export interface RecoverableTargetSummary {
  targetId: string;
  sessionId: string;
  workspaceId: string;
  objective: string;
  status: SupervisorTargetMeta["status"];
  updatedAt: number;
  progressSummary?: string;
  cycleCount: number;
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

function targetsRoot(workspacePath: string): string {
  return join(workspacePath, ".coder-studio", "supervisor", "targets");
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

function readOptionalTimestamp(value: unknown): number | undefined {
  if (!Number.isSafeInteger(value) || typeof value !== "number") {
    return undefined;
  }
  return value;
}

function readSupervisorState(value: unknown): SupervisorState | undefined {
  return value === "inactive" ||
    value === "idle" ||
    value === "evaluating" ||
    value === "injecting" ||
    value === "paused" ||
    value === "error" ||
    value === "stopped"
    ? value
    : undefined;
}

function readSupervisorStopReason(value: unknown): SupervisorStopReason | undefined {
  return value === "objective_complete" ||
    value === "max_supervision_count_reached" ||
    value === "supervisor_uncertain"
    ? value
    : undefined;
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

function normalizePersistedSupervisor(
  raw: unknown,
  fallback: Pick<
    SupervisorTargetMeta,
    "targetId" | "sessionId" | "workspaceId" | "objective" | "createdAt" | "updatedAt"
  >
): PersistedSupervisor | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const id = readNonEmptyString(raw.id) ?? fallback.targetId;
  const sessionId = readNonEmptyString(raw.sessionId) ?? fallback.sessionId;
  const workspaceId = readNonEmptyString(raw.workspaceId) ?? fallback.workspaceId;
  const targetId = readNonEmptyString(raw.targetId) ?? fallback.targetId;
  const state = readSupervisorState(raw.state);
  const objective = readNonEmptyString(raw.objective) ?? fallback.objective;
  const evaluatorProviderId = readNonEmptyString(raw.evaluatorProviderId);
  const createdAt = readTimestamp(raw.createdAt, fallback.createdAt);
  const updatedAt = readTimestamp(raw.updatedAt, fallback.updatedAt);

  if (!state || !evaluatorProviderId) {
    return undefined;
  }

  return {
    id,
    sessionId,
    workspaceId,
    targetId,
    state,
    objective,
    evaluatorProviderId,
    evaluatorModel: readNonEmptyString(raw.evaluatorModel),
    maxSupervisionCount: readNonNegativeInteger(raw.maxSupervisionCount, 0),
    completedSupervisionCount: readNonNegativeInteger(raw.completedSupervisionCount, 0),
    scheduledAt: readOptionalTimestamp(raw.scheduledAt),
    stopReason: readSupervisorStopReason(raw.stopReason),
    lastCycleAt: readOptionalTimestamp(raw.lastCycleAt),
    lastEvaluatedTurnId: readNonEmptyString(raw.lastEvaluatedTurnId),
    errorReason: readNonEmptyString(raw.errorReason),
    createdAt,
    updatedAt,
  };
}

function normalizeTargetMeta(raw: unknown, fallbackTargetId?: string): SupervisorTargetMeta {
  if (!isRecord(raw)) {
    const targetId = fallbackTargetId ?? "";
    return {
      targetId,
      sessionId: "",
      workspaceId: "",
      objective: "",
      status: "active",
      createdAt: 0,
      updatedAt: 0,
      supersededBy: null,
      completedAt: null,
      supervisor: undefined,
    };
  }

  const targetId = readNonEmptyString(raw.targetId) ?? fallbackTargetId ?? "";
  const sessionId = readNonEmptyString(raw.sessionId) ?? "";
  const workspaceId = readNonEmptyString(raw.workspaceId) ?? "";
  const objective = readNonEmptyString(raw.objective) ?? "";
  const createdAt = readTimestamp(raw.createdAt, 0);
  const updatedAt = readTimestamp(raw.updatedAt, createdAt);

  return {
    targetId,
    sessionId,
    workspaceId,
    objective,
    status:
      raw.status === "completed" ||
      raw.status === "cancelled" ||
      raw.status === "superseded" ||
      raw.status === "active"
        ? raw.status
        : "active",
    createdAt,
    updatedAt,
    supersededBy: readNonEmptyString(raw.supersededBy) ?? null,
    completedAt: readOptionalTimestamp(raw.completedAt) ?? null,
    supervisor: normalizePersistedSupervisor(raw.supervisor, {
      targetId,
      sessionId,
      workspaceId,
      objective,
      createdAt,
      updatedAt,
    }),
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
  supervisor?: PersistedSupervisor;
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
    supervisor: input.supervisor,
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
    supervisor?: PersistedSupervisor;
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
    supervisor?: PersistedSupervisor;
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
    supervisor?: PersistedSupervisor;
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
  return normalizeTargetMeta(
    JSON.parse(await readFile(metaPath(workspacePath, targetId), "utf-8")),
    targetId
  );
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

export async function listRecoverableTargets(
  workspacePath: string
): Promise<RecoverableTargetSummary[]> {
  const root = targetsRoot(workspacePath);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const targets = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const targetId = entry.name;
        const [meta, memory, cycles] = await Promise.all([
          readTargetMeta(workspacePath, targetId),
          loadTargetMemory(workspacePath, targetId).catch(() => buildTargetMemory(targetId, 0)),
          readTargetCycleRecords(workspacePath, targetId, Number.MAX_SAFE_INTEGER),
        ]);

        return {
          targetId: meta.targetId,
          sessionId: meta.sessionId,
          workspaceId: meta.workspaceId,
          objective: meta.objective,
          status: meta.status,
          updatedAt: meta.updatedAt,
          progressSummary: memory.progressSummary,
          cycleCount: cycles.length,
        } satisfies RecoverableTargetSummary;
      })
  );

  return targets.sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function cloneTargetFiles(
  workspacePath: string,
  input: {
    sourceTargetId: string;
    targetId: string;
    sessionId: string;
    workspaceId: string;
    objective: string;
    createdAt: number;
    supervisor?: PersistedSupervisor;
  }
): Promise<number> {
  const [sourceMemory, sourceCycles] = await Promise.all([
    loadTargetMemory(workspacePath, input.sourceTargetId),
    readTargetCycleRecords(workspacePath, input.sourceTargetId, Number.MAX_SAFE_INTEGER),
  ]);

  const nextMeta = buildTargetMeta({
    targetId: input.targetId,
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    objective: input.objective,
    createdAt: input.createdAt,
    supervisor: input.supervisor,
  });
  const nextMemory: SupervisorTargetMemory = {
    ...sourceMemory,
    targetId: input.targetId,
  };
  const nextCycles = sourceCycles
    .slice()
    .reverse()
    .map((record) => ({
      ...record,
      targetId: input.targetId,
    }));

  await mkdir(targetDir(workspacePath, input.targetId), { recursive: true });
  await saveTargetMeta(workspacePath, input.targetId, nextMeta);
  await saveTargetMemory(workspacePath, input.targetId, nextMemory);
  await writeFile(cyclesPath(workspacePath, input.targetId), "", "utf-8");
  for (const cycle of nextCycles) {
    await appendTargetCycleRecord(workspacePath, input.targetId, cycle);
  }

  return nextCycles.length;
}

export async function deleteTarget(workspacePath: string, targetId: string): Promise<void> {
  await rm(targetDir(workspacePath, targetId), { recursive: true, force: true });
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
