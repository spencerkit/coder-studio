/**
 * Development script for server package
 * Starts tsx watch for backend
 */

import {
  buildDevServerEnv,
  CLI_DIR,
  ensureWslRuntimeEntryBuilt,
  error,
  info,
  log,
  ROOT_DIR,
  SERVER_DIR,
  success,
} from "./shared/index.js";
import { isDirectExecution, runBackground } from "./shared/process.js";

const SERVER_PORT = 4173;
const SERVER_HOST = "127.0.0.1";

async function devServer(): Promise<void> {
  info("Ensuring WSL runtime entry is built...");
  await ensureWslRuntimeEntryBuilt();

  info("Starting tsx watch for backend...");

  const serverEnv = buildDevServerEnv({
    rootDir: ROOT_DIR,
    cliDir: CLI_DIR,
    env: {
      ...process.env,
      NODE_ENV: "development",
      HOST: SERVER_HOST,
      PORT: String(SERVER_PORT),
    },
  });

  const serverProcess = runBackground("pnpm", ["tsx", "watch", "src/server.ts"], {
    cwd: SERVER_DIR,
    stdio: "inherit",
    env: serverEnv,
  });

  serverProcess.on("error", (err) => {
    error(`Server process failed: ${err.message}`);
    process.exit(1);
  });

  serverProcess.on("close", (code, signal) => {
    const exitCode = typeof code === "number" ? code : signal ? 1 : 0;
    if (exitCode !== 0) {
      error(
        `Server process exited with ${typeof code === "number" ? `code ${code}` : `signal ${signal}`}`
      );
    }
    process.exit(exitCode);
  });

  success(`Backend dev server running at http://${SERVER_HOST}:${SERVER_PORT}`);

  // Handle process termination
  process.on("SIGINT", () => {
    info("\nStopping backend dev server...");
    serverProcess.kill("SIGTERM");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    serverProcess.kill("SIGTERM");
    process.exit(0);
  });
}

// Run if called directly
if (isDirectExecution(import.meta.url)) {
  devServer().catch((err) => {
    error(err.message);
    process.exit(1);
  });
}

export { devServer };
