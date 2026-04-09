import fs from 'node:fs/promises';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const DEV_STACK_PROCESS_FILE = 'dev-stack-processes.json';
const CODER_STUDIO_DISABLE_VITE_WATCH = 'CODER_STUDIO_DISABLE_VITE_WATCH';

const processStatePath = (stateDir) => path.join(stateDir, DEV_STACK_PROCESS_FILE);

const sanitizePid = (value) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const isMissingProcessError = (error) => (
  error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH'
);

const isProcessRunning = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isMissingProcessError(error)) {
      return false;
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') {
      return true;
    }
    throw error;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isPortInUse = (port, host = '127.0.0.1') => new Promise((resolve, reject) => {
  const socket = net.createConnection({ host, port });

  socket.once('connect', () => {
    socket.destroy();
    resolve(true);
  });
  socket.once('error', (error) => {
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'ECONNREFUSED' || error.code === 'EHOSTUNREACH') {
        resolve(false);
        return;
      }
    }
    reject(error);
  });
});

const listChildPids = (pid) => {
  if (process.platform === 'win32') {
    return [];
  }

  const result = spawnSync('ps', ['-o', 'pid=', '--ppid', String(pid)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) {
    return [];
  }

  return result.stdout
    .split(/\s+/)
    .map((value) => sanitizePid(value))
    .filter((value) => value !== null);
};

const stopProcessTree = async (pid) => {
  if (!sanitizePid(pid) || pid === process.pid) {
    return;
  }

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  const childPids = listChildPids(pid);
  for (const childPid of childPids) {
    await stopProcessTree(childPid);
  }

  if (!isProcessRunning(pid)) {
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (isMissingProcessError(error)) {
      return;
    }
    throw error;
  }

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      return;
    }
    await sleep(100);
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (isMissingProcessError(error)) {
      return;
    }
    throw error;
  }
};

export function buildDevStackRuntimeEnv(root, env = process.env) {
  const stateDir = env.CODER_STUDIO_HOME
    ? path.resolve(env.CODER_STUDIO_HOME)
    : path.join(root, '.tmp', 'dev-stack-runtime');
  const dataDir = env.CODER_STUDIO_DATA_DIR
    ? path.resolve(env.CODER_STUDIO_DATA_DIR)
    : path.join(stateDir, 'data');
  const claudeHomeRoot = env.CODER_STUDIO_CLAUDE_HOME
    ? path.resolve(env.CODER_STUDIO_CLAUDE_HOME)
    : path.join(stateDir, 'provider-homes', 'claude-home');
  const codexHomeRoot = env.CODER_STUDIO_CODEX_HOME
    ? path.resolve(env.CODER_STUDIO_CODEX_HOME)
    : path.join(stateDir, 'provider-homes', 'codex-home');

  return {
    stateDir,
    dataDir,
    claudeHomeRoot,
    codexHomeRoot,
    env: {
      ...env,
      CODER_STUDIO_HOME: stateDir,
      CODER_STUDIO_DATA_DIR: dataDir,
      CODER_STUDIO_CLAUDE_HOME: claudeHomeRoot,
      CODER_STUDIO_CODEX_HOME: codexHomeRoot,
      [CODER_STUDIO_DISABLE_VITE_WATCH]: env[CODER_STUDIO_DISABLE_VITE_WATCH] ?? '1',
    },
  };
}

export async function readDevStackRuntimeProcesses(stateDir) {
  try {
    const raw = await fs.readFile(processStatePath(stateDir), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      serverPid: sanitizePid(parsed.serverPid),
      frontendPid: sanitizePid(parsed.frontendPid),
    };
  } catch {
    return {
      serverPid: null,
      frontendPid: null,
    };
  }
}

export async function writeDevStackRuntimeProcesses(
  stateDir,
  { serverPid = null, frontendPid = null },
) {
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(processStatePath(stateDir), JSON.stringify({
    serverPid: sanitizePid(serverPid),
    frontendPid: sanitizePid(frontendPid),
  }), 'utf8');
}

export async function clearDevStackRuntimeProcesses(stateDir) {
  await fs.rm(processStatePath(stateDir), { force: true });
}

export async function stopRecordedDevStackProcesses(
  stateDir,
  { stopProcess = stopProcessTree } = {},
) {
  const recorded = await readDevStackRuntimeProcesses(stateDir);
  const pids = Array.from(new Set([
    recorded.serverPid,
    recorded.frontendPid,
  ].filter((value) => value !== null)));

  for (const pid of pids) {
    await stopProcess(pid);
  }

  await clearDevStackRuntimeProcesses(stateDir);
  return pids;
}

export async function assertDevStackPortsAvailable(ports, { host = '127.0.0.1' } = {}) {
  for (const port of ports) {
    const parsedPort = Number.parseInt(String(port ?? ''), 10);
    if (!Number.isFinite(parsedPort) || parsedPort <= 0) {
      continue;
    }
    if (await isPortInUse(parsedPort, host)) {
      throw new Error(`port_in_use:${host}:${parsedPort}`);
    }
  }
}

export async function resetDevStackRuntimeState(stateDir, options = {}) {
  const { protectedPorts = [], ...stopOptions } = options;
  await stopRecordedDevStackProcesses(stateDir, stopOptions);
  await assertDevStackPortsAvailable(protectedPorts);
  await fs.rm(stateDir, { recursive: true, force: true });
  await fs.mkdir(stateDir, { recursive: true });
}
