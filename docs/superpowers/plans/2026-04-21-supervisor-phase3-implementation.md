# Supervisor Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 3 supervisor system as a persisted, event-driven, per-session objective tracker that evaluates on `turn_completed` or manual trigger, supports per-supervisor `claude` / `codex` evaluator selection, and injects guidance through real terminal input semantics.

**Architecture:** The implementation replaces the current timer-based MVP with a persisted state machine backed by SQLite repos, an event-driven scheduler subscribed to `session.lifecycle`, a transcript-first context builder, and a provider-driven headless evaluator. The web UI stays server-authoritative: `supervisor.get` hydrates once per session, WebSocket events keep atoms fresh, and the enable/edit/disable dialog exposes objective plus evaluator-provider selection without any `intervalMs` control.

**Tech Stack:** TypeScript, SQLite (`better-sqlite3`), Vitest, Playwright, Fastify WebSocket, Jotai, provider CLIs (`claude -p`, `codex exec`), existing `@coder-studio/core` / `@coder-studio/providers` abstractions.

---

## File Structure

### Core contracts
```text
packages/core/src/
├── domain/supervisor.ts            # supervisor entities, cycle metadata, config constants
├── domain/events.ts                # session lifecycle event types already consumed by scheduler
└── provider/definition.ts          # provider headless-eval + transcript-excerpt capabilities
```

### Provider integrations
```text
packages/providers/src/
├── claude/
│   ├── definition.ts               # wire headless eval + transcript excerpt reader
│   ├── supervisor-eval.ts          # claude -p command builder
│   └── transcript-excerpt.ts       # Claude transcript JSONL excerpt reader
└── codex/
    ├── definition.ts               # wire headless eval + transcript excerpt reader
    ├── supervisor-eval.ts          # codex exec command builder
    └── transcript-excerpt.ts       # Codex rollout JSONL excerpt reader
```

### Server persistence and runtime
```text
packages/server/src/
├── storage/
│   ├── migrations/003_supervisors.sql              # supervisor + cycle tables
│   ├── repositories/supervisor-repo.ts             # persisted supervisor CRUD + startup restore list
│   ├── repositories/supervisor-cycle-repo.ts       # cycle CRUD + retention pruning
│   └── index.ts                                    # export new repos
├── supervisor/
│   ├── context-builder.ts                          # transcript / terminal / git evaluation context
│   ├── evaluator.ts                                # provider headless runner + JSON validation
│   ├── injector.ts                                 # real PTY input semantics + dedupe guard
│   ├── scheduler.ts                                # subscribe to session.lifecycle turn_completed
│   └── manager.ts                                  # authoritative state machine + repo coordination
├── commands/supervisor.ts                          # create/get/update/delete/pause/resume/trigger
└── server.ts                                       # instantiate repos + hydrate manager on boot
```

### Web UI
```text
packages/web/src/
├── app/providers.tsx                               # route supervisor events into atoms
├── features/agent-panes/components/session-card.tsx# hydrate + render supervisor region
├── features/supervisor/atoms.ts                    # dialog draft state + hydration flag atoms
├── features/supervisor/hooks/use-supervisor.ts     # hydrate + command helpers
├── features/supervisor/components/supervisor-card.tsx
├── features/supervisor/components/objective-dialog.tsx
└── styles/components.css                           # supervisor progress/history/dialog styling
```

### Tests
```text
packages/server/src/__tests__/
├── supervisor-commands.test.ts
├── supervisor-repo.test.ts
└── supervisor-integration.test.ts

packages/server/src/supervisor/
├── context-builder.test.ts
├── evaluator.test.ts
├── injector.test.ts
├── manager.test.ts
└── scheduler.test.ts

packages/providers/src/
├── claude/definition.test.ts
├── claude/transcript-excerpt.test.ts
├── codex/definition.test.ts
└── codex/transcript-excerpt.test.ts

packages/web/src/
├── app/providers.test.tsx
├── features/supervisor/components/supervisor-card.test.tsx
├── features/supervisor/components/objective-dialog.test.tsx
└── features/agent-panes/components/session-card.test.tsx

e2e/specs/phase3/supervisor.spec.ts
```

## Execution Notes

- This plan intentionally removes all `intervalMs` and periodic fallback logic from Phase 3. Do not add UI fields, DB columns, command args, timers, or polling loops for that capability.
- Automatic evaluation is triggered only by `session.lifecycle.turn_completed`; manual re-evaluation remains `supervisor.trigger`.
- Guidance injection must use the same PTY input path as `terminal.input`, not `writeToSession()` screen echo.
- `packages/web/src/app/providers.tsx` already has local modifications in the working tree. Re-read and merge carefully during Task 6 instead of overwriting the file wholesale.

### Task 1: Normalize Core Contracts And Supervisor Commands

**Files:**
- Modify: `packages/core/src/domain/supervisor.ts`
- Modify: `packages/core/src/provider/definition.ts`
- Modify: `packages/server/src/commands/supervisor.ts`
- Test: `packages/server/src/__tests__/supervisor-commands.test.ts`

- [ ] **Step 1: Write the failing command contract tests**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, type CommandContext } from '../ws/dispatch.js';

import '../commands/supervisor.js';

