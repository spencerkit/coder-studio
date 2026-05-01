import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { GitDiffViewer } from './git-diff-viewer';
import { wsClientAtom } from '../../../../atoms/connection';
import { gitDiffPreviewAtomFamily } from '../../atoms/git';

describe('GitDiffViewer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows file contents in preview mode and raw patch in diff mode', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === 'file.read') {
        expect(args).toEqual({
          workspaceId: 'ws-test',
          path: 'packages/core/src/domain/types.ts',
        });

        return {
          content: [
            'export interface Workspace {',
            '  previewMode: true;',
            '}',
          ].join('\n'),
          baseHash: 'hash-1',
          encoding: 'utf-8',
        };
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(gitDiffPreviewAtomFamily('ws-test'), {
      path: 'packages/core/src/domain/types.ts',
      staged: false,
      diff: [
        'diff --git a/packages/core/src/domain/types.ts b/packages/core/src/domain/types.ts',
        'index 1234567..89abcde 100644',
        '@@ -1,2 +1,3 @@',
        ' export interface Workspace {',
        '+  previewMode: true;',
        ' }',
      ].join('\n'),
    });

    const { container } = render(
      <Provider store={store}>
        <GitDiffViewer workspaceId="ws-test" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('file.read', {
        workspaceId: 'ws-test',
        path: 'packages/core/src/domain/types.ts',
      });
    });

    await waitFor(() => {
      expect(container.querySelector('.git-preview-lines')).toHaveTextContent(
        'export interface Workspace {'
      );
    });
    expect(container.querySelector('.git-preview-lines')).toHaveTextContent('previewMode: true;');
    expect(screen.queryByText(/diff --git/)).not.toBeInTheDocument();
    expect(screen.queryByText(/@@ -1,2 \+1,3 @@/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Diff' }));

    expect(await screen.findByText(/diff --git a\/packages\/core\/src\/domain\/types\.ts/)).toBeInTheDocument();
    expect(screen.getByText('@@ -1,2 +1,3 @@')).toBeInTheDocument();
  });

  it('applies syntax highlight classes in preview mode', async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      content: [
        "import React from 'react';",
        '// preview comment',
      ].join('\n'),
      baseHash: 'hash-2',
      encoding: 'utf-8',
    });

    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(gitDiffPreviewAtomFamily('ws-test'), {
      path: 'src/example.ts',
      diff: 'diff --git a/src/example.ts b/src/example.ts',
      staged: false,
    });

    const { container } = render(
      <Provider store={store}>
        <GitDiffViewer workspaceId="ws-test" />
      </Provider>
    );

    await screen.findByText('import');

    expect(container.querySelector('.code-keyword')?.textContent).toBe('import');
    expect(container.querySelector('.code-string')?.textContent).toBe("'react'");
    expect(container.querySelector('.code-comment')?.textContent).toBe('// preview comment');
  });
});
