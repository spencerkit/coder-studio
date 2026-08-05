import { buildDesktopShell, DESKTOP_DIR } from "./build-desktop.js";
import {
  error,
  info,
  log,
  ROOT_DIR,
  runBackground,
  step,
  success,
  WEB_DIR,
  waitForProcesses,
} from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

export async function devDesktop(): Promise<void> {
  step("DEV DESKTOP", "Starting Vite, Electron, and the managed backend...\n");
  await buildDesktopShell({ clean: true });

  const vite = runBackground("pnpm", ["vite"], {
    cwd: WEB_DIR,
    stdio: "inherit",
  });
  const electron = runBackground("pnpm", ["exec", "electron", "."], {
    cwd: DESKTOP_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      CODER_STUDIO_DESKTOP_DEV_URL: "http://127.0.0.1:5173",
      CODER_STUDIO_DESKTOP_NODE_PATH: process.execPath,
      CODER_STUDIO_DESKTOP_REPO_ROOT: ROOT_DIR,
      CODER_STUDIO_DESKTOP_PORT: "4173",
      CODER_STUDIO_DESKTOP_REUSE_SERVER: "false",
    },
  });
  const children = [vite, electron];

  const cleanup = () => {
    for (const child of children) {
      if (!child.killed) child.kill("SIGTERM");
    }
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  success("Desktop development processes started");
  info("UI: http://127.0.0.1:5173");
  log("Press Ctrl+C to stop.\n");
  await waitForProcesses(children);
}

if (isDirectExecution(import.meta.url)) {
  devDesktop().catch((devError) => {
    error(devError instanceof Error ? devError.message : String(devError));
    process.exit(1);
  });
}
