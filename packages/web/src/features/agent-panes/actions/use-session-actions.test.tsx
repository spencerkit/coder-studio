import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../atoms/connection";
import { sessionsAtom } from "../../../atoms/sessions";
import { useSessionActions } from "./use-session-actions";

describe("useSessionActions", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes ended sessions directly without issuing session.stop", async () => {
    const store = createStore();
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "session.remove") {
        return undefined;
      }
      throw new Error(`Unexpected op: ${op}`);
    });

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);
    store.set(sessionsAtom, {
      "sess-1": {
        id: "sess-1",
        workspaceId: "ws-1",
        terminalId: "term-1",
        providerId: "codex",
        state: "ended",
        capability: "full",
        startedAt: 1,
        lastActiveAt: 1,
        endedAt: 2,
      },
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    const { result } = renderHook(() => useSessionActions(), { wrapper });

    await act(async () => {
      await result.current.closeSession("sess-1");
    });

    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(sendCommand).toHaveBeenCalledWith("session.remove", { sessionId: "sess-1" }, undefined);
  });

  it("closes running sessions even when window timers are unavailable", async () => {
    vi.useFakeTimers();

    const store = createStore();
    let resolveStop: (() => void) | undefined;
    const sendCommand = vi.fn((op: string) => {
      if (op === "session.stop") {
        return new Promise<void>((resolve) => {
          resolveStop = resolve;
        });
      }
      if (op === "session.remove") {
        return Promise.resolve(undefined);
      }
      throw new Error(`Unexpected op: ${op}`);
    });

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);
    store.set(sessionsAtom, {
      "sess-1": {
        id: "sess-1",
        workspaceId: "ws-1",
        terminalId: "term-1",
        providerId: "codex",
        state: "running",
        capability: "full",
        startedAt: 1,
        lastActiveAt: 1,
      },
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    const { result } = renderHook(() => useSessionActions(), { wrapper });
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });

    try {
      const closePromise = result.current.closeSession("sess-1");
      await Promise.resolve();
      resolveStop?.();
      await Promise.resolve();

      queueMicrotask(() => {
        store.set(sessionsAtom, {
          "sess-1": {
            id: "sess-1",
            workspaceId: "ws-1",
            terminalId: "term-1",
            providerId: "codex",
            state: "ended",
            capability: "full",
            startedAt: 1,
            lastActiveAt: 1,
            endedAt: 2,
          },
        });
      });

      await vi.advanceTimersByTimeAsync(100);
      await expect(closePromise).resolves.toBe(true);
    } finally {
      if (windowDescriptor) {
        Object.defineProperty(globalThis, "window", windowDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }

    expect(sendCommand).toHaveBeenNthCalledWith(
      1,
      "session.stop",
      { sessionId: "sess-1" },
      undefined
    );
    expect(sendCommand).toHaveBeenNthCalledWith(
      2,
      "session.remove",
      { sessionId: "sess-1" },
      undefined
    );
  });

  it("uses the atomic server close command for remove disposition", async () => {
    const store = createStore();
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "session.close") {
        return undefined;
      }
      throw new Error(`Unexpected op: ${op}`);
    });

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);
    store.set(sessionsAtom, {
      "sess-1": {
        id: "sess-1",
        workspaceId: "ws-1",
        terminalId: "term-1",
        providerId: "codex",
        state: "running",
        capability: "full",
        startedAt: 1,
        lastActiveAt: 1,
      },
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    const { result } = renderHook(() => useSessionActions(), { wrapper });

    await act(async () => {
      await result.current.closeSession("sess-1", "remove");
    });

    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(sendCommand).toHaveBeenCalledWith(
      "session.close",
      { sessionId: "sess-1", paneDisposition: "remove" },
      undefined
    );
  });
});
