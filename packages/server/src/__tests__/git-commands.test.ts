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
      sessionMgr: {},
      terminalMgr: {},
      eventBus,
      broadcaster: { broadcast: () => {} },
      providerRegistry: [],
      fencingMgr: {},
      supervisorMgr: {},
    } as CommandContext;
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

  it('discards modified tracked files', async () => {
    const result = await dispatch(
      {
        kind: 'command',
        id: 'git-discard-modified',
        op: 'git.discard',
        args: {
          workspaceId,
          paths: ['sample.ts'],
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    const { stdout } = await execFileAsync('git', ['status', '--short'], { cwd: testDir });
    expect(stdout.trim()).toBe('');
  });

  it('discards untracked files', async () => {
    await writeFile(join(testDir, 'scratch.txt'), 'temporary\n');

    const result = await dispatch(
      {
        kind: 'command',
        id: 'git-discard-untracked',
        op: 'git.discard',
        args: {
          workspaceId,
          paths: ['scratch.txt'],
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    const { stdout } = await execFileAsync('git', ['status', '--short'], { cwd: testDir });
    expect(stdout).not.toContain('scratch.txt');
  });
});
