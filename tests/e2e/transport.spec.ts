import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

type PollCommand = 'git_status' | 'git_changes' | 'worktree_list' | 'workspace_tree';

type PollCounts = Record<PollCommand, number>;

type PollingBaseline = {
  commands: PollCommand[];
  initialCounts: PollCounts;
  countsBeforeNextPoll: PollCounts;
  countsAfterNextPoll: PollCounts;
};

type WsEventFrame = {
  event: string;
  payload: Record<string, unknown>;
};

type WsTransportBaseline = {
  controlPlaneCommands: string[];
  websocketUrls: string[];
  workspaceId: string;
  sessionId: string;
  terminalFrame: WsEventFrame;
  agentFrame: WsEventFrame;
};

type ReconnectBaseline = {
  reconnectDelayMs: number;
  countsAtDisconnect: PollCounts;
  countsAfterReconnectBeforePoll: PollCounts;
  countsAfterNextPoll: PollCounts;
};

type WorkspaceHandle = {
  workspaceId: string;
  workspacePath: string;
  target: { type: 'native' | 'wsl'; distro?: string };
};

type TransportTrackerSnapshot = {
  urls: string[];
  connectTimes: number[];
  closeTimes: number[];
  scheduledTimeouts: number[];
  frames: string[];
};

type BackendEnvelope = {
  type?: string;
  event?: string;
  payload?: Record<string, unknown>;
};

const POLL_COMMANDS: PollCommand[] = [
  'git_status',
  'git_changes',
  'worktree_list',
  'workspace_tree',
];
const WS_RECONNECT_DELAY_MS = 800;
const WORKSPACE_PATH = process.cwd();

const incrementCounts = (counts: PollCounts) => ({
  git_status: counts.git_status + 1,
  git_changes: counts.git_changes + 1,
  worktree_list: counts.worktree_list + 1,
  workspace_tree: counts.workspace_tree + 1,
});

const emptyPollCounts = (): PollCounts => ({
  git_status: 0,
  git_changes: 0,
  worktree_list: 0,
  workspace_tree: 0,
});

test.describe('workspace transport baseline', () => {
  test('legacy polling refreshes git/tree/worktree on the 4-second cadence', async ({ page }) => {
    const baseline = await observePollingBaseline(page);

    expect(baseline.commands).toEqual(POLL_COMMANDS);
    expect(baseline.initialCounts).toEqual({
      git_status: expect.any(Number),
      git_changes: expect.any(Number),
      worktree_list: expect.any(Number),
      workspace_tree: expect.any(Number),
    });
    expect(Object.values(baseline.initialCounts).every((count) => count >= 1)).toBe(true);
    expect(baseline.countsBeforeNextPoll).toEqual(baseline.initialCounts);
    expect(baseline.countsAfterNextPoll).toEqual(incrementCounts(baseline.initialCounts));
  });

  test('terminal and agent streams still arrive over /ws', async ({ page }) => {
    const baseline = await observeWsTransport(page);

    expect(baseline.controlPlaneCommands).toEqual([
      'terminal_create',
      'terminal_write',
      'create_session',
      'agent_start',
      'agent_send',
    ]);
    expect(baseline.websocketUrls.some((url) => url.includes('/ws'))).toBe(true);
    expect(baseline.terminalFrame.event).toBe('terminal://event');
    expect(baseline.terminalFrame.payload.workspace_id).toBe(baseline.workspaceId);
    expect(String(baseline.terminalFrame.payload.data ?? '')).toContain('transport-terminal');
    expect(baseline.agentFrame.event).toBe('agent://event');
    expect(baseline.agentFrame.payload.workspace_id).toBe(baseline.workspaceId);
    expect(baseline.agentFrame.payload.session_id).toBe(baseline.sessionId);
    expect(String(baseline.agentFrame.payload.data ?? '')).toContain('transport-agent');
  });

  test('websocket reconnect does not self-heal resource state before polling', async ({ page }) => {
    const baseline = await observeReconnectBaseline(page);

    expect(baseline.reconnectDelayMs).toBe(WS_RECONNECT_DELAY_MS);
    expect(baseline.countsAfterReconnectBeforePoll).toEqual(baseline.countsAtDisconnect);
    expect(baseline.countsAfterNextPoll).toEqual(incrementCounts(baseline.countsAtDisconnect));
  });
});

async function observePollingBaseline(page: Page): Promise<PollingBaseline> {
  const probe = await installTransportProbe(page);
  await openWorkspace(page);
  await waitForPollCycle(probe.counts);
  await page.waitForTimeout(250);

  const initialCounts = snapshotCounts(probe.counts);
  const commands = [...probe.initialCommandOrder];

  await page.waitForTimeout(3000);
  const countsBeforeNextPoll = snapshotCounts(probe.counts);
  await waitForCounts(probe.counts, incrementCounts(initialCounts));
  const countsAfterNextPoll = snapshotCounts(probe.counts);

  return {
    commands,
    initialCounts,
    countsBeforeNextPoll,
    countsAfterNextPoll,
  };
}

