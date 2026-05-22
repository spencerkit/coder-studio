# Supervisor Execution Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-supervisor model override, max-supervision cap, one-shot scheduled execution, in-flight pause support, global retry policy, and lightweight `v1 -> v2` database upgrade support without reintroducing the legacy migration chain.

**Architecture:** Keep the current latest-schema snapshot model, but add a narrow startup upgrader for known `v1 -> v2` databases plus a CLI/server preflight path for incompatible schemas. Extend supervisor persistence with new execution-policy fields, add attempt-level retry history, refactor the manager into cycle + retry execution flow, and upgrade the scheduler from event-only to event + one-shot timer. The web UI remains server-authoritative: supervisor dialog edits persisted session-level policy fields, while Settings owns global retry/evaluation timeout configuration.

**Tech Stack:** TypeScript, SQLite via `node:sqlite`, Vitest, existing WebSocket commands, Jotai, React, Fastify, PM2-backed CLI startup flow.

---

## File Structure

### Storage startup and compatibility
- Modify: `packages/server/src/storage/db.ts` — replace strict-only open path with `v1 -> v2` upgrade + incompatible-schema detection result handling.
- Modify: `packages/server/src/storage/migrations/001_init.sql` — update latest schema snapshot to include supervisor execution-policy columns and `supervisor_cycle_attempts`.
- Modify: `packages/server/src/storage/index.ts` — export any new repo types needed by tests/consumers.
- Create: `packages/server/src/storage/schema-version.ts` — helper constants plus exact current/v1 schema fingerprint utilities; do not rely on `PRAGMA user_version` alone because existing latest v1 databases were created before schema version stamping.
- Test: `packages/server/src/__tests__/db.test.ts`

### Supervisor domain and repositories
- Modify: `packages/core/src/domain/supervisor.ts` — new state/trigger/status types and persisted fields.
- Modify: `packages/server/src/storage/repositories/supervisor-repo.ts` — CRUD for new supervisor columns.
- Modify: `packages/server/src/storage/repositories/supervisor-cycle-repo.ts` — `scheduled`/`cancelled` compatibility plus cycle lookups as needed.
- Create: `packages/server/src/storage/repositories/supervisor-cycle-attempt-repo.ts` — attempt persistence.
- Test: `packages/server/src/__tests__/supervisor-repo.test.ts`

### Runtime execution
- Modify: `packages/server/src/supervisor/settings.ts` — add retry-related Settings keys and coercion helpers.
- Modify: `packages/server/src/supervisor/evaluator.ts` — optional per-supervisor model override, objective-complete detection helper.
- Modify: `packages/server/src/supervisor/scheduler.ts` — keep `turn_completed`, add one-shot time trigger support.
- Modify: `packages/server/src/supervisor/manager.ts` — state machine, retry loop, stopped state, attempt recording, in-flight pause/cancel.
- Test: `packages/server/src/supervisor/evaluator.test.ts`
- Test: `packages/server/src/supervisor/scheduler.test.ts`
- Test: `packages/server/src/__tests__/supervisor-manager.test.ts`

### Commands, server assembly, and CLI startup
- Modify: `packages/server/src/commands/supervisor.ts` — create/update payloads for model/cap/schedule fields.
- Modify: `packages/server/src/commands/settings.ts` — new global retry settings validation + persistence.
- Modify: `packages/server/src/server.ts` — integrate schema-open result handling if startup API changes.
- Modify: `packages/cli/src/server-runner.ts` — preflight DB compatibility before foreground server start.
- Modify: `packages/cli/src/cli.ts` — prompt to delete and rebuild on incompatible schema for foreground/background/open flows.
- Modify: `packages/cli/src/prompts.ts` — add reusable destructive confirmation helper if needed.
- Test: `packages/server/src/__tests__/supervisor-commands.test.ts`
- Test: `packages/server/src/commands/settings.test.ts`
- Test: `packages/cli/src/bin.test.ts`
- Test: `packages/cli/src/server-runner.test.ts`

### Web UI
- Modify: `packages/web/src/features/supervisor/actions/use-objective-dialog-state.ts` — dialog draft state for new supervisor fields and command payloads.
- Modify: `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx` — optional model input, max count input, one-shot schedule input.
- Modify: `packages/web/src/features/supervisor/views/shared/objective-dialog-content.test.tsx`
- Modify: `packages/web/src/features/supervisor/views/shared/supervisor-card.tsx` — render stopped state, stop reason, and new summary fields.
- Modify: `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx` — add retry settings inputs and payload wiring.
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/locales/en.json`

## Task 1: Add Lightweight Schema Versioning And `v1 -> v2` Upgrade

**Files:**
- Create: `packages/server/src/storage/schema-version.ts`
- Modify: `packages/server/src/storage/db.ts`
- Modify: `packages/server/src/storage/migrations/001_init.sql`
- Test: `packages/server/src/__tests__/db.test.ts`

- [ ] **Step 1: Write failing DB compatibility tests**

```ts
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../storage/db.js";

