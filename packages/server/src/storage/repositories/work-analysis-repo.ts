import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deserialize, serialize } from "node:v8";
import { compactWorkLogEventForHourlyIndex } from "../../work-analysis/hourly-index-events.js";
import type {
  WorkAnalysisDashboardProviderStatus,
  WorkAnalysisHourlyIndex,
  WorkAnalysisHourlyIndexSession,
  WorkAnalysisProviderWarning,
  WorkAnalysisRecord,
} from "../../work-analysis/types.js";
import { readJsonFile } from "./json-file-store.js";

interface WorkAnalysisFileRecord {
  version: 1;
  records: Record<string, WorkAnalysisRecord>;
  index?: WorkAnalysisHourlyIndex;
}

export interface WorkAnalysisRepoOptions {
  filePath: string;
  legacyJsonFilePath?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isTimeRange(value: unknown): value is WorkAnalysisRecord["timeRange"] {
  if (!isRecord(value)) {
    return false;
  }

  if ("preset" in value) {
    return (
      value.preset === "24h" ||
      value.preset === "7d" ||
      value.preset === "30d" ||
      value.preset === "90d"
    );
  }

  return typeof value.startAt === "number" && typeof value.endAt === "number";
}

function isStatus(value: unknown): value is WorkAnalysisRecord["basicStatus"] {
  return value === "idle" || value === "running" || value === "succeeded" || value === "failed";
}

function isSourceSnapshot(value: unknown): value is WorkAnalysisRecord["sourceSnapshot"] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.sourceDigest === "string" &&
    typeof value.collectedAt === "number" &&
    Array.isArray(value.providerStatuses) &&
    value.providerStatuses.every(
      (status) =>
        isRecord(status) &&
        typeof status.providerId === "string" &&
        typeof status.status === "string" &&
        typeof status.sessionCount === "number" &&
        typeof status.parseErrorCount === "number"
    )
  );
}

function isWorkAnalysisRecord(value: unknown): value is WorkAnalysisRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.queryDigest === "string" &&
    (value.workspacePaths === undefined || isStringArray(value.workspacePaths)) &&
    isTimeRange(value.timeRange) &&
    isStatus(value.basicStatus) &&
    isStatus(value.deepStatus) &&
    (value.requestedAt === undefined || typeof value.requestedAt === "number") &&
    (value.basicCompletedAt === undefined || typeof value.basicCompletedAt === "number") &&
    (value.deepCompletedAt === undefined || typeof value.deepCompletedAt === "number") &&
    (value.basicErrorMessage === undefined || typeof value.basicErrorMessage === "string") &&
    (value.deepErrorMessage === undefined || typeof value.deepErrorMessage === "string") &&
    (value.sourceSnapshot === undefined || isSourceSnapshot(value.sourceSnapshot))
  );
}

function isProviderWarning(value: unknown): value is WorkAnalysisProviderWarning {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    (value.sourceRef === undefined || typeof value.sourceRef === "string")
  );
}

function isProviderStatus(value: unknown): value is WorkAnalysisDashboardProviderStatus {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.providerId === "string" &&
    typeof value.status === "string" &&
    typeof value.sessionCount === "number" &&
    typeof value.parseErrorCount === "number" &&
    typeof value.warningCount === "number" &&
    (value.warnings === undefined ||
      (Array.isArray(value.warnings) && value.warnings.every(isProviderWarning)))
  );
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === "number";
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isUsage(value: unknown): value is WorkAnalysisHourlyIndexSession["usage"] {
  if (value === undefined) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }

  return (
    isOptionalNumber(value.inputTokens) &&
    isOptionalNumber(value.outputTokens) &&
    isOptionalNumber(value.cachedInputTokens) &&
    isOptionalNumber(value.cacheCreationInputTokens) &&
    isOptionalNumber(value.cacheReadInputTokens) &&
    isOptionalNumber(value.reasoningOutputTokens) &&
    isOptionalNumber(value.totalTokens) &&
    isOptionalNumber(value.estimatedCostUsd)
  );
}

function isUsageCoverage(value: unknown): value is WorkAnalysisHourlyIndexSession["usageCoverage"] {
  if (value === undefined) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.hasUsage === "boolean" &&
    typeof value.callCount === "number" &&
    typeof value.callsWithTotalTokens === "number" &&
    typeof value.estimatedCallCount === "number"
  );
}

function isTimestampQuality(
  value: unknown
): value is WorkAnalysisHourlyIndexSession["timestampQuality"] {
  return value === "explicit" || value === "file_mtime" || value === "mixed";
}

function isHourlyIndexEvent(
  value: unknown
): value is NonNullable<WorkAnalysisHourlyIndexSession["events"]>[number] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.eventId === "string" &&
    typeof value.providerId === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.workspacePath === "string" &&
    typeof value.eventType === "string" &&
    typeof value.canonicalEventType === "string" &&
    (value.occurredAt === undefined || typeof value.occurredAt === "number") &&
    isStringArray(value.rawRefs)
  );
}

