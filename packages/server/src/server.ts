/**
 * Server Entry Point
 *
 * Creates and assembles all server components.
 */

import type { FastifyInstance } from 'fastify';
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventBus } from './bus/event-bus.js';
import { buildFastifyApp } from './app.js';
import {
  auditCodexConfigToml,
  cleanupCodexConfigToml,
  type CodexAuditFindingType,
  type CodexCleanupResult,
  type CodexConfigAudit,
} from './config/codex-config-audit.js';
import { parseServerConfig, ensureDataDir, type ServerConfig } from './config.js';
import { ProviderInstallManager } from './provider-runtime/install-manager.js';
import type { RuntimeStatusDeps } from './provider-runtime/runtime-status.js';
import { SessionManager } from './session/manager.js';
import { openDatabase } from './storage/db.js';
import type { Database } from './storage/database.js';
import { ProviderConfigRepo } from './storage/repositories/provider-config-repo.js';
import { rowToSession, type SessionRow } from './storage/repositories/session-repo.js';
import { SupervisorCycleRepo } from './storage/repositories/supervisor-cycle-repo.js';
import { SupervisorRepo } from './storage/repositories/supervisor-repo.js';
import { AuthLoginBlockRepo } from './storage/repositories/auth-login-block-repo.js';
import { SupervisorManager } from './supervisor/manager.js';
import { TerminalManager } from './terminal/manager.js';
import { NodePtyHost } from './terminal/pty-host.js';
import { WorkspaceManager } from './workspace/manager.js';
import { FencingManager } from './ws/fencing.js';
import { WsHub } from './ws/hub.js';
import type { CommandContext } from './ws/dispatch.js';
import { providerRegistry } from '@coder-studio/providers';
import { AuthSessionRepo } from './storage/repositories/auth-session-repo.js';
import {
  deleteRuntimeConfig,
  getRuntimePath,
  writeRuntimeConfig,
  type RuntimeConfig,
} from '@coder-studio/core/runtime';
import { deleteWorkspaceUploads, runStartupGc } from './uploads/cleanup.js';
import { STARTUP_GC_DELAY_MS } from './uploads/constants.js';

import './commands/index.js';

export interface Server {
  app: FastifyInstance;
  stop: () => Promise<void>;
  __test__?: { sessionMgr: any; commandContext: any };
}

export interface ServerRuntimeOptions {
  writeRuntimeConfig?: boolean;
}

export interface ServerWarnLogger {
  warn(context: Record<string, unknown>, message: string): void;
}

export interface CodexConfigAuditApi {
  audit(): { codex: CodexConfigAudit };
  cleanup(removeIds: CodexAuditFindingType[]): CodexCleanupResult;
}

export function createCodexConfigAuditApi(): CodexConfigAuditApi {
  return {
    audit: () => ({ codex: auditCodexConfigToml() }),
    cleanup: (removeIds) => {
      const audit = auditCodexConfigToml();
      return cleanupCodexConfigToml(audit.configPath, { removeIds });
    },
  };
}

export async function logCodexConfigFindings(
  auditApi: Pick<CodexConfigAuditApi, 'audit'>,
  logger: ServerWarnLogger
): Promise<void> {
  try {
    const audit = auditApi.audit();
    for (const finding of audit.codex.findings) {
      logger.warn(
        {
          configPath: audit.codex.configPath,
          startLine: finding.startLine,
          findingMessage: finding.message,
        },
        'Codex config finding'
      );
    }
  } catch (err) {
    logger.warn({ err }, 'Codex config audit failed (non-fatal)');
  }
}

