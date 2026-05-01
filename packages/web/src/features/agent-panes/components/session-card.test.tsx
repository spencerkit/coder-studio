import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { SessionCard } from './session-card';
import { sessionsAtom } from '../../../atoms/sessions';
import { wsClientAtom } from '../../../atoms/connection';
import { pendingFocusSessionAtom } from '../../../atoms/app-ui';

const mockXtermHost = vi.fn((props: Record<string, unknown>) => (
  <div data-testid="mock-xterm-host" data-readonly={String(props.readOnly)} />
));

vi.mock('../../terminal-panel/components/xterm-host', () => ({
  XtermHost: (props: Record<string, unknown>) => mockXtermHost(props),
}));

function createSessionStore(
  overrides: Partial<Record<string, unknown>> = {},
  sendCommand = vi.fn().mockResolvedValue(undefined)
) {
  const store = createStore();

  store.set(wsClientAtom, {
    sendCommand,
    subscribe: vi.fn(() => () => {}),
  } as never);

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
      ...overrides,
    },
  });

  return { store, sendCommand };
}

describe('SessionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders ended sessions with a read-only terminal host', () => {
    const { store } = createSessionStore();

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

  it('renders interactive sessions without the extra command input', () => {
    const { store } = createSessionStore({
      terminalId: 'term-live',
      state: 'idle',
      endedAt: undefined,
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(mockXtermHost.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        terminalId: 'term-live',
        readOnly: false,
      })
    );
  });

  it('hides header actions when showHeaderActions is false', () => {
    const { store } = createSessionStore({
      terminalId: 'term-live',
      state: 'running',
      endedAt: undefined,
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" showHeaderActions={false} />
      </Provider>
    );

    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('forces the terminal read-only when terminalReadOnlyOverride is true', () => {
    const { store } = createSessionStore({
      terminalId: 'term-live',
      state: 'running',
      endedAt: undefined,
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" terminalReadOnlyOverride />
      </Provider>
    );

    expect(mockXtermHost.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        terminalId: 'term-live',
        readOnly: true,
      })
    );
  });

  it('hydrates supervisor state for full-capability sessions and renders the card above the terminal', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === 'supervisor.get') {
        return {
          supervisor: {
            id: 'sup-1',
            sessionId: 'sess_123456',
            workspaceId: 'ws-123',
            state: 'idle',
            objective: 'Keep the agent on track',
            evaluatorProviderId: 'claude',
            cycles: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        };
      }
      return undefined;
    });

    const { store } = createSessionStore({ state: 'running', capability: 'full' }, sendCommand);

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('supervisor.get', { sessionId: 'sess_123456' });
    });

    expect(screen.getByText('Supervisor')).toBeInTheDocument();
  });

  it('reacts to a pending-focus request by scrolling itself into view and pulsing, then clears the marker', async () => {
    const scrollSpy = vi.fn();
    // jsdom doesn't implement scrollIntoView; provide a stub before render.
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollSpy,
    });

    const { store } = createSessionStore({ state: 'idle', endedAt: undefined });
    store.set(pendingFocusSessionAtom, 'sess_123456');

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalledTimes(1);
    });

    const card = document.querySelector('[data-session-id="sess_123456"]');
    expect(card).not.toBeNull();
    expect(card?.classList.contains('session-card--focus-pulse')).toBe(true);
    // Marker should self-clear so siblings don't also fire on re-render.
    expect(store.get(pendingFocusSessionAtom)).toBeNull();
  });

  it('ignores a pending-focus request targeting a different session', async () => {
    const scrollSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollSpy,
    });

    const { store } = createSessionStore({ state: 'idle', endedAt: undefined });
    store.set(pendingFocusSessionAtom, 'some-other-session');

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    // Let any effects flush (none should change anything for this card).
    await act(async () => {
      await Promise.resolve();
    });

    expect(scrollSpy).not.toHaveBeenCalled();
    const card = document.querySelector('[data-session-id="sess_123456"]');
    expect(card?.classList.contains('session-card--focus-pulse')).toBe(false);
    // Untouched.
    expect(store.get(pendingFocusSessionAtom)).toBe('some-other-session');
  });

  it('shows the session title when the server has assigned one', () => {
    const { store } = createSessionStore({
      state: 'running',
      endedAt: undefined,
      title: 'fix bug',
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    expect(screen.getByText('fix bug')).toBeInTheDocument();
    // The SESSION-XX fallback should not also render in the header.
    expect(screen.queryByText(/^SESSION-/)).toBeNull();
  });

  it('falls back to SESSION-XX while the session has no title yet', () => {
    const { store } = createSessionStore({
      state: 'running',
      endedAt: undefined,
      // title intentionally omitted
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    expect(screen.getByText('SESSION-56')).toBeInTheDocument();
  });

  it('renders interrupted sessions as read-only terminals with a resume action', () => {
    const { store } = createSessionStore({
      terminalId: 'term-interrupted',
      state: 'interrupted',
      resumeId: 'resume-1',
      endedAt: undefined,
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    expect(mockXtermHost.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        terminalId: 'term-interrupted',
        readOnly: true,
      })
    );
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('renders unavailable sessions as read-only terminals without a resume action', () => {
    const { store } = createSessionStore({
      terminalId: 'term-unavailable',
      state: 'unavailable',
      endedAt: undefined,
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    expect(mockXtermHost.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        terminalId: 'term-unavailable',
        readOnly: true,
      })
    );
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
  });

  it('routes close through the explicit callback', async () => {
    const { store, sendCommand } = createSessionStore({
      terminalId: 'term-live',
      state: 'running',
      endedAt: undefined,
    });
    const onClose = vi.fn();

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" onClose={onClose} />
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sendCommand).not.toHaveBeenCalledWith('session.stop', { sessionId: 'sess_123456' });
  });

  it('routes split buttons through explicit callbacks', () => {
    const { store } = createSessionStore({
      terminalId: 'term-live',
      state: 'running',
      endedAt: undefined,
    });
    const onSplitHorizontal = vi.fn();
    const onSplitVertical = vi.fn();

    render(
      <Provider store={store}>
        <SessionCard
          sessionId="sess_123456"
          onSplitHorizontal={onSplitHorizontal}
          onSplitVertical={onSplitVertical}
        />
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Split horizontal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Split vertical' }));

    expect(onSplitHorizontal).toHaveBeenCalledTimes(1);
    expect(onSplitVertical).toHaveBeenCalledTimes(1);
  });
});
