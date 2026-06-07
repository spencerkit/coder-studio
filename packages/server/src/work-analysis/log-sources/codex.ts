import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { extractSkillNameFromPayload } from "../skill-attribution.js";
import { buildUsageCoverage, normalizeUsage, sumUsageCalls } from "../usage-rollup.js";
import {
  isWithinRange,
  parseOptionalTimestamp,
  resolveHomePath,
  safeJsonParse,
} from "./path-encoding.js";
import type {
  ProviderWorkLogDiscoverInput,
  ProviderWorkLogDiscovery,
  ProviderWorkLogSource,
  WorkLogEvent,
  WorkLogEvidenceExcerpt,
  WorkLogSession,
  WorkLogSourceRef,
  WorkLogUsageCall,
} from "./types.js";

interface CodexRecord {
  type?: string;
  role?: string;
  timestamp?: string | number;
  cwd?: string;
  event?: string;
  payload?: {
    id?: string;
    cwd?: string;
    text?: string;
    name?: string;
    type?: string;
    model?: string;
    model_provider?: string;
    input?: unknown;
    arguments?: string;
    path?: string;
    file_path?: string;
    parsed_cmd?: CodexParsedCommand[] | unknown;
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
    total_tokens?: number;
    info?: {
      last_token_usage?: {
        input_tokens?: number;
        cached_input_tokens?: number;
        output_tokens?: number;
        reasoning_output_tokens?: number;
        total_tokens?: number;
      };
      total_token_usage?: {
        input_tokens?: number;
        cached_input_tokens?: number;
        output_tokens?: number;
        reasoning_output_tokens?: number;
        total_tokens?: number;
      };
    };
    git?: {
      branch?: string;
      commit_hash?: string;
    };
  };
}

interface CodexParsedCommand {
  type?: string;
  cmd?: string;
  name?: string;
  path?: string;
  file_path?: string;
}

interface NormalizedCodexTool {
  toolName?: string;
  toolCategory?: WorkLogEvent["toolCategory"];
  eventType: WorkLogEvent["eventType"];
  canonicalEventType: WorkLogEvent["canonicalEventType"];
  commandKind?: string;
}

export function createCodexWorkLogSource(options: { home?: string } = {}): ProviderWorkLogSource {
  return {
    providerId: "codex",
    async discover(input) {
      const root = resolveHomePath("~/.codex/sessions", options.home);
      const rootStat = await stat(root).catch(() => undefined);
      if (!rootStat?.isDirectory()) {
        return buildEmptyDiscovery("codex", "missing_root");
      }

      const files = await collectFiles(root, ".jsonl");
      const sessions: WorkLogSession[] = [];
      const sourceRefs: WorkLogSourceRef[] = [];
      const warnings: ProviderWorkLogDiscovery["warnings"] = [];
      let parseErrorCount = 0;

      for (const filePath of files) {
        const fileStat = await stat(filePath).catch(() => undefined);
        if (!fileStat?.isFile()) {
          continue;
        }

        const sourceRef: WorkLogSourceRef = {
          providerId: "codex",
          kind: "file",
          path: filePath,
          mtimeMs: fileStat.mtimeMs,
          sizeBytes: fileStat.size,
        };
        sourceRefs.push(sourceRef);

        const parsed = await parseCodexSession(filePath, fileStat.mtimeMs, input);
        if (!parsed.matched) {
          continue;
        }

        parseErrorCount += parsed.parseErrorCount;
        if (parsed.parseErrorCount > 0) {
          warnings.push({
            code: "parse_error",
            message: `Failed to parse ${parsed.parseErrorCount} line(s) from Codex log`,
            sourceRef: filePath,
          });
        }
        if (parsed.session) {
          sessions.push(parsed.session);
        }
      }

      const status =
        parseErrorCount > 0 ? "partial" : sessions.length === 0 ? "no_logs" : "supported";

      return {
        providerId: "codex",
        status,
        sessions,
        sourceRefs,
        parseErrorCount,
        warnings,
      };
    },
  };
}

