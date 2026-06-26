export const WorkspaceMemoryType = {
  Wiki: "wiki",
  Issue: "issue",
  Todo: "todo",
  Note: "note",
} as const;

export const WORKSPACE_MEMORY_TYPES = [
  WorkspaceMemoryType.Wiki,
  WorkspaceMemoryType.Issue,
  WorkspaceMemoryType.Todo,
  WorkspaceMemoryType.Note,
] as const;

export type WorkspaceMemoryType = (typeof WORKSPACE_MEMORY_TYPES)[number];

export const WorkspaceMemoryStatus = {
  NotStarted: "not_started",
  InProgress: "in_progress",
  PendingVerification: "pending_verification",
  Completed: "completed",
} as const;

export const WORKSPACE_MEMORY_STATUSES = [
  WorkspaceMemoryStatus.NotStarted,
  WorkspaceMemoryStatus.InProgress,
  WorkspaceMemoryStatus.PendingVerification,
  WorkspaceMemoryStatus.Completed,
] as const;

export type WorkspaceMemoryStatus = (typeof WORKSPACE_MEMORY_STATUSES)[number];

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
  status?: WorkspaceMemoryStatus;
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
  status?: unknown;
}

export interface WorkspaceMemoryValidatedInput {
  type: WorkspaceMemoryType;
  content: string;
  status?: WorkspaceMemoryStatus;
}

export interface WorkspaceMemorySourceInput {
  kind?: unknown;
  defaultKind?: WorkspaceMemorySourceKind;
  providerId?: unknown;
  sessionId?: unknown;
  skillSlug?: unknown;
}

const WORKSPACE_MEMORY_TYPE_SET = new Set<string>(WORKSPACE_MEMORY_TYPES);
const WORKSPACE_MEMORY_STATUS_SET = new Set<string>(WORKSPACE_MEMORY_STATUSES);
const WORKSPACE_MEMORY_SOURCE_KIND_SET = new Set<string>(WORKSPACE_MEMORY_SOURCE_KINDS);

const LEGACY_WORKSPACE_MEMORY_TYPE_ALIASES = new Map<string, WorkspaceMemoryType>([
  ["project", WorkspaceMemoryType.Wiki],
  ["bugfix", WorkspaceMemoryType.Issue],
  ["feature", WorkspaceMemoryType.Wiki],
]);

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

export function normalizeWorkspaceMemoryType(value: unknown): WorkspaceMemoryType | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  if (WORKSPACE_MEMORY_TYPE_SET.has(value)) {
    return value as WorkspaceMemoryType;
  }

  return LEGACY_WORKSPACE_MEMORY_TYPE_ALIASES.get(value);
}

export function isActionableWorkspaceMemoryType(type: WorkspaceMemoryType): boolean {
  return type === WorkspaceMemoryType.Issue || type === WorkspaceMemoryType.Todo;
}

export function normalizeWorkspaceMemoryStatus(value: unknown): WorkspaceMemoryStatus | undefined {
  return typeof value === "string" && WORKSPACE_MEMORY_STATUS_SET.has(value)
    ? (value as WorkspaceMemoryStatus)
    : undefined;
}

export function validateWorkspaceMemoryInput(
  input: WorkspaceMemoryInput
): WorkspaceMemoryValidatedInput {
  const type = normalizeWorkspaceMemoryType(input.type);
  if (!type) {
    throw new Error("Invalid memory type");
  }

  if (typeof input.content !== "string") {
    throw new Error("Memory content is required");
  }

  const content = input.content.trim();
  if (!content) {
    throw new Error("Memory content is required");
  }

  const status =
    input.status === undefined ? undefined : normalizeWorkspaceMemoryStatus(input.status);
  if (input.status !== undefined && !status) {
    throw new Error("Invalid memory status");
  }

  if (!isActionableWorkspaceMemoryType(type)) {
    return {
      type,
      content,
    };
  }

  return {
    type,
    content,
    status: status ?? WorkspaceMemoryStatus.NotStarted,
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
