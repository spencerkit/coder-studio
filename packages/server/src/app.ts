/**
 * Fastify App Assembly
 *
 * Builds the Fastify application with all routes and middleware
 */

import { dirname, join, resolve } from "node:path";
import compress from "@fastify/compress";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import websocket, { type WebSocket } from "@fastify/websocket";
import type { FastifyRequest } from "fastify";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import {
  createAuthGuard,
  registerAuthLogoutRoute,
  registerAuthRoutes,
  registerAuthStatusRoute,
} from "./auth/index.js";
import type { ServerConfig } from "./config.js";
import { registerAppearanceAssetsRoutes } from "./routes/appearance-assets.js";
import { registerFileAssetRoutes } from "./routes/file-asset.js";
import { registerUploadsRoute } from "./routes/uploads.js";
import {
  AppearanceAssetRepo,
  type AppearanceAssetRepo as AppearanceAssetRepoType,
} from "./storage/repositories/appearance-asset-repo.js";
import type { AuthLoginBlockRepo } from "./storage/repositories/auth-login-block-repo.js";
import type { AuthSessionRepo } from "./storage/repositories/auth-session-repo.js";
import { MAX_FILE_BYTES, MAX_FILES_PER_BATCH } from "./uploads/constants.js";
import { isFrontendNavigationRequest } from "./web-ui-routing.js";
import type { WorkspaceManager } from "./workspace/manager.js";
import type { WsHub } from "./ws/hub.js";

interface AppDeps {
  wsHub: WsHub;
  webRoot?: string;
  workspaceMgr: WorkspaceManager;
  config: ServerConfig;
  authSessionRepo: AuthSessionRepo;
  authLoginBlockRepo: AuthLoginBlockRepo;
  appearanceAssetRepo?: AppearanceAssetRepoType;
  logger?: FastifyServerOptions["logger"];
}

/**
 * Build Fastify application
 */
export async function buildFastifyApp(deps: AppDeps): Promise<FastifyInstance> {
  const stateRoot =
    deps.config.dataDir === ":memory:"
      ? resolve(deps.config.uploadsDir, "..")
      : dirname(deps.config.dataDir);
  const appearanceAssetRepo =
    deps.appearanceAssetRepo ??
    new AppearanceAssetRepo({
      filePath: join(stateRoot, "state", "appearance-assets.json"),
    });

  const app = Fastify({
    logger: deps.logger ?? {
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
    fastify.get("/ws", { websocket: true }, (connection: WebSocket, req: FastifyRequest) => {
      deps.wsHub.handleConnection(connection, req);
    });
  });

  // Phase 2: Configurable auth middleware
  app.addHook(
    "onRequest",
    createAuthGuard({
      config: deps.config,
      authSessionRepo: deps.authSessionRepo,
      authLoginBlockRepo: deps.authLoginBlockRepo,
    })
  );

  await app.register(compress);

  await app.register(multipart, {
    limits: {
      fileSize: MAX_FILE_BYTES,
      files: MAX_FILES_PER_BATCH,
    },
    isPartAFile: (fieldName, contentType, fileName) =>
      fieldName === "files" || contentType === "application/octet-stream" || fileName !== undefined,
  });

  // CORS configuration (development mode)
  await app.register(cors, {
    origin: true, // Allow all origins in development
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  });

  // Auth endpoints
  app.get(
    "/auth/status",
    registerAuthStatusRoute({
      config: deps.config,
      authSessionRepo: deps.authSessionRepo,
      authLoginBlockRepo: deps.authLoginBlockRepo,
    })
  );
  app.post(
    "/auth/login",
    registerAuthRoutes({
      config: deps.config,
      authSessionRepo: deps.authSessionRepo,
      authLoginBlockRepo: deps.authLoginBlockRepo,
    })
  );
  app.post(
    "/auth/logout",
    registerAuthLogoutRoute({
      config: deps.config,
      authSessionRepo: deps.authSessionRepo,
      authLoginBlockRepo: deps.authLoginBlockRepo,
    })
  );

  // Health check endpoint
  app.get("/healthz", async () => {
    return { ok: true };
  });

  // /api/file — binary streaming endpoint used by the editor's image preview.
  // Auth is inherited from the global onRequest cookie guard above, so this
  // only needs its own path-safety and allowlist checks.
  registerFileAssetRoutes(app, {
    workspaceMgr: deps.workspaceMgr,
  });

  registerAppearanceAssetsRoutes(app, {
    uploadsDir: deps.config.uploadsDir,
    repo: appearanceAssetRepo,
  });

  registerUploadsRoute(app, {
    uploadsDir: deps.config.uploadsDir,
    workspaceMgr: deps.workspaceMgr,
  });

  // Static file serving (for web UI)
  if (deps.webRoot) {
    app.register(staticPlugin, {
      root: deps.webRoot,
      prefix: "/",
      wildcard: false,
      globIgnore: ["index.html", "assets/**"],
      maxAge: "1y",
      immutable: true,
    });

    app.register(staticPlugin, {
      root: `${deps.webRoot}/assets`,
      prefix: "/assets/",
      maxAge: "1y",
      immutable: true,
      wildcard: true,
      decorateReply: false,
    });

    app.get("/", async (_request, reply) => {
      return reply.sendFile("index.html", {
        maxAge: 0,
        immutable: false,
      });
    });

    app.get("/index.html", async (_request, reply) => {
      return reply.sendFile("index.html", {
        maxAge: 0,
        immutable: false,
      });
    });

    app.get("/*", async (request, reply) => {
      if (!isFrontendNavigationRequest(request)) {
        return reply.callNotFound();
      }
      return reply.sendFile("index.html", {
        maxAge: 0,
        immutable: false,
      });
    });
  }

  return app;
}
