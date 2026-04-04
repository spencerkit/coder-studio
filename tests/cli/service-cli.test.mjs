import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CLI_BIN = path.resolve('.build/cli/bin/coder-studio.mjs');

async function runCli(args, { env = process.env, allowFailure = false } = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-cli-run-'));
  const stdoutPath = path.join(tempRoot, 'stdout.log');
  const stderrPath = path.join(tempRoot, 'stderr.log');
  const stdoutHandle = await fs.open(stdoutPath, 'w');
  const stderrHandle = await fs.open(stderrPath, 'w');

  try {
    const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
      env,
      stdio: ['ignore', stdoutHandle.fd, stderrHandle.fd],
    });

    await stdoutHandle.close();
    await stderrHandle.close();

    const [stdout, stderr] = await Promise.all([
      fs.readFile(stdoutPath, 'utf8').catch(() => ''),
      fs.readFile(stderrPath, 'utf8').catch(() => ''),
    ]);

    if ((result.status ?? 0) !== 0) {
      const error = Object.assign(new Error(`cli exited with code ${result.status}`), {
        code: result.status ?? 1,
        stdout,
        stderr,
      });
      if (allowFailure) {
        return error;
      }
      throw error;
    }

    return { stdout, stderr };
  } finally {
    await stdoutHandle.close().catch(() => undefined);
    await stderrHandle.close().catch(() => undefined);
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function withManagedServiceEnv(run) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-service-cli-'));
  const env = {
    ...process.env,
    CODER_STUDIO_HOME: path.join(tempRoot, 'state'),
    CODER_STUDIO_TEST_MANAGED_SERVICE: '1',
  };

  try {
    return await run(env);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

test('managed mode rejects foreground start', async () => {
  const result = await withManagedServiceEnv((env) =>
    runCli(['start', '--foreground'], {
      env,
      allowFailure: true,
    }),
  );

  assert.equal(result.code, 1);
  assert.match(result.stderr, /service_managed_runtime_requires_service_stop_for_foreground_debug/);
});

test('managed mode rejects host override on start', async () => {
  const result = await withManagedServiceEnv((env) =>
    runCli(['start', '--host', '0.0.0.0'], {
      env,
      allowFailure: true,
    }),
  );

  assert.equal(result.code, 1);
  assert.match(result.stderr, /service_managed_runtime_requires_config_update_instead_of_ephemeral_override/);
});

test('service status command is recognized', async () => {
  const result = await withManagedServiceEnv((env) =>
    runCli(['service', 'status', '--json'], {
      env,
    }),
  );

  const body = JSON.parse(result.stdout);
  assert.equal(body.installed, true);
  assert.equal(typeof body.serviceState, 'object');
});
