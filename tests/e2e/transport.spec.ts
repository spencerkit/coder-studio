import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
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
  lifecycleFrame: WsEventFrame;
};

type ReconnectBaseline = {
  reconnectDelayMs: number;
  countsAtDisconnect: PollCounts;
  countsAfterReconnectBeforePoll: PollCounts;
  countsAfterNextPoll: PollCounts;
};

type ArtifactsDirtyBaseline = {
  dirtyFrame: WsEventFrame;
  savedPath: string;
};

type WatcherInvalidationBaseline = {
  dirtyFrame: WsEventFrame;
  workspacePath: string;
};

type GitIndexInvalidationBaseline = {
  workspacePath: string;
  countsAfterFileWrite: number;
  countsAfterGitAdd: number;
};

type WorkspaceHandle = {
  workspaceId: string;
  workspacePath: string;
  target: { type: 'native' | 'wsl'; distro?: string };
};

type WorkspaceControllerMutation = {
  workspaceId: string;
  deviceId: string;
  clientId: string;
  fencingToken: number;
};

type WorkspaceControllerLeaseSnapshot = {
  controller_device_id?: string | null;
  controller_client_id?: string | null;
  fencing_token: number;
  takeover_request_id?: string | null;
  takeover_requested_by_device_id?: string | null;
  takeover_requested_by_client_id?: string | null;
  takeover_deadline_at?: number | null;
};

type RpcCounts = Record<string, number>;

type TransportTrackerSnapshot = {
  urls: string[];
  connectTimes: number[];
  openTimes: number[];
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
const BACKEND_WS_PATH = '/ws';
const WS_RECONNECT_DELAY_MS = 800;
const WORKSPACE_PATH = process.cwd();
const WORKSPACE_PROBE_FILE = path.join(WORKSPACE_PATH, 'package.json');
const AGENT_STDIN_ECHO_SCRIPT = path.join(WORKSPACE_PATH, 'tests/e2e/fixtures/agent-stdin-echo.mjs');
const AGENT_BURST_STREAM_SCRIPT = path.join(WORKSPACE_PATH, 'tests/e2e/fixtures/agent-burst-stream.mjs');
const AGENT_CLAUDE_LIFECYCLE_SCRIPT = path.join(WORKSPACE_PATH, 'tests/e2e/fixtures/claude-lifecycle-agent.mjs');
const AGENT_CLAUDE_REPLAY_DELAY_MS = 5000;
const AGENT_CLAUDE_RECOVERY_DELAY_MS = 12000;
const AGENT_START_SYSTEM_MESSAGE = 'Agent started / 智能体已启动';
const TRANSPORT_EVENT_TIMEOUT_MS = 20000;
const BURST_CHUNK_COUNT = readIntEnv('CODER_STUDIO_TEST_BURST_CHUNKS', 24, 1);
const BURST_INTERVAL_MS = readIntEnv('CODER_STUDIO_TEST_BURST_INTERVAL_MS', 2, 0);
const BURST_MAX_FRAMES = readIntEnv('CODER_STUDIO_TEST_BURST_MAX_FRAMES', 12, 1);
const TERMINAL_BURST_MAX_FRAMES = readIntEnv('CODER_STUDIO_TEST_TERMINAL_BURST_MAX_FRAMES', 14, 1);
const MIXED_BURST_MAX_TOTAL_FRAMES = readIntEnv('CODER_STUDIO_TEST_MIXED_BURST_MAX_TOTAL_FRAMES', 24, 1);
const BURST_EMIT_MEASURE = process.env.CODER_STUDIO_TEST_BURST_EMIT_MEASURE === '1';
const execFileAsync = promisify(execFile);
const DEFAULT_TRANSPORT_IDS = {
  deviceId: 'transport-default-device',
  clientId: 'transport-default-client',
};

const commandBinary = (command: string | undefined) => command?.trim().split(/\s+/, 1)[0] ?? '';
const splitCommandTokens = (command: string | undefined) => (command ?? '').trim().split(/\s+/).filter(Boolean);

async function prepareTransportPage(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.removeItem('coder-studio.workbench');
    window.localStorage.removeItem('coder-studio.app-settings');
  });
  await page.route('**/api/rpc/command_exists', async (route) => {
    const body = route.request().postDataJSON() as { command?: string } | null;
    const binary = commandBinary(body?.command);
    if (binary !== 'claude' && binary !== 'git') {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          command: body?.command ?? '',
          available: true,
          resolved_path: `/mock/bin/${binary}`,
          error: null,
        },
      }),
    });
  });

  await seedAppSettings(page, {});
}

async function seedAppSettings(
  page: Page,
  overrides: Partial<{
    agentProvider: 'claude';
    agentCommand: string;
    idlePolicy: {
      enabled: boolean;
      idleMinutes: number;
      maxActive: number;
      pressure: boolean;
    };
    completionNotifications: {
      enabled: boolean;
      onlyWhenBackground: boolean;
    };
    terminalCompatibilityMode: 'standard' | 'compatibility';
  }>,
) {
  const [executable = 'claude', ...startupArgs] = splitCommandTokens(overrides.agentCommand ?? 'claude');
  await invokeRpc(page, 'app_settings_update', {
    settings: {
      general: {
        locale: 'en',
        terminalCompatibilityMode: overrides.terminalCompatibilityMode ?? 'standard',
        completionNotifications: overrides.completionNotifications ?? {
          enabled: true,
          onlyWhenBackground: true,
        },
        idlePolicy: overrides.idlePolicy ?? {
          enabled: true,
          idleMinutes: 10,
          maxActive: 3,
          pressure: true,
        },
      },
      claude: {
        global: {
          executable,
          startupArgs,
          env: {},
          settingsJson: {},
          globalConfigJson: {},
        },
        overrides: {
          native: null,
          wsl: null,
        },
      },
    },
  });
}

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

test.beforeEach(async ({ page }) => {
  await prepareTransportPage(page);
  await closeAllOpenWorkspaces(page);
});

