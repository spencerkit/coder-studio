import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activationStatusAtom } from "../../atoms/activation";
import { authEnabledAtom } from "../../atoms/connection";
import { SessionGatePage } from "./session-gate";

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
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("shows the session gate action even when auth is enabled", () => {
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

    expect(screen.queryByLabelText("密码")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新进入" })).toBeInTheDocument();
  });

  it("shows an explicit re-enter action when auth is disabled", () => {
    const store = createStore();
    store.set(authEnabledAtom, false);
    store.set(activationStatusAtom, "gated");

    render(
      <Provider store={store}>
        <MemoryRouter>
          <SessionGatePage />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByRole("button", { name: "重新进入" })).toBeInTheDocument();
  });

  it("returns to the app bootstrap entry when re-enter is clicked", async () => {
    const store = createStore();
    store.set(authEnabledAtom, false);
    store.set(activationStatusAtom, "gated");

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/session-gate"]}>
          <SessionGatePage />
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "重新进入" }));

    await waitFor(() => {
      expect(window.location.replace).toHaveBeenCalledWith("/");
    });
  });
});
