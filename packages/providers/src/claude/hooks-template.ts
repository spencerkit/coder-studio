import type { HooksDescriptor, ManagedHooks, ProviderEvent } from '@coder-studio/core';
import { homedir } from 'os';
import { join } from 'path';

/**
 * Claude Code hooks descriptor
 * Implements merge-write strategy that preserves user's existing hooks
 */
export const claudeHooksDescriptor: HooksDescriptor = {
  markerVersion: 'cs-v1',

  /**
   * Resolve Claude's global config path
   */
  resolveGlobalConfigPath(): string {
    return join(homedir(), '.claude', 'settings.json');
  },

  /**
   * Merge Coder Studio managed hooks into existing config
   * CRITICAL: Must not mutate existing config - return new object
   */
  mergeInto(existing: unknown, managed: ManagedHooks): unknown {
    const config =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? (existing as Record<string, unknown>)
        : {};

    // Extract existing hooks or default to empty object
    const existingHooks = (config.hooks as Record<string, unknown>) ?? {};

    // Create new config object with merged hooks (immutable update)
    const newConfig = {
      ...config,
      hooks: {
        ...existingHooks,
        SessionStart: removeManagedHooks(
          existingHooks.SessionStart as unknown[] | undefined
        ),
        Stop: removeManagedHooks(
          existingHooks.Stop as unknown[] | undefined
        ),
      },
    };

    // Add managed hooks
    if (managed.commands.SessionStart) {
      newConfig.hooks.SessionStart = [
        ...newConfig.hooks.SessionStart,
        {
          _cs_managed: true,
          _cs_version: 'cs-v1',
          hooks: [
            {
              type: 'command',
              command: managed.commands.SessionStart,
            },
          ],
        },
      ];
    }

    if (managed.commands.Stop) {
      newConfig.hooks.Stop = [
        ...newConfig.hooks.Stop,
        {
          _cs_managed: true,
          _cs_version: 'cs-v1',
          hooks: [
            {
              type: 'command',
              command: managed.commands.Stop,
            },
          ],
        },
      ];
    }

    return newConfig;
  },

  /**
   * Extract Coder Studio managed hooks from config
   * Used for upgrade and cleanup
   */
  extractManaged(config: unknown): ManagedHooks | null {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return null;
    }

    const hooks = (config as Record<string, unknown>).hooks;
    if (!hooks || typeof hooks !== 'object') {
      return null;
    }

    const sessionStartHooks = (hooks as Record<string, unknown>).SessionStart;
    const stopHooks = (hooks as Record<string, unknown>).Stop;

    const sessionStartManaged = extractManagedFromHookArray(sessionStartHooks);
    const stopManaged = extractManagedFromHookArray(stopHooks);

    if (!sessionStartManaged && !stopManaged) {
      return null;
    }

    return {
      commands: {
        SessionStart: sessionStartManaged?.command || '',
        Stop: stopManaged?.command || '',
      },
    };
  },

  /**
   * Build bridge command for a specific event
   */
  bridgeCommand(bridgeScriptPath: string, event: string): string[] {
    return ['node', bridgeScriptPath, event];
  },

  /**
   * Parse hook event payload into standardized ProviderEvent
   */
  parseEvent(event: string, payload: unknown): ProviderEvent | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const data = payload as Record<string, unknown>;

    switch (event) {
      case 'SessionStart':
        return {
          type: 'session_start',
          sessionId: (data.session_id as string) ?? '',
          payload: {
            resumeId: data.session_id as string,
            transcriptPath: data.transcript_path,
          },
        };

      case 'Stop':
        return {
          type: 'stop',
          sessionId: (data.session_id as string) ?? '',
          payload: {
            reason: data.stop_hook_reason,
          },
        };

      default:
        return null;
    }
  },

  /**
   * Event capabilities declaration
   */
  events: {
    sessionStart: true, // Can reliably get resume_id
    completion: true, // Can reliably detect completion via Stop
    progress: false, // Phase 3: consider PreToolUse/PostToolUse
  },
};

/**
 * Remove Coder Studio managed hooks from a hook array
 * Preserves user-defined hooks
 */
function removeManagedHooks(hooks: unknown[] | undefined): unknown[] {
  if (!hooks || !Array.isArray(hooks)) {
    return [];
  }

  return hooks.filter((hook) => {
    if (!hook || typeof hook !== 'object') {
      return true; // Keep non-object hooks
    }

    const h = hook as Record<string, unknown>;
    // Remove hooks marked as managed by Coder Studio
    return !h._cs_managed;
  });
}

/**
 * Extract first managed hook from an array
 */
function extractManagedFromHookArray(
  hooks: unknown
): { command: string } | null {
  if (!hooks || !Array.isArray(hooks)) {
    return null;
  }

  for (const hook of hooks) {
    if (!hook || typeof hook !== 'object') {
      continue;
    }

    const h = hook as Record<string, unknown>;
    if (!h._cs_managed) {
      continue;
    }

    const nestedHooks = h.hooks;
    if (!Array.isArray(nestedHooks)) {
      continue;
    }

    for (const nested of nestedHooks) {
      if (!nested || typeof nested !== 'object') {
        continue;
      }

      const nestedHook = nested as Record<string, unknown>;
      if (nestedHook.type === 'command' && typeof nestedHook.command === 'string') {
        return { command: nestedHook.command };
      }
    }
  }

  return null;
}
