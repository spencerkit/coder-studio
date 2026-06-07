import type { SessionAnalysisRecord, SessionAnalysisResult } from "../../session-analysis/types.js";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

interface SessionAnalysisFileRecord {
  version: 1;
  records: Record<string, SessionAnalysisRecord>;
}

export interface SessionAnalysisRepoOptions {
  filePath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSessionAnalysisRecord(value: unknown): value is SessionAnalysisRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.sessionId === "string" &&
    typeof value.workspaceId === "string" &&
    typeof value.providerId === "string" &&
    (value.status === "idle" ||
      value.status === "running" ||
      value.status === "succeeded" ||
      value.status === "failed") &&
    (value.requestedAt === undefined || typeof value.requestedAt === "number") &&
    (value.completedAt === undefined || typeof value.completedAt === "number") &&
    (value.inputDigest === undefined || typeof value.inputDigest === "string") &&
    (value.errorMessage === undefined || typeof value.errorMessage === "string") &&
    (value.result === undefined || isSessionAnalysisResult(value.result))
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isSessionAnalysisResult(value: unknown): value is SessionAnalysisResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.summary === "string" &&
    isStringArray(value.recentWork) &&
    Array.isArray(value.repeatedTopics) &&
    value.repeatedTopics.every(
      (topic) =>
        isRecord(topic) &&
        typeof topic.topic === "string" &&
        typeof topic.whyItRepeated === "string" &&
        isStringArray(topic.evidence)
    ) &&
    Array.isArray(value.bottlenecks) &&
    value.bottlenecks.every(
      (bottleneck) =>
        isRecord(bottleneck) &&
        typeof bottleneck.title === "string" &&
        typeof bottleneck.impact === "string" &&
        isStringArray(bottleneck.evidence) &&
        typeof bottleneck.suggestion === "string"
    ) &&
    Array.isArray(value.skillCandidates) &&
    value.skillCandidates.every(
      (candidate) =>
        isRecord(candidate) &&
        typeof candidate.title === "string" &&
        typeof candidate.why === "string" &&
        typeof candidate.suggestedScope === "string" &&
        isStringArray(candidate.evidence)
    ) &&
    isStringArray(value.openLoops) &&
    isStringArray(value.wrapUpSuggestions) &&
    (value.confidence === "low" || value.confidence === "medium" || value.confidence === "high")
  );
}

function normalizeRecord(record: SessionAnalysisRecord): SessionAnalysisRecord {
  return {
    sessionId: record.sessionId,
    workspaceId: record.workspaceId,
    providerId: record.providerId,
    status: record.status,
    ...(record.requestedAt === undefined ? {} : { requestedAt: record.requestedAt }),
    ...(record.completedAt === undefined ? {} : { completedAt: record.completedAt }),
    ...(record.inputDigest === undefined ? {} : { inputDigest: record.inputDigest }),
    ...(record.errorMessage === undefined ? {} : { errorMessage: record.errorMessage }),
    ...(record.result === undefined ? {} : { result: normalizeResult(record.result) }),
  };
}

function normalizeResult(result: SessionAnalysisResult): SessionAnalysisResult {
  return {
    summary: result.summary,
    recentWork: [...result.recentWork],
    repeatedTopics: result.repeatedTopics.map((topic) => ({
      topic: topic.topic,
      whyItRepeated: topic.whyItRepeated,
      evidence: [...topic.evidence],
    })),
    bottlenecks: result.bottlenecks.map((bottleneck) => ({
      title: bottleneck.title,
      impact: bottleneck.impact,
      evidence: [...bottleneck.evidence],
      suggestion: bottleneck.suggestion,
    })),
    skillCandidates: result.skillCandidates.map((candidate) => ({
      title: candidate.title,
      why: candidate.why,
      suggestedScope: candidate.suggestedScope,
      evidence: [...candidate.evidence],
    })),
    openLoops: [...result.openLoops],
    wrapUpSuggestions: [...result.wrapUpSuggestions],
    confidence: result.confidence,
  };
}

function normalizeSessionAnalysisFile(value: unknown): Record<string, SessionAnalysisRecord> {
  if (isRecord(value) && value.version === 1 && isRecord(value.records)) {
    const normalized: Record<string, SessionAnalysisRecord> = {};
    for (const entry of Object.values(value.records)) {
      if (isSessionAnalysisRecord(entry)) {
        normalized[entry.sessionId] = normalizeRecord(entry);
      }
    }
    return normalized;
  }

  if (Array.isArray(value)) {
    const normalized: Record<string, SessionAnalysisRecord> = {};
    for (const entry of value) {
      if (isSessionAnalysisRecord(entry)) {
        normalized[entry.sessionId] = normalizeRecord(entry);
      }
    }
    return normalized;
  }

  if (isRecord(value)) {
    const normalized: Record<string, SessionAnalysisRecord> = {};
    for (const [sessionId, entry] of Object.entries(value)) {
      if (isSessionAnalysisRecord(entry)) {
        normalized[sessionId] = normalizeRecord({
          ...entry,
          sessionId,
        });
      }
    }
    return normalized;
  }

  return {};
}

export class SessionAnalysisRepo {
  private readonly filePath: string;

  constructor(input: SessionAnalysisRepoOptions) {
    this.filePath = input.filePath;
  }

  private loadFileRecords(): Record<string, SessionAnalysisRecord> {
    const parsed = readJsonFile<
      SessionAnalysisFileRecord | Record<string, SessionAnalysisRecord> | SessionAnalysisRecord[]
    >(this.filePath);
    if (parsed !== undefined) {
      return normalizeSessionAnalysisFile(parsed);
    }

    return {};
  }

  private saveFileRecords(records: Record<string, SessionAnalysisRecord>): void {
    const payload: SessionAnalysisFileRecord = {
      version: 1,
      records,
    };
    writeJsonFileAtomic(this.filePath, payload);
  }

  findBySessionId(sessionId: string): SessionAnalysisRecord | undefined {
    return this.loadFileRecords()[sessionId];
  }

  upsert(record: SessionAnalysisRecord): SessionAnalysisRecord {
    const records = this.loadFileRecords();
    const normalized = normalizeRecord(record);
    records[normalized.sessionId] = normalized;
    this.saveFileRecords(records);
    return normalized;
  }
}

export type { SessionAnalysisRecord, SessionAnalysisResult };
