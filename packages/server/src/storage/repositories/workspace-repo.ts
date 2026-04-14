import type Database from 'better-sqlite3';
import type { Workspace, UiState } from '@coder-studio/core';

/**
 * Database row representation for Workspace table
 */
export interface WorkspaceRow {
  id: string;
  path: string;
  target_runtime: 'native' | 'wsl';
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
  targetRuntime: 'native' | 'wsl';
  wslDistro?: string;
  openedAt: number;
  lastActiveAt: number;
  uiState: UiState;
}

/**
 * Workspace repository for CRUD operations
 */
export class WorkspaceRepo {
  constructor(private db: Database.Database) {}

  /**
   * Lists all workspaces
   */
  list(): Workspace[] {
    const rows = this.db.prepare('SELECT * FROM workspaces').all() as WorkspaceRow[];
    return rows.map(row => this.rowToWorkspace(row));
  }

  /**
   * Finds a workspace by ID
   */
  findById(id: string): Workspace | undefined {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined;
    return row ? this.rowToWorkspace(row) : undefined;
  }

  /**
   * Finds a workspace by path
   */
  findByPath(path: string): Workspace | undefined {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE path = ?').get(path) as WorkspaceRow | undefined;
    return row ? this.rowToWorkspace(row) : undefined;
  }

  /**
   * Creates a new workspace
   */
  create(workspace: NewWorkspace): Workspace {
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

  /**
   * Updates the UI state for a workspace
   */
  updateUiState(id: string, uiState: UiState): void {
    const stmt = this.db.prepare('UPDATE workspaces SET ui_state = ? WHERE id = ?');
    stmt.run(JSON.stringify(uiState), id);
  }

  /**
   * Updates the last active timestamp for a workspace
   */
  updateLastActive(id: string, lastActiveAt: number): void {
    const stmt = this.db.prepare('UPDATE workspaces SET last_active_at = ? WHERE id = ?');
    stmt.run(lastActiveAt, id);
  }

  /**
   * Deletes a workspace by ID
   */
  delete(id: string): void {
    const stmt = this.db.prepare('DELETE FROM workspaces WHERE id = ?');
    stmt.run(id);
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
