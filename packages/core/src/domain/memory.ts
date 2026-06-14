export const WORKSPACE_MEMORY_TYPES = ["feature", "todo", "bugfix", "project", "note"] as const;

export type WorkspaceMemoryType = (typeof WORKSPACE_MEMORY_TYPES)[number];

export const WORKSPACE_MEMORY_SOURCE_KINDS = ["user", "agent", "skill"] as const;

export type WorkspaceMemorySourceKind = (typeof WORKSPACE_MEMORY_SOURCE_KINDS)[number];

export interface WorkspaceMemorySource {
  kind: WorkspaceMemorySourceKind;
  providerId?: string;
  sessionId?: string;
  skillSlug?: string;
}

export interface WorkspaceMemoryEntry {
  id: string;
  workspaceId: string;
  type: WorkspaceMemoryType;
  content: string;
  source: WorkspaceMemorySource;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
}

export interface WorkspaceMemoryListFilter {
  workspaceId: string;
  query?: string;
  type?: WorkspaceMemoryType;
  includeArchived?: boolean;
}

export interface WorkspaceMemoryInput {
  type: unknown;
  content: unknown;
}

export interface WorkspaceMemoryValidatedInput {
  type: WorkspaceMemoryType;
  content: string;
}

export interface WorkspaceMemorySourceInput {
  kind?: unknown;
  defaultKind?: WorkspaceMemorySourceKind;
  providerId?: unknown;
  sessionId?: unknown;
  skillSlug?: unknown;
}

const WORKSPACE_MEMORY_TYPE_SET = new Set<string>(WORKSPACE_MEMORY_TYPES);
const WORKSPACE_MEMORY_SOURCE_KIND_SET = new Set<string>(WORKSPACE_MEMORY_SOURCE_KINDS);
function isWorkspaceMemoryType(value: unknown): value is WorkspaceMemoryType {
  return typeof value === "string" && WORKSPACE_MEMORY_TYPE_SET.has(value);
}

function isWorkspaceMemorySourceKind(value: unknown): value is WorkspaceMemorySourceKind {
  return typeof value === "string" && WORKSPACE_MEMORY_SOURCE_KIND_SET.has(value);
}

function normalizeSourceText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function validateWorkspaceMemoryInput(
  input: WorkspaceMemoryInput
): WorkspaceMemoryValidatedInput {
  if (!isWorkspaceMemoryType(input.type)) {
    throw new Error("Invalid memory type");
  }

  if (typeof input.content !== "string") {
    throw new Error("Memory content is required");
  }

  const content = input.content.trim();
  if (!content) {
    throw new Error("Memory content is required");
  }

  return {
    type: input.type,
    content,
  };
}

export function resolveWorkspaceMemorySource(
  input: WorkspaceMemorySourceInput
): WorkspaceMemorySource {
  const kind = input.kind ?? input.defaultKind ?? "user";
  if (!isWorkspaceMemorySourceKind(kind)) {
    throw new Error("Invalid memory source kind");
  }

  const providerId = normalizeSourceText(input.providerId);
  const sessionId = normalizeSourceText(input.sessionId);
  const skillSlug = normalizeSourceText(input.skillSlug);

  return {
    kind,
    ...(providerId ? { providerId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(skillSlug ? { skillSlug } : {}),
  };
}
