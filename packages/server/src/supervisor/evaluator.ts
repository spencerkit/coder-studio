import { spawn } from "node:child_process";
import {
  DEFAULT_SUPERVISOR_CONFIG,
  type ProviderDefinition,
  type Supervisor,
  type SupervisorConfig,
  type SupervisorCycleNodeUpdate,
  type SupervisorGranularity,
  type SupervisorPlanNode,
  type SupervisorStopReason,
  type SupervisorTaskType,
} from "@coder-studio/core";
import {
  estimateCommandLineLength,
  type HeadlessSpawnCommand,
  prepareHeadlessSpawnCommand,
} from "@coder-studio/utils";
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

const EVALUATOR_BASE_ENV_KEYS = [
  "PATH",
  "Path",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "ComSpec",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
] as const;

const EVALUATOR_WINDOWS_ENV_KEYS = [
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramData",
  "PROGRAMDATA",
  "ProgramFiles",
  "PROGRAMFILES",
  "ProgramFiles(x86)",
  "PROGRAMFILES(X86)",
  "ProgramW6432",
  "PROGRAMW6432",
  "CommonProgramFiles",
  "COMMONPROGRAMFILES",
  "CommonProgramFiles(x86)",
  "COMMONPROGRAMFILES(X86)",
  "CommonProgramW6432",
  "COMMONPROGRAMW6432",
  "SystemDrive",
  "SYSTEMDRIVE",
  "USERNAME",
  "USERDOMAIN",
] as const;

const EVALUATOR_NETWORK_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
] as const;

const EVALUATOR_PROVIDER_ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "VERTEXAI_PROJECT",
  "VERTEXAI_LOCATION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_PROFILE",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_API_VERSION",
] as const;

const EVALUATOR_PROVIDER_ENV_PREFIXES = [
  "OPENAI_",
  "ANTHROPIC_",
  "GEMINI_",
  "GOOGLE_",
  "VERTEXAI_",
  "AWS_",
  "AZURE_OPENAI_",
  "CODEX_",
  "CLAUDE_",
  "CURSOR_",
  "OPENCODE_",
] as const;

export interface SupervisorDecomposeResult {
  mode: "decompose";
  children: SupervisorPlanNode[];
  activeNodeId?: string;
  progressSummary?: string;
}

export interface SupervisorContinueResult {
  mode: "evaluate";
  status: "continue";
  reason: string;
  guidance?: string;
  activeNodeId?: string;
  progressSummary?: string;
  nodeUpdates?: SupervisorCycleNodeUpdate[];
}

export interface SupervisorStopResult {
  mode: "evaluate";
  status: "stop";
  stopReason?: Extract<SupervisorStopReason, "objective_complete" | "supervisor_uncertain">;
  reason: string;
}

export interface SupervisorReadyCheckResult {
  mode: "ready_check";
  nodeId: string;
  taskType: SupervisorTaskType;
  granularity: SupervisorGranularity;
  reason: string;
  recommendedUnit?: string;
  qualityRisk?: string;
  missingInputs?: string[];
  confidence?: "low" | "medium" | "high";
}

export interface SupervisorDecomposeChildResult {
  mode: "decompose_child";
  parentNodeId: string;
  children: SupervisorPlanNode[];
  activeNodeId?: string;
  progressSummary?: string;
}

export interface SupervisorExecutableTaskResult {
  mode: "executable_task";
  nodeId: string;
  guidance: string;
  fallback?: boolean;
}

export type SupervisorEvaluationResult =
  | SupervisorDecomposeResult
  | SupervisorContinueResult
  | SupervisorStopResult
  | SupervisorReadyCheckResult
  | SupervisorDecomposeChildResult
  | SupervisorExecutableTaskResult;

export type SupervisorResult = SupervisorEvaluationResult;

type SupervisorEvaluatorMode =
  | "decompose"
  | "evaluate"
  | "ready_check"
  | "decompose_child"
  | "executable_task";

interface EvaluateOptions {
  signal?: AbortSignal;
  mode?: SupervisorEvaluatorMode;
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
    if (!provider?.headless?.supportedScenarios.includes("supervisor_eval")) {
      throw {
        code: "supervisor_invalid_evaluator_provider",
        message: "Evaluator provider does not support headless eval",
      };
    }

    const config = mergeProviderLaunchConfig(
      provider,
      this.deps.providerConfigRepo.get(provider.id)
    );

