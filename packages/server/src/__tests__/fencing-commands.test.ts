import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FencingManager } from '../ws/fencing.js';

describe('FencingManager', () => {
  let manager: FencingManager;
  const mockReq = {
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test-agent' },
  } as any;

  beforeEach(() => {
    manager = new FencingManager();
  });

  describe('requestControl', () => {
    it('grants control when no existing controller', () => {
      const result = manager.requestControl('ws1', 'client1', 'tab1', mockReq);
      expect(result.isController).toBe(true);
    });

    it('rejects when another client is controller', () => {
      manager.requestControl('ws1', 'client1', 'tab1', mockReq);
      const result = manager.requestControl('ws1', 'client2', 'tab2', mockReq);
      expect(result.isController).toBe(false);
      expect(result.reason).toBe('another_tab_active');
    });

    it('refreshes token for same client', () => {
      manager.requestControl('ws1', 'client1', 'tab1', mockReq);
      const result = manager.requestControl('ws1', 'client1', 'tab1', mockReq);
      expect(result.isController).toBe(true);
    });
  });

  describe('heartbeat', () => {
    it('returns true for current controller', () => {
      manager.requestControl('ws1', 'client1', 'tab1', mockReq);
      expect(manager.heartbeat('ws1', 'client1')).toBe(true);
    });

    it('returns false for non-controller', () => {
      expect(manager.heartbeat('ws1', 'unknown')).toBe(false);
    });
  });

  describe('release', () => {
    it('releases controller status', () => {
      manager.requestControl('ws1', 'client1', 'tab1', mockReq);
      manager.release('ws1', 'client1');
      expect(manager.getController('ws1')).toBeUndefined();
    });
  });

  describe('forceTakeover', () => {
    it('fails when controller is responsive', () => {
      manager.requestControl('ws1', 'client1', 'tab1', mockReq);
      manager.heartbeat('ws1', 'client1');
      const result = manager.forceTakeover('ws1', 'client2', 'tab2', mockReq);
      expect(result.success).toBe(false);
    });

    it('succeeds when controller is unresponsive', () => {
      const fastManager = new FencingManager({
        visibleHeartbeatMs: 1,
        tokenExpirationMs: 1,
      });
      fastManager.requestControl('ws1', 'client1', 'tab1', mockReq);

      // Wait for heartbeat to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const result = fastManager.forceTakeover('ws1', 'client2', 'tab2', mockReq);
          expect(result.success).toBe(true);
          resolve();
        }, 10);
      });
    });
  });

  describe('isControllerUnresponsive', () => {
    it('returns true when no controller', () => {
      expect(manager.isControllerUnresponsive('ws1')).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('removes expired tokens', () => {
      const fastManager = new FencingManager({ tokenExpirationMs: 1 });
      fastManager.requestControl('ws1', 'client1', 'tab1', mockReq);

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          fastManager.cleanup();
          expect(fastManager.getController('ws1')).toBeUndefined();
          resolve();
        }, 10);
      });
    });
  });
});
