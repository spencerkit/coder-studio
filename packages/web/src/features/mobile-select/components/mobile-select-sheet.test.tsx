import { describe, expect, it, vi } from 'vitest';
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

describe('MobileSelectSheet', () => {
  it('renders option sections and highlights the selected item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

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
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('region', { name: 'Terminal Sessions sheet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Workspace Shell' })).toHaveAttribute(
      'data-selected',
      'true'
    );

    await user.click(screen.getByRole('button', { name: 'Workspace Shell 2' }));
    expect(onSelect).toHaveBeenCalledWith('term_2');
  });

  it('filters only option sections when searchable and keeps action rows visible', async () => {
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
              { id: 'sess_1', label: 'Claude' },
              { id: 'sess_2', label: 'Codex' },
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
    expect(screen.getByRole('button', { name: 'Codex' })).toBeInTheDocument();
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
});