    const mode = options.mode ?? "evaluate";
    const prompt = buildPrompt(context, mode);
    const command = provider.headless.buildCommand(config, "supervisor_eval", {
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

    let stdout: string;
    try {
      stdout = await runCommand(
        prepareHeadlessSpawnCommand(command, prompt),
        this.deps.timeoutMs ?? getSupervisorEvaluationTimeoutMs(this.deps.settingsRepo),
        options
      );
    } catch (error) {
      if (isEvaluatorProcessError(error)) {
        throw diagnoseEvaluatorProcessError(
          error,
          provider.id,
          this.logger,
          supervisor,
          context,
          command,
          prompt
        );
      }
      throw error;
    }

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

    return parseSupervisorEvaluationResult(
      payloadText,
      this.config.guidanceMaxChars,
      mode,
      this.logger
    );
  }
}

function buildPrompt(context: SupervisorEvaluationContext, mode: SupervisorEvaluatorMode): string {
  if (mode === "decompose") {
    return [
      "You are an autonomous planner-supervisor for this target-scoped software task.",
      "Your purpose is to drive the work from objective to high-quality delivery with minimal babysitting.",
      'Do not optimize for merely reaching "done"; optimize for a result that is correct, verified, coherent, and not obviously low-quality or rushed.',
      "Your first job is to decompose the target into a supervision structure before evaluation begins.",
      "",
      "Return JSON only.",
      "No prose before or after the JSON.",
      "",
      "Decomposition policy:",
      "- Create an execution plan, not just a task list.",
      "- Break the objective into the smallest reasonable set of milestones that maximize clarity, reduce uncertainty, and preserve steady forward progress.",
      "- Order milestones by dependency, risk reduction, and delivery leverage.",
      "- Prefer a plan structure that makes execution easier, verification clearer, and replanning cheaper.",
      "- Do not ask the user any questions.",
      "- Do not ask for clarification, confirmation, or approval.",
      "- Do not propose options for the user to choose from.",
      "- If information is incomplete, make the most conservative reasonable assumptions and decide the decomposition yourself.",
      "- Your job is to return the best useful decomposition now, not to begin a discussion or planning workflow.",
      "- Keep the user-visible target as the root supervision owner.",
      "- Produce 1 to 7 top-level child nodes for targetMemory.planTree.",
      "- Each child node must be concrete, milestone-sized, and useful for subsequent evaluation.",
      "- Do not leave the child list empty.",
      "",
      "Decomposition principles:",
      "- Prefer milestones that produce a concrete artifact, observable behavior change, test result, or verification result.",
      "- Make dependencies explicit.",
      "- Separate implementation, verification, integration, and cleanup when that improves delivery reliability.",
      "- If a step is too vague to verify independently, split it further.",
      "- Prefer plans that keep the agent moving with minimal ambiguity between milestones.",
      "- Use stage-based planning by default unless there are clearly independent deliverables that justify subtargets.",
      "- Build the plan so it can recover from failed attempts: prefer decompositions that allow narrowing scope, isolating failures, checking assumptions, and restoring a working baseline when needed.",
      "- Keep the decomposition practical for execution, not merely neat on paper.",
      "",
      "Planning quality bar:",
      "- Prefer fewer, stronger milestones over many thin or vague ones.",
      "- Every item should imply a concrete deliverable and observable acceptance criteria.",
      '- Avoid vague items such as "improve", "clean up", or "refactor" unless tied to a specific delivery or verification target.',
      "- Include quality and verification checkpoints where they materially improve the final result.",
      "- Do not decompose in a way that encourages superficial completion.",
      "",
      "Planning boundary:",
      "- You are responsible for execution structure, sequencing, quality control, and verification structure.",
      "- Do not hard-code unnecessary implementation detail too early.",
      "- If multiple implementation paths exist, prefer a plan that keeps execution adaptable until evidence makes one path clearly better.",
      "- Do not hide assumptions inside the plan.",
      "- Do not create a brittle plan that depends on perfect execution.",
      "",
      "Node requirements:",
      '- Each node must include "id", "title", "objective", "deliverable", "acceptanceCriteria", "status", "taskType", and "children".',
      '- "acceptanceCriteria" must be a non-empty string array.',
      '- Use statuses "pending", "in_progress", "done", or "blocked".',
      '- Use taskType "generic", "coding", "writing", "research", or "design".',
      "- Usually mark the first active child as in_progress and the rest as pending.",
      '- Do not include "parentId", "depth", "kind", or flat item fields.',
      "",
      "Output schema:",
      "{",
      '  "mode": "decompose",',
      '  "children": [',
      '    { "id": string, "title": string, "objective": string, "deliverable": string, "acceptanceCriteria": string[], "status": "pending" | "in_progress" | "done" | "blocked", "taskType": "coding" | "writing" | "research" | "design" | "generic", "children": [] }',
      "  ],",
      '  "activeNodeId": optional string,',
      '  "progressSummary": optional brief summary',
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
    ].join("\n");
  }

  if (mode === "ready_check") {
    return [
      "You are a task-granularity supervisor.",
      "Decide whether the active plan node is sized appropriately for one high-quality execution pass.",
      "Classify the work as too_large, ready, or too_small based on scope, available inputs, risk, and verifiability.",
      "",
      "Return JSON only.",
      "No prose before or after the JSON.",
      "",
      "Ready-check policy:",
      "- Use the active plan node when targetMemory.activeNodeId is available.",
      "- Treat broad, multi-deliverable, or hard-to-verify work as too_large.",
      "- Treat microscopic work that cannot produce a meaningful deliverable as too_small.",
      "- Treat work as ready only when it has a concrete deliverable, clear acceptance criteria, and enough input to execute.",
      "- Do not ask the user for clarification; report missingInputs when inputs are missing.",
      "",
      "Output schema:",
      "{",
      '  "mode": "ready_check",',
      '  "nodeId": string,',
      '  "taskType": "coding" | "writing" | "research" | "design" | "generic",',
      '  "granularity": "too_large" | "ready" | "too_small",',
      '  "reason": string,',
      '  "recommendedUnit": optional string,',
      '  "qualityRisk": optional string,',
      '  "missingInputs": optional string[],',
      '  "confidence": optional "low" | "medium" | "high"',
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
    ].join("\n");
  }

  if (mode === "decompose_child") {
    return [
      "You are a lazy recursive planning supervisor.",
      "Decompose only the active parent plan node into the next useful children needed for execution.",
      "Keep the tree shallow and defer decomposition until a node is too large for one high-quality execution pass.",
      "",
      "Return JSON only.",
      "No prose before or after the JSON.",
      "",
      "Child decomposition policy:",
      "- Use targetMemory.activeNodeId as the parent unless the target memory clearly identifies another active too-large node.",
      "- Produce concrete child nodes with clear deliverables and acceptance criteria.",
      "- Preserve dependency order and make the first useful child active when appropriate.",
      "- Do not rewrite unrelated parts of the plan tree.",
      "- Do not ask the user questions.",
      "",
      "Output schema:",
      "{",
      '  "mode": "decompose_child",',
      '  "parentNodeId": string,',
      '  "children": [',
      '    { "id": string, "title": string, "objective": string, "deliverable": string, "acceptanceCriteria": string[], "status": "pending" | "in_progress" | "done" | "blocked", "taskType": "coding" | "writing" | "research" | "design" | "generic", "children": [] }',
      "  ],",
      '  "activeNodeId": optional string,',
      '  "progressSummary": optional brief summary',
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
    ].join("\n");
  }

  if (mode === "executable_task") {
    return [
      "You are a supervisor preparing one concrete instruction for an AI execution agent.",
      "Turn the active ready plan node into direct guidance that the execution agent can perform without another planning round.",
      "Focus on one concrete unit of work and the evidence needed to verify it.",
      "",
      "Return JSON only.",
      "No prose before or after the JSON.",
      "",
      "Executable-task policy:",
      "- Use targetMemory.activeNodeId as the nodeId unless the active leaf path identifies a more specific ready leaf.",
      "- Give concise, actionable guidance with files, commands, checks, or artifacts when the context supports them.",
      "- Include a fallback flag only when the guidance is a conservative fallback because the node is underspecified.",
      "- Do not ask the user to choose between options.",
      "",
      "Output schema:",
      "{",
      '  "mode": "executable_task",',
      '  "nodeId": string,',
      '  "guidance": string,',
      '  "fallback": optional true',
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
    ].join("\n");
  }

  const lines: string[] = [
    "You are an autonomous planner-supervisor for this target-scoped software task.",
    "Your purpose is to drive the work from objective to high-quality delivery with minimal babysitting.",
    'Do not optimize for merely reaching "done"; optimize for a result that is correct, verified, coherent, and not obviously low-quality or rushed.',
    "Act as an autonomous execution supervisor.",
    "Your job is to keep the agent moving toward the objective, maintain delivery quality, detect low-yield paths early, and redirect work when needed.",
    "Do not passively observe progress; actively steer it toward successful, high-quality completion.",
    "Drive execution through the supervised agent rather than by independently performing the work yourself.",
    "",
    "Return JSON only.",
    "No prose before or after the JSON.",
    "",
    "Decision policy:",
    '- Prefer "continue" over "stop" whenever the objective is not yet verified complete and there is a concrete next action.',
    '- "continue" may mean continuing the current item, verifying the current item, unblocking the current item, or advancing to the next item only after the current item is verified done.',
    "- Do not ask the user to decide, clarify, or choose among implementation options.",
    "- Do not tell the agent to ask the user to decide, clarify, or choose among implementation options unless continuing would likely be unsafe or clearly unsupported.",
    "- If the agent asks a question or presents multiple options, choose the most conservative reasonable option yourself and direct the next action.",
    "- If multiple reasonable paths exist, pick one and move forward unless doing so would be unsafe or clearly unsupported.",
    "- When information is incomplete, choose a conservative next action based on the objective, target memory, latest user input, and terminal snapshot.",
    "- Do not treat the agent's claims, summaries, or self-reports as sufficient evidence of completion.",
    "- Stop only when the objective is complete, or when continuing would likely push the agent in an unsafe or clearly unsupported direction.",
    "",
    "Stage decision policy:",
    "- Use the target memory as the current supervision state.",
    "- Base your decision on the objective, targetMemory.planTree, activeNodeId, progressSummary, lastGuidance, stalledCount, latest user input, and terminal snapshot.",
    "- Identify which plan tree node is currently active.",
    "- Keep the current active node unless there is evidence that it is done, blocked, or obsolete.",
    "- Decide whether the active node is done, still in progress, blocked, or obsolete based on observable evidence.",
    '- Treat statements like "done", "fixed", "implemented", or "should pass" as unverified unless supported by observable evidence.',
    '- Mark an item as "done" only when there is observable evidence that its deliverable or acceptanceCriteria were satisfied.',
    "- Prefer evidence from terminal output, test results, build results, explicit verification output, or other observable artifacts in the terminal snapshot.",
    "- If evidence is missing or ambiguous, keep the item in_progress and direct the agent to gather or produce the missing verification evidence.",
    "- If the current node appears nearly complete but is not yet verified, keep the same active node and direct targeted verification.",
    "- Advance only after the current node's deliverable or acceptanceCriteria are supported by observable evidence.",
    '- When advancing, use nodeUpdates to mark the current active node "done"; the manager will choose the next runnable node unless activeNodeId is explicitly provided.',
    "- If the active node is blocked, give guidance that is most likely to unblock it.",
    "- If the active node is obsolete, explain the reason briefly and move to the next useful node.",
    "- If the current path is low-yield, brittle, repetitive, or producing low-quality output, redirect early.",
    "- Diagnose stalls precisely: implementation failure, verification failure, environment failure, scope misframing, weak solution quality, or missing evidence.",
    "- Choose the next action that most improves objective-level progress, not merely the most local continuation.",
    "- Do not repeat the same tactic after failure unless new evidence justifies retrying it.",
    "- Maintain commitment to the objective, not blind commitment to the current tactic.",
    "- Replan locally when needed, but keep the overall execution coherent and objective-driven.",
    "- Do not rewrite the decomposition structure during normal evaluation cycles.",
    "",
    "Allowed statuses:",
    '- "continue": supervision should continue; include "reason" and "guidance".',
    '- "stop": supervision should stop; include "stopReason" and "reason".',
    "",
    "Allowed stop reasons:",
    '- "objective_complete"',
    '- "supervisor_uncertain"',
    "",
    'Use "objective_complete" only when there is evidence that the objective and relevant acceptanceCriteria have been satisfied.',
    "- Do not stop only because the agent says the work is complete or because code changes exist without verification evidence.",
    "- If completion looks plausible but remains unverified, continue and require targeted verification.",
    'Use "supervisor_uncertain" only as a last resort when no useful next action can be inferred and additional guidance would likely be misleading.',
    "",
    'Guidance requirements for "continue":',
    "- Give one concrete next action or a short ordered set of concrete actions.",
    "- Focus on the highest-value step toward completing the objective.",
    "- Be specific enough for the supervised agent to act without asking the user.",
    "- Avoid generic reminders, encouragement, or restating the objective.",
    "- If verification is needed, tell the agent exactly what command, file, behavior, or artifact to verify next.",
    "- If implementation is needed, point to the likely area, behavior, or file/module based on available evidence.",
    "- If the agent asked a question, answer it directly in the guidance and continue with a concrete next action.",
    "",
    "Delivery quality bar:",
    "- Do not accept shallow, brittle, or obviously rushed solutions.",
    "- Do not optimize for the smallest change if it leads to poor maintainability, weak verification, or fragile behavior.",
    "- Prefer solutions that are robust, coherent with the existing codebase, and likely to hold up beyond the happy path.",
    "- Require appropriate verification for the kind of work being done.",
    "- Consider edge cases, integration impact, regressions, and maintainability where relevant.",
    "- If a solution technically works but is low-quality, incomplete, poorly verified, or obviously a shortcut, treat the milestone as not yet complete.",
    "- Do not let superficial progress masquerade as real delivery.",
    "",
    "Completion standard:",
    "- A milestone is complete only when its deliverable and acceptanceCriteria are supported by observable evidence and the result meets a reasonable quality bar.",
    "- The objective is complete only when the final result is implemented, verified, and not obviously compromised in quality.",
    "- Do not mark work complete merely because code was changed, a command passed once, or a minimal patch exists.",
    "- Optimize for finished, verified, and defensible delivery.",
    "",
    "Evaluation policy:",
    "- Update progress incrementally against the existing decomposition.",
    "- Use nodeUpdates to reflect evidence-backed status changes only.",
    "- Use nodeUpdates with the activeNodeId to mark the active leaf done; the manager will advance activeNodeId from the tree.",
    "- Keep activeNodeId on the current node by default.",
    "- Change activeNodeId only when there is a clear reason to switch to another existing tree node.",
    "- If evidence is missing or ambiguous, prefer verification over further implementation.",
    "",
    "Output schema:",
    "For continue:",
    "{",
    '  "mode": "evaluate",',
    '  "status": "continue",',
    '  "reason": "brief explanation of why more work is needed",',
    '  "guidance": "specific next action for the supervised agent",',
    '  "activeNodeId": optional node id,',
    '  "progressSummary": optional brief progress summary,',
    '  "nodeUpdates": optional array of { "id": string, "status": "pending" | "in_progress" | "done" | "blocked" }',
    "}",
    "",
    "For stop:",
    "{",
    '  "mode": "evaluate",',
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
  command: HeadlessSpawnCommand,
  timeoutMs: number,
  options: EvaluateOptions = {}
): Promise<string> {
  if (options.signal?.aborted) {
    throw createSupervisorEvalAbortedError();
  }

  const standardEnv = buildEvaluatorSpawnEnv(command.env, "standard");
  try {
    return await runCommandWithEnv(command, timeoutMs, options, standardEnv);
  } catch (error) {
    if (!isSpawnE2BigError(error)) {
      throw error;
    }

    const minimalEnv = buildEvaluatorSpawnEnv(command.env, "minimal");
    if (estimateEnvironmentSize(minimalEnv) >= estimateEnvironmentSize(standardEnv)) {
      throw error;
    }

    try {
      return await runCommandWithEnv(command, timeoutMs, options, minimalEnv);
    } catch (retryError) {
      throw retryError;
    }
  }
}

async function runCommandWithEnv(
  command: HeadlessSpawnCommand,
  timeoutMs: number,
  options: EvaluateOptions,
  env: NodeJS.ProcessEnv
): Promise<string> {
  if (options.signal?.aborted) {
    throw createSupervisorEvalAbortedError();
  }

  const stdio: ["pipe" | "ignore", "pipe", "pipe"] =
    command.stdin !== undefined ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"];
  let child: ReturnType<typeof spawn>;

  try {
    child = spawn(command.argv[0]!, command.argv.slice(1), {
      cwd: command.cwd,
      detached: process.platform !== "win32",
      env,
      stdio,
      windowsHide: true,
    });
  } catch (error) {
    throw createEvaluatorSpawnFailure(error, "", "", command.argv, env);
  }

  return await new Promise((resolve, reject) => {
    if (command.stdin !== undefined && child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.end(command.stdin);
    }

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
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: null,
        spawnError: true,
        spawnCode: getErrorCode(error),
        argvBytes: estimateCommandLineLength(command.argv),
        envBytes: estimateEnvironmentSize(env),
        envKeyCount: Object.keys(env).length,
      } satisfies EvaluatorProcessError);
    });
    child.on("exit", (code) => {
      if (terminationError) {
        settleReject(terminationError);
        return;
      }
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) {
        settleReject({
          code: "supervisor_eval_failed",
          message: stderrText.trim() || `Evaluator exited with code ${code}`,
          stdout: stdoutText,
          stderr: stderrText,
          exitCode: code,
          spawnError: false,
        } satisfies EvaluatorProcessError);
        return;
      }

      settleResolve(stdoutText);
    });
  });
}

