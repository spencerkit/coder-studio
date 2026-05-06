# Codex Notify Hook Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Codex provider from `capability: 'limited'` to `'full'` by integrating Codex's `-c notify=[...]` argv override, so every turn produces a `TurnCompleted` event + resolvable rollout transcript path. Also persist `transcript_path` for Claude sessions.

**Architecture:** Server injects `-c notify='["node","<bridge>"]'` into Codex's argv. When Codex completes a turn, it spawns the bridge which POSTs the payload (passed as last argv token) to `/internal/hooks/agent-turn-complete?token=<t>&coder_studio_session_id=<s>`. The `HooksManager` resolves the coder-studio session from the query, converts the `ProviderEvent` into a `ProviderHookEvent` `{ kind: 'TurnCompleted' }`, and routes to `SessionManager`. Transcripts are resolved by scanning `~/.codex/sessions/**/rollout-*-<thread-id>.jsonl` on first successful turn.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, Fastify, `node-pty`, monorepo with `@coder-studio/core` / `providers` / `server` / `hook-bridge` packages.

**Related Spec:** `docs/superpowers/specs/2026-04-20-codex-notify-hook-integration-design.md`

---

## Task List Overview

| # | Task | Files |
|---|---|---|
| 1 | Generalize migration runner to discover SQL files | `storage/db.ts`, new test |
| 2 | Add migration `002_transcript_path.sql` | migrations dir |
| 3 | Extend `Session` + `LaunchContext` + `ProviderDefinition` types | `core/src/domain/types.ts`, `core/src/provider/definition.ts` |
| 4 | Extend server `ProviderHookEvent` with `TurnCompleted`; `SessionStart` carries `transcriptPath` | `server/src/session/manager.ts` |
| 5 | SessionManager persists + writes `transcriptPath` in `applyHookEvent` | `server/src/session/manager.ts` |
| 6 | Inline `createSessionDatabase` + `SessionRepo` handle `transcript_path` column | `server/src/server.ts`, `storage/repositories/session-repo.ts` |
| 7 | Claude `parseEvent` preserves `transcript_path` via `ProviderEvent.payload` (regression test) | `providers/src/claude/hooks-template.ts` |
| 8 | `resolveCodexTranscriptPath` utility + tests | `providers/src/codex/resolve-transcript.ts` (new) |
| 9 | Claude definition adds `resolveTranscriptPath` (uses stored path) | `providers/src/claude/definition.ts` |
| 10 | Codex `hooks` descriptor: real `parseEvent('agent-turn-complete', …)` + no-op config | `providers/src/codex/definition.ts` |
| 11 | Codex `buildCommand` + `buildResumeCommand` inject `-c notify=[...]`; capability → `'full'` | `providers/src/codex/definition.ts` |
| 12 | Bridge generator branches stdin (Claude) vs argv (Codex) | `server/src/hooks/bridge.ts`, tests |
| 13 | Sync `packages/hook-bridge/src/codex-bridge.js` to argv form | `packages/hook-bridge/src/codex-bridge.js` |
| 14 | Endpoint propagates `coder_studio_session_id` query to callback context | `server/src/hooks/endpoint.ts`, `server/src/app.ts` |
| 15 | `HooksManager.handleHookEvent` resolves session + routes to `SessionManager` | `server/src/hooks/manager.ts` |
| 16 | `server.ts` wires real handler + fills `LaunchContext.bridgeScriptPath` via `SessionManager.create` | `server/src/server.ts`, `server/src/session/manager.ts` |
| 17 | End-to-end integration test with fake-codex script | `server/src/__tests__/codex-hook-integration.test.ts` (new) |

---

## Commands You'll Need

**Run package tests** (from repo root):
```bash
pnpm --filter @coder-studio/server test -- --run --reporter=verbose <path-glob>
pnpm --filter @coder-studio/providers test -- --run --reporter=verbose <path-glob>
pnpm --filter @coder-studio/core build
```

**Single-file vitest:**
```bash
pnpm --filter @coder-studio/server vitest run src/hooks/bridge.test.ts
```

---

### Task 1: Generalize migration runner

**Why:** Currently `runMigrations` hardcodes `001_init.sql`. We need to pick up `002_transcript_path.sql` automatically, and any future migration.

**Files:**
- Modify: `packages/server/src/storage/db.ts:39-65`
- Test: `packages/server/src/storage/db.test.ts` (new)

- [ ] **Step 1: Write failing test**

Create `packages/server/src/storage/db.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { runMigrations } from './db.js';

describe('runMigrations', () => {
  const tempDbs: string[] = [];

  afterEach(() => {
    for (const p of tempDbs) if (existsSync(p)) rmSync(p);
    tempDbs.length = 0;
  });

  function tempDb() {
    const p = join(tmpdir(), `cs-mig-${Date.now()}-${Math.random()}.db`);
    tempDbs.push(p);
    return new Database(p);
  }

  it('applies all sequentially-numbered migrations in order', () => {
    const db = tempDb();
    runMigrations(db);

    // 001_init.sql must have produced the sessions table
    const cols = db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>;
    expect(cols.some(c => c.name === 'id')).toBe(true);

    // every discovered migration should be recorded in _migrations
    const applied = db.prepare(`SELECT name FROM _migrations ORDER BY id`).all() as Array<{ name: string }>;
    expect(applied[0].name).toBe('001_init');
    // After Task 2 lands there will be at least one more migration:
    // we only assert the first row here so this test stays stable as migrations grow.
  });

  it('is idempotent — running twice does not re-apply migrations', () => {
    const db = tempDb();
    runMigrations(db);
    const firstCount = db.prepare(`SELECT COUNT(*) as n FROM _migrations`).get() as { n: number };

    runMigrations(db);
    const secondCount = db.prepare(`SELECT COUNT(*) as n FROM _migrations`).get() as { n: number };
    expect(secondCount.n).toBe(firstCount.n);
  });
});
```

- [ ] **Step 2: Run test to verify it fails appropriately**

```bash
pnpm --filter @coder-studio/server vitest run src/storage/db.test.ts
```

Expected: passes the first test today (001 is the only migration). Second test may already pass.

> If both pass already, proceed — the tests are the contract we want preserved after refactoring.

- [ ] **Step 3: Refactor `runMigrations` to discover migrations dynamically**

Replace `runMigrations` in `packages/server/src/storage/db.ts`:

