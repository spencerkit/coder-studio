import { spawn } from 'node:child_process';
import { z } from 'zod';
import {
  DEFAULT_SUPERVISOR_CONFIG,
  type ProviderDefinition,
  type Supervisor,
  type SupervisorConfig,
} from '@coder-studio/core';
import type { ProviderConfigRepo } from '../storage/repositories/provider-config-repo.js';
import type { SupervisorEvaluationContext } from './context-builder.js';
import { mergeProviderLaunchConfig } from '../provider-config.js';

const EvalResultSchema = z
  .object({
    progress: z.number(),
    summary: z.string().min(1),
    shouldInject: z.boolean(),
    guidance: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.shouldInject && !value.guidance) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'guidance is required when shouldInject=true',
      });
    }
  });

export interface EvaluationResult {
  progress: number;
  summary: string;
  guidance?: string;
  shouldInject: boolean;
  confidence?: number;
}

export class SupervisorEvaluator {
  private readonly config: SupervisorConfig;

  constructor(
    private readonly deps: {
      providerRegistry: ProviderDefinition[];
      providerConfigRepo: ProviderConfigRepo;
      timeoutMs?: number;
      config?: SupervisorConfig;
    }
  ) {
    this.config = deps.config ?? DEFAULT_SUPERVISOR_CONFIG;
  }

  async evaluate(
    supervisor: Supervisor,
    context: SupervisorEvaluationContext
  ): Promise<EvaluationResult> {
    const provider = this.deps.providerRegistry.find(
      (item) => item.id === supervisor.evaluatorProviderId
    );
    if (!provider?.buildSupervisorEvalCommand) {
      throw {
        code: 'supervisor_invalid_evaluator_provider',
        message: 'Evaluator provider does not support headless eval',
      };
    }

    const config = mergeProviderLaunchConfig(provider, this.deps.providerConfigRepo.get(provider.id));

    const prompt = buildPrompt(context);
    const command = provider.buildSupervisorEvalCommand(config, {
      prompt,
      sessionId: supervisor.sessionId,
      workspacePath: context.workspacePath,
      model: typeof config.model === 'string' ? config.model : undefined,
    });

    if (!command) {
      throw {
        code: 'supervisor_invalid_evaluator_provider',
        message: 'Evaluator provider returned null command',
      };
    }

    const stdout = await runCommand(command, this.deps.timeoutMs ?? 30_000);
    const parsed = EvalResultSchema.parse(extractEvalPayload(stdout));

    return {
      progress: Math.max(0, Math.min(100, Math.round(parsed.progress))),
      summary: parsed.summary,
      shouldInject: parsed.shouldInject,
      guidance: parsed.guidance?.slice(0, this.config.guidanceMaxChars),
      confidence: parsed.confidence,
    };
  }
}

