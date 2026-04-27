import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider, createStore } from 'jotai';
import { LoginPage } from './index';
import { authenticatedAtom } from '../../atoms/ui';

const originalFetch = globalThis.fetch;

describe('LoginPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renders the shared card layout while auth status is loading', async () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as typeof fetch;

    render(
      <Provider>
        <LoginPage />
      </Provider>
    );

    expect(document.querySelector('.welcome-container')).toBeTruthy();
    expect(document.querySelector('.welcome-card')).toBeTruthy();
    expect(document.querySelector('.auth-form')).toBeTruthy();
    expect(document.querySelector('.auth-status-panel')).toBeTruthy();
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getAllByText('连接中').length).toBeGreaterThan(0);
  });

  it('renders the password field with a dedicated hint when auth is available', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ authEnabled: true }),
    }) as unknown as typeof fetch;

    render(
      <Provider>
        <LoginPage />
      </Provider>
    );

    await screen.findByPlaceholderText('密码');

    expect(screen.getByText('输入密码后继续进入当前工作区。')).toBeInTheDocument();
    expect(screen.getByText('请输入当前部署配置的访问密码。')).toBeInTheDocument();
  });

  it('marks the user authenticated when auth is disabled on the server', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ authEnabled: false }),
    }) as unknown as typeof fetch;

    const store = createStore();

    render(
      <Provider store={store}>
        <LoginPage />
      </Provider>
    );

    await waitFor(() => {
      expect(store.get(authenticatedAtom)).toBe(true);
    });
  });

  it('shows unavailable messaging when auth status cannot be loaded', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

    render(
      <Provider>
        <LoginPage />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getAllByText('不可用').length).toBeGreaterThan(0);
      expect(document.querySelector('.auth-status-panel.auth-status-panel-error')).toBeTruthy();
    });
  });

  it('submits the password and marks the user authenticated after a successful login', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ authEnabled: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      }) as unknown as typeof fetch;

    const user = userEvent.setup();
    const store = createStore();

    render(
      <Provider store={store}>
        <LoginPage />
      </Provider>
    );

    const input = await screen.findByPlaceholderText('密码');
    await user.type(input, 'sekrit');
    await user.click(screen.getByRole('button', { name: '确认' }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenNthCalledWith(
        2,
        '/auth/login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ password: 'sekrit' }),
        })
      );
      expect(store.get(authenticatedAtom)).toBe(true);
    });
  });

  it('shows the login error returned by the server', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ authEnabled: true }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Wrong password' }),
      }) as unknown as typeof fetch;

    const user = userEvent.setup();

    render(
      <Provider>
        <LoginPage />
      </Provider>
    );

    const input = await screen.findByPlaceholderText('密码');
    await user.type(input, 'bad');
    await user.click(screen.getByRole('button', { name: '确认' }));

    await waitFor(() => {
      expect(screen.getByText('Wrong password')).toBeInTheDocument();
      expect(document.querySelector('.auth-status-panel.auth-status-panel-error')).toBeTruthy();
    });
  });
});
