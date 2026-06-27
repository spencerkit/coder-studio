import type { UiState, Workspace } from "@coder-studio/core";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

/**
 * Input type for creating a new workspace
 */
export interface NewWorkspace {
  id: string;
  path: string;
  targetRuntime: "native" | "wsl";
  wslDistro?: string;
  openedAt: number;
  lastActiveAt: number;
  uiState: UiState;
}

interface WorkspaceFileRecord {
  version: 1;
  workspaces: Record<string, Workspace>;
}

export interface WorkspaceRepoOptions {
  filePath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWorkspace(value: unknown): value is Workspace {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.path === "string" &&
    (value.targetRuntime === "native" || value.targetRuntime === "wsl") &&
    typeof value.openedAt === "number" &&
    typeof value.lastActiveAt === "number" &&
    isRecord(value.uiState)
  );
}

function normalizeWorkspaceFile(value: unknown): Record<string, Workspace> {
  if (isRecord(value) && value.version === 1 && isRecord(value.workspaces)) {
    const normalized: Record<string, Workspace> = {};
    for (const entry of Object.values(value.workspaces)) {
      if (isWorkspace(entry)) {
        normalized[entry.id] = entry;
      }
    }
    return normalized;
  }

  if (Array.isArray(value)) {
    const normalized: Record<string, Workspace> = {};
    for (const entry of value) {
      if (isWorkspace(entry)) {
        normalized[entry.id] = entry;
      }
    }
    return normalized;
  }

  if (isRecord(value)) {
    const normalized: Record<string, Workspace> = {};
    for (const [workspaceId, entry] of Object.entries(value)) {
      if (isWorkspace(entry)) {
        normalized[workspaceId] = {
          ...entry,
          id: workspaceId,
        };
      }
    }
    return normalized;
  }

  return {};
}

function isSameWorkspaceIdentity(
  existing: Pick<Workspace, "path" | "targetRuntime" | "wslDistro">,
  next: Pick<Workspace, "path" | "targetRuntime" | "wslDistro">
): boolean {
  return (
    existing.path === next.path &&
    existing.targetRuntime === next.targetRuntime &&
    (existing.targetRuntime !== "wsl" || existing.wslDistro === next.wslDistro)
  );
}

/**
 * Workspace repository for CRUD operations
 */
export class WorkspaceRepo {
  private readonly filePath: string;

  constructor(input: WorkspaceRepoOptions) {
    this.filePath = input.filePath;
  }

  private loadFileWorkspaces(): Record<string, Workspace> {
    const parsed = readJsonFile<WorkspaceFileRecord | Record<string, Workspace> | Workspace[]>(
      this.filePath
    );
    if (parsed !== undefined) {
      return normalizeWorkspaceFile(parsed);
    }

    return {};
  }

  private saveFileWorkspaces(workspaces: Record<string, Workspace>): void {
    const payload: WorkspaceFileRecord = {
      version: 1,
      workspaces,
    };
    writeJsonFileAtomic(this.filePath, payload);
  }

  private sortWorkspaces(workspaces: Record<string, Workspace>): Workspace[] {
    return Object.values(workspaces).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  /**
   * Lists all workspaces
   */
  list(): Workspace[] {
    return this.sortWorkspaces(this.loadFileWorkspaces());
  }

  /**
   * Finds a workspace by ID
   */
  findById(id: string): Workspace | undefined {
    return this.loadFileWorkspaces()[id];
  }

  /**
   * Finds a workspace by path
   */
  findByPath(path: string): Workspace | undefined {
    return Object.values(this.loadFileWorkspaces()).find((workspace) => workspace.path === path);
  }

  /**
   * Creates a new workspace
   */
  create(workspace: NewWorkspace): Workspace {
    const next = this.loadFileWorkspaces();
    if (next[workspace.id]) {
      throw new Error(`Workspace already exists: ${workspace.id}`);
    }
    if (Object.values(next).some((entry) => isSameWorkspaceIdentity(entry, workspace))) {
      throw new Error(`Workspace path already exists: ${workspace.path}`);
    }

    const created: Workspace = {
      id: workspace.id,
      path: workspace.path,
      targetRuntime: workspace.targetRuntime,
      wslDistro: workspace.wslDistro,
      openedAt: workspace.openedAt,
      lastActiveAt: workspace.lastActiveAt,
      uiState: workspace.uiState,
    };

    next[created.id] = created;
    this.saveFileWorkspaces(next);

    return created;
  }

  /**
   * Updates the UI state for a workspace
   */
  updateUiState(id: string, uiState: UiState): void {
    const next = this.loadFileWorkspaces();
    const workspace = next[id];
    if (!workspace) {
      return;
    }

    const updated: Workspace = {
      ...workspace,
      uiState,
    };
    next[id] = updated;
    this.saveFileWorkspaces(next);
  }

  /**
   * Updates the last active timestamp for a workspace
   */
  updateLastActive(id: string, lastActiveAt: number): void {
    const next = this.loadFileWorkspaces();
    const workspace = next[id];
    if (!workspace) {
      return;
    }

    const updated: Workspace = {
      ...workspace,
      lastActiveAt,
    };
    next[id] = updated;
    this.saveFileWorkspaces(next);
  }

  /**
   * Deletes a workspace by ID
   */
  delete(id: string): void {
    const next = this.loadFileWorkspaces();
    if (!next[id]) {
      return;
    }

    delete next[id];
    this.saveFileWorkspaces(next);
  }
}
