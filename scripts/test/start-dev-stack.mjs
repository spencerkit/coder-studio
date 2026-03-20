import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PNPM_CMD = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const server = spawn(PNPM_CMD, ['dev:server'], {
  cwd: ROOT,
  stdio: 'inherit',
  windowsHide: true
});
let frontend = null;

let shuttingDown = false;

const killChild = (child) => {
  if (!child || child.killed) return;
  try {
    child.kill('SIGTERM');
  } catch {
    // Ignore already stopped child processes.
  }
};

const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  killChild(server);
  killChild(frontend);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.on('exit', (code) => {
  if (!shuttingDown) {
    process.exitCode = code ?? 1;
    shutdown();
  }
});

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:41033/health');
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('server_start_timeout');
}

try {
  await waitForServer();
} catch (error) {
  shutdown();
  throw error;
}

frontend = spawn(PNPM_CMD, ['dev:frontend'], {
  cwd: ROOT,
  stdio: 'inherit',
  windowsHide: true
});

frontend.on('exit', (code) => {
  if (!shuttingDown) {
    process.exitCode = code ?? 1;
    shutdown();
  }
});

await new Promise((resolve) => {
  server.on('exit', resolve);
  frontend.on('exit', resolve);
});
