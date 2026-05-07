import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticatedAtom, localeAtom } from "../../atoms/app-ui";
import { authEnabledAtom } from "../../atoms/connection";
import { LoginPage } from "./index";

const originalFetch = globalThis.fetch;
const viewportMocks = vi.hoisted(() => ({
  viewport: "desktop" as "desktop" | "mobile",
}));

vi.mock("../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

describe("LoginPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    viewportMocks.viewport = "desktop";
    window.localStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders the shared card layout while auth status is loading", async () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as typeof fetch;

    render(
      <Provider>
        <LoginPage />
      </Provider>
    );

    expect(document.querySelector(".welcome-container")).toBeTruthy();
    expect(document.querySelector(".welcome-card")).toBeTruthy();
    expect(document.querySelector(".auth-form")).toBeTruthy();
    expect(document.querySelector(".auth-status-panel")).toBeTruthy();
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getAllByText("连接中").length).toBeGreaterThan(0);
  });

  it("renders the password field with a dedicated hint when auth is available", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ authEnabled: true, authenticated: false }),
    }) as unknown as typeof fetch;

    render(
      <Provider>
        <LoginPage />
      </Provider>
    );

    await screen.findByPlaceholderText("密码");

    expect(screen.getByText("输入密码后继续进入当前工作区。")).toBeInTheDocument();
    expect(screen.getByText("请输入当前部署配置的访问密码。")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("密码")).toHaveClass("input", "auth-input");
  });

  it("marks the user authenticated when auth is disabled on the server", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ authEnabled: false, authenticated: true }),
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

  it("shows unavailable messaging when auth status cannot be loaded", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;

    render(
      <Provider>
        <LoginPage />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getAllByText("不可用").length).toBeGreaterThan(0);
      expect(document.querySelector(".auth-status-panel.auth-status-panel-error")).toBeTruthy();
    });
  });

  it("submits the password and marks the user authenticated after a successful login", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    }) as unknown as typeof fetch;

    const store = createStore();
    store.set(authEnabledAtom, true);

    render(
      <Provider store={store}>
        <LoginPage />
      </Provider>
    );

    const input = await screen.findByPlaceholderText("密码");
    fireEvent.change(input, { target: { value: "sekrit" } });
    expect(input).toHaveValue("sekrit");
    expect(screen.getByRole("button", { name: "确认" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/auth/login",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ password: "sekrit" }),
        })
      );
      expect(store.get(authenticatedAtom)).toBe(true);
    });
  });

  it("shows the login error returned by the server", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Wrong password" }),
    }) as unknown as typeof fetch;

    const store = createStore();
    store.set(authEnabledAtom, true);

    render(
      <Provider store={store}>
        <LoginPage />
      </Provider>
    );

    const input = await screen.findByPlaceholderText("密码");
    fireEvent.change(input, { target: { value: "bad" } });
    expect(input).toHaveValue("bad");
    expect(screen.getByRole("button", { name: "确认" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Wrong password")).toBeInTheDocument();
      expect(document.querySelector(".auth-status-panel.auth-status-panel-error")).toBeTruthy();
    });
  });

  it("shows a clear retry time when login is blocked after too many failures", async () => {
    const blockedUntil = new Date("2026-05-05T12:00:00.000Z").getTime();
    const expectedBlockedUntil = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(blockedUntil);

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: "Too many failed attempts",
        blocked: true,
        blockedUntil,
      }),
    }) as unknown as typeof fetch;

    const store = createStore();
    store.set(authEnabledAtom, true);

    render(
      <Provider store={store}>
        <LoginPage />
      </Provider>
    );

    const input = await screen.findByPlaceholderText("密码");
    fireEvent.change(input, { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(
        screen.getByText(`尝试次数过多，请于 ${expectedBlockedUntil} 后再试，或联系管理员解禁。`)
      ).toBeInTheDocument();
      expect(document.querySelector(".auth-status-panel.auth-status-panel-error")).toBeTruthy();
    });
  });

  it("shows the blocked fallback message when blockedUntil is missing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: "Too many failed attempts",
        blocked: true,
      }),
    }) as unknown as typeof fetch;

    const store = createStore();
    store.set(authEnabledAtom, true);

    render(
      <Provider store={store}>
        <LoginPage />
      </Provider>
    );

    const input = await screen.findByPlaceholderText("密码");
    fireEvent.change(input, { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(screen.getByText("尝试次数过多，请稍后再试，或联系管理员解禁。")).toBeInTheDocument();
    });
  });

  it("renders the blocked message in english when the locale is en", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: "Too many failed attempts",
        blocked: true,
        blockedUntil: new Date("2026-05-05T12:00:00.000Z").getTime(),
      }),
    }) as unknown as typeof fetch;

    const store = createStore();
    store.set(authEnabledAtom, true);
    store.set(localeAtom, "en");

    render(
      <Provider store={store}>
        <LoginPage />
      </Provider>
    );

    const input = await screen.findByPlaceholderText("Password");
    fireEvent.change(input, { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          (content) =>
            content.startsWith("Too many attempts. Try again after ") &&
            content.endsWith(", or ask an administrator to unblock access.")
        )
      ).toBeInTheDocument();
    });
  });

  it("adds the mobile auth page variant classes on mobile viewports", async () => {
    viewportMocks.viewport = "mobile";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ authEnabled: true, authenticated: false }),
    }) as unknown as typeof fetch;

    render(
      <Provider>
        <LoginPage />
      </Provider>
    );

    await screen.findByPlaceholderText("密码");

    expect(document.querySelector(".welcome-container--mobile")).toBeTruthy();
    expect(document.querySelector(".auth-screen--mobile")).toBeTruthy();
    expect(document.querySelector(".auth-card-shell--mobile")).toBeTruthy();
  });

  it("marks the user authenticated when the server already has a valid session cookie", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ authEnabled: true, authenticated: true }),
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
});
