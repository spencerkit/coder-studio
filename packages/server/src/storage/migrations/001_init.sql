-- Phase 1 Schema

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  target_runtime TEXT NOT NULL,
  wsl_distro TEXT,
  opened_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  ui_state TEXT  -- JSON: panel widths, collapse states, etc.
);

CREATE TABLE terminals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                  -- 'agent' | 'shell'
  cwd TEXT NOT NULL,
  argv TEXT NOT NULL,                  -- JSON array
  env TEXT,                            -- JSON object
  title TEXT,
  cols INTEGER NOT NULL,
  rows INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  exit_code INTEGER
);

CREATE INDEX idx_terminals_workspace ON terminals(workspace_id);
CREATE INDEX idx_terminals_kind ON terminals(workspace_id, kind);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  terminal_id TEXT NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  resume_id TEXT,
  capability TEXT NOT NULL,            -- 'full' | 'limited' | 'unsupported'
  state TEXT NOT NULL,                 -- Session state enum
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  last_active_at INTEGER NOT NULL,
  completion_percent INTEGER,
  error_reason TEXT,
  archived BOOLEAN DEFAULT 0
);

CREATE INDEX idx_sessions_workspace ON sessions(workspace_id);
CREATE UNIQUE INDEX idx_sessions_terminal ON sessions(terminal_id);  -- 1:1 relationship

CREATE TABLE provider_configs (
  provider_id TEXT PRIMARY KEY,
  config TEXT NOT NULL  -- JSON blob
);

CREATE TABLE user_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL  -- JSON
);

CREATE TABLE hook_registrations (
  provider_id TEXT PRIMARY KEY,
  marker_version TEXT NOT NULL,
  injected_at INTEGER NOT NULL,
  global_config_path TEXT NOT NULL,
  last_check_at INTEGER NOT NULL,
  last_status TEXT NOT NULL,  -- 'ok' | 'error'
  last_error TEXT
);
