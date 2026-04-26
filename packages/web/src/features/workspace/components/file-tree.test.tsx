import { describe, it, expect, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { FileTreePanel } from './file-tree';
import { wsClientAtom } from '../../../atoms/connection';
import { fileTreeAtomFamily, fileTreeStaleAtomFamily } from '../../../atoms/fs';

vi.mock('../../../lib/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

describe('FileTreePanel', () => {
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
    store.set(fileTreeAtomFamily('ws-test'), [
      {
        path: 'README.md',
        name: 'README.md',
        kind: 'file',
      },
    ]);
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

    expect(store.get(fileTreeAtomFamily('ws-test'))).toEqual([
      {
        path: 'src',
        name: 'src',
        kind: 'dir',
        children: [],
      },
    ]);
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
    store.set(fileTreeAtomFamily('ws-test'), [
      {
        path: 'README.md',
        name: 'README.md',
        kind: 'file',
      },
    ]);

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
});
