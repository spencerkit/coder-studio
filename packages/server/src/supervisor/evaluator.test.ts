import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_SUPERVISOR_EVALUATION_TIMEOUT_SEC,
  type ProviderDefinition,
  type Supervisor,
} from "@coder-studio/core";
import type { FastifyBaseLogger } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, openDatabase } from "../storage/db.js";
import type { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import { SettingsRepo } from "../storage/repositories/settings-repo.js";
import type { SupervisorEvaluationContext } from "./context-builder.js";
import { SupervisorEvaluator } from "./evaluator.js";
import { getSupervisorEvaluationTimeoutMs } from "./settings.js";

function nodeEchoCommand(stdout: string) {
  return {
    argv: ["node", "-e", `process.stdout.write(${JSON.stringify(stdout)})`],
    cwd: process.cwd(),
    env: {},
  };
}

function createProvider(
  providerId: string,
  stdout: string,
  options?: { defaultConfig?: Record<string, unknown> }
): ProviderDefinition {
  return {
    id: providerId,
    buildSupervisorEvalCommand: vi.fn(() => nodeEchoCommand(stdout)),
    defaultConfig: options?.defaultConfig,
  } as unknown as ProviderDefinition;
}

function createProviderConfigRepo(
  config: Record<string, unknown> | undefined = { additionalArgs: [], envVars: {} }
): ProviderConfigRepo {
  return {
    get: vi.fn(() => config),
  } as unknown as ProviderConfigRepo;
}

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

function makeEvaluator(
  stdout: string,
  providerId = "codex",
  config?: { guidanceMaxChars?: number }
) {
  return new SupervisorEvaluator({
    providerRegistry: [createProvider(providerId, stdout)],
    providerConfigRepo: createProviderConfigRepo(),
    timeoutMs: 5000,
    config: config
      ? { guidanceMaxChars: config.guidanceMaxChars ?? 2000, guidanceDedupeWindow: 2 }
      : undefined,
  });
}

function continuePayload(overrides?: Partial<Record<string, unknown>>): string {
  return JSON.stringify({
    status: "continue",
    reason: "Need more work",
    guidance: "next step: run tests",
    ...overrides,
  });
}

function stopPayload(overrides?: Partial<Record<string, unknown>>): string {
  return JSON.stringify({
    status: "stop",
    stopReason: "objective_complete",
    reason: "The target is complete",
    ...overrides,
  });
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

function makeSupervisor(evaluatorProviderId = "codex"): Supervisor {
  return {
    id: "sup-1",
    sessionId: "sess-1",
    workspaceId: "ws-1",
    targetId: "tgt-1",
    state: "idle",
    objective: "obj",
    evaluatorProviderId,
    maxSupervisionCount: 0,
    completedSupervisionCount: 0,
    recentTargetCycles: [],
    cycles: [],
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
      targetId: "tgt-1",
      planGenerated: true,
      plan: [{ id: "step-1", title: "Verify the fix", status: "in_progress" }],
      activeStepId: "step-1",
      progressSummary: "Verification in progress",
      lastGuidance: "Run the focused tests",
      stalledCount: 0,
      updatedAt: 1,
    },
  };
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("SupervisorEvaluator", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("uses supervisor.evaluatorProviderId instead of the session provider", async () => {
    const evaluator = new SupervisorEvaluator({
      providerRegistry: [
        createProvider("claude", continuePayload({ guidance: "should not be used" })),
        createProvider(
          "codex",
          codexJsonlPayload(continuePayload({ guidance: "next step: run tests" }))
        ),
      ],
      providerConfigRepo: createProviderConfigRepo(),
      timeoutMs: 5000,
    });

    const result = await evaluator.evaluate(
      {
        ...makeSupervisor("codex"),
        objective: "Finish the evaluator runner",
      },
      {
        objective: "Finish the evaluator runner",
        sessionId: "sess-1",
        workspaceId: "ws-1",
        workspacePath: process.cwd(),
        sessionProviderId: "claude",
        evaluatorProviderId: "codex",
        sessionState: "running",
        evidenceSource: "headless_snapshot",
        terminalExcerpt: "build passes",
        latestUserInput: "run the tests",
        targetMemory: makeContext().targetMemory,
      }
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: "continue",
        reason: "Need more work",
        guidance: "next step: run tests",
      })
    );
  });

  it("prefers supervisor.evaluatorModel over provider config model", async () => {
    const provider = createProvider("claude", continuePayload(), {
      defaultConfig: { model: "gpt-4.1", additionalArgs: [], envVars: {} },
    });
    const evaluator = new SupervisorEvaluator({
      providerRegistry: [provider],
      providerConfigRepo: createProviderConfigRepo({
        model: "gpt-4.1",
        additionalArgs: [],
        envVars: {},
      }),
      timeoutMs: 5000,
    });

    const result = await evaluator.evaluate(
      {
        ...makeSupervisor("claude"),
        evaluatorModel: "o3",
      },
      makeContext()
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: "continue",
        guidance: "next step: run tests",
      })
    );
    expect(provider.buildSupervisorEvalCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: "o3" })
    );
  });

  it("builds a bootstrap prompt when planGenerated is false", async () => {
    const evaluator = makeEvaluator(
      JSON.stringify({
        status: "continue",
        reason: "Need a plan first",
        guidance: "Break the objective into 3 to 7 steps",
        plan: [
          { id: "step-1", title: "Inspect current behavior", status: "in_progress" },
          { id: "step-2", title: "Implement target store", status: "pending" },
        ],
        activeStepId: "step-1",
        progressSummary: "Initial decomposition complete",
      }),
      "claude"
    );

    const result = await evaluator.evaluate(makeSupervisor("claude"), {
      ...makeContext(),
      targetMemory: {
        targetId: "tgt-1",
        planGenerated: false,
        plan: [],
        stalledCount: 0,
        updatedAt: 1,
      },
    });

    expect(result.status).toBe("continue");
    expect(result.plan?.map((step) => step.title)).toEqual([
      "Inspect current behavior",
      "Implement target store",
    ]);
    expect(result.guidance).toBe("Break the objective into 3 to 7 steps");
  });

  it("parses a stop result with stopReason", async () => {
    const evaluator = makeEvaluator(
      JSON.stringify({
        status: "stop",
        stopReason: "objective_complete",
        reason: "The target is complete",
      }),
      "claude"
    );

    await expect(evaluator.evaluate(makeSupervisor("claude"), makeContext())).resolves.toEqual({
      status: "stop",
      stopReason: "objective_complete",
      reason: "The target is complete",
    });
  });

  it("rejects needs_user_input as a stopReason", async () => {
    const evaluator = makeEvaluator(
      JSON.stringify({
        status: "stop",
        stopReason: "needs_user_input",
        reason: "Need user input",
      }),
      "claude"
    );

    await expect(evaluator.evaluate(makeSupervisor("claude"), makeContext())).rejects.toThrow(
      "Supervisor stop result is missing a valid stopReason"
    );
  });

  it("falls back to provider.defaultConfig when evaluator config is missing", async () => {
    const evaluator = new SupervisorEvaluator({
      providerRegistry: [
        createProvider("claude", continuePayload({ guidance: "proceed with review" }), {
          defaultConfig: { model: "claude-sonnet-4-6", additionalArgs: [], envVars: {} },
        }),
      ],
      providerConfigRepo: createProviderConfigRepo(undefined),
      timeoutMs: 5000,
    });

    const result = await evaluator.evaluate(
      {
        ...makeSupervisor("claude"),
        objective: "Finish the evaluator runner",
      },
      {
        objective: "Finish the evaluator runner",
        sessionId: "sess-1",
        workspaceId: "ws-1",
        workspacePath: process.cwd(),
        sessionProviderId: "codex",
        evaluatorProviderId: "claude",
        sessionState: "running",
        evidenceSource: "headless_snapshot",
        terminalExcerpt: "build passes",
        latestUserInput: "run the tests",
        targetMemory: makeContext().targetMemory,
      }
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: "continue",
        guidance: "proceed with review",
      })
    );
  });

  it("uses the shared 600-second default timeout when the setting is missing", () => {
    expect(getSupervisorEvaluationTimeoutMs()).toBe(
      DEFAULT_SUPERVISOR_EVALUATION_TIMEOUT_SEC * 1000
    );
    expect(
      getSupervisorEvaluationTimeoutMs({
        get: vi.fn(() => undefined),
      } as never)
    ).toBe(DEFAULT_SUPERVISOR_EVALUATION_TIMEOUT_SEC * 1000);
  });

  it("uses the stored supervisor timeout setting when available", () => {
    expect(
      getSupervisorEvaluationTimeoutMs({
        get: vi.fn(() => 900),
      } as never)
    ).toBe(900_000);
  });

  it("falls back to the default timeout when the stored setting exceeds the supported maximum", () => {
    expect(
      getSupervisorEvaluationTimeoutMs({
        get: vi.fn(() => 999_999_999),
      } as never)
    ).toBe(DEFAULT_SUPERVISOR_EVALUATION_TIMEOUT_SEC * 1000);
  });

  it("falls back to the default timeout when the stored setting is fractional", () => {
    expect(
      getSupervisorEvaluationTimeoutMs({
        get: vi.fn(() => 1.9),
      } as never)
    ).toBe(DEFAULT_SUPERVISOR_EVALUATION_TIMEOUT_SEC * 1000);
  });

  it("falls back to the default timeout when reading the stored setting throws", () => {
    expect(
      getSupervisorEvaluationTimeoutMs({
        get: vi.fn(() => {
          throw new SyntaxError("Unexpected token");
        }),
      } as never)
    ).toBe(DEFAULT_SUPERVISOR_EVALUATION_TIMEOUT_SEC * 1000);
  });

  it("reads the evaluator timeout from settingsRepo when timeoutMs is not provided", async () => {
    const settingsRepo = {
      get: vi.fn(() => 900),
    };
    const evaluator = new SupervisorEvaluator({
      providerRegistry: [createProvider("claude", continuePayload())],
      providerConfigRepo: createProviderConfigRepo(),
      settingsRepo: settingsRepo as never,
    });

    const result = await evaluator.evaluate(makeSupervisor("claude"), makeContext());

    expect(result.guidance).toBe("next step: run tests");
    expect(settingsRepo.get).toHaveBeenCalledWith("supervisor.evaluationTimeoutSec");
  });

  it("falls back to the default timeout when the stored row is malformed JSON", async () => {
    const db = openDatabase(":memory:");

    try {
      db.prepare("INSERT INTO user_settings (key, value) VALUES (?, ?)").run(
        "supervisor.evaluationTimeoutSec",
        "not-json"
      );

      const evaluator = new SupervisorEvaluator({
        providerRegistry: [createProvider("claude", continuePayload())],
        providerConfigRepo: createProviderConfigRepo(),
        settingsRepo: new SettingsRepo(db),
      });

      const result = await evaluator.evaluate(makeSupervisor("claude"), makeContext());

      expect(result.guidance).toBe("next step: run tests");
    } finally {
      closeDatabase(db);
    }
  });

  it("builds a natural language prompt matching the develop supervisor pattern", async () => {
    const logger = createLogger();
    const evaluator = new SupervisorEvaluator({
      providerRegistry: [createProvider("codex", "")],
      providerConfigRepo: createProviderConfigRepo(),
      timeoutMs: 5000,
      logger,
    });

    await expect(
      evaluator.evaluate(makeSupervisor("codex"), {
        ...makeContext(),
        objective: "Ship the fix",
        terminalExcerpt: "latest output",
      })
    ).rejects.toThrow();

    const prompt = (logger.warn.mock.calls[0]?.[0] as { prompt?: string } | undefined)?.prompt;
    expect(prompt).toContain("You are an autonomous supervisor for a target-scoped software task.");
    expect(prompt).toContain("Return JSON only.");
    expect(prompt).toContain('Prefer "continue" whenever there is a reasonable next action.');
    expect(prompt).toContain(
      "Do not ask the user to decide, clarify, or choose among implementation options."
    );
    expect(prompt).toContain("Use the target memory as the current supervision state.");
    expect(prompt).toContain("Identify which plan step is currently active.");
    expect(prompt).toContain("If the active step is done, advance to the next useful step.");
    expect(prompt).toContain(
      "If the agent appears stuck or repeated the same action, give a different concrete next action."
    );
    expect(prompt).toContain('Use "supervisor_uncertain" only as a last resort');
    expect(prompt).toContain('Guidance requirements for "continue":');
    expect(prompt).toContain(
      "Be specific enough for the supervised agent to act without asking the user."
    );
    expect(prompt).toContain("Current objective:");
    expect(prompt).toContain("Ship the fix");
    expect(prompt).toContain("Current target memory:");
    expect(prompt).toContain('"targetId": "tgt-1"');
    expect(prompt).toContain("Latest user input:");
    expect(prompt).toContain("run the tests");
    expect(prompt).toContain("Current terminal snapshot:");
    expect(prompt).toContain("latest output");
    expect(prompt).toContain('"continue"');
    expect(prompt).toContain('"stop"');
  });

  it("aborts the evaluator process group when the signal is cancelled", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "supervisor-evaluator-"));
    const pidFile = path.join(tempDir, "pids.json");
    const script = [
      'const { spawn } = require("node:child_process");',
      'const fs = require("node:fs");',
      `const pidFile = ${JSON.stringify(pidFile)};`,
      'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
      "fs.writeFileSync(pidFile, JSON.stringify({ parent: process.pid, child: child.pid }));",
      "setInterval(() => {}, 1000);",
    ].join(" ");
    const evaluator = new SupervisorEvaluator({
      providerRegistry: [
        {
          id: "codex",
          buildSupervisorEvalCommand: vi.fn(() => ({
            argv: [process.execPath, "-e", script],
            cwd: process.cwd(),
            env: {},
          })),
        } as unknown as ProviderDefinition,
      ],
      providerConfigRepo: createProviderConfigRepo(),
      timeoutMs: 5000,
    });
    const controller = new AbortController();

    let pids: { parent: number; child: number } | null = null;
    try {
      const evaluation = evaluator.evaluate(makeSupervisor("codex"), makeContext(), {
        signal: controller.signal,
      });

      await waitFor(() => {
        expect(existsSync(pidFile)).toBe(true);
      });
      pids = JSON.parse(readFileSync(pidFile, "utf8")) as {
        parent: number;
        child: number;
      };

      controller.abort();

      await expect(evaluation).rejects.toMatchObject({
        code: "supervisor_eval_aborted",
      });

      await waitFor(() => {
        expect(isPidAlive(pids.parent)).toBe(false);
        expect(isPidAlive(pids.child)).toBe(false);
      });
    } finally {
      if (pids?.parent && isPidAlive(pids.parent)) {
        try {
          process.kill(-pids.parent, "SIGKILL");
        } catch {
          process.kill(pids.parent, "SIGKILL");
        }
      }
      if (pids?.child && isPidAlive(pids.child)) {
        process.kill(pids.child, "SIGKILL");
      }
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  describe("message extraction", () => {
    it("parses agent_message text from codex JSONL stream", async () => {
      const jsonl = [
        JSON.stringify({ type: "thread.started", thread_id: "t1" }),
        JSON.stringify({ type: "turn.started" }),
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "i1",
            type: "agent_message",
            text: continuePayload({ guidance: "Run pnpm vitest to verify" }),
          },
        }),
        JSON.stringify({ type: "turn.completed", usage: { output_tokens: 20 } }),
      ].join("\n");

      const evaluator = makeEvaluator(jsonl, "codex");
      const result = await evaluator.evaluate(makeSupervisor("codex"), makeContext());

      expect(result.guidance).toBe("Run pnpm vitest to verify");
    });

    it("falls back to reasoning text when agent_message is missing", async () => {
      const jsonl = [
        JSON.stringify({ type: "thread.started", thread_id: "t1" }),
        JSON.stringify({ type: "turn.started" }),
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "i0",
            type: "reasoning",
            text: continuePayload({ guidance: "Continue with the tests" }),
          },
        }),
        JSON.stringify({ type: "turn.completed", usage: { output_tokens: 50 } }),
      ].join("\n");

      const evaluator = makeEvaluator(jsonl, "codex");
      const result = await evaluator.evaluate(makeSupervisor("codex"), makeContext());

      expect(result.guidance).toBe("Continue with the tests");
    });

    it("accepts assistant_message (older codex builds)", async () => {
      const jsonl = [
        JSON.stringify({ type: "thread.started", thread_id: "t1" }),
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "i0",
            item_type: "assistant_message",
            text: continuePayload({ guidance: "All good" }),
          },
        }),
        JSON.stringify({ type: "turn.completed", usage: { output_tokens: 40 } }),
      ].join("\n");

      const evaluator = makeEvaluator(jsonl, "codex");
      const result = await evaluator.evaluate(makeSupervisor("codex"), makeContext());

      expect(result.guidance).toBe("All good");
    });

    it("strips markdown code fence from agent_message text", async () => {
      const fenced = `\`\`\`json\n${continuePayload({ guidance: "Run the tests" })}\n\`\`\``;
      const jsonl = [
        JSON.stringify({ type: "thread.started", thread_id: "t1" }),
        JSON.stringify({ type: "turn.started" }),
        JSON.stringify({
          type: "item.completed",
          item: { id: "i1", type: "agent_message", text: fenced },
        }),
        JSON.stringify({ type: "turn.completed", usage: {} }),
      ].join("\n");

      const evaluator = makeEvaluator(jsonl, "codex");
      const result = await evaluator.evaluate(makeSupervisor("codex"), makeContext());

      expect(result.guidance).toBe("Run the tests");
    });

    it("parses claude --output-format json envelope (result field)", async () => {
      const claudeEnvelope = JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 42,
        result: continuePayload({ guidance: "Proceed to the next step" }),
        session_id: "uuid",
      });

      const evaluator = makeEvaluator(claudeEnvelope, "claude");
      const result = await evaluator.evaluate(makeSupervisor("claude"), makeContext());

      expect(result.guidance).toBe("Proceed to the next step");
    });

    it("surfaces codex turn.failed error details", async () => {
      const jsonl = JSON.stringify({
        type: "turn.failed",
        error: { message: "context length exceeded" },
      });

      const evaluator = makeEvaluator(jsonl, "codex");

      await expect(evaluator.evaluate(makeSupervisor("codex"), makeContext())).rejects.toThrow(
        "context length exceeded"
      );
    });

    it("raises when codex stream has no agent_message or reasoning", async () => {
      const jsonl =
        JSON.stringify({ type: "thread.started", thread_id: "t1" }) +
        "\n" +
        JSON.stringify({ type: "turn.started" }) +
        "\n" +
        JSON.stringify({ type: "turn.completed", usage: { output_tokens: 191 } });

      const evaluator = makeEvaluator(jsonl, "codex");

      await expect(evaluator.evaluate(makeSupervisor("codex"), makeContext())).rejects.toThrow(
        /completed without returning a message/i
      );
    });

    it("truncates message to guidanceMaxChars", async () => {
      const longMessage = "A".repeat(500);
      const jsonl = [
        JSON.stringify({ type: "thread.started", thread_id: "t1" }),
        JSON.stringify({ type: "turn.started" }),
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "i1",
            type: "agent_message",
            text: continuePayload({ guidance: longMessage }),
          },
        }),
        JSON.stringify({ type: "turn.completed", usage: {} }),
      ].join("\n");

      const evaluator = makeEvaluator(jsonl, "codex", { guidanceMaxChars: 100 });
      const result = await evaluator.evaluate(makeSupervisor(), makeContext());

      expect(result.guidance).toHaveLength(100);
    });
  });
});

async function waitFor(fn: () => void, { timeoutMs = 3000, intervalMs = 20 } = {}): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      fn();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("waitFor timed out");
}
