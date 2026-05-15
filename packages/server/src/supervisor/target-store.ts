import { mkdir, readFile, writeFile } from "node:fs/promises";
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

async function writeJsonIfMissing(path: string, value: unknown): Promise<void> {
  try {
    await writeFile(path, JSON.stringify(value, null, 2) + "\n", {
      encoding: "utf-8",
      flag: "wx",
    });
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      (error as { code?: string }).code !== "EEXIST"
    ) {
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
  await mkdir(dir, { recursive: true });
  await writeFile(
    metaPath(workspacePath, input.targetId),
    JSON.stringify(buildTargetMeta(input), null, 2) + "\n",
    "utf-8"
  );
  await writeFile(
    memoryPath(workspacePath, input.targetId),
    JSON.stringify(buildTargetMemory(input.targetId, input.createdAt), null, 2) + "\n",
    "utf-8"
  );
  await writeFile(cyclesPath(workspacePath, input.targetId), "", "utf-8");
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
