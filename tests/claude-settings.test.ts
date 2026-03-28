import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../apps/web/src/i18n.ts';
import {
  applyGeneralSettingsPatch,
  cloneAppSettings,
  defaultAppSettings,
  forceClaudeExecutableDefaults,
  formatClaudeLaunchPreview,
  getIdlePolicySyncWorkspaceIds,
  getClaudeScopeProfile,
  getSettingsDraftLocale,
  patchClaudeStructuredSettings,
  replaceClaudeAdvancedJson,
  mergeLegacySettingsIntoAppSettings,
  resolveClaudeRuntimeProfile,
  setClaudeScopeOverrideEnabled,
} from '../apps/web/src/shared/app/claude-settings.ts';

test('formatClaudeLaunchPreview always starts with claude and omits blank args', () => {
  assert.equal(
    formatClaudeLaunchPreview({
      executable: 'claude-nightly',
      startupArgs: ['--verbose', '   ', '--dangerously-skip-permissions'],
      env: {},
      settingsJson: {},
      globalConfigJson: {},
    }),
    'claude --verbose --dangerously-skip-permissions',
  );
});

test('forceClaudeExecutableDefaults resets hidden executable overrides back to claude', () => {
  const settings = cloneAppSettings(defaultAppSettings());
  settings.claude.global.executable = 'claude-nightly';
  settings.claude.overrides.native = {
    enabled: true,
    profile: {
      ...settings.claude.global,
      executable: 'claude-native',
      startupArgs: ['--verbose'],
    },
  };

  const next = forceClaudeExecutableDefaults(settings);

  assert.equal(next.claude.global.executable, 'claude');
  assert.equal(next.claude.overrides.native?.profile.executable, 'claude');
  assert.deepEqual(next.claude.overrides.native?.profile.startupArgs, ['--verbose']);
});

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

test('mergeLegacySettingsIntoAppSettings preserves unquoted windows paths with backslashes', () => {
  const merged = mergeLegacySettingsIntoAppSettings(defaultAppSettings(), {
    agentCommand: 'C:\\tools\\claude.exe --verbose',
  });

  assert.equal(merged.claude.global.executable, 'C:\\tools\\claude.exe');
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

test('getSettingsDraftLocale follows the shared draft locale', () => {
  const settings = defaultAppSettings();
  settings.general.locale = 'zh';

  assert.equal(getSettingsDraftLocale(settings), 'zh');
});

test('setClaudeScopeOverrideEnabled materializes a target override from global defaults', () => {
  const settings = defaultAppSettings();
  settings.claude.global.executable = 'claude-global';
  settings.claude.global.startupArgs = ['--verbose'];

  const next = setClaudeScopeOverrideEnabled(settings, 'native', true);
  const nativeOverride = next.claude.overrides.native;

  assert.equal(nativeOverride?.enabled, true);
  assert.equal(nativeOverride?.profile.executable, 'claude-global');
  assert.deepEqual(nativeOverride?.profile.startupArgs, ['--verbose']);
});

test('patchClaudeStructuredSettings only updates the requested target scope', () => {
  const settings = defaultAppSettings();

  const next = patchClaudeStructuredSettings(settings, {
    scope: 'native',
    executable: 'claude-native',
    startupArgs: ['--dangerously-skip-permissions'],
    env: { ANTHROPIC_API_KEY: 'secret' },
  });

  assert.equal(next.claude.global.executable, 'claude');
  assert.equal(next.claude.overrides.native?.profile.executable, 'claude-native');
  assert.deepEqual(next.claude.overrides.native?.profile.startupArgs, ['--dangerously-skip-permissions']);
  assert.deepEqual(next.claude.overrides.native?.profile.env, { ANTHROPIC_API_KEY: 'secret' });
});

test('replaceClaudeAdvancedJson updates nested advanced json for a single scope', () => {
  const settings = defaultAppSettings();

  const next = replaceClaudeAdvancedJson(settings, {
    scope: 'wsl',
    field: 'settingsJson',
    value: {
      model: 'claude-opus',
      sandbox: {
        enabled: true,
      },
    },
  });

  assert.deepEqual(getClaudeScopeProfile(next, 'wsl').settingsJson, {
    model: 'claude-opus',
    sandbox: {
      enabled: true,
    },
  });
  assert.deepEqual(next.claude.global.settingsJson, {});
});

test('translator exposes the new history and Claude settings keys', () => {
  const en = createTranslator('en') as (key: string, params?: Record<string, string | number>) => string;
  const zh = createTranslator('zh') as (key: string, params?: Record<string, string | number>) => string;

  assert.equal(en('draftModeNew'), 'New session');
  assert.equal(zh('draftModeRestore'), '从历史恢复');
  assert.equal(en('historyCount', { count: 3 }), '3 sessions');
  assert.match(en('historyDeleteConfirm', { title: 'Session 7' }), /Session 7/);
  assert.equal(en('claudeSettingsTitle'), 'Claude');
  assert.equal(zh('claudeStartupSection'), '启动');
  assert.equal(en('claudeAuthSection'), 'Authentication');
  assert.match(en('claudePermissionModeHelp'), /auto/i);
  assert.match(en('claudeApiKeyHelp'), /primaryApiKey/);
  assert.match(en('claudeApiKeyHelperHelp'), /priority/i);
  assert.match(zh('claudeAuthSectionHint'), /Claude 配置/);
  assert.equal(zh('claudeVerbose'), '--verbose');
  assert.equal(en('claudeJsonInvalid'), 'JSON must be an object.');
});
