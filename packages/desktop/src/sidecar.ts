import { acquireStateLock, createServer, type Server } from "@coder-studio/server";
import { DESKTOP_READY_PREFIX, DESKTOP_SHUTDOWN_MESSAGE } from "./protocol.js";

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required desktop sidecar environment variable: ${name}`);
  }
  return value;
}

function readPort(): number {
  const raw = process.env.CODER_STUDIO_DESKTOP_PORT?.trim() || "0";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid desktop sidecar port: ${raw}`);
  }
  return port;
}

function extractListenPort(server: Server): number {
  const address = server.app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Desktop sidecar did not expose a TCP listen address");
  }
  return address.port;
}

async function run(): Promise<void> {
  const host = "127.0.0.1";
  const secret = readRequiredEnv("CODER_STUDIO_DESKTOP_SECRET");
  const stateDir = readRequiredEnv("CODER_STUDIO_DESKTOP_STATE_DIR");
  const uploadsDir = readRequiredEnv("CODER_STUDIO_DESKTOP_UPLOADS_DIR");
  const webRoot = process.env.CODER_STUDIO_DESKTOP_WEB_ROOT?.trim() || undefined;
  const appVersion = process.env.CODER_STUDIO_DESKTOP_APP_VERSION?.trim() || "0.0.0";

  const stateLock = acquireStateLock(stateDir);
  let server: Server;
  try {
    server = await createServer({
      host,
      port: readPort(),
      stateDir,
      uploadsDir,
      webRoot,
      appVersion,
      auth: {
        enabled: true,
        password: secret,
      },
      update: {
        supported: false,
        installKind: "unsupported",
        runtimeContext: {
          environment: "desktop-managed",
          authority: "desktop",
          supported: true,
          unsupportedReason: null,
        },
        packageName: "@spencer-kit/coder-studio",
        cliCommand: "coder-studio",
        npmCommand: "npm",
        registryUrl: "https://registry.npmjs.org/",
        distTag: "latest",
        restartArgs: ["serve", "--restart"],
        installArgsPrefix: ["install", "-g"],
        unsupportedReason:
          "Desktop builds update from the Help > Check for Updates menu, not through npm.",
      },
      writeRuntimeConfig: false,
    });
  } catch (error) {
    stateLock.release();
    throw error;
  }

  const port = extractListenPort(server);
  process.stdout.write(
    `${DESKTOP_READY_PREFIX}${JSON.stringify({ type: "ready", host, port, pid: process.pid })}\n`
  );

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await server.stop();
    } finally {
      stateLock.release();
    }
    process.exit(0);
  };

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    if (chunk.split(/\r?\n/).some((line) => line.trim() === DESKTOP_SHUTDOWN_MESSAGE)) {
      void stop();
    }
  });
  process.stdin.on("end", () => void stop());
  process.stdin.resume();

  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

run().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`[desktop-sidecar] ${message}\n`);
  process.exit(1);
});
