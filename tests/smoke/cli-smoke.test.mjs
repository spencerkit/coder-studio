import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NPM_CMD, PNPM_CMD, run } from '../helpers/exec.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ARTIFACTS_DIR = path.join(ROOT, '.artifacts');
const CLI_BIN_NAME = process.platform === 'win32' ? 'coder-studio.cmd' : 'coder-studio';
const DEFAULT_TEST_PORT = 41933;

async function ensureTarballs() {
  let files = [];
  try {
    files = await fs.readdir(ARTIFACTS_DIR);
  } catch {
    files = [];
  }

  const main = files.find((file) => file.startsWith('spencer-kit-coder-studio-') && !file.includes(process.platform));
  const platform = files.find((file) => file.includes(process.platform));
  if (!main || !platform) {
    await run(PNPM_CMD, ['pack:local'], { cwd: ROOT });
    files = await fs.readdir(ARTIFACTS_DIR);
  }

  const resolvedMain = files.find((file) => file.startsWith('spencer-kit-coder-studio-') && !file.includes(process.platform));
  const resolvedPlatform = files.find((file) => file.includes(process.platform));
  assert.ok(resolvedMain, 'main package tarball should exist');
  assert.ok(resolvedPlatform, 'platform package tarball should exist');
  return {
    main: path.join(ARTIFACTS_DIR, resolvedMain),
    platform: path.join(ARTIFACTS_DIR, resolvedPlatform)
  };
}

async function installLocalPackage(installDir, tarballs) {
  await fs.writeFile(path.join(installDir, 'package.json'), JSON.stringify({ name: 'coder-studio-smoke', private: true }, null, 2));
  await run(NPM_CMD, ['install', '--no-package-lock', '--no-save', tarballs.main, tarballs.platform], {
    cwd: installDir,
    env: {
      ...process.env,
      npm_config_fund: 'false',
      npm_config_audit: 'false'
    }
  });
  return path.join(installDir, 'node_modules', '.bin', CLI_BIN_NAME);
}

async function runCli(cliPath, args, env, allowFailure = false) {
  try {
    return await run(cliPath, args, { env });
  } catch (error) {
    if (allowFailure) {
      return error;
    }
    throw error;
  }
}

test('installed package can manage runtime and auth config', { timeout: 600000 }, async () => {
  const tarballs = await ensureTarballs();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-smoke-'));
  const installDir = path.join(tempRoot, 'install');
  const stateDir = path.join(tempRoot, 'state');
  const accessibleRoot = path.join(tempRoot, 'accessible-root');
  await fs.mkdir(installDir, { recursive: true });

  const cliPath = await installLocalPackage(installDir, tarballs);
  const env = {
    ...process.env,
    CODER_STUDIO_HOME: stateDir
  };

  try {
    const configShow = await runCli(cliPath, ['config', 'show', '--json'], env);
    const configShowResult = JSON.parse(configShow.stdout);
    assert.equal(configShowResult.values['server.port'], 41033);

    const setPort = await runCli(cliPath, ['config', 'set', 'server.port', String(DEFAULT_TEST_PORT), '--json'], env);
    assert.deepEqual(JSON.parse(setPort.stdout).changedKeys, ['server.port']);

    const setRoot = await runCli(cliPath, ['config', 'root', 'set', accessibleRoot, '--json'], env);
    assert.deepEqual(JSON.parse(setRoot.stdout).changedKeys, ['root.path']);

    const setPassword = await runCli(cliPath, ['config', 'password', 'set', 'secret-pass', '--json'], env);
    const setPasswordResult = JSON.parse(setPassword.stdout);
    assert.equal(setPasswordResult.configured, true);

    const validate = await runCli(cliPath, ['config', 'validate', '--json'], env);
    const validateResult = JSON.parse(validate.stdout);
    assert.equal(validateResult.ok, true);

    const start = await runCli(cliPath, ['start', '--json'], env);
    const startResult = JSON.parse(start.stdout);
    assert.equal(startResult.status, 'running');
    assert.equal(startResult.endpoint, `http://127.0.0.1:${DEFAULT_TEST_PORT}`);

    const status = await runCli(cliPath, ['status', '--json'], env);
    const statusResult = JSON.parse(status.stdout);
    assert.equal(statusResult.status, 'running');
    assert.equal(statusResult.managed, true);
    assert.equal(statusResult.endpoint, `http://127.0.0.1:${DEFAULT_TEST_PORT}`);

    const authStatus = await runCli(cliPath, ['auth', 'status', '--json'], env);
    const authStatusResult = JSON.parse(authStatus.stdout);
    assert.equal(authStatusResult.runtimeRunning, true);
    assert.equal(authStatusResult.server.port, DEFAULT_TEST_PORT);
    assert.equal(authStatusResult.root.path, accessibleRoot);
    assert.equal(authStatusResult.auth.passwordConfigured, true);

    const ipList = await runCli(cliPath, ['auth', 'ip', 'list', '--json'], env);
    const ipListResult = JSON.parse(ipList.stdout);
    assert.equal(ipListResult.running, true);
    assert.deepEqual(ipListResult.entries, []);

    const unblockAll = await runCli(cliPath, ['auth', 'ip', 'unblock', '--all', '--json'], env);
    const unblockAllResult = JSON.parse(unblockAll.stdout);
    assert.equal(unblockAllResult.removed, 0);

    const liveRoot = path.join(tempRoot, 'live-root');
    const liveRootUpdate = await runCli(cliPath, ['config', 'root', 'set', liveRoot, '--json'], env);
    const liveRootUpdateResult = JSON.parse(liveRootUpdate.stdout);
    assert.deepEqual(liveRootUpdateResult.changedKeys, ['root.path']);

    const authStatusAfterUpdate = await runCli(cliPath, ['auth', 'status', '--json'], env);
    const authStatusAfterUpdateResult = JSON.parse(authStatusAfterUpdate.stdout);
    assert.equal(authStatusAfterUpdateResult.root.path, liveRoot);

    const doctor = await runCli(cliPath, ['doctor', '--json'], env);
    const doctorResult = JSON.parse(doctor.stdout);
    assert.equal(doctorResult.status.status, 'running');
    assert.ok(doctorResult.bundle.binaryPath.includes('coder-studio'));

    const restart = await runCli(cliPath, ['restart', '--json'], env);
    const restartResult = JSON.parse(restart.stdout);
    assert.equal(restartResult.status, 'running');

    await runCli(cliPath, ['stop', '--json'], env);
    const stopped = await runCli(cliPath, ['status', '--json'], env, true);
    const stoppedResult = JSON.parse(stopped.stdout || stopped.stdout?.toString?.() || '{}');
    assert.equal(stoppedResult.status, 'stopped');
  } finally {
    await runCli(cliPath, ['stop', '--json'], env, true);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
