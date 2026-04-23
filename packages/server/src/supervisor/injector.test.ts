import { describe, expect, it, vi } from 'vitest';
import { SupervisorInjector, describeNonInjectableState } from './injector.js';
import type { SessionState } from '@coder-studio/core';

function makeInjector(writeSpy = vi.fn(), state: SessionState = 'running') {
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
    } as any,
    terminalMgr: { write: writeSpy } as any,
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
  it('writes guidance through terminalMgr.write using the session terminalId', async () => {
    const writeSpy = vi.fn();
    const injector = makeInjector(writeSpy);

    await injector.inject(
      supervisor,
      {
        summary: 'Tables and repos are finished.',
        guidance: 'Wire the repos into SupervisorManager next.',
      },
      []
    );

    expect(writeSpy).toHaveBeenCalledWith('term-1', expect.any(Buffer));
  });

  it('flattens multi-line guidance to a single TUI-safe line with bracketed paste + CR', async () => {
    const writeSpy = vi.fn();
    const injector = makeInjector(writeSpy);

    await injector.inject(
      supervisor,
      {
        summary: 'Line one.\nLine two.',
        guidance: 'Do:\n  1. step one\n  2. step two',
      },
      []
    );

    const buffer = writeSpy.mock.calls[0]![1] as Buffer;
    const payload = buffer.toString('utf8');
    // Must start with bracketed-paste start, end with bracketed-paste end + \r
    expect(payload.startsWith('\x1b[200~')).toBe(true);
    expect(payload.endsWith('\x1b[201~\r')).toBe(true);
    // Must NOT contain raw \n (would otherwise leave guidance half-typed or
    // submit only partial input in Claude Code / Codex TUIs).
    expect(payload.includes('\n')).toBe(false);
    // Must include the flattened guidance as a single line.
    expect(payload).toContain('Do: 1. step one 2. step two');
    expect(payload).toContain('Line one. Line two.');
  });

  it('refuses to write into a session that has not finished handshake (state=starting)', async () => {
    const writeSpy = vi.fn();
    const injector = makeInjector(writeSpy, 'starting');

    await expect(
      injector.inject(
        supervisor,
        { summary: 'ok', guidance: 'go' },
        []
      )
    ).rejects.toMatchObject({
      code: 'inject_target_unavailable',
      // The message must describe the lifecycle phase (not just repeat the raw
      // state name) so the operator knows what to do about it.
      message: expect.stringContaining('still starting up'),
    });

    expect(writeSpy).not.toHaveBeenCalled();
  });
});

describe('describeNonInjectableState', () => {
  it('returns actionable copy for every non-injectable session state', () => {
    // Guard against silent regressions if someone adds a new SessionState: the
    // default branch still produces a string, but these specific ones must
    // carry operator-facing copy rather than the raw enum.
    expect(describeNonInjectableState('starting')).toMatch(/starting up/);
    expect(describeNonInjectableState('interrupted')).toMatch(/resume/);
    expect(describeNonInjectableState('unavailable')).toMatch(/unavailable/);
    expect(describeNonInjectableState('ended')).toMatch(/ended/);
    expect(describeNonInjectableState('draft')).toMatch(/draft/);
  });
});
