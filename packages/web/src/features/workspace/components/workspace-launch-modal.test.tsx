import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { wsClientAtom } from '../../../atoms/connection';
import { WorkspaceLaunchModal } from './workspace-launch-modal';

describe('WorkspaceLaunchModal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('navigates into a selected folder from the inline enter action', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { path?: string }) => {
      if (op !== 'workspace.browse') {
        return {};
      }

      if (args.path === '/home/spencer/workspace') {
        return {
          currentPath: '/home/spencer/workspace',
          parentPath: '/home/spencer',
          directories: [
            { name: 'coder-studio', path: '/home/spencer/workspace/coder-studio' },
          ],
        };
      }

      return {
        currentPath: '/home/spencer',
        parentPath: '/home',
        directories: [
          { name: 'workspace', path: '/home/spencer/workspace' },
        ],
      };
    });

    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>
    );

    const folderName = await screen.findByText('workspace');
    fireEvent.click(folderName);

    const enterButton = await screen.findByRole('button', { name: 'Enter workspace' });
    fireEvent.click(enterButton);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('workspace.browse', {
        path: '/home/spencer/workspace',
      });
    });

    expect(await screen.findByText('coder-studio')).toBeInTheDocument();
  });
});
