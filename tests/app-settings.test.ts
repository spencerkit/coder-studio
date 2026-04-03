import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../apps/web/src/i18n';
import {
  cloneAppSettings,
  defaultAppSettings,
  readStoredAppSettings,
} from '../apps/web/src/shared/app/settings';

type LocalStorageMock = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

const withMockWindow = (localStorage: LocalStorageMock, run: () => void) => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  });

  try {
    run();
  } finally {
    if (typeof originalWindow === 'undefined') {
      Reflect.deleteProperty(globalThis, 'window');
      return;
    }

    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
  }
};

test('defaultAppSettings enables background-only completion notifications', () => {
  const settings = defaultAppSettings();

  assert.equal(settings.general.locale, 'en');
  assert.equal(settings.general.completionNotifications.enabled, true);
  assert.equal(settings.general.completionNotifications.onlyWhenBackground, true);
  assert.equal(settings.claude.global.executable, 'claude');
  assert.equal(settings.agentCommand, 'claude');
});

test('cloneAppSettings creates independent nested settings objects', () => {
  const original = defaultAppSettings();
  original.claude.global.env.ANTHROPIC_BASE_URL = 'https://anthropic.example';
  original.claude.global.settingsJson = { model: 'sonnet' };
  original.claude.global.globalConfigJson = { showTurnDuration: true };
  const cloned = cloneAppSettings(original);

  assert.notStrictEqual(cloned, original);
  assert.notStrictEqual(cloned.general, original.general);
  assert.notStrictEqual(cloned.general.idlePolicy, original.general.idlePolicy);
  assert.notStrictEqual(
    cloned.general.completionNotifications,
    original.general.completionNotifications,
  );
  assert.notStrictEqual(cloned.claude, original.claude);
  assert.notStrictEqual(cloned.claude.global, original.claude.global);
  assert.notStrictEqual(cloned.claude.global.env, original.claude.global.env);
  assert.notStrictEqual(cloned.claude.global.settingsJson, original.claude.global.settingsJson);
  assert.notStrictEqual(
    cloned.claude.global.globalConfigJson,
    original.claude.global.globalConfigJson,
  );
  assert.deepEqual(cloned, original);
  assert.ok(!('overrides' in cloned.claude));
});

test('readStoredAppSettings returns null without browser storage', () => {
  const originalWindow = globalThis.window;
  Reflect.deleteProperty(globalThis, 'window');

  try {
    assert.equal(readStoredAppSettings(), null);
  } finally {
    if (typeof originalWindow !== 'undefined') {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
        writable: true,
      });
    }
  }
});

test('readStoredAppSettings falls back cleanly for malformed JSON', () => {
  withMockWindow(
    {
      getItem: () => '{',
      setItem: () => {},
    },
    () => {
      assert.equal(readStoredAppSettings(), null);
    },
  );
});

test('readStoredAppSettings hydrates backend-shaped settings and derived compatibility fields', () => {
  withMockWindow(
    {
      getItem: () =>
        JSON.stringify({
          general: {
            locale: 'zh',
            terminalCompatibilityMode: 'compatibility',
            completionNotifications: {
              enabled: false,
              onlyWhenBackground: false,
            },
            idlePolicy: {
              enabled: false,
              idleMinutes: 4,
              maxActive: 2,
              pressure: false,
            },
          },
          claude: {
            global: {
              executable: 'claude-nightly',
              startupArgs: ['--verbose'],
              env: {
                ANTHROPIC_BASE_URL: 'https://anthropic.example',
              },
              settingsJson: {
                model: 'sonnet',
              },
              globalConfigJson: {
                showTurnDuration: true,
              },
            },
          },
        }),
      setItem: () => {},
    },
    () => {
      const settings = readStoredAppSettings();

      assert.ok(settings);
      assert.equal(settings.general.locale, 'zh');
      assert.equal(settings.general.terminalCompatibilityMode, 'compatibility');
      assert.equal(settings.claude.global.executable, 'claude-nightly');
      assert.deepEqual(settings.claude.global.startupArgs, ['--verbose']);
      assert.ok(!('overrides' in settings.claude));
      assert.equal(settings.agentCommand, 'claude-nightly --verbose');
      assert.deepEqual(settings.completionNotifications, {
        enabled: false,
        onlyWhenBackground: false,
      });
    },
  );
});

test('readStoredAppSettings migrates legacy launch command into backend-backed shape', () => {
  withMockWindow(
    {
      getItem: () =>
        JSON.stringify({
          agentCommand: 'custom-claude --verbose',
          completionNotifications: {
            enabled: false,
            onlyWhenBackground: false,
          },
          terminalCompatibilityMode: 'compatibility',
        }),
      setItem: () => {},
    },
    () => {
      const settings = readStoredAppSettings();

      assert.ok(settings);
      assert.equal(settings.claude.global.executable, 'custom-claude');
      assert.deepEqual(settings.claude.global.startupArgs, ['--verbose']);
      assert.deepEqual(settings.general.completionNotifications, {
        enabled: false,
        onlyWhenBackground: false,
      });
      assert.equal(settings.general.terminalCompatibilityMode, 'compatibility');
    },
  );
});

test('readStoredAppSettings preserves valid values and falls back for missing or invalid reminder fields', () => {
  withMockWindow(
    {
      getItem: () =>
        JSON.stringify({
          general: {
            completionNotifications: {
              enabled: false,
              onlyWhenBackground: 'nope',
            },
          },
        }),
      setItem: () => {},
    },
    () => {
      const settings = readStoredAppSettings();

      assert.ok(settings);
      assert.deepEqual(settings.general.completionNotifications, {
        enabled: true,
        onlyWhenBackground: true,
      });
    },
  );
});

test('translator exposes completion reminder copy in English and Chinese', () => {
  const en = createTranslator('en');
  const zh = createTranslator('zh');

  assert.equal(en('completionNotifications'), 'Completion Notifications');
  assert.equal(
    en('completionNotificationsHint'),
    'Send reminders when tasks finish in the background.',
  );
  assert.equal(en('notifyOnlyInBackground'), 'Only notify in background');
  assert.equal(
    en('notifyOnlyInBackgroundHint'),
    'Skip browser alerts when the completed session is already in view.',
  );
  assert.equal(en('notificationPermission'), 'Browser notification permission');
  assert.equal(en('notificationPermissionAllowed'), 'Allowed');
  assert.equal(en('notificationPermissionNotEnabled'), 'Not enabled');
  assert.equal(en('notificationPermissionUnsupported'), 'Unsupported');
  assert.equal(
    en('completionNotificationBody', { workspaceTitle: 'Alpha' }),
    'Alpha · Task complete',
  );

  assert.equal(zh('completionNotifications'), '完成提醒');
  assert.equal(zh('completionNotificationsHint'), '任务在后台完成时发送提醒。');
  assert.equal(zh('notifyOnlyInBackground'), '仅在后台提醒');
  assert.equal(
    zh('notifyOnlyInBackgroundHint'),
    '如果已在当前界面查看完成的会话，则跳过浏览器提醒。',
  );
  assert.equal(zh('notificationPermission'), '浏览器通知权限');
  assert.equal(zh('notificationPermissionAllowed'), '已允许');
  assert.equal(zh('notificationPermissionNotEnabled'), '未启用');
  assert.equal(zh('notificationPermissionUnsupported'), '不支持');
  assert.equal(
    zh('completionNotificationBody', { workspaceTitle: '阿尔法' }),
    '阿尔法 · 任务完成',
  );
});
