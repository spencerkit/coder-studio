import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { GitDiffViewer } from './git-diff-viewer';
import { wsClientAtom } from '../../../../atoms/connection';
import { gitDiffPreviewAtomFamily } from '../../atoms';

describe('GitDiffViewer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows raw patch content only and does not request file preview content', async () => {
    const sendCommand = vi.fn();

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

    render(
      <Provider store={store}>
        <GitDiffViewer workspaceId="ws-test" />
      </Provider>
    );

    expect(await screen.findByText(/diff --git a\/packages\/core\/src\/domain\/types\.ts/)).toBeInTheDocument();
    expect(screen.getByText('@@ -1,2 +1,3 @@')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Diff' })).not.toBeInTheDocument();
    expect(sendCommand).not.toHaveBeenCalled();
  });
});
