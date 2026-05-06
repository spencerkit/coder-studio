import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toastsAtom } from "../../notifications/atoms";
import { usePasteDropUpload } from "./use-paste-drop-upload.js";

function makeWrapper(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

function makeFile(name: string, body = "x") {
  return new File([body], name, { type: "text/plain" });
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function fireDataTransferPaste(target: HTMLElement, files: File[]) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { files, types: files.length ? ["Files"] : [], items: [] },
  });
  target.dispatchEvent(event);
  return event;
}

function fireDrop(target: HTMLElement, files: File[]) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { files, types: files.length ? ["Files"] : [], items: [] },
  });
  target.dispatchEvent(event);
  return event;
}

function fireTextDrop(target: HTMLElement) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { files: [], types: ["text/plain"], items: [] },
  });
  target.dispatchEvent(event);
  return event;
}

describe("usePasteDropUpload", () => {
  let container: HTMLDivElement;
  let sendInput: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    sendInput = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          files: [{ path: "/abs/a.txt", originalName: "a.txt", size: 1 }],
        }),
      })
    );
  });

  afterEach(() => {
    container.remove();
    vi.unstubAllGlobals();
  });

  it("intercepts paste with files, uploads, and sends quoted path to terminal", async () => {
    const store = createStore();
    const { result } = renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    await act(async () => {
      const evt = fireDataTransferPaste(container, [makeFile("a.txt")]);
      expect(evt.defaultPrevented).toBe(true);
      await flushAsyncWork();
    });

    expect(sendInput).toHaveBeenCalledTimes(1);
    expect(sendInput.mock.calls[0]?.[0]).toBe("'/abs/a.txt' ");
    expect(store.get(toastsAtom)).toEqual([]);
    expect(result.current.busy).toBe(false);
  });

  it("falls through when paste has only text (no files)", () => {
    const store = createStore();
    renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    const evt = fireDataTransferPaste(container, []);
    expect(evt.defaultPrevented).toBe(false);
    expect(sendInput).not.toHaveBeenCalled();
  });

  it("handles drop with multiple files joined by space", async () => {
    const store = createStore();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          files: [
            { path: "/abs/a.txt", originalName: "a.txt", size: 1 },
            { path: "/abs/b file.txt", originalName: "b file.txt", size: 1 },
          ],
        }),
      })
    );

    renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    await act(async () => {
      fireDrop(container, [makeFile("a.txt"), makeFile("b file.txt")]);
      await flushAsyncWork();
    });

    expect(sendInput.mock.calls[0]?.[0]).toBe("'/abs/a.txt' '/abs/b file.txt' ");
  });

  it("falls through for non-file drop payloads", () => {
    const store = createStore();
    renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    const evt = fireTextDrop(container);
    expect(evt.defaultPrevented).toBe(false);
    expect(sendInput).not.toHaveBeenCalled();
  });

  it("keeps busy true until overlapping uploads both finish", async () => {
    const store = createStore();
    let resolveFirst: ((value: Response) => void) | undefined;
    let resolveSecond: ((value: Response) => void) | undefined;
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount += 1;
        return new Promise((resolve) => {
          if (callCount === 1) {
            resolveFirst = resolve as (value: Response) => void;
            return;
          }
          resolveSecond = resolve as (value: Response) => void;
        });
      })
    );

    const { result } = renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    await act(async () => {
      fireDataTransferPaste(container, [makeFile("a.txt")]);
      fireDrop(container, [makeFile("b.txt")]);
      await Promise.resolve();
    });

    expect(result.current.busy).toBe(true);

    await act(async () => {
      resolveFirst?.({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          files: [{ path: "/abs/a.txt", originalName: "a.txt", size: 1 }],
        }),
      } as Response);
      await flushAsyncWork();
    });

    expect(result.current.busy).toBe(true);

    await act(async () => {
      resolveSecond?.({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          files: [{ path: "/abs/b.txt", originalName: "b.txt", size: 1 }],
        }),
      } as Response);
      await flushAsyncWork();
    });

    expect(result.current.busy).toBe(false);
    expect(sendInput).toHaveBeenCalledTimes(2);
  });

  it("preserves terminal insertion order across overlapping uploads", async () => {
    const store = createStore();
    let resolveFirst: ((value: Response) => void) | undefined;
    let resolveSecond: ((value: Response) => void) | undefined;
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount += 1;
        return new Promise((resolve) => {
          if (callCount === 1) {
            resolveFirst = resolve as (value: Response) => void;
            return;
          }
          resolveSecond = resolve as (value: Response) => void;
        });
      })
    );

    renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    await act(async () => {
      fireDataTransferPaste(container, [makeFile("a.txt")]);
      fireDrop(container, [makeFile("b.txt")]);
      await Promise.resolve();
    });

    await act(async () => {
      resolveSecond?.({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          files: [{ path: "/abs/b.txt", originalName: "b.txt", size: 1 }],
        }),
      } as Response);
      await flushAsyncWork();
    });

    expect(sendInput).not.toHaveBeenCalled();

    await act(async () => {
      resolveFirst?.({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          files: [{ path: "/abs/a.txt", originalName: "a.txt", size: 1 }],
        }),
      } as Response);
      await flushAsyncWork();
    });

    expect(sendInput.mock.calls).toEqual([["'/abs/a.txt' "], ["'/abs/b.txt' "]]);
  });

  it("on upload error, does not send to terminal and pushes a toast", async () => {
    const store = createStore();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 413,
        json: async () => ({ ok: false, error: "file_too_large" }),
      })
    );

    const { result } = renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    await act(async () => {
      fireDataTransferPaste(container, [makeFile("big.bin")]);
      await flushAsyncWork();
    });

    expect(sendInput).not.toHaveBeenCalled();
    const toasts = store.get(toastsAtom);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      kind: "error",
      title: "Upload failed",
    });
    expect(toasts[0]?.body).toContain("file_too_large");
    expect(result.current.busy).toBe(false);
  });
});
