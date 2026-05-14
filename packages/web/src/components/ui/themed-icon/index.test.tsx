import { render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it } from "vitest";
import { themeAtom } from "../../../atoms/app-ui";
import { ThemedIcon } from ".";

describe("ThemedIcon", () => {
  it("renders the resolved icon with stable tone and surface classes", () => {
    const store = createStore();
    store.set(themeAtom, "mint-dark");

    render(
      <Provider store={store}>
        <ThemedIcon semantic="state.warning" size={16} />
      </Provider>
    );

    const icon = screen.getByTestId("themed-icon");
    expect(icon).toHaveAttribute("data-icon-semantic", "state.warning");
    expect(icon).toHaveClass(
      "themed-icon",
      "themed-icon--tone-warning",
      "themed-icon--surface-warning"
    );
    expect(icon.querySelector("svg")).toBeInTheDocument();
  });

  it("omits announcement for decorative icons", () => {
    const store = createStore();
    store.set(themeAtom, "mint-dark");

    render(
      <Provider store={store}>
        <ThemedIcon semantic="nav.settings" />
      </Provider>
    );

    expect(screen.getByTestId("themed-icon")).toHaveAttribute("aria-hidden", "true");
  });

  it("reads the active theme and applies theme-specific presentation overrides", () => {
    const store = createStore();
    store.set(themeAtom, "hc-dark");

    render(
      <Provider store={store}>
        <ThemedIcon semantic="file.folder.closed" size={18} />
      </Provider>
    );

    const icon = screen.getByTestId("themed-icon");
    const svg = icon.querySelector("svg");

    expect(icon).toHaveClass("themed-icon--tone-warning", "themed-icon--surface-none");
    expect(svg).toHaveAttribute("stroke-width", "2.25");
    expect(svg).toHaveAttribute("width", "18");
    expect(svg).toHaveAttribute("height", "18");
  });

  it("allows semantic icons to participate in accessibility when decorative is false", () => {
    const store = createStore();
    store.set(themeAtom, "mint-dark");

    render(
      <Provider store={store}>
        <ThemedIcon aria-label="Workspace warning" decorative={false} semantic="state.warning" />
      </Provider>
    );

    const icon = screen.getByLabelText("Workspace warning");

    expect(icon).toHaveAttribute("role", "img");
    expect(icon).not.toHaveAttribute("aria-hidden");
  });
});
