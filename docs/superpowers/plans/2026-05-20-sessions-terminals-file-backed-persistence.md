# Sessions And Terminals File-Backed Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `sessions` and `terminals` off SQLite as the runtime source of truth, while keeping DB shadow rows for foreign-key compatibility with `supervisors`.

**Architecture:** Extend the existing `TerminalRepo` and `SessionRepo` so they work in dual mode, matching the already-shipped `WorkspaceRepo` pattern: file-backed canonical state plus optional one-time legacy import and DB shadow sync. Runtime managers keep their current in-memory/PTy behavior; we do **not** attempt PTY resurrection or live terminal/session restore after restart. On restart, sessions still hydrate from persisted metadata and become `ended` when no live terminal exists.

**Tech Stack:** TypeScript, Vitest, SQLite shadow rows, JSON file stores under `state/`, existing repo patterns in `packages/server/src/storage/repositories/*`.

---

## File Map

**Modify:**
- `packages/server/src/storage/repositories/terminal-repo.ts`
  Add file-backed canonical persistence, legacy DB import, DB shadow sync, and a manager-facing `insert()` method.
- `packages/server/src/storage/repositories/session-repo.ts`
  Add file-backed canonical persistence, legacy DB import, DB shadow sync, generic `update()` support, and `listHydratable()` over file-backed state.
- `packages/server/src/storage/index.ts`
  Export any new repo option types needed by tests and server wiring.
- `packages/server/src/server.ts`
  Replace raw SQL adapters with file-backed repos, wire `state/terminals.json` and `state/sessions.json`, and make workspace teardown explicitly clear session/terminal file state before deleting the workspace shadow row.
- `packages/server/src/session/manager.ts`
  Make `deleteEndedForWorkspace()` remove persisted session state instead of only clearing in-memory maps.

**Test:**
- `packages/server/src/__tests__/terminal-repo.test.ts`
  Add file-backed terminal repo coverage.
- `packages/server/src/__tests__/session-repo.test.ts`
  Add file-backed session repo coverage.
- `packages/server/src/__tests__/session-hydrate-restart.test.ts`
  Seed restart state through file-backed repos instead of raw SQL truth.
- `packages/server/src/__tests__/supervisor-hydrate-restart.test.ts`
  Seed restart state through file-backed repos so supervisor compatibility still rides on session shadow rows.
- `packages/server/src/__tests__/workspace-close-state-cleanup.test.ts`
  Add a server-level regression proving workspace close deletes file-backed session/terminal state.

## Design Notes

- `workspaces -> terminals -> sessions -> supervisors` remains the compatibility FK chain. That is why `workspaces`, `terminals`, and `sessions` all keep shadow DB rows even after their canonical state moves to files.
- `terminals` become file-backed metadata only. `TerminalManager` still does not recreate PTY processes on restart.
- `sessions` hydrate from file-backed persisted state exactly once on startup. If the referenced terminal is not alive in memory, the hydrated session becomes `ended`, which preserves current restart behavior.
- No DB migration is required. Existing `terminals` and `sessions` tables remain in place and are treated as a shadow layer.
- `session.close` already is not truly atomic across state files because `workspaces` are file-backed today. This phase does not add a new cross-file transaction layer.

### Stored File Shapes

```ts
type TerminalFileRecord = {
  version: 1;
  terminals: Record<string, Terminal>;
};

type StoredSession = Session & {
  archived?: boolean;
};

type SessionFileRecord = {
  version: 1;
  sessions: Record<string, StoredSession>;
};
```

### Startup Order

1. `WorkspaceRepo` loads file-backed workspaces and syncs workspace shadow rows.
2. `TerminalRepo` loads file-backed terminals and syncs terminal shadow rows.
3. `SessionRepo` loads file-backed sessions and syncs session shadow rows.
4. `SessionManager.hydrate()` reads canonical file-backed sessions and marks any session without a live terminal as `ended`.

