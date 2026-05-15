import type {
  ProviderDefinition,
  SessionState,
  Supervisor,
  SupervisorTargetMemory,
} from "@coder-studio/core";
import type { FastifyBaseLogger } from "fastify";
import type { SessionManager } from "../session/manager.js";
import type { TerminalManagerLike } from "../terminal/terminal-manager-like.js";
import type { WorkspaceManager } from "../workspace/manager.js";

export { stripAnsi } from "../terminal/snapshot-render.js";

const NOOP_LOGGER: FastifyBaseLogger = {
  child: () => NOOP_LOGGER,
  debug: () => {},
  error: () => {},
  fatal: () => {},
  info: () => {},
  level: "silent",
  silent: () => {},
  trace: () => {},
  warn: () => {},
};

const TERMINAL_MAX_LINES = 200;
const TERMINAL_MAX_CHARS = 12_000;
export interface SupervisorEvaluationContext {
  objective: string;
  sessionId: string;
  workspaceId: string;
  workspacePath: string;
  sessionProviderId: string;
  evaluatorProviderId: string;
  sessionState: SessionState;
  transcriptExcerpt?: string;
  terminalExcerpt?: string;
  lastTurnId?: string;
  evidenceSource: "headless_snapshot" | "transcript" | "terminal_fallback";
  /** Latest user input from the current turn (for supervisor context) */
  latestUserInput?: string;
  targetMemory: SupervisorTargetMemory;
}

export class SupervisorContextBuilder {
  private readonly logger: FastifyBaseLogger;

  constructor(
    private readonly deps: {
      workspaceMgr: WorkspaceManager;
      sessionMgr: SessionManager;
      terminalMgr: TerminalManagerLike;
      providerRegistry: ProviderDefinition[];
      logger?: FastifyBaseLogger;
    }
  ) {
    this.logger = deps.logger ?? NOOP_LOGGER;
  }

  async build(
    supervisor: Supervisor,
    targetMemory: SupervisorTargetMemory
  ): Promise<SupervisorEvaluationContext> {
    const session = this.deps.sessionMgr.get(supervisor.sessionId);
    const workspace = this.deps.workspaceMgr.get(supervisor.workspaceId);

    if (!session || !workspace) {
      throw {
        code: "supervisor_not_found",
        message: "Supervisor session context is unavailable",
      };
    }

    let renderedSnapshot = "";
    try {
      renderedSnapshot = await this.deps.sessionMgr.getRenderedSnapshot(session.id, {
        maxLines: TERMINAL_MAX_LINES,
        maxChars: TERMINAL_MAX_CHARS,
      });
    } catch (error) {
      this.logger.warn(
        { err: error, sessionId: session.id },
        "Supervisor headless snapshot read failed"
      );
    }

    const latestUserInput = this.deps.sessionMgr.getLatestSubmittedUserInput(session.id);

    this.logger.info(
      {
        metric: "supervisor.evidence.built",
        sessionId: session.id,
        workspaceId: workspace.id,
        evidenceSource: "headless_snapshot",
        terminalCharCount: renderedSnapshot.length,
      },
      "supervisor evidence built"
    );

    return {
      objective: supervisor.objective,
      sessionId: session.id,
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      sessionProviderId: session.providerId,
      evaluatorProviderId: supervisor.evaluatorProviderId,
      sessionState: session.state,
      transcriptExcerpt: undefined,
      terminalExcerpt: renderedSnapshot,
      lastTurnId: undefined,
      evidenceSource: "headless_snapshot",
      latestUserInput,
      targetMemory,
    };
  }
}
