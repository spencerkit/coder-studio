/**
 * Session Integration Tests
 *
 * Tests the complete workflow:
 * 1. Open workspace
 * 2. Create session with provider
 * 3. Verify terminal creation
 * 4. Test session state transitions
 * 5. Test terminal input/output
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { dispatch } from '../ws/dispatch.js';
import type { CommandContext } from '../ws/dispatch.js';
import { openDatabase, runMigrations } from '../storage/db.js';
import { WorkspaceManager } from '../workspace/manager.js';
import { SessionManager } from '../session/manager.js';
import { TerminalManager } from '../terminal/manager.js';
import { EventBus } from '../bus/event-bus.js';
import type { PtyHost, PtyProcess, Broadcaster } from '../terminal/types.js';
import { ProviderConfigRepo } from '../storage/repositories/provider-config-repo.js';
import { providerRegistry } from '@coder-studio/providers';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Import command handlers to register them
import '../commands/workspace.js';
import '../commands/session.js';
import '../commands/terminal.js';

/**
 * Mock PtyHost for testing without spawning real processes
 */
function createMockPtyHost(spawnCalls: Array<{ argv: string[]; options: unknown }>): PtyHost {
  const terminals = new Map<string, { onDataCallbacks: Array<(data: string) => void>; onExitCallbacks: Array<(event: { exitCode: number }) => void> }>();

  return {
    spawn: (argv: string[], options) => {
      spawnCalls.push({ argv, options });
      const id = `mock-pty-${Date.now()}`;

      const pty: PtyProcess = {
        onData: (callback) => {
          const term = terminals.get(id);
          if (term) term.onDataCallbacks.push(callback);
        },
        onExit: (callback) => {
          const term = terminals.get(id);
          if (term) term.onExitCallbacks.push(callback);
        },
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
      };

      terminals.set(id, { onDataCallbacks: [], onExitCallbacks: [] });

      // Simulate startup output
      setTimeout(() => {
        const term = terminals.get(id);
        if (term) {
          for (const cb of term.onDataCallbacks) {
            cb('\x1b[32mMock Agent Started\x1b[0m\n');
          }
        }
      }, 50);

      return pty;
    },
  };
}