async function observeWsTransport(page: Page): Promise<WsTransportBaseline> {
  await installTransportProbe(page);
  const workspace = await openWorkspace(page);
  await expect.poll(async () => (await readTransportTracker(page)).urls.length).toBeGreaterThan(0);

  const controlPlaneCommands: string[] = [];

  const terminal = await invokeRpc<{ id: number }>(page, 'terminal_create', {
    workspaceId: workspace.workspaceId,
    cwd: workspace.workspacePath,
    target: workspace.target,
    cols: 120,
    rows: 30,
  });
  controlPlaneCommands.push('terminal_create');

  await invokeRpc(page, 'terminal_write', {
    workspaceId: workspace.workspaceId,
    terminalId: terminal.id,
    input: 'printf "transport-terminal\\n"\r',
  });
  controlPlaneCommands.push('terminal_write');

  const session = await invokeRpc<{ id: number }>(page, 'create_session', {
    workspaceId: workspace.workspaceId,
    mode: 'branch',
  });
  const sessionId = String(session.id);
  controlPlaneCommands.push('create_session');

  await invokeRpc(page, 'agent_start', {
    workspaceId: workspace.workspaceId,
    sessionId,
    provider: 'shell',
    command: 'cat',
    cols: 120,
    rows: 30,
  });
  controlPlaneCommands.push('agent_start');

  await invokeRpc(page, 'agent_send', {
    workspaceId: workspace.workspaceId,
    sessionId,
    input: 'transport-agent',
    appendNewline: true,
  });
  controlPlaneCommands.push('agent_send');

  const terminalFrame = await waitForWsEvent(
    page,
    'terminal://event',
    (payload) => payload.workspace_id === workspace.workspaceId && String(payload.data ?? '').includes('transport-terminal'),
  );
  const agentFrame = await waitForWsEvent(
    page,
    'agent://event',
    (payload) => payload.workspace_id === workspace.workspaceId
      && payload.session_id === sessionId
      && String(payload.data ?? '').includes('transport-agent'),
  );
  const tracker = await readTransportTracker(page);

  return {
    controlPlaneCommands,
    websocketUrls: tracker.urls,
    workspaceId: workspace.workspaceId,
    sessionId,
    terminalFrame,
    agentFrame,
  };
}

async function observeReconnectBaseline(page: Page): Promise<ReconnectBaseline> {
  const probe = await installTransportProbe(page);
  await openWorkspace(page);
  await waitForPollCycle(probe.counts);
  await expect.poll(async () => (await readTransportTracker(page)).connectTimes.length).toBeGreaterThan(0);
  await page.waitForTimeout(250);

  const trackerBeforeDisconnect = await readTransportTracker(page);
  const countsAtDisconnect = snapshotCounts(probe.counts);
  const connectCountBeforeDisconnect = trackerBeforeDisconnect.connectTimes.length;
  const closeCountBeforeDisconnect = trackerBeforeDisconnect.closeTimes.length;
  const scheduledTimeoutCountBeforeDisconnect = trackerBeforeDisconnect.scheduledTimeouts.length;

  await page.evaluate(() => {
    window.__transportTest?.closeMatching('/ws');
  });

  await expect.poll(async () => (await readTransportTracker(page)).closeTimes.length).toBeGreaterThan(closeCountBeforeDisconnect);
  await expect
    .poll(async () => (await readTransportTracker(page)).scheduledTimeouts.slice(scheduledTimeoutCountBeforeDisconnect), {
      timeout: 10000,
    })
    .toContain(WS_RECONNECT_DELAY_MS);
  await expect.poll(async () => (await readTransportTracker(page)).connectTimes.length).toBeGreaterThan(connectCountBeforeDisconnect);
  const tracker = await readTransportTracker(page);
  const reconnectDelayMs = tracker.scheduledTimeouts
    .slice(scheduledTimeoutCountBeforeDisconnect)
    .find((timeout) => timeout === WS_RECONNECT_DELAY_MS) ?? -1;
  const countsAfterReconnectBeforePoll = snapshotCounts(probe.counts);

  await waitForCounts(probe.counts, incrementCounts(countsAtDisconnect));
  const countsAfterNextPoll = snapshotCounts(probe.counts);

  return {
    reconnectDelayMs,
    countsAtDisconnect,
    countsAfterReconnectBeforePoll,
    countsAfterNextPoll,
  };
}