export async function createServer(
  configOverrides?: Partial<ServerConfig> & ServerRuntimeOptions
): Promise<Server> {
  const execFileAsync = promisify(nodeExecFile);
  const config = parseServerConfig(configOverrides);

  ensureDataDir(config);

  const db = openDatabase(config.dataDir);
  const eventBus = new EventBus();
  const fencingMgr = new FencingManager();
  const wsHub = new WsHub({ eventBus, commandContext: null as any, config, fencingMgr });

  const terminalMgr = new TerminalManager({
    ptyHost: createPtyHost(),
    eventBus,
    db: createTerminalDatabase(db),
  });

  const sessionDb = createSessionDatabase(db);
  const providerConfigRepo = new ProviderConfigRepo(db);
  const sessionMgr = new SessionManager({
    terminalMgr,
    eventBus,
    db: sessionDb,
    broadcaster: wsHub,
    providerRegistry,
    providerConfigRepo,
  });

  const workspaceMgr = new WorkspaceManager({
    db,
    eventBus,
    broadcaster: wsHub,
    onClose: (workspaceId) =>
      deleteWorkspaceUploads(config.uploadsDir, workspaceId).catch((err) =>
        console.warn('[uploads] cascade cleanup failed', { wsId: workspaceId, err })
      ),
  });

  const authSessionRepo = new AuthSessionRepo(db);
  const authLoginBlockRepo = new AuthLoginBlockRepo(db);
  const codexConfigAudit = createCodexConfigAuditApi();

  const app = await buildFastifyApp({
    wsHub,
    db,
    workspaceMgr,
    webRoot: config.webRoot,
    config,
    authSessionRepo,
    authLoginBlockRepo,
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    },
  });

  wsHub.setLogger(app.log);
  await logCodexConfigFindings(codexConfigAudit, app.log);

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
    logger: app.log,
  });
  await sessionMgr.hydrate();
  await supervisorMgr.hydrate();

  const providerRuntimeDeps: RuntimeStatusDeps = {};
  const providerInstallMgr = new ProviderInstallManager(providerRegistry, {
    ...providerRuntimeDeps,
    execFile: (file, args) => execFileAsync(file, args),
  });

  const commandContext: CommandContext = {
    workspaceMgr,
    sessionMgr,
    terminalMgr,
    eventBus,
    broadcaster: wsHub,
    db,
    providerRegistry,
    fencingMgr,
    supervisorMgr,
    providerRuntimeDeps,
    providerInstallMgr,
    codexConfigAudit,
  };

  (wsHub as any).deps.commandContext = commandContext;

  await app.listen({
    host: config.host,
    port: config.port,
  });

  if (configOverrides?.writeRuntimeConfig ?? process.env.NODE_ENV === 'production') {
    const runtime: RuntimeConfig = {
      host: config.host,
      port: extractListenPort(app) ?? config.port,
      pid: process.pid,
      token: `server-${process.pid}`,
      serverInstanceId: `server-${process.pid}`,
      startedAt: Date.now(),
    };
    process.env.CODER_STUDIO_RUNTIME_JSON_PATH = getRuntimePath();
    writeRuntimeConfig(runtime);
  }

  const gcTimer = setTimeout(() => {
    runStartupGc(config.uploadsDir, app.log).catch((err) =>
      app.log.warn({ err }, 'startup GC failed')
    );
  }, STARTUP_GC_DELAY_MS);
  gcTimer.unref();

  let stopped = false;
  const stopServer = async () => {
    if (stopped) return;
    stopped = true;

    clearTimeout(gcTimer);
    await app.close();
    supervisorMgr.stop();
    terminalMgr.shutdown();
    wsHub.destroy();
    eventBus.clear();
    deleteRuntimeConfig();
    db.close();
  };

  const actualPort = extractListenPort(app) ?? config.port;
  console.log(`Server listening on http://${config.host}:${actualPort}`);

  return {
    app,
    stop: stopServer,
    __test__: { sessionMgr, commandContext },
  };
}

function extractListenPort(app: FastifyInstance): number | undefined {
  const address = app.server.address();
  if (address && typeof address === 'object' && typeof address.port === 'number') {
    return address.port;
  }
  return undefined;
}

function createPtyHost() {
  return new NodePtyHost();
}

function createTerminalDatabase(db: Database) {
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

function createSessionDatabase(db: Database) {
  return {
    insert: (session: SessionRow) => {
      db.prepare(`
        INSERT INTO sessions (id, workspace_id, terminal_id, provider_id, state, capability, started_at, last_active_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        session.id,
        session.workspace_id,
        session.terminal_id,
        session.provider_id,
        session.state,
        session.capability,
        session.started_at,
        session.last_active_at
      );
    },
    update: (id: string, patch: Record<string, unknown>) => {
      const keys = Object.keys(patch);
      if (keys.length === 0) return;

      const allowedCols = new Set([
        'terminal_id',
        'state',
        'started_at',
        'ended_at',
        'completion_percent',
        'error_reason',
        'last_active_at',
        'title',
      ]);

      const setClauses: string[] = [];
      const values: unknown[] = [];
      for (const key of keys) {
        const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (!allowedCols.has(col)) continue;
        setClauses.push(`${col} = ?`);
        values.push(patch[key]);
      }
      if (setClauses.length === 0) return;

      db.prepare(`UPDATE sessions SET ${setClauses.join(', ')} WHERE id = ?`).run(
        ...(values as Array<string | number | bigint | Uint8Array | null>),
        id
      );
    },
    findById: (id: string) => {
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
      return row ? rowToSession(row) : undefined;
    },
    findByWorkspaceId: (workspaceId: string) => {
      const rows = db
        .prepare('SELECT * FROM sessions WHERE workspace_id = ? ORDER BY started_at DESC')
        .all(workspaceId) as unknown as SessionRow[];
      return rows.map(rowToSession);
    },
    listHydratable: () => {
      const rows = db.prepare(
        'SELECT * FROM sessions WHERE archived = 0 AND ended_at IS NULL ORDER BY started_at DESC'
      ).all() as unknown as SessionRow[];
      return rows.map(rowToSession);
    },
    delete: (id: string) => {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await createServer();

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
