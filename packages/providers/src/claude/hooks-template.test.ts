import { describe, expect, it } from 'vitest';
import { claudeHooksDescriptor } from './hooks-template.js';
import type { ManagedHooks } from '@coder-studio/core';
import { homedir } from 'os';
import { join } from 'path';

describe('Claude Hooks Descriptor', () => {
  describe('resolveGlobalConfigPath', () => {
    it('should point at ~/.claude/settings.json', () => {
      expect(claudeHooksDescriptor.resolveGlobalConfigPath()).toBe(
        join(homedir(), '.claude', 'settings.json')
      );
    });
  });

  describe('mergeInto', () => {
    it('should create new config when existing is undefined', () => {
      const managed: ManagedHooks = {
        commands: {
          SessionStart: 'node /path/to/bridge SessionStart',
          Stop: 'node /path/to/bridge Stop',
        },
      };

      const result = claudeHooksDescriptor.mergeInto(undefined, managed);

      expect(result).toBeDefined();
      expect((result as any).hooks).toBeDefined();
      expect((result as any).hooks.SessionStart).toHaveLength(1);
      expect((result as any).hooks.Stop).toHaveLength(1);
    });

    it('should preserve existing user hooks', () => {
      const existing = {
        hooks: {
          SessionStart: [{ command: 'user-hook-1' }],
          Stop: [{ command: 'user-hook-2' }],
        },
      };

      const managed: ManagedHooks = {
        commands: {
          SessionStart: 'node /path/to/bridge SessionStart',
          Stop: 'node /path/to/bridge Stop',
        },
      };

      const result = claudeHooksDescriptor.mergeInto(existing, managed);

      // Should have 2 hooks each: user + managed
      expect((result as any).hooks.SessionStart).toHaveLength(2);
      expect((result as any).hooks.Stop).toHaveLength(2);

      // First should be user hook
      expect((result as any).hooks.SessionStart[0].command).toBe('user-hook-1');
      expect((result as any).hooks.Stop[0].command).toBe('user-hook-2');

      // Second should be managed
      expect((result as any).hooks.SessionStart[1]._cs_managed).toBe(true);
      expect((result as any).hooks.Stop[1]._cs_managed).toBe(true);
      expect((result as any).hooks.SessionStart[1].hooks).toEqual([
        {
          type: 'command',
          command: 'node /path/to/bridge SessionStart',
        },
      ]);
      expect((result as any).hooks.Stop[1].hooks).toEqual([
        {
          type: 'command',
          command: 'node /path/to/bridge Stop',
        },
      ]);
    });

    it('should replace old managed hooks', () => {
      const existing = {
        hooks: {
          SessionStart: [
            { _cs_managed: true, _cs_version: 'cs-v0', command: 'old-bridge' },
          ],
          Stop: [
            { _cs_managed: true, _cs_version: 'cs-v0', command: 'old-bridge' },
          ],
        },
      };

      const managed: ManagedHooks = {
        commands: {
          SessionStart: 'node /new-bridge SessionStart',
          Stop: 'node /new-bridge Stop',
        },
      };

      const result = claudeHooksDescriptor.mergeInto(existing, managed);

      // Old managed hooks should be removed, new ones added
      expect((result as any).hooks.SessionStart).toHaveLength(1);
      expect((result as any).hooks.Stop).toHaveLength(1);
      expect((result as any).hooks.SessionStart[0]._cs_version).toBe('cs-v1');
      expect((result as any).hooks.Stop[0]._cs_version).toBe('cs-v1');
      expect((result as any).hooks.SessionStart[0].hooks[0].command).toBe(
        'node /new-bridge SessionStart'
      );
      expect((result as any).hooks.Stop[0].hooks[0].command).toBe(
        'node /new-bridge Stop'
      );
    });

    it('should not mutate existing config', () => {
      const existing = {
        hooks: {
          SessionStart: [{ command: 'user-hook' }],
        },
      };

      const managed: ManagedHooks = {
        commands: {
          SessionStart: 'node /bridge SessionStart',
        },
      };

      const result = claudeHooksDescriptor.mergeInto(existing, managed);

      // Original should not be modified
      expect((existing as any).hooks.SessionStart).toHaveLength(1);
      expect((result as any).hooks.SessionStart).toHaveLength(2);
    });
  });

  describe('extractManaged', () => {
    it('should extract managed hooks from config', () => {
      const config = {
        hooks: {
          SessionStart: [
            {
              _cs_managed: true,
              _cs_version: 'cs-v1',
              hooks: [{ type: 'command', command: 'bridge-start' }],
            },
          ],
          Stop: [
            {
              _cs_managed: true,
              _cs_version: 'cs-v1',
              hooks: [{ type: 'command', command: 'bridge-stop' }],
            },
          ],
        },
      };

      const result = claudeHooksDescriptor.extractManaged(config);

      expect(result).toBeDefined();
      expect(result?.commands.SessionStart).toBe('bridge-start');
      expect(result?.commands.Stop).toBe('bridge-stop');
    });

    it('should return null for non-managed config', () => {
      const config = {
        hooks: {
          SessionStart: [{ command: 'user-hook' }],
        },
      };

      const result = claudeHooksDescriptor.extractManaged(config);

      expect(result).toBeNull();
    });

    it('should return null for invalid config', () => {
      expect(claudeHooksDescriptor.extractManaged(null)).toBeNull();
      expect(claudeHooksDescriptor.extractManaged('string')).toBeNull();
      expect(claudeHooksDescriptor.extractManaged([])).toBeNull();
    });
  });

  describe('parseEvent', () => {
    it('should parse SessionStart event', () => {
      const payload = {
        session_id: 'abc-123',
        transcript_path: '/path/to/transcript',
      };

      const result = claudeHooksDescriptor.parseEvent('SessionStart', payload);

      expect(result).toBeDefined();
      expect(result?.type).toBe('session_start');
      expect(result?.sessionId).toBe('abc-123');
      expect(result?.payload.resumeId).toBe('abc-123');
      expect(result?.payload.transcriptPath).toBe('/path/to/transcript');
    });

    it('should parse Stop event', () => {
      const payload = {
        session_id: 'abc-123',
        stop_hook_reason: 'end_turn',
      };

      const result = claudeHooksDescriptor.parseEvent('Stop', payload);

      expect(result).toBeDefined();
      expect(result?.type).toBe('stop');
      expect(result?.sessionId).toBe('abc-123');
      expect(result?.payload.reason).toBe('end_turn');
    });

    it('should return null for unknown event', () => {
      const result = claudeHooksDescriptor.parseEvent('Unknown', {});

      expect(result).toBeNull();
    });

    it('should return null for invalid payload', () => {
      expect(claudeHooksDescriptor.parseEvent('SessionStart', null)).toBeNull();
      expect(claudeHooksDescriptor.parseEvent('SessionStart', 'string')).toBeNull();
    });
  });

  describe('events capability', () => {
    it('should declare sessionStart and completion as true', () => {
      expect(claudeHooksDescriptor.events.sessionStart).toBe(true);
      expect(claudeHooksDescriptor.events.completion).toBe(true);
      expect(claudeHooksDescriptor.events.progress).toBe(false);
    });
  });
});
