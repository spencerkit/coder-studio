import { spawn } from "node:child_process";
import {
  DEFAULT_SUPERVISOR_CONFIG,
  type ProviderDefinition,
  type Supervisor,
  type SupervisorConfig,
  type SupervisorCycleStepUpdate,
  type SupervisorPlanStep,
  type SupervisorStopReason,
} from "@coder-studio/core";
import type { FastifyBaseLogger } from "fastify";
import { mergeProviderLaunchConfig } from "../provider-config.js";
import type { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import type { SettingsRepo } from "../storage/repositories/settings-repo.js";
import { escalateKillWithPolling } from "../terminal/pty-host.js";
import type { SupervisorEvaluationContext } from "./context-builder.js";
import { getSupervisorEvaluationTimeoutMs } from "./settings.js";

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

export interface SupervisorEvaluationResult {
  status: "continue" | "stop";
  stopReason?: Extract<SupervisorStopReason, "objective_complete" | "supervisor_uncertain">;
  reason: string;
  guidance?: string;
  plan?: SupervisorPlanStep[];
  activeStepId?: string;
  progressSummary?: string;
  stepUpdates?: SupervisorCycleStepUpdate[];
}

export type SupervisorResult = SupervisorEvaluationResult;

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
      settingsRepo?: Pick<SettingsRepo, "get">;
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
  ): Promise<SupervisorEvaluationResult> {
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
      model:
        typeof supervisor.evaluatorModel === "string" && supervisor.evaluatorModel.trim()
          ? supervisor.evaluatorModel.trim()
          : typeof config.model === "string"
            ? config.model
            : undefined,
    });

    if (!command) {
      throw {
        code: "supervisor_invalid_evaluator_provider",
        message: "Evaluator provider returned null command",
      };
    }

    const stdout = await runCommand(
      command,
      this.deps.timeoutMs ?? getSupervisorEvaluationTimeoutMs(this.deps.settingsRepo),
      options
    );

    let payloadText: string;
    try {
      payloadText = extractSupervisorPayload(stdout, provider.id);
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

    return parseSupervisorEvaluationResult(payloadText, this.config.guidanceMaxChars);
  }
}