async function parseCodexSession(
  filePath: string,
  fileMtimeMs: number,
  input: ProviderWorkLogDiscoverInput
): Promise<{ matched: boolean; session?: WorkLogSession; parseErrorCount: number }> {
  const content = await readFile(filePath, "utf8").catch(() => "");
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  let parseErrorCount = 0;
  const records: CodexRecord[] = [];
  let firstValidRecord: CodexRecord | undefined;

  for (const line of lines) {
    const record = safeJsonParse<CodexRecord>(line);
    if (!record) {
      parseErrorCount += 1;
      continue;
    }
    firstValidRecord ??= record;
    records.push(record);
  }

  if (!firstValidRecord) {
    return { matched: false, parseErrorCount: 0 };
  }

  const metadata = firstValidRecord;
  const workspacePath = metadata?.payload?.cwd ?? metadata?.cwd;
  if (!workspacePath) {
    return { matched: false, parseErrorCount: 0 };
  }

  let userTurnCount = 0;
  let assistantTurnCount = 0;
  let toolUseCount = 0;
  let startedAt = Number.POSITIVE_INFINITY;
  let lastActiveAt = 0;
  let hasExplicitTimestamp = false;
  const excerpts: WorkLogEvidenceExcerpt[] = [];
  const events: WorkLogEvent[] = [];
  const recentCommandEvents = new Map<string, number | undefined>();
  const usageCalls: WorkLogUsageCall[] = [];
  let previousTotalUsage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };

  for (const record of records) {
    const type = `${record.type ?? ""}`.toLowerCase();
    const role = `${record.role ?? ""}`.toLowerCase();
    const event = `${record.event ?? record.payload?.type ?? ""}`.toLowerCase();
    const timestamp = parseOptionalTimestamp(record.timestamp);
    if (timestamp !== undefined) {
      hasExplicitTimestamp = true;
      startedAt = Math.min(startedAt, timestamp);
      lastActiveAt = Math.max(lastActiveAt, timestamp);
    }

    if (type === "event_msg" && event === "token_count") {
      const usage = normalizeUsage(
        takeCodexUsageDelta(record.payload, previousTotalUsage) ??
          takeLegacyCodexUsage(record.payload)
      );
      const totalTokenUsage = takeCodexTotalUsage(record.payload);
      if (totalTokenUsage) {
        previousTotalUsage = totalTokenUsage;
      }
      if (usage) {
        usageCalls.push({
          callId: `${metadata?.payload?.id ?? basename(filePath, ".jsonl")}:usage:${usageCalls.length}`,
          providerId: "codex",
          sessionId: metadata?.payload?.id ?? basename(filePath, ".jsonl"),
          workspacePath,
          occurredAt: timestamp,
          modelId: metadata?.payload?.model ?? metadata?.payload?.model_provider,
          kind: "token_count",
          usage,
          rawRefs: [filePath],
        });
      }
      events.push({
        eventId: `usage-${events.length}`,
        providerId: "codex",
        sessionId: metadata?.payload?.id ?? basename(filePath, ".jsonl"),
        workspacePath,
        eventType: "usage",
        canonicalEventType: "usage",
        occurredAt: timestamp,
        timestampQuality: timestamp !== undefined ? "explicit" : "inferred",
        modelId: metadata?.payload?.model ?? metadata?.payload?.model_provider,
        ...(usage ? { tokenUsage: usage } : {}),
        rawRefs: [filePath],
      });
    }

    if (type.includes("user") || role.includes("user")) {
      userTurnCount += 1;
      const text = takeText(record.payload?.text);
      pushExcerpt(excerpts, {
        role: "user",
        at: timestamp,
        text,
      });
      events.push({
        eventId: `message-${events.length}`,
        providerId: "codex",
        sessionId: metadata?.payload?.id ?? basename(filePath, ".jsonl"),
        workspacePath,
        eventType: "message",
        canonicalEventType: "message_turn",
        occurredAt: timestamp,
        timestampQuality: timestamp !== undefined ? "explicit" : "inferred",
        role: "user",
        text,
        modelId: metadata?.payload?.model ?? metadata?.payload?.model_provider,
        rawRefs: [filePath],
      });
      continue;
    }

    if (
      type.includes("assistant") ||
      type.includes("agent_message") ||
      role.includes("assistant")
    ) {
      assistantTurnCount += 1;
      const text = takeText(record.payload?.text);
      pushExcerpt(excerpts, {
        role: "assistant",
        at: timestamp,
        text,
      });
      events.push({
        eventId: `message-${events.length}`,
        providerId: "codex",
        sessionId: metadata?.payload?.id ?? basename(filePath, ".jsonl"),
        workspacePath,
        eventType: "message",
        canonicalEventType: "message_turn",
        occurredAt: timestamp,
        timestampQuality: timestamp !== undefined ? "explicit" : "inferred",
        role: "assistant",
        text,
        modelId: metadata?.payload?.model ?? metadata?.payload?.model_provider,
        rawRefs: [filePath],
      });
      continue;
    }

    const toolEvents = extractCodexToolEvents({
      record,
      sessionId: metadata?.payload?.id ?? basename(filePath, ".jsonl"),
      workspacePath,
      timestamp,
      modelId: metadata?.payload?.model ?? metadata?.payload?.model_provider,
      sourceRef: filePath,
      eventStartIndex: events.length,
      recentCommandEvents,
    });
    if (toolEvents.length > 0) {
      toolUseCount += toolEvents.length;
      for (const toolEvent of toolEvents) {
        pushExcerpt(excerpts, {
          role: "tool",
          at: timestamp,
          ...(toolEvent.toolName ? { toolName: toolEvent.toolName } : {}),
          ...(toolEvent.commandKind ? { commandKind: toolEvent.commandKind } : {}),
          ...(toolEvent.filePath ? { filePath: toolEvent.filePath } : {}),
          ...(toolEvent.commandText ? { text: toolEvent.commandText } : {}),
        });
      }
      events.push(...toolEvents);
    }
  }

  if (!hasExplicitTimestamp) {
    startedAt = fileMtimeMs;
    lastActiveAt = fileMtimeMs;
  }

  if (!isWithinRange(startedAt, lastActiveAt, input.timeRange)) {
    return { matched: true, parseErrorCount };
  }

  const sessionUsage = sumUsageCalls(usageCalls);
  const usageCoverage = buildUsageCoverage(usageCalls);
  return {
    matched: true,
    parseErrorCount,
    session: {
      providerId: "codex",
      sessionId: metadata?.payload?.id ?? basename(filePath, ".jsonl"),
      workspacePath,
      startedAt,
      lastActiveAt,
      sourceRef: filePath,
      modelId: metadata?.payload?.model ?? metadata?.payload?.model_provider,
      gitBranch: metadata?.payload?.git?.branch,
      gitCommit: metadata?.payload?.git?.commit_hash,
      userTurnCount,
      assistantTurnCount,
      toolUseCount,
      ...(sessionUsage ? { usage: sessionUsage } : {}),
      ...(usageCalls.length > 0 ? { usageCalls } : {}),
      ...(usageCoverage ? { usageCoverage } : {}),
      parseErrorCount,
      timestampQuality: hasExplicitTimestamp ? "explicit" : "file_mtime",
      evidence: [
        {
          providerId: "codex",
          sessionId: metadata?.payload?.id ?? basename(filePath, ".jsonl"),
          workspacePath,
          startedAt,
          lastActiveAt,
          excerpts,
        },
      ],
      ...(events.length > 0 ? { events: sortEvents(events) } : {}),
    },
  };
}

