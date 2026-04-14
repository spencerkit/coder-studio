/**
 * Fastify App Assembly
 *
 * Builds the Fastify application with all routes and middleware
 */

import Fastify, { type FastifyInstance } from 'fastify';
import websocket, { type WebSocket } from '@fastify/websocket';
import staticPlugin from '@fastify/static';
import cors from '@fastify/cors';
import type { WsHub } from './ws/hub.js';
import type { Database } from 'better-sqlite3';
import type { HooksManager } from './hooks/manager.js';
import type { CommandContext } from './ws/dispatch.js';
import type { FastifyRequest } from 'fastify';

interface AppDeps {
  wsHub: WsHub;
  db: Database;
  hooksMgr: HooksManager;
  webRoot?: string;
  commandContext: CommandContext;
  logger?: any;
}

/**
 * Build Fastify application
 */
export async function buildFastifyApp(deps: AppDeps): Promise<FastifyInstance> {
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

  // WebSocket plugin - routes must be registered within this scope
  await app.register(async function (fastify) {
    await fastify.register(websocket);

    // WebSocket endpoint - connection is the WebSocket directly in v11+
    fastify.get('/ws', { websocket: true }, (connection: WebSocket, req: FastifyRequest) => {
      deps.wsHub.handleConnection(connection, req);
    });
  });

  // Phase 1: Auth middleware is empty passthrough
  app.addHook('onRequest', async (request, reply) => {
    // Phase 2: Implement auth here
    // For now, just pass through
  });

  // CORS configuration (development mode)
  await app.register(cors, {
    origin: true, // Allow all origins in development
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Health check endpoint
  app.get('/healthz', async (request, reply) => {
    return { ok: true };
  });

  // Internal hooks endpoint (for bridge scripts)
  app.post('/internal/hooks/:event', async (request, reply) => {
    const event = request.params.event;
    const payload = request.body;

    try {
      // Delegate to hooks manager
      deps.hooksMgr.handleHookEvent(event, payload);
      return { ok: true };
    } catch (error) {
      request.log.error({ error, event }, 'Failed to handle hook event');
      return reply.status(500).send({
        ok: false,
        error: 'Failed to handle hook event',
      });
    }
  });

  // Static file serving (for web UI)
  if (deps.webRoot) {
    app.register(staticPlugin, {
      root: deps.webRoot,
      prefix: '/',
    });
  }

  return app;
}
