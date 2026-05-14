import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { lastViewedTargetAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { CommandResultError } from "../../../ws/client";
import { usePersistWorkspaceLastViewedTarget } from "./use-persist-workspace-last-viewed-target";

function wrapperFor(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}
describe("usePersistWorkspaceLastViewedTarget", () => {
  it("does not suppress a retry for the same target after a failed write", async () => {
    const store = createStore();
    const sendCommand = vi
      .fn()
      .mockRejectedValueOnce(
        new CommandResultError({
          code: "write_failed",
          message: "failed",
        })
      )
      .mockResolvedValueOnce({
        workspaceId: "ws-2",
        updatedAt: 11,
      });

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);
    store.set(lastViewedTargetAtom, null);

    const { result } = renderHook(() => usePersistWorkspaceLastViewedTarget(), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      await result.current({ workspaceId: "ws-2" });
    });

    await act(async () => {
      await result.current({ workspaceId: "ws-2" });
    });

    expect(sendCommand).toHaveBeenNthCalledWith(
      1,
      "workspace.lastViewedTarget.set",
      { workspaceId: "ws-2", sessionId: undefined },
      undefined
    );
    expect(sendCommand).toHaveBeenNthCalledWith(
      2,
      "workspace.lastViewedTarget.set",
      { workspaceId: "ws-2", sessionId: undefined },
      undefined
    );
  });
  it("does not roll back a newer target when an older write fails out of order", async () => {
    const store = createStore();
    const firstWrite = createDeferred<{ workspaceId: string; updatedAt: number }>();
    const secondWrite = createDeferred<{ workspaceId: string; updatedAt: number }>();
    const sendCommand = vi
      .fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockImplementationOnce(() => secondWrite.promise);

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);
    store.set(lastViewedTargetAtom, null);

    const { result } = renderHook(() => usePersistWorkspaceLastViewedTarget(), {
      wrapper: wrapperFor(store),
    });

    let firstRequest!: Promise<unknown>;
    let secondRequest!: Promise<unknown>;

    act(() => {
      firstRequest = result.current({ workspaceId: "ws-1" });
      secondRequest = result.current({ workspaceId: "ws-2" });
    });

    expect(store.get(lastViewedTargetAtom)?.workspaceId).toBe("ws-2");

    await act(async () => {
      secondWrite.resolve({ workspaceId: "ws-2", updatedAt: 22 });
      await secondRequest;
    });

    expect(store.get(lastViewedTargetAtom)?.workspaceId).toBe("ws-2");

    await act(async () => {
      firstWrite.reject(
        new CommandResultError({
          code: "write_failed",
          message: "failed",
        })
      );
      await firstRequest;
    });

    expect(store.get(lastViewedTargetAtom)?.workspaceId).toBe("ws-2");
  });

  it("does not overwrite a newer target when an older write succeeds out of order", async () => {
    const store = createStore();
    const firstWrite = createDeferred<{ workspaceId: string; updatedAt: number }>();
    const secondWrite = createDeferred<{ workspaceId: string; updatedAt: number }>();
    const sendCommand = vi
      .fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockImplementationOnce(() => secondWrite.promise);

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);
    store.set(lastViewedTargetAtom, null);

    const { result } = renderHook(() => usePersistWorkspaceLastViewedTarget(), {
      wrapper: wrapperFor(store),
    });

    let firstRequest!: Promise<unknown>;
    let secondRequest!: Promise<unknown>;

    act(() => {
      firstRequest = result.current({ workspaceId: "ws-1" });
      secondRequest = result.current({ workspaceId: "ws-2" });
    });

    await act(async () => {
      secondWrite.resolve({ workspaceId: "ws-2", updatedAt: 22 });
      await secondRequest;
    });

    expect(store.get(lastViewedTargetAtom)?.workspaceId).toBe("ws-2");

    await act(async () => {
      firstWrite.resolve({ workspaceId: "ws-1", updatedAt: 11 });
      await firstRequest;
    });

    expect(store.get(lastViewedTargetAtom)?.workspaceId).toBe("ws-2");
  });

  it("rolls back to the last confirmed target when overlapping writes both fail", async () => {
    const store = createStore();
    const firstWrite = createDeferred<{ workspaceId: string; updatedAt: number }>();
    const secondWrite = createDeferred<{ workspaceId: string; updatedAt: number }>();
    const sendCommand = vi
      .fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockImplementationOnce(() => secondWrite.promise);

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);
    store.set(lastViewedTargetAtom, {
      workspaceId: "ws-0",
      updatedAt: 1,
    });

    const { result } = renderHook(() => usePersistWorkspaceLastViewedTarget(), {
      wrapper: wrapperFor(store),
    });

    let firstRequest!: Promise<unknown>;
    let secondRequest!: Promise<unknown>;

    act(() => {
      firstRequest = result.current({ workspaceId: "ws-1" });
      secondRequest = result.current({ workspaceId: "ws-2" });
    });

    expect(store.get(lastViewedTargetAtom)?.workspaceId).toBe("ws-2");

    await act(async () => {
      firstWrite.reject(
        new CommandResultError({
          code: "write_failed",
          message: "failed",
        })
      );
      await firstRequest;
    });

    expect(store.get(lastViewedTargetAtom)?.workspaceId).toBe("ws-2");

    await act(async () => {
      secondWrite.reject(
        new CommandResultError({
          code: "write_failed",
          message: "failed",
        })
      );
      await secondRequest;
    });

    expect(store.get(lastViewedTargetAtom)?.workspaceId).toBe("ws-0");
  });

  it("rolls back to an older confirmed target when a newer overlapping write fails", async () => {
    const store = createStore();
    const firstWrite = createDeferred<{ workspaceId: string; updatedAt: number }>();
    const secondWrite = createDeferred<{ workspaceId: string; updatedAt: number }>();
    const sendCommand = vi
      .fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockImplementationOnce(() => secondWrite.promise);

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);
    store.set(lastViewedTargetAtom, {
      workspaceId: "ws-0",
      updatedAt: 1,
    });

    const { result } = renderHook(() => usePersistWorkspaceLastViewedTarget(), {
      wrapper: wrapperFor(store),
    });

    let firstRequest!: Promise<unknown>;
    let secondRequest!: Promise<unknown>;

    act(() => {
      firstRequest = result.current({ workspaceId: "ws-1" });
      secondRequest = result.current({ workspaceId: "ws-2" });
    });

    await act(async () => {
      firstWrite.resolve({ workspaceId: "ws-1", updatedAt: 11 });
      await firstRequest;
    });

    expect(store.get(lastViewedTargetAtom)?.workspaceId).toBe("ws-2");

    await act(async () => {
      secondWrite.reject(
        new CommandResultError({
          code: "write_failed",
          message: "failed",
        })
      );
      await secondRequest;
    });

    expect(store.get(lastViewedTargetAtom)?.workspaceId).toBe("ws-1");
  });
});
