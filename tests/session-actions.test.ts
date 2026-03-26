import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../apps/web/src/i18n.ts';
import { createWorkspaceSessionActions } from '../apps/web/src/features/workspace/session-actions.ts';
import type { AppSettings, Toast } from '../apps/web/src/types/app.ts';
import type { WorkbenchState } from '../apps/web/src/state/workbench.ts';

const defaultAppSettings = (): AppSettings => ({
  agentProvider: 'claude',
  agentCommand: 'claude',
  idlePolicy: {
    enabled: true,
    idleMinutes: 10,
    maxActive: 3,
    pressure: true,
  },
  completionNotifications: {
    enabled: true,
    onlyWhenBackground: true,
  },
  terminalCompatibilityMode: 'standard',
});

const createState = (): WorkbenchState => ({
  activeTabId: 'ws-1',
  layout: {
    leftWidth: 320,
    rightWidth: 320,
    rightSplit: 64,
    showCodePanel: false,
    showTerminalPanel: false,
  },
  overlay: {
    visible: false,
    mode: 'local',
    input: '',
    target: { type: 'native' },
  },
  tabs: [
    {
      id: 'ws-1',
      title: 'Workspace Alpha',
      status: 'ready',
      controller: {
        role: 'controller',
        deviceId: 'device-a',
        clientId: 'client-a',
        fencingToken: 1,
        takeoverPending: false,
        takeoverRequestedBySelf: false,
      },
      agent: {
        provider: 'claude',
        command: 'claude',
        useWsl: false,
      },
      git: { branch: 'main', changes: 0, lastCommit: 'abc123' },
      gitChanges: [],
      worktrees: [],
      sessions: [
        {
          id: 'session-active',
          title: 'Active Session',
          status: 'running',
          mode: 'branch',
          autoFeed: true,
          queue: [],
          messages: [],
          stream: '',
          unread: 0,
          lastActiveAt: 1,
        },
        {
          id: 'session-background',
          title: 'Background Session',
          status: 'running',
          mode: 'branch',
          autoFeed: true,
          queue: [],
          messages: [],
          stream: '',
          unread: 0,
          lastActiveAt: 1,
        },
      ],
      activeSessionId: 'session-active',
      archive: [],
      terminals: [],
      activeTerminalId: '',
      fileTree: [],
      changesTree: [],
      filePreview: {
        path: '',
        content: '',
        mode: 'preview',
        originalContent: '',
        modifiedContent: '',
        dirty: false,
      },
      paneLayout: {
        type: 'leaf',
        id: 'pane-1',
        sessionId: 'session-active',
      },
      activePaneId: 'pane-1',
      idlePolicy: {
        enabled: true,
        idleMinutes: 10,
        maxActive: 3,
        pressure: true,
      },
    },
  ],
});

test('markSessionIdle triggers completion reminder for a completed background task', async () => {
  const locale = 'en';
  const t = createTranslator(locale);
  const state = createState();
  const stateRef = { current: state };
  const toasts: Toast[] = [];
  const reminders: Array<{
    workspaceId: string;
    workspaceTitle: string;
    sessionId: string;
    sessionTitle: string;
  }> = [];

  const actions = createWorkspaceSessionActions({
    appSettings: defaultAppSettings(),
    locale,
    t,
    stateRef,
    updateTab: (tabId, updater) => {
      stateRef.current = {
        ...stateRef.current,
        tabs: stateRef.current.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab)),
      };
    },
    withServiceFallback: async (operation, fallback) => {
      try {
        return await operation();
      } catch {
        return fallback;
      }
    },
    addToast: (toast) => {
      toasts.push(toast);
    },
    onCompletionReminder: async (target) => {
      reminders.push(target);
    },
  });

  await actions.markSessionIdle('ws-1', 'session-background');

  assert.equal(toasts.length, 1);
  assert.deepEqual(reminders, [
    {
      workspaceId: 'ws-1',
      workspaceTitle: 'Workspace Alpha',
      sessionId: 'session-background',
      sessionTitle: 'Background Session',
    },
  ]);
});

test('markSessionIdle does not trigger completion reminder for agent exit notes', async () => {
  const locale = 'en';
  const t = createTranslator(locale);
  const state = createState();
  const stateRef = { current: state };
  const reminders: string[] = [];

  const actions = createWorkspaceSessionActions({
    appSettings: defaultAppSettings(),
    locale,
    t,
    stateRef,
    updateTab: (tabId, updater) => {
      stateRef.current = {
        ...stateRef.current,
        tabs: stateRef.current.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab)),
      };
    },
    withServiceFallback: async (operation, fallback) => {
      try {
        return await operation();
      } catch {
        return fallback;
      }
    },
    addToast: () => {},
    onCompletionReminder: async ({ sessionId }) => {
      reminders.push(sessionId);
    },
  });

  await actions.markSessionIdle('ws-1', 'session-background', t('agentExited'));

  assert.deepEqual(reminders, []);
});
