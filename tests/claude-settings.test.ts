import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGeneralSettingsPatch,
  cloneAppSettings,
  defaultAppSettings,
  getIdlePolicySyncWorkspaceIds,
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

test('mergeLegacySettingsIntoAppSettings preserves quoted executable paths and args', () => {
  const merged = mergeLegacySettingsIntoAppSettings(defaultAppSettings(), {
    agentCommand: '"C:\\Program Files\\Claude\\claude.exe" --model "claude 3.7 sonnet" --append \'nightly build\'',
  });

  assert.equal(merged.claude.global.executable, 'C:\\Program Files\\Claude\\claude.exe');
  assert.deepEqual(merged.claude.global.startupArgs, [
    '--model',
    'claude 3.7 sonnet',
    '--append',
    'nightly build',
  ]);
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

test('applyGeneralSettingsPatch updates nested general settings and compatibility mirrors', () => {
  const next = applyGeneralSettingsPatch(defaultAppSettings(), {
    idlePolicy: {
      idleMinutes: 22,
      maxActive: 6,
    },
    completionNotifications: {
      enabled: false,
    },
    terminalCompatibilityMode: 'compatibility',
  });

  assert.equal(next.general.idlePolicy.idleMinutes, 22);
  assert.equal(next.general.idlePolicy.maxActive, 6);
  assert.equal(next.general.completionNotifications.enabled, false);
  assert.equal(next.general.terminalCompatibilityMode, 'compatibility');
  assert.equal(next.idlePolicy.idleMinutes, 22);
  assert.equal(next.completionNotifications.enabled, false);
  assert.equal(next.terminalCompatibilityMode, 'compatibility');
});

test('resolveClaudeRuntimeProfile inherits global startup args for enabled target overrides', () => {
  const settings = cloneAppSettings({
    ...defaultAppSettings(),
    claude: {
      ...defaultAppSettings().claude,
      global: {
        ...defaultAppSettings().claude.global,
        executable: 'claude-global',
        startupArgs: ['--verbose'],
      },
      overrides: {
        ...defaultAppSettings().claude.overrides,
      },
    },
  });
  settings.claude.overrides.native = {
    enabled: true,
    profile: {
      ...settings.claude.global,
      executable: 'claude-native',
      startupArgs: [],
    },
  };

  const resolved = resolveClaudeRuntimeProfile(settings, { type: 'native' });

  assert.equal(resolved.executable, 'claude-native');
  assert.deepEqual(resolved.startupArgs, ['--verbose']);
});

test('getIdlePolicySyncWorkspaceIds waits for confirmed settings hydration', () => {
  const settings = defaultAppSettings();
  settings.general.idlePolicy.idleMinutes = 25;
  settings.idlePolicy.idleMinutes = 25;

  const tabs = [
    {
      id: 'ws-1',
      idlePolicy: defaultAppSettings().idlePolicy,
    },
  ];

  assert.deepEqual(getIdlePolicySyncWorkspaceIds(tabs, settings.idlePolicy, false), []);
  assert.deepEqual(getIdlePolicySyncWorkspaceIds(tabs, settings.idlePolicy, true), ['ws-1']);
});
