import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PageHeader } from './page-header';

describe('PageHeader', () => {
  it('keeps the back button and title grouped on the left while actions stay on the right', () => {
    render(
      <PageHeader
        title="Agent Sessions"
        backLabel="Back"
        onBack={vi.fn()}
        rightSlot={<button type="button">Edit</button>}
      />
    );

    const header = document.querySelector('.page-header');
    const leading = header?.querySelector('.page-header__leading');
    const actions = header?.querySelector('.page-header__actions');

    expect(leading).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(within(leading as HTMLElement).getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(within(leading as HTMLElement).getByText('Agent Sessions')).toBeInTheDocument();
    expect(within(actions as HTMLElement).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('renders the optional kicker above the left-aligned title copy', () => {
    render(
      <PageHeader title="Config" kicker="Workspace" backLabel="Back" onBack={vi.fn()} />
    );

    const copy = document.querySelector('.page-header__copy');

    expect(copy).not.toBeNull();
    expect(within(copy as HTMLElement).getByText('Workspace')).toBeInTheDocument();
    expect(within(copy as HTMLElement).getByText('Config')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });
});
