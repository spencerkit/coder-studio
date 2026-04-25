/**
 * Server Entry Point
 *
 * Creates and assembles all server components
 */

import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { EventBus } from './bus/event-bus.js';
import { WsHub } from './ws/hub.js';
import { buildFastifyApp } from './app.js';
import { openDatabase, runMigrations } from './storage/db.js';
import { parseServerConfig, ensureDataDir, type ServerConfig } from './config.js';
import { type CommandContext } from './ws/dispatch.js';
import { WorkspaceManager } from './workspace/manager.js';
import { SessionManager } from './session/manager.js';
import { TerminalManager } from './terminal/manager.js';
import { HooksManager } from './hooks/manager.js';
import { getBridgeScriptPath } from './hooks/bridge.js';
import {
  deleteRuntimeConfig,
  writeRuntimeConfig,
  type RuntimeConfig,
} from './hooks/runtime-json.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { HookRegistrationRepo } from './storage/repositories/hook-registration-repo.js';
import { ProviderConfigRepo } from './storage/repositories/provider-config-repo.js';
import { SupervisorCycleRepo } from './storage/repositories/supervisor-cycle-repo.js';
import { SupervisorRepo } from './storage/repositories/supervisor-repo.js';
import { rowToSession, type SessionRow } from './storage/repositories/session-repo.js';
import { providerRegistry } from '@coder-studio/providers';
import { FencingManager } from './ws/fencing.js';
import { SupervisorManager } from './supervisor/manager.js';
import { NodePtyHost } from './terminal/pty-host.js';

// Import command handlers to register them
import './commands/index.js';

export interface Server {
  app: FastifyInstance;
  stop: () => Promise<void>;
  __test__?: { sessionMgr: any; hooksMgr: any; commandContext: any };
}

/**
 * Create and start server
 */
