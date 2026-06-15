import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type {
  WorkspaceMemoryEntry,
  WorkspaceMemoryListFilter,
  WorkspaceMemorySourceInput,
  WorkspaceMemoryType,
} from "@coder-studio/core";
import { resolveWorkspaceMemorySource, validateWorkspaceMemoryInput } from "@coder-studio/core";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

interface MemoryRepoOptions {
  rootDir: string;
  now?: () => number;
  randomId?: () => string;
}

interface WorkspaceMemoryFile {
  version: 1;
  workspaceId: string;
  entries: Record<string, WorkspaceMemoryEntry>;
}

interface MemoryCreateInput {
  workspaceId: string;
  type: WorkspaceMemoryType;
  content: string;
  source?: WorkspaceMemorySourceInput;
}

interface MemoryUpdateInput {
  workspaceId: string;
  id: string;
  type?: WorkspaceMemoryType;
  content?: string;
  archivedAt?: number;
}

interface LegacyWorkspaceMemoryEntry extends WorkspaceMemoryEntry {
  title?: string;
}

interface LegacyWorkspaceMemoryFile {
  version: 1;
  workspaceId: string;
  entries: Record<string, LegacyWorkspaceMemoryEntry>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function notFound(id: string): never {
  throw { code: "memory_not_found", message: `Memory entry not found: ${id}` };
}

function createEmptyFile(workspaceId: string): WorkspaceMemoryFile {
  return {
    version: 1,
    workspaceId,
    entries: {},
  };
}

function includesQuery(entry: WorkspaceMemoryEntry, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return [entry.content, entry.type].some((value) => value.toLowerCase().includes(normalized));
}

function normalizeEntry(
  entry: unknown,
  fallbackWorkspaceId: string,
  fallbackEntryId: string
): WorkspaceMemoryEntry {
  if (!isRecord(entry)) {
    throw new Error("Invalid memory entry");
  }

  const validated = validateWorkspaceMemoryInput({
    type: entry.type,
    content: entry.content,
  });

  return {
    id: typeof entry.id === "string" && entry.id.trim().length > 0 ? entry.id : fallbackEntryId,
    workspaceId:
      typeof entry.workspaceId === "string" && entry.workspaceId.trim().length > 0
        ? entry.workspaceId
        : fallbackWorkspaceId,
    type: validated.type,
    content: validated.content,
    source: resolveWorkspaceMemorySource(isRecord(entry.source) ? entry.source : {}),
    createdAt:
      typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt) ? entry.createdAt : 0,
    updatedAt:
      typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
    ...(typeof entry.archivedAt === "number" && Number.isFinite(entry.archivedAt)
      ? { archivedAt: entry.archivedAt }
      : {}),
  };
}

function normalizeWorkspaceFile(file: unknown, workspaceId: string): WorkspaceMemoryFile {
  if (!isRecord(file)) {
    return createEmptyFile(workspaceId);
  }

  const normalizedWorkspaceId =
    typeof file.workspaceId === "string" && file.workspaceId.trim().length > 0
      ? file.workspaceId
      : workspaceId;
  const entries: Record<string, WorkspaceMemoryEntry> = {};

  for (const [id, entry] of Object.entries(isRecord(file.entries) ? file.entries : {})) {
    try {
      entries[id] = normalizeEntry(entry, normalizedWorkspaceId, id);
    } catch {
      // Skip invalid legacy entries and keep loading the rest of the workspace file.
    }
  }

  return {
    version: 1,
    workspaceId: normalizedWorkspaceId,
    entries,
  };
}

export class MemoryRepo {
  private readonly rootDir: string;
  private readonly now: () => number;
  private readonly randomId: () => string;

  constructor(options: MemoryRepoOptions) {
    this.rootDir = options.rootDir;
    this.now = options.now ?? (() => Date.now());
    this.randomId = options.randomId ?? (() => randomBytes(4).toString("hex"));
  }

  list(filter: WorkspaceMemoryListFilter): WorkspaceMemoryEntry[] {
    const file = this.readWorkspaceFile(filter.workspaceId);

    return Object.values(file.entries)
      .filter((entry) => filter.includeArchived || entry.archivedAt === undefined)
      .filter((entry) => (filter.type ? entry.type === filter.type : true))
      .filter((entry) => (filter.query ? includesQuery(entry, filter.query) : true))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  get(workspaceId: string, id: string): WorkspaceMemoryEntry | undefined {
    return this.readWorkspaceFile(workspaceId).entries[id];
  }

  create(input: MemoryCreateInput): WorkspaceMemoryEntry {
    const validated = validateWorkspaceMemoryInput({
      type: input.type,
      content: input.content,
    });
    const file = this.readWorkspaceFile(input.workspaceId);
    const timestamp = this.now();
    const entry: WorkspaceMemoryEntry = {
      id: `mem_${timestamp}_${this.randomId()}`,
      workspaceId: input.workspaceId,
      type: validated.type,
      content: validated.content,
      source: resolveWorkspaceMemorySource(input.source ?? {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    file.entries[entry.id] = entry;
    this.writeWorkspaceFile(file);
    return entry;
  }

  update(input: MemoryUpdateInput): WorkspaceMemoryEntry {
    const file = this.readWorkspaceFile(input.workspaceId);
    const existing = file.entries[input.id];
    if (!existing) {
      return notFound(input.id);
    }

    const validated = validateWorkspaceMemoryInput({
      type: input.type ?? existing.type,
      content: input.content ?? existing.content,
    });
    const updated: WorkspaceMemoryEntry = {
      ...existing,
      type: validated.type,
      content: validated.content,
      updatedAt: this.now(),
      ...(input.archivedAt !== undefined ? { archivedAt: input.archivedAt } : {}),
    };

    file.entries[input.id] = updated;
    this.writeWorkspaceFile(file);
    return updated;
  }

  delete(workspaceId: string, id: string): WorkspaceMemoryEntry {
    const timestamp = this.now();
    return this.update({
      workspaceId,
      id,
      archivedAt: timestamp,
    });
  }

  removeWorkspace(workspaceId: string): void {
    rmSync(this.filePath(workspaceId), { force: true });
  }

  private readWorkspaceFile(workspaceId: string): WorkspaceMemoryFile {
    return normalizeWorkspaceFile(
      readJsonFile<LegacyWorkspaceMemoryFile>(this.filePath(workspaceId)),
      workspaceId
    );
  }

  private writeWorkspaceFile(file: WorkspaceMemoryFile): void {
    writeJsonFileAtomic(this.filePath(file.workspaceId), file);
  }

  private filePath(workspaceId: string): string {
    return join(this.rootDir, `${encodeURIComponent(workspaceId)}.json`);
  }
}
