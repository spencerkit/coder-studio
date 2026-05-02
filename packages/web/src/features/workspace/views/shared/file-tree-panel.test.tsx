import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { FileTreePanel } from './file-tree-panel';
import { wsClientAtom } from '../../../../atoms/connection';
import {
  activeFilePathAtomFamily,
  fileTreeAtomFamily,
  fileTreeStaleAtomFamily,
  loadedDirsAtomFamily,
  openFilesAtomFamily,
} from '../../atoms';

vi.mock('../../../../lib/i18n', () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) => {
    if (key === 'file.delete_confirm') {
      return `Are you sure you want to delete "${params?.name ?? ''}"?`;
    }
    if (key === 'action.cancel') return 'Cancel';
    if (key === 'action.confirm') return 'Confirm';
    return key;
  },
}));

describe('FileTreePanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('clears the stale flag after reloading the file tree for an fs.dirty event', async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      path: '/workspace',
      children: [
        {
          path: 'src',
          name: 'src',
          kind: 'dir',
          children: [],
        },
      ],
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily('ws-test'), new Map([['.', [
      {
        path: 'README.md',
        name: 'README.md',
        kind: 'file',
      },
    ]]]));
    store.set(fileTreeStaleAtomFamily('ws-test'), true);

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('file.readTree', {
        workspaceId: 'ws-test',
      });
    });

    await waitFor(() => {
      expect(store.get(fileTreeStaleAtomFamily('ws-test'))).toBe(false);
    });

    expect(store.get(fileTreeAtomFamily('ws-test'))).toEqual(new Map([['.', [
      {
        path: 'src',
        name: 'src',
        kind: 'dir',
        children: [],
      },
    ]]]));
  });

  it('consumes a refresh token only once instead of reloading on every render', async () => {
    let resolveTree: ((value: { path: string; children: never[] }) => void) | null = null;
    const sendCommand = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTree = resolve;
        })
    );
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily('ws-test'), new Map([['.', [
      {
        path: 'README.md',
        name: 'README.md',
        kind: 'file',
      },
    ]]]));

    const { rerender } = render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" refreshToken={0} />
      </Provider>
    );

    rerender(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" refreshToken={1} />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledTimes(1);
      expect(sendCommand).toHaveBeenCalledWith('file.readTree', {
        workspaceId: 'ws-test',
      });
    });

    await act(async () => {
      resolveTree?.({
        path: '/workspace',
        children: [],
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledTimes(1);
    });
  });

  it('reloads the file tree after creating a file from the toolbar', async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        path: '/workspace',
        children: [
          {
            path: 'src/demo/new-file.ts',
            name: 'new-file.ts',
            kind: 'file',
          },
        ],
      });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily('ws-test'), new Map([['.', []]]));

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" createRequest={{ id: 1, mode: 'file', baseDir: null }} />
      </Provider>
    );

    fireEvent.change(await screen.findByLabelText('file.path'), {
      target: { value: 'src/demo/new-file.ts' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(1, 'file.create', {
        workspaceId: 'ws-test',
        path: 'src/demo/new-file.ts',
      });
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(2, 'file.readTree', {
        workspaceId: 'ws-test',
      });
    });

    await waitFor(() => {
      expect(store.get(fileTreeAtomFamily('ws-test'))).toEqual(new Map([['.', [
        {
          path: 'src/demo/new-file.ts',
          name: 'new-file.ts',
          kind: 'file',
        },
      ]]]));
    });

    expect(store.get(activeFilePathAtomFamily('ws-test'))).toBe('src/demo/new-file.ts');
  });

  it('reloads the file tree after creating a folder from a directory action', async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        path: '/workspace',
        children: [
          {
            path: 'src',
            name: 'src',
            kind: 'dir',
            children: [
              {
                path: 'src/demo',
                name: 'demo',
                kind: 'dir',
                children: [],
              },
            ],
          },
        ],
      });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily('ws-test'), new Map([['.', [
      {
        path: 'src',
        name: 'src',
        kind: 'dir',
        children: [],
      },
    ]]]));

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'file.new_folder src' }));

    const input = await screen.findByLabelText('file.path');
    expect(input).toHaveValue('src/');

    fireEvent.change(input, { target: { value: 'src/demo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(1, 'file.mkdir', {
        workspaceId: 'ws-test',
        path: 'src/demo',
      });
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(2, 'file.readTree', {
        workspaceId: 'ws-test',
      });
    });

    await waitFor(() => {
      expect(store.get(fileTreeAtomFamily('ws-test'))).toEqual(new Map([['.', [
        {
          path: 'src',
          name: 'src',
          kind: 'dir',
          children: [
            {
              path: 'src/demo',
              name: 'demo',
              kind: 'dir',
              children: [],
            },
          ],
        },
      ]]]));
    });
  });

  it('opens the new file dialog from the toolbar and dispatches file.create', async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({ path: '/workspace', children: [] })
      .mockResolvedValueOnce({ ok: true });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily('ws-test'), new Map([['.', []]]));

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" createRequest={{ id: 1, mode: 'file', baseDir: null }} />
      </Provider>
    );

    expect(await screen.findByLabelText('file.path')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('file.path'), {
      target: { value: 'src/demo/new-file.ts' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('file.create', {
        workspaceId: 'ws-test',
        path: 'src/demo/new-file.ts',
      });
    });

    expect(store.get(activeFilePathAtomFamily('ws-test'))).toBe('src/demo/new-file.ts');
  });

  it('opens the new folder dialog from a directory action and pre-fills the directory prefix', async () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily('ws-test'), new Map([['.', [
      {
        path: 'src',
        name: 'src',
        kind: 'dir',
        children: [],
      },
    ]]]));

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'file.new_folder src' }));

    const input = await screen.findByLabelText('file.path');
    expect(input).toHaveValue('src/');

    fireEvent.change(input, { target: { value: 'src/demo/new-dir' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('file.mkdir', {
        workspaceId: 'ws-test',
        path: 'src/demo/new-dir',
      });
    });
  });

  it('opens the new folder dialog on the first click from a directory action', async () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily('ws-test'), new Map([['.', [
      {
        path: 'src',
        name: 'src',
        kind: 'dir',
        children: [],
      },
    ]]]));

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'file.new_folder src' }));

    expect(await screen.findByLabelText('file.path')).toBeInTheDocument();
  });

  it('uses translated loading copy while the tree is still being fetched', async () => {
    const sendCommand = vi.fn().mockImplementation(
      () =>
        new Promise(() => {
          // Keep the initial tree request pending so the loading state remains visible.
        })
    );
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    expect(await screen.findByText('common.loading')).toBeInTheDocument();
  });

  it('loads children for default-expanded root directories', async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      path: 'src',
      children: [
        {
          path: 'src/index.ts',
          name: 'index.ts',
          kind: 'file',
        },
      ],
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily('ws-test'), new Map([['.', [
      {
        path: 'src',
        name: 'src',
        kind: 'dir',
      },
    ]]]));

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('file.readTree', {
        workspaceId: 'ws-test',
        subPath: 'src',
      });
    });

    expect(await screen.findByText('index.ts')).toBeInTheDocument();
  });

  it('uses translated empty-directory copy for expanded folders with no children', () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily('ws-test'), new Map([['.', [
      {
        path: 'src',
        name: 'src',
        kind: 'dir',
        children: [],
      },
    ]]]));

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    expect(screen.getByText('file.empty_directory')).toBeInTheDocument();
  });

  it('filters loaded files by fuzzy filename search', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { query?: string }) => {
      if (op === 'file.search') {
        const query = args.query?.toLowerCase() ?? '';
        const files = [
          { path: 'README.md', name: 'README.md', kind: 'file' },
          { path: 'src/AppController.tsx', name: 'AppController.tsx', kind: 'file' },
          { path: 'src/button.tsx', name: 'button.tsx', kind: 'file' },
        ].filter((item) => item.name.toLowerCase().includes(query));

        return { files };
      }

      return { ok: true };
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    const searchInput = screen.getByPlaceholderText('action.search_files');
    fireEvent.change(searchInput, { target: { value: 'app' } });

    expect(await screen.findByText('AppController.tsx')).toBeInTheDocument();
    expect(screen.queryByText('button.tsx')).not.toBeInTheDocument();
    expect(screen.queryByText('README.md')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'read' } });

    expect(await screen.findByText('README.md')).toBeInTheDocument();
    expect(screen.queryByText('AppController.tsx')).not.toBeInTheDocument();
  });

  it('keeps expanded directories populated after refreshing the file tree', async () => {
    let libReadCount = 0;
    const sendCommand = vi.fn().mockImplementation(async (_op: string, args: { subPath?: string }) => {
      if (args.subPath === 'lib') {
        libReadCount += 1;
        return {
          path: 'lib',
          children: [
            {
              path: libReadCount === 1 ? 'lib/old.ts' : 'lib/new.ts',
              name: libReadCount === 1 ? 'old.ts' : 'new.ts',
              kind: 'file',
            },
          ],
        };
      }

      return {
        path: '.',
        children: [
          {
            path: 'lib',
            name: 'lib',
            kind: 'dir',
          },
        ],
      };
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily('ws-test'), new Map([['.', [
      {
        path: 'lib',
        name: 'lib',
        kind: 'dir',
      },
    ]]]));

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(screen.getByText('lib'));
    expect(await screen.findByText('old.ts')).toBeInTheDocument();

    act(() => {
      store.set(fileTreeStaleAtomFamily('ws-test'), true);
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('file.readTree', {
        workspaceId: 'ws-test',
      });
    });
    expect(await screen.findByText('new.ts')).toBeInTheDocument();
    expect(screen.queryByText('old.ts')).not.toBeInTheDocument();
  });

  it('reloads the file tree after deleting a file', async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        path: '/workspace',
        children: [],
      });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily('ws-test'), new Map([['.', [
      {
        path: 'src/app.tsx',
        name: 'app.tsx',
        kind: 'file',
      },
    ]]]));

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'file.delete src/app.tsx' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(1, 'file.delete', {
        workspaceId: 'ws-test',
        path: 'src/app.tsx',
      });
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(2, 'file.readTree', {
        workspaceId: 'ws-test',
      });
    });

    await waitFor(() => {
      expect(store.get(fileTreeAtomFamily('ws-test'))).toEqual(new Map([['.', []]]));
    });
  });

  it('confirms directory deletion and reloads the file tree', async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        path: '/workspace',
        children: [],
      });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily('ws-test'), new Map([['.', [
      {
        path: 'src',
        name: 'src',
        kind: 'dir',
        children: [],
      },
    ]]]));

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'file.delete src' }));

    expect(await screen.findByText('Are you sure you want to delete "src"?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(1, 'file.delete', {
        workspaceId: 'ws-test',
        path: 'src',
      });
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(2, 'file.readTree', {
        workspaceId: 'ws-test',
      });
    });

    await waitFor(() => {
      expect(store.get(fileTreeAtomFamily('ws-test'))).toEqual(new Map([['.', []]]));
    });
  });

  it('confirms file deletion and removes the file from editor state', async () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily('ws-test'), new Map([['.', [
      {
        path: 'src/app.tsx',
        name: 'app.tsx',
        kind: 'file',
      },
    ]]]));
    store.set(activeFilePathAtomFamily('ws-test'), 'src/app.tsx');
    store.set(openFilesAtomFamily('ws-test'), {
      'src/app.tsx': {
        kind: 'text',
        path: 'src/app.tsx',
        content: 'export {}',
        baseHash: 'hash',
        isDirty: false,
      },
      'src/other.ts': {
        kind: 'text',
        path: 'src/other.ts',
        content: 'export const other = true',
        baseHash: 'hash-2',
        isDirty: false,
      },
    });

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'file.delete src/app.tsx' }));

    expect(await screen.findByText('Are you sure you want to delete "app.tsx"?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('file.delete', {
        workspaceId: 'ws-test',
        path: 'src/app.tsx',
      });
    });

    expect(store.get(activeFilePathAtomFamily('ws-test'))).toBeNull();
    expect(store.get(openFilesAtomFamily('ws-test'))).toEqual({
      'src/other.ts': {
        kind: 'text',
        path: 'src/other.ts',
        content: 'export const other = true',
        baseHash: 'hash-2',
        isDirty: false,
      },
    });
  });
});
