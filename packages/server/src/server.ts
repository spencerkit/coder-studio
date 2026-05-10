/**
 * Server Entry Point
 *
 * Creates and assembles all server components.
 */
import {
  deleteRuntimeConfig,
  getRuntimePath,
  type RuntimeConfig,
  writeRuntimeConfig,
} from "@coder-studio/core/runtime";
import { providerRegistry } from "@coder-studio/providers";
import { isDirectExecution } from "@coder-studio/utils";
import type { FastifyInstance } from "fastify";
import { buildFastifyApp } from "./app.js";
import { EventBus } from "./bus/event-bus.js";
import { ensureDataDir, parseServerConfig, type ServerConfig } from "./config.js";
import { AutoFetchScheduler } from "./git/auto-fetch.js";
import { runCommandAsString } from "./provider-runtime/command-runner.js";
import { createE2EProviderMockOverrides } from "./provider-runtime/e2e-provider-mock.js";
import { ProviderInstallManager } from "./provider-runtime/install-manager.js";
import type { RuntimeStatusDeps } from "./provider-runtime/runtime-status.js";
import { SessionManager } from "./session/manager.js";
import type { Database } from "./storage/database.js";
import { openDatabase } from "./storage/db.js";
import { AuthLoginBlockRepo } from "./storage/repositories/auth-login-block-repo.js";
import { AuthSessionRepo } from "./storage/repositories/auth-session-repo.js";
import { ProviderConfigRepo } from "./storage/repositories/provider-config-repo.js";
import { rowToSession, type SessionRow } from "./storage/repositories/session-repo.js";
import { SettingsRepo } from "./storage/repositories/settings-repo.js";
import { SupervisorCycleRepo } from "./storage/repositories/supervisor-cycle-repo.js";
import { SupervisorRepo } from "./storage/repositories/supervisor-repo.js";
import { SupervisorManager } from "./supervisor/manager.js";
import { TerminalManager } from "./terminal/manager.js";
import { NodePtyHost } from "./terminal/pty-host.js";
import type { TerminalDatabase } from "./terminal/types.js";
import { deleteWorkspaceUploads, runStartupGc } from "./uploads/cleanup.js";
import { STARTUP_GC_DELAY_MS } from "./uploads/constants.js";
import { WorkspaceManager } from "./workspace/manager.js";
import type { CommandContext } from "./ws/dispatch.js";
import { dispatch } from "./ws/dispatch.js";
import { FencingManager } from "./ws/fencing.js";
import { WsHub } from "./ws/hub.js";

import "./commands/index.js";

export interface Server {
  app: FastifyInstance;
  stop: () => Promise<void>;
  __test__?: { sessionMgr: SessionManager; commandContext: CommandContext };
}

export interface ServerRuntimeOptions {
  writeRuntimeConfig?: boolean;
}

