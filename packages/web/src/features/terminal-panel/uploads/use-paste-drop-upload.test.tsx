import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_PATH_DRAG_MIME } from "../../../lib/workspace-path-drag";
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

function makeImageFile(name: string, type = "image/png", body = "img") {
  return new File([body], name, { type });
}

function makeClipboardItem(type: string, blob: Blob): ClipboardItem {
  return {
    types: [type],
    getType: vi.fn().mockResolvedValue(blob),
  } as unknown as ClipboardItem;
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

function fireWorkspacePathDragOver(
  target: HTMLElement,
  payload: { workspaceId: string; path: string; kind: "file" | "dir" }
) {
  const event = new Event("dragover", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files: [],
      types: [WORKSPACE_PATH_DRAG_MIME, "text/plain"],
      items: [],
      getData: (type: string) =>
        type === WORKSPACE_PATH_DRAG_MIME ? JSON.stringify(payload) : payload.path,
    },
  });
  target.dispatchEvent(event);
  return event;
}

function fireWorkspacePathDrop(
  target: HTMLElement,
  payload: { workspaceId: string; path: string; kind: "file" | "dir" }
) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files: [],
      types: [WORKSPACE_PATH_DRAG_MIME, "text/plain"],
      items: [],
      getData: (type: string) =>
        type === WORKSPACE_PATH_DRAG_MIME ? JSON.stringify(payload) : payload.path,
    },
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
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    sendInput = vi.fn().mockResolvedValue(undefined);
    createObjectURL = vi.fn().mockReturnValue("blob:preview-1");
    revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
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
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("intercepts paste with files, uploads, and sends quoted path to terminal", async () => {
    const store = createStore();
    const { result } = renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          terminalId: "terminal-1",
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

  it("collects pasted image files as pending previews and does not send terminal input", async () => {
    const store = createStore();
    const { result } = renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          terminalId: "terminal-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    await act(async () => {
      const evt = fireDataTransferPaste(container, [makeImageFile("paste.png")]);
      expect(evt.defaultPrevented).toBe(true);
      await flushAsyncWork();
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(sendInput).not.toHaveBeenCalled();
    expect(result.current.pendingImages).toHaveLength(1);
    expect(result.current.pendingImages[0]).toMatchObject({
      id: expect.any(String),
      file: expect.any(File),
      previewUrl: "blob:preview-1",
      name: "paste.png",
      type: "image/png",
    });
    expect(store.get(toastsAtom)).toEqual([]);
  });

  it("falls through when paste has only text (no files)", () => {
    const store = createStore();
    renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          terminalId: "terminal-1",
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
          terminalId: "terminal-1",
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

  it("collects image clipboard content through the explicit clipboard handler until upload is requested", async () => {
    const store = createStore();
    const clipboardRead = vi
      .fn()
      .mockResolvedValue([
        makeClipboardItem("image/png", new Blob(["img"], { type: "image/png" })),
      ]);
    const clipboardReadText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        read: clipboardRead,
        readText: clipboardReadText,
      } satisfies Pick<Clipboard, "readText"> & { read: () => Promise<ClipboardItem[]> },
    });

    const { result } = renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          terminalId: "terminal-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    await act(async () => {
      await result.current.handleClipboardPaste();
    });

    expect(clipboardRead).toHaveBeenCalledTimes(1);
    expect(clipboardReadText).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(sendInput).not.toHaveBeenCalled();
    expect(result.current.pendingImages).toHaveLength(1);
  });

  it("uploads pending images only when called and keeps previews for the submit owner", async () => {
    const store = createStore();
    createObjectURL.mockReturnValueOnce("blob:preview-1").mockReturnValueOnce("blob:preview-2");
    const { result } = renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          terminalId: "terminal-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    await act(async () => {
      result.current.collectPendingFiles([
        makeImageFile("a.png"),
        makeImageFile("b.png", "image/jpeg"),
      ]);
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.current.pendingImages).toHaveLength(2);

    let uploaded: Awaited<ReturnType<typeof result.current.uploadPendingImages>> = [];
    await act(async () => {
      uploaded = await result.current.uploadPendingImages();
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(sendInput).not.toHaveBeenCalled();
    expect(uploaded).toEqual([{ path: "/abs/a.txt", originalName: "a.txt", size: 1 }]);
    expect(result.current.pendingImages).toHaveLength(2);
    expect(result.current.pendingImages.map((image) => image.name)).toEqual(["a.png", "b.png"]);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("appends image previews when a second image paste is collected", async () => {
    const store = createStore();
    createObjectURL.mockReturnValueOnce("blob:preview-1").mockReturnValueOnce("blob:preview-2");
    const { result } = renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          terminalId: "terminal-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    await act(async () => {
      fireDataTransferPaste(container, [makeImageFile("first.png")]);
      await flushAsyncWork();
    });

    await act(async () => {
      fireDataTransferPaste(container, [makeImageFile("second.png")]);
      await flushAsyncWork();
    });

    expect(result.current.pendingImages).toHaveLength(2);
    expect(result.current.pendingImages.map((image) => image.name)).toEqual([
      "first.png",
      "second.png",
    ]);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("keeps pending image previews across transient unmounts for the same terminal", async () => {
    const store = createStore();
    createObjectURL.mockReturnValueOnce("blob:preview-1");
    const firstRender = renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          terminalId: "terminal-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    await act(async () => {
      firstRender.result.current.collectPendingFiles([makeImageFile("pane.png")]);
    });

    expect(firstRender.result.current.pendingImages).toHaveLength(1);

    firstRender.unmount();

    expect(revokeObjectURL).not.toHaveBeenCalled();

    const secondRender = renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          terminalId: "terminal-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    expect(secondRender.result.current.pendingImages).toHaveLength(1);
    expect(secondRender.result.current.pendingImages[0]).toMatchObject({
      name: "pane.png",
      previewUrl: "blob:preview-1",
    });
  });

  it("falls back to clipboard text when no clipboard files are available", async () => {
    const store = createStore();
    const clipboardRead = vi.fn().mockResolvedValue([]);
    const clipboardReadText = vi.fn().mockResolvedValue("ls -la");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        read: clipboardRead,
        readText: clipboardReadText,
      } satisfies Pick<Clipboard, "readText"> & { read: () => Promise<ClipboardItem[]> },
    });

    const { result } = renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          terminalId: "terminal-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    await act(async () => {
      await result.current.handleClipboardPaste();
    });

    expect(clipboardRead).toHaveBeenCalledTimes(1);
    expect(clipboardReadText).toHaveBeenCalledTimes(1);
    expect(sendInput).toHaveBeenCalledWith("ls -la");
  });

  it("keeps plain text insertion out of upload busy handling while pending", async () => {
    const store = createStore();
    const clipboardRead = vi.fn().mockResolvedValue([]);
    const clipboardReadText = vi.fn().mockResolvedValue("ls -la");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        read: clipboardRead,
        readText: clipboardReadText,
      } satisfies Pick<Clipboard, "readText"> & { read: () => Promise<ClipboardItem[]> },
    });
    let resolveSend: (() => void) | undefined;
    sendInput.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        })
    );

    const { result } = renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          terminalId: "terminal-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    const pastePromise = result.current.handleClipboardPaste();
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.busy).toBe(false);

    await act(async () => {
      resolveSend?.();
      await pastePromise;
    });
  });

  it("surfaces plain text send failures as paste errors, not upload errors", async () => {
    const store = createStore();
    const clipboardRead = vi.fn().mockResolvedValue([]);
    const clipboardReadText = vi.fn().mockResolvedValue("ls -la");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        read: clipboardRead,
        readText: clipboardReadText,
      } satisfies Pick<Clipboard, "readText"> & { read: () => Promise<ClipboardItem[]> },
    });
    sendInput.mockRejectedValueOnce(new Error("terminal write failed"));

    const { result } = renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          terminalId: "terminal-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    await act(async () => {
      await expect(result.current.handleClipboardPaste()).rejects.toThrow("terminal write failed");
      await flushAsyncWork();
    });

    expect(store.get(toastsAtom)).toContainEqual(
      expect.objectContaining({
        kind: "error",
        title: "Paste failed",
      })
    );
    expect(store.get(toastsAtom)).not.toContainEqual(
      expect.objectContaining({
        kind: "error",
        title: "Upload failed",
      })
    );
  });

  it("uploads files passed directly to the explicit file handler", async () => {
    const store = createStore();
    const { result } = renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          terminalId: "terminal-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    await act(async () => {
      await result.current.handleFiles([makeFile("a.txt")]);
    });

    expect(sendInput).toHaveBeenCalledWith("'/abs/a.txt' ");
  });

  it("keeps non-image files on the existing immediate upload path", async () => {
    const store = createStore();
    const { result } = renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          terminalId: "terminal-1",
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

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(sendInput).toHaveBeenCalledWith("'/abs/a.txt' ");
    expect(result.current.pendingImages).toEqual([]);
  });

  it("revokes pending preview urls when cleared", async () => {
    const store = createStore();
    createObjectURL.mockReturnValueOnce("blob:preview-1");
    const { result } = renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          terminalId: "terminal-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    await act(async () => {
      result.current.collectPendingFiles([makeImageFile("a.png")]);
    });

    await act(async () => {
      result.current.clearPendingImages();
    });

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
    expect(result.current.pendingImages).toEqual([]);
  });

  it("removes one pending image and only revokes that preview url", async () => {
    const store = createStore();
    createObjectURL.mockReturnValueOnce("blob:preview-1").mockReturnValueOnce("blob:preview-2");
    const { result } = renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          terminalId: "terminal-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    await act(async () => {
      result.current.collectPendingFiles([makeImageFile("a.png"), makeImageFile("b.png")]);
    });

    const firstId = result.current.pendingImages[0]?.id;
    expect(firstId).toBeTruthy();

    await act(async () => {
      result.current.removePendingImage(firstId!);
    });

    expect(result.current.pendingImages).toHaveLength(1);
    expect(result.current.pendingImages[0]?.name).toBe("b.png");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
    expect(revokeObjectURL).not.toHaveBeenCalledWith("blob:preview-2");
  });

  it("keeps images added during pending upload queued after that upload resolves", async () => {
    const store = createStore();
    let resolveUpload: ((value: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveUpload = resolve as (value: Response) => void;
          })
      )
    );
    createObjectURL.mockReturnValueOnce("blob:preview-1").mockReturnValueOnce("blob:preview-2");
    const { result } = renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          terminalId: "terminal-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    await act(async () => {
      result.current.collectPendingFiles([makeImageFile("a.png")]);
    });

    let uploadedPromise: Promise<unknown> | undefined;
    await act(async () => {
      uploadedPromise = result.current.uploadPendingImages();
      await Promise.resolve();
    });

    expect(result.current.busy).toBe(true);

    await act(async () => {
      result.current.collectPendingFiles([makeImageFile("b.png")]);
    });

    expect(result.current.pendingImages).toHaveLength(2);

    await act(async () => {
      resolveUpload?.({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          files: [{ path: "/abs/a.txt", originalName: "a.png", size: 1 }],
        }),
      } as Response);
      await uploadedPromise;
    });

    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(result.current.pendingImages).toHaveLength(2);
    expect(result.current.pendingImages.map((image) => image.name)).toEqual(["a.png", "b.png"]);
    expect(revokeObjectURL).not.toHaveBeenCalledWith("blob:preview-2");
  });

  it("falls through for non-file drop payloads", () => {
    const store = createStore();
    renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          terminalId: "terminal-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    const evt = fireTextDrop(container);
    expect(evt.defaultPrevented).toBe(false);
    expect(sendInput).not.toHaveBeenCalled();
  });

  it("prevents default for internal workspace drags and inserts a quoted relative path", async () => {
    const store = createStore();
    const { result } = renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          terminalId: "terminal-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    const dragOver = fireWorkspacePathDragOver(container, {
      workspaceId: "ws-1",
      path: "src/app.tsx",
      kind: "file",
    });
    expect(dragOver.defaultPrevented).toBe(true);

    await act(async () => {
      const drop = fireWorkspacePathDrop(container, {
        workspaceId: "ws-1",
        path: "src/app.tsx",
        kind: "file",
      });
      expect(drop.defaultPrevented).toBe(true);
      await flushAsyncWork();
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(sendInput).toHaveBeenCalledWith("'src/app.tsx' ");
    expect(result.current.busy).toBe(false);
  });

  it("keeps internal path insertion ordered behind earlier uploads", async () => {
    const store = createStore();
    let resolveUpload: ((value: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveUpload = resolve as (value: Response) => void;
          })
      )
    );

    renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          terminalId: "terminal-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    await act(async () => {
      fireDrop(container, [makeFile("upload.txt")]);
      fireWorkspacePathDrop(container, {
        workspaceId: "ws-1",
        path: "src/app.tsx",
        kind: "file",
      });
      await Promise.resolve();
    });

    expect(sendInput).not.toHaveBeenCalled();

    await act(async () => {
      resolveUpload?.({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          files: [{ path: "/abs/upload.txt", originalName: "upload.txt", size: 1 }],
        }),
      } as Response);
      await flushAsyncWork();
    });

    expect(sendInput.mock.calls).toEqual([["'/abs/upload.txt' "], ["'src/app.tsx' "]]);
  });

  it("rejects internal workspace drops from another workspace", async () => {
    const store = createStore();
    const { result } = renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          terminalId: "terminal-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    await act(async () => {
      fireWorkspacePathDrop(container, {
        workspaceId: "ws-2",
        path: "src/app.tsx",
        kind: "file",
      });
      await flushAsyncWork();
    });

    expect(sendInput).not.toHaveBeenCalled();
    expect(store.get(toastsAtom)).toContainEqual(
      expect.objectContaining({
        kind: "error",
        title: "Drop failed",
      })
    );
    expect(result.current.busy).toBe(false);
  });

  it("toasts when the internal workspace payload is invalid", async () => {
    const store = createStore();

    renderHook(
      () =>
        usePasteDropUpload({
          containerRef: { current: container },
          workspaceId: "ws-1",
          terminalId: "terminal-1",
          sendTextToTerminal: sendInput,
          enabled: true,
        }),
      { wrapper: makeWrapper(store) }
    );

    await act(async () => {
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", {
        value: {
          files: [],
          types: [WORKSPACE_PATH_DRAG_MIME, "text/plain"],
          items: [],
          getData: (type: string) =>
            type === WORKSPACE_PATH_DRAG_MIME ? "{bad json" : "src/app.tsx",
        },
      });
      container.dispatchEvent(event);
      await flushAsyncWork();
    });

    expect(sendInput).not.toHaveBeenCalled();
    expect(store.get(toastsAtom)).toContainEqual(
      expect.objectContaining({
        kind: "error",
        title: "Drop failed",
        body: "Could not read the dragged workspace path.",
      })
    );
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
          terminalId: "terminal-1",
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
          terminalId: "terminal-1",
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
          terminalId: "terminal-1",
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
