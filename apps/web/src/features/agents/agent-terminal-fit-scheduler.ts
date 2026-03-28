type AgentTerminalFitTask = () => void;

type ScheduleFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;

export type AgentTerminalFitScheduler = {
  schedule: (task: AgentTerminalFitTask) => void;
  flush: () => void;
  dispose: () => void;
};

export const createAgentTerminalFitScheduler = (
  scheduleFrame: ScheduleFrame,
  cancelFrame: CancelFrame,
): AgentTerminalFitScheduler => {
  let frameHandle = 0;
  let pendingTask: AgentTerminalFitTask | null = null;

  const runPendingTask = () => {
    frameHandle = 0;
    const task = pendingTask;
    pendingTask = null;
    task?.();
  };

  return {
    schedule(task) {
      pendingTask = task;
      if (frameHandle) return;
      frameHandle = scheduleFrame(() => {
        runPendingTask();
      });
    },
    flush() {
      if (frameHandle) {
        cancelFrame(frameHandle);
        frameHandle = 0;
      }
      runPendingTask();
    },
    dispose() {
      if (frameHandle) {
        cancelFrame(frameHandle);
        frameHandle = 0;
      }
      pendingTask = null;
    },
  };
};
