import { describe, expect, it, vi } from 'vitest';
import { SupervisorInjector, describeNonInjectableState } from './injector.js';
import type { SessionState } from '@coder-studio/core';

function makeInjector(sendInputSpy = vi.fn(), state: SessionState = 'running') {
  return new SupervisorInjector({
    sessionMgr: {
      get: vi.fn(() => ({
        id: 'sess-1',
        terminalId: 'term-1',
        state,
        workspaceId: 'ws-1',
        providerId: 'claude',
        capability: 'full',
        startedAt: 1,
        lastActiveAt: 1,
      })),
      sendInput: sendInputSpy,
    } as any,
    terminalMgr: {} as any,
  });
}

const supervisor = {
  id: 'sup-1',
  sessionId: 'sess-1',
  workspaceId: 'ws-1',
  state: 'idle' as const,
  objective: 'Finish the repo migration',
  evaluatorProviderId: 'claude',
  cycles: [],
  createdAt: 1,
  updatedAt: 1,
};

describe('SupervisorInjector', () => {
  it('writes guidance through sessionMgr.sendInput using system activity', async () => {
    const sendInputSpy = vi.fn();
    const injector = makeInjector(sendInputSpy);

    await injector.inject(
      supervisor,
      {
        summary: 'Tables and repos are finished.',
        guidance: 'Wire the repos into SupervisorManager next.',
      },
      []
    );

    expect(sendInputSpy).toHaveBeenCalledWith('sess-1', expect.any(Buffer), 'system');
  });

  it('flattens multi-line guidance to a single TUI-safe line with bracketed paste + CR', async () => {
    const sendInputSpy = vi.fn();
    const injector = makeInjector(sendInputSpy);

    await injector.inject(
      supervisor,
      {
        summary: 'Line one.\nLine two.',
        guidance: 'Do:\n  1. step one\n  2. step two',
      },
      []
    );

    const buffer = sendInputSpy.mock.calls[0]![1] as Buffer;
    const payload = buffer.toString('utf8');
    expect(payload.startsWith('\x1b[200~')).toBe(true);
    expect(payload.endsWith('\x1b[201~\r')).toBe(true);
    expect(payload.includes('\n')).toBe(false);
    expect(payload).toContain('Do: 1. step one 2. step two');
    expect(payload).toContain('Line one. Line two.');
  });

  it('refuses to write into a session that has not finished handshake (state=starting)', async () => {
    const sendInputSpy = vi.fn();
    const injector = makeInjector(sendInputSpy, 'starting');

    await expect(
      injector.inject(
        supervisor,
        { summary: 'ok', guidance: 'go' },
        []
      )
    ).rejects.toMatchObject({
      code: 'inject_target_unavailable',
      message: expect.stringContaining('still starting up'),
    });

    expect(sendInputSpy).not.toHaveBeenCalled();
  });
});

describe('describeNonInjectableState', () => {
  it('returns actionable copy for every non-injectable session state', () => {
    expect(describeNonInjectableState('starting')).toMatch(/starting up/);
    expect(describeNonInjectableState('interrupted')).toMatch(/resume/);
    expect(describeNonInjectableState('unavailable')).toMatch(/unavailable/);
    expect(describeNonInjectableState('ended')).toMatch(/ended/);
    expect(describeNonInjectableState('draft')).toMatch(/draft/);
  });
});