interface EvaluatorProcessError {
  code: "supervisor_eval_failed";
  message: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  spawnError: boolean;
  spawnCode?: string;
  argvBytes?: number;
  envBytes?: number;
  envKeyCount?: number;
}

type EvaluatorEnvMode = "standard" | "minimal";

function buildEvaluatorSpawnEnv(
  commandEnv: Record<string, string> | undefined,
  mode: EvaluatorEnvMode
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  copyEnvKeys(env, process.env, EVALUATOR_BASE_ENV_KEYS);
  copyEnvKeys(env, process.env, EVALUATOR_WINDOWS_ENV_KEYS);
  copyPrefixedEnvKeys(env, process.env, ["LC_"]);
  copyEnvKeys(env, process.env, EVALUATOR_PROVIDER_ENV_KEYS);
  copyPrefixedEnvKeys(env, process.env, EVALUATOR_PROVIDER_ENV_PREFIXES);
  if (mode === "standard") {
    copyEnvKeys(env, process.env, EVALUATOR_NETWORK_ENV_KEYS);
  }

  if (commandEnv) {
    for (const [key, value] of Object.entries(commandEnv)) {
      env[key] = value;
    }
  }

  return env;
}

function copyEnvKeys(
  target: NodeJS.ProcessEnv,
  source: NodeJS.ProcessEnv,
  keys: readonly string[]
): void {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string") {
      target[key] = value;
    }
  }
}

