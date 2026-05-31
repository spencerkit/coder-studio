/**
 * XtermHost Component Tests
 *
 * Unit tests for the xterm.js terminal rendering component.
 */

import { Topics } from "@coder-studio/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appearancePersonalizationAtom, localeAtom, themeAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { JotaiProvider } from "../../../test-utils/jotai-provider";
import { getThemeById } from "../../../theme";
import {
  CommandResultError,
  type TerminalReplayPayload,
  type TerminalSnapshotPayload,
} from "../../../ws/client";
import { toastsAtom } from "../../notifications/atoms";
import { terminalMetaAtomFamily, terminalOutputAtomFamily } from "../atoms";
import type { HydrationRequestHandle, HydrationTier } from "../hydration-coordinator";
import { DEFAULT_TERMINAL_FONT_SIZE, terminalPreferencesAtom } from "../preferences";
import { createRecoveryCoordinator } from "../recovery-coordinator";
import {
  getGlobalRecoveryCoordinator,
  resetGlobalRecoveryCoordinator,
  setGlobalRecoveryCoordinator,
} from "../recovery-singleton";
import { TERMINAL_REPLAY_TIMEOUT_MS } from "../replay-state";
import { trimWrittenChunks, XtermHost } from "../views/shared/xterm-host";

const viewportMocks = vi.hoisted(() => ({
  viewport: "desktop" as "desktop" | "mobile",
}));

const hydrationCoordinatorMocks = vi.hoisted(() => {
  let currentHandle: HydrationRequestHandle | null = null;
  return {
    request: vi.fn((req: { terminalId: string; tier: HydrationTier }) => {
      const listeners = new Set<(position: number) => void>();
      let resolveGranted = () => {};
      const granted = new Promise<void>((resolve) => {
        resolveGranted = resolve;
      });
      currentHandle = {
        granted,
        isGranted: hydrationCoordinatorMocks.autoGrant,
        promote: vi.fn(),
        release: vi.fn(),
        subscribePosition: vi.fn((callback: (position: number) => void) => {
          listeners.add(callback);
          return () => {
            listeners.delete(callback);
          };
        }),
      };
      hydrationCoordinatorMocks.lastRequest = req;
      hydrationCoordinatorMocks.listeners = listeners;
      hydrationCoordinatorMocks.resolveGranted = resolveGranted;
      if (hydrationCoordinatorMocks.autoGrant) {
        resolveGranted();
      }
      return currentHandle;
    }),
    autoGrant: true,
    lastRequest: null as { terminalId: string; tier: HydrationTier } | null,
    listeners: new Set<(position: number) => void>(),
    resolveGranted: (() => {}) as () => void,
    emitQueuePosition(position: number) {
      for (const listener of hydrationCoordinatorMocks.listeners) {
        listener(position);
      }
    },
    currentHandle() {
      return currentHandle;
    },
  };
});

const uploadHookMocks = vi.hoisted(() => ({
  busy: false,
  handleClipboardPaste: vi.fn().mockResolvedValue(undefined),
  handleFiles: vi.fn().mockResolvedValue(undefined),
}));

const baseRequestAnimationFrame = global.requestAnimationFrame;
const baseCancelAnimationFrame = global.cancelAnimationFrame;
const baseResizeObserver = global.ResizeObserver;

const clipboardHelperMocks = vi.hoisted(() => ({
  copyTextWithFallback: vi.fn(),
}));

vi.mock("../../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

vi.mock("../../../lib/clipboard", async () => {
  const actual =
    await vi.importActual<typeof import("../../../lib/clipboard")>("../../../lib/clipboard");

  clipboardHelperMocks.copyTextWithFallback.mockImplementation((text: string) =>
    actual.copyTextWithFallback(text)
  );

  return {
    ...actual,
    copyTextWithFallback: clipboardHelperMocks.copyTextWithFallback,
  };
});

vi.mock("../hydration-coordinator", async () => {
  const actual = await vi.importActual<typeof import("../hydration-coordinator")>(
    "../hydration-coordinator"
  );
  return {
    ...actual,
    globalHydrationCoordinator: {
      request: hydrationCoordinatorMocks.request,
      inspect: vi.fn(() => ({ running: [], queued: [] })),
    },
  };
});

vi.mock("../uploads/use-paste-drop-upload", () => ({
  usePasteDropUpload: vi.fn(() => ({
    busy: uploadHookMocks.busy,
    handleClipboardPaste: uploadHookMocks.handleClipboardPaste,
    handleFiles: uploadHookMocks.handleFiles,
  })),
}));

function expectReplayCall(mock: ReturnType<typeof vi.fn>, terminalId: string, lastSeq: number) {
  expect(mock).toHaveBeenCalledWith(
    "terminal.replay",
    {
      terminalId,
      lastSeq,
    },
    {
      timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS,
    }
  );
}

function expectSnapshotCall(mock: ReturnType<typeof vi.fn>, terminalId: string) {
  expect(mock).toHaveBeenCalledWith(
    "terminal.snapshot",
    {
      terminalId,
    },
    {
      timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS,
    }
  );
}

function expectResizeCall(
  mock: ReturnType<typeof vi.fn>,
  terminalId: string,
  cols: number,
  rows: number
) {
  expect(mock).toHaveBeenCalledWith(
    "terminal.resize",
    {
      terminalId,
      cols,
      rows,
    },
    undefined
  );
}

function expectTerminalWriteData(data: Uint8Array | string) {
  expect(mockTerminal.write.mock.calls.some(([written]) => written === data)).toBe(true);
}

function expectAppliedTerminalTheme(theme: unknown, themeId: string) {
  const expectedTheme = getThemeById(themeId).terminalTheme;

  expect(theme).toEqual(
    expect.objectContaining({
      background: "#00000000",
      foreground: expectedTheme.foreground,
      cursor: expectedTheme.cursor,
    })
  );
}

interface MockBufferLine {
  isWrapped?: boolean;
  translateToString(trimRight?: boolean): string;
}

const mockBufferLines = new Map<number, MockBufferLine>();

function createMockBufferLine(text: string, isWrapped = false): MockBufferLine {
  return {
    isWrapped,
    translateToString(trimRight = false) {
      return trimRight ? text.replace(/\s+$/u, "") : text;
    },
  };
}

function setMockBufferLines(entries: Array<[row: number, text: string, isWrapped?: boolean]>) {
  mockBufferLines.clear();
  for (const [row, text, isWrapped = false] of entries) {
    mockBufferLines.set(row, createMockBufferLine(text, isWrapped));
  }
}

function dispatchTouchEvent(
  target: EventTarget,
  type: string,
  touches: Array<{ identifier: number; clientX?: number; clientY: number; target?: EventTarget }>,
  changedTouches = touches
) {
  const normalizedTouches = touches.map((touch) => ({ ...touch, target: touch.target ?? target }));
  const normalizedChangedTouches = changedTouches.map((touch) => ({
    ...touch,
    target: touch.target ?? target,
  }));
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: normalizedTouches });
  Object.defineProperty(event, "targetTouches", { value: normalizedTouches });
  Object.defineProperty(event, "changedTouches", { value: normalizedChangedTouches });
  target.dispatchEvent(event);
}

function createMockDomRect({
  x,
  y,
  width,
  height,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
}): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function stubRowsGeometry(
  host: HTMLDivElement,
  rowsElement: HTMLDivElement,
  rowElements: HTMLDivElement[],
  options: {
    hostRect?: { x: number; y: number; width: number; height: number };
    rowsRect: { x: number; y: number; width: number; height: number };
    rowHeight: number;
    screenRect?: { x: number; y: number; width: number; height: number };
  }
) {
  vi.spyOn(host, "getBoundingClientRect").mockReturnValue(
    createMockDomRect(
      options.hostRect ?? { x: 0, y: 0, width: options.rowsRect.width, height: 240 }
    )
  );
  rowsElement.getBoundingClientRect = () => createMockDomRect(options.rowsRect);
  rowElements.forEach((rowElement, index) => {
    rowElement.getBoundingClientRect = () =>
      createMockDomRect({
        x: options.rowsRect.x,
        y: options.rowsRect.y + index * options.rowHeight,
        width: options.rowsRect.width,
        height: options.rowHeight,
      });
  });

  if (options.screenRect) {
    const screenElement = host.querySelector(".xterm-screen");
    if (screenElement instanceof HTMLDivElement) {
      screenElement.getBoundingClientRect = () => createMockDomRect(options.screenRect!);
    }
  }
}

const mockTerminal = {
  open: vi.fn(),
  onData: vi.fn(() => vi.fn()), // Return dispose function
  onBinary: vi.fn(() => vi.fn()),
  onResize: vi.fn(() => vi.fn()),
  onRender: vi.fn(() => vi.fn()),
  onSelectionChange: vi.fn(() => vi.fn()),
  attachCustomKeyEventHandler: vi.fn(),
  hasSelection: vi.fn(() => false),
  getSelection: vi.fn(() => ""),
  input: vi.fn(),
  write: vi.fn(),
  writeln: vi.fn(),
  scrollLines: vi.fn(),
  reset: vi.fn(),
  dispose: vi.fn(),
  focus: vi.fn(),
  loadAddon: vi.fn(),
  cols: 80,
  buffer: {
    active: {
      viewportY: 0,
      baseY: 0,
      getLine: vi.fn((row: number) => mockBufferLines.get(row)),
    },
  },
  parser: {
    registerOscHandler: vi.fn(() => ({ dispose: vi.fn() })),
  },
  options: {},
};

const mockFitAddon = {
  fit: vi.fn(),
};

const textEncoder = new TextEncoder();

// Mock xterm.js modules
vi.mock("@xterm/xterm", () => {
  return {
    Terminal: vi.fn(function (options?: Record<string, unknown>) {
      mockTerminal.options = { ...(options ?? {}) };
      return mockTerminal;
    }),
  };
});

vi.mock("@xterm/addon-fit", () => {
  return {
    FitAddon: vi.fn(function () {
      return mockFitAddon;
    }),
  };
});

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn().mockImplementation(function () {}),
}));

