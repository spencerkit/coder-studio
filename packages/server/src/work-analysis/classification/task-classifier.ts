import type { WorkLogEvent } from "../log-sources/types.js";
import type { RetryToolStep } from "../metrics/retry.js";
import { countTurnRetries } from "../metrics/retry.js";
import type { WorkAnalysisTaskType } from "../types.js";
import {
  BASH_TOOL_NAMES,
  BRAINSTORM_KEYWORDS,
  BUILD_PATTERNS,
  DEBUG_KEYWORDS,
  FEATURE_KEYWORDS,
  FILE_PATTERNS,
  firstMatchingCategory,
  GIT_PATTERNS,
  INSTALL_PATTERNS,
  REFACTOR_KEYWORDS,
  RESEARCH_KEYWORDS,
  SCRIPT_PATTERNS,
  TEST_PATTERNS,
  URL_PATTERN,
} from "./task-rules.js";
import { WORK_ANALYSIS_TASK_TYPES } from "./task-taxonomy.js";

export interface TaskClassificationInput {
  providerId: string;
  workspacePath?: string;
  modelId?: string;
  userTurnCount?: number;
  assistantTurnCount?: number;
  toolUseCount?: number;
  events?: WorkLogEvent[];
}

export interface TaskClassificationResult {
  primaryTask: WorkAnalysisTaskType;
  signals: string[];
  scores: Partial<Record<WorkAnalysisTaskType, number>>;
}

export interface TaskTurnClassificationInput {
  turnId?: string;
  userMessage: string;
  toolNames: string[];
  commandTexts: string[];
  filePaths: string[];
  toolSteps?: RetryToolStep[];
  hasPlanMode: boolean;
  hasAgentSpawn: boolean;
  hasEdits: boolean;
  hasReads: boolean;
  hasSearch: boolean;
  hasTaskTool?: boolean;
  hasTaskTools?: boolean;
  hasSkillTool: boolean;
  hasMcpTool?: boolean;
  hasMcpTools?: boolean;
}

export interface TaskTurnClassificationResult {
  turnId?: string;
  primaryTask: WorkAnalysisTaskType;
  secondaryTasks: WorkAnalysisTaskType[];
  evidence: string[];
  hasEdits: boolean;
  retries: number;
}

const SHELL_TEST_PATTERNS = [
  /\bvitest\b/i,
  /\bjest\b/i,
  /\bpytest\b/i,
  /\bnpm\s+test\b/i,
  /\bpnpm\s+test\b/i,
  /\bgo\s+test\b/i,
  /\bcargo\s+test\b/i,
];

const BUILD_SIGNAL_PATTERNS = [
  /\bnpm\s+run\s+build\b/i,
  /\bpnpm\s+build\b/i,
  /\byarn\s+build\b/i,
  /\bdocker\b/i,
  /\bkubectl\b/i,
  /\bdeploy\b/i,
  /\bvercel\b/i,
  /\bnetlify\b/i,
];

const DEBUG_SIGNAL_PATTERNS = [/\bdebug\b/i, /\berror\b/i, /\bbug\b/i, /\bfix\b/i, /\bfailing\b/i];
const PLAN_PATTERNS = [/\bplan\b/i, /\bdesign\b/i, /\broadmap\b/i, /方案/, /规划/, /调研/];
const EXPLORE_PATTERNS = [/\bresearch\b/i, /\binvestigate\b/i, /\bexplore\b/i, /\banalyze\b/i];
const BRAINSTORM_PATTERNS = [/\bbrainstorm\b/i, /\bideas?\b/i, /头脑风暴/, /想法/];
const REFACTOR_SIGNAL_PATTERNS = [/\brefactor\b/i, /\bcleanup\b/i, /\brename\b/i];
const FEATURE_SIGNAL_PATTERNS = [/\bfeature\b/i, /\bimplement\b/i, /\badd\b/i, /\bbuild\b/i];
const GIT_SIGNAL_PATTERNS = [
  /\bgit\b/i,
  /\bcommit\b/i,
  /\brebase\b/i,
  /\bmerge\b/i,
  /\bcherry-pick\b/i,
];

function normalizeTaskToolFlag(input: TaskTurnClassificationInput) {
  return input.hasTaskTools ?? input.hasTaskTool ?? false;
}

function normalizeMcpToolFlag(input: TaskTurnClassificationInput) {
  return input.hasMcpTools ?? input.hasMcpTool ?? false;
}

