import { act, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { themeAtom } from '../../../atoms/ui';
import { MonacoHost } from './monaco-host';

const mockEditor = vi.fn();

vi.mock('@monaco-editor/react', () => ({
  default: (props: Record<string, unknown>) => {
    mockEditor(props);
    return <div data-testid="monaco-editor" />;
  },
}));

describe('MonacoHost', () => {
  beforeEach(() => {
    mockEditor.mockClear();
  });

  it('uses a light editor theme when ui theme is light', async () => {
    const store = createStore();
    store.set(themeAtom, 'light');

    render(
      <Provider store={store}>
        <MonacoHost
          workspaceId="ws-test"
          filePath="src/example.ts"
          content="export const a = 1;"
        />
      </Provider>
    );

    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockEditor).toHaveBeenLastCalledWith(
        expect.objectContaining({
          theme: 'vs',
        })
      );
    });
  });

  it('updates the editor theme when the ui theme changes', async () => {
    const store = createStore();

    render(
      <Provider store={store}>
        <MonacoHost
          workspaceId="ws-test"
          filePath="src/example.ts"
          content="export const a = 1;"
        />
      </Provider>
    );

    await act(async () => {
      store.set(themeAtom, 'light');
    });

    await waitFor(() => {
      expect(mockEditor).toHaveBeenLastCalledWith(
        expect.objectContaining({
          theme: 'vs',
        })
      );
    });
  });
});