export async function createServer(
  configOverrides?: Partial<ServerConfig>
): Promise<Server> {
  const config = parseServerConfig(configOverrides);

  // Ensure data directory exists (production only)
  ensureDataDir(config);

  // Runtime handshake: shared state between this server process and the
  // per-provider bridge scripts (Claude SessionStart hook, Codex -c notify,
  // …). Generated here, consumed by registerHooksEndpoint (for token check)
  // and — if config.writeRuntime — persisted to ~/.coder-studio/runtime.json
  // after `app.listen()` so bridge scripts can locate and authenticate us.
  //
  // Port is filled in post-listen (config.port may be 0 to let the OS pick).
  // We mutate the same object instead of replacing it so that the endpoint
  // registered in buildFastifyApp still sees the final port through its
  // captured reference (not strictly required — the endpoint only reads
  // `token` — but keeps the object truthful everywhere else).
  const runtime: RuntimeConfig = {
    port: config.port,
    token: randomBytes(32).toString('hex'),
    serverInstanceId: randomUUID(),
    startedAt: Date.now(),
  };

  // Infrastructure: Database
  const db = openDatabase(config.dataDir);
  runMigrations(db);

  // Collaboration infrastructure: Event Bus + WebSocket Hub
  const eventBus = new EventBus();

  // Create FencingManager first
  const fencingMgr = new FencingManager();

  // Create WsHub (implements Broadcaster)
  const wsHub = new WsHub({ eventBus, commandContext: null as any, config, fencingMgr });

  // Terminal Manager (needs eventBus)
  // Note: For Phase 1, we use a minimal PTY host implementation
  const terminalMgr = new TerminalManager({
    ptyHost: createPtyHost(), // Will be implemented with node-pty
    eventBus,
    db: createTerminalDatabase(db),
  });

  // Session Manager (needs terminal manager)
  const sessionDb = createSessionDatabase(db);
  const providerConfigRepo = new ProviderConfigRepo(db);

  const sessionMgr = new SessionManager({
    terminalMgr,
    eventBus,
    db: sessionDb,
    broadcaster: wsHub,
    providerRegistry,
    providerConfigRepo,
    resolveBridgeScriptPath: (providerId) => getBridgeScriptPath(providerId),
  });

  // Workspace Manager
  const workspaceMgr = new WorkspaceManager({
    db,
    eventBus,
  });

  // Hooks Manager
  const hookRegistrationRepo = new HookRegistrationRepo(db);

  const hooksMgr = new HooksManager(
    hookRegistrationRepo,
    runtime,
    {
      sessionMgr,
      providerRegistry,
      sessionDb,
    }
  );

  // Deploy per-provider bridge scripts and merge managed hook entries into
  // each provider's global config. Without this, Claude's SessionStart hook
  // never runs and Codex's `-c notify=[...]` points at a non-existent
  // script — both providers' sessions would then be stuck in 'starting'.
  //
  // In tests we skip this (see ServerConfig.writeRuntime) to keep runs from
  // racing on the shared `~/.claude/settings.json` + `~/.coder-studio/hooks`
  // files. Tests that need the hook chain exercise HooksManager directly.
  if (config.writeRuntime) {
    try {
      await hooksMgr.deployBridgeScripts(providerRegistry);
    } catch (err) {
      console.warn('Failed to deploy provider bridge scripts — hooks may not fire:', err);
    }

    // Warn (but don't modify) if the user's Codex config.toml has settings
    // that would interfere with our `-c notify=` argv injection. The actual
    // remediation is user-initiated via the `settings.cleanupCodexConfig`
    // WS command — we never touch their TOML without consent.
    try {
      const audit = hooksMgr.auditExternalConfigs();
      for (const finding of audit.codex.findings) {
        console.warn(
          `[codex-config] ${audit.codex.configPath}:${finding.startLine} ${finding.message}`
        );
      }
    } catch (err) {
      // Strictly best-effort: a broken audit must never block startup.
      console.warn('Codex config audit failed (non-fatal):', err);
    }
  }

  // Supervisor Manager
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
  await sessionMgr.hydrate();
  await supervisorMgr.hydrate();

  // Command context with all managers
  const commandContext: CommandContext = {
    workspaceMgr,
    sessionMgr,
    terminalMgr,
    hooksMgr,
    eventBus,
    broadcaster: wsHub,
    db,
    providerRegistry,
    fencingMgr,
    supervisorMgr,
  };

  // Update wsHub with command context
  (wsHub as any).deps.commandContext = commandContext;

  // Web assets root (for CLI mode)
  const webRoot = config.webRoot;

  // Transport: Fastify app
  const app = await buildFastifyApp({
    wsHub,
    db,
    hooksMgr,
    commandContext,
    webRoot,
    config,
    runtime,
  });

  // Start server
  await app.listen({
    host: config.host,
    port: config.port,
  });

  // Resolve the real port before persisting runtime.json: callers may pass
  // port 0 (tests, dev tooling) to let the OS pick a free port, and bridge
  // scripts need the actual number to POST back.
  const actualPort = extractListenPort(app) ?? config.port;
  runtime.port = actualPort;

  if (config.writeRuntime) {
    try {
      writeRuntimeConfig(runtime);
    } catch (err) {
      // Non-fatal: server itself is up and the WS API keeps working. Hooks
      // (SessionStart, agent-turn-complete) will silently no-op until the
      // user resolves the disk issue, but that's strictly better than
      // refusing to boot.
      console.warn('Failed to write runtime.json — provider hooks will not reach the server:', err);
    }
  }

  console.log(`Server listening on http://${config.host}:${actualPort}`);

  let stopped = false;

  return {
    app,
    stop: async () => {
      if (stopped) return;
      stopped = true;

      // Clean up the on-disk handshake first so any bridge script that
      // spawns during shutdown silently no-ops instead of POSTing to a
      // dying server (or worse, a next server instance with a different
      // token listening on the same port).
      if (config.writeRuntime) {
        try {
          deleteRuntimeConfig();
        } catch {
          // Best-effort cleanup; do not block shutdown on it.
        }
      }

      // Graceful shutdown in reverse order
      await app.close();
      supervisorMgr.stop();
      terminalMgr.shutdown();
      wsHub.destroy();
      eventBus.clear();
      db.close();
    },
    // Exposed for integration tests. Not part of the public API.
    __test__: { sessionMgr, hooksMgr, commandContext },
  };
}