function takeLegacyCodexUsage(payload: CodexRecord["payload"]) {
  return {
    inputTokens: payload?.input_tokens,
    cachedInputTokens: payload?.cached_input_tokens,
    outputTokens: payload?.output_tokens,
    reasoningOutputTokens: payload?.reasoning_output_tokens,
    totalTokens: payload?.total_tokens,
  };
}

function takeCodexUsageDelta(
  payload: CodexRecord["payload"],
  previousTotalUsage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
  }
) {
  const last = payload?.info?.last_token_usage;
  if (last) {
    return {
      inputTokens: last.input_tokens,
      cachedInputTokens: last.cached_input_tokens,
      outputTokens: last.output_tokens,
      reasoningOutputTokens: last.reasoning_output_tokens,
      totalTokens: last.total_tokens,
    };
  }

  const total = takeCodexTotalUsage(payload);
  if (!total) {
    return undefined;
  }

  return {
    inputTokens: Math.max(0, total.inputTokens - previousTotalUsage.inputTokens),
    cachedInputTokens: Math.max(0, total.cachedInputTokens - previousTotalUsage.cachedInputTokens),
    outputTokens: Math.max(0, total.outputTokens - previousTotalUsage.outputTokens),
    reasoningOutputTokens: Math.max(
      0,
      total.reasoningOutputTokens - previousTotalUsage.reasoningOutputTokens
    ),
    totalTokens: Math.max(0, total.totalTokens - previousTotalUsage.totalTokens),
  };
}

