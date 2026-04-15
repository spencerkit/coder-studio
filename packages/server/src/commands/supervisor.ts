/**
 * Supervisor command handlers (Phase 3)
 */

import { registerCommand } from '../ws/dispatch.js';
import type { SupervisorManager } from '../supervisor/manager.js';

let supervisorManager: SupervisorManager | null = null;

/**
 * Set the supervisor manager instance for command handlers
 */
export function setSupervisorManager(manager: SupervisorManager): void {
  supervisorManager = manager;
}

/**
 * Register supervisor command handlers
 */
export function registerSupervisorCommands(): void {
  // supervisor.create - Create a new supervisor for a session
  registerCommand('supervisor.create', async (args) => {
    if (!supervisorManager) {
      return { ok: false, error: { code: 'supervisor_not_available', message: 'Supervisor manager not initialized' } };
    }

    const { sessionId, workspaceId, objective, intervalMs } = args as {
      sessionId: string;
      workspaceId: string;
      objective: string;
      intervalMs?: number;
    };

    try {
      const supervisor = await supervisorManager.create({
        sessionId,
        workspaceId,
        objective,
        intervalMs,
      });
      return { ok: true, data: { supervisor } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: { code: 'create_failed', message } };
    }
  });

  // supervisor.get - Get supervisor by session ID
  registerCommand('supervisor.get', async (args) => {
    if (!supervisorManager) {
      return { ok: false, error: { code: 'supervisor_not_available', message: 'Supervisor manager not initialized' } };
    }

    const { sessionId } = args as { sessionId: string };
    const supervisor = supervisorManager.getBySession(sessionId);

    return { ok: true, data: { supervisor: supervisor ?? null } };
  });

  // supervisor.update - Update supervisor objective or interval
  registerCommand('supervisor.update', async (args) => {
    if (!supervisorManager) {
      return { ok: false, error: { code: 'supervisor_not_available', message: 'Supervisor manager not initialized' } };
    }

    const { id, objective, intervalMs } = args as {
      id: string;
      objective?: string;
      intervalMs?: number;
    };

    try {
      const supervisor = await supervisorManager.update(id, { objective, intervalMs });
      return { ok: true, data: { supervisor } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: { code: 'update_failed', message } };
    }
  });

  // supervisor.delete - Delete a supervisor
  registerCommand('supervisor.delete', async (args) => {
    if (!supervisorManager) {
      return { ok: false, error: { code: 'supervisor_not_available', message: 'Supervisor manager not initialized' } };
    }

    const { id } = args as { id: string };

    try {
      await supervisorManager.delete(id);
      return { ok: true, data: {} };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: { code: 'delete_failed', message } };
    }
  });

  // supervisor.pause - Pause supervisor evaluation
  registerCommand('supervisor.pause', async (args) => {
    if (!supervisorManager) {
      return { ok: false, error: { code: 'supervisor_not_available', message: 'Supervisor manager not initialized' } };
    }

    const { id } = args as { id: string };

    try {
      const supervisor = await supervisorManager.pause(id);
      return { ok: true, data: { supervisor } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: { code: 'pause_failed', message } };
    }
  });

  // supervisor.resume - Resume supervisor evaluation
  registerCommand('supervisor.resume', async (args) => {
    if (!supervisorManager) {
      return { ok: false, error: { code: 'supervisor_not_available', message: 'Supervisor manager not initialized' } };
    }

    const { id } = args as { id: string };

    try {
      const supervisor = await supervisorManager.resume(id);
      return { ok: true, data: { supervisor } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: { code: 'resume_failed', message } };
    }
  });

  // supervisor.trigger - Trigger manual evaluation cycle
  registerCommand('supervisor.trigger', async (args) => {
    if (!supervisorManager) {
      return { ok: false, error: { code: 'supervisor_not_available', message: 'Supervisor manager not initialized' } };
    }

    const { id } = args as { id: string };

    try {
      const cycle = await supervisorManager.triggerEvaluation(id);
      return { ok: true, data: { cycle } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: { code: 'trigger_failed', message } };
    }
  });
}