function copyPrefixedEnvKeys(
  target: NodeJS.ProcessEnv,
  source: NodeJS.ProcessEnv,
  prefixes: readonly string[]
): void {
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" && prefixes.some((prefix) => key.startsWith(prefix))) {
      target[key] = value;
    }
  }
}

function estimateEnvironmentSize(env: NodeJS.ProcessEnv): number {
  let size = 0;
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") {
      continue;
    }
    size += key.length + 1 + value.length + 1;
  }
  return size;
}

function createEvaluatorSpawnFailure(
  error: unknown,
  stdout: string,
  stderr: string,
  argv: string[],
  env: NodeJS.ProcessEnv
): EvaluatorProcessError {
  return {
    code: "supervisor_eval_failed",
    message: error instanceof Error ? error.message : "Evaluator process failed to start",
    stdout,
    stderr,
    exitCode: null,
    spawnError: true,
    spawnCode: getErrorCode(error),
    argvBytes: estimateCommandLineLength(argv),
    envBytes: estimateEnvironmentSize(env),
    envKeyCount: Object.keys(env).length,
  };
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function isSpawnE2BigError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  if ((error as { code?: unknown }).code === "E2BIG") {
    return true;
  }
  if (isEvaluatorProcessError(error) && error.spawnError) {
    return error.spawnCode === "E2BIG" || /\bE2BIG\b|argument list too long/i.test(error.message);
  }
  return false;
}

