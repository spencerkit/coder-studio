import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

type WsEventEnvelope = {
  type: 'event';
  event: string;
  payload: Record<string, unknown>;
};

const HOME_DIR = os.homedir();
const TAB_STABILITY_DIRS = [
  path.join(HOME_DIR, 'coder-studio-e2e-tab-a'),
  path.join(HOME_DIR, 'coder-studio-e2e-tab-b'),
];
const TAB_STABILITY_LABELS = TAB_STABILITY_DIRS.map((dir) => path.basename(dir));

type RuntimeCommandMockState = {
  claude: boolean;
  git: boolean;
  delayMs: number;
};

const runtimeCommandMockStates = new WeakMap<Page, RuntimeCommandMockState>();

const commandBinary = (command: string | undefined) => command?.trim().split(/\s+/, 1)[0] ?? '';

const installRuntimeCommandMock = async (page: Page, initial?: Partial<RuntimeCommandMockState>) => {
  const state: RuntimeCommandMockState = {
    claude: true,
    git: true,
    delayMs: 0,
    ...initial,
  };
  runtimeCommandMockStates.set(page, state);

  await page.route('**/api/rpc/command_exists', async (route) => {
    const body = route.request().postDataJSON() as { command?: string } | null;
    const command = body?.command ?? '';
    const binary = commandBinary(command);
    if (binary !== 'claude' && binary !== 'git') {
      await route.fallback();
      return;
    }

    if (state.delayMs > 0) {
      await page.waitForTimeout(state.delayMs);
    }

    const available = binary === 'claude' ? state.claude : state.git;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          command,
          available,
          resolved_path: available ? `/mock/bin/${binary}` : null,
          error: available ? null : `\`${binary}\` was not found`,
        },
      }),
    });
  });
};

const runtimeCommandMockState = (page: Page) => {
  const state = runtimeCommandMockStates.get(page);
  expect(state, 'runtime command mock state').toBeTruthy();
  return state as RuntimeCommandMockState;
};

const gotoWorkspaceRoot = async (page: Page) => {
  await Promise.all([
    page.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().includes('/api/rpc/workbench_bootstrap')
    ),
    page.goto('/'),
  ]);
  await page.waitForFunction(() =>
    Boolean(document.querySelector('[data-testid="overlay"]'))
    || document.querySelectorAll('.workspace-top-tab').length > 0
  );
};

const countWorkspaceTabs = async (page: Page) => page.locator('.workspace-top-tab').count();

const workspaceLabelForPath = (workspacePath: string) => path.basename(workspacePath) || workspacePath;

const openLaunchOverlay = async (page: Page) => {
  await gotoWorkspaceRoot(page);
  const overlay = page.getByTestId('overlay');
  if (await overlay.isVisible()) {
    await expect(overlay).toBeVisible();
    return;
  }

  await expect.poll(() => countWorkspaceTabs(page)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Add workspace' }).click();
  await expect(overlay).toBeVisible();
};

const launchLocalWorkspace = async (page: Page) => {
  await gotoWorkspaceRoot(page);
  if (await countWorkspaceTabs(page)) {
    const activeLabel = (await page.locator('.workspace-top-tab.active .session-top-label').textContent())?.trim();
    return activeLabel ?? '';
  }

  await openLaunchOverlay(page);
  await expect(page.getByTestId('choice-local-only')).toBeVisible();
  await expect(page.getByTestId('folder-select')).toBeVisible();

  await page.getByRole('button', { name: 'Home' }).click();
  const selectedPath = ((await page.locator('[data-testid="folder-select"] .web-folder-picker-paths strong').textContent()) ?? '').trim();
  await expect(page.getByTestId('start-workspace')).toBeEnabled();
  await page.getByTestId('start-workspace').click();
  await expect(page.getByTestId('overlay')).toHaveCount(0);
  await expect(page.getByTestId('workspace-topbar')).toBeVisible();
  return workspaceLabelForPath(selectedPath);
};

const invokeRpc = async <T>(page: Page, command: string, payload: Record<string, unknown> = {}) => {
  const response = await page.request.post(`/api/rpc/${command}`, { data: payload });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.ok).not.toBe(false);
  return body.data as T;
};

