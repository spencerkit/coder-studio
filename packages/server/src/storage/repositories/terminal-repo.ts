import type { Terminal } from "@coder-studio/core";
import type { Database } from "../database.js";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

/**
 * Database row representation for Terminal table
 */
export interface TerminalRow {
  id: string;
  workspace_id: string;
  kind: "agent" | "shell";
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
  kind: "agent" | "shell";
  cwd: string;
  argv: string[];
  env?: Record<string, string>;
  title?: string;
  cols: number;
  rows: number;
  createdAt: number;
}

interface TerminalFileRecord {
  version: 1;
  terminals: Record<string, Terminal>;
}

export interface TerminalRepoOptions {
  filePath: string;
}

function isDatabase(value: Database | TerminalRepoOptions): value is Database {
  return typeof (value as Database).prepare === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTerminal(value: unknown): value is Terminal {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.workspaceId === "string" &&
    (value.kind === "agent" || value.kind === "shell") &&
    typeof value.cwd === "string" &&
    Array.isArray(value.argv) &&
    typeof value.cols === "number" &&
    typeof value.rows === "number" &&
    typeof value.alive === "boolean" &&
    typeof value.createdAt === "number"
  );
}

function normalizeTerminal(value: Terminal): Terminal {
  return {
    ...value,
    title: value.title ?? "",
  };
}

function normalizeTerminalFile(value: unknown): Record<string, Terminal> {
  if (isRecord(value) && value.version === 1 && isRecord(value.terminals)) {
    const normalized: Record<string, Terminal> = {};
    for (const entry of Object.values(value.terminals)) {
      if (isTerminal(entry)) {
        normalized[entry.id] = normalizeTerminal(entry);
      }
    }
    return normalized;
  }

  if (Array.isArray(value)) {
    const normalized: Record<string, Terminal> = {};
    for (const entry of value) {
      if (isTerminal(entry)) {
        normalized[entry.id] = normalizeTerminal(entry);
      }
    }
    return normalized;
  }

  if (isRecord(value)) {
    const normalized: Record<string, Terminal> = {};
    for (const [terminalId, entry] of Object.entries(value)) {
      if (isTerminal(entry)) {
        normalized[terminalId] = normalizeTerminal({
          ...entry,
          id: terminalId,
        });
      }
    }
    return normalized;
  }

  return {};
}

/**
 * Terminal repository for CRUD operations
 */
export class TerminalRepo {
  private readonly db?: Database;
  private readonly filePath?: string;

