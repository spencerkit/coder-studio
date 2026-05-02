CREATE TABLE auth_sessions (
  token TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX idx_auth_sessions_last_seen_at ON auth_sessions(last_seen_at);
