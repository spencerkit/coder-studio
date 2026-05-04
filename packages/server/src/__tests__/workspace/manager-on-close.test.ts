import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Database } from '../../storage/database.js';
import { WorkspaceManager } from '../../workspace/manager.js';

describe('WorkspaceManager.close — onClose callback', () => {
  let rootDir: string;
  let db: Database;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'workspace-onclose-'));

    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        target_runtime TEXT NOT NULL,
        wsl_distro TEXT,
        opened_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        ui_state TEXT
      );
    `);
  });

  afterEach(async () => {
    db.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  it('invokes onClose after the workspace row is deleted', async () => {
    let manager!: WorkspaceManager;
    const onClose = vi.fn(async (workspaceId: string) => {
      expect(manager.get(workspaceId)).toBeUndefined();
    });
    const eventBus = {
      emit: () => {},
      on: () => () => {},
    };

    manager = new WorkspaceManager({ db, eventBus, onClose });

    const workspace = await manager.open({ path: rootDir });
    await manager.close(workspace.id);

    expect(onClose).toHaveBeenCalledWith(workspace.id);
    expect(manager.get(workspace.id)).toBeUndefined();
  });

  it('swallows onClose errors and still removes the workspace', async () => {
    const eventBus = {
      emit: () => {},
      on: () => () => {},
    };
    const manager = new WorkspaceManager({
      db,
      eventBus,
      onClose: async () => {
        throw new Error('cleanup failed');
      },
    });

    const workspacePath = join(rootDir, 'nested');
    await mkdir(workspacePath);
    const workspace = await manager.open({ path: workspacePath });

    await expect(manager.close(workspace.id)).resolves.toBeUndefined();
    expect(manager.get(workspace.id)).toBeUndefined();
  });
});
