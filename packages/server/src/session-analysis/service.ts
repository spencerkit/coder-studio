import type { Session } from "@coder-studio/core";
import type { SessionManager } from "../session/manager.js";
import type { SessionAnalysisRepo } from "../storage/repositories/session-analysis-repo.js";
import type { WorkspaceManager } from "../workspace/manager.js";
import { createSessionAnalysisContextCollector } from "./context.js";
import { buildSessionAnalysisDigest, SessionAnalysisRunner } from "./runner.js";
import { createSessionTranscriptReader } from "./transcript-reader.js";
import type { SessionAnalysisContext, SessionAnalysisRecord } from "./types.js";

export interface SessionAnalysisServiceDeps {
  repo: Pick<SessionAnalysisRepo, "findBySessionId" | "upsert">;
  sessionMgr: Pick<
    SessionManager,
    "get" | "getPersisted" | "getRenderedSnapshot" | "getLatestSubmittedUserInput"
  >;
  workspaceMgr: Pick<WorkspaceManager, "get">;
  runner: Pick<SessionAnalysisRunner, "run">;
  readTranscript?: ReturnType<typeof createSessionTranscriptReader>;
  collectContext?: (input: {
    sessionId: string;
    sessionSnapshot?: Session;
  }) => Promise<SessionAnalysisContext>;
  now?: () => number;
}

export class SessionAnalysisService {
  private readonly now: () => number;
  private readonly readTranscript: ReturnType<typeof createSessionTranscriptReader>;
  private readonly collectContext: (input: {
    sessionId: string;
    sessionSnapshot?: Session;
  }) => Promise<SessionAnalysisContext>;

  constructor(private readonly deps: SessionAnalysisServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.readTranscript = deps.readTranscript ?? createSessionTranscriptReader();
    this.collectContext =
      deps.collectContext ??
      createSessionAnalysisContextCollector({
        sessionMgr: deps.sessionMgr,
        workspaceMgr: deps.workspaceMgr,
      });
  }

  get(sessionId: string): SessionAnalysisRecord | undefined {
    return this.deps.repo.findBySessionId(sessionId);
  }

  async run(input: {
    sessionId: string;
    force?: boolean;
    sessionSnapshot?: Session;
  }): Promise<SessionAnalysisRecord> {
    const context = await this.collectContext({
      sessionId: input.sessionId,
      sessionSnapshot: input.sessionSnapshot,
    });
    const transcript = await this.readTranscript({
      providerId: context.providerId,
      sessionId: context.sessionId,
    });
    const inputDigest = buildSessionAnalysisDigest({
      transcript: transcript.content,
      context,
    });
    const existing = this.deps.repo.findBySessionId(input.sessionId);

    if (!input.force && existing?.status === "succeeded" && existing.inputDigest === inputDigest) {
      return existing;
    }

    const runningRecord = this.deps.repo.upsert({
      sessionId: context.sessionId,
      workspaceId: context.workspaceId,
      providerId: context.providerId,
      status: "running",
      requestedAt: this.now(),
      inputDigest,
    });

    try {
      const result = await this.deps.runner.run({
        providerId: context.providerId,
        sessionId: context.sessionId,
        workspacePath: context.workspacePath,
        transcript: transcript.content,
        context,
      });

      return this.deps.repo.upsert({
        ...runningRecord,
        status: "succeeded",
        completedAt: this.now(),
        result,
        errorMessage: undefined,
      });
    } catch (error) {
      const candidate = error as { message?: string };
      return this.deps.repo.upsert({
        ...runningRecord,
        status: "failed",
        completedAt: this.now(),
        errorMessage: candidate.message ?? "Session analysis failed",
      });
    }
  }
}
