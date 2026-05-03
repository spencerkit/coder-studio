import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider, createStore } from 'jotai';
import { localeAtom } from '../../../atoms/app-ui';
import { MobileSelectSheet } from './mobile-select-sheet';

function renderWithEnglishLocale(node: React.ReactNode) {
  const store = createStore();
  store.set(localeAtom, 'en');

  return render(<Provider store={store}>{node}</Provider>);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MobileSelectSheet', () => {
  it('renders option sections and highlights the selected item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();

    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Terminal Sessions"
        sections={[
          {
            kind: 'options',
            id: 'terminals',
            items: [
              { id: 'term_1', label: 'Workspace Shell', meta: 'Current terminal' },
              { id: 'term_2', label: 'Workspace Shell 2', meta: 'Terminal 2' },
            ],
          },
        ]}
        selectedId="term_1"
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    expect(screen.getByRole('region', { name: 'Terminal Sessions sheet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Workspace Shell' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Workspace Shell' })).toHaveAccessibleDescription(
      'Current terminal'
    );

    await user.click(screen.getByRole('button', { name: 'Workspace Shell 2' }));
    expect(onSelect).toHaveBeenCalledWith('term_2');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('waits for async onSelect to settle before closing when closeOnSelect is true', async () => {
    const user = userEvent.setup();
    let resolveSelect: (() => void) | null = null;
    const onSelect = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSelect = resolve;
        })
    );
    const onClose = vi.fn();

    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Terminal Sessions"
        sections={[
          {
            kind: 'options',
            id: 'terminals',
            items: [{ id: 'term_1', label: 'Workspace Shell' }],
          },
        ]}
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Workspace Shell' }));

    expect(onSelect).toHaveBeenCalledWith('term_1');
    expect(onClose).not.toHaveBeenCalled();

    resolveSelect?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('logs and keeps the sheet open when async onSelect rejects', async () => {
    const user = userEvent.setup();
    const error = new Error('select failed');
    const onSelect = vi.fn().mockRejectedValue(error);
    const onClose = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Terminal Sessions"
        sections={[
          {
            kind: 'options',
            id: 'terminals',
            items: [{ id: 'term_1', label: 'Workspace Shell' }],
          },
        ]}
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Workspace Shell' }));
    await Promise.resolve();
    await Promise.resolve();

    expect(onClose).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('MobileSelectSheet select failed', error);
  });

  it('filters only option sections when searchable and matches descriptions and keywords', async () => {
    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Agent Sessions"
        searchable
        searchPlaceholder="Search sessions"
        sections={[
          {
            kind: 'actions',
            id: 'actions',
            items: [{ id: 'create', label: 'Create Session', onAction: vi.fn() }],
          },
          {
            kind: 'options',
            id: 'sessions',
            items: [
              {
                id: 'sess_1',
                label: 'Claude',
                description: 'Anthropic session',
                keywords: ['analysis'],
              },
              {
                id: 'sess_2',
                label: 'Codex',
                description: 'Code generation',
                keywords: ['automation', 'openai'],
              },
            ],
          },
        ]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Search sessions'), {
      target: { value: 'cod' },
    });

    expect(screen.getByRole('button', { name: 'Create Session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Codex' })).toHaveAccessibleDescription(
      'Code generation'
    );
    expect(screen.queryByRole('button', { name: 'Claude' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search sessions'), {
      target: { value: 'Anthropic' },
    });

    expect(screen.getByRole('button', { name: 'Claude' })).toHaveAccessibleDescription(
      'Anthropic session'
    );
    expect(screen.queryByRole('button', { name: 'Codex' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search sessions'), {
      target: { value: 'automation' },
    });

    expect(screen.getByRole('button', { name: 'Codex' })).toHaveAccessibleDescription(
      'Code generation'
    );
    expect(screen.queryByRole('button', { name: 'Claude' })).not.toBeInTheDocument();
  });

  it('renders the create action from the current query when enabled', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();

    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Branch"
        searchable
        searchPlaceholder="Search branches"
        sections={[{ kind: 'options', id: 'branches', items: [] }]}
        create={{
          visible: true,
          label: (query) => `Create branch: ${query}`,
          onCreate,
        }}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Search branches'), {
      target: { value: 'feature/mobile-select' },
    });
    await user.click(screen.getByRole('button', { name: 'Create branch: feature/mobile-select' }));

    expect(onCreate).toHaveBeenCalledWith('feature/mobile-select');
  });

  it('keeps the sheet open when closeOnSelect is false', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Terminal Sessions"
        sections={[
          {
            kind: 'options',
            id: 'terminals',
            items: [{ id: 'term_1', label: 'Workspace Shell' }],
          },
        ]}
        closeOnSelect={false}
        onSelect={vi.fn()}
        onClose={onClose}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Workspace Shell' }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('represents disabled option, action, and create rows through the public API', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const onAction = vi.fn();
    const onCreate = vi.fn();

    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Branch"
        searchable
        searchPlaceholder="Search branches"
        sections={[
          {
            kind: 'actions',
            id: 'actions',
            items: [
              {
                id: 'refresh',
                label: 'Refresh',
                disabled: true,
                onAction,
              },
            ],
          },
          {
            kind: 'options',
            id: 'branches',
            items: [
              {
                id: 'main',
                label: 'main',
                description: 'Protected branch',
                disabled: true,
              },
            ],
          },
        ]}
        create={{
          visible: true,
          label: (query) => `Create branch: ${query}`,
          disabled: (query) => query.includes('main'),
          onCreate,
        }}
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Search branches'), {
      target: { value: 'main' },
    });

    const option = screen.getByRole('button', { name: 'main' });
    const action = screen.getByRole('button', { name: 'Refresh' });
    const create = screen.getByRole('button', { name: 'Create branch: main' });

    expect(option).toBeDisabled();
    expect(option).toHaveAccessibleDescription('Protected branch');
    expect(action).toBeDisabled();
    expect(create).toBeDisabled();

    await user.click(option);
    await user.click(action);
    await user.click(create);

    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('renders loading state separately from the empty state', () => {
    renderWithEnglishLocale(
      <MobileSelectSheet
        title="Branch"
        loading
        sections={[{ kind: 'options', id: 'branches', items: [] }]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
    expect(screen.queryByText('No results found')).not.toBeInTheDocument();
  });
});
