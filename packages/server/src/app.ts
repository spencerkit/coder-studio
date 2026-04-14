/**
 * Fastify App Assembly
 *
 * Builds the Fastify application with all routes and middleware
 */

import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import staticPlugin from '@fastify/static';
import path from 'path';
import type { WsHub } from './ws/hub.js';
import type { Database } from './storage/db.js';
import { dispatch, type CommandContext } from './ws/dispatch.js';

interface AppDeps {
  wsHub: WsHub;
  db: Database;
  webRoot?: string;
  commandContext: CommandContext;
  logger?: any;
}

/**
 * Build Fastify application
 */
export function buildFastifyApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.logger || {
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

  // Phase 1: Auth middleware is empty passthrough
  app.addHook('onRequest', async (request, reply) => {
    // Phase 2: Implement auth here
    // For now, just pass through
  });

  // WebSocket endpoint
  app.register(websocket);

  app.get('/ws', { websocket: true }, (connection, req) => {
    deps.wsHub.handleConnection(connection.socket, req);
  });

  // Health check endpoint
  app.get('/healthz', async (request, reply) => {
    return { ok: true };
  });

  // Static file serving (for web UI)
  if (deps.webRoot) {
    app.register(staticPlugin, {
      root: deps.webRoot,
      prefix: '/',
    });
  }

  // WebSocket message handling
  app.decorate('handleCommand', async (msg: any) => {
    return dispatch(msg, deps.commandContext);
  });

  return app;
}
