import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WorkspaceRepo } from "../../packages/server/src/storage/index.ts";

const WORKSPACE_ID = "ws-branch-switcher";

const [, , stateDir, workspacesRoot] = process.argv;

if (!stateDir || !workspacesRoot) {
  throw new Error("Usage: tsx seed-git-branch-switching-db.ts <state-dir> <workspaces-root>");
}

mkdirSync(stateDir, { recursive: true });
mkdirSync(workspacesRoot, { recursive: true });
rmSync(join(stateDir, "state"), { recursive: true, force: true });

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
  mkdirSync(workspacePath, { recursive: true });
  mkdirSync(join(workspacePath, "src"), { recursive: true });
  writeFileSync(join(workspacePath, "README.md"), `# ${dirName}\n`);
  writeFileSync(join(workspacePath, "src", "index.ts"), "export const ready = true;\n");

  runGit(["init", "--initial-branch=main"], workspacePath);
  runGit(["add", "."], workspacePath);
  runGit(["commit", "-m", "init"], workspacePath);

  return workspacePath;
};

const workspaceRepo = new WorkspaceRepo({
  filePath: join(stateDir, "state", "workspaces.json"),
});
const now = Date.now();
const workspacePath = createWorkspaceDir("branch-switcher-workspace");

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

console.log(
  JSON.stringify({
    stateDir,
    workspaceId: WORKSPACE_ID,
    workspacePath,
  })
);