test.describe('workspace transport baseline', () => {
  test('fallback polling refreshes git/tree/worktree on the configured cadence', async ({ page }) => {
    const baseline = await observePollingBaseline(page);

    expect(baseline.commands).toEqual(POLL_COMMANDS);
    expect(baseline.initialCounts).toEqual({
      git_status: expect.any(Number),
      git_changes: expect.any(Number),
      worktree_list: expect.any(Number),
      workspace_tree: expect.any(Number),
    });
    expect(Object.values(baseline.initialCounts).every((count) => count >= 1)).toBe(true);
    expectPollCountsNotToRegressFrom(baseline.countsBeforeNextPoll, baseline.initialCounts);
    expectPollCountsToAdvanceFrom(baseline.countsAfterNextPoll, baseline.initialCounts);
  });

  test('session startup and follow-up I/O use session_runtime_start plus terminal transport', async ({ page }) => {
    const baseline = await observeWsTransport(page);

    expect(baseline.controlPlaneCommands).toContain('session_runtime_start');
    expect(baseline.controlPlaneCommands).toContain('terminal_write');
    expect(baseline.controlPlaneCommands).toContain('terminal_resize');
    expect(baseline.controlPlaneCommands).not.toContain('agent_start');
    expect(baseline.controlPlaneCommands).not.toContain('agent_send');
    expect(baseline.controlPlaneCommands).not.toContain('agent_resize');
    expect(baseline.websocketUrls.some((url) => url.includes('/ws'))).toBe(true);
    expect(baseline.terminalFrame.event).toBe('terminal://event');
    expect(baseline.terminalFrame.payload.workspace_id).toBe(baseline.workspaceId);
    expect(String(baseline.terminalFrame.payload.data ?? '')).toContain('transport-terminal');
    expect(baseline.lifecycleFrame.event).toBe('agent://lifecycle');
    expect(baseline.lifecycleFrame.payload.workspace_id).toBe(baseline.workspaceId);
    expect(baseline.lifecycleFrame.payload.session_id).toBe(baseline.sessionId);
    expect(baseline.lifecycleFrame.payload.kind).toBe('tool_started');
  });

  test('high-frequency agent stdout is coalesced into fewer websocket frames', async ({ page }) => {
    const baseline = await observeBurstAgentTransport(page, {
      chunkCount: BURST_CHUNK_COUNT,
      intervalMs: BURST_INTERVAL_MS,
    });

    emitBurstMeasure('agent', {
      chunkCount: BURST_CHUNK_COUNT,
      intervalMs: BURST_INTERVAL_MS,
      frameCount: baseline.frameCount,
      textLength: baseline.text.length,
    });
    expect(baseline.text).toContain('agent-burst-00');
    expect(baseline.text).toContain(`agent-burst-${String(BURST_CHUNK_COUNT - 1).padStart(2, '0')}`);
    expect(baseline.frameCount).toBeLessThanOrEqual(BURST_MAX_FRAMES);
  });

  test('high-frequency terminal output is coalesced into fewer websocket frames', async ({ page }) => {
    const baseline = await observeBurstTerminalTransport(page, {
      chunkCount: BURST_CHUNK_COUNT,
    });

    emitBurstMeasure('terminal', {
      chunkCount: BURST_CHUNK_COUNT,
      intervalMs: 0,
      frameCount: baseline.frameCount,
      textLength: baseline.text.length,
    });
    expect(baseline.text).toContain('term-burst-00');
    expect(baseline.text).toContain(`term-burst-${String(BURST_CHUNK_COUNT - 1).padStart(2, '0')}`);
    expect(baseline.frameCount).toBeLessThanOrEqual(TERMINAL_BURST_MAX_FRAMES);
  });

  test('mixed agent and terminal burst workloads stay within bounded websocket frames', async ({ page }) => {
    const baseline = await observeMixedBurstTransport(page, {
      chunkCount: BURST_CHUNK_COUNT,
      intervalMs: BURST_INTERVAL_MS,
    });

    emitBurstMeasure('mixed', {
      chunkCount: BURST_CHUNK_COUNT,
      intervalMs: BURST_INTERVAL_MS,
      frameCount: baseline.totalFrameCount,
      textLength: baseline.agentText.length + baseline.terminalText.length,
      agentFrameCount: baseline.agentFrameCount,
      terminalFrameCount: baseline.terminalFrameCount,
    });
    expect(baseline.agentText).toContain('mix-agent-00');
    expect(baseline.agentText).toContain(`mix-agent-${String(BURST_CHUNK_COUNT - 1).padStart(2, '0')}`);
    expect(baseline.terminalText).toContain('mix-term-00');
    expect(baseline.terminalText).toContain(`mix-term-${String(BURST_CHUNK_COUNT - 1).padStart(2, '0')}`);
    expect(baseline.totalFrameCount).toBeLessThanOrEqual(MIXED_BURST_MAX_TOTAL_FRAMES);
  });

  test('websocket reconnect preserves resource resync cadence after reconnect', async ({ page }) => {
    const baseline = await observeReconnectBaseline(page);

    expect(baseline.reconnectDelayMs).toBe(WS_RECONNECT_DELAY_MS);
    expectPollCountsNotToRegressFrom(
      baseline.countsAfterReconnectBeforePoll,
      baseline.countsAtDisconnect,
    );
    expect(
      baseline.countsAfterReconnectBeforePoll.git_status - baseline.countsAtDisconnect.git_status,
    ).toBeLessThanOrEqual(1);
    expect(
      baseline.countsAfterReconnectBeforePoll.git_changes - baseline.countsAtDisconnect.git_changes,
    ).toBeLessThanOrEqual(1);
    expect(
      baseline.countsAfterReconnectBeforePoll.worktree_list - baseline.countsAtDisconnect.worktree_list,
    ).toBeLessThanOrEqual(1);
    expect(
      baseline.countsAfterReconnectBeforePoll.workspace_tree - baseline.countsAtDisconnect.workspace_tree,
    ).toBeLessThanOrEqual(1);
    expectPollCountsNotToRegressFrom(
      baseline.countsAfterNextPoll,
      baseline.countsAfterReconnectBeforePoll,
    );
    expectPollCountsToAdvanceFrom(
      baseline.countsAfterNextPoll,
      baseline.countsAtDisconnect,
    );
  });

  test('workspace artifact invalidations stream over /ws', async ({ page }) => {
    const baseline = await observeArtifactsDirtyBaseline(page);

    expect(baseline.dirtyFrame.event).toBe('workspace://artifacts_dirty');
    expect(baseline.dirtyFrame.payload.path).toBe(baseline.savedPath);
    expect(baseline.dirtyFrame.payload.reason).toBe('file_save');
    expect((baseline.dirtyFrame.payload.target as { type?: string } | undefined)?.type).toBe('native');
  });

  test('out-of-band file edits stream workspace invalidations over /ws', async ({ page }) => {
    const baseline = await observeWatcherInvalidationBaseline(page);

    expect(baseline.dirtyFrame.event).toBe('workspace://artifacts_dirty');
    expect(baseline.dirtyFrame.payload.path).toBe(baseline.workspacePath);
    expect(baseline.dirtyFrame.payload.reason).toBe('file_watcher');
    expect((baseline.dirtyFrame.payload.target as { type?: string } | undefined)?.type).toBe('native');
  });

  test('git index writes from external git add also stream workspace invalidations over /ws', async ({ page }) => {
    const baseline = await observeGitIndexInvalidationBaseline(page);

    expect(baseline.countsAfterGitAdd).toBeGreaterThan(baseline.countsAfterFileWrite);
    expect(normalizePathForComparison(baseline.workspacePath)).toBe(normalizePathForComparison(WORKSPACE_PATH));
  });

  test('git discard all invalidations refresh the file tree over /ws before fallback polling', async ({ page }) => {
    test.setTimeout(30000);
    const probe = await installTransportProbe(page, { pollIntervalMs: 10000 });
    const workspacePath = await createExternalTempWorkspace('coder-studio-transport-git-discard-');
    const untrackedFile = path.join(workspacePath, 'discard-me.txt');
    let workspace: WorkspaceHandle | null = null;

    try {
      await execFileAsync('git', ['init'], { cwd: workspacePath });
      await fs.writeFile(untrackedFile, 'discard me\n', 'utf8');

      workspace = await openWorkspace(page, DEFAULT_TRANSPORT_IDS, workspacePath);
      await waitForBackendSocket(page);
      const controller = await currentWorkspaceController(page, workspace.workspaceId);
      const workspaceTreeCountBeforeDiscard = probe.rpcCounts.workspace_tree ?? 0;

      await invokeRpc(page, 'git_discard_all', {
        ...controller,
        path: workspace.workspacePath,
        target: workspace.target,
      });

      const dirtyFrame = await waitForWsEvent(
        page,
        'workspace://artifacts_dirty',
        (payload) => payload.path === workspace?.workspacePath && payload.reason === 'git_discard_all',
      );

      expect(dirtyFrame.payload.categories).toEqual(['git', 'worktrees', 'tree']);
      await expect
        .poll(() => probe.rpcCounts.workspace_tree ?? 0, {
          timeout: 5000,
        })
        .toBeGreaterThan(workspaceTreeCountBeforeDiscard);
      await expect
        .poll(async () => {
          try {
            await fs.access(untrackedFile);
            return true;
          } catch {
            return false;
          }
        })
        .toBe(false);
    } finally {
      if (workspace && !page.isClosed()) {
        await closeWorkspaceBestEffort(page, workspace.workspaceId, DEFAULT_TRANSPORT_IDS);
      }
      await removeExternalWorkspace(workspacePath);
    }
  });

  test('refresh reattaches to the same shell replay and controller state', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const ids = { deviceId: 'device-refresh', clientId: 'client-refresh' };

    try {
      await prepareTransportPage(page);
      await installTransportProbe(page);
      await seedWorkspaceControllerIds(page, ids);
      const workspace = await openWorkspace(page, ids);
      await waitForBackendSocket(page);

      const initialRuntime = await invokeRpc<{
        controller: {
          fencing_token: number;
          controller_client_id?: string | null;
        };
      }>(page, 'workspace_runtime_attach', {
        workspaceId: workspace.workspaceId,
        deviceId: ids.deviceId,
        clientId: ids.clientId,
      });
      expect(initialRuntime.controller.controller_client_id).toBe(ids.clientId);
      const controller = {
        workspaceId: workspace.workspaceId,
        deviceId: ids.deviceId,
        clientId: ids.clientId,
        fencingToken: initialRuntime.controller.fencing_token,
      };

      const terminal = await invokeRpc<{ id: number }>(page, 'terminal_create', {
        ...controller,
        cwd: workspace.workspacePath,
        target: workspace.target,
        cols: 120,
        rows: 30,
      });
      await invokeRpc(page, 'terminal_write', {
        ...controller,
        terminalId: terminal.id,
        input: buildTerminalProbeInput(workspace.target),
      });
      await waitForWsEvent(
        page,
        'terminal://event',
        (payload) => payload.workspace_id === workspace.workspaceId && String(payload.data ?? '').includes('transport-terminal'),
      );

      await page.reload();
      await waitForWorkspaceTopbar(page);
      await waitForBackendSocket(page);
      await expect(page.getByTestId('workspace-read-only-banner')).toBeHidden();

      const refreshedRuntime = await invokeRpc<{
        snapshot: {
          terminals: Array<{ output: string }>;
        };
        controller: {
          controller_client_id?: string | null;
        };
      }>(page, 'workspace_runtime_attach', {
        workspaceId: workspace.workspaceId,
        deviceId: ids.deviceId,
        clientId: ids.clientId,
      });

      expect(refreshedRuntime.controller.controller_client_id).toBe(ids.clientId);
      expect(
        refreshedRuntime.snapshot.terminals.some((terminal) => terminal.output.includes('transport-terminal')),
      ).toBe(true);
    } finally {
      await context.close();
    }
  });

  test('reconnect reattaches runtime replay after websocket loss during an active run', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const ids = { deviceId: 'device-runtime-reconnect', clientId: 'client-runtime-reconnect' };
    const replayClaudeSessionId = `claude-reconnect-${Date.now()}`;
    const workspacePath = await createExternalTempWorkspace('coder-studio-transport-reconnect-');
    let workspace: WorkspaceHandle | null = null;

    try {
      await prepareTransportPage(page);
      await installTransportProbe(page);
      await seedAppSettings(page, {
        agentCommand: `node ${AGENT_CLAUDE_LIFECYCLE_SCRIPT} --running-delay-ms 150 --stopped-delay-ms 3000 ${replayClaudeSessionId}`,
      });
      await seedWorkspaceControllerIds(page, ids);
      workspace = await openWorkspace(page, ids, workspacePath);
      await waitForBackendSocket(page);
      const controller = await currentWorkspaceController(page, workspace.workspaceId, ids);
      const session = await invokeRpc<{ id: number }>(page, 'create_session', {
        ...controller,
        mode: 'branch',
        provider: 'claude',
      });
      const sessionId = String(session.id);

      await invokeRpc(page, 'workspace_view_update', {
        ...controller,
        patch: {
          active_session_id: sessionId,
          active_pane_id: `pane-${session.id}`,
          pane_layout: {
            type: 'leaf',
            id: `pane-${session.id}`,
            sessionId,
          },
        },
      });
      await invokeRpc(page, 'session_update', {
        ...controller,
        sessionId: session.id,
        patch: {
          status: 'waiting',
        },
      });

      const sessionCard = page.locator(`.agent-pane-card[data-session-id="${session.id}"]`).first();

      const started = await invokeRpc<{ terminal_id: number; started: boolean; boot_input?: string | null }>(page, 'session_runtime_start', {
        ...controller,
        sessionId,
        cols: 120,
        rows: 30,
      });
      expect(started.boot_input).toBeTruthy();
      await invokeRpc(page, 'terminal_write', {
        ...controller,
        terminalId: started.terminal_id,
        input: started.boot_input,
      });

      await waitForLifecycleReplayEvent(
        page,
        workspace.workspaceId,
        ids,
        sessionId,
        'tool_started',
        TRANSPORT_EVENT_TIMEOUT_MS,
      );

      const trackerBeforeDisconnect = await readTransportTracker(page);
      const backendConnectCountBeforeDisconnect = countTrackedSockets(
        trackerBeforeDisconnect,
        BACKEND_WS_PATH,
      );
      const closeCountBeforeDisconnect = trackerBeforeDisconnect.closeTimes.length;

      await page.evaluate((fragment) => {
        window.__transportTest?.closeMatching(fragment);
      }, BACKEND_WS_PATH);

      await expect.poll(async () => (await readTransportTracker(page)).closeTimes.length).toBeGreaterThan(closeCountBeforeDisconnect);
      await page.waitForTimeout(700);
      await expect
        .poll(async () => countTrackedSockets(await readTransportTracker(page), BACKEND_WS_PATH), {
          timeout: 10000,
        })
        .toBeGreaterThan(backendConnectCountBeforeDisconnect);

      const runtimeAfterReconnect = await invokeRpc<{
        lifecycle_events?: Array<{ session_id: string; kind: string }>;
      }>(page, 'workspace_runtime_attach', {
        workspaceId: workspace.workspaceId,
        deviceId: ids.deviceId,
        clientId: ids.clientId,
      });
      expect(runtimeAfterReconnect.lifecycle_events?.some((event) =>
        event.session_id === sessionId && event.kind === 'turn_completed'
      )).toBe(true);

      await expect.poll(async () => sessionCard.getAttribute('data-session-status'), {
        timeout: 4000,
      }).toBe('idle');
    } finally {
      if (workspace && !page.isClosed()) {
        await closeWorkspaceBestEffort(page, workspace.workspaceId, ids);
      }
      await Promise.allSettled([context.close()]);
      await removeExternalWorkspace(workspacePath);
    }
  });

  test('reload replays agent lifecycle history into running and idle browser state', async ({ browser }) => {
    test.setTimeout(45000);
    const context = await browser.newContext();
    const page = await context.newPage();
    const ids = { deviceId: 'device-lifecycle', clientId: 'client-lifecycle' };
    const replayClaudeSessionId = `claude-replay-${Date.now()}`;
    const workspacePath = await createExternalTempWorkspace('coder-studio-transport-lifecycle-');
    let workspace: WorkspaceHandle | null = null;

    try {
      await prepareTransportPage(page);
      await installTransportProbe(page);
      await seedAppSettings(page, {
        agentCommand: `node ${AGENT_CLAUDE_LIFECYCLE_SCRIPT} --running-delay-ms ${AGENT_CLAUDE_REPLAY_DELAY_MS} ${replayClaudeSessionId}`,
      });
      await seedWorkspaceControllerIds(page, ids);
      workspace = await openWorkspace(page, ids, workspacePath);
      await waitForBackendSocket(page);
      const controller = await currentWorkspaceController(page, workspace.workspaceId, ids);
      const session = await invokeRpc<{ id: number }>(page, 'create_session', {
        ...controller,
        mode: 'branch',
        provider: 'claude',
      });

      await invokeRpc(page, 'workspace_view_update', {
        ...controller,
        patch: {
          active_session_id: String(session.id),
          active_pane_id: `pane-${session.id}`,
          pane_layout: {
            type: 'leaf',
            id: `pane-${session.id}`,
            sessionId: String(session.id),
          },
        },
      });
      await invokeRpc(page, 'session_update', {
        ...controller,
        sessionId: session.id,
        patch: {
          status: 'waiting',
        },
      });

      await page.reload();
      await waitForWorkspaceTopbar(page);
      await waitForBackendSocket(page);
      const controllerAfterReload = await currentWorkspaceController(page, workspace.workspaceId, ids);
      const started = await invokeRpc<{ terminal_id: number; started: boolean; boot_input?: string | null }>(page, 'session_runtime_start', {
        ...controllerAfterReload,
        sessionId: String(session.id),
        cols: 120,
        rows: 30,
      });
      expect(started.boot_input).toBeTruthy();
      await invokeRpc(page, 'terminal_write', {
        ...controllerAfterReload,
        terminalId: started.terminal_id,
        input: started.boot_input,
      });

      await waitForLifecycleReplayEvent(
        page,
        workspace.workspaceId,
        ids,
        String(session.id),
        'tool_started',
        TRANSPORT_EVENT_TIMEOUT_MS,
      );
      await page.reload();
      await waitForWorkspaceTopbar(page);
      await waitForBackendSocket(page);
      const runtimeAfterReload = await invokeRpc<{
        snapshot: {
          sessions: Array<{ id: number }>;
          view_state: {
            active_session_id: string;
            active_pane_id: string;
          };
        };
        lifecycle_events?: Array<{ session_id: string; kind: string }>;
      }>(page, 'workspace_runtime_attach', {
        workspaceId: workspace.workspaceId,
        deviceId: ids.deviceId,
        clientId: ids.clientId,
      });
      expect(runtimeAfterReload.snapshot.sessions.some((candidate) => candidate.id === session.id)).toBe(true);
      expect(runtimeAfterReload.snapshot.view_state.active_session_id).toBe(String(session.id));
      expect(runtimeAfterReload.snapshot.view_state.active_pane_id).toBe(`pane-${session.id}`);
      expect(runtimeAfterReload.lifecycle_events?.some((event) =>
        event.session_id === String(session.id) && event.kind === 'tool_started'
      )).toBe(true);
      let lastReloadStatus: string | null = null;
      try {
        await expect.poll(async () => {
          lastReloadStatus = await page
            .locator(`.agent-pane-card[data-session-id="${session.id}"]`)
            .first()
            .getAttribute('data-session-status');
          return lastReloadStatus === 'running'
            || lastReloadStatus === 'background'
            || lastReloadStatus === 'idle';
        }, {
          timeout: 20000,
          message: `session status after reload: ${lastReloadStatus ?? 'null'}`,
        }).toBe(true);
      } catch {
        const debug = await readWorkspaceReloadDebug(page, workspace.workspaceId, ids);
        throw new Error([
          `session status after reload: ${lastReloadStatus ?? 'null'}`,
          JSON.stringify(debug),
        ].join('\n'));
      }
      if (lastReloadStatus === 'idle') {
        const debug = await readWorkspaceReloadDebug(page, workspace.workspaceId, ids);
        expect(debug.lifecycleTail.some((event) =>
          event.session_id === String(session.id) && event.kind === 'turn_completed'
        )).toBe(true);
      }

      await page.goto('about:blank');
      await page.waitForTimeout(2200);
      await page.goto(`/workspace/${workspace.workspaceId}`);
      await waitForWorkspaceTopbar(page);
      await waitForBackendSocket(page);
      await expect.poll(async () =>
        page.locator(`.agent-pane-card[data-session-id="${session.id}"]`).first().getAttribute('data-session-status')
      ).toBe('idle');
    } finally {
      if (workspace && !page.isClosed()) {
        await closeWorkspaceBestEffort(page, workspace.workspaceId, ids);
      }
      await Promise.allSettled([context.close()]);
      await removeExternalWorkspace(workspacePath);
    }
  });

  test('reload keeps automatic workspace runtime attaches bounded', async ({ browser }) => {
    test.setTimeout(30000);
    const context = await browser.newContext();
    const page = await context.newPage();
    const ids = { deviceId: 'device-reload-attach', clientId: 'client-reload-attach' };
    const workspacePath = await createExternalTempWorkspace('coder-studio-transport-reload-attach-');
    let workspace: WorkspaceHandle | null = null;

    try {
      await prepareTransportPage(page);
      const probe = await installTransportProbe(page);
      await seedWorkspaceControllerIds(page, ids);
      workspace = await openWorkspace(page, ids, workspacePath);
      await waitForBackendSocket(page);

      const attachCountBeforeReload = probe.rpcCounts.workspace_runtime_attach ?? 0;

      await page.reload();
      await waitForWorkspaceTopbar(page);
      await waitForBackendSocket(page);
      await page.waitForTimeout(3600);

      const attachCountAfterReload = probe.rpcCounts.workspace_runtime_attach ?? 0;
      expect(attachCountAfterReload - attachCountBeforeReload).toBeLessThanOrEqual(1);
    } finally {
      if (workspace && !page.isClosed()) {
        await closeWorkspaceBestEffort(page, workspace.workspaceId, ids);
      }
      await Promise.allSettled([context.close()]);
      await removeExternalWorkspace(workspacePath);
    }
  });

  test('reload defers session history loading until the drawer is opened', async ({ browser }) => {
    test.setTimeout(30000);
    const context = await browser.newContext();
    const page = await context.newPage();
    const ids = { deviceId: 'device-reload-history', clientId: 'client-reload-history' };
    const workspacePath = await createExternalTempWorkspace('coder-studio-transport-reload-history-');
    let workspace: WorkspaceHandle | null = null;

    try {
      await prepareTransportPage(page);
      const probe = await installTransportProbe(page);
      await seedWorkspaceControllerIds(page, ids);
      workspace = await openWorkspace(page, ids, workspacePath);
      await waitForBackendSocket(page);

      const historyCountBeforeReload = probe.rpcCounts.list_session_history ?? 0;

      await page.reload();
      await waitForWorkspaceTopbar(page);
      await waitForBackendSocket(page);
      await page.waitForTimeout(1200);

      const historyCountAfterReload = probe.rpcCounts.list_session_history ?? 0;
      expect(historyCountAfterReload - historyCountBeforeReload).toBe(0);

      await page.getByTestId('history-toggle').click();
      await expect(page.getByTestId('history-drawer')).toBeVisible();
      await expect.poll(() => probe.rpcCounts.list_session_history ?? 0).toBe(historyCountAfterReload + 1);
    } finally {
      if (workspace && !page.isClosed()) {
        await closeWorkspaceBestEffort(page, workspace.workspaceId, ids);
      }
      await Promise.allSettled([context.close()]);
      await removeExternalWorkspace(workspacePath);
    }
  });

  test('observer follows controller and takeover succeeds after timeout', async ({ browser }) => {
    test.setTimeout(45000);
    const controllerContext = await browser.newContext();
    const observerContext = await browser.newContext();
    const controller = await controllerContext.newPage();
    const observer = await observerContext.newPage();
    const controllerIds = { deviceId: 'device-a', clientId: 'client-a' };
    const observerIds = { deviceId: 'device-b', clientId: 'client-b' };
    const workspacePath = await createExternalTempWorkspace('coder-studio-transport-takeover-follow-');
    let workspace: WorkspaceHandle | null = null;

    try {
      await prepareTransportPage(controller);
      await prepareTransportPage(observer);
      await installTransportProbe(controller);
      await installTransportProbe(observer);
      await seedWorkspaceControllerIds(controller, controllerIds);
      await seedWorkspaceControllerIds(observer, observerIds);
      workspace = await openWorkspace(controller, controllerIds, workspacePath);
      await waitForBackendSocket(controller);

      await observer.goto(`/workspace/${workspace.workspaceId}`);
      await waitForWorkspaceTopbar(observer);
      await waitForBackendSocket(observer);
      await expect(observer.getByTestId('runtime-validation-overlay')).toHaveCount(0);

      await expect(observer.getByTestId('workspace-read-only-banner')).toBeVisible();
      const takeoverLease = await invokeRpc<WorkspaceControllerLeaseSnapshot>(observer, 'workspace_controller_takeover', {
        workspaceId: workspace.workspaceId,
        deviceId: observerIds.deviceId,
        clientId: observerIds.clientId,
      });
      expect(takeoverLease.takeover_request_id).toBeTruthy();
      expect(takeoverLease.takeover_requested_by_device_id).toBe(observerIds.deviceId);
      expect(takeoverLease.takeover_requested_by_client_id).toBe(observerIds.clientId);
      await expect(controller.getByTestId('workspace-takeover-request-banner')).toBeVisible({
        timeout: 30000,
      });

      await controllerContext.close();
      await currentWorkspaceController(observer, workspace.workspaceId, observerIds);

      await expect(observer.getByTestId('workspace-read-only-banner')).toBeHidden({
        timeout: 15000,
      });
    } finally {
      if (workspace && !observer.isClosed()) {
        await closeWorkspaceBestEffort(observer, workspace.workspaceId, observerIds);
      }
      await Promise.allSettled([
        observerContext.close(),
        controllerContext.close(),
      ]);
      await removeExternalWorkspace(workspacePath);
    }
  });

  test('observer takeover button requests takeover and reflects pending state', async ({ browser }) => {
    test.setTimeout(45000);
    const controllerContext = await browser.newContext();
    const observerContext = await browser.newContext();
    const controller = await controllerContext.newPage();
    const observer = await observerContext.newPage();
    const controllerIds = { deviceId: 'device-click-a', clientId: 'client-click-a' };
    const observerIds = { deviceId: 'device-click-b', clientId: 'client-click-b' };
    const workspacePath = await createExternalTempWorkspace('coder-studio-transport-takeover-request-');
    let workspace: WorkspaceHandle | null = null;

    try {
      await prepareTransportPage(controller);
      await prepareTransportPage(observer);
      await installTransportProbe(controller);
      await installTransportProbe(observer);
      await seedWorkspaceControllerIds(controller, controllerIds);
      await seedWorkspaceControllerIds(observer, observerIds);
      workspace = await openWorkspace(controller, controllerIds, workspacePath);
      await waitForBackendSocket(controller);

      await observer.goto(`/workspace/${workspace.workspaceId}`);
      await waitForWorkspaceTopbar(observer);
      await waitForBackendSocket(observer);
      await expect(observer.getByTestId('workspace-read-only-banner')).toBeVisible();
      await observer.bringToFront();
      await expect.poll(() => observer.evaluate(() => document.visibilityState)).toBe('visible');

      await observer.getByTestId('workspace-read-only-banner').getByRole('button', { name: 'Request takeover' }).click();

      await expect(observer.getByTestId('workspace-read-only-banner')).toContainText(
        'If the current controller does not respond within 10 seconds',
      );
      await expect(controller.getByTestId('workspace-takeover-request-banner')).toBeVisible({
        timeout: 30000,
      });
      await expect(observer.getByTestId('workspace-read-only-banner')).toBeHidden({
        timeout: 15000,
      });
    } finally {
      if (workspace && !observer.isClosed()) {
        await closeWorkspaceBestEffort(observer, workspace.workspaceId, observerIds);
      }
      await Promise.allSettled([
        observerContext.close(),
        controllerContext.close(),
      ]);
      await removeExternalWorkspace(workspacePath);
    }
  });

  test('observer terminal stays unfocused and read-only even after clicking the pane', async ({ browser }) => {
    test.setTimeout(45000);
    const controllerContext = await browser.newContext();
    const observerContext = await browser.newContext();
    const controller = await controllerContext.newPage();
    const observer = await observerContext.newPage();
    const controllerIds = { deviceId: 'device-readonly-a', clientId: 'client-readonly-a' };
    const observerIds = { deviceId: 'device-readonly-b', clientId: 'client-readonly-b' };
    const workspacePath = await createExternalTempWorkspace('coder-studio-transport-readonly-focus-');
    let workspace: WorkspaceHandle | null = null;

    try {
      await prepareTransportPage(controller);
      await prepareTransportPage(observer);
      await installTransportProbe(controller);
      await installTransportProbe(observer);
      await seedWorkspaceControllerIds(controller, controllerIds);
      await seedWorkspaceControllerIds(observer, observerIds);

      workspace = await openWorkspace(controller, controllerIds, workspacePath);
      await waitForBackendSocket(controller);
      await seedAppSettings(controller, {
        agentCommand: `node ${AGENT_STDIN_ECHO_SCRIPT}`,
      });

      const startButton = controller.locator('[data-testid^="draft-start-claude-"]').first();
      await expect(startButton).toBeVisible();
      await startButton.click();
      await expect(controller.locator('.agent-pane-xterm')).toBeVisible({ timeout: 10000 });

      await controller.locator('.agent-pane-xterm').click();
      await controller.keyboard.type('observer focus guard');
      await controller.keyboard.press('Enter');

      await observer.goto(`/workspace/${workspace.workspaceId}`);
      await waitForWorkspaceTopbar(observer);
      await waitForBackendSocket(observer);
      await expect(observer.getByTestId('workspace-read-only-banner')).toBeVisible();
      await expect(observer.locator('.agent-pane-xterm')).toBeVisible({ timeout: 10000 });

      await expect.poll(() => observer.evaluate(() => {
        const helper = document.querySelector('.xterm-helper-textarea');
        return {
          textboxActive: document.activeElement?.classList?.contains('xterm-helper-textarea') ?? false,
          helperInteractive: helper instanceof HTMLTextAreaElement
            ? (!helper.readOnly || helper.tabIndex !== -1)
            : false,
        };
      })).toEqual({
        textboxActive: false,
        helperInteractive: false,
      });

      await observer.locator('.agent-pane-xterm').click();

      await expect.poll(() => observer.evaluate(() => (
        document.activeElement?.classList?.contains('xterm-helper-textarea') ?? false
      ))).toBe(false);
    } finally {
      if (workspace && !observer.isClosed()) {
        await closeWorkspaceBestEffort(observer, workspace.workspaceId, observerIds);
      }
      await Promise.allSettled([
        observerContext.close(),
        controllerContext.close(),
      ]);
      await removeExternalWorkspace(workspacePath);
    }
  });

  test('observer takeover button surfaces loading and error feedback when takeover request fails', async ({ browser }) => {
    test.setTimeout(45000);
    const controllerContext = await browser.newContext();
    const observerContext = await browser.newContext();
    const controller = await controllerContext.newPage();
    const observer = await observerContext.newPage();
    const controllerIds = { deviceId: 'device-click-fail-a', clientId: 'client-click-fail-a' };
    const observerIds = { deviceId: 'device-click-fail-b', clientId: 'client-click-fail-b' };
    const workspacePath = await createExternalTempWorkspace('coder-studio-transport-takeover-error-');
    let workspace: WorkspaceHandle | null = null;

    try {
      await prepareTransportPage(controller);
      await prepareTransportPage(observer);
      await installTransportProbe(controller);
      await installTransportProbe(observer);
      await observer.route('**/api/rpc/workspace_controller_takeover', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false,
            error: 'takeover_failed',
          }),
        });
      });
      await seedWorkspaceControllerIds(controller, controllerIds);
      await seedWorkspaceControllerIds(observer, observerIds);
      workspace = await openWorkspace(controller, controllerIds, workspacePath);
      await waitForBackendSocket(controller);

      await observer.goto(`/workspace/${workspace.workspaceId}`);
      await waitForWorkspaceTopbar(observer);
      await waitForBackendSocket(observer);
      await expect(observer.getByTestId('workspace-read-only-banner')).toBeVisible();

      await observer.getByTestId('workspace-read-only-banner').getByRole('button', { name: 'Request takeover' }).click();

      await expect(observer.getByTestId('workspace-read-only-banner')).toContainText(
        'Requesting takeover',
      );
      await expect(observer.locator('.toast')).toContainText(
        'Takeover request failed',
      );
      await expect(observer.getByTestId('workspace-read-only-banner')).toContainText(
        'This workspace is following the current controller.',
      );
    } finally {
      if (workspace && !controller.isClosed()) {
        await closeWorkspaceBestEffort(controller, workspace.workspaceId, controllerIds);
      }
      await Promise.allSettled([
        observerContext.close(),
        controllerContext.close(),
      ]);
      await removeExternalWorkspace(workspacePath);
    }
  });

  test('draft provider button starts a session immediately with a generated title', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const titleWorkspacePath = await createExternalTempWorkspace('coder-studio-transport-title-');
    let workspace: WorkspaceHandle | null = null;

    try {
      await prepareTransportPage(page);
      await installTransportProbe(page);
      workspace = await openWorkspace(page, DEFAULT_TRANSPORT_IDS, titleWorkspacePath);
      await waitForBackendSocket(page);
      await seedAppSettings(page, {
        agentCommand: `node ${AGENT_STDIN_ECHO_SCRIPT}`,
      });

      const startButton = page.locator('[data-testid^="draft-start-claude-"]').first();
      await expect(startButton).toBeVisible();

      await startButton.click();

      await expect(page.locator('.agent-pane-xterm')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.agent-pane-title').first()).not.toHaveText('New Session');
    } finally {
      if (workspace && !page.isClosed()) {
        await closeWorkspaceBestEffort(page, workspace.workspaceId, DEFAULT_TRANSPORT_IDS);
      }
      await Promise.allSettled([context.close()]);
      await removeExternalWorkspace(titleWorkspacePath);
    }
  });

  test('same-device new client takes over immediately after controller disconnects', async ({ browser }) => {
    const controllerContext = await browser.newContext();
    const reopenedContext = await browser.newContext();
    const controller = await controllerContext.newPage();
    const reopened = await reopenedContext.newPage();
    const controllerIds = { deviceId: 'device-reopen', clientId: 'client-a' };
    const reopenedIds = { deviceId: 'device-reopen', clientId: 'client-b' };
    const workspacePath = await createExternalTempWorkspace('coder-studio-transport-same-device-');
    let workspace: WorkspaceHandle | null = null;

    try {
      await prepareTransportPage(controller);
      await prepareTransportPage(reopened);
      await installTransportProbe(controller);
      await installTransportProbe(reopened);
      await seedWorkspaceControllerIds(controller, controllerIds);
      await seedWorkspaceControllerIds(reopened, reopenedIds);

      workspace = await openWorkspace(controller, controllerIds, workspacePath);
      await waitForBackendSocket(controller);

      await reopened.goto(`/workspace/${workspace.workspaceId}`);
      await waitForWorkspaceTopbar(reopened);
      await waitForBackendSocket(reopened);
      await expect(reopened.getByTestId('runtime-validation-overlay')).toHaveCount(0);
      await expect(reopened.getByTestId('workspace-read-only-banner')).toBeVisible();

      await controllerContext.close();

      await waitForWorkspaceControllerState(
        reopened,
        workspace.workspaceId,
        reopenedIds,
        (lease) =>
          lease.controller_device_id === reopenedIds.deviceId
          && lease.controller_client_id === reopenedIds.clientId,
        TRANSPORT_EVENT_TIMEOUT_MS,
      );

      await expect(reopened.getByTestId('workspace-read-only-banner')).toBeHidden({
        timeout: 15000,
      });

      const runtime = await invokeRpc<{
        controller: {
          controller_device_id?: string | null;
          controller_client_id?: string | null;
        };
      }>(reopened, 'workspace_runtime_attach', {
        workspaceId: workspace.workspaceId,
        deviceId: reopenedIds.deviceId,
        clientId: reopenedIds.clientId,
      });

      expect(runtime.controller.controller_device_id).toBe(reopenedIds.deviceId);
      expect(runtime.controller.controller_client_id).toBe(reopenedIds.clientId);
    } finally {
      if (workspace && !reopened.isClosed()) {
        await closeWorkspaceBestEffort(reopened, workspace.workspaceId, reopenedIds);
      }
      await Promise.allSettled([
        reopenedContext.close(),
        controllerContext.close(),
      ]);
      await removeExternalWorkspace(workspacePath);
    }
  });

  test('interrupted sessions show an explicit resume entry and reuse the saved claude session id', async ({ browser }) => {
    test.setTimeout(45000);
    const context = await browser.newContext();
    const page = await context.newPage();
    const ids = { deviceId: 'device-recovery', clientId: 'client-recovery' };
    const resumeClaudeSessionId = `claude-e2e-resume-${Date.now()}`;
    const workspacePath = await createExternalTempWorkspace('coder-studio-transport-recovery-');
    let workspace: WorkspaceHandle | null = null;

    try {
      await prepareTransportPage(page);
      await installTransportProbe(page);
      await seedAppSettings(page, {
        agentCommand: `node ${AGENT_CLAUDE_LIFECYCLE_SCRIPT} --running-delay-ms ${AGENT_CLAUDE_RECOVERY_DELAY_MS}`,
      });
      await seedWorkspaceControllerIds(page, ids);
      workspace = await openWorkspace(page, ids, workspacePath);
      await waitForBackendSocket(page);
      const controller = await currentWorkspaceController(page, workspace.workspaceId, ids);
      const session = await invokeRpc<{ id: number }>(page, 'create_session', {
        ...controller,
        mode: 'branch',
        provider: 'claude',
      });

      await invokeRpc(page, 'session_update', {
        ...controller,
        sessionId: session.id,
        patch: {
          status: 'interrupted',
          resume_id: resumeClaudeSessionId,
        },
      });
      await page.reload();
      await waitForWorkspaceTopbar(page);
      await waitForBackendSocket(page);
      const controllerAfterReload = await currentWorkspaceController(page, workspace.workspaceId, ids);
      const interruptedSessionCard = page.locator(`.agent-pane-card[data-session-id="${session.id}"]`).first();
      await expect(interruptedSessionCard).toBeVisible({
        timeout: 10000,
      });
      await interruptedSessionCard.click();
      await invokeRpc(page, 'workspace_view_update', {
        ...controllerAfterReload,
        patch: {
          active_session_id: String(session.id),
          active_pane_id: `pane-${session.id}`,
          pane_layout: {
            type: 'leaf',
            id: `pane-${session.id}`,
            sessionId: String(session.id),
          },
        },
      });
      await expect(page.getByTestId('workspace-agent-recovery-banner')).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByTestId('workspace-agent-recovery-action')).toHaveText('Resume agent');
      await page.getByTestId('workspace-agent-recovery-action').click();

      await waitForLifecycleReplayEntry(
        page,
        workspace.workspaceId,
        ids,
        (event) =>
          event.session_id === String(session.id)
          && event.kind === 'tool_started'
          && typeof event.data === 'string'
          && event.data.includes(resumeClaudeSessionId),
        TRANSPORT_EVENT_TIMEOUT_MS,
      );

      await page.reload();
      await waitForWorkspaceTopbar(page);
      await waitForBackendSocket(page);
      let resumedStatus: string | null = null;
      try {
        await expect.poll(async () => {
          resumedStatus = await page
            .locator(`.agent-pane-card[data-session-id="${session.id}"]`)
            .first()
            .getAttribute('data-session-status');
          return resumedStatus === 'running'
            || resumedStatus === 'background'
            || resumedStatus === 'idle';
        }, {
          timeout: 5000,
          message: `resumed session status after reload: ${resumedStatus ?? 'null'}`,
        }).toBe(true);
      } catch {
        const debug = await readWorkspaceReloadDebug(page, workspace.workspaceId, ids);
        throw new Error([
          `resumed session status after reload: ${resumedStatus ?? 'null'}`,
          JSON.stringify(debug),
        ].join('\n'));
      }
      if (resumedStatus === 'idle') {
        const debug = await readWorkspaceReloadDebug(page, workspace.workspaceId, ids);
        expect(debug.lifecycleTail.some((event) =>
          event.session_id === String(session.id) && event.kind === 'turn_completed'
        )).toBe(true);
      }
    } finally {
      if (workspace && !page.isClosed()) {
        await closeWorkspaceBestEffort(page, workspace.workspaceId, ids);
      }
      await Promise.allSettled([context.close()]);
      await removeExternalWorkspace(workspacePath);
    }
  });
});

