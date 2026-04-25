import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { wsClientAtom } from '../../atoms/connection';
import { activeWorkspaceIdAtom } from '../../atoms/ui';
import {
  activeFilePathAtomFamily,
  openFilesAtomFamily,
  type OpenFile,
} from '../../atoms/fs';
import { seedReadyWorkspaceState } from '../../test-utils/workspace-state';
import { CodeEditorHost } from './index';

// Monaco is not happy in jsdom; stub it so we only assert our own chrome.
vi.mock('./components/monaco-host', () => ({
  MonacoHost: ({ content }: { content: string }) => (
    <div data-testid="monaco-host">{content}</div>
  ),
}));

// ImagePreview mount would try to decode the <img>; in jsdom the load event
// never fires for data: URLs, so we stub it to assert routing only.
vi.mock('./components/image-preview', () => ({
  ImagePreview: ({ url, mime }: { url: string; mime: string }) => (
    <div data-testid="image-preview" data-url={url} data-mime={mime} />
  ),
}));

function setupStore(options?: {
  activePath?: string | null;
  openFiles?: Record<string, OpenFile>;
  sendCommand?: ReturnType<typeof vi.fn>;
}) {
  const store = createStore();
  const sendCommand =
    options?.sendCommand ??
    vi.fn().mockImplementation(async (op: string) => {
      if (op === 'file.read') {
        return {
          kind: 'text',
          content: 'hello world',
          baseHash: 'abc123',
          encoding: 'utf-8',
        };
      }
      return null;
    });

  store.set(wsClientAtom, { sendCommand } as never);
  seedReadyWorkspaceState(store, {
    'ws-1': {
      id: 'ws-1',
      path: '/tmp/ws',
      targetRuntime: 'native',
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 280,
        bottomPanelHeight: 200,
        focusMode: false,
      },
    },
  });
  store.set(activeWorkspaceIdAtom, 'ws-1');

  if (options?.activePath !== undefined) {
    store.set(activeFilePathAtomFamily('ws-1'), options.activePath);
  }
  if (options?.openFiles) {
    store.set(openFilesAtomFamily('ws-1'), options.openFiles);
  }

  return { store, sendCommand };
}

describe('CodeEditorHost', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches file contents via file.read when activeFile has no cached buffer', async () => {
    const { store, sendCommand } = setupStore({ activePath: 'src/a.ts' });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('file.read', {
        workspaceId: 'ws-1',
        path: 'src/a.ts',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('monaco-host')).toHaveTextContent('hello world');
    });
  });

  it('does not re-fetch a file that is already open', async () => {
    const { store, sendCommand } = setupStore({
      activePath: 'src/b.ts',
      openFiles: {
        'src/b.ts': {
          kind: 'text',
          path: 'src/b.ts',
          content: 'cached',
          baseHash: 'h',
          isDirty: false,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    expect(screen.getByTestId('monaco-host')).toHaveTextContent('cached');
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('clears the active file when the close button is clicked', async () => {
    const { store } = setupStore({
      activePath: 'src/c.ts',
      openFiles: {
        'src/c.ts': {
          kind: 'text',
          path: 'src/c.ts',
          content: 'content',
          baseHash: 'h',
          isDirty: false,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    expect(store.get(activeFilePathAtomFamily('ws-1'))).toBe('src/c.ts');

    const closeBtn = screen.getByRole('button', { name: /close|关闭/i });
    fireEvent.click(closeBtn);

    expect(store.get(activeFilePathAtomFamily('ws-1'))).toBeNull();
    expect(store.get(openFilesAtomFamily('ws-1'))['src/c.ts']).toBeUndefined();
  });

  it('renders ImagePreview when file.read returns an image descriptor', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === 'file.read') {
        return {
          kind: 'image',
          mime: 'image/png',
          url: '/api/file?workspaceId=ws-1&path=assets%2Flogo.png',
          size: 1234,
          isTextBacked: false,
        };
      }
      return null;
    });

    const { store } = setupStore({ activePath: 'assets/logo.png', sendCommand });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('image-preview')).toBeInTheDocument();
    });

    const preview = screen.getByTestId('image-preview');
    expect(preview.getAttribute('data-mime')).toBe('image/png');
    expect(preview.getAttribute('data-url')).toContain('/api/file?');
    expect(screen.queryByTestId('monaco-host')).not.toBeInTheDocument();

    // Save button must be disabled for images (nothing to write back).
    const saveBtn = screen.getByRole('button', { name: /save|保存/i });
    expect(saveBtn).toBeDisabled();
  });

  describe('SVG edit-as-text toggle', () => {
    beforeEach(() => {
      // The toggle fetches the file bytes over HTTP to reuse them as text.
      // Stub global fetch so jsdom doesn't try to hit the network.
      const fetchMock = vi.fn(async () => ({
        ok: true,
        text: async () => '<svg xmlns="http://www.w3.org/2000/svg"/>',
      }));
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('switches a text-backed image into text mode when the toggle is clicked', async () => {
      // Server still routes SVG through the image branch on every read; the
      // force-text escape hatch is what the client uses to then pull the
      // bytes as text.
      const sendCommand = vi.fn().mockImplementation(async (op: string) => {
        if (op === 'file.read') {
          return {
            kind: 'image',
            mime: 'image/svg+xml',
            url: '/api/file?workspaceId=ws-1&path=icon.svg',
            size: 200,
            isTextBacked: true,
          };
        }
        return null;
      });

      const { store } = setupStore({
        activePath: 'icon.svg',
        sendCommand,
        openFiles: {
          'icon.svg': {
            kind: 'image',
            path: 'icon.svg',
            mime: 'image/svg+xml',
            url: '/api/file?workspaceId=ws-1&path=icon.svg',
            size: 200,
            isTextBacked: true,
          },
        },
      });

      render(
        <Provider store={store}>
          <CodeEditorHost />
        </Provider>
      );

      // Initially renders as image preview.
      expect(screen.getByTestId('image-preview')).toBeInTheDocument();

      const toggleBtn = screen.getByRole('button', { name: /edit as text/i });
      fireEvent.click(toggleBtn);

      // After the fetch resolves we should be viewing it in Monaco with the
      // raw SVG source, and the toggle label flips to the image direction.
      await waitFor(() => {
        expect(screen.getByTestId('monaco-host')).toHaveTextContent('<svg');
      });
      expect(screen.queryByTestId('image-preview')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /preview as image/i })).toBeInTheDocument();
    });

    it('does not show the toggle for non-text-backed images like PNG', async () => {
      const { store } = setupStore({
        activePath: 'logo.png',
        openFiles: {
          'logo.png': {
            kind: 'image',
            path: 'logo.png',
            mime: 'image/png',
            url: '/api/file?workspaceId=ws-1&path=logo.png',
            size: 4096,
            isTextBacked: false,
          },
        },
      });

      render(
        <Provider store={store}>
          <CodeEditorHost />
        </Provider>
      );

      expect(screen.getByTestId('image-preview')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /edit as text/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /preview as image/i })).not.toBeInTheDocument();
    });
  });
});