function isEvaluatorProcessError(error: unknown): error is EvaluatorProcessError {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "supervisor_eval_failed" &&
    typeof (error as { stdout?: unknown }).stdout === "string" &&
    typeof (error as { stderr?: unknown }).stderr === "string"
  );
}

/**
 * When the evaluator child process exits non-zero (or fails to spawn), the
 * `stderr` buffer is frequently empty: codex and claude both like to surface
 * upstream API failures (rate limit, context exceeded, auth, etc.) as JSONL
 * events on stdout instead. This helper:
 *
 * - Scans stdout for a more useful error message (codex `turn.failed`,
 *   claude `is_error` envelope).
 * - Logs a single structured warn with stdout/stderr previews, argv, and
 *   exit code so future failures are diagnosable from server logs alone.
 * - Returns a fresh error with `code: "supervisor_eval_failed"` so the
 *   existing `retryOnEvaluatorError` retry path still kicks in.
 */
function diagnoseEvaluatorProcessError(
  error: EvaluatorProcessError,
  providerId: string,
  logger: FastifyBaseLogger,
  supervisor: Supervisor,
  context: SupervisorEvaluationContext,
  command: { argv: string[]; cwd?: string; env?: Record<string, string> },
  prompt: string
): { code: "supervisor_eval_failed"; message: string } {
  const stdoutLines = error.stdout.trim().split(/\r?\n/).filter(Boolean);
  const upstreamMessage = extractUpstreamErrorMessage(providerId, error.stdout, stdoutLines);

  const resolvedMessage =
    upstreamMessage ?? (error.stderr.trim() ? error.stderr.trim() : error.message);

  logger.warn(
    {
      supervisorId: supervisor.id,
      sessionId: supervisor.sessionId,
      evaluatorProviderId: supervisor.evaluatorProviderId,
      sessionProviderId: context.sessionProviderId,
      exitCode: error.exitCode,
      spawnError: error.spawnError,
      spawnCode: error.spawnCode,
      argvBytes: error.argvBytes,
      envBytes: error.envBytes,
      envKeyCount: error.envKeyCount,
      upstreamMessage,
      stderrPreview: buildStdoutPreview(error.stderr.trim(), 2000),
      stdoutPreview: buildStdoutPreview(error.stdout.trim(), 2000),
      commandArgv: command.argv,
      commandCwd: command.cwd,
      promptPreview: buildStdoutPreview(prompt, 500),
    },
    "Supervisor evaluator process failed"
  );

  return {
    code: "supervisor_eval_failed",
    message: resolvedMessage || `Evaluator exited with code ${error.exitCode ?? "unknown"}`,
  };
}

