/**
 * XtermHost Component Tests
 *
 * Unit tests for the xterm.js terminal rendering component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { Topics } from '@coder-studio/core';
import type { TerminalReplayPayload } from '../../../ws/client';
import { JotaiProvider } from '../../../test-utils/jotai-provider';
import { XtermHost, trimWrittenChunks } from '../components/xterm-host';
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

const textEncoder = new TextEncoder();

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
    mockTerminal.cols = undefined;
    mockTerminal.rows = undefined;
    mockTerminal.write.mockImplementation(() => {});
    mockTerminal.writeln.mockImplementation(() => {});
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

  it('forwards utf-8 terminal output bytes to xterm without pre-decoding', async () => {
    const store = createStore();
    const chunk = textEncoder.encode('你好─Codex');

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
      expect(mockTerminal.write).toHaveBeenCalledWith(chunk);
    });
  });

  it('forwards split utf-8 chunks to xterm without corrupting partial code points', async () => {
    const store = createStore();
    const fullChunk = textEncoder.encode('┌─审批确认─┐');
    const firstChunk = fullChunk.slice(0, 1);
    const secondChunk = fullChunk.slice(1);

    store.set(terminalOutputAtomFamily('utf-split-terminal'), {
      chunks: [firstChunk, secondChunk],
      lastSeq: fullChunk.byteLength,
      lastWritten: 0,
    });

    render(
      <Provider store={store}>
        <XtermHost terminalId="utf-split-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expect(mockTerminal.write).toHaveBeenCalledTimes(2);
    });

    expect(mockTerminal.write.mock.calls[0]?.[0]).toEqual(firstChunk);
    expect(mockTerminal.write.mock.calls[1]?.[0]).toEqual(secondChunk);
  });

  it('trims only the written chunk prefix and preserves concurrently appended chunks', () => {
    const firstChunk = textEncoder.encode('first\n');
    const secondChunk = textEncoder.encode('second\n');

    expect(
      trimWrittenChunks(
        {
          chunks: [firstChunk, secondChunk],
          lastSeq: firstChunk.byteLength + secondChunk.byteLength,
          lastWritten: 0,
        },
        1
      )
    ).toEqual({
      chunks: [secondChunk],
      lastSeq: firstChunk.byteLength + secondChunk.byteLength,
      lastWritten: 0,
    });
  });

  it('does not send terminal input when rendered in read-only mode', async () => {
    const store = createStore();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);
    const sendCommand = vi.fn().mockResolvedValue({ status: 'ok' });
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendTerminalInput,
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
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendTerminalInput).not.toHaveBeenCalled();

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('encodes Chinese terminal input as UTF-8 bytes before dispatching', async () => {
    const store = createStore();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(wsClientAtom, {
      sendTerminalInput,
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

    expect(sendTerminalInput).toHaveBeenCalledWith(
      'stdin-terminal',
      new TextEncoder().encode('你好，终端'),
      'typing',
      undefined
    );
  });

  it('marks focus reporting bytes as system activity before dispatching', async () => {
    const store = createStore();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(wsClientAtom, {
      sendTerminalInput,
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

    expect(sendTerminalInput).toHaveBeenCalledWith(
      'focus-terminal',
      new TextEncoder().encode('\x1b[I'),
      'system',
      undefined
    );
  });

  it('marks enter key input as submit activity before dispatching', async () => {
    const store = createStore();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(wsClientAtom, {
      sendTerminalInput,
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

    expect(sendTerminalInput).toHaveBeenCalledWith(
      'submit-terminal',
      new TextEncoder().encode('\r'),
      'submit',
      undefined
    );
  });

  it('includes submitted text metadata when submit input carries content', async () => {
    const store = createStore();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(wsClientAtom, {
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="submit-text-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    expect(onDataCallback).toBeTypeOf('function');

    await onDataCallback?.('fix the build\r');

    expect(sendTerminalInput).toHaveBeenCalledWith(
      'submit-text-terminal',
      new TextEncoder().encode('fix the build\r'),
      'submit',
      'fix the build'
    );
  });

  it('tracks typed input across keystrokes and sends the buffered line on Enter', async () => {
    const store = createStore();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(wsClientAtom, {
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="buffered-submit-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    expect(onDataCallback).toBeTypeOf('function');

    await onDataCallback?.('f');
    await onDataCallback?.('i');
    await onDataCallback?.('x');
    await onDataCallback?.('\r');

    expect(sendTerminalInput).toHaveBeenLastCalledWith(
      'buffered-submit-terminal',
      new TextEncoder().encode('\r'),
      'submit',
      'fix'
    );
  });

  it('ignores OSC control sequences while buffering submitted text', async () => {
    const store = createStore();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(wsClientAtom, {
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="osc-submit-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    expect(onDataCallback).toBeTypeOf('function');

    await onDataCallback?.('f');
    await onDataCallback?.('i');
    await onDataCallback?.('x');
    await onDataCallback?.('\x1b]10;rgb:e5/e5/e5\x07');
    await onDataCallback?.('\r');

    expect(sendTerminalInput).toHaveBeenLastCalledWith(
      'osc-submit-terminal',
      new TextEncoder().encode('\r'),
      'submit',
      'fix'
    );
  });

  it('buffers live output until replay finishes and drops overlapping bytes', async () => {
    const store = createStore();
    const replayChunk = new TextEncoder().encode('replay snapshot\n');
    const earlyChunk = new TextEncoder().encode('early output\n');
    const lateChunk = new TextEncoder().encode('late output\n');
    const dispatchCommand = vi.fn();
    let replayResolve: ((value: TerminalReplayPayload) => void) | undefined;
    let subscriptionHandler:
      | ((topic: string, payload: unknown, seq: number) => void)
      | undefined;
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

    dispatchCommand.mockImplementation((op: string) => {
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
      sendCommand: dispatchCommand,
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
        { transport: 'binary', streamId: 100, size: earlyChunk.byteLength, bytes: earlyChunk },
        100
      );
      await Promise.resolve();
    });

    expect(mockTerminal.write).not.toHaveBeenCalled();
    expect(dispatchCommand).not.toHaveBeenCalledWith('terminal.replay', {
      terminalId: 'dedup-terminal',
      lastSeq: 0,
    });

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(dispatchCommand).toHaveBeenCalledWith('terminal.resize', {
        terminalId: 'dedup-terminal',
        cols: 132,
        rows: 36,
      });
      expect(dispatchCommand).toHaveBeenCalledWith('terminal.replay', {
        terminalId: 'dedup-terminal',
        lastSeq: 0,
      });
    });

    await act(async () => {
      replayResolve?.({
        status: 'ok',
        transport: 'binary',
        streamId: 101,
        size: replayChunk.byteLength,
        seq: 200,
        bytes: replayChunk,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockTerminal.write).toHaveBeenNthCalledWith(1, replayChunk);
    });
    expect(mockTerminal.write).not.toHaveBeenCalledWith(earlyChunk);

    await act(async () => {
      subscriptionHandler?.(
        Topics.terminalOutput('test-workspace', 'dedup-terminal'),
        { transport: 'binary', streamId: 102, size: lateChunk.byteLength, bytes: lateChunk },
        200 + lateChunk.byteLength
      );
    });

    await waitFor(() => {
      expect(mockTerminal.write).toHaveBeenCalledWith(lateChunk);
    });

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('requests a replay from the last rendered seq when live output arrives with a seq gap', async () => {
    const store = createStore();
    const initialReplayChunk = new TextEncoder().encode('snapshot\n');
    const liveChunk = new TextEncoder().encode('tail\n');
    const gapReplayChunk = new TextEncoder().encode('missed\ntail\n');
    const sendCommand = vi.fn();
    let replayCount = 0;
    let gapReplayResolve: ((value: TerminalReplayPayload) => void) | undefined;
    let subscriptionHandler:
      | ((topic: string, payload: unknown, seq: number) => void)
      | undefined;
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

    sendCommand.mockImplementation((op: string) => {
      if (op === 'terminal.replay') {
        replayCount += 1;

        if (replayCount === 1) {
          return Promise.resolve({
            status: 'ok',
            transport: 'binary',
            streamId: 501,
            size: initialReplayChunk.byteLength,
            seq: 100,
            bytes: initialReplayChunk,
          } satisfies TerminalReplayPayload);
        }

        return new Promise((resolve) => {
          gapReplayResolve = resolve;
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
        <XtermHost terminalId="gap-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('terminal.replay', {
        terminalId: 'gap-terminal',
        lastSeq: 0,
      });
      expect(mockTerminal.write).toHaveBeenCalledWith(initialReplayChunk);
    });

    mockTerminal.write.mockClear();

    await act(async () => {
      subscriptionHandler?.(
        Topics.terminalOutput('test-workspace', 'gap-terminal'),
        { transport: 'binary', streamId: 502, size: liveChunk.byteLength, bytes: liveChunk },
        112
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('terminal.replay', {
        terminalId: 'gap-terminal',
        lastSeq: 100,
      });
    });
    expect(mockTerminal.write).not.toHaveBeenCalled();

    await act(async () => {
      gapReplayResolve?.({
        status: 'ok',
        transport: 'binary',
        streamId: 503,
        size: gapReplayChunk.byteLength,
        seq: 112,
        bytes: gapReplayChunk,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockTerminal.write).toHaveBeenCalledWith(gapReplayChunk);
    });

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('waits for the first fit frame before writing replay output', async () => {
    const store = createStore();
    const replayChunk = new TextEncoder().encode('cursor addressed replay\n');
    const dispatchCommand = vi.fn().mockImplementation((op: string) => {
      if (op === 'terminal.replay') {
        return Promise.resolve({
          status: 'ok',
          seq: 200,
          bytes: replayChunk,
        });
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
      sendCommand: dispatchCommand,
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
    expect(mockTerminal.write).not.toHaveBeenCalledWith(replayChunk);

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockFitAddon.fit).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockTerminal.write).toHaveBeenCalledWith(replayChunk);
    });

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('waits for the initial PTY resize sync before requesting replay', async () => {
    const store = createStore();
    const dispatchCommand = vi.fn().mockImplementation((op: string) => {
      if (op === 'terminal.replay') {
        return Promise.resolve({ ok: true, data: { status: 'ok', seq: 200 } });
      }

      return Promise.resolve({ ok: true, data: { status: 'ok' } });
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
      sendCommand: dispatchCommand,
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

    expect(dispatchCommand).not.toHaveBeenCalledWith('terminal.replay', {
      terminalId: 'initial-resize-terminal',
      lastSeq: 0,
    });

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(dispatchCommand).toHaveBeenCalledWith('terminal.resize', {
        terminalId: 'initial-resize-terminal',
        cols: 132,
        rows: 36,
      });
      expect(dispatchCommand).toHaveBeenCalledWith('terminal.replay', {
        terminalId: 'initial-resize-terminal',
        lastSeq: 0,
      });
    });

    const ops = dispatchCommand.mock.calls.map(([op]) => op);
    const resizeIndex = ops.indexOf('terminal.resize');
    const replayIndex = ops.indexOf('terminal.replay');
    expect(resizeIndex).toBeGreaterThanOrEqual(0);
    expect(replayIndex).toBeGreaterThan(resizeIndex);

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('waits for websocket connection before initial resize sync and replay', async () => {
    const store = createStore();
    const replayChunk = new TextEncoder().encode('replay after connect\n');
    let connectionStatus: 'connecting' | 'connected' = 'connecting';
    let statusListener: ((status: 'connecting' | 'connected') => void) | undefined;
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (connectionStatus !== 'connected') {
        return Promise.reject(new Error('WebSocket not connected'));
      }

      if (op === 'terminal.replay') {
        return Promise.resolve({
          status: 'ok',
          transport: 'binary',
          streamId: 401,
          size: replayChunk.byteLength,
          seq: 200,
          bytes: replayChunk,
        });
      }

      return Promise.resolve({ status: 'ok' });
    });
    const subscribe = vi.fn(() => vi.fn());
    const onStatus = vi.fn((listener: typeof statusListener) => {
      statusListener = listener;
      return vi.fn();
    });
    const getStatus = vi.fn(() => connectionStatus);
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
      onStatus,
      getStatus,
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="connect-gated-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendCommand).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(onStatus).toHaveBeenCalled();
      expect(typeof statusListener).toBe('function');
    });

    await act(async () => {
      connectionStatus = 'connected';
      statusListener?.('connected');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('terminal.resize', {
        terminalId: 'connect-gated-terminal',
        cols: 132,
        rows: 36,
      });
      expect(sendCommand).toHaveBeenCalledWith('terminal.replay', {
        terminalId: 'connect-gated-terminal',
        lastSeq: 0,
      });
      expect(mockTerminal.write).toHaveBeenCalledWith(replayChunk);
    });

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('ignores delayed replay results after unmount', async () => {
    const store = createStore();
    const replayChunk = new TextEncoder().encode('late replay after unmount\n');
    const dispatchCommand = vi.fn();
    let replayResolve: ((value: TerminalReplayPayload) => void) | undefined;
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    dispatchCommand.mockImplementation((op: string) => {
      if (op === 'terminal.replay') {
        return new Promise((resolve) => {
          replayResolve = resolve;
        }).then((data) => ({ ok: true, data }));
      }

      return Promise.resolve({ ok: true, data: { status: 'ok' } });
    });

    store.set(wsClientAtom, {
      sendCommand: dispatchCommand,
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
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(dispatchCommand).toHaveBeenCalledWith('terminal.replay', {
        terminalId: 'unmount-terminal',
        lastSeq: 0,
      });
    });

    unmount();

    await act(async () => {
      replayResolve?.({
        status: 'ok',
        transport: 'binary',
        streamId: 301,
        size: replayChunk.byteLength,
        bytes: replayChunk,
        seq: 10,
      });
      await Promise.resolve();
    });

    expect(mockTerminal.write).not.toHaveBeenCalledWith('late replay after unmount\n');

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('does not trigger a re-replay for sequential 1-byte live chunks after replay completes', async () => {
    const store = createStore();
    const initialReplayChunk = new TextEncoder().encode('');
    const sendCommand = vi.fn();
    let replayCount = 0;
    let subscriptionHandler:
      | ((topic: string, payload: unknown, seq: number) => void)
      | undefined;
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

    sendCommand.mockImplementation((op: string) => {
      if (op === 'terminal.replay') {
        replayCount += 1;
        return Promise.resolve({
          status: 'ok',
          transport: 'binary',
          streamId: 700 + replayCount,
          size: initialReplayChunk.byteLength,
          seq: 100,
          bytes: initialReplayChunk,
        } satisfies TerminalReplayPayload);
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
        <XtermHost terminalId="typing-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('terminal.replay', {
        terminalId: 'typing-terminal',
        lastSeq: 0,
      });
    });

    expect(replayCount).toBe(1);
    mockTerminal.write.mockClear();

    // Simulate three sequential 1-byte echoes (e.g. PTY echoing typed
    // characters), each immediately following the previous in seq.
    const bytes = ['g', 'i', 't'].map((ch) => new TextEncoder().encode(ch));
    let seq = 100;
    for (const chunk of bytes) {
      seq += chunk.byteLength;
      const localChunk = chunk;
      const localSeq = seq;
      await act(async () => {
        subscriptionHandler?.(
          Topics.terminalOutput('test-workspace', 'typing-terminal'),
          {
            transport: 'binary',
            streamId: 800 + localSeq,
            size: localChunk.byteLength,
            bytes: localChunk,
          },
          localSeq
        );
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    await waitFor(() => {
      expect(mockTerminal.write).toHaveBeenCalledTimes(bytes.length);
    });

    // No spurious re-replay should have fired - the live chunks were
    // contiguous with the snapshot's covered seq.
    expect(replayCount).toBe(1);
    expect(mockTerminal.write.mock.calls.map(([data]) => data)).toEqual(bytes);

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('syncs xterm resize events back to the server PTY', async () => {
    const store = createStore();
    const dispatchCommand = vi.fn().mockResolvedValue({ ok: true, data: { status: 'ok' } });

    store.set(wsClientAtom, {
      sendCommand: dispatchCommand,
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

    expect(dispatchCommand).toHaveBeenCalledWith('terminal.resize', {
      terminalId: 'resize-terminal',
      cols: 132,
      rows: 36,
    });
  });
});
