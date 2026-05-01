import { act, render, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { themeAtom } from '../../../atoms/app-ui';
import { MonacoHost } from './monaco-host';

const {
  mockCreateEditor,
  mockSetModelLanguage,
  mockSetTheme,
  mockEditorInstance,
  mockWorker,
} = vi.hoisted(() => {
  const mockEditorInstance = {
    dispose: vi.fn(),
    getModel: vi.fn(() => ({})),
    getValue: vi.fn(() => 'export const a = 1;'),
    onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
    setValue: vi.fn(),
  };

  return {
    mockCreateEditor: vi.fn(() => mockEditorInstance),
    mockSetModelLanguage: vi.fn(),
    mockSetTheme: vi.fn(),
    mockEditorInstance,
    mockWorker: class MockWorker {},
  };
});

vi.mock('monaco-editor', () => ({
  editor: {
    create: mockCreateEditor,
    setModelLanguage: mockSetModelLanguage,
    setTheme: mockSetTheme,
  },
}));

vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({ default: mockWorker }));
vi.mock('monaco-editor/esm/vs/language/css/css.worker?worker', () => ({ default: mockWorker }));
vi.mock('monaco-editor/esm/vs/language/html/html.worker?worker', () => ({ default: mockWorker }));
vi.mock('monaco-editor/esm/vs/language/json/json.worker?worker', () => ({ default: mockWorker }));
vi.mock('monaco-editor/esm/vs/language/typescript/ts.worker?worker', () => ({ default: mockWorker }));

describe('MonacoHost', () => {
  beforeEach(() => {
    mockCreateEditor.mockClear();
    mockSetModelLanguage.mockClear();
    mockSetTheme.mockClear();
    mockEditorInstance.dispose.mockClear();
    mockEditorInstance.getValue.mockClear();
    mockEditorInstance.setValue.mockClear();
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

    await waitFor(() => {
      expect(mockCreateEditor).toHaveBeenCalledWith(
        expect.any(HTMLDivElement),
        expect.objectContaining({
          language: 'typescript',
          theme: 'vs',
          value: 'export const a = 1;',
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
      expect(mockSetTheme).toHaveBeenCalledWith('vs');
    });
  });
});
