import type { TaskDefinition, TaskRun } from "@coder-studio/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../commands/index.js";
import { type CommandContext, dispatch } from "../ws/dispatch.js";

function createContext(): CommandContext {
  const workspace = { id: "ws-1", path: "/repo" };
  const task: TaskDefinition = {
    id: "verify",
    workspaceId: "ws-1",
    kind: "verify",
    label: "Verify",
    command: "pnpm",
    args: ["ci:verify"],
    cwdPath: ".",
    source: "package-json",
    priority: 900,
  };
  const run: TaskRun = {
    id: "run-1",
    workspaceId: "ws-1",
    taskId: "verify",
    terminalId: "term-task",
    status: "running",
    command: "pnpm",
    args: ["ci:verify"],
    cwdPath: ".",
    startedAt: 100,
  };

  return {
    workspaceMgr: {
      get: vi.fn(() => workspace),
    },
    taskMgr: {
      setDiscoveredTasks: vi.fn((_workspaceId, tasks) => tasks),
      list: vi.fn(() => [task]),
      history: vi.fn(() => [run]),
      run: vi.fn(async () => run),
      rerun: vi.fn(async () => run),
      stop: vi.fn(async () => ({ ...run, status: "stopped", finishedAt: 200 })),
    },
    terminalMgr: {},
    sessionMgr: {},
    eventBus: {},
    broadcaster: {},
    settingsRepo: {},
    providerConfigRepo: {},
    providerRegistry: [],
    fencingMgr: {},
    supervisorMgr: {},
    autoFetch: {},
    activationMgr: { getLease: vi.fn(() => ({ wsClientId: "client-1" })) },
    lspMgr: {},
  } as unknown as CommandContext;
}

describe("task commands", () => {
  let ctx: CommandContext;

  beforeEach(() => {
    ctx = createContext();
  });

  it("lists task definitions", async () => {
    const result = await dispatch(
      { kind: "command", id: "cmd-1", op: "task.list", args: { workspaceId: "ws-1" } },
      ctx,
      "client-1"
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(ctx.taskMgr.list("ws-1"));
  });

  it("runs a task for the workspace root", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "cmd-1",
        op: "task.run",
        args: { workspaceId: "ws-1", taskId: "verify", themeBackground: "#0b1218" },
      },
      ctx,
      "client-1"
    );

    expect(result.ok).toBe(true);
    expect(ctx.taskMgr.run).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      taskId: "verify",
      themeBackground: "#0b1218",
    });
  });

  it("stops a running task", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "cmd-1",
        op: "task.stop",
        args: { workspaceId: "ws-1", runId: "run-1" },
      },
      ctx,
      "client-1"
    );

    expect(result.ok).toBe(true);
    expect(ctx.taskMgr.stop).toHaveBeenCalledWith({ workspaceId: "ws-1", runId: "run-1" });
  });

  it("returns workspace_not_found for missing workspaces", async () => {
    vi.mocked(ctx.workspaceMgr.get).mockReturnValueOnce(undefined);

    const result = await dispatch(
      {
        kind: "command",
        id: "cmd-1",
        op: "task.run",
        args: { workspaceId: "missing", taskId: "verify" },
      },
      ctx,
      "client-1"
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("workspace_not_found");
  });
});
