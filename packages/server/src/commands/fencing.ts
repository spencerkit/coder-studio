/**
 * Fencing command handlers (Phase 3)
 */

import { registerCommand } from '../ws/dispatch.js';
import type { FencingManager } from '../ws/fencing.js';

let fencingManager: FencingManager | null = null;
let currentClientId: string | null = null;

/**
 * Set the fencing manager instance for command handlers
 */
export function setFencingManager(manager: FencingManager, clientId: string): void {
  fencingManager = manager;
  currentClientId = clientId;
}

/**
 * Register fencing command handlers
 */
export function registerFencingCommands(): void {
  // fencing.request - Request controller status
  registerCommand('fencing.request', async (args) => {
    if (!fencingManager || !currentClientId) {
      return { ok: false, error: { code: 'fencing_not_available', message: 'Fencing manager not initialized' } };
    }

    const { workspaceId, tabId, request } = args as {
      workspaceId: string;
      tabId: string;
      request?: { ip: string; userAgent: string };
    };

    // Use mock request if not provided (for testing)
    const mockRequest = {
      ip: request?.ip || '127.0.0.1',
      headers: { 'user-agent': request?.userAgent || '' },
    } as any;

    const result = fencingManager.requestControl(workspaceId, currentClientId, tabId, mockRequest);

    return { ok: true, data: result };
  });

  // fencing.heartbeat - Send heartbeat
  registerCommand('fencing.heartbeat', async (args) => {
    if (!fencingManager || !currentClientId) {
      return { ok: false, error: { code: 'fencing_not_available', message: 'Fencing manager not initialized' } };
    }

    const { workspaceId } = args as { workspaceId: string };

    const success = fencingManager.heartbeat(workspaceId, currentClientId);

    return { ok: true, data: { success } };
  });

  // fencing.release - Release controller status
  registerCommand('fencing.release', async (args) => {
    if (!fencingManager || !currentClientId) {
      return { ok: false, error: { code: 'fencing_not_available', message: 'Fencing manager not initialized' } };
    }

    const { workspaceId } = args as { workspaceId: string };

    fencingManager.release(workspaceId, currentClientId);

    return { ok: true, data: {} };
  });

  // fencing.status - Get current controller status
  registerCommand('fencing.status', async (args) => {
    if (!fencingManager || !currentClientId) {
      return { ok: false, error: { code: 'fencing_not_available', message: 'Fencing manager not initialized' } };
    }

    const { workspaceId } = args as { workspaceId: string };

    const isController = fencingManager.isController(workspaceId, currentClientId);
    const controller = fencingManager.getController(workspaceId);
    const isUnresponsive = fencingManager.isControllerUnresponsive(workspaceId);

    return {
      ok: true,
      data: {
        isController,
        controller: controller ? {
          tabId: controller.tabId,
          issuedAt: controller.issuedAt,
        } : null,
        isUnresponsive,
      },
    };
  });

  // fencing.takeover - Force takeover when controller is unresponsive
  registerCommand('fencing.takeover', async (args) => {
    if (!fencingManager || !currentClientId) {
      return { ok: false, error: { code: 'fencing_not_available', message: 'Fencing manager not initialized' } };
    }

    const { workspaceId, tabId, request } = args as {
      workspaceId: string;
      tabId: string;
      request?: { ip: string; userAgent: string };
    };

    const mockRequest = {
      ip: request?.ip || '127.0.0.1',
      headers: { 'user-agent': request?.userAgent || '' },
    } as any;

    const result = fencingManager.forceTakeover(workspaceId, currentClientId, tabId, mockRequest);

    return { ok: true, data: result };
  });
}
