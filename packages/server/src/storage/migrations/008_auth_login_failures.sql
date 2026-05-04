CREATE TABLE auth_login_failures (
  ip TEXT NOT NULL,
  failed_at INTEGER NOT NULL
);

WITH RECURSIVE backfill(ip, first_failed_at, last_failed_at, failed_count, idx) AS (
  SELECT ip, first_failed_at, last_failed_at, failed_count, 0
  FROM auth_login_blocks
  WHERE failed_count > 0

  UNION ALL

  SELECT ip, first_failed_at, last_failed_at, failed_count, idx + 1
  FROM backfill
  WHERE idx + 1 < failed_count
)
INSERT INTO auth_login_failures (ip, failed_at)
SELECT
  ip,
  CASE
    WHEN failed_count = 1 THEN last_failed_at
    WHEN last_failed_at <= first_failed_at THEN last_failed_at
    ELSE first_failed_at + ((last_failed_at - first_failed_at) * idx) / (failed_count - 1)
  END AS failed_at
FROM backfill;

CREATE INDEX idx_auth_login_failures_ip_failed_at ON auth_login_failures(ip, failed_at);
