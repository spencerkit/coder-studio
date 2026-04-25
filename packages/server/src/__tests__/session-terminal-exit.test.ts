/**
 * Session Terminal Exit Tests
 *
 * Tests that PTY exit correctly transitions session to 'ended' state
 * and persists to database.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../session/manager.js';
import { TerminalManager } from '../terminal/manager.js';
import { EventBus } from '../bus/event-bus.js';
import type { PtyHost, PtyProcess, Broadcaster } from '../terminal/types.js';
import { ProviderConfigRepo } from '../storage/repositories/provider-config-repo.js';
import { providerRegistry } from '@coder-studio/providers';
import { openDatabase, runMigrations } from '../storage/db.js';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Mock PtyHost that allows triggering exit programmatically
 *
 * Note: This mock tracks processes by creation order, not by terminal ID.
 * The first spawned process is index 0, the second is index 1, etc.
 * This is needed because TerminalManager generates its own terminal IDs
 * (`term_xxx`), while the mock would otherwise generate its own IDs.
 */
function createMockPtyHost(): {
  ptyHost: PtyHost;
  triggerExitForProcessIndex: (processIndex: number, exitCode: number) => void;
} {
  const processes: Array<{
    onDataCallbacks: Array<(data: string) => void>;
    onExitCallbacks: Array<(event: { exitCode: number }) => void>;
  }> = [];

  const ptyHost: PtyHost = {
    spawn: (argv: string[], options) => {
      const processIndex = processes.length;

      const pty: PtyProcess = {
        onData: (callback) => {
          processes[processIndex]?.onDataCallbacks.push(callback);
        },
        onExit: (callback) => {
          processes[processIndex]?.onExitCallbacks.push(callback);
        },
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
      };

      processes.push({ onDataCallbacks: [], onExitCallbacks: [] });

      return pty;
    },
  };

  const triggerExitForProcessIndex = (processIndex: number, exitCode: number) => {
    const proc = processes[processIndex];
    if (proc) {
      for (const cb of proc.onExitCallbacks) {
        cb({ exitCode });
      }
    }
  };

  return { ptyHost, triggerExitForProcessIndex };
}

describe('Session Terminal Exit', () => {
  let db: ReturnType<typeof openDatabase>;
  let eventBus: EventBus;
  let sessionMgr: SessionManager;
  let terminalMgr: TerminalManager;
  let triggerExitForProcessIndex: (processIndex: number, exitCode: number) => void;
  let broadcastEvents: Array<{ topic: string; payload: unknown }>;
  let sessionDb: {
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findByWorkspaceId: ReturnType<typeof vi.fn>;
    listHydratable: ReturnType<typeof vi.fn>;
  };
  let testDir: string;

  beforeEach(() => {
    // Create in-memory database
    db = openDatabase(':memory:');
    runMigrations(db);

    // Create event bus
    eventBus = new EventBus();

    // Create mock PTY host with exit trigger
    const mockPtyHostSetup = createMockPtyHost();
    triggerExitForProcessIndex = mockPtyHostSetup.triggerExitForProcessIndex;

    // Track broadcast events
    broadcastEvents = [];
    const mockBroadcaster: Broadcaster = {
      broadcast: (topic, payload) => {
        broadcastEvents.push({ topic, payload });
      },
    };

    // Create terminal manager with mock PTY
    terminalMgr = new TerminalManager({
      ptyHost: mockPtyHostSetup.ptyHost,
      eventBus,
      db: {
        insert: vi.fn(),
        markEnded: vi.fn(),
      },
    });

    // Create test directory with .git folder
    testDir = join(tmpdir(), `coder-studio-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, '.git'), { recursive: true });
    writeFileSync(join(testDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');

    sessionDb = {
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findById: vi.fn(),
      findByWorkspaceId: vi.fn(),
      listHydratable: vi.fn().mockReturnValue([]),
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

    // SessionManager subscribes to terminal.exited via EventBus in its constructor
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('PTY exit handling', () => {
    it('should transition session to ended when PTY exits', async () => {
      // Create session (this will spawn process at index 0)
      const session = await sessionMgr.create({
        workspaceId: 'ws-test-1',
        workspacePath: testDir,
        providerId: 'codex',
        provider: providerRegistry.find(p => p.id === 'codex')!,
      });

      expect(session.state).toBe('idle');
      expect(session.terminalId).toBeDefined();

      // Trigger PTY exit for process 0
      triggerExitForProcessIndex(0, 0);

      // Verify session transitioned to ended
      const endedSession = sessionMgr.get(session.id);
      expect(endedSession?.state).toBe('ended');
      expect(endedSession?.endedAt).toBeDefined();
    });

    it('should persist session ended state to database when PTY exits', async () => {
      // Create session (this will spawn process at index 0)
      const session = await sessionMgr.create({
        workspaceId: 'ws-test-2',
        workspacePath: testDir,
        providerId: 'codex',
        provider: providerRegistry.find(p => p.id === 'codex')!,
      });

      // Clear previous update calls from initialization
      sessionDb.update.mockClear();

      // Trigger PTY exit for process 0
      triggerExitForProcessIndex(0, 1);

      // Verify database was updated
      expect(sessionDb.update).toHaveBeenCalledWith(
        session.id,
        expect.objectContaining({
          state: 'ended',
          endedAt: expect.any(Number),
        })
      );
    });

    it('should emit state change event when PTY exits', async () => {
      // Track state change events
      const stateChanges: Array<{ from: string; to: string }> = [];
      eventBus.on('session.state.changed', (event: any) => {
        stateChanges.push({ from: event.from, to: event.to });
      });

      // Create session (this will spawn process at index 0)
      const session = await sessionMgr.create({
        workspaceId: 'ws-test-3',
        workspacePath: testDir,
        providerId: 'codex',
        provider: providerRegistry.find(p => p.id === 'codex')!,
      });

      // Clear previous state changes from initialization
      stateChanges.length = 0;

      // Trigger PTY exit for process 0
      triggerExitForProcessIndex(0, 0);

      // Verify state change event was emitted
      expect(stateChanges.length).toBeGreaterThan(0);
      expect(stateChanges[0]).toEqual({ from: 'idle', to: 'ended' });
    });
  });
});