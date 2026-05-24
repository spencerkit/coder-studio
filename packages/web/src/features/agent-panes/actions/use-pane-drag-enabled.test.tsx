import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePaneDragEnabled } from "./use-pane-drag-enabled";

type MediaListener = () => void;

const POINTER_QUERY = "(pointer: coarse)";

function createMatchMediaHarness(initialMatchesByQuery: Record<string, boolean>) {
  const listeners = new Map<string, Set<MediaListener>>();
  const matchesByQuery = new Map(Object.entries(initialMatchesByQuery));

  const matchMedia = vi.fn((query: string) => ({
    matches: matchesByQuery.get(query) ?? false,
    media: query,
    addEventListener: (_event: string, listener: MediaListener) => {
      const queryListeners = listeners.get(query) ?? new Set<MediaListener>();
      queryListeners.add(listener);
      listeners.set(query, queryListeners);
    },
    removeEventListener: (_event: string, listener: MediaListener) => {
      listeners.get(query)?.delete(listener);
    },
    addListener: (listener: MediaListener) => {
      const queryListeners = listeners.get(query) ?? new Set<MediaListener>();
      queryListeners.add(listener);
      listeners.set(query, queryListeners);
    },
    removeListener: (listener: MediaListener) => {
      listeners.get(query)?.delete(listener);
    },
    dispatchEvent: () => true,
  }));

  return {
    matchMedia,
    setMatches(query: string, nextMatches: boolean) {
      matchesByQuery.set(query, nextMatches);
      for (const listener of listeners.get(query) ?? []) {
        listener();
      }
    },
  };
}

const Probe = () => <div data-testid="pane-drag-enabled">{String(usePaneDragEnabled())}</div>;

describe("usePaneDragEnabled", () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("returns false on coarse pointer devices", () => {
    const harness = createMatchMediaHarness({
      [POINTER_QUERY]: true,
    });
    window.matchMedia = harness.matchMedia as unknown as typeof window.matchMedia;

    render(<Probe />);

    expect(window.matchMedia).toHaveBeenCalledWith(POINTER_QUERY);
    expect(screen.getByTestId("pane-drag-enabled")).toHaveTextContent("false");
  });

  it("returns true on fine pointer devices even if the window is narrow", () => {
    const harness = createMatchMediaHarness({
      [POINTER_QUERY]: false,
      "(max-width: 899px)": true,
    });
    window.matchMedia = harness.matchMedia as unknown as typeof window.matchMedia;

    render(<Probe />);

    expect(window.matchMedia).toHaveBeenCalledWith(POINTER_QUERY);
    expect(window.matchMedia).not.toHaveBeenCalledWith("(max-width: 899px)");
    expect(screen.getByTestId("pane-drag-enabled")).toHaveTextContent("true");
  });

  it("updates when the coarse pointer media query changes", () => {
    const harness = createMatchMediaHarness({
      [POINTER_QUERY]: false,
    });
    window.matchMedia = harness.matchMedia as unknown as typeof window.matchMedia;

    render(<Probe />);
    expect(screen.getByTestId("pane-drag-enabled")).toHaveTextContent("true");

    act(() => {
      harness.setMatches(POINTER_QUERY, true);
    });

    expect(screen.getByTestId("pane-drag-enabled")).toHaveTextContent("false");
  });
});