function collectKeywordMatches(message: string) {
  const matches: WorkAnalysisTaskType[] = [];
  if (REFACTOR_KEYWORDS.test(message)) {
    matches.push("refactoring");
  }
  if (FEATURE_KEYWORDS.test(message)) {
    matches.push("feature_dev");
  }
  if (DEBUG_KEYWORDS.test(message)) {
    matches.push("debugging");
  }
  if (RESEARCH_KEYWORDS.test(message)) {
    matches.push("exploration");
  }
  if (BRAINSTORM_KEYWORDS.test(message)) {
    matches.push("brainstorming");
  }
  return matches;
}

function classifyConversation(input: TaskTurnClassificationInput) {
  if (BRAINSTORM_KEYWORDS.test(input.userMessage)) {
    return { category: "brainstorming" as const, evidence: ["keyword:brainstorming"] };
  }
  if (RESEARCH_KEYWORDS.test(input.userMessage)) {
    return { category: "exploration" as const, evidence: ["keyword:exploration"] };
  }

  const featureOrDebug = firstMatchingCategory(input.userMessage, [
    { regex: FEATURE_KEYWORDS, category: "feature_dev" },
    { regex: DEBUG_KEYWORDS, category: "debugging" },
  ]);
  if (featureOrDebug) {
    return { category: featureOrDebug, evidence: [`keyword:${featureOrDebug}`] };
  }

  if (input.filePaths.length > 0 || FILE_PATTERNS.test(input.userMessage)) {
    return { category: "coding" as const, evidence: ["conversation:file_reference"] };
  }

  if (SCRIPT_PATTERNS.test(input.userMessage)) {
    return { category: "coding" as const, evidence: ["conversation:script_reference"] };
  }

  if (URL_PATTERN.test(input.userMessage)) {
    return { category: "exploration" as const, evidence: ["conversation:url_reference"] };
  }

  return { category: "conversation" as const, evidence: ["fallback:conversation"] };
}

function classifyByToolPattern(input: TaskTurnClassificationInput) {
  const textCorpus = [input.userMessage, ...input.commandTexts].join("\n");
  const hasBash = input.toolNames.some((toolName) => BASH_TOOL_NAMES.has(toolName));
  const hasTaskTools = normalizeTaskToolFlag(input);
  const hasMcpTools = normalizeMcpToolFlag(input);

  if (input.hasPlanMode) {
    return { category: "planning" as const, evidence: ["tool_pattern:plan_mode"] };
  }
  if (input.hasAgentSpawn) {
    return { category: "delegation" as const, evidence: ["tool_pattern:agent_spawn"] };
  }
  if (hasBash && !input.hasEdits) {
    if (TEST_PATTERNS.test(textCorpus)) {
      return { category: "testing" as const, evidence: ["tool_pattern:test_command"] };
    }
    if (GIT_PATTERNS.test(textCorpus)) {
      return { category: "git_ops" as const, evidence: ["tool_pattern:git_command"] };
    }
    if (BUILD_PATTERNS.test(textCorpus)) {
      return { category: "build_deploy" as const, evidence: ["tool_pattern:build_command"] };
    }
    if (INSTALL_PATTERNS.test(textCorpus)) {
      return { category: "build_deploy" as const, evidence: ["tool_pattern:install_command"] };
    }
  }
  if (input.hasEdits) {
    return { category: "coding" as const, evidence: ["tool_pattern:edit"] };
  }
  if (hasBash && input.hasReads) {
    return { category: "exploration" as const, evidence: ["tool_pattern:bash_read"] };
  }
  if (hasBash) {
    return { category: "coding" as const, evidence: ["tool_pattern:bash"] };
  }
  if (input.hasSearch || hasMcpTools) {
    return { category: "exploration" as const, evidence: ["tool_pattern:search_or_mcp"] };
  }
  if (input.hasReads && !input.hasEdits) {
    return { category: "exploration" as const, evidence: ["tool_pattern:read_only"] };
  }
  if (hasTaskTools && !input.hasEdits) {
    return { category: "planning" as const, evidence: ["tool_pattern:task_tool"] };
  }
  if (input.hasSkillTool) {
    return { category: "general" as const, evidence: ["tool_pattern:skill_tool"] };
  }
  return null;
}