describe('supervisor commands', () => {
  const supervisorMgr = {
    create: vi.fn(async (input) => ({
      id: 'sup-1',
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      state: 'idle',
      objective: input.objective,
      evaluatorProviderId: input.evaluatorProviderId,
      cycles: [],
      createdAt: 1,
      updatedAt: 1,
    })),
    getBySession: vi.fn(() => null),
    update: vi.fn(async (id, patch) => ({
      id,
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
      state: 'idle',
      objective: patch.objective ?? 'existing objective',
      evaluatorProviderId: patch.evaluatorProviderId ?? 'claude',
      cycles: [],
      createdAt: 1,
      updatedAt: 2,
    })),
    delete: vi.fn(async () => {}),
    pause: vi.fn(),
    resume: vi.fn(),
    triggerEvaluation: vi.fn(),
  };

  let ctx: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = {
      db: {} as any,
      workspaceMgr: {} as any,
      sessionMgr: {} as any,
      terminalMgr: {} as any,
      hooksMgr: {} as any,
      eventBus: {} as any,
      broadcaster: { broadcast: vi.fn() } as any,
      providerRegistry: [],
      fencingMgr: {} as any,
      supervisorMgr: supervisorMgr as any,
    };
  });

  it('passes evaluatorProviderId through supervisor.create', async () => {
    const result = await dispatch(
      {
        kind: 'command',
        id: 'cmd-1',
        op: 'supervisor.create',
        args: {
          sessionId: 'sess-1',
          workspaceId: 'ws-1',
          objective: 'Ship supervisor persistence',
          evaluatorProviderId: 'codex',
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(supervisorMgr.create).toHaveBeenCalledWith(
      expect.objectContaining({ evaluatorProviderId: 'codex' })
    );
  });

  it('rejects legacy intervalMs on supervisor.create', async () => {
    const result = await dispatch(
      {
        kind: 'command',
        id: 'cmd-2',
        op: 'supervisor.create',
        args: {
          sessionId: 'sess-1',
          workspaceId: 'ws-1',
          objective: 'Ship supervisor persistence',
          evaluatorProviderId: 'claude',
          intervalMs: 60000,
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('validation_error');
  });

  it('passes evaluatorProviderId through supervisor.update', async () => {
    const result = await dispatch(
      {
        kind: 'command',
        id: 'cmd-3',
        op: 'supervisor.update',
        args: {
          id: 'sup-1',
          evaluatorProviderId: 'codex',
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(supervisorMgr.update).toHaveBeenCalledWith('sup-1', {
      evaluatorProviderId: 'codex',
      objective: undefined,
    });
  });
});
```

- [ ] **Step 2: Run the command tests to verify the current MVP fails**

Run: `pnpm --dir packages/server exec vitest run src/__tests__/supervisor-commands.test.ts`
Expected: FAIL because `supervisor.create`/`supervisor.update` still use `intervalMs` and never pass `evaluatorProviderId` through to `SupervisorManager`.

- [ ] **Step 3: Update the core types and command schemas**

```ts
// packages/core/src/domain/supervisor.ts
export type CycleTrigger = 'turn_completed' | 'manual';

export type EvidenceSource = 'transcript' | 'terminal_fallback';

export interface SupervisorCycle {
  id: string;
  supervisorId: string;
  sessionId: string;
  status: CycleStatus;
  trigger: CycleTrigger;
  evidenceSource: EvidenceSource;
  objective: string;
  evaluatorProviderId: string;
  turnId?: string;
  progress?: number;
  result?: string;
  injectedGuidance?: string;
  createdAt: number;
  completedAt?: number;
  errorReason?: string;
}

export interface Supervisor {
  id: string;
  sessionId: string;
  workspaceId: string;
  state: SupervisorState;
  objective: string;
  evaluatorProviderId: string;
  cycles: SupervisorCycle[];
  lastCycleAt?: number;
  lastEvaluatedTurnId?: string;
  errorReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SupervisorConfig {
  maxCyclesPerSession: number;
  terminalLinesForEvaluation: number;
  guidanceMaxChars: number;
}

export const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig = {
  maxCyclesPerSession: 100,
  terminalLinesForEvaluation: 500,
  guidanceMaxChars: 2000,
};
```

```ts
// packages/core/src/provider/definition.ts
export interface SupervisorEvalCommandRequest {
  prompt: string;
  sessionId: string;
  workspacePath: string;
  apiKey?: string;
  model?: string;
}

export interface TranscriptExcerptRequest {
  transcriptPath: string;
  maxChars: number;
  maxTurns: number;
}

export interface ProviderDefinition {
  id: string;
  displayName: string;
  badge: string;
  capability: 'full' | 'limited' | 'unsupported';
  buildCommand(config: ProviderConfig, ctx: LaunchContext): {
    argv: string[];
    env: Record<string, string>;
    cwd: string;
  };
  buildResumeCommand?(
    resumeId: string,
    config: ProviderConfig,
    ctx: LaunchContext
  ):
    | {
        argv: string[];
        env: Record<string, string>;
        cwd: string;
      }
    | null;
  buildSupervisorEvalCommand?(
    config: ProviderConfig,
    req: SupervisorEvalCommandRequest
  ):
    | {
        argv: string[];
        cwd?: string;
        env?: Record<string, string>;
      }
    | null;
  readTranscriptExcerpt?(
    req: TranscriptExcerptRequest
  ): Promise<
    | {
        excerpt: string;
        lastTurnId?: string;
      }
    | null
  >;
  configSchema: ZodSchema<ProviderConfig>;
  defaultConfig: ProviderConfig;
  requiredCommands: string[];
  hooks: HooksDescriptor;
  resolveTranscriptPath?(session: Session): Promise<string | null>;
}
```

```ts
// packages/server/src/commands/supervisor.ts
import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';

const supervisorObjectiveSchema = z.string().trim().min(1).max(4000);

registerCommand(
  'supervisor.create',
  z
    .object({
      sessionId: z.string(),
      workspaceId: z.string(),
      objective: supervisorObjectiveSchema,
      evaluatorProviderId: z.string(),
    })
    .strict(),
  async (args, ctx) => {
    return {
      supervisor: await ctx.supervisorMgr.create({
        sessionId: args.sessionId,
        workspaceId: args.workspaceId,
        objective: args.objective,
        evaluatorProviderId: args.evaluatorProviderId,
      }),
    };
  }
);

registerCommand(
  'supervisor.update',
  z
    .object({
      id: z.string(),
      objective: supervisorObjectiveSchema.optional(),
      evaluatorProviderId: z.string().optional(),
    })
    .strict()
    .refine(
      (input) => input.objective !== undefined || input.evaluatorProviderId !== undefined,
      'objective or evaluatorProviderId is required'
    ),
  async (args, ctx) => {
    return {
      supervisor: await ctx.supervisorMgr.update(args.id, {
        objective: args.objective,
        evaluatorProviderId: args.evaluatorProviderId,
      }),
    };
  }
);
```

- [ ] **Step 4: Run build and targeted tests**

Run: `pnpm --dir packages/core build && pnpm --dir packages/server exec vitest run src/__tests__/supervisor-commands.test.ts`
Expected: PASS with `supervisor.create`/`supervisor.update` forwarding `evaluatorProviderId`, and legacy `intervalMs` rejected by schema validation.

- [ ] **Step 5: Commit the contract cleanup**

```bash
git add packages/core/src/domain/supervisor.ts packages/core/src/provider/definition.ts packages/server/src/commands/supervisor.ts packages/server/src/__tests__/supervisor-commands.test.ts
git commit -m "feat(supervisor): normalize phase3 contracts"
```

### Task 2: Add Persistent Supervisor Repositories And Migration

**Files:**
- Create: `packages/server/src/storage/migrations/003_supervisors.sql`
- Create: `packages/server/src/storage/repositories/supervisor-repo.ts`
- Create: `packages/server/src/storage/repositories/supervisor-cycle-repo.ts`
- Modify: `packages/server/src/storage/index.ts`
- Modify: `packages/server/src/storage/db.test.ts`
- Test: `packages/server/src/__tests__/supervisor-repo.test.ts`

- [ ] **Step 1: Write the failing persistence tests**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase, openDatabase, SupervisorCycleRepo, SupervisorRepo } from '../storage/index.js';

describe('SupervisorRepo', () => {
  let tempDir: string;
  let db: ReturnType<typeof openDatabase>;
  let supervisorRepo: SupervisorRepo;
  let cycleRepo: SupervisorCycleRepo;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'supervisor-repo-'));
    db = openDatabase(join(tempDir, 'test.db'));

    db.prepare(
      'INSERT INTO workspaces (id, path, target_runtime, opened_at, last_active_at, ui_state) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('ws-1', tempDir, 'native', 1, 1, '{}');
    db.prepare(
      'INSERT INTO terminals (id, workspace_id, kind, cwd, argv, cols, rows, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('term-1', 'ws-1', 'agent', tempDir, '[]', 120, 30, 1);
    db.prepare(
      'INSERT INTO sessions (id, workspace_id, terminal_id, provider_id, resume_id, capability, state, started_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('sess-1', 'ws-1', 'term-1', 'claude', null, 'full', 'idle', 1, 1);

    supervisorRepo = new SupervisorRepo(db);
    cycleRepo = new SupervisorCycleRepo(db);
  });

  afterEach(() => {
    closeDatabase(db);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists evaluatorProviderId and lastEvaluatedTurnId', () => {
    supervisorRepo.create({
      id: 'sup-1',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
      state: 'idle',
      objective: 'Finish supervisor persistence',
      evaluatorProviderId: 'codex',
      lastEvaluatedTurnId: 'turn-7',
      createdAt: 10,
      updatedAt: 10,
    });

    const stored = supervisorRepo.getBySessionId('sess-1');
    expect(stored?.evaluatorProviderId).toBe('codex');
    expect(stored?.lastEvaluatedTurnId).toBe('turn-7');
  });

  it('prunes cycles beyond max retention', () => {
    supervisorRepo.create({
      id: 'sup-1',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
      state: 'idle',
      objective: 'Keep the newest 100 cycles',
      evaluatorProviderId: 'claude',
      createdAt: 10,
      updatedAt: 10,
    });

    for (let i = 0; i < 101; i += 1) {
      cycleRepo.create({
        id: `cycle-${i}`,
        supervisorId: 'sup-1',
        sessionId: 'sess-1',
        status: 'completed',
        trigger: 'manual',
        evidenceSource: 'terminal_fallback',
        objective: 'Keep the newest 100 cycles',
        evaluatorProviderId: 'claude',
        createdAt: i,
        completedAt: i,
      });
    }

    cycleRepo.pruneOldest('sup-1', 100);

    const cycles = cycleRepo.listRecentForSupervisor('sup-1', 200);
    expect(cycles).toHaveLength(100);
    expect(cycles.some((cycle) => cycle.id === 'cycle-0')).toBe(false);
    expect(cycles[0]?.id).toBe('cycle-100');
  });
});
```

- [ ] **Step 2: Run the new persistence tests and migration test**

Run: `pnpm --dir packages/server exec vitest run src/__tests__/supervisor-repo.test.ts src/storage/db.test.ts`
Expected: FAIL because the `003_supervisors.sql` migration and both repository classes do not exist yet.

- [ ] **Step 3: Add the migration, repositories, and exports**

```sql
-- packages/server/src/storage/migrations/003_supervisors.sql
CREATE TABLE supervisors (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  objective TEXT NOT NULL,
  evaluator_provider_id TEXT NOT NULL,
  last_cycle_at INTEGER,
  last_evaluated_turn_id TEXT,
  error_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_supervisors_workspace ON supervisors(workspace_id);
CREATE INDEX idx_supervisors_session ON supervisors(session_id);

CREATE TABLE supervisor_cycles (
  id TEXT PRIMARY KEY,
  supervisor_id TEXT NOT NULL REFERENCES supervisors(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
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

CREATE INDEX idx_supervisor_cycles_supervisor ON supervisor_cycles(supervisor_id, created_at DESC);
CREATE INDEX idx_supervisor_cycles_session ON supervisor_cycles(session_id, created_at DESC);
```

```ts
// packages/server/src/storage/repositories/supervisor-repo.ts
import type Database from 'better-sqlite3';
import type { Supervisor, SupervisorState } from '@coder-studio/core';

export interface NewSupervisor {
  id: string;
  sessionId: string;
  workspaceId: string;
  state: SupervisorState;
  objective: string;
  evaluatorProviderId: string;
  lastCycleAt?: number;
  lastEvaluatedTurnId?: string;
  errorReason?: string;
  createdAt: number;
  updatedAt: number;
}

export class SupervisorRepo {
  constructor(private readonly db: Database.Database) {}

  create(input: NewSupervisor): Supervisor {
    this.db.prepare(
      `INSERT INTO supervisors (id, session_id, workspace_id, state, objective, evaluator_provider_id, last_cycle_at, last_evaluated_turn_id, error_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.sessionId,
      input.workspaceId,
      input.state,
      input.objective,
      input.evaluatorProviderId,
      input.lastCycleAt ?? null,
      input.lastEvaluatedTurnId ?? null,
      input.errorReason ?? null,
      input.createdAt,
      input.updatedAt
    );

    return this.findById(input.id)!;
  }

  findById(id: string): Supervisor | undefined {
    const row = this.db.prepare('SELECT * FROM supervisors WHERE id = ?').get(id) as any;
    return row ? this.rowToSupervisor(row) : undefined;
  }

  getBySessionId(sessionId: string): Supervisor | undefined {
    const row = this.db.prepare('SELECT * FROM supervisors WHERE session_id = ?').get(sessionId) as any;
    return row ? this.rowToSupervisor(row) : undefined;
  }

  listAll(): Supervisor[] {
    const rows = this.db.prepare('SELECT * FROM supervisors ORDER BY created_at ASC').all() as any[];
    return rows.map((row) => this.rowToSupervisor(row));
  }

  update(id: string, patch: Partial<NewSupervisor>): Supervisor {
    this.db.prepare(
      `UPDATE supervisors
       SET state = COALESCE(@state, state),
           objective = COALESCE(@objective, objective),
           evaluator_provider_id = COALESCE(@evaluatorProviderId, evaluator_provider_id),
           last_cycle_at = COALESCE(@lastCycleAt, last_cycle_at),
           last_evaluated_turn_id = COALESCE(@lastEvaluatedTurnId, last_evaluated_turn_id),
           error_reason = @errorReason,
           updated_at = @updatedAt
       WHERE id = @id`
    ).run({
      id,
      state: patch.state ?? null,
      objective: patch.objective ?? null,
      evaluatorProviderId: patch.evaluatorProviderId ?? null,
      lastCycleAt: patch.lastCycleAt ?? null,
      lastEvaluatedTurnId: patch.lastEvaluatedTurnId ?? null,
      errorReason: patch.errorReason ?? null,
      updatedAt: patch.updatedAt ?? Date.now(),
    });

    return this.findById(id)!;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM supervisors WHERE id = ?').run(id);
  }

  private rowToSupervisor(row: any): Supervisor {
    return {
      id: row.id,
      sessionId: row.session_id,
      workspaceId: row.workspace_id,
      state: row.state,
      objective: row.objective,
      evaluatorProviderId: row.evaluator_provider_id,
      cycles: [],
      lastCycleAt: row.last_cycle_at ?? undefined,
      lastEvaluatedTurnId: row.last_evaluated_turn_id ?? undefined,
      errorReason: row.error_reason ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
```

```ts
// packages/server/src/storage/repositories/supervisor-cycle-repo.ts
import type Database from 'better-sqlite3';
import type { SupervisorCycle } from '@coder-studio/core';

export class SupervisorCycleRepo {
  constructor(private readonly db: Database.Database) {}

  create(input: SupervisorCycle): SupervisorCycle {
    this.db.prepare(
      `INSERT INTO supervisor_cycles (id, supervisor_id, session_id, status, trigger, evidence_source, objective, evaluator_provider_id, turn_id, progress, result, injected_guidance, error_reason, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.supervisorId,
      input.sessionId,
      input.status,
      input.trigger,
      input.evidenceSource,
      input.objective,
      input.evaluatorProviderId,
      input.turnId ?? null,
      input.progress ?? null,
      input.result ?? null,
      input.injectedGuidance ?? null,
      input.errorReason ?? null,
      input.createdAt,
      input.completedAt ?? null
    );

    return this.findById(input.id)!;
  }

  findById(id: string): SupervisorCycle | undefined {
    const row = this.db.prepare('SELECT * FROM supervisor_cycles WHERE id = ?').get(id) as any;
    return row ? this.rowToCycle(row) : undefined;
  }

  listRecentForSupervisor(supervisorId: string, limit: number): SupervisorCycle[] {
    const rows = this.db.prepare(
      'SELECT * FROM supervisor_cycles WHERE supervisor_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(supervisorId, limit) as any[];
    return rows.map((row) => this.rowToCycle(row));
  }

  update(id: string, patch: Partial<SupervisorCycle>): SupervisorCycle {
    this.db.prepare(
      `UPDATE supervisor_cycles
       SET status = COALESCE(@status, status),
           progress = COALESCE(@progress, progress),
           result = COALESCE(@result, result),
           injected_guidance = COALESCE(@injectedGuidance, injected_guidance),
           error_reason = COALESCE(@errorReason, error_reason),
           completed_at = COALESCE(@completedAt, completed_at)
       WHERE id = @id`
    ).run({
      id,
      status: patch.status ?? null,
      progress: patch.progress ?? null,
      result: patch.result ?? null,
      injectedGuidance: patch.injectedGuidance ?? null,
      errorReason: patch.errorReason ?? null,
      completedAt: patch.completedAt ?? null,
    });

    return this.findById(id)!;
  }

  pruneOldest(supervisorId: string, keep: number): void {
    this.db.prepare(
      `DELETE FROM supervisor_cycles
       WHERE id IN (
         SELECT id FROM supervisor_cycles
         WHERE supervisor_id = ?
         ORDER BY created_at DESC
         LIMIT -1 OFFSET ?
       )`
    ).run(supervisorId, keep);
  }

  private rowToCycle(row: any): SupervisorCycle {
    return {
      id: row.id,
      supervisorId: row.supervisor_id,
      sessionId: row.session_id,
      status: row.status,
      trigger: row.trigger,
      evidenceSource: row.evidence_source,
      objective: row.objective,
      evaluatorProviderId: row.evaluator_provider_id,
      turnId: row.turn_id ?? undefined,
      progress: row.progress ?? undefined,
      result: row.result ?? undefined,
      injectedGuidance: row.injected_guidance ?? undefined,
      errorReason: row.error_reason ?? undefined,
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
    };
  }
}
```

```ts
// packages/server/src/storage/index.ts
export { SupervisorRepo, type NewSupervisor } from './repositories/supervisor-repo.js';
export { SupervisorCycleRepo } from './repositories/supervisor-cycle-repo.js';
```

```ts
// packages/server/src/storage/db.test.ts
it('migration 003 creates supervisor tables and indexes', async () => {
  const { runMigrations } = await import('./db');
  const db = new Database(dbPath);
  runMigrations(db);

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
  expect(tables.map((item) => item.name)).toEqual(
    expect.arrayContaining(['supervisors', 'supervisor_cycles'])
  );

  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>;
  expect(indexes.map((item) => item.name)).toEqual(
    expect.arrayContaining([
      'idx_supervisors_workspace',
      'idx_supervisors_session',
      'idx_supervisor_cycles_supervisor',
      'idx_supervisor_cycles_session',
    ])
  );

  db.close();
});
```

- [ ] **Step 4: Run the persistence suite again**

Run: `pnpm --dir packages/server build && pnpm --dir packages/server exec vitest run src/__tests__/supervisor-repo.test.ts src/storage/db.test.ts`
Expected: PASS with `003_supervisors` applied, repo CRUD working, and cycle pruning limited to the newest 100 rows.

- [ ] **Step 5: Commit the persistence layer**

```bash
git add packages/server/src/storage/migrations/003_supervisors.sql packages/server/src/storage/repositories/supervisor-repo.ts packages/server/src/storage/repositories/supervisor-cycle-repo.ts packages/server/src/storage/index.ts packages/server/src/storage/db.test.ts packages/server/src/__tests__/supervisor-repo.test.ts
git commit -m "feat(supervisor): persist supervisors and cycles"
```

### Task 3: Add Provider Headless Eval And Transcript Excerpts

**Files:**
- Create: `packages/providers/src/claude/supervisor-eval.ts`
- Create: `packages/providers/src/claude/transcript-excerpt.ts`
- Modify: `packages/providers/src/claude/definition.ts`
- Modify: `packages/providers/src/claude/definition.test.ts`
- Create: `packages/providers/src/claude/transcript-excerpt.test.ts`
- Create: `packages/providers/src/codex/supervisor-eval.ts`
- Create: `packages/providers/src/codex/transcript-excerpt.ts`
- Modify: `packages/providers/src/codex/definition.ts`
- Modify: `packages/providers/src/codex/definition.test.ts`
- Create: `packages/providers/src/codex/transcript-excerpt.test.ts`

- [ ] **Step 1: Write the failing provider tests**

```ts
// packages/providers/src/claude/definition.test.ts
it('builds a supervisor eval command with claude -p', () => {
  const result = claudeDefinition.buildSupervisorEvalCommand?.(
    {
      model: 'claude-sonnet-4-6',
      maxTurns: null,
      additionalArgs: [],
      envVars: { ANTHROPIC_API_KEY: 'sk-test' },
    },
    {
      prompt: 'Return strict JSON',
      sessionId: 'sess-1',
      workspacePath: '/workspace',
    }
  );

  expect(result?.argv[0]).toBe('claude');
  expect(result?.argv).toContain('-p');
  expect(result?.cwd).toBe('/workspace');
  expect(result?.env?.ANTHROPIC_API_KEY).toBe('sk-test');
});
```

```ts
// packages/providers/src/codex/definition.test.ts
it('builds a supervisor eval command with codex exec', () => {
  const result = codexDefinition.buildSupervisorEvalCommand?.(
    {
      additionalArgs: [],
      envVars: { OPENAI_API_KEY: 'sk-openai' },
      cwd: '/workspace',
    },
    {
      prompt: 'Return strict JSON',
      sessionId: 'sess-1',
      workspacePath: '/workspace',
    }
  );

  expect(result?.argv.slice(0, 2)).toEqual(['codex', 'exec']);
  expect(result?.cwd).toBe('/workspace');
  expect(result?.env?.OPENAI_API_KEY).toBe('sk-openai');
});
```

```ts
// packages/providers/src/claude/transcript-excerpt.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readClaudeTranscriptExcerpt } from './transcript-excerpt.js';

describe('readClaudeTranscriptExcerpt', () => {
  let tempDir: string;
  let transcriptPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'claude-transcript-'));
    transcriptPath = join(tempDir, 'session.jsonl');
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'Build the repo layer' }] }, turn_id: 'turn-1' }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Created supervisor repo and cycle repo.' }] }, turn_id: 'turn-1' }),
      ].join('\n')
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns excerpt text and lastTurnId', async () => {
    const result = await readClaudeTranscriptExcerpt({ transcriptPath, maxChars: 500, maxTurns: 5 });
    expect(result?.excerpt).toContain('Created supervisor repo and cycle repo.');
    expect(result?.lastTurnId).toBe('turn-1');
  });
});
```

```ts
// packages/providers/src/codex/transcript-excerpt.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCodexTranscriptExcerpt } from './transcript-excerpt.js';

describe('readCodexTranscriptExcerpt', () => {
  let tempDir: string;
  let transcriptPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'codex-transcript-'));
    transcriptPath = join(tempDir, 'rollout.jsonl');
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({ type: 'message', role: 'user', content: 'Implement the evaluator runner', turn_id: 'turn-9' }),
        JSON.stringify({ type: 'message', role: 'assistant', content: 'Implemented a spawn-based runner with timeout.', turn_id: 'turn-9' }),
      ].join('\n')
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns excerpt text and lastTurnId', async () => {
    const result = await readCodexTranscriptExcerpt({ transcriptPath, maxChars: 500, maxTurns: 5 });
    expect(result?.excerpt).toContain('spawn-based runner');
    expect(result?.lastTurnId).toBe('turn-9');
  });
});
```

- [ ] **Step 2: Run the provider tests to confirm the new capability is missing**

Run: `pnpm --dir packages/providers exec vitest run src/claude/definition.test.ts src/codex/definition.test.ts src/claude/transcript-excerpt.test.ts src/codex/transcript-excerpt.test.ts`
Expected: FAIL because neither provider exposes `buildSupervisorEvalCommand` or `readTranscriptExcerpt` yet.

- [ ] **Step 3: Implement the provider helpers and wire them into each definition**

```ts
// packages/providers/src/claude/supervisor-eval.ts
import type { ProviderConfig, SupervisorEvalCommandRequest } from '@coder-studio/core';
import type { ClaudeConfig } from './config-schema.js';

export function buildClaudeSupervisorEvalCommand(
  config: ProviderConfig,
  req: SupervisorEvalCommandRequest
) {
  const cfg = config as ClaudeConfig;
  return {
    argv: [
      'claude',
      '-p',
      req.prompt,
      '--output-format',
      'json',
      ...(req.model ?? cfg.model ? ['--model', (req.model ?? cfg.model)!] : []),
    ],
    cwd: req.workspacePath,
    env: {
      ...cfg.envVars,
      ...(req.apiKey ? { ANTHROPIC_API_KEY: req.apiKey } : {}),
      CODER_STUDIO_SESSION_ID: req.sessionId,
    },
  };
}
```

```ts
// packages/providers/src/codex/supervisor-eval.ts
import type { ProviderConfig, SupervisorEvalCommandRequest } from '@coder-studio/core';

type CodexConfig = ProviderConfig & { additionalArgs?: string[]; envVars?: Record<string, string>; cwd?: string };

export function buildCodexSupervisorEvalCommand(
  config: ProviderConfig,
  req: SupervisorEvalCommandRequest
) {
  const cfg = config as CodexConfig;
  return {
    argv: [
      'codex',
      'exec',
      '--json',
      req.prompt,
      ...(cfg.additionalArgs ?? []),
    ],
    cwd: cfg.cwd ?? req.workspacePath,
    env: {
      ...(cfg.envVars ?? {}),
      ...(req.apiKey ? { OPENAI_API_KEY: req.apiKey } : {}),
      CODER_STUDIO_SESSION_ID: req.sessionId,
    },
  };
}
```

```ts
// packages/providers/src/claude/transcript-excerpt.ts
import { readFile } from 'node:fs/promises';
import type { TranscriptExcerptRequest } from '@coder-studio/core';

export async function readClaudeTranscriptExcerpt(req: TranscriptExcerptRequest) {
  const lines = (await readFile(req.transcriptPath, 'utf8')).split('\n').filter(Boolean);
  const records = lines
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, any>;
      } catch {
        return null;
      }
    })
    .filter((record): record is Record<string, any> => record !== null)
    .flatMap((record) => {
      const text = record.message?.content
        ?.filter((part: any) => part.type === 'text')
        ?.map((part: any) => part.text)
        ?.join('\n');
      if (!text) return [];
      return [{ role: record.type, text, turnId: record.turn_id as string | undefined }];
    });

  const excerpt = records
    .slice(-req.maxTurns)
    .map((record) => `${record.role}: ${record.text}`)
    .join('\n\n')
    .slice(-req.maxChars);

  return excerpt
    ? { excerpt, lastTurnId: records.at(-1)?.turnId }
    : null;
}
```

```ts
// packages/providers/src/codex/transcript-excerpt.ts
import { readFile } from 'node:fs/promises';
import type { TranscriptExcerptRequest } from '@coder-studio/core';

export async function readCodexTranscriptExcerpt(req: TranscriptExcerptRequest) {
  const lines = (await readFile(req.transcriptPath, 'utf8')).split('\n').filter(Boolean);
  const records = lines
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, any>;
      } catch {
        return null;
      }
    })
    .filter((record): record is Record<string, any> => record !== null)
    .filter((record) => record.type === 'message' && typeof record.content === 'string')
    .map((record) => ({
      role: String(record.role ?? 'unknown'),
      text: String(record.content),
      turnId: record.turn_id as string | undefined,
    }));

  const excerpt = records
    .slice(-req.maxTurns)
    .map((record) => `${record.role}: ${record.text}`)
    .join('\n\n')
    .slice(-req.maxChars);

  return excerpt
    ? { excerpt, lastTurnId: records.at(-1)?.turnId }
    : null;
}
```

```ts
// packages/providers/src/claude/definition.ts
import { buildClaudeSupervisorEvalCommand } from './supervisor-eval.js';
import { readClaudeTranscriptExcerpt } from './transcript-excerpt.js';

export const claudeDefinition: ProviderDefinition = {
  id: 'claude',
  displayName: 'Claude Code',
  badge: 'Claude',
  capability: 'full',
  buildCommand(config, ctx) {
    const cfg = config as ClaudeConfig;
    const modelArg = cfg.model ? ['--model', cfg.model] : [];
    return {
      argv: ['claude', ...modelArg, ...cfg.additionalArgs],
      env: { ...cfg.envVars, CODER_STUDIO_SESSION_ID: ctx.sessionId },
      cwd: ctx.workspacePath,
    };
  },
  buildResumeCommand(resumeId, config, ctx) {
    const cfg = config as ClaudeConfig;
    const modelArg = cfg.model ? ['--model', cfg.model] : [];
    return {
      argv: ['claude', '--resume', resumeId, ...modelArg, ...cfg.additionalArgs],
      env: { ...cfg.envVars, CODER_STUDIO_SESSION_ID: ctx.sessionId },
      cwd: ctx.workspacePath,
    };
  },
  buildSupervisorEvalCommand: buildClaudeSupervisorEvalCommand,
  readTranscriptExcerpt: readClaudeTranscriptExcerpt,
  configSchema: claudeConfigSchema,
  defaultConfig: {
    model: 'claude-sonnet-4-6',
    maxTurns: null,
    additionalArgs: [],
    envVars: {},
  },
  requiredCommands: ['claude'],
  hooks: claudeHooksDescriptor,
  async resolveTranscriptPath(session) {
    return session.transcriptPath ?? null;
  },
};
```

```ts
// packages/providers/src/codex/definition.ts
import { buildCodexSupervisorEvalCommand } from './supervisor-eval.js';
import { readCodexTranscriptExcerpt } from './transcript-excerpt.js';

export const codexDefinition: ProviderDefinition = {
  id: 'codex',
  displayName: 'Codex',
  badge: 'Codex',
  capability: 'full',
  buildCommand(config, ctx) {
    const cfg = config as CodexConfig;
    const extraArgs = [...cfg.additionalArgs];
    if (ctx.bridgeScriptPath) {
      extraArgs.push('-c', `notify=["node","${ctx.bridgeScriptPath}"]`);
    }
    return {
      argv: ['codex', ...extraArgs],
      env: { ...cfg.envVars, CODER_STUDIO_SESSION_ID: ctx.sessionId },
      cwd: cfg.cwd ?? ctx.workspacePath,
    };
  },
  buildResumeCommand: undefined,
  buildSupervisorEvalCommand: buildCodexSupervisorEvalCommand,
  readTranscriptExcerpt: readCodexTranscriptExcerpt,
  configSchema: codexConfigSchema,
  defaultConfig: {
    additionalArgs: [],
    envVars: {},
  },
  requiredCommands: ['codex'],
  hooks: codexHooksDescriptor,
  async resolveTranscriptPath(session) {
    return resolveCodexTranscriptPath(session);
  },
};
```

- [ ] **Step 4: Run providers build and tests**

Run: `pnpm --dir packages/core build && pnpm --dir packages/providers build && pnpm --dir packages/providers exec vitest run src/claude/definition.test.ts src/codex/definition.test.ts src/claude/transcript-excerpt.test.ts src/codex/transcript-excerpt.test.ts`
Expected: PASS with both providers exposing the new headless-eval and transcript-excerpt capabilities.

- [ ] **Step 5: Commit the provider capability work**

```bash
git add packages/providers/src/claude/definition.ts packages/providers/src/claude/definition.test.ts packages/providers/src/claude/supervisor-eval.ts packages/providers/src/claude/transcript-excerpt.ts packages/providers/src/claude/transcript-excerpt.test.ts packages/providers/src/codex/definition.ts packages/providers/src/codex/definition.test.ts packages/providers/src/codex/supervisor-eval.ts packages/providers/src/codex/transcript-excerpt.ts packages/providers/src/codex/transcript-excerpt.test.ts
git commit -m "feat(supervisor): add provider headless eval support"
```

### Task 4: Build Transcript-First Context Builder And Provider-Driven Evaluator

**Files:**
- Create: `packages/server/src/supervisor/context-builder.ts`
- Create: `packages/server/src/supervisor/context-builder.test.ts`
- Refactor: `packages/server/src/supervisor/evaluator.ts`
- Modify: `packages/server/src/supervisor/evaluator.test.ts`
- Modify: `packages/server/src/git/cli.ts`

- [ ] **Step 1: Write failing context-builder and evaluator tests**

```ts
// packages/server/src/supervisor/context-builder.test.ts
import { describe, expect, it, vi } from 'vitest';
import { SupervisorContextBuilder } from './context-builder.js';

describe('SupervisorContextBuilder', () => {
  it('prefers transcript excerpts over terminal fallback', async () => {
    const builder = new SupervisorContextBuilder({
      workspaceMgr: {
        get: vi.fn(() => ({ id: 'ws-1', path: '/workspace' })),
      } as any,
      sessionMgr: {
        get: vi.fn(() => ({
          id: 'sess-1',
          workspaceId: 'ws-1',
          providerId: 'claude',
          terminalId: 'term-1',
          state: 'running',
          capability: 'full',
          startedAt: 1,
          lastActiveAt: 1,
          transcriptPath: '/tmp/session.jsonl',
        })),
      } as any,
      terminalMgr: {
        get: vi.fn(() => ({ ringBuffer: { snapshot: () => Buffer.from('terminal fallback') } })),
      } as any,
      providerRegistry: [
        {
          id: 'claude',
          readTranscriptExcerpt: vi.fn(async () => ({ excerpt: 'assistant: repo ready', lastTurnId: 'turn-2' })),
        },
      ] as any,
      git: {
        getStatusSummary: vi.fn(async () => 'M packages/server/src/supervisor/manager.ts'),
        getDiffStatSummary: vi.fn(async () => '1 file changed, 42 insertions(+)'),
      },
    });

    const context = await builder.build({
      id: 'sup-1',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
      state: 'idle',
      objective: 'Persist supervisors',
      evaluatorProviderId: 'codex',
      cycles: [],
      createdAt: 1,
      updatedAt: 1,
    });

    expect(context.evidenceSource).toBe('transcript');
    expect(context.transcriptExcerpt).toContain('repo ready');
    expect(context.lastTurnId).toBe('turn-2');
  });

  it('falls back to terminal output when transcript is unavailable', async () => {
    const builder = new SupervisorContextBuilder({
      workspaceMgr: { get: vi.fn(() => ({ id: 'ws-1', path: '/workspace' })) } as any,
      sessionMgr: {
        get: vi.fn(() => ({
          id: 'sess-1',
          workspaceId: 'ws-1',
          providerId: 'claude',
          terminalId: 'term-1',
          state: 'running',
          capability: 'full',
          startedAt: 1,
          lastActiveAt: 1,
        })),
      } as any,
      terminalMgr: {
        get: vi.fn(() => ({ ringBuffer: { snapshot: () => Buffer.from('npm test\nPASS') } })),
      } as any,
      providerRegistry: [{ id: 'claude', readTranscriptExcerpt: vi.fn(async () => null) }] as any,
      git: { getStatusSummary: vi.fn(async () => ''), getDiffStatSummary: vi.fn(async () => '') },
    });

    const context = await builder.build({
      id: 'sup-1',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
      state: 'idle',
      objective: 'Persist supervisors',
      evaluatorProviderId: 'claude',
      cycles: [],
      createdAt: 1,
      updatedAt: 1,
    });

    expect(context.evidenceSource).toBe('terminal_fallback');
    expect(context.terminalExcerpt).toContain('PASS');
  });
});
```

```ts
// packages/server/src/supervisor/evaluator.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupervisorEvaluator } from './evaluator.js';

describe('SupervisorEvaluator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('uses supervisor.evaluatorProviderId instead of the session provider', async () => {
    const evaluator = new SupervisorEvaluator({
      providerRegistry: [
        {
          id: 'codex',
          buildSupervisorEvalCommand: vi.fn(() => ({
            argv: ['node', '-e', `process.stdout.write(${JSON.stringify(JSON.stringify({ progress: 60, summary: 'codex evaluator', shouldInject: false, confidence: 0.9 }))})`],
            cwd: process.cwd(),
            env: {},
          })),
        },
      ] as any,
      providerConfigRepo: {
        get: vi.fn(() => ({ additionalArgs: [], envVars: {} })),
      } as any,
      timeoutMs: 5000,
    });

    const result = await evaluator.evaluate(
      {
        id: 'sup-1',
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        state: 'idle',
        objective: 'Finish the evaluator runner',
        evaluatorProviderId: 'codex',
        cycles: [],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        objective: 'Finish the evaluator runner',
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        workspacePath: process.cwd(),
        sessionProviderId: 'claude',
        evaluatorProviderId: 'codex',
        sessionState: 'running',
        evidenceSource: 'terminal_fallback',
        terminalExcerpt: 'build passes',
      }
    );

    expect(result.summary).toBe('codex evaluator');
    expect(result.progress).toBe(60);
  });

  it('fails with missing_evaluator_config when evaluator provider has no config', async () => {
    const evaluator = new SupervisorEvaluator({
      providerRegistry: [{ id: 'claude', buildSupervisorEvalCommand: vi.fn() }] as any,
      providerConfigRepo: { get: vi.fn(() => undefined) } as any,
      timeoutMs: 1000,
    });

    await expect(
      evaluator.evaluate(
        {
          id: 'sup-1',
          sessionId: 'sess-1',
          workspaceId: 'ws-1',
          state: 'idle',
          objective: 'Finish the evaluator runner',
          evaluatorProviderId: 'claude',
          cycles: [],
          createdAt: 1,
          updatedAt: 1,
        },
        {
          objective: 'Finish the evaluator runner',
          sessionId: 'sess-1',
          workspaceId: 'ws-1',
          workspacePath: process.cwd(),
          sessionProviderId: 'codex',
          evaluatorProviderId: 'claude',
          sessionState: 'running',
          evidenceSource: 'terminal_fallback',
          terminalExcerpt: 'build passes',
        }
      )
    ).rejects.toMatchObject({ code: 'missing_evaluator_config' });
  });
});
```

- [ ] **Step 2: Run the context and evaluator tests**

Run: `pnpm --dir packages/server exec vitest run src/supervisor/context-builder.test.ts src/supervisor/evaluator.test.ts`
Expected: FAIL because `SupervisorContextBuilder` does not exist and `evaluator.ts` still talks directly to the Anthropic SDK.

- [ ] **Step 3: Implement the context builder, git summaries, and provider-driven evaluator**

```ts
// packages/server/src/git/cli.ts
export async function getGitStatusSummary(cwd: string): Promise<string> {
  const { stdout } = await runGit(cwd, ['status', '--short']);
  return stdout.trim();
}

export async function getGitDiffStatSummary(cwd: string): Promise<string> {
  const { stdout } = await runGit(cwd, ['diff', '--stat']);
  return stdout.trim();
}
```

```ts
// packages/server/src/supervisor/context-builder.ts
import type { ProviderDefinition, SessionState, Supervisor } from '@coder-studio/core';
import type { SessionManager } from '../session/manager.js';
import type { TerminalManager } from '../terminal/manager.js';
import type { WorkspaceManager } from '../workspace/manager.js';
import { getGitDiffStatSummary, getGitStatusSummary } from '../git/cli.js';

export interface SupervisorEvaluationContext {
  objective: string;
  sessionId: string;
  workspaceId: string;
  workspacePath: string;
  sessionProviderId: string;
  evaluatorProviderId: string;
  sessionState: SessionState;
  transcriptExcerpt?: string;
  terminalExcerpt?: string;
  gitStatusSummary?: string;
  gitDiffStat?: string;
  lastTurnId?: string;
  evidenceSource: 'transcript' | 'terminal_fallback';
}

export class SupervisorContextBuilder {
  constructor(
    private readonly deps: {
      workspaceMgr: WorkspaceManager;
      sessionMgr: SessionManager;
      terminalMgr: TerminalManager;
      providerRegistry: ProviderDefinition[];
      git?: {
        getStatusSummary?: typeof getGitStatusSummary;
        getDiffStatSummary?: typeof getGitDiffStatSummary;
      };
    }
  ) {}

  async build(supervisor: Supervisor): Promise<SupervisorEvaluationContext> {
    const session = this.deps.sessionMgr.get(supervisor.sessionId);
    const workspace = this.deps.workspaceMgr.get(supervisor.workspaceId);

    if (!session || !workspace) {
      throw { code: 'supervisor_not_found', message: 'Supervisor session context is unavailable' };
    }

    const provider = this.deps.providerRegistry.find((item) => item.id === session.providerId);
    const transcript = session.transcriptPath && provider?.readTranscriptExcerpt
      ? await provider.readTranscriptExcerpt({
          transcriptPath: session.transcriptPath,
          maxChars: 12000,
          maxTurns: 12,
        })
      : null;

    const terminalSnapshot = this.deps.terminalMgr.get(session.terminalId)?.ringBuffer.snapshot().toString('utf8') ?? '';
    const terminalExcerpt = terminalSnapshot
      .split('\n')
      .slice(-200)
      .join('\n')
      .slice(-12000);

    const gitStatusSummary = await (this.deps.git?.getStatusSummary ?? getGitStatusSummary)(workspace.path).catch(() => '');
    const gitDiffStat = await (this.deps.git?.getDiffStatSummary ?? getGitDiffStatSummary)(workspace.path).catch(() => '');

    return {
      objective: supervisor.objective,
      sessionId: session.id,
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      sessionProviderId: session.providerId,
      evaluatorProviderId: supervisor.evaluatorProviderId,
      sessionState: session.state,
      transcriptExcerpt: transcript?.excerpt,
      terminalExcerpt: transcript?.excerpt ? undefined : terminalExcerpt,
      gitStatusSummary: gitStatusSummary.slice(-4000),
      gitDiffStat: gitDiffStat.slice(-4000),
      lastTurnId: transcript?.lastTurnId,
      evidenceSource: transcript?.excerpt ? 'transcript' : 'terminal_fallback',
    };
  }
}
```

```ts
// packages/server/src/supervisor/evaluator.ts
import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { ProviderDefinition, Supervisor } from '@coder-studio/core';
import type { ProviderConfigRepo } from '../storage/repositories/provider-config-repo.js';
import type { SupervisorEvaluationContext } from './context-builder.js';

const EvalResultSchema = z
  .object({
    progress: z.number(),
    summary: z.string().min(1),
    shouldInject: z.boolean(),
    guidance: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.shouldInject && !value.guidance) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'guidance is required when shouldInject=true' });
    }
  });

export class SupervisorEvaluator {
  constructor(
    private readonly deps: {
      providerRegistry: ProviderDefinition[];
      providerConfigRepo: ProviderConfigRepo;
      timeoutMs?: number;
    }
  ) {}

  async evaluate(supervisor: Supervisor, context: SupervisorEvaluationContext) {
    const provider = this.deps.providerRegistry.find((item) => item.id === supervisor.evaluatorProviderId);
    if (!provider?.buildSupervisorEvalCommand) {
      throw { code: 'supervisor_invalid_evaluator_provider', message: 'Evaluator provider does not support headless eval' };
    }

    const config = this.deps.providerConfigRepo.get(provider.id);
    if (!config) {
      throw { code: 'missing_evaluator_config', message: `Missing config for evaluator provider ${provider.id}` };
    }

    const prompt = [
      'You are the supervisor evaluator. Return strict JSON only.',
      `Objective: ${context.objective}`,
      `Session provider: ${context.sessionProviderId}`,
      `Evaluator provider: ${context.evaluatorProviderId}`,
      `Session state: ${context.sessionState}`,
      context.transcriptExcerpt ? `Transcript:\n${context.transcriptExcerpt}` : `Terminal:\n${context.terminalExcerpt ?? ''}`,
      context.gitStatusSummary ? `Git status:\n${context.gitStatusSummary}` : '',
      context.gitDiffStat ? `Git diff stat:\n${context.gitDiffStat}` : '',
      'JSON shape: {"progress":0,"summary":"","shouldInject":false,"guidance":"","confidence":0.0}',
    ]
      .filter(Boolean)
      .join('\n\n');

    const command = provider.buildSupervisorEvalCommand(config, {
      prompt,
      sessionId: supervisor.sessionId,
      workspacePath: context.workspacePath,
      model: typeof (config as any).model === 'string' ? (config as any).model : undefined,
    });

    if (!command) {
      throw { code: 'supervisor_invalid_evaluator_provider', message: 'Evaluator provider returned null command' };
    }

    const stdout = await runCommand(command, this.deps.timeoutMs ?? 30_000);
    const parsed = EvalResultSchema.parse(JSON.parse(stdout.trim()));

    return {
      progress: Math.max(0, Math.min(100, Math.round(parsed.progress))),
      summary: parsed.summary,
      shouldInject: parsed.shouldInject,
      guidance: parsed.guidance?.slice(0, 2000),
      confidence: parsed.confidence,
    };
  }
}

async function runCommand(
  command: { argv: string[]; cwd?: string; env?: Record<string, string> },
  timeoutMs: number
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command.argv[0]!, command.argv.slice(1), {
      cwd: command.cwd,
      env: { ...process.env, ...command.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject({ code: 'supervisor_eval_timeout', message: `Supervisor evaluator timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject({ code: 'supervisor_eval_failed', message: Buffer.concat(stderr).toString('utf8') || `Evaluator exited with code ${code}` });
        return;
      }
      resolve(Buffer.concat(stdout).toString('utf8'));
    });
  });
}
```

- [ ] **Step 4: Run the server build and targeted supervisor tests**

Run: `pnpm --dir packages/server build && pnpm --dir packages/server exec vitest run src/supervisor/context-builder.test.ts src/supervisor/evaluator.test.ts`
Expected: PASS with transcript-first context construction, terminal fallback, git summaries, provider-driven headless execution, and JSON validation.

- [ ] **Step 5: Commit the evaluator pipeline**

```bash
git add packages/server/src/git/cli.ts packages/server/src/supervisor/context-builder.ts packages/server/src/supervisor/context-builder.test.ts packages/server/src/supervisor/evaluator.ts packages/server/src/supervisor/evaluator.test.ts
git commit -m "feat(supervisor): add transcript-first evaluation pipeline"
```

### Task 5: Refactor Injector, Event-Driven Scheduler, Manager, And Server Wiring

**Files:**
- Refactor: `packages/server/src/supervisor/injector.ts`
- Refactor: `packages/server/src/supervisor/scheduler.ts`
- Refactor: `packages/server/src/supervisor/manager.ts`
- Modify: `packages/server/src/supervisor/manager.test.ts`
- Modify: `packages/server/src/supervisor/injector.test.ts`
- Modify: `packages/server/src/supervisor/scheduler.test.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/ws/dispatch.ts`

- [ ] **Step 1: Write the failing runtime tests for scheduler, injector, and manager**

```ts
// packages/server/src/supervisor/injector.test.ts
import { describe, expect, it, vi } from 'vitest';
import { SupervisorInjector } from './injector.js';

describe('SupervisorInjector', () => {
  it('writes guidance through terminalMgr.write using the session terminalId', async () => {
    const injector = new SupervisorInjector({
      sessionMgr: {
        get: vi.fn(() => ({
          id: 'sess-1',
          terminalId: 'term-1',
          state: 'running',
          workspaceId: 'ws-1',
          providerId: 'claude',
          capability: 'full',
          startedAt: 1,
          lastActiveAt: 1,
        })),
      } as any,
      terminalMgr: { write: vi.fn() } as any,
    });

    await injector.inject(
      {
        id: 'sup-1',
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        state: 'idle',
        objective: 'Finish the repo migration',
        evaluatorProviderId: 'claude',
        cycles: [],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        summary: 'Tables and repos are finished.',
        guidance: 'Wire the repos into SupervisorManager next.',
      },
      []
    );

    expect((injector as any).deps.terminalMgr.write).toHaveBeenCalledWith(
      'term-1',
      expect.any(Buffer)
    );
  });
});
```

```ts
// packages/server/src/supervisor/scheduler.test.ts
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../bus/event-bus.js';
import { SupervisorScheduler } from './scheduler.js';

describe('SupervisorScheduler', () => {
  it('only reacts to session.lifecycle turn_completed', async () => {
    const eventBus = new EventBus();
    const onTurnCompleted = vi.fn();
    const scheduler = new SupervisorScheduler({ eventBus, onTurnCompleted });

    scheduler.start();
    eventBus.emit({ type: 'session.lifecycle', workspaceId: 'ws-1', sessionId: 'sess-1', event: 'started' });
    eventBus.emit({ type: 'session.lifecycle', workspaceId: 'ws-1', sessionId: 'sess-1', event: 'turn_completed' });

    expect(onTurnCompleted).toHaveBeenCalledTimes(1);
    expect(onTurnCompleted).toHaveBeenCalledWith('sess-1');
  });
});
```

```ts
// packages/server/src/supervisor/manager.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupervisorManager } from './manager.js';

describe('SupervisorManager', () => {
  let deps: any;

  beforeEach(() => {
    deps = {
      eventBus: { on: vi.fn(() => () => {}), emit: vi.fn() },
      broadcaster: { broadcast: vi.fn() },
      terminalMgr: { write: vi.fn() },
      workspaceMgr: { get: vi.fn(() => ({ id: 'ws-1', path: '/workspace' })) },
      sessionMgr: { get: vi.fn(() => ({ id: 'sess-1', terminalId: 'term-1', workspaceId: 'ws-1', providerId: 'claude', state: 'running', capability: 'full', startedAt: 1, lastActiveAt: 1 })) },
      providerRegistry: [
        { id: 'claude', capability: 'full', buildSupervisorEvalCommand: vi.fn(() => ({ argv: ['node', '-e', `process.stdout.write(${JSON.stringify(JSON.stringify({ progress: 50, summary: 'on track', shouldInject: false, confidence: 0.8 }))})`], cwd: process.cwd(), env: {} })) },
      ],
      providerConfigRepo: { get: vi.fn(() => ({ model: 'claude-sonnet-4-6', additionalArgs: [], envVars: {} })) },
      supervisorRepo: {
        create: vi.fn((value) => ({ ...value, cycles: [] })),
        update: vi.fn((id, patch) => ({ id, sessionId: 'sess-1', workspaceId: 'ws-1', state: patch.state ?? 'idle', objective: patch.objective ?? 'Persist supervisors', evaluatorProviderId: patch.evaluatorProviderId ?? 'claude', cycles: [], createdAt: 1, updatedAt: patch.updatedAt ?? 1, lastEvaluatedTurnId: patch.lastEvaluatedTurnId })),
        findById: vi.fn(() => undefined),
        getBySessionId: vi.fn(() => undefined),
        listAll: vi.fn(() => []),
        delete: vi.fn(),
      },
      cycleRepo: {
        create: vi.fn((cycle) => cycle),
        update: vi.fn((id, patch) => ({ id, supervisorId: 'sup-1', sessionId: 'sess-1', status: patch.status ?? 'completed', trigger: 'manual', evidenceSource: 'transcript', objective: 'Persist supervisors', evaluatorProviderId: 'claude', createdAt: 1, completedAt: patch.completedAt ?? 1 })),
        listRecentForSupervisor: vi.fn(() => []),
        pruneOldest: vi.fn(),
      },
    };
  });

  it('recovers persisted evaluating supervisors back to idle on hydrate', async () => {
    deps.supervisorRepo.listAll.mockReturnValue([
      {
        id: 'sup-1',
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        state: 'evaluating',
        objective: 'Persist supervisors',
        evaluatorProviderId: 'claude',
        cycles: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const manager = new SupervisorManager(deps);
    await manager.hydrate();

    expect(deps.supervisorRepo.update).toHaveBeenCalledWith(
      'sup-1',
      expect.objectContaining({ state: 'idle', errorReason: null })
    );
  });
});
```

- [ ] **Step 2: Run the runtime suite and capture the failures**

Run: `pnpm --dir packages/server exec vitest run src/supervisor/injector.test.ts src/supervisor/scheduler.test.ts src/supervisor/manager.test.ts`
Expected: FAIL because the current injector still uses `writeToSession()`, the scheduler is `setInterval`-based, and the manager has no repo-backed hydrate or event-driven lifecycle.

- [ ] **Step 3: Implement the injector, scheduler, manager, and boot wiring**

```ts
// packages/server/src/supervisor/injector.ts
import { createHash } from 'node:crypto';
import type { Supervisor, SupervisorCycle } from '@coder-studio/core';
import type { SessionManager } from '../session/manager.js';
import type { TerminalManager } from '../terminal/manager.js';

export class SupervisorInjector {
  constructor(
    readonly deps: {
      sessionMgr: SessionManager;
      terminalMgr: TerminalManager;
    }
  ) {}

  async inject(
    supervisor: Supervisor,
    input: { summary: string; guidance: string },
    recentCycles: SupervisorCycle[]
  ): Promise<{ injected: boolean; text: string }> {
    const session = this.deps.sessionMgr.get(supervisor.sessionId);
    if (!session || session.state === 'ended' || session.state === 'unavailable') {
      throw { code: 'inject_target_unavailable', message: `Session ${supervisor.sessionId} is not available for injection` };
    }

    const text = [
      'Supervisor guidance:',
      `Objective: ${supervisor.objective}`,
      `Assessment: ${input.summary}`,
      `Next step: ${input.guidance.slice(0, 2000)}`,
      '',
    ].join('\n');

    const hash = createHash('sha1').update(text).digest('hex');
    const recentHashes = recentCycles.slice(0, 2).map((cycle) => cycle.injectedGuidance ?? '');
    const duplicate = recentHashes.some((value) => value && createHash('sha1').update(value).digest('hex') === hash);
    if (duplicate) {
      return { injected: false, text };
    }

    this.deps.terminalMgr.write(session.terminalId, Buffer.from(text, 'utf8'));
    return { injected: true, text };
  }
}
```

```ts
// packages/server/src/supervisor/scheduler.ts
import type { EventBus } from '../bus/event-bus.js';

export class SupervisorScheduler {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly deps: {
      eventBus: EventBus;
      onTurnCompleted: (sessionId: string) => void;
    }
  ) {}

  start(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.deps.eventBus.on('session.lifecycle', (event) => {
      if (event.event !== 'turn_completed') {
        return;
      }
      this.deps.onTurnCompleted(event.sessionId);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
```

```ts
// packages/server/src/supervisor/manager.ts
import type { Supervisor, SupervisorCycle, SupervisorState } from '@coder-studio/core';
import type { EventBus } from '../bus/event-bus.js';
import type { Broadcaster } from '../ws/hub.js';
import type { TerminalManager } from '../terminal/manager.js';
import type { WorkspaceManager } from '../workspace/manager.js';
import type { SessionManager } from '../session/manager.js';
import type { ProviderDefinition } from '@coder-studio/core';
import type { ProviderConfigRepo } from '../storage/repositories/provider-config-repo.js';
import type { SupervisorRepo } from '../storage/repositories/supervisor-repo.js';
import type { SupervisorCycleRepo } from '../storage/repositories/supervisor-cycle-repo.js';
import { DEFAULT_SUPERVISOR_CONFIG } from '@coder-studio/core';
import { SupervisorScheduler } from './scheduler.js';
import { SupervisorContextBuilder } from './context-builder.js';
import { SupervisorEvaluator } from './evaluator.js';
import { SupervisorInjector } from './injector.js';

export interface SupervisorManagerDeps {
  eventBus: EventBus;
  broadcaster: Broadcaster;
  terminalMgr: TerminalManager;
  workspaceMgr: WorkspaceManager;
  sessionMgr: SessionManager;
  providerRegistry: ProviderDefinition[];
  providerConfigRepo: ProviderConfigRepo;
  supervisorRepo: SupervisorRepo;
  cycleRepo: SupervisorCycleRepo;
}

export class SupervisorManager {
  private readonly supervisors = new Map<string, Supervisor>();
  private readonly supervisorsBySession = new Map<string, string>();
  private readonly inFlight = new Set<string>();
  private readonly scheduler: SupervisorScheduler;
  private readonly contextBuilder: SupervisorContextBuilder;
  private readonly evaluator: SupervisorEvaluator;
  private readonly injector: SupervisorInjector;

  constructor(private readonly deps: SupervisorManagerDeps) {
    this.contextBuilder = new SupervisorContextBuilder({
      workspaceMgr: deps.workspaceMgr,
      sessionMgr: deps.sessionMgr,
      terminalMgr: deps.terminalMgr,
      providerRegistry: deps.providerRegistry,
    });
    this.evaluator = new SupervisorEvaluator({
      providerRegistry: deps.providerRegistry,
      providerConfigRepo: deps.providerConfigRepo,
    });
    this.injector = new SupervisorInjector({
      sessionMgr: deps.sessionMgr,
      terminalMgr: deps.terminalMgr,
    });
    this.scheduler = new SupervisorScheduler({
      eventBus: deps.eventBus,
      onTurnCompleted: (sessionId) => {
        const supervisorId = this.supervisorsBySession.get(sessionId);
        if (supervisorId) {
          void this.evaluate(supervisorId, 'turn_completed');
        }
      },
    });
    this.deps.eventBus.on('session.lifecycle', (event) => {
      if (event.event !== 'removed') {
        return;
      }
      const supervisorId = this.supervisorsBySession.get(event.sessionId);
      if (supervisorId) {
        void this.delete(supervisorId);
      }
    });
  }

  async hydrate(): Promise<void> {
    const persisted = this.deps.supervisorRepo.listAll();
    for (const supervisor of persisted) {
      const normalizedState: SupervisorState =
        supervisor.state === 'evaluating' || supervisor.state === 'injecting'
          ? 'idle'
          : supervisor.state;
      const recovered =
        normalizedState === supervisor.state
          ? supervisor
          : this.deps.supervisorRepo.update(supervisor.id, {
              state: normalizedState,
              errorReason: null,
              updatedAt: Date.now(),
            });
      recovered.cycles = this.deps.cycleRepo.listRecentForSupervisor(recovered.id, 20);
      this.supervisors.set(recovered.id, recovered);
      this.supervisorsBySession.set(recovered.sessionId, recovered.id);
    }
    this.scheduler.start();
  }

  async create(req: {
    sessionId: string;
    workspaceId: string;
    objective: string;
    evaluatorProviderId: string;
  }): Promise<Supervisor> {
    const session = this.deps.sessionMgr.get(req.sessionId);
    if (!session) {
      throw { code: 'supervisor_not_found', message: `Session ${req.sessionId} not found` };
    }
    if (session.state === 'draft') {
      throw { code: 'supervisor_unsupported_provider', message: 'Draft sessions cannot enable supervisor' };
    }
    if (session.capability !== 'full') {
      throw { code: 'supervisor_unsupported_provider', message: 'Supervisor requires a full-capability session provider' };
    }
    if (this.supervisorsBySession.has(req.sessionId)) {
      throw { code: 'supervisor_already_exists', message: `Supervisor already exists for ${req.sessionId}` };
    }
    const evaluatorProvider = this.deps.providerRegistry.find((item) => item.id === req.evaluatorProviderId);
    if (!evaluatorProvider?.buildSupervisorEvalCommand) {
      throw { code: 'supervisor_invalid_evaluator_provider', message: `Provider ${req.evaluatorProviderId} cannot evaluate supervisors` };
    }
    if (!this.deps.providerConfigRepo.get(req.evaluatorProviderId)) {
      throw { code: 'missing_evaluator_config', message: `Missing config for evaluator provider ${req.evaluatorProviderId}` };
    }

    const supervisor = this.deps.supervisorRepo.create({
      id: `sup_${Date.now()}`,
      sessionId: req.sessionId,
      workspaceId: req.workspaceId,
      state: 'idle',
      objective: req.objective.trim(),
      evaluatorProviderId: req.evaluatorProviderId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    supervisor.cycles = [];
    this.supervisors.set(supervisor.id, supervisor);
    this.supervisorsBySession.set(supervisor.sessionId, supervisor.id);
    this.broadcastState(supervisor, 'created');
    return supervisor;
  }

  getBySession(sessionId: string): Supervisor | undefined {
    const id = this.supervisorsBySession.get(sessionId);
    if (!id) return undefined;
    return this.supervisors.get(id);
  }

  async update(id: string, patch: { objective?: string; evaluatorProviderId?: string }): Promise<Supervisor> {
    const current = this.requireSupervisor(id);
    if (patch.evaluatorProviderId) {
      const evaluatorProvider = this.deps.providerRegistry.find((item) => item.id === patch.evaluatorProviderId);
      if (!evaluatorProvider?.buildSupervisorEvalCommand) {
        throw { code: 'supervisor_invalid_evaluator_provider', message: `Provider ${patch.evaluatorProviderId} cannot evaluate supervisors` };
      }
      if (!this.deps.providerConfigRepo.get(patch.evaluatorProviderId)) {
        throw { code: 'missing_evaluator_config', message: `Missing config for evaluator provider ${patch.evaluatorProviderId}` };
      }
    }

    const updated = this.deps.supervisorRepo.update(id, {
      objective: patch.objective?.trim() ?? current.objective,
      evaluatorProviderId: patch.evaluatorProviderId ?? current.evaluatorProviderId,
      state: current.state === 'error' ? 'idle' : current.state,
      errorReason: null,
      updatedAt: Date.now(),
    });
    updated.cycles = this.deps.cycleRepo.listRecentForSupervisor(id, 20);
    this.supervisors.set(id, updated);
    this.broadcastState(updated, 'updated');
    return updated;
  }

  async pause(id: string): Promise<Supervisor> {
    const updated = this.deps.supervisorRepo.update(id, { state: 'paused', updatedAt: Date.now() });
    updated.cycles = this.deps.cycleRepo.listRecentForSupervisor(id, 20);
    this.supervisors.set(id, updated);
    this.broadcastState(updated, 'state_changed');
    return updated;
  }

  async resume(id: string): Promise<Supervisor> {
    const updated = this.deps.supervisorRepo.update(id, { state: 'idle', errorReason: null, updatedAt: Date.now() });
    updated.cycles = this.deps.cycleRepo.listRecentForSupervisor(id, 20);
    this.supervisors.set(id, updated);
    this.broadcastState(updated, 'state_changed');
    return updated;
  }

  async delete(id: string): Promise<void> {
    const supervisor = this.requireSupervisor(id);
    this.deps.supervisorRepo.delete(id);
    this.supervisors.delete(id);
    this.supervisorsBySession.delete(supervisor.sessionId);
    this.deps.broadcaster.broadcast(
      `workspace.${supervisor.workspaceId}.session.${supervisor.sessionId}.supervisor.state`,
      { supervisorId: id, event: 'deleted' }
    );
  }

  async triggerEvaluation(id: string): Promise<SupervisorCycle> {
    return await this.evaluate(id, 'manual');
  }

  private async evaluate(id: string, trigger: 'turn_completed' | 'manual'): Promise<SupervisorCycle> {
    const supervisor = this.requireSupervisor(id);
    if (supervisor.state === 'paused') {
      throw { code: 'supervisor_paused', message: `Supervisor ${id} is paused` };
    }
    if (this.inFlight.has(id)) {
      throw { code: 'supervisor_busy', message: `Supervisor ${id} is already evaluating` };
    }

    this.inFlight.add(id);
    try {
      const context = await this.contextBuilder.build(supervisor);
      if (trigger === 'turn_completed' && context.lastTurnId && context.lastTurnId === supervisor.lastEvaluatedTurnId) {
        throw { code: 'supervisor_busy', message: 'Latest turn already evaluated' };
      }

      const queued = this.deps.cycleRepo.create({
        id: `cycle_${Date.now()}`,
        supervisorId: supervisor.id,
        sessionId: supervisor.sessionId,
        status: 'evaluating',
        trigger,
        evidenceSource: context.evidenceSource,
        objective: supervisor.objective,
        evaluatorProviderId: supervisor.evaluatorProviderId,
        turnId: context.lastTurnId,
        createdAt: Date.now(),
      });
      this.broadcastCycle(supervisor, queued, 'created');

      const evaluation = await this.evaluator.evaluate(supervisor, context);
      const recentCycles = this.deps.cycleRepo.listRecentForSupervisor(supervisor.id, 5);
      const injection = evaluation.shouldInject && evaluation.guidance
        ? await this.injector.inject(supervisor, { summary: evaluation.summary, guidance: evaluation.guidance }, recentCycles)
        : { injected: false, text: '' };

      const finished = this.deps.cycleRepo.update(queued.id, {
        status: injection.injected ? 'injected' : 'completed',
        progress: evaluation.progress,
        result: evaluation.summary,
        injectedGuidance: injection.injected ? injection.text : undefined,
        completedAt: Date.now(),
      });

      const next = this.deps.supervisorRepo.update(supervisor.id, {
        state: 'idle',
        lastCycleAt: finished.completedAt,
        lastEvaluatedTurnId: context.lastTurnId,
        errorReason: null,
        updatedAt: Date.now(),
      });
      next.cycles = this.deps.cycleRepo.listRecentForSupervisor(supervisor.id, 20);
      this.supervisors.set(supervisor.id, next);
      this.broadcastCycle(next, finished, 'updated');
      this.broadcastState(next, 'state_changed');
      this.deps.cycleRepo.pruneOldest(supervisor.id, DEFAULT_SUPERVISOR_CONFIG.maxCyclesPerSession);
      return finished;
    } catch (error: any) {
      if (error?.code !== 'supervisor_busy') {
        const failedSupervisor = this.deps.supervisorRepo.update(id, {
          state: 'error',
          errorReason: error?.message ?? 'Supervisor evaluation failed',
          updatedAt: Date.now(),
        });
        failedSupervisor.cycles = this.deps.cycleRepo.listRecentForSupervisor(id, 20);
        this.supervisors.set(id, failedSupervisor);
        this.broadcastState(failedSupervisor, 'state_changed');
      }
      throw error;
    } finally {
      this.inFlight.delete(id);
    }
  }

  private requireSupervisor(id: string): Supervisor {
    const supervisor = this.supervisors.get(id);
    if (!supervisor) {
      throw { code: 'supervisor_not_found', message: `Supervisor ${id} not found` };
    }
    return supervisor;
  }

  private broadcastState(supervisor: Supervisor, event: 'created' | 'updated' | 'state_changed'): void {
    this.deps.broadcaster.broadcast(
      `workspace.${supervisor.workspaceId}.session.${supervisor.sessionId}.supervisor.state`,
      { supervisor, event }
    );
  }

  private broadcastCycle(supervisor: Supervisor, cycle: SupervisorCycle, event: 'created' | 'updated'): void {
    this.deps.broadcaster.broadcast(
      `workspace.${supervisor.workspaceId}.session.${supervisor.sessionId}.supervisor.cycle`,
      { cycle, event }
    );
  }
}
```

```ts
// packages/server/src/server.ts
import { ProviderConfigRepo } from './storage/repositories/provider-config-repo.js';
import { SupervisorRepo } from './storage/repositories/supervisor-repo.js';
import { SupervisorCycleRepo } from './storage/repositories/supervisor-cycle-repo.js';

const providerConfigRepo = new ProviderConfigRepo(db);
const supervisorRepo = new SupervisorRepo(db);
const cycleRepo = new SupervisorCycleRepo(db);

const supervisorMgr = new SupervisorManager({
  eventBus,
  broadcaster: wsHub,
  terminalMgr,
  workspaceMgr,
  sessionMgr,
  providerRegistry,
  providerConfigRepo,
  supervisorRepo,
  cycleRepo,
});
await supervisorMgr.hydrate();
```

```ts
// packages/server/src/ws/dispatch.ts
export interface CommandContext {
  workspaceMgr: WorkspaceManager;
  sessionMgr: SessionManager;
  terminalMgr: TerminalManager;
  hooksMgr: HooksManager;
  eventBus: EventBus;
  broadcaster: Broadcaster;
  db: Database;
  providerRegistry: ProviderDefinition[];
  fencingMgr: FencingManager;
  supervisorMgr: SupervisorManager;
}
```

- [ ] **Step 4: Run the server build and runtime supervisor suite**

Run: `pnpm --dir packages/server build && pnpm --dir packages/server exec vitest run src/supervisor/injector.test.ts src/supervisor/scheduler.test.ts src/supervisor/manager.test.ts src/__tests__/supervisor-commands.test.ts`
Expected: PASS with real PTY input semantics, event-driven `turn_completed` scheduling, repo-backed state recovery, per-supervisor evaluator validation, and no remaining `intervalMs` behavior.

- [ ] **Step 5: Commit the runtime refactor**

```bash
git add packages/server/src/supervisor/injector.ts packages/server/src/supervisor/injector.test.ts packages/server/src/supervisor/scheduler.ts packages/server/src/supervisor/scheduler.test.ts packages/server/src/supervisor/manager.ts packages/server/src/supervisor/manager.test.ts packages/server/src/server.ts packages/server/src/ws/dispatch.ts
git commit -m "feat(supervisor): switch to event-driven runtime"
```

### Task 6: Wire Supervisor Hydration And UI Into Agent Pane

**Files:**
- Modify: `packages/web/src/features/supervisor/atoms.ts`
- Create: `packages/web/src/features/supervisor/hooks/use-supervisor.ts`
- Modify: `packages/web/src/features/supervisor/components/supervisor-card.tsx`
- Modify: `packages/web/src/features/supervisor/components/objective-dialog.tsx`
- Modify: `packages/web/src/features/agent-panes/components/session-card.tsx`
- Modify: `packages/web/src/app/providers.tsx`
- Modify: `packages/web/src/styles/components.css`
- Test: `packages/web/src/features/supervisor/components/supervisor-card.test.tsx`
- Test: `packages/web/src/features/supervisor/components/objective-dialog.test.tsx`
- Test: `packages/web/src/features/agent-panes/components/session-card.test.tsx`
- Test: `packages/web/src/app/providers.test.tsx`

- [ ] **Step 1: Write the failing UI tests for dialog mode, hydration, and event routing**

```tsx
// packages/web/src/features/supervisor/components/objective-dialog.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { ObjectiveDialog } from './objective-dialog';
import { supervisorDialogAtom, supervisorsAtom } from '../atoms';
import { wsClientAtom } from '../../../atoms/connection';

describe('ObjectiveDialog', () => {
  it('submits evaluatorProviderId during enable', async () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as any);
    store.set(supervisorDialogAtom, {
      open: true,
      sessionId: 'sess-1',
      mode: 'enable',
      draftObjective: 'Finish the server refactor',
      draftEvaluatorProviderId: 'codex',
    });
    store.set(supervisorsAtom, new Map());

    render(
      <Provider store={store}>
        <ObjectiveDialog workspaceId="ws-1" />
      </Provider>
    );

    fireEvent.change(screen.getByLabelText('Evaluator Provider'), {
      target: { value: 'claude' },
    });
    fireEvent.click(screen.getByRole('button', { name: '启用' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('supervisor.create', {
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        objective: 'Finish the server refactor',
        evaluatorProviderId: 'claude',
      });
    });
  });

  it('renders disable confirmation mode', () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn() } as any);
    store.set(supervisorDialogAtom, {
      open: true,
      sessionId: 'sess-1',
      mode: 'disable',
      draftObjective: '',
      draftEvaluatorProviderId: 'claude',
    });
    store.set(
      supervisorsAtom,
      new Map([
        [
          'sess-1',
          {
            id: 'sup-1',
            sessionId: 'sess-1',
            workspaceId: 'ws-1',
            state: 'idle',
            objective: 'Finish the server refactor',
            evaluatorProviderId: 'claude',
            cycles: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      ])
    );

    render(
      <Provider store={store}>
        <ObjectiveDialog workspaceId="ws-1" />
      </Provider>
    );

    expect(screen.getByText('禁用会停止评估并清空历史')).toBeInTheDocument();
    expect(screen.getByText('Finish the server refactor')).toBeInTheDocument();
  });
});
```

```tsx
// packages/web/src/features/supervisor/components/supervisor-card.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { SupervisorCard } from './supervisor-card';
import { supervisorsAtom, supervisorCyclesAtom } from '../atoms';
import { wsClientAtom } from '../../../atoms/connection';

describe('SupervisorCard', () => {
  it('shows the latest cycle history and trigger action', () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as any);
    store.set(
      supervisorsAtom,
      new Map([
        [
          'sess-1',
          {
            id: 'sup-1',
            sessionId: 'sess-1',
            workspaceId: 'ws-1',
            state: 'idle',
            objective: 'Finish the server refactor',
            evaluatorProviderId: 'codex',
            cycles: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      ])
    );
    store.set(
      supervisorCyclesAtom,
      new Map([
        [
          'sup-1',
          [
            {
              id: 'cycle-1',
              supervisorId: 'sup-1',
              sessionId: 'sess-1',
              status: 'completed',
              trigger: 'manual',
              evidenceSource: 'transcript',
              objective: 'Finish the server refactor',
              evaluatorProviderId: 'codex',
              progress: 65,
              result: 'Persistence and hydration are done.',
              createdAt: 1,
              completedAt: 2,
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <SupervisorCard sessionId="sess-1" workspaceId="ws-1" />
      </Provider>
    );

    expect(screen.getByText('Persistence and hydration are done.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '触发评估' }));
    expect(sendCommand).toHaveBeenCalledWith('supervisor.trigger', { id: 'sup-1' });
  });
});
```

```tsx
// packages/web/src/features/agent-panes/components/session-card.test.tsx
it('hydrates supervisor state for full-capability sessions and renders the card above the terminal', async () => {
  const sendCommand = vi.fn().mockImplementation(async (op: string) => {
    if (op === 'supervisor.get') {
      return {
        supervisor: {
          id: 'sup-1',
          sessionId: 'sess_123456',
          workspaceId: 'ws-123',
          state: 'idle',
          objective: 'Keep the agent on track',
          evaluatorProviderId: 'claude',
          cycles: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };
    }
    return undefined;
  });

  const { store } = createSessionStore({ state: 'running', capability: 'full' }, sendCommand);

  render(
    <Provider store={store}>
      <SessionCard sessionId="sess_123456" />
    </Provider>
  );

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith('supervisor.get', { sessionId: 'sess_123456' });
  });

  expect(screen.getByText('Supervisor')).toBeInTheDocument();
});
```

```tsx
// packages/web/src/app/providers.test.tsx
import { describe, expect, it } from 'vitest';
import { createStore } from 'jotai';
import { supervisorsAtom, supervisorCyclesAtom } from '../features/supervisor/atoms';
import { routeEventToAtom } from './providers';

describe('routeEventToAtom', () => {
  it('removes supervisor state and cycles on delete events', () => {
    const store = createStore();
    store.set(
      supervisorsAtom,
      new Map([
        ['sess-1', { id: 'sup-1', sessionId: 'sess-1', workspaceId: 'ws-1', state: 'idle', objective: 'Track progress', evaluatorProviderId: 'claude', cycles: [], createdAt: 1, updatedAt: 1 }],
      ])
    );
    store.set(
      supervisorCyclesAtom,
      new Map([
        ['sup-1', [{ id: 'cycle-1', supervisorId: 'sup-1', sessionId: 'sess-1', status: 'completed', trigger: 'manual', evidenceSource: 'transcript', objective: 'Track progress', evaluatorProviderId: 'claude', createdAt: 1, completedAt: 2 }]],
      ])
    );

    routeEventToAtom('workspace.ws-1.session.sess-1.supervisor.state', { supervisorId: 'sup-1', event: 'deleted' }, store);

    expect(store.get(supervisorsAtom).size).toBe(0);
    expect(store.get(supervisorCyclesAtom).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the web tests before wiring the UI**

Run: `pnpm --dir packages/web exec vitest run src/features/supervisor/components/objective-dialog.test.tsx src/features/supervisor/components/supervisor-card.test.tsx src/features/agent-panes/components/session-card.test.tsx src/app/providers.test.tsx`
Expected: FAIL because the dialog still lacks provider selection and disable mode, the card lacks history rendering, `SessionCard` does not hydrate supervisors, and `routeEventToAtom` does not clear cycle state on delete.

- [ ] **Step 3: Implement hydration, dialog state, UI actions, and event routing**

```ts
// packages/web/src/features/supervisor/atoms.ts
import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import type { Supervisor, SupervisorCycle } from '@coder-studio/core';

export const supervisorsAtom = atom<Map<string, Supervisor>>(new Map());
export const supervisorCyclesAtom = atom<Map<string, SupervisorCycle[]>>(new Map());
export const supervisorHydratedAtomFamily = atomFamily((sessionId: string) => atom(false));

export const supervisorDialogAtom = atom<{
  open: boolean;
  sessionId: string | null;
  mode: 'enable' | 'edit' | 'disable';
  draftObjective: string;
  draftEvaluatorProviderId: 'claude' | 'codex';
}>({
  open: false,
  sessionId: null,
  mode: 'enable',
  draftObjective: '',
  draftEvaluatorProviderId: 'claude',
});

export const supervisorBySessionAtom = atom((get) => (sessionId: string) => get(supervisorsAtom).get(sessionId));
```

```ts
// packages/web/src/features/supervisor/hooks/use-supervisor.ts
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect } from 'react';
import type { Session, Supervisor, SupervisorCycle } from '@coder-studio/core';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { supervisorCyclesAtom, supervisorDialogAtom, supervisorHydratedAtomFamily, supervisorsAtom } from '../atoms';

export function useSupervisor(session: Session) {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setSupervisors = useSetAtom(supervisorsAtom);
  const setCycles = useSetAtom(supervisorCyclesAtom);
  const hydrated = useAtomValue(supervisorHydratedAtomFamily(session.id));
  const setHydrated = useSetAtom(supervisorHydratedAtomFamily(session.id));
  const setDialog = useSetAtom(supervisorDialogAtom);

  useEffect(() => {
    if (hydrated || session.state === 'draft' || session.capability !== 'full') {
      return;
    }

    void dispatch<{ supervisor: Supervisor | null }>('supervisor.get', { sessionId: session.id }).then((result) => {
      if (!result.ok) {
        return;
      }
      const supervisor = result.data?.supervisor ?? null;
      if (supervisor) {
        setSupervisors((prev) => new Map(prev).set(session.id, supervisor));
        setCycles((prev) => new Map(prev).set(supervisor.id, supervisor.cycles as SupervisorCycle[]));
      }
      setHydrated(true);
    });
  }, [dispatch, hydrated, session, setCycles, setHydrated, setSupervisors]);

  const openDialog = useCallback(
    (mode: 'enable' | 'edit' | 'disable', supervisor?: Supervisor) => {
      setDialog({
        open: true,
        sessionId: session.id,
        mode,
        draftObjective: supervisor?.objective ?? '',
        draftEvaluatorProviderId: (supervisor?.evaluatorProviderId as 'claude' | 'codex') ?? 'claude',
      });
    },
    [session.id, setDialog]
  );

  return { openDialog };
}
```

```tsx
// packages/web/src/features/supervisor/components/supervisor-card.tsx
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useMemo } from 'react';
import { supervisorDialogAtom, supervisorsAtom, supervisorCyclesAtom } from '../atoms';
import { dispatchCommandAtom } from '../../../atoms/connection';

export function SupervisorCard({ sessionId, workspaceId }: { sessionId: string; workspaceId: string }) {
  const supervisors = useAtomValue(supervisorsAtom);
  const cyclesBySupervisor = useAtomValue(supervisorCyclesAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setDialog = useSetAtom(supervisorDialogAtom);
  const supervisor = supervisors.get(sessionId);

  const cycles = useMemo(
    () => (supervisor ? (cyclesBySupervisor.get(supervisor.id) ?? []).slice(0, 5) : []),
    [cyclesBySupervisor, supervisor]
  );
  const latestProgress = cycles.find((cycle) => cycle.progress != null)?.progress ?? 0;
  const openDialog = useCallback(
    (mode: 'enable' | 'edit' | 'disable') => {
      setDialog({
        open: true,
        sessionId,
        mode,
        draftObjective: supervisor?.objective ?? '',
        draftEvaluatorProviderId: (supervisor?.evaluatorProviderId as 'claude' | 'codex') ?? 'claude',
      });
    },
    [sessionId, setDialog, supervisor]
  );

  const handlePause = useCallback(async () => {
    if (!supervisor) return;
    await dispatch('supervisor.pause', { id: supervisor.id });
  }, [dispatch, supervisor]);

  const handleResume = useCallback(async () => {
    if (!supervisor) return;
    await dispatch('supervisor.resume', { id: supervisor.id });
  }, [dispatch, supervisor]);

  const handleTrigger = useCallback(async () => {
    if (!supervisor) return;
    await dispatch('supervisor.trigger', { id: supervisor.id });
  }, [dispatch, supervisor]);

  if (!supervisor) {
    return (
      <div className="supervisor-card supervisor-card-inactive">
        <button className="btn btn-secondary btn-sm" onClick={() => openDialog('enable')} aria-label="启用 Supervisor">
          启用 Supervisor
        </button>
      </div>
    );
  }

  return (
    <div className={`supervisor-card supervisor-state-${supervisor.state}`}>
      <div className="supervisor-header">
        <span className="supervisor-icon">✓</span>
        <span className="supervisor-label">Supervisor</span>
        <span className="supervisor-state-tag">{supervisor.state}</span>
      </div>

      <div className="supervisor-objective-row" title={supervisor.objective}>
        <span className="supervisor-objective-text">{supervisor.objective}</span>
        <span className="supervisor-provider-pill">{supervisor.evaluatorProviderId}</span>
      </div>

      <div className="supervisor-progress-block">
        <div className="supervisor-progress-track">
          <div className="supervisor-progress-fill" style={{ width: `${latestProgress}%` }} />
        </div>
        <ul className="supervisor-history-list">
          {cycles.map((cycle) => (
            <li key={cycle.id} className={`supervisor-history-item supervisor-history-${cycle.status}`}>
              <span>{cycle.trigger === 'manual' ? 'Manual' : 'Turn'}</span>
              <span>{cycle.progress ?? 0}%</span>
              <span>{cycle.result ?? cycle.errorReason ?? cycle.status}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="supervisor-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => openDialog('edit', supervisor)} aria-label="编辑 Supervisor">编辑</button>
        {supervisor.state === 'paused' ? (
          <button className="btn btn-ghost btn-sm" onClick={handleResume} aria-label="恢复">恢复</button>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={handlePause} aria-label="暂停">暂停</button>
        )}
        {supervisor.state === 'error' ? (
          <button className="btn btn-ghost btn-sm" onClick={handleTrigger} aria-label="重试">重试</button>
        ) : null}
        <button className="btn btn-ghost btn-sm" onClick={handleTrigger} aria-label="触发评估">触发评估</button>
        <button className="btn btn-ghost btn-sm btn-danger" onClick={() => openDialog('disable', supervisor)} aria-label="禁用 Supervisor">禁用</button>
      </div>
    </div>
  );
}
```

```tsx
// packages/web/src/features/supervisor/components/objective-dialog.tsx
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useState } from 'react';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { supervisorDialogAtom, supervisorsAtom } from '../atoms';

const EVALUATOR_OPTIONS = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
] as const;

export function ObjectiveDialog({ workspaceId }: { workspaceId: string }) {
  const dialog = useAtomValue(supervisorDialogAtom);
  const supervisors = useAtomValue(supervisorsAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setDialog = useSetAtom(supervisorDialogAtom);
  const [providerConfigured, setProviderConfigured] = useState<Record<'claude' | 'codex', boolean>>({
    claude: false,
    codex: true,
  });

  const supervisor = dialog.sessionId ? supervisors.get(dialog.sessionId) : undefined;

  useEffect(() => {
    void dispatch<Record<string, unknown>>('settings.get', {}).then((result) => {
      if (!result.ok) {
        return;
      }
      const settings = result.data ?? {};
      setProviderConfigured({
        claude: Boolean(settings['providers.apiKey']),
        codex: true,
      });
    });
  }, [dispatch]);

  const close = useCallback(() => {
    setDialog({
      open: false,
      sessionId: null,
      mode: 'enable',
      draftObjective: '',
      draftEvaluatorProviderId: 'claude',
    });
  }, [setDialog]);

  const updateDraft = useCallback(
    (patch: Partial<typeof dialog>) => setDialog({ ...dialog, ...patch }),
    [dialog, setDialog]
  );

  const confirm = useCallback(async () => {
    if (!dialog.sessionId) return;
    if (dialog.mode === 'disable' && supervisor) {
      const result = await dispatch('supervisor.delete', { id: supervisor.id });
      if (result.ok) close();
      return;
    }

    const payload = {
      objective: dialog.draftObjective.trim(),
      evaluatorProviderId: dialog.draftEvaluatorProviderId,
    };
    const result = dialog.mode === 'enable'
      ? await dispatch('supervisor.create', { sessionId: dialog.sessionId, workspaceId, ...payload })
      : await dispatch('supervisor.update', { id: supervisor?.id, ...payload });

    if (result.ok) {
      close();
    }
  }, [close, dialog, dispatch, supervisor, workspaceId]);

  if (!dialog.open) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3>{dialog.mode === 'disable' ? '禁用 Supervisor' : dialog.mode === 'edit' ? '编辑 Supervisor' : '启用 Supervisor'}</h3>
          <button className="btn btn-ghost btn-sm" onClick={close}>✕</button>
        </div>

        <div className="modal-body">
          {dialog.mode === 'disable' ? (
            <>
              <p className="dialog-helper">禁用会停止评估并清空历史</p>
              <pre className="objective-preview">{supervisor?.objective ?? ''}</pre>
            </>
          ) : (
            <>
              <div className="form-group">
                <label htmlFor="objective">目标描述</label>
                <textarea
                  id="objective"
                  className="input textarea"
                  rows={5}
                  value={dialog.draftObjective}
                  onChange={(event) => updateDraft({ draftObjective: event.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="evaluator-provider">Evaluator Provider</label>
                <select
                  id="evaluator-provider"
                  className="input"
                  value={dialog.draftEvaluatorProviderId}
                  onChange={(event) => updateDraft({ draftEvaluatorProviderId: event.target.value as 'claude' | 'codex' })}
                >
                  {EVALUATOR_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="dialog-helper">
                  {providerConfigured[dialog.draftEvaluatorProviderId]
                    ? '将复用该 provider 当前已配置的 API key / model'
                    : '当前 provider 未配置，保存时会被服务端拒绝'}
                </p>
              </div>
              <pre className="objective-preview">{dialog.draftObjective}</pre>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={close}>取消</button>
          <button
            className={`btn ${dialog.mode === 'disable' ? 'btn-danger' : 'btn-primary'}`}
            onClick={confirm}
            disabled={dialog.mode !== 'disable' && !dialog.draftObjective.trim()}
          >
            {dialog.mode === 'disable' ? '禁用' : dialog.mode === 'edit' ? '保存' : '启用'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

```tsx
// packages/web/src/features/agent-panes/components/session-card.tsx
import { ObjectiveDialog } from '../../supervisor/components/objective-dialog';
import { SupervisorCard } from '../../supervisor/components/supervisor-card';
import { useSupervisor } from '../../supervisor/hooks/use-supervisor';
import { XtermHost } from '../../terminal-panel/components/xterm-host';
import { Send } from 'lucide-react';
import { encodeUtf8ToBase64 } from '../../../lib/base64';

export const SessionCard: FC<SessionCardProps> = ({ sessionId }) => {
  const session = useAtomValue(sessionByIdAtomFamily(sessionId));
  const dispatch = useAtomValue(dispatchCommandAtom);
  const [inputValue, setInputValue] = useState('');

  if (!session) {
    return null;
  }

  useSupervisor(session);

  return (
    <div className="session-card agent-pane">
      <div className="session-progress">
        <div className={`session-progress-bar ${getSessionProgressClass(session.state)}`} style={{ width: `${getProgressWidth(session.state)}%` }} />
      </div>

      <div className="session-header">
        <div className="session-header-left">
          <span className={`session-dot ${getSessionDotClass(session.state)}`} />
          <div className="session-header-copy">
            <div className="session-title-row">
              <span className="session-title">{formatSessionLabel(session.id)}</span>
              <span className="badge badge-blue session-provider-badge">{formatProviderLabel(session.providerId)}</span>
              <span className={`session-state-badge ${getSessionBadgeClass(session.state)}`}>
                {formatSessionStateLabel(session.state)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {session.state !== 'draft' && session.capability === 'full' ? (
        <>
          <SupervisorCard sessionId={session.id} workspaceId={session.workspaceId} />
          <ObjectiveDialog workspaceId={session.workspaceId} />
        </>
      ) : null}

      <div className="session-terminal">
        <XtermHost
          terminalId={session.terminalId}
          workspaceId={session.workspaceId}
          readOnly={!isSessionInteractive(session.state)}
        />
      </div>

      {isSessionInteractive(session.state) ? (
        <div className="session-input">
          <input
            className="input"
            type="text"
            value={inputValue}
            onInput={(event) => setInputValue((event.target as HTMLInputElement).value)}
            onCompositionEnd={(event) => setInputValue((event.target as HTMLInputElement).value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                void dispatch('terminal.input', {
                  terminalId: session.terminalId,
                  bytes: encodeUtf8ToBase64(`${inputValue}\n`),
                });
                setInputValue('');
              }
            }}
            placeholder="Ask the agent to inspect, edit, or run a command"
          />
          <button className="btn btn-primary btn-sm" onClick={() => {
            void dispatch('terminal.input', {
              terminalId: session.terminalId,
              bytes: encodeUtf8ToBase64(`${inputValue}\n`),
            });
            setInputValue('');
          }} disabled={!inputValue.trim()}>
            <Send size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
};
```

```ts
// packages/web/src/app/providers.tsx
export function routeEventToAtom(topic: string, payload: unknown, store: ReturnType<typeof useStore>): void {
  if (topic === 'connection.ready') {
    const data = payload as { version: string; serverInstanceId: string; isWriter: boolean };
    store.set(serverInfoAtom, { version: data.version, serverInstanceId: data.serverInstanceId });
    store.set(isWriterAtom, data.isWriter);
    store.set(connectionErrorAtom, null);
    return;
  }

  const workspaceMatch = topic.match(/^workspace\.([^.]+)\.(.+)$/);
  if (!workspaceMatch) {
    return;
  }

  const workspaceId = workspaceMatch[1]!;
  const subtopic = workspaceMatch[2]!;
  const sessionMatch = subtopic.match(/^session\.([^.]+)\.(.+)$/);
  if (!sessionMatch) {
    return;
  }

  const sessionId = sessionMatch[1]!;
  const sessionSubtopic = sessionMatch[2]!;

  if (sessionSubtopic === 'supervisor.state') {
    const data = payload as { supervisor?: Supervisor; supervisorId?: string; event: string };
    if (data.event === 'deleted' && data.supervisorId) {
      store.set(supervisorsAtom, (prev: Map<string, Supervisor>) => {
        const next = new Map(prev);
        for (const [existingSessionId, supervisor] of next.entries()) {
          if (supervisor.id === data.supervisorId) {
            next.delete(existingSessionId);
            break;
          }
        }
        return next;
      });
      store.set(supervisorCyclesAtom, (prev: Map<string, SupervisorCycle[]>) => {
        const next = new Map(prev);
        next.delete(data.supervisorId!);
        return next;
      });
      return;
    }

    if (data.supervisor) {
      store.set(supervisorsAtom, (prev: Map<string, Supervisor>) => new Map(prev).set(sessionId, data.supervisor!));
      if (Array.isArray(data.supervisor.cycles)) {
        store.set(supervisorCyclesAtom, (prev: Map<string, SupervisorCycle[]>) => new Map(prev).set(data.supervisor!.id, data.supervisor!.cycles));
      }
    }
    return;
  }

  if (sessionSubtopic === 'supervisor.cycle') {
    const data = payload as { cycle: SupervisorCycle; event: string };
    store.set(supervisorCyclesAtom, (prev: Map<string, SupervisorCycle[]>) => {
      const next = new Map(prev);
      const existing = next.get(data.cycle.supervisorId) ?? [];
      const deduped = existing.filter((cycle) => cycle.id !== data.cycle.id);
      next.set(data.cycle.supervisorId, [data.cycle, ...deduped].slice(0, 20));
      return next;
    });
  }
}
```

```css
/* packages/web/src/styles/components.css */
.supervisor-objective-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  margin-bottom: var(--sp-2);
}

.supervisor-objective-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.supervisor-provider-pill {
  flex-shrink: 0;
  padding: 0 var(--sp-2);
  border-radius: var(--radius-sm);
  background: rgba(108, 182, 255, 0.12);
  color: var(--accent-blue);
  font-size: var(--text-xs);
}

.supervisor-progress-block {
  display: grid;
  gap: var(--sp-2);
  margin-bottom: var(--sp-2);
}

.supervisor-progress-track {
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: rgba(114, 132, 146, 0.18);
  overflow: hidden;
}

.supervisor-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent-blue), var(--accent-green));
}

.supervisor-history-list {
  display: grid;
  gap: var(--sp-1);
  list-style: none;
  margin: 0;
  padding: 0;
}

.supervisor-history-item {
  display: grid;
  grid-template-columns: 56px 44px minmax(0, 1fr);
  gap: var(--sp-2);
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.dialog-helper {
  margin-top: var(--sp-1);
  font-size: var(--text-xs);
  color: var(--text-secondary);
}
```

- [ ] **Step 4: Run the web test suite for supervisor UI**

Run: `pnpm --dir packages/web exec vitest run src/features/supervisor/components/objective-dialog.test.tsx src/features/supervisor/components/supervisor-card.test.tsx src/features/agent-panes/components/session-card.test.tsx src/app/providers.test.tsx`
Expected: PASS with one-time hydration, enable/edit/disable dialog flow, per-supervisor evaluator selection, server-authoritative event routing, and recent cycle display inside `SessionCard`.

- [ ] **Step 5: Commit the Agent Pane UI wiring**

```bash
git add packages/web/src/features/supervisor/atoms.ts packages/web/src/features/supervisor/hooks/use-supervisor.ts packages/web/src/features/supervisor/components/supervisor-card.tsx packages/web/src/features/supervisor/components/objective-dialog.tsx packages/web/src/features/agent-panes/components/session-card.tsx packages/web/src/app/providers.tsx packages/web/src/styles/components.css packages/web/src/features/supervisor/components/supervisor-card.test.tsx packages/web/src/features/supervisor/components/objective-dialog.test.tsx packages/web/src/features/agent-panes/components/session-card.test.tsx packages/web/src/app/providers.test.tsx
git commit -m "feat(supervisor): wire agent pane supervisor ui"
```

### Task 7: Add Integration Coverage And Final Verification

**Files:**
- Create: `packages/server/src/__tests__/supervisor-integration.test.ts`
- Modify: `e2e/specs/phase3/supervisor.spec.ts`
- Modify: `e2e/specs/phase3/supervisor-visual.spec.ts`

- [ ] **Step 1: Write the failing integration and acceptance tests**

```ts
// packages/server/src/__tests__/supervisor-integration.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../server.js';

describe('Supervisor integration', () => {
  let server: Awaited<ReturnType<typeof createServer>>;

  beforeEach(async () => {
    server = await createServer({
      dataDir: ':memory:',
      host: '127.0.0.1',
      port: 0,
    } as any);
  });

  afterEach(async () => {
    await server.stop();
  });

  it('creates a cycle on manual trigger and persists it into supervisor.get', async () => {
    const ctx = server.__test__!.commandContext;

    ctx.workspaceMgr.get = () => ({ id: 'ws-1', path: process.cwd() });
    ctx.sessionMgr.get = () => ({ id: 'sess-1', workspaceId: 'ws-1', terminalId: 'term-1', providerId: 'claude', state: 'running', capability: 'full', startedAt: 1, lastActiveAt: 1, transcriptPath: undefined });
    ctx.providerRegistry = [
      {
        id: 'claude',
        capability: 'full',
        buildSupervisorEvalCommand: () => ({
          argv: ['node', '-e', `process.stdout.write(${JSON.stringify(JSON.stringify({ progress: 30, summary: 'manual trigger works', shouldInject: false, confidence: 0.7 }))})`],
          cwd: process.cwd(),
          env: {},
        }),
      },
    ];

    ctx.supervisorMgr['deps'].providerConfigRepo.get = () => ({ model: 'claude-sonnet-4-6', additionalArgs: [], envVars: {} });

    const supervisor = await ctx.supervisorMgr.create({
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
      objective: 'Verify end-to-end persistence',
      evaluatorProviderId: 'claude',
    });

    const cycle = await ctx.supervisorMgr.triggerEvaluation(supervisor.id);
    const fetched = ctx.supervisorMgr.getBySession('sess-1');

    expect(cycle.status).toMatch(/completed|injected/);
    expect(fetched?.cycles.length).toBeGreaterThan(0);
  });
});
```

```ts
// e2e/specs/phase3/supervisor.spec.ts
import { test, expect } from '@playwright/test';

test.describe('@phase3 supervisor acceptance', () => {
  test('P3S-01 enables, triggers, pauses, resumes, and disables supervisor from the agent pane', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Claude' }).click();
    await page.getByRole('button', { name: '启用 Supervisor' }).click();
    await page.getByLabel('目标描述').fill('Keep the implementation focused on persistence and event-driven scheduling');
    await page.getByLabel('Evaluator Provider').selectOption('codex');
    await page.getByRole('button', { name: '启用' }).click();

    await expect(page.getByText('Supervisor')).toBeVisible();
    await expect(page.getByText('codex')).toBeVisible();

    await page.getByRole('button', { name: '触发评估' }).click();
    await expect(page.locator('.supervisor-history-item')).toHaveCount(1);

    await page.getByRole('button', { name: '暂停' }).click();
    await expect(page.getByText('paused')).toBeVisible();

    await page.getByRole('button', { name: '恢复' }).click();
    await expect(page.getByText('idle')).toBeVisible();

    await page.getByRole('button', { name: '禁用 Supervisor' }).click();
    await page.getByRole('button', { name: '禁用' }).click();
    await expect(page.getByRole('button', { name: '启用 Supervisor' })).toBeVisible();
  });
});
```

```ts
// e2e/specs/phase3/supervisor-visual.spec.ts
import { test, expect } from '@playwright/test';

test.describe('@phase3 supervisor visual acceptance', () => {
  test('P3SV-01 supervisor card shows objective row, provider pill, and progress track', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Claude' }).click();
    await page.getByRole('button', { name: '启用 Supervisor' }).click();
    await page.getByLabel('目标描述').fill('Render a visible supervisor card');
    await page.getByRole('button', { name: '启用' }).click();

    await expect(page.locator('.supervisor-objective-row')).toBeVisible();
    await expect(page.locator('.supervisor-provider-pill')).toBeVisible();
    await expect(page.locator('.supervisor-progress-track')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the integration and acceptance suites to confirm there are still gaps**

Run: `pnpm --dir packages/server exec vitest run src/__tests__/supervisor-integration.test.ts && pnpm --dir e2e exec playwright test --config playwright.config.ts e2e/specs/phase3/supervisor.spec.ts e2e/specs/phase3/supervisor-visual.spec.ts`
Expected: FAIL until the server boot wiring, UI hydration, and real cycle persistence all work together.

- [ ] **Step 3: Add the final glue needed for deterministic integration verification**

```ts
// packages/server/src/__tests__/supervisor-integration.test.ts
ctx.supervisorMgr['contextBuilder'] = {
  build: async () => ({
    objective: 'Verify end-to-end persistence',
    sessionId: 'sess-1',
    workspaceId: 'ws-1',
    workspacePath: process.cwd(),
    sessionProviderId: 'claude',
    evaluatorProviderId: 'claude',
    sessionState: 'running',
    transcriptExcerpt: 'assistant: built the persistent supervisor repos',
    evidenceSource: 'transcript',
    lastTurnId: 'turn-1',
  }),
};
```

```ts
// e2e/specs/phase3/supervisor.spec.ts
await expect(page.locator('.supervisor-history-item')).toContainText(['Manual', '30%']);
await expect(page.locator('.supervisor-provider-pill')).toContainText('codex');
```

```ts
// e2e/specs/phase3/supervisor-visual.spec.ts
await expect(page.locator('.supervisor-card')).toHaveCSS('border-radius', '12px');
await expect(page.locator('.supervisor-progress-fill')).toHaveCount(1);
```

- [ ] **Step 4: Run the final verification matrix**

Run: `pnpm --dir packages/core build && pnpm --dir packages/providers build && pnpm --dir packages/server build && pnpm --dir packages/server test && pnpm --dir packages/web test && pnpm --dir e2e exec playwright test --config playwright.config.ts e2e/specs/phase3/supervisor.spec.ts e2e/specs/phase3/supervisor-visual.spec.ts`
Expected: All targeted Phase 3 supervisor tests PASS. No `intervalMs` references remain in supervisor codepaths, `turn_completed` is the only automatic trigger, and UI operations work after refresh through `supervisor.get` hydration plus WebSocket updates.

- [ ] **Step 5: Commit the verification coverage**

```bash
git add packages/server/src/__tests__/supervisor-integration.test.ts e2e/specs/phase3/supervisor.spec.ts e2e/specs/phase3/supervisor-visual.spec.ts
git commit -m "test(supervisor): add phase3 integration coverage"
```