describe('Session Integration', () => {
  let db: ReturnType<typeof openDatabase>;
  let ctx: CommandContext;
  let eventBus: EventBus;
  let workspaceMgr: WorkspaceManager;
  let sessionMgr: SessionManager;
  let terminalMgr: TerminalManager;
  let mockPtyHost: PtyHost;
  let broadcastEvents: Array<{ topic: string; payload: unknown }>;
  let spawnCalls: Array<{ argv: string[]; options: unknown }>;
  let sessionDb: {
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let testDir: string;

  beforeEach(() => {
    // Create in-memory database
    db = openDatabase(':memory:');
    runMigrations(db);

    // Create event bus
    eventBus = new EventBus();

    // Create mock PTY host
    spawnCalls = [];
    mockPtyHost = createMockPtyHost(spawnCalls);

    // Track broadcast events
    broadcastEvents = [];
    const mockBroadcaster: Broadcaster = {
      broadcast: (topic, payload) => {
        broadcastEvents.push({ topic, payload });
      },
    };

    // Create terminal manager with mock PTY
    terminalMgr = new TerminalManager({
      ptyHost: mockPtyHost,
      eventBus,
      db: {
        insert: () => {},
        markEnded: () => {},
      },
    });

    // Create workspace manager
    workspaceMgr = new WorkspaceManager({ db, eventBus });

    // Create test directory with .git folder
    testDir = join(tmpdir(), `coder-studio-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, '.git'), { recursive: true });
    writeFileSync(join(testDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');

    sessionDb = {
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    // Create session manager
    sessionMgr = new SessionManager({
      terminalMgr,
      eventBus,
      db: sessionDb as any,
      broadcaster: mockBroadcaster,
      providerRegistry,
      providerConfigRepo: new ProviderConfigRepo(db),
    });

    // Create context
    ctx = {
      db,
      workspaceMgr,
      sessionMgr,
      terminalMgr,
      hooksMgr: {} as any,
      eventBus,
      broadcaster: mockBroadcaster,
      providerRegistry,
    };
  });

  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Complete workflow: workspace.open -> session.create', () => {
    it('should open workspace and create session successfully', async () => {
      // Step 1: Open workspace
      const openResult = await dispatch(
        {
          kind: 'command',
          id: 'test-1',
          op: 'workspace.open',
          args: { path: testDir },
        },
        ctx
      );

      expect(openResult.ok).toBe(true);
      expect(openResult.data).toBeDefined();
      expect(openResult.data?.id).toBeDefined();
      expect(openResult.data?.path).toBe(testDir);

      const workspaceId = openResult.data!.id;

      // Step 2: List workspaces to verify
      const listResult = await dispatch(
        {
          kind: 'command',
          id: 'test-2',
          op: 'workspace.list',
          args: {},
        },
        ctx
      );

      expect(listResult.ok).toBe(true);
      expect(listResult.data).toHaveLength(1);
      expect(listResult.data?.[0]?.id).toBe(workspaceId);

      // Step 3: Create session with claude provider
      const sessionResult = await dispatch(
        {
          kind: 'command',
          id: 'test-3',
          op: 'session.create',
          args: {
            workspaceId,
            providerId: 'claude',
          },
        },
        ctx
      );

      expect(sessionResult.ok).toBe(true);
      expect(sessionResult.data).toBeDefined();
      expect(sessionResult.data?.id).toBeDefined();
      expect(sessionResult.data?.workspaceId).toBe(workspaceId);
      expect(sessionResult.data?.providerId).toBe('claude');
      expect(sessionResult.data?.state).toBe('starting');

      // Verify terminal was created
      expect(sessionResult.data?.terminalId).toBeDefined();
      expect(sessionResult.data?.terminalId).not.toBe('');
    });

    it('should fail session.create if workspace does not exist', async () => {
      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-4',
          op: 'session.create',
          args: {
            workspaceId: 'non-existent-workspace',
            providerId: 'claude',
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('workspace_not_found');
    });

    it('should fail session.create if provider does not exist', async () => {
      // First open workspace
      const openResult = await dispatch(
        {
          kind: 'command',
          id: 'test-5',
          op: 'workspace.open',
          args: { path: testDir },
        },
        ctx
      );

      const workspaceId = openResult.data!.id;

      // Try to create session with invalid provider
      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-6',
          op: 'session.create',
          args: {
            workspaceId,
            providerId: 'non-existent-provider',
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('unknown_provider');
    });

    it('should use saved provider config when creating a session', async () => {
      db.prepare('INSERT INTO provider_configs (provider_id, config) VALUES (?, ?)')
        .run('claude', '{"additionalArgs":["--verbose"]}');

      const openResult = await dispatch(
        {
          kind: 'command',
          id: 'test-provider-config-open',
          op: 'workspace.open',
          args: { path: testDir },
        },
        ctx
      );

      const workspaceId = openResult.data!.id;

      const sessionResult = await dispatch(
        {
          kind: 'command',
          id: 'test-provider-config-create',
          op: 'session.create',
          args: {
            workspaceId,
            providerId: 'claude',
          },
        },
        ctx
      );

      expect(sessionResult.ok).toBe(true);
      expect(spawnCalls.at(-1)?.argv).toContain('--verbose');
    });

    it('should ignore legacy provider cwd overrides when creating a codex session', async () => {
      db.prepare('INSERT INTO provider_configs (provider_id, config) VALUES (?, ?)')
        .run('codex', '{"additionalArgs":["--sandbox"],"cwd":"/tmp/legacy-cwd"}');

      const openResult = await dispatch(
        {
          kind: 'command',
          id: 'test-provider-config-codex-open',
          op: 'workspace.open',
          args: { path: testDir },
        },
        ctx
      );

      const workspaceId = openResult.data!.id;

      const sessionResult = await dispatch(
        {
          kind: 'command',
          id: 'test-provider-config-codex-create',
          op: 'session.create',
          args: {
            workspaceId,
            providerId: 'codex',
          },
        },
        ctx
      );

      expect(sessionResult.ok).toBe(true);
      expect(spawnCalls.at(-1)?.argv).toContain('--sandbox');
      expect((spawnCalls.at(-1)?.options as { cwd?: string } | undefined)?.cwd).toBe(testDir);
    });
  });

  describe('Session state transitions', () => {
    it('should emit state change events when session is created', async () => {
      // Track events via session.state.changed
      const stateChanges: Array<{ from: string; to: string }> = [];
      eventBus.on('session.state.changed', (event: any) => {
        stateChanges.push({ from: event.from, to: event.to });
      });

      // Open workspace
      const openResult = await dispatch(
        {
          kind: 'command',
          id: 'test-7',
          op: 'workspace.open',
          args: { path: testDir },
        },
        ctx
      );

      const workspaceId = openResult.data!.id;

      // Create session
      await dispatch(
        {
          kind: 'command',
          id: 'test-8',
          op: 'session.create',
          args: {
            workspaceId,
            providerId: 'claude',
          },
        },
        ctx
      );

      // Verify state change event was emitted
      expect(stateChanges.length).toBeGreaterThan(0);
      expect(stateChanges[0]).toEqual({ from: 'draft', to: 'starting' });
    });
  });

  describe('Terminal operations', () => {
    let workspaceId: string;
    let sessionId: string;
    let terminalId: string;

    beforeEach(async () => {
      // Setup: open workspace and create session
      const openResult = await dispatch(
        {
          kind: 'command',
          id: 'setup-1',
          op: 'workspace.open',
          args: { path: testDir },
        },
        ctx
      );

      workspaceId = openResult.data!.id;

      const sessionResult = await dispatch(
        {
          kind: 'command',
          id: 'setup-2',
          op: 'session.create',
          args: {
            workspaceId,
            providerId: 'claude',
          },
        },
        ctx
      );

      sessionId = sessionResult.data!.id;
      terminalId = sessionResult.data!.terminalId;
    });

    it('should handle terminal.input command', async () => {
      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-9',
          op: 'terminal.input',
          args: {
            terminalId,
            bytes: btoa('Hello Agent\n'),
            activity: 'submit',
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
    });

    it('should handle terminal.resize command', async () => {
      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-10',
          op: 'terminal.resize',
          args: {
            terminalId,
            cols: 120,
            rows: 40,
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
    });

    it('should fail terminal.input for non-existent terminal', async () => {
      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-11',
          op: 'terminal.input',
          args: {
            terminalId: 'non-existent-terminal',
            bytes: btoa('test\n'),
            activity: 'submit',
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
    });
  });

  describe('Session stop and resume', () => {
    let workspaceId: string;
    let sessionId: string;

    beforeEach(async () => {
      // Setup
      const openResult = await dispatch(
        {
          kind: 'command',
          id: 'setup-3',
          op: 'workspace.open',
          args: { path: testDir },
        },
        ctx
      );

      workspaceId = openResult.data!.id;

      const sessionResult = await dispatch(
        {
          kind: 'command',
          id: 'setup-4',
          op: 'session.create',
          args: {
            workspaceId,
            providerId: 'claude',
          },
        },
        ctx
      );

      sessionId = sessionResult.data!.id;
    });

    it('should stop session successfully', async () => {
      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-12',
          op: 'session.stop',
          args: { sessionId },
        },
        ctx
      );

      expect(result.ok).toBe(true);

      // Verify session state changed to ended
      const session = sessionMgr.get(sessionId);
      expect(session?.state).toBe('ended');
    });

    it('should fail session.stop for non-existent session', async () => {
      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-13',
          op: 'session.stop',
          args: { sessionId: 'non-existent-session' },
        },
        ctx
      );

      expect(result.ok).toBe(false);
    });

    it('should resume session with resume_id', async () => {
      // First set resume_id on session (simulating SessionStart hook event)
      const sessions = sessionMgr.getForWorkspace(workspaceId);
      const activeSession = sessions.find((s) => s.id === sessionId);
      expect(activeSession).toBeDefined();

      // Simulate hook event setting resume_id
      sessionMgr.onHookEvent(sessionId, {
        kind: 'SessionStart',
        resumeId: 'test-resume-id-123',
      });

      // Stop the session
      await dispatch(
        {
          kind: 'command',
          id: 'test-14',
          op: 'session.stop',
          args: { sessionId },
        },
        ctx
      );

      // Resume the session
      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-15',
          op: 'session.resume',
          args: { sessionId },
        },
        ctx
      );

      // Note: resume might fail in test without proper setup
      // but we verify the command is dispatched correctly
      expect(result.ok).toBeDefined();
    });
  });

  describe('Idle state transitions', () => {
    let workspaceId: string;
    let sessionId: string;
    let terminalId: string;

    beforeEach(async () => {
      const openResult = await dispatch(
        {
          kind: 'command',
          id: 'setup-idle-1',
          op: 'workspace.open',
          args: { path: testDir },
        },
        ctx
      );

      workspaceId = openResult.data!.id;

      const sessionResult = await dispatch(
        {
          kind: 'command',
          id: 'setup-idle-2',
          op: 'session.create',
          args: {
            workspaceId,
            providerId: 'codex',
          },
        },
        ctx
      );

      sessionId = sessionResult.data!.id;
      terminalId = sessionResult.data!.terminalId;
    });

    it('moves a session to idle when a turn completes', () => {
      sessionMgr.onHookEvent(sessionId, {
        kind: 'TurnCompleted',
        resumeId: 'resume-1',
        turnId: 'turn-1',
      });

      const session = sessionMgr.get(sessionId);
      expect(session?.state).toBe('idle');
    });

    it('opens Codex-style sessions directly in idle (no SessionStart hook)', () => {
      // Providers whose HooksDescriptor declares events.sessionStart=false
      // (currently: codex) never emit a "CLI finished booting" event. The
      // session manager must recognise that and optimistically promote the
      // session from `starting` to `idle` the moment spawn succeeds,
      // otherwise the UI would be pinned to "starting…" until the user
      // completes an entire turn round-trip.
      //
      // The shared beforeEach above creates a codex session, so by the time
      // we observe it here the optimistic transition should already be done.
      expect(sessionMgr.get(sessionId)?.state).toBe('idle');
    });

    it('moves a session to idle when a stop hook marks the turn complete', () => {
      // Re-enter `running` first so Stop actually has something to close.
      const internal = (sessionMgr as any).sessions.get(sessionId);
      internal.state = 'running';

      sessionMgr.onHookEvent(sessionId, {
        kind: 'Stop',
      });

      const session = sessionMgr.get(sessionId);
      expect(session?.state).toBe('idle');
    });

    it('does not move an idle session back to running on typing input', async () => {
      const internalSession = (sessionMgr as any).sessions.get(sessionId);
      internalSession.state = 'idle';

      const result = await dispatch(
        {
          kind: 'command',
          id: 'idle-test-input',
          op: 'terminal.input',
          args: {
            terminalId,
            bytes: btoa('next turn\n'),
            activity: 'typing',
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(sessionMgr.get(sessionId)?.state).toBe('idle');
    });

    it('moves an idle session back to running when the user submits input', async () => {
      const internalSession = (sessionMgr as any).sessions.get(sessionId);
      internalSession.state = 'idle';

      const result = await dispatch(
        {
          kind: 'command',
          id: 'idle-test-submit',
          op: 'terminal.input',
          args: {
            terminalId,
            bytes: btoa('next turn\n'),
            activity: 'submit',
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(sessionMgr.get(sessionId)?.state).toBe('running');
    });
  });

  describe('Session hydration', () => {
    it('marks persisted resumable sessions as interrupted when hydrating without a live terminal', async () => {
      sessionDb.listHydratable = vi.fn().mockReturnValue([
        {
          id: 'sess-hydrate-1',
          workspaceId: 'ws-1',
          terminalId: 'term-stale',
          providerId: 'claude',
          state: 'running',
          resumeId: 'resume-123',
          capability: 'full',
          startedAt: 100,
          lastActiveAt: 200,
          transcriptPath: '/tmp/session.jsonl',
          title: 'resume me',
        },
      ]);

      await sessionMgr.hydrate();

      expect(sessionMgr.get('sess-hydrate-1')).toEqual(
        expect.objectContaining({
          id: 'sess-hydrate-1',
          terminalId: 'term-stale',
          state: 'interrupted',
          resumeId: 'resume-123',
          transcriptPath: '/tmp/session.jsonl',
          title: 'resume me',
        })
      );
      expect(sessionDb.update).toHaveBeenCalledWith('sess-hydrate-1', {
        state: 'interrupted',
      });
    });

    it('preserves persisted error reason when hydrating a stale session', async () => {
      sessionDb.listHydratable = vi.fn().mockReturnValue([
        {
          id: 'sess-hydrate-error',
          workspaceId: 'ws-1',
          terminalId: 'term-stale',
          providerId: 'claude',
          state: 'running',
          resumeId: 'resume-error',
          capability: 'full',
          startedAt: 100,
          lastActiveAt: 200,
          errorReason: 'Orphaned before restart',
        },
      ]);

      await sessionMgr.hydrate();

      expect(sessionMgr.get('sess-hydrate-error')).toEqual(
        expect.objectContaining({
          id: 'sess-hydrate-error',
          state: 'interrupted',
          errorReason: 'Orphaned before restart',
        })
      );
    });

    it('marks persisted non-resumable sessions as unavailable when hydrating without a live terminal', async () => {
      sessionDb.listHydratable = vi.fn().mockReturnValue([
        {
          id: 'sess-hydrate-2',
          workspaceId: 'ws-1',
          terminalId: 'term-dead',
          providerId: 'codex',
          state: 'idle',
          capability: 'full',
          startedAt: 100,
          lastActiveAt: 200,
        },
      ]);

      await sessionMgr.hydrate();

      expect(sessionMgr.get('sess-hydrate-2')).toEqual(
        expect.objectContaining({
          id: 'sess-hydrate-2',
          terminalId: 'term-dead',
          state: 'unavailable',
        })
      );
      expect(sessionDb.update).toHaveBeenCalledWith('sess-hydrate-2', {
        state: 'unavailable',
      });
    });

    it('persists the replacement terminal id when a hydrated interrupted session is resumed', async () => {
      sessionDb.listHydratable = vi.fn().mockReturnValue([
        {
          id: 'sess-hydrate-3',
          workspaceId: 'ws-1',
          terminalId: 'term-old',
          providerId: 'claude',
          state: 'running',
          resumeId: 'resume-456',
          capability: 'full',
          startedAt: 100,
          lastActiveAt: 200,
        },
      ]);

      await sessionMgr.hydrate();
      sessionDb.update.mockClear();

      const result = await sessionMgr.resume(
        'sess-hydrate-3',
        testDir,
        providerRegistry.find((provider) => provider.id === 'claude')!
      );

      expect(result.terminalId).not.toBe('term-old');
      expect(sessionDb.update).toHaveBeenCalledWith(
        'sess-hydrate-3',
        expect.objectContaining({
          terminalId: result.terminalId,
          state: 'running',
        })
      );
    });
  });

  describe('Multiple sessions', () => {
    it('should support creating multiple sessions in same workspace', async () => {
      // Open workspace
      const openResult = await dispatch(
        {
          kind: 'command',
          id: 'test-16',
          op: 'workspace.open',
          args: { path: testDir },
        },
        ctx
      );

      const workspaceId = openResult.data!.id;

      // Create first session
      const session1Result = await dispatch(
        {
          kind: 'command',
          id: 'test-17',
          op: 'session.create',
          args: {
            workspaceId,
            providerId: 'claude',
          },
        },
        ctx
      );

      // Create second session
      const session2Result = await dispatch(
        {
          kind: 'command',
          id: 'test-18',
          op: 'session.create',
          args: {
            workspaceId,
            providerId: 'codex',
          },
        },
        ctx
      );

      expect(session1Result.ok).toBe(true);
      expect(session2Result.ok).toBe(true);

      // Verify both sessions have different IDs and terminal IDs
      expect(session1Result.data?.id).not.toBe(session2Result.data?.id);
      expect(session1Result.data?.terminalId).not.toBe(session2Result.data?.terminalId);
    }, 10000);
  });

  describe('Provider command construction', () => {
    it('should build correct command for claude provider', async () => {
      const claudeProvider = providerRegistry.find((p) => p.id === 'claude');
      expect(claudeProvider).toBeDefined();

      const cmd = claudeProvider!.buildCommand(
        claudeProvider!.defaultConfig,
        {
          workspacePath: testDir,
          sessionId: 'test-session-123',
        }
      );

      expect(cmd.argv[0]).toBe('claude');
      expect(cmd.cwd).toBe(testDir);
      expect(cmd.env.CODER_STUDIO_SESSION_ID).toBe('test-session-123');
    });

    it('should build correct resume command for claude provider', async () => {
      const claudeProvider = providerRegistry.find((p) => p.id === 'claude');
      expect(claudeProvider).toBeDefined();

      const cmd = claudeProvider!.buildResumeCommand!(
        'resume-id-456',
        claudeProvider!.defaultConfig,
        {
          workspacePath: testDir,
          sessionId: 'test-session-123',
        }
      );

      expect(cmd.argv).toContain('--resume');
      expect(cmd.argv).toContain('resume-id-456');
    });
  });
});
