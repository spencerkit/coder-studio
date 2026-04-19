import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { SessionCard } from './session-card';
import { sessionsAtom } from '../../../atoms/sessions';

const mockXtermHost = vi.fn((props: Record<string, unknown>) => (
  <div data-testid="mock-xterm-host" data-readonly={String(props.readOnly)} />
));

vi.mock('../../terminal-panel/components/xterm-host', () => ({
  XtermHost: (props: Record<string, unknown>) => mockXtermHost(props),
}));

describe('SessionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders ended sessions with a read-only terminal host', () => {
    const store = createStore();

    store.set(sessionsAtom, {
      sess_123456: {
        id: 'sess_123456',
        workspaceId: 'ws-123',
        terminalId: 'term-ended',
        providerId: 'codex',
        state: 'ended',
        capability: 'full',
        startedAt: Date.now() - 5_000,
        lastActiveAt: Date.now() - 1_000,
        endedAt: Date.now(),
      },
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    expect(mockXtermHost).toHaveBeenCalled();
    expect(mockXtermHost.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        terminalId: 'term-ended',
        workspaceId: 'ws-123',
        readOnly: true,
      })
    );
  });
});
