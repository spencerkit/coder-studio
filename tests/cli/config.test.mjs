import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  buildEndpoint,
  DEFAULT_PORT,
  resolveDataDir,
  resolveStateDir,
} from '../../.build/cli/lib/config.mjs';
import {
  flattenPublicConfig,
  loadLocalConfig,
  updateLocalConfig,
  validateConfigSnapshot,
} from '../../.build/cli/lib/user-config.mjs';

const execFileAsync = promisify(execFile);
const CLI_BIN = path.resolve('.build/cli/bin/coder-studio.mjs');

async function runCli(args, { env = process.env, allowFailure = false } = {}) {
  try {
    return await execFileAsync(process.execPath, [CLI_BIN, ...args], {
      env,
      maxBuffer: 1024 * 1024 * 8,
    });
  } catch (error) {
    if (allowFailure) {
      return error;
    }
    throw error;
  }
}

test('resolveStateDir prefers CODER_STUDIO_HOME override', () => {
  const result = resolveStateDir({ CODER_STUDIO_HOME: '/tmp/coder-studio-custom' }, 'linux');
  assert.equal(result, path.resolve('/tmp/coder-studio-custom'));
});

test('resolveStateDir respects platform defaults', () => {
  const linux = resolveStateDir({ XDG_STATE_HOME: '/tmp/xdg-state' }, 'linux');
  const darwin = resolveStateDir({}, 'darwin');
  assert.equal(linux, path.join('/tmp/xdg-state', 'coder-studio'));
  assert.match(darwin, /Library\/Application Support\/coder-studio$/);
});

test('resolveDataDir nests under stateDir by default', () => {
  const stateDir = '/tmp/coder-studio-state';
  assert.equal(resolveDataDir(stateDir, {}), path.join(stateDir, 'data'));
});

test('buildEndpoint uses the default port when requested', () => {
  assert.equal(buildEndpoint('127.0.0.1', DEFAULT_PORT), 'http://127.0.0.1:41033');
});

test('buildEndpoint wraps ipv6 hosts', () => {
  assert.equal(buildEndpoint('::1', DEFAULT_PORT), 'http://[::1]:41033');
});

