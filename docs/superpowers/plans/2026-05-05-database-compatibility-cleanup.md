# Database Compatibility Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove redundant historical database compatibility logic and converge server storage initialization to a single current-schema baseline.

**Architecture:** Replace the current incremental migration chain with one authoritative latest-schema snapshot, simplify `openDatabase()` so it initializes and validates only the current schema, and delete upgrade-path tests/fixtures that only exist to support never-shipped legacy databases. Keep current business tables and repository behavior intact.

**Tech Stack:** TypeScript, Node.js `node:sqlite`, Vitest, SQL schema files, Playwright E2E fixtures, pnpm workspaces.

---

## File Structure

- Modify: `packages/server/src/storage/db.ts` — remove `_migrations` workflow, initialize current schema directly, add legacy-schema detection with actionable errors.
- Replace: `packages/server/src/storage/migrations/001_init.sql` — redefine as the single latest-schema snapshot.
- Delete: `packages/server/src/storage/migrations/002_transcript_path.sql` — legacy upgrade-only migration.
- Delete: `packages/server/src/storage/migrations/003_supervisors.sql` — merge into latest baseline.
- Delete: `packages/server/src/storage/migrations/004_session_title.sql` — merge into latest baseline.
- Delete: `packages/server/src/storage/migrations/005_auth_sessions.sql` — merge into latest baseline.
- Delete: `packages/server/src/storage/migrations/006_drop_legacy_hook_session_columns.sql` — legacy cleanup migration.
- Delete: `packages/server/src/storage/migrations/007_auth_login_blocks.sql` — merge into latest baseline.
- Delete: `packages/server/src/storage/migrations/008_auth_login_failures.sql` — merge into latest baseline and drop backfill logic.
- Modify: `packages/server/src/storage/db.test.ts` — rewrite around current-schema initialization and legacy detection.
- Modify: `packages/server/src/__tests__/db.test.ts` — remove `_migrations` assertions, keep current DB invariants.
- Modify: `e2e/fixtures/seed-hydrate-refresh-db.ts` — stop inserting removed legacy session columns.
- Verify: `packages/server/src/storage/repositories/*.ts` — ensure baseline schema still satisfies repository SQL.

---

### Task 1: Freeze the Latest Schema Baseline

**Files:**
- Modify: `packages/server/src/storage/migrations/001_init.sql`
- Delete: `packages/server/src/storage/migrations/002_transcript_path.sql`
- Delete: `packages/server/src/storage/migrations/003_supervisors.sql`
- Delete: `packages/server/src/storage/migrations/004_session_title.sql`
- Delete: `packages/server/src/storage/migrations/005_auth_sessions.sql`
- Delete: `packages/server/src/storage/migrations/006_drop_legacy_hook_session_columns.sql`
- Delete: `packages/server/src/storage/migrations/007_auth_login_blocks.sql`
- Delete: `packages/server/src/storage/migrations/008_auth_login_failures.sql`
- Test: `packages/server/src/storage/db.test.ts`

- [ ] **Step 1: Write the failing schema-shape test**

Add assertions in `packages/server/src/storage/db.test.ts` that a fresh DB contains:

- tables: `workspaces`, `terminals`, `sessions`, `provider_configs`, `user_settings`, `auth_sessions`, `supervisors`, `supervisor_cycles`, `auth_login_blocks`, `auth_login_failures`
- no table: `hook_registrations`
- no `sessions` columns: `resume_id`, `transcript_path`
- yes `sessions` column: `title`

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coder-studio/server vitest run src/storage/db.test.ts -t "current schema baseline"`

Expected: FAIL because the current migration chain still creates `_migrations`-driven state and the baseline file still contains legacy columns / tables.

- [ ] **Step 3: Replace `001_init.sql` with the authoritative latest schema**

Define one schema file that directly creates:

- `workspaces`
- `terminals`
- `sessions` without `resume_id` / `transcript_path`, with `title`
- `provider_configs`
- `user_settings`
- `auth_sessions`
- `supervisors`
- `supervisor_cycles`
- `auth_login_blocks`
- `auth_login_failures`
- all currently required indexes, including:
  - `idx_terminals_workspace`
  - `idx_terminals_kind`
  - `idx_sessions_workspace`
  - `idx_sessions_terminal`
  - `idx_sessions_id_workspace`
  - `idx_auth_sessions_last_seen_at`
  - `idx_supervisors_workspace`
  - `idx_supervisors_session`
  - `idx_supervisors_id_session`
  - `idx_supervisor_cycles_supervisor`
  - `idx_supervisor_cycles_session`
  - `idx_auth_login_blocks_blocked_until`
  - `idx_auth_login_failures_ip_failed_at`

The resulting SQL must not mention:

- `resume_id`
- `transcript_path`
- `hook_registrations`
- migration backfills

- [ ] **Step 4: Delete the obsolete incremental migration files**

Delete:

```text
packages/server/src/storage/migrations/002_transcript_path.sql
packages/server/src/storage/migrations/003_supervisors.sql
packages/server/src/storage/migrations/004_session_title.sql
packages/server/src/storage/migrations/005_auth_sessions.sql
packages/server/src/storage/migrations/006_drop_legacy_hook_session_columns.sql
packages/server/src/storage/migrations/007_auth_login_blocks.sql
packages/server/src/storage/migrations/008_auth_login_failures.sql
```

- [ ] **Step 5: Run the schema test to verify it passes**

Run: `pnpm --filter @coder-studio/server vitest run src/storage/db.test.ts -t "current schema baseline"`

Expected: PASS with the fresh DB matching the final schema directly.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/storage/migrations/001_init.sql packages/server/src/storage/db.test.ts
git rm packages/server/src/storage/migrations/002_transcript_path.sql packages/server/src/storage/migrations/003_supervisors.sql packages/server/src/storage/migrations/004_session_title.sql packages/server/src/storage/migrations/005_auth_sessions.sql packages/server/src/storage/migrations/006_drop_legacy_hook_session_columns.sql packages/server/src/storage/migrations/007_auth_login_blocks.sql packages/server/src/storage/migrations/008_auth_login_failures.sql
git commit -m "refactor(storage): collapse database schema to latest baseline"
```

