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

const readNotificationEvents = async (page: Page) => page.evaluate(() => window.__completionReminderNotifications?.read() ?? []);
const readAudioEvents = async (page: Page) => page.evaluate(() => window.__completionReminderAudio?.read() ?? []);

const waitForNotificationEvent = async (page: Page, expected: string) => {
  await expect.poll(() => readNotificationEvents(page)).toContain(expected);
};

const waitForAudioEvent = async (page: Page, expectedPattern: RegExp) => {
  await expect.poll(() => readAudioEvents(page)).toContainEqual(expect.stringMatching(expectedPattern));
};

const closeAllOpenWorkspaces = async (page: Page) => {
  const bootstrap = await invokeRpc<{
    ui_state: {
      open_workspace_ids: string[];
    };
  }>(page, 'workbench_bootstrap');

  for (const workspaceId of bootstrap.ui_state.open_workspace_ids) {
    await invokeRpc(page, 'close_workspace', { workspace_id: workspaceId });
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

test('runtime validation blocks workspace selection until required tools are installed', async ({ page }) => {
  const runtime = runtimeCommandMockState(page);
  runtime.claude = false;
  await closeAllOpenWorkspaces(page);

  await page.goto('/');

  await expect(page.getByTestId('runtime-validation-overlay')).toBeVisible();
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
  const reminderWorkspaceDir = await fs.mkdtemp(path.join(HOME_DIR, 'coder-studio-e2e-reminder-'));

  try {
    await createNotificationRecorder(page);
    await closeAllOpenWorkspaces(page);
    await launchWorkspaceByPath(page, reminderWorkspaceDir);
    await page.goto('/');
    await expect(page.getByTestId('workspace-topbar')).toBeVisible();

    const readReminderWorkspace = async () => {
      const bootstrap = await invokeRpc<{
        workspaces: Array<{
          workspace: { workspace_id: string; title: string; project_path: string };
          sessions: Array<{ id: number; title: string }>;
          view_state: { active_session_id: string };
        }>;
      }>(page, 'workbench_bootstrap');
      return bootstrap.workspaces.find((item) => item.workspace.project_path === reminderWorkspaceDir) ?? null;
    };

    const initialWorkspace = await readReminderWorkspace();
    expect(initialWorkspace).toBeTruthy();
    const initialSessionId = initialWorkspace!.view_state.active_session_id;

    await page.getByRole('button', { name: 'Split Vertically' }).first().click();
    const draftInputs = page.getByPlaceholder('Type to start a new task');
    const backgroundTaskTitle = 'Background task';
    await draftInputs.nth(1).fill(backgroundTaskTitle);
    await draftInputs.nth(1).press('Enter');

    await expect.poll(async () => (await readReminderWorkspace())?.sessions.length ?? 0).toBe(2);
    const workspaceAfterMaterialize = await readReminderWorkspace();
    expect(workspaceAfterMaterialize).toBeTruthy();
    const backgroundCandidate = workspaceAfterMaterialize!.sessions.find(
      (session) => session.id.toString() !== initialSessionId,
    );
    expect(backgroundCandidate).toBeTruthy();

    await page.locator('.agent-pane-card').first().click();

    await emitLifecycleEvent(page, {
      workspace_id: workspaceAfterMaterialize!.workspace.workspace_id,
      session_id: String(backgroundCandidate!.id),
      kind: 'tool_started',
      source_event: 'PreToolUse',
      data: JSON.stringify({ hook_event_name: 'PreToolUse' }),
    });

    await emitLifecycleEvent(page, {
      workspace_id: workspaceAfterMaterialize!.workspace.workspace_id,
      session_id: String(backgroundCandidate!.id),
      kind: 'turn_completed',
      source_event: 'Stop',
      data: JSON.stringify({ hook_event_name: 'Stop' }),
    });

    await waitForNotificationEvent(page, `notify:${backgroundTaskTitle}:${workspaceAfterMaterialize!.workspace.title} · Task complete`);
    await waitForAudioEvent(page, /play:.*task-complete\.(wav|mp3|ogg)/);
  } finally {
    await fs.rm(reminderWorkspaceDir, { recursive: true, force: true });
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
