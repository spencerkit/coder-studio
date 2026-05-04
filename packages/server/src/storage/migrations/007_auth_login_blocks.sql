CREATE TABLE auth_login_blocks (
  ip TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL,
  first_failed_at INTEGER NOT NULL,
  last_failed_at INTEGER NOT NULL,
  blocked_until INTEGER
);

CREATE INDEX idx_auth_login_blocks_blocked_until ON auth_login_blocks(blocked_until);
