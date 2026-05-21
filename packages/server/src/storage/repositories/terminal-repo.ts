import type { Terminal } from "@coder-studio/core";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

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
  private readonly filePath: string;

  constructor(input: TerminalRepoOptions) {
    this.filePath = input.filePath;
  }

  private loadFileTerminals(): Record<string, Terminal> {
    const parsed = readJsonFile<TerminalFileRecord | Record<string, Terminal> | Terminal[]>(
      this.filePath
    );
    if (parsed !== undefined) {
      return normalizeTerminalFile(parsed);
    }

    return {};
  }

  private saveFileTerminals(terminals: Record<string, Terminal>): void {
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
    return this.sortTerminals(this.loadFileTerminals()).filter(
      (terminal) => terminal.workspaceId === workspaceId
    );
  }

  /**
   * Finds a terminal by ID
   */
  findById(id: string): Terminal | undefined {
    return this.loadFileTerminals()[id];
  }

  /**
   * Lists all active (non-ended) terminals for a workspace
   */
  listActiveByWorkspace(workspaceId: string): Terminal[] {
    return this.listByWorkspace(workspaceId).filter((terminal) => terminal.alive);
  }

  /**
   * Creates a new terminal
   */
  create(terminal: NewTerminal): Terminal {
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
    const terminals = this.loadFileTerminals();
    if (!terminals[id]) {
      return;
    }

    delete terminals[id];
    this.saveFileTerminals(terminals);
  }
}
