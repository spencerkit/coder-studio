import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SettingsRepo, WorkspaceRepo } from "../../packages/server/src/storage/index.ts";

const WORKSPACE_ID = "ws-git-auto-fetch";
const AUTO_FETCH_PERIOD_SEC = 1;
const WORKSPACE_DIR_NAME = "git-auto-fetch-workspace";
const REMOTE_DIR_NAME = "git-auto-fetch-remote.git";
const CONTRIBUTOR_DIR_NAME = "git-auto-fetch-contributor";

const [, , stateDir, workspacesRoot] = process.argv;

if (!stateDir || !workspacesRoot) {
  throw new Error("Usage: tsx seed-git-auto-fetch-db.ts <state-dir> <workspaces-root>");
}

const sandboxRoot = dirname(stateDir);
const remotePath = join(sandboxRoot, REMOTE_DIR_NAME);
const contributorPath = join(sandboxRoot, CONTRIBUTOR_DIR_NAME);

mkdirSync(stateDir, { recursive: true });
mkdirSync(workspacesRoot, { recursive: true });
rmSync(join(stateDir, "state"), { recursive: true, force: true });
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

const now = Date.now();
const workspaceRepo = new WorkspaceRepo({
  filePath: join(stateDir, "state", "workspaces.json"),
});
const settingsRepo = new SettingsRepo({
  filePath: join(stateDir, "state", "settings.json"),
});

workspaceRepo.create({
  id: WORKSPACE_ID,
  path: workspacePath,
  targetRuntime: "native",
  openedAt: now - 10_000,
  lastActiveAt: now,
  uiState: {
    leftPanelWidth: 280,
    bottomPanelHeight: 200,
    focusMode: false,
  },
});

settingsRepo.set("git.autofetchPeriodSec", AUTO_FETCH_PERIOD_SEC);

console.log(
  JSON.stringify({
    stateDir,
    workspaceId: WORKSPACE_ID,
    workspacePath,
    remotePath,
    contributorPath,
    autoFetchPeriodSec: AUTO_FETCH_PERIOD_SEC,
  })
);