async function createExternalTempWorkspace(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function observePollingBaseline(page: Page): Promise<PollingBaseline> {
  const probe = await installTransportProbe(page);
  await openWorkspace(page);
  await waitForPollCycle(probe.counts);
  await page.waitForTimeout(250);

  const initialCounts = snapshotCounts(probe.counts);
  const commands = [...probe.initialCommandOrder];

  await page.waitForTimeout(3000);
  const countsBeforeNextPoll = snapshotCounts(probe.counts);
  await waitForCountsAtLeast(probe.counts, incrementCounts(initialCounts));
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
  await waitForBackendSocket(page);
  await seedAppSettings(page, {
    agentCommand: `node ${AGENT_CLAUDE_LIFECYCLE_SCRIPT} --running-delay-ms 5000 transport-lifecycle`,
  });

  const controlPlaneCommands: string[] = [];
  const controller = await currentWorkspaceController(page, workspace.workspaceId);

  const terminal = await invokeRpc<{ id: number }>(page, 'terminal_create', {
    ...controller,
    cwd: workspace.workspacePath,
    target: workspace.target,
    cols: 120,
    rows: 30,
  });
  controlPlaneCommands.push('terminal_create');

  await invokeRpc(page, 'terminal_write', {
    ...controller,
    terminalId: terminal.id,
    input: buildTerminalProbeInput(workspace.target),
  });
  controlPlaneCommands.push('terminal_write');

  const session = await invokeRpc<{ id: number }>(page, 'create_session', {
    ...controller,
    mode: 'branch',
    provider: 'claude',
  });
  const sessionId = String(session.id);
  controlPlaneCommands.push('create_session');

  const started = await invokeRpc<{ terminal_id: number; started: boolean; boot_input?: string | null }>(page, 'session_runtime_start', {
    ...controller,
    sessionId,
    cols: 120,
    rows: 30,
  });
  controlPlaneCommands.push('session_runtime_start');

  expect(started.boot_input).toBeTruthy();

  await invokeRpc(page, 'terminal_write', {
    ...controller,
    terminalId: started.terminal_id,
    input: started.boot_input,
  });
  controlPlaneCommands.push('terminal_write');

  await invokeRpc(page, 'terminal_resize', {
    ...controller,
    terminalId: started.terminal_id,
    cols: 100,
    rows: 24,
  });
  controlPlaneCommands.push('terminal_resize');

  const terminalFrame = await waitForWsEvent(
    page,
    'terminal://event',
    (payload) => payload.workspace_id === workspace.workspaceId && String(payload.data ?? '').includes('transport-terminal'),
  );
  const lifecycleFrame = await waitForWsEvent(
    page,
    'agent://lifecycle',
    (payload) => payload.workspace_id === workspace.workspaceId
      && payload.session_id === sessionId
      && payload.kind === 'tool_started',
  );
  const tracker = await readTransportTracker(page);

  return {
    controlPlaneCommands,
    websocketUrls: tracker.urls,
    workspaceId: workspace.workspaceId,
    sessionId,
    terminalFrame,
    lifecycleFrame,
  };
}

async function observeReconnectBaseline(page: Page): Promise<ReconnectBaseline> {
  const probe = await installTransportProbe(page, { pollIntervalMs: 10000 });
  await openWorkspace(page);
  await waitForPollCycle(probe.counts);
  await waitForBackendSocket(page);
  await page.waitForTimeout(250);

  const trackerBeforeDisconnect = await readTransportTracker(page);
  const countsAtDisconnect = snapshotCounts(probe.counts);
  const backendConnectCountBeforeDisconnect = countTrackedSockets(
    trackerBeforeDisconnect,
    BACKEND_WS_PATH,
  );
  const closeCountBeforeDisconnect = trackerBeforeDisconnect.closeTimes.length;
  const scheduledTimeoutCountBeforeDisconnect = trackerBeforeDisconnect.scheduledTimeouts.length;

  await page.evaluate((fragment) => {
    window.__transportTest?.closeMatching(fragment);
  }, BACKEND_WS_PATH);

  await expect.poll(async () => (await readTransportTracker(page)).closeTimes.length).toBeGreaterThan(closeCountBeforeDisconnect);
  await expect
    .poll(async () => (await readTransportTracker(page)).scheduledTimeouts.slice(scheduledTimeoutCountBeforeDisconnect), {
      timeout: 10000,
    })
    .toContain(WS_RECONNECT_DELAY_MS);
  await expect
    .poll(async () => countTrackedSockets(await readTransportTracker(page), BACKEND_WS_PATH), {
      timeout: 10000,
    })
    .toBeGreaterThan(backendConnectCountBeforeDisconnect);
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

async function observeBurstAgentTransport(
  page: Page,
  options: { chunkCount: number; intervalMs: number },
) {
  await prepareTransportPage(page);
  await installTransportProbe(page);
  const workspace = await openWorkspace(page);
  await waitForBackendSocket(page);
  await seedAppSettings(page, {
    agentCommand: `node ${AGENT_BURST_STREAM_SCRIPT} --chunks ${options.chunkCount} --interval-ms ${options.intervalMs} --prefix agent-burst`,
  });

  const controller = await currentWorkspaceController(page, workspace.workspaceId);
  const session = await invokeRpc<{ id: number }>(page, 'create_session', {
    ...controller,
    mode: 'branch',
    provider: 'claude',
  });
  const sessionId = String(session.id);

  await invokeRpc(page, 'agent_start', {
    ...controller,
    sessionId,
    cols: 120,
    rows: 30,
  });

  const finalMarker = `agent-burst-${String(options.chunkCount - 1).padStart(2, '0')}`;
  await expect
    .poll(async () => (await readAgentStreamFrames(page, sessionId, 'stdout')).text.includes(finalMarker), {
      timeout: TRANSPORT_EVENT_TIMEOUT_MS,
    })
    .toBe(true);
  await page.waitForTimeout(150);

  return readAgentStreamFrames(page, sessionId, 'stdout');
}

async function observeBurstTerminalTransport(
  page: Page,
  options: { chunkCount: number },
) {
  await prepareTransportPage(page);
  await installTransportProbe(page);
  const workspace = await openWorkspace(page);
  await waitForBackendSocket(page);
  const controller = await currentWorkspaceController(page, workspace.workspaceId);
  const terminal = await invokeRpc<{ id: number }>(page, 'terminal_create', {
    ...controller,
    cwd: workspace.workspacePath,
    target: workspace.target,
    cols: 120,
    rows: 30,
  });

  const probeFile = await writeBurstProbeFile(
    workspace.workspacePath,
    'term-burst',
    options.chunkCount,
  );
  try {
    await page.waitForTimeout(150);
    const frameCursor = await readTransportFrameCursor(page);
    await invokeRpc(page, 'terminal_write', {
      ...controller,
      terminalId: terminal.id,
      input: buildTerminalBurstInput(workspace.target, probeFile),
    });

    const finalMarker = `term-burst-${String(options.chunkCount - 1).padStart(2, '0')}`;
    await expect
      .poll(async () => (await readTerminalStreamFrames(page, terminal.id, frameCursor)).text.includes(finalMarker), {
        timeout: TRANSPORT_EVENT_TIMEOUT_MS,
      })
      .toBe(true);
    await page.waitForTimeout(150);

    return readTerminalStreamFrames(page, terminal.id, frameCursor);
  } finally {
    await fs.rm(probeFile, { force: true });
  }
}

async function observeMixedBurstTransport(
  page: Page,
  options: { chunkCount: number; intervalMs: number },
) {
  await prepareTransportPage(page);
  await installTransportProbe(page);
  const workspace = await openWorkspace(page);
  await waitForBackendSocket(page);
  await seedAppSettings(page, {
    agentCommand: `node ${AGENT_BURST_STREAM_SCRIPT} --chunks ${options.chunkCount} --interval-ms ${options.intervalMs} --prefix mix-agent`,
  });

  const controller = await currentWorkspaceController(page, workspace.workspaceId);
  const terminal = await invokeRpc<{ id: number }>(page, 'terminal_create', {
    ...controller,
    cwd: workspace.workspacePath,
    target: workspace.target,
    cols: 120,
    rows: 30,
  });
  const session = await invokeRpc<{ id: number }>(page, 'create_session', {
    ...controller,
    mode: 'branch',
    provider: 'claude',
  });
  const sessionId = String(session.id);
  const probeFile = await writeBurstProbeFile(
    workspace.workspacePath,
    'mix-term',
    options.chunkCount,
  );

  try {
    await page.waitForTimeout(150);
    const frameCursor = await readTransportFrameCursor(page);
    await invokeRpc(page, 'terminal_write', {
      ...controller,
      terminalId: terminal.id,
      input: buildTerminalBurstInput(workspace.target, probeFile),
    });
    await invokeRpc(page, 'agent_start', {
      ...controller,
      sessionId,
      cols: 120,
      rows: 30,
    });

    const finalAgentMarker = `mix-agent-${String(options.chunkCount - 1).padStart(2, '0')}`;
    const finalTerminalMarker = `mix-term-${String(options.chunkCount - 1).padStart(2, '0')}`;
    await expect
      .poll(async () => {
        const agent = await readAgentStreamFrames(page, sessionId, 'stdout', frameCursor);
        const terminalFrames = await readTerminalStreamFrames(page, terminal.id, frameCursor);
        return agent.text.includes(finalAgentMarker) && terminalFrames.text.includes(finalTerminalMarker);
      }, {
        timeout: TRANSPORT_EVENT_TIMEOUT_MS,
      })
      .toBe(true);
    await page.waitForTimeout(150);

    const agentFrames = await readAgentStreamFrames(page, sessionId, 'stdout', frameCursor);
    const terminalFrames = await readTerminalStreamFrames(page, terminal.id, frameCursor);
    return {
      agentFrameCount: agentFrames.frameCount,
      terminalFrameCount: terminalFrames.frameCount,
      totalFrameCount: agentFrames.frameCount + terminalFrames.frameCount,
      agentText: agentFrames.text,
      terminalText: terminalFrames.text,
    };
  } finally {
    await fs.rm(probeFile, { force: true });
  }
}

async function observeArtifactsDirtyBaseline(page: Page): Promise<ArtifactsDirtyBaseline> {
  await installTransportProbe(page);
  const workspace = await openWorkspace(page);
  await waitForBackendSocket(page);
  const controller = await currentWorkspaceController(page, workspace.workspaceId);

  const preview = await invokeRpc<{ path: string; content: string }>(page, 'file_preview', {
    path: WORKSPACE_PROBE_FILE,
  });
  await invokeRpc(page, 'file_save', {
    ...controller,
    path: preview.path,
    content: preview.content,
  });

  const dirtyFrame = await waitForWsEvent(
    page,
    'workspace://artifacts_dirty',
    (payload) => payload.path === preview.path && payload.reason === 'file_save',
  );

  return {
    dirtyFrame,
    savedPath: preview.path,
  };
}

async function observeWatcherInvalidationBaseline(page: Page): Promise<WatcherInvalidationBaseline> {
  await installTransportProbe(page);
  const workspace = await openWorkspace(page);
  await waitForBackendSocket(page);

  const probeFile = path.join(
    WORKSPACE_PATH,
    'tests',
    'e2e',
    `.transport-watcher-probe-${process.pid}-${Date.now()}.txt`,
  );
  const predicate = (payload: Record<string, unknown>) =>
    payload.path === workspace.workspacePath && payload.reason === 'file_watcher';

  await fs.mkdir(path.dirname(probeFile), { recursive: true });
  try {
    let dirtyFrame: WsEventFrame | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await fs.writeFile(probeFile, `watcher ${Date.now()}-${attempt}\n`, 'utf8');
      try {
        dirtyFrame = await waitForWsEvent(
          page,
          'workspace://artifacts_dirty',
          predicate,
          2500,
        );
        break;
      } catch (error) {
        lastError = error;
        await page.waitForTimeout(350);
      }
    }
    if (!dirtyFrame) {
      throw lastError ?? new Error('watcher_invalidation_timeout');
    }

    return {
      dirtyFrame,
      workspacePath: workspace.workspacePath,
    };
  } finally {
    await fs.rm(probeFile, { force: true });
  }
}

async function observeGitIndexInvalidationBaseline(page: Page): Promise<GitIndexInvalidationBaseline> {
  const probe = await installTransportProbe(page);
  const workspace = await openWorkspace(page);
  await waitForBackendSocket(page);
  await waitForPollCycle(probe.counts);

  const probeFile = path.join(
    WORKSPACE_PATH,
    'tests',
    'e2e',
    `.transport-index-probe-${process.pid}-${Date.now()}.txt`,
  );
  const predicate = (payload: Record<string, unknown>) =>
    payload.path === workspace.workspacePath && payload.reason === 'file_watcher';
  const baselineCount = await countWsEvents(page, 'workspace://artifacts_dirty', predicate);
  const countsBeforeFileWrite = snapshotCounts(probe.counts);

  await fs.mkdir(path.dirname(probeFile), { recursive: true });
  try {
    await fs.writeFile(probeFile, `index ${Date.now()}\n`, 'utf8');
    await waitForWsEventCount(page, 'workspace://artifacts_dirty', predicate, baselineCount + 1);
    await waitForCountsAtLeast(probe.counts, incrementCounts(countsBeforeFileWrite));
    await page.waitForTimeout(1500);
    const countsAfterFileWrite = await countWsEvents(page, 'workspace://artifacts_dirty', predicate);

    await execFileAsync('git', ['add', '--', probeFile], { cwd: WORKSPACE_PATH });
    await waitForWsEventCount(page, 'workspace://artifacts_dirty', predicate, countsAfterFileWrite + 1, 15000);
    const countsAfterGitAdd = await countWsEvents(page, 'workspace://artifacts_dirty', predicate);

    return {
      workspacePath: workspace.workspacePath,
      countsAfterFileWrite,
      countsAfterGitAdd,
    };
  } finally {
    try {
      await execFileAsync('git', ['reset', 'HEAD', '--', probeFile], { cwd: WORKSPACE_PATH });
    } catch {
      // Best-effort cleanup for repos without HEAD or already-reset files.
    }
    await fs.rm(probeFile, { force: true });
  }
}

async function installTransportProbe(
  page: Page,
  options: { pollIntervalMs?: number } = {},
) {
  const counts = emptyPollCounts();
  const rpcCounts: RpcCounts = {};
  const initialCommandOrder: PollCommand[] = [];
  const pollIntervalMs = options.pollIntervalMs ?? 4000;

  await page.addInitScript(({ pollIntervalMs }: { pollIntervalMs: number }) => {
    const NativeWebSocket = window.WebSocket;
    const nativeSetTimeout = window.setTimeout.bind(window);
    (window as typeof window & {
      __CODER_STUDIO_ARTIFACT_FALLBACK_POLL_INTERVAL_MS__?: number;
    }).__CODER_STUDIO_ARTIFACT_FALLBACK_POLL_INTERVAL_MS__ = pollIntervalMs;
    const store = {
      urls: [] as string[],
      connectTimes: [] as number[],
      openTimes: [] as number[],
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
      socket.addEventListener('open', () => {
        store.openTimes.push(Date.now());
      });
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
          openTimes: [...store.openTimes],
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
  }, { pollIntervalMs });

  await page.route('**/api/rpc/*', async (route) => {
    const command = rpcCommand(route.request().url());
    rpcCounts[command] = (rpcCounts[command] ?? 0) + 1;
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
    rpcCounts,
  };
}

async function openWorkspace(
  page: Page,
  ids: { deviceId: string; clientId: string } = DEFAULT_TRANSPORT_IDS,
  workspacePath = WORKSPACE_PATH,
): Promise<WorkspaceHandle> {
  await seedWorkspaceControllerIds(page, ids);
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
      pathOrUrl: workspacePath,
      target: { type: 'native' },
    },
    deviceId: ids.deviceId,
    clientId: ids.clientId,
  });

  const workspaceId = launch.snapshot.workspace.workspace_id;
  const bootstrapRequest = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().includes('/api/rpc/workbench_bootstrap'),
  {
    timeout: 15000,
  }).catch(() => null);
  await page.goto(`/workspace/${workspaceId}`);
  await bootstrapRequest;
  await waitForWorkspaceTopbar(page);

  return {
    workspaceId,
    workspacePath: launch.snapshot.workspace.project_path,
    target: launch.snapshot.workspace.target,
  };
}

