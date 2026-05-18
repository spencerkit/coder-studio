import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../atoms/app-ui";
import { WelcomePage } from "./index";

const viewportMocks = vi.hoisted(() => ({
  viewport: "desktop" as "desktop" | "mobile",
}));

vi.mock("../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

vi.mock("../workspace/views/shared/workspace-launch-modal", () => ({
  WorkspaceLaunchModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="workspace-launch-modal">
      <button type="button" onClick={onClose}>
        Close modal
      </button>
    </div>
  ),
}));

describe("WelcomePage", () => {
  beforeEach(() => {
    viewportMocks.viewport = "desktop";
  });

  it("opens the workspace launch modal directly from the primary action", () => {
    const store = createStore();
    store.set(localeAtom, "en");

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WelcomePage />
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Workspace" }));

    expect(screen.getByTestId("workspace-launch-modal")).toBeInTheDocument();
  });

  it("navigates to settings from the secondary action", () => {
    const store = createStore();
    store.set(localeAtom, "en");

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<WelcomePage />} />
            <Route path="/settings" element={<div>Settings Screen</div>} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByText("Settings Screen")).toBeInTheDocument();
  });

  it("adds the mobile welcome page variant classes on mobile viewports", () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WelcomePage />
        </MemoryRouter>
      </Provider>
    );

    expect(document.querySelector(".welcome-container--mobile")).toBeTruthy();
    expect(document.querySelector(".welcome-card--mobile")).toBeTruthy();
    expect(document.querySelector(".welcome-card.welcome-card--mobile")).toBeTruthy();
  });

  it("renders translated English copy when locale is set to en", () => {
    const store = createStore();
    store.set(localeAtom, "en");

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WelcomePage />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByText("DEPLOY ONCE, CODE EVERYWHERE")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Welcome to Coder Studio" })).toBeInTheDocument();
    expect(document.querySelector(".welcome-card__hero")).toBeTruthy();
    expect(document.querySelector(".welcome-card__actions")).toBeTruthy();
    expect(document.querySelector(".welcome-card__features")).toBeTruthy();
    expect(document.querySelector(".welcome-actions-group")).toBeTruthy();
    const openWorkspaceButton = screen.getByRole("button", { name: "Open Workspace" });
    const settingsButton = screen.getByRole("button", { name: "Settings" });
    const featureCards = Array.from(document.querySelectorAll(".welcome-feature"));

    expect(featureCards).toHaveLength(3);
    expect(
      openWorkspaceButton.querySelector('[data-icon-semantic="nav.newWorkspace"]')
    ).toBeTruthy();
    expect(settingsButton.querySelector('[data-icon-semantic="nav.settings"]')).toBeTruthy();
    expect(
      featureCards.some((card) =>
        card.querySelector('[data-icon-semantic="state.welcome.lightning"]')
      )
    ).toBe(true);
    expect(
      featureCards.some((card) => card.querySelector('[data-icon-semantic="state.welcome.git"]'))
    ).toBe(true);
    expect(
      featureCards.some((card) =>
        card.querySelector('[data-icon-semantic="state.welcome.terminal"]')
      )
    ).toBe(true);
  });

  it("renders the flat welcome shell with hero, actions, and features sections", () => {
    const store = createStore();
    store.set(localeAtom, "en");

    const { container } = render(
      <Provider store={store}>
        <MemoryRouter>
          <WelcomePage />
        </MemoryRouter>
      </Provider>
    );

    expect(container.querySelector(".welcome-card__hero")).toBeTruthy();
    expect(container.querySelector(".welcome-card__actions")).toBeTruthy();
    expect(container.querySelector(".welcome-card__features")).toBeTruthy();
    expect(container.querySelector(".welcome-actions-group")).toBeTruthy();
    expect(container.querySelector(".welcome-card__panel")).toBeFalsy();
  });
});
