import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../apps/web/src/i18n.ts';
import {
  cloneAppSettings,
  defaultAppSettings,
  readStoredAppSettings,
} from '../apps/web/src/shared/app/settings.ts';

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

  assert.equal(settings.completionNotifications.enabled, true);
  assert.equal(settings.completionNotifications.onlyWhenBackground, true);
});

test('cloneAppSettings creates independent nested settings objects', () => {
  const original = defaultAppSettings();
  const cloned = cloneAppSettings(original);

  assert.notStrictEqual(cloned, original);
  assert.notStrictEqual(cloned.idlePolicy, original.idlePolicy);
  assert.notStrictEqual(cloned.completionNotifications, original.completionNotifications);
  assert.deepEqual(cloned, original);
});

test('readStoredAppSettings returns defaults without browser storage', () => {
  const originalWindow = globalThis.window;
  Reflect.deleteProperty(globalThis, 'window');

  try {
    assert.deepEqual(readStoredAppSettings(), defaultAppSettings());
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
      assert.deepEqual(readStoredAppSettings(), defaultAppSettings());
    },
  );
});

test('readStoredAppSettings hydrates legacy settings with completion notification defaults', () => {
  withMockWindow(
    {
      getItem: () => JSON.stringify({ agentCommand: 'custom-claude' }),
      setItem: () => {},
    },
    () => {
      const settings = readStoredAppSettings();

      assert.equal(settings.agentCommand, 'custom-claude');
      assert.deepEqual(settings.completionNotifications, {
        enabled: true,
        onlyWhenBackground: true,
      });
    },
  );
});

test('readStoredAppSettings preserves valid values and falls back for missing or invalid reminder fields', () => {
  withMockWindow(
    {
      getItem: () =>
        JSON.stringify({
          completionNotifications: {
            enabled: false,
            onlyWhenBackground: 'nope',
          },
        }),
      setItem: () => {},
    },
    () => {
      const settings = readStoredAppSettings();

      assert.deepEqual(settings.completionNotifications, {
        enabled: false,
        onlyWhenBackground: true,
      });
    },
  );
});

test('readStoredAppSettings falls back missing enabled field', () => {
  withMockWindow(
    {
      getItem: () =>
        JSON.stringify({
          completionNotifications: {
            onlyWhenBackground: false,
          },
        }),
      setItem: () => {},
    },
    () => {
      const settings = readStoredAppSettings();

      assert.deepEqual(settings.completionNotifications, {
        enabled: true,
        onlyWhenBackground: false,
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
