import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../apps/web/src/i18n';
import { createWorkspaceSessionActions } from '../apps/web/src/features/workspace/session-actions';
import { readWorkspaceSyncVersion } from '../apps/web/src/features/workspace/workspace-sync-version';
import type { AppSettings, Toast } from '../apps/web/src/types/app';
import type { WorkbenchState } from '../apps/web/src/state/workbench';

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

test('archiveSessionForTab unmounts the slot without creating a local archive snapshot', async () => {
  const locale = 'en';
  const t = createTranslator(locale);
  const stateRef = { current: createState() };

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
    withServiceFallback: async (_operation, fallback) => fallback,
    addToast: () => {},
  });

  await actions.archiveSessionForTab('ws-1', 'session-active');

  const tab = stateRef.current.tabs[0];
  assert.equal(tab?.archive.length ?? 0, 0);
  assert.equal(tab?.activeSessionId, tab?.sessions[0]?.id);
  assert.equal(tab?.sessions[0]?.isDraft, true);
  if (tab?.paneLayout.type === 'leaf') {
    assert.equal(tab.paneLayout.sessionId, tab.sessions[0]?.id);
  }
});

test('restoreSessionIntoPane bumps the workspace sync version before applying the restored session', async () => {
  const locale = 'en';
  const t = createTranslator(locale);
  const workspaceId = 'ws-restore-sync';
  const beforeVersion = readWorkspaceSyncVersion(workspaceId);
  const stateRef = {
    current: {
      activeTabId: workspaceId,
      layout: {
        leftWidth: 320,
        rightWidth: 320,
        rightSplit: 64,
        showCodePanel: false,
        showTerminalPanel: false,
      },
      overlay: {
        visible: false,
        mode: 'local' as const,
        input: '',
        target: { type: 'native' as const },
      },
      tabs: [
        {
          id: workspaceId,
          title: 'Workspace Restore',
          status: 'ready' as const,
          controller: {
            role: 'controller' as const,
            deviceId: 'device-a',
            clientId: 'client-a',
            fencingToken: 1,
            takeoverPending: false,
            takeoverRequestedBySelf: false,
          },
          agent: {
            provider: 'claude' as const,
            command: 'claude',
            useWsl: false,
          },
          git: { branch: 'main', changes: 0, lastCommit: 'abc123' },
          gitChanges: [],
          worktrees: [],
          sessions: [
            {
              id: 'draft-restore',
              title: 'Session 1',
              status: 'idle' as const,
              mode: 'branch' as const,
              autoFeed: true,
              queue: [],
              messages: [],
              unread: 0,
              lastActiveAt: 1,
              isDraft: true,
            },
          ],
          activeSessionId: 'draft-restore',
          archive: [],
          terminals: [],
          activeTerminalId: '',
          fileTree: [],
          changesTree: [],
          filePreview: {
            path: '',
            content: '',
            mode: 'preview' as const,
            originalContent: '',
            modifiedContent: '',
            dirty: false,
          },
          paneLayout: {
            type: 'leaf' as const,
            id: 'pane-draft',
            sessionId: 'draft-restore',
          },
          activePaneId: 'pane-draft',
          idlePolicy: {
            enabled: true,
            idleMinutes: 10,
            maxActive: 3,
            pressure: true,
          },
        },
      ],
    } satisfies WorkbenchState,
  };

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
    withServiceFallback: async (_operation, fallback) => {
      if (fallback === null) {
        return {
          session: {
            id: 7,
            title: 'History Restore Session',
            status: 'idle' as const,
            mode: 'branch' as const,
            auto_feed: true,
            queue: [],
            messages: [],
            unread: 0,
            last_active_at: 10,
            claude_session_id: 'claude-restore-sync',
          },
          alreadyActive: false,
        };
      }
      return fallback;
    },
    addToast: () => {},
  });

  const restored = await actions.restoreSessionIntoPane(workspaceId, '7');

  assert.equal(restored?.id, 7);
  assert.equal(readWorkspaceSyncVersion(workspaceId), beforeVersion + 1);
  assert.equal(stateRef.current.tabs[0]?.activeSessionId, '7');
  assert.equal(stateRef.current.tabs[0]?.sessions[0]?.title, 'History Restore Session');
});

