import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultAppSettings,
  mergeLegacySettingsIntoAppSettings,
  resolveClaudeRuntimeProfile,
} from '../apps/web/src/shared/app/claude-settings.ts';

test('mergeLegacySettingsIntoAppSettings migrates launch command into claude global executable', () => {
  const merged = mergeLegacySettingsIntoAppSettings(defaultAppSettings(), {
    agentCommand: 'claude-nightly --verbose',
    completionNotifications: { enabled: true, onlyWhenBackground: true },
  });

  assert.equal(merged.claude.global.executable, 'claude-nightly');
  assert.deepEqual(merged.claude.global.startupArgs, ['--verbose']);
});

test('resolveClaudeRuntimeProfile only uses target override when enabled', () => {
  const settings = defaultAppSettings();
  settings.claude.overrides.native = {
    enabled: true,
    profile: {
      ...settings.claude.global,
      executable: 'claude-native',
      startupArgs: ['--dangerously-skip-permissions'],
    },
  };

  const native = resolveClaudeRuntimeProfile(settings, { type: 'native' });
  const wsl = resolveClaudeRuntimeProfile(settings, { type: 'wsl', distro: 'Ubuntu' });

  assert.equal(native.executable, 'claude-native');
  assert.equal(wsl.executable, 'claude');
});
