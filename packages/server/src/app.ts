/**
 * Fastify App Assembly
 *
 * Builds the Fastify application with all routes and middleware
 */

import Fastify, { type FastifyInstance } from 'fastify';
import websocket, { type WebSocket } from '@fastify/websocket';
import staticPlugin from '@fastify/static';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import type { WsHub } from './ws/hub.js';
import type { HooksManager } from './hooks/manager.js';
import type { WorkspaceManager } from './workspace/manager.js';
import type { FastifyRequest } from 'fastify';
import type { ServerConfig } from './config.js';
import {
  createAuthGuard,
  registerAuthLogoutRoute,
  registerAuthRoutes,
  registerAuthStatusRoute,
} from './auth/index.js';
import { registerHooksEndpoint } from './hooks/endpoint.js';
import { registerFileAssetRoutes } from './routes/file-asset.js';
import type { RuntimeConfig } from './hooks/runtime-json.js';
import type { AuthSessionRepo } from './storage/repositories/auth-session-repo.js';
import type { Database } from './storage/database.js';

interface AppDeps {
  wsHub: WsHub;
  db: Database;
  hooksMgr: HooksManager;
  webRoot?: string;
  workspaceMgr: WorkspaceManager;
  config: ServerConfig;
  runtime: RuntimeConfig;
  authSessionRepo: AuthSessionRepo;
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
    await fastify.register(websocket, {
      options: {
        // permessage-deflate: terminal ANSI streams (repeated escape codes,
        // whitespace, color sequences) typically compress 5-10x. Cross-message
        // context takeover is left enabled (default) so the zlib dictionary
        // persists across frames for highest ratio on continuous streams.
        perMessageDeflate: {
          threshold: 1024,
          zlibDeflateOptions: { level: 6 },
        },
      },
    });

    // WebSocket endpoint - connection is the WebSocket directly in v11+
    fastify.get('/ws', { websocket: true }, (connection: WebSocket, req: FastifyRequest) => {
      deps.wsHub.handleConnection(connection, req);
    });
  });

  // Phase 2: Configurable auth middleware
  app.addHook('onRequest', createAuthGuard({
    config: deps.config,
    authSessionRepo: deps.authSessionRepo,
  }));

  await app.register(compress);

  // CORS configuration (development mode)
  await app.register(cors, {
    origin: true, // Allow all origins in development
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Auth endpoints
  app.get('/auth/status', registerAuthStatusRoute({
    config: deps.config,
    authSessionRepo: deps.authSessionRepo,
  }));
  app.post('/auth/login', registerAuthRoutes({
    config: deps.config,
    authSessionRepo: deps.authSessionRepo,
  }));
  app.post('/auth/logout', registerAuthLogoutRoute({
    config: deps.config,
    authSessionRepo: deps.authSessionRepo,
  }));

  // Health check endpoint
  app.get('/healthz', async () => {
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

  // /api/file — binary streaming endpoint used by the editor's image preview.
  // Auth is inherited from the global onRequest cookie guard above, so this
  // only needs its own path-safety and allowlist checks.
  registerFileAssetRoutes(app, {
    workspaceMgr: deps.workspaceMgr,
  });

  // Static file serving (for web UI)
  if (deps.webRoot) {
    app.register(staticPlugin, {
      root: deps.webRoot,
      prefix: '/',
      globIgnore: ['index.html'],
      maxAge: '1y',
      immutable: true,
      wildcard: false,
    });

    app.get('/', async (_request, reply) => {
      return reply.sendFile('index.html', {
        maxAge: 0,
        immutable: false,
      });
    });

    app.get('/*', async (request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/auth/') || request.url.startsWith('/internal/')) {
        return reply.callNotFound();
      }
      return reply.sendFile('index.html', {
        maxAge: 0,
        immutable: false,
      });
    });
  }

  return app;
}
