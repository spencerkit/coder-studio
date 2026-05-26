import type { AgentSessionMetadata, AgentSessionVerificationRun } from "@coder-studio/core";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

interface SessionMetadataFileRecord {
  version: 1;
  metadata: Record<string, AgentSessionMetadata>;
}

export interface SessionMetadataRepoOptions {
  filePath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRun(run: AgentSessionVerificationRun): AgentSessionVerificationRun {
  return {
    ...run,
  };
}

function normalizeMetadata(metadata: AgentSessionMetadata): AgentSessionMetadata {
  return {
    sessionId: metadata.sessionId,
    workspaceId: metadata.workspaceId,
    providerId: metadata.providerId,
    objective: metadata.objective ?? undefined,
    baselineGitHead: metadata.baselineGitHead ?? undefined,
    baselineCapturedAt: metadata.baselineCapturedAt ?? undefined,
    verificationRuns: metadata.verificationRuns.map(normalizeRun),
  };
}

function normalizeFileMetadata(value: unknown): Record<string, AgentSessionMetadata> {
  if (isRecord(value) && value.version === 1 && isRecord(value.metadata)) {
    return Object.fromEntries(
      Object.entries(value.metadata).map(([sessionId, metadata]) => [
        sessionId,
        normalizeMetadata(metadata as AgentSessionMetadata),
      ])
    );
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([sessionId, metadata]) => [
        sessionId,
        normalizeMetadata(metadata as AgentSessionMetadata),
      ])
    );
  }

  return {};
}

export class SessionMetadataRepo {
  private readonly filePath: string;

  constructor(input: SessionMetadataRepoOptions) {
    this.filePath = input.filePath;
  }

  upsert(metadata: AgentSessionMetadata): AgentSessionMetadata {
    const normalized = normalizeMetadata(metadata);

    const next = this.loadFileMetadata();
    next[normalized.sessionId] = normalized;
    this.saveFileMetadata(next);
    return next[normalized.sessionId]!;
  }

  get(sessionId: string): AgentSessionMetadata | undefined {
    return this.loadFileMetadata()[sessionId];
  }

  addVerificationRun(sessionId: string, run: AgentSessionVerificationRun): AgentSessionMetadata {
    const existing = this.get(sessionId);
    if (!existing) {
      throw new Error(`Session metadata not found: ${sessionId}`);
    }

    const next = this.loadFileMetadata();
    next[sessionId] = normalizeMetadata({
      ...existing,
      verificationRuns: [...existing.verificationRuns, normalizeRun(run)],
    });
    this.saveFileMetadata(next);
    return next[sessionId]!;
  }

  delete(sessionId: string): void {
    const next = this.loadFileMetadata();
    if (!Object.prototype.hasOwnProperty.call(next, sessionId)) {
      return;
    }
    delete next[sessionId];
    this.saveFileMetadata(next);
  }

  private loadFileMetadata(): Record<string, AgentSessionMetadata> {
    const parsed = readJsonFile<SessionMetadataFileRecord | Record<string, AgentSessionMetadata>>(
      this.filePath
    );
    if (parsed !== undefined) {
      return normalizeFileMetadata(parsed);
    }

    return {};
  }

  private saveFileMetadata(metadata: Record<string, AgentSessionMetadata>): void {
    const payload: SessionMetadataFileRecord = {
      version: 1,
      metadata,
    };
    writeJsonFileAtomic(this.filePath, payload);
  }
}
