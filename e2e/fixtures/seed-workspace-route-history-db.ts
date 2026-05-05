import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { closeDatabase, openDatabase } from "../../packages/server/src/storage/db.ts";

const RECENT_WORKSPACE_ID = "ws-history-recent";
const OLDER_WORKSPACE_ID = "ws-history-older";

const [, , dbPath, workspacesRoot] = process.argv;

if (!dbPath || !workspacesRoot) {
  throw new Error("Usage: tsx seed-workspace-route-history-db.ts <db-path> <workspaces-root>");
}

mkdirSync(dirname(dbPath), { recursive: true });
mkdirSync(workspacesRoot, { recursive: true });
rmSync(dbPath, { force: true });

const db = openDatabase(dbPath);
const now = Date.now();

function createWorkspaceDir(dirName: string): string {
  const workspacePath = join(workspacesRoot, dirName);
  mkdirSync(join(workspacePath, ".git"), { recursive: true });
  writeFileSync(join(workspacePath, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(workspacePath, "README.md"), `# ${dirName}\n`);
  return workspacePath;
}

try {
  const recentPath = createWorkspaceDir("recent-workspace");
  const olderPath = createWorkspaceDir("older-workspace");

  const insertWorkspace = db.prepare(
    `INSERT INTO workspaces (id, path, target_runtime, wsl_distro, opened_at, last_active_at, ui_state)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  insertWorkspace.run(
    RECENT_WORKSPACE_ID,
    recentPath,
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

  insertWorkspace.run(
    OLDER_WORKSPACE_ID,
    olderPath,
    "native",
    null,
    now - 20_000,
    now - 5_000,
    JSON.stringify({
      leftPanelWidth: 280,
      bottomPanelHeight: 200,
      focusMode: false,
    })
  );

  console.log(
    JSON.stringify({
      dbPath,
      workspaceIds: [RECENT_WORKSPACE_ID, OLDER_WORKSPACE_ID],
      workspacePaths: [recentPath, olderPath],
    })
  );
} finally {
  closeDatabase(db);
}