function takeCodexTotalUsage(payload: CodexRecord["payload"]) {
  const total = payload?.info?.total_token_usage;
  if (!total) {
    return undefined;
  }

  return {
    inputTokens: typeof total.input_tokens === "number" ? total.input_tokens : 0,
    cachedInputTokens:
      typeof total.cached_input_tokens === "number" ? total.cached_input_tokens : 0,
    outputTokens: typeof total.output_tokens === "number" ? total.output_tokens : 0,
    reasoningOutputTokens:
      typeof total.reasoning_output_tokens === "number" ? total.reasoning_output_tokens : 0,
    totalTokens: typeof total.total_tokens === "number" ? total.total_tokens : 0,
  };
}

async function collectFiles(root: string, extension: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath, extension)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(entryPath);
    }
  }
  return files;
}

function buildEmptyDiscovery(
  providerId: ProviderWorkLogDiscovery["providerId"],
  status: ProviderWorkLogDiscovery["status"]
): ProviderWorkLogDiscovery {
  return {
    providerId,
    status,
    sessions: [],
    sourceRefs: [],
    parseErrorCount: 0,
    warnings: [],
  };
}

function takeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, 240)
    : undefined;
}

function takeCommandTextFromArguments(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  const parsed = safeJsonParse<Record<string, unknown>>(value);
  return takeText(parsed?.cmd) ?? takeText(parsed?.command) ?? takeText(parsed?.query);
}

function takeFilePathFromArguments(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  const parsed = safeJsonParse<Record<string, unknown>>(value);
  return takeFilePath(parsed);
}

function takeFilePath(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const direct =
    Reflect.get(value, "file_path") ?? Reflect.get(value, "filePath") ?? Reflect.get(value, "path");
  return typeof direct === "string" && direct.trim().length > 0 ? direct.trim() : undefined;
}

function takePatchFilePath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  const match = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/m.exec(value);
  return match?.[1]?.trim() || undefined;
}

