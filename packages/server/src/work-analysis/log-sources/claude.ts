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
  ProviderWorkLogDiscovery,
  ProviderWorkLogSource,
  WorkLogEvent,
  WorkLogSession,
  WorkLogSourceRef,
  WorkLogUsageCall,
} from "./types.js";

interface ClaudeRecord {
  type?: string;
  role?: string;
  timestamp?: string | number;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  gitCommit?: string;
  toolUse?: unknown;
  attachment?: unknown;
  tool?: unknown;
  message?: {
    role?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    content?: ClaudeMessageContentPart[] | unknown;
  };
}

interface ClaudeMessageContentPart {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
}

interface NormalizedClaudeTool {
  toolName?: string;
  toolCategory?: WorkLogEvent["toolCategory"];
  eventType: WorkLogEvent["eventType"];
  canonicalEventType: WorkLogEvent["canonicalEventType"];
  commandKind?: string;
}

export function createClaudeWorkLogSource(options: { home?: string } = {}): ProviderWorkLogSource {
  return {
    providerId: "claude",
    async discover(input) {
      const root = resolveHomePath("~/.claude/projects", options.home);
      const sourceRefs: WorkLogSourceRef[] = [];
      const sessions: WorkLogSession[] = [];
      const warnings: ProviderWorkLogDiscovery["warnings"] = [];
      let parseErrorCount = 0;
      const rootStat = await stat(root).catch(() => undefined);
      if (!rootStat?.isDirectory()) {
        return {
          providerId: "claude",
          status: "missing_root",
          sessions: [],
          sourceRefs: [],
          parseErrorCount: 0,
          warnings: [],
        };
      }

      const projectDirs = await readdir(root, { withFileTypes: true }).catch(() => []);
      for (const projectDir of projectDirs) {
        if (!projectDir.isDirectory()) {
          continue;
        }

        const dir = join(root, projectDir.name);
        const filePaths = await collectClaudeJsonlFiles(dir);
        for (const filePath of filePaths) {
          const fileStat = await stat(filePath).catch(() => undefined);
          if (!fileStat?.isFile()) {
            continue;
          }
          sourceRefs.push({
            providerId: "claude",
            kind: "file",
            path: filePath,
            mtimeMs: fileStat.mtimeMs,
            sizeBytes: fileStat.size,
          });

          const parsed = await parseClaudeSessions(filePath, fileStat.mtimeMs, input.timeRange);
          parseErrorCount += parsed.parseErrorCount;
          if (parsed.parseErrorCount > 0) {
            warnings.push({
              code: "parse_error",
              message: `Failed to parse ${parsed.parseErrorCount} line(s) from Claude log`,
              sourceRef: filePath,
            });
          }
          sessions.push(...parsed.sessions);
        }
      }

      return {
        providerId: "claude",
        status: sessions.length === 0 ? "no_logs" : parseErrorCount > 0 ? "partial" : "supported",
        sessions,
        sourceRefs,
        parseErrorCount,
        warnings,
      };
    },
  };
}