export async function createServer(
  configOverrides?: Partial<ServerConfig> & ServerRuntimeOptions
): Promise<Server> {
  const config = parseServerConfig(configOverrides);

  ensureDataDir(config);

  const db = openDatabase(config.dataDir);
  const eventBus = new EventBus();
  const fencingMgr = new FencingManager();
  const wsHub = new WsHub({ eventBus, commandContext: null, config, fencingMgr });
  let workspaceMgr: WorkspaceManager;
  let commandContext: CommandContext;

  const terminalMgr = new TerminalManager({
    ptyHost: createPtyHost(),
    eventBus,
    db: createTerminalDatabase(db),
  });

  const settingsRepo = new SettingsRepo(db);
  const autoFetch = new AutoFetchScheduler({
    workspaceMgr: { get: (workspaceId) => workspaceMgr.get(workspaceId) },
    eventBus,
    settingsRepo,
    runFetch: async (workspaceId) => {
      if (!workspaceMgr.get(workspaceId)) {
        return;
      }

      const result = await dispatch(
        {
          kind: "command",
          id: `auto-fetch:${workspaceId}:${Date.now()}`,
          op: "git.fetch",
          args: {
            workspaceId,
            background: true,
          },
        },
        commandContext
      );

      if (!result.ok) {
        throw new Error(result.error?.message ?? "Background fetch failed");
      }

      const data = result.data as { success?: boolean; message?: string };
      if (data.success === false) {
        throw new Error(data.message ?? "Background fetch failed");
      }
    },
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

  let supervisorMgr: SupervisorManager | undefined;

  workspaceMgr = new WorkspaceManager({
    db,
    eventBus,
    broadcaster: wsHub,
    autoFetch,
    teardown: async (workspaceId) => {
      await supervisorMgr?.deleteForWorkspace(workspaceId);
      await sessionMgr.stopForWorkspace(workspaceId);
      await terminalMgr.closeForWorkspace(workspaceId);
      sessionMgr.deleteEndedForWorkspace(workspaceId);
    },
    onClose: (workspaceId) =>
      deleteWorkspaceUploads(config.uploadsDir, workspaceId).catch((err) =>
        console.warn("[uploads] cascade cleanup failed", { wsId: workspaceId, err })
      ),
  });
  workspaceMgr.hydrateWatchers();

  const authSessionRepo = new AuthSessionRepo(db);
  const authLoginBlockRepo = new AuthLoginBlockRepo(db);

  const app = await buildFastifyApp({
    wsHub,
    db,
    workspaceMgr,
    webRoot: config.webRoot,
    config,
    authSessionRepo,
    authLoginBlockRepo,
    logger: {
      level: "info",
      transport: {
        target: "pino-pretty",
        options: {
          translateTime: "HH:MM:ss Z",
          ignore: "pid,hostname",
        },
      },
    },
  });

  wsHub.setLogger(app.log);

  const supervisorRepo = new SupervisorRepo(db);
  const cycleRepo = new SupervisorCycleRepo(db);
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
    logger: app.log,
  });
  await sessionMgr.hydrate();
  await supervisorMgr.hydrate();

  const providerMockOverrides = createE2EProviderMockOverrides();
  const providerRuntimeDeps: RuntimeStatusDeps = providerMockOverrides
    ? {
        commandExists: providerMockOverrides.commandExists,
      }
    : {};
  const providerInstallMgr = new ProviderInstallManager(providerRegistry, {
    ...providerRuntimeDeps,
    runCommand: providerMockOverrides?.runCommand ?? runCommandAsString,
  });

  commandContext = {
    workspaceMgr,
    sessionMgr,
    terminalMgr,
    eventBus,
    broadcaster: wsHub,
    db,
    providerRegistry,
    fencingMgr,
    supervisorMgr,
    autoFetch,
    providerRuntimeDeps,
    providerInstallMgr,
  };

  wsHub.setCommandContext(commandContext);

  await app.listen({
    host: config.host,
    port: config.port,
  });

  if (configOverrides?.writeRuntimeConfig ?? process.env.NODE_ENV === "production") {
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
      app.log.warn({ err }, "startup GC failed")
    );
  }, STARTUP_GC_DELAY_MS);
  gcTimer.unref();

  let stopped = false;
  const stopServer = async () => {
    if (stopped) return;
    stopped = true;

    clearTimeout(gcTimer);
    await app.close();
    autoFetch.stop();
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
  if (address && typeof address === "object" && typeof address.port === "number") {
    return address.port;
  }
  return undefined;
}

function createPtyHost() {
  return new NodePtyHost();
}

function createTerminalDatabase(db: Database): TerminalDatabase {
  return {
    insert: (terminal) => {
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
        "terminal_id",
        "state",
        "started_at",
        "ended_at",
        "completion_percent",
        "error_reason",
        "last_active_at",
        "title",
      ]);

      const setClauses: string[] = [];
      const values: unknown[] = [];
      for (const key of keys) {
        const col = key.replace(/([A-Z])/g, "_$1").toLowerCase();
        if (!allowedCols.has(col)) continue;
        setClauses.push(`${col} = ?`);
        values.push(patch[key]);
      }
      if (setClauses.length === 0) return;

      db.prepare(`UPDATE sessions SET ${setClauses.join(", ")} WHERE id = ?`).run(
        ...(values as Array<string | number | bigint | Uint8Array | null>),
        id
      );
    },
    findById: (id: string) => {
      const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
        | SessionRow
        | undefined;
      return row ? rowToSession(row) : undefined;
    },
    findByWorkspaceId: (workspaceId: string) => {
      const rows = db
        .prepare("SELECT * FROM sessions WHERE workspace_id = ? ORDER BY started_at DESC")
        .all(workspaceId) as unknown as SessionRow[];
      return rows.map(rowToSession);
    },
    listHydratable: () => {
      const rows = db
        .prepare(
          "SELECT * FROM sessions WHERE archived = 0 AND ended_at IS NULL ORDER BY started_at DESC"
        )
        .all() as unknown as SessionRow[];
      return rows.map(rowToSession);
    },
    delete: (id: string) => {
      db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    },
  };
}

if (isDirectExecution(import.meta.url)) {
  const server = await createServer();

  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nShutting down...");
    await server.stop();
    process.exit(0);
  });
}
