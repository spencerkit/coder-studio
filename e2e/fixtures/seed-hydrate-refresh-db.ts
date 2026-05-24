import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  SessionRepo,
  SettingsRepo,
  TerminalRepo,
  WorkspaceRepo,
} from "../../packages/server/src/storage/index.ts";

const WORKSPACE_ID = "ws-hydrate-e2e";
const INTERRUPTED_SESSION_ID = "sess-hydrate-interrupted";
const UNAVAILABLE_SESSION_ID = "sess-hydrate-unavailable";
const INTERRUPTED_TERMINAL_ID = "term-hydrate-interrupted";
const UNAVAILABLE_TERMINAL_ID = "term-hydrate-unavailable";
const HYDRATED_PANE_LAYOUT = {
  id: "root",
  type: "split",
  direction: "horizontal",
  children: [
    { id: "left", type: "leaf", sessionId: INTERRUPTED_SESSION_ID },
    { id: "right", type: "leaf", sessionId: UNAVAILABLE_SESSION_ID },
  ],
};

const [, , stateDir, workspacePath] = process.argv;

if (!stateDir || !workspacePath) {
  throw new Error("Usage: tsx seed-hydrate-refresh-db.ts <state-dir> <workspace-path>");
}

mkdirSync(stateDir, { recursive: true });
rmSync(join(stateDir, "state"), { recursive: true, force: true });

const now = Date.now();
const workspaceRepo = new WorkspaceRepo({
  filePath: join(stateDir, "state", "workspaces.json"),
});
const terminalRepo = new TerminalRepo({
  filePath: join(stateDir, "state", "terminals.json"),
});
const sessionRepo = new SessionRepo({
  filePath: join(stateDir, "state", "sessions.json"),
});
const settingsRepo = new SettingsRepo({
  filePath: join(stateDir, "state", "settings.json"),
});

workspaceRepo.create({
  id: WORKSPACE_ID,
  path: workspacePath,
  targetRuntime: "native",
  openedAt: now,
  lastActiveAt: now,
  uiState: {
    leftPanelWidth: 280,
    bottomPanelHeight: 200,
    focusMode: false,
    activeSessionId: UNAVAILABLE_SESSION_ID,
    paneLayout: HYDRATED_PANE_LAYOUT,
  },
});

terminalRepo.insert({
  id: INTERRUPTED_TERMINAL_ID,
  workspaceId: WORKSPACE_ID,
  kind: "agent",
  cwd: workspacePath,
  argv: [],
  env: undefined,
  title: "Claude",
  cols: 120,
  rows: 30,
  alive: false,
  createdAt: now,
  endedAt: now,
  exitCode: 0,
});

terminalRepo.insert({
  id: UNAVAILABLE_TERMINAL_ID,
  workspaceId: WORKSPACE_ID,
  kind: "agent",
  cwd: workspacePath,
  argv: [],
  env: undefined,
  title: "Codex",
  cols: 120,
  rows: 30,
  alive: false,
  createdAt: now,
  endedAt: now,
  exitCode: 0,
});

sessionRepo.insert({
  id: INTERRUPTED_SESSION_ID,
  workspace_id: WORKSPACE_ID,
  terminal_id: INTERRUPTED_TERMINAL_ID,
  provider_id: "claude",
  capability: "full",
  state: "running",
  started_at: now,
  ended_at: null,
  last_active_at: now,
  completion_percent: null,
  error_reason: "Orphaned before restart",
  archived: 0,
  title: "Resume me",
  draft: null,
});

sessionRepo.insert({
  id: UNAVAILABLE_SESSION_ID,
  workspace_id: WORKSPACE_ID,
  terminal_id: UNAVAILABLE_TERMINAL_ID,
  provider_id: "codex",
  capability: "full",
  state: "running",
  started_at: now,
  ended_at: null,
  last_active_at: now,
  completion_percent: null,
  error_reason: "Terminal missing after restart",
  archived: 0,
  title: "Unavailable",
  draft: null,
});

settingsRepo.set("workspace.lastViewedTarget", {
  workspaceId: WORKSPACE_ID,
  sessionId: INTERRUPTED_SESSION_ID,
  updatedAt: now,
});

console.log(
  JSON.stringify({
    stateDir,
    workspaceId: WORKSPACE_ID,
    sessions: [INTERRUPTED_SESSION_ID, UNAVAILABLE_SESSION_ID],
  })
);