This order matters because session shadow rows reference terminal shadow rows, and terminal shadow rows reference workspace shadow rows.

### Non-Goals

- Do not remove the `sessions` or `terminals` tables.
- Do not add DB migrations in this phase.
- Do not auto-resume PTY processes, shell terminals, or agent sessions after server restart.
- Do not migrate `supervisors`, `supervisor_cycles`, or `attempts` in this phase.

### Task 1: Make `TerminalRepo` File-Backed And Manager-Compatible

**Files:**
- Modify: `packages/server/src/storage/repositories/terminal-repo.ts`
- Modify: `packages/server/src/storage/index.ts`
- Test: `packages/server/src/__tests__/terminal-repo.test.ts`

- [ ] **Step 1: Write the failing file-backed terminal repo tests**

Add a `describe("file-backed persistence", ...)` block to `packages/server/src/__tests__/terminal-repo.test.ts` with these cases:

```ts
describe("file-backed persistence", () => {
  it("reads terminal metadata from the file store when shadow rows are missing", () => {
    const filePath = join(tempDir, "terminals.json");
    const fileRepo = new TerminalRepo({
      filePath,
      shadowDb: db,
    });

    fileRepo.insert({
      id: "t-file",
      workspaceId: "ws-1",
      kind: "shell",
      cwd: "/path/to/workspace",
      argv: ["/bin/bash"],
      cols: 120,
      rows: 30,
      alive: true,
      createdAt: 1000,
      title: "bash",
    });

    db.prepare("DELETE FROM terminals WHERE id = ?").run("t-file");

    expect(fileRepo.findById("t-file")).toMatchObject({
      id: "t-file",
      workspaceId: "ws-1",
      kind: "shell",
      cwd: "/path/to/workspace",
    });
  });

  it("migrates legacy database terminals into the file store when the file is missing", () => {
    repo.create({
      id: "t-legacy",
      workspaceId: "ws-1",
      kind: "agent",
      cwd: "/path/to/workspace",
      argv: ["node", "agent.js"],
      cols: 80,
      rows: 24,
      createdAt: 1000,
      title: "Agent",
    });

    const migratedRepo = new TerminalRepo({
      filePath: join(tempDir, "migrated-terminals.json"),
      legacyDb: db,
      shadowDb: db,
    });

    expect(migratedRepo.findById("t-legacy")).toMatchObject({
      id: "t-legacy",
      workspaceId: "ws-1",
      kind: "agent",
      title: "Agent",
    });
  });

  it("deletes the shadow row when deleting a file-backed terminal", () => {
    const fileRepo = new TerminalRepo({
      filePath: join(tempDir, "delete-terminals.json"),
      shadowDb: db,
    });

    fileRepo.insert({
      id: "t-delete",
      workspaceId: "ws-1",
      kind: "shell",
      cwd: "/path/to/workspace",
      argv: ["/bin/bash"],
      cols: 120,
      rows: 30,
      alive: true,
      createdAt: 1000,
    });

    fileRepo.delete("t-delete");

    expect(fileRepo.findById("t-delete")).toBeUndefined();
    expect(db.prepare("SELECT * FROM terminals WHERE id = ?").get("t-delete")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the terminal repo test file and confirm the new cases fail**

Run:

```bash
pnpm exec vitest packages/server/src/__tests__/terminal-repo.test.ts
```

Expected:
- FAIL because `TerminalRepo` only supports DB mode today
- FAIL because `TerminalRepo` does not accept `{ filePath, legacyDb, shadowDb }`
- FAIL because `TerminalRepo` does not expose `insert()`

- [ ] **Step 3: Implement dual-mode file-backed `TerminalRepo`**

Refactor `packages/server/src/storage/repositories/terminal-repo.ts` to mirror the existing `WorkspaceRepo` structure:

```ts
export interface TerminalRepoOptions {
  filePath: string;
  legacyDb?: Database;
  shadowDb?: Database;
}