test('restoreSessionIntoPane prunes orphan draft panes that are no longer backed by sessions', async () => {
  const locale = 'en';
  const t = createTranslator(locale);
  const workspaceId = 'ws-restore-prune';
  const stateRef = {
    current: {
      activeTabId: workspaceId,
      layout: {
        leftWidth: 320,
        rightWidth: 320,
        rightSplit: 64,
        showCodePanel: false,
        showTerminalPanel: false,
      },
      overlay: {
        visible: false,
        mode: 'local' as const,
        input: '',
        target: { type: 'native' as const },
      },
      tabs: [
        {
          id: workspaceId,
          title: 'Workspace Restore',
          status: 'ready' as const,
          controller: {
            role: 'controller' as const,
            deviceId: 'device-a',
            clientId: 'client-a',
            fencingToken: 1,
            takeoverPending: false,
            takeoverRequestedBySelf: false,
          },
          agent: {
            provider: 'codex' as const,
            command: 'codex',
            useWsl: false,
          },
          git: { branch: 'main', changes: 0, lastCommit: 'abc123' },
          gitChanges: [],
          worktrees: [],
          sessions: [
            {
              id: 'draft-current',
              title: 'Session 1',
              status: 'idle' as const,
              mode: 'branch' as const,
              provider: 'codex',
              autoFeed: true,
              queue: [],
              messages: [],
              unread: 0,
              lastActiveAt: 1,
              isDraft: true,
            },
          ],
          activeSessionId: 'draft-current',
          archive: [],
          terminals: [],
          activeTerminalId: '',
          fileTree: [],
          changesTree: [],
          filePreview: {
            path: '',
            content: '',
            mode: 'preview' as const,
            originalContent: '',
            modifiedContent: '',
            dirty: false,
          },
          paneLayout: {
            type: 'split' as const,
            id: 'split-draft',
            axis: 'vertical' as const,
            ratio: 0.5,
            first: {
              type: 'leaf' as const,
              id: 'pane-orphan',
              sessionId: 'draft-orphan',
            },
            second: {
              type: 'leaf' as const,
              id: 'pane-current',
              sessionId: 'draft-current',
            },
          },
          activePaneId: 'pane-current',
          idlePolicy: {
            enabled: true,
            idleMinutes: 10,
            maxActive: 3,
            pressure: true,
          },
        },
      ],
    } satisfies WorkbenchState,
  };

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
    withServiceFallback: async (_operation, fallback) => {
      if (fallback === null) {
        return {
          session: {
            id: 9,
            title: 'Recovered Session',
            status: 'idle' as const,
            mode: 'branch' as const,
            provider: 'codex' as const,
            auto_feed: true,
            queue: [],
            messages: [],
            unread: 0,
            last_active_at: 10,
            resume_id: null,
          },
          alreadyActive: false,
        };
      }
      return fallback;
    },
    addToast: () => {},
  });

  await actions.restoreSessionIntoPane(workspaceId, '9');

  const tab = stateRef.current.tabs[0];
  assert.equal(tab?.sessions.length, 1);
  assert.equal(tab?.sessions[0]?.id, '9');
  assert.equal(tab?.paneLayout.type, 'leaf');
  if (tab?.paneLayout.type === 'leaf') {
    assert.equal(tab.paneLayout.sessionId, '9');
    assert.equal(tab.activePaneId, tab.paneLayout.id);
  }
});

test('restoreSessionIntoPane can open history restore in a new pane without replacing the active draft pane', async () => {
  const locale = 'en';
  const t = createTranslator(locale);
  const workspaceId = 'ws-restore-new-pane';
  const stateRef = {
    current: {
      activeTabId: workspaceId,
      layout: {
        leftWidth: 320,
        rightWidth: 320,
        rightSplit: 64,
        showCodePanel: false,
        showTerminalPanel: false,
      },
      overlay: {
        visible: false,
        mode: 'local' as const,
        input: '',
        target: { type: 'native' as const },
      },
      tabs: [
        {
          id: workspaceId,
          title: 'Workspace Restore',
          status: 'ready' as const,
          controller: {
            role: 'controller' as const,
            deviceId: 'device-a',
            clientId: 'client-a',
            fencingToken: 1,
            takeoverPending: false,
            takeoverRequestedBySelf: false,
          },
          agent: {
            provider: 'claude' as const,
            command: 'claude',
            useWsl: false,
          },
          git: { branch: 'main', changes: 0, lastCommit: 'abc123' },
          gitChanges: [],
          worktrees: [],
          sessions: [
            {
              id: 'draft-current',
              title: 'New Session',
              status: 'idle' as const,
              mode: 'branch' as const,
              provider: 'claude' as const,
              autoFeed: true,
              queue: [],
              messages: [],
              unread: 0,
              lastActiveAt: 1,
              isDraft: true,
            },
          ],
          activeSessionId: 'draft-current',
          archive: [],
          terminals: [],
          activeTerminalId: '',
          fileTree: [],
          changesTree: [],
          filePreview: {
            path: '',
            content: '',
            mode: 'preview' as const,
            originalContent: '',
            modifiedContent: '',
            dirty: false,
          },
          paneLayout: {
            type: 'leaf' as const,
            id: 'pane-current',
            sessionId: 'draft-current',
          },
          activePaneId: 'pane-current',
          idlePolicy: {
            enabled: true,
            idleMinutes: 10,
            maxActive: 3,
            pressure: true,
          },
        },
      ],
    } satisfies WorkbenchState,
  };

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
    withServiceFallback: async (_operation, fallback) => {
      if (fallback === null) {
        return {
          session: {
            id: 12,
            title: 'Recovered Session',
            status: 'idle' as const,
            mode: 'branch' as const,
            provider: 'claude' as const,
            auto_feed: true,
            queue: [],
            messages: [],
            unread: 0,
            last_active_at: 10,
            claude_session_id: 'claude-restore-new-pane',
          },
          alreadyActive: false,
        };
      }
      return fallback;
    },
    addToast: () => {},
  });

  await actions.restoreSessionIntoPane(
    workspaceId,
    '12',
    'pane-current',
    {
      availability: 'available',
      provider: 'claude',
      resumeId: 'claude-restore-new-pane',
    },
    {
      strategy: 'split-new',
    },
  );

  const tab = stateRef.current.tabs[0];
  assert.equal(tab?.sessions.length, 2);
  assert.equal(tab?.paneLayout.type, 'split');
  if (tab?.paneLayout.type === 'split') {
    assert.equal(tab.paneLayout.first.id, 'pane-current');
    assert.equal(tab.paneLayout.first.sessionId, 'draft-current');
    assert.equal(tab.paneLayout.second.sessionId, '12');
    assert.equal(tab.activePaneId, tab.paneLayout.second.id);
    assert.notEqual(tab.activePaneId, 'pane-current');
  }
});
