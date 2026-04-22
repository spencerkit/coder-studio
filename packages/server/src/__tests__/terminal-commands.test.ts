import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch } from '../ws/dispatch.js';
import type { CommandContext } from '../ws/dispatch.js';
import type { Terminal } from '@coder-studio/core';

import '../commands/terminal.js';

function createContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    db: {} as never,
    workspaceMgr: {
      get: vi.fn().mockReturnValue({
        id: 'ws-1',
        path: '/tmp/workspace',
      }),
    } as never,
    sessionMgr: {} as never,
    terminalMgr: {
      create: vi.fn().mockImplementation((spec) => ({
        id: 'term-1',
        workspaceId: spec.workspaceId,
        kind: spec.kind,
        title: spec.title ?? spec.argv[0],
        cwd: spec.cwd,
        argv: spec.argv,
        cols: spec.cols ?? 120,
        rows: spec.rows ?? 30,
        alive: true,
        createdAt: Date.now(),
      } satisfies Terminal)),
      getAll: vi.fn().mockReturnValue([]),
      replay: vi.fn(),
      kill: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
    } as never,
    hooksMgr: {} as never,
    eventBus: {} as never,
    broadcaster: { broadcast: vi.fn() } as never,
    providerRegistry: [],
    ...overrides,
  };
}

describe('terminal commands', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the current user shell when creating shell terminals', async () => {
    vi.stubEnv('SHELL', '/bin/zsh');
    const ctx = createContext();

    const result = await dispatch(
      {
        kind: 'command',
        id: 'terminal-create-1',
        op: 'terminal.create',
        args: {
          workspaceId: 'ws-1',
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.terminalMgr.create).toHaveBeenCalledWith(
      expect.objectContaining({
        argv: ['/bin/zsh'],
        title: 'zsh',
      })
    );
  });
});
