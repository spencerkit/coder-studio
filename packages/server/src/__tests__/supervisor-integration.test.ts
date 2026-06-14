import type { Result, Session, Supervisor } from "@coder-studio/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerConfig } from "../config.js";
import { createServer, type Server } from "../server.js";
import type { SupervisorEvaluationContext } from "../supervisor/context-builder.js";
import type { SupervisorEvaluationResult } from "../supervisor/evaluator.js";
import type { SupervisorManager } from "../supervisor/manager.js";
import { type CommandContext, dispatch } from "../ws/dispatch.js";

type MutableSupervisorManager = SupervisorManager & {
  deps: {
    providerConfigRepo: {
      get: (providerId: string) => Record<string, unknown> | undefined;
    };
  };
  contextBuilder: {
    build: (supervisor: Supervisor) => Promise<SupervisorEvaluationContext>;
  };
  evaluator: {
    evaluate: (
      supervisor: Supervisor,
      context: SupervisorEvaluationContext,
      options?: { signal?: AbortSignal }
    ) => Promise<SupervisorEvaluationResult>;
  };
  logger: unknown;
};

type SupervisorGetResult = Result & {
  ok: true;
  data?: {
    supervisor: Supervisor | null;
  };
};

const TEST_SERVER_CONFIG: Partial<ServerConfig> = {
  stateDir: ":memory:",
  host: "127.0.0.1",
  port: 0,
};

const createSessionRecord = (): Session => ({
  id: "sess-1",
  workspaceId: "ws-1",
  terminalId: "term-1",
  providerId: "claude",
  state: "running",
  capability: "full",
  startedAt: 1,
  lastActiveAt: 1,
});

const buildTargetMemory = () => ({
  schemaVersion: 2 as const,
  targetId: "tgt-1",
  planTree: {
    id: "plan-root",
    title: "Supervisor target",
    objective: "Complete the supervised target",
    deliverable: "Completed target",
    acceptanceCriteria: ["Target objective is complete"],
    status: "in_progress" as const,
    taskType: "generic" as const,
    children: [
      {
        id: "stage-1",
        title: "Verify end-to-end persistence",
        objective: "Confirm the end-to-end persistence flow works",
        deliverable: "A validated persistence verification pass",
        acceptanceCriteria: ["Persistence flow is verified"],
        status: "in_progress" as const,
        taskType: "generic" as const,
        children: [],
      },
    ],
  },
  activeNodeId: "stage-1",
  maxDepth: 6,
  planRevision: 0,
  stalledCount: 0,
  updatedAt: 1,
});

describe("Supervisor integration", () => {
  let server: Server;

  const getCommandContext = (): CommandContext => server.__test__!.commandContext as CommandContext;

  const getSupervisorManagerInternals = (): MutableSupervisorManager =>
    getCommandContext().supervisorMgr as unknown as MutableSupervisorManager;

  beforeEach(async () => {
    server = await createServer(TEST_SERVER_CONFIG);

    const ctx = getCommandContext();

    ctx.workspaceMgr.get = () => ({ id: "ws-1", path: process.cwd() });
    ctx.sessionMgr.get = () => createSessionRecord();
    ctx.sessionMgr.getRenderedSnapshot = async () =>
      "assistant: built the persistent supervisor repos";
    ctx.sessionMgr.getLatestSubmittedUserInput = () => "run the tests";

    const supervisorManager = getSupervisorManagerInternals();
    supervisorManager.deps.providerConfigRepo.get = () => ({
      model: "claude-sonnet-4-6",
      additionalArgs: [],
      envVars: {},
    });
    supervisorManager.contextBuilder = {
      build: async () => ({
        objective: "Verify end-to-end persistence",
        sessionId: "sess-1",
        workspaceId: "ws-1",
        workspacePath: process.cwd(),
        sessionProviderId: "claude",
        evaluatorProviderId: "claude",
        sessionState: "running",
        terminalExcerpt: "assistant: built the persistent supervisor repos",
        evidenceSource: "headless_snapshot",
        latestUserInput: "run the tests",
        targetMemory: buildTargetMemory(),
      }),
    };
    supervisorManager.evaluator = {
      evaluate: async (_supervisor, _context, options) =>
        options?.mode === "decompose"
          ? {
              mode: "decompose",
              children: [
                {
                  id: "stage-1",
                  title: "Verify end-to-end persistence",
                  objective: "Confirm the end-to-end persistence flow works",
                  deliverable: "A validated persistence verification pass",
                  acceptanceCriteria: ["Persistence flow is verified"],
                  status: "in_progress",
                  taskType: "generic",
                  children: [],
                },
              ],
              activeNodeId: "stage-1",
              progressSummary: "Decomposition complete",
            }
          : options?.mode === "ready_check"
            ? {
                mode: "ready_check",
                nodeId: "stage-1",
                taskType: "generic",
                granularity: "too_small",
                reason: "Current stage is already narrow enough",
              }
            : {
                mode: "evaluate",
                status: "continue",
                reason: "Keep going",
                guidance: "",
              },
    };
  });

  afterEach(async () => {
    await server?.stop();
  });

  it("creates a cycle on manual trigger and persists it into supervisor.get", async () => {
    const ctx = getCommandContext();

    const created = await ctx.supervisorMgr.create({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Verify end-to-end persistence",
      evaluatorProviderId: "claude",
    });

    const cycle = await ctx.supervisorMgr.triggerEvaluation(created.id);
    expect(cycle.trigger).toBe("manual");
    expect(cycle.status).toBe("evaluating");

    await waitFor(async () => {
      const current = ctx.supervisorMgr.get(created.id);
      const latest = current?.recentTargetCycles?.find((entry) => entry.cycleId === cycle.id);
      if (!latest || latest.result === undefined) {
        throw new Error("cycle still in flight");
      }
    });

    const fetched = (await dispatch(
      {
        kind: "command",
        id: "cmd-supervisor-get",
        op: "supervisor.get",
        args: { sessionId: "sess-1" },
      },
      ctx
    )) as SupervisorGetResult;

    expect(fetched.ok).toBe(true);
    expect(fetched.data?.supervisor?.recentTargetCycles).toHaveLength(1);
    expect(fetched.data?.supervisor?.recentTargetCycles?.[0]?.targetId).toBe(created.targetId);
    expect(fetched.data?.supervisor?.recentTargetCycles?.[0]).toEqual(
      expect.objectContaining({
        result: "continue",
        reason: "Keep going",
        injected: false,
      })
    );
  });

  it("wires supervisor manager to the shared Fastify logger", () => {
    expect(getSupervisorManagerInternals().logger).toBe(server.app.log);
  });
});

async function waitFor(
  fn: () => Promise<void> | void,
  { timeoutMs = 1000, intervalMs = 10 } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await fn();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("waitFor timed out");
}