async function seedWorkspaceControllerIds(
  page: Page,
  ids: { deviceId: string; clientId: string },
) {
  await page.addInitScript(({ deviceId, clientId }) => {
    window.localStorage.setItem('coder-studio.workspace-device-id', deviceId);
    window.sessionStorage.setItem('coder-studio.workspace-client-id', clientId);
  }, ids);
}

async function currentWorkspaceController(
  page: Page,
  workspaceId: string,
  ids?: { deviceId: string; clientId: string },
): Promise<WorkspaceControllerMutation> {
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
}

async function waitForWorkspaceControllerState(
  page: Page,
  workspaceId: string,
  ids: { deviceId: string; clientId: string },
  predicate: (controller: WorkspaceControllerLeaseSnapshot) => boolean,
  timeoutMs = 15000,
): Promise<WorkspaceControllerLeaseSnapshot> {
  await expect
    .poll(async () => {
      const runtime = await invokeRpc<{
        controller: WorkspaceControllerLeaseSnapshot;
      }>(page, 'workspace_runtime_attach', {
        workspaceId,
        deviceId: ids.deviceId,
        clientId: ids.clientId,
      });
      return predicate(runtime.controller) ? runtime.controller : null;
    }, {
      timeout: timeoutMs,
    })
    .not.toBeNull();

  const runtime = await invokeRpc<{
    controller: WorkspaceControllerLeaseSnapshot;
  }>(page, 'workspace_runtime_attach', {
    workspaceId,
    deviceId: ids.deviceId,
    clientId: ids.clientId,
  });
  return runtime.controller;
}