function isHourlyIndexSession(value: unknown): value is WorkAnalysisHourlyIndexSession {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.providerId === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.workspacePath === "string" &&
    typeof value.startedAt === "number" &&
    typeof value.lastActiveAt === "number" &&
    typeof value.sourceRef === "string" &&
    isOptionalString(value.title) &&
    isOptionalString(value.modelId) &&
    isOptionalString(value.gitBranch) &&
    isOptionalString(value.gitCommit) &&
    typeof value.userTurnCount === "number" &&
    typeof value.assistantTurnCount === "number" &&
    typeof value.toolUseCount === "number" &&
    isUsage(value.usage) &&
    isUsageCoverage(value.usageCoverage) &&
    typeof value.parseErrorCount === "number" &&
    isTimestampQuality(value.timestampQuality) &&
    (value.events === undefined ||
      (Array.isArray(value.events) && value.events.every(isHourlyIndexEvent)))
  );
}

function isHourlyIndex(value: unknown): value is WorkAnalysisHourlyIndex {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.version === 1 &&
    (value.bucketMode === undefined || value.bucketMode === "hourly_session_slices") &&
    typeof value.indexedAt === "number" &&
    typeof value.indexedThroughHourStart === "number" &&
    typeof value.sourceDigest === "string" &&
    Array.isArray(value.providerStatuses) &&
    value.providerStatuses.every(isProviderStatus) &&
    Array.isArray(value.buckets) &&
    value.buckets.every(
      (bucket) =>
        isRecord(bucket) &&
        typeof bucket.hourStart === "number" &&
        Array.isArray(bucket.sessions) &&
        bucket.sessions.every(isHourlyIndexSession)
    )
  );
}

function normalizeProviderWarnings(warnings?: WorkAnalysisProviderWarning[]) {
  if (!warnings || warnings.length === 0) {
    return {};
  }

  return {
    warnings: warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
      ...(warning.sourceRef === undefined ? {} : { sourceRef: warning.sourceRef }),
    })),
  };
}

function normalizeRecord(record: WorkAnalysisRecord): WorkAnalysisRecord {
  return {
    id: record.id,
    queryDigest: record.queryDigest,
    ...(record.workspacePaths === undefined ? {} : { workspacePaths: [...record.workspacePaths] }),
    timeRange:
      "preset" in record.timeRange
        ? { preset: record.timeRange.preset }
        : { startAt: record.timeRange.startAt, endAt: record.timeRange.endAt },
    basicStatus: record.basicStatus,
    deepStatus: record.deepStatus,
    ...(record.requestedAt === undefined ? {} : { requestedAt: record.requestedAt }),
    ...(record.basicCompletedAt === undefined ? {} : { basicCompletedAt: record.basicCompletedAt }),
    ...(record.deepCompletedAt === undefined ? {} : { deepCompletedAt: record.deepCompletedAt }),
    ...(record.basicErrorMessage === undefined
      ? {}
      : { basicErrorMessage: record.basicErrorMessage }),
    ...(record.deepErrorMessage === undefined ? {} : { deepErrorMessage: record.deepErrorMessage }),
    ...(record.sourceSnapshot === undefined
      ? {}
      : {
          sourceSnapshot: {
            sourceDigest: record.sourceSnapshot.sourceDigest,
            collectedAt: record.sourceSnapshot.collectedAt,
            providerStatuses: record.sourceSnapshot.providerStatuses.map((providerStatus) => ({
              providerId: providerStatus.providerId,
              status: providerStatus.status,
              sessionCount: providerStatus.sessionCount,
              parseErrorCount: providerStatus.parseErrorCount,
            })),
          },
        }),
    ...(record.basicResult === undefined ? {} : { basicResult: record.basicResult }),
    ...(record.deepResult === undefined ? {} : { deepResult: record.deepResult }),
  };
}

function normalizeProviderStatus(provider: WorkAnalysisDashboardProviderStatus) {
  return {
    providerId: provider.providerId,
    status: provider.status,
    sessionCount: provider.sessionCount,
    parseErrorCount: provider.parseErrorCount,
    warningCount: provider.warningCount,
    ...normalizeProviderWarnings(provider.warnings),
  };
}

