# Supervisor Target-Scoped Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current effectively stateless supervisor loop with a target-scoped, workspace-file-backed supervision model that bootstraps a lightweight plan on first trigger and exposes current target progress plus recent cycle reasoning in the UI.

**Architecture:** Keep the existing session-bound supervisor runtime state machine, commands, retry loop, and injection behavior, but add a `targetId`-based workspace store under `.coder-studio/supervisor/targets/`. The server becomes responsible for loading and updating `meta.json`, `memory.json`, and `cycles.jsonl`; the evaluator upgrades from plain-text guidance to structured `continue` / `stop` results; the web UI remains server-authoritative and renders current target state plus recent cycle history from the enriched supervisor payload.

**Tech Stack:** TypeScript, Node `fs/promises`, existing workspace-safe file IO patterns, SQLite for runtime supervisor state, Vitest, Fastify, WebSocket topics, React, Jotai.

---

## File Structure

### Core domain and protocol
- Modify: `packages/core/src/domain/supervisor.ts` — add target-scoped domain types, new stop reasons, structured cycle result shape, and supervisor `targetId` fields.
- Modify: `packages/core/src/index.ts` — export any new target-memory domain types.

### Workspace-backed target store
- Create: `packages/server/src/supervisor/target-store.ts` — read/write helpers for `.coder-studio/supervisor/targets/<targetId>/meta.json`, `memory.json`, and `cycles.jsonl`.
- Create: `packages/server/src/supervisor/target-store.test.ts` — focused tests for file layout, bootstrap state, append-only cycle history, and objective supersede behavior.
- Reuse reference patterns from: `packages/server/src/fs/file-io.ts`

### Supervisor runtime
- Modify: `packages/server/src/storage/repositories/supervisor-repo.ts` — persist active `targetId` in runtime supervisor rows.
- Modify: `packages/server/src/storage/db.ts` — add `v2 -> v3` upgrade handling for `target_id`, and ensure `v1` databases still upgrade all the way to current.
- Modify: `packages/server/src/storage/migrations/001_init.sql` — extend the current baseline `supervisors` table with `target_id` in the exact shape expected by the upgraded fingerprint.
- Modify: `packages/server/src/storage/schema-version.ts` — bump the schema version, preserve a `V2_SCHEMA_SQL` snapshot, and teach detection about `v2`.
- Modify: `packages/server/src/supervisor/context-builder.ts` — remove git signal from evaluation context, add target memory input support, keep latest user input and terminal snapshot.
- Modify: `packages/server/src/supervisor/evaluator.ts` — bootstrap plan on first trigger and return structured `continue` / `stop` payloads.
- Modify: `packages/server/src/supervisor/manager.ts` — create target directories, supersede target on objective changes, update memory, append cycle records, map structured results to runtime state.
- Modify: `packages/server/src/supervisor/index.ts` — export new target store types/helpers if needed.
- Test: `packages/server/src/supervisor/manager.test.ts`
- Test: `packages/server/src/supervisor/evaluator.test.ts`
- Test: `packages/server/src/supervisor/evaluator.windows.test.ts`
- Test: `packages/server/src/__tests__/supervisor-manager.test.ts`
- Test: `packages/server/src/__tests__/supervisor-integration.test.ts`
- Test: `packages/server/src/__tests__/supervisor-repo.test.ts`
- Test: `packages/server/src/storage/db.test.ts`
- Test: `packages/server/src/__tests__/db.test.ts`

### Commands and server wiring
- Modify: `packages/server/src/commands/supervisor.ts` only if type updates require it; command names and payload shapes stay unchanged.
- Modify: `packages/server/src/server.ts` — wire `target-store` dependencies into `SupervisorManager`.
- Test: `packages/server/src/__tests__/supervisor-commands.test.ts`

### Web UI and event routing
- Modify: `packages/web/src/features/supervisor/atoms.ts` only if helper selectors become useful; the main shape expansion comes from the `Supervisor` domain type.
- Modify: `packages/web/src/features/supervisor/actions/use-supervisor-actions.ts` — derive current target plan, progress summary, stop reason, and recent cycle list from enriched supervisor data.
- Modify: `packages/web/src/features/supervisor/actions/use-objective-dialog-state.ts` only if the dialog has assumptions that break once `targetId` rotates on objective edit.
- Modify: `packages/web/src/features/supervisor/views/shared/supervisor-card.tsx` — render active target, plan summary, stalled count, and recent cycle reasoning.
- Modify: `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx` only if the expanded `SupervisorCard` needs mobile-specific layout adjustments.
- Modify: `packages/web/src/app/providers.tsx` — route richer supervisor payloads and cycle records into atoms.
- Test: `packages/web/src/features/supervisor/components/supervisor-card.test.tsx`
- Test: `packages/web/src/features/supervisor/components/objective-dialog.test.tsx`
- Test: `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx`
- Test: `packages/web/src/app/providers.test.tsx`

## Task 1: Add Target-Scoped Domain Types And Runtime `targetId`

**Files:**
- Modify: `packages/core/src/domain/supervisor.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/server/src/storage/migrations/001_init.sql`
- Modify: `packages/server/src/storage/schema-version.ts`
- Modify: `packages/server/src/storage/db.ts`
- Modify: `packages/server/src/storage/repositories/supervisor-repo.ts`
- Test: `packages/server/src/__tests__/supervisor-repo.test.ts`
- Test: `packages/server/src/storage/db.test.ts`
- Test: `packages/server/src/__tests__/db.test.ts`

- [ ] **Step 1: Write failing repository and schema tests for `targetId` persistence**

```ts
// packages/server/src/__tests__/supervisor-repo.test.ts
it("persists targetId on supervisor create and update", () => {
  const repo = createSupervisorRepo();

  const created = repo.create({
    id: "sup-1",
    sessionId: "sess-1",
    workspaceId: "ws-1",
    state: "idle",
    objective: "Ship feature",
    evaluatorProviderId: "claude",
    targetId: "tgt-1",
    maxSupervisionCount: 0,
    completedSupervisionCount: 0,
    createdAt: 1,
    updatedAt: 1,
  });

  expect(created.targetId).toBe("tgt-1");

  const updated = repo.update("sup-1", {
    targetId: "tgt-2",
  });

  expect(updated.targetId).toBe("tgt-2");
});
```

