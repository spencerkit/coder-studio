import type Database from 'better-sqlite3';
import type { Terminal } from '@coder-studio/core';

/**
 * Database row representation for Terminal table
 */
export interface TerminalRow {
  id: string;
  workspace_id: string;
  kind: 'agent' | 'shell';
  cwd: string;
  argv: string; // JSON string
  env: string | null; // JSON string
  title: string | null;
  cols: number;
  rows: number;
  created_at: number;
  ended_at: number | null;
  exit_code: number | null;
}

/**
 * Input type for creating a new terminal
 */
export interface NewTerminal {
  id: string;
  workspaceId: string;
  kind: 'agent' | 'shell';
  cwd: string;
  argv: string[];
  env?: Record<string, string>;
  title?: string;
  cols: number;
  rows: number;
  createdAt: number;
}

/**
 * Terminal repository for CRUD operations
 */
export class TerminalRepo {
  constructor(private db: Database.Database) {}

  /**
   * Lists all terminals for a workspace
   */
  listByWorkspace(workspaceId: string): Terminal[] {
    const rows = this.db
      .prepare('SELECT * FROM terminals WHERE workspace_id = ? ORDER BY created_at DESC')
      .all(workspaceId) as TerminalRow[];
    return rows.map(row => this.rowToTerminal(row));
  }

  /**
   * Finds a terminal by ID
   */
  findById(id: string): Terminal | undefined {
    const row = this.db.prepare('SELECT * FROM terminals WHERE id = ?').get(id) as TerminalRow | undefined;
    return row ? this.rowToTerminal(row) : undefined;
  }

  /**
   * Lists all active (non-ended) terminals for a workspace
   */
  listActiveByWorkspace(workspaceId: string): Terminal[] {
    const rows = this.db
      .prepare('SELECT * FROM terminals WHERE workspace_id = ? AND ended_at IS NULL ORDER BY created_at DESC')
      .all(workspaceId) as TerminalRow[];
    return rows.map(row => this.rowToTerminal(row));
  }

  /**
   * Creates a new terminal
   */
  create(terminal: NewTerminal): Terminal {
    const stmt = this.db.prepare(`
      INSERT INTO terminals (id, workspace_id, kind, cwd, argv, env, title, cols, rows, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      terminal.id,
      terminal.workspaceId,
      terminal.kind,
      terminal.cwd,
      JSON.stringify(terminal.argv),
      terminal.env ? JSON.stringify(terminal.env) : null,
      terminal.title ?? null,
      terminal.cols,
      terminal.rows,
      terminal.createdAt
    );

    return this.findById(terminal.id)!;
  }

  /**
   * Marks a terminal as ended
   */
  markEnded(id: string, endedAt: number, exitCode: number): void {
    const stmt = this.db.prepare('UPDATE terminals SET ended_at = ?, exit_code = ? WHERE id = ?');
    stmt.run(endedAt, exitCode, id);
  }

  /**
   * Updates terminal dimensions
   */
  updateDimensions(id: string, cols: number, rows: number): void {
    const stmt = this.db.prepare('UPDATE terminals SET cols = ?, rows = ? WHERE id = ?');
    stmt.run(cols, rows, id);
  }

  /**
   * Updates terminal title
   */
  updateTitle(id: string, title: string): void {
    const stmt = this.db.prepare('UPDATE terminals SET title = ? WHERE id = ?');
    stmt.run(title, id);
  }

  /**
   * Deletes a terminal by ID
   */
  delete(id: string): void {
    const stmt = this.db.prepare('DELETE FROM terminals WHERE id = ?');
    stmt.run(id);
  }

  /**
   * Converts a database row to a Terminal domain object
   */
  private rowToTerminal(row: TerminalRow): Terminal {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      kind: row.kind,
      cwd: row.cwd,
      argv: JSON.parse(row.argv) as string[],
      cols: row.cols,
      rows: row.rows,
      alive: row.ended_at === null,
      createdAt: row.created_at,
      endedAt: row.ended_at ?? undefined,
      exitCode: row.exit_code ?? undefined,
      title: row.title ?? '',
      env: row.env ? (JSON.parse(row.env) as Record<string, string>) : undefined,
    };
  }
}
