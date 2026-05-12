import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activationStatusAtom } from "../../atoms/activation";
import { authEnabledAtom } from "../../atoms/connection";
import { SessionGatePage } from "./session-gate";

const originalFetch = globalThis.fetch;
const originalLocation = window.location;

describe("SessionGatePage", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        replace: vi.fn(),
        reload: vi.fn(),
      },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("shows a password form when auth is enabled", () => {
    const store = createStore();
    store.set(authEnabledAtom, true);
    store.set(activationStatusAtom, "gated");

    render(
      <Provider store={store}>
        <MemoryRouter>
          <SessionGatePage />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByLabelText("密码")).toBeInTheDocument();
  });

  it("claims re-entry after successful login when auth is enabled", async () => {
    const requestReentry = vi.fn().mockResolvedValue(true);
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    }) as unknown as typeof fetch;

    const store = createStore();
    store.set(authEnabledAtom, true);
    store.set(activationStatusAtom, "gated");

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/session-gate"]}>
          <SessionGatePage requestReentry={requestReentry} />
        </MemoryRouter>
      </Provider>
    );

    const input = await screen.findByLabelText("密码");
    fireEvent.change(input, { target: { value: "sekrit" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(requestReentry).toHaveBeenCalledTimes(1);
    });
  });

  it("shows an explicit re-enter action when auth is disabled", async () => {
    const requestReentry = vi.fn().mockResolvedValue(true);
    const store = createStore();
    store.set(authEnabledAtom, false);
    store.set(activationStatusAtom, "gated");

    render(
      <Provider store={store}>
        <MemoryRouter>
          <SessionGatePage requestReentry={requestReentry} />
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "重新进入" }));

    await waitFor(() => {
      expect(requestReentry).toHaveBeenCalledTimes(1);
    });
  });

  it("reloads the app after successful re-entry when auth is disabled", async () => {
    const requestReentry = vi.fn().mockResolvedValue(true);
    const store = createStore();
    store.set(authEnabledAtom, false);
    store.set(activationStatusAtom, "gated");

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/session-gate"]}>
          <SessionGatePage requestReentry={requestReentry} />
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "重新进入" }));

    await waitFor(() => {
      expect(requestReentry).toHaveBeenCalledTimes(1);
      expect(window.location.replace).toHaveBeenCalledWith("/");
    });
  });
});
