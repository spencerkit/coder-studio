import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createServer,
  type DesktopUpdateAdapter,
  type DesktopUpdateCheckForUpdatesResult,
  normalizeDesktopUpdateStatePatch,
  type Server,
  type ServerConfigInput,
} from "@coder-studio/server";
import { buildWslRuntimeSource } from "./wsl-runtime-source.js";

export interface DesktopRuntimeEnv {
  host?: string;
  port: number;
  stateDir?: string;
  runtimeJsonPath?: string;
  password?: string;
  appVersion?: string;
  runtimeVersion?: string;
  webRoot?: string;
}

interface RuntimePackageManifest {
  version?: string;
}

const MISSING_WEB_ASSETS_WARNING =
  "Warning: Desktop web assets not found. Frontend will not be available.";
const DESKTOP_UPDATE_REQUEST_TIMEOUT_MS = 15_000;

function resolveDesktopRuntimePackageRoot(importMetaUrl: string): string {
  const currentDir = dirname(fileURLToPath(importMetaUrl));
  return resolve(currentDir, "../..");
}

export function parseDesktopRuntimeEnv(env: NodeJS.ProcessEnv): DesktopRuntimeEnv {
  return {
    ...(env.CODER_STUDIO_DESKTOP_HOST?.trim()
      ? { host: env.CODER_STUDIO_DESKTOP_HOST.trim() }
      : {}),
    port: env.CODER_STUDIO_DESKTOP_PORT ? Number(env.CODER_STUDIO_DESKTOP_PORT) : 0,
    ...(env.CODER_STUDIO_DESKTOP_STATE_DIR ? { stateDir: env.CODER_STUDIO_DESKTOP_STATE_DIR } : {}),
    ...(env.CODER_STUDIO_DESKTOP_RUNTIME_JSON_PATH
      ? { runtimeJsonPath: env.CODER_STUDIO_DESKTOP_RUNTIME_JSON_PATH }
      : {}),
    ...(env.CODER_STUDIO_DESKTOP_PASSWORD ? { password: env.CODER_STUDIO_DESKTOP_PASSWORD } : {}),
    ...(env.CODER_STUDIO_DESKTOP_APP_VERSION
      ? { appVersion: env.CODER_STUDIO_DESKTOP_APP_VERSION }
      : {}),
    ...(env.CODER_STUDIO_DESKTOP_RUNTIME_VERSION
      ? { runtimeVersion: env.CODER_STUDIO_DESKTOP_RUNTIME_VERSION }
      : {}),
    ...(env.CODER_STUDIO_DESKTOP_WEB_ROOT ? { webRoot: env.CODER_STUDIO_DESKTOP_WEB_ROOT } : {}),
  };
}

function readDesktopRuntimeVersion(importMetaUrl: string): string {
  const currentDir = dirname(fileURLToPath(importMetaUrl));
  const candidates = [
    resolve(currentDir, "../../package.json"),
    resolve(currentDir, "../../cli/package.json"),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    try {
      const manifest = JSON.parse(readFileSync(candidate, "utf-8")) as RuntimePackageManifest;
      if (typeof manifest.version === "string" && manifest.version.trim().length > 0) {
        return manifest.version.trim();
      }
    } catch {
      continue;
    }
  }

  return "0.0.0";
}

