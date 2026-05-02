/**
 * Tests for file system commands.
 */

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

import '../commands/file.js';
import '../commands/workspace.js';

const execFileAsync = promisify(execFile);

describe('File Commands', () => {
  let testDir: string;
  let ctx: CommandContext;
  let workspaceMgr: WorkspaceManager;
  let eventBus: EventBus;
  let db: ReturnType<typeof openDatabase>;
  let workspaceId: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `file-command-test-${Date.now()}`);
    await mkdir(testDir);

    await execFileAsync('git', ['init'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });

    await writeFile(join(testDir, 'README.md'), 'readme\n');
    await writeFile(join(testDir, 'src.ts'), 'export const src = true;\n');
    await mkdir(join(testDir, 'docs'));
    await writeFile(join(testDir, 'docs', 'src-note.md'), 'note\n');
    await writeFile(join(testDir, 'docs', 'readme-copy.md'), 'copy\n');
    await writeFile(join(testDir, 'docs', 'readme-again.md'), 'again\n');
    await writeFile(join(testDir, 'docs', 'README-notes.md'), 'notes\n');
    await writeFile(join(testDir, 'docs', 'a-readme.md'), 'a\n');
    await writeFile(join(testDir, 'docs', 'b-readme.md'), 'b\n');
    await writeFile(join(testDir, 'docs', 'c-readme.md'), 'c\n');
    await writeFile(join(testDir, 'docs', 'd-readme.md'), 'd\n');
    await writeFile(join(testDir, 'docs', 'e-readme.md'), 'e\n');
    await writeFile(join(testDir, 'docs', 'f-readme.md'), 'f\n');
    await writeFile(join(testDir, 'docs', 'g-readme.md'), 'g\n');

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
      hooksMgr: {},
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

  it('searches files across the workspace by filename with a default limit of 10', async () => {
    const result = await dispatch(
      {
        kind: 'command',
        id: 'file-search-1',
        op: 'file.search',
        args: {
          workspaceId,
          query: 'readme',
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    const files = (result.data as { files: Array<{ path: string }> }).files;
    expect(files).toHaveLength(10);
    expect(files.every((item) => item.path.toLowerCase().endsWith('.md'))).toBe(true);
    expect(files.some((item) => item.path === 'README.md')).toBe(true);
    expect(files.some((item) => item.path === 'src.ts')).toBe(false);
  });

  it('matches by filename only and ignores directory names', async () => {
    const result = await dispatch(
      {
        kind: 'command',
        id: 'file-search-2',
        op: 'file.search',
        args: {
          workspaceId,
          query: 'docs',
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    const files = (result.data as { files: Array<{ path: string }> }).files;
    expect(files).toHaveLength(0);
  });
});
