/**
 * Development script - parallel web + server
 * Runs both frontend and backend dev servers concurrently
 */

import {
  buildDevServerEnv,
  CLI_DIR,
  error,
  info,
  log,
  ROOT_DIR,
  SERVER_DIR,
  step,
  success,
  WEB_DIR,
} from "./shared/index.js";
import { isDirectExecution, runBackground, waitForProcesses } from "./shared/process.js";

const VITE_PORT = 5173;
const VITE_HOST = "localhost";
const SERVER_PORT = 4173;
const SERVER_HOST = "127.0.0.1";

async function dev(): Promise<void> {
  step("DEV", "Starting parallel development servers...\n");

  info("Starting frontend (Vite dev server)...");
  const viteProcess = runBackground("pnpm", ["vite"], {
    cwd: WEB_DIR,
    stdio: "inherit",
  });

  info("Starting backend (tsx watch)...");
  const serverProcess = runBackground("pnpm", ["tsx", "watch", "src/main.ts"], {
    cwd: SERVER_DIR,
    stdio: "inherit",
    env: buildDevServerEnv({
      rootDir: ROOT_DIR,
      cliDir: CLI_DIR,
      env: {
        ...process.env,
        NODE_ENV: "development",
        HOST: SERVER_HOST,
        PORT: String(SERVER_PORT),
      },
    }),
  });

  const processes = [viteProcess, serverProcess];

  // Handle errors
  processes.forEach((p) => {
    p.on("error", (err) => {
      error(`Process error: ${err.message}`);
      processes.forEach((proc) => proc.kill("SIGTERM"));
      process.exit(1);
    });
  });

  // Wait a bit for servers to start
  setTimeout(() => {
    success("\n✓ Development environment ready:");
    log(`  Frontend: http://${VITE_HOST}:${VITE_PORT}`);
    log(`  Backend:  http://${SERVER_HOST}:${SERVER_PORT}`);
    log("\n  Press Ctrl+C to stop both servers...\n");
  }, 2000);

  // Handle termination signals
  const cleanup = () => {
    info("\nStopping development servers...");
    processes.forEach((p) => p.kill("SIGTERM"));
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Wait for processes
  await waitForProcesses(processes);
}

// Run if called directly
if (isDirectExecution(import.meta.url)) {
  dev().catch((err) => {
    error(err.message);
    process.exit(1);
  });
}

export { dev };
