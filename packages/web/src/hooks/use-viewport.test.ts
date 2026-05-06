import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useViewport } from "./use-viewport";

const VIEWPORT_QUERY = "(max-width: 899px), (pointer: coarse)";

describe("useViewport compatibility re-export", () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("keeps wide coarse-pointer devices on the mobile branch through the legacy import path", () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === VIEWPORT_QUERY,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));

    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useViewport());

    expect(matchMedia).toHaveBeenCalledWith(VIEWPORT_QUERY);
    expect(result.current).toBe("mobile");
  });
});