  constructor(input: Database | TerminalRepoOptions) {
    if (isDatabase(input)) {
      this.db = input;
      return;
    }

    this.filePath = input.filePath;
  }

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
      title: row.title ?? "",
      env: row.env ? (JSON.parse(row.env) as Record<string, string>) : undefined,
    };
  }

  private loadFileTerminals(): Record<string, Terminal> {
    if (!this.filePath) {
      return {};
    }

    const parsed = readJsonFile<TerminalFileRecord | Record<string, Terminal> | Terminal[]>(
      this.filePath
    );
    if (parsed !== undefined) {
      return normalizeTerminalFile(parsed);
    }

    return {};
  }

  private saveFileTerminals(terminals: Record<string, Terminal>): void {
    if (!this.filePath) {
      return;
    }

    const payload: TerminalFileRecord = {
      version: 1,
      terminals,
    };
    writeJsonFileAtomic(this.filePath, payload);
  }

  private sortTerminals(terminals: Record<string, Terminal>): Terminal[] {
    return Object.values(terminals).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Lists all terminals for a workspace
   */
  listByWorkspace(workspaceId: string): Terminal[] {
    if (this.db) {
      const rows = this.db
        .prepare("SELECT * FROM terminals WHERE workspace_id = ? ORDER BY created_at DESC")
        .all(workspaceId) as unknown as TerminalRow[];
      return rows.map((row) => this.rowToTerminal(row));
    }

    return this.sortTerminals(this.loadFileTerminals()).filter(
      (terminal) => terminal.workspaceId === workspaceId
    );
  }

  /**
   * Finds a terminal by ID
   */
  findById(id: string): Terminal | undefined {
    if (this.db) {
      const row = this.db.prepare("SELECT * FROM terminals WHERE id = ?").get(id) as
        | TerminalRow
        | undefined;
      return row ? this.rowToTerminal(row) : undefined;
    }

    return this.loadFileTerminals()[id];
  }

  /**
   * Lists all active (non-ended) terminals for a workspace
   */
  listActiveByWorkspace(workspaceId: string): Terminal[] {
    if (this.db) {
      const rows = this.db
        .prepare(
          "SELECT * FROM terminals WHERE workspace_id = ? AND ended_at IS NULL ORDER BY created_at DESC"
        )
        .all(workspaceId) as unknown as TerminalRow[];
      return rows.map((row) => this.rowToTerminal(row));
    }

    return this.listByWorkspace(workspaceId).filter((terminal) => terminal.alive);
  }

  /**
   * Creates a new terminal
   */
  create(terminal: NewTerminal): Terminal {
    if (this.db) {
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

    const nextTerminal: Terminal = normalizeTerminal({
      id: terminal.id,
      workspaceId: terminal.workspaceId,
      kind: terminal.kind,
      cwd: terminal.cwd,
      argv: terminal.argv,
      cols: terminal.cols,
      rows: terminal.rows,
      alive: true,
      createdAt: terminal.createdAt,
      title: terminal.title ?? "",
      env: terminal.env,
    });

    const terminals = this.loadFileTerminals();
    terminals[nextTerminal.id] = nextTerminal;
    this.saveFileTerminals(terminals);
    return nextTerminal;
  }

  insert(terminal: Terminal): void {
    this.create({
      id: terminal.id,
      workspaceId: terminal.workspaceId,
      kind: terminal.kind,
      cwd: terminal.cwd,
      argv: terminal.argv,
      env: terminal.env,
      title: terminal.title,
      cols: terminal.cols,
      rows: terminal.rows,
      createdAt: terminal.createdAt,
    });

    if (!terminal.alive && terminal.endedAt != null) {
      this.markEnded(terminal.id, terminal.endedAt, terminal.exitCode ?? 0);
    }
  }

  /**
   * Marks a terminal as ended
   */
  markEnded(id: string, endedAt: number, exitCode: number): void {
    if (this.db) {
      const stmt = this.db.prepare("UPDATE terminals SET ended_at = ?, exit_code = ? WHERE id = ?");
      stmt.run(endedAt, exitCode, id);
      return;
    }

    const terminals = this.loadFileTerminals();
    const terminal = terminals[id];
    if (!terminal) {
      return;
    }

    terminals[id] = {
      ...terminal,
      alive: false,
      endedAt,
      exitCode,
    };
    this.saveFileTerminals(terminals);
  }

  /**
   * Updates terminal dimensions
   */
  updateDimensions(id: string, cols: number, rows: number): void {
    if (this.db) {
      const stmt = this.db.prepare("UPDATE terminals SET cols = ?, rows = ? WHERE id = ?");
      stmt.run(cols, rows, id);
      return;
    }

    const terminals = this.loadFileTerminals();
    const terminal = terminals[id];
    if (!terminal) {
      return;
    }

    terminals[id] = {
      ...terminal,
      cols,
      rows,
    };
    this.saveFileTerminals(terminals);
  }

  /**
   * Updates terminal title
   */
  updateTitle(id: string, title: string): void {
    if (this.db) {
      const stmt = this.db.prepare("UPDATE terminals SET title = ? WHERE id = ?");
      stmt.run(title, id);
      return;
    }

    const terminals = this.loadFileTerminals();
    const terminal = terminals[id];
    if (!terminal) {
      return;
    }

    terminals[id] = {
      ...terminal,
      title,
    };
    this.saveFileTerminals(terminals);
  }

  /**
   * Deletes a terminal by ID
   */
  delete(id: string): void {
    if (this.db) {
      const stmt = this.db.prepare("DELETE FROM terminals WHERE id = ?");
      stmt.run(id);
      return;
    }

    const terminals = this.loadFileTerminals();
    if (!terminals[id]) {
      return;
    }

    delete terminals[id];
    this.saveFileTerminals(terminals);
  }
}