function buildPrompt(context: SupervisorEvaluationContext): string {
  const lines: string[] = [
    "You are an autonomous supervisor for a target-scoped software task.",
    "Your job is to keep the agent moving toward the objective until the objective is complete.",
    "",
    "Return JSON only.",
    "",
    "Decision policy:",
    '- Prefer "continue" whenever there is a reasonable next action.',
    "- Do not ask the user to decide, clarify, or choose among implementation options.",
    "- When information is incomplete, choose a conservative next action based on the objective, target memory, latest user input, and terminal snapshot.",
    "- Stop only when the objective is complete, or when continuing would likely push the agent in an unsafe or clearly unsupported direction.",
    "",
    "Stage decision policy:",
    "- Use the target memory as the current supervision state.",
    "- Base your decision on the objective, current plan, activeStepId, progressSummary, lastGuidance, stalledCount, latest user input, and terminal snapshot.",
    "- Identify which plan step is currently active.",
    "- Decide whether the active step is done, still in progress, blocked, or obsolete.",
    "- If the active step is done, advance to the next useful step.",
    "- If the active step is still in progress, give guidance that moves it forward.",
    "- If the agent appears stuck or repeated the same action, give a different concrete next action.",
    "- If the plan is obsolete, update only the affected steps unless a full replacement is necessary.",
    "",
    "Allowed statuses:",
    '- "continue": more work is needed; include "reason" and "guidance".',
    '- "stop": supervision should stop; include "stopReason" and "reason".',
    "",
    "Allowed stop reasons:",
    '- "objective_complete"',
    '- "supervisor_uncertain"',
    "",
    'Use "objective_complete" only when the objective has been satisfied.',
    'Use "supervisor_uncertain" only as a last resort when no useful next action can be inferred and additional guidance would likely be misleading.',
    "",
    'Guidance requirements for "continue":',
    "- Give one concrete next action or a short ordered set of concrete actions.",
    "- Focus on the highest-value step toward completing the objective.",
    "- Be specific enough for the supervised agent to act without asking the user.",
    "- Avoid generic reminders, encouragement, or restating the objective.",
    "- If verification is needed, tell the agent exactly what to verify next.",
    "- If implementation is needed, point to the likely area, behavior, or file/module based on available evidence.",
    "",
    "Planning policy:",
    "- If planGenerated is false, include a plan with 3 to 7 milestone-sized steps.",
    "- If planGenerated is true, update progress incrementally.",
    "- Do not rewrite the full plan unless the existing plan is clearly wrong or obsolete.",
    "- Use stepUpdates to mark completed or active steps when the terminal snapshot shows progress.",
    "- Keep activeStepId aligned with the next useful step.",
    "",
    "Output schema:",
    "For continue:",
    "{",
    '  "status": "continue",',
    '  "reason": "brief explanation of why more work is needed",',
    '  "guidance": "specific next action for the supervised agent",',
    '  "plan": optional array of plan steps,',
    '  "activeStepId": optional step id,',
    '  "progressSummary": optional brief progress summary,',
    '  "stepUpdates": optional array of { "id": string, "status": "pending" | "in_progress" | "done" }',
    "}",
    "",
    "For stop:",
    "{",
    '  "status": "stop",',
    '  "stopReason": "objective_complete" | "supervisor_uncertain",',
    '  "reason": "brief explanation"',
    "}",
    "",
    "Current objective:",
    context.objective,
    "",
    "Current target memory:",
    JSON.stringify(context.targetMemory, null, 2),
    "",
    "Latest user input:",
    context.latestUserInput?.trim() || "(none)",
    "",
    "Current terminal snapshot:",
    context.terminalExcerpt || "(no output yet)",
  ];

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
      windowsHide: true,
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
      settleReject({
        code: "supervisor_eval_failed",
        message: error instanceof Error ? error.message : "Evaluator process failed to start",
      });
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
 * Extract the supervisor's payload text from the provider's output.
 * For Codex: scans JSONL stream for agent_message/reasoning items.
 * For Claude: parses the result envelope or plain text.
 */
function extractSupervisorPayload(output: string, providerId: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error("Supervisor returned empty output");
  }

  const lines = trimmed.split(/\r?\n/).filter(Boolean);

  if (providerId === "codex") {
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return stripCodeFence(trimmed);
    }

    const scan = scanCodexStream(lines);

    if (!scan.isCodexStream && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
      return stripCodeFence(trimmed);
    }

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

function parseSupervisorEvaluationResult(
  payloadText: string,
  guidanceMaxChars: number
): SupervisorEvaluationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(payloadText));
  } catch (error) {
    throw new Error(
      `Supervisor returned invalid JSON: ${error instanceof Error ? error.message : "parse failed"}`
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Supervisor returned invalid evaluation payload");
  }

  const record = parsed as Record<string, unknown>;
  const status = record.status;
  const reason = record.reason;

  if (
    (status !== "continue" && status !== "stop") ||
    typeof reason !== "string" ||
    !reason.trim()
  ) {
    throw new Error("Supervisor returned invalid evaluation payload");
  }

  if (status === "stop") {
    const stopReason = record.stopReason;
    if (stopReason !== "objective_complete" && stopReason !== "supervisor_uncertain") {
      throw new Error("Supervisor stop result is missing a valid stopReason");
    }

    return {
      status,
      stopReason,
      reason: reason.trim(),
    };
  }

  const guidance =
    typeof record.guidance === "string" && record.guidance.trim()
      ? record.guidance.trim().slice(0, guidanceMaxChars)
      : undefined;

  const plan: SupervisorPlanStep[] | undefined = Array.isArray(record.plan)
    ? record.plan.flatMap<SupervisorPlanStep>((value) => {
        if (!value || typeof value !== "object") {
          return [];
        }
        const step = value as Record<string, unknown>;
        if (
          typeof step.id !== "string" ||
          typeof step.title !== "string" ||
          (step.status !== "pending" && step.status !== "in_progress" && step.status !== "done")
        ) {
          return [];
        }
        return [{ id: step.id, title: step.title, status: step.status }];
      })
    : undefined;

  const stepUpdates: SupervisorCycleStepUpdate[] | undefined = Array.isArray(record.stepUpdates)
    ? record.stepUpdates.flatMap<SupervisorCycleStepUpdate>((value) => {
        if (!value || typeof value !== "object") {
          return [];
        }
        const update = value as Record<string, unknown>;
        if (
          typeof update.id !== "string" ||
          (update.status !== "pending" &&
            update.status !== "in_progress" &&
            update.status !== "done")
        ) {
          return [];
        }
        return [{ id: update.id, status: update.status }];
      })
    : undefined;

  return {
    status,
    reason: reason.trim(),
    guidance,
    plan,
    activeStepId:
      typeof record.activeStepId === "string" && record.activeStepId.trim()
        ? record.activeStepId
        : undefined,
    progressSummary:
      typeof record.progressSummary === "string" && record.progressSummary.trim()
        ? record.progressSummary.trim()
        : undefined,
    stepUpdates,
  };
}
