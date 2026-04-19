/**
 * XtermHost Component Tests
 *
 * Unit tests for the xterm.js terminal rendering component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { JotaiProvider } from '../../../test-utils/jotai-provider';
import { XtermHost } from '../components/xterm-host';
import { terminalOutputAtomFamily } from '../../../atoms/terminals';
import { wsClientAtom } from '../../../atoms/connection';

const mockTerminal = {
  open: vi.fn(),
  onData: vi.fn(() => vi.fn()), // Return dispose function
  write: vi.fn(),
  writeln: vi.fn(),
  dispose: vi.fn(),
  focus: vi.fn(),
  loadAddon: vi.fn(),
  options: {},
};

// Mock xterm.js modules
vi.mock('xterm', () => {
  return {
    Terminal: vi.fn(() => mockTerminal),
  };
});

vi.mock('xterm-addon-fit', () => {
  const mockFitAddon = {
    fit: vi.fn(),
  };

  return {
    FitAddon: vi.fn(() => mockFitAddon),
  };
});

vi.mock('xterm-addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(() => {}),
}));

describe('XtermHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    const { Terminal } = await import('xterm');

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

  it('uses JetBrains Mono font family', async () => {
    const { Terminal } = await import('xterm');

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
    const { Terminal } = await import('xterm');

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
    const { Terminal } = await import('xterm');

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

  it('sets font size to 13 with line height 1.4', async () => {
    const { Terminal } = await import('xterm');

    render(
      <JotaiProvider>
        <XtermHost terminalId="test-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    expect(Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        fontSize: 13,
        lineHeight: 1.4,
      })
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

    expect(sendCommand).toHaveBeenCalledWith('terminal.replay', {
      terminalId: 'readonly-terminal',
      lastSeq: 0,
    });
    expect(sendCommand).not.toHaveBeenCalledWith('terminal.input', expect.anything());
  });
});
