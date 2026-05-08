import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { closeDatabase, openDatabase } from "../../packages/server/src/storage/db.ts";

const WORKSPACE_ID = "ws-git-auto-fetch";
const AUTO_FETCH_PERIOD_SEC = 1;
const WORKSPACE_DIR_NAME = "git-auto-fetch-workspace";
const REMOTE_DIR_NAME = "git-auto-fetch-remote.git";
const CONTRIBUTOR_DIR_NAME = "git-auto-fetch-contributor";

const [, , dbPath, workspacesRoot] = process.argv;

if (!dbPath || !workspacesRoot) {
  throw new Error("Usage: tsx seed-git-auto-fetch-db.ts <db-path> <workspaces-root>");
}

const sandboxRoot = dirname(dbPath);
const remotePath = join(sandboxRoot, REMOTE_DIR_NAME);
const contributorPath = join(sandboxRoot, CONTRIBUTOR_DIR_NAME);

mkdirSync(dirname(dbPath), { recursive: true });
mkdirSync(workspacesRoot, { recursive: true });
rmSync(dbPath, { force: true });
rmSync(remotePath, { recursive: true, force: true });
rmSync(contributorPath, { recursive: true, force: true });

const runGit = (args: string[], cwd: string) => {
  execFileSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Coder Studio E2E",
      GIT_AUTHOR_EMAIL: "e2e@coder-studio.test",
      GIT_COMMITTER_NAME: "Coder Studio E2E",
      GIT_COMMITTER_EMAIL: "e2e@coder-studio.test",
    },
    stdio: "pipe",
  });
};

const createWorkspaceDir = (dirName: string): string => {
  const workspacePath = join(workspacesRoot, dirName);
  rmSync(workspacePath, { recursive: true, force: true });
  mkdirSync(workspacePath, { recursive: true });
  mkdirSync(join(workspacePath, "src"), { recursive: true });
  writeFileSync(join(workspacePath, "README.md"), `# ${dirName}\n`);
  writeFileSync(join(workspacePath, "src", "index.ts"), "export const ready = true;\n");

  runGit(["init", "--initial-branch=main"], workspacePath);
  runGit(["add", "."], workspacePath);
  runGit(["commit", "-m", "init"], workspacePath);

  return workspacePath;
};

const workspacePath = createWorkspaceDir(WORKSPACE_DIR_NAME);
runGit(["init", "--bare", remotePath], sandboxRoot);
runGit(["remote", "add", "origin", remotePath], workspacePath);
runGit(["push", "-u", "origin", "main"], workspacePath);
runGit(["clone", remotePath, contributorPath], sandboxRoot);
runGit(["config", "user.name", "Coder Studio E2E"], contributorPath);
runGit(["config", "user.email", "e2e@coder-studio.test"], contributorPath);

const db = openDatabase(dbPath);
const now = Date.now();

try {
  db.prepare(
    `INSERT INTO workspaces (id, path, target_runtime, wsl_distro, opened_at, last_active_at, ui_state)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    WORKSPACE_ID,
    workspacePath,
    "native",
    null,
    now - 10_000,
    now,
    JSON.stringify({
      leftPanelWidth: 280,
      bottomPanelHeight: 200,
      focusMode: false,
    })
  );

  db.prepare("INSERT INTO user_settings (key, value) VALUES (?, ?)").run(
    "git.autofetchPeriodSec",
    JSON.stringify(AUTO_FETCH_PERIOD_SEC)
  );

  console.log(
    JSON.stringify({
      dbPath,
      workspaceId: WORKSPACE_ID,
      workspacePath,
      remotePath,
      contributorPath,
      autoFetchPeriodSec: AUTO_FETCH_PERIOD_SEC,
    })
  );
} finally {
  closeDatabase(db);
}