const patchSystemConfig = async (request: APIRequestContext, updates: Record<string, unknown>) => {
  const response = await request.patch('http://127.0.0.1:4173/api/system/config', {
    data: { updates },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.ok).not.toBe(false);
  return body.data as {
    config: {
      root: { path?: string | null };
    };
  };
};

const readSystemConfig = async (request: APIRequestContext) => {
  const response = await request.get('http://127.0.0.1:4173/api/system/config');
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.ok).not.toBe(false);
  return body.data as {
    root: { path?: string | null };
  };
};

const launchWorkspaceByPath = async (page: Page, workspacePath: string) => {
  await invokeRpc(page, 'launch_workspace', {
    source: {
      kind: 'local',
      pathOrUrl: workspacePath,
      target: { type: 'native' },
    },
  });
};

const readWorkspaceTabLabels = async (page: Page) =>
  page.locator('.workspace-top-tab .session-top-label').evaluateAll((nodes) =>
    nodes.map((node) => node.textContent?.trim() ?? '').filter(Boolean)
  );

const installTransportTracker = async (page: Page) => {
  await page.addInitScript(() => {
    const store = {
      sockets: [] as WebSocket[],
    };

    const NativeWebSocket = window.WebSocket;
    const TrackingWebSocket = function (this: WebSocket, url: string | URL, protocols?: string | string[]) {
      const socket = protocols === undefined
        ? new NativeWebSocket(url)
        : new NativeWebSocket(url, protocols);
      store.sockets.push(socket);
      socket.addEventListener('close', () => {
        const index = store.sockets.indexOf(socket);
        if (index >= 0) {
          store.sockets.splice(index, 1);
        }
      });
      return socket;
    } as unknown as typeof WebSocket;

    TrackingWebSocket.prototype = NativeWebSocket.prototype;
    Object.setPrototypeOf(TrackingWebSocket, NativeWebSocket);
    window.WebSocket = TrackingWebSocket;

    window.__completionReminderTest = {
      emit(frame: string) {
        store.sockets.forEach((socket) => {
          socket.dispatchEvent(new MessageEvent('message', { data: frame }));
        });
      },
      socketCount() {
        return store.sockets.length;
      },
    };
  });
};

const emitLifecycleEvent = async (page: Page, payload: Record<string, unknown>) => {
  const frame: WsEventEnvelope = {
    type: 'event',
    event: 'agent://lifecycle',
    payload,
  };
  await page.evaluate((message) => {
    window.__completionReminderTest?.emit(message);
  }, JSON.stringify(frame));
};

const createNotificationRecorder = async (page: Page) => {
  await page.addInitScript(() => {
    const notificationEvents: string[] = [];
    const audioEvents: string[] = [];

    class NotificationMock {
      static permission = 'granted';

      static async requestPermission() {
        notificationEvents.push('requestPermission');
        return 'granted';
      }

      onclick: null | (() => void) = null;

      constructor(title: string, options: { body?: string }) {
        notificationEvents.push(`notify:${title}:${options.body ?? ''}`);
      }
    }

    class AudioMock {
      src: string;
      currentTime = 0;
      preload = '';

      constructor(src = '') {
        this.src = src;
      }

      async play() {
        audioEvents.push(`play:${this.src}`);
      }
    }

    Object.defineProperty(window, 'Notification', {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(window, 'Audio', {
      value: AudioMock,
      configurable: true,
      writable: true,
    });

    window.__completionReminderNotifications = {
      read: () => [...notificationEvents],
    };
    window.__completionReminderAudio = {
      read: () => [...audioEvents],
    };
  });
};

const seedDefaultAppSettings = async (page: Page) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('coder-studio.app-settings', JSON.stringify({
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
    }));
  });
};

