import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { Sheet } from "..";

function renderWithLocale(node: ReactNode, locale: "en" | "zh" = "en") {
  const store = createStore();
  store.set(localeAtom, locale);

  return render(<Provider store={store}>{node}</Provider>);
}

describe("Sheet", () => {
  it("renders the shared mobile sheet chrome with footer", () => {
    renderWithLocale(
      <Sheet
        title="Quick Actions"
        kicker="COMMAND PALETTE"
        body={<div>Body</div>}
        footer={<button type="button">Done</button>}
        onClose={vi.fn()}
      />
    );

    expect(document.querySelector(".mobile-sheet-layer")).toBeTruthy();
    expect(document.querySelector(".mobile-sheet")).toBeTruthy();
    expect(document.querySelector(".mobile-sheet__header")).toBeTruthy();
    expect(document.querySelector(".mobile-sheet__body")).toBeTruthy();
    expect(document.querySelector(".mobile-sheet__footer")).toBeTruthy();
    expect(screen.getByText("Body")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("closes from the backdrop and uses the localized region label", () => {
    const onClose = vi.fn();

    renderWithLocale(
      <Sheet title="Quick Actions" body={<div>Body</div>} onClose={onClose} />,
      "en"
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss current sheet" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("region", { name: "Quick Actions sheet" })).toBeInTheDocument();
  });

  it("prefers onBack over onClose and falls back to onClose when onBack is absent", () => {
    const onBack = vi.fn();
    const onClose = vi.fn();

    const { rerender } = renderWithLocale(
      <Sheet title="Quick Actions" body={<div>Body</div>} onBack={onBack} onClose={onClose} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    rerender(
      <Provider
        store={(() => {
          const store = createStore();
          store.set(localeAtom, "en");
          return store;
        })()}
      >
        <Sheet title="Quick Actions" body={<div>Body</div>} onClose={onClose} />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("suppresses the handle in fullscreen mode and preserves caller compatibility classes", () => {
    renderWithLocale(
      <Sheet
        title="Open Workspace"
        body={<div>Body</div>}
        onClose={vi.fn()}
        fullscreen
        bodyClassName="mobile-sheet__body--flush mobile-sheet__body--fullscreen mobile-launch-sheet"
        contentClassName="mobile-sheet--launch"
      />
    );

    expect(document.querySelector(".mobile-sheet--fullscreen")).toBeTruthy();
    expect(document.querySelector(".mobile-sheet--launch")).toBeTruthy();
    expect(document.querySelector(".mobile-sheet__body--flush")).toBeTruthy();
    expect(document.querySelector(".mobile-sheet__body--fullscreen")).toBeTruthy();
    expect(document.querySelector(".mobile-launch-sheet")).toBeTruthy();
    expect(document.querySelector(".mobile-sheet__handle")).toBeNull();
  });
});