interface TerminalFileRecord {
  version: 1;
  terminals: Record<string, Terminal>;
}

export class TerminalRepo {
  private readonly db?: Database;
  private readonly filePath?: string;
  private readonly legacyDb?: Database;
  private readonly shadowDb?: Database;
  private shadowSynced = false;

  constructor(input: Database | TerminalRepoOptions) {
    if (isDatabase(input)) {
      this.db = input;
      return;
    }

    this.filePath = input.filePath;
    this.legacyDb = input.legacyDb;
    this.shadowDb = input.shadowDb;
  }

  insert(terminal: Terminal): void {
    this.create({
      id: terminal.id,
      workspaceId: terminal.workspaceId,
      kind: terminal.kind,
      cwd: terminal.cwd,
      argv: terminal.argv,
      env: terminal.env,
      title: terminal.title,
      cols: terminal.cols,
      rows: terminal.rows,
      createdAt: terminal.createdAt,
    });

    if (!terminal.alive && terminal.endedAt != null) {
      this.markEnded(terminal.id, terminal.endedAt, terminal.exitCode ?? 0);
    }
  }

  private loadFileTerminals(): Record<string, Terminal> {
    const parsed = readJsonFile<TerminalFileRecord | Record<string, Terminal> | Terminal[]>(
      this.filePath!
    );
    if (parsed !== undefined) {
      const terminals = normalizeTerminalFile(parsed);
      this.ensureShadowRows(terminals);
      return terminals;
    }

    if (!this.legacyDb) {
      return {};
    }

    const migrated = this.readAllDbTerminals(this.legacyDb);
    if (Object.keys(migrated).length > 0) {
      this.saveFileTerminals(migrated);
    }
    this.ensureShadowRows(migrated);
    return migrated;
  }
}
```

Implement these behaviors in the same file:

```ts
private upsertShadowRow(terminal: Terminal): void {
  this.shadowDb?.prepare(
    `INSERT INTO terminals (id, workspace_id, kind, cwd, argv, env, title, cols, rows, created_at, ended_at, exit_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       workspace_id = excluded.workspace_id,
       kind = excluded.kind,
       cwd = excluded.cwd,
       argv = excluded.argv,
       env = excluded.env,
       title = excluded.title,
       cols = excluded.cols,
       rows = excluded.rows,
       created_at = excluded.created_at,
       ended_at = excluded.ended_at,
       exit_code = excluded.exit_code`
  ).run(
    terminal.id,
    terminal.workspaceId,
    terminal.kind,
    terminal.cwd,
    JSON.stringify(terminal.argv),
    terminal.env ? JSON.stringify(terminal.env) : null,
    terminal.title || null,
    terminal.cols,
    terminal.rows,
    terminal.createdAt,
    terminal.endedAt ?? null,
    terminal.exitCode ?? null
  );
}

markEnded(id: string, endedAt: number, exitCode: number): void {
  if (this.db) {
    this.db.prepare("UPDATE terminals SET ended_at = ?, exit_code = ? WHERE id = ?").run(
      endedAt,
      exitCode,
      id
    );
    return;
  }

  const terminals = this.loadFileTerminals();
  const terminal = terminals[id];
  if (!terminal) {
    return;
  }

  terminals[id] = {
    ...terminal,
    alive: false,
    endedAt,
    exitCode,
  };
  this.saveFileTerminals(terminals);
  this.upsertShadowRow(terminals[id]);
}

