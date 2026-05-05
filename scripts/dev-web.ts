/**
 * Development script for web package
 * Starts Vite dev server for frontend
 */

import { resolve } from "path";
import { error, info, log, success, WEB_DIR } from "./shared/index.js";
import { runBackground } from "./shared/process.js";

const VITE_PORT = 5173;
const VITE_HOST = "localhost";

async function devWeb(): Promise<void> {
  info("Starting Vite dev server for frontend...");

  const viteProcess = runBackground("pnpm", ["vite"], {
    cwd: WEB_DIR,
    stdio: "inherit",
  });

  viteProcess.on("error", (err) => {
    error(`Vite dev server failed: ${err.message}`);
    process.exit(1);
  });

  success(`Frontend dev server running at http://${VITE_HOST}:${VITE_PORT}`);

  // Handle process termination
  process.on("SIGINT", () => {
    info("\nStopping frontend dev server...");
    viteProcess.kill("SIGTERM");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    viteProcess.kill("SIGTERM");
    process.exit(0);
  });
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  devWeb().catch((err) => {
    error(err.message);
    process.exit(1);
  });
}

export { devWeb };