test('loadLocalConfig provides runtime defaults before files exist', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-config-'));
  const stateDir = path.join(tempRoot, 'state');
  const dataDir = path.join(stateDir, 'data');

  try {
    const snapshot = await loadLocalConfig({ stateDir, dataDir });
    assert.equal(snapshot.values.server.host, '127.0.0.1');
    assert.equal(snapshot.values.server.port, 41033);
    assert.equal(snapshot.values.auth.publicMode, true);
    assert.equal(snapshot.values.auth.passwordConfigured, false);
    assert.match(snapshot.values.root.path, /coder-studio-workspaces$/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('updateLocalConfig writes config.json and auth.json with rootPath compatibility', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-config-'));
  const stateDir = path.join(tempRoot, 'state');
  const dataDir = path.join(stateDir, 'data');
  const rootPath = path.join(tempRoot, 'shared-root');

  try {
    await updateLocalConfig(
      { stateDir, dataDir },
      {
        'server.port': 43210,
        'root.path': rootPath,
        'auth.password': 'secret',
        'system.openCommand': 'open -a Browser',
        'logs.tailLines': 120,
      },
    );

    const snapshot = await loadLocalConfig({ stateDir, dataDir });
    const flat = flattenPublicConfig(snapshot);
    assert.equal(flat['server.port'], 43210);
    assert.equal(flat['root.path'], rootPath);
    assert.equal(flat['auth.password'], '(configured)');
    assert.equal(flat['system.openCommand'], 'open -a Browser');
    assert.equal(flat['logs.tailLines'], 120);

    const authJson = JSON.parse(await fs.readFile(path.join(dataDir, 'auth.json'), 'utf8'));
    assert.equal(authJson.rootPath, rootPath);
    assert.equal(authJson.allowedRoots, undefined);
    assert.equal(authJson.password, 'secret');

    const cliJson = JSON.parse(await fs.readFile(path.join(stateDir, 'config.json'), 'utf8'));
    assert.equal(cliJson.system.openCommand, 'open -a Browser');
    assert.equal(cliJson.logs.tailLines, 120);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('validateConfigSnapshot reports missing root when public mode is enabled', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-config-'));
  const stateDir = path.join(tempRoot, 'state');
  const dataDir = path.join(stateDir, 'data');

  try {
    await updateLocalConfig(
      { stateDir, dataDir },
      {
        'root.path': null,
        'auth.password': '',
      },
    );
    const snapshot = await loadLocalConfig({ stateDir, dataDir });
    const report = validateConfigSnapshot(snapshot);
    assert.equal(report.ok, false);
    assert.match(report.errors.join('\n'), /root\.path is required/);
    assert.match(report.warnings.join('\n'), /auth\.password is not configured/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('cli help documents exit codes and common examples', async () => {
  const result = await runCli(['help']);
  assert.match(result.stdout, /Exit Codes:/);
  assert.match(result.stdout, /coder-studio help start/);
  assert.match(result.stdout, /coder-studio config show --json/);
  assert.match(result.stdout, /coder-studio auth ip list/);
});

test('cli supports dedicated help topics', async () => {
  const startHelp = await runCli(['help', 'start']);
  assert.match(startHelp.stdout, /^coder-studio start/m);
  assert.match(startHelp.stdout, /--foreground/);

  const configHelp = await runCli(['config', '--help']);
  assert.match(configHelp.stdout, /^coder-studio config/m);

  const completionHelp = await runCli(['help', 'completion']);
  assert.match(completionHelp.stdout, /^coder-studio completion/m);
  assert.match(completionHelp.stdout, /completion <bash\|zsh\|fish>/);
  assert.match(completionHelp.stdout, /completion install <bash\|zsh\|fish>/);
  assert.match(completionHelp.stdout, /completion uninstall <bash\|zsh\|fish>/);

  const commandHelp = await runCli(['start', '--help']);
  assert.match(commandHelp.stdout, /^coder-studio start/m);
});

test('cli prints shell completion scripts', async () => {
  const bash = await runCli(['completion', 'bash']);
  assert.match(bash.stdout, /complete -F __coder_studio_complete coder-studio/);

  const zsh = await runCli(['completion', 'zsh']);
  assert.match(zsh.stdout, /#compdef coder-studio/);

  const fish = await runCli(['completion', 'fish']);
  assert.match(fish.stdout, /complete -c coder-studio/);
});

test('cli validates completion shell arguments', async () => {
  const invalidShell = await runCli(['completion', 'powershell'], { allowFailure: true });
  assert.equal(invalidShell.code, 2);
  assert.match(invalidShell.stderr, /unsupported completion shell: powershell/);
  assert.match(invalidShell.stderr, /coder-studio help completion/);

  const invalidJson = await runCli(['completion', 'bash', '--json'], { allowFailure: true });
  assert.equal(invalidJson.code, 2);
  const body = JSON.parse(invalidJson.stdout);
  assert.equal(body.ok, false);
  assert.equal(body.exitCode, 2);
  assert.equal(body.kind, 'usage');
  assert.match(body.error, /completion does not support --json/);

  const invalidForce = await runCli(['completion', 'bash', '--force'], { allowFailure: true });
  assert.equal(invalidForce.code, 2);
  assert.match(invalidForce.stderr, /completion does not support --force/);
});

test('cli installs bash completion into the user profile', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-completion-'));
  const homeDir = path.join(tempRoot, 'home');
  await fs.mkdir(homeDir, { recursive: true });
  const env = {
    ...process.env,
    HOME: homeDir,
    XDG_CONFIG_HOME: path.join(homeDir, '.config'),
  };

  try {
    const installResult = await runCli(['completion', 'install', 'bash', '--json'], { env });
    const body = JSON.parse(installResult.stdout);
    assert.equal(body.shell, 'bash');
    assert.match(body.scriptPath, /coder-studio\.bash$/);
    assert.match(body.profilePath, /\.bashrc$/);
    assert.equal(body.scriptUpdated, true);
    assert.equal(body.profileUpdated, true);
    assert.equal(body.activationCommand, 'source ~/.bashrc');
    assert.equal(body.forced, false);

    const script = await fs.readFile(body.scriptPath, 'utf8');
    assert.match(script, /complete -F __coder_studio_complete coder-studio/);

    const profile = await fs.readFile(body.profilePath, 'utf8');
    assert.match(profile, /coder-studio completion/);
    assert.match(profile, /source "\$HOME\/\.coder-studio\/completions\/coder-studio\.bash"/);

    const secondResult = await runCli(['completion', 'install', 'bash', '--json'], { env });
    const secondBody = JSON.parse(secondResult.stdout);
    assert.equal(secondBody.scriptUpdated, false);
    assert.equal(secondBody.profileUpdated, false);

    const thirdResult = await runCli(['completion', 'install', 'bash', '--json', '--force'], { env });
    const thirdBody = JSON.parse(thirdResult.stdout);
    assert.equal(thirdBody.scriptUpdated, true);
    assert.equal(thirdBody.profileUpdated, true);
    assert.equal(thirdBody.forced, true);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('cli installs fish completion without mutating a shell profile', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-completion-'));
  const homeDir = path.join(tempRoot, 'home');
  const xdgConfigHome = path.join(tempRoot, 'xdg-config');
  await fs.mkdir(homeDir, { recursive: true });
  const env = {
    ...process.env,
    HOME: homeDir,
    XDG_CONFIG_HOME: xdgConfigHome,
  };

  try {
    const installResult = await runCli(['completion', 'install', 'fish', '--json'], { env });
    const body = JSON.parse(installResult.stdout);
    assert.equal(body.shell, 'fish');
    assert.equal(body.scriptUpdated, true);
    assert.equal(body.profilePath, null);
    assert.equal(body.profileUpdated, false);
    assert.equal(body.activationCommand, 'exec fish');
    assert.equal(body.forced, false);
    assert.equal(
      body.scriptPath,
      path.join(xdgConfigHome, 'fish', 'completions', 'coder-studio.fish'),
    );

    const script = await fs.readFile(body.scriptPath, 'utf8');
    assert.match(script, /complete -c coder-studio/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('cli validates completion install usage', async () => {
  const missingShell = await runCli(['completion', 'install'], { allowFailure: true });
  assert.equal(missingShell.code, 2);
  assert.match(missingShell.stderr, /completion install requires <bash\|zsh\|fish>/);

  const extraArg = await runCli(['completion', 'install', 'bash', 'extra'], { allowFailure: true });
  assert.equal(extraArg.code, 2);
  assert.match(extraArg.stderr, /completion install accepts exactly one <shell> argument/);
});

test('cli uninstalls bash completion and removes the managed profile block', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-completion-'));
  const homeDir = path.join(tempRoot, 'home');
  await fs.mkdir(homeDir, { recursive: true });
  const env = {
    ...process.env,
    HOME: homeDir,
    XDG_CONFIG_HOME: path.join(homeDir, '.config'),
  };

  try {
    await runCli(['completion', 'install', 'bash', '--json'], { env });
    const uninstallResult = await runCli(['completion', 'uninstall', 'bash', '--json'], { env });
    const body = JSON.parse(uninstallResult.stdout);
    assert.equal(body.shell, 'bash');
    assert.equal(body.scriptRemoved, true);
    assert.match(body.profilePath, /\.bashrc$/);
    assert.equal(body.profileUpdated, true);

    await assert.rejects(fs.access(body.scriptPath));
    const profile = await fs.readFile(body.profilePath, 'utf8');
    assert.doesNotMatch(profile, /coder-studio completion/);

    const secondResult = await runCli(['completion', 'uninstall', 'bash', '--json'], { env });
    const secondBody = JSON.parse(secondResult.stdout);
    assert.equal(secondBody.scriptRemoved, false);
    assert.equal(secondBody.profileUpdated, false);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('cli validates completion uninstall usage', async () => {
  const missingShell = await runCli(['completion', 'uninstall'], { allowFailure: true });
  assert.equal(missingShell.code, 2);
  assert.match(missingShell.stderr, /completion uninstall requires <bash\|zsh\|fish>/);

  const extraArg = await runCli(['completion', 'uninstall', 'bash', 'extra'], { allowFailure: true });
  assert.equal(extraArg.code, 2);
  assert.match(extraArg.stderr, /completion uninstall accepts exactly one <shell> argument/);

  const invalidForce = await runCli(['completion', 'uninstall', 'bash', '--force'], { allowFailure: true });
  assert.equal(invalidForce.code, 2);
  assert.match(invalidForce.stderr, /completion uninstall does not support --force/);
});

test('cli returns usage exit code and hint for unsupported commands', async () => {
  const result = await runCli(['wat'], { allowFailure: true });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /unsupported command: wat/);
  assert.match(result.stderr, /coder-studio help/);
});

test('cli returns usage exit code for unsupported help topics', async () => {
  const result = await runCli(['help', 'wat'], { allowFailure: true });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /unsupported help topic: wat/);
});

test('cli returns usage exit code in json mode for invalid config usage', async () => {
  const result = await runCli(['config', 'set', 'server.port'], { allowFailure: true });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /config set requires <key> <value>/);

  const jsonResult = await runCli(['config', 'set', 'server.port', 'abc', '--json'], { allowFailure: true });
  assert.equal(jsonResult.code, 2);
  const body = JSON.parse(jsonResult.stdout);
  assert.equal(body.ok, false);
  assert.equal(body.exitCode, 2);
  assert.equal(body.kind, 'usage');
  assert.match(body.error, /server\.port/);
});
