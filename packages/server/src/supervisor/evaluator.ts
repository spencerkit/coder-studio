import { spawn } from "node:child_process";
import {
  DEFAULT_SUPERVISOR_CONFIG,
  type ProviderDefinition,
  type Supervisor,
  type SupervisorConfig,
} from "@coder-studio/core";
import type { FastifyBaseLogger } from "fastify";
import { mergeProviderLaunchConfig } from "../provider-config.js";
import type { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import { escalateKillWithPolling } from "../terminal/pty-host.js";
import type { SupervisorEvaluationContext } from "./context-builder.js";

const NOOP_LOGGER: FastifyBaseLogger = {
  child: () => NOOP_LOGGER,
  debug: () => {},
  error: () => {},
  fatal: () => {},
  info: () => {},
  level: "silent",
  silent: () => {},
  trace: () => {},
  warn: () => {},
};

/**
 * Result of a supervisor evaluation cycle.
 * The message is the next instruction to send to the business agent.
 */
export interface SupervisorResult {
  message: string;
}

interface EvaluateOptions {
  signal?: AbortSignal;
}

export class SupervisorEvaluator {
  private readonly config: SupervisorConfig;
  private readonly logger: FastifyBaseLogger;

  constructor(
    private readonly deps: {
      providerRegistry: ProviderDefinition[];
      providerConfigRepo: ProviderConfigRepo;
      timeoutMs?: number;
      config?: SupervisorConfig;
      logger?: FastifyBaseLogger;
    }
  ) {
    this.config = deps.config ?? DEFAULT_SUPERVISOR_CONFIG;
    this.logger = deps.logger ?? NOOP_LOGGER;
  }

  async evaluate(
    supervisor: Supervisor,
    context: SupervisorEvaluationContext,
    options: EvaluateOptions = {}
  ): Promise<SupervisorResult> {
    const provider = this.deps.providerRegistry.find(
      (item) => item.id === supervisor.evaluatorProviderId
    );
    if (!provider?.buildSupervisorEvalCommand) {
      throw {
        code: "supervisor_invalid_evaluator_provider",
        message: "Evaluator provider does not support headless eval",
      };
    }

    const config = mergeProviderLaunchConfig(
      provider,
      this.deps.providerConfigRepo.get(provider.id)
    );

    const prompt = buildPrompt(context);
    const command = provider.buildSupervisorEvalCommand(config, {
      prompt,
      sessionId: supervisor.sessionId,
      workspacePath: context.workspacePath,
      model: typeof config.model === "string" ? config.model : undefined,
    });

    if (!command) {
      throw {
        code: "supervisor_invalid_evaluator_provider",
        message: "Evaluator provider returned null command",
      };
    }

    const stdout = await runCommand(command, this.deps.timeoutMs ?? 30_000, options);

    let message: string;
    try {
      message = extractSupervisorMessage(stdout, provider.id);
    } catch (error) {
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      debugCodexUnparseableOutput(
        this.logger,
        supervisor,
        context,
        command,
        prompt,
        stdout,
        scanCodexStream(lines)
      );
      throw error;
    }

    return { message: message.slice(0, this.config.guidanceMaxChars) };
  }
}

function buildPrompt(context: SupervisorEvaluationContext): string {
  const agentOutput = context.transcriptExcerpt ?? context.terminalExcerpt ?? "";
  const userInput = context.latestUserInput?.trim() ?? "";

  const lines: string[] = [
    "You are the supervisor for a business agent terminal session.",
    "Your job is to analyze the current objective and the business agent's latest output, then generate the next concrete task for the agent to execute.",
    'If the objective is complete, respond with "[objective complete]".',
    "If more work is needed, respond with a clear, actionable instruction for the next step.",
    "",
    "Current objective:",
    context.objective,
  ];

  if (userInput) {
    lines.push("", "Latest user input:", userInput);
  }

  lines.push(
    "",
    "Latest business agent output:",
    agentOutput || "(no output yet)",
    "",
    "Your response must be one of:",
    '1. A concrete next task (e.g., "Run the tests to verify the fix", "Review the error in logs/main.log")',
    '2. "[objective complete]" if the objective has been fully achieved'
  );

  return lines.join("\n");
}

async function runCommand(
  command: { argv: string[]; cwd?: string; env?: Record<string, string> },
  timeoutMs: number,
  options: EvaluateOptions = {}
): Promise<string> {
  if (options.signal?.aborted) {
    throw createSupervisorEvalAbortedError();
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(command.argv[0]!, command.argv.slice(1), {
      cwd: command.cwd,
      detached: process.platform !== "win32",
      env: { ...process.env, ...command.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let terminationError: {
      code: "supervisor_eval_timeout" | "supervisor_eval_aborted";
      message: string;
    } | null = null;

    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };

    const settleReject = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const settleResolve = (value: string) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const terminate = (error: {
      code: "supervisor_eval_timeout" | "supervisor_eval_aborted";
      message: string;
    }) => {
      if (terminationError) {
        return;
      }
      terminationError = error;

      if (typeof child.pid !== "number" || child.pid <= 0) {
        settleReject(error);
        return;
      }

      void escalateKillWithPolling(child.pid, "SIGTERM").catch(() => {
        // Best-effort only. The exit/error event still decides final settlement.
      });
    };

    const onAbort = () => {
      terminate(createSupervisorEvalAbortedError());
    };

    const timer = setTimeout(() => {
      terminate({
        code: "supervisor_eval_timeout",
        message: `Supervisor evaluator timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      if (terminationError) {
        settleReject(terminationError);
        return;
      }
      settleReject(error);
    });
    child.on("exit", (code) => {
      if (terminationError) {
        settleReject(terminationError);
        return;
      }
      if (code !== 0) {
        settleReject({
          code: "supervisor_eval_failed",
          message:
            Buffer.concat(stderr).toString("utf8").trim() || `Evaluator exited with code ${code}`,
        });
        return;
      }

      settleResolve(Buffer.concat(stdout).toString("utf8"));
    });
  });
}

function createSupervisorEvalAbortedError(): {
  code: "supervisor_eval_aborted";
  message: string;
} {
  return {
    code: "supervisor_eval_aborted",
    message: "Supervisor evaluator aborted",
  };
}

/**
 * Strip a ```json … ``` (or bare ```…```) markdown fence if present.
 */
function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```/);
  return fenced ? fenced[1]!.trim() : text;
}

type CodexCompletedCandidate = {
  sourceType: "agent_message" | "assistant_message" | "command_execution" | "reasoning";
  content: string;
};

interface CodexStreamScan {
  /** Completed items that may contain the final evaluator payload. */
  completedItemCandidates: CodexCompletedCandidate[];
  /** True if any recognizable codex event was seen (thread/turn/item). */
  isCodexStream: boolean;
  /** True if the stream included a `turn.completed` event. */
  turnCompleted: boolean;
  /** Populated when the stream reported `turn.failed`. */
  turnFailure: string | null;
  /** Total output_tokens reported by `turn.completed`, if any. */
  outputTokens: number | null;
}

/**
 * Walk a codex `exec --json` JSONL stream and collect completed-item content
 * that may contain the model's final answer.
 */
function scanCodexStream(lines: string[]): CodexStreamScan {
  const scan: CodexStreamScan = {
    completedItemCandidates: [],
    isCodexStream: false,
    turnCompleted: false,
    turnFailure: null,
    outputTokens: null,
  };

  for (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") {
      continue;
    }
    const record = event as Record<string, unknown>;
    const type = record.type;

    if (
      type === "thread.started" ||
      type === "turn.started" ||
      type === "turn.completed" ||
      type === "turn.failed" ||
      type === "item.started" ||
      type === "item.updated" ||
      type === "item.completed"
    ) {
      scan.isCodexStream = true;
    }

    if (type === "turn.completed") {
      scan.turnCompleted = true;
      const usage = record.usage;
      if (
        usage &&
        typeof usage === "object" &&
        typeof (usage as Record<string, unknown>).output_tokens === "number"
      ) {
        scan.outputTokens = (usage as Record<string, unknown>).output_tokens as number;
      }
    }

    if (type === "turn.failed") {
      const error = record.error;
      if (
        error &&
        typeof error === "object" &&
        typeof (error as Record<string, unknown>).message === "string"
      ) {
        scan.turnFailure = (error as Record<string, unknown>).message as string;
      } else {
        scan.turnFailure = "codex turn failed";
      }
    }

    if (type === "item.completed") {
      const item = record.item;
      if (!item || typeof item !== "object") {
        continue;
      }
      const itemRecord = item as Record<string, unknown>;
      const itemType = itemRecord.type ?? itemRecord.item_type;
      if (
        (itemType === "agent_message" ||
          itemType === "assistant_message" ||
          itemType === "reasoning") &&
        typeof itemRecord.text === "string"
      ) {
        scan.completedItemCandidates.push({
          sourceType: itemType,
          content: itemRecord.text,
        });
        continue;
      }
      if (itemType === "command_execution" && typeof itemRecord.aggregated_output === "string") {
        scan.completedItemCandidates.push({
          sourceType: "command_execution",
          content: itemRecord.aggregated_output,
        });
      }
    }
  }

  return scan;
}

function buildStdoutPreview(output: string, maxChars = 4000): string {
  return output.length <= maxChars
    ? output
    : `${output.slice(0, maxChars)}\n…[truncated ${output.length - maxChars} chars]`;
}

function debugCodexUnparseableOutput(
  logger: FastifyBaseLogger,
  supervisor: Supervisor,
  context: SupervisorEvaluationContext,
  command: { argv: string[]; cwd?: string; env?: Record<string, string> },
  prompt: string,
  output: string,
  scan: CodexStreamScan
): void {
  logger.warn(
    {
      supervisorId: supervisor.id,
      sessionId: supervisor.sessionId,
      evaluatorProviderId: supervisor.evaluatorProviderId,
      sessionProviderId: context.sessionProviderId,
      outputTokens: scan.outputTokens,
      turnCompleted: scan.turnCompleted,
      turnFailure: scan.turnFailure,
      completedItemCandidateCount: scan.completedItemCandidates.length,
      completedItemCandidates: scan.completedItemCandidates.map((candidate, index) => ({
        index,
        sourceType: candidate.sourceType,
        contentPreview: buildStdoutPreview(candidate.content, 500),
      })),
      commandArgv: command.argv,
      commandCwd: command.cwd,
      prompt,
      rawStdout: buildStdoutPreview(output),
    },
    "Supervisor evaluator debug: codex output was not parseable"
  );
}

/**
 * Extract the supervisor's message from the provider's output.
 * The supervisor outputs natural language text (not JSON) that should be
 * sent directly to the business agent.
 *
 * For Codex: scans JSONL stream for agent_message/reasoning items.
 * For Claude: parses the result envelope or plain text.
 */
function extractSupervisorMessage(output: string, providerId: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error("Supervisor returned empty output");
  }

  const lines = trimmed.split(/\r?\n/).filter(Boolean);

  if (providerId === "codex") {
    const scan = scanCodexStream(lines);

    if (scan.turnFailure) {
      throw new Error(`Supervisor (codex) failed: ${scan.turnFailure}`);
    }

    // Prefer agent_message, then reasoning, then assistant_message.
    // Iterate in reverse so the last occurrence wins.
    for (let i = scan.completedItemCandidates.length - 1; i >= 0; i--) {
      const candidate = scan.completedItemCandidates[i]!;
      if (
        candidate.sourceType === "agent_message" ||
        candidate.sourceType === "reasoning" ||
        candidate.sourceType === "assistant_message"
      ) {
        const stripped = stripCodeFence(candidate.content).trim();
        if (stripped) {
          return stripped;
        }
      }
    }

    // Last resort: try to extract plain text from any line
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!;
      // Skip obvious JSON/event lines
      if (line.startsWith("{") || line.startsWith("[")) {
        continue;
      }
      const text = line.trim();
      if (text && !scan.isCodexStream) {
        // Not a codex stream — use raw text
        return stripCodeFence(text);
      }
    }

    // Codex stream but no agent_message found
    const tokenHint = scan.outputTokens !== null ? ` (${scan.outputTokens} output tokens)` : "";
    throw new Error("Supervisor (codex) completed without returning a message" + tokenHint);
  }

  // Claude path: try result envelope, then plain text
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null && "result" in parsed) {
        const result = (parsed as Record<string, unknown>).result;
        if (typeof result === "string") {
          return stripCodeFence(result).trim();
        }
      }
    } catch {
      // not JSON, continue
    }
  }

  // Plain text: use the last non-empty line
  for (let i = lines.length - 1; i >= 0; i--) {
    const text = lines[i]!.trim();
    if (text) {
      return stripCodeFence(text);
    }
  }

  throw new Error("Supervisor did not return a recognizable message");
}