const readNotificationEvents = async (page: Page) => page.evaluate(() => window.__completionReminderNotifications?.read() ?? []);
const readAudioEvents = async (page: Page) => page.evaluate(() => window.__completionReminderAudio?.read() ?? []);

const waitForNotificationEvent = async (page: Page, expected: string) => {
  await expect.poll(() => readNotificationEvents(page)).toContain(expected);
};

const waitForAudioEvent = async (page: Page, expectedPattern: RegExp) => {
  await expect.poll(() => readAudioEvents(page)).toContainEqual(expect.stringMatching(expectedPattern));
};

const waitForReminderSocket = async (page: Page) => {
  await expect.poll(() => page.evaluate(() => window.__completionReminderTest?.socketCount() ?? 0)).toBeGreaterThan(0);
};

const ensureCompletionReminderSettingsEnabled = async (page: Page, stayOnSettings = false) => {
  await page.getByTestId('settings-open').click();
  await expect(page.getByTestId('settings-page')).toBeVisible();

  const completionToggle = page.getByTestId('settings-completion-notifications');
  const backgroundToggle = page.getByTestId('settings-notify-only-background');
  if (!await completionToggle.isChecked()) {
    await page.locator('label:has([data-testid="settings-completion-notifications"])').click();
  }
  if (!await backgroundToggle.isChecked()) {
    await page.locator('label:has([data-testid="settings-notify-only-background"])').click();
  }

  await expect(completionToggle).toBeChecked();
  await expect(backgroundToggle).toBeChecked();

  if (!stayOnSettings) {
    await page.getByRole('button', { name: 'Back to app' }).click();
    await expect(page.getByTestId('workspace-topbar')).toBeVisible();
  }

  await waitForReminderSocket(page);
  await page.waitForTimeout(1000);
};

type ReminderWorkspaceSnapshot = {
  workspace: { workspace_id: string; title: string; project_path: string };
  sessions: Array<{ id: number; title: string }>;
  view_state: { active_session_id: string };
};

const readWorkspaceByPath = async (page: Page, workspacePath: string) => {
  const bootstrap = await invokeRpc<{
    ui_state: {
      active_workspace_id?: string | null;
    };
    workspaces: ReminderWorkspaceSnapshot[];
  }>(page, 'workbench_bootstrap');

  return {
    activeWorkspaceId: bootstrap.ui_state.active_workspace_id ?? null,
    workspace: bootstrap.workspaces.find((item) => item.workspace.project_path === workspacePath) ?? null,
  };
};

const launchReminderWorkspacePair = async (page: Page, prefix: string) => {
  const backgroundWorkspaceDir = await fs.mkdtemp(path.join(HOME_DIR, `${prefix}-background-`));
  const foregroundWorkspaceDir = await fs.mkdtemp(path.join(HOME_DIR, `${prefix}-foreground-`));

  try {
    await closeAllOpenWorkspaces(page);
    await launchWorkspaceByPath(page, backgroundWorkspaceDir);
    await launchWorkspaceByPath(page, foregroundWorkspaceDir);
    await page.goto('/');
    await expect(page.getByTestId('workspace-topbar')).toBeVisible();
    await waitForReminderSocket(page);

    const background = await readWorkspaceByPath(page, backgroundWorkspaceDir);
    const foreground = await readWorkspaceByPath(page, foregroundWorkspaceDir);
    expect(background.workspace).toBeTruthy();
    expect(foreground.workspace).toBeTruthy();
    expect(foreground.activeWorkspaceId).toBe(foreground.workspace!.workspace.workspace_id);

    return {
      background: background.workspace as ReminderWorkspaceSnapshot,
      foreground: foreground.workspace as ReminderWorkspaceSnapshot,
      cleanup: async () => {
        await Promise.all([
          fs.rm(backgroundWorkspaceDir, { recursive: true, force: true }),
          fs.rm(foregroundWorkspaceDir, { recursive: true, force: true }),
        ]);
      },
    };
  } catch (error) {
    await Promise.all([
      fs.rm(backgroundWorkspaceDir, { recursive: true, force: true }),
      fs.rm(foregroundWorkspaceDir, { recursive: true, force: true }),
    ]);
    throw error;
  }
};

