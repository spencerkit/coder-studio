import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBrowserNotificationPermissionState,
  isCompletionReminderBackgroundCase,
  notifyCompletionReminder,
  playCompletionReminderSound,
} from '../apps/web/src/features/workspace/completion-reminders';

const withMockWindow = <T>(mockWindow: Window, run: () => Promise<T> | T) => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    value: mockWindow,
    configurable: true,
    writable: true,
  });

  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (typeof originalWindow === 'undefined') {
        Reflect.deleteProperty(globalThis, 'window');
        return;
      }

      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
        writable: true,
      });
    });
};

test('getBrowserNotificationPermissionState returns unsupported without Notification API', () => {
  const originalWindow = globalThis.window;
  Reflect.deleteProperty(globalThis, 'window');

  try {
    assert.equal(getBrowserNotificationPermissionState(), 'unsupported');
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

test('getBrowserNotificationPermissionState maps granted permission to allowed', async () => {
  await withMockWindow({ Notification: { permission: 'granted' } } as Window, () => {
    assert.equal(getBrowserNotificationPermissionState(), 'allowed');
  });
});

test('isCompletionReminderBackgroundCase returns true when session is not active', () => {
  assert.equal(
    isCompletionReminderBackgroundCase(
      {
        workspaceId: 'ws-1',
        workspaceTitle: 'Workspace',
        sessionId: 'session-2',
        sessionTitle: 'Session',
      },
      {
        activeWorkspaceId: 'ws-1',
        activeSessionId: 'session-1',
        documentVisible: true,
        windowFocused: true,
      },
    ),
    true,
  );
});

test('isCompletionReminderBackgroundCase returns false for the active visible focused session', () => {
  assert.equal(
    isCompletionReminderBackgroundCase(
      {
        workspaceId: 'ws-1',
        workspaceTitle: 'Workspace',
        sessionId: 'session-1',
        sessionTitle: 'Session',
      },
      {
        activeWorkspaceId: 'ws-1',
        activeSessionId: 'session-1',
        documentVisible: true,
        windowFocused: true,
      },
    ),
    false,
  );
});

test('playCompletionReminderSound rewinds audio before playing', async () => {
  const calls: string[] = [];
  const audio = {
    currentTime: 4,
    play: async () => {
      calls.push('play');
    },
  } as HTMLAudioElement;

  await playCompletionReminderSound(audio);

  assert.equal(audio.currentTime, 0);
  assert.deepEqual(calls, ['play']);
});

test('notifyCompletionReminder requests permission then sends notification and focuses on click', async () => {
  const events: string[] = [];
  let createdNotification: { onclick: null | (() => void) } | null = null;

  class NotificationMock {
    static permission = 'default';

    static async requestPermission() {
      events.push('requestPermission');
      NotificationMock.permission = 'granted';
      return 'granted';
    }

    onclick: null | (() => void) = null;

    constructor(title: string, options: { body: string }) {
      events.push(`notify:${title}:${options.body}`);
      createdNotification = this;
    }
  }

  await withMockWindow(
    {
      Notification: NotificationMock,
      focus: () => {
        events.push('focus');
      },
    } as unknown as Window,
    async () => {
      await notifyCompletionReminder({
        title: 'Session title',
        body: 'Workspace · Task complete',
        onClick: () => {
          events.push('onClick');
        },
      });

      assert.ok(createdNotification);
      createdNotification?.onclick?.();
    },
  );

  assert.deepEqual(events, [
    'requestPermission',
    'notify:Session title:Workspace · Task complete',
    'focus',
    'onClick',
  ]);
});
