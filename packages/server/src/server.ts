/**
 * Server Entry Point
 *
 * Creates and assembles all server components
 */

import type { FastifyInstance } from 'fastify';
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
import { HookRegistrationRepo } from './storage/repositories/hook-registration-repo.js';
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

  // Infrastructure: Database
  const db = openDatabase(config.dataDir);
  runMigrations(db);

  // Collaboration infrastructure: Event Bus + WebSocket Hub
  const eventBus = new EventBus();

  // Create FencingManager first
  const fencingMgr = new FencingManager();

  // Create WsHub (implements Broadcaster)
  const wsHub = new WsHub({ eventBus, commandContext: null as any, config, fencingMgr });

  // Terminal Manager (needs broadcaster)
  // Note: For Phase 1, we use a minimal PTY host implementation
  const terminalMgr = new TerminalManager({
    ptyHost: createPtyHost(), // Will be implemented with node-pty
    broadcaster: wsHub,
    db: createTerminalDatabase(db),
  });

  // Session Manager (needs terminal manager)
  const sessionDb = createSessionDatabase(db);

  const sessionMgr = new SessionManager({
    terminalMgr,
    eventBus,
    db: sessionDb,
    broadcaster: wsHub,
    providerRegistry,
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
    {} as any, // Runtime config - pre-existing stub
    {
      sessionMgr,
      providerRegistry,
      sessionDb,
    }
  );

  // Supervisor Manager
  const supervisorMgr = new SupervisorManager({
    eventBus,
    broadcaster: wsHub,
    terminalMgr,
  });

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
  });

  // Start server
  await app.listen({
    host: config.host,
    port: config.port,
  });

  console.log(`Server listening on http://${config.host}:${config.port}`);

  // Return server handle
  return {
    app,
    stop: async () => {
      // Graceful shutdown in reverse order
      await app.close();
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
function createSessionDatabase(db: any) {
  return {
    insert: (session: any) => {
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

      // Whitelist allowed columns to prevent SQL injection via crafted keys
      const ALLOWED_COLS = new Set([
        'resume_id', 'transcript_path', 'state', 'started_at',
        'ended_at', 'completion_percent', 'error_reason', 'last_active_at',
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
