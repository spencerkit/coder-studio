import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { WorkspaceFullscreenButton } from "./workspace-fullscreen-button";

const viewportMocks = vi.hoisted(() => ({
  value: "desktop" as "desktop" | "mobile",
}));

vi.mock("../../../components/ui/_internal/use-viewport", () => ({
  useViewport: () => viewportMocks.value,
}));

function renderWithEnglish(ui: React.ReactElement) {
  const store = createStore();
  store.set(localeAtom, "en");

  return render(<Provider store={store}>{ui}</Provider>);
}

describe("WorkspaceFullscreenButton", () => {
  it("renders the fullscreen control even when the controller reports unsupported", () => {
    renderWithEnglish(
      <WorkspaceFullscreenButton
        controller={{
          supported: false,
          isFullscreen: false,
          enterFullscreen: vi.fn(),
          toggleFullscreen: vi.fn(),
          exitFullscreen: vi.fn(),
        }}
        className="topbar-btn"
        iconSize={14}
      />
    );

    expect(screen.getByRole("button", { name: "Enter Fullscreen" })).toBeInTheDocument();
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

    const button = screen.getByRole("button", { name: "Enter Fullscreen" });
    expect(button).toHaveClass("btn", "btn-ghost", "topbar-btn");
    expect(button).not.toHaveAttribute("title");

    fireEvent.mouseEnter(button);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Enter Fullscreen");

    fireEvent.click(button);

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

  it("renders nothing when no fullscreen controller is provided", () => {
    const { container } = renderWithEnglish(
      <WorkspaceFullscreenButton controller={undefined} className="topbar-btn" iconSize={14} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("does not render tooltip overlays on mobile/coarse viewports", () => {
    viewportMocks.value = "mobile";

    renderWithEnglish(
      <WorkspaceFullscreenButton
        controller={{
          supported: true,
          isFullscreen: false,
          enterFullscreen: vi.fn(),
          exitFullscreen: vi.fn(),
          toggleFullscreen: vi.fn(),
        }}
        className="topbar-btn"
        iconSize={14}
      />
    );

    const button = screen.getByRole("button", { name: "Enter Fullscreen" });
    fireEvent.mouseEnter(button);
    fireEvent.focus(button);

    expect(screen.queryByRole("tooltip")).toBeNull();
    viewportMocks.value = "desktop";
  });
});
