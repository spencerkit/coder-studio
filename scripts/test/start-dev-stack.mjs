import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PNPM_CMD = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
let frontend = null;

let shuttingDown = false;

function quoteForCmd(value) {
  if (value.length === 0) {
    return '""';
  }
  if (!/[\s"&^|<>()]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function resolveSpawn(command, args) {
  if (process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')) {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', [command, ...args].map(quoteForCmd).join(' ')]
    };
  }

  return { command, args };
}

function spawnPnpm(args) {
  const resolved = resolveSpawn(PNPM_CMD, args);
  return spawn(resolved.command, resolved.args, {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true
  });
}

const server = spawnPnpm(['dev:server']);

const killChild = (child) => {
  if (!child || child.killed || child.pid == null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      });
      return;
    }
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

frontend = spawnPnpm(['dev:frontend']);

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