function normalizeCodexToolName(rawToolName: string | undefined): NormalizedCodexTool {
  const toolName = rawToolName?.trim();
  const lower = toolName?.toLowerCase();

  if (!toolName || !lower) {
    return {
      eventType: "tool",
      canonicalEventType: "tool_call",
    };
  }

  if (
    lower === "shell" ||
    lower === "bash" ||
    lower === "command" ||
    lower === "exec" ||
    lower === "exec_command"
  ) {
    return {
      toolName: "Bash",
      toolCategory: "bash",
      eventType: "command",
      canonicalEventType: "command",
      commandKind: "bash",
    };
  }

  if (lower === "apply_patch" || lower === "edit_file" || lower === "edit" || lower === "patch") {
    return {
      toolName: "Edit",
      toolCategory: "edit",
      eventType: "edit",
      canonicalEventType: "edit",
    };
  }

  if (lower === "write") {
    return {
      toolName: "Write",
      toolCategory: "edit",
      eventType: "edit",
      canonicalEventType: "edit",
    };
  }

  if (lower === "read") {
    return {
      toolName: "Read",
      toolCategory: "read",
      eventType: "tool",
      canonicalEventType: "tool_call",
    };
  }

  if (lower === "grep") {
    return {
      toolName: "Grep",
      toolCategory: "read",
      eventType: "tool",
      canonicalEventType: "tool_call",
    };
  }

  if (lower === "glob") {
    return {
      toolName: "Glob",
      toolCategory: "read",
      eventType: "tool",
      canonicalEventType: "tool_call",
    };
  }

  if (lower === "todowrite") {
    return {
      toolName: "TodoWrite",
      toolCategory: "task",
      eventType: "plan",
      canonicalEventType: "plan",
    };
  }

  if (lower === "toolsearch") {
    return {
      toolName: "ToolSearch",
      toolCategory: "search",
      eventType: "tool",
      canonicalEventType: "tool_call",
    };
  }

  if (lower === "websearch") {
    return {
      toolName: "WebSearch",
      toolCategory: "search",
      eventType: "tool",
      canonicalEventType: "tool_call",
    };
  }

  if (lower === "webfetch") {
    return {
      toolName: "WebFetch",
      toolCategory: "search",
      eventType: "tool",
      canonicalEventType: "tool_call",
    };
  }

  if (lower === "skill") {
    return {
      toolName: "Skill",
      toolCategory: "skill",
      eventType: "tool",
      canonicalEventType: "tool_call",
    };
  }

  if (lower.startsWith("mcp__")) {
    return {
      toolName,
      toolCategory: "mcp",
      eventType: "tool",
      canonicalEventType: "tool_call",
    };
  }

  return {
    toolName,
    toolCategory: "other",
    eventType: "tool",
    canonicalEventType: "tool_call",
  };
}

function extractCodexToolEvents(input: {
  record: CodexRecord;
  sessionId: string;
  workspacePath: string;
  timestamp?: number;
  modelId?: string;
  sourceRef: string;
  eventStartIndex: number;
  recentCommandEvents: Map<string, number | undefined>;
}): WorkLogEvent[] {
  const events: WorkLogEvent[] = [];
  const parsedCommands = Array.isArray(input.record.payload?.parsed_cmd)
    ? input.record.payload.parsed_cmd
    : [];

  for (const parsedCommand of parsedCommands) {
    const event = createCodexToolEvent({
      sessionId: input.sessionId,
      workspacePath: input.workspacePath,
      timestamp: input.timestamp,
      modelId: input.modelId,
      sourceRef: input.sourceRef,
      toolName:
        typeof parsedCommand?.type === "string"
          ? parsedCommand.type
          : typeof parsedCommand?.name === "string"
            ? parsedCommand.name
            : undefined,
      commandText: takeText(parsedCommand?.cmd),
      filePath: takeFilePath(parsedCommand),
      eventIndex: input.eventStartIndex + events.length,
    });
    if (event && shouldIncludeCodexToolEvent(input.recentCommandEvents, event)) {
      events.push(event);
    }
  }

  const payloadToolName =
    typeof input.record.payload?.name === "string" ? input.record.payload.name : undefined;
  if (payloadToolName) {
    const event = createCodexToolEvent({
      sessionId: input.sessionId,
      workspacePath: input.workspacePath,
      timestamp: input.timestamp,
      modelId: input.modelId,
      sourceRef: input.sourceRef,
      toolName: payloadToolName,
      commandText:
        takeText(input.record.payload?.text) ??
        takeText(input.record.payload?.input) ??
        takeText(
          input.record.payload?.input && typeof input.record.payload.input === "object"
            ? Reflect.get(input.record.payload.input, "cmd")
            : undefined
        ) ??
        takeCommandTextFromArguments(input.record.payload?.arguments),
      filePath:
        takeFilePath(input.record.payload) ??
        takeFilePath(input.record.payload?.input) ??
        takePatchFilePath(input.record.payload?.input) ??
        takeFilePathFromArguments(input.record.payload?.arguments) ??
        takePatchFilePath(input.record.payload?.arguments),
      payload: buildCodexToolPayload(input.record.payload),
      eventIndex: input.eventStartIndex + events.length,
    });
    if (event && shouldIncludeCodexToolEvent(input.recentCommandEvents, event)) {
      events.push(event);
    }
  }

  return events;
}

