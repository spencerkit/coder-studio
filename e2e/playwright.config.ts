import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const HOST = "127.0.0.1";
const ownsPhase1Sandbox = !process.env.CODER_STUDIO_PHASE1_SANDBOX_DIR;
const sandboxDir =
  process.env.CODER_STUDIO_PHASE1_SANDBOX_DIR ??
  mkdtempSync(join(tmpdir(), "coder-studio-phase1-acceptance-"));
const dataDir = process.env.CODER_STUDIO_PHASE1_DATA_DIR ?? join(sandboxDir, "coder-studio.db");
const runtimeDir = process.env.CODER_STUDIO_PHASE1_RUNTIME_DIR ?? join(sandboxDir, "runtime");

async function reservePort(host: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to reserve an ephemeral port for Playwright"));
        return;
      }

      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

const SERVER_PORT = process.env.CODER_STUDIO_PHASE1_SERVER_PORT
  ? Number(process.env.CODER_STUDIO_PHASE1_SERVER_PORT)
  : await reservePort(HOST);
const WEB_PORT = process.env.CODER_STUDIO_PHASE1_WEB_PORT
  ? Number(process.env.CODER_STUDIO_PHASE1_WEB_PORT)
  : await reservePort(HOST);
const BACKEND_HTTP_URL = `http://${HOST}:${SERVER_PORT}`;
const BASE_URL = `http://${HOST}:${WEB_PORT}`;

if (ownsPhase1Sandbox) {
  mkdirSync(runtimeDir, { recursive: true });
  process.env.CODER_STUDIO_PHASE1_SANDBOX_DIR = sandboxDir;
  process.env.CODER_STUDIO_PHASE1_DATA_DIR = dataDir;
  process.env.CODER_STUDIO_PHASE1_RUNTIME_DIR = runtimeDir;
  process.env.CODER_STUDIO_PHASE1_SERVER_PORT = String(SERVER_PORT);
  process.env.CODER_STUDIO_PHASE1_WEB_PORT = String(WEB_PORT);

  process.on("exit", () => {
    rmSync(sandboxDir, { recursive: true, force: true });
  });
}

export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  workers: process.env.PLAYWRIGHT_WORKERS ? Number(process.env.PLAYWRIGHT_WORKERS) : 1,
  retries: 0,
  timeout: 60000,
  reporter: [["list"]],
  webServer: [
    {
      command: "pnpm exec tsx packages/server/src/server.ts",
      cwd: "..",
      url: `${BACKEND_HTTP_URL}/healthz`,
      reuseExistingServer: false,
      timeout: 30000,
      env: {
        ...process.env,
        HOST,
        PORT: String(SERVER_PORT),
        DATA_DIR: dataDir,
        RUNTIME_DIR: runtimeDir,
        NO_AUTH: "true",
      },
    },
    {
      command: `pnpm exec vite --host ${HOST} --port ${WEB_PORT}`,
      cwd: "../packages/web",
      url: `${BASE_URL}/`,
      reuseExistingServer: false,
      timeout: 30000,
      env: {
        ...process.env,
        // Playwright may inherit NODE_ENV=production from the outer shell,
        // which breaks the Vite React refresh transform at runtime.
        NODE_ENV: "development",
        VITE_BACKEND_HTTP_URL: BACKEND_HTTP_URL,
        VITE_BACKEND_WS_URL: `ws://${HOST}:${SERVER_PORT}/ws`,
      },
    },
  ],
  use: {
    baseURL: BASE_URL,
    trace: "off",
    screenshot: "on",
    video: "off",
    viewport: { width: 1280, height: 800 },
  },
  outputDir: "./test-results",
});
