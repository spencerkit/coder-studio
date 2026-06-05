import type { TaskDefinition, TaskRun } from "@coder-studio/core";
import { Topics } from "@coder-studio/core";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect } from "react";
import { dispatchCommandAtom, wsClientAtom } from "../../../atoms/connection";
import { useTranslation } from "../../../lib/i18n";
import { useTerminalThemeBackground } from "../../../theme";
import { bottomPanelActiveTabAtomFamily } from "../../bottom-panel";
import { pushToastAtom } from "../../notifications/atoms";
import {
  terminalActiveIdAtomFamily,
  terminalIdsAtomFamily,
  terminalMetaAtomFamily,
} from "../../terminal-panel/atoms";
import { taskStateAtomFamily } from "../atoms";

function commandPreview(task: TaskDefinition): string {
  return [task.command, ...task.args].join(" ");
}

function taskTerminalTitle(task: TaskDefinition): string {
  return `Task: ${task.label}`;
}

function isActiveRun(run: TaskRun): boolean {
  return run.status === "running" || run.status === "queued";
}

export function useTaskActions(workspaceId: string) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const wsClient = useAtomValue(wsClientAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const store = useStore();
  const themeBackground = useTerminalThemeBackground();
  const [state, setState] = useAtom(taskStateAtomFamily(workspaceId));

  useEffect(() => {
    let cancelled = false;

    async function loadTasks() {
      setState((previous) => ({ ...previous, loading: true, error: undefined }));

      const [tasksResult, historyResult] = await Promise.all([
        dispatch<TaskDefinition[]>("task.list", { workspaceId }),
        dispatch<TaskRun[]>("task.history", { workspaceId }),
      ]);

      if (cancelled) {
        return;
      }

      if (!tasksResult.ok || !tasksResult.data) {
        const message = tasksResult.error?.message ?? t("tasks.load_failed_body");
        setState((previous) => ({ ...previous, loading: false, error: message }));
        pushToast({ kind: "error", title: t("tasks.load_failed_title"), body: message });
        return;
      }

      setState({
        tasks: tasksResult.data,
        runs: historyResult.ok && historyResult.data ? historyResult.data : [],
        loading: false,
      });
    }

    void loadTasks();

    return () => {
      cancelled = true;
    };
  }, [dispatch, pushToast, setState, t, workspaceId]);

  useEffect(() => {
    if (!wsClient) {
      return undefined;
    }

    return wsClient.subscribe([Topics.workspaceTasksAll(workspaceId)], (_topic, payload) => {
      const data = payload as { tasks?: TaskDefinition[]; run?: TaskRun };
      const tasks = data.tasks;
      const run = data.run;
      if (tasks) {
        setState((previous) => ({ ...previous, tasks }));
      }
      if (run) {
        setState((previous) => ({
          ...previous,
          runs: [run, ...previous.runs.filter((candidate) => candidate.id !== run.id)],
        }));
      }
    });
  }, [setState, workspaceId, wsClient]);

  function activateRunTerminal(task: TaskDefinition, run: TaskRun) {
    store.set(terminalMetaAtomFamily(run.terminalId), {
      id: run.terminalId,
      workspaceId,
      kind: "task",
      alive: isActiveRun(run),
      exitCode: run.exitCode,
      title: taskTerminalTitle(task),
    });
    store.set(terminalIdsAtomFamily(workspaceId), (current) =>
      current.includes(run.terminalId) ? current : [...current, run.terminalId]
    );
    store.set(terminalActiveIdAtomFamily(workspaceId), run.terminalId);
    store.set(bottomPanelActiveTabAtomFamily(workspaceId), "terminal");
  }

  async function runTask(task: TaskDefinition) {
    const result = await dispatch<TaskRun>("task.run", {
      workspaceId,
      taskId: task.id,
      themeBackground,
    });
    if (!result.ok || !result.data) {
      pushToast({
        kind: "error",
        title: t("tasks.run_failed_title"),
        body: result.error?.message ?? t("tasks.run_failed_body"),
      });
      return null;
    }

    activateRunTerminal(task, result.data);
    setState((previous) => ({
      ...previous,
      runs: [result.data!, ...previous.runs.filter((run) => run.taskId !== task.id)],
    }));
    return result.data;
  }

  async function rerunTask(task: TaskDefinition) {
    const result = await dispatch<TaskRun>("task.rerun", {
      workspaceId,
      taskId: task.id,
      themeBackground,
    });
    if (!result.ok || !result.data) {
      pushToast({
        kind: "error",
        title: t("tasks.run_failed_title"),
        body: result.error?.message ?? t("tasks.run_failed_body"),
      });
      return null;
    }

    activateRunTerminal(task, result.data);
    setState((previous) => ({
      ...previous,
      runs: [result.data!, ...previous.runs.filter((run) => run.taskId !== task.id)],
    }));
    return result.data;
  }

  async function stopTask(run: TaskRun) {
    const result = await dispatch<TaskRun>("task.stop", { workspaceId, runId: run.id });
    if (!result.ok || !result.data) {
      pushToast({
        kind: "error",
        title: t("tasks.stop_failed_title"),
        body: result.error?.message ?? t("tasks.stop_failed_body"),
      });
      return null;
    }

    setState((previous) => ({
      ...previous,
      runs: [result.data!, ...previous.runs.filter((candidate) => candidate.id !== run.id)],
    }));
    return result.data;
  }

  return {
    ...state,
    commandPreview,
    runTask,
    rerunTask,
    stopTask,
  };
}
