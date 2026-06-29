// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useShellUpdate } from "./use-shell-update";

declare global {
  interface Window {
    coderStudioDesktop?: {
      shellUpdate?: {
        getState(): Promise<unknown>;
        check(): Promise<unknown>;
        install(): Promise<unknown>;
        restartToApply(): Promise<void>;
        subscribe(listener: (state: unknown) => void): () => void;
      };
    };
  }
}

function createShellUpdateApi() {
  const listeners = new Set<(state: unknown) => void>();
  const api = {
    getState: vi.fn(async () => ({
      supported: true,
      currentVersion: "1.2.3",
      latestVersion: null,
      availability: "unknown",
      status: "idle",
      lastCheckedAt: null,
      errorSummary: null,
      releaseNotes: null,
    })),
    check: vi.fn(async () => ({
      supported: true,
      currentVersion: "1.2.3",
      latestVersion: "1.2.4",
      availability: "update_available",
      status: "idle",
      lastCheckedAt: 123,
      errorSummary: null,
      releaseNotes: "Bug fixes",
    })),
    install: vi.fn(async () => ({
      supported: true,
      currentVersion: "1.2.3",
      latestVersion: "1.2.4",
      availability: "downloaded",
      status: "ready_to_restart",
      lastCheckedAt: 123,
      errorSummary: null,
      releaseNotes: "Bug fixes",
    })),
    restartToApply: vi.fn(async () => {}),
    subscribe: vi.fn((listener: (state: unknown) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
  };

  return {
    api,
    emit(state: unknown) {
      for (const listener of listeners) {
        listener(state);
      }
    },
  };
}

describe("useShellUpdate", () => {
  afterEach(() => {
    delete window.coderStudioDesktop;
  });

  it("reports unavailable outside desktop mode", () => {
    const { result } = renderHook(() => useShellUpdate());

    expect(result.current.available).toBe(false);
    expect(result.current.state).toBeNull();
  });

  it("hydrates state and reacts to desktop bridge events", async () => {
    const { api, emit } = createShellUpdateApi();
    window.coderStudioDesktop = {
      shellUpdate: api,
    };

    const { result } = renderHook(() => useShellUpdate());

    await waitFor(() => {
      expect(result.current.available).toBe(true);
      expect(result.current.state?.currentVersion).toBe("1.2.3");
    });

    emit({
      supported: true,
      currentVersion: "1.2.3",
      latestVersion: "1.2.4",
      availability: "downloaded",
      status: "ready_to_restart",
      lastCheckedAt: 123,
      errorSummary: null,
      releaseNotes: "Bug fixes",
    });

    await waitFor(() => {
      expect(result.current.state?.status).toBe("ready_to_restart");
    });
  });

  it("runs desktop bridge actions", async () => {
    const { api } = createShellUpdateApi();
    window.coderStudioDesktop = {
      shellUpdate: api,
    };

    const { result } = renderHook(() => useShellUpdate());

    await waitFor(() => {
      expect(result.current.available).toBe(true);
    });

    await result.current.check();
    await result.current.install();
    await result.current.restartToApply();

    expect(api.check).toHaveBeenCalledTimes(1);
    expect(api.install).toHaveBeenCalledTimes(1);
    expect(api.restartToApply).toHaveBeenCalledTimes(1);
  });
});
