import type { DomainEvent, TaskDefinition } from "@coder-studio/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { TaskManager } from "./manager.js";

function createTask(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id: "verify",
    workspaceId: "ws-1",
    kind: "verify",
    label: "Verify",
    command: "pnpm",
    args: ["ci:verify"],
    cwdPath: ".",
    source: "package-json",
    priority: 900,
    ...overrides,
  };
}

describe("TaskManager", () => {
  let eventBus: EventBus;
  let events: DomainEvent[];
  let terminalMgr: {
    create: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let manager: TaskManager;

  beforeEach(() => {
    eventBus = new EventBus();
    events = [];
    for (const type of [
      "task.discovered",
      "task.run.started",
      "task.run.updated",
      "task.run.finished",
      "task.run.stopped",
    ] as const) {
      eventBus.on(type, (event) => events.push(event));
    }
    terminalMgr = {
      create: vi.fn((spec) => ({
        id: "term-task",
        workspaceId: spec.workspaceId,
        kind: spec.kind,
        title: spec.title,
        cwd: spec.cwd,
        argv: spec.argv,
        cols: 120,
        rows: 30,
        alive: true,
        createdAt: 1,
      })),
      close: vi.fn(async () => undefined),
    };
    manager = new TaskManager({
      eventBus,
      terminalMgr: terminalMgr as never,
      now: () => 1000,
    });
  });

  it("stores discovered tasks and emits task.discovered", () => {
    const tasks = [createTask()];

    manager.setDiscoveredTasks("ws-1", tasks);

    expect(manager.list("ws-1")).toEqual(tasks);
    expect(events).toEqual([
      {
        type: "task.discovered",
        workspaceId: "ws-1",
        tasks,
      },
    ]);
  });

  it("runs a task through a managed task terminal", async () => {
    manager.setDiscoveredTasks("ws-1", [createTask()]);

    const run = await manager.run({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      taskId: "verify",
      themeBackground: "#0b1218",
    });

    expect(terminalMgr.create).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      kind: "task",
      argv: ["pnpm", "ci:verify"],
      cwd: "/repo",
      title: "Task: Verify",
      cols: 120,
      rows: 30,
      themeBackground: "#0b1218",
    });
    expect(run).toMatchObject({
      workspaceId: "ws-1",
      taskId: "verify",
      terminalId: "term-task",
      status: "running",
      command: "pnpm",
      args: ["ci:verify"],
      cwdPath: ".",
      startedAt: 1000,
    });
    expect(events.at(-1)).toEqual({
      type: "task.run.started",
      workspaceId: "ws-1",
      run,
    });
  });

  it("finds the latest verify run from the discovered verify task id", async () => {
    manager.setDiscoveredTasks("ws-1", [
      createTask({ id: "ci:verify", label: "ci:verify", args: ["ci:verify"] }),
    ]);

    const run = await manager.run({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      taskId: "ci:verify",
    });

    expect(manager.latestVerify("ws-1")).toBe(run);
  });

  it("marks a run passed when its task terminal exits with zero", async () => {
    manager.setDiscoveredTasks("ws-1", [createTask()]);
    const run = await manager.run({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      taskId: "verify",
    });

    eventBus.emit({
      type: "terminal.exited",
      workspaceId: "ws-1",
      terminalId: run.terminalId,
      exitCode: 0,
    });

    expect(manager.history("ws-1")[0]).toMatchObject({
      id: run.id,
      status: "passed",
      exitCode: 0,
      finishedAt: 1000,
    });
    expect(events.at(-1)?.type).toBe("task.run.finished");
  });

  it("marks a run failed and records capped output tail on non-zero exit", async () => {
    manager.setDiscoveredTasks("ws-1", [createTask()]);
    const run = await manager.run({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      taskId: "verify",
    });

    for (let index = 0; index < 14; index += 1) {
      eventBus.emit({
        type: "terminal.output",
        workspaceId: "ws-1",
        terminalId: run.terminalId,
        chunk: Buffer.from(`line ${index}\n`),
        seq: index + 1,
      });
    }
    eventBus.emit({
      type: "terminal.exited",
      workspaceId: "ws-1",
      terminalId: run.terminalId,
      exitCode: 1,
    });

    const latest = manager.history("ws-1")[0]!;
    expect(latest.status).toBe("failed");
    expect(latest.summary?.tailLines).toEqual([
      "line 4",
      "line 5",
      "line 6",
      "line 7",
      "line 8",
      "line 9",
      "line 10",
      "line 11",
      "line 12",
      "line 13",
    ]);
  });

  it("stops a running task terminal and emits task.run.stopped", async () => {
    manager.setDiscoveredTasks("ws-1", [createTask()]);
    const run = await manager.run({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      taskId: "verify",
    });

    const stopped = await manager.stop({ workspaceId: "ws-1", runId: run.id });

    expect(terminalMgr.close).toHaveBeenCalledWith(run.terminalId);
    expect(stopped).toMatchObject({
      id: run.id,
      status: "stopped",
      finishedAt: 1000,
    });
    expect(events.at(-1)?.type).toBe("task.run.stopped");
  });
});
