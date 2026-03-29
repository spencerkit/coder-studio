import test from "node:test";
import assert from "node:assert/strict";
import * as workspaceViewPersistence from "../apps/web/src/features/workspace/workspace-view-persistence.ts";

const createPatch = (ratio: number) => ({
  active_session_id: "session-1",
  active_pane_id: "pane-1",
  active_terminal_id: "",
  pane_layout: {
    type: "split" as const,
    id: "split-1",
    axis: "vertical" as const,
    ratio,
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
  file_preview: {
    path: "",
    content: "",
    mode: "preview" as const,
    originalContent: "",
    modifiedContent: "",
    dirty: false,
  },
});

const createFakeTimeouts = () => {
  const timers = new Map<number, { callback: () => void; delayMs: number }>();
  const cancelled: number[] = [];
  let nextHandle = 1;

  return {
    cancelled,
    timers,
    schedule(callback: () => void, delayMs: number) {
      const handle = nextHandle++;
      timers.set(handle, { callback, delayMs });
      return handle;
    },
    cancel(handle: unknown) {
      cancelled.push(handle as number);
      timers.delete(handle as number);
    },
    runNext() {
      const next = timers.entries().next();
      if (next.done) return false;
      const [handle, timer] = next.value;
      timers.delete(handle);
      timer.callback();
      return true;
    },
  };
};

test("createWorkspaceViewPersistScheduler waits for stability and only persists the latest view patch", () => {
  const createScheduler = (workspaceViewPersistence as Record<string, unknown>).createWorkspaceViewPersistScheduler;
  assert.equal(typeof createScheduler, "function");

  const timeouts = createFakeTimeouts();
  const persisted: Array<{ workspaceId: string; ratio: number; controller: string }> = [];
  const scheduler = (createScheduler as (
    persist: (workspaceId: string, patch: ReturnType<typeof createPatch>, controller: string) => void,
    scheduleTimeout: (callback: () => void, delayMs: number) => number,
    cancelTimeout: (handle: unknown) => void,
    delayMs: number,
  ) => {
    schedule: (workspaceId: string, patch: ReturnType<typeof createPatch>, controller: string) => void;
  })(
    (workspaceId, patch, controller) => {
      persisted.push({
        workspaceId,
        ratio: patch.pane_layout.type === "split" ? patch.pane_layout.ratio : -1,
        controller,
      });
    },
    timeouts.schedule,
    timeouts.cancel,
    180,
  );

  scheduler.schedule("ws-1", createPatch(0.4), "controller-a");
  scheduler.schedule("ws-1", createPatch(0.72), "controller-b");

  assert.deepEqual(persisted, []);
  assert.equal(timeouts.timers.size, 1);
  assert.deepEqual(timeouts.cancelled, [1]);

  timeouts.runNext();

  assert.deepEqual(persisted, [
    { workspaceId: "ws-1", ratio: 0.72, controller: "controller-b" },
  ]);
});

test("createWorkspaceViewPersistScheduler can flush the final pending view immediately", () => {
  const createScheduler = (workspaceViewPersistence as Record<string, unknown>).createWorkspaceViewPersistScheduler;
  assert.equal(typeof createScheduler, "function");

  const timeouts = createFakeTimeouts();
  const persisted: Array<{ workspaceId: string; ratio: number }> = [];
  const scheduler = (createScheduler as (
    persist: (workspaceId: string, patch: ReturnType<typeof createPatch>, controller: string) => void,
    scheduleTimeout: (callback: () => void, delayMs: number) => number,
    cancelTimeout: (handle: unknown) => void,
    delayMs: number,
  ) => {
    schedule: (workspaceId: string, patch: ReturnType<typeof createPatch>, controller: string) => void;
    flush: (workspaceId?: string) => void;
  })(
    (workspaceId, patch) => {
      persisted.push({
        workspaceId,
        ratio: patch.pane_layout.type === "split" ? patch.pane_layout.ratio : -1,
      });
    },
    timeouts.schedule,
    timeouts.cancel,
    180,
  );

  scheduler.schedule("ws-1", createPatch(0.61), "controller-a");
  assert.equal(timeouts.timers.size, 1);

  scheduler.flush("ws-1");

  assert.deepEqual(persisted, [
    { workspaceId: "ws-1", ratio: 0.61 },
  ]);
  assert.equal(timeouts.timers.size, 0);
  assert.deepEqual(timeouts.cancelled, [1]);
});