delete(id: string): void {
  if (this.db) {
    this.db.prepare("DELETE FROM terminals WHERE id = ?").run(id);
    return;
  }

  const terminals = this.loadFileTerminals();
  if (!terminals[id]) {
    return;
  }

  delete terminals[id];
  this.saveFileTerminals(terminals);
  this.shadowDb?.prepare("DELETE FROM terminals WHERE id = ?").run(id);
}
```

Also update `packages/server/src/storage/index.ts` to export the new options type:

```ts
export {
  type NewTerminal,
  TerminalRepo,
  type TerminalRepoOptions,
  type TerminalRow,
} from "./repositories/terminal-repo.js";
```

- [ ] **Step 4: Run the terminal repo tests again**

Run:

```bash
pnpm exec vitest packages/server/src/__tests__/terminal-repo.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/storage/repositories/terminal-repo.ts \
        packages/server/src/storage/index.ts \
        packages/server/src/__tests__/terminal-repo.test.ts
git commit -m "refactor: add file-backed terminal persistence"
```

### Task 2: Make `SessionRepo` File-Backed And Hydration-Compatible

**Files:**
- Modify: `packages/server/src/storage/repositories/session-repo.ts`
- Modify: `packages/server/src/storage/index.ts`
- Test: `packages/server/src/__tests__/session-repo.test.ts`

- [ ] **Step 1: Write the failing file-backed session repo tests**

Add a `describe("file-backed persistence", ...)` block to `packages/server/src/__tests__/session-repo.test.ts` with these cases:

```ts
describe("file-backed persistence", () => {
  it("reads sessions from the file store when shadow rows are missing", () => {
    const fileSessionRepo = new SessionRepo({
      filePath: join(tempDir, "sessions.json"),
      shadowDb: db,
    });

    fileSessionRepo.insert({
      id: "s-file",
      workspace_id: "ws-1",
      terminal_id: "t-1",
      provider_id: "claude-cli",
      capability: "full",
      state: "running",
      started_at: 1000,
      last_active_at: 1000,
      ended_at: null,
      completion_percent: null,
      error_reason: null,
      archived: 0,
      title: "resume me",
      draft: "draft text",
    });

    db.prepare("DELETE FROM sessions WHERE id = ?").run("s-file");

    expect(fileSessionRepo.findById("s-file")).toMatchObject({
      id: "s-file",
      workspaceId: "ws-1",
      terminalId: "t-1",
      title: "resume me",
      draft: "draft text",
    });
  });

  it("migrates legacy database sessions into the file store when the file is missing", () => {
    repo.create({
      id: "s-legacy",
      workspaceId: "ws-1",
      terminalId: "t-1",
      providerId: "claude-cli",
      state: "idle",
      capability: "full",
      startedAt: 1000,
      lastActiveAt: 1000,
    });

    const migratedRepo = new SessionRepo({
      filePath: join(tempDir, "migrated-sessions.json"),
      legacyDb: db,
      shadowDb: db,
    });

    expect(migratedRepo.findById("s-legacy")).toMatchObject({
      id: "s-legacy",
      terminalId: "t-1",
      providerId: "claude-cli",
      state: "idle",
    });
  });

  it("lists hydratable sessions from file-backed state", () => {
    const fileSessionRepo = new SessionRepo({
      filePath: join(tempDir, "hydratable-sessions.json"),
      shadowDb: db,
    });

    fileSessionRepo.insert({
      id: "s-running",
      workspace_id: "ws-1",
      terminal_id: "t-1",
      provider_id: "claude-cli",
      capability: "full",
      state: "running",
      started_at: 1000,
      last_active_at: 1000,
      ended_at: null,
      completion_percent: null,
      error_reason: null,
      archived: 0,
      title: null,
      draft: null,
    });

    fileSessionRepo.insert({
      id: "s-ended",
      workspace_id: "ws-1",
      terminal_id: "t-1",
      provider_id: "claude-cli",
      capability: "full",
      state: "ended",
      started_at: 1000,
      last_active_at: 1000,
      ended_at: 1001,
      completion_percent: null,
      error_reason: null,
      archived: 0,
      title: null,
      draft: null,
    });

    expect(fileSessionRepo.listHydratable().map((session) => session.id)).toEqual(["s-running"]);
  });
});
```

- [ ] **Step 2: Run the session repo test file and confirm the new cases fail**

Run:

```bash
pnpm exec vitest packages/server/src/__tests__/session-repo.test.ts
```

Expected:
- FAIL because `SessionRepo` only supports DB mode today
- FAIL because `SessionRepo` does not expose `insert()` or `listHydratable()`
- FAIL because generic file-backed `update()` behavior does not exist

- [ ] **Step 3: Implement dual-mode file-backed `SessionRepo`**

Refactor `packages/server/src/storage/repositories/session-repo.ts` so it mirrors `WorkspaceRepo` and stays backward-compatible with existing DB callers:

```ts
export interface SessionRepoOptions {
  filePath: string;
  legacyDb?: Database;
  shadowDb?: Database;
}