async function invokeRpc<T>(page: Page, command: string, payload: Record<string, unknown> = {}) {
  const response = await page.request.post(`/api/rpc/${command}`, { data: payload });
  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`RPC ${command} failed with ${response.status()}: ${body}`);
  }
  const body = await response.json();
  expect(body.ok).not.toBe(false);
  return body.data as T;
}

async function waitForWorkspaceTopbar(page: Page, timeout = 15000) {
  await expect(page.getByTestId('workspace-topbar')).toBeVisible({ timeout });
}

async function closeAllOpenWorkspaces(page: Page) {
  const bootstrap = await invokeRpc<{
    ui_state: {
      open_workspace_ids: string[];
    };
  }>(page, 'workbench_bootstrap', DEFAULT_TRANSPORT_IDS);

  for (const workspaceId of bootstrap.ui_state.open_workspace_ids) {
    const controller = await currentWorkspaceController(page, workspaceId, DEFAULT_TRANSPORT_IDS);
    await invokeRpc(page, 'close_workspace', controller);
  }
}

async function closeWorkspaceBestEffort(
  page: Page,
  workspaceId: string,
  ids: { deviceId: string; clientId: string } = DEFAULT_TRANSPORT_IDS,
) {
  try {
    const controller = await currentWorkspaceController(page, workspaceId, ids);
    await invokeRpc(page, 'close_workspace', controller);
  } catch {
    // Best-effort cleanup for flaky transport cases.
  }
}

