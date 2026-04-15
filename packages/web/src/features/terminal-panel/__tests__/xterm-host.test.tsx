/**
 * XtermHost Component Tests
 *
 * Unit tests for the xterm.js terminal rendering component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { JotaiProvider } from '../../../test-utils/jotai-provider';
import { XtermHost } from '../components/xterm-host';

// Mock xterm.js modules
vi.mock('xterm', () => {
  const mockTerminal = {
    open: vi.fn(),
    onData: vi.fn(() => vi.fn()), // Return dispose function
    write: vi.fn(),
    writeln: vi.fn(),
    dispose: vi.fn(),
    focus: vi.fn(),
    loadAddon: vi.fn(),
  };

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
});