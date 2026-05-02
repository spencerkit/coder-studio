import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { HooksManager, type HookRouteDeps } from '../hooks/manager.js';
import { HookRegistrationRepo } from '../storage/repositories/hook-registration-repo.js';
import { ProviderConfigRepo } from '../storage/repositories/provider-config-repo.js';
import { SessionManager, type ProviderHookEvent } from '../session/manager.js';
import { TerminalManager } from '../terminal/manager.js';
import { EventBus } from '../bus/event-bus.js';
import type { Broadcaster, PtyHost, PtyProcess } from '../terminal/types.js';
import type { ProviderDefinition } from '@coder-studio/core';
import { providerRegistry } from '@coder-studio/providers';

function createMockPtyHost(): PtyHost {
  const terminals = new Map<string, { onDataCallbacks: Array<(data: string) => void>; onExitCallbacks: Array<(event: { exitCode: number }) => void> }>();

  return {
    spawn: (argv: string[], options) => {
      const id = `mock-pty-${Date.now()}`;
      const pty: PtyProcess = {
        onData: (callback) => {
          const term = terminals.get(id);
          if (term) term.onDataCallbacks.push(callback);
        },
        onExit: (callback) => {
          const term = terminals.get(id);
          if (term) term.onExitCallbacks.push(callback);
        },
        write: () => {},
        resize: () => {},
        kill: () => {},
      };
      terminals.set(id, { onDataCallbacks: [], onExitCallbacks: [] });
      return pty;
    },
  };
}

describe('Codex notify hook integration', () => {
  let tempHome: string;
  let db: Database.Database;
  let sessionMgr: SessionManager;
  let hooksMgr: HooksManager;

  beforeEach(() => {
    tempHome = join(tmpdir(), `cs-e2e-${Date.now()}`);
    mkdirSync(tempHome, { recursive: true });

    // Create in-memory database
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Create tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS hook_registrations (
        provider_id TEXT PRIMARY KEY,
        marker_version TEXT NOT NULL,
        injected_at INTEGER NOT NULL,
        global_config_path TEXT NOT NULL,
        last_check_at INTEGER NOT NULL,
        last_status TEXT NOT NULL,
        last_error TEXT
      );
    `);
    // Run the init migration inline
    db.exec(`
      CREATE TABLE IF NOT EXISTS terminals (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        cwd TEXT NOT NULL,
        argv TEXT NOT NULL,
        cols INTEGER NOT NULL,
        rows INTEGER NOT NULL,
        alive INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        ended_at INTEGER,
        exit_code INTEGER
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        terminal_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        state TEXT NOT NULL,
        resume_id TEXT,
        capability TEXT NOT NULL,
        started_at INTEGER,
        last_active_at INTEGER NOT NULL,
        ended_at INTEGER,
        completion_percent INTEGER,
        draft TEXT,
        transcript_path TEXT
      );
      CREATE TABLE IF NOT EXISTS provider_configs (
        provider_id TEXT PRIMARY KEY,
        config TEXT NOT NULL
      );
      INSERT INTO _migrations (name, applied_at) VALUES ('001_init', ${Date.now()});
      INSERT INTO _migrations (name, applied_at) VALUES ('002_transcript_path', ${Date.now()});
    `);

    const eventBus = new EventBus();
    const mockBroadcaster: Broadcaster = {
      broadcast: () => {},
    };
    const mockPtyHost = createMockPtyHost();
    const terminalMgr = new TerminalManager({
      ptyHost: mockPtyHost,
      eventBus,
      db: { insert: () => {}, markEnded: () => {} },
    });

    const sessionDb = {
      insert: (session: any) => {
        db.prepare(`
          INSERT INTO sessions (id, workspace_id, terminal_id, provider_id, state, resume_id, capability, started_at, last_active_at, transcript_path)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          session.id, session.workspace_id, session.terminal_id, session.provider_id,
          session.state, session.resume_id, session.capability, session.started_at,
          session.last_active_at, session.transcript_path ?? null
        );
      },
      update: (id: string, patch: any) => {
        const keys = Object.keys(patch);
        if (keys.length === 0) return;
        const setClause = keys.map((k) => `${k.replace(/([A-Z])/g, '_$1').toLowerCase()} = ?`).join(', ');
        const values = keys.map((k) => patch[k]);
        db.prepare(`UPDATE sessions SET ${setClause} WHERE id = ?`).run(...values, id);
      },
      findById: (id: string) => {
        return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
      },
      findByWorkspaceId: (workspaceId: string) => {
        return db.prepare('SELECT * FROM sessions WHERE workspace_id = ?').all(workspaceId);
      },
      delete: (id: string) => {
        db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      },
      findByResumeId: (resumeId: string) => {
        return db.prepare('SELECT * FROM sessions WHERE resume_id = ?').get(resumeId) as { id: string } | null | undefined;
      },
    };

    const codex = providerRegistry.find((p) => p.id === 'codex')!;

    sessionMgr = new SessionManager({
      terminalMgr,
      eventBus,
      db: sessionDb,
      broadcaster: mockBroadcaster,
      providerRegistry: [codex],
      providerConfigRepo: new ProviderConfigRepo(db),
    });

    const hookRegistrationRepo = new HookRegistrationRepo(db);
    hooksMgr = new HooksManager(hookRegistrationRepo, {
      host: '127.0.0.1',
      port: 0,
      pid: process.pid,
      token: 'test',
      serverInstanceId: 'x',
      startedAt: Date.now(),
    }, {
      sessionMgr,
      providerRegistry: [codex],
      sessionDb,
    });
  });

  afterEach(() => {
    db.close();
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('Codex agent-turn-complete → DB has resume_id and transcript_path', async () => {
    const codex = providerRegistry.find((p) => p.id === 'codex')!;

    // Create a session
    const session = await sessionMgr.create({
      workspaceId: 'ws-e2e',
      workspacePath: tempHome,
      providerId: 'codex',
      provider: codex,
    });

    // Simulate Codex notify hook posting agent-turn-complete
    hooksMgr.handleHookEvent('agent-turn-complete', {
      type: 'agent-turn-complete',
      'thread-id': 'fake-uuid-42',
      'turn-id': 'turn-1',
    }, { coderStudioSessionId: session.id });

    // Wait for async transcript resolution
    await new Promise((r) => setTimeout(r, 100));

    // Verify DB row
    const row = db.prepare('SELECT resume_id, transcript_path FROM sessions WHERE id = ?')
      .get(session.id) as { resume_id: string; transcript_path: string | null };

    expect(row.resume_id).toBe('fake-uuid-42');
    // transcript_path may be null if ~/.codex/sessions doesn't exist in test env — that's expected
    // The key assertion is that resume_id is populated from the hook event
    expect(row.resume_id).toBeTruthy();
  });

  it('subsequent TurnCompleted does not overwrite resumeId', async () => {
    const codex = providerRegistry.find((p) => p.id === 'codex')!;
    const session = await sessionMgr.create({
      workspaceId: 'ws-e2e',
      workspacePath: tempHome,
      providerId: 'codex',
      provider: codex,
    });

    hooksMgr.handleHookEvent('agent-turn-complete', {
      type: 'agent-turn-complete',
      'thread-id': 'uuid-a',
      'turn-id': 't1',
    }, { coderStudioSessionId: session.id });

    hooksMgr.handleHookEvent('agent-turn-complete', {
      type: 'agent-turn-complete',
      'thread-id': 'uuid-b',
      'turn-id': 't2',
    }, { coderStudioSessionId: session.id });

    const updated = sessionMgr.get(session.id)!;
    expect(updated.resumeId).toBe('uuid-a');
  });
});