const currentWorkspaceController = async (
  page: Page,
  workspaceId: string,
  ids?: { deviceId: string; clientId: string },
) => {
  const controllerIds = ids ?? await page.evaluate(() => ({
    deviceId: window.localStorage.getItem('coder-studio.workspace-device-id') ?? '',
    clientId: window.sessionStorage.getItem('coder-studio.workspace-client-id') ?? '',
  }));
  let fencingToken = 0;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const runtime = await invokeRpc<{
      controller: {
        controller_device_id?: string | null;
        controller_client_id?: string | null;
        fencing_token: number;
      };
    }>(page, 'workspace_runtime_attach', {
      workspaceId,
      deviceId: controllerIds.deviceId,
      clientId: controllerIds.clientId,
    });
    fencingToken = runtime.controller.fencing_token;
    if (
      runtime.controller.controller_device_id === controllerIds.deviceId
      && runtime.controller.controller_client_id === controllerIds.clientId
    ) {
      return {
        workspaceId,
        deviceId: controllerIds.deviceId,
        clientId: controllerIds.clientId,
        fencingToken,
      };
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`failed to acquire controller for workspace ${workspaceId}; last token=${fencingToken}`);
};

const closeAllOpenWorkspaces = async (page: Page) => {
  const bootstrap = await invokeRpc<{
    ui_state: {
      open_workspace_ids: string[];
    };
  }>(page, 'workbench_bootstrap');

  for (const workspaceId of bootstrap.ui_state.open_workspace_ids) {
    const controller = await currentWorkspaceController(page, workspaceId, {
      deviceId: 'cleanup-device',
      clientId: 'cleanup-client',
    });
    await invokeRpc(page, 'close_workspace', controller);
  }
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem('coder-studio.test-init')) {
      window.localStorage.setItem('coder-studio.locale', 'en');
      window.localStorage.removeItem('coder-studio.workbench');
      window.localStorage.removeItem('coder-studio.app-settings');
      window.sessionStorage.setItem('coder-studio.test-init', '1');
    }
  });
  await installTransportTracker(page);
  await installRuntimeCommandMock(page);
  await closeAllOpenWorkspaces(page);
});

test.beforeAll(async () => {
  await Promise.all(TAB_STABILITY_DIRS.map((dir) => fs.mkdir(dir, { recursive: true })));
});