export function classifyTaskTurn(input: TaskTurnClassificationInput): TaskTurnClassificationResult {
  const keywordMatches = collectKeywordMatches(input.userMessage);
  const toolPattern = classifyByToolPattern(input);
  const evidence = [...(toolPattern?.evidence ?? [])];
  let primaryTask: WorkAnalysisTaskType;

  if (!toolPattern) {
    const conversation = classifyConversation(input);
    primaryTask = conversation.category;
    evidence.push(...conversation.evidence);
  } else {
    primaryTask = toolPattern.category;

    if (primaryTask === "coding") {
      const refined = firstMatchingCategory(input.userMessage, [
        { regex: REFACTOR_KEYWORDS, category: "refactoring" },
        { regex: FEATURE_KEYWORDS, category: "feature_dev" },
        { regex: DEBUG_KEYWORDS, category: "debugging" },
      ]);
      if (refined) {
        primaryTask = refined;
        evidence.push(`keyword:${refined}`);
      }
    } else if (primaryTask === "exploration") {
      if (RESEARCH_KEYWORDS.test(input.userMessage)) {
        evidence.push("keyword:exploration");
      } else if (DEBUG_KEYWORDS.test(input.userMessage)) {
        primaryTask = "debugging";
        evidence.push("keyword:debugging");
      }
    }
  }

  const secondaryTasks = keywordMatches.filter(
    (taskType, index, tasks) => taskType !== primaryTask && tasks.indexOf(taskType) === index
  );

  return {
    ...(input.turnId ? { turnId: input.turnId } : {}),
    primaryTask,
    secondaryTasks,
    evidence,
    hasEdits: input.hasEdits,
    retries: input.hasEdits ? countTurnRetries(input.toolSteps ?? []) : 0,
  };
}

export function classifySessionTask(input: TaskClassificationInput): TaskClassificationResult {
  const scores: Partial<Record<WorkAnalysisTaskType, number>> = {};
  const signals: string[] = [];
  const events = input.events ?? [];
  const textCorpus = events
    .flatMap((event) => [event.text, event.commandText, event.toolName])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");

  function add(taskType: WorkAnalysisTaskType, score: number, signal: string) {
    scores[taskType] = (scores[taskType] ?? 0) + score;
    if (!signals.includes(signal)) {
      signals.push(signal);
    }
  }

  for (const event of events) {
    if (event.eventType === "agent") {
      add("delegation", 6, "agent_event");
    }
    if (event.eventType === "plan") {
      add("planning", 5, "plan_event");
    }
    if (event.eventType === "git") {
      add("git_ops", 6, "git_event");
    }
    if (event.eventType === "edit") {
      add("coding", 4, "edit_event");
    }
    if (event.eventType === "command" && typeof event.commandText === "string") {
      const command = event.commandText;
      if (SHELL_TEST_PATTERNS.some((pattern) => pattern.test(command))) {
        add("testing", 6, "test_command");
      }
      if (BUILD_SIGNAL_PATTERNS.some((pattern) => pattern.test(command))) {
        add("build_deploy", 5, "build_command");
      }
      if (GIT_SIGNAL_PATTERNS.some((pattern) => pattern.test(command))) {
        add("git_ops", 5, "git_command");
      }
    }
  }

  if (REFACTOR_SIGNAL_PATTERNS.some((pattern) => pattern.test(textCorpus))) {
    add("refactoring", 5, "refactor_language");
  }
  if (DEBUG_SIGNAL_PATTERNS.some((pattern) => pattern.test(textCorpus))) {
    add("debugging", 5, "debug_language");
  }
  if (PLAN_PATTERNS.some((pattern) => pattern.test(textCorpus))) {
    add("planning", 4, "planning_language");
  }
  if (EXPLORE_PATTERNS.some((pattern) => pattern.test(textCorpus))) {
    add("exploration", 4, "exploration_language");
  }
  if (BRAINSTORM_PATTERNS.some((pattern) => pattern.test(textCorpus))) {
    add("brainstorming", 5, "brainstorming_language");
  }
  if (FEATURE_SIGNAL_PATTERNS.some((pattern) => pattern.test(textCorpus))) {
    add("feature_dev", 3, "feature_language");
  }
  if ((input.toolUseCount ?? 0) > 0 && !scores.testing && !scores.git_ops) {
    add("coding", 2, "tool_activity");
  }
  if (
    (input.userTurnCount ?? 0) > 0 &&
    (input.assistantTurnCount ?? 0) > 0 &&
    events.length === 0
  ) {
    add("conversation", 1, "message_only_session");
  }

  const ranked = WORK_ANALYSIS_TASK_TYPES.filter((taskType) => taskType !== "general")
    .map((taskType) => ({ taskType, score: scores[taskType] ?? 0 }))
    .sort((left, right) => right.score - left.score || left.taskType.localeCompare(right.taskType));

  const primaryTask =
    ranked[0] && ranked[0].score > 0 ? ranked[0].taskType : inferGeneralTaskFallback(input);

  return {
    primaryTask,
    signals: signals.length > 0 ? signals : ["fallback_general"],
    scores,
  };
}

function inferGeneralTaskFallback(input: TaskClassificationInput): WorkAnalysisTaskType {
  if ((input.toolUseCount ?? 0) > 0) {
    return "coding";
  }
  if ((input.userTurnCount ?? 0) > 0 || (input.assistantTurnCount ?? 0) > 0) {
    return "conversation";
  }
  return "general";
}
