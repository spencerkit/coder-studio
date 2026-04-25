import type { ProviderDefinition, SessionState, Supervisor } from '@coder-studio/core';
import type { FastifyBaseLogger } from 'fastify';
import type { SessionManager } from '../session/manager.js';
import type { TerminalManager } from '../terminal/manager.js';
import type { WorkspaceManager } from '../workspace/manager.js';
import { getGitDiffStatSummary, getGitStatusSummary } from '../git/cli.js';

const NOOP_LOGGER: FastifyBaseLogger = {
  child: () => NOOP_LOGGER,
  debug: () => {},
  error: () => {},
  fatal: () => {},
  info: () => {},
  level: 'silent',
  trace: () => {},
  warn: () => {},
};

const TRANSCRIPT_MAX_CHARS = 12_000;
const TRANSCRIPT_MAX_TURNS = 12;
const TERMINAL_MAX_LINES = 200;
const TERMINAL_MAX_CHARS = 12_000;
const GIT_SUMMARY_MAX_CHARS = 4_000;

export function stripAnsi(text: string): string {
  return text
    // CSI 序列: \x1b[ 开头，参数含 0-9;?>，结尾为 final-char
    .replace(/\x1b\[[0-9;<>?]*[a-zA-Z>=~]/g, '')
    // OSC 序列: \x1b]...BEL 或 \x1b]...ST(\x1b\\)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // 孤立的 ESC
    .replace(/\x1b/g, '')
    .trim();
}

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
  gitStatusSummary?: string;
  gitDiffStat?: string;
  lastTurnId?: string;
  evidenceSource: 'transcript' | 'terminal_fallback';
}

export class SupervisorContextBuilder {
  private readonly logger: FastifyBaseLogger;

  constructor(
    private readonly deps: {
      workspaceMgr: WorkspaceManager;
      sessionMgr: SessionManager;
      terminalMgr: TerminalManager;
      providerRegistry: ProviderDefinition[];
      logger?: FastifyBaseLogger;
      git?: {
        getStatusSummary?: typeof getGitStatusSummary;
        getDiffStatSummary?: typeof getGitDiffStatSummary;
      };
    }
  ) {
    this.logger = deps.logger ?? NOOP_LOGGER;
  }

  async build(supervisor: Supervisor): Promise<SupervisorEvaluationContext> {
    const session = this.deps.sessionMgr.get(supervisor.sessionId);
    const workspace = this.deps.workspaceMgr.get(supervisor.workspaceId);

    if (!session || !workspace) {
      throw {
        code: 'supervisor_not_found',
        message: 'Supervisor session context is unavailable',
      };
    }

    const provider = this.deps.providerRegistry.find((item) => item.id === session.providerId);
    let transcript: { excerpt: string; lastTurnId?: string } | null = null;
    if (session.transcriptPath && provider?.readTranscriptExcerpt) {
      try {
        transcript =
          (await provider.readTranscriptExcerpt({
            transcriptPath: session.transcriptPath,
            maxChars: TRANSCRIPT_MAX_CHARS,
            maxTurns: TRANSCRIPT_MAX_TURNS,
          })) ?? null;
      } catch (error) {
        this.logger.warn(
          { err: error, sessionId: session.id, transcriptPath: session.transcriptPath },
          'Supervisor transcript read failed; falling back to terminal snapshot'
        );
        transcript = null;
      }
    }

    const terminalSnapshot = this.deps.sessionMgr.getOutputTail(session.id, TERMINAL_MAX_CHARS).toString('utf8');
    const terminalExcerpt = stripAnsi(terminalSnapshot)
      .split('\n')
      .slice(-TERMINAL_MAX_LINES)
      .join('\n')
      .slice(-TERMINAL_MAX_CHARS);

    const getStatusSummary = this.deps.git?.getStatusSummary ?? getGitStatusSummary;
    const getDiffStatSummary = this.deps.git?.getDiffStatSummary ?? getGitDiffStatSummary;

    const gitStatusSummary = await getStatusSummary(workspace.path)
      .then((value) => value.slice(-GIT_SUMMARY_MAX_CHARS))
      .catch((error) => {
        this.logger.warn(
          { err: error, workspaceId: workspace.id },
          'Supervisor git status read failed'
        );
        return '';
      });
    const gitDiffStat = await getDiffStatSummary(workspace.path)
      .then((value) => value.slice(-GIT_SUMMARY_MAX_CHARS))
      .catch((error) => {
        this.logger.warn(
          { err: error, workspaceId: workspace.id },
          'Supervisor git diff read failed'
        );
        return '';
      });

    return {
      objective: supervisor.objective,
      sessionId: session.id,
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      sessionProviderId: session.providerId,
      evaluatorProviderId: supervisor.evaluatorProviderId,
      sessionState: session.state,
      transcriptExcerpt: transcript?.excerpt,
      terminalExcerpt: transcript?.excerpt ? undefined : terminalExcerpt,
      gitStatusSummary,
      gitDiffStat,
      lastTurnId: transcript?.lastTurnId,
      evidenceSource: transcript?.excerpt ? 'transcript' : 'terminal_fallback',
    };
  }
}
