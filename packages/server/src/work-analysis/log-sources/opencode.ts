import { stat } from "node:fs/promises";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { buildUsageCoverage, normalizeUsage, sumUsageCalls } from "../usage-rollup.js";
import { resolveHomePath } from "./path-encoding.js";
import type {
  ProviderWorkLogDiscovery,
  ProviderWorkLogSource,
  WorkLogEvent,
  WorkLogSession,
  WorkLogSourceRef,
  WorkLogUsage,
  WorkLogUsageCall,
} from "./types.js";

interface OpenCodeRow {
  sessionId?: string;
  worktree?: string;
  directory?: string;
  title?: string;
  version?: string;
  modelId?: string;
  cost?: number | string | null;
  tokensInput?: number | string | null;
  tokensOutput?: number | string | null;
  tokensReasoning?: number | string | null;
  tokensCacheRead?: number | string | null;
  tokensCacheWrite?: number | string | null;
  summaryFiles?: number | string | null;
  summaryAdditions?: number | string | null;
  summaryDeletions?: number | string | null;
  startedAt?: number | string;
  lastActiveAt?: number | string;
  userTurnCount?: number | string;
  assistantTurnCount?: number | string;
  toolUseCount?: number | string;
}

interface OpenCodeMessageRow {
  messageId?: string;
  sessionId?: string;
  createdAt?: number | string;
  data?: string | Uint8Array | null;
}

interface OpenCodePartRow {
  messageId?: string;
  data?: string | Uint8Array | null;
}