function normalizeHourlyIndexSession(
  session: WorkAnalysisHourlyIndexSession
): WorkAnalysisHourlyIndexSession {
  return {
    providerId: session.providerId,
    sessionId: session.sessionId,
    workspacePath: session.workspacePath,
    startedAt: session.startedAt,
    lastActiveAt: session.lastActiveAt,
    sourceRef: session.sourceRef,
    ...(session.title === undefined ? {} : { title: session.title }),
    ...(session.modelId === undefined ? {} : { modelId: session.modelId }),
    ...(session.gitBranch === undefined ? {} : { gitBranch: session.gitBranch }),
    ...(session.gitCommit === undefined ? {} : { gitCommit: session.gitCommit }),
    userTurnCount: session.userTurnCount,
    assistantTurnCount: session.assistantTurnCount,
    toolUseCount: session.toolUseCount,
    ...(session.usage === undefined ? {} : { usage: { ...session.usage } }),
    ...(session.usageCoverage === undefined ? {} : { usageCoverage: { ...session.usageCoverage } }),
    parseErrorCount: session.parseErrorCount,
    timestampQuality: session.timestampQuality,
    ...(session.events === undefined
      ? {}
      : {
          events: session.events.map(compactWorkLogEventForHourlyIndex),
        }),
  };
}

function normalizeHourlyIndex(index: WorkAnalysisHourlyIndex): WorkAnalysisHourlyIndex {
  return {
    version: 1,
    ...(index.bucketMode === undefined ? {} : { bucketMode: index.bucketMode }),
    indexedAt: index.indexedAt,
    indexedThroughHourStart: index.indexedThroughHourStart,
    sourceDigest: index.sourceDigest,
    providerStatuses: index.providerStatuses.map(normalizeProviderStatus),
    buckets: index.buckets
      .map((bucket) => ({
        hourStart: bucket.hourStart,
        sessions: bucket.sessions.map(normalizeHourlyIndexSession),
      }))
      .sort((left, right) => left.hourStart - right.hourStart),
  };
}

function normalizeFileRecords(value: unknown): Record<string, WorkAnalysisRecord> {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.records)) {
    return {};
  }

  const normalized: Record<string, WorkAnalysisRecord> = {};
  for (const [queryDigest, entry] of Object.entries(value.records)) {
    if (isWorkAnalysisRecord(entry) && entry.queryDigest === queryDigest) {
      normalized[queryDigest] = normalizeRecord(entry);
    }
  }

  return normalized;
}

function normalizeFileIndex(value: unknown): WorkAnalysisHourlyIndex | undefined {
  if (!isRecord(value) || value.version !== 1 || !isHourlyIndex(value.index)) {
    return undefined;
  }

  return normalizeHourlyIndex(value.index);
}

type RecordRow = { record: Uint8Array };
type IndexMetaRow = {
  version: number;
  bucket_mode: string | null;
  indexed_at: number;
  indexed_through_hour_start: number;
  source_digest: string;
  provider_statuses: Uint8Array;
};
type IndexBucketRow = { hour_start: number; bucket: Uint8Array };

function encodeValue(value: unknown): Buffer {
  return serialize(value);
}

function decodeValue<T>(value: Uint8Array): T | undefined {
  try {
    return deserialize(Buffer.from(value)) as T;
  } catch {
    return undefined;
  }
}

function runTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export class WorkAnalysisRepo {
  private db: DatabaseSync | undefined;
  private initialized = false;

  constructor(private readonly input: WorkAnalysisRepoOptions) {}

  private getDb(): DatabaseSync {
    if (!this.db) {
      mkdirSync(dirname(this.input.filePath), { recursive: true });
      this.db = new DatabaseSync(this.input.filePath);
    }
    if (!this.initialized) {
      this.initialize(this.db);
      this.initialized = true;
    }

    return this.db;
  }

  private initialize(db: DatabaseSync): void {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      DROP TABLE IF EXISTS work_analysis_dashboards;
      CREATE TABLE IF NOT EXISTS work_analysis_records (
        query_digest TEXT PRIMARY KEY,
        record BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS work_analysis_index_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL,
        bucket_mode TEXT,
        indexed_at INTEGER NOT NULL,
        indexed_through_hour_start INTEGER NOT NULL,
        source_digest TEXT NOT NULL,
        provider_statuses BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS work_analysis_index_buckets (
        hour_start INTEGER PRIMARY KEY,
        bucket BLOB NOT NULL
      );
    `);
    this.importLegacyJsonIfEmpty(db);
  }

  private importLegacyJsonIfEmpty(db: DatabaseSync): void {
    const legacyPath = this.input.legacyJsonFilePath;
    if (!legacyPath || !existsSync(legacyPath) || !this.isEmpty(db)) {
      return;
    }

    const parsed = readJsonFile<WorkAnalysisFileRecord>(legacyPath);
    if (parsed === undefined) {
      return;
    }

    const records = normalizeFileRecords(parsed);
    const index = normalizeFileIndex(parsed);
    runTransaction(db, () => {
      for (const record of Object.values(records)) {
        this.writeRecord(db, record);
      }
      if (index) {
        this.writeHourlyIndex(db, index);
      }
    });
  }

  private isEmpty(db: DatabaseSync): boolean {
    const record = db.prepare("SELECT 1 FROM work_analysis_records LIMIT 1").get();
    const index = db.prepare("SELECT 1 FROM work_analysis_index_meta WHERE id = 1").get();
    return !record && !index;
  }

  private writeRecord(db: DatabaseSync, record: WorkAnalysisRecord): void {
    db.prepare(
      "INSERT OR REPLACE INTO work_analysis_records (query_digest, record) VALUES (?, ?)"
    ).run(record.queryDigest, encodeValue(record));
  }

  private writeHourlyIndex(db: DatabaseSync, index: WorkAnalysisHourlyIndex): void {
    db.prepare("DELETE FROM work_analysis_index_buckets").run();
    db.prepare("DELETE FROM work_analysis_index_meta WHERE id = 1").run();
    db.prepare(
      `INSERT INTO work_analysis_index_meta (
        id,
        version,
        bucket_mode,
        indexed_at,
        indexed_through_hour_start,
        source_digest,
        provider_statuses
      ) VALUES (1, ?, ?, ?, ?, ?, ?)`
    ).run(
      index.version,
      index.bucketMode ?? null,
      index.indexedAt,
      index.indexedThroughHourStart,
      index.sourceDigest,
      encodeValue(index.providerStatuses)
    );
    const insertBucket = db.prepare(
      "INSERT INTO work_analysis_index_buckets (hour_start, bucket) VALUES (?, ?)"
    );
    for (const bucket of index.buckets) {
      insertBucket.run(bucket.hourStart, encodeValue(bucket));
    }
  }

  findByQueryDigest(queryDigest: string): WorkAnalysisRecord | undefined {
    const db = this.getDb();
    const row = db
      .prepare("SELECT record FROM work_analysis_records WHERE query_digest = ?")
      .get(queryDigest) as RecordRow | undefined;
    const record = row ? decodeValue<WorkAnalysisRecord>(row.record) : undefined;
    return isWorkAnalysisRecord(record) ? normalizeRecord(record) : undefined;
  }

  upsert(record: WorkAnalysisRecord): WorkAnalysisRecord {
    const normalized = normalizeRecord(record);
    runTransaction(this.getDb(), () => this.writeRecord(this.getDb(), normalized));
    return normalized;
  }

  findHourlyIndex(): WorkAnalysisHourlyIndex | undefined {
    const db = this.getDb();
    const meta = db.prepare("SELECT * FROM work_analysis_index_meta WHERE id = 1").get() as
      | IndexMetaRow
      | undefined;
    if (!meta) {
      return undefined;
    }

    const providerStatuses = decodeValue<WorkAnalysisHourlyIndex["providerStatuses"]>(
      meta.provider_statuses
    );
    if (!Array.isArray(providerStatuses)) {
      return undefined;
    }

    const bucketRows = db
      .prepare("SELECT hour_start, bucket FROM work_analysis_index_buckets ORDER BY hour_start ASC")
      .all() as IndexBucketRow[];
    const buckets = bucketRows
      .map((row) => decodeValue<WorkAnalysisHourlyIndex["buckets"][number]>(row.bucket))
      .filter((bucket): bucket is WorkAnalysisHourlyIndex["buckets"][number] =>
        Boolean(
          bucket &&
            isRecord(bucket) &&
            typeof bucket.hourStart === "number" &&
            Array.isArray(bucket.sessions) &&
            bucket.sessions.every(isHourlyIndexSession)
        )
      );
    const index: WorkAnalysisHourlyIndex = {
      version: 1,
      ...(meta.bucket_mode === null
        ? {}
        : { bucketMode: meta.bucket_mode as WorkAnalysisHourlyIndex["bucketMode"] }),
      indexedAt: meta.indexed_at,
      indexedThroughHourStart: meta.indexed_through_hour_start,
      sourceDigest: meta.source_digest,
      providerStatuses,
      buckets,
    };

    return isHourlyIndex(index) ? normalizeHourlyIndex(index) : undefined;
  }

  upsertHourlyIndex(index: WorkAnalysisHourlyIndex): WorkAnalysisHourlyIndex {
    const normalized = normalizeHourlyIndex(index);
    runTransaction(this.getDb(), () => this.writeHourlyIndex(this.getDb(), normalized));
    return normalized;
  }

  clearAnalysisCache(): void {
    const db = this.getDb();
    runTransaction(db, () => {
      db.prepare("DELETE FROM work_analysis_records").run();
      db.prepare("DELETE FROM work_analysis_index_buckets").run();
      db.prepare("DELETE FROM work_analysis_index_meta").run();
    });
  }

  close(): void {
    if (!this.db) {
      return;
    }

    this.db.close();
    this.db = undefined;
    this.initialized = false;
  }
}