### Task 2: Remove Migration Machinery and Add Legacy Detection

**Files:**
- Modify: `packages/server/src/storage/db.ts`
- Test: `packages/server/src/storage/db.test.ts`
- Test: `packages/server/src/__tests__/db.test.ts`

- [ ] **Step 1: Write failing tests for no-migration initialization and legacy DB rejection**

Add tests covering:

- fresh DB open does not create `_migrations`
- opening a DB whose `sessions` table still has `resume_id` fails with a clear error
- opening a DB with `hook_registrations` fails with a clear error

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @coder-studio/server vitest run src/storage/db.test.ts src/__tests__/db.test.ts`

Expected: FAIL because `db.ts` still creates `_migrations`, scans files, and accepts legacy structures.

- [ ] **Step 3: Rewrite `db.ts` initialization flow**

Change `packages/server/src/storage/db.ts` so that it:

- reads one authoritative schema file
- executes it directly inside a transaction
- removes:
  - `MIGRATION_PATTERN`
  - `discoverMigrations()`
  - `_migrations` table creation
  - per-file migration application loop
- adds a schema validation step that inspects `sqlite_master` / `PRAGMA table_info`
- throws an actionable error if legacy markers are present

Recommended error content:

```ts
throw new Error(
  `Legacy database schema detected at ${dbPath}. This build no longer supports automatic database upgrades. Delete the local database file and restart.`
);
```

- [ ] **Step 4: Update DB unit tests to the new contract**

Rewrite tests so they assert:

- `journal_mode = wal`
- `foreign_keys = 1`
- `integrity_check = ok`
- no `_migrations` table
- current required tables / indexes exist
- repeated open of a file DB remains stable
- foreign key and cascade behavior still work

Delete tests that assert:

- `001_init` is recorded in `_migrations`
- migration order
- migration idempotence via timestamps

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @coder-studio/server vitest run src/storage/db.test.ts src/__tests__/db.test.ts`

Expected: PASS with current-schema initialization and explicit rejection of legacy DB structures.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/storage/db.ts packages/server/src/storage/db.test.ts packages/server/src/__tests__/db.test.ts
git commit -m "refactor(storage): drop migration runner and reject legacy schemas"
```

### Task 3: Clean Legacy Upgrade Tests and Fixtures

**Files:**
- Modify: `packages/server/src/storage/db.test.ts`
- Modify: `e2e/fixtures/seed-hydrate-refresh-db.ts`
- Verify: `e2e/specs/session-hydrate-refresh.spec.ts`

- [ ] **Step 1: Write the failing fixture-sanity test or assertion**

Add either:

- a unit assertion in `src/storage/db.test.ts` that no test fixture path still depends on legacy `sessions` columns, or
- a targeted E2E fixture smoke test that inserts current-schema session rows only

The minimum requirement is to make legacy column usage visible in CI.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coder-studio/server vitest run src/storage/db.test.ts`

Expected: FAIL or remain blocked until the legacy fixture inserts are removed.

- [ ] **Step 3: Rewrite the hydrate-refresh seed to current schema**

Update `e2e/fixtures/seed-hydrate-refresh-db.ts` so `INSERT INTO sessions` only uses current columns:

- keep: `id`, `workspace_id`, `terminal_id`, `provider_id`, `capability`, `state`, `started_at`, `ended_at`, `last_active_at`, `completion_percent`, `error_reason`, `archived`, `title`
- remove: `resume_id`, `transcript_path`

- [ ] **Step 4: Remove legacy upgrade-only tests**

Delete or replace tests in `packages/server/src/storage/db.test.ts` that cover:

- upgrading a pre-006 database
- dropping old session columns via migration 006
- backfilling failure rows via migration 008

Replace them with current-schema assertions only if equivalent coverage is still needed for active behavior.

- [ ] **Step 5: Run the targeted tests**

