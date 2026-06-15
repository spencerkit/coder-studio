import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  Supervisor,
  SupervisorCycleTargetRecord,
  SupervisorGranularity,
  SupervisorPlanNode,
  SupervisorPlanNodeReadyCheck,
  SupervisorPlanNodeStatus,
  SupervisorState,
  SupervisorStopReason,
  SupervisorTargetMemory,
  SupervisorTaskType,
} from "@coder-studio/core";
import { DEFAULT_SUPERVISOR_PLAN_MAX_DEPTH } from "@coder-studio/core";
import {
  clonePlanTreeWithRoot,
  createPlanRoot,
  createPlanRootId,
  findNodePath,
} from "./plan-tree.js";

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

function readTaskType(value: unknown): SupervisorTaskType {
  return value === "coding" ||
    value === "writing" ||
    value === "research" ||
    value === "design" ||
    value === "generic"
    ? value
    : "generic";
}

function readPlanNodeStatus(value: unknown): SupervisorPlanNodeStatus {
  return value === "in_progress" || value === "done" || value === "pending" || value === "blocked"
    ? value
    : "pending";
}

function readGranularity(value: unknown): SupervisorGranularity | undefined {
  return value === "too_large" || value === "ready" || value === "too_small" ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value.flatMap<string>((entry) => {
    const text = readNonEmptyString(entry);
    return text ? [text] : [];
  });
  return values.length > 0 ? values : undefined;
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

function normalizeReadyCheck(raw: unknown): SupervisorPlanNodeReadyCheck | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const granularity = readGranularity(raw.granularity);
  const reason = readNonEmptyString(raw.reason);
  if (!granularity || !reason) {
    return undefined;
  }
  const confidence =
    raw.confidence === "low" || raw.confidence === "medium" || raw.confidence === "high"
      ? raw.confidence
      : undefined;
  return {
    granularity,
    reason,
    recommendedUnit: readNonEmptyString(raw.recommendedUnit),
    qualityRisk: readNonEmptyString(raw.qualityRisk),
    missingInputs: readStringArray(raw.missingInputs),
    confidence,
    checkedAt: readTimestamp(raw.checkedAt, 0),
  };
}

function normalizePlanNode(
  raw: unknown,
  fallback: { id: string; title: string }
): SupervisorPlanNode | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = readNonEmptyString(raw.id) ?? fallback.id;
  const title = readNonEmptyString(raw.title) ?? fallback.title;
  const acceptanceCriteria = readStringArray(raw.acceptanceCriteria) ?? [`${title} is complete`];
  const children = Array.isArray(raw.children)
    ? raw.children.flatMap<SupervisorPlanNode>((child, index) => {
        const normalized = normalizePlanNode(child, {
          id: `${id}-${index + 1}`,
          title: `Child ${index + 1}`,
        });
        return normalized ? [normalized] : [];
      })
    : [];

  return {
    id,
    title,
    objective: readNonEmptyString(raw.objective) ?? title,
    deliverable: readNonEmptyString(raw.deliverable) ?? `${title} completed`,
    acceptanceCriteria,
    status: readPlanNodeStatus(raw.status),
    taskType: readTaskType(raw.taskType),
    children,
    readyCheck: normalizeReadyCheck(raw.readyCheck),
    execution: isRecord(raw.execution)
      ? {
          executable: raw.execution.executable === true,
          guidance: readNonEmptyString(raw.execution.guidance),
          lastInjectedAt: readOptionalTimestamp(raw.execution.lastInjectedAt),
        }
      : undefined,
  };
}

function remapPlanTreeRoot(planTree: SupervisorPlanNode): SupervisorPlanNode {
  return clonePlanTreeWithRoot(planTree);
}

function normalizePlanTreeIdentity(planTree: SupervisorPlanNode): SupervisorPlanNode {
  if (!planTree.id.endsWith("-root")) {
    return planTree;
  }

  return remapPlanTreeRoot(planTree);
}

function resolveActiveNodeId(planTree: SupervisorPlanNode, candidate: unknown): string | undefined {
  const next = readNonEmptyString(candidate);
  if (next && next !== planTree.id && findNodePath(planTree, next)) {
    return next;
  }

  return findFirstRunnableNodeId(planTree, true);
}

function findFirstRunnableNodeId(node: SupervisorPlanNode, isRoot = false): string | undefined {
  if (
    !isRoot &&
    node.children.length === 0 &&
    node.status !== "done" &&
    node.status !== "blocked"
  ) {
    return node.id;
  }

  for (const child of node.children) {
    if (child.status === "done" || child.status === "blocked") {
      continue;
    }
    const childId = findFirstRunnableNodeId(child);
    if (childId) {
      return childId;
    }
  }
  return undefined;
}

function normalizeTargetMemory(raw: unknown, targetId: string): SupervisorTargetMemory {
  if (!isRecord(raw)) {
    return buildTargetMemory(targetId, 0);
  }

  const updatedAt = readTimestamp(raw.updatedAt, 0);
  const targetIdValue = readNonEmptyString(raw.targetId) ?? targetId;
  const normalizedTree =
    normalizePlanNode(raw.planTree, {
      id: createPlanRootId(),
      title: "Supervisor target",
    }) ?? createPlanRoot();
  const planTree = normalizePlanTreeIdentity(normalizedTree);
  const activeNodeId = resolveActiveNodeId(planTree, raw.activeNodeId);

  return {
    schemaVersion: 2,
    targetId: targetIdValue,
    planTree,
    activeNodeId,
    maxDepth: readNonNegativeInteger(raw.maxDepth, DEFAULT_SUPERVISOR_PLAN_MAX_DEPTH),
    planRevision: readNonNegativeInteger(raw.planRevision, 0),
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
    schemaVersion: 2,
    targetId,
    planTree: createPlanRoot(),
    activeNodeId: undefined,
    maxDepth: DEFAULT_SUPERVISOR_PLAN_MAX_DEPTH,
    planRevision: 0,
    progressSummary: undefined,
    lastGuidance: undefined,
    stalledCount: 0,
    updatedAt: createdAt,
  };
}

function countsTowardCycleTotal(record: SupervisorCycleTargetRecord): boolean {
  return record.result !== "error";
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isTransientTargetDirectory(name: string): boolean {
  return name.includes(".backup-") || name.includes(".reset-");
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
    tryParseJson(await readFile(metaPath(workspacePath, targetId), "utf-8")),
    targetId
  );
}

export async function loadTargetMemory(
  workspacePath: string,
  targetId: string
): Promise<SupervisorTargetMemory> {
  return normalizeTargetMemory(
    tryParseJson(await readFile(memoryPath(workspacePath, targetId), "utf-8")),
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
    .flatMap<SupervisorCycleTargetRecord>((line) => {
      const parsed = tryParseJson(line);
      return parsed ? [parsed as SupervisorCycleTargetRecord] : [];
    })
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
      .filter((entry) => entry.isDirectory() && !isTransientTargetDirectory(entry.name))
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
          cycleCount: cycles.filter(countsTowardCycleTotal).length,
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
  const planTree = remapPlanTreeRoot(sourceMemory.planTree);
  const nextMemory: SupervisorTargetMemory = {
    ...sourceMemory,
    targetId: input.targetId,
    planTree,
    activeNodeId:
      sourceMemory.activeNodeId === sourceMemory.planTree.id
        ? undefined
        : sourceMemory.activeNodeId,
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

  return nextCycles.filter(countsTowardCycleTotal).length;
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
