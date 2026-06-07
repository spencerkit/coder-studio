import type { TaskDefinition, TaskRun } from "@coder-studio/core";
import { atom } from "jotai";
import { atomFamily } from "jotai-family";

export interface TaskState {
  tasks: TaskDefinition[];
  runs: TaskRun[];
  loading: boolean;
  error?: string;
}

export const taskStateAtomFamily = atomFamily((_workspaceId: string) =>
  atom<TaskState>({
    tasks: [],
    runs: [],
    loading: false,
  })
);

export const latestVerifyRunAtomFamily = atomFamily((workspaceId: string) =>
  atom((get) => {
    const state = get(taskStateAtomFamily(workspaceId));
    const verifyTaskIds = new Set(
      state.tasks.filter((task) => task.kind === "verify").map((task) => task.id)
    );
    return state.runs.find((run) => verifyTaskIds.has(run.taskId));
  })
);
