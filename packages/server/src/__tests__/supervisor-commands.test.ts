import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SupervisorManager } from '../supervisor/manager.js';
import type { EventBus } from '../bus/event-bus.js';
import type { Broadcaster } from '../ws/hub.js';

describe('SupervisorManager', () => {
  let manager: SupervisorManager;
  const mockBroadcast = vi.fn();
  const mockDeps = {
    eventBus: { on: vi.fn(), emit: vi.fn() } as unknown as EventBus,
    broadcaster: { broadcast: mockBroadcast } as unknown as Broadcaster,
    terminalMgr: {
      writeToSession: vi.fn(),
      getSessionOutput: vi.fn().mockReturnValue(''),
    } as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SupervisorManager(mockDeps);
  });

  describe('create', () => {
    it('creates a supervisor with idle state', async () => {
      const sup = await manager.create({
        sessionId: 's1',
        workspaceId: 'ws1',
        objective: 'Build login',
      });

      expect(sup.state).toBe('idle');
      expect(sup.objective).toBe('Build login');
      expect(sup.sessionId).toBe('s1');
      expect(sup.id).toBeTruthy();
    });

    it('broadcasts creation event', async () => {
      await manager.create({
        sessionId: 's1',
        workspaceId: 'ws1',
        objective: 'Build login',
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.stringContaining('supervisor.state'),
        expect.objectContaining({ event: 'created' })
      );
    });
  });

  describe('pause/resume', () => {
    it('pauses a supervisor', async () => {
      const sup = await manager.create({
        sessionId: 's1',
        workspaceId: 'ws1',
        objective: 'Test',
      });

      const paused = await manager.pause(sup.id);
      expect(paused.state).toBe('paused');
    });

    it('resumes a paused supervisor', async () => {
      const sup = await manager.create({
        sessionId: 's1',
        workspaceId: 'ws1',
        objective: 'Test',
      });

      await manager.pause(sup.id);
      const resumed = await manager.resume(sup.id);
      expect(resumed.state).toBe('idle');
    });
  });

  describe('triggerEvaluation', () => {
    it('creates a queued cycle', async () => {
      const sup = await manager.create({
        sessionId: 's1',
        workspaceId: 'ws1',
        objective: 'Test',
      });

      const cycle = await manager.triggerEvaluation(sup.id);
      expect(cycle.status).toBe('queued');
      expect(cycle.supervisorId).toBe(sup.id);
    });
  });

  describe('delete', () => {
    it('removes supervisor', async () => {
      const sup = await manager.create({
        sessionId: 's1',
        workspaceId: 'ws1',
        objective: 'Test',
      });

      await manager.delete(sup.id);
      expect(manager.get(sup.id)).toBeUndefined();
    });
  });

  describe('getBySession', () => {
    it('finds supervisor by session ID', async () => {
      const sup = await manager.create({
        sessionId: 's1',
        workspaceId: 'ws1',
        objective: 'Test',
      });

      const found = manager.getBySession('s1');
      expect(found?.id).toBe(sup.id);
    });

    it('returns undefined for unknown session', () => {
      expect(manager.getBySession('unknown')).toBeUndefined();
    });
  });
});