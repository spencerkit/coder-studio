import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { SessionCard } from './session-card';
import { sessionsAtom } from '../../../atoms/sessions';
import { wsClientAtom } from '../../../atoms/connection';
import { pendingFocusSessionAtom } from '../../../atoms/ui';

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

  it('encodes Chinese session input as UTF-8 base64 before dispatching', async () => {
    const { store, sendCommand } = createSessionStore({
      terminalId: 'term-cn',
      state: 'idle',
      endedAt: undefined,
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: '你好，Codex' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('terminal.input', {
        terminalId: 'term-cn',
        bytes: Buffer.from('你好，Codex\n', 'utf8').toString('base64'),
        activity: 'submit',
      });
    });
  });

  it('does not submit while the session input is still composing with an IME', async () => {
    const { store, sendCommand } = createSessionStore({
      terminalId: 'term-ime',
      state: 'idle',
      endedAt: undefined,
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: '你好' } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

    expect(sendCommand).not.toHaveBeenCalledWith(
      'terminal.input',
      expect.objectContaining({ terminalId: 'term-ime' })
    );

    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('terminal.input', {
        terminalId: 'term-ime',
        bytes: Buffer.from('你好\n', 'utf8').toString('base64'),
        activity: 'submit',
      });
    });
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

  it('stops the session and closes the pane when close is clicked', async () => {
    const { store, sendCommand } = createSessionStore({
      terminalId: 'term-live',
      state: 'running',
      endedAt: undefined,
    });
    const closeEvents: CustomEvent[] = [];
    const handleCloseEvent = (event: Event) => {
      closeEvents.push(event as CustomEvent);
    };

    window.addEventListener('coder-studio:panel-close', handleCloseEvent as EventListener);

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => {
      // Should stop the session (sets state to ended)
      expect(sendCommand).toHaveBeenCalledWith('session.stop', { sessionId: 'sess_123456' });
    });

    // Then close the pane
    expect(closeEvents).toHaveLength(1);
    expect(closeEvents[0]?.detail).toEqual({ sessionId: 'sess_123456' });

    window.removeEventListener('coder-studio:panel-close', handleCloseEvent as EventListener);
  });
});
