// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../atoms/app-ui";
import { NotFoundPage } from "./index";

const viewportMocks = vi.hoisted(() => ({
  viewport: "desktop" as "desktop" | "mobile",
}));

vi.mock("../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

describe("NotFoundPage", () => {
  beforeEach(() => {
    viewportMocks.viewport = "desktop";
  });

  it("uses the shared empty-state shell while preserving the missing pathname details", () => {
    const store = createStore();
    store.set(localeAtom, "en");

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/missing/path"]}>
          <Routes>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    expect(document.querySelector(".welcome-container")).toBeTruthy();
    expect(document.querySelector(".welcome-card")).toBeTruthy();
    expect(document.querySelector(".welcome-card__panel")).toBeTruthy();
    expect(document.querySelector(".welcome-card__panel .auth-status-panel")).toBeTruthy();
    expect(screen.getByText("Requested path")).toBeInTheDocument();
    expect(screen.getByText("/missing/path")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });

  it("navigates home from the primary action", () => {
    const store = createStore();
    store.set(localeAtom, "en");

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/missing/path"]}>
          <Routes>
            <Route path="*" element={<NotFoundPage />} />
            <Route path="/" element={<div>Home Screen</div>} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Go Home" }));

    expect(screen.getByText("Home Screen")).toBeInTheDocument();
  });
});