describe("database schema upgrade", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "db-upgrade-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("upgrades a known v1 supervisor schema to v2 on open even when user_version is unset", () => {
    const dbPath = join(tempDir, "upgrade.db");
    const seed = new DatabaseSync(dbPath);
    seed.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE workspaces (id TEXT PRIMARY KEY, path TEXT NOT NULL, target_runtime TEXT NOT NULL, opened_at INTEGER NOT NULL, last_active_at INTEGER NOT NULL, ui_state TEXT NOT NULL);
      CREATE TABLE terminals (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, kind TEXT NOT NULL, cwd TEXT NOT NULL, argv TEXT NOT NULL, cols INTEGER NOT NULL, rows INTEGER NOT NULL, created_at INTEGER NOT NULL, FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, terminal_id TEXT NOT NULL, provider_id TEXT NOT NULL, capability TEXT NOT NULL, state TEXT NOT NULL, started_at INTEGER NOT NULL, last_active_at INTEGER NOT NULL, FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE, FOREIGN KEY (terminal_id) REFERENCES terminals(id) ON DELETE CASCADE);
      CREATE TABLE user_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE supervisors (
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
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE supervisor_cycles (
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
        completed_at INTEGER
      );
    `);
    seed.close();

    const db = openDatabase(dbPath);
    const columns = db.prepare("PRAGMA table_info(supervisors)").all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "evaluator_model",
        "max_supervision_count",
        "completed_supervision_count",
        "scheduled_at",
        "stop_reason",
      ])
    );
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='supervisor_cycle_attempts'").get()
    ).toBeTruthy();
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(2);
  });

  it("throws a typed incompatible-schema error for unknown schemas", () => {
    const dbPath = join(tempDir, "unknown.db");
    const seed = new DatabaseSync(dbPath);
    seed.exec(`
      CREATE TABLE random_table (id TEXT PRIMARY KEY);
      PRAGMA user_version = 99;
    `);
    seed.close();

    expect(() => openDatabase(dbPath)).toThrow(/db_incompatible_schema/);
  });
});
```

- [ ] **Step 2: Run the DB test file and confirm the new cases fail**

Run: `pnpm vitest packages/server/src/__tests__/db.test.ts -t "database schema upgrade" --run`
Expected: FAIL because `openDatabase()` currently only initializes-or-rejects; it cannot recognize the known latest v1 schema structurally when `user_version` is still `0`, and it cannot produce the new typed incompatible-schema branch.

- [ ] **Step 3: Add a narrow schema version helper**

```ts
// packages/server/src/storage/schema-version.ts
import type { Database } from "./database.js";

export const CURRENT_SCHEMA_VERSION = 2;
export type KnownSchemaKind = "empty" | "current" | "v1" | "incompatible";

export function getUserVersion(db: Database): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version ?? 0;
}

export function setUserVersion(db: Database, version: number): void {
  db.exec(`PRAGMA user_version = ${version}`);
}

export function classifyKnownSchema(db: Database): KnownSchemaKind {
  // Build exact normalized sqlite_master signatures for the current schema
  // and the last shipped v1 schema snapshot, then compare the opened DB to
  // those fingerprints. Existing v1 databases may still have user_version=0,
  // so structure is the source of truth for upgrade eligibility.
  return "incompatible";
}
```

- [ ] **Step 4: Implement explicit `v1 -> v2` upgrade in `db.ts`**

```ts
function initializeOrUpgradeSchema(db: Database, dbPath: string): void {
  switch (classifyKnownSchema(db)) {
    case "empty":
      initializeSchema(db);
      return;
    case "current":
      if (getUserVersion(db) !== CURRENT_SCHEMA_VERSION) {
        setUserVersion(db, CURRENT_SCHEMA_VERSION);
      }
      return;
    case "v1":
      upgradeKnownV1Schema(db);
      return;
    default:
      throw createIncompatibleSchemaError(dbPath, "schema fingerprint is not a supported version");
  }
}

function upgradeKnownV1Schema(db: Database): void {
  withTransaction(db, () => {
    db.exec(`
      ALTER TABLE supervisors ADD COLUMN evaluator_model TEXT;
      ALTER TABLE supervisors ADD COLUMN max_supervision_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE supervisors ADD COLUMN completed_supervision_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE supervisors ADD COLUMN scheduled_at INTEGER;
      ALTER TABLE supervisors ADD COLUMN stop_reason TEXT;

      CREATE TABLE IF NOT EXISTS supervisor_cycle_attempts (
        id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL,
        attempt_index INTEGER NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        error_reason TEXT,
        provider_model TEXT,
        FOREIGN KEY (cycle_id) REFERENCES supervisor_cycles(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_supervisor_cycle_attempts_cycle
        ON supervisor_cycle_attempts(cycle_id, attempt_index ASC);
    `);
    setUserVersion(db, CURRENT_SCHEMA_VERSION);
  });
}
```

A known v1 database must be detected by exact schema fingerprint, not just `PRAGMA user_version = 1`.

- [ ] **Step 5: Return a typed incompatible-schema error instead of a generic mismatch**

```ts
throw new Error(
  JSON.stringify({
    code: "db_incompatible_schema",
    dbPath,
    message: `Database schema is incompatible at ${dbPath}: ${mismatch}`,
  })
);
```

Use a small helper that emits a stable string containing `db_incompatible_schema` so CLI-side detection can parse it reliably without introducing a broad error framework here.

- [ ] **Step 6: Update latest schema snapshot to v2**

```sql
CREATE TABLE IF NOT EXISTS supervisors (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  state TEXT NOT NULL,
  objective TEXT NOT NULL,
  evaluator_provider_id TEXT NOT NULL,
  evaluator_model TEXT,
  max_supervision_count INTEGER NOT NULL DEFAULT 0,
  completed_supervision_count INTEGER NOT NULL DEFAULT 0,
  scheduled_at INTEGER,
  stop_reason TEXT,
  last_cycle_at INTEGER,
  last_evaluated_turn_id TEXT,
  error_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id, workspace_id) REFERENCES sessions(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS supervisor_cycle_attempts (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  attempt_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  error_reason TEXT,
  provider_model TEXT,
  FOREIGN KEY (cycle_id) REFERENCES supervisor_cycles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_supervisor_cycle_attempts_cycle
  ON supervisor_cycle_attempts(cycle_id, attempt_index ASC);

PRAGMA user_version = 2;
```

- [ ] **Step 7: Re-run DB tests**

Run: `pnpm vitest packages/server/src/__tests__/db.test.ts --run`
Expected: PASS with new v2 schema coverage, v1 upgrade support, and typed incompatible-schema failure handling.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/storage/schema-version.ts packages/server/src/storage/db.ts packages/server/src/storage/migrations/001_init.sql packages/server/src/__tests__/db.test.ts
git commit -m "feat: add supervisor schema v2 upgrade"
```

## Task 2: Add CLI/Foreground Preflight And Delete-Rebuild Flow For Incompatible Schemas

**Files:**
- Modify: `packages/server/src/storage/db.ts`
- Modify: `packages/cli/src/server-runner.ts`
- Modify: `packages/cli/src/cli.ts`
- Modify: `packages/cli/src/prompts.ts`
- Test: `packages/cli/src/server-runner.test.ts`
- Test: `packages/cli/src/bin.test.ts`

- [ ] **Step 1: Write failing CLI tests for incompatible schema handling**

```ts
it("prompts to delete and rebuild when foreground startup sees an incompatible schema", async () => {
  startServer.mockRejectedValueOnce(
    new Error('{"code":"db_incompatible_schema","dbPath":"/tmp/legacy-state.sqlite","message":"schema mismatch"}')
  );
  confirmYesNo.mockResolvedValue(true);

  await expect(main(["serve", "--foreground"])).resolves.toBeUndefined();

  expect(confirmYesNo).toHaveBeenCalledWith(
    expect.stringContaining("Delete and rebuild the local database")
  );
});
```

Add a matching background `serve` or `open` test that verifies preflight runs before PM2 startup and avoids launching a crashing managed process.

- [ ] **Step 2: Run the CLI tests and confirm failure**

Run: `pnpm vitest packages/cli/src/bin.test.ts packages/cli/src/server-runner.test.ts --run`
Expected: FAIL because there is no incompatible-schema parsing, no delete-rebuild prompt, and no preflight path before managed startup.

- [ ] **Step 3: Add a reusable incompatible-schema detector**

```ts
export interface IncompatibleSchemaErrorPayload {
  code: "db_incompatible_schema";
  dbPath: string;
  message: string;
}

export function parseIncompatibleSchemaError(error: unknown): IncompatibleSchemaErrorPayload | null {
  if (!(error instanceof Error)) return null;
  try {
    const parsed = JSON.parse(error.message) as IncompatibleSchemaErrorPayload;
    return parsed.code === "db_incompatible_schema" ? parsed : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Add a server-side preflight helper in `server-runner.ts`**

```ts
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  closeDatabase,
  openDatabase,
  parseServerConfig,
} from "@coder-studio/server";

export const verifyLocalDatabaseCompatibility = (): void => {
  const config = parseServerConfig(buildServerConfig());
  if (config.dataDir !== ":memory:") {
    mkdirSync(dirname(config.dataDir), { recursive: true });
  }
  const db = openDatabase(config.dataDir);
  closeDatabase(db);
};
```

Keep this helper on the exact same saved-config resolution path as `startServer()`. Do not preflight a different DB location than the foreground server would open.

- [ ] **Step 5: Add delete-and-rebuild prompt flow in `cli.ts`**

```ts
async function handleIncompatibleSchema(error: unknown): Promise<boolean> {
  const payload = parseIncompatibleSchemaError(error);
  if (!payload) return false;

  const approved = isInteractiveSession()
    ? await confirmYesNo(
        `Local database is incompatible at ${payload.dbPath}. Delete and rebuild it? [y/N] `
      )
    : false;

  if (!approved) {
    throw new Error(payload.message);
  }

  rmSync(payload.dbPath, { force: true });
  return true;
}
```

For `serve --foreground`, catch startup failure, prompt once, delete DB if approved, then retry `startServer()` once.

For managed `serve` / `open`, call `verifyLocalDatabaseCompatibility()` before `startManagedServerFlow()`. If incompatible, run the same prompt/delete path before launching PM2.

- [ ] **Step 6: Re-run CLI tests**

Run: `pnpm vitest packages/cli/src/bin.test.ts packages/cli/src/server-runner.test.ts --run`
Expected: PASS with prompt-driven delete-rebuild flow in interactive mode and no managed-server launch before compatibility preflight.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/cli.ts packages/cli/src/prompts.ts packages/cli/src/server-runner.ts packages/cli/src/bin.test.ts packages/cli/src/server-runner.test.ts
git commit -m "feat: prompt to rebuild incompatible databases"
```

## Task 3: Extend Core Supervisor Types And Repositories

**Files:**
- Modify: `packages/core/src/domain/supervisor.ts`
- Modify: `packages/server/src/storage/repositories/supervisor-repo.ts`
- Modify: `packages/server/src/storage/repositories/supervisor-cycle-repo.ts`
- Create: `packages/server/src/storage/repositories/supervisor-cycle-attempt-repo.ts`
- Modify: `packages/server/src/storage/index.ts`
- Test: `packages/server/src/__tests__/supervisor-repo.test.ts`

- [ ] **Step 1: Write failing repository tests for new persisted fields and attempt rows**

```ts
it("persists evaluatorModel, maxSupervisionCount, completedSupervisionCount, scheduledAt, and stopReason", () => {
  supervisorRepo.create({
    id: "sup-1",
    sessionId: "sess-1",
    workspaceId: "ws-1",
    state: "idle",
    objective: "Ship supervisor execution policy",
    evaluatorProviderId: "codex",
    evaluatorModel: "o3",
    maxSupervisionCount: 8,
    completedSupervisionCount: 3,
    scheduledAt: 1_746_950_400_000,
    stopReason: undefined,
    createdAt: 10,
    updatedAt: 10,
  });

  expect(supervisorRepo.findById("sup-1")).toEqual(
    expect.objectContaining({
      evaluatorModel: "o3",
      maxSupervisionCount: 8,
      completedSupervisionCount: 3,
      scheduledAt: 1_746_950_400_000,
    })
  );
});

it("stores attempt history rows in order", () => {
  attemptRepo.create({
    id: "attempt-1",
    cycleId: "cycle-1",
    attemptIndex: 0,
    status: "failed",
    startedAt: 10,
    completedAt: 12,
    errorReason: "timeout",
    providerModel: "o3",
  });
  attemptRepo.create({
    id: "attempt-2",
    cycleId: "cycle-1",
    attemptIndex: 1,
    status: "completed",
    startedAt: 20,
    completedAt: 21,
    providerModel: "o3",
  });

  expect(attemptRepo.listForCycle("cycle-1").map((row) => row.attemptIndex)).toEqual([0, 1]);
});
```

- [ ] **Step 2: Run repository tests and confirm failure**

Run: `pnpm vitest packages/server/src/__tests__/supervisor-repo.test.ts --run`
Expected: FAIL because supervisor rows do not have the new columns and the attempt repo does not exist.

- [ ] **Step 3: Extend the core domain model**

```ts
export type SupervisorState =
  | "inactive"
  | "idle"
  | "evaluating"
  | "injecting"
  | "paused"
  | "error"
  | "stopped";

export type CycleStatus =
  | "queued"
  | "evaluating"
  | "completed"
  | "injected"
  | "failed"
  | "cancelled";

export type CycleTrigger = "turn_completed" | "manual" | "scheduled";

export interface Supervisor {
  id: string;
  sessionId: string;
  workspaceId: string;
  state: SupervisorState;
  objective: string;
  evaluatorProviderId: string;
  evaluatorModel?: string;
  maxSupervisionCount: number;
  completedSupervisionCount: number;
  scheduledAt?: number;
  stopReason?: "objective_complete" | "max_supervision_count_reached";
  cycles: SupervisorCycle[];
  lastCycleAt?: number;
  lastEvaluatedTurnId?: string;
  errorReason?: string;
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 4: Update supervisor repo row mapping and patches**

```ts
interface SupervisorRow {
  evaluator_model: string | null;
  max_supervision_count: number;
  completed_supervision_count: number;
  scheduled_at: number | null;
  stop_reason: string | null;
}

export interface NewSupervisor {
  evaluatorModel?: string;
  maxSupervisionCount: number;
  completedSupervisionCount: number;
  scheduledAt?: number;
  stopReason?: "objective_complete" | "max_supervision_count_reached";
}
```

Include matching nullable update patch support for clearing `evaluatorModel`, `scheduledAt`, and `stopReason`.

- [ ] **Step 5: Create attempt repo**

```ts
export interface SupervisorCycleAttempt {
  id: string;
  cycleId: string;
  attemptIndex: number;
  status: "evaluating" | "failed" | "completed" | "cancelled";
  startedAt: number;
  completedAt?: number;
  errorReason?: string;
  providerModel?: string;
}

export class SupervisorCycleAttemptRepo {
  constructor(private readonly db: Database) {}

  create(input: SupervisorCycleAttempt): SupervisorCycleAttempt { /* insert + find */ }
  update(id: string, patch: SupervisorCycleAttemptPatch): SupervisorCycleAttempt { /* update */ }
  listForCycle(cycleId: string): SupervisorCycleAttempt[] { /* order by attempt_index asc */ }
  deleteForCycle(cycleId: string): void { /* cleanup helper */ }
}
```

- [ ] **Step 6: Re-run repository tests**

Run: `pnpm vitest packages/server/src/__tests__/supervisor-repo.test.ts --run`
Expected: PASS with persisted v2 supervisor fields and attempt-row storage.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/domain/supervisor.ts packages/server/src/storage/repositories/supervisor-repo.ts packages/server/src/storage/repositories/supervisor-cycle-repo.ts packages/server/src/storage/repositories/supervisor-cycle-attempt-repo.ts packages/server/src/storage/index.ts packages/server/src/__tests__/supervisor-repo.test.ts
git commit -m "feat: persist supervisor execution policy fields"
```

## Task 4: Add Global Retry Settings And Settings Validation

**Files:**
- Modify: `packages/server/src/supervisor/settings.ts`
- Modify: `packages/server/src/commands/settings.ts`
- Test: `packages/server/src/commands/settings.test.ts`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/locales/en.json`

- [ ] **Step 1: Write failing Settings command tests for retry fields**

```ts
it("accepts supervisor retry settings", async () => {
  const result = await dispatch(
    {
      kind: "command",
      id: "settings-1",
      op: "settings.update",
      args: {
        settings: {
          supervisor: {
            evaluationTimeoutSec: 600,
            retryEnabled: true,
            retryMaxCount: 3,
            retryDelaySec: 10,
            retryOnTimeout: true,
            retryOnEvaluatorError: false,
          },
        },
      },
    },
    ctx
  );

  expect(result.ok).toBe(true);
});
```

Add a validation failure for `retryDelaySec: 0` or negative retry counts.

- [ ] **Step 2: Run settings tests and confirm failure**

Run: `pnpm vitest packages/server/src/commands/settings.test.ts packages/web/src/features/settings/components/settings-page.test.tsx --run`
Expected: FAIL because the settings schema and page only understand evaluation timeout.

- [ ] **Step 3: Add retry key constants and resolvers**

```ts
export const SUPERVISOR_RETRY_ENABLED_SETTING_KEY = "supervisor.retryEnabled";
export const SUPERVISOR_RETRY_MAX_COUNT_SETTING_KEY = "supervisor.retryMaxCount";
export const SUPERVISOR_RETRY_DELAY_SEC_SETTING_KEY = "supervisor.retryDelaySec";
export const SUPERVISOR_RETRY_ON_TIMEOUT_SETTING_KEY = "supervisor.retryOnTimeout";
export const SUPERVISOR_RETRY_ON_EVALUATOR_ERROR_SETTING_KEY =
  "supervisor.retryOnEvaluatorError";

export interface SupervisorRetrySettings {
  retryEnabled: boolean;
  retryMaxCount: number;
  retryDelaySec: number;
  retryOnTimeout: boolean;
  retryOnEvaluatorError: boolean;
}
```

- [ ] **Step 4: Extend `settings.update` schema**

```ts
supervisor: z
  .object({
    evaluationTimeoutSec: z.number().int().min(1).max(MAX_SUPERVISOR_EVALUATION_TIMEOUT_SEC).optional(),
    retryEnabled: z.boolean().optional(),
    retryMaxCount: z.number().int().min(0).max(20).optional(),
    retryDelaySec: z.number().int().min(1).max(3600).optional(),
    retryOnTimeout: z.boolean().optional(),
    retryOnEvaluatorError: z.boolean().optional(),
  })
  .optional(),
```

- [ ] **Step 5: Add settings page controls**

Use the existing supervisor section in `SettingsPage` and add:

```tsx
<Switch checked={retryEnabled} onCheckedChange={handleRetryEnabledChange} />
<Input type="number" min={0} max={20} value={retryMaxCount} onChange={...} />
<Input type="number" min={1} max={3600} value={retryDelaySec} onChange={...} />
<Switch checked={retryOnTimeout} onCheckedChange={...} />
<Switch checked={retryOnEvaluatorError} onCheckedChange={...} />
```

Persist them through the same `settings.update` payload as evaluation timeout.

- [ ] **Step 6: Re-run settings tests**

Run: `pnpm vitest packages/server/src/commands/settings.test.ts packages/web/src/features/settings/components/settings-page.test.tsx --run`
Expected: PASS with retry settings validation and UI payload coverage.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/supervisor/settings.ts packages/server/src/commands/settings.ts packages/server/src/commands/settings.test.ts packages/web/src/features/settings/components/settings-page.tsx packages/web/src/features/settings/components/settings-page.test.tsx packages/web/src/locales/zh.json packages/web/src/locales/en.json
git commit -m "feat: add global supervisor retry settings"
```

## Task 5: Extend Supervisor Commands And Dialog Draft State

**Files:**
- Modify: `packages/server/src/commands/supervisor.ts`
- Test: `packages/server/src/__tests__/supervisor-commands.test.ts`
- Modify: `packages/web/src/features/supervisor/actions/use-objective-dialog-state.ts`
- Modify: `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`
- Modify: `packages/web/src/features/supervisor/views/shared/objective-dialog-content.test.tsx`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/locales/en.json`

- [ ] **Step 1: Write failing command/UI tests for model, max count, and schedule fields**

```ts
it("passes evaluatorModel, maxSupervisionCount, and scheduledAt through supervisor.create", async () => {
  const result = await dispatch(
    {
      kind: "command",
      id: "cmd-1",
      op: "supervisor.create",
      args: {
        sessionId: "sess-1",
        workspaceId: "ws-1",
        objective: "Ship execution policy",
        evaluatorProviderId: "codex",
        evaluatorModel: "o3",
        maxSupervisionCount: 5,
        scheduledAt: 1_746_950_400_000,
      },
    },
    ctx
  );

  expect(result.ok).toBe(true);
  expect(supervisorMgr.create).toHaveBeenCalledWith(
    expect.objectContaining({
      evaluatorModel: "o3",
      maxSupervisionCount: 5,
      scheduledAt: 1_746_950_400_000,
    })
  );
});
```

Add a React test that fills the new fields in `ObjectiveDialogContent` and verifies the submit payload.

- [ ] **Step 2: Run command/dialog tests and confirm failure**

Run: `pnpm vitest packages/server/src/__tests__/supervisor-commands.test.ts packages/web/src/features/supervisor/views/shared/objective-dialog-content.test.tsx --run`
Expected: FAIL because the schemas and dialog draft state only know about objective and evaluator provider.

- [ ] **Step 3: Extend supervisor command schemas**

```ts
const supervisorExecutionFields = {
  evaluatorModel: z.string().trim().max(200).optional(),
  maxSupervisionCount: z.number().int().min(0),
  scheduledAt: z.number().int().positive().optional(),
};
```

Use these fields in both create and update, with update variants optional.

- [ ] **Step 4: Extend dialog draft state**

```ts
const CLOSED_DIALOG_STATE = {
  open: false,
  sessionId: null,
  mode: "enable" as const,
  draftObjective: "",
  draftEvaluatorProviderId: "claude" as const,
  draftEvaluatorModel: "",
  draftMaxSupervisionCount: "0",
  draftScheduledAt: "",
};
```

Normalize:

- empty model -> omitted / `null`
- empty schedule -> omitted
- numeric count string -> integer, default `0`

- [ ] **Step 5: Add dialog fields**

```tsx
<Input id="evaluator-model" value={draftEvaluatorModel} onChange={...} />
<Input id="max-supervision-count" type="number" min={0} value={draftMaxSupervisionCount} onChange={...} />
<Input id="scheduled-at" type="datetime-local" value={draftScheduledAt} onChange={...} />
```

Convert `datetime-local` to epoch milliseconds on confirm, using the browser-local timestamp semantics already implied by the control.

- [ ] **Step 6: Re-run command/dialog tests**

Run: `pnpm vitest packages/server/src/__tests__/supervisor-commands.test.ts packages/web/src/features/supervisor/views/shared/objective-dialog-content.test.tsx --run`
Expected: PASS with new payload fields, validation, and draft rehydration.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/commands/supervisor.ts packages/server/src/__tests__/supervisor-commands.test.ts packages/web/src/features/supervisor/actions/use-objective-dialog-state.ts packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx packages/web/src/features/supervisor/views/shared/objective-dialog-content.test.tsx packages/web/src/locales/zh.json packages/web/src/locales/en.json
git commit -m "feat: extend supervisor dialog policy fields"
```

## Task 6: Add Evaluator Model Override And Objective-Complete Detection

**Files:**
- Modify: `packages/providers/src/codex/config-schema.ts`
- Modify: `packages/providers/src/codex/supervisor-eval.ts`
- Modify: `packages/server/src/supervisor/evaluator.ts`
- Test: `packages/server/src/supervisor/evaluator.test.ts`
- Test: `packages/providers/src/codex/definition.test.ts`

- [ ] **Step 1: Write failing evaluator tests**

```ts
it("prefers supervisor.evaluatorModel over provider config model", async () => {
  const result = await evaluator.evaluate(
    {
      ...makeSupervisor("codex"),
      evaluatorModel: "o3",
    },
    context
  );

  expect(codexBuildSupervisorEvalCommand).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ model: "o3" })
  );
  expect(result.message).toBe("Run the focused parser test.");
});

it("returns a typed objective-complete result when the evaluator emits the sentinel", async () => {
  const evaluator = makeEvaluator("[objective complete]");

  await expect(evaluator.evaluate(makeSupervisor("codex"), context)).resolves.toEqual({
    message: "[objective complete]",
    objectiveComplete: true,
  });
});
```

- [ ] **Step 2: Run evaluator/provider tests and confirm failure**

Run: `pnpm vitest packages/server/src/supervisor/evaluator.test.ts packages/providers/src/codex/definition.test.ts --run`
Expected: FAIL because Codex config does not parse `model`, Codex eval command ignores `req.model`, and evaluator result has no objective-complete metadata.

- [ ] **Step 3: Add optional `model` to Codex config schema**

```ts
export const codexConfigSchema = z.object({
  model: z.string().trim().min(1).optional(),
  additionalArgs: z.array(z.string()).default([]),
  envVars: z.record(z.string(), z.string()).default({}),
});
```

- [ ] **Step 4: Pass model override through Codex supervisor eval command**

```ts
const effectiveModel = req.model ?? cfg.model;
const modelArg = effectiveModel ? ["-m", effectiveModel] : [];

return {
  argv: [
    "codex",
    "exec",
    "--json",
    "-s",
    "read-only",
    "--skip-git-repo-check",
    ...modelArg,
    ...cfg.additionalArgs,
    req.prompt,
  ],
  ...
};
```

- [ ] **Step 5: Mark objective-complete explicitly in evaluator result**

```ts
export interface SupervisorResult {
  message: string;
  objectiveComplete: boolean;
}

const normalized = message.trim();
return {
  message: normalized,
  objectiveComplete: normalized === "[objective complete]",
};
```

- [ ] **Step 6: Re-run evaluator/provider tests**

Run: `pnpm vitest packages/server/src/supervisor/evaluator.test.ts packages/providers/src/codex/definition.test.ts --run`
Expected: PASS with Codex model override and typed objective-complete detection.

- [ ] **Step 7: Commit**

```bash
git add packages/providers/src/codex/config-schema.ts packages/providers/src/codex/supervisor-eval.ts packages/server/src/supervisor/evaluator.ts packages/server/src/supervisor/evaluator.test.ts packages/providers/src/codex/definition.test.ts
git commit -m "feat: support supervisor evaluator model overrides"
```

## Task 7: Refactor Supervisor Manager For Retry, Stop, Scheduled Trigger, And In-Flight Pause

**Files:**
- Modify: `packages/server/src/supervisor/manager.ts`
- Modify: `packages/server/src/supervisor/scheduler.ts`
- Modify: `packages/server/src/supervisor/scheduler.test.ts`
- Modify: `packages/server/src/__tests__/supervisor-manager.test.ts`

- [ ] **Step 1: Write failing manager tests for new execution semantics**

```ts
it("stops the supervisor when evaluator returns objective complete", async () => {
  const supervisor = await manager.create({
    sessionId: "sess-stop",
    workspaceId: "ws-1",
    objective: "Finish the migration",
    evaluatorProviderId: "codex",
    maxSupervisionCount: 0,
  });

  vi.spyOn(getManagerInternals().evaluator, "evaluate").mockResolvedValueOnce({
    message: "[objective complete]",
    objectiveComplete: true,
  });

  const finished = await getManagerInternals().runEvaluation(supervisor.id, "turn_completed");

  expect(finished?.status).toBe("completed");
  expect(manager.get(supervisor.id)?.state).toBe("stopped");
  expect(manager.get(supervisor.id)?.stopReason).toBe("objective_complete");
});

it("retries evaluator timeout up to the global retry budget", async () => {
  deps.settingsRepo.get = vi.fn((key: string) => {
    switch (key) {
      case "supervisor.retryEnabled": return true;
      case "supervisor.retryMaxCount": return 2;
      case "supervisor.retryDelaySec": return 1;
      case "supervisor.retryOnTimeout": return true;
      case "supervisor.retryOnEvaluatorError": return false;
      default: return undefined;
    }
  });

  vi.spyOn(getManagerInternals().evaluator, "evaluate")
    .mockRejectedValueOnce({ code: "supervisor_eval_timeout", message: "timed out" })
    .mockResolvedValueOnce({ message: "Run tests", objectiveComplete: false });

  const finished = await getManagerInternals().runEvaluation(supervisor.id, "turn_completed");

  expect(finished?.status).toBe("injected");
  expect(attemptRepo.listForCycle(finished!.id)).toHaveLength(2);
});

it("pauses an in-flight evaluation by cancelling the cycle", async () => {
  const supervisor = await manager.create(...);
  vi.spyOn(getManagerInternals().evaluator, "evaluate").mockImplementation(
    () => new Promise(() => {})
  );

  const cycle = await manager.triggerEvaluation(supervisor.id);
  await manager.pause(supervisor.id);

  expect(manager.get(supervisor.id)?.state).toBe("paused");
  expect(manager.get(supervisor.id)?.cycles.find((entry) => entry.id === cycle.id)?.status).toBe("cancelled");
});
```

Also add tests for:

- `maxSupervisionCount = 0` stays unlimited
- positive max count stops before starting an extra cycle
- `scheduledAt` trigger type creates `scheduled` cycles
- pause during retry wait cancels the pending timer

- [ ] **Step 2: Run manager/scheduler tests and confirm failure**

Run: `pnpm vitest packages/server/src/__tests__/supervisor-manager.test.ts packages/server/src/supervisor/scheduler.test.ts --run`
Expected: FAIL because the manager has no stopped state, no retry loop, no scheduled trigger, and `pause()` does not abort in-flight work.

- [ ] **Step 3: Extend the scheduler API to support scheduled callbacks**

```ts
constructor(
  private readonly deps: {
    eventBus: EventBus;
    onTurnCompleted: (sessionId: string) => void;
    listScheduledSupervisors: () => Array<{ supervisorId: string; scheduledAt: number }>;
    onScheduledDue: (supervisorId: string) => void;
  }
) {}
```

Maintain:

- existing `session.lifecycle` subscription
- one in-memory nearest-deadline `setTimeout`
- `refresh()` method the manager can call after hydrate/create/update/pause/resume/delete

- [ ] **Step 4: Introduce retry settings snapshot and attempt recording**

```ts
interface SupervisorRetrySnapshot {
  retryEnabled: boolean;
  retryMaxCount: number;
  retryDelayMs: number;
  retryOnTimeout: boolean;
  retryOnEvaluatorError: boolean;
}

interface StartedCycle {
  cycle: SupervisorCycle;
  context: SupervisorEvaluationContext;
  retry: SupervisorRetrySnapshot;
}
```

Each attempt should create/update a `supervisor_cycle_attempts` row.

- [ ] **Step 5: Split execution into begin / execute-with-retry / finalize**

```ts
private async executeCycleWithRetry(started: StartedCycle): Promise<SupervisorCycle> {
  for (let attemptIndex = 0; ; attemptIndex += 1) {
    // create attempt row
    // run evaluator
    // stop on objective complete
    // inject on actionable message
    // if failure and retry allowed -> wait and continue
    // else finalize failure
  }
}
```

Key rules:

- retry only evaluator timeout / evaluator failure categories
- no retry after `[objective complete]`
- count cycles, not attempts, against `maxSupervisionCount`
- clear consumed `scheduledAt` once a scheduled cycle begins successfully

- [ ] **Step 6: Add `stopped` and `cancelled` flows**

Use:

```ts
const stoppedSupervisor = this.deps.supervisorRepo.update(supervisorId, {
  state: "stopped",
  stopReason: "objective_complete",
  updatedAt: Date.now(),
});
```

For user pause during active work:

```ts
this.evaluationAbortControllers.get(id)?.abort();
this.retryTimers.get(id)?.cancel?.();
```

Finalize the cycle as `cancelled`, not `failed`.

- [ ] **Step 7: Re-run manager/scheduler tests**

Run: `pnpm vitest packages/server/src/__tests__/supervisor-manager.test.ts packages/server/src/supervisor/scheduler.test.ts --run`
Expected: PASS with retry loop, one-shot scheduled execution, stopped state, and in-flight pause behavior.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/supervisor/manager.ts packages/server/src/supervisor/scheduler.ts packages/server/src/supervisor/scheduler.test.ts packages/server/src/__tests__/supervisor-manager.test.ts
git commit -m "feat: add supervisor retry and stop state machine"
```

## Task 8: Assemble Server Wiring And Surface New States In The UI

**Files:**
- Modify: `packages/server/src/server.ts`
- Modify: `packages/web/src/features/supervisor/views/shared/supervisor-card.tsx`
- Modify: `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx`
- Modify: `packages/web/src/features/supervisor/actions/use-supervisor-actions.ts`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/locales/en.json`
- Test: `packages/web/src/features/supervisor/components/supervisor-card.test.tsx`
- Test: `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx`

- [ ] **Step 1: Write failing UI tests for stopped state and schedule/model summary**

```ts
it("renders the stopped state and objective-complete reason", () => {
  renderSupervisorCard({
    state: "stopped",
    stopReason: "objective_complete",
    evaluatorProviderId: "codex",
    evaluatorModel: "o3",
    maxSupervisionCount: 0,
  });

  expect(screen.getByText("Supervisor")).toBeVisible();
  expect(screen.getByText(/Objective complete/i)).toBeVisible();
  expect(screen.getByText(/codex/i)).toBeVisible();
  expect(screen.getByText(/o3/i)).toBeVisible();
});
```

- [ ] **Step 2: Run supervisor UI tests and confirm failure**

Run: `pnpm vitest packages/web/src/features/supervisor/components/supervisor-card.test.tsx packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx --run`
Expected: FAIL because `stopped` is not a known state and the UI has no stop-reason rendering.

- [ ] **Step 3: Wire the new repos and scheduler dependencies in `server.ts`**

```ts
const attemptRepo = new SupervisorCycleAttemptRepo(db);
supervisorMgr = new SupervisorManager({
  ...,
  cycleAttemptRepo: attemptRepo,
});
```

If the manager constructor now requires scheduler callbacks or refresh hooks, wire them in here and keep hydrate order as:

1. session hydrate
2. supervisor hydrate
3. scheduler refresh

- [ ] **Step 4: Add new supervisor state copy and summary rendering**

Render:

- stopped badge/state class
- stop reason text
- optional evaluator model
- optional scheduled time
- max supervision cap summary when positive

Keep the existing provider pill and objective row intact.

- [ ] **Step 5: Re-run supervisor UI tests**

Run: `pnpm vitest packages/web/src/features/supervisor/components/supervisor-card.test.tsx packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx --run`
Expected: PASS with stopped-state copy, new summary rows, and mobile parity.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/server.ts packages/web/src/features/supervisor/views/shared/supervisor-card.tsx packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx packages/web/src/features/supervisor/actions/use-supervisor-actions.ts packages/web/src/features/supervisor/components/supervisor-card.test.tsx packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx packages/web/src/locales/zh.json packages/web/src/locales/en.json
git commit -m "feat: surface supervisor stopped state in server and UI"
```

## Task 9: Run End-To-End Verification Across Startup, Commands, And UI

**Files:**
- Modify as needed based on verification fallout only
- Test: relevant Vitest suites

- [ ] **Step 1: Run focused server/unit suites**

Run: `pnpm vitest packages/server/src/__tests__/db.test.ts packages/server/src/__tests__/supervisor-repo.test.ts packages/server/src/commands/settings.test.ts packages/server/src/__tests__/supervisor-commands.test.ts packages/server/src/__tests__/supervisor-manager.test.ts packages/server/src/supervisor/evaluator.test.ts packages/server/src/supervisor/scheduler.test.ts --run`
Expected: PASS

- [ ] **Step 2: Run focused CLI suites**

Run: `pnpm vitest packages/cli/src/bin.test.ts packages/cli/src/server-runner.test.ts --run`
Expected: PASS

- [ ] **Step 3: Run focused web suites**

Run: `pnpm vitest packages/web/src/features/settings/components/settings-page.test.tsx packages/web/src/features/supervisor/views/shared/objective-dialog-content.test.tsx packages/web/src/features/supervisor/components/supervisor-card.test.tsx packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx --run`
Expected: PASS

- [ ] **Step 4: Run a representative cross-package supervisor slice**

Run: `pnpm vitest packages/server/src/__tests__/supervisor-manager.test.ts packages/web/src/features/supervisor/components/supervisor-card.test.tsx packages/cli/src/bin.test.ts --run`
Expected: PASS

- [ ] **Step 5: Commit any bounded verification fixes**

```bash
git add <only files changed by verification fixes>
git commit -m "fix: polish supervisor execution policy rollout"
```

## Plan Self-Review

- Spec coverage:
  - DB upgrade + unknown schema rebuild prompt: Task 1 and Task 2
  - per-supervisor persisted fields: Task 3 and Task 5
  - global retry settings: Task 4
  - model override: Task 6
  - retry loop / pause / stop semantics: Task 7
  - scheduler one-shot trigger: Task 7
  - UI and locale updates: Task 4, Task 5, Task 8
- Placeholder scan:
  - every task includes exact files, test commands, and concrete code skeletons
  - no `TBD`, `TODO`, or “handle appropriately” placeholders remain
- Type consistency:
  - state names use `stopped`
  - cycle cancellation uses `cancelled`
  - stop reasons use `objective_complete` and `max_supervision_count_reached`
  - retry settings keys are consistently `supervisor.retry*`
