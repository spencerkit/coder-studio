-- Current database schema baseline

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  target_runtime TEXT NOT NULL,
  wsl_distro TEXT,
  opened_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  ui_state TEXT
);

CREATE TABLE IF NOT EXISTS terminals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  cwd TEXT NOT NULL,
  argv TEXT NOT NULL,
  env TEXT,
  title TEXT,
  cols INTEGER NOT NULL,
  rows INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  exit_code INTEGER
);

CREATE INDEX IF NOT EXISTS idx_terminals_workspace ON terminals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_terminals_kind ON terminals(workspace_id, kind);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  terminal_id TEXT NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  last_active_at INTEGER NOT NULL,
  completion_percent INTEGER,
  error_reason TEXT,
  archived BOOLEAN DEFAULT 0,
  title TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_terminal ON sessions(terminal_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_id_workspace ON sessions(id, workspace_id);

CREATE TABLE IF NOT EXISTS provider_configs (
  provider_id TEXT PRIMARY KEY,
  config TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_last_seen_at ON auth_sessions(last_seen_at);

CREATE TABLE IF NOT EXISTS supervisors (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  state TEXT NOT NULL,
  objective TEXT NOT NULL,
  evaluator_provider_id TEXT NOT NULL,
  last_cycle_at INTEGER,
  last_evaluated_turn_id TEXT,
  error_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id, workspace_id) REFERENCES sessions(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_supervisors_workspace ON supervisors(workspace_id);
CREATE INDEX IF NOT EXISTS idx_supervisors_session ON supervisors(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_supervisors_id_session ON supervisors(id, session_id);

CREATE TABLE IF NOT EXISTS supervisor_cycles (
  id TEXT PRIMARY KEY,
  supervisor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  evidence_source TEXT NOT NULL,
  objective TEXT NOT NULL,
  evaluator_provider_id TEXT NOT NULL,
  turn_id TEXT,
  progress INTEGER,
  result TEXT,
  injected_guidance TEXT,
  error_reason TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (supervisor_id, session_id) REFERENCES supervisors(id, session_id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_supervisor_cycles_supervisor ON supervisor_cycles(supervisor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supervisor_cycles_session ON supervisor_cycles(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_login_blocks (
  ip TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL,
  first_failed_at INTEGER NOT NULL,
  last_failed_at INTEGER NOT NULL,
  blocked_until INTEGER
);

CREATE INDEX IF NOT EXISTS idx_auth_login_blocks_blocked_until ON auth_login_blocks(blocked_until);

CREATE TABLE IF NOT EXISTS auth_login_failures (
  ip TEXT NOT NULL,
  failed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_login_failures_ip_failed_at ON auth_login_failures(ip, failed_at);