```ts
// packages/server/src/storage/db.test.ts
it("includes target_id on supervisors in the latest schema", () => {
  const db = openDatabase(tempDbPath());
  const columns = db.prepare("PRAGMA table_info(supervisors)").all() as Array<{ name: string }>;

  expect(columns.map((column) => column.name)).toContain("target_id");
});
```

```ts
// packages/server/src/__tests__/db.test.ts
it("upgrades a known v2 supervisor schema to v3 and backfills target_id", () => {
  const dbPath = join(tempDir, "v2.db");
  const rawDb = new DatabaseSync(dbPath);
  rawDb.exec("PRAGMA user_version = 2");
  rawDb.exec(V2_SCHEMA_SQL);
  rawDb.exec(`
    INSERT INTO workspaces (id, path, target_runtime, opened_at, last_active_at, ui_state)
    VALUES ('ws-1', '/workspace', 'native', 1, 1, '{}');
    INSERT INTO terminals (id, workspace_id, kind, cwd, argv, cols, rows, created_at)
    VALUES ('term-1', 'ws-1', 'agent', '/workspace', '[]', 120, 30, 1);
    INSERT INTO sessions (id, workspace_id, terminal_id, provider_id, capability, state, started_at, last_active_at)
    VALUES ('sess-1', 'ws-1', 'term-1', 'claude', 'full', 'idle', 1, 1);
    INSERT INTO supervisors (id, session_id, workspace_id, state, objective, evaluator_provider_id, evaluator_model, max_supervision_count, completed_supervision_count, scheduled_at, stop_reason, last_cycle_at, last_evaluated_turn_id, error_reason, created_at, updated_at)
    VALUES ('sup-1', 'sess-1', 'ws-1', 'idle', 'Ship feature', 'claude', NULL, 0, 0, NULL, NULL, NULL, NULL, NULL, 1, 1);
  `);
  rawDb.close();

  db = openDatabase(dbPath);

  const userVersion = db.prepare("PRAGMA user_version").get() as { user_version: number };
  expect(userVersion.user_version).toBe(CURRENT_SCHEMA_VERSION);

  const supervisorColumns = db.prepare("PRAGMA table_info(supervisors)").all() as Array<{
    name: string;
  }>;
  expect(supervisorColumns.map((column) => column.name)).toContain("target_id");

  const migrated = db.prepare("SELECT target_id FROM supervisors WHERE id = ?").get("sup-1") as {
    target_id: string;
  };
  expect(migrated.target_id).toMatch(/^legacy_sup-1$/);
});
```

- [ ] **Step 2: Run the narrow test set and confirm failure**

Run: `pnpm vitest packages/server/src/__tests__/supervisor-repo.test.ts packages/server/src/storage/db.test.ts packages/server/src/__tests__/db.test.ts --run`
Expected: FAIL because `Supervisor` has no `targetId` field, the `supervisors` table has no `target_id` column, and the database layer does not yet recognize a `v3` schema.

- [ ] **Step 3: Extend the supervisor domain with target-scoped types**

