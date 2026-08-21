import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShellEntry } from "./shell-entry";

vi.mock("./desktop-shell", () => ({
  DesktopShell: () => <div data-testid="desktop-shell">DesktopShell</div>,
}));

vi.mock("./mobile-shell", () => ({
  MobileShell: () => <div data-testid="mobile-shell">MobileShell</div>,
}));

function setMatchMediaMock(predicate: (query: string) => boolean) {
  const matchMedia = vi.fn((query: string) => ({
    addEventListener: vi.fn(),
    matches: predicate(query),
    media: query,
    removeEventListener: vi.fn(),
  }));
  window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
}

describe("ShellEntry", () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("renders DesktopShell on a wide viewport with fine pointer", async () => {
    setMatchMediaMock(() => false);

    render(<ShellEntry />);

    expect(await screen.findByTestId("desktop-shell")).toBeInTheDocument();
    expect(screen.queryByTestId("mobile-shell")).not.toBeInTheDocument();
  });

  it("renders MobileShell when viewport is narrow", async () => {
    setMatchMediaMock((query) => query.includes("max-width: 899px"));

    render(<ShellEntry />);

    expect(await screen.findByTestId("mobile-shell")).toBeInTheDocument();
    expect(screen.queryByTestId("desktop-shell")).not.toBeInTheDocument();
  });

  it("renders MobileShell on wide coarse-pointer devices", async () => {
    setMatchMediaMock((query) => query.includes("pointer: coarse"));

    render(<ShellEntry />);

    expect(await screen.findByTestId("mobile-shell")).toBeInTheDocument();
    expect(screen.queryByTestId("desktop-shell")).not.toBeInTheDocument();
  });
});