```typescript
export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    );
  `);

  const migrationsDir = join(import.meta.dirname, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();

  const appliedNames = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>).map((r) => r.name)
  );

  for (const file of files) {
    const name = file.replace(/\.sql$/, '');
    if (appliedNames.has(name)) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(name, Date.now());
    });
    tx();
  }
}
```

Add `readdirSync` to the existing fs import at the top:

```typescript
import { readFileSync, readdirSync } from 'fs';
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @coder-studio/server vitest run src/storage/db.test.ts
pnpm --filter @coder-studio/server test -- --run
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/storage/db.ts packages/server/src/storage/db.test.ts
git commit -m "refactor: discover SQL migrations dynamically"
```

---

### Task 2: Add migration `002_transcript_path.sql`

**Files:**
- Create: `packages/server/src/storage/migrations/002_transcript_path.sql`
- Test: extend `packages/server/src/storage/db.test.ts`

- [ ] **Step 1: Write failing test** — append to `db.test.ts`:

```typescript
  it('migration 002 adds transcript_path column to sessions', () => {
    const db = tempDb();
    runMigrations(db);

    const cols = db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>;
    const transcriptCol = cols.find(c => c.name === 'transcript_path');
    expect(transcriptCol).toBeDefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @coder-studio/server vitest run src/storage/db.test.ts -t "migration 002"
```

Expected: FAIL — `transcriptCol` is `undefined`.

- [ ] **Step 3: Create migration file**

Create `packages/server/src/storage/migrations/002_transcript_path.sql`:

```sql
-- Adds transcript_path column for storing provider session log paths
-- (Claude: ~/.claude/projects/<hash>/<session>.jsonl,
--  Codex: ~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*-<uuid>.jsonl)

ALTER TABLE sessions ADD COLUMN transcript_path TEXT;
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm --filter @coder-studio/server vitest run src/storage/db.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/storage/migrations/002_transcript_path.sql packages/server/src/storage/db.test.ts
git commit -m "feat(db): add transcript_path column to sessions"
```

---

### Task 3: Extend core types

**Why:** `LaunchContext` needs to carry the bridge script path (so Codex `buildCommand` can reference it). `ProviderDefinition` gets optional `resolveTranscriptPath`. `Session` gets `transcriptPath?`.

**Files:**
- Modify: `packages/core/src/domain/types.ts:38-51`
- Modify: `packages/core/src/provider/definition.ts:4-42`

- [ ] **Step 1: Update `Session` in `packages/core/src/domain/types.ts`**

Add `transcriptPath?: string;` after `errorReason?: string;` (keep alphabetical-ish order intact):

```typescript
export interface Session {
  id: string;
  workspaceId: string;
  terminalId: string;
  providerId: string;
  state: SessionState;
  resumeId?: string;
  capability: 'full' | 'limited' | 'unsupported';
  startedAt: number;
  lastActiveAt: number;
  endedAt?: number;
  completionPercent?: number;
  errorReason?: string;
  transcriptPath?: string;   // NEW
}
```

- [ ] **Step 2: Update `LaunchContext` and `ProviderDefinition` in `packages/core/src/provider/definition.ts`**

```typescript
export interface LaunchContext {
  sessionId: string;
  workspacePath: string;
  bridgeScriptPath?: string;  // NEW — absolute path to provider bridge script
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
  ): {
    argv: string[];
    env: Record<string, string>;
    cwd: string;
  } | null;

  configSchema: ZodSchema<ProviderConfig>;
  defaultConfig: ProviderConfig;
  requiredCommands: string[];
  hooks: HooksDescriptor;

  // NEW — optional transcript path resolver.
  // Returns absolute path or null if not yet discoverable.
  // Must not throw.
  resolveTranscriptPath?(session: Session): Promise<string | null>;
}
```

Add `import type { Session } from '../domain/types';` to the top.

- [ ] **Step 3: Build core to validate types**

```bash
pnpm --filter @coder-studio/core build
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/domain/types.ts packages/core/src/provider/definition.ts
git commit -m "feat(core): add transcriptPath + bridgeScriptPath + resolveTranscriptPath"
```

---

### Task 4: Extend `ProviderHookEvent` in SessionManager

**Why:** Add `TurnCompleted` variant and extend `SessionStart` with `transcriptPath?`.

**Files:**
- Modify: `packages/server/src/session/manager.ts:429-432`

- [ ] **Step 1: Replace the `ProviderHookEvent` type**

In `packages/server/src/session/manager.ts` change:

```typescript
export type ProviderHookEvent =
  | { kind: 'SessionStart'; resumeId: string }
  | { kind: 'Stop' }
  | { kind: 'Progress'; percent: number };
```

to:

```typescript
export type ProviderHookEvent =
  | { kind: 'SessionStart'; resumeId: string; transcriptPath?: string }
  | { kind: 'Stop' }
  | { kind: 'TurnCompleted'; resumeId: string; turnId: string }
  | { kind: 'Progress'; percent: number };
```

- [ ] **Step 2: Type check**

```bash
pnpm --filter @coder-studio/server exec tsc --noEmit
```

Expected: compile succeeds. `applyHookEvent` won't fail to compile yet because it only switches on existing kinds (no exhaustiveness check). Task 5 adds the new branches.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/session/manager.ts
git commit -m "feat(session): extend ProviderHookEvent with TurnCompleted + transcriptPath"
```

---

### Task 5: SessionManager handles `TurnCompleted` + persists `transcriptPath`

**Files:**
- Modify: `packages/server/src/session/manager.ts:219-258` (`applyHookEvent`)
- Test: `packages/server/src/__tests__/session-integration.test.ts` (extend)

- [ ] **Step 1: Write failing tests**

Open `packages/server/src/__tests__/session-integration.test.ts` and locate the existing `describe('SessionManager', ...)` block (find it via `grep`). Append these test cases inside:

```typescript
  describe('TurnCompleted hook event', () => {
    it('fills resume_id + transcript_path on first TurnCompleted', async () => {
      const session = await sessionMgr.create({
        workspaceId: 'ws-1',
        workspacePath: '/tmp',
        providerId: 'codex',
        provider: fakeCodexProvider,   // defined below
      });

      sessionMgr.onHookEvent(session.id, {
        kind: 'TurnCompleted',
        resumeId: 'thread-uuid-1',
        turnId: 'turn-1',
      });

      // wait a tick for async transcript resolution
      await new Promise(r => setImmediate(r));

      const updated = sessionMgr.get(session.id)!;
      expect(updated.resumeId).toBe('thread-uuid-1');
      expect(updated.transcriptPath).toBe('/fake/rollout.jsonl');
    });

    it('does not overwrite resumeId on subsequent TurnCompleted', async () => {
      const session = await sessionMgr.create({
        workspaceId: 'ws-1',
        workspacePath: '/tmp',
        providerId: 'codex',
        provider: fakeCodexProvider,
      });

      sessionMgr.onHookEvent(session.id, { kind: 'TurnCompleted', resumeId: 'uuid-a', turnId: 't1' });
      sessionMgr.onHookEvent(session.id, { kind: 'TurnCompleted', resumeId: 'uuid-b', turnId: 't2' });

      const final = sessionMgr.get(session.id)!;
      expect(final.resumeId).toBe('uuid-a');
    });
  });

  describe('SessionStart with transcriptPath', () => {
    it('persists transcript_path when hook payload carries it', async () => {
      const session = await sessionMgr.create({
        workspaceId: 'ws-1',
        workspacePath: '/tmp',
        providerId: 'claude',
        provider: fakeClaudeProvider,
      });

      sessionMgr.onHookEvent(session.id, {
        kind: 'SessionStart',
        resumeId: 'claude-sess-1',
        transcriptPath: '/home/user/.claude/projects/x/claude-sess-1.jsonl',
      });

      const row = sessionDb.findById(session.id);
      expect(row).toMatchObject({
        transcriptPath: '/home/user/.claude/projects/x/claude-sess-1.jsonl',
      });
    });
  });
```

Near the top of `packages/server/src/__tests__/session-integration.test.ts`, add the fake providers used above as new `const` declarations:

```typescript
const fakeCodexProvider: ProviderDefinition = {
  id: 'codex',
  displayName: 'Codex',
  badge: 'Codex',
  capability: 'full',
  buildCommand: () => ({ argv: ['codex'], env: {}, cwd: '/tmp' }),
  buildResumeCommand: () => null,
  configSchema: {} as any,
  defaultConfig: {},
  requiredCommands: ['codex'],
  hooks: {} as any,
  async resolveTranscriptPath() { return '/fake/rollout.jsonl'; },
};

const fakeClaudeProvider: ProviderDefinition = {
  id: 'claude',
  displayName: 'Claude',
  badge: 'Claude',
  capability: 'full',
  buildCommand: () => ({ argv: ['claude'], env: {}, cwd: '/tmp' }),
  buildResumeCommand: () => null,
  configSchema: {} as any,
  defaultConfig: {},
  requiredCommands: ['claude'],
  hooks: {} as any,
};
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @coder-studio/server vitest run src/__tests__/session-integration.test.ts -t "TurnCompleted"
```

Expected: FAIL — `transcriptPath` missing from session DTO.

- [ ] **Step 3: Implement `TurnCompleted` + `SessionStart` extension in `applyHookEvent`**

In `packages/server/src/session/manager.ts`, replace the body of `applyHookEvent`:

```typescript
private applyHookEvent(sessionId: string, event: ProviderHookEvent): void {
  const session = this.sessions.get(sessionId);
  if (!session) return;

  const prev = session.state;

  switch (event.kind) {
    case 'SessionStart':
      session.resumeId = event.resumeId;
      if (event.transcriptPath) session.transcriptPath = event.transcriptPath;
      session.state = 'running';
      session.startedAt = Date.now();

      this.deps.db.update(sessionId, {
        resumeId: event.resumeId,
        transcriptPath: event.transcriptPath,
        state: 'running',
        startedAt: session.startedAt,
      });
      break;

    case 'TurnCompleted': {
      if (!session.resumeId) session.resumeId = event.resumeId;
      if (session.state === 'starting') session.state = 'running';

      this.deps.db.update(sessionId, {
        resumeId: session.resumeId,
        state: session.state,
      });

      this.deps.eventBus.emit({
        type: 'session.lifecycle',
        workspaceId: session.workspaceId,
        sessionId,
        event: 'turn_completed',
      } as DomainEvent);

      if (!session.transcriptPath) {
        this.resolveTranscriptPathAsync(session);
      }
      break;
    }

    case 'Stop':
      this.deps.eventBus.emit({
        type: 'session.lifecycle',
        workspaceId: session.workspaceId,
        sessionId,
        event: 'turn_completed',
      } as DomainEvent);
      break;

    case 'Progress':
      session.completionPercent = event.percent;
      this.deps.db.update(sessionId, {
        completionPercent: event.percent,
      });
      break;
  }

  if (session.state !== prev) {
    this.emitStateChanged(session, prev, session.state);
  }
}

private async resolveTranscriptPathAsync(session: ActiveSession): Promise<void> {
  const provider = this.deps.providerRegistry.find((p) => p.id === session.providerId);
  if (!provider?.resolveTranscriptPath || !session.resumeId) return;

  try {
    const path = await provider.resolveTranscriptPath(session.toDTO());
    if (path) {
      session.transcriptPath = path;
      this.deps.db.update(session.id, { transcriptPath: path });
    }
  } catch {
    // never throw from transcript resolution
  }
}
```

Also add `transcriptPath?: string;` to the `ActiveSession` class fields (search for the class near line 357 and add to the list), to `toDTO()`, and to the constructor data contract.

```typescript
// In ActiveSession class near line 370:
transcriptPath?: string;

// In toDTO():
return {
  id: this.id,
  workspaceId: this.workspaceId,
  terminalId: this.terminalId,
  providerId: this.providerId,
  state: this.state,
  resumeId: this.resumeId,
  capability: this.capability,
  startedAt: this.startedAt ?? Date.now(),
  lastActiveAt: this.lastActiveAt,
  endedAt: this.endedAt,
  completionPercent: this.completionPercent,
  transcriptPath: this.transcriptPath,   // NEW
};
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @coder-studio/server vitest run src/__tests__/session-integration.test.ts -t "TurnCompleted|SessionStart with transcriptPath"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/session/manager.ts packages/server/src/__tests__/session-integration.test.ts
git commit -m "feat(session): handle TurnCompleted + persist transcriptPath"
```

---

### Task 6: Persistence layer — `transcript_path` read/write

**Files:**
- Modify: `packages/server/src/server.ts:182-219` (`createSessionDatabase`)
- Modify: `packages/server/src/storage/repositories/session-repo.ts` (SessionRow, rowToSession, create, new `updateTranscriptPath`)
- Test: `packages/server/src/__tests__/session-repo.test.ts` (extend)

- [ ] **Step 1: Write failing repo test**

Open `packages/server/src/__tests__/session-repo.test.ts` and append:

```typescript
  it('maps transcript_path column to transcriptPath on session', () => {
    const session = repo.create({
      id: 's-tp',
      workspaceId: 'w',
      terminalId: 't',
      providerId: 'codex',
      state: 'running',
      capability: 'full',
      startedAt: 1,
      lastActiveAt: 1,
    });
    expect(session.transcriptPath).toBeUndefined();

    repo.updateTranscriptPath('s-tp', '/home/u/.codex/sessions/rollout-xyz.jsonl');

    const found = repo.findById('s-tp')!;
    expect(found.transcriptPath).toBe('/home/u/.codex/sessions/rollout-xyz.jsonl');
  });
```

- [ ] **Step 2: Run test to confirm failure**

```bash
pnpm --filter @coder-studio/server vitest run src/__tests__/session-repo.test.ts -t "transcript_path"
```

Expected: FAIL — `updateTranscriptPath` doesn't exist.

- [ ] **Step 3: Update `SessionRepo`**

In `packages/server/src/storage/repositories/session-repo.ts`:

Add to `SessionRow`:
```typescript
  transcript_path: string | null;
```

Add a new method (after `updateLastActive`):
```typescript
  updateTranscriptPath(id: string, transcriptPath: string): void {
    this.db.prepare('UPDATE sessions SET transcript_path = ? WHERE id = ?').run(transcriptPath, id);
  }
```

Update `rowToSession`:
```typescript
  private rowToSession(row: SessionRow): Session {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      terminalId: row.terminal_id,
      providerId: row.provider_id,
      state: row.state,
      resumeId: row.resume_id ?? undefined,
      capability: row.capability,
      startedAt: row.started_at,
      lastActiveAt: row.last_active_at,
      endedAt: row.ended_at ?? undefined,
      completionPercent: row.completion_percent ?? undefined,
      errorReason: row.error_reason ?? undefined,
      transcriptPath: row.transcript_path ?? undefined,
    };
  }
```

- [ ] **Step 4: Update inline `createSessionDatabase` in `packages/server/src/server.ts`**

Replace the `insert` and `update` functions in `createSessionDatabase` so they understand `transcript_path`:

```typescript
function createSessionDatabase(db: any) {
  return {
    insert: (session: any) => {
      db.prepare(`
        INSERT INTO sessions (id, workspace_id, terminal_id, provider_id, state, resume_id, capability, started_at, last_active_at, transcript_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        session.id,
        session.workspace_id,
        session.terminal_id,
        session.provider_id,
        session.state,
        session.resume_id,
        session.capability,
        session.started_at,
        session.last_active_at,
        session.transcript_path ?? null
      );
    },
    update: (id: string, patch: any) => {
      const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
      if (keys.length === 0) return;

      const setClause = keys
        .map((k) => `${k.replace(/([A-Z])/g, '_$1').toLowerCase()} = ?`)
        .join(', ');
      const values = keys.map((k) => patch[k]);

      db.prepare(`UPDATE sessions SET ${setClause} WHERE id = ?`).run(...values, id);
    },
    findById: (id: string) => {
      return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    },
    findByWorkspaceId: (workspaceId: string) => {
      return db.prepare('SELECT * FROM sessions WHERE workspace_id = ?').all(workspaceId);
    },
    findByResumeId: (resumeId: string) => {
      return db
        .prepare('SELECT * FROM sessions WHERE resume_id = ? ORDER BY last_active_at DESC LIMIT 1')
        .get(resumeId);
    },
    delete: (id: string) => {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    },
  };
}
```

The `findByResumeId` method is added for Task 15 (HooksManager reverse-lookup for Claude).

- [ ] **Step 5: Update `SessionDatabase` interface**

Edit `packages/server/src/session/types.ts` to add `findByResumeId`:

```typescript
export interface SessionDatabase {
  insert(session: any): void;
  update(id: string, patch: Partial<Session> & { transcriptPath?: string }): void;
  findById(id: string): any;
  findByWorkspaceId(workspaceId: string): any;
  findByResumeId(resumeId: string): any;
  delete(id: string): void;
}
```

Also update `ActiveSession.toRow()` in `session/manager.ts` to include `transcript_path`:

```typescript
toRow(): SessionRow {
  return {
    id: this.id,
    workspace_id: this.workspaceId,
    terminal_id: this.terminalId,
    provider_id: this.providerId,
    state: this.state,
    resume_id: this.resumeId ?? null,
    capability: this.capability,
    started_at: this.startedAt ?? this.lastActiveAt,
    last_active_at: this.lastActiveAt,
    ended_at: this.endedAt ?? null,
    completion_percent: this.completionPercent ?? null,
    draft: this.draft ?? null,
    transcript_path: this.transcriptPath ?? null,
  };
}
```

And `SessionRow` in the same file:
```typescript
export interface SessionRow {
  // ... existing fields ...
  transcript_path: string | null;
}
```

- [ ] **Step 6: Run all tests**

```bash
pnpm --filter @coder-studio/server test -- --run
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/storage/repositories/session-repo.ts \
        packages/server/src/__tests__/session-repo.test.ts \
        packages/server/src/server.ts \
        packages/server/src/session/types.ts \
        packages/server/src/session/manager.ts
