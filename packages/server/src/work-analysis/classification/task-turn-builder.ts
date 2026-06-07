import type { WorkLogEvent, WorkLogSession } from "../log-sources/types.js";

import {
  EDIT_TOOL_NAMES,
  READ_TOOL_NAMES,
  SEARCH_TOOL_NAMES,
  TASK_TOOL_NAMES,
} from "./task-rules.js";

export interface DerivedTaskToolStep {
  tool: string;
  file?: string;
  command?: string;
}

export interface DerivedTaskTurn {
  turnId: string;
  sessionId: string;
  providerId: string;
  workspacePath: string;
  modelId?: string;
  userMessage: string;
  toolNames: string[];
  commandTexts: string[];
  filePaths: string[];
  toolSteps: DerivedTaskToolStep[];
  startedAt?: number;
  hasPlanMode: boolean;
  hasAgentSpawn: boolean;
  hasEdits: boolean;
  hasReads: boolean;
  hasSearch: boolean;
  hasTaskTools: boolean;
  hasSkillTool: boolean;
  hasMcpTools: boolean;
  hasGitSignal: boolean;
}

function isUserMessageEvent(event: WorkLogEvent) {
  return event.eventType === "message" && event.role === "user";
}

function createTurn(
  session: WorkLogSession,
  turnIndex: number,
  startedAt?: number
): DerivedTaskTurn {
  return {
    turnId: `${session.sessionId}:turn:${turnIndex}`,
    sessionId: session.sessionId,
    providerId: session.providerId,
    workspacePath: session.workspacePath,
    ...(session.modelId ? { modelId: session.modelId } : {}),
    userMessage: "",
    toolNames: [],
    commandTexts: [],
    filePaths: [],
    toolSteps: [],
    ...(typeof startedAt === "number" ? { startedAt } : {}),
    hasPlanMode: false,
    hasAgentSpawn: false,
    hasEdits: false,
    hasReads: false,
    hasSearch: false,
    hasTaskTools: false,
    hasSkillTool: false,
    hasMcpTools: false,
    hasGitSignal: false,
  };
}

function applyEvent(turn: DerivedTaskTurn, event: WorkLogEvent) {
  if (isUserMessageEvent(event)) {
    turn.userMessage = event.text?.trim() ?? "";
  }

  if (typeof event.toolName === "string" && event.toolName.length > 0) {
    turn.toolNames.push(event.toolName);
    turn.toolSteps.push({
      tool: event.toolName,
      ...(typeof event.filePath === "string" && event.filePath.length > 0
        ? { file: event.filePath }
        : {}),
      ...(typeof event.commandText === "string" && event.commandText.length > 0
        ? { command: event.commandText }
        : {}),
    });
    turn.hasEdits ||= EDIT_TOOL_NAMES.has(event.toolName);
    turn.hasReads ||= READ_TOOL_NAMES.has(event.toolName);
    turn.hasSearch ||= SEARCH_TOOL_NAMES.has(event.toolName);
    turn.hasTaskTools ||= TASK_TOOL_NAMES.has(event.toolName);
    turn.hasSkillTool ||= event.toolName === "Skill";
    turn.hasMcpTools ||= event.toolName.startsWith("mcp__");
  }

  if (typeof event.commandText === "string" && event.commandText.length > 0) {
    turn.commandTexts.push(event.commandText);
    if (!(typeof event.toolName === "string" && event.toolName.length > 0)) {
      turn.toolSteps.push({
        tool: event.eventType === "command" ? "command" : "shell",
        command: event.commandText,
      });
    }
  }

  if (typeof event.filePath === "string" && event.filePath.length > 0) {
    turn.filePaths.push(event.filePath);
    if (
      !(typeof event.toolName === "string" && event.toolName.length > 0) &&
      event.eventType === "edit"
    ) {
      turn.toolSteps.push({ tool: "edit", file: event.filePath });
    }
  }

  if (event.eventType === "plan" || event.canonicalEventType === "plan") {
    turn.hasPlanMode = true;
  }

  if (event.eventType === "agent" || event.canonicalEventType === "agent_spawn") {
    turn.hasAgentSpawn = true;
  }

  if (event.eventType === "edit") {
    turn.hasEdits = true;
    if (
      !(typeof event.toolName === "string" && event.toolName.length > 0) &&
      !(typeof event.filePath === "string" && event.filePath.length > 0)
    ) {
      turn.toolSteps.push({ tool: "edit" });
    }
  }

  if (event.eventType === "git" || event.canonicalEventType === "git_signal") {
    turn.hasGitSignal = true;
  }
}

export function deriveTaskTurns(session: WorkLogSession): DerivedTaskTurn[] {
  const events = session.events ?? [];
  if (events.length === 0) {
    return [];
  }

  const hasUserMessages = events.some(isUserMessageEvent);
  const turns: DerivedTaskTurn[] = [];
  let currentTurn: DerivedTaskTurn | null = hasUserMessages
    ? null
    : createTurn(session, 0, events[0]?.occurredAt);

  for (const event of events) {
    if (isUserMessageEvent(event)) {
      if (currentTurn) {
        turns.push(currentTurn);
      }
      currentTurn = createTurn(session, turns.length, event.occurredAt);
    }

    if (!currentTurn) {
      continue;
    }

    applyEvent(currentTurn, event);
  }

  if (currentTurn) {
    turns.push(currentTurn);
  }

  return turns;
}
