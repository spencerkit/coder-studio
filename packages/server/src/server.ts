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
import { parseServerConfig, type ServerConfig } from './config.js';
import { CommandContext } from './ws/dispatch.js';

// Import command handlers to register them
import './commands/workspace.js';
import './commands/session.js';
import './commands/file.js';
import './commands/git.js';
import './commands/terminal.js';

export interface Server {
  app: FastifyInstance;
  stop: () => Promise<void>;
}

/**
 * Create and start server
 */
export async function createServer(
  configOverrides?: Partial<ServerConfig>
): Promise<Server> {
  const config = parseServerConfig(configOverrides);

  // Infrastructure: Database
  const db = openDatabase(config.dataDir);
  runMigrations(db);

  // Collaboration infrastructure: Event Bus + WebSocket Hub
  const eventBus = new EventBus();
  const wsHub = new WsHub({ eventBus });

  // Command context (will add managers as we implement them)
  const commandContext: CommandContext = {
    db,
    // workspaceMgr: ...,
    // sessionMgr: ...,
    // terminalMgr: ...,
    // hooksMgr: ...,
  };

  // Transport: Fastify app
  const app = buildFastifyApp({
    wsHub,
    db,
    commandContext,
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
      wsHub.destroy();
      eventBus.clear();
      db.close();
    },
  };
}

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