function extractUpstreamErrorMessage(
  providerId: string,
  stdout: string,
  stdoutLines: string[]
): string | null {
  if (!stdout.trim()) {
    return null;
  }

  if (providerId === "codex") {
    const scan = scanCodexStream(stdoutLines);
    if (scan.turnFailure) {
      return scan.turnFailure;
    }
  }

  // Claude CLI with `--output-format json` writes the result envelope (or
  // partial event stream) to stdout. Look at the trailing lines first since
  // the final envelope arrives last.
  for (let i = stdoutLines.length - 1; i >= 0; i--) {
    const line = stdoutLines[i]!.trim();
    if (!line.startsWith("{") && !line.startsWith("[")) {
      continue;
    }
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== "object") {
        continue;
      }
      const record = parsed as Record<string, unknown>;
      if (record.is_error === true || record.subtype === "error_during_execution") {
        const result = record.result;
        if (typeof result === "string" && result.trim()) {
          return result.trim();
        }
        const err = record.error;
        if (err && typeof err === "object") {
          const msg = (err as Record<string, unknown>).message;
          if (typeof msg === "string" && msg.trim()) {
            return msg.trim();
          }
        }
        return "Evaluator reported an error in its result envelope";
      }
    } catch {
      // not JSON, keep looking
    }
  }

  return null;
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
 * Strip a ```json … ``` (or bare ```…```) markdown fence when it wraps the
 * entire payload. The regex is anchored on purpose: a mid-payload fence
 * (e.g. a ```bash``` snippet inside a `guidance` string value) must NOT be
 * harvested, otherwise the surrounding JSON is destroyed.
 */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```$/);
  return fenced ? fenced[1]!.trim() : text;
}

/**
 * Re-escape literal control characters (newlines, tabs, etc.) that appear
 * inside JSON string values. LLM evaluators occasionally emit multi-line
 * strings without escaping the newlines, which produces
 * `SyntaxError: Unterminated string in JSON at position X`. This pass only
 * touches characters that appear inside a string literal; structure outside
 * of strings is left untouched.
 */
function repairJsonControlChars(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString) {
      if (ch === "\n") {
        out += "\\n";
        continue;
      }
      if (ch === "\r") {
        out += "\\r";
        continue;
      }
      if (ch === "\t") {
        out += "\\t";
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        out += `\\u${code.toString(16).padStart(4, "0")}`;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function createSupervisorEvalFailedError(message: string): {
  code: "supervisor_eval_failed";
  message: string;
} {
  return { code: "supervisor_eval_failed", message };
}

/**
 * Scan `text` for the first balanced `{ … }` block, ignoring braces that
 * appear inside string literals. Useful when the model prefaces the JSON
 * with prose like "Based on my analysis: {…}". Returns null when no
 * balanced object is found.
 */
function extractBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

interface JsonCandidate {
  text: string;
  source: "raw" | "code-fence-wrap" | "balanced-object";
}

/**
 * Enumerate plausible JSON candidates inside a supervisor payload, ordered
 * from most-trusted to most-aggressive. Each entry is later passed to
 * JSON.parse (with a control-char repair fallback) until one succeeds.
 */
function collectJsonCandidates(text: string): JsonCandidate[] {
  const candidates: JsonCandidate[] = [];
  const trimmed = text.trim();
  if (!trimmed) {
    return candidates;
  }

  const seen = new Set<string>();
  const push = (entry: JsonCandidate) => {
    if (!entry.text || seen.has(entry.text)) {
      return;
    }
    seen.add(entry.text);
    candidates.push(entry);
  };

  push({ text: trimmed, source: "raw" });

  const wholeWrap = trimmed.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```$/);
  if (wholeWrap) {
    push({ text: wholeWrap[1]!.trim(), source: "code-fence-wrap" });
  }

  const balanced = extractBalancedObject(trimmed);
  if (balanced) {
    push({ text: balanced, source: "balanced-object" });
  }

  return candidates;
}

