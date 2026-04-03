import test from "node:test";
import assert from "node:assert/strict";
import { createAgentTerminalFitScheduler } from "../apps/web/src/features/agents/agent-terminal-fit-scheduler";

test("createAgentTerminalFitScheduler coalesces repeated schedule calls into the latest frame task", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrameId = 1;
  const calls: string[] = [];
  const scheduler = createAgentTerminalFitScheduler(
    (callback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    },
    (id) => {
      frames.delete(id);
    },
  );

  scheduler.schedule(() => {
    calls.push("first");
  });
  scheduler.schedule(() => {
    calls.push("second");
  });

  assert.equal(frames.size, 1);

  const [frameId, frame] = frames.entries().next().value as [number, FrameRequestCallback];
  frames.delete(frameId);
  frame(0);

  assert.deepEqual(calls, ["second"]);
  assert.equal(frames.size, 0);
});

test("createAgentTerminalFitScheduler flushes the pending task immediately and clears the queued frame", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrameId = 1;
  const cancelled: number[] = [];
  const calls: string[] = [];
  const scheduler = createAgentTerminalFitScheduler(
    (callback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    },
    (id) => {
      cancelled.push(id);
      frames.delete(id);
    },
  );

  scheduler.schedule(() => {
    calls.push("pending");
  });

  scheduler.flush();

  assert.deepEqual(calls, ["pending"]);
  assert.deepEqual(cancelled, [1]);
  assert.equal(frames.size, 0);
});