async function removeExternalWorkspace(workspacePath: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(workspacePath, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== 'EBUSY' && code !== 'EPERM') || attempt === 4) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
}

async function waitForPollCycle(counts: PollCounts) {
  await expect
    .poll(() => {
      const snapshot = snapshotCounts(counts);
      return Object.values(snapshot).every((count) => count >= 1);
    }, {
      timeout: 10000,
    })
    .toBe(true);
}

async function waitForCounts(actual: PollCounts, expected: PollCounts) {
  await expect
    .poll(() => snapshotCounts(actual), {
      timeout: 10000,
    })
    .toEqual(expected);
}

async function waitForCountsAtLeast(actual: PollCounts, expectedMinimum: PollCounts) {
  await expect
    .poll(() => {
      const snapshot = snapshotCounts(actual);
      return snapshot.git_status >= expectedMinimum.git_status
        && snapshot.git_changes >= expectedMinimum.git_changes
        && snapshot.worktree_list >= expectedMinimum.worktree_list
        && snapshot.workspace_tree >= expectedMinimum.workspace_tree;
    }, {
      timeout: 10000,
    })
    .toBe(true);
}

function snapshotCounts(counts: PollCounts): PollCounts {
  return {
    git_status: counts.git_status,
    git_changes: counts.git_changes,
    worktree_list: counts.worktree_list,
    workspace_tree: counts.workspace_tree,
  };
}