interface SupervisorJsonParseAttempt {
  parsed: unknown;
  parsedOk: boolean;
  candidate: string;
  source: JsonCandidate["source"];
  firstError?: unknown;
  repaired: boolean;
}

function tryParseSupervisorJson(payloadText: string): SupervisorJsonParseAttempt {
  const candidates = collectJsonCandidates(payloadText);
  let firstError: unknown;
  let firstCandidate = payloadText.trim();

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    if (i === 0) {
      firstCandidate = candidate.text;
    }
    try {
      const parsed = JSON.parse(candidate.text);
      return {
        parsed,
        parsedOk: true,
        candidate: candidate.text,
        source: candidate.source,
        repaired: false,
      };
    } catch (error) {
      if (firstError === undefined) {
        firstError = error;
      }
    }

    const repaired = repairJsonControlChars(candidate.text);
    if (repaired !== candidate.text) {
      try {
        const parsed = JSON.parse(repaired);
        return {
          parsed,
          parsedOk: true,
          candidate: candidate.text,
          source: candidate.source,
          repaired: true,
        };
      } catch {
        // continue with the next candidate
      }
    }
  }

  return {
    parsed: undefined,
    parsedOk: false,
    candidate: firstCandidate,
    source: "raw",
    firstError,
    repaired: false,
  };
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

function readTaskType(value: unknown): SupervisorTaskType {
  return value === "coding" ||
    value === "writing" ||
    value === "research" ||
    value === "design" ||
    value === "generic"
    ? value
    : "generic";
}

function readGranularity(value: unknown): SupervisorGranularity | undefined {
  return value === "too_large" || value === "ready" || value === "too_small" ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value.flatMap<string>((entry) =>
    typeof entry === "string" && entry.trim() ? [entry.trim()] : []
  );
  return values.length > 0 ? values : undefined;
}

function parsePlanNode(value: unknown): SupervisorPlanNode | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const node = value as Record<string, unknown>;
  if (
    typeof node.id !== "string" ||
    typeof node.title !== "string" ||
    typeof node.objective !== "string" ||
    typeof node.deliverable !== "string" ||
    !Array.isArray(node.acceptanceCriteria) ||
    node.acceptanceCriteria.some((entry) => typeof entry !== "string")
  ) {
    return null;
  }
  const status =
    node.status === "done" || node.status === "blocked" || node.status === "in_progress"
      ? node.status
      : "pending";
  const children = Array.isArray(node.children)
    ? node.children.flatMap<SupervisorPlanNode>((child) => {
        const parsed = parsePlanNode(child);
        return parsed ? [parsed] : [];
      })
    : [];
  return {
    id: node.id,
    title: node.title,
    objective: node.objective,
    deliverable: node.deliverable,
    acceptanceCriteria: node.acceptanceCriteria as string[],
    status,
    taskType: readTaskType(node.taskType),
    children,
  };
}

