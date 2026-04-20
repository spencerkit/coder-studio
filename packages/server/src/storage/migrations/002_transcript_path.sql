-- Adds transcript_path column for storing provider session log paths
-- (Claude: ~/.claude/projects/<hash>/<session>.jsonl,
--  Codex: ~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*-<uuid>.jsonl)

ALTER TABLE sessions ADD COLUMN transcript_path TEXT;