Run: `pnpm --filter @coder-studio/server vitest run src/storage/db.test.ts`

Expected: PASS with no references to legacy DB upgrades.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/storage/db.test.ts e2e/fixtures/seed-hydrate-refresh-db.ts
git commit -m "test(storage): remove legacy database upgrade coverage"
```

### Task 4: Verify Repository and Integration Compatibility on the New Baseline

**Files:**
- Verify: `packages/server/src/storage/repositories/session-repo.ts`
- Verify: `packages/server/src/storage/repositories/auth-login-block-repo.ts`
- Verify: `packages/server/src/storage/repositories/supervisor-repo.ts`
- Verify: `packages/server/src/storage/repositories/supervisor-cycle-repo.ts`
- Test: `packages/server/src/__tests__/session-repo.test.ts`
- Test: `packages/server/src/__tests__/terminal-repo.test.ts`
- Test: `packages/server/src/__tests__/workspace-repo.test.ts`
- Test: `packages/server/src/__tests__/supervisor-repo.test.ts`
- Test: `packages/server/src/auth/plugin.test.ts`
- Test: `packages/server/src/__tests__/session-hydrate-restart.test.ts`

- [ ] **Step 1: Run the targeted repository and integration suite**

Run:

```bash
pnpm --filter @coder-studio/server vitest run src/__tests__/session-repo.test.ts src/__tests__/terminal-repo.test.ts src/__tests__/workspace-repo.test.ts src/__tests__/supervisor-repo.test.ts src/auth/plugin.test.ts src/__tests__/session-hydrate-restart.test.ts
```

Expected: Any failures should point to assumptions that still rely on removed legacy columns or deleted migration behavior.

- [ ] **Step 2: Apply the minimal fixes required by the new baseline**

If failures occur, fix only the affected tests or schema assumptions. Do not reintroduce migration machinery or legacy columns.

- [ ] **Step 3: Run the same suite again to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/server vitest run src/__tests__/session-repo.test.ts src/__tests__/terminal-repo.test.ts src/__tests__/workspace-repo.test.ts src/__tests__/supervisor-repo.test.ts src/auth/plugin.test.ts src/__tests__/session-hydrate-restart.test.ts
```

Expected: PASS on the latest-schema baseline.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src e2e/fixtures
git commit -m "test(server): validate repositories against latest schema baseline"
```

### Task 5: Final Verification

**Files:**
- Verify: `packages/server/src/storage/db.ts`
- Verify: `packages/server/src/storage/migrations/001_init.sql`
- Verify: `packages/server/src/storage/db.test.ts`
- Verify: `packages/server/src/__tests__/db.test.ts`
- Verify: `e2e/fixtures/seed-hydrate-refresh-db.ts`

- [ ] **Step 1: Run the full targeted server test slice**

Run:

```bash
pnpm --filter @coder-studio/server vitest run src/storage/db.test.ts src/__tests__/db.test.ts src/__tests__/session-repo.test.ts src/__tests__/terminal-repo.test.ts src/__tests__/workspace-repo.test.ts src/__tests__/supervisor-repo.test.ts src/auth/plugin.test.ts src/__tests__/session-hydrate-restart.test.ts
```

Expected: PASS.

- [ ] **Step 2: Search for forbidden legacy storage markers**

Run:

```bash
rg -n "resume_id|transcript_path|hook_registrations|_migrations|002_transcript_path|006_drop_legacy_hook_session_columns|008_auth_login_failures" packages/server e2e
```

Expected:

- no matches for `resume_id`
- no matches for `transcript_path`
- no matches for `hook_registrations`
- no matches for `_migrations`
- no matches for deleted migration filenames
- allowed matches only in historical docs if those docs are intentionally untouched

- [ ] **Step 3: Review the final diff for scope control**

Run:

```bash
git diff -- packages/server/src/storage packages/server/src/__tests__/db.test.ts e2e/fixtures/seed-hydrate-refresh-db.ts docs/superpowers/specs/2026-05-05-database-compatibility-cleanup-design.md docs/superpowers/plans/2026-05-05-database-compatibility-cleanup.md
```

Expected: Diff contains only storage-baseline cleanup, test rewrites, and the agreed docs.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/storage packages/server/src/__tests__/db.test.ts e2e/fixtures/seed-hydrate-refresh-db.ts docs/superpowers/specs/2026-05-05-database-compatibility-cleanup-design.md docs/superpowers/plans/2026-05-05-database-compatibility-cleanup.md
git commit -m "refactor(storage): remove redundant database compatibility layer"
```

---

## Self-Review

- Spec coverage: The plan covers schema baseline creation, initialization rewrite, legacy DB rejection, test cleanup, fixture cleanup, and repository verification.
- Placeholder scan: No `TODO`/`TBD` placeholders remain; each task names exact files, commands, and expected outcomes.
- Type consistency: The plan consistently treats `sessions.title` as current, and `resume_id` / `transcript_path` / `hook_registrations` / `_migrations` as forbidden legacy structures.