git commit -m "feat(session): persist transcript_path through storage layer"
```

---

### Task 7: Claude `parseEvent` — ensure `transcriptPath` lands in `ProviderEvent.payload`

**Why:** `hooks-template.ts:127-129` already includes `transcriptPath: data.transcript_path` in `payload`. Confirm with a test and fail if it regresses.

**Files:**
- Modify: `packages/providers/src/claude/hooks-template.test.ts`

- [ ] **Step 1: Extend the existing test file**

Append to `packages/providers/src/claude/hooks-template.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { claudeHooksDescriptor } from './hooks-template';

describe('claudeHooksDescriptor.parseEvent', () => {
  it('maps SessionStart payload → ProviderEvent carrying transcriptPath', () => {
    const event = claudeHooksDescriptor.parseEvent('SessionStart', {
      session_id: 'c-1',
      transcript_path: '/tmp/c-1.jsonl',
    });

    expect(event).toEqual({
      type: 'session_start',
      sessionId: 'c-1',
      payload: {
        resumeId: 'c-1',
        transcriptPath: '/tmp/c-1.jsonl',
      },
    });
  });

  it('handles missing transcript_path gracefully', () => {
    const event = claudeHooksDescriptor.parseEvent('SessionStart', {
      session_id: 'c-2',
    });

    expect(event?.payload).toMatchObject({ resumeId: 'c-2' });
  });
});
```

- [ ] **Step 2: Run test**

```bash
pnpm --filter @coder-studio/providers vitest run src/claude/hooks-template.test.ts
```

Expected: PASS (code already returns `transcriptPath` from line 128).

- [ ] **Step 3: Commit**

```bash
git add packages/providers/src/claude/hooks-template.test.ts
git commit -m "test(claude): lock in transcriptPath in SessionStart ProviderEvent"
```

---

### Task 8: `resolveCodexTranscriptPath` utility

**Files:**
- Create: `packages/providers/src/codex/resolve-transcript.ts`
- Create: `packages/providers/src/codex/resolve-transcript.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/providers/src/codex/resolve-transcript.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveCodexTranscriptPath } from './resolve-transcript';

