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
import type { ServerConfig } from './config.js';
import { createAuthGuard, registerAuthRoutes, registerAuthStatusRoute } from './auth/index.js';
import { registerHooksEndpoint } from './hooks/endpoint.js';
import type { RuntimeConfig } from './hooks/runtime-json.js';

interface AppDeps {
  wsHub: WsHub;
  db: Database;
  hooksMgr: HooksManager;
  webRoot?: string;
  commandContext: CommandContext;
  config: ServerConfig;
  runtime: RuntimeConfig;
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

  // Phase 2: Configurable auth middleware
  app.addHook('onRequest', createAuthGuard(deps.config));

  // CORS configuration (development mode)
  await app.register(cors, {
    origin: true, // Allow all origins in development
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Auth endpoints
  app.get('/auth/status', registerAuthStatusRoute(deps.config));
  app.post('/auth/login', registerAuthRoutes(deps.config));

  // Health check endpoint
  app.get('/healthz', async (request, reply) => {
    return { ok: true };
  });

  // Internal hooks endpoint (for bridge scripts). Enforces:
  // - localhost-only origin
  // - per-process token from runtime.json
  // Auth cookie is skipped for this path (see `auth/plugin.ts::isPublicPath`)
  // because bridge scripts don't and can't carry cookies.
  registerHooksEndpoint(app, deps.runtime, (event, payload, ctx) => {
    deps.hooksMgr.handleHookEvent(event, payload, {
      coderStudioSessionId: ctx.coderStudioSessionId,
    });
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
