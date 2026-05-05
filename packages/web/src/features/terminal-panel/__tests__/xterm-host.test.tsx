/**
 * XtermHost Component Tests
 *
 * Unit tests for the xterm.js terminal rendering component.
 */

import { Topics } from "@coder-studio/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom, themeAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { JotaiProvider } from "../../../test-utils/jotai-provider";
import type { TerminalReplayPayload, TerminalSnapshotPayload } from "../../../ws/client";
import { terminalOutputAtomFamily } from "../atoms";
import type { HydrationRequestHandle, HydrationTier } from "../hydration-coordinator";
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
}));

vi.mock("../../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

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
  usePasteDropUpload: vi.fn(() => ({ busy: uploadHookMocks.busy })),
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

const mockTerminal = {
  open: vi.fn(),
  onData: vi.fn(() => vi.fn()), // Return dispose function
  onResize: vi.fn(() => vi.fn()),
  attachCustomKeyEventHandler: vi.fn(),
  write: vi.fn(),
  writeln: vi.fn(),
  scrollLines: vi.fn(),
  dispose: vi.fn(),
  focus: vi.fn(),
  loadAddon: vi.fn(),
  buffer: {
    active: {
      viewportY: 0,
      baseY: 0,
    },
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
    window.localStorage.clear();
    viewportMocks.viewport = "desktop";
    hydrationCoordinatorMocks.autoGrant = true;
    hydrationCoordinatorMocks.lastRequest = null;
    hydrationCoordinatorMocks.listeners = new Set();
    hydrationCoordinatorMocks.resolveGranted = () => {};
    uploadHookMocks.busy = false;
    mockTerminal.options = {};
    mockTerminal.cols = undefined;
    mockTerminal.rows = undefined;
    mockTerminal.buffer.active.viewportY = 0;
    mockTerminal.buffer.active.baseY = 0;
    mockTerminal.write.mockImplementation((_data: Uint8Array | string, callback?: () => void) => {
      callback?.();
    });
    mockTerminal.writeln.mockImplementation(() => {});
    mockTerminal.scrollLines.mockImplementation((amount: number) => {
      const nextViewportY = mockTerminal.buffer.active.viewportY + amount;
      mockTerminal.buffer.active.viewportY = Math.max(
        0,
        Math.min(mockTerminal.buffer.active.baseY, nextViewportY)
      );
    });
  });

  afterEach(() => {
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

  it("shows upload overlay and disables stdin while an upload is pending", async () => {
    uploadHookMocks.busy = true;

    render(
      <JotaiProvider>
        <XtermHost terminalId="upload-busy-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    expect(screen.getByText("Uploading…")).toBeInTheDocument();
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
      expect(screen.queryByText("Uploading…")).not.toBeInTheDocument();
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

  it("shows a restoring overlay while the initial replay is in flight", async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.replay") {
        return new Promise(() => {});
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

    expect(await screen.findByText("正在恢复终端内容…")).toBeInTheDocument();
    expect(
      screen.getByText("你已经可以继续使用当前页面；历史内容会在后台补上，内容较多时可能需要更久。")
    ).toBeInTheDocument();

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
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
      store.set(themeAtom, "light");
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
          background: "#fafbfc",
          foreground: "#1f2328",
        }),
      })
    );
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
    expect(await screen.findByText("Restoring terminal output...")).toBeInTheDocument();
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

  it("shows a degraded overlay message when replay fails so the terminal remains usable", async () => {
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
      expect(screen.getByText("历史内容恢复失败")).toBeInTheDocument();
    });
    expect(
      screen.getByText("新输出仍会继续显示；如果需要完整历史，再手动刷新页面。")
    ).toBeInTheDocument();

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
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
      expect(screen.getByText("该会话已被关闭")).toBeInTheDocument();
    });
    expect(screen.getByText("请重新开启新会话。")).toBeInTheDocument();
    expect(screen.queryByText("正在恢复终端内容…")).not.toBeInTheDocument();

    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("creates xterm instance on mount with correct theme", async () => {
    const { Terminal } = await import("@xterm/xterm");

    render(
      <JotaiProvider>
        <XtermHost terminalId="test-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    // Terminal should be called with Aurora Mint theme
    expect(Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: expect.objectContaining({
          background: "#0b1218",
          foreground: "#e5edf3",
          cursor: "#78d7b2",
          selectionBackground: "#1e3040",
        }),
      })
    );
  });

  it("creates xterm instance with a light theme when ui theme is light", async () => {
    const { Terminal } = await import("@xterm/xterm");
    const store = createStore();
    store.set(themeAtom, "light");

    render(
      <Provider store={store}>
        <XtermHost terminalId="light-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    expect(Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: expect.objectContaining({
          background: "#fafbfc",
          foreground: "#1f2328",
          cursor: "#0969da",
          selectionBackground: "#dde4ea",
        }),
      })
    );
  });

  it("updates the live xterm theme when the ui theme changes", async () => {
    const store = createStore();

    render(
      <Provider store={store}>
        <XtermHost terminalId="theme-sync-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      store.set(themeAtom, "light");
    });

    await waitFor(() => {
      expect(mockTerminal.options).toEqual(
        expect.objectContaining({
          theme: expect.objectContaining({
            background: "#fafbfc",
            foreground: "#1f2328",
          }),
        })
      );
    });
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

  it("shows a collapsed mobile soft-key handle for interactive terminals and expands it on tap", async () => {
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

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-soft-key-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const toggle = await screen.findByRole("button", { name: "Expand terminal keys" });
    expect(toggle).toBeInTheDocument();
    expect(container.querySelector(".mobile-terminal-input-bar")).toHaveAttribute(
      "data-expanded",
      "false"
    );
    expect(container.querySelector(".xterm-host-shell")?.firstElementChild).toBe(
      container.querySelector(".mobile-terminal-input-bar")
    );

    await user.click(toggle);

    expect(container.querySelector(".mobile-terminal-input-bar")).toHaveAttribute(
      "data-expanded",
      "true"
    );
    expect(screen.getByRole("button", { name: "Escape" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ctrl" })).toBeInTheDocument();
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

    expect(screen.queryByRole("button", { name: "Expand terminal keys" })).not.toBeInTheDocument();
  });

  it("routes soft-key presses through sendTerminalInput and refocuses the xterm instance", async () => {
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

    await user.click(await screen.findByRole("button", { name: "Expand terminal keys" }));
    await user.click(screen.getByRole("button", { name: "Escape" }));

    await waitFor(() => {
      expect(sendTerminalInput).toHaveBeenLastCalledWith(
        "mobile-escape-terminal",
        new TextEncoder().encode("\x1b"),
        "typing",
        undefined
      );
    });
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

    await user.click(await screen.findByRole("button", { name: "Expand terminal keys" }));
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

    await user.click(await screen.findByRole("button", { name: "Expand terminal keys" }));
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
    const toggleButton = screen.getByRole("button", { name: "Collapse terminal keys" });
    const callCountBeforeDisabledClick = sendTerminalInput.mock.calls.length;

    expect(ctrlButton).toHaveAttribute("data-ctrl-mode", "armed");
    expect(escapeButton).toBeDisabled();
    expect(toggleButton).toBeEnabled();
    await user.click(toggleButton);
    expect(container.querySelector(".mobile-terminal-input-bar")).toHaveAttribute(
      "data-expanded",
      "false"
    );
    await user.click(screen.getByRole("button", { name: "Expand terminal keys" }));
    const reexpandedEscapeButton = screen.getByRole("button", { name: "Escape" });
    expect(reexpandedEscapeButton).toBeDisabled();
    await user.click(reexpandedEscapeButton);
    expect(sendTerminalInput).toHaveBeenCalledTimes(callCountBeforeDisabledClick);
  });

  it("resets expanded state and ctrl mode when the terminal instance changes", async () => {
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

    await user.click(await screen.findByRole("button", { name: "Expand terminal keys" }));
    await user.click(screen.getByRole("button", { name: "Ctrl" }));

    expect(container.querySelector(".mobile-terminal-input-bar")).toHaveAttribute(
      "data-expanded",
      "true"
    );
    expect(container.querySelector(".mobile-terminal-input-bar__ctrl")).toHaveAttribute(
      "data-ctrl-mode",
      "armed"
    );

    rerender(
      <Provider store={store}>
        <XtermHost terminalId="mobile-reset-terminal-b" workspaceId="test-workspace" />
      </Provider>
    );

    expect(container.querySelector(".mobile-terminal-input-bar")).toHaveAttribute(
      "data-expanded",
      "false"
    );
    expect(container.querySelector(".mobile-terminal-input-bar__ctrl")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Expand terminal keys" }));
    expect(container.querySelector(".mobile-terminal-input-bar__ctrl")).toHaveAttribute(
      "data-ctrl-mode",
      "off"
    );
  });

  it("clears buffered submitted text when the terminal instance changes", async () => {
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
        <XtermHost terminalId="mobile-draft-reset-terminal-a" workspaceId="test-workspace" />
      </Provider>
    );

    const firstOnDataCallback = mockTerminal.onData.mock.calls[0]?.[0];
    await user.click(await screen.findByRole("button", { name: "Expand terminal keys" }));
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
    await user.click(await screen.findByRole("button", { name: "Expand terminal keys" }));
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

    await user.click(await screen.findByRole("button", { name: "Expand terminal keys" }));
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

    await user.click(await screen.findByRole("button", { name: "Expand terminal keys" }));
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

    await user.click(await screen.findByRole("button", { name: "Expand terminal keys" }));
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

    await user.click(await screen.findByRole("button", { name: "Expand terminal keys" }));
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
        <XtermHost terminalId="mobile-ctrl-keyboard-lock-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await user.click(await screen.findByRole("button", { name: "Expand terminal keys" }));
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

    await user.click(await screen.findByRole("button", { name: "Expand terminal keys" }));
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

    await user.click(await screen.findByRole("button", { name: "Expand terminal keys" }));
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

    await user.click(await screen.findByRole("button", { name: "Expand terminal keys" }));
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

    expect(container.querySelector(".mobile-terminal-input-bar")).toHaveAttribute(
      "data-expanded",
      "false"
    );

    await user.click(screen.getByRole("button", { name: "Expand terminal keys" }));
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

  it("does not send xterm query responses produced by live chunks flushed after snapshot hydration", async () => {
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
    expect(sendTerminalInput).not.toHaveBeenCalled();

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

  it("replays shell history again after websocket reconnect using snapshot", async () => {
    const store = createStore();
    const firstSnapshot = new TextEncoder().encode("shell snapshot\n");
    const reconnectSnapshot = new TextEncoder().encode("shell snapshot after reconnect\n");
    const sendCommand = vi.fn();
    let snapshotCount = 0;
    let statusHandler:
      | ((
          status: "connecting" | "connected" | "disconnected" | "reconnecting" | "rejected"
        ) => void)
      | undefined;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    sendCommand.mockImplementation((op: string) => {
      if (op === "terminal.snapshot") {
        snapshotCount += 1;
        if (snapshotCount === 1) {
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

        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 946,
          size: reconnectSnapshot.byteLength,
          seq: 240,
          rows: 36,
          cols: 132,
          source: "headless",
          bytes: reconnectSnapshot,
        } satisfies TerminalSnapshotPayload);
      }

      return Promise.resolve({ status: "ok" });
    });

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
      expect(
        mockTerminal.write.mock.calls.some(([written]) => written === reconnectSnapshot)
      ).toBe(true);
    });
    expect(snapshotCount).toBe(2);
    expect(sendCommand.mock.calls.some(([op]) => op === "terminal.replay")).toBe(false);
  });

  it("replays agent history again after websocket reconnect using snapshot", async () => {
    const store = createStore();
    const firstSnapshot = new TextEncoder().encode("agent snapshot\n");
    const reconnectSnapshot = new TextEncoder().encode("agent snapshot after reconnect\n");
    const sendCommand = vi.fn();
    let snapshotCount = 0;
    let statusHandler:
      | ((
          status: "connecting" | "connected" | "disconnected" | "reconnecting" | "rejected"
        ) => void)
      | undefined;

    mockTerminal.cols = 132;
    mockTerminal.rows = 36;

    sendCommand.mockImplementation((op: string) => {
      if (op === "terminal.snapshot") {
        snapshotCount += 1;
        if (snapshotCount === 1) {
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

        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 951,
          size: reconnectSnapshot.byteLength,
          seq: 240,
          rows: 36,
          cols: 132,
          source: "headless",
          bytes: reconnectSnapshot,
        } satisfies TerminalSnapshotPayload);
      }

      return Promise.resolve({ status: "ok" });
    });

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
      expect(mockTerminal.write.mock.calls.some(([written]) => written === reconnectSnapshot)).toBe(
        true
      );
    });
    expect(snapshotCount).toBe(2);
    expect(sendCommand.mock.calls.some(([op]) => op === "terminal.replay")).toBe(false);
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

  it("falls back to replay on agent reconnect when snapshot refresh fails", async () => {
    const store = createStore();
    const initialSnapshot = new TextEncoder().encode("initial snapshot\n");
    const replayFallback = new TextEncoder().encode("snapshot fallback replay\n");
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

          return Promise.reject(new Error("Command timeout: terminal.snapshot"));
        }

        if (op === "terminal.replay") {
          expect(args.lastSeq).toBe(200);
          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 981,
            size: replayFallback.byteLength,
            seq: 240,
            bytes: replayFallback,
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
      expect(sendCommand).toHaveBeenCalledWith(
        "terminal.replay",
        {
          terminalId: "agent-reconnect-fallback",
          lastSeq: 200,
        },
        {
          timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS,
        }
      );
      expectTerminalWriteData(replayFallback);
    });
  });

  it("falls back to replay on shell reconnect when snapshot refresh fails", async () => {
    const store = createStore();
    const initialSnapshot = new TextEncoder().encode("initial shell snapshot\n");
    const replayFallback = new TextEncoder().encode("shell snapshot fallback replay\n");
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

          return Promise.reject(new Error("Command timeout: terminal.snapshot"));
        }

        if (op === "terminal.replay") {
          expect(args.lastSeq).toBe(200);
          return Promise.resolve({
            status: "ok",
            transport: "binary",
            streamId: 983,
            size: replayFallback.byteLength,
            seq: 240,
            bytes: replayFallback,
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
      expect(sendCommand).toHaveBeenCalledWith(
        "terminal.replay",
        {
          terminalId: "shell-reconnect-fallback",
          lastSeq: 200,
        },
        {
          timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS,
        }
      );
      expectTerminalWriteData(replayFallback);
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