function buildPrompt(context: SupervisorEvaluationContext): string {
  return [
    'You are the supervisor evaluator. Your ONLY output MUST be a single raw JSON object matching the schema below. Do NOT wrap it in markdown code fences. Do NOT add explanations, reasoning, or any text before or after the JSON. The very first character of your reply must be `{` and the very last character must be `}`.',
    'Your job: estimate how close the coding agent is to the stated objective and (optionally) write a short directive the agent should follow next.',
    'Rules:',
    '- progress: integer 0-100. Your best-effort completion percentage toward the objective.',
    '- summary: one short sentence describing what you see and where the agent stands.',
    '- shouldInject: set to true whenever you have a clear next step for the agent. Lean toward true if the agent looks stuck, off-track, or is waiting for input. Leaning toward false is fine only when progress is >=95 or the agent is actively working on the correct next thing.',
    '- guidance: required when shouldInject=true. A single imperative sentence addressed to the agent (e.g. "Run the failing test and fix the TypeError in parser.ts"). Max ~400 chars, no markdown, no line breaks.',
    '- confidence: your confidence in the assessment, 0.0-1.0.',
    `Objective: ${context.objective}`,
    `Session provider: ${context.sessionProviderId}`,
    `Evaluator provider: ${context.evaluatorProviderId}`,
    `Session state: ${context.sessionState}`,
    `Evidence source: ${context.evidenceSource}`,
    context.lastTurnId ? `Last turn ID: ${context.lastTurnId}` : '',
    context.transcriptExcerpt
      ? `Transcript:\n${context.transcriptExcerpt}`
      : `Terminal:\n${context.terminalExcerpt ?? ''}`,
    context.gitStatusSummary ? `Git status:\n${context.gitStatusSummary}` : '',
    context.gitDiffStat ? `Git diff stat:\n${context.gitDiffStat}` : '',
    'JSON schema (exact keys): {"progress":<int 0-100>,"summary":"<string>","shouldInject":<boolean>,"guidance":"<string, required iff shouldInject=true>","confidence":<number 0-1>}',
    'Example valid reply: {"progress":42,"summary":"Agent is editing parser.ts but tests still fail.","shouldInject":true,"guidance":"Run pnpm vitest parser and fix the TypeError on line 88.","confidence":0.7}',
    'Reply now with the JSON object only.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function runCommand(
  command: { argv: string[]; cwd?: string; env?: Record<string, string> },
  timeoutMs: number
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command.argv[0]!, command.argv.slice(1), {
      cwd: command.cwd,
      env: { ...process.env, ...command.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject({
        code: 'supervisor_eval_timeout',
        message: `Supervisor evaluator timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject({
          code: 'supervisor_eval_failed',
          message:
            Buffer.concat(stderr).toString('utf8').trim() ||
            `Evaluator exited with code ${code}`,
        });
        return;
      }

      resolve(Buffer.concat(stdout).toString('utf8'));
    });
  });
}

const REQUIRED_KEYS = ['progress', 'summary', 'shouldInject'] as const;
/**
 * Keys on common CLI response envelopes whose value holds the actual model
 * text (either as a string or as a nested object we want to dig into).
 *
 * - `text`: codex `{type:'item.completed', item:{type:'agent_message', text:'...'}}`
 * - `result`: claude `-p --output-format json` → `{type:'result', result:'...'}`
 * - `message`/`content`: some wrappers stash the reply here
 * - `payload`/`data`: generic envelopes
 */
const ENVELOPE_KEYS = ['text', 'result', 'message', 'content', 'payload', 'data'] as const;

function looksLikeEvalPayload(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return REQUIRED_KEYS.every((key) => key in (value as Record<string, unknown>));
}

/**
 * Strip a ```json … ``` (or bare ```…```) markdown fence if present.
 * Models wrapped in fences is the #1 reason a valid payload is unparseable.
 */
function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json|JSON)?\s*\n([\s\S]*?)\n```/);
  return fenced ? fenced[1]!.trim() : text;
}

/**
 * Try very hard to turn `candidate` into an eval payload. We accept:
 *   1. The value is already the payload object.
 *   2. The value is a string that parses as the payload JSON
 *      (including when wrapped in a markdown fence).
 *   3. The value is an object carrying the payload under one of
 *      {@link ENVELOPE_KEYS} — recurse into it.
 *
 * Returns `undefined` if no shape matches so callers can keep searching.
 */
function coerceToPayload(candidate: unknown, depth = 0): unknown {
  if (depth > 4) {
    return undefined;
  }

  if (looksLikeEvalPayload(candidate)) {
    return candidate;
  }

  if (typeof candidate === 'string') {
    const source = stripCodeFence(candidate.trim());
    if (!source) {
      return undefined;
    }
    // Try a full parse first.
    try {
      const parsed = JSON.parse(source);
      const resolved = coerceToPayload(parsed, depth + 1);
      if (resolved !== undefined) {
        return resolved;
      }
    } catch {
      // Strings that contain prose + JSON: grab the last balanced {...}.
      const sliced = sliceLastJsonObject(source);
      if (sliced) {
        try {
          const parsed = JSON.parse(sliced);
          const resolved = coerceToPayload(parsed, depth + 1);
          if (resolved !== undefined) {
            return resolved;
          }
        } catch {
          // fallthrough
        }
      }
    }
    return undefined;
  }

  if (candidate && typeof candidate === 'object') {
    for (const key of ENVELOPE_KEYS) {
      const inner = (candidate as Record<string, unknown>)[key];
      if (inner === undefined) {
        continue;
      }
      const resolved = coerceToPayload(inner, depth + 1);
      if (resolved !== undefined) {
        return resolved;
      }
    }
  }

  return undefined;
}

function sliceLastJsonObject(text: string): string | null {
  const end = text.lastIndexOf('}');
  const start = text.lastIndexOf('{', end);
  if (start < 0 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

interface CodexStreamScan {
  /** Text of the final `agent_message` item, if one was emitted. */
  agentMessage: string | null;
  /**
   * Text of the last `reasoning` item. Normally the model's internal
   * thinking, but on certain upstream Codex proxies/gateways the final
   * answer leaks into reasoning instead of `agent_message`, so we keep
   * it as a last-ditch payload source.
   */
  reasoningText: string | null;
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
 * Walk a codex `exec --json` JSONL stream and pull out the text of the
 * last `agent_message` item (where the model's final answer lives).
 */
function scanCodexStream(lines: string[]): CodexStreamScan {
  const scan: CodexStreamScan = {
    agentMessage: null,
    reasoningText: null,
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
    if (!event || typeof event !== 'object') {
      continue;
    }
    const record = event as Record<string, unknown>;
    const type = record.type;

    if (
      type === 'thread.started' ||
      type === 'turn.started' ||
      type === 'turn.completed' ||
      type === 'turn.failed' ||
      type === 'item.started' ||
      type === 'item.updated' ||
      type === 'item.completed'
    ) {
      scan.isCodexStream = true;
    }

    if (type === 'turn.completed') {
      scan.turnCompleted = true;
      const usage = record.usage;
      if (
        usage &&
        typeof usage === 'object' &&
        typeof (usage as Record<string, unknown>).output_tokens === 'number'
      ) {
        scan.outputTokens = (usage as Record<string, unknown>).output_tokens as number;
      }
    }

    if (type === 'turn.failed') {
      const error = record.error;
      if (
        error &&
        typeof error === 'object' &&
        typeof (error as Record<string, unknown>).message === 'string'
      ) {
        scan.turnFailure = (error as Record<string, unknown>).message as string;
      } else {
        scan.turnFailure = 'codex turn failed';
      }
    }

    if (type === 'item.completed') {
      const item = record.item;
      if (!item || typeof item !== 'object') {
        continue;
      }
      const itemRecord = item as Record<string, unknown>;
      // Accept both `type` (current) and `item_type` (older codex builds).
      const itemType = itemRecord.type ?? itemRecord.item_type;
      const text = itemRecord.text;
      if (typeof text !== 'string') {
        continue;
      }
      if (itemType === 'agent_message' || itemType === 'assistant_message') {
        scan.agentMessage = text;
      } else if (itemType === 'reasoning') {
        scan.reasoningText = text;
      }
    }
  }

  return scan;
}

function extractEvalPayload(output: string): unknown {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error('Supervisor evaluator returned empty output');
  }

  // Fast path: whole stdout is the JSON payload (or a trivially wrapped one).
  try {
    const parsed = JSON.parse(trimmed);
    const resolved = coerceToPayload(parsed);
    if (resolved !== undefined) {
      return resolved;
    }
  } catch {
    // fall through to line-by-line and fence-aware strategies
  }

  // Fenced JSON: ```json {...} ``` anywhere in the output.
  const unfenced = stripCodeFence(trimmed);
  if (unfenced !== trimmed) {
    try {
      const parsed = JSON.parse(unfenced);
      const resolved = coerceToPayload(parsed);
      if (resolved !== undefined) {
        return resolved;
      }
    } catch {
      // keep trying
    }
  }

  const lines = trimmed.split(/\r?\n/).filter(Boolean);

  // Codex `exec --json` path: pull the final agent_message and parse it.
  const codexScan = scanCodexStream(lines);
  if (codexScan.agentMessage) {
    const resolved = coerceToPayload(codexScan.agentMessage);
    if (resolved !== undefined) {
      return resolved;
    }
  }
  // Fallback: some proxy/gateway providers drop `agent_message` entirely
  // and the model's answer leaks into the reasoning item text. Try there
  // before giving up — a valid JSON payload is a valid JSON payload.
  if (codexScan.reasoningText) {
    const resolved = coerceToPayload(codexScan.reasoningText);
    if (resolved !== undefined) {
      return resolved;
    }
  }

  // NDJSON / event-stream path: find the last line that parses to our shape
  // (or carries one inside an envelope like Claude's `{result:"..."}`).
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    try {
      const parsed = JSON.parse(line);
      const resolved = coerceToPayload(parsed);
      if (resolved !== undefined) {
        return resolved;
      }
    } catch {
      // ignore non-JSON lines
    }
  }

  // Last resort: extract the last balanced {...} substring that matches the shape.
  const sliced = sliceLastJsonObject(trimmed);
  if (sliced) {
    try {
      const parsed = JSON.parse(sliced);
      const resolved = coerceToPayload(parsed);
      if (resolved !== undefined) {
        return resolved;
      }
    } catch {
      // fallthrough
    }
  }

  // Codex-specific diagnostics: if we recognized the stream but still
  // couldn't pull a usable payload, say *why* instead of the generic error.
  if (codexScan.isCodexStream) {
    if (codexScan.turnFailure) {
      throw new Error(`Supervisor evaluator (codex) failed: ${codexScan.turnFailure}`);
    }
    if (codexScan.agentMessage) {
      throw new Error(
        'Supervisor evaluator (codex) returned an agent_message, ' +
          'but its content is not valid JSON matching the evaluator schema. ' +
          'The model likely wrapped the JSON in prose or markdown — retry, or switch the evaluator provider.'
      );
    }
    if (codexScan.reasoningText) {
      throw new Error(
        'Supervisor evaluator (codex) emitted only reasoning (no agent_message), ' +
          'and the reasoning text does not contain a valid JSON payload. ' +
          'This usually indicates the Codex model/provider is dropping the final assistant message. ' +
          'Try a lower reasoning effort (e.g. `-c model_reasoning_effort="low"` in additionalArgs) ' +
          'or switch the evaluator provider to Claude.'
      );
    }
    const tokenHint =
      codexScan.outputTokens !== null ? ` (${codexScan.outputTokens} output tokens used)` : '';
    throw new Error(
      'Supervisor evaluator (codex) produced no agent_message' +
        tokenHint +
        '. The Codex CLI got a turn.completed with no final reply from the model — ' +
        'this typically means the upstream Codex provider is not returning the assistant ' +
        "`message` event. Switch the evaluator provider to Claude, or configure codex to use " +
        'a provider that streams agent messages.'
    );
  }

  throw new Error('Supervisor evaluator did not return a recognizable JSON payload');
}