async function collectClaudeJsonlFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectClaudeJsonlFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(entryPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

async function parseClaudeSessions(
  filePath: string,
  fileMtimeMs: number,
  timeRange: { startAt: number; endAt: number }
): Promise<{ sessions: WorkLogSession[]; parseErrorCount: number }> {
  const content = await readFile(filePath, "utf8").catch(() => "");
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  const grouped = new Map<string, ClaudeRecord[]>();
  let parseErrorCount = 0;

  for (const line of lines) {
    const record = safeJsonParse<ClaudeRecord>(line);
    if (!record) {
      parseErrorCount += 1;
      continue;
    }
    const sessionId = record.sessionId ?? basename(filePath, ".jsonl");
    const bucket = grouped.get(sessionId) ?? [];
    bucket.push(record);
    grouped.set(sessionId, bucket);
  }

  const sessions: WorkLogSession[] = [];
  for (const [sessionId, records] of grouped) {
    const workspacePath = records.find(
      (record) => typeof record.cwd === "string" && record.cwd.length > 0
    )?.cwd;
    if (!workspacePath) {
      continue;
    }

    let userTurnCount = 0;
    let assistantTurnCount = 0;
    let toolUseCount = 0;
    let startedAt = Number.POSITIVE_INFINITY;
    let lastActiveAt = 0;
    let hasExplicitTimestamp = false;
    let gitBranch: string | undefined;
    let gitCommit: string | undefined;
    let modelId: string | undefined;
    const usageCalls: WorkLogUsageCall[] = [];
    const events: WorkLogEvent[] = [];

    for (const record of records) {
      const timestamp = parseOptionalTimestamp(record.timestamp);
      if (timestamp !== undefined) {
        hasExplicitTimestamp = true;
        startedAt = Math.min(startedAt, timestamp);
        lastActiveAt = Math.max(lastActiveAt, timestamp);
      }
      const role = `${record.type ?? record.role ?? record.message?.role ?? ""}`.toLowerCase();
      if (role.includes("user")) {
        userTurnCount += 1;
        const text = takeClaudeText(record.message?.content);
        events.push({
          eventId: `message-${events.length}`,
          providerId: "claude",
          sessionId,
          workspacePath,
          eventType: "message",
          canonicalEventType: "message_turn",
          occurredAt: timestamp,
          timestampQuality: timestamp !== undefined ? "explicit" : "inferred",
          role: "user",
          text,
          modelId: record.message?.model,
          rawRefs: [filePath],
        });
      } else if (role.includes("assistant")) {
        assistantTurnCount += 1;
        const text = takeClaudeText(record.message?.content);
        events.push({
          eventId: `message-${events.length}`,
          providerId: "claude",
          sessionId,
          workspacePath,
          eventType: "message",
          canonicalEventType: "message_turn",
          occurredAt: timestamp,
          timestampQuality: timestamp !== undefined ? "explicit" : "inferred",
          role: "assistant",
          text,
          modelId: record.message?.model,
          rawRefs: [filePath],
        });
      }
      const toolEvents = extractClaudeToolEvents({
        record,
        sessionId,
        workspacePath,
        timestamp,
        modelId: record.message?.model,
        sourceRef: filePath,
        eventStartIndex: events.length,
      });
      if (toolEvents.length > 0) {
        toolUseCount += toolEvents.length;
        events.push(...toolEvents);
      }
      gitBranch ??= record.gitBranch;
      gitCommit ??= record.gitCommit;
      modelId ??= record.message?.model;
      const contentParts = Array.isArray(record.message?.content) ? record.message.content : [];
      const reasoningOutputTokens = contentParts.some(
        (part) => `${part?.type ?? ""}`.toLowerCase() === "thinking"
      )
        ? 0
        : undefined;
      if (contentParts.some((part) => `${part?.type ?? ""}`.toLowerCase() === "thinking")) {
        // Keep the signal that Claude exposed hidden reasoning content, even though
        // the local journal does not provide a reasoning token count.
      }
      if (record.message?.usage) {
        const usage = normalizeUsage({
          inputTokens: record.message.usage.input_tokens,
          outputTokens: record.message.usage.output_tokens,
          cacheCreationInputTokens: record.message.usage.cache_creation_input_tokens,
          cacheReadInputTokens: record.message.usage.cache_read_input_tokens,
          ...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
        });
        if (usage) {
          usageCalls.push({
            callId: `${sessionId}:usage:${usageCalls.length}`,
            providerId: "claude",
            sessionId,
            workspacePath,
            occurredAt: timestamp,
            modelId: record.message?.model,
            kind: "assistant_message",
            usage,
            rawRefs: [filePath],
          });
        }
        events.push({
          eventId: `usage-${events.length}`,
          providerId: "claude",
          sessionId,
          workspacePath,
          eventType: "usage",
          canonicalEventType: "usage",
          occurredAt: timestamp,
          timestampQuality: timestamp !== undefined ? "explicit" : "inferred",
          role: role.includes("assistant")
            ? "assistant"
            : role.includes("user")
              ? "user"
              : "unknown",
          modelId: record.message?.model,
          ...(usage ? { tokenUsage: usage } : {}),
          rawRefs: [filePath],
        });
      }
    }

    if (!hasExplicitTimestamp) {
      startedAt = fileMtimeMs;
      lastActiveAt = fileMtimeMs;
    }
    if (!isWithinRange(startedAt, lastActiveAt, timeRange)) {
      continue;
    }

    const sessionUsage = sumUsageCalls(usageCalls);
    const usageCoverage = buildUsageCoverage(usageCalls);
    sessions.push({
      providerId: "claude",
      sessionId,
      workspacePath,
      startedAt,
      lastActiveAt,
      sourceRef: filePath,
      modelId,
      gitBranch,
      gitCommit,
      userTurnCount,
      assistantTurnCount,
      toolUseCount,
      ...(sessionUsage ? { usage: sessionUsage } : {}),
      ...(usageCalls.length > 0 ? { usageCalls } : {}),
      ...(usageCoverage ? { usageCoverage } : {}),
      parseErrorCount: 0,
      timestampQuality: hasExplicitTimestamp ? "explicit" : "file_mtime",
      ...(events.length > 0 ? { events: sortEvents(events) } : {}),
    });
  }

  return { sessions, parseErrorCount };
}

function takeClaudeText(
  content: ClaudeRecord["message"] extends { content?: infer T } ? T : unknown
) {
  if (!Array.isArray(content)) {
    return undefined;
  }
  const text = content
    .map((part) => (typeof part?.text === "string" ? part.text.trim() : ""))
    .filter((value) => value.length > 0)
    .join("\n")
    .trim();
  return text.length > 0 ? text.slice(0, 240) : undefined;
}

function takeToolName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const name = Reflect.get(value, "name");
  return typeof name === "string" && name.trim().length > 0 ? name.trim() : undefined;
}

