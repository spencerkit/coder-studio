import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_SUPERVISOR_EVALUATION_TIMEOUT_SEC,
  type ProviderDefinition,
  type Supervisor,
} from "@coder-studio/core";
import type { FastifyBaseLogger } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

function nodeExitCommand(options: { stdout?: string; stderr?: string; exitCode: number }) {
  const stdout = options.stdout ?? "";
  const stderr = options.stderr ?? "";
  return {
    argv: [
      "node",
      "-e",
      `process.stdout.write(${JSON.stringify(stdout)}); process.stderr.write(${JSON.stringify(stderr)}); process.exit(${options.exitCode});`,
    ],
    cwd: process.cwd(),
    env: {},
  };
}

function createCommandProvider(
  providerId: string,
  command: ReturnType<typeof nodeEchoCommand>
): ProviderDefinition {
  return {
    id: providerId,
    buildSupervisorEvalCommand: vi.fn(() => command),
  } as unknown as ProviderDefinition;
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
      ? {
          guidanceMaxChars: config.guidanceMaxChars ?? 2000,
          maxCyclesPerSession: 100,
          terminalLinesForEvaluation: 500,
        }
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
      decompositionGenerated: true,
      decompositionMode: "stage",
      items: [
        {
          id: "stage-1",
          kind: "stage",
          title: "Verify the fix",
          objective: "Confirm the fix works",
          deliverable: "A passing focused verification run",
          acceptanceCriteria: ["Focused verification passes"],
          status: "in_progress",
        },
      ],
      activeItemId: "stage-1",
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

  it("parses a valid decompose result with stage items", async () => {
    const evaluator = makeEvaluator(
      JSON.stringify({
        mode: "decompose",
        decompositionMode: "stage",
        items: [
          {
            id: "stage-1",
            kind: "stage",
            title: "Inspect current behavior",
            objective: "Understand the current implementation",
            deliverable: "A verified behavior summary",
            acceptanceCriteria: ["Behavior summary is captured"],
            status: "in_progress",
          },
        ],
        activeItemId: "stage-1",
        progressSummary: "Decomposition complete",
      }),
      "claude"
    );

    const result = await evaluator.evaluate(
      makeSupervisor("claude"),
      {
        ...makeContext(),
        targetMemory: {
          targetId: "tgt-1",
          decompositionGenerated: false,
          items: [],
          stalledCount: 0,
          updatedAt: 1,
        },
      },
      { mode: "decompose" }
    );

    expect(result.mode).toBe("decompose");
    expect(result.decompositionMode).toBe("stage");
    expect(result.items?.[0]?.title).toBe("Inspect current behavior");
  });

  it("rejects decompose results that do not return any items", async () => {
    const evaluator = makeEvaluator(
      JSON.stringify({
        mode: "decompose",
        decompositionMode: "stage",
        items: [],
      }),
      "claude"
    );

    await expect(
      evaluator.evaluate(
        makeSupervisor("claude"),
        {
          ...makeContext(),
          targetMemory: {
            targetId: "tgt-1",
            decompositionGenerated: false,
            items: [],
            stalledCount: 0,
            updatedAt: 1,
          },
        },
        { mode: "decompose" }
      )
    ).rejects.toThrow(/at least one valid item/i);
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
      mode: "evaluate",
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

  it("normalizes evaluator process start errors as retryable evaluator failures", async () => {
    const evaluator = new SupervisorEvaluator({
      providerRegistry: [
        {
          id: "claude",
          buildSupervisorEvalCommand: vi.fn(() => ({
            argv: ["definitely-missing-supervisor-evaluator-binary"],
            cwd: process.cwd(),
            env: {},
          })),
        } as unknown as ProviderDefinition,
      ],
      providerConfigRepo: createProviderConfigRepo(),
      timeoutMs: 5000,
    });

    await expect(evaluator.evaluate(makeSupervisor("claude"), makeContext())).rejects.toMatchObject(
      {
        code: "supervisor_eval_failed",
      }
    );
  });

  it("falls back to the default timeout when the stored settings file is malformed JSON", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "supervisor-evaluator-settings-"));

    try {
      const filePath = path.join(tempDir, "settings.json");
      writeFileSync(filePath, "{not-json", "utf-8");

      const evaluator = new SupervisorEvaluator({
        providerRegistry: [createProvider("claude", continuePayload())],
        providerConfigRepo: createProviderConfigRepo(),
        settingsRepo: new SettingsRepo({ filePath }),
      });

      const result = await evaluator.evaluate(makeSupervisor("claude"), makeContext());

      expect(result.guidance).toBe("next step: run tests");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
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
    expect(prompt).toContain("No prose before or after the JSON.");
    expect(prompt).toContain(
      'Prefer "continue" over "stop" whenever the objective is not yet verified complete and there is a concrete next action.'
    );
    expect(prompt).toContain(
      "Do not ask the user to decide, clarify, or choose among implementation options."
    );
    expect(prompt).toContain(
      "Do not treat the agent's claims, summaries, or self-reports as sufficient evidence of completion."
    );
    expect(prompt).toContain(
      "If the agent asks a question or presents multiple options, choose the most conservative reasonable option yourself and direct the next action."
    );
    expect(prompt).toContain("Use the target memory as the current supervision state.");
    expect(prompt).toContain("Identify which decomposition item is currently active.");
    expect(prompt).toContain(
      "Keep the current active item unless there is evidence that it is done, blocked, or obsolete."
    );
    expect(prompt).toContain(
      'Mark an item as "done" only when there is observable evidence that its deliverable or acceptanceCriteria were satisfied.'
    );
    expect(prompt).toContain(
      "If the current item appears nearly complete but is not yet verified, keep the same active item and direct targeted verification."
    );
    expect(prompt).toContain(
      "Advance to the next item only after the current item's deliverable or acceptanceCriteria are supported by observable evidence."
    );
    expect(prompt).toContain(
      "If the agent appears stuck or repeated the same action, give a different concrete next action."
    );
    expect(prompt).toContain("Do not stop only because the agent says the work is complete");
    expect(prompt).toContain('Guidance requirements for "continue":');
    expect(prompt).toContain(
      "Be specific enough for the supervised agent to act without asking the user."
    );
    expect(prompt).toContain(
      "If the agent asked a question, answer it directly in the guidance and continue with a concrete next action."
    );
    expect(prompt).toContain("Use itemUpdates to reflect evidence-backed status changes only.");
    expect(prompt).toContain(
      "If evidence is missing or ambiguous, prefer verification over further implementation."
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

  it("builds a decompose prompt that forbids questions and requires autonomous decisions", async () => {
    const logger = createLogger();
    const evaluator = new SupervisorEvaluator({
      providerRegistry: [createProvider("codex", "")],
      providerConfigRepo: createProviderConfigRepo(),
      timeoutMs: 5000,
      logger,
    });

    await expect(
      evaluator.evaluate(
        makeSupervisor("codex"),
        {
          ...makeContext(),
          objective: "Ship the fix",
          terminalExcerpt: "latest output",
          targetMemory: {
            targetId: "tgt-1",
            decompositionGenerated: false,
            items: [],
            stalledCount: 0,
            updatedAt: 1,
          },
        },
        { mode: "decompose" }
      )
    ).rejects.toThrow();

    const prompt = (logger.warn.mock.calls[0]?.[0] as { prompt?: string } | undefined)?.prompt;
    expect(prompt).toContain("Return JSON only.");
    expect(prompt).toContain("Do not ask the user any questions.");
    expect(prompt).toContain("Do not ask for clarification, confirmation, or approval.");
    expect(prompt).toContain("Do not propose options for the user to choose from.");
    expect(prompt).toContain(
      "If information is incomplete, make the most conservative reasonable assumptions and decide the decomposition yourself."
    );
    expect(prompt).toContain(
      "Your job is to return the best useful decomposition now, not to begin a discussion or planning workflow."
    );
    expect(prompt).toContain("No prose before or after the JSON.");
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

  describe("payload robustness", () => {
    it("preserves backtick-fenced snippets that appear inside a string value", async () => {
      const payload = JSON.stringify({
        status: "continue",
        reason: "Need to verify the change",
        guidance: "execute ```bash\nls -la\n``` and inspect output",
      });
      const evaluator = makeEvaluator(codexJsonlPayload(payload), "codex");

      const result = await evaluator.evaluate(makeSupervisor("codex"), makeContext());

      expect(result).toMatchObject({
        mode: "evaluate",
        status: "continue",
        guidance: "execute ```bash\nls -la\n``` and inspect output",
      });
    });

    it("auto-repairs payloads where the model used literal newlines in strings", async () => {
      const logger = createLogger();
      const malformed =
        '{"status":"continue","reason":"more work needed","guidance":"step 1: read foo.ts\nstep 2: run tests"}';
      const evaluator = new SupervisorEvaluator({
        providerRegistry: [createProvider("codex", codexJsonlPayload(malformed))],
        providerConfigRepo: createProviderConfigRepo(),
        timeoutMs: 5000,
        logger,
      });

      const result = await evaluator.evaluate(makeSupervisor("codex"), makeContext());

      expect(result).toMatchObject({
        mode: "evaluate",
        status: "continue",
        guidance: "step 1: read foo.ts\nstep 2: run tests",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadPreview: expect.any(String),
          repaired: true,
        }),
        expect.stringMatching(/auto-recovered/)
      );
    });

    it("extracts JSON when the model prefaces the payload with prose", async () => {
      const logger = createLogger();
      const prosePrefixed =
        'Based on my analysis of the terminal output, here is the supervisor verdict:\n\n{"status":"continue","reason":"need to verify","guidance":"run the focused tests"}\n\nThat should keep the agent moving.';
      const evaluator = new SupervisorEvaluator({
        providerRegistry: [createProvider("codex", codexJsonlPayload(prosePrefixed))],
        providerConfigRepo: createProviderConfigRepo(),
        timeoutMs: 5000,
        logger,
      });

      const result = await evaluator.evaluate(makeSupervisor("codex"), makeContext());

      expect(result).toMatchObject({
        mode: "evaluate",
        status: "continue",
        guidance: "run the focused tests",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "balanced-object",
          repaired: false,
          payloadPreview: expect.any(String),
        }),
        expect.stringMatching(/auto-recovered/)
      );
    });

    it("logs the payload preview and throws a retryable error when JSON is unrecoverable", async () => {
      const logger = createLogger();
      const garbage = '{"status":"continue","reason":"oops","this is not';
      const evaluator = new SupervisorEvaluator({
        providerRegistry: [createProvider("codex", codexJsonlPayload(garbage))],
        providerConfigRepo: createProviderConfigRepo(),
        timeoutMs: 5000,
        logger,
      });

      await expect(
        evaluator.evaluate(makeSupervisor("codex"), makeContext())
      ).rejects.toMatchObject({
        code: "supervisor_eval_failed",
        message: expect.stringMatching(/invalid JSON/i),
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadPreview: expect.any(String),
          parseError: expect.any(String),
        }),
        expect.stringMatching(/invalid JSON/i)
      );
    });
  });

  describe("non-zero evaluator exit diagnostics", () => {
    it("surfaces codex turn.failed messages emitted on stdout when the CLI exits non-zero", async () => {
      const logger = createLogger();
      const codexFailureStdout = [
        JSON.stringify({ type: "thread.started", thread_id: "t1" }),
        JSON.stringify({ type: "turn.started" }),
        JSON.stringify({
          type: "turn.failed",
          error: { message: "rate limit exceeded for model" },
        }),
      ].join("\n");

      const evaluator = new SupervisorEvaluator({
        providerRegistry: [
          createCommandProvider(
            "codex",
            nodeExitCommand({ stdout: codexFailureStdout, exitCode: 1 })
          ),
        ],
        providerConfigRepo: createProviderConfigRepo(),
        timeoutMs: 5000,
        logger,
      });

      await expect(
        evaluator.evaluate(makeSupervisor("codex"), makeContext())
      ).rejects.toMatchObject({
        code: "supervisor_eval_failed",
        message: "rate limit exceeded for model",
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          exitCode: 1,
          upstreamMessage: "rate limit exceeded for model",
          stdoutPreview: expect.any(String),
          stderrPreview: expect.any(String),
          commandArgv: expect.any(Array),
        }),
        expect.stringMatching(/evaluator process failed/i)
      );
    });

    it("surfaces claude is_error envelopes emitted on stdout when the CLI exits non-zero", async () => {
      const logger = createLogger();
      const claudeFailureStdout = JSON.stringify({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        result: "Anthropic API: 401 invalid x-api-key",
        session_id: "abc",
      });

      const evaluator = new SupervisorEvaluator({
        providerRegistry: [
          createCommandProvider(
            "claude",
            nodeExitCommand({ stdout: claudeFailureStdout, exitCode: 1 })
          ),
        ],
        providerConfigRepo: createProviderConfigRepo(),
        timeoutMs: 5000,
        logger,
      });

      await expect(
        evaluator.evaluate(makeSupervisor("claude"), makeContext())
      ).rejects.toMatchObject({
        code: "supervisor_eval_failed",
        message: "Anthropic API: 401 invalid x-api-key",
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          exitCode: 1,
          upstreamMessage: "Anthropic API: 401 invalid x-api-key",
        }),
        expect.stringMatching(/evaluator process failed/i)
      );
    });

    it("logs full process context even when neither stdout nor stderr has a usable message", async () => {
      const logger = createLogger();
      const evaluator = new SupervisorEvaluator({
        providerRegistry: [createCommandProvider("claude", nodeExitCommand({ exitCode: 1 }))],
        providerConfigRepo: createProviderConfigRepo(),
        timeoutMs: 5000,
        logger,
      });

      await expect(
        evaluator.evaluate(makeSupervisor("claude"), makeContext())
      ).rejects.toMatchObject({
        code: "supervisor_eval_failed",
        message: expect.stringMatching(/exited with code 1/i),
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          exitCode: 1,
          stdoutPreview: "",
          stderrPreview: "",
          commandArgv: expect.any(Array),
          promptPreview: expect.any(String),
        }),
        expect.stringMatching(/evaluator process failed/i)
      );
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