function resolveDefaultWebRoot(importMetaUrl: string): string | undefined {
  const currentDir = dirname(fileURLToPath(importMetaUrl));
  const candidates = [
    resolve(currentDir, "../web"),
    resolve(currentDir, "../../web"),
    resolve(currentDir, "../../cli/dist/web"),
    resolve(currentDir, "../../web/dist"),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

export function buildDesktopRuntimeServerConfig(
  env: NodeJS.ProcessEnv,
  importMetaUrl: string
): {
  serverConfig: ServerConfigInput;
  runtimeJsonPath?: string;
  writeRuntimeConfig: true;
} {
  const parsed = parseDesktopRuntimeEnv(env);
  const runtimeVersion = parsed.runtimeVersion ?? readDesktopRuntimeVersion(importMetaUrl);
  const webRoot = parsed.webRoot ?? resolveDefaultWebRoot(importMetaUrl);

  const serverConfig: ServerConfigInput = {
    port: parsed.port,
    appVersion: parsed.appVersion ?? runtimeVersion,
    runtimeVersion,
    wslRuntime: {
      enabled: true,
      source: buildWslRuntimeSource({
        runtimeVersion,
        packageRoot: resolveDesktopRuntimePackageRoot(importMetaUrl),
        entryRelativePath: "dist/esm/wsl-runtime-entry.mjs",
      }),
    },
    update: {
      supported: true,
      installKind: "desktop_managed",
      packageName: "@spencer-kit/coder-studio",
      cliCommand: "coder-studio",
      npmCommand: "npm",
      restartArgs: [],
      installArgsPrefix: [],
      unsupportedReason: null,
    },
    ...(parsed.host ? { host: parsed.host } : {}),
    ...(parsed.stateDir ? { stateDir: parsed.stateDir } : {}),
    ...(parsed.password ? { auth: { enabled: true, password: parsed.password } } : {}),
    ...(webRoot ? { webRoot } : {}),
  };

  if (!webRoot) {
    console.warn(MISSING_WEB_ASSETS_WARNING);
  }

  return {
    serverConfig,
    ...(parsed.runtimeJsonPath ? { runtimeJsonPath: parsed.runtimeJsonPath } : {}),
    writeRuntimeConfig: true,
  };
}

function createDesktopUpdateAdapter(): DesktopUpdateAdapter | undefined {
  if (typeof process.send !== "function") {
    return undefined;
  }

  let applyPatch: ((patch: Record<string, unknown>) => void) | null = null;
  let nextRequestId = 0;
  const pendingUpdateChecks = new Map<
    string,
    {
      resolve: (result: DesktopUpdateCheckForUpdatesResult) => void;
      reject: (error: Error) => void;
      timeoutHandle: NodeJS.Timeout;
    }
  >();

  process.on("message", (message: unknown) => {
    if (
      typeof message !== "object" ||
      message === null ||
      !("kind" in message) ||
      !("action" in message) ||
      !("payload" in message)
    ) {
      return;
    }

    const typed = message as {
      kind?: unknown;
      action?: unknown;
      payload?: unknown;
    };
    if (typed.kind !== "desktop-update") {
      return;
    }

    if (typed.action === "apply-state-patch") {
      try {
        applyPatch?.(normalizeDesktopUpdateStatePatch(typed.payload));
      } catch (error) {
        console.warn(
          "Ignoring invalid desktop update state patch:",
          error instanceof Error ? error.message : String(error)
        );
      }
      return;
    }

    if (
      typed.action === "check-for-updates-result" &&
      typeof typed.payload === "object" &&
      typed.payload
    ) {
      const payload = typed.payload as {
        requestId?: unknown;
        latestVersion?: unknown;
        errorSummary?: unknown;
      };
      if (typeof payload.requestId !== "string") {
        return;
      }

      const pending = pendingUpdateChecks.get(payload.requestId);
      if (!pending) {
        return;
      }

      pendingUpdateChecks.delete(payload.requestId);
      clearTimeout(pending.timeoutHandle);
      if (typeof payload.errorSummary === "string" && payload.errorSummary.trim().length > 0) {
        pending.reject(new Error(payload.errorSummary.trim()));
        return;
      }

      pending.resolve({
        latestVersion:
          typeof payload.latestVersion === "string" && payload.latestVersion.trim().length > 0
            ? payload.latestVersion.trim()
            : null,
      });
    }
  });

  return {
    async startInstall(input) {
      process.send?.({
        kind: "desktop-update",
        action: "start-install",
        payload: input,
      });
    },
    async checkForUpdates(input) {
      const requestId = `desktop-update-check-${nextRequestId++}`;
      return await new Promise<DesktopUpdateCheckForUpdatesResult>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          pendingUpdateChecks.delete(requestId);
          reject(
            new Error(`Desktop update check timed out after ${DESKTOP_UPDATE_REQUEST_TIMEOUT_MS}ms`)
          );
        }, DESKTOP_UPDATE_REQUEST_TIMEOUT_MS);
        timeoutHandle.unref?.();

        pendingUpdateChecks.set(requestId, {
          resolve,
          reject,
          timeoutHandle,
        });

        process.send?.({
          kind: "desktop-update",
          action: "check-for-updates",
          payload: {
            requestId,
            ...input,
          },
        });
      });
    },
    bindStateController(controller) {
      applyPatch = (patch) => {
        controller.applyPatch(patch);
      };
    },
  };
}

const createShutdownHandler = (server: Server) => async () => {
  await server.stop();
  process.exit(0);
};

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<Server> {
  const options = buildDesktopRuntimeServerConfig(env, import.meta.url);
  const server = await createServer({
    ...options,
    desktopUpdateAdapter: createDesktopUpdateAdapter(),
  });
  const shutdown = createShutdownHandler(server);

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Desktop runtime error:", message);
    process.exit(1);
  });
}
