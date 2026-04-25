/**
 * XtermHost Component Tests
 *
 * Unit tests for the xterm.js terminal rendering component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { Topics } from '@coder-studio/core';
import { JotaiProvider } from '../../../test-utils/jotai-provider';
import { XtermHost } from '../components/xterm-host';
import { terminalOutputAtomFamily } from '../../../atoms/terminals';
import { wsClientAtom } from '../../../atoms/connection';
import { themeAtom } from '../../../atoms/ui';

const mockTerminal = {
  open: vi.fn(),
  onData: vi.fn(() => vi.fn()), // Return dispose function
  onResize: vi.fn(() => vi.fn()),
  write: vi.fn(),
  writeln: vi.fn(),
  dispose: vi.fn(),
  focus: vi.fn(),
  loadAddon: vi.fn(),
  options: {},
};

const mockFitAddon = {
  fit: vi.fn(),
};

// Mock xterm.js modules
vi.mock('@xterm/xterm', () => {
  return {
    Terminal: vi.fn(function () {
      return mockTerminal;
    }),
  };
});

vi.mock('@xterm/addon-fit', () => {
  return {
    FitAddon: vi.fn(function () {
      return mockFitAddon;
    }),
  };
});

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(function () {}),
}));

describe('XtermHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTerminal.options = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not crash on unmount when terminal disposal fails', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockTerminal.dispose.mockImplementationOnce(() => {
      throw new Error('dispose failed');
    });

    const { unmount } = render(
      <JotaiProvider>
        <XtermHost terminalId="test-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    expect(() => unmount()).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to dispose xterm instance:',
      expect.any(Error)
    );
  });

  it('renders without crashing', () => {
    const { container } = render(
      <JotaiProvider>
        <XtermHost terminalId="test-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    // Check that the xterm-host container is rendered
    const hostContainer = container.querySelector('.xterm-host');
    expect(hostContainer).toBeTruthy();
  });

  it('creates xterm instance on mount with correct theme', async () => {
    const { Terminal } = await import('@xterm/xterm');

    render(
      <JotaiProvider>
        <XtermHost terminalId="test-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    // Terminal should be called with Aurora Mint theme
    expect(Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: expect.objectContaining({
          background: '#0b1218',
          foreground: '#e5edf3',
          cursor: '#78d7b2',
          selectionBackground: '#1e3040',
        }),
      })
    );
  });

  it('creates xterm instance with a light theme when ui theme is light', async () => {
    const { Terminal } = await import('@xterm/xterm');
    const store = createStore();
    store.set(themeAtom, 'light');

    render(
      <Provider store={store}>
        <XtermHost terminalId="light-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    expect(Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: expect.objectContaining({
          background: '#fafbfc',
          foreground: '#1f2328',
          cursor: '#0969da',
          selectionBackground: '#dde4ea',
        }),
      })
    );
  });

  it('updates the live xterm theme when the ui theme changes', async () => {
    const store = createStore();

    render(
      <Provider store={store}>
        <XtermHost terminalId="theme-sync-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      store.set(themeAtom, 'light');
    });

    await waitFor(() => {
      expect(mockTerminal.options).toEqual(
        expect.objectContaining({
          theme: expect.objectContaining({
            background: '#fafbfc',
            foreground: '#1f2328',
          }),
        })
      );
    });
  });

  it('uses JetBrains Mono font family', async () => {
    const { Terminal } = await import('@xterm/xterm');

    render(
      <JotaiProvider>
        <XtermHost terminalId="test-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    expect(Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        fontFamily: expect.stringContaining('JetBrains Mono'),
      })
    );
  });

  it('sets scrollback limit to 5000', async () => {
    const { Terminal } = await import('@xterm/xterm');

    render(
      <JotaiProvider>
        <XtermHost terminalId="test-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    expect(Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        scrollback: 5000,
      })
    );
  });

  it('sets cursor style to block with blink', async () => {
    const { Terminal } = await import('@xterm/xterm');

    render(
      <JotaiProvider>
        <XtermHost terminalId="test-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    expect(Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        cursorBlink: true,
        cursorStyle: 'block',
      })
    );
  });

  it('sets font size to 13 and leaves line height at xterm default', async () => {
    const { Terminal } = await import('@xterm/xterm');

    render(
      <JotaiProvider>
        <XtermHost terminalId="test-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    expect(Terminal).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 13 }));
    expect(Terminal).toHaveBeenCalledWith(
      expect.not.objectContaining({ lineHeight: expect.any(Number) })
    );
  });

  it('decodes utf-8 terminal output without mojibake', async () => {
    const store = createStore();
    const chunk = Buffer.from('你好─Codex', 'utf8').toString('base64');

    store.set(terminalOutputAtomFamily('utf-terminal'), {
      chunks: [chunk],
      lastSeq: 1,
      lastWritten: 0,
    });

    render(
      <Provider store={store}>
        <XtermHost terminalId="utf-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expect(mockTerminal.write).toHaveBeenCalledWith('你好─Codex');
    });
  });

  it('does not send terminal input when rendered in read-only mode', async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockResolvedValue({ status: 'unknown' });
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="readonly-terminal" workspaceId="test-workspace" readOnly />
      </Provider>
    );

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    expect(onDataCallback).toBeTypeOf('function');

    await onDataCallback?.('ls -la\n');

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('terminal.replay', {
        terminalId: 'readonly-terminal',
        lastSeq: 0,
      });
    });
    expect(sendCommand).not.toHaveBeenCalledWith('terminal.input', expect.anything());

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('encodes Chinese terminal input as UTF-8 base64 before dispatching', async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockResolvedValue({ status: 'ok' });

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="stdin-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    expect(onDataCallback).toBeTypeOf('function');

    await onDataCallback?.('你好，终端');

    expect(sendCommand).toHaveBeenCalledWith('terminal.input', {
      terminalId: 'stdin-terminal',
      bytes: Buffer.from('你好，终端', 'utf8').toString('base64'),
      activity: 'typing',
    });
  });

  it('marks focus reporting bytes as system activity before dispatching', async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockResolvedValue({ status: 'ok' });

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="focus-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    expect(onDataCallback).toBeTypeOf('function');

    await onDataCallback?.('\x1b[I');

    expect(sendCommand).toHaveBeenCalledWith('terminal.input', {
      terminalId: 'focus-terminal',
      bytes: Buffer.from('\x1b[I', 'utf8').toString('base64'),
      activity: 'system',
    });
  });

  it('marks enter key input as submit activity before dispatching', async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockResolvedValue({ status: 'ok' });

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="submit-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    expect(onDataCallback).toBeTypeOf('function');

    await onDataCallback?.('\r');

    expect(sendCommand).toHaveBeenCalledWith('terminal.input', {
      terminalId: 'submit-terminal',
      bytes: Buffer.from('\r', 'utf8').toString('base64'),
      activity: 'submit',
    });
  });

  it('buffers live output until replay finishes and drops overlapping bytes', async () => {
    const store = createStore();
    const replayChunk = Buffer.from('replay snapshot\n', 'utf8').toString('base64');
    const earlyChunk = Buffer.from('early output\n', 'utf8').toString('base64');
    const lateChunk = Buffer.from('late output\n', 'utf8').toString('base64');
    const sendCommand = vi.fn();
    let replayResolve:
      | ((value: { status: 'ok'; chunk: string; seq: number }) => void)
      | undefined;
    let subscriptionHandler:
      | ((topic: string, payload: unknown, seq: number) => void)
      | undefined;
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    sendCommand.mockImplementation((op: string) => {
      if (op === 'terminal.replay') {
        return new Promise((resolve) => {
          replayResolve = resolve;
        });
      }

      return Promise.resolve({ status: 'ok' });
    });

    const subscribe = vi.fn((topics: string[], handler: typeof subscriptionHandler) => {
      subscriptionHandler = handler;
      return vi.fn();
    });

    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="dedup-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    expect(subscribe).toHaveBeenCalledWith(
      [
        Topics.terminalOutput('test-workspace', 'dedup-terminal'),
        Topics.terminalExit('test-workspace', 'dedup-terminal'),
      ],
      expect.any(Function)
    );
    expect(subscriptionHandler).toBeTypeOf('function');

    await act(async () => {
      subscriptionHandler?.(
        Topics.terminalOutput('test-workspace', 'dedup-terminal'),
        { chunk: earlyChunk, size: 13, seq: 100 },
        1
      );
    });

    expect(mockTerminal.write).not.toHaveBeenCalledWith('early output\n');
    expect(sendCommand).not.toHaveBeenCalledWith('terminal.replay', {
      terminalId: 'dedup-terminal',
      lastSeq: 0,
    });

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('terminal.replay', {
        terminalId: 'dedup-terminal',
        lastSeq: 0,
      });
    });

    await act(async () => {
      replayResolve?.({
        status: 'ok',
        chunk: replayChunk,
        seq: 200,
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockTerminal.write).toHaveBeenCalledWith('replay snapshot\n');
    });
    expect(mockTerminal.write).not.toHaveBeenCalledWith('early output\n');

    await act(async () => {
      subscriptionHandler?.(
        Topics.terminalOutput('test-workspace', 'dedup-terminal'),
        { chunk: lateChunk, size: 12, seq: 250 },
        2
      );
    });

    await waitFor(() => {
      expect(mockTerminal.write).toHaveBeenCalledWith('late output\n');
    });

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('waits for the first fit frame before writing replay output', async () => {
    const store = createStore();
    const replayChunk = Buffer.from('cursor addressed replay\n', 'utf8').toString('base64');
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === 'terminal.replay') {
        return Promise.resolve({ status: 'ok', chunk: replayChunk, seq: 200 });
      }

      return Promise.resolve({ status: 'ok' });
    });
    const subscribe = vi.fn(() => vi.fn());
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="fit-gated-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockFitAddon.fit).not.toHaveBeenCalled();
    expect(mockTerminal.write).not.toHaveBeenCalledWith('cursor addressed replay\n');

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
    });

    expect(mockFitAddon.fit).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockTerminal.write).toHaveBeenCalledWith('cursor addressed replay\n');
    });

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('waits for the initial PTY resize sync before requesting replay', async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === 'terminal.replay') {
        return Promise.resolve({ status: 'ok', seq: 200 });
      }

      return Promise.resolve({ status: 'ok' });
    });
    const subscribe = vi.fn(() => vi.fn());
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="initial-resize-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(sendCommand).not.toHaveBeenCalledWith('terminal.replay', {
      terminalId: 'initial-resize-terminal',
      lastSeq: 0,
    });

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('terminal.resize', {
        terminalId: 'initial-resize-terminal',
        cols: 132,
        rows: 36,
      });
      expect(sendCommand).toHaveBeenCalledWith('terminal.replay', {
        terminalId: 'initial-resize-terminal',
        lastSeq: 0,
      });
    });

    const ops = sendCommand.mock.calls.map(([op]) => op);
    const resizeIndex = ops.indexOf('terminal.resize');
    const replayIndex = ops.indexOf('terminal.replay');
    expect(resizeIndex).toBeGreaterThanOrEqual(0);
    expect(replayIndex).toBeGreaterThan(resizeIndex);

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('ignores delayed replay results after unmount', async () => {
    const store = createStore();
    const sendCommand = vi.fn();
    let replayResolve:
      | ((value: { status: 'ok'; chunk: string; seq: number }) => void)
      | undefined;
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    sendCommand.mockImplementation((op: string) => {
      if (op === 'terminal.replay') {
        return new Promise((resolve) => {
          replayResolve = resolve;
        });
      }

      return Promise.resolve({ status: 'ok' });
    });

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);

    const { unmount } = render(
      <Provider store={store}>
        <XtermHost terminalId="unmount-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('terminal.replay', {
        terminalId: 'unmount-terminal',
        lastSeq: 0,
      });
    });

    unmount();

    await act(async () => {
      replayResolve?.({
        status: 'ok',
        chunk: Buffer.from('late replay after unmount\n', 'utf8').toString('base64'),
        seq: 10,
      });
      await Promise.resolve();
    });

    expect(mockTerminal.write).not.toHaveBeenCalledWith('late replay after unmount\n');

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('syncs xterm resize events back to the server PTY', async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockResolvedValue({ status: 'ok' });

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="resize-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const onResizeCallback = mockTerminal.onResize.mock.calls[0]?.[0];
    expect(onResizeCallback).toBeTypeOf('function');

    await onResizeCallback?.({ cols: 132, rows: 36 });

    expect(sendCommand).toHaveBeenCalledWith('terminal.resize', {
      terminalId: 'resize-terminal',
      cols: 132,
      rows: 36,
    });
  });
});
