import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SettingsRepo, WorkspaceRepo } from "../../packages/server/src/storage/index.ts";

const RECENT_WORKSPACE_ID = "ws-history-recent";
const OLDER_WORKSPACE_ID = "ws-history-older";

const [, , stateDir, workspacesRoot] = process.argv;

if (!stateDir || !workspacesRoot) {
  throw new Error("Usage: tsx seed-workspace-route-history-db.ts <state-dir> <workspaces-root>");
}

mkdirSync(stateDir, { recursive: true });
mkdirSync(workspacesRoot, { recursive: true });
rmSync(join(stateDir, "state"), { recursive: true, force: true });

function createWorkspaceDir(dirName: string): string {
  const workspacePath = join(workspacesRoot, dirName);
  mkdirSync(join(workspacePath, ".git"), { recursive: true });
  writeFileSync(join(workspacePath, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(workspacePath, "README.md"), `# ${dirName}\n`);
  return workspacePath;
}

const workspaceRepo = new WorkspaceRepo({
  filePath: join(stateDir, "state", "workspaces.json"),
});
const settingsRepo = new SettingsRepo({
  filePath: join(stateDir, "state", "settings.json"),
});
const now = Date.now();
const recentPath = createWorkspaceDir("recent-workspace");
const olderPath = createWorkspaceDir("older-workspace");

workspaceRepo.create({
  id: RECENT_WORKSPACE_ID,
  path: recentPath,
  targetRuntime: "native",
  openedAt: now - 10_000,
  lastActiveAt: now,
  uiState: {
    leftPanelWidth: 280,
    bottomPanelHeight: 200,
    focusMode: false,
  },
});

workspaceRepo.create({
  id: OLDER_WORKSPACE_ID,
  path: olderPath,
  targetRuntime: "native",
  openedAt: now - 20_000,
  lastActiveAt: now - 5_000,
  uiState: {
    leftPanelWidth: 280,
    bottomPanelHeight: 200,
    focusMode: false,
  },
});

settingsRepo.set("workspace.lastViewedTarget", {
  workspaceId: OLDER_WORKSPACE_ID,
  updatedAt: now,
});

console.log(
  JSON.stringify({
    stateDir,
    workspaceIds: [RECENT_WORKSPACE_ID, OLDER_WORKSPACE_ID],
    workspacePaths: [recentPath, olderPath],
  })
);