interface StoredSession extends Session {
  archived?: boolean;
}

interface SessionFileRecord {
  version: 1;
  sessions: Record<string, StoredSession>;
}

export class SessionRepo {
  private readonly db?: Database;
  private readonly filePath?: string;
  private readonly legacyDb?: Database;
  private readonly shadowDb?: Database;
  private shadowSynced = false;

  constructor(input: Database | SessionRepoOptions) {
    if (isDatabase(input)) {
      this.db = input;
      return;
    }

    this.filePath = input.filePath;
    this.legacyDb = input.legacyDb;
    this.shadowDb = input.shadowDb;
  }

  insert(session: SessionRow): void {
    const next: StoredSession = {
      ...rowToSession(session),
      ...(session.draft != null ? { draft: session.draft } : {}),
      archived: session.archived === 1,
    };

    const sessions = this.loadFileSessions();
    sessions[next.id] = next;
    this.saveFileSessions(sessions);
    this.upsertShadowRow(next);
  }

  update(id: string, patch: SessionUpdatePatch): void {
    const sessions = this.loadFileSessions();
    const current = sessions[id];
    if (!current) {
      return;
    }

    const next: StoredSession = {
      ...current,
      ...(patch.terminalId ? { terminalId: patch.terminalId } : {}),
      ...(patch.state ? { state: patch.state as Session["state"] } : {}),
      ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
      ...(patch.endedAt !== undefined ? { endedAt: patch.endedAt } : {}),
      ...(patch.lastActiveAt !== undefined ? { lastActiveAt: patch.lastActiveAt } : {}),
      ...(patch.completionPercent !== undefined
        ? { completionPercent: patch.completionPercent }
        : {}),
      ...(patch.errorReason !== undefined ? { errorReason: patch.errorReason } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
    };

    sessions[id] = next;
    this.saveFileSessions(sessions);
    this.upsertShadowRow(next);
  }

  listHydratable(): Session[] {
    return this.listAllStoredSessions()
      .filter((session) => !session.archived && session.endedAt == null)
      .sort((a, b) => b.startedAt - a.startedAt);
  }
}
```

Implement shadow sync using the session FK shape already used by SQLite:

```ts
private upsertShadowRow(session: StoredSession): void {
  this.shadowDb?.prepare(
    `INSERT INTO sessions (
       id,
       workspace_id,
       terminal_id,
       provider_id,
       capability,
       state,
       started_at,
       ended_at,
       last_active_at,
       completion_percent,
       error_reason,
       archived,
       title
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       workspace_id = excluded.workspace_id,
       terminal_id = excluded.terminal_id,
       provider_id = excluded.provider_id,
       capability = excluded.capability,
       state = excluded.state,
       started_at = excluded.started_at,
       ended_at = excluded.ended_at,
       last_active_at = excluded.last_active_at,
       completion_percent = excluded.completion_percent,
       error_reason = excluded.error_reason,
       archived = excluded.archived,
       title = excluded.title`
  ).run(
    session.id,
    session.workspaceId,
    session.terminalId,
    session.providerId,
    session.capability,
    session.state,
    session.startedAt,
    session.endedAt ?? null,
    session.lastActiveAt,
    session.completionPercent ?? null,
    session.errorReason ?? null,
    session.archived ? 1 : 0,
    session.title ?? null
  );
}
```

Keep the existing DB-specific helpers by delegating them through `update()`:

```ts
updateState(id: string, state: SessionState): void {
  this.update(id, { state });
}

updateLastActive(id: string, lastActiveAt: number): void {
  this.update(id, { lastActiveAt });
}

markEnded(id: string, endedAt: number): void {
  this.update(id, { endedAt, state: "ended" });
}
```

Also update `packages/server/src/storage/index.ts`:

```ts
export {
  type NewSession,
  rowToSession,
  SessionRepo,
  type SessionRepoOptions,
  type SessionRow,
  sessionToRow,
} from "./repositories/session-repo.js";
```

- [ ] **Step 4: Run the session repo tests again**

Run:

```bash
pnpm exec vitest packages/server/src/__tests__/session-repo.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/storage/repositories/session-repo.ts \
        packages/server/src/storage/index.ts \
        packages/server/src/__tests__/session-repo.test.ts
git commit -m "refactor: add file-backed session persistence"
```

### Task 3: Rewire Server Runtime To File Truth And Explicit Cleanup

**Files:**
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/session/manager.ts`
- Test: `packages/server/src/__tests__/session-hydrate-restart.test.ts`
- Test: `packages/server/src/__tests__/supervisor-hydrate-restart.test.ts`
- Test: `packages/server/src/__tests__/workspace-close-state-cleanup.test.ts`

- [ ] **Step 1: Write the failing runtime/regression tests**

Update the restart tests so they seed canonical persisted state through the new file-backed repos instead of direct SQL inserts:

```ts
const terminalRepo = new TerminalRepo({
  filePath: join(dataDir, "state", "terminals.json"),
  shadowDb: firstCtx.db,
});
const sessionRepo = new SessionRepo({
  filePath: join(dataDir, "state", "sessions.json"),
  shadowDb: firstCtx.db,
});

terminalRepo.insert({
  id: "term-hydrated",
  workspaceId,
  kind: "agent",
  cwd: workspaceDir,
  argv: [],
  cols: 120,
  rows: 30,
  alive: false,
  createdAt: now,
  endedAt: now,
  exitCode: 0,
});

sessionRepo.insert({
  id: "sess-hydrated",
  workspace_id: workspaceId,
  terminal_id: "term-hydrated",
  provider_id: "claude",
  capability: "full",
  state: "running",
  started_at: now,
  last_active_at: now,
  ended_at: null,
  completion_percent: null,
  error_reason: null,
  archived: 0,
  title: null,
  draft: null,
});
```

Add a new server-level cleanup regression in `packages/server/src/__tests__/workspace-close-state-cleanup.test.ts`:

```ts
it("removes file-backed sessions and terminals when a workspace is closed", async () => {
  server = await createServer({
    dataDir: dbPath,
    host: "127.0.0.1",
    port: 0,
  });

  const ctx = server.__test__!.commandContext;
  const openResult = await dispatch(
    {
      kind: "command",
      id: "workspace-open",
      op: "workspace.open",
      args: { path: workspaceDir },
    },
    ctx
  );

  const workspaceId = openResult.data!.id;

  await dispatch(
    {
      kind: "command",
      id: "terminal-create",
      op: "terminal.create",
      args: { workspaceId },
    },
    ctx
  );

  await dispatch(
    {
      kind: "command",
      id: "workspace-close",
      op: "workspace.close",
      args: { workspaceId },
    },
    ctx
  );

  const terminalRepo = new TerminalRepo({
    filePath: join(dataDir, "state", "terminals.json"),
    shadowDb: ctx.db,
  });
  const sessionRepo = new SessionRepo({
    filePath: join(dataDir, "state", "sessions.json"),
    shadowDb: ctx.db,
  });

  expect(terminalRepo.listByWorkspace(workspaceId)).toEqual([]);
  expect(sessionRepo.listByWorkspace(workspaceId)).toEqual([]);
});
```

- [ ] **Step 2: Run the restart and cleanup tests to confirm they fail**

Run:

```bash
pnpm exec vitest \
  packages/server/src/__tests__/session-hydrate-restart.test.ts \
  packages/server/src/__tests__/supervisor-hydrate-restart.test.ts \
  packages/server/src/__tests__/workspace-close-state-cleanup.test.ts
```

Expected:
- FAIL because `server.ts` still uses raw SQL adapters
- FAIL because restart tests seed DB rows that are no longer the source of truth
- FAIL because workspace close does not yet delete file-backed terminal/session state

- [ ] **Step 3: Replace raw SQL adapters with file-backed repos in `server.ts`**

Update `packages/server/src/server.ts` so the runtime builds repos first and injects them directly:

```ts
const terminalRepo = new TerminalRepo({
  filePath: join(stateRoot, "state", "terminals.json"),
  legacyDb: db,
  shadowDb: db,
});

const sessionRepo = new SessionRepo({
  filePath: join(stateRoot, "state", "sessions.json"),
  legacyDb: db,
  shadowDb: db,
});

const terminalMgr = new TerminalManager({
  ptyHost: createPtyHost(),
  eventBus,
  db: terminalRepo,
});

const sessionMgr = new SessionManager({
  terminalMgr,
  eventBus,
  db: sessionRepo,
  broadcaster: wsHub,
  providerRegistry,
  providerConfigRepo,
});
```

Delete the now-obsolete raw SQL helper functions at the bottom of the file:

```ts
function createTerminalDatabase(...) { ... }
function createSessionDatabase(...) { ... }
```

Rewrite workspace teardown so it explicitly clears file-backed state in FK-safe order:

```ts
teardown: async (workspaceId) => {
  await lspMgr?.disposeWorkspace(workspaceId);
  await supervisorMgr?.deleteForWorkspace(workspaceId);
  await sessionMgr.stopForWorkspace(workspaceId);
  await terminalMgr.closeForWorkspace(workspaceId);
  sessionMgr.deleteEndedForWorkspace(workspaceId);

  for (const terminal of terminalRepo.listByWorkspace(workspaceId)) {
    terminalRepo.delete(terminal.id);
  }
},
```

The order is required:
1. stop sessions
2. close PTYs
3. delete session file/shadow rows
4. delete terminal file/shadow rows
5. let `WorkspaceRepo.delete()` remove the workspace file/shadow row

- [ ] **Step 4: Persist workspace-close session deletion in `SessionManager`**

Update `packages/server/src/session/manager.ts` so `deleteEndedForWorkspace()` removes persisted state as well as in-memory state:

```ts
deleteEndedForWorkspace(workspaceId: string): void {
  const endedSessions = Array.from(this.sessions.values()).filter(
    (session) => session.workspaceId === workspaceId && session.state === "ended"
  );

  for (const session of endedSessions) {
    this.deps.db.delete(session.id);
    this.sessions.delete(session.id);
    this.terminalToSession.delete(session.terminalId);
    this.cleanupDetector(session.id);
  }
}
```

Do **not** change restart semantics in `hydrate()`. This code path stays intentionally simple:

```ts
private resolveHydratedState(session: Session): SessionState {
  if (session.state === "draft") {
    return "draft";
  }

  const activeTerminal = this.deps.terminalMgr.get(session.terminalId);
  if (activeTerminal?.alive) {
    return session.state;
  }

  if (session.state === "ended") {
    return session.state;
  }

  return "ended";
}
```

That preserves the current “no live terminal after restart means ended session” behavior.

- [ ] **Step 5: Run the runtime regression tests again**

Run:

```bash
pnpm exec vitest \
  packages/server/src/__tests__/session-hydrate-restart.test.ts \
  packages/server/src/__tests__/supervisor-hydrate-restart.test.ts \
  packages/server/src/__tests__/workspace-close-state-cleanup.test.ts
```

Expected:
- PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/server.ts \
        packages/server/src/session/manager.ts \
        packages/server/src/__tests__/session-hydrate-restart.test.ts \
        packages/server/src/__tests__/supervisor-hydrate-restart.test.ts \
        packages/server/src/__tests__/workspace-close-state-cleanup.test.ts
git commit -m "refactor: wire file-backed session and terminal state"
```

### Task 4: Run Final Verification Across The Migration Slice

**Files:**
- No code changes expected
- Test: previously modified files

- [ ] **Step 1: Run targeted repo and restart suites**

Run:

```bash
pnpm exec vitest \
  packages/server/src/__tests__/terminal-repo.test.ts \
  packages/server/src/__tests__/session-repo.test.ts \
  packages/server/src/__tests__/session-hydrate-restart.test.ts \
  packages/server/src/__tests__/supervisor-hydrate-restart.test.ts \
  packages/server/src/__tests__/workspace-close-state-cleanup.test.ts
```

Expected:
- PASS

- [ ] **Step 2: Run server TypeScript validation**

Run:

```bash
pnpm exec tsc -p packages/server/tsconfig.json --noEmit
```

Expected:
- PASS with no TypeScript errors

- [ ] **Step 3: Run formatting/lint checks on touched files**

Run:

```bash
pnpm exec biome check \
  packages/server/src/storage/repositories/terminal-repo.ts \
  packages/server/src/storage/repositories/session-repo.ts \
  packages/server/src/storage/index.ts \
  packages/server/src/server.ts \
  packages/server/src/session/manager.ts \
  packages/server/src/__tests__/terminal-repo.test.ts \
  packages/server/src/__tests__/session-repo.test.ts \
  packages/server/src/__tests__/session-hydrate-restart.test.ts \
  packages/server/src/__tests__/supervisor-hydrate-restart.test.ts \
  packages/server/src/__tests__/workspace-close-state-cleanup.test.ts
```

Expected:
- PASS

- [ ] **Step 4: Commit the verification-only follow-up if any formatting edits were required**

```bash
git add packages/server/src/storage/repositories/terminal-repo.ts \
        packages/server/src/storage/repositories/session-repo.ts \
        packages/server/src/storage/index.ts \
        packages/server/src/server.ts \
        packages/server/src/session/manager.ts \
        packages/server/src/__tests__/terminal-repo.test.ts \
        packages/server/src/__tests__/session-repo.test.ts \
        packages/server/src/__tests__/session-hydrate-restart.test.ts \
        packages/server/src/__tests__/supervisor-hydrate-restart.test.ts \
        packages/server/src/__tests__/workspace-close-state-cleanup.test.ts
git commit -m "test: verify file-backed session and terminal migration"
```

## Acceptance Criteria

- `state/terminals.json` is the canonical source of persisted terminal metadata.
- `state/sessions.json` is the canonical source of persisted session metadata.
- Missing state files trigger one-time migration from legacy DB rows.
- DB shadow rows are kept in sync for `workspaces`, `terminals`, and `sessions`.
- Server restart still does **not** resurrect PTYs, but persisted sessions appear in `session.list` and resolve to `ended` when no live terminal exists.
- Workspace close removes file-backed session and terminal state before removing the workspace shadow row.
- `supervisors` continue to work against shadow session rows without changing their own persistence model.

## Risks To Watch During Implementation

- Session shadow sync must happen after terminal shadow sync, or SQLite FK inserts will fail.
- Workspace teardown must delete session rows before terminal rows, or SQLite FK deletes will fail.
- `draft` exists in `SessionRow` but not in the DB schema. The file-backed repo can preserve it even though the shadow row cannot.
- `session.close` best-effort behavior across `workspaces.json` and `sessions.json` remains a known limitation and should not be “fixed” ad hoc inside this migration.
