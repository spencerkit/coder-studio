import type { AgentSessionMetadata, AgentSessionVerificationRun } from "@coder-studio/core";
import type { Database } from "../database.js";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

interface SessionMetadataRow {
  session_id: string;
  workspace_id: string;
  provider_id: string;
  objective: string | null;
  baseline_git_head: string | null;
  baseline_captured_at: number | null;
}

interface SessionVerificationRunRow {
  id: string;
  session_id: string;
  command: string;
  status: AgentSessionVerificationRun["status"];
  exit_code: number | null;
  summary: string | null;
  created_at: number;
}

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

function isDatabaseInput(input: Database | SessionMetadataRepoOptions): input is Database {
  return typeof input === "object" && input !== null && "prepare" in input;
}

export class SessionMetadataRepo {
  private readonly db?: Database;
  private readonly filePath?: string;

  constructor(input: Database | SessionMetadataRepoOptions) {
    if (isDatabaseInput(input)) {
      this.db = input;
      return;
    }

    this.filePath = input.filePath;
  }

  upsert(metadata: AgentSessionMetadata): AgentSessionMetadata {
    const normalized = normalizeMetadata(metadata);

    if (this.db) {
      this.db
        .prepare(
          `INSERT INTO session_metadata (session_id, workspace_id, provider_id, objective, baseline_git_head, baseline_captured_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             workspace_id = excluded.workspace_id,
             provider_id = excluded.provider_id,
             objective = excluded.objective,
             baseline_git_head = excluded.baseline_git_head,
             baseline_captured_at = excluded.baseline_captured_at`
        )
        .run(
          normalized.sessionId,
          normalized.workspaceId,
          normalized.providerId,
          normalized.objective ?? null,
          normalized.baselineGitHead ?? null,
          normalized.baselineCapturedAt ?? null
        );

      this.db
        .prepare("DELETE FROM session_verification_runs WHERE session_id = ?")
        .run(normalized.sessionId);

      for (const run of normalized.verificationRuns) {
        this.insertVerificationRun(normalized.sessionId, run);
      }

      return this.get(normalized.sessionId)!;
    }

    const next = this.loadFileMetadata();
    next[normalized.sessionId] = normalized;
    this.saveFileMetadata(next);
    return next[normalized.sessionId]!;
  }

  get(sessionId: string): AgentSessionMetadata | undefined {
    if (this.db) {
      const row = this.db
        .prepare(
          `SELECT session_id, workspace_id, provider_id, objective, baseline_git_head, baseline_captured_at
           FROM session_metadata
           WHERE session_id = ?`
        )
        .get(sessionId) as SessionMetadataRow | undefined;

      if (!row) {
        return undefined;
      }

      const runs = this.db
        .prepare(
          `SELECT id, session_id, command, status, exit_code, summary, created_at
           FROM session_verification_runs
           WHERE session_id = ?
           ORDER BY created_at ASC, id ASC`
        )
        .all(sessionId) as unknown as SessionVerificationRunRow[];

      return normalizeMetadata({
        sessionId: row.session_id,
        workspaceId: row.workspace_id,
        providerId: row.provider_id,
        objective: row.objective ?? undefined,
        baselineGitHead: row.baseline_git_head ?? undefined,
        baselineCapturedAt: row.baseline_captured_at ?? undefined,
        verificationRuns: runs.map((run) => ({
          id: run.id,
          command: run.command,
          status: run.status,
          exitCode: run.exit_code ?? undefined,
          summary: run.summary ?? undefined,
          createdAt: run.created_at,
        })),
      });
    }

    return this.loadFileMetadata()[sessionId];
  }

  addVerificationRun(sessionId: string, run: AgentSessionVerificationRun): AgentSessionMetadata {
    const existing = this.get(sessionId);
    if (!existing) {
      throw new Error(`Session metadata not found: ${sessionId}`);
    }

    if (this.db) {
      this.insertVerificationRun(sessionId, run);
      return this.get(sessionId)!;
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
    if (this.db) {
      this.db.prepare("DELETE FROM session_metadata WHERE session_id = ?").run(sessionId);
      return;
    }

    const next = this.loadFileMetadata();
    if (!Object.prototype.hasOwnProperty.call(next, sessionId)) {
      return;
    }
    delete next[sessionId];
    this.saveFileMetadata(next);
  }

  private insertVerificationRun(sessionId: string, run: AgentSessionVerificationRun): void {
    this.db!.prepare(
      `INSERT INTO session_verification_runs (id, session_id, command, status, exit_code, summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      run.id,
      sessionId,
      run.command,
      run.status,
      run.exitCode ?? null,
      run.summary ?? null,
      run.createdAt
    );
  }

  private loadFileMetadata(): Record<string, AgentSessionMetadata> {
    const parsed = readJsonFile<SessionMetadataFileRecord | Record<string, AgentSessionMetadata>>(
      this.filePath!
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
    writeJsonFileAtomic(this.filePath!, payload);
  }
}