describe('resolveCodexTranscriptPath', () => {
  let home: string;

  beforeEach(() => {
    home = join(tmpdir(), `cs-codex-${Date.now()}-${Math.random()}`);
    mkdirSync(home, { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  function createRollout(year: string, month: string, day: string, name: string, mtime?: number) {
    const dir = join(home, '.codex', 'sessions', year, month, day);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, name);
    writeFileSync(p, '{}');
    if (mtime) utimesSync(p, mtime / 1000, mtime / 1000);
    return p;
  }

  it('returns null when sessions dir does not exist', async () => {
    const result = await resolveCodexTranscriptPath('no-such-uuid', home);
    expect(result).toBeNull();
  });

  it('returns the path for the matching UUID', async () => {
    createRollout('2026', '04', '20', 'rollout-2026-04-20T10-uuid-abc.jsonl');
    const result = await resolveCodexTranscriptPath('uuid-abc', home);
    expect(result).toMatch(/rollout-2026-04-20T10-uuid-abc\.jsonl$/);
  });

  it('ignores files that do not start with rollout-', async () => {
    createRollout('2026', '04', '20', 'junk-uuid-abc.jsonl');
    const result = await resolveCodexTranscriptPath('uuid-abc', home);
    expect(result).toBeNull();
  });

  it('returns newest mtime when multiple files match same UUID', async () => {
    const older = createRollout('2026', '04', '19', 'rollout-2026-04-19T10-uuid-x.jsonl', 1_000_000_000_000);
    const newer = createRollout('2026', '04', '20', 'rollout-2026-04-20T10-uuid-x.jsonl', 2_000_000_000_000);
    const result = await resolveCodexTranscriptPath('uuid-x', home);
    expect(result).toBe(newer);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @coder-studio/providers vitest run src/codex/resolve-transcript.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `packages/providers/src/codex/resolve-transcript.ts`:

```typescript
import { readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * Scan ~/.codex/sessions/<yyyy>/<mm>/<dd>/ for rollout-*-<resumeId>.jsonl.
 * Returns the most recently modified match, or null if none.
 * Never throws — returns null on any error.
 */
export async function resolveCodexTranscriptPath(
  resumeId: string,
  homeDir = homedir()
): Promise<string | null> {
  const base = join(homeDir, '.codex', 'sessions');
  if (!existsSync(base)) return null;

  type Match = { path: string; mtime: number };
  const matches: Match[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (
        entry.isFile() &&
        entry.name.startsWith('rollout-') &&
        entry.name.includes(resumeId) &&
        entry.name.endsWith('.jsonl')
      ) {
        try {
          const st = await stat(entryPath);
          matches.push({ path: entryPath, mtime: st.mtimeMs });
        } catch {
          // ignore
        }
      }
    }
  }

  try {
    await walk(base);
  } catch {
    return null;
  }

  if (matches.length === 0) return null;
  matches.sort((a, b) => b.mtime - a.mtime);
  return matches[0].path;
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @coder-studio/providers vitest run src/codex/resolve-transcript.test.ts
```

Expected: PASS (all four tests).

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/codex/resolve-transcript.ts packages/providers/src/codex/resolve-transcript.test.ts
git commit -m "feat(providers): add Codex rollout transcript resolver"
```

---

### Task 9: Claude `resolveTranscriptPath`

**Why:** Claude's SessionStart hook already supplies `transcript_path`; the provider's `resolveTranscriptPath` simply returns what's stored on the session. This preserves the contract that every `capability: 'full'` provider implements it.

**Files:**
- Modify: `packages/providers/src/claude/definition.ts`
- Test: `packages/providers/src/claude/definition.test.ts` (new or extend)

- [ ] **Step 1: Write failing test**

`packages/providers/src/claude/definition.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { claudeDefinition } from './definition';

describe('claudeDefinition.resolveTranscriptPath', () => {
  it('returns session.transcriptPath verbatim if set', async () => {
    const path = await claudeDefinition.resolveTranscriptPath!({
      id: 's1',
      workspaceId: 'w',
      terminalId: 't',
      providerId: 'claude',
      state: 'running',
      capability: 'full',
      startedAt: 0,
      lastActiveAt: 0,
      transcriptPath: '/a/b.jsonl',
    });
    expect(path).toBe('/a/b.jsonl');
  });

  it('returns null when session has no transcriptPath', async () => {
    const path = await claudeDefinition.resolveTranscriptPath!({
      id: 's2',
      workspaceId: 'w',
      terminalId: 't',
      providerId: 'claude',
      state: 'running',
      capability: 'full',
      startedAt: 0,
      lastActiveAt: 0,
    });
    expect(path).toBeNull();
  });
});
```

- [ ] **Step 2: Run**

```bash
pnpm --filter @coder-studio/providers vitest run src/claude/definition.test.ts
```

Expected: FAIL — `resolveTranscriptPath` is undefined.

- [ ] **Step 3: Implement**

In `packages/providers/src/claude/definition.ts`, add right before the closing brace of `claudeDefinition`:

```typescript
  async resolveTranscriptPath(session) {
    return session.transcriptPath ?? null;
  },
```

- [ ] **Step 4: Run test**

```bash
pnpm --filter @coder-studio/providers vitest run src/claude/definition.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/claude/definition.ts packages/providers/src/claude/definition.test.ts
git commit -m "feat(claude): implement resolveTranscriptPath"
```

---

### Task 10: Codex `hooks` descriptor — real `parseEvent`

**Why:** Replace `noopHooksDescriptor` with a real one. Global config is still a no-op (Codex uses argv injection). `parseEvent('agent-turn-complete', …)` returns a `turn_completed` `ProviderEvent`.

**Files:**
- Modify: `packages/providers/src/codex/definition.ts`
- Test: `packages/providers/src/codex/definition.test.ts` (new or extend)

- [ ] **Step 1: Write failing test**

`packages/providers/src/codex/definition.test.ts` (create if missing):

```typescript
import { describe, it, expect } from 'vitest';
import { codexDefinition } from './definition';

describe('codexDefinition.hooks.parseEvent', () => {
  it('parses agent-turn-complete into ProviderEvent { type:"turn_completed" }', () => {
    const event = codexDefinition.hooks.parseEvent('agent-turn-complete', {
      type: 'agent-turn-complete',
      'thread-id': 'uuid-1',
      'turn-id': 'turn-1',
      'input-messages': ['hi'],
      'last-assistant-message': 'hello',
    });

    expect(event).toEqual({
      type: 'turn_completed',
      sessionId: '',
      payload: {
        resumeId: 'uuid-1',
        turnId: 'turn-1',
      },
    });
  });

  it('returns null for unknown events', () => {
    expect(codexDefinition.hooks.parseEvent('whatever', {})).toBeNull();
  });

  it('returns null when payload is malformed', () => {
    expect(codexDefinition.hooks.parseEvent('agent-turn-complete', null)).toBeNull();
    expect(codexDefinition.hooks.parseEvent('agent-turn-complete', {})).toBeNull();
  });
});
```

- [ ] **Step 2: Run**

```bash
pnpm --filter @coder-studio/providers vitest run src/codex/definition.test.ts
```

Expected: FAIL — `parseEvent` returns null for everything.

- [ ] **Step 3: Create new hooks descriptor**

In `packages/providers/src/codex/definition.ts`, replace the `noopHooksDescriptor` block with a real descriptor. Keep `resolveGlobalConfigPath`/`mergeInto`/`extractManaged` as no-ops since Codex injection happens via argv in Task 11:

```typescript
const codexHooksDescriptor: HooksDescriptor = {
  markerVersion: 'cs-codex-v1',

  // Codex integration is via argv (-c notify=[...]), not a config file.
  resolveGlobalConfigPath(): string {
    return ''; // empty path signals "no global config to write"
  },

  mergeInto(existing: unknown): unknown {
    return existing; // no-op
  },

  extractManaged(): null {
    return null;
  },

  bridgeCommand(): string[] {
    return []; // unused; Codex invokes the bridge directly via notify
  },

  parseEvent(event: string, payload: unknown) {
    if (!payload || typeof payload !== 'object') return null;
    const data = payload as Record<string, unknown>;

    switch (event) {
      case 'agent-turn-complete': {
        const threadId = data['thread-id'];
        const turnId = data['turn-id'];
        if (typeof threadId !== 'string' || typeof turnId !== 'string') return null;
        return {
          type: 'turn_completed' as const,
          sessionId: '',
          payload: { resumeId: threadId, turnId },
        };
      }
      default:
        return null;
    }
  },

  events: {
    sessionStart: false,  // Codex does not emit SessionStart before first turn
    completion: true,
    progress: false,
  },

  // Fallback kept until Spec 2 cleanup
  stdoutHeuristics: {
    sessionIdPatterns,
    idlePromptPatterns,
    idleDebounceMs,
  },
};
```

Below `codexHooksDescriptor`, replace `hooks: noopHooksDescriptor` with `hooks: codexHooksDescriptor`.

Note: leave `codexDefinition.hooks.events.sessionStart = false` so `HooksManager.buildManagedHooks` won't write a Codex SessionStart hook into a config file — this is important because Codex has no equivalent global config slot for it.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @coder-studio/providers vitest run src/codex/definition.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/codex/definition.ts packages/providers/src/codex/definition.test.ts
git commit -m "feat(codex): real hooks descriptor with turn_completed parsing"
```

---

### Task 11: Codex argv injection + resume support + capability upgrade

**Files:**
- Modify: `packages/providers/src/codex/definition.ts`
- Test: `packages/providers/src/codex/definition.test.ts` (extend)

- [ ] **Step 1: Write failing tests** — append to `definition.test.ts`:

```typescript
describe('codexDefinition.buildCommand', () => {
  const ctx = {
    sessionId: 'cs-1',
    workspacePath: '/tmp/ws',
    bridgeScriptPath: '/home/u/.coder-studio/hooks/codex-bridge.js',
  };

  it('injects -c notify=[...] pointing at the bridge', () => {
    const result = codexDefinition.buildCommand(
      codexDefinition.defaultConfig,
      ctx
    );
    const idx = result.argv.indexOf('-c');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(result.argv[idx + 1]).toBe(
      `notify=["node","/home/u/.coder-studio/hooks/codex-bridge.js"]`
    );
  });

  it('omits -c notify when bridgeScriptPath is missing (dev/test fallback)', () => {
    const result = codexDefinition.buildCommand(codexDefinition.defaultConfig, {
      sessionId: 'cs-1',
      workspacePath: '/tmp/ws',
    });
    expect(result.argv.includes('-c')).toBe(false);
  });

  it('escapes paths with spaces safely (JSON.stringify)', () => {
    const result = codexDefinition.buildCommand(codexDefinition.defaultConfig, {
      ...ctx,
      bridgeScriptPath: '/home/with space/bridge.js',
    });
    const idx = result.argv.indexOf('-c');
    expect(result.argv[idx + 1]).toBe(
      `notify=["node","/home/with space/bridge.js"]`
    );
  });
});

describe('codexDefinition.buildResumeCommand', () => {
  it('prepends "resume <id>" and retains notify injection', () => {
    const ctx = {
      sessionId: 'cs-1',
      workspacePath: '/tmp/ws',
      bridgeScriptPath: '/bridge.js',
    };
    const result = codexDefinition.buildResumeCommand!(
      'thread-uuid-1',
      codexDefinition.defaultConfig,
      ctx
    );
    expect(result).not.toBeNull();
    expect(result!.argv.slice(0, 3)).toEqual(['codex', 'resume', 'thread-uuid-1']);
    const idx = result!.argv.indexOf('-c');
    expect(idx).toBeGreaterThan(2);
  });
});

describe('codexDefinition capability', () => {
  it('reports "full"', () => {
    expect(codexDefinition.capability).toBe('full');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @coder-studio/providers vitest run src/codex/definition.test.ts -t "buildCommand|buildResumeCommand|capability"
```

Expected: FAIL.

- [ ] **Step 3: Update Codex definition**

In `packages/providers/src/codex/definition.ts`:

1. Add helper at top:
```typescript
function notifyArg(bridgeScriptPath?: string): string[] {
  if (!bridgeScriptPath) return [];
  const notifyValue = JSON.stringify(['node', bridgeScriptPath]);
  return ['-c', `notify=${notifyValue}`];
}
```

2. Replace `buildCommand` body:
```typescript
  buildCommand(config: ProviderConfig, ctx: LaunchContext) {
    const cfg = config as CodexConfig;
    return {
      argv: ['codex', ...notifyArg(ctx.bridgeScriptPath), ...cfg.additionalArgs],
      env: {
        ...cfg.envVars,
        CODER_STUDIO_SESSION_ID: ctx.sessionId,
      },
      cwd: cfg.cwd ?? ctx.workspacePath,
    };
  },
```

3. Replace `buildResumeCommand: undefined` with:
```typescript
  buildResumeCommand(resumeId: string, config: ProviderConfig, ctx: LaunchContext) {
    const cfg = config as CodexConfig;
    return {
      argv: ['codex', 'resume', resumeId, ...notifyArg(ctx.bridgeScriptPath), ...cfg.additionalArgs],
      env: {
        ...cfg.envVars,
        CODER_STUDIO_SESSION_ID: ctx.sessionId,
      },
      cwd: cfg.cwd ?? ctx.workspacePath,
    };
  },
```

4. Add `resolveTranscriptPath`:
```typescript
  async resolveTranscriptPath(session) {
    if (!session.resumeId) return null;
    return resolveCodexTranscriptPath(session.resumeId);
  },
```

Add import:
```typescript
import { resolveCodexTranscriptPath } from './resolve-transcript.js';
```

5. Flip `capability: 'limited'` to `capability: 'full'`.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @coder-studio/providers vitest run src/codex/
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/codex/definition.ts packages/providers/src/codex/definition.test.ts
git commit -m "feat(codex): inject -c notify into argv + enable resume + full capability"
```

---

### Task 12: Bridge generator — argv variant for Codex

**Why:** `generateBridgeScript` currently produces a stdin-reading script. Codex passes payload as `argv.at(-1)`. Split into per-provider templates.

**Files:**
- Modify: `packages/server/src/hooks/bridge.ts`
- Test: `packages/server/src/hooks/bridge.test.ts` (extend)

- [ ] **Step 1: Write failing tests** — append to `bridge.test.ts`:

```typescript
  describe('generateBridgeScript — Codex variant', () => {
    it('reads payload from last argv token, not stdin', () => {
      const script = generateBridgeScript('codex');
      expect(script).toContain('process.argv');
      expect(script).not.toContain('fs.readFileSync(0');  // no stdin read
    });

    it('derives event name from payload.type', () => {
      const script = generateBridgeScript('codex');
      expect(script).toMatch(/payload\s*\.\s*type/);
    });

    it('sends coder_studio_session_id from env in the query string', () => {
      const script = generateBridgeScript('codex');
      expect(script).toContain('CODER_STUDIO_SESSION_ID');
      expect(script).toContain('coder_studio_session_id=');
    });

    it('uses /internal/hooks/<event> path with token query', () => {
      const script = generateBridgeScript('codex');
      expect(script).toContain('/internal/hooks/');
      expect(script).toContain('token=');
    });
  });

  describe('generateBridgeScript — Claude variant retained', () => {
    it('still reads payload from stdin', () => {
      const script = generateBridgeScript('claude');
      expect(script).toContain('process.argv[2]');
      expect(script).toContain('fs.readFileSync(0');
    });
  });
```

- [ ] **Step 2: Run**

```bash
pnpm --filter @coder-studio/server vitest run src/hooks/bridge.test.ts
```

Expected: FAIL — Codex tests don't match current generator.

- [ ] **Step 3: Refactor `generateBridgeScript`**

Replace the function in `packages/server/src/hooks/bridge.ts`:

```typescript
export function generateBridgeScript(providerId: string): string {
  if (providerId === 'codex') return generateCodexBridgeScript();
  return generateStdinBridgeScript(providerId);
}

function generateStdinBridgeScript(providerId: string): string {
  return `// Coder Studio hook bridge for ${providerId}
// Auto-generated - do not edit
const fs = require("fs");
const http = require("http");
const path = require("path");
const os = require("os");

const event = process.argv[2];
const runtimePath = path.join(os.homedir(), ".coder-studio", "runtime.json");

let runtime;
try {
  runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
} catch {
  process.exit(0);
}

let payload = "";
try { payload = fs.readFileSync(0, "utf8"); } catch {}

let body;
try { body = JSON.parse(payload || "{}"); } catch { body = { raw: payload }; }

const req = http.request({
  hostname: "127.0.0.1",
  port: runtime.port,
  path: \`/internal/hooks/\${encodeURIComponent(event)}?token=\${encodeURIComponent(runtime.token)}\`,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  timeout: 500,
});

req.on("error", () => process.exit(0));
req.on("timeout", () => { req.destroy(); process.exit(0); });
req.write(JSON.stringify(body));
req.end();
req.on("response", () => process.exit(0));
`;
}

function generateCodexBridgeScript(): string {
  return `// Coder Studio hook bridge for codex
// Auto-generated - do not edit
// Codex passes the JSON payload as the last argv token (not stdin).
const fs = require("fs");
const http = require("http");
const path = require("path");
const os = require("os");

const raw = process.argv[process.argv.length - 1];
let payload;
try { payload = JSON.parse(raw); } catch { process.exit(0); }
if (!payload || typeof payload !== "object" || typeof payload.type !== "string") {
  process.exit(0);
}
const event = payload.type;

const sessionId = process.env.CODER_STUDIO_SESSION_ID;
if (!sessionId) process.exit(0);

const runtimePath = path.join(os.homedir(), ".coder-studio", "runtime.json");
let runtime;
try { runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8")); } catch { process.exit(0); }

const query =
  "token=" + encodeURIComponent(runtime.token) +
  "&coder_studio_session_id=" + encodeURIComponent(sessionId);

const req = http.request({
  hostname: "127.0.0.1",
  port: runtime.port,
  path: \`/internal/hooks/\${encodeURIComponent(event)}?\${query}\`,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  timeout: 500,
});
req.on("error", () => process.exit(0));
req.on("timeout", () => { req.destroy(); process.exit(0); });
req.write(JSON.stringify(payload));
req.end();
req.on("response", () => process.exit(0));
`;
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @coder-studio/server vitest run src/hooks/bridge.test.ts
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/hooks/bridge.ts packages/server/src/hooks/bridge.test.ts
git commit -m "feat(hooks): generate argv-based bridge for codex provider"
```

---

### Task 13: Sync `packages/hook-bridge/src/codex-bridge.js` reference script

**Why:** The reference source file in `hook-bridge/src/` is not what runs at runtime (the generator produces the real one), but we keep it in sync so the package is self-documenting.

**Files:**
- Modify: `packages/hook-bridge/src/codex-bridge.js`

- [ ] **Step 1: Replace its contents**

Open `packages/hook-bridge/src/codex-bridge.js` and replace the body with the same logic as `generateCodexBridgeScript` (minus the auto-generated comment):

```javascript
/**
 * Codex Hook Bridge
 *
 * Reads the JSON payload from the last argv token (Codex's notify contract),
 * extracts the event name from payload.type, and POSTs to the server's
 * internal hook endpoint. Uses CODER_STUDIO_SESSION_ID env to route.
 *
 * CRITICAL: Zero external dependencies - pure Node.js.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');

const raw = process.argv[process.argv.length - 1];
let payload;
try { payload = JSON.parse(raw); } catch { process.exit(0); }
if (!payload || typeof payload !== 'object' || typeof payload.type !== 'string') {
  process.exit(0);
}
const event = payload.type;

const sessionId = process.env.CODER_STUDIO_SESSION_ID;
if (!sessionId) process.exit(0);

const runtimePath = path.join(os.homedir(), '.coder-studio', 'runtime.json');
let runtime;
try { runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8')); } catch { process.exit(0); }

const query =
  'token=' + encodeURIComponent(runtime.token) +
  '&coder_studio_session_id=' + encodeURIComponent(sessionId);

const req = http.request({
  hostname: '127.0.0.1',
  port: runtime.port,
  path: `/internal/hooks/${encodeURIComponent(event)}?${query}`,
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  timeout: 500,
});
req.on('error', () => process.exit(0));
req.on('timeout', () => { req.destroy(); process.exit(0); });
req.write(JSON.stringify(payload));
req.end();
req.on('response', () => process.exit(0));
```

- [ ] **Step 2: Sanity-check**

```bash
node -c packages/hook-bridge/src/codex-bridge.js
```

Expected: no output (syntax OK).

- [ ] **Step 3: Commit**

```bash
git add packages/hook-bridge/src/codex-bridge.js
git commit -m "chore(hook-bridge): sync codex-bridge.js with generator output"
```

---

### Task 14: Endpoint passes `coder_studio_session_id` query to callback

**Files:**
- Modify: `packages/server/src/hooks/endpoint.ts`
- Modify: `packages/server/src/app.ts:77-92` (inline endpoint)
- Test: `packages/server/src/hooks/endpoint.test.ts` (extend)

- [ ] **Step 1: Write failing test** — append to `endpoint.test.ts`:

```typescript
    it('forwards coder_studio_session_id query to handler', async () => {
      const ctxApp = Fastify();
      let captured: { event: string; payload: unknown; coderStudioSessionId?: string } | null = null;

      registerHooksEndpoint(ctxApp, runtime, (event, payload, ctx) => {
        captured = { event, payload, coderStudioSessionId: ctx?.coderStudioSessionId };
      });
      await ctxApp.ready();

      await ctxApp.inject({
        method: 'POST',
        url: '/internal/hooks/agent-turn-complete?token=test-token-123&coder_studio_session_id=sess-9',
        payload: { type: 'agent-turn-complete' },
      });

      expect(captured).toMatchObject({
        event: 'agent-turn-complete',
        coderStudioSessionId: 'sess-9',
      });
    });

    it('forwards undefined coder_studio_session_id when query missing', async () => {
      let captured: any;
      const app2 = Fastify();
      registerHooksEndpoint(app2, runtime, (event, payload, ctx) => {
        captured = ctx;
      });
      await app2.ready();

      await app2.inject({
        method: 'POST',
        url: '/internal/hooks/SessionStart?token=test-token-123',
        payload: { session_id: 'c' },
      });
      expect(captured).toEqual({ coderStudioSessionId: undefined });
    });
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @coder-studio/server vitest run src/hooks/endpoint.test.ts
```

Expected: FAIL — callback signature lacks `ctx`.

- [ ] **Step 3: Update `endpoint.ts`**

In `packages/server/src/hooks/endpoint.ts`:

```typescript
export interface HookEventContext {
  coderStudioSessionId?: string;
}

export function registerHooksEndpoint(
  app: FastifyInstance,
  runtime: RuntimeConfig,
  onHookEvent: (event: string, payload: unknown, ctx: HookEventContext) => void
): void {
  app.post<{
    Params: { event: string };
    Querystring: { token: string; coder_studio_session_id?: string };
    Body: unknown;
  }>('/internal/hooks/:event', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isLocalhost(request.ip)) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const query = request.query as { token?: string; coder_studio_session_id?: string };
    if (!query.token || query.token !== runtime.token) {
      return reply.code(403).send({ error: 'invalid_token' });
    }

    const params = request.params as { event: string };
    const event = params.event;
    const payload = request.body;

    try {
      onHookEvent(event, payload, {
        coderStudioSessionId: query.coder_studio_session_id,
      });
      return reply.send({ ok: true });
    } catch (error) {
      console.error('Hook event handler error:', error);
      return reply.code(500).send({ error: 'internal_error' });
    }
  });
}
```

Update existing test (`'should handle handler errors gracefully'`, etc.) only if TypeScript complains about the new ctx parameter — the three-argument handler is compatible with two-argument callbacks since JS ignores extra args. Verify compile.

- [ ] **Step 4: Update `app.ts` inline endpoint**

Replace lines 77-92 of `packages/server/src/app.ts`:

```typescript
  // Internal hooks endpoint (for bridge scripts)
  app.post<{
    Params: { event: string };
    Querystring: { coder_studio_session_id?: string };
  }>('/internal/hooks/:event', async (request, reply) => {
    const event = request.params.event;
    const payload = request.body;
    const coderStudioSessionId = (request.query as any)?.coder_studio_session_id as string | undefined;

    try {
      deps.hooksMgr.handleHookEvent(event, payload, { coderStudioSessionId });
      return { ok: true };
    } catch (error) {
      request.log.error({ error, event }, 'Failed to handle hook event');
      return reply.status(500).send({
        ok: false,
        error: 'Failed to handle hook event',
      });
    }
  });
```

- [ ] **Step 5: Run**

```bash
pnpm --filter @coder-studio/server vitest run src/hooks/endpoint.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/hooks/endpoint.ts packages/server/src/hooks/endpoint.test.ts packages/server/src/app.ts
git commit -m "feat(hooks): propagate coder_studio_session_id query to handler"
```

---

### Task 15: `HooksManager.handleHookEvent` — real routing

**Why:** Replace the `console.log` stub with real session resolution + `ProviderEvent → ProviderHookEvent` conversion + routing.

**Files:**
- Modify: `packages/server/src/hooks/manager.ts`
- Test: `packages/server/src/hooks/manager.test.ts` (replace the trivial `handleHookEvent` test)

- [ ] **Step 1: Write failing tests** — replace the old `handleHookEvent` test block with:

```typescript
  describe('handleHookEvent', () => {
    it('routes Codex agent-turn-complete to SessionManager via query sessionId', () => {
      const sessionMgr = { onHookEvent: vi.fn() };
      const providerRegistry = [
        {
          id: 'codex',
          hooks: {
            parseEvent: (event: string, payload: any) =>
              event === 'agent-turn-complete'
                ? { type: 'turn_completed', sessionId: '', payload: { resumeId: payload['thread-id'], turnId: payload['turn-id'] } }
                : null,
          },
        } as any,
      ];
      manager = new HooksManager(hookRegistrationRepo, runtime, {
        sessionMgr: sessionMgr as any,
        providerRegistry,
        sessionDb: { findByResumeId: vi.fn() },
      });

      manager.handleHookEvent('agent-turn-complete', {
        type: 'agent-turn-complete',
        'thread-id': 'uuid-1',
        'turn-id': 'turn-1',
      }, { coderStudioSessionId: 'cs-1' });

      expect(sessionMgr.onHookEvent).toHaveBeenCalledWith('cs-1', {
        kind: 'TurnCompleted',
        resumeId: 'uuid-1',
        turnId: 'turn-1',
      });
    });

    it('routes Claude SessionStart via payload.session_id reverse lookup', () => {
      const sessionMgr = { onHookEvent: vi.fn() };
      const sessionDb = {
        findByResumeId: vi.fn().mockReturnValue({ id: 'cs-claude-1' }),
      };
      const providerRegistry = [
        {
          id: 'claude',
          hooks: {
            parseEvent: (event: string, payload: any) =>
              event === 'SessionStart'
                ? { type: 'session_start', sessionId: payload.session_id, payload: { resumeId: payload.session_id, transcriptPath: payload.transcript_path } }
                : null,
          },
        } as any,
      ];
      manager = new HooksManager(hookRegistrationRepo, runtime, {
        sessionMgr: sessionMgr as any,
        providerRegistry,
        sessionDb: sessionDb as any,
      });

      manager.handleHookEvent('SessionStart', {
        session_id: 'claude-abc',
        transcript_path: '/x.jsonl',
      }, {});

      expect(sessionDb.findByResumeId).toHaveBeenCalledWith('claude-abc');
      expect(sessionMgr.onHookEvent).toHaveBeenCalledWith('cs-claude-1', {
        kind: 'SessionStart',
        resumeId: 'claude-abc',
        transcriptPath: '/x.jsonl',
      });
    });

    it('no-ops when no provider parses the event', () => {
      const sessionMgr = { onHookEvent: vi.fn() };
      manager = new HooksManager(hookRegistrationRepo, runtime, {
        sessionMgr: sessionMgr as any,
        providerRegistry: [],
        sessionDb: { findByResumeId: vi.fn() },
      });

      manager.handleHookEvent('unknown', {}, {});
      expect(sessionMgr.onHookEvent).not.toHaveBeenCalled();
    });
  });
```

(Keep the `vi` import at the top of the file.)

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @coder-studio/server vitest run src/hooks/manager.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement real routing**

In `packages/server/src/hooks/manager.ts`:

1. Extend the constructor with optional routing deps:

```typescript
import type { ProviderDefinition, ProviderEvent } from '@coder-studio/core';

export interface HookRouteDeps {
  sessionMgr: { onHookEvent(sessionId: string, event: ProviderHookEvent): void };
  providerRegistry: ProviderDefinition[];
  sessionDb: { findByResumeId(resumeId: string): { id: string } | null | undefined };
}

// Reuse `HookEventContext` from endpoint.ts (Task 14) to keep the shape
// unified across the call chain. Do NOT re-declare it here.
import type { HookEventContext } from './endpoint.js';

export class HooksManager {
  private readonly backupDir = join(homedir(), '.coder-studio', 'backups');

  constructor(
    private readonly hookRegistrationRepo: HookRegistrationRepo,
    private readonly runtime: RuntimeConfig,
    private readonly routeDeps?: HookRouteDeps
  ) {}
```

2. Replace `handleHookEvent`:

```typescript
  handleHookEvent(event: string, payload: unknown, ctx: HookEventContext = {}): void {
    if (!this.routeDeps) {
      // Router not wired yet (early-boot path). Log and drop.
      console.warn('Hook event received before router wiring:', event);
      return;
    }

    // 1. Find a provider that parses this event.
    let match: { provider: ProviderDefinition; providerEvent: ProviderEvent } | null = null;
    for (const provider of this.routeDeps.providerRegistry) {
      const parsed = provider.hooks.parseEvent(event, payload);
      if (parsed) {
        match = { provider, providerEvent: parsed };
        break;
      }
    }
    if (!match) return;

    // 2. Resolve coder-studio sessionId.
    const sessionId =
      ctx.coderStudioSessionId ??
      this.resolveSessionIdFromProviderEvent(match.providerEvent);
    if (!sessionId) return;

    // 3. Convert to internal ProviderHookEvent.
    const hookEvent = toHookEvent(match.providerEvent);
    if (!hookEvent) return;

    // 4. Route.
    this.routeDeps.sessionMgr.onHookEvent(sessionId, hookEvent);
  }

  private resolveSessionIdFromProviderEvent(ev: ProviderEvent): string | null {
    // Claude-style: sessionId carries the provider's own resume id; reverse lookup.
    const candidate = ev.sessionId || (ev.payload?.resumeId as string | undefined);
    if (!candidate) return null;
    const row = this.routeDeps!.sessionDb.findByResumeId(candidate);
    return row?.id ?? null;
  }
}

function toHookEvent(ev: ProviderEvent): ProviderHookEvent | null {
  switch (ev.type) {
    case 'session_start':
      return {
        kind: 'SessionStart',
        resumeId: (ev.payload.resumeId as string) ?? ev.sessionId,
        transcriptPath: ev.payload.transcriptPath as string | undefined,
      };
    case 'turn_completed':
      return {
        kind: 'TurnCompleted',
        resumeId: (ev.payload.resumeId as string) ?? '',
        turnId: (ev.payload.turnId as string) ?? '',
      };
    case 'stop':
      return { kind: 'Stop' };
    case 'progress':
      return { kind: 'Progress', percent: (ev.payload.percent as number) ?? 0 };
    default:
      return null;
  }
}
```

Add the `ProviderHookEvent` import at the top:
```typescript
import type { ProviderHookEvent } from '../session/manager.js';
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @coder-studio/server vitest run src/hooks/manager.test.ts
```

Expected: PASS (including the new tests plus the preserved `ensureGlobalConfig` tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/hooks/manager.ts packages/server/src/hooks/manager.test.ts
git commit -m "feat(hooks): route parsed ProviderEvents to SessionManager"
```

---

### Task 16: Wire everything together in `server.ts`

**Why:** Pass real `routeDeps` to `HooksManager`. Make `SessionManager.create` fill `LaunchContext.bridgeScriptPath` per provider.

**Files:**
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/session/manager.ts` (two `buildCommand` call sites)

- [ ] **Step 1: Update `SessionManager.create` and `.resume` to pass `bridgeScriptPath`**

In `packages/server/src/session/manager.ts`, the manager currently calls `provider.buildCommand(config, ctx)` where `ctx` has only `sessionId` + `workspacePath`. Add the bridge script path.

The cleanest seam: extend `SessionManagerDeps` with a resolver injected from server.ts.

```typescript
export interface SessionManagerDeps {
  terminalMgr: TerminalManager;
  eventBus: EventBus;
  db: SessionDatabase;
  broadcaster: Broadcaster;
  providerRegistry: ProviderDefinition[];
  resolveBridgeScriptPath?: (providerId: string) => string | undefined;
}
```

Update both call sites to pass it:

```typescript
// In .create(...)
const cmd = req.provider.buildCommand(req.provider.defaultConfig, {
  workspacePath: req.workspacePath,
  sessionId,
  bridgeScriptPath: this.deps.resolveBridgeScriptPath?.(req.providerId),
});

// In .resume(...)
const cmd = provider.buildResumeCommand!(
  existing.resumeId,
  provider.defaultConfig,
  {
    workspacePath,
    sessionId,
    bridgeScriptPath: this.deps.resolveBridgeScriptPath?.(existing.providerId),
  }
);
```

- [ ] **Step 2: Wire it in `server.ts`**

In `packages/server/src/server.ts`:

1. Add import near the top:
```typescript
import { getBridgeScriptPath } from './hooks/bridge.js';
```

2. In `createServer`, pass the resolver when constructing SessionManager:
```typescript
const sessionMgr = new SessionManager({
  terminalMgr,
  eventBus,
  db: createSessionDatabase(db),
  broadcaster: wsHub,
  providerRegistry,
  resolveBridgeScriptPath: (providerId) => getBridgeScriptPath(providerId),
});
```

3. Replace the `HooksManager` construction to inject real route deps.

   Current code (`server.ts:79-82`):
   ```typescript
   const hooksMgr = new HooksManager(
     createHookRegistrationRepo(db),
     {} as any // Runtime config - will be implemented
   );
   ```

   Replace with (keep the existing `{} as any` runtime stub — runtime.json wiring is out of this spec's scope):
   ```typescript
   const sessionDb = createSessionDatabase(db);

   const sessionMgr = new SessionManager({
     terminalMgr,
     eventBus,
     db: sessionDb,
     broadcaster: wsHub,
     providerRegistry,
     resolveBridgeScriptPath: (providerId) => getBridgeScriptPath(providerId),
   });

   const hooksMgr = new HooksManager(
     createHookRegistrationRepo(db),
     {} as any, // Runtime config - pre-existing stub
     {
       sessionMgr,
       providerRegistry,
       sessionDb,
     }
   );
   ```

> **Ordering:** `hooksMgr` is constructed AFTER `sessionMgr` in the current code (lines 64-70 → 79-82), so no reordering is needed. If a future refactor flips the order, restore it here — `hooksMgr` must reference the same `sessionMgr` instance used elsewhere.

- [ ] **Step 3: Type-check everything**

```bash
pnpm --filter @coder-studio/server exec tsc --noEmit
pnpm --filter @coder-studio/server test -- --run
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/session/manager.ts packages/server/src/server.ts
git commit -m "feat(server): wire HooksManager routing + bridge path injection"
```

---

### Task 17: End-to-end integration test with fake Codex

**Why:** Validate the full loop: SessionManager.create → fake-codex emits notify → bridge POSTs → HooksManager routes → DB has resume_id + transcript_path.

**Prerequisite — expose `sessionMgr` from `createServer`:**
`createServer` currently only returns `{ app, stop }`. Extend the return value so tests can reach `sessionMgr` without reaching into Fastify internals.

In `packages/server/src/server.ts`, find the `return { app, stop }` at the end of `createServer` and change it to:

```typescript
return {
  app,
  stop,
  // Exposed for integration tests. Not part of the public API.
  __test__: { sessionMgr, hooksMgr, commandContext },
};
```

**Files:**
- Create: `packages/server/src/__tests__/codex-hook-integration.test.ts`
- Create: `packages/server/src/__tests__/fixtures/fake-codex.js` — a mock Codex executable
- Modify: `packages/server/src/server.ts` (one-line return change)

- [ ] **Step 1: Create the fake Codex script**

Create `packages/server/src/__tests__/fixtures/fake-codex.js`:

```javascript
#!/usr/bin/env node
/**
 * Fake Codex for integration tests.
 *
 * - Parses `-c notify=[...]` and stores the command array.
 * - Writes a rollout fixture under the provided HOME/.codex/sessions/...
 * - Spawns the notify command with an agent-turn-complete payload as
 *   the last argv token (matching Codex's notify contract).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
let notifyCmd = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '-c' && argv[i + 1]?.startsWith('notify=')) {
    notifyCmd = JSON.parse(argv[i + 1].slice('notify='.length));
    break;
  }
}

const home = process.env.HOME;
const threadId = process.env.FAKE_CODEX_THREAD_ID || 'fake-uuid-1';
const turnId = 'turn-1';

// Write rollout fixture
const rolloutDir = path.join(home, '.codex', 'sessions', '2026', '04', '20');
fs.mkdirSync(rolloutDir, { recursive: true });
const rolloutPath = path.join(rolloutDir, `rollout-2026-04-20T10-${threadId}.jsonl`);
fs.writeFileSync(rolloutPath, JSON.stringify({ turn: 1 }) + '\n');

if (!notifyCmd) process.exit(0);

const payload = {
  type: 'agent-turn-complete',
  'thread-id': threadId,
  'turn-id': turnId,
  'input-messages': ['hi'],
  'last-assistant-message': 'hello',
};

const finalArgv = [...notifyCmd.slice(1), JSON.stringify(payload)];
spawnSync(notifyCmd[0], finalArgv, { stdio: 'inherit' });
```

Make it executable:

```bash
chmod +x packages/server/src/__tests__/fixtures/fake-codex.js
```

- [ ] **Step 2: Write the integration test**

Create `packages/server/src/__tests__/codex-hook-integration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { createServer } from '../server.js';

describe('Codex notify hook end-to-end', () => {
  let tempHome: string;
  let server: Awaited<ReturnType<typeof createServer>>;

  beforeEach(async () => {
    tempHome = join(tmpdir(), `cs-e2e-${Date.now()}`);
    mkdirSync(tempHome, { recursive: true });
    process.env.HOME = tempHome;
    process.env.FAKE_CODEX_THREAD_ID = 'fake-uuid-42';
    process.env.PATH = join(__dirname, 'fixtures') + ':' + process.env.PATH;

    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      dataDir: join(tempHome, 'data'),
      webRoot: undefined,
    });
  });

  afterEach(async () => {
    await server.stop();
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('completes a turn → DB has resume_id and transcript_path', async () => {
    // Arrange: mock fake-codex executable as 'codex' on PATH
    // Provided by fixtures/fake-codex.js (aliased as 'codex' in PATH hack below).
    const fixtures = join(__dirname, 'fixtures');
    const codexSymlink = join(fixtures, 'codex');
    if (!existsSync(codexSymlink)) {
      writeFileSync(codexSymlink, '#!/usr/bin/env node\nrequire("./fake-codex.js");\n');
      require('fs').chmodSync(codexSymlink, 0o755);
    }

    // Act: create a Codex session through the test-only handle exposed from createServer.
    const sessionMgr = server.__test__.sessionMgr;

    const providerRegistry = (await import('@coder-studio/providers')).providerRegistry;
    const codex = providerRegistry.find((p) => p.id === 'codex')!;

    const workspace = await sessionMgr.create({
      workspaceId: 'ws-e2e',
      workspacePath: tempHome,
      providerId: 'codex',
      provider: codex,
    });

    // The fake-codex process will run the notify bridge during startup.
    // Wait for the POST to flush.
    await new Promise((r) => setTimeout(r, 500));

    // Assert: DB row contains resume_id + transcript_path.
    const dbPath = join(tempHome, 'data', 'coder-studio.db');
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('SELECT resume_id, transcript_path FROM sessions WHERE id = ?')
      .get(workspace.id) as { resume_id: string; transcript_path: string };
    db.close();

    expect(row.resume_id).toBe('fake-uuid-42');
    expect(row.transcript_path).toMatch(/rollout-2026-04-20T10-fake-uuid-42\.jsonl$/);
  });
});
```

> The test uses the `__test__.sessionMgr` handle added at the top of this task, so no extra HTTP or WS test harness is needed.

- [ ] **Step 3: Run the test**

```bash
pnpm --filter @coder-studio/server vitest run src/__tests__/codex-hook-integration.test.ts --reporter=verbose
```

Expected: PASS after resolving any `sessionMgr` exposure wiring (see note above).

If it fails because of timing: increase the `setTimeout` to 1000ms and verify the server log shows the POST being received. If the POST never arrives, check that `PATH` is being inherited by the spawned fake-codex subprocess.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/__tests__/fixtures/fake-codex.js \
        packages/server/src/__tests__/fixtures/codex \
        packages/server/src/__tests__/codex-hook-integration.test.ts
git commit -m "test(server): add end-to-end Codex notify hook integration test"
```

---

## Regression Sweep

After Task 17 passes, run the full suite to catch any ripples:

```bash
pnpm -r test -- --run
pnpm -r build
```

If any unrelated tests fail, investigate them before declaring the plan complete. Do not commit workarounds that mask regressions.

Commit any fixes as focused commits (`fix: …`).

---

## Manual Smoke Test (optional, after all tasks pass)

1. Run the server in dev mode (`pnpm dev` or equivalent).
2. Open the web UI, create a Codex session.
3. In the TUI, send a short message.
4. After the turn completes, run:
   ```sql
   sqlite3 ~/.coder-studio/data/coder-studio.db \
     'SELECT id, resume_id, transcript_path FROM sessions ORDER BY started_at DESC LIMIT 1;'
   ```
   Expected: both columns populated; file exists.
5. Restart the server; resume the session; verify the TUI replays history.
6. Inspect `~/.codex/config.toml` — unchanged.

---

## Non-Goals (reminder from the spec)

- Do NOT migrate Codex to `codex app-server` / `mcp-server` mode.
- Do NOT implement Supervisor evaluation/injection (that's Spec 2).
- Do NOT delete `stdout-heuristics.ts` — keep as fallback, evaluate in a later spec.
- Do NOT modify the user's `~/.codex/config.toml`.
