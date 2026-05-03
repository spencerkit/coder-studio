ALTER TABLE sessions DROP COLUMN resume_id;
ALTER TABLE sessions DROP COLUMN transcript_path;

DROP TABLE IF EXISTS hook_registrations;
