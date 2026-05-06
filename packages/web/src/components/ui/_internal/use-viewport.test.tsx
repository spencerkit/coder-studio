import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useViewport } from "./use-viewport";

type MediaListener = () => void;

const VIEWPORT_QUERY = "(max-width: 899px), (pointer: coarse)";

const createMatchMediaHarness = (initialMatches: boolean) => {
  let matches = initialMatches;
  const listeners = new Set<MediaListener>();

  const matchMedia = vi.fn((query: string) => ({
    matches,
    media: query,
    addEventListener: (_event: string, listener: MediaListener) => {
      listeners.add(listener);
    },
    removeEventListener: (_event: string, listener: MediaListener) => {
      listeners.delete(listener);
    },
    addListener: (listener: MediaListener) => {
      listeners.add(listener);
    },
    removeListener: (listener: MediaListener) => {
      listeners.delete(listener);
    },
    dispatchEvent: () => true,
  }));

  return {
    matchMedia,
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      for (const listener of listeners) {
        listener();
      }
    },
  };
};

const Probe = () => {
  return <div data-testid="viewport">{useViewport()}</div>;
};

describe("useViewport", () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("returns desktop when the combined viewport query does not match", () => {
    const harness = createMatchMediaHarness(false);
    window.matchMedia = harness.matchMedia as unknown as typeof window.matchMedia;

    render(<Probe />);

    expect(window.matchMedia).toHaveBeenCalledWith(VIEWPORT_QUERY);
    expect(screen.getByTestId("viewport")).toHaveTextContent("desktop");
  });

  it("returns mobile when the combined viewport query matches", () => {
    const harness = createMatchMediaHarness(true);
    window.matchMedia = harness.matchMedia as unknown as typeof window.matchMedia;

    render(<Probe />);

    expect(screen.getByTestId("viewport")).toHaveTextContent("mobile");
  });

  it("updates when the media query match changes", () => {
    const harness = createMatchMediaHarness(false);
    window.matchMedia = harness.matchMedia as unknown as typeof window.matchMedia;

    render(<Probe />);
    expect(screen.getByTestId("viewport")).toHaveTextContent("desktop");

    act(() => {
      harness.setMatches(true);
    });

    expect(screen.getByTestId("viewport")).toHaveTextContent("mobile");
  });

  it("cleans up listeners on unmount", () => {
    const removeEventListener = vi.fn();
    const listeners = new Set<MediaListener>();

    window.matchMedia = vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: (_event: string, listener: MediaListener) => {
        listeners.add(listener);
      },
      removeEventListener,
      addListener: (listener: MediaListener) => {
        listeners.add(listener);
      },
      removeListener: vi.fn(),
      dispatchEvent: () => true,
    })) as unknown as typeof window.matchMedia;

    const view = render(<Probe />);
    view.unmount();

    expect(removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });
});
