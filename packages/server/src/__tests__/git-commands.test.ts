import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { dispatch } from '../ws/dispatch.js';
import type { CommandContext } from '../ws/dispatch.js';
import { openDatabase, runMigrations } from '../storage/db.js';
import { WorkspaceManager } from '../workspace/manager.js';
import { EventBus } from '../bus/event-bus.js';

import '../commands/workspace.js';
import '../commands/git.js';

const execFileAsync = promisify(execFile);

describe('Git Commands', () => {
  let testDir: string;
  let ctx: CommandContext;
  let workspaceMgr: WorkspaceManager;
  let eventBus: EventBus;
  let db: ReturnType<typeof openDatabase>;
  let workspaceId: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `git-command-test-${Date.now()}`);
    await mkdir(testDir);

    await execFileAsync('git', ['init'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });

    await writeFile(join(testDir, 'sample.ts'), 'export const value = 1;\n');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: testDir });
    await writeFile(join(testDir, 'sample.ts'), 'export const value = 2;\n');

    db = openDatabase(':memory:');
    runMigrations(db);
    eventBus = new EventBus();
    workspaceMgr = new WorkspaceManager({ db, eventBus });

    const workspace = await workspaceMgr.open({
      path: testDir,
    });
    workspaceId = workspace.id;

    ctx = {
      db,
      workspaceMgr,
      sessionMgr: {} as any,
      terminalMgr: {} as any,
      hooksMgr: {} as any,
      eventBus,
      broadcaster: { broadcast: () => {} } as any,
      providerRegistry: [],
      fencingMgr: {} as any,
      supervisorMgr: {} as any,
    };
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('returns file diff for git.diff', async () => {
    const result = await dispatch(
      {
        kind: 'command',
        id: 'git-diff-1',
        op: 'git.diff',
        args: {
          workspaceId,
          path: 'sample.ts',
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        diff: expect.stringContaining('-export const value = 1;'),
      })
    );
    expect((result.data as { diff: string }).diff).toContain('+export const value = 2;');
  });
});
