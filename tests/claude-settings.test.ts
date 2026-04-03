import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../apps/web/src/i18n';
import {
  applyGeneralSettingsPatch,
  cloneAppSettings,
  defaultAppSettings,
  forceClaudeExecutableDefaults,
  formatClaudeLaunchPreview,
  formatCodexRuntimeCommand,
  getIdlePolicySyncWorkspaceIds,
  getSettingsDraftLocale,
  normalizeAppSettings,
  patchClaudeStructuredSettings,
  patchCodexStructuredSettings,
  replaceClaudeAdvancedJson,
  mergeLegacySettingsIntoAppSettings,
  resolveClaudeRuntimeProfile,
  resolveCodexRuntimeProfile,
} from '../apps/web/src/shared/app/claude-settings';

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

test('formatCodexRuntimeCommand includes generated config overrides without explicit codex hooks feature args', () => {
  assert.equal(
    formatCodexRuntimeCommand({
      executable: 'codex',
      extraArgs: ['--full-auto', '   '],
      model: 'gpt-5.4',
      approvalPolicy: 'on-request',
      sandboxMode: '',
      webSearch: '',
      modelReasoningEffort: '',
      env: {},
    }),
    'codex --full-auto --config model="gpt-5.4" --config approval_policy="on-request"',
  );
});

test('forceClaudeExecutableDefaults only resets the single Claude executable back to claude', () => {
  const settings = cloneAppSettings(defaultAppSettings());
  settings.claude.global.executable = 'claude-nightly';
  settings.codex.global.executable = 'codex-nightly';

  const next = forceClaudeExecutableDefaults(settings);

  assert.equal(next.claude.global.executable, 'claude');
  assert.equal(next.codex.global.executable, 'codex-nightly');
  assert.ok(!('overrides' in next.claude));
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

test('normalizeAppSettings drops incoming Claude target overrides and keeps one runtime profile', () => {
  const settings = normalizeAppSettings({
    ...defaultAppSettings(),
    claude: {
      global: {
        executable: 'claude-global',
        startupArgs: ['--verbose'],
        env: {},
        settingsJson: {
          model: 'sonnet',
        },
        globalConfigJson: {},
      },
      overrides: {
        native: {
          enabled: true,
          profile: {
            executable: 'claude-native',
            startupArgs: ['--dangerously-skip-permissions'],
            env: {},
            settingsJson: {
              model: 'opus',
            },
            globalConfigJson: {},
          },
        },
        wsl: {
          enabled: true,
          profile: {
            executable: 'claude-wsl',
            startupArgs: ['--print'],
            env: {},
            settingsJson: {
              model: 'haiku',
            },
            globalConfigJson: {},
          },
        },
      },
    },
  });

  const native = resolveClaudeRuntimeProfile(settings, { type: 'native' });
  const wsl = resolveClaudeRuntimeProfile(settings, { type: 'wsl', distro: 'Ubuntu' });

  assert.deepEqual(native, wsl);
  assert.equal(native.executable, 'claude-global');
  assert.deepEqual(native.startupArgs, ['--verbose']);
  assert.equal(native.settingsJson.model, 'sonnet');
  assert.ok(!('overrides' in settings.claude));
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

test('normalizeAppSettings drops incoming Codex target overrides and keeps one runtime profile', () => {
  const settings = normalizeAppSettings({
    ...defaultAppSettings(),
    codex: {
      global: {
        executable: 'codex-global',
        extraArgs: ['--full-auto'],
        model: 'gpt-5.4',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        webSearch: '',
        modelReasoningEffort: '',
        env: {},
      },
      overrides: {
        native: {
          enabled: true,
          profile: {
            executable: 'codex-native',
            extraArgs: ['--search'],
            model: '',
            approvalPolicy: 'never',
            sandboxMode: '',
            webSearch: 'live',
            modelReasoningEffort: 'high',
            env: {},
          },
        },
        wsl: null,
      },
    },
  });

  const native = resolveCodexRuntimeProfile(settings, { type: 'native' });
  const wsl = resolveCodexRuntimeProfile(settings, { type: 'wsl', distro: 'Ubuntu' });

  assert.deepEqual(native, wsl);
  assert.equal(native.executable, 'codex-global');
  assert.deepEqual(native.extraArgs, ['--full-auto']);
  assert.equal(native.approvalPolicy, 'on-request');
  assert.ok(!('overrides' in settings.codex));
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

test('patchClaudeStructuredSettings updates the single Claude profile directly', () => {
  const settings = defaultAppSettings();

  const next = patchClaudeStructuredSettings(settings, {
    executable: 'claude-nightly',
    startupArgs: ['--dangerously-skip-permissions'],
    env: { ANTHROPIC_API_KEY: 'secret' },
  });

  assert.equal(next.claude.global.executable, 'claude-nightly');
  assert.deepEqual(next.claude.global.startupArgs, ['--dangerously-skip-permissions']);
  assert.deepEqual(next.claude.global.env, { ANTHROPIC_API_KEY: 'secret' });
  assert.ok(!('overrides' in next.claude));
});

test('patchCodexStructuredSettings updates the single Codex profile directly', () => {
  const settings = defaultAppSettings();

  const next = patchCodexStructuredSettings(settings, {
    executable: 'codex-nightly',
    extraArgs: ['--full-auto'],
    model: 'gpt-5.4',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    webSearch: 'live',
    modelReasoningEffort: 'high',
    env: { OPENAI_API_KEY: 'secret' },
  });

  assert.equal(next.codex.global.executable, 'codex-nightly');
  assert.deepEqual(next.codex.global.extraArgs, ['--full-auto']);
  assert.equal(next.codex.global.model, 'gpt-5.4');
  assert.equal(next.codex.global.approvalPolicy, 'on-request');
  assert.equal(next.codex.global.sandboxMode, 'workspace-write');
  assert.equal(next.codex.global.webSearch, 'live');
  assert.equal(next.codex.global.modelReasoningEffort, 'high');
  assert.deepEqual(next.codex.global.env, { OPENAI_API_KEY: 'secret' });
  assert.ok(!('overrides' in next.codex));
});

test('replaceClaudeAdvancedJson updates nested advanced json on the single Claude profile', () => {
  const settings = defaultAppSettings();

  const next = replaceClaudeAdvancedJson(settings, {
    field: 'settingsJson',
    value: {
      model: 'claude-opus',
      sandbox: {
        enabled: true,
      },
    },
  });

  assert.deepEqual(next.claude.global.settingsJson, {
    model: 'claude-opus',
    sandbox: {
      enabled: true,
    },
  });
  assert.ok(!('overrides' in next.claude));
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
  assert.match(en('claudeApiKeyMeta'), /Secret string/);
  assert.equal(en('claudeModelPlaceholder'), 'claude-sonnet-4-5');
  assert.equal(en('claudeSelectUnsetOption'), 'Not set');
  assert.equal(en('claudeEditorModeVimOption'), 'vim');
  assert.equal(en('claudeShowSecret'), 'Show secret');
  assert.equal(zh('claudeHideSecret'), '隐藏明文');
  assert.match(en('claudeApiKeyHelperHelp'), /take precedence/i);
  assert.match(zh('claudeAuthSectionHint'), /Claude 配置/);
  assert.match(zh('claudeCleanupDaysMeta'), />= 0/);
  assert.equal(zh('claudeExtraStartupArgsPlaceholder'), '--model\nclaude-sonnet-4-5');
  assert.equal(zh('claudeVerbose'), '--verbose');
  assert.equal(en('claudeJsonInvalid'), 'JSON must be an object.');
});
