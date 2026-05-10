/**
 * WorkspaceManager - Manages workspace lifecycle (open/close/list).
 */

import type { DomainEvent, Workspace } from "@coder-studio/core";
import type { Database } from "../storage/database.js";
import { WorkspaceValidator } from "./validator.js";

export interface OpenWorkspaceRequest {
  path: string;
  wslDistro?: string;
}

export interface EventBus {
  emit(event: DomainEvent): void;
  on(type: DomainEvent["type"], handler: (event: DomainEvent) => void): () => void;
}

export interface AutoFetchRuntime {
  triggerOpenTimeFetch(workspaceId: string): void;
  recordSuccess(workspaceId: string): void;
  getLastFetchAt(workspaceId: string): number | undefined;
}

export interface WorkspaceManagerDeps {
  db: Database;
  eventBus: EventBus;
  broadcaster?: Broadcaster;
  autoFetch?: AutoFetchRuntime;
  teardown?: (workspaceId: string) => void | Promise<void>;
  onClose?: (workspaceId: string) => void | Promise<void>;
}

/**
 * Generates a unique workspace ID.
 */
function generateWorkspaceId(): string {
  return `ws_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * WorkspaceManager handles workspace lifecycle operations.
 * It validates paths, checks runtime requirements, persists to DB,
 * and broadcasts metadata changes via EventBus.
 */
export class WorkspaceManager {
  private validator = new WorkspaceValidator();
  private watchers = new Map<string, WorkspaceWatcher>();

  constructor(private deps: WorkspaceManagerDeps) {}

  private startWatcher(workspaceId: string, rootPath: string): void {
    if (!this.deps.broadcaster || this.watchers.has(workspaceId)) {
      return;
    }

    this.watchers.set(
      workspaceId,
      new WorkspaceWatcher(workspaceId, rootPath, this.deps.broadcaster)
    );
  }

  hydrateWatchers(): void {
    for (const workspace of this.list()) {
      this.startWatcher(workspace.id, workspace.path);
    }
  }

  updateUiState(workspaceId: string, uiState: Workspace["uiState"]): void {
    const workspace = this.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    this.deps.db
      .prepare("UPDATE workspaces SET ui_state = ? WHERE id = ?")
      .run(JSON.stringify(uiState), workspaceId);

    this.deps.eventBus.emit({
      type: "workspace.meta.changed",
      workspaceId,
      patch: { uiState },
    });
  }

  /**
   * Opens a new workspace.
   *
   * 1. Validates path exists and is accessible
   * 2. Checks if workspace already exists for this path
   * 3. Persists workspace to database (or returns existing)
   * 4. Emits metadata change event
   *
   * @param req - Open workspace request
   * @returns Created or existing workspace
   */
  async open(req: OpenWorkspaceRequest): Promise<Workspace> {
    // 1. Validate path
    await this.validator.validate(req.path);

    // 2. Check if workspace already exists for this path
    const existing = this.getByPath(req.path);
    if (existing) {
      // Update last active timestamp and return existing
      this.touch(existing.id);

      // Start watcher if not already watching (e.g., after server restart)
      this.startWatcher(existing.id, existing.path);

      this.deps.eventBus.emit({
        type: "workspace.meta.changed",
        workspaceId: existing.id,
        patch: { lastActiveAt: Date.now() },
      });
      this.deps.autoFetch?.triggerOpenTimeFetch(existing.id);
      return existing;
    }

    // 3. Persist to DB
    const workspace: Workspace = {
      id: generateWorkspaceId(),
      path: req.path,
      targetRuntime: "native",
      wslDistro: req.wslDistro,
      openedAt: Date.now(),
      lastActiveAt: Date.now(),
      uiState: {
        leftPanelWidth: 250,
        bottomPanelHeight: 200,
        focusMode: false,
        paneLayout: {
          id: "root",
          type: "leaf",
        },
      },
    };

    this.deps.db
      .prepare(
        `INSERT INTO workspaces (id, path, target_runtime, wsl_distro, opened_at, last_active_at, ui_state)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        workspace.id,
        workspace.path,
        "native",
        workspace.wslDistro ?? null,
        workspace.openedAt,
        workspace.lastActiveAt,
        JSON.stringify(workspace.uiState)
      );

    // 3. Emit event
    this.deps.eventBus.emit({
      type: "workspace.meta.changed",
      workspaceId: workspace.id,
      patch: workspace,
    });

    // Start file system watcher
    this.startWatcher(workspace.id, workspace.path);
    this.deps.autoFetch?.triggerOpenTimeFetch(workspace.id);

    return workspace;
  }

  /**
   * Closes a workspace.
   *
   * @param workspaceId - Workspace ID to close
   */
  async close(workspaceId: string): Promise<void> {
    const workspace = this.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    // Stop file system watcher
    const watcher = this.watchers.get(workspaceId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(workspaceId);
    }

    if (this.deps.teardown) {
      await this.deps.teardown(workspaceId);
    }

    // Delete from DB (cascade deletes terminals and sessions)
    this.deps.db.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);

    if (this.deps.onClose) {
      try {
        await this.deps.onClose(workspaceId);
      } catch (err) {
        console.warn("[workspace] onClose hook failed:", err);
      }
    }

    // Emit event
    this.deps.eventBus.emit({
      type: "workspace.meta.changed",
      workspaceId: workspaceId,
      patch: { lastActiveAt: Date.now() },
    });
  }

  /**
   * Lists all open workspaces.
   *
   * @returns Array of workspaces
   */
  list(): Workspace[] {
    const rows = this.deps.db
      .prepare(
        `SELECT id, path, target_runtime, wsl_distro, opened_at, last_active_at, ui_state
         FROM workspaces
         ORDER BY last_active_at DESC`
      )
      .all() as Array<{
      id: string;
      path: string;
      target_runtime: string;
      wsl_distro: string | null;
      opened_at: number;
      last_active_at: number;
      ui_state: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      targetRuntime: row.target_runtime as "native" | "wsl",
      wslDistro: row.wsl_distro ?? undefined,
      openedAt: row.opened_at,
      lastActiveAt: row.last_active_at,
      uiState: JSON.parse(row.ui_state),
    }));
  }

  /**
   * Gets a single workspace by ID.
   *
   * @param workspaceId - Workspace ID
   * @returns Workspace or undefined
   */
  get(workspaceId: string): Workspace | undefined {
    const row = this.deps.db
      .prepare(
        `SELECT id, path, target_runtime, wsl_distro, opened_at, last_active_at, ui_state
         FROM workspaces
         WHERE id = ?`
      )
      .get(workspaceId) as
      | {
          id: string;
          path: string;
          target_runtime: string;
          wsl_distro: string | null;
          opened_at: number;
          last_active_at: number;
          ui_state: string;
        }
      | undefined;

    if (!row) return undefined;

    return {
      id: row.id,
      path: row.path,
      targetRuntime: row.target_runtime as "native" | "wsl",
      wslDistro: row.wsl_distro ?? undefined,
      openedAt: row.opened_at,
      lastActiveAt: row.last_active_at,
      uiState: JSON.parse(row.ui_state),
    };
  }

  /**
   * Gets a workspace by path.
   *
   * @param path - Workspace path
   * @returns Workspace or undefined
   */
  getByPath(path: string): Workspace | undefined {
    const row = this.deps.db
      .prepare(
        `SELECT id, path, target_runtime, wsl_distro, opened_at, last_active_at, ui_state
         FROM workspaces
         WHERE path = ?`
      )
      .get(path) as
      | {
          id: string;
          path: string;
          target_runtime: string;
          wsl_distro: string | null;
          opened_at: number;
          last_active_at: number;
          ui_state: string;
        }
      | undefined;

    if (!row) return undefined;

    return {
      id: row.id,
      path: row.path,
      targetRuntime: row.target_runtime as "native" | "wsl",
      wslDistro: row.wsl_distro ?? undefined,
      openedAt: row.opened_at,
      lastActiveAt: row.last_active_at,
      uiState: JSON.parse(row.ui_state),
    };
  }

  /**
   * Updates workspace last active timestamp.
   *
   * @param workspaceId - Workspace ID
   */
  touch(workspaceId: string): void {
    const now = Date.now();
    this.deps.db
      .prepare("UPDATE workspaces SET last_active_at = ? WHERE id = ?")
      .run(now, workspaceId);
  }

  recordFetch(workspaceId: string): void {
    this.deps.autoFetch?.recordSuccess(workspaceId);
  }
}

import { WorkspaceWatcher } from "../fs/watcher.js";

export interface Broadcaster {
  broadcast(topic: string, data: unknown): void;
}