test.afterAll(async () => {
  await Promise.all(TAB_STABILITY_DIRS.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

test('local workspace flow opens the workspace shell', async ({ page }) => {
  const expectedLabel = await launchLocalWorkspace(page);
  await expect(page.getByTestId('workspace-topbar')).toContainText(expectedLabel);
  await expect(page.getByTestId('settings-open')).toBeVisible();
});

test('launch overlay shows the server-side folder picker shell', async ({ page }) => {
  await openLaunchOverlay(page);

  await expect(page.getByTestId('choice-local-only')).toBeVisible();
  await expect(page.getByTestId('folder-select')).toBeVisible();
  await expect(page.getByTestId('folder-selected')).toBeVisible();
  await expect(page.getByTestId('start-workspace')).toBeVisible();
});

test('flat matte UI exposes compact shell and supporting screen markers', async ({ page }) => {
  await openLaunchOverlay(page);
  await expect(page.getByTestId('launch-overlay-shell')).toBeVisible();
  await expect(page.getByTestId('launch-overlay-shell')).toHaveAttribute('data-density', 'compact');

  const expectedLabel = await launchLocalWorkspace(page);
  await expect(page.getByTestId('workspace-topbar')).toContainText(expectedLabel);
  await expect(page.getByTestId('workspace-status-strip')).toBeVisible();
  await expect(page.getByTestId('workspace-status-strip')).toContainText('Branch');
  await expect(page.getByTestId('workspace-status-strip')).toContainText('Runtime');
  await expect(page.getByTestId('workspace-status-strip')).toContainText('Changes');
  await expect(page.getByTestId('workspace-status-strip')).toContainText('Queue');
  await expect(page.locator('.agent-pane-state-tag').first()).toBeVisible();
  await expect(page.locator('.agent-pane-state-tag').first()).toHaveText(/Ready|Queued|Suspended|Running|Background/);

  await page.getByRole('button', { name: 'Actions' }).click();
  await expect(page.getByTestId('command-palette-shell')).toBeVisible();
  await expect(page.getByTestId('command-palette-shell')).toHaveAttribute('data-density', 'compact');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Code' }).click();
  await page.getByRole('button', { name: 'Expand code area' }).click();
  await expect(page.getByTestId('workspace-review-dock')).toBeVisible();
  await expect(page.getByTestId('workspace-review-dock-tabs')).toBeVisible();

  await page.getByRole('button', { name: 'Git Diff' }).click();
  await expect(page.getByTestId('workspace-review-dock')).toHaveAttribute('data-view', 'git');
  await expect(page.getByTestId('workspace-review-dock-toolbar')).toBeVisible();
  await expect(page.getByTestId('git-commit-message')).toBeVisible();

  await page.getByTestId('settings-open').click();
  await expect(page.getByTestId('settings-page')).toHaveAttribute('data-density', 'compact');
  await expect(page.getByTestId('settings-summary')).toBeVisible();
});

test('runtime validation blocks workspace selection until required tools are installed', async ({ page }) => {
  const runtime = runtimeCommandMockState(page);
  runtime.claude = false;
  await closeAllOpenWorkspaces(page);

  await page.goto('/');

  await expect(page.getByTestId('runtime-validation-overlay')).toBeVisible();
  await expect(page.getByTestId('runtime-validation-overlay')).toHaveAttribute('data-density', 'compact');
  await expect(page.getByTestId('overlay')).toHaveCount(0);
  await expect(page.getByText('Required tools are missing. Install them first before entering workspace selection.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry Check' })).toBeEnabled();

  runtime.claude = true;
  await page.getByRole('button', { name: 'Retry Check' }).click();

  await expect(page.getByTestId('runtime-validation-overlay')).toHaveCount(0);
  await expect(page.getByTestId('overlay')).toBeVisible();
  await expect(page.getByTestId('folder-select')).toBeVisible();
});

test('settings appearance controls can switch locale', async ({ page }) => {
  await launchLocalWorkspace(page);
  await page.getByTestId('settings-open').click();
  await page.getByRole('button', { name: 'Appearance' }).click();
  await page.getByRole('button', { name: '中文' }).click();
  await expect(page.getByRole('button', { name: '返回应用' })).toBeVisible();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('button', { name: 'Back to app' })).toBeVisible();
});

test('settings general panel shows completion reminder controls', async ({ page }) => {
  await launchLocalWorkspace(page);
  await page.getByTestId('settings-open').click();

  await expect(page.getByTestId('settings-page')).toBeVisible();
  await expect(page.getByTestId('settings-completion-notifications')).toBeChecked();
  await expect(page.getByTestId('settings-notify-only-background')).toBeChecked();
  await expect(page.getByTestId('settings-notification-permission')).toHaveText('Not enabled');
});

test('completion reminder settings persist across route changes and reloads', async ({ page }) => {
  await launchLocalWorkspace(page);
  await page.getByTestId('settings-open').click();

  await expect(page.getByTestId('settings-page')).toBeVisible();
  await page.locator('label:has([data-testid="settings-completion-notifications"])').click();
  await page.locator('label:has([data-testid="settings-notify-only-background"])').click();
  await expect(page.getByTestId('settings-completion-notifications')).not.toBeChecked();
  await expect(page.getByTestId('settings-notify-only-background')).not.toBeChecked();

  await page.getByRole('button', { name: 'Back to app' }).click();
  await expect(page.getByTestId('workspace-topbar')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('overlay')).toHaveCount(0);
  await page.getByTestId('settings-open').click();
  await expect(page.getByTestId('settings-completion-notifications')).not.toBeChecked();
  await expect(page.getByTestId('settings-notify-only-background')).not.toBeChecked();
});

test('background turn_completed sends a completion reminder notification', async ({ page }) => {
  let cleanup = async () => {};

  try {
    await createNotificationRecorder(page);
    await seedDefaultAppSettings(page);
    const pair = await launchReminderWorkspacePair(page, 'coder-studio-e2e-reminder');
    cleanup = pair.cleanup;
    await ensureCompletionReminderSettingsEnabled(page, false);
    const backgroundSessionId = pair.background.view_state.active_session_id;
    const backgroundSession = pair.background.sessions.find(
      (session) => session.id.toString() === backgroundSessionId,
    );
    expect(backgroundSession).toBeTruthy();

    await emitLifecycleEvent(page, {
      workspace_id: pair.background.workspace.workspace_id,
      session_id: backgroundSessionId,
      kind: 'tool_started',
      source_event: 'PreToolUse',
      data: JSON.stringify({ hook_event_name: 'PreToolUse' }),
    });
    await page.waitForTimeout(150);

    await emitLifecycleEvent(page, {
      workspace_id: pair.background.workspace.workspace_id,
      session_id: backgroundSessionId,
      kind: 'turn_completed',
      source_event: 'Stop',
      data: JSON.stringify({ hook_event_name: 'Stop' }),
    });

    await waitForNotificationEvent(
      page,
      `notify:${backgroundSession!.title}:${pair.background.workspace.title} · Task complete`,
    );
    await waitForAudioEvent(page, /play:.*task-complete\.(wav|mp3|ogg)/);
  } finally {
    await cleanup();
  }
});

test('background turn_completed still sends a reminder while viewing settings', async ({ page }) => {
  let cleanup = async () => {};

  try {
    await createNotificationRecorder(page);
    await seedDefaultAppSettings(page);
    const pair = await launchReminderWorkspacePair(page, 'coder-studio-e2e-reminder-settings');
    cleanup = pair.cleanup;
    await ensureCompletionReminderSettingsEnabled(page, false);
    const backgroundSessionId = pair.background.view_state.active_session_id;
    const backgroundSession = pair.background.sessions.find(
      (session) => session.id.toString() === backgroundSessionId,
    );
    expect(backgroundSession).toBeTruthy();

    await emitLifecycleEvent(page, {
      workspace_id: pair.background.workspace.workspace_id,
      session_id: backgroundSessionId,
      kind: 'tool_started',
      source_event: 'PreToolUse',
      data: JSON.stringify({ hook_event_name: 'PreToolUse' }),
    });
    await page.waitForTimeout(150);

    await page.getByTestId('settings-open').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await waitForReminderSocket(page);
    await page.waitForTimeout(1000);

    await emitLifecycleEvent(page, {
      workspace_id: pair.background.workspace.workspace_id,
      session_id: backgroundSessionId,
      kind: 'turn_completed',
      source_event: 'Stop',
      data: JSON.stringify({ hook_event_name: 'Stop' }),
    });

    await waitForNotificationEvent(
      page,
      `notify:${backgroundSession!.title}:${pair.background.workspace.title} · Task complete`,
    );
    await waitForAudioEvent(page, /play:.*task-complete\.(wav|mp3|ogg)/);
  } finally {
    await cleanup();
  }
});

test('settings persist across route changes and reloads', async ({ page }) => {
  await launchLocalWorkspace(page);
  await page.getByTestId('settings-open').click();

  await expect(page.getByTestId('settings-page')).toBeVisible();
  await page.getByTestId('settings-agent-command').fill('claude --print');
  await page.getByTestId('settings-max-active').fill('5');

  await page.getByRole('button', { name: 'Back to app' }).click();
  await expect(page.getByTestId('workspace-topbar')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('overlay')).toHaveCount(0);
  await page.getByTestId('settings-open').click();
  await expect(page.getByTestId('settings-agent-command')).toHaveValue('claude --print');
  await expect(page.getByTestId('settings-max-active')).toHaveValue('5');
});

test('restores the last workspace after reload', async ({ page }) => {
  const expectedLabel = await launchLocalWorkspace(page);
  await page.reload();

  await expect(page.getByTestId('overlay')).toHaveCount(0);
  await expect(page.getByTestId('workspace-topbar')).toContainText(expectedLabel);
});

test('workspace tabs keep a stable order when switching between workspaces', async ({ page }) => {
  await launchWorkspaceByPath(page, TAB_STABILITY_DIRS[0]);
  await launchWorkspaceByPath(page, TAB_STABILITY_DIRS[1]);
  await page.goto('/');
  await expect(page.getByTestId('workspace-topbar')).toBeVisible();

  const initialOrder = await readWorkspaceTabLabels(page);
  const initialFirstIndex = initialOrder.indexOf(TAB_STABILITY_LABELS[0]);
  const initialSecondIndex = initialOrder.indexOf(TAB_STABILITY_LABELS[1]);
  expect(initialFirstIndex).toBeGreaterThanOrEqual(0);
  expect(initialSecondIndex).toBeGreaterThan(initialFirstIndex);

  await page.locator('.workspace-top-tab').filter({ hasText: TAB_STABILITY_LABELS[0] }).click();
  await expect(page.locator('.workspace-top-tab.active .session-top-label')).toHaveText(TAB_STABILITY_LABELS[0]);
  await expect.poll(() => readWorkspaceTabLabels(page)).toEqual(initialOrder);

  await page.locator('.workspace-top-tab').filter({ hasText: TAB_STABILITY_LABELS[1] }).click();
  await expect(page.locator('.workspace-top-tab.active .session-top-label')).toHaveText(TAB_STABILITY_LABELS[1]);
  await expect.poll(() => readWorkspaceTabLabels(page)).toEqual(initialOrder);
});

test('release runtime allows sign-in from a remote HTTP host', async ({ page, request, baseURL }) => {
  test.skip(!baseURL?.includes(':4173'), 'Release runtime only');

  const currentConfig = await readSystemConfig(request);
  const originalRootPath = currentConfig.root.path ?? null;

  try {
    await patchSystemConfig(request, {
      'auth.password': REMOTE_HTTP_PASSWORD,
      'root.path': process.cwd(),
    });

    await page.route('**/*', async (route) => {
      await route.fallback({
        headers: {
          ...route.request().headers(),
          'x-forwarded-host': REMOTE_HTTP_HOST,
          'x-forwarded-proto': 'http',
        },
      });
    });

    await page.goto('/?auth=force');
    await expect(page.getByRole('heading', { name: 'Unlock Coder Studio' })).toBeVisible();
    await expect(page.getByText('HTTPS is required on this host')).toHaveCount(0);

    await page.getByPlaceholder('Enter passphrase').fill(REMOTE_HTTP_PASSWORD);
    await page.getByRole('button', { name: 'Enter workspace' }).click();

    await page.waitForFunction(() =>
      Boolean(document.querySelector('[data-testid="overlay"]'))
      || Boolean(document.querySelector('[data-testid="workspace-topbar"]'))
    );

    if (await page.getByTestId('overlay').count()) {
      await expect(page.getByTestId('overlay')).toBeVisible();
      await expect(page.getByTestId('folder-select')).toBeVisible();
    } else {
      await expect(page.getByTestId('workspace-topbar')).toBeVisible();
    }
  } finally {
    await patchSystemConfig(request, {
      'auth.password': null,
      'root.path': originalRootPath,
    });
  }
});
