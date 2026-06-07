import { isAbsolute } from "node:path";
import type { DomainEvent, TaskDefinition, TaskRun } from "@coder-studio/core";
import type { EventBus } from "../bus/event-bus.js";
import { resolveSafe } from "../fs/file-io.js";
import type { TerminalManager } from "../terminal/manager.js";

interface TaskManagerDeps {
  eventBus: EventBus;
  terminalMgr: Pick<TerminalManager, "create" | "close">;
  now?: () => number;
}

interface RunTaskInput {
  workspaceId: string;
  workspacePath: string;
  taskId: string;
  themeBackground?: string;
}

interface StopTaskInput {
  workspaceId: string;
  runId: string;
}

const TASK_TAIL_LINE_LIMIT = 10;

function createRunId(): string {
  return `taskrun_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeOutputLines(chunk: Buffer): string[] {
  return chunk
    .toString("utf8")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

export class TaskManager {
  private readonly now: () => number;
  private readonly tasksByWorkspace = new Map<string, TaskDefinition[]>();
  private readonly runsByWorkspace = new Map<string, TaskRun[]>();
  private readonly runByTerminalId = new Map<string, TaskRun>();
  private readonly outputTailByRunId = new Map<string, string[]>();

  constructor(private readonly deps: TaskManagerDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.deps.eventBus.on("terminal.output", (event: DomainEvent) => {
      if (event.type === "terminal.output") {
        this.onTerminalOutput(event);
      }
    });
    this.deps.eventBus.on("terminal.exited", (event: DomainEvent) => {
      if (event.type === "terminal.exited") {
        this.onTerminalExited(event);
      }
    });
  }

  setDiscoveredTasks(workspaceId: string, tasks: TaskDefinition[]): TaskDefinition[] {
    this.tasksByWorkspace.set(workspaceId, tasks);
    this.deps.eventBus.emit({ type: "task.discovered", workspaceId, tasks });
    return tasks;
  }

  list(workspaceId: string): TaskDefinition[] {
    return this.tasksByWorkspace.get(workspaceId) ?? [];
  }

  history(workspaceId: string): TaskRun[] {
    return this.runsByWorkspace.get(workspaceId) ?? [];
  }

  latestVerify(workspaceId: string): TaskRun | undefined {
    const verifyTaskIds = new Set(
      (this.tasksByWorkspace.get(workspaceId) ?? [])
        .filter((task) => task.kind === "verify")
        .map((task) => task.id)
    );
    return this.history(workspaceId).find((run) => verifyTaskIds.has(run.taskId));
  }

  async run(input: RunTaskInput): Promise<TaskRun> {
    const task = this.list(input.workspaceId).find((candidate) => candidate.id === input.taskId);
    if (!task) {
      throw { code: "task_not_found", message: `Task not found: ${input.taskId}` };
    }

    const cwd = this.resolveTaskCwd(input.workspacePath, task.cwdPath);
    const terminal = this.deps.terminalMgr.create({
      workspaceId: input.workspaceId,
      kind: "task",
      argv: [task.command, ...task.args],
      cwd,
      title: `Task: ${task.label}`,
      cols: 120,
      rows: 30,
      themeBackground: input.themeBackground,
    });

    const run: TaskRun = {
      id: createRunId(),
      workspaceId: input.workspaceId,
      taskId: task.id,
      terminalId: terminal.id,
      status: "running",
      command: task.command,
      args: task.args,
      cwdPath: task.cwdPath,
      startedAt: this.now(),
    };

    this.storeRun(run);
    this.runByTerminalId.set(terminal.id, run);
    this.deps.eventBus.emit({ type: "task.run.started", workspaceId: input.workspaceId, run });
    return run;
  }

  async rerun(input: RunTaskInput): Promise<TaskRun> {
    return this.run(input);
  }

  async stop(input: StopTaskInput): Promise<TaskRun> {
    const run = this.history(input.workspaceId).find((candidate) => candidate.id === input.runId);
    if (!run) {
      throw { code: "task_run_not_found", message: `Task run not found: ${input.runId}` };
    }
    if (run.status !== "running" && run.status !== "queued") {
      return run;
    }

    await this.deps.terminalMgr.close(run.terminalId);
    const stopped = this.updateRun(run, {
      status: "stopped",
      finishedAt: this.now(),
      summary: { tailLines: this.outputTailByRunId.get(run.id) ?? [] },
    });
    this.runByTerminalId.delete(run.terminalId);
    this.deps.eventBus.emit({
      type: "task.run.stopped",
      workspaceId: input.workspaceId,
      run: stopped,
    });
    return stopped;
  }

  clearWorkspace(workspaceId: string): void {
    this.tasksByWorkspace.delete(workspaceId);
    const runs = this.runsByWorkspace.get(workspaceId) ?? [];
    for (const run of runs) {
      this.runByTerminalId.delete(run.terminalId);
      this.outputTailByRunId.delete(run.id);
    }
    this.runsByWorkspace.delete(workspaceId);
  }

  private resolveTaskCwd(workspacePath: string, cwdPath: string | undefined): string {
    if (!cwdPath || cwdPath === ".") {
      return workspacePath;
    }
    if (isAbsolute(cwdPath)) {
      throw { code: "invalid_task_cwd", message: "Task cwdPath must be workspace-relative" };
    }
    return resolveSafe(workspacePath, cwdPath);
  }

  private storeRun(run: TaskRun): void {
    const current = this.runsByWorkspace.get(run.workspaceId) ?? [];
    const withoutSameTask = current.filter((candidate) => candidate.taskId !== run.taskId);
    this.runsByWorkspace.set(run.workspaceId, [run, ...withoutSameTask]);
  }

  private updateRun(run: TaskRun, patch: Partial<TaskRun>): TaskRun {
    const next = { ...run, ...patch };
    this.storeRun(next);
    this.runByTerminalId.set(next.terminalId, next);
    return next;
  }

  private onTerminalOutput(event: Extract<DomainEvent, { type: "terminal.output" }>): void {
    const run = this.runByTerminalId.get(event.terminalId);
    if (!run) {
      return;
    }
    const previous = this.outputTailByRunId.get(run.id) ?? [];
    const next = [...previous, ...normalizeOutputLines(event.chunk)].slice(-TASK_TAIL_LINE_LIMIT);
    this.outputTailByRunId.set(run.id, next);
  }

  private onTerminalExited(event: Extract<DomainEvent, { type: "terminal.exited" }>): void {
    const run = this.runByTerminalId.get(event.terminalId);
    if (!run || run.status === "stopped") {
      return;
    }

    const finished = this.updateRun(run, {
      status: event.exitCode === 0 ? "passed" : "failed",
      finishedAt: this.now(),
      exitCode: event.exitCode,
      summary: { tailLines: this.outputTailByRunId.get(run.id) ?? [] },
    });
    this.runByTerminalId.delete(event.terminalId);
    this.deps.eventBus.emit({
      type: "task.run.finished",
      workspaceId: event.workspaceId,
      run: finished,
    });
  }
}