```ts
// packages/core/src/domain/supervisor.ts
export type SupervisorStopReason =
  | "objective_complete"
  | "max_supervision_count_reached"
  | "supervisor_uncertain"
  | "needs_user_input";

export type SupervisorPlanStepStatus = "pending" | "in_progress" | "done";

export interface SupervisorPlanStep {
  id: string;
  title: string;
  status: SupervisorPlanStepStatus;
}

export interface SupervisorTargetMemory {
  targetId: string;
  planGenerated: boolean;
  plan: SupervisorPlanStep[];
  activeStepId?: string;
  progressSummary?: string;
  lastGuidance?: string;
  stalledCount: number;
  updatedAt: number;
}

export interface SupervisorCycleStepUpdate {
  id: string;
  status: SupervisorPlanStepStatus;
}

export interface SupervisorCycleTargetRecord {
  cycleId: string;
  targetId: string;
  startedAt: number;
  completedAt: number;
  result: "continue" | "stop" | "error";
  stopReason?: "objective_complete" | "supervisor_uncertain" | "needs_user_input";
  reason?: string;
  guidance?: string;
  progressSummary?: string;
  activeStepId?: string;
  stepUpdates?: SupervisorCycleStepUpdate[];
  injected?: boolean;
  attemptCount?: number;
  errorReason?: string;
}

export interface Supervisor {
  id: string;
  sessionId: string;
  workspaceId: string;
  state: SupervisorState;
  objective: string;
  targetId: string;
  evaluatorProviderId: string;
  evaluatorModel?: string;
  maxSupervisionCount: number;
  completedSupervisionCount: number;
  scheduledAt?: number;
  stopReason?: SupervisorStopReason;
  cycles: SupervisorCycle[];
  currentTargetMemory?: SupervisorTargetMemory;
  recentTargetCycles?: SupervisorCycleTargetRecord[];
  lastCycleAt?: number;
  lastEvaluatedTurnId?: string;
  errorReason?: string;
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 4: Add `target_id` to the latest schema and repository CRUD**

```sql
-- packages/server/src/storage/migrations/001_init.sql
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
  updated_at INTEGER NOT NULL, target_id TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (session_id, workspace_id) REFERENCES sessions(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
```

```ts
// packages/server/src/storage/repositories/supervisor-repo.ts
interface SupervisorRow {
  id: string;
  session_id: string;
  workspace_id: string;
  state: SupervisorState;
  objective: string;
  target_id: string;
  evaluator_provider_id: string;
  evaluator_model: string | null;
  max_supervision_count: number;
  completed_supervision_count: number;
  scheduled_at: number | null;
  stop_reason: SupervisorStopReason | null;
  last_cycle_at: number | null;
  last_evaluated_turn_id: string | null;
  error_reason: string | null;
  created_at: number;
  updated_at: number;
}

export interface NewSupervisor {
  id: string;
  sessionId: string;
  workspaceId: string;
  state: SupervisorState;
  objective: string;
  targetId: string;
  evaluatorProviderId: string;
  evaluatorModel?: string;
  maxSupervisionCount: number;
  completedSupervisionCount: number;
  scheduledAt?: number;
  stopReason?: SupervisorStopReason;
  lastCycleAt?: number;
  lastEvaluatedTurnId?: string;
  errorReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SupervisorUpdatePatch {
  state?: SupervisorState;
  objective?: string;
  targetId?: string;
  evaluatorProviderId?: string;
  evaluatorModel?: string | null;
  maxSupervisionCount?: number;
  completedSupervisionCount?: number;
  scheduledAt?: number | null;
  stopReason?: SupervisorStopReason | null;
  lastCycleAt?: number | null;
  lastEvaluatedTurnId?: string | null;
  errorReason?: string | null;
  updatedAt?: number;
}
```

Persist `target_id` on create, update, and row mapping.

Also introduce a real schema upgrade path rather than only editing the baseline:

```ts
// packages/server/src/storage/schema-version.ts
export type SchemaState = "empty" | "current" | "v1" | "v2" | "incompatible";

export const CURRENT_SCHEMA_VERSION = 3;
export const V2_SCHEMA_SQL = `
  -- paste the exact pre-target_id baseline schema here so fingerprint
  -- detection can distinguish v2 from incompatible drift
`;
```

```ts
// packages/server/src/storage/db.ts
function upgradeSchemaV2ToV3(db: Database): void {
  withTransaction(db, () => {
    db.exec("ALTER TABLE supervisors ADD COLUMN target_id TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE supervisors SET target_id = 'legacy_' || id WHERE target_id = ''");
    stampCurrentSchemaVersion(db);
  });
}

function initializeOrUpgradeSchema(db: Database, dbPath: string): void {
  throwIfLegacySchema(db, dbPath);

  const detection = detectSchema(db);

  switch (detection.state) {
    case "empty":
      initializeSchema(db);
      assertCurrentSchema(db, dbPath);
      return;

    case "current":
      if (detection.userVersion !== CURRENT_SCHEMA_VERSION) {
        stampCurrentSchemaVersion(db);
      }
      assertCurrentSchema(db, dbPath);
      return;

    case "v1":
      upgradeSchemaV1ToV2(db);
      upgradeSchemaV2ToV3(db);
      assertCurrentSchema(db, dbPath);
      return;

    case "v2":
      upgradeSchemaV2ToV3(db);
      assertCurrentSchema(db, dbPath);
      return;

    case "incompatible":
      throw new IncompatibleSchemaError(dbPath, detection.mismatch ?? "unknown schema drift");
  }
}
```

- [ ] **Step 5: Run the narrow test set and verify it passes**

Run: `pnpm vitest packages/server/src/__tests__/supervisor-repo.test.ts packages/server/src/storage/db.test.ts packages/server/src/__tests__/db.test.ts --run`
Expected: PASS with schema, upgrade, and repo assertions recognizing `target_id`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/domain/supervisor.ts packages/core/src/index.ts packages/server/src/storage/migrations/001_init.sql packages/server/src/storage/schema-version.ts packages/server/src/storage/db.ts packages/server/src/storage/repositories/supervisor-repo.ts packages/server/src/__tests__/supervisor-repo.test.ts packages/server/src/storage/db.test.ts packages/server/src/__tests__/db.test.ts
git commit -m "feat: persist supervisor target ids"
```

## Task 2: Build The Workspace-Backed Target Store

**Files:**
- Create: `packages/server/src/supervisor/target-store.ts`
- Create: `packages/server/src/supervisor/target-store.test.ts`
- Reuse reference: `packages/server/src/fs/file-io.ts`

- [ ] **Step 1: Write failing target store tests**

```ts
// packages/server/src/supervisor/target-store.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendTargetCycleRecord,
  createTargetFiles,
  readTargetCycleRecords,
  readTargetMeta,
  loadTargetMemory,
  markTargetSuperseded,
  saveTargetMemory,
} from "./target-store.js";

describe("target store", () => {
  let workspacePath: string;

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), "supervisor-target-store-"));
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it("creates target metadata with planGenerated=false before first trigger", async () => {
    await createTargetFiles(workspacePath, {
      targetId: "tgt-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Ship feature",
      createdAt: 1,
    });

    const memory = await loadTargetMemory(workspacePath, "tgt-1");

    expect(memory).toEqual({
      targetId: "tgt-1",
      planGenerated: false,
      plan: [],
      activeStepId: undefined,
      progressSummary: undefined,
      lastGuidance: undefined,
      stalledCount: 0,
      updatedAt: 1,
    });
  });

  it("appends cycle records as newline-delimited json", async () => {
    await createTargetFiles(workspacePath, {
      targetId: "tgt-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Ship feature",
      createdAt: 1,
    });

    await appendTargetCycleRecord(workspacePath, "tgt-1", {
      cycleId: "cycle-1",
      targetId: "tgt-1",
      startedAt: 1,
      completedAt: 2,
      result: "continue",
      reason: "Need one more implementation step",
      guidance: "Implement the store",
      injected: true,
      attemptCount: 1,
    });

    const lines = await readTargetCycleRecords(workspacePath, "tgt-1");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.guidance).toBe("Implement the store");
  });

  it("marks a target as superseded without mutating the old memory contents", async () => {
    await createTargetFiles(workspacePath, {
      targetId: "tgt-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Old objective",
      createdAt: 1,
    });

    await saveTargetMemory(workspacePath, "tgt-1", {
      targetId: "tgt-1",
      planGenerated: true,
      plan: [{ id: "step-1", title: "Old step", status: "in_progress" }],
      activeStepId: "step-1",
      progressSummary: "In progress",
      lastGuidance: "Do old thing",
      stalledCount: 1,
      updatedAt: 2,
    });

    await markTargetSuperseded(workspacePath, "tgt-1", "tgt-2", 3);

    const meta = await readTargetMeta(workspacePath, "tgt-1");
    const memory = await loadTargetMemory(workspacePath, "tgt-1");

    expect(meta.status).toBe("superseded");
    expect(meta.supersededBy).toBe("tgt-2");
    expect(memory.lastGuidance).toBe("Do old thing");
  });
});
```

- [ ] **Step 2: Run the target store tests and confirm failure**

Run: `pnpm vitest packages/server/src/supervisor/target-store.test.ts --run`
Expected: FAIL because `target-store.ts` does not exist yet.

- [ ] **Step 3: Implement workspace target store helpers**

```ts
// packages/server/src/supervisor/target-store.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SupervisorCycleTargetRecord, SupervisorTargetMemory } from "@coder-studio/core";

export interface SupervisorTargetMeta {
  targetId: string;
  sessionId: string;
  workspaceId: string;
  objective: string;
  status: "active" | "completed" | "cancelled" | "superseded";
  createdAt: number;
  updatedAt: number;
  supersededBy: string | null;
  completedAt: number | null;
}

function targetDir(workspacePath: string, targetId: string): string {
  return join(workspacePath, ".coder-studio", "supervisor", "targets", targetId);
}

function metaPath(workspacePath: string, targetId: string): string {
  return join(targetDir(workspacePath, targetId), "meta.json");
}

function memoryPath(workspacePath: string, targetId: string): string {
  return join(targetDir(workspacePath, targetId), "memory.json");
}

function cyclesPath(workspacePath: string, targetId: string): string {
  return join(targetDir(workspacePath, targetId), "cycles.jsonl");
}

export async function createTargetFiles(
  workspacePath: string,
  input: { targetId: string; sessionId: string; workspaceId: string; objective: string; createdAt: number }
): Promise<void> {
  const dir = targetDir(workspacePath, input.targetId);
  await mkdir(dir, { recursive: true });

  const meta: SupervisorTargetMeta = {
    targetId: input.targetId,
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    objective: input.objective,
    status: "active",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    supersededBy: null,
    completedAt: null,
  };

  const memory: SupervisorTargetMemory = {
    targetId: input.targetId,
    planGenerated: false,
    plan: [],
    stalledCount: 0,
    updatedAt: input.createdAt,
  };

  await writeFile(metaPath(workspacePath, input.targetId), JSON.stringify(meta, null, 2) + "\n", "utf-8");
  await writeFile(memoryPath(workspacePath, input.targetId), JSON.stringify(memory, null, 2) + "\n", "utf-8");
}

export async function readTargetMeta(
  workspacePath: string,
  targetId: string
): Promise<SupervisorTargetMeta> {
  return JSON.parse(await readFile(metaPath(workspacePath, targetId), "utf-8")) as SupervisorTargetMeta;
}

export async function loadTargetMemory(
  workspacePath: string,
  targetId: string
): Promise<SupervisorTargetMemory> {
  return JSON.parse(await readFile(memoryPath(workspacePath, targetId), "utf-8")) as SupervisorTargetMemory;
}

export async function saveTargetMemory(
  workspacePath: string,
  targetId: string,
  memory: SupervisorTargetMemory
): Promise<void> {
  await mkdir(dirname(memoryPath(workspacePath, targetId)), { recursive: true });
  await writeFile(memoryPath(workspacePath, targetId), JSON.stringify(memory, null, 2) + "\n", "utf-8");
}

export async function appendTargetCycleRecord(
  workspacePath: string,
  targetId: string,
  record: SupervisorCycleTargetRecord
): Promise<void> {
  await mkdir(dirname(cyclesPath(workspacePath, targetId)), { recursive: true });
  await writeFile(cyclesPath(workspacePath, targetId), JSON.stringify(record) + "\n", {
    encoding: "utf-8",
    flag: "a",
  });
}

export async function saveTargetMeta(
  workspacePath: string,
  targetId: string,
  meta: SupervisorTargetMeta
): Promise<void> {
  await mkdir(dirname(metaPath(workspacePath, targetId)), { recursive: true });
  await writeFile(metaPath(workspacePath, targetId), JSON.stringify(meta, null, 2) + "\n", "utf-8");
}

export async function readTargetCycleRecords(
  workspacePath: string,
  targetId: string,
  limit = 20
): Promise<SupervisorCycleTargetRecord[]> {
  const content = await readFile(cyclesPath(workspacePath, targetId), "utf-8").catch(() => "");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SupervisorCycleTargetRecord)
    .slice(-limit)
    .reverse();
}

export async function markTargetSuperseded(
  workspacePath: string,
  targetId: string,
  nextTargetId: string,
  updatedAt: number
): Promise<void> {
  const meta = await readTargetMeta(workspacePath, targetId);
  await saveTargetMeta(workspacePath, targetId, {
    ...meta,
    status: "superseded",
    supersededBy: nextTargetId,
    updatedAt,
  });
}
```

- [ ] **Step 4: Run the target store tests and verify they pass**

Run: `pnpm vitest packages/server/src/supervisor/target-store.test.ts --run`
Expected: PASS with target file creation, supersede metadata updates, and JSONL appends working.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/supervisor/target-store.ts packages/server/src/supervisor/target-store.test.ts
git commit -m "feat: add workspace-backed supervisor target store"
```

## Task 3: Bootstrap Plans On First Trigger And Return Structured Evaluator Results

**Files:**
- Modify: `packages/server/src/supervisor/context-builder.ts`
- Modify: `packages/server/src/supervisor/evaluator.ts`
- Test: `packages/server/src/supervisor/context-builder.test.ts`
- Test: `packages/server/src/supervisor/evaluator.test.ts`
- Test: `packages/server/src/supervisor/evaluator.windows.test.ts`

- [ ] **Step 1: Write failing evaluator tests for plan bootstrap and `continue` / `stop` output parsing**

```ts
// packages/server/src/supervisor/evaluator.test.ts
it("builds a bootstrap prompt when planGenerated is false", async () => {
  const evaluator = createEvaluatorWithStdout(
    JSON.stringify({
      status: "continue",
      reason: "Need a plan first",
      guidance: "Break the objective into 3 to 7 steps",
      plan: [
        { id: "step-1", title: "Inspect current behavior", status: "in_progress" },
        { id: "step-2", title: "Implement target store", status: "pending" },
      ],
      activeStepId: "step-1",
      progressSummary: "Initial decomposition complete",
    })
  );

  const result = await evaluator.evaluate(
    createSupervisor(),
    {
      objective: "Improve supervisor quality",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      workspacePath: "/workspace",
      sessionProviderId: "claude",
      evaluatorProviderId: "claude",
      sessionState: "running",
      terminalExcerpt: "Need to define the implementation plan",
      evidenceSource: "headless_snapshot",
      latestUserInput: "Please improve supervisor quality",
      targetMemory: {
        targetId: "tgt-1",
        planGenerated: false,
        plan: [],
        stalledCount: 0,
        updatedAt: 1,
      },
    },
    {}
  );

  expect(result.status).toBe("continue");
  expect(result.plan?.map((step) => step.title)).toEqual([
    "Inspect current behavior",
    "Implement target store",
  ]);
});

it("parses a stop result with stopReason", async () => {
  const evaluator = createEvaluatorWithStdout(
    JSON.stringify({
      status: "stop",
      stopReason: "objective_complete",
      reason: "The target is complete",
    })
  );

  const result = await evaluator.evaluate(createSupervisor(), createEvaluationContext(), {});

  expect(result).toEqual({
    status: "stop",
    stopReason: "objective_complete",
    reason: "The target is complete",
  });
});
```

- [ ] **Step 2: Run the evaluator tests and confirm failure**

Run: `pnpm vitest packages/server/src/supervisor/evaluator.test.ts packages/server/src/supervisor/context-builder.test.ts --run`
Expected: FAIL because the evaluator still expects plain-text guidance, the context builder has no target memory input, and the evaluator parser still assumes the old message-only contract.

- [ ] **Step 3: Add target memory to evaluation context and remove git as a primary signal**

```ts
// packages/server/src/supervisor/context-builder.ts
import type { SupervisorTargetMemory } from "@coder-studio/core";

export interface SupervisorEvaluationContext {
  objective: string;
  sessionId: string;
  workspaceId: string;
  workspacePath: string;
  sessionProviderId: string;
  evaluatorProviderId: string;
  sessionState: SessionState;
  terminalExcerpt?: string;
  lastTurnId?: string;
  evidenceSource: "headless_snapshot" | "transcript" | "terminal_fallback";
  latestUserInput?: string;
  targetMemory: SupervisorTargetMemory;
}

async build(
  supervisor: Supervisor,
  targetMemory: SupervisorTargetMemory
): Promise<SupervisorEvaluationContext> {
  // keep the existing headless snapshot path, but stop reading git state
  // and copy the loaded target memory directly into the evaluation context
}
```

Drop `gitStatusSummary` and `gitDiffStat` from the normal evaluation context. Update `context-builder.test.ts` to assert those fields are gone and that the provided `targetMemory` is passed through unchanged.

- [ ] **Step 4: Change evaluator output from plain text to structured JSON**

```ts
// packages/server/src/supervisor/evaluator.ts
export interface SupervisorEvaluationResult {
  status: "continue" | "stop";
  stopReason?: "objective_complete" | "supervisor_uncertain" | "needs_user_input";
  reason: string;
  guidance?: string;
  plan?: SupervisorPlanStep[];
  activeStepId?: string;
  progressSummary?: string;
  stepUpdates?: SupervisorCycleStepUpdate[];
}

function buildPrompt(context: SupervisorEvaluationContext): string {
  const lines: string[] = [
    "You are supervising a target-scoped software task.",
    "Return JSON only.",
    "",
    "Allowed statuses:",
    '- "continue": more work is needed; include "reason" and "guidance".',
    '- "stop": supervision should stop; include "stopReason" and "reason".',
    "",
    "Allowed stop reasons:",
    '- "objective_complete"',
    '- "supervisor_uncertain"',
    '- "needs_user_input"',
    "",
    "If planGenerated is false, bootstrap a plan with 3 to 7 milestone-sized steps.",
    "If planGenerated is true, update progress incrementally; do not rewrite the full plan unless absolutely necessary.",
    "",
    "Current objective:",
    context.objective,
    "",
    "Current target memory:",
    JSON.stringify(context.targetMemory, null, 2),
    "",
    "Latest user input:",
    context.latestUserInput?.trim() || "(none)",
    "",
    "Current terminal snapshot:",
    context.terminalExcerpt || "(no output yet)",
  ];

  return lines.join("\n");
}
```

Parse evaluator stdout as JSON and validate the result shape before returning it. Keep the existing subprocess / timeout / Codex-stream handling, but change the final parsed artifact from `{ message, objectiveComplete }` to the new structured result. Update both `evaluator.test.ts` and `evaluator.windows.test.ts` to cover the new JSON contract.

- [ ] **Step 5: Run the evaluator tests and verify they pass**

Run: `pnpm vitest packages/server/src/supervisor/evaluator.test.ts packages/server/src/supervisor/evaluator.windows.test.ts packages/server/src/supervisor/context-builder.test.ts --run`
Expected: PASS with structured result parsing, first-trigger plan bootstrap behavior, and platform-specific subprocess parsing covered.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/supervisor/context-builder.ts packages/server/src/supervisor/evaluator.ts packages/server/src/supervisor/context-builder.test.ts packages/server/src/supervisor/evaluator.test.ts packages/server/src/supervisor/evaluator.windows.test.ts
git commit -m "feat: add structured supervisor evaluation results"
```

## Task 4: Move Supervisor Runtime To Target Lifecycle + Memory Updates

**Files:**
- Modify: `packages/server/src/supervisor/manager.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/commands/supervisor.ts`
- Modify: `packages/server/src/supervisor/index.ts`
- Test: `packages/server/src/supervisor/manager.test.ts`
- Test: `packages/server/src/__tests__/supervisor-manager.test.ts`
- Test: `packages/server/src/__tests__/supervisor-integration.test.ts`
- Test: `packages/server/src/__tests__/supervisor-commands.test.ts`

- [ ] **Step 1: Write failing runtime tests for target creation, supersede-on-objective-edit, and file-backed cycle records**

```ts
// packages/server/src/__tests__/supervisor-manager.test.ts
it("creates a target on supervisor.create and stores its id on the supervisor", async () => {
  const { manager, targetStore } = createManagerHarness();

  const created = await manager.create({
    sessionId: "sess-1",
    workspaceId: "ws-1",
    objective: "Ship feature",
    evaluatorProviderId: "claude",
  });

  expect(created.targetId).toMatch(/^tgt_/);
  expect(targetStore.createTargetFiles).toHaveBeenCalledWith(
    "/workspace",
    expect.objectContaining({
      targetId: created.targetId,
      objective: "Ship feature",
    })
  );
});

it("supersedes the old target when supervisor.update changes the objective", async () => {
  const { manager, targetStore } = createManagerWithExistingSupervisor({
    targetId: "tgt-old",
    objective: "Old objective",
  });

  const updated = await manager.update("sup-1", {
    objective: "New objective",
  });

  expect(updated.targetId).not.toBe("tgt-old");
  expect(targetStore.markTargetSuperseded).toHaveBeenCalledWith(
    "/workspace",
    "tgt-old",
    updated.targetId,
    expect.any(Number)
  );
});

it("bootstraps the target plan on first trigger and appends the cycle record", async () => {
  const { manager, targetStore } = createManagerWithExistingSupervisor({
    targetId: "tgt-1",
    objective: "Ship feature",
  });

  targetStore.loadTargetMemory.mockResolvedValue({
    targetId: "tgt-1",
    planGenerated: false,
    plan: [],
    stalledCount: 0,
    updatedAt: 1,
  });

  const cycle = await manager.triggerEvaluation("sup-1");
  expect(cycle.trigger).toBe("manual");

  await waitFor(() => {
    expect(targetStore.saveTargetMemory).toHaveBeenCalledWith(
      "/workspace",
      "tgt-1",
      expect.objectContaining({
        planGenerated: true,
        plan: expect.arrayContaining([
          expect.objectContaining({ title: expect.any(String) }),
        ]),
      })
    );
    expect(targetStore.appendTargetCycleRecord).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the runtime tests and confirm failure**

Run: `pnpm vitest packages/server/src/supervisor/manager.test.ts packages/server/src/__tests__/supervisor-manager.test.ts packages/server/src/__tests__/supervisor-integration.test.ts packages/server/src/__tests__/supervisor-commands.test.ts --run`
Expected: FAIL because manager create/update/finish flow does not know about target files or structured evaluator results.

- [ ] **Step 3: Wire target store into `SupervisorManager` and create target files on create**

```ts
// packages/server/src/supervisor/manager.ts
export interface SupervisorManagerDeps {
  eventBus: EventBus;
  broadcaster: Broadcaster;
  terminalMgr: TerminalManager;
  workspaceMgr: WorkspaceManager;
  sessionMgr: SessionManager;
  providerRegistry: ProviderDefinition[];
  providerConfigRepo: ProviderConfigRepo;
  settingsRepo: Pick<SettingsRepo, "get">;
  supervisorRepo: SupervisorRepo;
  cycleRepo: SupervisorCycleRepo;
  cycleAttemptRepo: Pick<SupervisorCycleAttemptRepo, "create" | "update" | "listForCycle" | "deleteForCycle">;
  targetStore: {
    createTargetFiles: typeof import("./target-store.js").createTargetFiles;
    readTargetMeta: typeof import("./target-store.js").readTargetMeta;
    loadTargetMemory: typeof import("./target-store.js").loadTargetMemory;
    saveTargetMeta: typeof import("./target-store.js").saveTargetMeta;
    saveTargetMemory: typeof import("./target-store.js").saveTargetMemory;
    appendTargetCycleRecord: typeof import("./target-store.js").appendTargetCycleRecord;
    markTargetSuperseded: typeof import("./target-store.js").markTargetSuperseded;
    readTargetCycleRecords: typeof import("./target-store.js").readTargetCycleRecords;
  };
  logger?: FastifyBaseLogger;
  config?: SupervisorConfig;
}
```

Generate `targetId` during `create()`, persist it on the supervisor row, then call `targetStore.createTargetFiles(workspace.path, ...)`.

Also add a small `ensureTargetArtifacts(supervisor)` helper that runs during `hydrate()` and before evaluation:

- for upgraded legacy rows, if target files are missing, create them lazily from the current supervisor objective and `targetId`
- after loading memory, pass it into `contextBuilder.build(supervisor, targetMemory)`
- after cycle completion, refresh `recentTargetCycles` from `readTargetCycleRecords(..., 20)` before broadcasting the snapshot

- [ ] **Step 4: Supersede targets on objective edits and update file-backed memory during cycle completion**

```ts
// packages/server/src/supervisor/manager.ts
if (
  patch.objective !== undefined &&
  patch.objective.trim() !== current.objective
) {
  const nextTargetId = generateTargetId();
  await this.deps.targetStore.markTargetSuperseded(
    workspace.path,
    current.targetId,
    nextTargetId,
    Date.now()
  );
  await this.deps.targetStore.createTargetFiles(workspace.path, {
    targetId: nextTargetId,
    sessionId: current.sessionId,
    workspaceId: current.workspaceId,
    objective: patch.objective.trim(),
    createdAt: Date.now(),
  });
  nextPatch.targetId = nextTargetId;
}
```

When a cycle finishes with `status: "continue"`:

- load the current target memory
- if the evaluator returned bootstrap `plan`, save it with `planGenerated: true`
- otherwise apply only incremental updates: `stepUpdates`, `activeStepId`, `progressSummary`, `lastGuidance`, and `stalledCount`
- append the cycle record to `cycles.jsonl`
- refresh `currentTargetMemory` and `recentTargetCycles` on the in-memory supervisor snapshot before broadcasting

When the evaluator returns `status: "stop"`:

- append a stop record to `cycles.jsonl`
- update `meta.json` to `status: "completed"` with `completedAt`
- transition the runtime supervisor to `stopped`
- persist `stopReason`

When supervisor deletion disables an active target:

- update `meta.json` to `status: "cancelled"` unless the target was already `completed` or `superseded`
- keep the target directory on disk for inspection

- [ ] **Step 5: Wire the target store in server assembly and keep command payloads stable**

```ts
// packages/server/src/server.ts
import * as targetStore from "./supervisor/target-store.js";

supervisorMgr = new SupervisorManager({
  eventBus,
  broadcaster: wsHub,
  terminalMgr,
  workspaceMgr,
  sessionMgr,
  providerRegistry,
  providerConfigRepo,
  settingsRepo,
  supervisorRepo,
  cycleRepo,
  cycleAttemptRepo,
  targetStore,
  logger: app.log,
});
```

Keep `supervisor.create/update/delete/trigger` command names unchanged. The behavior change is internal: objective edits now rotate `targetId`. `packages/server/src/commands/supervisor.ts` should only need edits if the stricter return types force updates in the command tests or mocks.

- [ ] **Step 6: Run the runtime test set and verify it passes**

Run: `pnpm vitest packages/server/src/supervisor/manager.test.ts packages/server/src/__tests__/supervisor-manager.test.ts packages/server/src/__tests__/supervisor-integration.test.ts packages/server/src/__tests__/supervisor-commands.test.ts --run`
Expected: PASS with target creation, supersede behavior, first-trigger bootstrap, and cycle record appends covered.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/supervisor/manager.ts packages/server/src/server.ts packages/server/src/commands/supervisor.ts packages/server/src/supervisor/index.ts packages/server/src/supervisor/manager.test.ts packages/server/src/__tests__/supervisor-manager.test.ts packages/server/src/__tests__/supervisor-integration.test.ts packages/server/src/__tests__/supervisor-commands.test.ts
git commit -m "feat: add target-scoped supervisor runtime"
```

## Task 5: Render Current Target Memory And Recent Cycle History In The Web UI

**Files:**
- Modify: `packages/web/src/features/supervisor/atoms.ts`
- Modify: `packages/web/src/features/supervisor/actions/use-supervisor-actions.ts`
- Modify: `packages/web/src/features/supervisor/actions/use-objective-dialog-state.ts`
- Modify: `packages/web/src/features/supervisor/views/shared/supervisor-card.tsx`
- Modify: `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx`
- Modify: `packages/web/src/app/providers.tsx`
- Test: `packages/web/src/features/supervisor/components/supervisor-card.test.tsx`
- Test: `packages/web/src/features/supervisor/components/objective-dialog.test.tsx`
- Test: `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx`
- Test: `packages/web/src/app/providers.test.tsx`

- [ ] **Step 1: Write failing UI tests for target progress and recent cycle reasoning**

```tsx
// packages/web/src/features/supervisor/components/supervisor-card.test.tsx
it("renders the current target progress summary, active step, and recent cycle reasons", () => {
  const supervisor = createSupervisor({
    targetId: "tgt-1",
    currentTargetMemory: {
      targetId: "tgt-1",
      planGenerated: true,
      plan: [
        { id: "step-1", title: "Inspect current behavior", status: "done" },
        { id: "step-2", title: "Implement target store", status: "in_progress" },
      ],
      activeStepId: "step-2",
      progressSummary: "Target store implementation is in progress",
      lastGuidance: "Implement the target store",
      stalledCount: 1,
      updatedAt: 2,
    },
    recentTargetCycles: [
      {
        cycleId: "cycle-1",
        targetId: "tgt-1",
        startedAt: 1,
        completedAt: 2,
        result: "continue",
        reason: "Need the storage layer before wiring runtime",
        guidance: "Implement the target store",
        progressSummary: "Current behavior review is complete",
        activeStepId: "step-2",
        injected: true,
        attemptCount: 1,
      },
    ],
  });

  renderSupervisorCard(supervisor);

  expect(screen.getByText("Target store implementation is in progress")).toBeInTheDocument();
  expect(screen.getByText("Implement target store")).toBeInTheDocument();
  expect(screen.getByText("Need the storage layer before wiring runtime")).toBeInTheDocument();
  expect(screen.getByText("stalled: 1")).toBeInTheDocument();
});
```

```tsx
// packages/web/src/app/providers.test.tsx
it("stores enriched supervisor payloads with target memory and recent cycles", () => {
  routeEventToAtom("workspace.ws-1.session.sess-1.supervisor.state", {
    event: "updated",
    supervisor: {
      id: "sup-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      state: "idle",
      objective: "Ship feature",
      targetId: "tgt-1",
      evaluatorProviderId: "claude",
      maxSupervisionCount: 0,
      completedSupervisionCount: 0,
      cycles: [],
      currentTargetMemory: {
        targetId: "tgt-1",
        planGenerated: true,
        plan: [],
        stalledCount: 0,
        updatedAt: 1,
      },
      recentTargetCycles: [],
      createdAt: 1,
      updatedAt: 1,
    },
  }, store);

  expect(store.get(supervisorsAtom).get("sess-1")?.targetId).toBe("tgt-1");
  expect(store.get(supervisorsAtom).get("sess-1")?.currentTargetMemory?.targetId).toBe("tgt-1");
});
```

- [ ] **Step 2: Run the UI tests and confirm failure**

Run: `pnpm vitest packages/web/src/features/supervisor/components/supervisor-card.test.tsx packages/web/src/features/supervisor/components/objective-dialog.test.tsx packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx packages/web/src/app/providers.test.tsx --run`
Expected: FAIL because the supervisor payload and card UI do not yet know about target memory or recent target cycles.

- [ ] **Step 3: Route enriched supervisor payloads through atoms and derived actions**

```ts
// packages/web/src/features/supervisor/actions/use-supervisor-actions.ts
const currentTargetMemory = supervisor?.currentTargetMemory;
const recentTargetCycles = supervisor?.recentTargetCycles ?? [];
const activeStep = currentTargetMemory?.plan.find(
  (step) => step.id === currentTargetMemory.activeStepId
);

return {
  actionError,
  cycles,
  currentTargetMemory,
  recentTargetCycles,
  activeStep,
  progressSummary: currentTargetMemory?.progressSummary ?? null,
  stalledCount: currentTargetMemory?.stalledCount ?? 0,
  handlePause,
  handleResume,
  handleTrigger,
  isBusy: supervisor?.state === "evaluating" || supervisor?.state === "injecting",
  latestCycle,
  latestCycleText,
  openDialog,
  stopReasonLabel,
  stateClass: supervisor ? STATE_CLASSES[supervisor.state] : STATE_CLASSES.inactive,
  stateLabel: t(
    `supervisor.state.${supervisor ? supervisor.state : ("inactive" as SupervisorState)}`
  ),
  supervisor,
};
```

- [ ] **Step 4: Render target summary and recent cycle reasoning on desktop and mobile**

```tsx
// packages/web/src/features/supervisor/views/shared/supervisor-card.tsx
{progressSummary ? (
  <div className="supervisor-progress-summary" role="status">
    {progressSummary}
  </div>
) : null}

{activeStep ? (
  <div className="supervisor-active-step">
    <span className="supervisor-active-step__label">Current step</span>
    <span className="supervisor-active-step__value">{activeStep.title}</span>
  </div>
) : null}

{typeof stalledCount === "number" ? (
  <div className="supervisor-stalled-count">stalled: {stalledCount}</div>
) : null}

{currentTargetMemory?.plan.length ? (
  <ol className="supervisor-plan-list" aria-label="Current target plan">
    {currentTargetMemory.plan.map((step) => (
      <li key={step.id} data-status={step.status} data-active={step.id === currentTargetMemory.activeStepId}>
        <span>{step.title}</span>
      </li>
    ))}
  </ol>
) : null}

{recentTargetCycles.length ? (
  <ol className="supervisor-target-cycle-list" aria-label="Recent target cycles">
    {recentTargetCycles.map((cycle) => (
      <li key={cycle.cycleId}>
        <strong>{cycle.result}</strong>
        <span>{cycle.reason ?? cycle.errorReason}</span>
      </li>
    ))}
  </ol>
) : null}
```

Because `mobile-supervisor-sheet.tsx` already renders `SupervisorCard`, prefer keeping the new target/memory UI in `SupervisorCard`. Only touch the mobile sheet if the larger card needs spacing, scroll, or footer adjustments.

- [ ] **Step 5: Run the UI test set and verify it passes**

Run: `pnpm vitest packages/web/src/features/supervisor/components/supervisor-card.test.tsx packages/web/src/features/supervisor/components/objective-dialog.test.tsx packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx packages/web/src/app/providers.test.tsx --run`
Expected: PASS with enriched supervisor payloads rendered in both desktop and mobile surfaces.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/features/supervisor/atoms.ts packages/web/src/features/supervisor/actions/use-supervisor-actions.ts packages/web/src/features/supervisor/actions/use-objective-dialog-state.ts packages/web/src/features/supervisor/views/shared/supervisor-card.tsx packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx packages/web/src/app/providers.tsx packages/web/src/features/supervisor/components/supervisor-card.test.tsx packages/web/src/features/supervisor/components/objective-dialog.test.tsx packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx packages/web/src/app/providers.test.tsx
git commit -m "feat: show supervisor target memory and cycle history"
```

## Task 6: Run End-To-End Verification And Update The Written Plan If Needed

**Files:**
- Modify: `docs/superpowers/plans/2026-05-12-supervisor-target-scoped-memory-implementation.md` if verification reveals scope or naming drift

- [ ] **Step 1: Run the focused server and web supervisor test suites**

Run:

```bash
pnpm vitest \
  packages/server/src/supervisor/target-store.test.ts \
  packages/server/src/supervisor/context-builder.test.ts \
  packages/server/src/supervisor/evaluator.test.ts \
  packages/server/src/supervisor/evaluator.windows.test.ts \
  packages/server/src/supervisor/manager.test.ts \
  packages/server/src/__tests__/supervisor-manager.test.ts \
  packages/server/src/__tests__/supervisor-integration.test.ts \
  packages/server/src/__tests__/supervisor-commands.test.ts \
  packages/server/src/__tests__/supervisor-repo.test.ts \
  packages/server/src/storage/db.test.ts \
  packages/server/src/__tests__/db.test.ts \
  packages/web/src/features/supervisor/components/supervisor-card.test.tsx \
  packages/web/src/features/supervisor/components/objective-dialog.test.tsx \
  packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx \
  packages/web/src/app/providers.test.tsx \
  --run
```

Expected: PASS. If failures expose plan/spec drift, update the implementation and amend this plan document before proceeding.

- [ ] **Step 2: Run a repo-level typecheck or equivalent package checks touching changed code**

Run:

```bash
pnpm --filter @coder-studio/server exec tsc --noEmit
pnpm --filter @coder-studio/web exec tsc --noEmit
```

Expected: PASS with no new type errors in supervisor domain, server wiring, or web UI.

- [ ] **Step 3: Review workspace target artifacts manually in a local run**

Run:

```bash
pnpm dev
```

Manual expectations:

- enabling supervisor creates `.coder-studio/supervisor/targets/<targetId>/meta.json`
- first manual trigger creates or fills `memory.json` with a generated plan
- repeated triggers append newline-delimited records to `cycles.jsonl`
- editing the objective creates a new `targetId` and marks the old target `superseded`
- the UI shows current step, progress summary, stalled count, and recent cycle reasons

If local manual validation is not possible in the execution environment, note that explicitly in the final handoff.

- [ ] **Step 4: Commit verification fixes if any were needed**

```bash
git add -A
git commit -m "test: verify supervisor target-scoped memory flow"
```

Only make this commit if verification uncovered real code fixes.

## Self-Review

### Spec coverage

This plan covers:

- target-scoped memory under `.coder-studio/supervisor/targets/`
- `meta.json`, `memory.json`, and `cycles.jsonl`
- migration of existing supervisor rows through a real `v2 -> v3` database upgrade path
- first-trigger plan bootstrap
- `continue` / `stop` evaluator result shape
- objective edits creating new targets
- removal of git from the primary supervision signal
- UI rendering of current target progress and recent cycle reasoning

### Placeholder scan

No `TODO`, `TBD`, or "implement later" placeholders remain. Each task names exact files, verification commands, and expected outcomes.

### Type consistency

The plan consistently uses:

- `targetId`
- `SupervisorTargetMemory`
- `SupervisorCycleTargetRecord`
- evaluator result `status: "continue" | "stop"`
- stop reasons `objective_complete | supervisor_uncertain | needs_user_input`
- database schema version `3` with explicit `v1 -> v2 -> v3` and `v2 -> v3` upgrade handling

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-12-supervisor-target-scoped-memory-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