function expectPollCountsToAdvanceFrom(actual: PollCounts, baseline: PollCounts) {
  expect(actual.git_status).toBeGreaterThan(baseline.git_status);
  expect(actual.git_changes).toBeGreaterThan(baseline.git_changes);
  expect(actual.worktree_list).toBeGreaterThan(baseline.worktree_list);
  expect(actual.workspace_tree).toBeGreaterThan(baseline.workspace_tree);
}

function expectPollCountsNotToRegressFrom(actual: PollCounts, baseline: PollCounts) {
  expect(actual.git_status).toBeGreaterThanOrEqual(baseline.git_status);
  expect(actual.git_changes).toBeGreaterThanOrEqual(baseline.git_changes);
  expect(actual.worktree_list).toBeGreaterThanOrEqual(baseline.worktree_list);
  expect(actual.workspace_tree).toBeGreaterThanOrEqual(baseline.workspace_tree);
}

function rpcCommand(url: string) {
  return url.split('/api/rpc/')[1]?.split('?')[0] ?? '';
}

function isPollCommand(command: string): command is PollCommand {
  return POLL_COMMANDS.includes(command as PollCommand);
}

function isWindowsNativeTarget(target: WorkspaceHandle['target']) {
  return process.platform === 'win32' && target.type === 'native';
}

