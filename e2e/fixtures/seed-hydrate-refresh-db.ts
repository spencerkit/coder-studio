import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { closeDatabase, openDatabase } from '../../packages/server/src/storage/db.ts';

const WORKSPACE_ID = 'ws-hydrate-e2e';
const INTERRUPTED_SESSION_ID = 'sess-hydrate-interrupted';
const UNAVAILABLE_SESSION_ID = 'sess-hydrate-unavailable';
const INTERRUPTED_TERMINAL_ID = 'term-hydrate-interrupted';
const UNAVAILABLE_TERMINAL_ID = 'term-hydrate-unavailable';
const HYDRATED_PANE_LAYOUT = {
  id: 'root',
  type: 'split',
  direction: 'horizontal',
  children: [
    { id: 'left', type: 'leaf', sessionId: INTERRUPTED_SESSION_ID },
    { id: 'right', type: 'leaf', sessionId: UNAVAILABLE_SESSION_ID },
  ],
};

const [, , dbPath, workspacePath] = process.argv;

if (!dbPath || !workspacePath) {
  throw new Error('Usage: tsx seed-hydrate-refresh-db.ts <db-path> <workspace-path>');
}

mkdirSync(dirname(dbPath), { recursive: true });
rmSync(dbPath, { force: true });

const db = openDatabase(dbPath);
const now = Date.now();

try {
  db.prepare(
    `INSERT INTO workspaces (id, path, target_runtime, wsl_distro, opened_at, last_active_at, ui_state)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    WORKSPACE_ID,
    workspacePath,
    'native',
    null,
    now,
    now,
    JSON.stringify({
      leftPanelWidth: 280,
      bottomPanelHeight: 200,
      focusMode: false,
      activeSessionId: UNAVAILABLE_SESSION_ID,
      paneLayout: HYDRATED_PANE_LAYOUT,
    })
  );

  const insertTerminal = db.prepare(
    `INSERT INTO terminals (id, workspace_id, kind, cwd, argv, env, title, cols, rows, created_at, ended_at, exit_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  insertTerminal.run(
    INTERRUPTED_TERMINAL_ID,
    WORKSPACE_ID,
    'agent',
    workspacePath,
    '[]',
    null,
    'Claude',
    120,
    30,
    now,
    now,
    0
  );

  insertTerminal.run(
    UNAVAILABLE_TERMINAL_ID,
    WORKSPACE_ID,
    'agent',
    workspacePath,
    '[]',
    null,
    'Codex',
    120,
    30,
    now,
    now,
    0
  );

  const insertSession = db.prepare(
    `INSERT INTO sessions (
      id,
      workspace_id,
      terminal_id,
      provider_id,
      resume_id,
      capability,
      state,
      started_at,
      ended_at,
      last_active_at,
      completion_percent,
      error_reason,
      archived,
      transcript_path,
      title
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  insertSession.run(
    INTERRUPTED_SESSION_ID,
    WORKSPACE_ID,
    INTERRUPTED_TERMINAL_ID,
    'claude',
    'resume-hydrate-e2e',
    'full',
    'running',
    now,
    null,
    now,
    null,
    'Orphaned before restart',
    0,
    '/tmp/hydrate-interrupted.jsonl',
    'Resume me'
  );

  insertSession.run(
    UNAVAILABLE_SESSION_ID,
    WORKSPACE_ID,
    UNAVAILABLE_TERMINAL_ID,
    'codex',
    null,
    'full',
    'running',
    now,
    null,
    now,
    null,
    'Terminal missing after restart',
    0,
    '/tmp/hydrate-unavailable.jsonl',
    'Unavailable'
  );

  console.log(
    JSON.stringify({
      dbPath,
      workspaceId: WORKSPACE_ID,
      sessions: [INTERRUPTED_SESSION_ID, UNAVAILABLE_SESSION_ID],
    })
  );
} finally {
  closeDatabase(db);
}
