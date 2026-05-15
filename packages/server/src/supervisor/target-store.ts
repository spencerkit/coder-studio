import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SupervisorCycleTargetRecord, SupervisorTargetMemory } from "@coder-studio/core";

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
    planGenerated: false,
    plan: [],
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

  let movedExisting = false;
  let promoted = false;

  try {
    await writeResetTargetFiles(stagingDir, input);

    try {
      await rename(dir, backupDir);
      movedExisting = true;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) {
        throw error;
      }
    }

    try {
      await rename(stagingDir, dir);
      promoted = true;
    } catch (error) {
      if (movedExisting) {
        await rename(backupDir, dir);
        movedExisting = false;
      }
      throw error;
    }

    if (movedExisting) {
      await rm(backupDir, { recursive: true, force: true });
      movedExisting = false;
    }
  } catch (error) {
    if (!promoted) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
    if (movedExisting) {
      await rm(backupDir, { recursive: true, force: true }).catch(() => {});
    }
    throw error;
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
  return JSON.parse(
    await readFile(memoryPath(workspacePath, targetId), "utf-8")
  ) as SupervisorTargetMemory;
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