function normalizePathForComparison(value: string) {
  return value.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase();
}

function buildTerminalProbeInput(target: WorkspaceHandle['target']) {
  return isWindowsNativeTarget(target)
    ? 'echo transport-terminal\r'
    : 'printf "transport-terminal\\n"\r';
}

function buildAgentProbeCommand(target: WorkspaceHandle['target']) {
  void target;
  return `node ${AGENT_STDIN_ECHO_SCRIPT}`;
}

function buildAgentProbeInput(target: WorkspaceHandle['target']) {
  void target;
  return 'transport-agent';
}

function buildAgentProbe(target: WorkspaceHandle['target']) {
  if (isWindowsNativeTarget(target)) {
    return {
      mode: 'startup' as const,
      command: 'cmd /Q /D /C exit 0',
      input: null,
      expectedKind: 'system',
      expectedText: AGENT_START_SYSTEM_MESSAGE,
    };
  }

  return {
    mode: 'stdin' as const,
    command: buildAgentProbeCommand(target),
    input: buildAgentProbeInput(target),
    expectedKind: 'stdout',
    expectedText: 'transport-agent',
  };
}

function countTrackedSockets(tracker: TransportTrackerSnapshot, fragment: string) {
  return tracker.urls.filter((url) => url.includes(fragment)).length;
}

async function waitForBackendSocket(page: Page) {
  await expect
    .poll(async () => {
      const tracker = await readTransportTracker(page);
      return tracker.openTimes.length - tracker.closeTimes.length;
    }, {
      timeout: 10000,
    })
    .toBeGreaterThan(0);
}

async function readTransportTracker(page: Page): Promise<TransportTrackerSnapshot> {
  return page.evaluate(() => window.__transportTest!.read());
}

async function waitForWsEvent(
  page: Page,
  eventName: string,
  predicate: (payload: Record<string, unknown>) => boolean,
  timeoutMs = 10000,
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
      timeout: timeoutMs,
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

async function waitForLifecycleReplayEvent(
  page: Page,
  workspaceId: string,
  ids: { deviceId: string; clientId: string },
  sessionId: string,
  kind: string,
  timeoutMs = 10000,
) {
  await expect
    .poll(async () => {
      const runtime = await invokeRpc<{
        lifecycle_events?: Array<{ session_id: string; kind: string }>;
      }>(page, 'workspace_runtime_attach', {
        workspaceId,
        deviceId: ids.deviceId,
        clientId: ids.clientId,
      });
      return runtime.lifecycle_events?.some((event) =>
        event.session_id === sessionId && event.kind === kind
      ) ?? false;
    }, {
      timeout: timeoutMs,
    })
    .toBe(true);
}

async function waitForLifecycleReplayEntry(
  page: Page,
  workspaceId: string,
  ids: { deviceId: string; clientId: string },
  predicate: (event: { session_id: string; kind: string; data?: string }) => boolean,
  timeoutMs = 10000,
) {
  await expect
    .poll(async () => {
      const runtime = await invokeRpc<{
        lifecycle_events?: Array<{ session_id: string; kind: string; data?: string }>;
      }>(page, 'workspace_runtime_attach', {
        workspaceId,
        deviceId: ids.deviceId,
        clientId: ids.clientId,
      });
      return runtime.lifecycle_events?.some(predicate) ?? false;
    }, {
      timeout: timeoutMs,
    })
    .toBe(true);
}

async function readWorkspaceReloadDebug(
  page: Page,
  workspaceId: string,
  ids: { deviceId: string; clientId: string },
) {
  const [cards, focusState, runtime] = await Promise.all([
    page.locator('.agent-pane-card').evaluateAll((nodes) => nodes.map((node) => ({
      sessionId: node.getAttribute('data-session-id'),
      status: node.getAttribute('data-session-status'),
      title: node.querySelector('.agent-pane-title')?.textContent?.trim() ?? null,
    }))),
    page.evaluate(() => ({
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
    })),
    invokeRpc<{
      snapshot: {
        sessions: Array<{ id: number }>;
        view_state: {
          active_session_id: string;
          active_pane_id: string;
        };
      };
      controller: {
        controller_device_id?: string | null;
        controller_client_id?: string | null;
        fencing_token?: number;
      };
      lifecycle_events?: Array<{ session_id: string; kind: string; data?: string }>;
    }>(page, 'workspace_runtime_attach', {
      workspaceId,
      deviceId: ids.deviceId,
      clientId: ids.clientId,
    }),
  ]);

  return {
    url: page.url(),
    focusState,
    cards,
    snapshot: {
      sessionIds: runtime.snapshot.sessions.map((session) => session.id),
      activeSessionId: runtime.snapshot.view_state.active_session_id,
      activePaneId: runtime.snapshot.view_state.active_pane_id,
    },
    controller: runtime.controller,
    lifecycleTail: (runtime.lifecycle_events ?? []).slice(-6),
  };
}

async function countWsEvents(
  page: Page,
  eventName: string,
  predicate: (payload: Record<string, unknown>) => boolean,
) {
  const tracker = await readTransportTracker(page);
  return tracker.frames
    .map(parseBackendEnvelope)
    .filter((frame): frame is WsEventFrame =>
      Boolean(frame)
      && frame.event === eventName
      && predicate(frame.payload),
    )
    .length;
}

async function waitForWsEventCount(
  page: Page,
  eventName: string,
  predicate: (payload: Record<string, unknown>) => boolean,
  expectedCount: number,
  timeoutMs = 10000,
) {
  await expect
    .poll(() => countWsEvents(page, eventName, predicate), {
      timeout: timeoutMs,
    })
    .toBeGreaterThanOrEqual(expectedCount);
}

async function readTransportFrameCursor(page: Page) {
  return (await readTransportTracker(page)).frames.length;
}

async function readAgentStreamFrames(
  page: Page,
  sessionId: string,
  kind: 'stdout' | 'stderr',
  fromFrameIndex = 0,
) {
  const tracker = await readTransportTracker(page);
  const frames = tracker.frames
    .slice(fromFrameIndex)
    .map(parseBackendEnvelope)
    .filter((frame): frame is WsEventFrame =>
      Boolean(frame)
      && frame.event === 'agent://event'
      && frame.payload.session_id === sessionId
      && frame.payload.kind === kind,
    );

  return {
    frameCount: frames.length,
    text: frames.map((frame) => String(frame.payload.data ?? '')).join(''),
  };
}

async function readTerminalStreamFrames(
  page: Page,
  terminalId: number,
  fromFrameIndex = 0,
) {
  const tracker = await readTransportTracker(page);
  const frames = tracker.frames
    .slice(fromFrameIndex)
    .map(parseBackendEnvelope)
    .filter((frame): frame is WsEventFrame =>
      Boolean(frame)
      && frame.event === 'terminal://event'
      && frame.payload.terminal_id === terminalId,
    );

  return {
    frameCount: frames.length,
    text: frames.map((frame) => String(frame.payload.data ?? '')).join(''),
  };
}

async function writeBurstProbeFile(workspacePath: string, prefix: string, chunkCount: number) {
  const probeFile = path.join(
    workspacePath,
    `.${prefix}-${process.pid}-${Date.now()}.txt`,
  );
  const lines = Array.from({ length: chunkCount }, (_, index) =>
    `${prefix}-${String(index).padStart(2, '0')}`,
  ).join('\n');
  await fs.writeFile(probeFile, `${lines}\n`, 'utf8');
  return probeFile;
}

function buildTerminalBurstInput(target: WorkspaceHandle['target'], filePath: string) {
  if (isWindowsNativeTarget(target)) {
    return `type "${filePath.replaceAll('"', '""')}"\r`;
  }
  return `cat ${quotePosixShellArg(filePath)}\r`;
}

function quotePosixShellArg(value: string) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function emitBurstMeasure(
  scenario: 'agent' | 'terminal' | 'mixed',
  measure: Record<string, number>,
) {
  if (!BURST_EMIT_MEASURE) {
    return;
  }
  console.log(`__TRANSPORT_BURST_MEASURE__ ${JSON.stringify({
    scenario,
    ...measure,
  })}`);
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

function readIntEnv(name: string, fallback: number, minimum: number) {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

declare global {
  interface Window {
    __transportTest?: {
      read: () => TransportTrackerSnapshot;
      closeMatching: (fragment: string) => void;
    };
  }
}
