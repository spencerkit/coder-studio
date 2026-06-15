import { EventEmitter } from "node:events";
import type { ProviderDefinition, Supervisor } from "@coder-studio/core";
import type { FastifyBaseLogger } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import type { SupervisorEvaluationContext } from "./context-builder.js";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { SupervisorEvaluator } from "./evaluator.js";

type MockLogger = FastifyBaseLogger & {
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

function createLogger(): MockLogger {
  const logger = {
    child: () => logger,
    debug: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    info: vi.fn(),
    level: "info",
    silent: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  } as unknown as MockLogger;
  return logger;
}

function createProvider(commandEnv: Record<string, string>): ProviderDefinition {
  return {
    id: "codex",
    headless: {
      supportedScenarios: ["supervisor_eval"],
      buildCommand: vi.fn((_, scenario, req) =>
        scenario === "supervisor_eval"
          ? {
              argv: ["codex", "exec", "--json", req.prompt],
              cwd: process.cwd(),
              env: {
                ...commandEnv,
                CODER_STUDIO_SESSION_ID: req.sessionId,
              },
            }
          : null
      ),
    },
  } as unknown as ProviderDefinition;
}

function createProviderConfigRepo(): ProviderConfigRepo {
  return {
    get: vi.fn(() => ({ additionalArgs: [], envVars: {} })),
  } as unknown as ProviderConfigRepo;
}

function makeSupervisor(): Supervisor {
  return {
    id: "sup-1",
    sessionId: "sess-1",
    workspaceId: "ws-1",
    targetId: "tgt-1",
    state: "idle",
    objective: "obj",
    evaluatorProviderId: "codex",
    maxSupervisionCount: 0,
    completedSupervisionCount: 0,
    recentTargetCycles: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeContext(): SupervisorEvaluationContext {
  return {
    objective: "obj",
    sessionId: "sess-1",
    workspaceId: "ws-1",
    workspacePath: process.cwd(),
    sessionProviderId: "claude",
    evaluatorProviderId: "codex",
    sessionState: "running",
    evidenceSource: "headless_snapshot",
    terminalExcerpt: "build passes",
    latestUserInput: "run the tests",
    targetMemory: {
      schemaVersion: 2,
      targetId: "tgt-1",
      planTree: {
        id: "root",
        title: "Supervisor target",
        objective: "Complete the supervised target",
        deliverable: "Completed target",
        acceptanceCriteria: ["Target objective is complete"],
        status: "in_progress",
        taskType: "generic",
        children: [],
      },
      activeNodeId: "root",
      maxDepth: 6,
      planRevision: 0,
      stalledCount: 0,
      updatedAt: 1,
    },
  };
}

function createSuccessfulChild() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
  };

  child.pid = 1234;
  child.stdout = stdout;
  child.stderr = stderr;

  return child;
}

function codexJsonlPayload(text: string): string {
  return [
    JSON.stringify({ type: "thread.started", thread_id: "t1" }),
    JSON.stringify({ type: "turn.started" }),
    JSON.stringify({
      type: "item.completed",
      item: { id: "i1", type: "agent_message", text },
    }),
    JSON.stringify({ type: "turn.completed", usage: { output_tokens: 20 } }),
  ].join("\n");
}

function continuePayload(overrides?: Partial<Record<string, unknown>>): string {
  return JSON.stringify({
    status: "continue",
    reason: "Need more work",
    guidance: "next step: run tests",
    ...overrides,
  });
}

function spawnE2BigError() {
  return Object.assign(new Error("spawn E2BIG"), {
    code: "E2BIG",
    errno: -7,
    syscall: "spawn",
  });
}

describe("SupervisorEvaluator environment handling", () => {
  const originalEnv = {
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    SUPERVISOR_NOISE: process.env.SUPERVISOR_NOISE,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    LANG: process.env.LANG,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.APPDATA = "C:\\Users\\tester\\AppData\\Roaming";
    process.env.LOCALAPPDATA = "C:\\Users\\tester\\AppData\\Local";
    process.env.SUPERVISOR_NOISE = "x".repeat(4096);
    process.env.HTTPS_PROXY = "http://proxy.example:8080";
    process.env.LANG = "en_US.UTF-8";
  });

  afterEach(() => {
    if (originalEnv.APPDATA === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = originalEnv.APPDATA;
    }
    if (originalEnv.LOCALAPPDATA === undefined) {
      delete process.env.LOCALAPPDATA;
    } else {
      process.env.LOCALAPPDATA = originalEnv.LOCALAPPDATA;
    }
    if (originalEnv.SUPERVISOR_NOISE === undefined) {
      delete process.env.SUPERVISOR_NOISE;
    } else {
      process.env.SUPERVISOR_NOISE = originalEnv.SUPERVISOR_NOISE;
    }
    if (originalEnv.HTTPS_PROXY === undefined) {
      delete process.env.HTTPS_PROXY;
    } else {
      process.env.HTTPS_PROXY = originalEnv.HTTPS_PROXY;
    }
    if (originalEnv.LANG === undefined) {
      delete process.env.LANG;
    } else {
      process.env.LANG = originalEnv.LANG;
    }
  });

  it("does not inherit unrelated process env when spawning the evaluator", async () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    spawnMock.mockImplementation((_file, _args, options) => {
      capturedEnv = options?.env;
      const child = createSuccessfulChild();
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from(codexJsonlPayload(continuePayload())));
        child.emit("exit", 0);
      });
      return child;
    });

    const evaluator = new SupervisorEvaluator({
      providerRegistry: [createProvider({ OPENAI_API_KEY: "sk-test" })],
      providerConfigRepo: createProviderConfigRepo(),
      timeoutMs: 5000,
      logger: createLogger(),
    });

    await expect(evaluator.evaluate(makeSupervisor(), makeContext())).resolves.toMatchObject({
      mode: "evaluate",
      status: "continue",
    });

    expect(capturedEnv).toBeDefined();
    expect(capturedEnv).not.toHaveProperty("SUPERVISOR_NOISE");
    expect(capturedEnv).toHaveProperty("APPDATA", "C:\\Users\\tester\\AppData\\Roaming");
    expect(capturedEnv).toHaveProperty("LOCALAPPDATA", "C:\\Users\\tester\\AppData\\Local");
    expect(capturedEnv).toHaveProperty("OPENAI_API_KEY", "sk-test");
    expect(capturedEnv).toHaveProperty("CODER_STUDIO_SESSION_ID", "sess-1");
  });

  it("retries with a smaller environment after E2BIG", async () => {
    const capturedEnvs: Array<Record<string, string> | undefined> = [];
    spawnMock
      .mockImplementationOnce((_file, _args, options) => {
        capturedEnvs.push(options?.env);
        throw spawnE2BigError();
      })
      .mockImplementationOnce((_file, _args, options) => {
        capturedEnvs.push(options?.env);
        const child = createSuccessfulChild();
        queueMicrotask(() => {
          child.stdout.emit("data", Buffer.from(codexJsonlPayload(continuePayload())));
          child.emit("exit", 0);
        });
        return child;
      });

    const evaluator = new SupervisorEvaluator({
      providerRegistry: [createProvider({ OPENAI_API_KEY: "sk-test" })],
      providerConfigRepo: createProviderConfigRepo(),
      timeoutMs: 5000,
      logger: createLogger(),
    });

    await expect(evaluator.evaluate(makeSupervisor(), makeContext())).resolves.toMatchObject({
      mode: "evaluate",
      status: "continue",
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(capturedEnvs[0]).toBeDefined();
    expect(capturedEnvs[1]).toBeDefined();
    expect(capturedEnvs[0]).toHaveProperty("HTTPS_PROXY", "http://proxy.example:8080");
    expect(capturedEnvs[1]).not.toHaveProperty("HTTPS_PROXY");
    expect(Object.keys(capturedEnvs[1] ?? {}).length).toBeLessThan(
      Object.keys(capturedEnvs[0] ?? {}).length
    );
  });
});
