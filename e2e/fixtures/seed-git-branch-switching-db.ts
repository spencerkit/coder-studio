import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { closeDatabase, openDatabase } from '../../packages/server/src/storage/db.ts';

const WORKSPACE_ID = 'ws-branch-switcher';

const [, , dbPath, workspacesRoot] = process.argv;

if (!dbPath || !workspacesRoot) {
  throw new Error('Usage: tsx seed-git-branch-switching-db.ts <db-path> <workspaces-root>');
}

mkdirSync(dirname(dbPath), { recursive: true });
mkdirSync(workspacesRoot, { recursive: true });
rmSync(dbPath, { force: true });

const runGit = (args: string[], cwd: string) => {
  execFileSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Coder Studio E2E',
      GIT_AUTHOR_EMAIL: 'e2e@coder-studio.test',
      GIT_COMMITTER_NAME: 'Coder Studio E2E',
      GIT_COMMITTER_EMAIL: 'e2e@coder-studio.test',
    },
    stdio: 'pipe',
  });
};

const createWorkspaceDir = (dirName: string): string => {
  const workspacePath = join(workspacesRoot, dirName);
  mkdirSync(workspacePath, { recursive: true });
  mkdirSync(join(workspacePath, 'src'), { recursive: true });
  writeFileSync(join(workspacePath, 'README.md'), `# ${dirName}\n`);
  writeFileSync(join(workspacePath, 'src', 'index.ts'), 'export const ready = true;\n');

  runGit(['init', '--initial-branch=main'], workspacePath);
  runGit(['add', '.'], workspacePath);
  runGit(['commit', '-m', 'init'], workspacePath);

  return workspacePath;
};

const db = openDatabase(dbPath);
const now = Date.now();

try {
  const workspacePath = createWorkspaceDir('branch-switcher-workspace');

  const insertWorkspace = db.prepare(
    `INSERT INTO workspaces (id, path, target_runtime, wsl_distro, opened_at, last_active_at, ui_state)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  insertWorkspace.run(
    WORKSPACE_ID,
    workspacePath,
    'native',
    null,
    now - 10_000,
    now,
    JSON.stringify({
      leftPanelWidth: 280,
      bottomPanelHeight: 200,
      focusMode: false,
    })
  );

  console.log(
    JSON.stringify({
      dbPath,
      workspaceId: WORKSPACE_ID,
      workspacePath,
    })
  );
} finally {
  closeDatabase(db);
}
