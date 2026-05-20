import type { AgentSessionMetadata, AgentSessionVerificationRun } from "@coder-studio/core";
import type { Database } from "../database.js";

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

export class SessionMetadataRepo {
  constructor(private readonly db: Database) {}

  upsert(metadata: AgentSessionMetadata): AgentSessionMetadata {
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
        metadata.sessionId,
        metadata.workspaceId,
        metadata.providerId,
        metadata.objective ?? null,
        metadata.baselineGitHead ?? null,
        metadata.baselineCapturedAt ?? null
      );

    return this.get(metadata.sessionId)!;
  }

  get(sessionId: string): AgentSessionMetadata | undefined {
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

    return {
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
    };
  }

  addVerificationRun(sessionId: string, run: AgentSessionVerificationRun): AgentSessionMetadata {
    const existing = this.get(sessionId);
    if (!existing) {
      throw new Error(`Session metadata not found: ${sessionId}`);
    }

    this.db
      .prepare(
        `INSERT INTO session_verification_runs (id, session_id, command, status, exit_code, summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        sessionId,
        run.command,
        run.status,
        run.exitCode ?? null,
        run.summary ?? null,
        run.createdAt
      );

    return this.get(sessionId)!;
  }
}