interface OpenCodeMessageData {
  role?: string;
  model?: string;
  modelID?: string;
  cost?: number;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: {
      read?: number;
      write?: number;
    };
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface OpenCodePartData {
  type?: string;
  tool?: string;
}

interface OpenCodeDatabase {
  query<T = Record<string, unknown>>(sql: string, params?: SQLInputValue[]): T[];
  close(): void;
}

export function createOpenCodeWorkLogSource(
  options: { home?: string } = {}
): ProviderWorkLogSource {
  return {
    providerId: "opencode",
    async discover(input) {
      const dbPath = resolveHomePath("~/.local/share/opencode/opencode.db", options.home);
      const dbStat = await stat(dbPath).catch(() => undefined);
      if (!dbStat?.isFile()) {
        return buildDiscovery("opencode", "missing_root", [], [], 0, []);
      }

      const sourceRef: WorkLogSourceRef = {
        providerId: "opencode",
        kind: "sqlite",
        path: dbPath,
        mtimeMs: dbStat.mtimeMs,
        sizeBytes: dbStat.size,
      };

      let db: OpenCodeDatabase | undefined;
      try {
        db = openOpenCodeDatabase(dbPath);
        validateOpenCodeSchema(db);
        const rows = querySessions(db, input.timeRange.startAt, input.timeRange.endAt);
        const sessions = rows
          .map((row) => toSession(row, db as OpenCodeDatabase, dbPath))
          .filter((session): session is WorkLogSession => session !== undefined);

        return buildDiscovery(
          "opencode",
          sessions.length === 0 ? "no_logs" : "supported",
          sessions,
          [sourceRef],
          0,
          []
        );
      } catch (error) {
        return buildDiscovery("opencode", "partial", [], [sourceRef], 0, [
          {
            code: "sqlite_query_failed",
            message:
              error instanceof Error
                ? `Failed to query OpenCode SQLite database: ${error.message}`
                : "Failed to query OpenCode SQLite database",
            sourceRef: dbPath,
          },
        ]);
      } finally {
        db?.close();
      }
    },
  };
}

function openOpenCodeDatabase(dbPath: string): OpenCodeDatabase {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec("PRAGMA busy_timeout = 1000");
  return {
    close() {
      db.close();
    },
    query<T = Record<string, unknown>>(sql: string, params: SQLInputValue[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
  };
}

function validateOpenCodeSchema(db: OpenCodeDatabase) {
  const requiredTables = ["project", "session", "message", "part"];
  const missingTables = requiredTables.filter((tableName) => {
    try {
      db.query(`select 1 from ${tableName} limit 1`);
      return false;
    } catch {
      return true;
    }
  });

  if (missingTables.length > 0) {
    throw new Error(`OpenCode database is missing expected tables: ${missingTables.join(", ")}`);
  }
}

function querySessions(db: OpenCodeDatabase, startAt: number, endAt: number): OpenCodeRow[] {
  const sessionColumns = getTableColumns(db, "session");

  return db.query<OpenCodeRow>(
    `
select
  s.id as sessionId,
  p.worktree as worktree,
  s.directory as directory,
  s.title as title,
  s.version as version,
  ${optionalSessionColumn(sessionColumns, "model_id")} as modelId,
  ${optionalSessionColumn(sessionColumns, "cost")} as cost,
  ${optionalSessionColumn(sessionColumns, "tokens_input")} as tokensInput,
  ${optionalSessionColumn(sessionColumns, "tokens_output")} as tokensOutput,
  ${optionalSessionColumn(sessionColumns, "tokens_reasoning")} as tokensReasoning,
  ${optionalSessionColumn(sessionColumns, "tokens_cache_read")} as tokensCacheRead,
  ${optionalSessionColumn(sessionColumns, "tokens_cache_write")} as tokensCacheWrite,
  ${optionalSessionColumn(sessionColumns, "summary_files")} as summaryFiles,
  ${optionalSessionColumn(sessionColumns, "summary_additions")} as summaryAdditions,
  ${optionalSessionColumn(sessionColumns, "summary_deletions")} as summaryDeletions,
  s.time_created as startedAt,
  s.time_updated as lastActiveAt
from session s
join project p on p.id = s.project_id
where
  s.time_updated >= ?
  and s.time_created <= ?
order by s.time_updated asc;
`.trim(),
    [Math.trunc(startAt), Math.trunc(endAt)]
  );
}

function getTableColumns(db: OpenCodeDatabase, tableName: string) {
  return new Set(
    db
      .query<{ name?: string }>(`pragma table_info(${tableName})`)
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string")
  );
}

function optionalSessionColumn(columns: Set<string>, columnName: string) {
  return columns.has(columnName) ? `s.${columnName}` : "null";
}

function toSession(
  row: OpenCodeRow,
  db: OpenCodeDatabase,
  dbPath: string
): WorkLogSession | undefined {
  const workspacePath = takeString(row.worktree) ?? takeString(row.directory);
  const sessionId = takeString(row.sessionId);
  const startedAt = takeNumber(row.startedAt);
  const lastActiveAt = takeNumber(row.lastActiveAt);
  if (!workspacePath || !sessionId || startedAt === undefined || lastActiveAt === undefined) {
    return undefined;
  }
  const messages = queryMessages(db, sessionId);
  const partsByMessageId = queryPartsByMessageId(db, sessionId);
  const userTurnCount = countMessagesByRole(messages, ["user"]);
  const assistantTurnCount = countMessagesByRole(messages, ["assistant", "model"]);
  const toolUseCount = countToolParts(partsByMessageId);
  const messageUsageCalls = buildMessageUsageCalls({
    dbPath,
    messages,
    sessionId,
    workspacePath,
  });
  const sessionLevelUsage = buildSessionLevelUsageCall({
    dbPath,
    lastActiveAt,
    row,
    sessionId,
    workspacePath,
  });
  const usageCalls = messageUsageCalls.length > 0 ? messageUsageCalls : sessionLevelUsage;
  const sessionUsage = sumUsageCalls(usageCalls);
  const usageCoverage = buildUsageCoverage(usageCalls);
  const usageEvents = usageCalls.map((call, index): WorkLogEvent => {
    return {
      eventId: `usage-${index}`,
      providerId: "opencode",
      sessionId,
      workspacePath,
      eventType: "usage",
      canonicalEventType: "usage",
      occurredAt: call.occurredAt,
      timestampQuality: call.occurredAt !== undefined ? "explicit" : "inferred",
      role: "assistant",
      modelId: call.modelId,
      tokenUsage: call.usage,
      rawRefs: call.rawRefs,
    };
  });

  return {
    providerId: "opencode",
    sessionId,
    workspacePath,
    startedAt,
    lastActiveAt,
    sourceRef: dbPath,
    title: takeString(row.title),
    modelId:
      usageCalls.find((call) => call.modelId)?.modelId ??
      takeString(row.modelId) ??
      takeString(row.version),
    userTurnCount,
    assistantTurnCount,
    toolUseCount,
    ...(sessionUsage ? { usage: sessionUsage } : {}),
    ...(usageCalls.length > 0 ? { usageCalls } : {}),
    ...(usageCoverage ? { usageCoverage } : {}),
    parseErrorCount: 0,
    timestampQuality: "explicit",
    ...(usageEvents.length > 0 ? { events: usageEvents } : {}),
  };
}

function queryMessages(db: OpenCodeDatabase, sessionId: string): OpenCodeMessageRow[] {
  return db.query<OpenCodeMessageRow>(
    `
select
  id as messageId,
  session_id as sessionId,
  time_created as createdAt,
  cast(data as blob) as data
from message
where session_id = ?
order by time_created asc, id asc
`.trim(),
    [sessionId]
  );
}

function queryPartsByMessageId(
  db: OpenCodeDatabase,
  sessionId: string
): Map<string, OpenCodePartData[]> {
  const rows = db.query<OpenCodePartRow>(
    `
select
  message_id as messageId,
  cast(data as blob) as data
from part
where session_id = ?
order by message_id asc, id asc
`.trim(),
    [sessionId]
  );
  const partsByMessageId = new Map<string, OpenCodePartData[]>();
  for (const row of rows) {
    const messageId = takeString(row.messageId);
    const data = parseJsonObject<OpenCodePartData>(row.data);
    if (!messageId || !data) {
      continue;
    }
    const parts = partsByMessageId.get(messageId) ?? [];
    parts.push(data);
    partsByMessageId.set(messageId, parts);
  }
  return partsByMessageId;
}

function countMessagesByRole(messages: OpenCodeMessageRow[], roles: string[]) {
  const roleSet = new Set(roles);
  return messages.filter((message) => {
    const data = parseJsonObject<OpenCodeMessageData>(message.data);
    const role = typeof data?.role === "string" ? data.role.toLowerCase() : "";
    return roleSet.has(role);
  }).length;
}

function countToolParts(partsByMessageId: Map<string, OpenCodePartData[]>) {
  let count = 0;
  for (const parts of partsByMessageId.values()) {
    count += parts.filter((part) => {
      const type = `${part.type ?? ""}`.toLowerCase();
      return type === "tool" || type === "tool-call" || type === "tool_call";
    }).length;
  }
  return count;
}

function buildMessageUsageCalls({
  dbPath,
  messages,
  sessionId,
  workspacePath,
}: {
  readonly dbPath: string;
  readonly messages: OpenCodeMessageRow[];
  readonly sessionId: string;
  readonly workspacePath: string;
}) {
  const usageCalls: WorkLogUsageCall[] = [];
  for (const message of messages) {
    const data = parseJsonObject<OpenCodeMessageData>(message.data);
    const role = typeof data?.role === "string" ? data.role.toLowerCase() : "";
    if (role !== "assistant" && role !== "model") {
      continue;
    }
    const usage = normalizeUsage(takeMessageUsage(data));
    if (!usage) {
      continue;
    }
    usageCalls.push({
      callId: `${sessionId}:usage:${usageCalls.length}`,
      providerId: "opencode",
      sessionId,
      workspacePath,
      occurredAt: takeNumber(message.createdAt),
      modelId: takeString(data?.modelID) ?? takeString(data?.model),
      kind: "assistant_message",
      usage,
      rawRefs: [dbPath],
    });
  }
  return usageCalls;
}

function buildSessionLevelUsageCall({
  dbPath,
  lastActiveAt,
  row,
  sessionId,
  workspacePath,
}: {
  readonly dbPath: string;
  readonly lastActiveAt: number;
  readonly row: OpenCodeRow;
  readonly sessionId: string;
  readonly workspacePath: string;
}) {
  const usage = normalizeUsage({
    inputTokens: takeNumber(row.tokensInput),
    outputTokens: takeNumber(row.tokensOutput),
    cachedInputTokens: takeNumber(row.tokensCacheRead),
    cacheCreationInputTokens: takeNumber(row.tokensCacheWrite),
    cacheReadInputTokens: takeNumber(row.tokensCacheRead),
    reasoningOutputTokens: takeNumber(row.tokensReasoning),
    estimatedCostUsd: takeNumber(row.cost),
  });

  if (!usage) {
    return [];
  }

  return [
    {
      callId: `${sessionId}:usage:session-level`,
      providerId: "opencode",
      sessionId,
      workspacePath,
      occurredAt: lastActiveAt,
      modelId: takeString(row.modelId),
      kind: "assistant_message",
      usage,
      rawRefs: [dbPath],
    } satisfies WorkLogUsageCall,
  ];
}

function takeMessageUsage(data: OpenCodeMessageData | undefined): WorkLogUsage | undefined {
  if (!data) {
    return undefined;
  }

  return {
    inputTokens: data.tokens?.input ?? data.usage?.input_tokens,
    outputTokens: data.tokens?.output ?? data.usage?.output_tokens,
    cachedInputTokens: data.tokens?.cache?.read ?? data.usage?.cache_read_input_tokens,
    cacheCreationInputTokens: data.tokens?.cache?.write ?? data.usage?.cache_creation_input_tokens,
    cacheReadInputTokens: data.tokens?.cache?.read ?? data.usage?.cache_read_input_tokens,
    reasoningOutputTokens: data.tokens?.reasoning,
    estimatedCostUsd: data.cost,
  };
}

function parseJsonObject<T extends object>(value: unknown): T | undefined {
  const text = valueToText(value);
  if (!text) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as T) : undefined;
  } catch {
    return undefined;
  }
}

function valueToText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Uint8Array) {
    return new TextDecoder("utf-8", { fatal: false }).decode(value);
  }

  return undefined;
}

function takeString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function takeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : undefined;
  }
  return undefined;
}

function buildDiscovery(
  providerId: ProviderWorkLogDiscovery["providerId"],
  status: ProviderWorkLogDiscovery["status"],
  sessions: WorkLogSession[],
  sourceRefs: WorkLogSourceRef[],
  parseErrorCount: number,
  warnings: ProviderWorkLogDiscovery["warnings"]
): ProviderWorkLogDiscovery {
  return {
    providerId,
    status,
    sessions,
    sourceRefs,
    parseErrorCount,
    warnings,
  };
}
