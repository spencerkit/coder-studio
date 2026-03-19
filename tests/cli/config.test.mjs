import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildEndpoint, DEFAULT_PORT, resolveDataDir, resolveStateDir } from '../../packages/coder-studio/lib/config.mjs';

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
