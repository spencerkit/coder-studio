import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildEndpoint,
  DEFAULT_PORT,
  resolveDataDir,
  resolveStateDir,
} from '../../packages/coder-studio/lib/config.mjs';
import {
  flattenPublicConfig,
  loadLocalConfig,
  updateLocalConfig,
  validateConfigSnapshot,
} from '../../packages/coder-studio/lib/user-config.mjs';

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