async function installTransportProbe(page: Page) {
  const counts = emptyPollCounts();
  const initialCommandOrder: PollCommand[] = [];

  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    const nativeSetTimeout = window.setTimeout.bind(window);
    const store = {
      urls: [] as string[],
      connectTimes: [] as number[],
      closeTimes: [] as number[],
      scheduledTimeouts: [] as number[],
      frames: [] as string[],
      sockets: [] as WebSocket[],
    };

    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      store.scheduledTimeouts.push(Number(timeout ?? 0));
      return nativeSetTimeout(handler, timeout, ...args);
    }) as typeof window.setTimeout;

    const TrackingWebSocket = function (this: WebSocket, url: string | URL, protocols?: string | string[]) {
      const socket = protocols === undefined
        ? new NativeWebSocket(url)
        : new NativeWebSocket(url, protocols);
      store.urls.push(String(url));
      store.connectTimes.push(Date.now());
      store.sockets.push(socket);
      socket.addEventListener('message', (event) => {
        store.frames.push(String(event.data));
      });
      socket.addEventListener('close', () => {
        store.closeTimes.push(Date.now());
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

    window.__transportTest = {
      read() {
        return {
          urls: [...store.urls],
          connectTimes: [...store.connectTimes],
          closeTimes: [...store.closeTimes],
          scheduledTimeouts: [...store.scheduledTimeouts],
          frames: [...store.frames],
        };
      },
      closeMatching(fragment: string) {
        store.sockets
          .filter((socket) => socket.url.includes(fragment))
          .forEach((socket) => socket.close());
      },
    };
  });

  await page.route('**/api/rpc/*', async (route) => {
    const command = rpcCommand(route.request().url());
    if (isPollCommand(command)) {
      counts[command] += 1;
      if (!initialCommandOrder.includes(command)) {
        initialCommandOrder.push(command);
      }
    }
    await route.continue();
  });

  return {
    counts,
    initialCommandOrder,
  };
}

async function openWorkspace(page: Page): Promise<WorkspaceHandle> {
  const launch = await invokeRpc<{
    snapshot: {
      workspace: {
        workspace_id: string;
        project_path: string;
        target: { type: 'native' | 'wsl'; distro?: string };
      };
    };
  }>(page, 'launch_workspace', {
    source: {
      kind: 'local',
      pathOrUrl: WORKSPACE_PATH,
      target: { type: 'native' },
    },
  });

  const workspaceId = launch.snapshot.workspace.workspace_id;
  await Promise.all([
    page.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().includes('/api/rpc/workbench_bootstrap'),
    ),
    page.goto(`/workspace/${workspaceId}`),
  ]);
  await expect(page.getByTestId('workspace-topbar')).toBeVisible();

  return {
    workspaceId,
    workspacePath: launch.snapshot.workspace.project_path,
    target: launch.snapshot.workspace.target,
  };
}

async function invokeRpc<T>(page: Page, command: string, payload: Record<string, unknown> = {}) {
  const response = await page.request.post(`/api/rpc/${command}`, { data: payload });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.ok).not.toBe(false);
  return body.data as T;
}

async function waitForPollCycle(counts: PollCounts) {
  await waitForCounts(counts, {
    git_status: 1,
    git_changes: 1,
    worktree_list: 1,
    workspace_tree: 1,
  });
}

async function waitForCounts(actual: PollCounts, expected: PollCounts) {
  await expect
    .poll(() => snapshotCounts(actual), {
      timeout: 10000,
    })
    .toEqual(expected);
}

function snapshotCounts(counts: PollCounts): PollCounts {
  return {
    git_status: counts.git_status,
    git_changes: counts.git_changes,
    worktree_list: counts.worktree_list,
    workspace_tree: counts.workspace_tree,
  };
}

function rpcCommand(url: string) {
  return url.split('/api/rpc/')[1]?.split('?')[0] ?? '';
}

function isPollCommand(command: string): command is PollCommand {
  return POLL_COMMANDS.includes(command as PollCommand);
}

async function readTransportTracker(page: Page): Promise<TransportTrackerSnapshot> {
  return page.evaluate(() => window.__transportTest!.read());
}

async function waitForWsEvent(
  page: Page,
  eventName: string,
  predicate: (payload: Record<string, unknown>) => boolean,
): Promise<WsEventFrame> {
  await expect
    .poll(async () => {
      const tracker = await readTransportTracker(page);
      const match = tracker.frames
        .map(parseBackendEnvelope)
        .find((frame): frame is WsEventFrame =>
          Boolean(frame)
          && frame.event === eventName
          && predicate(frame.payload),
        );
      return match ?? null;
    }, {
      timeout: 10000,
    })
    .not.toBeNull();

  const tracker = await readTransportTracker(page);
  return tracker.frames
    .map(parseBackendEnvelope)
    .find((frame): frame is WsEventFrame =>
      Boolean(frame)
      && frame.event === eventName
      && predicate(frame.payload),
    )!;
}

function parseBackendEnvelope(frame: string): WsEventFrame | null {
  try {
    const envelope = JSON.parse(frame) as BackendEnvelope;
    if (envelope.type !== 'event' || typeof envelope.event !== 'string' || !envelope.payload) {
      return null;
    }
    return {
      event: envelope.event,
      payload: envelope.payload,
    };
  } catch {
    return null;
  }
}

declare global {
  interface Window {
    __transportTest?: {
      read: () => TransportTrackerSnapshot;
      closeMatching: (fragment: string) => void;
    };
  }
}
