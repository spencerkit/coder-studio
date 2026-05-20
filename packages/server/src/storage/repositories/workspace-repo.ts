import type { UiState, Workspace } from "@coder-studio/core";
import type { Database } from "../database.js";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

/**
 * Database row representation for Workspace table
 */
export interface WorkspaceRow {
  id: string;
  path: string;
  target_runtime: "native" | "wsl";
  wsl_distro: string | null;
  opened_at: number;
  last_active_at: number;
  ui_state: string; // JSON string
}

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
  legacyDb?: Database;
}

function isDatabase(value: Database | WorkspaceRepoOptions): value is Database {
  return typeof (value as Database).prepare === "function";
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

/**
 * Workspace repository for CRUD operations
 */
export class WorkspaceRepo {
  private readonly db?: Database;
  private readonly filePath?: string;
  private readonly legacyDb?: Database;

  constructor(input: Database | WorkspaceRepoOptions) {
    if (isDatabase(input)) {
      this.db = input;
      return;
    }

    this.filePath = input.filePath;
    this.legacyDb = input.legacyDb;
  }

  private readAllDbWorkspaces(db: Database | undefined = this.db): Record<string, Workspace> {
    const rows = db?.prepare("SELECT * FROM workspaces").all() as WorkspaceRow[] | undefined;
    const result: Record<string, Workspace> = {};
    for (const row of rows ?? []) {
      const workspace = this.rowToWorkspace(row);
      result[workspace.id] = workspace;
    }
    return result;
  }

  private loadFileWorkspaces(): Record<string, Workspace> {
    if (!this.filePath) {
      return {};
    }

    const parsed = readJsonFile<WorkspaceFileRecord | Record<string, Workspace> | Workspace[]>(
      this.filePath
    );
    if (parsed !== undefined) {
      return normalizeWorkspaceFile(parsed);
    }

    if (!this.legacyDb) {
      return {};
    }

    const migrated = this.readAllDbWorkspaces(this.legacyDb);
    if (Object.keys(migrated).length > 0) {
      this.saveFileWorkspaces(migrated);
    }
    return migrated;
  }

  private saveFileWorkspaces(workspaces: Record<string, Workspace>): void {
    if (!this.filePath) {
      return;
    }

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
    if (this.db) {
      const rows = this.db
        .prepare("SELECT * FROM workspaces ORDER BY last_active_at DESC")
        .all() as unknown as WorkspaceRow[];
      return rows.map((row) => this.rowToWorkspace(row));
    }

    return this.sortWorkspaces(this.loadFileWorkspaces());
  }

  /**
   * Finds a workspace by ID
   */
  findById(id: string): Workspace | undefined {
    if (this.db) {
      const row = this.db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as
        | WorkspaceRow
        | undefined;
      return row ? this.rowToWorkspace(row) : undefined;
    }

    return this.loadFileWorkspaces()[id];
  }

  /**
   * Finds a workspace by path
   */
  findByPath(path: string): Workspace | undefined {
    if (this.db) {
      const row = this.db.prepare("SELECT * FROM workspaces WHERE path = ?").get(path) as
        | WorkspaceRow
        | undefined;
      return row ? this.rowToWorkspace(row) : undefined;
    }

    return Object.values(this.loadFileWorkspaces()).find((workspace) => workspace.path === path);
  }

  /**
   * Creates a new workspace
   */
  create(workspace: NewWorkspace): Workspace {
    if (this.db) {
      const stmt = this.db.prepare(`
        INSERT INTO workspaces (id, path, target_runtime, wsl_distro, opened_at, last_active_at, ui_state)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        workspace.id,
        workspace.path,
        workspace.targetRuntime,
        workspace.wslDistro ?? null,
        workspace.openedAt,
        workspace.lastActiveAt,
        JSON.stringify(workspace.uiState)
      );

      return this.findById(workspace.id)!;
    }

    const next = this.loadFileWorkspaces();
    if (next[workspace.id]) {
      throw new Error(`Workspace already exists: ${workspace.id}`);
    }
    if (Object.values(next).some((entry) => entry.path === workspace.path)) {
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
    if (this.db) {
      const stmt = this.db.prepare("UPDATE workspaces SET ui_state = ? WHERE id = ?");
      stmt.run(JSON.stringify(uiState), id);
      return;
    }

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
    if (this.db) {
      const stmt = this.db.prepare("UPDATE workspaces SET last_active_at = ? WHERE id = ?");
      stmt.run(lastActiveAt, id);
      return;
    }

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
    if (this.db) {
      const stmt = this.db.prepare("DELETE FROM workspaces WHERE id = ?");
      stmt.run(id);
      return;
    }

    const next = this.loadFileWorkspaces();
    if (!next[id]) {
      return;
    }

    delete next[id];
    this.saveFileWorkspaces(next);
  }

  /**
   * Converts a database row to a Workspace domain object
   */
  private rowToWorkspace(row: WorkspaceRow): Workspace {
    return {
      id: row.id,
      path: row.path,
      targetRuntime: row.target_runtime,
      wslDistro: row.wsl_distro ?? undefined,
      openedAt: row.opened_at,
      lastActiveAt: row.last_active_at,
      uiState: JSON.parse(row.ui_state) as UiState,
    };
  }
}
