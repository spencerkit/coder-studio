import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { WorkspaceFullscreenButton } from "./workspace-fullscreen-button";

function renderWithEnglish(ui: React.ReactElement) {
  const store = createStore();
  store.set(localeAtom, "en");

  return render(<Provider store={store}>{ui}</Provider>);
}

describe("WorkspaceFullscreenButton", () => {
  it("renders nothing when fullscreen is unsupported", () => {
    const { container } = renderWithEnglish(
      <WorkspaceFullscreenButton
        controller={{
          supported: false,
          isFullscreen: false,
          enterFullscreen: vi.fn(),
          exitFullscreen: vi.fn(),
          toggleFullscreen: vi.fn(),
        }}
        className="topbar-btn"
        iconSize={14}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders enter state and calls toggle", () => {
    const toggleFullscreen = vi.fn();

    renderWithEnglish(
      <WorkspaceFullscreenButton
        controller={{
          supported: true,
          isFullscreen: false,
          enterFullscreen: vi.fn(),
          exitFullscreen: vi.fn(),
          toggleFullscreen,
        }}
        className="topbar-btn"
        iconSize={14}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Enter Fullscreen" }));

    expect(toggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it("switches to exit state when fullscreen is active", () => {
    renderWithEnglish(
      <WorkspaceFullscreenButton
        controller={{
          supported: true,
          isFullscreen: true,
          enterFullscreen: vi.fn(),
          exitFullscreen: vi.fn(),
          toggleFullscreen: vi.fn(),
        }}
        className="topbar-btn"
        iconSize={14}
      />
    );

    expect(screen.getByRole("button", { name: "Exit Fullscreen" })).toBeInTheDocument();
  });
});
