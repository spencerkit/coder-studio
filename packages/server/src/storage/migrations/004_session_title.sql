-- Session title is derived from the first user-submitted instruction and is
-- assigned once, never overwritten (see SessionManager.onTerminalInput).
-- NULL means "no input submitted yet"; the UI falls back to SESSION-XX.

ALTER TABLE sessions ADD COLUMN title TEXT;
