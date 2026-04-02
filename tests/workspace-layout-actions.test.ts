import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultWorkbenchState } from "../apps/web/src/state/workbench-core";
import {
  startWorkspacePaneSplitResize,
  startWorkspacePanelResize,
} from "../apps/web/src/features/workspace/workspace-layout-actions";

const installResizeEnvironment = () => {
  const root = globalThis as typeof globalThis & {
    window?: {
      addEventListener: (type: string, listener: EventListener) => void;
      removeEventListener: (type: string, listener: EventListener) => void;
      requestAnimationFrame: (callback: FrameRequestCallback) => number;
      cancelAnimationFrame: (handle: number) => void;
    };
    document?: {
      body: {
        classList: {
          add: (...tokens: string[]) => void;
          remove: (...tokens: string[]) => void;
        };
      };
    };
    requestAnimationFrame?: (callback: FrameRequestCallback) => number;
    cancelAnimationFrame?: (handle: number) => void;
  };
  const previousWindow = root.window;
  const previousDocument = root.document;
  const previousRequestAnimationFrame = root.requestAnimationFrame;
  const previousCancelAnimationFrame = root.cancelAnimationFrame;
  const listeners = new Map<string, Set<EventListener>>();
  const frames = new Map<number, FrameRequestCallback>();
  const classNames = new Set<string>();
  let nextFrameId = 1;

  const requestAnimationFrame = (callback: FrameRequestCallback) => {
    const handle = nextFrameId++;
    frames.set(handle, callback);
    return handle;
  };

  const cancelAnimationFrame = (handle: number) => {
    frames.delete(handle);
  };

  root.window = {
    addEventListener(type, listener) {
      const current = listeners.get(type) ?? new Set<EventListener>();
      current.add(listener);
      listeners.set(type, current);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    requestAnimationFrame,
    cancelAnimationFrame,
  };
  root.document = {
    body: {
      classList: {
        add: (...tokens) => {
          tokens.forEach((token) => classNames.add(token));
        },
        remove: (...tokens) => {
          tokens.forEach((token) => classNames.delete(token));
        },
      },
    },
  };
  root.requestAnimationFrame = requestAnimationFrame;
  root.cancelAnimationFrame = cancelAnimationFrame;

  return {
    classNames,
    dispatch(type: string, event: Event) {
      Array.from(listeners.get(type) ?? []).forEach((listener) => {
        listener(event);
      });
    },
    flushAnimationFrame() {
      const next = frames.entries().next();
      if (next.done) return false;
      const [handle, callback] = next.value;
      frames.delete(handle);
      callback(0);
      return true;
    },
    restore() {
      if (previousWindow) {
        root.window = previousWindow;
      } else {
        delete root.window;
      }
      if (previousDocument) {
        root.document = previousDocument;
      } else {
        delete root.document;
      }
      if (previousRequestAnimationFrame) {
        root.requestAnimationFrame = previousRequestAnimationFrame;
      } else {
        delete root.requestAnimationFrame;
      }
      if (previousCancelAnimationFrame) {
        root.cancelAnimationFrame = previousCancelAnimationFrame;
      } else {
        delete root.cancelAnimationFrame;
      }
    },
  };
};

test("startWorkspacePanelResize updates layout during drag without fitting terminals until pointerup", () => {
  const env = installResizeEnvironment();

  try {
    const stateRef = {
      current: {
        ...createDefaultWorkbenchState(),
        layout: {
          leftWidth: 320,
          rightWidth: 320,
          rightSplit: 64,
          showCodePanel: true,
          showTerminalPanel: true,
        },
      },
    };
    const widths: number[] = [];
    let scheduledFits = 0;
    let flushedFits = 0;
    let shellFits = 0;
    let archiveFits = 0;

    startWorkspacePanelResize({
      event: {
        preventDefault() {},
        clientX: 400,
        clientY: 120,
        currentTarget: {},
      } as never,
      type: "left",
      stateRef: stateRef as never,
      updateState: (updater) => {
        stateRef.current = updater(stateRef.current);
        widths.push(stateRef.current.layout.rightWidth);
      },
      shellTerminalRef: {
        current: {
          fit: () => {
            shellFits += 1;
          },
        },
      } as never,
      archiveTerminalRef: {
        current: {
          fit: () => {
            archiveFits += 1;
          },
        },
      } as never,
      flushFitAgentTerminals: () => {
        flushedFits += 1;
      },
    });

    env.dispatch("pointermove", { clientX: 360, clientY: 120 } as Event);
    assert.deepEqual(widths, []);

    env.flushAnimationFrame();

    assert.deepEqual(widths, [360]);
    assert.equal(scheduledFits, 0);
    assert.equal(flushedFits, 0);
    assert.equal(shellFits, 0);

    env.dispatch("pointerup", {} as Event);
    assert.equal(flushedFits, 0);
    assert.equal(shellFits, 0);

    env.flushAnimationFrame();

    assert.equal(scheduledFits, 0);
    assert.equal(flushedFits, 1);
    assert.equal(shellFits, 1);
    assert.equal(archiveFits, 1);
    assert.equal(env.classNames.has("is-resizing-panels"), false);
    assert.equal(env.classNames.has("is-resizing-columns"), false);
  } finally {
    env.restore();
  }
});

test("startWorkspacePaneSplitResize keeps pane repaint live but defers terminal fitting until pointerup", () => {
  const env = installResizeEnvironment();

  try {
    let tab = {
      id: "ws-1",
      paneLayout: {
        type: "split" as const,
        id: "split-1",
        axis: "vertical" as const,
        ratio: 0.5,
        first: {
          type: "leaf" as const,
          id: "pane-1",
          sessionId: "session-1",
        },
        second: {
          type: "leaf" as const,
          id: "pane-2",
          sessionId: "session-2",
        },
      },
    };
    const ratios: number[] = [];
    let scheduledFits = 0;
    let flushedFits = 0;
    let archiveFits = 0;

    startWorkspacePaneSplitResize({
      event: {
        preventDefault() {},
        clientX: 500,
        clientY: 200,
        currentTarget: {
          parentElement: {
            getBoundingClientRect: () => ({
              width: 1000,
              height: 600,
            }),
          },
        },
      } as never,
      tabId: "ws-1",
      paneLayout: tab.paneLayout,
      splitId: "split-1",
      axis: "vertical",
      updateTab: (_tabId, updater) => {
        tab = updater(tab as never) as typeof tab;
        ratios.push(tab.paneLayout.type === "split" ? tab.paneLayout.ratio : -1);
      },
      archiveTerminalRef: {
        current: {
          fit: () => {
            archiveFits += 1;
          },
        },
      } as never,
      flushFitAgentTerminals: () => {
        flushedFits += 1;
      },
    });

    env.dispatch("pointermove", { clientX: 700, clientY: 200 } as Event);
    assert.deepEqual(ratios, []);

    env.flushAnimationFrame();

    assert.deepEqual(ratios, [0.7]);
    assert.equal(scheduledFits, 0);
    assert.equal(flushedFits, 0);

    env.dispatch("pointerup", {} as Event);
    assert.equal(flushedFits, 0);

    env.flushAnimationFrame();

    assert.equal(scheduledFits, 0);
    assert.equal(flushedFits, 1);
    assert.equal(archiveFits, 1);
    assert.equal(env.classNames.has("is-resizing-panels"), false);
    assert.equal(env.classNames.has("is-resizing-columns"), false);
  } finally {
    env.restore();
  }
});