function parseSupervisorEvaluationResult(
  payloadText: string,
  guidanceMaxChars: number,
  requestedMode: SupervisorEvaluatorMode,
  logger: FastifyBaseLogger = NOOP_LOGGER
): SupervisorEvaluationResult {
  const attempt = tryParseSupervisorJson(payloadText);

  if (!attempt.parsedOk) {
    logger.warn(
      {
        parseError:
          attempt.firstError instanceof Error
            ? attempt.firstError.message
            : String(attempt.firstError),
        payloadPreview: buildStdoutPreview(payloadText.trim(), 2000),
      },
      "Supervisor returned invalid JSON"
    );
    throw createSupervisorEvalFailedError(
      `Supervisor returned invalid JSON: ${attempt.firstError instanceof Error ? attempt.firstError.message : "parse failed"}`
    );
  }

  if (attempt.source !== "raw" || attempt.repaired) {
    logger.warn(
      {
        source: attempt.source,
        repaired: attempt.repaired,
        payloadPreview: buildStdoutPreview(payloadText.trim(), 2000),
      },
      "Supervisor JSON auto-recovered before parsing"
    );
  }

  const parsed = attempt.parsed;
  if (!parsed || typeof parsed !== "object") {
    throw createSupervisorEvalFailedError("Supervisor returned invalid evaluation payload");
  }

  const record = parsed as Record<string, unknown>;
  const payloadMode = record.mode;

  if (requestedMode === "decompose") {
    if (payloadMode !== "decompose") {
      throw createSupervisorEvalFailedError("Supervisor returned invalid decompose payload");
    }

    const children = Array.isArray(record.children)
      ? record.children.flatMap<SupervisorPlanNode>((value) => {
          const child = parsePlanNode(value);
          return child ? [child] : [];
        })
      : [];

    if (children.length === 0) {
      throw createSupervisorEvalFailedError(
        "Supervisor decompose result must include at least one valid child"
      );
    }

    return {
      mode: "decompose",
      children,
      activeNodeId:
        typeof record.activeNodeId === "string" && record.activeNodeId.trim()
          ? record.activeNodeId
          : undefined,
      progressSummary:
        typeof record.progressSummary === "string" && record.progressSummary.trim()
          ? record.progressSummary.trim()
          : undefined,
    };
  }

  if (requestedMode === "ready_check") {
    if (payloadMode !== "ready_check") {
      throw createSupervisorEvalFailedError("Supervisor returned invalid ready_check payload");
    }

    const granularity = readGranularity(record.granularity);
    if (!granularity) {
      throw createSupervisorEvalFailedError(
        "Supervisor ready_check result is missing a valid granularity"
      );
    }
    if (
      typeof record.nodeId !== "string" ||
      !record.nodeId.trim() ||
      typeof record.reason !== "string" ||
      !record.reason.trim()
    ) {
      throw createSupervisorEvalFailedError("Supervisor returned invalid ready_check payload");
    }

    return {
      mode: "ready_check",
      nodeId: record.nodeId,
      taskType: readTaskType(record.taskType),
      granularity,
      reason: record.reason.trim(),
      recommendedUnit:
        typeof record.recommendedUnit === "string" && record.recommendedUnit.trim()
          ? record.recommendedUnit.trim()
          : undefined,
      qualityRisk:
        typeof record.qualityRisk === "string" && record.qualityRisk.trim()
          ? record.qualityRisk.trim()
          : undefined,
      missingInputs: readStringArray(record.missingInputs),
      confidence:
        record.confidence === "low" ||
        record.confidence === "medium" ||
        record.confidence === "high"
          ? record.confidence
          : undefined,
    };
  }

  if (requestedMode === "decompose_child") {
    if (payloadMode !== "decompose_child") {
      throw createSupervisorEvalFailedError("Supervisor returned invalid decompose_child payload");
    }
    if (typeof record.parentNodeId !== "string" || !record.parentNodeId.trim()) {
      throw createSupervisorEvalFailedError(
        "Supervisor decompose_child result is missing a valid parentNodeId"
      );
    }

    const children = Array.isArray(record.children)
      ? record.children.flatMap<SupervisorPlanNode>((value) => {
          const child = parsePlanNode(value);
          return child ? [child] : [];
        })
      : [];

    if (children.length === 0) {
      throw createSupervisorEvalFailedError(
        "Supervisor decompose_child result must include at least one valid child"
      );
    }

    return {
      mode: "decompose_child",
      parentNodeId: record.parentNodeId,
      children,
      activeNodeId:
        typeof record.activeNodeId === "string" && record.activeNodeId.trim()
          ? record.activeNodeId
          : undefined,
      progressSummary:
        typeof record.progressSummary === "string" && record.progressSummary.trim()
          ? record.progressSummary.trim()
          : undefined,
    };
  }

  if (requestedMode === "executable_task") {
    if (payloadMode !== "executable_task") {
      throw createSupervisorEvalFailedError("Supervisor returned invalid executable_task payload");
    }
    if (
      typeof record.nodeId !== "string" ||
      !record.nodeId.trim() ||
      typeof record.guidance !== "string" ||
      !record.guidance.trim()
    ) {
      throw createSupervisorEvalFailedError("Supervisor returned invalid executable_task payload");
    }

    return {
      mode: "executable_task",
      nodeId: record.nodeId,
      guidance: record.guidance.trim().slice(0, guidanceMaxChars),
      fallback: record.fallback === true ? true : undefined,
    };
  }

  const status = record.status;
  const reason = record.reason;

  if (
    (payloadMode !== undefined && payloadMode !== "evaluate") ||
    (status !== "continue" && status !== "stop") ||
    typeof reason !== "string" ||
    !reason.trim()
  ) {
    throw createSupervisorEvalFailedError("Supervisor returned invalid evaluation payload");
  }

  if (status === "stop") {
    const stopReason = record.stopReason;
    if (stopReason !== "objective_complete" && stopReason !== "supervisor_uncertain") {
      throw createSupervisorEvalFailedError("Supervisor stop result is missing a valid stopReason");
    }

    return {
      mode: "evaluate",
      status,
      stopReason,
      reason: reason.trim(),
    };
  }

  const guidance =
    typeof record.guidance === "string" && record.guidance.trim()
      ? record.guidance.trim().slice(0, guidanceMaxChars)
      : undefined;

  const nodeUpdates: SupervisorCycleNodeUpdate[] | undefined = Array.isArray(record.nodeUpdates)
    ? record.nodeUpdates.flatMap<SupervisorCycleNodeUpdate>((value) => {
        if (!value || typeof value !== "object") {
          return [];
        }
        const update = value as Record<string, unknown>;
        if (
          typeof update.id !== "string" ||
          (update.status !== "pending" &&
            update.status !== "in_progress" &&
            update.status !== "done" &&
            update.status !== "blocked")
        ) {
          return [];
        }
        return [{ id: update.id, status: update.status }];
      })
    : undefined;

  return {
    mode: "evaluate",
    status,
    reason: reason.trim(),
    guidance,
    activeNodeId:
      typeof record.activeNodeId === "string" && record.activeNodeId.trim()
        ? record.activeNodeId
        : undefined,
    progressSummary:
      typeof record.progressSummary === "string" && record.progressSummary.trim()
        ? record.progressSummary.trim()
        : undefined,
    nodeUpdates,
  };
}
