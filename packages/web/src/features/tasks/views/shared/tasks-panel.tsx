import type { TaskDefinition, TaskRun } from "@coder-studio/core";
import { Button, EmptyState, ThemedIcon } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { useTaskActions } from "../../actions/use-task-actions";

interface TasksPanelProps {
  workspaceId: string;
}

function formatDuration(run: TaskRun | undefined): string {
  if (!run?.finishedAt) {
    return "";
  }

  const seconds = Math.max(1, Math.round((run.finishedAt - run.startedAt) / 1000));
  return `${seconds}s`;
}

function statusLabel(t: ReturnType<typeof useTranslation>, run: TaskRun | undefined): string {
  if (!run) return t("tasks.status_not_run");
  if (run.status === "running") return t("tasks.status_running");
  if (run.status === "queued") return t("tasks.status_queued");
  if (run.status === "passed") return t("tasks.status_passed");
  if (run.status === "failed") return t("tasks.status_failed");
  return t("tasks.status_stopped");
}

function latestRunFor(task: TaskDefinition, runs: TaskRun[]): TaskRun | undefined {
  return runs.find((run) => run.taskId === task.id);
}

export function TasksPanel({ workspaceId }: TasksPanelProps) {
  const t = useTranslation();
  const { tasks, runs, loading, error, commandPreview, runTask, rerunTask, stopTask } =
    useTaskActions(workspaceId);

  return (
    <div className="tasks-panel">
      <div className="tasks-panel-header">
        <div>
          <span className="terminal-kicker">{t("tasks.kicker")}</span>
          <h2 className="tasks-panel-title">{t("tasks.title")}</h2>
        </div>
        <div className="tasks-panel-quick-actions">
          {tasks
            .filter(
              (task) => task.kind === "verify" || task.kind === "test" || task.kind === "lint"
            )
            .slice(0, 3)
            .map((task) => (
              <Button
                key={task.id}
                aria-label={t("tasks.quick_run_label", { label: task.label })}
                size="sm"
                onClick={() => void runTask(task)}
              >
                {t("tasks.quick_run_short", { label: task.label })}
              </Button>
            ))}
        </div>
      </div>

      {error ? <div className="tasks-panel-error">{error}</div> : null}

      {tasks.length === 0 && !loading ? (
        <EmptyState
          className="tasks-empty"
          icon={<ThemedIcon semantic="terminal.action.new" size={28} />}
          title={<p>{t("tasks.empty_title")}</p>}
          description={<p>{t("tasks.empty_body")}</p>}
        />
      ) : (
        <div className="tasks-list">
          {tasks.map((task) => {
            const run = latestRunFor(task, runs);
            const running = run?.status === "running" || run?.status === "queued";

            return (
              <div key={task.id} className={`tasks-row tasks-row--${run?.status ?? "not-run"}`}>
                <div className="tasks-row-main">
                  <span className="tasks-row-label">{task.label}</span>
                  <span className="tasks-row-command">{commandPreview(task)}</span>
                </div>
                <span className="tasks-row-status">{statusLabel(t, run)}</span>
                <span className="tasks-row-duration">{formatDuration(run)}</span>
                <div className="tasks-row-actions">
                  {running && run ? (
                    <Button size="sm" variant="secondary" onClick={() => void stopTask(run)}>
                      {t("tasks.stop_label", { label: task.label })}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant={run ? "secondary" : "primary"}
                      onClick={() => void (run ? rerunTask(task) : runTask(task))}
                    >
                      {run
                        ? t("tasks.rerun_label", { label: task.label })
                        : t("tasks.run_label", { label: task.label })}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