function takeCommandText(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const direct =
    Reflect.get(value, "command") ??
    Reflect.get(value, "text") ??
    Reflect.get(value, "input") ??
    Reflect.get(value, "query");
  return typeof direct === "string" && direct.trim().length > 0
    ? direct.trim().slice(0, 240)
    : undefined;
}

function takeFilePath(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const direct =
    Reflect.get(value, "file_path") ??
    Reflect.get(value, "filePath") ??
    Reflect.get(value, "path") ??
    Reflect.get(value, "target_file") ??
    Reflect.get(value, "targetFile");
  return typeof direct === "string" && direct.trim().length > 0 ? direct.trim() : undefined;
}

function normalizeClaudeToolName(rawToolName: string | undefined): NormalizedClaudeTool {
  const toolName = rawToolName?.trim();
  const lower = toolName?.toLowerCase();

  if (!toolName || !lower) {
    return {
      eventType: "tool",
      canonicalEventType: "tool_call",
    };
  }

  if (lower === "shell" || lower === "bash" || lower === "command") {
    return {
      toolName: "Bash",
      toolCategory: "bash",
      eventType: "command",
      canonicalEventType: "command",
      commandKind: "bash",
    };
  }

  if (lower === "edit" || lower === "apply_patch" || lower === "edit_file") {
    return {
      toolName: "Edit",
      toolCategory: "edit",
      eventType: "edit",
      canonicalEventType: "edit",
    };
  }

  if (lower === "write" || lower === "filewritetool") {
    return {
      toolName: "Write",
      toolCategory: "edit",
      eventType: "edit",
      canonicalEventType: "edit",
    };
  }

  if (lower === "read" || lower === "filereadtool") {
    return {
      toolName: "Read",
      toolCategory: "read",
      eventType: "tool",
      canonicalEventType: "tool_call",
    };
  }

  if (lower === "grep" || lower === "greptool") {
    return {
      toolName: "Grep",
      toolCategory: "read",
      eventType: "tool",
      canonicalEventType: "tool_call",
    };
  }

  if (lower === "glob" || lower === "globtool") {
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

  if (
    lower === "taskcreate" ||
    lower === "taskupdate" ||
    lower === "taskget" ||
    lower === "tasklist" ||
    lower === "taskoutput" ||
    lower === "taskstop"
  ) {
    return {
      toolName,
      toolCategory: "task",
      eventType: "plan",
      canonicalEventType: "plan",
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

  if (lower === "toolsearch") {
    return {
      toolName: "ToolSearch",
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

function extractClaudeToolEvents(input: {
  record: ClaudeRecord;
  sessionId: string;
  workspacePath: string;
  timestamp?: number;
  modelId?: string;
  sourceRef: string;
  eventStartIndex: number;
}): WorkLogEvent[] {
  const events: WorkLogEvent[] = [];
  const directTools = [input.record.toolUse, input.record.tool];
  for (const value of directTools) {
    const event = createClaudeToolEvent({
      sessionId: input.sessionId,
      workspacePath: input.workspacePath,
      timestamp: input.timestamp,
      modelId: input.modelId,
      sourceRef: input.sourceRef,
      toolName: takeToolName(value),
      commandText: takeCommandText(value) ?? takeCommandText(Reflect.get(value ?? {}, "input")),
      filePath: takeFilePath(value) ?? takeFilePath(Reflect.get(value ?? {}, "input")),
      payload: buildClaudeToolPayload(value),
      eventIndex: input.eventStartIndex + events.length,
    });
    if (event) {
      events.push(event);
    }
  }

  const contentParts = Array.isArray(input.record.message?.content)
    ? input.record.message.content
    : [];
  for (const part of contentParts) {
    if (`${part?.type ?? ""}`.toLowerCase() !== "tool_use") {
      continue;
    }
    const event = createClaudeToolEvent({
      sessionId: input.sessionId,
      workspacePath: input.workspacePath,
      timestamp: input.timestamp,
      modelId: input.modelId,
      sourceRef: input.sourceRef,
      toolName: typeof part?.name === "string" ? part.name : undefined,
      commandText: takeCommandText(part?.input),
      filePath: takeFilePath(part?.input),
      payload: buildClaudeToolPayload(part),
      eventIndex: input.eventStartIndex + events.length,
    });
    if (event) {
      events.push(event);
    }
  }

  return events;
}

function createClaudeToolEvent(input: {
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
  const normalized = normalizeClaudeToolName(input.toolName);
  if (!normalized.toolName && !input.commandText && !input.filePath) {
    return null;
  }
  const skillPayload = normalized.toolCategory === "skill" ? input.payload : undefined;
  const skillName = skillPayload ? extractSkillNameFromPayload(skillPayload) : undefined;

  return {
    eventId: `tool-${input.eventIndex}`,
    providerId: "claude",
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

function buildClaudeToolPayload(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const input = Reflect.get(value, "input");
  if (input === undefined) {
    return undefined;
  }

  return { input };
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
