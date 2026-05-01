import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { wsClientAtom } from '../../../atoms/connection';
import { WorkspaceLaunchModal } from './workspace-launch-modal';

const viewportMocks = vi.hoisted(() => ({
  viewport: 'desktop' as 'desktop' | 'mobile',
}));

vi.mock('../../../hooks/use-viewport', () => ({
  useViewport: () => viewportMocks.viewport,
}));

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  location: { pathname: '/' },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => routerMocks.navigate,
    useLocation: () => routerMocks.location,
  };
});

describe('WorkspaceLaunchModal', () => {
  afterEach(() => {
    viewportMocks.viewport = 'desktop';
    routerMocks.navigate.mockReset();
    routerMocks.location.pathname = '/';
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

  it('opens the selected host directory without showing runtime target choices', async () => {
    const onClose = vi.fn();
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { path?: string }) => {
      if (op === 'workspace.browse') {
        return {
          currentPath: '/home/spencer',
          parentPath: '/home',
          directories: [
            { name: 'workspace', path: '/home/spencer/workspace' },
          ],
        };
      }

      if (op === 'workspace.open') {
        return {
          id: 'ws-1',
        };
      }

      return {};
    });

    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={onClose} />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.queryByRole('button', { name: 'Native' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'WSL' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Target:/)).not.toBeInTheDocument();

    const folderName = await screen.findByText('workspace');
    fireEvent.click(folderName);
    fireEvent.click(screen.getByRole('button', { name: 'Start Workspace' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('workspace.open', {
        path: '/home/spencer/workspace',
      });
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('navigates to /workspace after opening a workspace from outside the workspace page', async () => {
    const onClose = vi.fn();
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { path?: string }) => {
      if (op === 'workspace.browse') {
        return {
          currentPath: '/home/spencer',
          parentPath: '/home',
          directories: [
            { name: 'workspace', path: '/home/spencer/workspace' },
          ],
        };
      }

      if (op === 'workspace.open') {
        return {
          id: 'ws-1',
        };
      }

      return {};
    });

    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    routerMocks.location.pathname = '/';

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={onClose} />
        </MemoryRouter>
      </Provider>
    );

    const folderName = await screen.findByText('workspace');
    fireEvent.click(folderName);
    fireEvent.click(screen.getByRole('button', { name: 'Start Workspace' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('workspace.open', {
        path: '/home/spencer/workspace',
      });
    });

    await waitFor(() => {
      expect(routerMocks.navigate).toHaveBeenCalledWith('/workspace');
    });
  });

  it('renders inside MobileSheet on mobile while preserving browse and open behavior', async () => {
    viewportMocks.viewport = 'mobile';
    const onClose = vi.fn();
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { path?: string }) => {
      if (op === 'workspace.browse') {
        return {
          currentPath: '/home/spencer',
          parentPath: '/home',
          directories: [
            { name: 'workspace', path: '/home/spencer/workspace' },
          ],
        };
      }

      if (op === 'workspace.open') {
        return {
          id: 'ws-1',
        };
      }

      return {};
    });

    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WorkspaceLaunchModal onClose={onClose} />
        </MemoryRouter>
      </Provider>
    );

    await screen.findByText('workspace');

    expect(document.querySelector('.mobile-sheet')).toBeTruthy();
    expect(document.querySelector('.launch-overlay')).toBeNull();

    const folderName = screen.getByText('workspace');
    fireEvent.click(folderName);
    fireEvent.click(screen.getByRole('button', { name: 'Start Workspace' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('workspace.open', {
        path: '/home/spencer/workspace',
      });
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });
});