/**
 * Fastify hides the actual port on the underlying HTTP server; expose it
 * safely without assuming a specific Node typing.
 */
function extractListenPort(app: FastifyInstance): number | undefined {
  const address = app.server.address();
  if (address && typeof address === 'object' && typeof address.port === 'number') {
    return address.port;
  }
  return undefined;
}

/**
 * Create PTY host adapter
 */
function createPtyHost() {
  return new NodePtyHost();
}

/**
 * Create terminal database adapter
 */
function createTerminalDatabase(db: any) {
  return {
    insert: (terminal: any) => {
      db.prepare(`
        INSERT INTO terminals (id, workspace_id, kind, title, cwd, argv, cols, rows, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        terminal.id,
        terminal.workspaceId,
        terminal.kind,
        terminal.title,
        terminal.cwd,
        JSON.stringify(terminal.argv),
        terminal.cols,
        terminal.rows,
        terminal.createdAt
      );
    },
    markEnded: (id: string, endedAt: number, exitCode: number) => {
      db.prepare(`
        UPDATE terminals SET ended_at = ?, exit_code = ? WHERE id = ?
      `).run(endedAt, exitCode, id);
    },
  };
}

/**
 * Create session database adapter
 */
function createSessionDatabase(db: Database.Database) {
  return {
    insert: (session: SessionRow) => {
      db.prepare(`
        INSERT INTO sessions (id, workspace_id, terminal_id, provider_id, state, resume_id, capability, started_at, last_active_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        session.id,
        session.workspace_id,
        session.terminal_id,
        session.provider_id,
        session.state,
        session.resume_id,
        session.capability,
        session.started_at,
        session.last_active_at
      );
    },
    update: (id: string, patch: Record<string, unknown>) => {
      const keys = Object.keys(patch);
      if (keys.length === 0) return;

      const ALLOWED_COLS = new Set([
        'resume_id', 'transcript_path', 'terminal_id', 'state', 'started_at',
        'ended_at', 'completion_percent', 'error_reason', 'last_active_at',
        'title',
      ]);

      const setClauses: string[] = [];
      const values: unknown[] = [];
      for (const key of keys) {
        const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (!ALLOWED_COLS.has(col)) continue;
        setClauses.push(`${col} = ?`);
        values.push(patch[key]);
      }
      if (setClauses.length === 0) return;
      const setClause = setClauses.join(', ');

      db.prepare(`UPDATE sessions SET ${setClause} WHERE id = ?`).run(...values, id);
    },
    findById: (id: string) => {
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
      return row ? rowToSession(row) : undefined;
    },
    findByWorkspaceId: (workspaceId: string) => {
      const rows = db.prepare('SELECT * FROM sessions WHERE workspace_id = ? ORDER BY started_at DESC').all(workspaceId) as SessionRow[];
      return rows.map(rowToSession);
    },
    listHydratable: () => {
      const rows = db.prepare(
        `SELECT * FROM sessions WHERE archived = 0 AND ended_at IS NULL ORDER BY started_at DESC`
      ).all() as SessionRow[];
      return rows.map(rowToSession);
    },
    delete: (id: string) => {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    },
    findByResumeId: (resumeId: string) => {
      return db.prepare('SELECT * FROM sessions WHERE resume_id = ?').get(resumeId) as { id: string } | null | undefined;
    },
  };
}

/**
 * Create hook registration repository
 */


/**
 * Main entry point when run directly
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await createServer();

  // Handle shutdown signals
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nShutting down...');
    await server.stop();
    process.exit(0);
  });
}
