import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {
  assertDevStackPortsAvailable,
  buildDevStackRuntimeEnv,
  readDevStackRuntimeProcesses,
  resetDevStackRuntimeState,
  writeDevStackRuntimeProcesses,
} from '../scripts/test/dev-stack-runtime.mjs';

test('dev stack runtime defaults to an isolated repo-local state dir', () => {
  const root = '/tmp/coder-studio-root';
  const result = buildDevStackRuntimeEnv(root, {});

  assert.equal(result.stateDir, path.join(root, '.tmp', 'dev-stack-runtime'));
  assert.equal(result.env.CODER_STUDIO_HOME, path.join(root, '.tmp', 'dev-stack-runtime'));
});

test('dev stack runtime can persist and read recorded process ids', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-dev-stack-pids-'));
  const stateDir = path.join(tempRoot, 'state');

  try {
    await writeDevStackRuntimeProcesses(stateDir, {
      serverPid: 101,
      frontendPid: 202,
    });

    assert.deepEqual(await readDevStackRuntimeProcesses(stateDir), {
      serverPid: 101,
      frontendPid: 202,
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('dev stack runtime reset stops recorded processes before clearing prior state contents', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-dev-stack-reset-'));
  const stateDir = path.join(tempRoot, 'state');
  const stopped = [];

  try {
    await fs.mkdir(path.join(stateDir, 'nested'), { recursive: true });
    await fs.writeFile(path.join(stateDir, 'nested', 'stale.txt'), 'stale', 'utf8');
    await writeDevStackRuntimeProcesses(stateDir, {
      serverPid: 303,
      frontendPid: 404,
    });

    await resetDevStackRuntimeState(stateDir, {
      stopProcess: async (pid) => {
        stopped.push(pid);
      },
    });

    assert.deepEqual(stopped, [303, 404]);
    assert.deepEqual(await fs.readdir(stateDir), []);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('playwright port configs route through the isolated dev stack startup', async () => {
  const configPaths = [
    path.join(process.cwd(), 'playwright.config.ts'),
    path.join(process.cwd(), 'playwright.port-4174.config.ts'),
    path.join(process.cwd(), 'playwright.port-4175.config.ts'),
    path.join(process.cwd(), 'playwright.port-4176.config.ts'),
    path.join(process.cwd(), 'playwright.port-4177.config.ts'),
    path.join(process.cwd(), 'playwright.port-4179.config.ts'),
  ];

  for (const configPath of configPaths) {
    const raw = await fs.readFile(configPath, 'utf8');
    assert.match(raw, /node scripts\/test\/start-dev-stack\.mjs/);
    assert.doesNotMatch(raw, /pnpm exec vite --host/);
  }
});