function createCodexToolEvent(input: {
  sessionId: string;
  workspacePath: string;
  timestamp?: number;
  modelId?: string;
  sourceRef: string;
  toolName?: string;
  commandText?: string;
  filePath?: string;
  payload?: Record<string, unknown>;
  eventIndex: number;
}): WorkLogEvent | null {
  const normalized = normalizeCodexToolName(input.toolName);
  if (!normalized.toolName && !input.commandText && !input.filePath) {
    return null;
  }
  const skillPayload = normalized.toolCategory === "skill" ? input.payload : undefined;
  const skillName = skillPayload ? extractSkillNameFromPayload(skillPayload) : undefined;

  return {
    eventId: `tool-${input.eventIndex}`,
    providerId: "codex",
    sessionId: input.sessionId,
    workspacePath: input.workspacePath,
    eventType: normalized.eventType,
    canonicalEventType: normalized.canonicalEventType,
    occurredAt: input.timestamp,
    timestampQuality: input.timestamp !== undefined ? "explicit" : "inferred",
    role: "tool",
    ...(normalized.toolName ? { toolName: normalized.toolName } : {}),
    ...(normalized.toolCategory ? { toolCategory: normalized.toolCategory } : {}),
    ...(input.commandText ? { commandText: input.commandText } : {}),
    ...(normalized.commandKind ? { commandKind: normalized.commandKind } : {}),
    ...(input.filePath ? { filePath: input.filePath } : {}),
    ...(skillPayload ? { payload: skillPayload } : {}),
    ...(skillName ? { skillName } : {}),
    ...(input.modelId ? { modelId: input.modelId } : {}),
    rawRefs: [input.sourceRef],
  };
}

function buildCodexToolPayload(
  payload: CodexRecord["payload"]
): Record<string, unknown> | undefined {
  const toolPayload: Record<string, unknown> = {};
  if (payload?.input !== undefined) {
    toolPayload.input = payload.input;
  }
  if (payload?.arguments !== undefined) {
    toolPayload.arguments = payload.arguments;
  }

  return Object.keys(toolPayload).length > 0 ? toolPayload : undefined;
}

function shouldIncludeCodexToolEvent(
  recentCommandEvents: Map<string, number | undefined>,
  event: WorkLogEvent
): boolean {
  if (event.eventType !== "command") {
    return true;
  }

  const key = [event.toolName ?? "", event.commandText ?? ""].join("\u0000");
  if (key.trim().length === 0) {
    return true;
  }

  const lastSeenAt = recentCommandEvents.get(key);
  if (lastSeenAt !== undefined) {
    if (typeof event.occurredAt !== "number" || typeof lastSeenAt !== "number") {
      return false;
    }
    if (Math.abs(event.occurredAt - lastSeenAt) <= 2_000) {
      return false;
    }
  }

  recentCommandEvents.set(key, event.occurredAt);
  return true;
}

function pushExcerpt(target: WorkLogEvidenceExcerpt[], excerpt: WorkLogEvidenceExcerpt) {
  if (target.length >= 3) {
    return;
  }
  if (!excerpt.text && !excerpt.toolName) {
    return;
  }
  target.push(excerpt);
}

function sortEvents(events: WorkLogEvent[]): WorkLogEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const leftAt = left.event.occurredAt ?? Number.MAX_SAFE_INTEGER;
      const rightAt = right.event.occurredAt ?? Number.MAX_SAFE_INTEGER;
      if (leftAt !== rightAt) {
        return leftAt - rightAt;
      }
      return left.index - right.index;
    })
    .map(({ event }) => event);
}