describe("XtermHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGlobalRecoveryCoordinator();
    window.localStorage.clear();
    viewportMocks.viewport = "desktop";
    hydrationCoordinatorMocks.autoGrant = true;
    hydrationCoordinatorMocks.lastRequest = null;
    hydrationCoordinatorMocks.listeners = new Set();
    hydrationCoordinatorMocks.resolveGranted = () => {};
    uploadHookMocks.busy = false;
    uploadHookMocks.handleClipboardPaste.mockReset();
    uploadHookMocks.handleClipboardPaste.mockResolvedValue(undefined);
    uploadHookMocks.handleFiles.mockReset();
    uploadHookMocks.handleFiles.mockResolvedValue(undefined);
    clipboardHelperMocks.copyTextWithFallback.mockClear();
    mockTerminal.options = {};
    mockTerminal.cols = undefined;
    mockTerminal.rows = undefined;
    mockTerminal.buffer.active.viewportY = 0;
    mockTerminal.buffer.active.baseY = 0;
    mockBufferLines.clear();
    mockTerminal.buffer.active.getLine.mockImplementation((row: number) =>
      mockBufferLines.get(row)
    );
    mockTerminal.write.mockImplementation((_data: Uint8Array | string, callback?: () => void) => {
      callback?.();
    });
    mockTerminal.onRender.mockImplementation(() => vi.fn());
    mockTerminal.input.mockImplementation(() => {});
    mockTerminal.writeln.mockImplementation(() => {});
    mockTerminal.reset.mockImplementation(() => {});
    mockTerminal.scrollLines.mockImplementation((amount: number) => {
      const nextViewportY = mockTerminal.buffer.active.viewportY + amount;
      mockTerminal.buffer.active.viewportY = Math.max(
        0,
        Math.min(mockTerminal.buffer.active.baseY, nextViewportY)
      );
    });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        ready: Promise.resolve(),
      },
    });
  });

  afterEach(() => {
    resetGlobalRecoveryCoordinator();
    vi.useRealTimers();
    global.requestAnimationFrame = baseRequestAnimationFrame;
    global.cancelAnimationFrame = baseCancelAnimationFrame;
    global.ResizeObserver = baseResizeObserver;
    vi.restoreAllMocks();
  });

  it("does not crash on unmount when terminal disposal fails", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockTerminal.dispose.mockImplementationOnce(() => {
      throw new Error("dispose failed");
    });

    const { unmount } = render(
      <JotaiProvider>
        <XtermHost terminalId="test-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    expect(() => unmount()).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith("Failed to dispose xterm instance:", expect.any(Error));
  });

  it("does not crash on unmount when onSelectionChange returns a disposable object", () => {
    mockTerminal.onSelectionChange.mockImplementationOnce(() => ({
      dispose: vi.fn(),
    }));

    const { unmount } = render(
      <JotaiProvider>
        <XtermHost terminalId="selection-disposable-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    expect(() => unmount()).not.toThrow();
  });

  it("renders without crashing", () => {
    const { container } = render(
      <JotaiProvider>
        <XtermHost terminalId="test-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    // Check that the xterm-host container is rendered
    const hostContainer = container.querySelector(".xterm-host");
    expect(hostContainer).toBeTruthy();
  });

  it("copies the terminal selection on desktop pointerup when copy-on-select is enabled", async () => {
    const store = createStore();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const clipboard = {
      writeText,
    } satisfies Pick<Clipboard, "writeText">;

    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, {
      copyOnSelect: true,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: clipboard,
    });

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="copy-enabled-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    mockTerminal.hasSelection.mockReturnValue(true);
    mockTerminal.getSelection.mockReturnValue("selected text");

    const selectionHandler = mockTerminal.onSelectionChange.mock.calls[0]?.[0] as
      | (() => void)
      | undefined;

    await act(async () => {
      selectionHandler?.();
    });

    fireEvent.pointerDown(container.querySelector(".xterm-host")!, {
      pointerType: "mouse",
      pointerId: 1,
    });
    fireEvent.pointerUp(container.querySelector(".xterm-host")!, {
      pointerType: "mouse",
      pointerId: 1,
    });

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("selected text");
      expect(clipboardHelperMocks.copyTextWithFallback).toHaveBeenCalledWith("selected text");
    });
  });

  it("falls back to document.execCommand when desktop clipboard writeText is rejected", async () => {
    const store = createStore();
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard rejected"));
    const execCommand = vi.fn().mockReturnValue(true);

    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, {
      copyOnSelect: true,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText } satisfies Pick<Clipboard, "writeText">,
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="copy-fallback-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    mockTerminal.hasSelection.mockReturnValue(true);
    mockTerminal.getSelection.mockReturnValue("selected text");

    const selectionHandler = mockTerminal.onSelectionChange.mock.calls[0]?.[0] as
      | (() => void)
      | undefined;

    await act(async () => {
      selectionHandler?.();
    });

    fireEvent.pointerDown(container.querySelector(".xterm-host")!, {
      pointerType: "mouse",
      pointerId: 1,
    });
    fireEvent.pointerUp(container.querySelector(".xterm-host")!, {
      pointerType: "mouse",
      pointerId: 1,
    });

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("selected text");
      expect(execCommand).toHaveBeenCalledWith("copy");
    });
  });

  it("copies the terminal selection when desktop mouse pointerup ends outside the host", async () => {
    const store = createStore();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const clipboard = {
      writeText,
    } satisfies Pick<Clipboard, "writeText">;

    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, {
      copyOnSelect: true,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: clipboard,
    });

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="copy-outside-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    mockTerminal.hasSelection.mockReturnValue(true);
    mockTerminal.getSelection.mockReturnValue("selected text");

    const selectionHandler = mockTerminal.onSelectionChange.mock.calls[0]?.[0] as
      | (() => void)
      | undefined;

    await act(async () => {
      selectionHandler?.();
    });

    fireEvent.pointerDown(container.querySelector(".xterm-host")!, {
      pointerType: "mouse",
      pointerId: 1,
    });
    fireEvent.pointerUp(document.body, { pointerType: "mouse", pointerId: 1 });

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("selected text");
    });
  });

  it("does not copy on desktop when a stale tracked mouse pointerId is reused outside the host", async () => {
    const store = createStore();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const clipboard = {
      writeText,
    } satisfies Pick<Clipboard, "writeText">;

    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, {
      copyOnSelect: true,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: clipboard,
    });

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="copy-stale-pointer-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    mockTerminal.hasSelection.mockReturnValue(true);
    mockTerminal.getSelection.mockReturnValue("selected text");

    const selectionHandler = mockTerminal.onSelectionChange.mock.calls[0]?.[0] as
      | (() => void)
      | undefined;

    await act(async () => {
      selectionHandler?.();
    });

    fireEvent.pointerDown(container.querySelector(".xterm-host")!, {
      pointerType: "mouse",
      pointerId: 1,
    });

    fireEvent.pointerDown(document.body, {
      pointerType: "mouse",
      pointerId: 1,
    });
    fireEvent.pointerUp(document.body, {
      pointerType: "mouse",
      pointerId: 1,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(writeText).not.toHaveBeenCalled();
  });

  it("does not copy when copy-on-select is disabled", async () => {
    const store = createStore();
    const writeText = vi.fn().mockResolvedValue(undefined);

    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, {
      copyOnSelect: false,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText } satisfies Pick<Clipboard, "writeText">,
    });

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="copy-disabled-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    mockTerminal.hasSelection.mockReturnValue(true);
    mockTerminal.getSelection.mockReturnValue("selected text");

    const selectionHandler = mockTerminal.onSelectionChange.mock.calls[0]?.[0] as
      | (() => void)
      | undefined;

    await act(async () => {
      selectionHandler?.();
    });

    fireEvent.pointerUp(container.querySelector(".xterm-host")!);

    await waitFor(() => {
      expect(writeText).not.toHaveBeenCalled();
    });
  });

  it("does not copy on mobile even when the preference is enabled", async () => {
    viewportMocks.viewport = "mobile";

    const store = createStore();
    const writeText = vi.fn().mockResolvedValue(undefined);

    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, {
      copyOnSelect: true,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText } satisfies Pick<Clipboard, "writeText">,
    });

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="copy-mobile-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    mockTerminal.hasSelection.mockReturnValue(true);
    mockTerminal.getSelection.mockReturnValue("selected text");

    const selectionHandler = mockTerminal.onSelectionChange.mock.calls[0]?.[0] as
      | (() => void)
      | undefined;

    await act(async () => {
      selectionHandler?.();
    });

    fireEvent.pointerUp(container.querySelector(".xterm-host")!);

    await waitFor(() => {
      expect(writeText).not.toHaveBeenCalled();
    });
  });

  it("does not copy on desktop for touch or pen pointerup events", async () => {
    const store = createStore();
    const writeText = vi.fn().mockResolvedValue(undefined);

    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, {
      copyOnSelect: true,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText } satisfies Pick<Clipboard, "writeText">,
    });

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="copy-pointer-type-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    mockTerminal.hasSelection.mockReturnValue(true);
    mockTerminal.getSelection.mockReturnValue("selected text");

    const selectionHandler = mockTerminal.onSelectionChange.mock.calls[0]?.[0] as
      | (() => void)
      | undefined;

    await act(async () => {
      selectionHandler?.();
    });

    await act(async () => {
      fireEvent.pointerUp(container.querySelector(".xterm-host")!, { pointerType: "touch" });
      fireEvent.pointerUp(container.querySelector(".xterm-host")!, { pointerType: "pen" });
      await Promise.resolve();
    });

    expect(writeText).not.toHaveBeenCalled();
  });

  it("pushes only one error toast within the throttle window when clipboard writes fail", async () => {
    const store = createStore();
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard failed"));
    const execCommand = vi.fn().mockReturnValue(false);

    store.set(localeAtom, "zh");
    store.set(terminalPreferencesAtom, {
      copyOnSelect: true,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText } satisfies Pick<Clipboard, "writeText">,
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="copy-error-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    mockTerminal.hasSelection.mockReturnValue(true);
    mockTerminal.getSelection.mockReturnValue("selected text");

    const selectionHandler = mockTerminal.onSelectionChange.mock.calls[0]?.[0] as
      | (() => void)
      | undefined;

    await act(async () => {
      selectionHandler?.();
    });

    fireEvent.pointerUp(container.querySelector(".xterm-host")!);
    fireEvent.pointerUp(container.querySelector(".xterm-host")!);

    await waitFor(() => {
      expect(store.get(toastsAtom)).toHaveLength(1);
    });
    expect(store.get(toastsAtom)[0]).toMatchObject({
      kind: "error",
      title: "自动复制失败",
    });
  });

  it("shows upload overlay and disables stdin while an upload is pending", async () => {
    uploadHookMocks.busy = true;

    render(
      <JotaiProvider>
        <XtermHost terminalId="upload-busy-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    expect(screen.getByText("上传中...")).toBeInTheDocument();
    expect(document.querySelector(".local-overlay")).toBeTruthy();
    expect(document.querySelector(".terminal-upload-overlay")).toBeTruthy();
    expect(document.querySelector(".paste-dialog-overlay")).toBeNull();
    await waitFor(() => {
      expect(mockTerminal.options).toEqual(
        expect.objectContaining({
          disableStdin: true,
          cursorBlink: false,
        })
      );
    });
  });

  it("re-enables stdin when the upload busy state clears", async () => {
    uploadHookMocks.busy = true;

    const { rerender } = render(
      <JotaiProvider>
        <XtermHost terminalId="upload-toggle-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    await waitFor(() => {
      expect(mockTerminal.options).toEqual(
        expect.objectContaining({
          disableStdin: true,
        })
      );
    });

    uploadHookMocks.busy = false;
    rerender(
      <JotaiProvider>
        <XtermHost terminalId="upload-toggle-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    await waitFor(() => {
      expect(screen.queryByText("上传中...")).not.toBeInTheDocument();
      expect(mockTerminal.options).toEqual(
        expect.objectContaining({
          disableStdin: false,
          cursorBlink: true,
        })
      );
    });
  });

  it("lets the browser handle keyboard paste shortcuts instead of sending Ctrl+V to the PTY", () => {
    render(
      <JotaiProvider>
        <XtermHost terminalId="paste-shortcut-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    expect(mockTerminal.attachCustomKeyEventHandler).toHaveBeenCalledTimes(1);

    const handler = mockTerminal.attachCustomKeyEventHandler.mock.calls[0]?.[0] as
      | ((event: KeyboardEvent) => boolean)
      | undefined;

    expect(handler).toBeTypeOf("function");
    expect(handler?.(new KeyboardEvent("keydown", { key: "v", code: "KeyV", ctrlKey: true }))).toBe(
      false
    );
    expect(handler?.(new KeyboardEvent("keydown", { key: "v", code: "KeyV", metaKey: true }))).toBe(
      false
    );
    expect(handler?.(new KeyboardEvent("keydown", { key: "c", code: "KeyC", ctrlKey: true }))).toBe(
      true
    );
  });

  it("shows a restoring overlay only after the initial recovery exceeds the grace delay", async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.snapshot") {
        return new Promise(() => {});
      }

      return Promise.resolve({ status: "ok" });
    });
    const subscribe = vi.fn(() => vi.fn());
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(localeAtom, "zh");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="loading-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText("正在恢复终端内容…")).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1199);
    });

    expect(screen.queryByText("正在恢复终端内容…")).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(screen.getByText("正在恢复终端内容…")).toBeInTheDocument();
    expect(
      screen.getByText(
        "恢复期间暂时无法使用当前终端；请耐心等待，历史内容恢复完成后再继续。内容较多时可能需要更久。"
      )
    ).toBeInTheDocument();
    expect(document.querySelector(".local-overlay")).toBeTruthy();
    expect(document.querySelector(".xterm-replay-overlay")).toBeTruthy();

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
    vi.useRealTimers();
  });

  it("does not show a restoring overlay when recovery finishes within the grace delay", async () => {
    const store = createStore();
    const snapshotBytes = new TextEncoder().encode("hello");
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.snapshot") {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              status: "ok",
              transport: "binary",
              streamId: 7,
              size: 5,
              seq: 5,
              rows: 24,
              cols: 80,
              bytes: snapshotBytes,
            });
          }, 800);
        });
      }

      return Promise.resolve({ status: "ok" });
    });
    const subscribe = vi.fn(() => vi.fn());
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(localeAtom, "zh");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="fast-recovery-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText("正在恢复终端内容…")).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(800);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expectTerminalWriteData(snapshotBytes);
    expect(screen.queryByText("正在恢复终端内容…")).not.toBeInTheDocument();
    expect(document.querySelector(".xterm-replay-overlay")).toBeFalsy();

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
    vi.useRealTimers();
  });

  it("queues desktop hydration before creating xterm and shows queue placeholder copy", async () => {
    hydrationCoordinatorMocks.autoGrant = false;
    const store = createStore();
    const sendCommand = vi.fn().mockResolvedValue({ status: "ok" });

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="queued-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      hydrationCoordinatorMocks.emitQueuePosition(2);
    });

    expect(hydrationCoordinatorMocks.request).toHaveBeenCalledWith({
      terminalId: "queued-terminal",
      tier: "visible-other",
    });
    expect(screen.getByText("Waiting in queue (2 ahead)")).toBeInTheDocument();
    expect(screen.queryByText("Restoring terminal output...")).not.toBeInTheDocument();

    const { Terminal } = await import("@xterm/xterm");
    expect(Terminal).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalledWith(
      "terminal.replay",
      expect.anything(),
      expect.anything()
    );
  });

  it("switches queue placeholder copy to up next when promoted to the head of the line", async () => {
    hydrationCoordinatorMocks.autoGrant = false;
    const store = createStore();

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="up-next-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      hydrationCoordinatorMocks.emitQueuePosition(1);
    });
    expect(screen.getByText("Waiting in queue (1 ahead)")).toBeInTheDocument();

    await act(async () => {
      hydrationCoordinatorMocks.emitQueuePosition(0);
    });
    expect(screen.getByText("Up next...")).toBeInTheDocument();
  });

  it("does not promote read-only terminals to focused on pointer interaction", async () => {
    hydrationCoordinatorMocks.autoGrant = false;
    const store = createStore();

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="readonly-terminal" workspaceId="test-workspace" readOnly />
      </Provider>
    );

    const host = container.querySelector(".xterm-host");
    expect(host).not.toBeNull();

    fireEvent.mouseDown(host!);

    expect(hydrationCoordinatorMocks.currentHandle()?.promote).not.toHaveBeenCalledWith("focused");
  });

  it("uses the latest ui theme when a queued terminal is granted later", async () => {
    hydrationCoordinatorMocks.autoGrant = false;
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(themeAtom, "mint-dark");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockImplementation((op: string) => {
        if (op === "terminal.replay") {
          return new Promise(() => {});
        }

        return Promise.resolve({ ok: true, data: { status: "ok" } });
      }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="queued-theme-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      store.set(themeAtom, "mint-light");
    });

    await act(async () => {
      hydrationCoordinatorMocks.resolveGranted();
      await Promise.resolve();
      await Promise.resolve();
    });

    const { Terminal } = await import("@xterm/xterm");
    expect(Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: expect.objectContaining({
          background: "#00000000",
        }),
      })
    );
    const lastTheme = vi.mocked(Terminal).mock.calls.at(-1)?.[0]?.theme;
    expectAppliedTerminalTheme(lastTheme, "mint-light");
  });

  it("promotes the existing hydration request when active session changes", async () => {
    const store = createStore();

    const { rerender } = render(
      <Provider store={store}>
        <XtermHost
          terminalId="active-toggle-terminal"
          workspaceId="test-workspace"
          isActiveSession={false}
        />
      </Provider>
    );

    const firstHandle = hydrationCoordinatorMocks.currentHandle();
    expect(firstHandle).not.toBeNull();
    expect(hydrationCoordinatorMocks.request).toHaveBeenCalledTimes(1);

    rerender(
      <Provider store={store}>
        <XtermHost
          terminalId="active-toggle-terminal"
          workspaceId="test-workspace"
          isActiveSession
        />
      </Provider>
    );

    expect(hydrationCoordinatorMocks.request).toHaveBeenCalledTimes(1);
    expect(firstHandle?.release).not.toHaveBeenCalled();
    expect(firstHandle?.promote).toHaveBeenCalledWith("visible-active");

    const { Terminal } = await import("@xterm/xterm");
    expect(Terminal).toHaveBeenCalledTimes(1);
  });

  it("bypasses hydration queue on mobile and starts replay immediately", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.replay") {
        return new Promise(() => {});
      }

      return Promise.resolve({ ok: true, data: { status: "ok" } });
    });
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hydrationCoordinatorMocks.request).not.toHaveBeenCalled();
    expect(screen.queryByText("Restoring terminal output...")).not.toBeInTheDocument();
    expect(sendCommand).toHaveBeenCalledWith(
      "terminal.replay",
      {
        terminalId: "mobile-terminal",
        lastSeq: 0,
      },
      {
        timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS,
      }
    );

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("shows a retryable recovery notice instead of a blocking overlay when replay fails", async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.replay") {
        return Promise.reject(new Error("Command timeout: terminal.replay"));
      }

      return Promise.resolve({ ok: true, data: { status: "ok" } });
    });
    const subscribe = vi.fn(() => vi.fn());
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(localeAtom, "zh");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="failed-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("终端历史暂未恢复")).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        "当前终端可以继续使用，但较早输出这次没有补齐。你可以重试恢复；如果服务端仍保留历史，稍后或刷新页面后仍可能找回。"
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试恢复" })).toBeInTheDocument();
    expect(document.querySelector(".xterm-replay-overlay")).toBeFalsy();

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("suppresses the retryable recovery notice while the websocket is disconnected", async () => {
    // Regression guard: the global connection banner is already shown when the
    // socket is down, so xterm-host must not stack a "terminal history not
    // recovered" notice on top of it. Coverage is split across two layers:
    //   1. failHistoricalRecovery short-circuits to a quiet loading state
    //      when getStatus() != "connected".
    //   2. The UI gate (wsHealthy) hides the notice even if the state were
    //      somehow set.
    const store = createStore();
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.snapshot") {
        return Promise.resolve({ status: "unsupported" });
      }

      if (op === "terminal.replay") {
        return Promise.reject(new Error("Command timeout: terminal.replay"));
      }

      return Promise.resolve({ ok: true, data: { status: "ok" } });
    });
    const subscribe = vi.fn(() => vi.fn());
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(localeAtom, "zh");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
      getStatus: vi.fn(() => "disconnected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="ws-disconnected-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Even after the replay command rejects with a non-network-flavoured error,
    // no recovery failure notice should appear while the socket itself is down.
    expect(screen.queryByText("终端历史暂未恢复")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试恢复" })).not.toBeInTheDocument();
    expect(screen.queryByText("终端恢复检查未完成")).not.toBeInTheDocument();
    // The blocking loading overlay is also gated on a healthy socket.
    expect(document.querySelector(".xterm-replay-overlay")).toBeFalsy();

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("shows a recovery-check notice instead of retryable recovery when replay is unavailable as a command", async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.snapshot") {
        return Promise.resolve({ status: "unsupported" });
      }

      if (op === "terminal.replay") {
        return Promise.reject(
          new CommandResultError({
            code: "unknown_op",
            message: "Unknown operation: terminal.replay",
          })
        );
      }

      return Promise.resolve({ ok: true, data: { status: "ok" } });
    });
    const subscribe = vi.fn(() => vi.fn());
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(localeAtom, "zh");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="missing-replay-command-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("终端恢复检查未完成")).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        "这次没有完成恢复决策，当前终端仍可继续使用，但较早历史是否补齐暂时无法确认。请稍后重新检查。"
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新检查" })).toBeInTheDocument();
    expect(screen.queryByText("终端历史暂未恢复")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试恢复" })).not.toBeInTheDocument();

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("retries local recovery when the retry action is clicked", async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.snapshot") {
        return Promise.resolve({ status: "unsupported" });
      }

      if (op === "terminal.replay") {
        return Promise.reject(new Error("Command timeout: terminal.replay"));
      }

      return Promise.resolve({ status: "ok" });
    });
    const subscribe = vi.fn(() => vi.fn());
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(localeAtom, "zh");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="retry-local-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "重试恢复" })).toBeInTheDocument();
    });

    expect(sendCommand.mock.calls.filter(([op]) => op === "terminal.snapshot")).toHaveLength(1);
    expect(sendCommand.mock.calls.filter(([op]) => op === "terminal.replay")).toHaveLength(1);
    expect(
      sendCommand.mock.calls.filter(([op]) => op === "terminal.replay").map(([, args]) => args)
    ).toEqual([{ terminalId: "retry-local-terminal", lastSeq: 0 }]);

    fireEvent.click(screen.getByRole("button", { name: "重试恢复" }));

    await waitFor(() => {
      expect(sendCommand.mock.calls.filter(([op]) => op === "terminal.snapshot")).toHaveLength(2);
      expect(sendCommand.mock.calls.filter(([op]) => op === "terminal.replay")).toHaveLength(2);
    });
    expect(
      sendCommand.mock.calls.filter(([op]) => op === "terminal.replay").map(([, args]) => args)
    ).toEqual([
      { terminalId: "retry-local-terminal", lastSeq: 0 },
      { terminalId: "retry-local-terminal", lastSeq: 0 },
    ]);

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("removes the retry action after a manual retry also fails", async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.snapshot") {
        return Promise.resolve({ status: "unsupported" });
      }

      if (op === "terminal.replay") {
        return Promise.reject(new Error("Command timeout: terminal.replay"));
      }

      return Promise.resolve({ status: "ok" });
    });
    const subscribe = vi.fn(() => vi.fn());
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(localeAtom, "zh");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="retry-final-failure-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "重试恢复" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "重试恢复" }));

    await waitFor(() => {
      expect(sendCommand.mock.calls.filter(([op]) => op === "terminal.snapshot")).toHaveLength(2);
      expect(sendCommand.mock.calls.filter(([op]) => op === "terminal.replay")).toHaveLength(2);
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "重试恢复" })).not.toBeInTheDocument();
    });
    expect(screen.getByText("终端历史暂未恢复")).toBeInTheDocument();
    expect(document.querySelector(".xterm-replay-overlay")).toBeFalsy();

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("retries local gap recovery from the original missing-history seq", async () => {
    const store = createStore();
    const initialReplayChunk = new TextEncoder().encode("snapshot\n");
    const gapChunk = new TextEncoder().encode("tail\n");
    let subscriptionHandler: ((topic: string, payload: unknown, seq: number) => void) | undefined;
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;
    let replayCount = 0;
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.snapshot") {
        return Promise.resolve({ status: "unsupported" });
      }

      if (op === "terminal.replay") {
        replayCount += 1;
        if (replayCount === 1) {
          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 1,
            size: initialReplayChunk.byteLength,
            seq: 100,
            bytes: initialReplayChunk,
          } satisfies TerminalReplayPayload);
        }

        return Promise.reject(new Error("Command timeout: terminal.replay"));
      }

      return Promise.resolve({ status: "ok" });
    });

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(localeAtom, "zh");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn((_topics, handler) => {
        subscriptionHandler = handler;
        return vi.fn();
      }),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="gap-retry-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expectReplayCall(sendCommand, "gap-retry-terminal", 0);
      expectTerminalWriteData(initialReplayChunk);
    });

    mockTerminal.write.mockClear();

    await act(async () => {
      subscriptionHandler?.(
        Topics.terminalOutput("test-workspace", "gap-retry-terminal"),
        { transport: "binary", streamId: 2, size: gapChunk.byteLength, bytes: gapChunk },
        112
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "重试恢复" })).toBeInTheDocument();
    });
    expect(
      sendCommand.mock.calls.filter(([op]) => op === "terminal.replay").map(([, args]) => args)
    ).toEqual([
      { terminalId: "gap-retry-terminal", lastSeq: 0 },
      { terminalId: "gap-retry-terminal", lastSeq: 100 },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "重试恢复" }));

    await waitFor(() => {
      expect(sendCommand.mock.calls.filter(([op]) => op === "terminal.replay")).toHaveLength(3);
    });
    expect(
      sendCommand.mock.calls.filter(([op]) => op === "terminal.replay").map(([, args]) => args)
    ).toEqual([
      { terminalId: "gap-retry-terminal", lastSeq: 0 },
      { terminalId: "gap-retry-terminal", lastSeq: 100 },
      { terminalId: "gap-retry-terminal", lastSeq: 100 },
    ]);

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("routes retry through recovery.reconcile when a coordinator is installed", async () => {
    const probeConnection = vi.fn().mockResolvedValue({ ok: true });
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "recovery.reconcile") {
        return {
          terminals: [
            {
              terminalId: "retry-coordinator-terminal",
              action: "replay",
              fromSeq: 0,
              headSeq: 10,
            },
          ],
        };
      }

      if (op === "terminal.replay") {
        throw new Error("Command timeout: terminal.replay");
      }

      if (op === "terminal.resize") {
        return { status: "ok" };
      }

      throw new Error(`Unexpected op ${op}`);
    });

    const store = createStore();
    store.set(localeAtom, "zh");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      probeConnection,
      onStatus: vi.fn(() => () => {}),
    } as never);

    setGlobalRecoveryCoordinator(
      createRecoveryCoordinator({
        wsClient: {
          getStatus: vi.fn(() => "connected"),
          probeConnection,
          onStatus: vi.fn(() => () => {}),
          subscribe: vi.fn(() => () => {}),
        } as never,
        sendCommand: async (op, args, options) => {
          try {
            const data = await sendCommand(op, args, options);
            return { ok: true, data };
          } catch (error) {
            return {
              ok: false,
              error: {
                code: "command_error",
                message: error instanceof Error ? error.message : String(error),
              },
            };
          }
        },
        applyReplay: vi.fn(),
        applySnapshot: vi.fn(),
      })
    );

    render(
      <Provider store={store}>
        <XtermHost terminalId="retry-coordinator-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "重试恢复" })).toBeInTheDocument();
    });

    sendCommand.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "重试恢复" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "recovery.reconcile",
        {
          reason: "foreground_resume",
          terminals: [{ terminalId: "retry-coordinator-terminal", renderedSeq: 0 }],
        },
        undefined
      );
    });
  });

  it("preserves the original recovery anchor when coordinator retry follows a failed gap recovery", async () => {
    const initialReplayChunk = new TextEncoder().encode("snapshot\n");
    const gapChunk = new TextEncoder().encode("tail\n");
    let subscriptionHandler: ((topic: string, payload: unknown, seq: number) => void) | undefined;
    const probeConnection = vi.fn().mockResolvedValue({ ok: true });
    const sendCommand = vi.fn(
      async (op: string, args?: { terminals?: Array<{ renderedSeq: number }> }) => {
        if (op === "recovery.reconcile") {
          return {
            terminals: [
              {
                terminalId: "retry-coordinator-gap-terminal",
                action: "replay",
                fromSeq: args?.terminals?.[0]?.renderedSeq ?? 0,
                headSeq: 130,
              },
            ],
          };
        }

        if (op === "terminal.replay") {
          if (args?.terminals) {
            throw new Error(
              `Unexpected reconcile-shaped args for terminal.replay: ${JSON.stringify(args)}`
            );
          }

          if (
            (sendCommand.mock.calls.filter(([name]) => name === "terminal.replay").length ?? 0) ===
            1
          ) {
            return {
              status: "ok",
              transport: "binary",
              streamId: 1,
              size: initialReplayChunk.byteLength,
              seq: 100,
              bytes: initialReplayChunk,
            } satisfies TerminalReplayPayload;
          }

          throw new Error("Command timeout: terminal.replay");
        }

        if (op === "terminal.resize") {
          return { status: "ok" };
        }

        throw new Error(`Unexpected op ${op}`);
      }
    );

    const store = createStore();
    store.set(localeAtom, "zh");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn((_topics, handler) => {
        subscriptionHandler = handler;
        return vi.fn();
      }),
      getStatus: vi.fn(() => "connected"),
      probeConnection,
      onStatus: vi.fn(() => () => {}),
    } as never);

    setGlobalRecoveryCoordinator(
      createRecoveryCoordinator({
        wsClient: {
          getStatus: vi.fn(() => "connected"),
          probeConnection,
          onStatus: vi.fn(() => () => {}),
          subscribe: vi.fn(() => () => {}),
        } as never,
        sendCommand: async (op, innerArgs, options) => {
          try {
            const data = await sendCommand(op, innerArgs as never, options);
            return { ok: true, data };
          } catch (error) {
            return {
              ok: false,
              error: {
                code: "command_error",
                message: error instanceof Error ? error.message : String(error),
              },
            };
          }
        },
        applyReplay: vi.fn(),
        applySnapshot: vi.fn(),
      })
    );

    render(
      <Provider store={store}>
        <XtermHost terminalId="retry-coordinator-gap-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "recovery.reconcile",
        {
          reason: "initial_mount",
          terminals: [{ terminalId: "retry-coordinator-gap-terminal", renderedSeq: 0 }],
        },
        undefined
      );
      expectTerminalWriteData(initialReplayChunk);
    });

    await act(async () => {
      subscriptionHandler?.(
        Topics.terminalOutput("test-workspace", "retry-coordinator-gap-terminal"),
        { transport: "binary", streamId: 2, size: gapChunk.byteLength, bytes: gapChunk },
        112
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "重试恢复" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "重试恢复" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "recovery.reconcile",
        {
          reason: "foreground_resume",
          terminals: [{ terminalId: "retry-coordinator-gap-terminal", renderedSeq: 100 }],
        },
        undefined
      );
    });
  });

  it("shows a dedicated notice when earlier history is no longer recoverable", async () => {
    const initialSnapshot = new TextEncoder().encode("init");
    const probeConnection = vi.fn().mockResolvedValue({ ok: true });
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "recovery.reconcile") {
        return {
          terminals: [
            {
              terminalId: "too-old-terminal",
              action: "unrecoverable",
              reason: "too_old_no_snapshot",
            },
          ],
        };
      }

      if (op === "terminal.snapshot") {
        return {
          status: "ok",
          transport: "binary",
          streamId: 1,
          size: initialSnapshot.byteLength,
          seq: 12,
          rows: 24,
          cols: 80,
          source: "headless",
          bytes: initialSnapshot,
        };
      }

      throw new Error(`Unexpected op ${op}`);
    });

    const store = createStore();
    store.set(localeAtom, "zh");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      probeConnection,
      onStatus: vi.fn(() => () => {}),
    } as never);

    setGlobalRecoveryCoordinator(
      createRecoveryCoordinator({
        wsClient: {
          getStatus: vi.fn(() => "connected"),
          probeConnection,
          onStatus: vi.fn(() => () => {}),
          subscribe: vi.fn(() => () => {}),
        } as never,
        sendCommand: async (op, args, options) => {
          try {
            const data = await sendCommand(op, args, options);
            return { ok: true, data };
          } catch (error) {
            return {
              ok: false,
              error: {
                code: "command_error",
                message: error instanceof Error ? error.message : String(error),
              },
            };
          }
        },
        applyReplay: vi.fn(),
        applySnapshot: vi.fn(),
      })
    );

    render(
      <Provider store={store}>
        <XtermHost terminalId="too-old-terminal" workspaceId="ws-1" />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText("较早历史已无法恢复")).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        "较早的终端输出已经从回放缓冲区中淘汰，而且当前也没有可用快照。现在只能继续查看后续输出。"
      )
    ).toBeInTheDocument();
    expect(document.querySelector(".xterm-replay-overlay")).toBeFalsy();
  });

  it("shows an unavailable terminal overlay when the coordinator reports unknown_terminal", async () => {
    const probeConnection = vi.fn().mockResolvedValue({ ok: true });
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "recovery.reconcile") {
        return {
          terminals: [
            {
              terminalId: "unknown-terminal",
              action: "unrecoverable",
              reason: "unknown_terminal",
            },
          ],
        };
      }

      if (op === "terminal.resize") {
        return { status: "ok" };
      }

      throw new Error(`Unexpected op ${op}`);
    });

    const store = createStore();
    store.set(localeAtom, "zh");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      probeConnection,
      onStatus: vi.fn(() => () => {}),
    } as never);

    setGlobalRecoveryCoordinator(
      createRecoveryCoordinator({
        wsClient: {
          getStatus: vi.fn(() => "connected"),
          probeConnection,
          onStatus: vi.fn(() => () => {}),
          subscribe: vi.fn(() => () => {}),
        } as never,
        sendCommand: async (op, args, options) => {
          try {
            const data = await sendCommand(op, args, options);
            return { ok: true, data };
          } catch (error) {
            return {
              ok: false,
              error: {
                code: "command_error",
                message: error instanceof Error ? error.message : String(error),
              },
            };
          }
        },
        applyReplay: vi.fn(),
        applySnapshot: vi.fn(),
      })
    );

    render(
      <Provider store={store}>
        <XtermHost terminalId="unknown-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText("当前终端已不可恢复")).toBeInTheDocument();
    });
    expect(
      screen.getByText("这个终端会话已经不在服务端，历史输出无法再补回。请重新打开一个新终端继续。")
    ).toBeInTheDocument();
    expect(document.querySelector(".xterm-replay-overlay")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重试恢复" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockTerminal.options).toEqual(
        expect.objectContaining({
          disableStdin: true,
          cursorBlink: false,
        })
      );
    });
  });

  it("shows a recovery-check notice when the coordinator cannot run recovery.reconcile", async () => {
    const probeConnection = vi.fn().mockResolvedValue({ ok: true });
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "recovery.reconcile") {
        throw new Error("Unknown operation: recovery.reconcile");
      }

      if (op === "terminal.resize") {
        return { status: "ok" };
      }

      throw new Error(`Unexpected op ${op}`);
    });

    const store = createStore();
    store.set(localeAtom, "zh");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      probeConnection,
      onStatus: vi.fn(() => () => {}),
    } as never);

    setGlobalRecoveryCoordinator(
      createRecoveryCoordinator({
        wsClient: {
          getStatus: vi.fn(() => "connected"),
          probeConnection,
          onStatus: vi.fn(() => () => {}),
          subscribe: vi.fn(() => () => {}),
        } as never,
        sendCommand: async (op, args, options) => {
          try {
            const data = await sendCommand(op, args, options);
            return { ok: true, data };
          } catch (error) {
            return {
              ok: false,
              error: {
                code: "unknown_op",
                message: error instanceof Error ? error.message : String(error),
              },
            };
          }
        },
        applyReplay: vi.fn(),
        applySnapshot: vi.fn(),
      })
    );

    render(
      <Provider store={store}>
        <XtermHost terminalId="reconcile-missing-command-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText("终端恢复检查未完成")).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        "这次没有完成恢复决策，当前终端仍可继续使用，但较早历史是否补齐暂时无法确认。请稍后重新检查。"
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新检查" })).toBeInTheDocument();
    expect(screen.queryByText("终端历史暂未恢复")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试恢复" })).not.toBeInTheDocument();
  });

  it("shows a degraded overlay when replay returns unknown so unavailable terminals do not stay loading", async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.replay") {
        return Promise.resolve({ status: "unknown" });
      }

      return Promise.resolve({ ok: true, data: { status: "ok" } });
    });
    const subscribe = vi.fn(() => vi.fn());
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(localeAtom, "zh");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="unavailable-terminal" workspaceId="test-workspace" readOnly />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("当前终端已不可恢复")).toBeInTheDocument();
    });
    expect(
      screen.getByText("这个终端会话已经不在服务端，历史输出无法再补回。请重新打开一个新终端继续。")
    ).toBeInTheDocument();
    expect(screen.queryByText("正在恢复终端内容…")).not.toBeInTheDocument();
    expect(mockTerminal.options).toEqual(
      expect.objectContaining({
        disableStdin: true,
        cursorBlink: false,
      })
    );

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("shows provider-specific recovery actions for closed agent sessions", async () => {
    const store = createStore();
    const onContinue = vi.fn();
    const onClose = vi.fn();
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.replay") {
        return Promise.resolve({ status: "unknown" });
      }

      return Promise.resolve({ ok: true, data: { status: "ok" } });
    });
    const subscribe = vi.fn(() => vi.fn());
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(localeAtom, "zh");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost
          terminalId="closed-agent-terminal"
          workspaceId="test-workspace"
          readOnly
          terminalKind="agent"
          closedSessionProviderLabel="Codex"
          onClosedSessionContinue={onContinue}
          onClosedSessionClose={onClose}
        />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("当前终端已不可恢复")).toBeInTheDocument();
    });
    expect(
      screen.getByText("这个终端会话已经不在服务端。是否重新打开一个 Codex 会话继续？")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("does not trigger replay on successful foreground probe when continuity is intact", async () => {
    const initialSnapshot = new TextEncoder().encode("init");
    const probeConnection = vi.fn().mockResolvedValue({ ok: true });
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "recovery.reconcile") {
        return {
          terminals: [{ terminalId: "term-1", action: "snapshot", headSeq: 12 }],
        };
      }

      if (op === "terminal.snapshot") {
        return {
          status: "ok",
          transport: "binary",
          streamId: 1,
          size: initialSnapshot.byteLength,
          seq: 12,
          rows: 24,
          cols: 80,
          source: "headless",
          bytes: initialSnapshot,
        };
      }

      throw new Error(`Unexpected op ${op}`);
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      probeConnection,
      onStatus: vi.fn(() => () => {}),
    } as never);

    setGlobalRecoveryCoordinator(
      createRecoveryCoordinator({
        wsClient: {
          getStatus: vi.fn(() => "connected"),
          probeConnection,
          onStatus: vi.fn(() => () => {}),
          subscribe: vi.fn(() => () => {}),
        } as never,
        sendCommand: async (op, args, options) => {
          try {
            const data = await sendCommand(op, args, options);
            return { ok: true, data };
          } catch (error) {
            return {
              ok: false,
              error: {
                code: "command_error",
                message: error instanceof Error ? error.message : String(error),
              },
            };
          }
        },
        applyReplay: vi.fn(),
        applySnapshot: vi.fn(),
      })
    );

    render(
      <Provider store={store}>
        <XtermHost terminalId="term-1" workspaceId="ws-1" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "recovery.reconcile",
        {
          reason: "initial_mount",
          terminals: [{ terminalId: "term-1", renderedSeq: 0 }],
        },
        undefined
      );
    });
    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "terminal.snapshot",
        { terminalId: "term-1" },
        { timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS }
      );
    });

    sendCommand.mockClear();

    await act(async () => {
      await getGlobalRecoveryCoordinator()?.notifyReason("foreground_resume", "term-1");
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "recovery.reconcile",
      {
        reason: "foreground_resume",
        terminals: [{ terminalId: "term-1", renderedSeq: 12 }],
      },
      undefined
    );
    expect(sendCommand.mock.calls.some(([op]) => op === "terminal.replay")).toBe(false);
  });

  it("routes live seq gaps through recovery.reconcile before replay", async () => {
    const initialSnapshot = new TextEncoder().encode("hello");
    const missedTail = new TextEncoder().encode("missed\ntail\n");
    const probeConnection = vi.fn().mockResolvedValue({ ok: true });
    let eventHandler: ((topic: string, payload: unknown, seq: number) => void) | undefined;
    let reconcileCount = 0;
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "terminal.snapshot") {
        return {
          status: "ok",
          transport: "binary",
          streamId: 1,
          size: initialSnapshot.byteLength,
          seq: 100,
          rows: 24,
          cols: 80,
          source: "headless",
          bytes: initialSnapshot,
        };
      }

      if (op === "recovery.reconcile") {
        reconcileCount += 1;
        if (reconcileCount === 1) {
          return {
            terminals: [{ terminalId: "gap-terminal", action: "snapshot", headSeq: 100 }],
          };
        }

        return {
          terminals: [{ terminalId: "gap-terminal", action: "replay", fromSeq: 100, headSeq: 112 }],
        };
      }

      if (op === "terminal.replay") {
        return {
          status: "ok",
          transport: "binary",
          streamId: 2,
          size: missedTail.byteLength,
          seq: 112,
          bytes: missedTail,
        };
      }

      throw new Error(`Unexpected op ${op}`);
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn((_topics, handler) => {
        eventHandler = handler;
        return () => {
          eventHandler = undefined;
        };
      }),
      getStatus: vi.fn(() => "connected"),
      probeConnection,
      onStatus: vi.fn(() => () => {}),
    } as never);

    setGlobalRecoveryCoordinator(
      createRecoveryCoordinator({
        wsClient: {
          getStatus: vi.fn(() => "connected"),
          probeConnection,
          onStatus: vi.fn(() => () => {}),
          subscribe: vi.fn(() => () => {}),
        } as never,
        sendCommand: async (op, args, options) => {
          try {
            const data = await sendCommand(op, args, options);
            return { ok: true, data };
          } catch (error) {
            return {
              ok: false,
              error: {
                code: "command_error",
                message: error instanceof Error ? error.message : String(error),
              },
            };
          }
        },
        applyReplay: vi.fn(),
        applySnapshot: vi.fn(),
      })
    );

    render(
      <Provider store={store}>
        <XtermHost terminalId="gap-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "recovery.reconcile",
        {
          reason: "initial_mount",
          terminals: [{ terminalId: "gap-terminal", renderedSeq: 0 }],
        },
        undefined
      );
    });
    expect(sendCommand.mock.calls.some(([op]) => op === "terminal.snapshot")).toBe(true);
    sendCommand.mockClear();

    act(() => {
      eventHandler?.(
        Topics.terminalOutput("test-workspace", "gap-terminal"),
        {
          transport: "binary",
          streamId: 9,
          size: 4,
          bytes: new TextEncoder().encode("tail"),
        },
        116
      );
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "recovery.reconcile",
        {
          reason: "seq_gap",
          terminals: [{ terminalId: "gap-terminal", renderedSeq: 100 }],
        },
        undefined
      );
    });
    expect(sendCommand).toHaveBeenCalledWith(
      "terminal.replay",
      { terminalId: "gap-terminal", lastSeq: 100 },
      { timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS }
    );
  });

  it("renders live output immediately after an initial noop recovery decision", async () => {
    let eventHandler: ((topic: string, payload: unknown, seq: number) => void) | undefined;
    const liveChunk = new TextEncoder().encode("hello");
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "terminal.resize") {
        return { status: "ok" };
      }

      if (op === "recovery.reconcile") {
        return {
          terminals: [{ terminalId: "noop-terminal", action: "noop", headSeq: 0 }],
        };
      }

      throw new Error(`Unexpected op ${op}`);
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn((_topics, handler) => {
        eventHandler = handler;
        return () => {
          eventHandler = undefined;
        };
      }),
      getStatus: vi.fn(() => "connected"),
      probeConnection: vi.fn().mockResolvedValue({ ok: true }),
      onStatus: vi.fn(() => () => {}),
    } as never);

    setGlobalRecoveryCoordinator(
      createRecoveryCoordinator({
        wsClient: {
          getStatus: vi.fn(() => "connected"),
          probeConnection: vi.fn().mockResolvedValue({ ok: true }),
          onStatus: vi.fn(() => () => {}),
          subscribe: vi.fn(() => () => {}),
        } as never,
        sendCommand: async (op, args, options) => {
          try {
            const data = await sendCommand(op, args, options);
            return { ok: true, data };
          } catch (error) {
            return {
              ok: false,
              error: {
                code: "command_error",
                message: error instanceof Error ? error.message : String(error),
              },
            };
          }
        },
        applyReplay: vi.fn(),
        applySnapshot: vi.fn(),
      })
    );

    render(
      <Provider store={store}>
        <XtermHost terminalId="noop-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "recovery.reconcile",
        {
          reason: "initial_mount",
          terminals: [{ terminalId: "noop-terminal", renderedSeq: 0 }],
        },
        undefined
      );
    });

    mockTerminal.write.mockClear();

    act(() => {
      eventHandler?.(
        Topics.terminalOutput("test-workspace", "noop-terminal"),
        {
          transport: "binary",
          streamId: 11,
          size: liveChunk.byteLength,
          bytes: liveChunk,
        },
        liveChunk.byteLength
      );
    });

    await waitFor(() => {
      expectTerminalWriteData(liveChunk);
    });
  });

  it("renders live output immediately after an unrecoverable recovery decision", async () => {
    let eventHandler: ((topic: string, payload: unknown, seq: number) => void) | undefined;
    const liveChunk = new TextEncoder().encode("later output");
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "terminal.resize") {
        return { status: "ok" };
      }

      if (op === "recovery.reconcile") {
        return {
          terminals: [
            {
              terminalId: "too-old-live-terminal",
              action: "unrecoverable",
              reason: "too_old_no_snapshot",
            },
          ],
        };
      }

      throw new Error(`Unexpected op ${op}`);
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn((_topics, handler) => {
        eventHandler = handler;
        return () => {
          eventHandler = undefined;
        };
      }),
      getStatus: vi.fn(() => "connected"),
      probeConnection: vi.fn().mockResolvedValue({ ok: true }),
      onStatus: vi.fn(() => () => {}),
    } as never);

    setGlobalRecoveryCoordinator(
      createRecoveryCoordinator({
        wsClient: {
          getStatus: vi.fn(() => "connected"),
          probeConnection: vi.fn().mockResolvedValue({ ok: true }),
          onStatus: vi.fn(() => () => {}),
          subscribe: vi.fn(() => () => {}),
        } as never,
        sendCommand: async (op, args, options) => {
          try {
            const data = await sendCommand(op, args, options);
            return { ok: true, data };
          } catch (error) {
            return {
              ok: false,
              error: {
                code: "command_error",
                message: error instanceof Error ? error.message : String(error),
              },
            };
          }
        },
        applyReplay: vi.fn(),
        applySnapshot: vi.fn(),
      })
    );

    render(
      <Provider store={store}>
        <XtermHost terminalId="too-old-live-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText("Earlier history can no longer be restored")).toBeInTheDocument();
    });

    mockTerminal.write.mockClear();

    act(() => {
      eventHandler?.(
        Topics.terminalOutput("test-workspace", "too-old-live-terminal"),
        {
          transport: "binary",
          streamId: 12,
          size: liveChunk.byteLength,
          bytes: liveChunk,
        },
        liveChunk.byteLength
      );
    });

    await waitFor(() => {
      expectTerminalWriteData(liveChunk);
    });
  });

  it("marks terminal closed after recovery reconcile returns closed state", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "terminal.resize") {
        return { status: "ok" };
      }

      if (op === "recovery.reconcile") {
        return {
          terminals: [
            {
              terminalId: "closed-terminal",
              action: "closed",
              headSeq: 15,
              exitCode: 3,
            },
          ],
        };
      }

      throw new Error(`Unexpected op ${op}`);
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      probeConnection: vi.fn().mockResolvedValue({ ok: true }),
      onStatus: vi.fn(() => () => {}),
    } as never);

    const terminalMeta = {
      id: "closed-terminal",
      workspaceId: "test-workspace",
      kind: "shell" as const,
      alive: true,
      title: "shell",
    };
    store.set(terminalMetaAtomFamily("closed-terminal"), terminalMeta);

    setGlobalRecoveryCoordinator(
      createRecoveryCoordinator({
        wsClient: {
          getStatus: vi.fn(() => "connected"),
          probeConnection: vi.fn().mockResolvedValue({ ok: true }),
          onStatus: vi.fn(() => () => {}),
          subscribe: vi.fn(() => () => {}),
        } as never,
        sendCommand: async (op, args, options) => {
          try {
            const data = await sendCommand(op, args, options);
            return { ok: true, data };
          } catch (error) {
            return {
              ok: false,
              error: {
                code: "command_error",
                message: error instanceof Error ? error.message : String(error),
              },
            };
          }
        },
        applyReplay: vi.fn(),
        applySnapshot: vi.fn(),
      })
    );

    render(
      <Provider store={store}>
        <XtermHost terminalId="closed-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "recovery.reconcile",
        {
          reason: "initial_mount",
          terminals: [{ terminalId: "closed-terminal", renderedSeq: 0 }],
        },
        undefined
      );
    });
    await waitFor(() => {
      expect(screen.getByText("This session has ended")).toBeInTheDocument();
    });
    expect(screen.getByText("Reopen a new session to continue?")).toBeInTheDocument();
    expect(document.querySelector(".xterm-replay-overlay")).toBeTruthy();
    expect(mockTerminal.options).toEqual(
      expect.objectContaining({
        disableStdin: true,
        cursorBlink: false,
      })
    );
    expect(store.get(terminalMetaAtomFamily("closed-terminal"))).toMatchObject({
      alive: false,
      exitCode: 3,
    });
  });

  it("creates xterm instance on mount with correct theme", async () => {
    const { Terminal } = await import("@xterm/xterm");

    render(
      <JotaiProvider>
        <XtermHost terminalId="test-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    expect(Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        allowTransparency: true,
      })
    );
    const lastTheme = vi.mocked(Terminal).mock.calls.at(-1)?.[0]?.theme;
    expectAppliedTerminalTheme(lastTheme, "mint-dark");
  });

  it("creates xterm instance with the mint-light palette when ui theme is mint-light", async () => {
    const { Terminal } = await import("@xterm/xterm");
    const store = createStore();
    store.set(themeAtom, "mint-light");

    render(
      <Provider store={store}>
        <XtermHost terminalId="light-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    expect(Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        allowTransparency: true,
      })
    );
    const lastTheme = vi.mocked(Terminal).mock.calls.at(-1)?.[0]?.theme;
    expectAppliedTerminalTheme(lastTheme, "mint-light");
  });

  it("uses a transparent xterm background when glass surfaces are enabled", async () => {
    const { Terminal } = await import("@xterm/xterm");
    const store = createStore();
    store.set(appearancePersonalizationAtom, {
      version: 1,
      common: {
        backgroundMode: "image",
        backgroundAssetId: "asset-glass-terminal",
        backgroundFit: "cover",
        backgroundDimness: 18,
        backgroundBlur: 6,
        glassEnabled: true,
        glassIntensity: 24,
        surfaceOpacity: 56,
      },
      desktop: {},
      mobile: {},
    });

    render(
      <Provider store={store}>
        <XtermHost terminalId="glass-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    expect(Terminal).toHaveBeenCalledWith(expect.objectContaining({}));
    const lastTheme = vi.mocked(Terminal).mock.calls.at(-1)?.[0]?.theme;
    expectAppliedTerminalTheme(lastTheme, "mint-dark");
  });

  it("updates the live xterm theme when the ui theme changes to graphite-light", async () => {
    const store = createStore();
    store.set(themeAtom, "mint-dark");

    render(
      <Provider store={store}>
        <XtermHost terminalId="theme-sync-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      store.set(themeAtom, "graphite-light");
    });

    await waitFor(() => {
      expectAppliedTerminalTheme(mockTerminal.options.theme, "graphite-light");
    });
  });

  it("keeps the live xterm background transparent after a theme switch when glass surfaces are enabled", async () => {
    const store = createStore();
    store.set(themeAtom, "mint-dark");
    store.set(appearancePersonalizationAtom, {
      version: 1,
      common: {
        backgroundMode: "image",
        backgroundAssetId: "asset-glass-theme-sync",
        backgroundFit: "cover",
        backgroundDimness: 16,
        backgroundBlur: 4,
        glassEnabled: true,
        glassIntensity: 28,
        surfaceOpacity: 52,
      },
      desktop: {},
      mobile: {},
    });

    render(
      <Provider store={store}>
        <XtermHost terminalId="glass-theme-sync-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      store.set(themeAtom, "graphite-light");
    });

    await waitFor(() => {
      expectAppliedTerminalTheme(mockTerminal.options.theme, "graphite-light");
    });
  });

  it("reports semantic terminal colors for OSC 10/11 queries while keeping the rendered background transparent", async () => {
    const store = createStore();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);
    store.set(themeAtom, "mint-light");
    store.set(wsClientAtom, {
      sendTerminalInput,
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="osc-query-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const fgHandlerCall = mockTerminal.parser.registerOscHandler.mock.calls.find(
      ([ident]) => ident === 10
    );
    const bgHandlerCall = mockTerminal.parser.registerOscHandler.mock.calls.find(
      ([ident]) => ident === 11
    );

    expect(fgHandlerCall).toBeTruthy();
    expect(bgHandlerCall).toBeTruthy();

    const fgHandler = fgHandlerCall?.[1] as
      | ((data: string) => boolean | Promise<boolean>)
      | undefined;
    const bgHandler = bgHandlerCall?.[1] as
      | ((data: string) => boolean | Promise<boolean>)
      | undefined;

    await act(async () => {
      expect(await fgHandler?.("?")).toBe(true);
      expect(await bgHandler?.("?")).toBe(true);
    });

    await waitFor(() => {
      expect(sendTerminalInput).toHaveBeenNthCalledWith(
        1,
        "osc-query-terminal",
        textEncoder.encode("\u001b]10;rgb:1f1f/2323/2828\u001b\\"),
        "system",
        undefined
      );
      expect(sendTerminalInput).toHaveBeenNthCalledWith(
        2,
        "osc-query-terminal",
        textEncoder.encode("\u001b]11;rgb:fcfc/ffff/fdfd\u001b\\"),
        "system",
        undefined
      );
    });

    expectAppliedTerminalTheme(mockTerminal.options.theme, "mint-light");
  });

  it("normalizes rendered ANSI cell backgrounds to the active surface opacity", async () => {
    const store = createStore();
    store.set(themeAtom, "mint-light");
    store.set(appearancePersonalizationAtom, {
      version: 1,
      common: {
        backgroundMode: "image",
        backgroundAssetId: "asset-terminal-material-alpha",
        backgroundFit: "cover",
        backgroundDimness: 18,
        backgroundBlur: 4,
        glassEnabled: true,
        glassIntensity: 28,
        surfaceOpacity: 52,
      },
      desktop: {},
      mobile: {},
    });

    let renderListener: ((viewport: { start: number; end: number }) => void) | undefined;
    mockTerminal.onRender.mockImplementationOnce((listener) => {
      renderListener = listener;
      return vi.fn();
    });

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="terminal-material-alpha" workspaceId="test-workspace" />
      </Provider>
    );

    const host = container.querySelector(".xterm-host") as HTMLDivElement | null;
    expect(host).toBeTruthy();
    expect(renderListener).toBeTypeOf("function");

    const rowsElement = document.createElement("div");
    rowsElement.className = "xterm-rows";
    const row = document.createElement("div");
    const cell = document.createElement("span");
    cell.textContent = "你好";
    cell.style.backgroundColor = "rgb(55, 55, 55)";
    cell.style.color = "rgb(255, 255, 255)";
    row.appendChild(cell);
    rowsElement.appendChild(row);
    host!.appendChild(rowsElement);

    await act(async () => {
      renderListener?.({ start: 0, end: 0 });
    });

    expect(cell.style.backgroundColor).toBe("rgba(55, 55, 55, 0.52)");
  });

  it("uses the high-contrast dark terminal palette for hc-dark", async () => {
    const { Terminal } = await import("@xterm/xterm");
    const store = createStore();
    store.set(themeAtom, "hc-dark");

    render(
      <Provider store={store}>
        <XtermHost terminalId="hc-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    expect(Terminal).toHaveBeenCalledWith(expect.objectContaining({}));
    const lastTheme = vi.mocked(Terminal).mock.calls.at(-1)?.[0]?.theme;
    expectAppliedTerminalTheme(lastTheme, "hc-dark");
  });

  it("uses JetBrains Mono font family", async () => {
    const { Terminal } = await import("@xterm/xterm");

    render(
      <JotaiProvider>
        <XtermHost terminalId="test-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    expect(Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        fontFamily: expect.stringContaining("JetBrains Mono"),
      })
    );
  });

  it("sets scrollback limit to 5000", async () => {
    const { Terminal } = await import("@xterm/xterm");

    render(
      <JotaiProvider>
        <XtermHost terminalId="test-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    expect(Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        scrollback: 5000,
      })
    );
  });

  it("sets cursor style to block with blink", async () => {
    const { Terminal } = await import("@xterm/xterm");

    render(
      <JotaiProvider>
        <XtermHost terminalId="test-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    expect(Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        cursorBlink: true,
        cursorStyle: "block",
      })
    );
  });

  it("sets font size to 11 and leaves line height at xterm default", async () => {
    const { Terminal } = await import("@xterm/xterm");

    render(
      <JotaiProvider>
        <XtermHost terminalId="test-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    expect(Terminal).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 11 }));
    expect(Terminal).toHaveBeenCalledWith(
      expect.not.objectContaining({ lineHeight: expect.any(Number) })
    );
  });

  it("initializes xterm with the configured terminal font size", async () => {
    const store = createStore();
    store.set(terminalPreferencesAtom, {
      copyOnSelect: false,
      desktopFontSize: 16,
      mobileFontSize: 13,
      fontSize: 16,
    });

    const { Terminal } = await import("@xterm/xterm");

    render(
      <Provider store={store}>
        <XtermHost terminalId="font-size-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    expect(Terminal).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 16 }));
    expect(Terminal).toHaveBeenCalledWith(
      expect.not.objectContaining({ lineHeight: expect.any(Number) })
    );
  });

  it("initializes xterm with the mobile terminal font size on mobile viewport", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    store.set(terminalPreferencesAtom, {
      copyOnSelect: false,
      desktopFontSize: 16,
      mobileFontSize: 14,
      fontSize: 16,
    });

    const { Terminal } = await import("@xterm/xterm");

    render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-font-size-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    expect(Terminal).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 14 }));
  });

  it("updates the existing xterm instance when the current viewport terminal font size changes", async () => {
    const store = createStore();
    store.set(terminalPreferencesAtom, {
      copyOnSelect: false,
      desktopFontSize: 11,
      mobileFontSize: 13,
      fontSize: 11,
    });

    render(
      <Provider store={store}>
        <XtermHost terminalId="font-size-live-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expect(mockFitAddon.fit).toHaveBeenCalled();
    });

    const fitCallsBeforeUpdate = mockFitAddon.fit.mock.calls.length;

    act(() => {
      store.set(terminalPreferencesAtom, {
        copyOnSelect: false,
        desktopFontSize: 17,
        mobileFontSize: 13,
        fontSize: 17,
      });
    });

    await waitFor(() => {
      expect(mockTerminal.options.fontSize).toBe(17);
    });
    await waitFor(() => {
      expect(mockFitAddon.fit.mock.calls.length).toBeGreaterThan(fitCallsBeforeUpdate);
    });
  });

  it("does not enable xterm's overview ruler just to size the scrollbar", async () => {
    const { Terminal } = await import("@xterm/xterm");

    render(
      <JotaiProvider>
        <XtermHost terminalId="test-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    expect(Terminal).toHaveBeenCalledWith(
      expect.not.objectContaining({
        overviewRuler: expect.anything(),
      })
    );
  });

  it("forwards utf-8 terminal output bytes to xterm without pre-decoding", async () => {
    const store = createStore();
    const chunk = textEncoder.encode("你好─Codex");

    store.set(terminalOutputAtomFamily("utf-terminal"), {
      chunks: [chunk],
      lastSeq: 1,
    });

    render(
      <Provider store={store}>
        <XtermHost terminalId="utf-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expect(mockTerminal.write).toHaveBeenCalledWith(chunk, expect.any(Function));
    });
  });

  it("forwards split utf-8 chunks to xterm without corrupting partial code points", async () => {
    const store = createStore();
    const fullChunk = textEncoder.encode("┌─审批确认─┐");
    const firstChunk = fullChunk.slice(0, 1);
    const secondChunk = fullChunk.slice(1);

    store.set(terminalOutputAtomFamily("utf-split-terminal"), {
      chunks: [firstChunk, secondChunk],
      lastSeq: fullChunk.byteLength,
    });

    render(
      <Provider store={store}>
        <XtermHost terminalId="utf-split-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expect(mockTerminal.write).toHaveBeenCalledTimes(2);
    });

    expect(mockTerminal.write.mock.calls[0]?.[0]).toEqual(firstChunk);
    expect(mockTerminal.write.mock.calls[1]?.[0]).toEqual(secondChunk);
  });

  it("trims only the written chunk prefix and preserves concurrently appended chunks", () => {
    const firstChunk = textEncoder.encode("first\n");
    const secondChunk = textEncoder.encode("second\n");

    expect(
      trimWrittenChunks(
        {
          chunks: [firstChunk, secondChunk],
          lastSeq: firstChunk.byteLength + secondChunk.byteLength,
        },
        1
      )
    ).toEqual({
      chunks: [secondChunk],
      lastSeq: firstChunk.byteLength + secondChunk.byteLength,
    });
  });

  it("does not send terminal input when rendered in read-only mode", async () => {
    const store = createStore();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="readonly-terminal" workspaceId="test-workspace" readOnly />
      </Provider>
    );

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    expect(onDataCallback).toBeTypeOf("function");

    await onDataCallback?.("ls -la\n");

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendTerminalInput).not.toHaveBeenCalled();

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("dispatches binary terminal input bytes without UTF-8 re-encoding", async () => {
    const store = createStore();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(wsClientAtom, {
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="binary-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const onBinaryCallback = mockTerminal.onBinary.mock.calls[0]?.[0];
    expect(onBinaryCallback).toBeTypeOf("function");

    await onBinaryCallback?.("\x1b[M\u00ffA");

    expect(sendTerminalInput).toHaveBeenCalledWith(
      "binary-terminal",
      Uint8Array.from([0x1b, 0x5b, 0x4d, 0xff, 0x41]),
      "control",
      undefined
    );
  });

  it("does not send binary terminal input when rendered in read-only mode", async () => {
    const store = createStore();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="readonly-binary-terminal" workspaceId="test-workspace" readOnly />
      </Provider>
    );

    const onBinaryCallback = mockTerminal.onBinary.mock.calls[0]?.[0];
    expect(onBinaryCallback).toBeTypeOf("function");

    await onBinaryCallback?.("\x1b[M !!");

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendTerminalInput).not.toHaveBeenCalled();

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("encodes Chinese terminal input as UTF-8 bytes before dispatching", async () => {
    const store = createStore();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(wsClientAtom, {
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="stdin-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    expect(onDataCallback).toBeTypeOf("function");

    await onDataCallback?.("你好，终端");

    expect(sendTerminalInput).toHaveBeenCalledWith(
      "stdin-terminal",
      new TextEncoder().encode("你好，终端"),
      "typing",
      undefined
    );
  });

  it("dispatches focus reporting bytes as system activity without buffering them", async () => {
    const store = createStore();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(wsClientAtom, {
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="focus-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    expect(onDataCallback).toBeTypeOf("function");

    await onDataCallback?.("\x1b[I");

    expect(sendTerminalInput).toHaveBeenCalledWith(
      "focus-terminal",
      new TextEncoder().encode("\x1b[I"),
      "system",
      undefined
    );
  });

  it("marks enter key input as submit activity before dispatching", async () => {
    const store = createStore();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(wsClientAtom, {
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="submit-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    expect(onDataCallback).toBeTypeOf("function");

    await onDataCallback?.("\r");

    expect(sendTerminalInput).toHaveBeenCalledWith(
      "submit-terminal",
      new TextEncoder().encode("\r"),
      "submit",
      undefined
    );
  });

  it("includes submitted text metadata when submit input carries content", async () => {
    const store = createStore();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(wsClientAtom, {
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="submit-text-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    expect(onDataCallback).toBeTypeOf("function");

    await onDataCallback?.("fix the build\r");

    expect(sendTerminalInput).toHaveBeenCalledWith(
      "submit-text-terminal",
      new TextEncoder().encode("fix the build\r"),
      "submit",
      "fix the build"
    );
  });

  it("shows the mobile soft-key bar above interactive terminals", () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      sendTerminalInput: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-soft-key-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    expect(container.querySelector(".xterm-host-shell")?.firstElementChild).toBe(
      container.querySelector(".mobile-terminal-input-bar")
    );
    expect(container.querySelector(".mobile-terminal-input-bar")).toHaveAttribute(
      "data-expanded",
      "true"
    );
    expect(screen.getByRole("button", { name: "Escape" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shift" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ctrl" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paste" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
  });

  it("routes the mobile paste button through the upload hook clipboard handler", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    const user = userEvent.setup();

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      sendTerminalInput: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-paste-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Paste" }));

    expect(uploadHookMocks.handleClipboardPaste).toHaveBeenCalledTimes(1);
  });

  it("falls back to a local overlay paste dialog when clipboard paste fails", async () => {
    viewportMocks.viewport = "mobile";
    uploadHookMocks.handleClipboardPaste.mockRejectedValueOnce(new Error("clipboard failed"));
    const store = createStore();
    const user = userEvent.setup();

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      sendTerminalInput: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi.fn().mockRejectedValue(new Error("clipboard unavailable")),
      } satisfies Pick<Clipboard, "readText">,
    });

    render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-paste-fallback-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Paste" }));

    expect(document.querySelector(".local-overlay")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Paste Text" })).toBeInTheDocument();
    expect(document.querySelector(".paste-dialog-overlay")).toBeNull();
  });

  it("opens the hidden file picker from the mobile upload button and forwards selected files", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    const user = userEvent.setup();
    const filePickerClickSpy = vi.spyOn(HTMLInputElement.prototype, "click");

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      sendTerminalInput: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-upload-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(filePickerClickSpy).toHaveBeenCalledTimes(1);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    const file = new File(["hello"], "clip.png", { type: "image/png" });

    await act(async () => {
      fireEvent.change(input!, { target: { files: [file] } });
    });

    expect(uploadHookMocks.handleFiles).toHaveBeenCalledWith([file]);
    expect(input?.value).toBe("");
  });

  it("does not render the mobile soft-key handle when the terminal is read-only", () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-readonly-terminal" workspaceId="test-workspace" readOnly />
      </Provider>
    );

    expect(screen.queryByRole("button", { name: "Escape" })).not.toBeInTheDocument();
  });

  it("routes soft-key presses through sendTerminalInput without refocusing the xterm instance", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    const user = userEvent.setup();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-escape-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Escape" }));

    await waitFor(() => {
      expect(sendTerminalInput).toHaveBeenLastCalledWith(
        "mobile-escape-terminal",
        new TextEncoder().encode("\x1b"),
        "typing",
        undefined
      );
    });
    expect(mockTerminal.focus).not.toHaveBeenCalled();
  });

  it("routes touch soft-key presses through sendTerminalInput without relying on xterm focus", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-touch-escape-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const escapeButton = screen.getByRole("button", { name: "Escape" });
    fireEvent.pointerDown(escapeButton, { pointerType: "touch" });
    fireEvent.pointerUp(escapeButton, { pointerType: "touch" });

    await waitFor(() => {
      expect(sendTerminalInput).toHaveBeenLastCalledWith(
        "mobile-touch-escape-terminal",
        new TextEncoder().encode("\x1b"),
        "typing",
        undefined
      );
    });

    expect(sendTerminalInput).toHaveBeenCalledTimes(1);
    expect(mockTerminal.focus).not.toHaveBeenCalled();
  });

  it("does not auto-focus a live terminal on mobile", () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);
    store.set(terminalMetaAtomFamily("mobile-alive-terminal"), {
      id: "mobile-alive-terminal",
      workspaceId: "test-workspace",
      kind: "shell",
      alive: true,
    });

    render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-alive-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    expect(mockTerminal.focus).not.toHaveBeenCalled();
  });

  it("still auto-focuses a live terminal on desktop", () => {
    const store = createStore();

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);
    store.set(terminalMetaAtomFamily("desktop-alive-terminal"), {
      id: "desktop-alive-terminal",
      workspaceId: "test-workspace",
      kind: "shell",
      alive: true,
    });

    render(
      <Provider store={store}>
        <XtermHost terminalId="desktop-alive-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    expect(mockTerminal.focus).toHaveBeenCalled();
  });

  it("applies one-shot ctrl to the next single Latin letter and then resets to off", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    const user = userEvent.setup();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-ctrl-armed-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Ctrl" }));

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    await act(async () => {
      await onDataCallback?.("c");
    });

    expect(sendTerminalInput).toHaveBeenLastCalledWith(
      "mobile-ctrl-armed-terminal",
      new TextEncoder().encode("\x03"),
      "control",
      undefined
    );
    await waitFor(() => {
      expect(container.querySelector(".mobile-terminal-input-bar__ctrl")).toHaveAttribute(
        "data-ctrl-mode",
        "off"
      );
    });
  });

  it("keeps ctrl armed across non-letter input and disables soft keys while disconnected", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    const user = userEvent.setup();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);
    const statusListeners: Array<(status: "connected" | "disconnected") => void> = [];

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn((listener) => {
        statusListeners.push(listener);
        return () => {};
      }),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-disconnected-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    await user.click(screen.getByRole("button", { name: "Ctrl" }));
    await act(async () => {
      await onDataCallback?.("\t");
    });
    await act(async () => {
      statusListeners[0]?.("disconnected");
    });

    const ctrlButton = container.querySelector(".mobile-terminal-input-bar__ctrl");
    const escapeButton = screen.getByRole("button", { name: "Escape" });
    const callCountBeforeDisabledClick = sendTerminalInput.mock.calls.length;

    expect(ctrlButton).toHaveAttribute("data-ctrl-mode", "armed");
    expect(escapeButton).toBeDisabled();
    await user.click(escapeButton);
    expect(sendTerminalInput).toHaveBeenCalledTimes(callCountBeforeDisabledClick);
  });

  it("applies one-shot shift to the next soft key and then resets", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    const user = userEvent.setup();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-shift-soft-key-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Shift" }));
    await user.click(screen.getByRole("button", { name: "Tab" }));

    await waitFor(() => {
      expect(sendTerminalInput).toHaveBeenLastCalledWith(
        "mobile-shift-soft-key-terminal",
        new TextEncoder().encode("\x1b[Z"),
        "typing",
        undefined
      );
    });

    expect(container.querySelector(".mobile-terminal-input-bar__shift")).toHaveAttribute(
      "data-shift-armed",
      "false"
    );
  });

  it("resets ctrl mode when the terminal instance changes", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    const user = userEvent.setup();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    const { container, rerender } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-reset-terminal-a" workspaceId="test-workspace" />
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Ctrl" }));
    expect(container.querySelector(".mobile-terminal-input-bar__ctrl")).toHaveAttribute(
      "data-ctrl-mode",
      "armed"
    );

    rerender(
      <Provider store={store}>
        <XtermHost terminalId="mobile-reset-terminal-b" workspaceId="test-workspace" />
      </Provider>
    );

    expect(container.querySelector(".mobile-terminal-input-bar__ctrl")).toHaveAttribute(
      "data-ctrl-mode",
      "off"
    );
  });

  it("clears buffered submitted text when the terminal instance changes", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    const { rerender } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-draft-reset-terminal-a" workspaceId="test-workspace" />
      </Provider>
    );

    const firstOnDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    await act(async () => {
      await firstOnDataCallback?.("f");
      await firstOnDataCallback?.("o");
      await firstOnDataCallback?.("o");
    });

    rerender(
      <Provider store={store}>
        <XtermHost terminalId="mobile-draft-reset-terminal-b" workspaceId="test-workspace" />
      </Provider>
    );

    const secondOnDataCallback = mockTerminal.onData.mock.calls.at(-1)?.[0];
    await act(async () => {
      await secondOnDataCallback?.("\r");
    });

    expect(sendTerminalInput).toHaveBeenLastCalledWith(
      "mobile-draft-reset-terminal-b",
      new TextEncoder().encode("\r"),
      "submit",
      undefined
    );
  });

  it("preserves buffered draft and one-shot ctrl state across viewport changes for the same terminal", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    const user = userEvent.setup();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    const { rerender } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-viewport-stable-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const firstOnDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    await act(async () => {
      await firstOnDataCallback?.("f");
      await firstOnDataCallback?.("o");
      await firstOnDataCallback?.("o");
    });
    await user.click(screen.getByRole("button", { name: "Ctrl" }));

    viewportMocks.viewport = "desktop";
    rerender(
      <Provider store={store}>
        <XtermHost terminalId="mobile-viewport-stable-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const secondOnDataCallback = mockTerminal.onData.mock.calls.at(-1)?.[0];
    await act(async () => {
      await secondOnDataCallback?.("d");
      await secondOnDataCallback?.("\r");
    });

    expect(sendTerminalInput).toHaveBeenNthCalledWith(
      4,
      "mobile-viewport-stable-terminal",
      new TextEncoder().encode("\x04"),
      "control",
      undefined
    );
    expect(sendTerminalInput).toHaveBeenNthCalledWith(
      5,
      "mobile-viewport-stable-terminal",
      new TextEncoder().encode("\r"),
      "submit",
      "foo"
    );
  });

  it("tracks typed input across keystrokes and sends the buffered line on Enter", async () => {
    const store = createStore();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(wsClientAtom, {
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="buffered-submit-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    expect(onDataCallback).toBeTypeOf("function");

    await onDataCallback?.("f");
    await onDataCallback?.("i");
    await onDataCallback?.("x");
    await onDataCallback?.("\r");

    expect(sendTerminalInput).toHaveBeenLastCalledWith(
      "buffered-submit-terminal",
      new TextEncoder().encode("\r"),
      "submit",
      "fix"
    );
  });

  it("ignores OSC control sequences while buffering submitted text", async () => {
    const store = createStore();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(wsClientAtom, {
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="osc-submit-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    expect(onDataCallback).toBeTypeOf("function");

    await onDataCallback?.("f");
    await onDataCallback?.("i");
    await onDataCallback?.("x");
    await onDataCallback?.("\x1b]10;rgb:e5/e5/e5\x07");
    await onDataCallback?.("\r");

    expect(sendTerminalInput).toHaveBeenLastCalledWith(
      "osc-submit-terminal",
      new TextEncoder().encode("\r"),
      "submit",
      "fix"
    );
  });

  it("keeps buffered submitted text in sync when mobile ctrl sends backspace", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    const user = userEvent.setup();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="ctrl-backspace-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    expect(onDataCallback).toBeTypeOf("function");
    await onDataCallback?.("f");
    await onDataCallback?.("i");
    await onDataCallback?.("x");
    await user.click(screen.getByRole("button", { name: "Ctrl" }));
    await onDataCallback?.("h");
    await onDataCallback?.("\r");

    expect(sendTerminalInput).toHaveBeenLastCalledWith(
      "ctrl-backspace-terminal",
      new TextEncoder().encode("\r"),
      "submit",
      "fi"
    );
  });

  it("clears the buffered submitted text when mobile ctrl-u clears the line", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    const user = userEvent.setup();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="ctrl-clear-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    expect(onDataCallback).toBeTypeOf("function");
    await onDataCallback?.("f");
    await onDataCallback?.("i");
    await onDataCallback?.("x");
    await user.click(screen.getByRole("button", { name: "Ctrl" }));
    await onDataCallback?.("u");
    await onDataCallback?.("\r");

    expect(sendTerminalInput).toHaveBeenLastCalledWith(
      "ctrl-clear-terminal",
      new TextEncoder().encode("\r"),
      "submit",
      undefined
    );
  });

  it("drops the last word from buffered submitted text when mobile ctrl-w is used", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    const user = userEvent.setup();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="ctrl-word-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    expect(onDataCallback).toBeTypeOf("function");
    await onDataCallback?.("f");
    await onDataCallback?.("o");
    await onDataCallback?.("o");
    await onDataCallback?.(" ");
    await onDataCallback?.("b");
    await onDataCallback?.("a");
    await onDataCallback?.("r");
    await user.click(screen.getByRole("button", { name: "Ctrl" }));
    await onDataCallback?.("w");
    await onDataCallback?.("\r");

    expect(sendTerminalInput).toHaveBeenLastCalledWith(
      "ctrl-word-terminal",
      new TextEncoder().encode("\r"),
      "submit",
      "foo "
    );
  });

  it("starts a fresh buffered submitted text after mobile ctrl-c interrupts the line", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    const user = userEvent.setup();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="ctrl-interrupt-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    expect(onDataCallback).toBeTypeOf("function");
    await onDataCallback?.("n");
    await onDataCallback?.("p");
    await onDataCallback?.("m");
    await user.click(screen.getByRole("button", { name: "Ctrl" }));
    await onDataCallback?.("c");
    await onDataCallback?.("l");
    await onDataCallback?.("s");
    await onDataCallback?.("\r");

    expect(sendTerminalInput).toHaveBeenLastCalledWith(
      "ctrl-interrupt-terminal",
      new TextEncoder().encode("\r"),
      "submit",
      "ls"
    );
  });

  it("locks ctrl from the keyboard shortcut path and keeps applying control input", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-ctrl-keyboard-lock-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const ctrlButton = screen.getByRole("button", { name: "Ctrl" });
    ctrlButton.focus();

    fireEvent.keyDown(ctrlButton, { key: "Enter", altKey: true });

    expect(ctrlButton).toHaveAttribute("data-ctrl-mode", "locked");

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    await act(async () => {
      await onDataCallback?.("c");
      await onDataCallback?.("d");
    });

    expect(sendTerminalInput).toHaveBeenNthCalledWith(
      1,
      "mobile-ctrl-keyboard-lock-terminal",
      new TextEncoder().encode("\x03"),
      "control",
      undefined
    );
    expect(sendTerminalInput).toHaveBeenNthCalledWith(
      2,
      "mobile-ctrl-keyboard-lock-terminal",
      new TextEncoder().encode("\x04"),
      "control",
      undefined
    );
    expect(container.querySelector(".mobile-terminal-input-bar__ctrl")).toHaveAttribute(
      "data-ctrl-mode",
      "locked"
    );
  });

  it("restores one-shot ctrl mode when sending the control byte fails", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    const user = userEvent.setup();
    const sendTerminalInput = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket dropped"))
      .mockResolvedValueOnce(undefined);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-ctrl-send-failure-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Ctrl" }));

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    await act(async () => {
      await onDataCallback?.("c");
    });

    expect(container.querySelector(".mobile-terminal-input-bar__ctrl")).toHaveAttribute(
      "data-ctrl-mode",
      "armed"
    );

    await act(async () => {
      await onDataCallback?.("d");
    });

    expect(sendTerminalInput).toHaveBeenNthCalledWith(
      1,
      "mobile-ctrl-send-failure-terminal",
      new TextEncoder().encode("\x03"),
      "control",
      undefined
    );
    expect(sendTerminalInput).toHaveBeenNthCalledWith(
      2,
      "mobile-ctrl-send-failure-terminal",
      new TextEncoder().encode("\x04"),
      "control",
      undefined
    );
    expect(container.querySelector(".mobile-terminal-input-bar__ctrl")).toHaveAttribute(
      "data-ctrl-mode",
      "off"
    );
    expect(consoleSpy).toHaveBeenCalledWith("Failed to send terminal input:", expect.any(Error));
  });

  it("does not re-arm one-shot ctrl after a later keystroke already consumed the local state", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    const user = userEvent.setup();
    let rejectFirstSend: ((error: Error) => void) | null = null;
    const sendTerminalInput = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectFirstSend = reject;
          })
      )
      .mockResolvedValueOnce(undefined);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-ctrl-overlap-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Ctrl" }));

    const onDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    let firstInputPromise: Promise<void> | undefined;
    await act(async () => {
      firstInputPromise = onDataCallback?.("c");
    });

    expect(container.querySelector(".mobile-terminal-input-bar__ctrl")).toHaveAttribute(
      "data-ctrl-mode",
      "off"
    );

    await act(async () => {
      await onDataCallback?.("d");
    });

    rejectFirstSend?.(new Error("socket dropped"));
    await act(async () => {
      await firstInputPromise;
    });

    expect(sendTerminalInput).toHaveBeenNthCalledWith(
      1,
      "mobile-ctrl-overlap-terminal",
      new TextEncoder().encode("\x03"),
      "control",
      undefined
    );
    expect(sendTerminalInput).toHaveBeenNthCalledWith(
      2,
      "mobile-ctrl-overlap-terminal",
      new TextEncoder().encode("d"),
      "typing",
      undefined
    );
    expect(container.querySelector(".mobile-terminal-input-bar__ctrl")).toHaveAttribute(
      "data-ctrl-mode",
      "off"
    );
    expect(consoleSpy).toHaveBeenCalledWith("Failed to send terminal input:", expect.any(Error));
  });

  it("does not restore prior terminal draft or ctrl state after a delayed send failure on terminal switch", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    const user = userEvent.setup();
    let rejectFirstSend: ((error: Error) => void) | null = null;
    const sendTerminalInput = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectFirstSend = reject;
          })
      )
      .mockResolvedValueOnce(undefined);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    store.set(localeAtom, "en");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
      sendTerminalInput,
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    const { container, rerender } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-cross-terminal-a" workspaceId="test-workspace" />
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Ctrl" }));
    const firstOnDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    let firstInputPromise: Promise<void> | undefined;
    await act(async () => {
      firstInputPromise = firstOnDataCallback?.("c");
    });

    rerender(
      <Provider store={store}>
        <XtermHost terminalId="mobile-cross-terminal-b" workspaceId="test-workspace" />
      </Provider>
    );
    const secondOnDataCallback = mockTerminal.onData.mock.calls.at(-1)?.[0];
    await act(async () => {
      await secondOnDataCallback?.("\r");
    });

    rejectFirstSend?.(new Error("socket dropped"));
    await act(async () => {
      await firstInputPromise;
    });

    expect(sendTerminalInput).toHaveBeenNthCalledWith(
      2,
      "mobile-cross-terminal-b",
      new TextEncoder().encode("\r"),
      "submit",
      undefined
    );
    expect(container.querySelector(".mobile-terminal-input-bar__ctrl")).toHaveAttribute(
      "data-ctrl-mode",
      "off"
    );
    expect(consoleSpy).toHaveBeenCalledWith("Failed to send terminal input:", expect.any(Error));
  });

  it("buffers live output until replay finishes and drops overlapping bytes", async () => {
    const store = createStore();
    const replayChunk = new TextEncoder().encode("replay snapshot\n");
    const earlyChunk = new TextEncoder().encode("early output\n");
    const lateChunk = new TextEncoder().encode("late output\n");
    const dispatchCommand = vi.fn();
    let replayResolve: ((value: TerminalReplayPayload) => void) | undefined;
    let subscriptionHandler: ((topic: string, payload: unknown, seq: number) => void) | undefined;
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    dispatchCommand.mockImplementation((op: string) => {
      if (op === "terminal.replay") {
        return new Promise((resolve) => {
          replayResolve = resolve;
        });
      }

      return Promise.resolve({ status: "ok" });
    });

    const subscribe = vi.fn((topics: string[], handler: typeof subscriptionHandler) => {
      subscriptionHandler = handler;
      return vi.fn();
    });

    store.set(wsClientAtom, {
      sendCommand: dispatchCommand,
      subscribe,
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="dedup-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    expect(subscribe).toHaveBeenCalledWith(
      [
        Topics.terminalOutput("test-workspace", "dedup-terminal"),
        Topics.terminalExit("test-workspace", "dedup-terminal"),
      ],
      expect.any(Function)
    );
    expect(subscriptionHandler).toBeTypeOf("function");

    await act(async () => {
      subscriptionHandler?.(
        Topics.terminalOutput("test-workspace", "dedup-terminal"),
        { transport: "binary", streamId: 100, size: earlyChunk.byteLength, bytes: earlyChunk },
        100
      );
      await Promise.resolve();
    });

    expect(mockTerminal.write).not.toHaveBeenCalled();
    expect(dispatchCommand).not.toHaveBeenCalledWith("terminal.replay", {
      terminalId: "dedup-terminal",
      lastSeq: 0,
    });

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expectResizeCall(dispatchCommand, "dedup-terminal", 132, 36);
      expectReplayCall(dispatchCommand, "dedup-terminal", 0);
    });

    await act(async () => {
      replayResolve?.({
        status: "ok",
        transport: "binary",
        streamId: 101,
        size: replayChunk.byteLength,
        seq: 200,
        bytes: replayChunk,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockTerminal.write.mock.calls[0]?.[0]).toBe(replayChunk);
    });
    expect(mockTerminal.write).not.toHaveBeenCalledWith(earlyChunk);

    await act(async () => {
      subscriptionHandler?.(
        Topics.terminalOutput("test-workspace", "dedup-terminal"),
        { transport: "binary", streamId: 102, size: lateChunk.byteLength, bytes: lateChunk },
        200 + lateChunk.byteLength
      );
    });

    await waitFor(() => {
      expect(mockTerminal.write).toHaveBeenCalledWith(lateChunk, expect.any(Function));
    });

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("prefers terminal.snapshot for agent cold start and only flushes live chunks newer than the snapshot seq", async () => {
    const store = createStore();
    const snapshotChunk = new TextEncoder().encode("snapshot view\n");
    const coveredChunk = new TextEncoder().encode("covered\n");
    const liveChunk = new TextEncoder().encode("fresh output\n");
    const sendCommand = vi.fn();
    let subscriptionHandler: ((topic: string, payload: unknown, seq: number) => void) | undefined;
    const subscribe = vi.fn((topics: string[], handler: typeof subscriptionHandler) => {
      subscriptionHandler = handler;
      return vi.fn();
    });
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    sendCommand.mockImplementation((op: string) => {
      if (op === "terminal.snapshot") {
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 801,
          size: snapshotChunk.byteLength,
          seq: 200,
          cols: 132,
          rows: 36,
          source: "headless",
          bytes: snapshotChunk,
        } satisfies TerminalSnapshotPayload);
      }

      return Promise.resolve({ status: "ok" });
    });

    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost
          terminalId="agent-snapshot-terminal"
          workspaceId="test-workspace"
          terminalKind="agent"
        />
      </Provider>
    );

    await act(async () => {
      subscriptionHandler?.(
        Topics.terminalOutput("test-workspace", "agent-snapshot-terminal"),
        { transport: "binary", streamId: 802, size: coveredChunk.byteLength, bytes: coveredChunk },
        180
      );
      subscriptionHandler?.(
        Topics.terminalOutput("test-workspace", "agent-snapshot-terminal"),
        { transport: "binary", streamId: 803, size: liveChunk.byteLength, bytes: liveChunk },
        200 + liveChunk.byteLength
      );
      await Promise.resolve();
    });

    expect(mockTerminal.write).not.toHaveBeenCalled();

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "terminal.snapshot",
        {
          terminalId: "agent-snapshot-terminal",
        },
        {
          timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS,
        }
      );
    });
    expect(sendCommand).not.toHaveBeenCalledWith(
      "terminal.replay",
      expect.anything(),
      expect.anything()
    );

    await waitFor(() => {
      expect(mockTerminal.write.mock.calls[0]?.[0]).toBe(snapshotChunk);
      expect(mockTerminal.write).toHaveBeenCalledWith(liveChunk, expect.any(Function));
    });
    expect(mockTerminal.write).not.toHaveBeenCalledWith(coveredChunk);

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("prefers terminal.snapshot for shell cold start and only flushes live chunks newer than the snapshot seq", async () => {
    const store = createStore();
    const snapshotChunk = new TextEncoder().encode("shell snapshot view\n");
    const coveredChunk = new TextEncoder().encode("covered shell\n");
    const liveChunk = new TextEncoder().encode("fresh shell output\n");
    const sendCommand = vi.fn();
    let subscriptionHandler: ((topic: string, payload: unknown, seq: number) => void) | undefined;
    const subscribe = vi.fn((topics: string[], handler: typeof subscriptionHandler) => {
      subscriptionHandler = handler;
      return vi.fn();
    });
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    sendCommand.mockImplementation((op: string) => {
      if (op === "terminal.snapshot") {
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 804,
          size: snapshotChunk.byteLength,
          seq: 200,
          cols: 132,
          rows: 36,
          source: "headless",
          bytes: snapshotChunk,
        } satisfies TerminalSnapshotPayload);
      }

      return Promise.resolve({ status: "ok" });
    });

    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost
          terminalId="shell-snapshot-terminal"
          workspaceId="test-workspace"
          terminalKind="shell"
        />
      </Provider>
    );

    await act(async () => {
      subscriptionHandler?.(
        Topics.terminalOutput("test-workspace", "shell-snapshot-terminal"),
        { transport: "binary", streamId: 805, size: coveredChunk.byteLength, bytes: coveredChunk },
        180
      );
      subscriptionHandler?.(
        Topics.terminalOutput("test-workspace", "shell-snapshot-terminal"),
        { transport: "binary", streamId: 806, size: liveChunk.byteLength, bytes: liveChunk },
        200 + liveChunk.byteLength
      );
      await Promise.resolve();
    });

    expect(mockTerminal.write).not.toHaveBeenCalled();

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "terminal.snapshot",
        {
          terminalId: "shell-snapshot-terminal",
        },
        {
          timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS,
        }
      );
    });
    expect(sendCommand).not.toHaveBeenCalledWith(
      "terminal.replay",
      expect.anything(),
      expect.anything()
    );

    await waitFor(() => {
      expect(mockTerminal.write.mock.calls[0]?.[0]).toBe(snapshotChunk);
      expect(mockTerminal.write).toHaveBeenCalledWith(liveChunk, expect.any(Function));
    });
    expect(mockTerminal.write).not.toHaveBeenCalledWith(coveredChunk);

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("falls back to terminal.replay when agent snapshot is unsupported", async () => {
    const store = createStore();
    const replayChunk = new TextEncoder().encode("replay fallback\n");
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.snapshot") {
        return Promise.resolve({ status: "unsupported" });
      }
      if (op === "terminal.replay") {
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 811,
          size: replayChunk.byteLength,
          seq: replayChunk.byteLength,
          bytes: replayChunk,
        } satisfies TerminalReplayPayload);
      }

      return Promise.resolve({ status: "ok" });
    });
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => vi.fn()),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost
          terminalId="agent-fallback-terminal"
          workspaceId="test-workspace"
          terminalKind="agent"
        />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "terminal.snapshot",
        { terminalId: "agent-fallback-terminal" },
        { timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS }
      );
      expectReplayCall(sendCommand, "agent-fallback-terminal", 0);
      expectTerminalWriteData(replayChunk);
    });

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("falls back to terminal.replay when shell snapshot is unsupported", async () => {
    const store = createStore();
    const replayChunk = new TextEncoder().encode("shell replay fallback\n");
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.snapshot") {
        return Promise.resolve({ status: "unsupported" });
      }
      if (op === "terminal.replay") {
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 814,
          size: replayChunk.byteLength,
          seq: replayChunk.byteLength,
          bytes: replayChunk,
        } satisfies TerminalReplayPayload);
      }

      return Promise.resolve({ status: "ok" });
    });
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => vi.fn()),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost
          terminalId="shell-fallback-terminal"
          workspaceId="test-workspace"
          terminalKind="shell"
        />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "terminal.snapshot",
        { terminalId: "shell-fallback-terminal" },
        { timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS }
      );
      expectReplayCall(sendCommand, "shell-fallback-terminal", 0);
      expectTerminalWriteData(replayChunk);
    });

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("falls back to terminal.replay when agent snapshot times out", async () => {
    const store = createStore();
    const replayChunk = new TextEncoder().encode("timeout replay\n");
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.snapshot") {
        return Promise.reject(new Error("Command timeout: terminal.snapshot"));
      }
      if (op === "terminal.replay") {
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 821,
          size: replayChunk.byteLength,
          seq: replayChunk.byteLength,
          bytes: replayChunk,
        } satisfies TerminalReplayPayload);
      }

      return Promise.resolve({ status: "ok" });
    });
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => vi.fn()),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost
          terminalId="agent-timeout-terminal"
          workspaceId="test-workspace"
          terminalKind="agent"
        />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "terminal.snapshot",
        { terminalId: "agent-timeout-terminal" },
        { timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS }
      );
      expectReplayCall(sendCommand, "agent-timeout-terminal", 0);
      expectTerminalWriteData(replayChunk);
    });

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("does not send xterm query responses produced while writing replay output back to the PTY", async () => {
    const store = createStore();
    const replayChunk = new TextEncoder().encode("historical output\x1b[6n");
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.replay") {
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 700,
          size: replayChunk.byteLength,
          seq: replayChunk.byteLength,
          bytes: replayChunk,
        } satisfies TerminalReplayPayload);
      }

      return Promise.resolve({ status: "ok" });
    });
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);
    const subscribe = vi.fn(() => vi.fn());
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;
    let onDataCallback: ((data: string) => void) | undefined;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;
    mockTerminal.onData.mockImplementation((callback: (data: string) => void) => {
      onDataCallback = callback;
      return vi.fn();
    });
    mockTerminal.write.mockImplementation((data: Uint8Array | string, callback?: () => void) => {
      if (data === replayChunk) {
        onDataCallback?.("\x1b[12;3R");
      }
      callback?.();
    });

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand,
      sendTerminalInput,
      subscribe,
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="replay-query-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockTerminal.write).toHaveBeenCalledWith(replayChunk, expect.any(Function));
    });
    expect(sendTerminalInput).not.toHaveBeenCalled();

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("does not send async xterm query responses produced before replay write completion back to the PTY", async () => {
    const store = createStore();
    const replayChunk = new TextEncoder().encode("historical output\x1b[6n");
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.replay") {
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 701,
          size: replayChunk.byteLength,
          seq: replayChunk.byteLength,
          bytes: replayChunk,
        } satisfies TerminalReplayPayload);
      }

      return Promise.resolve({ status: "ok" });
    });
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);
    const subscribe = vi.fn(() => vi.fn());
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;
    let onDataCallback: ((data: string) => void) | undefined;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;
    mockTerminal.onData.mockImplementation((callback: (data: string) => void) => {
      onDataCallback = callback;
      return vi.fn();
    });
    mockTerminal.write.mockImplementation((data: Uint8Array | string, callback?: () => void) => {
      if (data === replayChunk) {
        void Promise.resolve().then(() => {
          onDataCallback?.("\x1b[12;3R");
          callback?.();
        });
        return;
      }

      callback?.();
    });

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand,
      sendTerminalInput,
      subscribe,
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="async-replay-query-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockTerminal.write).toHaveBeenCalledWith(replayChunk, expect.any(Function));
    });
    expect(sendTerminalInput).not.toHaveBeenCalled();

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("does not send xterm secondary device attribute responses produced during replay back to the PTY", async () => {
    const store = createStore();
    const replayChunk = new TextEncoder().encode("historical output\x1b[>0c");
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.replay") {
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 703,
          size: replayChunk.byteLength,
          seq: replayChunk.byteLength,
          bytes: replayChunk,
        } satisfies TerminalReplayPayload);
      }

      return Promise.resolve({ status: "ok" });
    });
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);
    const subscribe = vi.fn(() => vi.fn());
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;
    let onDataCallback: ((data: string) => void) | undefined;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;
    mockTerminal.onData.mockImplementation((callback: (data: string) => void) => {
      onDataCallback = callback;
      return vi.fn();
    });
    mockTerminal.write.mockImplementation((data: Uint8Array | string, callback?: () => void) => {
      if (data === replayChunk) {
        onDataCallback?.("\x1b[>41;331;0c");
      }
      callback?.();
    });

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand,
      sendTerminalInput,
      subscribe,
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="replay-da-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockTerminal.write).toHaveBeenCalledWith(replayChunk, expect.any(Function));
    });
    expect(sendTerminalInput).not.toHaveBeenCalled();

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("still sends real user input entered while replay output is being written", async () => {
    const store = createStore();
    const replayChunk = new TextEncoder().encode("historical output");
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.replay") {
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 702,
          size: replayChunk.byteLength,
          seq: replayChunk.byteLength,
          bytes: replayChunk,
        } satisfies TerminalReplayPayload);
      }

      return Promise.resolve({ status: "ok" });
    });
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);
    const subscribe = vi.fn(() => vi.fn());
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;
    let onDataCallback: ((data: string) => void) | undefined;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;
    mockTerminal.onData.mockImplementation((callback: (data: string) => void) => {
      onDataCallback = callback;
      return vi.fn();
    });
    mockTerminal.write.mockImplementation((data: Uint8Array | string, callback?: () => void) => {
      if (data === replayChunk) {
        onDataCallback?.("pwd\r");
      }
      callback?.();
    });

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand,
      sendTerminalInput,
      subscribe,
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="replay-user-input-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockTerminal.write).toHaveBeenCalledWith(replayChunk, expect.any(Function));
    });
    await waitFor(() => {
      expect(sendTerminalInput).toHaveBeenCalledWith(
        "replay-user-input-terminal",
        new TextEncoder().encode("pwd\r"),
        "submit",
        "pwd"
      );
    });

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("still sends xterm query responses produced by live output back to the PTY", async () => {
    const store = createStore();
    const replayChunk = new TextEncoder().encode("snapshot\n");
    const liveChunk = new TextEncoder().encode("live query\x1b[6n");
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.replay") {
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 710,
          size: replayChunk.byteLength,
          seq: replayChunk.byteLength,
          bytes: replayChunk,
        } satisfies TerminalReplayPayload);
      }

      return Promise.resolve({ status: "ok" });
    });
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);
    let subscriptionHandler: ((topic: string, payload: unknown, seq: number) => void) | undefined;
    const subscribe = vi.fn((topics: string[], handler: typeof subscriptionHandler) => {
      subscriptionHandler = handler;
      return vi.fn();
    });
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;
    let onDataCallback: ((data: string) => void) | undefined;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;
    mockTerminal.onData.mockImplementation((callback: (data: string) => void) => {
      onDataCallback = callback;
      return vi.fn();
    });
    mockTerminal.write.mockImplementation((data: Uint8Array | string, callback?: () => void) => {
      if (data === liveChunk) {
        onDataCallback?.("\x1b[12;3R");
      }
      callback?.();
    });

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand,
      sendTerminalInput,
      subscribe,
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="live-query-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expectTerminalWriteData(replayChunk);
    });
    sendTerminalInput.mockClear();

    await act(async () => {
      subscriptionHandler?.(
        Topics.terminalOutput("test-workspace", "live-query-terminal"),
        { transport: "binary", streamId: 711, size: liveChunk.byteLength, bytes: liveChunk },
        replayChunk.byteLength + liveChunk.byteLength
      );
    });

    await waitFor(() => {
      expect(sendTerminalInput).toHaveBeenCalledWith(
        "live-query-terminal",
        new TextEncoder().encode("\x1b[12;3R"),
        "typing",
        undefined
      );
    });

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("still sends xterm query responses produced by live chunks flushed after snapshot hydration", async () => {
    const store = createStore();
    const snapshotChunk = new TextEncoder().encode("snapshot\n");
    const queuedLiveChunk = new TextEncoder().encode("queued query\x1b[6n");
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.snapshot") {
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 901,
          size: snapshotChunk.byteLength,
          seq: 100,
          cols: 132,
          rows: 36,
          source: "headless",
          bytes: snapshotChunk,
        } satisfies TerminalSnapshotPayload);
      }

      return Promise.resolve({ status: "ok" });
    });
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);
    let subscriptionHandler: ((topic: string, payload: unknown, seq: number) => void) | undefined;
    const subscribe = vi.fn((topics: string[], handler: typeof subscriptionHandler) => {
      subscriptionHandler = handler;
      return vi.fn();
    });
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;
    let onDataCallback: ((data: string) => void) | undefined;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;
    mockTerminal.onData.mockImplementation((callback: (data: string) => void) => {
      onDataCallback = callback;
      return vi.fn();
    });
    mockTerminal.write.mockImplementation((data: Uint8Array | string, callback?: () => void) => {
      if (data === queuedLiveChunk) {
        onDataCallback?.("\x1b[12;3R");
      }
      callback?.();
    });

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand,
      sendTerminalInput,
      subscribe,
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost
          terminalId="snapshot-flush-query-terminal"
          workspaceId="test-workspace"
          terminalKind="agent"
        />
      </Provider>
    );

    await act(async () => {
      subscriptionHandler?.(
        Topics.terminalOutput("test-workspace", "snapshot-flush-query-terminal"),
        {
          transport: "binary",
          streamId: 902,
          size: queuedLiveChunk.byteLength,
          bytes: queuedLiveChunk,
        },
        100 + queuedLiveChunk.byteLength
      );
      await Promise.resolve();
    });

    expect(mockTerminal.write).not.toHaveBeenCalled();

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockTerminal.write.mock.calls[0]?.[0]).toBe(snapshotChunk);
      expect(mockTerminal.write).toHaveBeenCalledWith(queuedLiveChunk, expect.any(Function));
    });
    await waitFor(() => {
      expect(sendTerminalInput).toHaveBeenCalledWith(
        "snapshot-flush-query-terminal",
        new TextEncoder().encode("\x1b[12;3R"),
        "typing",
        undefined
      );
    });

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("does not reset the terminal for every pending live chunk flushed after snapshot hydration", async () => {
    const store = createStore();
    const snapshotChunk = new TextEncoder().encode("snapshot\n");
    const queuedLiveChunkA = new TextEncoder().encode("queued a\n");
    const queuedLiveChunkB = new TextEncoder().encode("queued b\n");
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.snapshot") {
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 905,
          size: snapshotChunk.byteLength,
          seq: 100,
          cols: 132,
          rows: 36,
          source: "headless",
          bytes: snapshotChunk,
        } satisfies TerminalSnapshotPayload);
      }

      return Promise.resolve({ status: "ok" });
    });
    let subscriptionHandler: ((topic: string, payload: unknown, seq: number) => void) | undefined;
    const subscribe = vi.fn((topics: string[], handler: typeof subscriptionHandler) => {
      subscriptionHandler = handler;
      return vi.fn();
    });
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost
          terminalId="snapshot-multi-flush-terminal"
          workspaceId="test-workspace"
          terminalKind="agent"
        />
      </Provider>
    );

    await act(async () => {
      subscriptionHandler?.(
        Topics.terminalOutput("test-workspace", "snapshot-multi-flush-terminal"),
        {
          transport: "binary",
          streamId: 906,
          size: queuedLiveChunkA.byteLength,
          bytes: queuedLiveChunkA,
        },
        100 + queuedLiveChunkA.byteLength
      );
      subscriptionHandler?.(
        Topics.terminalOutput("test-workspace", "snapshot-multi-flush-terminal"),
        {
          transport: "binary",
          streamId: 907,
          size: queuedLiveChunkB.byteLength,
          bytes: queuedLiveChunkB,
        },
        100 + queuedLiveChunkA.byteLength + queuedLiveChunkB.byteLength
      );
      await Promise.resolve();
    });

    expect(mockTerminal.write).not.toHaveBeenCalled();

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockTerminal.write.mock.calls.map(([written]) => written)).toEqual([
        snapshotChunk,
        queuedLiveChunkA,
        queuedLiveChunkB,
      ]);
    });
    expect(mockTerminal.reset).toHaveBeenCalledTimes(1);

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("still sends xterm query responses for queued supervisor-style live chunks flushed after snapshot hydration", async () => {
    const store = createStore();
    const snapshotChunk = new TextEncoder().encode("snapshot\n");
    const queuedLiveChunk = new TextEncoder().encode(
      "\x1b[200~[Supervisor] continue with the next fix\x1b[201~\r\x1b[6n"
    );
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.snapshot") {
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 904,
          size: snapshotChunk.byteLength,
          seq: 100,
          cols: 132,
          rows: 36,
          source: "headless",
          bytes: snapshotChunk,
        } satisfies TerminalSnapshotPayload);
      }

      return Promise.resolve({ status: "ok" });
    });
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);
    let subscriptionHandler: ((topic: string, payload: unknown, seq: number) => void) | undefined;
    const subscribe = vi.fn((topics: string[], handler: typeof subscriptionHandler) => {
      subscriptionHandler = handler;
      return vi.fn();
    });
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;
    let onDataCallback: ((data: string) => void) | undefined;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;
    mockTerminal.onData.mockImplementation((callback: (data: string) => void) => {
      onDataCallback = callback;
      return vi.fn();
    });
    mockTerminal.write.mockImplementation((data: Uint8Array | string, callback?: () => void) => {
      if (data === queuedLiveChunk) {
        onDataCallback?.("\x1b[12;3R");
      }
      callback?.();
    });

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand,
      sendTerminalInput,
      subscribe,
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost
          terminalId="snapshot-flush-supervisor-terminal"
          workspaceId="test-workspace"
          terminalKind="agent"
        />
      </Provider>
    );

    await act(async () => {
      subscriptionHandler?.(
        Topics.terminalOutput("test-workspace", "snapshot-flush-supervisor-terminal"),
        {
          transport: "binary",
          streamId: 905,
          size: queuedLiveChunk.byteLength,
          bytes: queuedLiveChunk,
        },
        100 + queuedLiveChunk.byteLength
      );
      await Promise.resolve();
    });

    expect(mockTerminal.write).not.toHaveBeenCalled();

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockTerminal.write.mock.calls[0]?.[0]).toBe(snapshotChunk);
      expect(mockTerminal.write).toHaveBeenCalledWith(queuedLiveChunk, expect.any(Function));
    });
    await waitFor(() => {
      expect(sendTerminalInput).toHaveBeenCalledWith(
        "snapshot-flush-supervisor-terminal",
        new TextEncoder().encode("\x1b[12;3R"),
        "typing",
        undefined
      );
    });

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("does not keep suppressing terminal auto-responses after the effect remounts with an unfinished replay write", async () => {
    const store = createStore();
    const replayChunk = new TextEncoder().encode("historical output");
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.replay") {
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 903,
          size: replayChunk.byteLength,
          seq: replayChunk.byteLength,
          bytes: replayChunk,
        } satisfies TerminalReplayPayload);
      }

      return Promise.resolve({ status: "ok" });
    });
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);
    const subscribe = vi.fn(() => vi.fn());
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;
    let onDataCallback: ((data: string) => void) | undefined;
    let skipReplayWriteCompletion = true;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;
    mockTerminal.onData.mockImplementation((callback: (data: string) => void) => {
      onDataCallback = callback;
      return vi.fn();
    });
    mockTerminal.write.mockImplementation((data: Uint8Array | string, callback?: () => void) => {
      if (data === replayChunk && skipReplayWriteCompletion) {
        return;
      }
      callback?.();
    });

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand,
      sendTerminalInput,
      subscribe,
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="stuck-replay-depth-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockTerminal.write).toHaveBeenCalledWith(replayChunk, expect.any(Function));
    });

    skipReplayWriteCompletion = false;
    store.set(wsClientAtom, {
      sendCommand,
      sendTerminalInput,
      subscribe,
      getStatus: vi.fn(() => "disconnected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(mockTerminal.onData).toHaveBeenCalledTimes(2);
    });

    sendTerminalInput.mockClear();

    await act(async () => {
      onDataCallback?.("\x1b[12;3R");
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(sendTerminalInput).toHaveBeenCalledWith(
        "stuck-replay-depth-terminal",
        new TextEncoder().encode("\x1b[12;3R"),
        "typing",
        undefined
      );
    });

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("requests a replay from the last rendered seq when live output arrives with a seq gap", async () => {
    const store = createStore();
    const initialReplayChunk = new TextEncoder().encode("snapshot\n");
    const liveChunk = new TextEncoder().encode("tail\n");
    const gapReplayChunk = new TextEncoder().encode("missed\ntail\n");
    const sendCommand = vi.fn();
    let replayCount = 0;
    let gapReplayResolve: ((value: TerminalReplayPayload) => void) | undefined;
    let subscriptionHandler: ((topic: string, payload: unknown, seq: number) => void) | undefined;
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    sendCommand.mockImplementation((op: string) => {
      if (op === "terminal.replay") {
        replayCount += 1;

        if (replayCount === 1) {
          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 501,
            size: initialReplayChunk.byteLength,
            seq: 100,
            bytes: initialReplayChunk,
          } satisfies TerminalReplayPayload);
        }

        return new Promise((resolve) => {
          gapReplayResolve = resolve;
        });
      }

      return Promise.resolve({ status: "ok" });
    });

    const subscribe = vi.fn((topics: string[], handler: typeof subscriptionHandler) => {
      subscriptionHandler = handler;
      return vi.fn();
    });

    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="gap-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expectReplayCall(sendCommand, "gap-terminal", 0);
      expectTerminalWriteData(initialReplayChunk);
    });

    mockTerminal.write.mockClear();

    await act(async () => {
      subscriptionHandler?.(
        Topics.terminalOutput("test-workspace", "gap-terminal"),
        { transport: "binary", streamId: 502, size: liveChunk.byteLength, bytes: liveChunk },
        112
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expectReplayCall(sendCommand, "gap-terminal", 100);
    });
    expect(mockTerminal.write).not.toHaveBeenCalled();

    await act(async () => {
      gapReplayResolve?.({
        status: "ok",
        transport: "binary",
        streamId: 503,
        size: gapReplayChunk.byteLength,
        seq: 112,
        bytes: gapReplayChunk,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(replayCount).toBe(2);
      expectTerminalWriteData(gapReplayChunk);
    });

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("replays shell history again after websocket reconnect", async () => {
    const store = createStore();
    const firstReplayChunk = new TextEncoder().encode("first replay\n");
    const reconnectReplayChunk = new TextEncoder().encode("reconnected replay\n");
    const sendCommand = vi.fn();
    let replayCount = 0;
    let statusHandler:
      | ((
          status: "connecting" | "connected" | "disconnected" | "reconnecting" | "rejected"
        ) => void)
      | undefined;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    sendCommand.mockImplementation(
      (op: string, args: { terminalId?: string; lastSeq?: number }) => {
        if (op !== "terminal.replay") {
          return Promise.resolve({ status: "ok" });
        }

        replayCount += 1;
        if (replayCount === 1) {
          expect(args.lastSeq).toBe(0);
          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 900,
            size: firstReplayChunk.byteLength,
            seq: 100,
            bytes: firstReplayChunk,
          } satisfies TerminalReplayPayload);
        }

        expect(args.lastSeq).toBe(100);
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 901,
          size: reconnectReplayChunk.byteLength,
          seq: 120,
          bytes: reconnectReplayChunk,
        } satisfies TerminalReplayPayload);
      }
    );

    const subscribe = vi.fn(() => vi.fn());
    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn((handler: typeof statusHandler) => {
        statusHandler = handler;
        return () => {};
      }),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="reconnect-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockTerminal.write.mock.calls.some(([written]) => written === firstReplayChunk)).toBe(
        true
      );
    });

    await act(async () => {
      statusHandler?.("disconnected");
      statusHandler?.("reconnecting");
      statusHandler?.("connected");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        mockTerminal.write.mock.calls.some(([written]) => written === reconnectReplayChunk)
      ).toBe(true);
    });
    expect(replayCount).toBe(2);
  });

  it("replays shell history again after websocket reconnect before attempting snapshot recovery", async () => {
    const store = createStore();
    const firstSnapshot = new TextEncoder().encode("shell snapshot\n");
    const reconnectReplay = new TextEncoder().encode("shell replay after reconnect\n");
    const sendCommand = vi.fn();
    let snapshotCount = 0;
    let replayCount = 0;
    let statusHandler:
      | ((
          status: "connecting" | "connected" | "disconnected" | "reconnecting" | "rejected"
        ) => void)
      | undefined;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    sendCommand.mockImplementation(
      (op: string, args: { terminalId?: string; lastSeq?: number }) => {
        if (op === "terminal.snapshot") {
          snapshotCount += 1;
          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 945,
            size: firstSnapshot.byteLength,
            seq: 200,
            rows: 36,
            cols: 132,
            source: "headless",
            bytes: firstSnapshot,
          } satisfies TerminalSnapshotPayload);
        }

        if (op === "terminal.replay") {
          replayCount += 1;
          expect(args.lastSeq).toBe(200);
          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 946,
            size: reconnectReplay.byteLength,
            seq: 240,
            bytes: reconnectReplay,
          } satisfies TerminalReplayPayload);
        }

        return Promise.resolve({ status: "ok" });
      }
    );

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => vi.fn()),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn((handler: typeof statusHandler) => {
        statusHandler = handler;
        return () => {};
      }),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost
          terminalId="shell-reconnect-terminal"
          workspaceId="test-workspace"
          terminalKind="shell"
        />
      </Provider>
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockTerminal.write.mock.calls.some(([written]) => written === firstSnapshot)).toBe(
        true
      );
    });

    await act(async () => {
      statusHandler?.("disconnected");
      statusHandler?.("reconnecting");
      statusHandler?.("connected");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockTerminal.write.mock.calls.some(([written]) => written === reconnectReplay)).toBe(
        true
      );
    });
    expect(snapshotCount).toBe(1);
    expect(replayCount).toBe(1);
  });

  it("replays agent history again after websocket reconnect before attempting snapshot recovery", async () => {
    const store = createStore();
    const firstSnapshot = new TextEncoder().encode("agent snapshot\n");
    const reconnectReplay = new TextEncoder().encode("agent replay after reconnect\n");
    const sendCommand = vi.fn();
    let snapshotCount = 0;
    let replayCount = 0;
    let statusHandler:
      | ((
          status: "connecting" | "connected" | "disconnected" | "reconnecting" | "rejected"
        ) => void)
      | undefined;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    sendCommand.mockImplementation(
      (op: string, args: { terminalId?: string; lastSeq?: number }) => {
        if (op === "terminal.snapshot") {
          snapshotCount += 1;
          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 950,
            size: firstSnapshot.byteLength,
            seq: 200,
            rows: 36,
            cols: 132,
            source: "headless",
            bytes: firstSnapshot,
          } satisfies TerminalSnapshotPayload);
        }

        if (op === "terminal.replay") {
          replayCount += 1;
          expect(args.lastSeq).toBe(200);
          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 951,
            size: reconnectReplay.byteLength,
            seq: 240,
            bytes: reconnectReplay,
          } satisfies TerminalReplayPayload);
        }

        return Promise.resolve({ status: "ok" });
      }
    );

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => vi.fn()),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn((handler: typeof statusHandler) => {
        statusHandler = handler;
        return () => {};
      }),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost
          terminalId="agent-reconnect-terminal"
          workspaceId="test-workspace"
          terminalKind="agent"
        />
      </Provider>
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockTerminal.write.mock.calls.some(([written]) => written === firstSnapshot)).toBe(
        true
      );
    });

    await act(async () => {
      statusHandler?.("disconnected");
      statusHandler?.("reconnecting");
      statusHandler?.("connected");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockTerminal.write.mock.calls.some(([written]) => written === reconnectReplay)).toBe(
        true
      );
    });
    expect(snapshotCount).toBe(1);
    expect(replayCount).toBe(1);
  });

  it("retries historical recovery after reconnect when the initial replay is interrupted by disconnect", async () => {
    const store = createStore();
    const recoveredChunk = new TextEncoder().encode("recovered after reconnect\n");
    let statusHandler:
      | ((
          status: "connecting" | "connected" | "disconnected" | "reconnecting" | "rejected"
        ) => void)
      | undefined;
    let rejectInitialReplay: ((error: Error) => void) | undefined;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op !== "terminal.replay") {
        return Promise.resolve({ status: "ok" });
      }

      if (
        sendCommand.mock.calls.filter(([calledOp]) => calledOp === "terminal.replay").length === 1
      ) {
        return new Promise((_, reject: (error: Error) => void) => {
          rejectInitialReplay = reject;
        });
      }

      return Promise.resolve({
        status: "ok",
        transport: "binary",
        streamId: 960,
        size: recoveredChunk.byteLength,
        seq: recoveredChunk.byteLength,
        bytes: recoveredChunk,
      } satisfies TerminalReplayPayload);
    });

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => vi.fn()),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn((handler: typeof statusHandler) => {
        statusHandler = handler;
        return () => {};
      }),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="interrupted-initial-replay" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expectReplayCall(sendCommand, "interrupted-initial-replay", 0);
    });

    await act(async () => {
      statusHandler?.("disconnected");
      statusHandler?.("reconnecting");
      rejectInitialReplay?.(new Error("WebSocket disconnected"));
      await Promise.resolve();
      await Promise.resolve();
      statusHandler?.("connected");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(sendCommand.mock.calls.filter(([op]) => op === "terminal.replay")).toHaveLength(2);
      expectTerminalWriteData(recoveredChunk);
    });

    consoleSpy.mockRestore();
  });

  it("retries the initial snapshot-first recovery after reconnect when hydration is interrupted before the first baseline completes", async () => {
    const store = createStore();
    const recoveredSnapshot = new TextEncoder().encode("recovered snapshot after reconnect\n");
    let statusHandler:
      | ((
          status: "connecting" | "connected" | "disconnected" | "reconnecting" | "rejected"
        ) => void)
      | undefined;
    let connectionStatus:
      | "connecting"
      | "connected"
      | "disconnected"
      | "reconnecting"
      | "rejected" = "connected";
    let rejectInitialSnapshot: ((error: Error) => void) | undefined;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sendCommand = vi
      .fn()
      .mockImplementation((op: string, args: { terminalId?: string; lastSeq?: number }) => {
        if (op === "terminal.snapshot") {
          if (
            sendCommand.mock.calls.filter(([calledOp]) => calledOp === "terminal.snapshot")
              .length === 1
          ) {
            return new Promise((_, reject: (error: Error) => void) => {
              rejectInitialSnapshot = reject;
            });
          }

          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 962,
            size: recoveredSnapshot.byteLength,
            seq: 200,
            rows: 36,
            cols: 132,
            source: "headless",
            bytes: recoveredSnapshot,
          } satisfies TerminalSnapshotPayload);
        }

        if (op === "terminal.replay") {
          if (connectionStatus !== "connected") {
            return Promise.reject(new Error("WebSocket disconnected"));
          }
          throw new Error(
            `Unexpected replay request after reconnect during initial hydration: ${args.lastSeq}`
          );
        }

        return Promise.resolve({ status: "ok" });
      });

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => vi.fn()),
      getStatus: vi.fn(() => connectionStatus),
      onStatus: vi.fn((handler: typeof statusHandler) => {
        statusHandler = handler;
        return () => {};
      }),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="interrupted-initial-snapshot" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expectSnapshotCall(sendCommand, "interrupted-initial-snapshot");
    });

    await act(async () => {
      connectionStatus = "disconnected";
      statusHandler?.("disconnected");
      connectionStatus = "reconnecting";
      statusHandler?.("reconnecting");
      rejectInitialSnapshot?.(new Error("WebSocket disconnected"));
      await Promise.resolve();
      await Promise.resolve();
      connectionStatus = "connected";
      statusHandler?.("connected");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(sendCommand.mock.calls.filter(([op]) => op === "terminal.snapshot")).toHaveLength(2);
      expect(sendCommand.mock.calls.filter(([op]) => op === "terminal.replay")).toHaveLength(0);
      expect(sendCommand.mock.calls[1]?.[0]).toBe("terminal.snapshot");
      expectTerminalWriteData(recoveredSnapshot);
    });

    consoleSpy.mockRestore();
  });

  it("switches to reconnect replay after an initial snapshot succeeds late following a disconnect", async () => {
    const store = createStore();
    const initialSnapshot = new TextEncoder().encode("late initial snapshot\n");
    const reconnectReplay = new TextEncoder().encode("tail after late snapshot\n");
    let statusHandler:
      | ((
          status: "connecting" | "connected" | "disconnected" | "reconnecting" | "rejected"
        ) => void)
      | undefined;
    let connectionStatus:
      | "connecting"
      | "connected"
      | "disconnected"
      | "reconnecting"
      | "rejected" = "connected";
    let resolveInitialSnapshot: ((payload: TerminalSnapshotPayload) => void) | undefined;
    let snapshotCount = 0;
    let replayCount = 0;
    const sendCommand = vi
      .fn()
      .mockImplementation((op: string, args: { terminalId?: string; lastSeq?: number }) => {
        if (op === "terminal.snapshot") {
          snapshotCount += 1;
          if (snapshotCount === 1) {
            return new Promise((resolve: (payload: TerminalSnapshotPayload) => void) => {
              resolveInitialSnapshot = resolve;
            });
          }

          throw new Error("Initial recovery should not restart with snapshot after a late success");
        }

        if (op === "terminal.replay") {
          replayCount += 1;
          expect(args.lastSeq).toBe(200);
          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 963,
            size: reconnectReplay.byteLength,
            seq: 240,
            bytes: reconnectReplay,
          } satisfies TerminalReplayPayload);
        }

        return Promise.resolve({ status: "ok" });
      });

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => vi.fn()),
      getStatus: vi.fn(() => connectionStatus),
      onStatus: vi.fn((handler: typeof statusHandler) => {
        statusHandler = handler;
        return () => {};
      }),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="late-success-initial-snapshot" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expectSnapshotCall(sendCommand, "late-success-initial-snapshot");
    });

    await act(async () => {
      connectionStatus = "disconnected";
      statusHandler?.("disconnected");
      connectionStatus = "reconnecting";
      statusHandler?.("reconnecting");
      resolveInitialSnapshot?.({
        status: "ok",
        transport: "binary",
        streamId: 962,
        size: initialSnapshot.byteLength,
        seq: 200,
        rows: 36,
        cols: 132,
        source: "headless",
        bytes: initialSnapshot,
      } satisfies TerminalSnapshotPayload);
      await Promise.resolve();
      await Promise.resolve();
      connectionStatus = "connected";
      statusHandler?.("connected");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(snapshotCount).toBe(1);
      expect(replayCount).toBe(1);
      expectTerminalWriteData(initialSnapshot);
      expectTerminalWriteData(reconnectReplay);
    });
  });

  it("reconnect replay resumes from the last rendered seq instead of buffered live seq", async () => {
    const store = createStore();
    const initialReplayChunk = new TextEncoder().encode("initial replay\n");
    const liveBufferedChunk = new TextEncoder().encode("live but not yet painted\n");
    const reconnectChunk = new TextEncoder().encode("recovered tail\n");
    let statusHandler:
      | ((
          status: "connecting" | "connected" | "disconnected" | "reconnecting" | "rejected"
        ) => void)
      | undefined;
    let subscriptionHandler: ((topic: string, payload: unknown, seq: number) => void) | undefined;
    let replayCount = 0;
    const sendCommand = vi
      .fn()
      .mockImplementation((op: string, args: { terminalId?: string; lastSeq?: number }) => {
        if (op !== "terminal.replay") {
          return Promise.resolve({ status: "ok" });
        }

        replayCount += 1;
        if (replayCount === 1) {
          expect(args.lastSeq).toBe(0);
          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 970,
            size: initialReplayChunk.byteLength,
            seq: 100,
            bytes: initialReplayChunk,
          } satisfies TerminalReplayPayload);
        }

        expect(args.lastSeq).toBe(100);
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 971,
          size: reconnectChunk.byteLength,
          seq: 130,
          bytes: reconnectChunk,
        } satisfies TerminalReplayPayload);
      });

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn((topics: string[], handler: typeof subscriptionHandler) => {
        subscriptionHandler = handler;
        return vi.fn();
      }),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn((handler: typeof statusHandler) => {
        statusHandler = handler;
        return () => {};
      }),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="rendered-seq-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expectTerminalWriteData(initialReplayChunk);
    });

    await act(async () => {
      subscriptionHandler?.(
        Topics.terminalOutput("test-workspace", "rendered-seq-terminal"),
        {
          transport: "binary",
          streamId: 972,
          size: liveBufferedChunk.byteLength,
          bytes: liveBufferedChunk,
        },
        120
      );
      statusHandler?.("disconnected");
      statusHandler?.("reconnecting");
      statusHandler?.("connected");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(replayCount).toBe(2);
      expectTerminalWriteData(reconnectChunk);
    });
  });

  it("does not advance rendered seq for reconnect recovery until the live write callback completes", async () => {
    const store = createStore();
    const initialReplayChunk = new TextEncoder().encode("initial replay\n");
    const delayedLiveChunk = new TextEncoder().encode("delayed live chunk\n");
    const reconnectChunk = new TextEncoder().encode("recovered after delayed live\n");
    let statusHandler:
      | ((
          status: "connecting" | "connected" | "disconnected" | "reconnecting" | "rejected"
        ) => void)
      | undefined;
    let subscriptionHandler: ((topic: string, payload: unknown, seq: number) => void) | undefined;
    let replayCount = 0;
    let releaseDelayedWrite: (() => void) | undefined;

    mockTerminal.write.mockImplementation((data: Uint8Array | string, callback?: () => void) => {
      if (data === delayedLiveChunk) {
        releaseDelayedWrite = callback;
        return;
      }
      callback?.();
    });

    const sendCommand = vi
      .fn()
      .mockImplementation((op: string, args: { terminalId?: string; lastSeq?: number }) => {
        if (op !== "terminal.replay") {
          return Promise.resolve({ status: "ok" });
        }

        replayCount += 1;
        if (replayCount === 1) {
          expect(args.lastSeq).toBe(0);
          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 973,
            size: initialReplayChunk.byteLength,
            seq: 100,
            bytes: initialReplayChunk,
          } satisfies TerminalReplayPayload);
        }

        expect(args.lastSeq).toBe(100);
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 974,
          size: reconnectChunk.byteLength,
          seq: 140,
          bytes: reconnectChunk,
        } satisfies TerminalReplayPayload);
      });

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn((topics: string[], handler: typeof subscriptionHandler) => {
        subscriptionHandler = handler;
        return vi.fn();
      }),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn((handler: typeof statusHandler) => {
        statusHandler = handler;
        return () => {};
      }),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="delayed-rendered-seq-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expectTerminalWriteData(initialReplayChunk);
    });

    await act(async () => {
      subscriptionHandler?.(
        Topics.terminalOutput("test-workspace", "delayed-rendered-seq-terminal"),
        {
          transport: "binary",
          streamId: 975,
          size: delayedLiveChunk.byteLength,
          bytes: delayedLiveChunk,
        },
        100 + delayedLiveChunk.byteLength
      );
      await Promise.resolve();
    });

    expect(typeof releaseDelayedWrite).toBe("function");

    await act(async () => {
      statusHandler?.("disconnected");
      statusHandler?.("reconnecting");
      statusHandler?.("connected");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(replayCount).toBe(2);
      expectTerminalWriteData(reconnectChunk);
    });
  });

  it("replays terminal history when websocket recovery succeeds without a status transition", async () => {
    const store = createStore();
    const initialReplayChunk = new TextEncoder().encode("initial replay\n");
    const recoveredReplayChunk = new TextEncoder().encode("recovered after probe\n");
    let replayCount = 0;
    const sendCommand = vi
      .fn()
      .mockImplementation((op: string, args: { terminalId?: string; lastSeq?: number }) => {
        if (op === "recovery.reconcile") {
          if (
            sendCommand.mock.calls.filter(([calledOp]) => calledOp === "recovery.reconcile")
              .length === 1
          ) {
            return Promise.resolve({
              terminals: [
                {
                  terminalId: "probe-recovery-terminal",
                  action: "replay",
                  fromSeq: 0,
                  headSeq: 100,
                },
              ],
            });
          }

          return Promise.resolve({
            terminals: [
              {
                terminalId: "probe-recovery-terminal",
                action: "replay",
                fromSeq: 100,
                headSeq: 126,
              },
            ],
          });
        }

        if (op !== "terminal.replay") {
          return Promise.resolve({ status: "ok" });
        }

        replayCount += 1;
        if (replayCount === 1) {
          expect(args.lastSeq).toBe(0);
          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 980,
            size: initialReplayChunk.byteLength,
            seq: 100,
            bytes: initialReplayChunk,
          } satisfies TerminalReplayPayload);
        }

        expect(args.lastSeq).toBe(100);
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 981,
          size: recoveredReplayChunk.byteLength,
          seq: 126,
          bytes: recoveredReplayChunk,
        } satisfies TerminalReplayPayload);
      });

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => vi.fn()),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
      probeConnection: vi.fn().mockResolvedValue({ ok: true }),
    } as never);

    setGlobalRecoveryCoordinator(
      createRecoveryCoordinator({
        wsClient: {
          getStatus: vi.fn(() => "connected"),
          probeConnection: vi.fn().mockResolvedValue({ ok: true }),
          onStatus: vi.fn(() => () => {}),
          subscribe: vi.fn(() => () => {}),
        } as never,
        sendCommand: async (op, args, options) => {
          try {
            const data = await sendCommand(op, args, options);
            return { ok: true, data };
          } catch (error) {
            return {
              ok: false,
              error: {
                code: "command_error",
                message: error instanceof Error ? error.message : String(error),
              },
            };
          }
        },
        applyReplay: vi.fn(),
        applySnapshot: vi.fn(),
      })
    );

    render(
      <Provider store={store}>
        <XtermHost terminalId="probe-recovery-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expectTerminalWriteData(initialReplayChunk);
    });

    await act(async () => {
      await getGlobalRecoveryCoordinator()?.notifyReason(
        "network_online",
        "probe-recovery-terminal"
      );
    });

    await waitFor(() => {
      expect(replayCount).toBe(2);
      expectTerminalWriteData(recoveredReplayChunk);
    });
  });

  it("waits for reconnect replay bytes to finish rendering before starting another reconnect recovery", async () => {
    const store = createStore();
    const initialReplayChunk = new TextEncoder().encode("initial replay\n");
    const delayedReconnectReplay = new TextEncoder().encode("delayed reconnect replay\n");
    const laterReconnectChunk = new TextEncoder().encode("later reconnect recovery\n");
    let statusHandler:
      | ((
          status: "connecting" | "connected" | "disconnected" | "reconnecting" | "rejected"
        ) => void)
      | undefined;
    let replayCount = 0;
    let releaseDelayedReconnectWrite: (() => void) | undefined;

    mockTerminal.write.mockImplementation((data: Uint8Array | string, callback?: () => void) => {
      if (data === delayedReconnectReplay) {
        releaseDelayedReconnectWrite = callback;
        return;
      }
      callback?.();
    });

    const sendCommand = vi
      .fn()
      .mockImplementation((op: string, args: { terminalId?: string; lastSeq?: number }) => {
        if (op !== "terminal.replay") {
          return Promise.resolve({ status: "ok" });
        }

        replayCount += 1;
        if (replayCount === 1) {
          expect(args.lastSeq).toBe(0);
          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 974,
            size: initialReplayChunk.byteLength,
            seq: 100,
            bytes: initialReplayChunk,
          } satisfies TerminalReplayPayload);
        }

        if (replayCount === 2) {
          expect(args.lastSeq).toBe(100);
          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 975,
            size: delayedReconnectReplay.byteLength,
            seq: 200,
            bytes: delayedReconnectReplay,
          } satisfies TerminalReplayPayload);
        }

        expect(args.lastSeq).toBe(200);
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 976,
          size: laterReconnectChunk.byteLength,
          seq: 240,
          bytes: laterReconnectChunk,
        } satisfies TerminalReplayPayload);
      });

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => vi.fn()),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn((handler: typeof statusHandler) => {
        statusHandler = handler;
        return () => {};
      }),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="delayed-reconnect-replay-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expectTerminalWriteData(initialReplayChunk);
    });

    await act(async () => {
      statusHandler?.("disconnected");
      statusHandler?.("reconnecting");
      statusHandler?.("connected");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(replayCount).toBe(2);
      expectTerminalWriteData(delayedReconnectReplay);
    });

    expect(typeof releaseDelayedReconnectWrite).toBe("function");

    await act(async () => {
      statusHandler?.("disconnected");
      statusHandler?.("reconnecting");
      statusHandler?.("connected");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(replayCount).toBe(2);

    await act(async () => {
      releaseDelayedReconnectWrite?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(replayCount).toBe(3);
      expectTerminalWriteData(laterReconnectChunk);
    });
  });

  it("queues probe-triggered recovery that arrives while historical recovery writes are still in flight", async () => {
    const store = createStore();
    const initialReplayChunk = new TextEncoder().encode("initial replay\n");
    const delayedReconnectReplay = new TextEncoder().encode("delayed reconnect replay\n");
    const queuedProbeReplay = new TextEncoder().encode("queued probe recovery\n");
    let replayCount = 0;
    let releaseDelayedReconnectWrite: (() => void) | undefined;

    mockTerminal.write.mockImplementation((data: Uint8Array | string, callback?: () => void) => {
      if (data === delayedReconnectReplay) {
        releaseDelayedReconnectWrite = callback;
        return;
      }
      callback?.();
    });

    const sendCommand = vi
      .fn()
      .mockImplementation((op: string, args: { terminalId?: string; lastSeq?: number }) => {
        if (op === "recovery.reconcile") {
          const reconcileCount = sendCommand.mock.calls.filter(
            ([calledOp]) => calledOp === "recovery.reconcile"
          ).length;

          if (reconcileCount === 1) {
            return Promise.resolve({
              terminals: [
                {
                  terminalId: "queued-probe-recovery-terminal",
                  action: "replay",
                  fromSeq: 0,
                  headSeq: 100,
                },
              ],
            });
          }

          if (reconcileCount === 2) {
            return Promise.resolve({
              terminals: [
                {
                  terminalId: "queued-probe-recovery-terminal",
                  action: "replay",
                  fromSeq: 100,
                  headSeq: 200,
                },
              ],
            });
          }

          return Promise.resolve({
            terminals: [
              {
                terminalId: "queued-probe-recovery-terminal",
                action: "replay",
                fromSeq: 200,
                headSeq: 240,
              },
            ],
          });
        }

        if (op !== "terminal.replay") {
          return Promise.resolve({ status: "ok" });
        }

        replayCount += 1;
        if (replayCount === 1) {
          expect(args.lastSeq).toBe(0);
          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 982,
            size: initialReplayChunk.byteLength,
            seq: 100,
            bytes: initialReplayChunk,
          } satisfies TerminalReplayPayload);
        }

        if (replayCount === 2) {
          expect(args.lastSeq).toBe(100);
          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 983,
            size: delayedReconnectReplay.byteLength,
            seq: 200,
            bytes: delayedReconnectReplay,
          } satisfies TerminalReplayPayload);
        }

        expect(args.lastSeq).toBe(200);
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 984,
          size: queuedProbeReplay.byteLength,
          seq: 240,
          bytes: queuedProbeReplay,
        } satisfies TerminalReplayPayload);
      });

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => vi.fn()),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
      probeConnection: vi.fn().mockResolvedValue({ ok: true }),
    } as never);

    setGlobalRecoveryCoordinator(
      createRecoveryCoordinator({
        wsClient: {
          getStatus: vi.fn(() => "connected"),
          probeConnection: vi.fn().mockResolvedValue({ ok: true }),
          onStatus: vi.fn(() => () => {}),
          subscribe: vi.fn(() => () => {}),
        } as never,
        sendCommand: async (op, args, options) => {
          try {
            const data = await sendCommand(op, args, options);
            return { ok: true, data };
          } catch (error) {
            return {
              ok: false,
              error: {
                code: "command_error",
                message: error instanceof Error ? error.message : String(error),
              },
            };
          }
        },
        applyReplay: vi.fn(),
        applySnapshot: vi.fn(),
      })
    );

    render(
      <Provider store={store}>
        <XtermHost terminalId="queued-probe-recovery-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expectTerminalWriteData(initialReplayChunk);
    });

    await act(async () => {
      void getGlobalRecoveryCoordinator()?.notifyReason(
        "network_online",
        "queued-probe-recovery-terminal"
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(replayCount).toBe(2);
      expectTerminalWriteData(delayedReconnectReplay);
    });

    expect(typeof releaseDelayedReconnectWrite).toBe("function");

    await act(async () => {
      void getGlobalRecoveryCoordinator()?.notifyReason(
        "foreground_resume",
        "queued-probe-recovery-terminal"
      );
      await Promise.resolve();
    });

    expect(replayCount).toBe(2);

    await act(async () => {
      releaseDelayedReconnectWrite?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(replayCount).toBe(3);
      expectTerminalWriteData(queuedProbeReplay);
    });
  });

  it("uses the flushed pending chunk seq for a later reconnect after a successful recovery", async () => {
    const store = createStore();
    const initialReplayChunk = new TextEncoder().encode("initial replay\n");
    const bufferedLiveChunk = new TextEncoder().encode("buffered during reconnect\n");
    const firstReconnectChunk = new TextEncoder().encode("first reconnect recovery\n");
    const secondReconnectChunk = new TextEncoder().encode("second reconnect recovery\n");
    let statusHandler:
      | ((
          status: "connecting" | "connected" | "disconnected" | "reconnecting" | "rejected"
        ) => void)
      | undefined;
    let subscriptionHandler: ((topic: string, payload: unknown, seq: number) => void) | undefined;
    let replayCount = 0;
    let resolveFirstReconnectReplay: ((payload: TerminalReplayPayload) => void) | undefined;
    const sendCommand = vi
      .fn()
      .mockImplementation((op: string, args: { terminalId?: string; lastSeq?: number }) => {
        if (op !== "terminal.replay") {
          return Promise.resolve({ status: "ok" });
        }

        replayCount += 1;
        if (replayCount === 1) {
          expect(args.lastSeq).toBe(0);
          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 976,
            size: initialReplayChunk.byteLength,
            seq: 100,
            bytes: initialReplayChunk,
          } satisfies TerminalReplayPayload);
        }

        if (replayCount === 2) {
          expect(args.lastSeq).toBe(100);
          return new Promise((resolve: (payload: TerminalReplayPayload) => void) => {
            resolveFirstReconnectReplay = resolve;
          });
        }

        expect(args.lastSeq).toBe(200 + bufferedLiveChunk.byteLength);
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 978,
          size: secondReconnectChunk.byteLength,
          seq: 260,
          bytes: secondReconnectChunk,
        } satisfies TerminalReplayPayload);
      });

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn((topics: string[], handler: typeof subscriptionHandler) => {
        subscriptionHandler = handler;
        return vi.fn();
      }),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn((handler: typeof statusHandler) => {
        statusHandler = handler;
        return () => {};
      }),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="flush-pending-seq-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expectTerminalWriteData(initialReplayChunk);
    });

    await act(async () => {
      statusHandler?.("disconnected");
      statusHandler?.("reconnecting");
      statusHandler?.("connected");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(replayCount).toBe(2);
    });

    await act(async () => {
      subscriptionHandler?.(
        Topics.terminalOutput("test-workspace", "flush-pending-seq-terminal"),
        {
          transport: "binary",
          streamId: 979,
          size: bufferedLiveChunk.byteLength,
          bytes: bufferedLiveChunk,
        },
        200 + bufferedLiveChunk.byteLength
      );
      await Promise.resolve();
      await Promise.resolve();
      resolveFirstReconnectReplay?.({
        status: "ok",
        transport: "binary",
        streamId: 977,
        size: firstReconnectChunk.byteLength,
        seq: 200,
        bytes: firstReconnectChunk,
      } satisfies TerminalReplayPayload);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expectTerminalWriteData(firstReconnectChunk);
      expectTerminalWriteData(bufferedLiveChunk);
    });

    mockTerminal.write.mockClear();

    await act(async () => {
      statusHandler?.("disconnected");
      statusHandler?.("reconnecting");
      statusHandler?.("connected");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(replayCount).toBe(3);
      expectTerminalWriteData(secondReconnectChunk);
    });
  });

  it("waits for flushed reconnect bytes to finish rendering before starting another reconnect recovery", async () => {
    const store = createStore();
    const initialReplayChunk = new TextEncoder().encode("initial replay\n");
    const delayedBufferedChunk = new TextEncoder().encode("delayed buffered during reconnect\n");
    const firstReconnectChunk = new TextEncoder().encode("first reconnect recovery\n");
    const secondReconnectChunk = new TextEncoder().encode("second reconnect recovery\n");
    let statusHandler:
      | ((
          status: "connecting" | "connected" | "disconnected" | "reconnecting" | "rejected"
        ) => void)
      | undefined;
    let subscriptionHandler: ((topic: string, payload: unknown, seq: number) => void) | undefined;
    let replayCount = 0;
    let resolveFirstReconnectReplay: ((payload: TerminalReplayPayload) => void) | undefined;
    let releaseDelayedBufferedWrite: (() => void) | undefined;

    mockTerminal.write.mockImplementation((data: Uint8Array | string, callback?: () => void) => {
      if (data === delayedBufferedChunk) {
        releaseDelayedBufferedWrite = callback;
        return;
      }
      callback?.();
    });

    const sendCommand = vi
      .fn()
      .mockImplementation((op: string, args: { terminalId?: string; lastSeq?: number }) => {
        if (op !== "terminal.replay") {
          return Promise.resolve({ status: "ok" });
        }

        replayCount += 1;
        if (replayCount === 1) {
          expect(args.lastSeq).toBe(0);
          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 977,
            size: initialReplayChunk.byteLength,
            seq: 100,
            bytes: initialReplayChunk,
          } satisfies TerminalReplayPayload);
        }

        if (replayCount === 2) {
          expect(args.lastSeq).toBe(100);
          return new Promise((resolve: (payload: TerminalReplayPayload) => void) => {
            resolveFirstReconnectReplay = resolve;
          });
        }

        expect(args.lastSeq).toBe(200 + delayedBufferedChunk.byteLength);
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 979,
          size: secondReconnectChunk.byteLength,
          seq: 260,
          bytes: secondReconnectChunk,
        } satisfies TerminalReplayPayload);
      });

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn((topics: string[], handler: typeof subscriptionHandler) => {
        subscriptionHandler = handler;
        return vi.fn();
      }),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn((handler: typeof statusHandler) => {
        statusHandler = handler;
        return () => {};
      }),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="delayed-flushed-reconnect-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await waitFor(() => {
      expectTerminalWriteData(initialReplayChunk);
    });

    await act(async () => {
      statusHandler?.("disconnected");
      statusHandler?.("reconnecting");
      statusHandler?.("connected");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(replayCount).toBe(2);
    });

    await act(async () => {
      subscriptionHandler?.(
        Topics.terminalOutput("test-workspace", "delayed-flushed-reconnect-terminal"),
        {
          transport: "binary",
          streamId: 978,
          size: delayedBufferedChunk.byteLength,
          bytes: delayedBufferedChunk,
        },
        200 + delayedBufferedChunk.byteLength
      );
      await Promise.resolve();
      await Promise.resolve();
      resolveFirstReconnectReplay?.({
        status: "ok",
        transport: "binary",
        streamId: 980,
        size: firstReconnectChunk.byteLength,
        seq: 200,
        bytes: firstReconnectChunk,
      } satisfies TerminalReplayPayload);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expectTerminalWriteData(firstReconnectChunk);
      expectTerminalWriteData(delayedBufferedChunk);
    });

    expect(typeof releaseDelayedBufferedWrite).toBe("function");

    await act(async () => {
      statusHandler?.("disconnected");
      statusHandler?.("reconnecting");
      statusHandler?.("connected");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(replayCount).toBe(2);

    await act(async () => {
      releaseDelayedBufferedWrite?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(replayCount).toBe(3);
      expectTerminalWriteData(secondReconnectChunk);
    });
  });

  it("falls back to snapshot on agent reconnect when replay history is too old", async () => {
    const store = createStore();
    const initialSnapshot = new TextEncoder().encode("initial snapshot\n");
    const reconnectSnapshot = new TextEncoder().encode("snapshot fallback baseline\n");
    let statusHandler:
      | ((
          status: "connecting" | "connected" | "disconnected" | "reconnecting" | "rejected"
        ) => void)
      | undefined;
    let snapshotCount = 0;
    const sendCommand = vi
      .fn()
      .mockImplementation((op: string, args: { terminalId?: string; lastSeq?: number }) => {
        if (op === "terminal.snapshot") {
          snapshotCount += 1;
          if (snapshotCount === 1) {
            return Promise.resolve({
              status: "ok",
              transport: "binary",
              streamId: 980,
              size: initialSnapshot.byteLength,
              seq: 200,
              rows: 36,
              cols: 132,
              source: "headless",
              bytes: initialSnapshot,
            } satisfies TerminalSnapshotPayload);
          }

          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 981,
            size: reconnectSnapshot.byteLength,
            seq: 240,
            rows: 36,
            cols: 132,
            source: "headless",
            bytes: reconnectSnapshot,
          } satisfies TerminalSnapshotPayload);
        }

        if (op === "terminal.replay") {
          expect(args.lastSeq).toBe(200);
          return Promise.resolve({
            status: "too_old",
          } satisfies TerminalReplayPayload);
        }

        return Promise.resolve({ status: "ok" });
      });

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => vi.fn()),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn((handler: typeof statusHandler) => {
        statusHandler = handler;
        return () => {};
      }),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost
          terminalId="agent-reconnect-fallback"
          workspaceId="test-workspace"
          terminalKind="agent"
        />
      </Provider>
    );

    await waitFor(() => {
      expectTerminalWriteData(initialSnapshot);
    });

    await act(async () => {
      statusHandler?.("disconnected");
      statusHandler?.("reconnecting");
      statusHandler?.("connected");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expectReplayCall(sendCommand, "agent-reconnect-fallback", 200);
      expectSnapshotCall(sendCommand, "agent-reconnect-fallback");
      expectTerminalWriteData(reconnectSnapshot);
    });
    expect(snapshotCount).toBe(2);
  });

  it("falls back to snapshot on shell reconnect when replay history is too old", async () => {
    const store = createStore();
    const initialSnapshot = new TextEncoder().encode("initial shell snapshot\n");
    const reconnectSnapshot = new TextEncoder().encode("shell snapshot fallback baseline\n");
    let statusHandler:
      | ((
          status: "connecting" | "connected" | "disconnected" | "reconnecting" | "rejected"
        ) => void)
      | undefined;
    let snapshotCount = 0;
    const sendCommand = vi
      .fn()
      .mockImplementation((op: string, args: { terminalId?: string; lastSeq?: number }) => {
        if (op === "terminal.snapshot") {
          snapshotCount += 1;
          if (snapshotCount === 1) {
            return Promise.resolve({
              status: "ok",
              transport: "binary",
              streamId: 982,
              size: initialSnapshot.byteLength,
              seq: 200,
              rows: 36,
              cols: 132,
              source: "headless",
              bytes: initialSnapshot,
            } satisfies TerminalSnapshotPayload);
          }

          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 983,
            size: reconnectSnapshot.byteLength,
            seq: 240,
            rows: 36,
            cols: 132,
            source: "headless",
            bytes: reconnectSnapshot,
          } satisfies TerminalSnapshotPayload);
        }

        if (op === "terminal.replay") {
          expect(args.lastSeq).toBe(200);
          return Promise.resolve({
            status: "too_old",
          } satisfies TerminalReplayPayload);
        }

        return Promise.resolve({ status: "ok" });
      });

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => vi.fn()),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn((handler: typeof statusHandler) => {
        statusHandler = handler;
        return () => {};
      }),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost
          terminalId="shell-reconnect-fallback"
          workspaceId="test-workspace"
          terminalKind="shell"
        />
      </Provider>
    );

    await waitFor(() => {
      expectTerminalWriteData(initialSnapshot);
    });

    await act(async () => {
      statusHandler?.("disconnected");
      statusHandler?.("reconnecting");
      statusHandler?.("connected");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expectReplayCall(sendCommand, "shell-reconnect-fallback", 200);
      expectSnapshotCall(sendCommand, "shell-reconnect-fallback");
      expectTerminalWriteData(reconnectSnapshot);
    });
    expect(snapshotCount).toBe(2);
  });

  it("falls back to snapshot on reconnect when replay recovery times out", async () => {
    const store = createStore();
    const initialSnapshot = new TextEncoder().encode("initial snapshot\n");
    const reconnectSnapshot = new TextEncoder().encode("reconnect snapshot after replay timeout\n");
    let statusHandler:
      | ((
          status: "connecting" | "connected" | "disconnected" | "reconnecting" | "rejected"
        ) => void)
      | undefined;
    let snapshotCount = 0;
    const sendCommand = vi
      .fn()
      .mockImplementation((op: string, args: { terminalId?: string; lastSeq?: number }) => {
        if (op === "terminal.snapshot") {
          snapshotCount += 1;
          if (snapshotCount === 1) {
            return Promise.resolve({
              status: "ok",
              transport: "binary",
              streamId: 984,
              size: initialSnapshot.byteLength,
              seq: 200,
              rows: 36,
              cols: 132,
              source: "headless",
              bytes: initialSnapshot,
            } satisfies TerminalSnapshotPayload);
          }

          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 985,
            size: reconnectSnapshot.byteLength,
            seq: 240,
            rows: 36,
            cols: 132,
            source: "headless",
            bytes: reconnectSnapshot,
          } satisfies TerminalSnapshotPayload);
        }

        if (op === "terminal.replay") {
          expect(args.lastSeq).toBe(200);
          return Promise.reject(new Error("Command timeout: terminal.replay"));
        }

        return Promise.resolve({ status: "ok" });
      });

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => vi.fn()),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn((handler: typeof statusHandler) => {
        statusHandler = handler;
        return () => {};
      }),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost
          terminalId="reconnect-replay-timeout-fallback"
          workspaceId="test-workspace"
          terminalKind="agent"
        />
      </Provider>
    );

    await waitFor(() => {
      expectTerminalWriteData(initialSnapshot);
    });

    await act(async () => {
      statusHandler?.("disconnected");
      statusHandler?.("reconnecting");
      statusHandler?.("connected");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expectReplayCall(sendCommand, "reconnect-replay-timeout-fallback", 200);
      expectSnapshotCall(sendCommand, "reconnect-replay-timeout-fallback");
      expectTerminalWriteData(reconnectSnapshot);
    });
    expect(snapshotCount).toBe(2);
  });

  it("retries reconnect recovery when replay fallback sees reconnecting before another reconnect status event is delivered", async () => {
    const store = createStore();
    const initialSnapshot = new TextEncoder().encode("initial snapshot\n");
    const recoveredReplay = new TextEncoder().encode("recovered after deferred reconnect\n");
    let statusHandler:
      | ((
          status: "connecting" | "connected" | "disconnected" | "reconnecting" | "rejected"
        ) => void)
      | undefined;
    let connectionStatus:
      | "connecting"
      | "connected"
      | "disconnected"
      | "reconnecting"
      | "rejected" = "connected";
    let rejectReconnectReplay: ((error: Error) => void) | undefined;
    let replayCount = 0;
    const getStatus = vi.fn(() => connectionStatus);
    const sendCommand = vi
      .fn()
      .mockImplementation((op: string, args: { terminalId?: string; lastSeq?: number }) => {
        if (op === "terminal.snapshot") {
          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 986,
            size: initialSnapshot.byteLength,
            seq: 200,
            rows: 36,
            cols: 132,
            source: "headless",
            bytes: initialSnapshot,
          } satisfies TerminalSnapshotPayload);
        }

        if (op === "terminal.replay") {
          replayCount += 1;
          expect(args.lastSeq).toBe(200);
          if (replayCount === 1) {
            return new Promise((_, reject: (error: Error) => void) => {
              rejectReconnectReplay = reject;
            });
          }

          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 987,
            size: recoveredReplay.byteLength,
            seq: 240,
            bytes: recoveredReplay,
          } satisfies TerminalReplayPayload);
        }

        return Promise.resolve({ status: "ok" });
      });

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => vi.fn()),
      getStatus,
      onStatus: vi.fn((handler: typeof statusHandler) => {
        statusHandler = handler;
        return () => {};
      }),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost
          terminalId="reconnect-status-race-terminal"
          workspaceId="test-workspace"
          terminalKind="agent"
        />
      </Provider>
    );

    await waitFor(() => {
      expectTerminalWriteData(initialSnapshot);
    });

    await act(async () => {
      connectionStatus = "disconnected";
      statusHandler?.("disconnected");
      connectionStatus = "reconnecting";
      statusHandler?.("reconnecting");
      connectionStatus = "connected";
      statusHandler?.("connected");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(replayCount).toBe(1);
    });

    const getStatusCallCountBeforeReject = getStatus.mock.calls.length;

    await act(async () => {
      connectionStatus = "reconnecting";
      rejectReconnectReplay?.(new Error("WebSocket disconnected"));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(getStatus.mock.calls.length).toBeGreaterThan(getStatusCallCountBeforeReject);
    });

    await act(async () => {
      connectionStatus = "connected";
      statusHandler?.("connected");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(replayCount).toBe(2);
      expectTerminalWriteData(recoveredReplay);
    });
  });

  it("resets the terminal before applying reconnect snapshot fallback so the baseline is not appended", async () => {
    const store = createStore();
    const initialSnapshot = new TextEncoder().encode("initial snapshot\n");
    const reconnectSnapshot = new TextEncoder().encode("reconnect baseline\n");
    const liveChunk = new TextEncoder().encode("live after initial load\n");
    let statusHandler:
      | ((
          status: "connecting" | "connected" | "disconnected" | "reconnecting" | "rejected"
        ) => void)
      | undefined;
    let subscriptionHandler: ((topic: string, payload: unknown, seq: number) => void) | undefined;
    mockTerminal.reset = vi.fn();
    const sendCommand = vi
      .fn()
      .mockImplementation((op: string, args: { terminalId?: string; lastSeq?: number }) => {
        if (op === "terminal.snapshot") {
          if (
            sendCommand.mock.calls.filter(([calledOp]) => calledOp === "terminal.snapshot")
              .length === 1
          ) {
            return Promise.resolve({
              status: "ok",
              transport: "binary",
              streamId: 990,
              size: initialSnapshot.byteLength,
              seq: 200,
              rows: 36,
              cols: 132,
              source: "headless",
              bytes: initialSnapshot,
            } satisfies TerminalSnapshotPayload);
          }

          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 991,
            size: reconnectSnapshot.byteLength,
            seq: 260,
            rows: 36,
            cols: 132,
            source: "headless",
            bytes: reconnectSnapshot,
          } satisfies TerminalSnapshotPayload);
        }

        if (op === "terminal.replay") {
          expect(args.lastSeq).toBe(220);
          return Promise.resolve({
            status: "too_old",
          } satisfies TerminalReplayPayload);
        }

        return Promise.resolve({ status: "ok" });
      });

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn((topics: string[], handler: typeof subscriptionHandler) => {
        subscriptionHandler = handler;
        return vi.fn();
      }),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn((handler: typeof statusHandler) => {
        statusHandler = handler;
        return () => {};
      }),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost
          terminalId="reconnect-snapshot-reset-terminal"
          workspaceId="test-workspace"
          terminalKind="agent"
        />
      </Provider>
    );

    await waitFor(() => {
      expectTerminalWriteData(initialSnapshot);
    });

    await act(async () => {
      subscriptionHandler?.(
        Topics.terminalOutput("test-workspace", "reconnect-snapshot-reset-terminal"),
        {
          transport: "binary",
          streamId: 992,
          size: liveChunk.byteLength,
          bytes: liveChunk,
        },
        220
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expectTerminalWriteData(liveChunk);
    });

    mockTerminal.write.mockClear();
    mockTerminal.reset.mockClear();

    await act(async () => {
      statusHandler?.("disconnected");
      statusHandler?.("reconnecting");
      statusHandler?.("connected");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expectReplayCall(sendCommand, "reconnect-snapshot-reset-terminal", 220);
      expectSnapshotCall(sendCommand, "reconnect-snapshot-reset-terminal");
      expect(mockTerminal.reset).toHaveBeenCalledTimes(1);
      expect(mockTerminal.write).toHaveBeenCalledTimes(1);
      expect(mockTerminal.write.mock.calls[0]?.[0]).toBe(reconnectSnapshot);
    });
  });

  it("waits for the first fit frame before writing replay output", async () => {
    const store = createStore();
    const replayChunk = new TextEncoder().encode("cursor addressed replay\n");
    const dispatchCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.replay") {
        return Promise.resolve({
          status: "ok",
          seq: 200,
          bytes: replayChunk,
        });
      }

      return Promise.resolve({ status: "ok" });
    });
    const subscribe = vi.fn(() => vi.fn());
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand: dispatchCommand,
      subscribe,
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="fit-gated-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockFitAddon.fit).not.toHaveBeenCalled();
    expect(mockTerminal.write.mock.calls.some(([written]) => written === replayChunk)).toBe(false);

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockFitAddon.fit).toHaveBeenCalled();
    await waitFor(() => {
      expectTerminalWriteData(replayChunk);
    });

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("waits for the initial PTY resize sync before requesting replay", async () => {
    const store = createStore();
    const dispatchCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.replay") {
        return Promise.resolve({ ok: true, data: { status: "ok", seq: 200 } });
      }

      return Promise.resolve({ ok: true, data: { status: "ok" } });
    });
    const subscribe = vi.fn(() => vi.fn());
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand: dispatchCommand,
      subscribe,
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="initial-resize-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(dispatchCommand).not.toHaveBeenCalledWith("terminal.replay", {
      terminalId: "initial-resize-terminal",
      lastSeq: 0,
    });

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expectResizeCall(dispatchCommand, "initial-resize-terminal", 132, 36);
      expectReplayCall(dispatchCommand, "initial-resize-terminal", 0);
    });

    const ops = dispatchCommand.mock.calls.map(([op]) => op);
    const resizeIndex = ops.indexOf("terminal.resize");
    const replayIndex = ops.indexOf("terminal.replay");
    expect(resizeIndex).toBeGreaterThanOrEqual(0);
    expect(replayIndex).toBeGreaterThan(resizeIndex);

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("waits for fonts to settle before the initial replay sync", async () => {
    const store = createStore();
    let resolveFontsReady: (() => void) | undefined;
    const fontsReady = new Promise<void>((resolve) => {
      resolveFontsReady = resolve;
    });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        ready: fontsReady,
      },
    });

    const dispatchCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.replay") {
        return Promise.resolve({ ok: true, data: { status: "ok", seq: 200 } });
      }

      return Promise.resolve({ ok: true, data: { status: "ok" } });
    });
    const subscribe = vi.fn(() => vi.fn());
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand: dispatchCommand,
      subscribe,
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="font-ready-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(dispatchCommand).not.toHaveBeenCalledWith("terminal.replay", {
      terminalId: "font-ready-terminal",
      lastSeq: 0,
    });
    expect(mockFitAddon.fit).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFontsReady?.();
      await Promise.resolve();
    });

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(32);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockFitAddon.fit).toHaveBeenCalledTimes(2);
      expectResizeCall(dispatchCommand, "font-ready-terminal", 132, 36);
      expectReplayCall(dispatchCommand, "font-ready-terminal", 0);
    });

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("attaches the resize observer after desktop hydration is granted", async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.snapshot") {
        return Promise.resolve({ status: "unsupported" });
      }

      if (op === "terminal.replay") {
        return Promise.resolve({ status: "ok", seq: 0 });
      }

      return Promise.resolve({ status: "ok" });
    });
    const subscribe = vi.fn(() => vi.fn());
    const observe = vi.fn();
    const disconnect = vi.fn();
    const originalResizeObserver = global.ResizeObserver;
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    hydrationCoordinatorMocks.autoGrant = false;
    mockTerminal.cols = 120;
    mockTerminal.rows = 32;

    class ResizeObserverMock {
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;

      constructor(_callback: ResizeObserverCallback) {}
    }

    global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="hydration-resize-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    expect(mockTerminal.open).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();

    await act(async () => {
      hydrationCoordinatorMocks.resolveGranted();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockTerminal.open).toHaveBeenCalledTimes(1);
    });

    expect(observe).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();

    global.ResizeObserver = originalResizeObserver;
    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("debounces resize-observer fits until resize settles", async () => {
    const store = createStore();
    const fontsReady = new Promise<void>(() => {});
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        ready: fontsReady,
      },
    });
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.snapshot") {
        return Promise.resolve({ status: "unsupported" });
      }

      if (op === "terminal.replay") {
        return Promise.resolve({ status: "ok", seq: 0 });
      }

      return Promise.resolve({ status: "ok" });
    });
    const subscribe = vi.fn(() => vi.fn());
    const originalResizeObserver = global.ResizeObserver;
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;
    let resizeObserverCallback: ResizeObserverCallback | null = null;

    hydrationCoordinatorMocks.autoGrant = false;
    mockTerminal.cols = 120;
    mockTerminal.rows = 32;

    class ResizeObserverMock {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();

      constructor(callback: ResizeObserverCallback) {
        resizeObserverCallback = callback;
      }
    }

    global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="debounced-resize-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      hydrationCoordinatorMocks.resolveGranted();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(resizeObserverCallback).toBeTypeOf("function");

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    mockFitAddon.fit.mockClear();

    act(() => {
      resizeObserverCallback?.([], {} as ResizeObserver);
      resizeObserverCallback?.([], {} as ResizeObserver);
      resizeObserverCallback?.([], {} as ResizeObserver);
    });

    act(() => {
      vi.advanceTimersByTime(149);
    });

    expect(mockFitAddon.fit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(mockFitAddon.fit).toHaveBeenCalledTimes(1);

    global.ResizeObserver = originalResizeObserver;
    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
    vi.useRealTimers();
  });

  it("waits for websocket connection before initial resize sync and snapshot recovery", async () => {
    const store = createStore();
    const snapshotChunk = new TextEncoder().encode("snapshot after connect\n");
    let connectionStatus: "connecting" | "connected" = "connecting";
    let statusListener: ((status: "connecting" | "connected") => void) | undefined;
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (connectionStatus !== "connected") {
        return Promise.reject(new Error("WebSocket not connected"));
      }

      if (op === "terminal.snapshot") {
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 401,
          size: snapshotChunk.byteLength,
          seq: 200,
          rows: 36,
          cols: 132,
          source: "headless",
          bytes: snapshotChunk,
        } satisfies TerminalSnapshotPayload);
      }

      return Promise.resolve({ status: "ok" });
    });
    const subscribe = vi.fn(() => vi.fn());
    const onStatus = vi.fn((listener: typeof statusListener) => {
      statusListener = listener;
      return vi.fn();
    });
    const getStatus = vi.fn(() => connectionStatus);
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
      onStatus,
      getStatus,
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="connect-gated-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendCommand).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(onStatus).toHaveBeenCalled();
      expect(typeof statusListener).toBe("function");
    });

    await act(async () => {
      connectionStatus = "connected";
      statusListener?.("connected");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expectResizeCall(sendCommand, "connect-gated-terminal", 132, 36);
      expectSnapshotCall(sendCommand, "connect-gated-terminal");
      expectTerminalWriteData(snapshotChunk);
    });
    expect(sendCommand.mock.calls.some(([op]) => op === "terminal.replay")).toBe(false);
    const ops = sendCommand.mock.calls.map(([op]) => op);
    const resizeIndex = ops.indexOf("terminal.resize");
    const snapshotIndex = ops.indexOf("terminal.snapshot");
    expect(resizeIndex).toBeGreaterThanOrEqual(0);
    expect(snapshotIndex).toBeGreaterThan(resizeIndex);

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("starts historical recovery after the websocket client becomes available post-mount", async () => {
    const store = createStore();
    const snapshotChunk = new TextEncoder().encode("snapshot after client attach\n");
    let connectionStatus: "connecting" | "connected" = "connecting";
    let statusListener: ((status: "connecting" | "connected") => void) | undefined;
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (connectionStatus !== "connected") {
        return Promise.reject(new Error("WebSocket not connected"));
      }

      if (op === "terminal.snapshot") {
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 402,
          size: snapshotChunk.byteLength,
          seq: 200,
          rows: 36,
          cols: 132,
          source: "headless",
          bytes: snapshotChunk,
        } satisfies TerminalSnapshotPayload);
      }

      return Promise.resolve({ status: "ok" });
    });
    const subscribe = vi.fn(() => vi.fn());
    const onStatus = vi.fn((listener: typeof statusListener) => {
      statusListener = listener;
      return vi.fn();
    });
    const getStatus = vi.fn(() => connectionStatus);
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    const { rerender } = render(
      <Provider store={store}>
        <XtermHost terminalId="late-client-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendCommand).not.toHaveBeenCalled();

    await act(async () => {
      store.set(wsClientAtom, {
        sendCommand,
        subscribe,
        onStatus,
        getStatus,
      } as never);

      rerender(
        <Provider store={store}>
          <XtermHost terminalId="late-client-terminal" workspaceId="test-workspace" />
        </Provider>
      );
      await Promise.resolve();
    });

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(onStatus).toHaveBeenCalled();
      expect(typeof statusListener).toBe("function");
    });

    await act(async () => {
      connectionStatus = "connected";
      statusListener?.("connected");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expectResizeCall(sendCommand, "late-client-terminal", 132, 36);
      expectSnapshotCall(sendCommand, "late-client-terminal");
      expectTerminalWriteData(snapshotChunk);
    });
    expect(sendCommand.mock.calls.some(([op]) => op === "terminal.replay")).toBe(false);
    const ops = sendCommand.mock.calls.map(([op]) => op);
    const resizeIndex = ops.indexOf("terminal.resize");
    const snapshotIndex = ops.indexOf("terminal.snapshot");
    expect(resizeIndex).toBeGreaterThanOrEqual(0);
    expect(snapshotIndex).toBeGreaterThan(resizeIndex);

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("recovers if the websocket connects during waitForConnected listener installation", async () => {
    const store = createStore();
    const snapshotChunk = new TextEncoder().encode("snapshot after connection race\n");
    let connectionStatus: "connecting" | "connected" = "connecting";
    let triggerConnectionRace = false;
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (connectionStatus !== "connected") {
        return Promise.reject(new Error("WebSocket not connected"));
      }

      if (op === "terminal.snapshot") {
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 403,
          size: snapshotChunk.byteLength,
          seq: 200,
          rows: 36,
          cols: 132,
          source: "headless",
          bytes: snapshotChunk,
        } satisfies TerminalSnapshotPayload);
      }

      return Promise.resolve({ status: "ok" });
    });
    const subscribe = vi.fn(() => vi.fn());
    const onStatus = vi.fn(() => {
      if (triggerConnectionRace) {
        connectionStatus = "connected";
        triggerConnectionRace = false;
      }
      return vi.fn();
    });
    const getStatus = vi.fn(() => connectionStatus);
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
      onStatus,
      getStatus,
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="connect-race-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      triggerConnectionRace = true;
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expectResizeCall(sendCommand, "connect-race-terminal", 132, 36);
      expectSnapshotCall(sendCommand, "connect-race-terminal");
      expectTerminalWriteData(snapshotChunk);
    });
    expect(sendCommand.mock.calls.some(([op]) => op === "terminal.replay")).toBe(false);
    const ops = sendCommand.mock.calls.map(([op]) => op);
    const resizeIndex = ops.indexOf("terminal.resize");
    const snapshotIndex = ops.indexOf("terminal.snapshot");
    expect(resizeIndex).toBeGreaterThanOrEqual(0);
    expect(snapshotIndex).toBeGreaterThan(resizeIndex);

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("ignores delayed replay results after unmount", async () => {
    const store = createStore();
    const replayChunk = new TextEncoder().encode("late replay after unmount\n");
    const dispatchCommand = vi.fn();
    let replayResolve: ((value: TerminalReplayPayload) => void) | undefined;
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    dispatchCommand.mockImplementation((op: string) => {
      if (op === "terminal.replay") {
        return new Promise((resolve) => {
          replayResolve = resolve;
        }).then((data) => ({ ok: true, data }));
      }

      return Promise.resolve({ ok: true, data: { status: "ok" } });
    });

    store.set(wsClientAtom, {
      sendCommand: dispatchCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);

    const { unmount } = render(
      <Provider store={store}>
        <XtermHost terminalId="unmount-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expectReplayCall(dispatchCommand, "unmount-terminal", 0);
    });

    unmount();

    await act(async () => {
      replayResolve?.({
        status: "ok",
        transport: "binary",
        streamId: 301,
        size: replayChunk.byteLength,
        bytes: replayChunk,
        seq: 10,
      });
      await Promise.resolve();
    });

    expect(mockTerminal.write).not.toHaveBeenCalledWith("late replay after unmount\n");

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("does not trigger a re-replay for sequential 1-byte live chunks after replay completes", async () => {
    const store = createStore();
    const initialReplayChunk = new TextEncoder().encode("");
    const sendCommand = vi.fn();
    let replayCount = 0;
    let subscriptionHandler: ((topic: string, payload: unknown, seq: number) => void) | undefined;
    const rafCallbacks: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    sendCommand.mockImplementation((op: string) => {
      if (op === "terminal.replay") {
        replayCount += 1;
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 700 + replayCount,
          size: initialReplayChunk.byteLength,
          seq: 100,
          bytes: initialReplayChunk,
        } satisfies TerminalReplayPayload);
      }

      return Promise.resolve({ status: "ok" });
    });

    const subscribe = vi.fn((topics: string[], handler: typeof subscriptionHandler) => {
      subscriptionHandler = handler;
      return vi.fn();
    });

    store.set(wsClientAtom, {
      sendCommand,
      subscribe,
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="typing-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expectReplayCall(sendCommand, "typing-terminal", 0);
    });

    expect(replayCount).toBe(1);
    mockTerminal.write.mockClear();

    // Simulate three sequential 1-byte echoes (e.g. PTY echoing typed
    // characters), each immediately following the previous in seq.
    const bytes = ["g", "i", "t"].map((ch) => new TextEncoder().encode(ch));
    let seq = 100;
    for (const chunk of bytes) {
      seq += chunk.byteLength;
      const localChunk = chunk;
      const localSeq = seq;
      await act(async () => {
        subscriptionHandler?.(
          Topics.terminalOutput("test-workspace", "typing-terminal"),
          {
            transport: "binary",
            streamId: 800 + localSeq,
            size: localChunk.byteLength,
            bytes: localChunk,
          },
          localSeq
        );
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    await waitFor(() => {
      expect(mockTerminal.write).toHaveBeenCalledTimes(bytes.length);
    });

    // No spurious re-replay should have fired - the live chunks were
    // contiguous with the snapshot's covered seq.
    expect(replayCount).toBe(1);
    expect(mockTerminal.write.mock.calls.map(([data]) => data)).toEqual(bytes);

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("bridges single-finger touch drags into xterm scroll on coarse pointers", () => {
    const originalMatchMedia = window.matchMedia;
    mockTerminal.rows = 20;
    mockTerminal.buffer.active.viewportY = 6;
    mockTerminal.buffer.active.baseY = 80;

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    const { container } = render(
      <JotaiProvider>
        <XtermHost terminalId="touch-scroll-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    const host = container.querySelector(".xterm-host");
    expect(host).toBeTruthy();

    const startEvent = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(startEvent, "touches", {
      value: [{ identifier: 1, clientY: 100 }],
    });
    Object.defineProperty(startEvent, "changedTouches", {
      value: [{ identifier: 1, clientY: 100 }],
    });

    const moveEvent = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(moveEvent, "touches", {
      value: [{ identifier: 1, clientY: 68 }],
    });
    Object.defineProperty(moveEvent, "changedTouches", {
      value: [{ identifier: 1, clientY: 68 }],
    });

    host?.dispatchEvent(startEvent);
    host?.dispatchEvent(moveEvent);

    expect(mockTerminal.scrollLines).toHaveBeenCalledWith(2);
    expect(mockTerminal.buffer.active.viewportY).toBe(8);

    window.matchMedia = originalMatchMedia;
  });

  it("continues coarse-pointer touch scrolling with momentum after release", () => {
    const originalMatchMedia = window.matchMedia;
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;
    const nowSpy = vi.spyOn(performance, "now");
    mockTerminal.rows = 20;
    mockTerminal.buffer.active.viewportY = 6;
    mockTerminal.buffer.active.baseY = 80;

    let now = 0;
    nowSpy.mockImplementation(() => now);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    const rafCallbacks: FrameRequestCallback[] = [];
    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    const { container } = render(
      <JotaiProvider>
        <XtermHost terminalId="touch-momentum-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    const host = container.querySelector(".xterm-host");
    expect(host).toBeTruthy();

    const dispatchTouchEvent = (
      type: string,
      touches: Array<{ identifier: number; clientY: number }>,
      changedTouches: Array<{ identifier: number; clientY: number }> = touches
    ) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", { value: touches });
      Object.defineProperty(event, "changedTouches", { value: changedTouches });
      host?.dispatchEvent(event);
    };

    now = 0;
    dispatchTouchEvent("touchstart", [{ identifier: 1, clientY: 120 }]);

    now = 16;
    dispatchTouchEvent("touchmove", [{ identifier: 1, clientY: 88 }]);

    now = 32;
    dispatchTouchEvent("touchmove", [{ identifier: 1, clientY: 56 }]);

    expect(mockTerminal.buffer.active.viewportY).toBe(10);

    now = 32;
    dispatchTouchEvent("touchend", [], [{ identifier: 1, clientY: 56 }]);

    expect(rafCallbacks.length).toBeGreaterThan(0);

    const firstMomentumFrame = rafCallbacks[rafCallbacks.length - 1];
    expect(firstMomentumFrame).toBeTypeOf("function");

    now = 48;
    firstMomentumFrame?.(48);

    expect(mockTerminal.buffer.active.viewportY).toBeGreaterThan(10);

    window.matchMedia = originalMatchMedia;
    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("stops touch momentum when scrollback hits the bottom edge", () => {
    const originalMatchMedia = window.matchMedia;
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;
    const nowSpy = vi.spyOn(performance, "now");
    mockTerminal.rows = 20;
    mockTerminal.buffer.active.viewportY = 78;
    mockTerminal.buffer.active.baseY = 80;

    let now = 0;
    nowSpy.mockImplementation(() => now);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    const rafCallbacks: FrameRequestCallback[] = [];
    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    const { container } = render(
      <JotaiProvider>
        <XtermHost terminalId="touch-momentum-boundary-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    const host = container.querySelector(".xterm-host");
    expect(host).toBeTruthy();

    const dispatchTouchEvent = (
      type: string,
      touches: Array<{ identifier: number; clientY: number }>,
      changedTouches: Array<{ identifier: number; clientY: number }> = touches
    ) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", { value: touches });
      Object.defineProperty(event, "changedTouches", { value: changedTouches });
      host?.dispatchEvent(event);
    };

    now = 0;
    dispatchTouchEvent("touchstart", [{ identifier: 1, clientY: 120 }]);

    now = 16;
    dispatchTouchEvent("touchmove", [{ identifier: 1, clientY: 88 }]);

    now = 32;
    dispatchTouchEvent("touchend", [], [{ identifier: 1, clientY: 88 }]);

    const firstMomentumFrame = rafCallbacks[rafCallbacks.length - 1];
    expect(firstMomentumFrame).toBeTypeOf("function");

    now = 48;
    firstMomentumFrame?.(48);

    expect(mockTerminal.buffer.active.viewportY).toBe(80);
    expect(global.cancelAnimationFrame).toHaveBeenCalled();

    window.matchMedia = originalMatchMedia;
    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("cancels touch momentum when a new touch starts", () => {
    const originalMatchMedia = window.matchMedia;
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;
    const nowSpy = vi.spyOn(performance, "now");
    mockTerminal.rows = 20;
    mockTerminal.buffer.active.viewportY = 6;
    mockTerminal.buffer.active.baseY = 80;

    let now = 0;
    nowSpy.mockImplementation(() => now);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    const rafCallbacks: FrameRequestCallback[] = [];
    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    const { container } = render(
      <JotaiProvider>
        <XtermHost terminalId="touch-momentum-cancel-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    const host = container.querySelector(".xterm-host");
    expect(host).toBeTruthy();

    const dispatchTouchEvent = (
      type: string,
      touches: Array<{ identifier: number; clientY: number }>,
      changedTouches: Array<{ identifier: number; clientY: number }> = touches
    ) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", { value: touches });
      Object.defineProperty(event, "changedTouches", { value: changedTouches });
      host?.dispatchEvent(event);
    };

    now = 0;
    dispatchTouchEvent("touchstart", [{ identifier: 1, clientY: 120 }]);

    now = 16;
    dispatchTouchEvent("touchmove", [{ identifier: 1, clientY: 88 }]);

    now = 32;
    dispatchTouchEvent("touchend", [], [{ identifier: 1, clientY: 88 }]);

    const firstMomentumFrame = rafCallbacks[rafCallbacks.length - 1];
    expect(firstMomentumFrame).toBeTypeOf("function");

    dispatchTouchEvent("touchstart", [{ identifier: 2, clientY: 200 }]);

    const viewportBeforeCanceledFrame = mockTerminal.buffer.active.viewportY;
    now = 48;
    firstMomentumFrame?.(48);

    expect(mockTerminal.buffer.active.viewportY).toBe(viewportBeforeCanceledFrame);
    expect(global.cancelAnimationFrame).toHaveBeenCalled();

    window.matchMedia = originalMatchMedia;
    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("measures touch line height once per gesture and reuses it for momentum", () => {
    const originalMatchMedia = window.matchMedia;
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;
    const nowSpy = vi.spyOn(performance, "now");
    mockTerminal.rows = 20;
    mockTerminal.buffer.active.viewportY = 6;
    mockTerminal.buffer.active.baseY = 80;

    let now = 0;
    nowSpy.mockImplementation(() => now);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    const rafCallbacks: FrameRequestCallback[] = [];
    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    const { container } = render(
      <JotaiProvider>
        <XtermHost terminalId="touch-line-height-cache-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    const host = container.querySelector(".xterm-host") as HTMLDivElement | null;
    expect(host).toBeTruthy();

    const rectSpy = vi.spyOn(host!, "getBoundingClientRect").mockReturnValue({
      width: 320,
      height: 160,
      top: 0,
      right: 320,
      bottom: 160,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    rectSpy.mockClear();

    const dispatchTouchEvent = (
      type: string,
      touches: Array<{ identifier: number; clientY: number }>,
      changedTouches: Array<{ identifier: number; clientY: number }> = touches
    ) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", { value: touches });
      Object.defineProperty(event, "changedTouches", { value: changedTouches });
      host?.dispatchEvent(event);
    };

    now = 0;
    dispatchTouchEvent("touchstart", [{ identifier: 1, clientY: 120 }]);

    now = 16;
    dispatchTouchEvent("touchmove", [{ identifier: 1, clientY: 88 }]);

    now = 32;
    dispatchTouchEvent("touchmove", [{ identifier: 1, clientY: 56 }]);

    now = 32;
    dispatchTouchEvent("touchend", [], [{ identifier: 1, clientY: 56 }]);

    const firstMomentumFrame = rafCallbacks[rafCallbacks.length - 1];
    expect(firstMomentumFrame).toBeTypeOf("function");

    now = 48;
    firstMomentumFrame?.(48);

    expect(rectSpy).toHaveBeenCalledTimes(1);

    window.matchMedia = originalMatchMedia;
    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("mobile line copy copies a wrapped logical line after a stable long press when copy-on-select is enabled", async () => {
    vi.useFakeTimers();
    viewportMocks.viewport = "mobile";

    const originalMatchMedia = window.matchMedia;
    const writeText = vi.fn().mockResolvedValue(undefined);
    const vibrate = vi.fn();
    const store = createStore();

    mockTerminal.cols = 80;
    mockTerminal.rows = 3;
    mockTerminal.buffer.active.viewportY = 10;
    setMockBufferLines([
      [10, "prompt> ", false],
      [11, "echo hel", false],
      [12, "lo   ", true],
    ]);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText } satisfies Pick<Clipboard, "writeText">,
    });
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: vibrate,
    });

    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, {
      copyOnSelect: true,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ ok: true, data: { status: "ok" } }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
      sendTerminalInput: vi.fn().mockResolvedValue(undefined),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-line-copy-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const host = container.querySelector(".xterm-host") as HTMLDivElement | null;
    expect(host).toBeTruthy();

    const rowsElement = document.createElement("div");
    rowsElement.className = "xterm-rows";

    const firstRow = document.createElement("div");
    firstRow.innerHTML = "<span>prompt&gt;</span>";
    const secondRow = document.createElement("div");
    secondRow.innerHTML = "<span><span>echo hel</span></span>";
    const thirdRow = document.createElement("div");
    thirdRow.innerHTML = "<span><span>lo</span></span>";

    rowsElement.append(firstRow, secondRow, thirdRow);
    host!.appendChild(rowsElement);
    stubRowsGeometry(host!, rowsElement, [firstRow, secondRow, thirdRow], {
      rowsRect: { x: 0, y: 100, width: 320, height: 60 },
      rowHeight: 20,
    });

    dispatchTouchEvent(host!, "touchstart", [{ identifier: 1, clientX: 6, clientY: 150 }]);

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(writeText).not.toHaveBeenCalled();

    dispatchTouchEvent(host!, "touchend", [], [{ identifier: 1, clientX: 6, clientY: 150 }]);

    await act(async () => {
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith("echo hello");
    expect(store.get(toastsAtom)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "success",
          title: "Copied current line",
        }),
      ])
    );
    expect(vibrate).toHaveBeenCalledWith(10);

    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
  });

  it("mobile line copy still copies a resolved empty logical line on long press", async () => {
    vi.useFakeTimers();
    viewportMocks.viewport = "mobile";

    const originalMatchMedia = window.matchMedia;
    const writeText = vi.fn().mockResolvedValue(undefined);
    const vibrate = vi.fn();
    const store = createStore();

    mockTerminal.cols = 80;
    mockTerminal.buffer.active.viewportY = 14;
    setMockBufferLines([[14, "", false]]);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText } satisfies Pick<Clipboard, "writeText">,
    });
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: vibrate,
    });

    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, {
      copyOnSelect: true,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ ok: true, data: { status: "ok" } }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
      sendTerminalInput: vi.fn().mockResolvedValue(undefined),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-line-copy-empty-line-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const host = container.querySelector(".xterm-host") as HTMLDivElement | null;
    expect(host).toBeTruthy();

    const rowsElement = document.createElement("div");
    rowsElement.className = "xterm-rows";
    rowsElement.innerHTML = "<div><span>&nbsp;</span></div>";
    host!.appendChild(rowsElement);
    stubRowsGeometry(host!, rowsElement, [rowsElement.firstElementChild as HTMLDivElement], {
      rowsRect: { x: 0, y: 100, width: 320, height: 20 },
      rowHeight: 20,
    });

    dispatchTouchEvent(host!, "touchstart", [{ identifier: 1, clientX: 20, clientY: 110 }]);

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(writeText).not.toHaveBeenCalled();

    dispatchTouchEvent(host!, "touchend", [], [{ identifier: 1, clientX: 20, clientY: 110 }]);

    await act(async () => {
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith("");
    expect(store.get(toastsAtom)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "success",
          title: "Copied current line",
        }),
      ])
    );
    expect(vibrate).toHaveBeenCalledWith(10);

    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
  });

  it("mobile line copy does nothing when copy-on-select is disabled", async () => {
    vi.useFakeTimers();
    viewportMocks.viewport = "mobile";

    const originalMatchMedia = window.matchMedia;
    const writeText = vi.fn().mockResolvedValue(undefined);
    const vibrate = vi.fn();
    const store = createStore();

    mockTerminal.cols = 80;
    mockTerminal.buffer.active.viewportY = 3;
    setMockBufferLines([[3, "disabled line", false]]);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText } satisfies Pick<Clipboard, "writeText">,
    });
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: vibrate,
    });

    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, {
      copyOnSelect: false,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ ok: true, data: { status: "ok" } }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
      sendTerminalInput: vi.fn().mockResolvedValue(undefined),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-line-copy-disabled-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const host = container.querySelector(".xterm-host") as HTMLDivElement | null;
    expect(host).toBeTruthy();

    const rowsElement = document.createElement("div");
    rowsElement.className = "xterm-rows";
    rowsElement.innerHTML = "<div><span>disabled line</span></div>";
    host!.appendChild(rowsElement);
    stubRowsGeometry(host!, rowsElement, [rowsElement.firstElementChild as HTMLDivElement], {
      rowsRect: { x: 0, y: 100, width: 320, height: 20 },
      rowHeight: 20,
    });

    dispatchTouchEvent(host!, "touchstart", [{ identifier: 1, clientX: 20, clientY: 110 }]);

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();

    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
  });

  it("mobile line copy does not fire when the gesture becomes a scroll before long press matures", async () => {
    vi.useFakeTimers();
    viewportMocks.viewport = "mobile";

    const originalMatchMedia = window.matchMedia;
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockTerminal.cols = 80;
    mockTerminal.rows = 20;
    mockTerminal.buffer.active.viewportY = 6;
    mockTerminal.buffer.active.baseY = 80;
    setMockBufferLines([[6, "scroll line", false]]);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText } satisfies Pick<Clipboard, "writeText">,
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, {
      copyOnSelect: true,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-line-copy-scroll-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const host = container.querySelector(".xterm-host");
    expect(host).toBeTruthy();

    const rowsElement = document.createElement("div");
    rowsElement.className = "xterm-rows";
    rowsElement.innerHTML = "<div><span>scroll line</span></div>";
    (host as HTMLDivElement).appendChild(rowsElement);
    stubRowsGeometry(
      host as HTMLDivElement,
      rowsElement,
      [rowsElement.firstElementChild as HTMLDivElement],
      {
        rowsRect: { x: 0, y: 100, width: 320, height: 20 },
        rowHeight: 20,
      }
    );

    dispatchTouchEvent(host!, "touchstart", [{ identifier: 1, clientX: 20, clientY: 110 }]);
    dispatchTouchEvent(host!, "touchmove", [{ identifier: 1, clientX: 40, clientY: 88 }]);

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(mockTerminal.scrollLines).toHaveBeenCalled();

    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
  });

  it("mobile line copy cancels on horizontal drift beyond tolerance without vibration or scrolling", async () => {
    vi.useFakeTimers();
    viewportMocks.viewport = "mobile";

    const originalMatchMedia = window.matchMedia;
    const writeText = vi.fn().mockResolvedValue(undefined);
    const vibrate = vi.fn();
    mockTerminal.cols = 80;
    mockTerminal.rows = 20;
    mockTerminal.buffer.active.viewportY = 6;
    mockTerminal.buffer.active.baseY = 80;
    setMockBufferLines([[6, "drift line", false]]);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText } satisfies Pick<Clipboard, "writeText">,
    });
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: vibrate,
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, {
      copyOnSelect: true,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });

    const { container } = render(
      <Provider store={store}>
        <XtermHost
          terminalId="mobile-line-copy-horizontal-drift-terminal"
          workspaceId="test-workspace"
        />
      </Provider>
    );

    const host = container.querySelector(".xterm-host");
    expect(host).toBeTruthy();

    const rowsElement = document.createElement("div");
    rowsElement.className = "xterm-rows";
    rowsElement.innerHTML = "<div><span>drift line</span></div>";
    (host as HTMLDivElement).appendChild(rowsElement);
    stubRowsGeometry(
      host as HTMLDivElement,
      rowsElement,
      [rowsElement.firstElementChild as HTMLDivElement],
      {
        rowsRect: { x: 0, y: 100, width: 320, height: 20 },
        rowHeight: 20,
      }
    );

    dispatchTouchEvent(host!, "touchstart", [{ identifier: 1, clientX: 20, clientY: 110 }]);
    dispatchTouchEvent(host!, "touchmove", [{ identifier: 1, clientX: 56, clientY: 110 }]);

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(mockTerminal.scrollLines).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();

    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
  });

  it("does not start touch momentum after a below-tolerance long-press nudge", () => {
    vi.useFakeTimers();
    viewportMocks.viewport = "mobile";

    const originalMatchMedia = window.matchMedia;
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalCancelAnimationFrame = global.cancelAnimationFrame;
    const nowSpy = vi.spyOn(performance, "now");
    mockTerminal.rows = 20;
    mockTerminal.buffer.active.viewportY = 6;
    mockTerminal.buffer.active.baseY = 80;

    let now = 0;
    nowSpy.mockImplementation(() => now);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    const rafCallbacks: FrameRequestCallback[] = [];
    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, {
      copyOnSelect: true,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });

    const { container } = render(
      <Provider store={store}>
        <XtermHost
          terminalId="mobile-copy-mode-below-tolerance-momentum-terminal"
          workspaceId="test-workspace"
        />
      </Provider>
    );

    const host = container.querySelector(".xterm-host");
    expect(host).toBeTruthy();
    const rafCountBeforeGesture = rafCallbacks.length;

    const dispatchTouchEvent = (
      type: string,
      touches: Array<{ identifier: number; clientY: number }>,
      changedTouches: Array<{ identifier: number; clientY: number }> = touches
    ) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", { value: touches });
      Object.defineProperty(event, "changedTouches", { value: changedTouches });
      host?.dispatchEvent(event);
    };

    now = 0;
    dispatchTouchEvent("touchstart", [{ identifier: 1, clientY: 120 }]);

    now = 32;
    dispatchTouchEvent("touchmove", [{ identifier: 1, clientY: 114 }]);

    now = 48;
    dispatchTouchEvent("touchend", [], [{ identifier: 1, clientY: 114 }]);

    expect(rafCallbacks).toHaveLength(rafCountBeforeGesture);
    expect(mockTerminal.scrollLines).not.toHaveBeenCalled();

    window.matchMedia = originalMatchMedia;
    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
    vi.useRealTimers();
  });

  it("mobile line copy shows a mobile-specific failure toast when clipboard write fails", async () => {
    vi.useFakeTimers();
    viewportMocks.viewport = "mobile";

    const originalMatchMedia = window.matchMedia;
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard failed"));
    const execCommand = vi.fn().mockReturnValue(false);
    const vibrate = vi.fn();
    const store = createStore();

    mockTerminal.cols = 80;
    mockTerminal.buffer.active.viewportY = 7;
    setMockBufferLines([[7, "toast line", false]]);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText } satisfies Pick<Clipboard, "writeText">,
    });
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: vibrate,
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    store.set(localeAtom, "zh");
    store.set(terminalPreferencesAtom, {
      copyOnSelect: true,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ ok: true, data: { status: "ok" } }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
      sendTerminalInput: vi.fn().mockResolvedValue(undefined),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-line-copy-failure-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const host = container.querySelector(".xterm-host") as HTMLDivElement | null;
    expect(host).toBeTruthy();

    const rowsElement = document.createElement("div");
    rowsElement.className = "xterm-rows";
    rowsElement.innerHTML = "<div><span>toast line</span></div>";
    host!.appendChild(rowsElement);
    stubRowsGeometry(host!, rowsElement, [rowsElement.firstElementChild as HTMLDivElement], {
      rowsRect: { x: 0, y: 100, width: 320, height: 20 },
      rowHeight: 20,
    });

    dispatchTouchEvent(host!, "touchstart", [{ identifier: 1, clientX: 20, clientY: 110 }]);

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(writeText).not.toHaveBeenCalled();

    dispatchTouchEvent(host!, "touchend", [], [{ identifier: 1, clientX: 20, clientY: 110 }]);

    await act(async () => {
      await Promise.resolve();
    });

    expect(store.get(toastsAtom)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "error",
          title: "当前行复制失败",
          body: "请重试长按当前行",
        }),
      ])
    );
    expect(vibrate).not.toHaveBeenCalled();

    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
  });

  it("mobile line copy falls back to document.execCommand when clipboard writeText is rejected", async () => {
    vi.useFakeTimers();
    viewportMocks.viewport = "mobile";

    const originalMatchMedia = window.matchMedia;
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard rejected"));
    const execCommand = vi.fn().mockReturnValue(true);
    const vibrate = vi.fn();
    const store = createStore();

    mockTerminal.cols = 80;
    mockTerminal.buffer.active.viewportY = 8;
    setMockBufferLines([[8, "fallback line", false]]);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText } satisfies Pick<Clipboard, "writeText">,
    });
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: vibrate,
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, {
      copyOnSelect: true,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ ok: true, data: { status: "ok" } }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
      sendTerminalInput: vi.fn().mockResolvedValue(undefined),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-line-copy-fallback-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const host = container.querySelector(".xterm-host") as HTMLDivElement | null;
    expect(host).toBeTruthy();

    const rowsElement = document.createElement("div");
    rowsElement.className = "xterm-rows";
    rowsElement.innerHTML = "<div><span>fallback line</span></div>";
    host!.appendChild(rowsElement);
    stubRowsGeometry(host!, rowsElement, [rowsElement.firstElementChild as HTMLDivElement], {
      rowsRect: { x: 0, y: 100, width: 320, height: 20 },
      rowHeight: 20,
    });

    dispatchTouchEvent(host!, "touchstart", [{ identifier: 1, clientX: 20, clientY: 110 }]);

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(writeText).not.toHaveBeenCalled();

    dispatchTouchEvent(host!, "touchend", [], [{ identifier: 1, clientX: 20, clientY: 110 }]);

    await act(async () => {
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith("fallback line");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(store.get(toastsAtom)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "success",
          title: "Copied current line",
        }),
      ])
    );
    expect(vibrate).toHaveBeenCalledWith(10);

    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
  });

  it("mobile line copy still succeeds when the touch target is only the host element", async () => {
    vi.useFakeTimers();
    viewportMocks.viewport = "mobile";

    const originalMatchMedia = window.matchMedia;
    const writeText = vi.fn().mockResolvedValue(undefined);
    const vibrate = vi.fn();
    const store = createStore();

    mockTerminal.cols = 80;
    mockTerminal.buffer.active.viewportY = 9;
    setMockBufferLines([[10, "from coords", false]]);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText } satisfies Pick<Clipboard, "writeText">,
    });
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: vibrate,
    });

    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, {
      copyOnSelect: true,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ ok: true, data: { status: "ok" } }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
      sendTerminalInput: vi.fn().mockResolvedValue(undefined),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <XtermHost
          terminalId="mobile-line-copy-host-target-terminal"
          workspaceId="test-workspace"
        />
      </Provider>
    );

    const host = container.querySelector(".xterm-host") as HTMLDivElement | null;
    expect(host).toBeTruthy();

    const rowsElement = document.createElement("div");
    rowsElement.className = "xterm-rows";
    const firstRow = document.createElement("div");
    firstRow.innerHTML = "<span>ignored</span>";
    const secondRow = document.createElement("div");
    secondRow.innerHTML = "<span>from coords</span>";
    rowsElement.append(firstRow, secondRow);
    host!.appendChild(rowsElement);
    stubRowsGeometry(host!, rowsElement, [firstRow, secondRow], {
      rowsRect: { x: 0, y: 100, width: 320, height: 40 },
      rowHeight: 20,
    });

    dispatchTouchEvent(host!, "touchstart", [
      { identifier: 1, clientX: 40, clientY: 130, target: host },
    ]);

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(writeText).not.toHaveBeenCalled();

    dispatchTouchEvent(host!, "touchend", [], [{ identifier: 1, clientX: 40, clientY: 130 }]);

    await act(async () => {
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith("from coords");
    expect(vibrate).toHaveBeenCalledWith(10);

    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
  });

  it("mobile line copy does not copy when a long press lands in the blank area to the right of a short row", async () => {
    vi.useFakeTimers();
    viewportMocks.viewport = "mobile";

    const originalMatchMedia = window.matchMedia;
    const writeText = vi.fn().mockResolvedValue(undefined);
    const vibrate = vi.fn();
    const store = createStore();

    mockTerminal.cols = 80;
    mockTerminal.buffer.active.viewportY = 12;
    setMockBufferLines([[12, "short", false]]);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText } satisfies Pick<Clipboard, "writeText">,
    });
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: vibrate,
    });

    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, {
      copyOnSelect: true,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ ok: true, data: { status: "ok" } }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
      sendTerminalInput: vi.fn().mockResolvedValue(undefined),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <XtermHost
          terminalId="mobile-line-copy-short-row-blank-area-terminal"
          workspaceId="test-workspace"
        />
      </Provider>
    );

    const host = container.querySelector(".xterm-host") as HTMLDivElement | null;
    expect(host).toBeTruthy();

    const rowsElement = document.createElement("div");
    rowsElement.className = "xterm-rows";
    rowsElement.innerHTML = "<div><span>short</span></div>";
    host!.appendChild(rowsElement);
    stubRowsGeometry(host!, rowsElement, [rowsElement.firstElementChild as HTMLDivElement], {
      rowsRect: { x: 0, y: 100, width: 320, height: 20 },
      rowHeight: 20,
    });

    dispatchTouchEvent(host!, "touchstart", [{ identifier: 1, clientX: 220, clientY: 110 }]);

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
    expect(store.get(toastsAtom)).toEqual([]);

    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
  });

  it("mobile line copy does not copy when a long press lands in the right gutter outside the xterm screen grid", async () => {
    vi.useFakeTimers();
    viewportMocks.viewport = "mobile";

    const originalMatchMedia = window.matchMedia;
    const writeText = vi.fn().mockResolvedValue(undefined);
    const vibrate = vi.fn();
    const store = createStore();

    mockTerminal.cols = 80;
    mockTerminal.buffer.active.viewportY = 15;
    setMockBufferLines([[15, "x".repeat(80), false]]);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText } satisfies Pick<Clipboard, "writeText">,
    });
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: vibrate,
    });

    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, {
      copyOnSelect: true,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ ok: true, data: { status: "ok" } }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
      sendTerminalInput: vi.fn().mockResolvedValue(undefined),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <XtermHost
          terminalId="mobile-line-copy-right-gutter-terminal"
          workspaceId="test-workspace"
        />
      </Provider>
    );

    const host = container.querySelector(".xterm-host") as HTMLDivElement | null;
    expect(host).toBeTruthy();

    const screenElement = document.createElement("div");
    screenElement.className = "xterm-screen";
    host!.appendChild(screenElement);

    const rowsElement = document.createElement("div");
    rowsElement.className = "xterm-rows";
    rowsElement.innerHTML = `<div><span>${"x".repeat(80)}</span></div>`;
    host!.appendChild(rowsElement);
    stubRowsGeometry(host!, rowsElement, [rowsElement.firstElementChild as HTMLDivElement], {
      rowsRect: { x: 0, y: 100, width: 320, height: 20 },
      screenRect: { x: 0, y: 100, width: 280, height: 20 },
      rowHeight: 20,
    });

    dispatchTouchEvent(host!, "touchstart", [{ identifier: 1, clientX: 300, clientY: 110 }]);

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
    expect(store.get(toastsAtom)).toEqual([]);

    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
  });

  it("mobile line copy does not copy an empty row when a long press lands in the right gutter outside the xterm screen grid", async () => {
    vi.useFakeTimers();
    viewportMocks.viewport = "mobile";

    const originalMatchMedia = window.matchMedia;
    const writeText = vi.fn().mockResolvedValue(undefined);
    const vibrate = vi.fn();
    const store = createStore();

    mockTerminal.cols = 80;
    mockTerminal.buffer.active.viewportY = 16;
    setMockBufferLines([[16, "", false]]);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText } satisfies Pick<Clipboard, "writeText">,
    });
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: vibrate,
    });

    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, {
      copyOnSelect: true,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ ok: true, data: { status: "ok" } }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
      sendTerminalInput: vi.fn().mockResolvedValue(undefined),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <XtermHost
          terminalId="mobile-line-copy-empty-right-gutter-terminal"
          workspaceId="test-workspace"
        />
      </Provider>
    );

    const host = container.querySelector(".xterm-host") as HTMLDivElement | null;
    expect(host).toBeTruthy();

    const screenElement = document.createElement("div");
    screenElement.className = "xterm-screen";
    host!.appendChild(screenElement);

    const rowsElement = document.createElement("div");
    rowsElement.className = "xterm-rows";
    rowsElement.innerHTML = "<div><span>&nbsp;</span></div>";
    host!.appendChild(rowsElement);
    stubRowsGeometry(host!, rowsElement, [rowsElement.firstElementChild as HTMLDivElement], {
      rowsRect: { x: 0, y: 100, width: 320, height: 20 },
      screenRect: { x: 0, y: 100, width: 280, height: 20 },
      rowHeight: 20,
    });

    dispatchTouchEvent(host!, "touchstart", [{ identifier: 1, clientX: 300, clientY: 110 }]);

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
    expect(store.get(toastsAtom)).toEqual([]);

    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
  });

  it("mobile line copy still succeeds after the row DOM is replaced before long press matures", async () => {
    vi.useFakeTimers();
    viewportMocks.viewport = "mobile";

    const originalMatchMedia = window.matchMedia;
    const writeText = vi.fn().mockResolvedValue(undefined);
    const store = createStore();

    mockTerminal.cols = 80;
    mockTerminal.buffer.active.viewportY = 4;
    setMockBufferLines([[5, "stable row text", false]]);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText } satisfies Pick<Clipboard, "writeText">,
    });

    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, {
      copyOnSelect: true,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
    });
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ ok: true, data: { status: "ok" } }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
      sendTerminalInput: vi.fn().mockResolvedValue(undefined),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-line-copy-redraw-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const host = container.querySelector(".xterm-host") as HTMLDivElement | null;
    expect(host).toBeTruthy();

    const rowsElement = document.createElement("div");
    rowsElement.className = "xterm-rows";
    const firstRow = document.createElement("div");
    firstRow.innerHTML = "<span>ignored</span>";
    const secondRow = document.createElement("div");
    secondRow.innerHTML = "<span><span>stable row text</span></span>";
    rowsElement.append(firstRow, secondRow);
    host!.appendChild(rowsElement);
    stubRowsGeometry(host!, rowsElement, [firstRow, secondRow], {
      rowsRect: { x: 0, y: 100, width: 320, height: 40 },
      rowHeight: 20,
    });

    dispatchTouchEvent(host!, "touchstart", [
      {
        identifier: 1,
        clientX: 40,
        clientY: 130,
        target: secondRow.querySelector("span span") as HTMLSpanElement,
      },
    ]);

    secondRow.replaceChildren(document.createElement("span"));

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(writeText).not.toHaveBeenCalled();

    dispatchTouchEvent(host!, "touchend", [], [{ identifier: 1, clientX: 40, clientY: 130 }]);

    await act(async () => {
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith("stable row text");

    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
  });

  it("syncs xterm resize events back to the server PTY", async () => {
    const store = createStore();
    const dispatchCommand = vi.fn().mockResolvedValue({ ok: true, data: { status: "ok" } });

    store.set(wsClientAtom, {
      sendCommand: dispatchCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <XtermHost terminalId="resize-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const onResizeCallback = mockTerminal.onResize.mock.calls[0]?.[0];
    expect(onResizeCallback).toBeTypeOf("function");

    await onResizeCallback?.({ cols: 132, rows: 36 });

    expectResizeCall(dispatchCommand, "resize-terminal", 132, 36);
  });
});
