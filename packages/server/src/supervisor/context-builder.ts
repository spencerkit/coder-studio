import type { ProviderDefinition, SessionState, Supervisor } from '@coder-studio/core';
import type { SessionManager } from '../session/manager.js';
import type { TerminalManager } from '../terminal/manager.js';
import type { WorkspaceManager } from '../workspace/manager.js';
import { getGitDiffStatSummary, getGitStatusSummary } from '../git/cli.js';

const TRANSCRIPT_MAX_CHARS = 12_000;
const TRANSCRIPT_MAX_TURNS = 12;
const TERMINAL_MAX_LINES = 200;
const TERMINAL_MAX_CHARS = 12_000;
const GIT_SUMMARY_MAX_CHARS = 4_000;

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
  constructor(
    private readonly deps: {
      workspaceMgr: WorkspaceManager;
      sessionMgr: SessionManager;
      terminalMgr: TerminalManager;
      providerRegistry: ProviderDefinition[];
      git?: {
        getStatusSummary?: typeof getGitStatusSummary;
        getDiffStatSummary?: typeof getGitDiffStatSummary;
      };
    }
  ) {}

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
    const transcript =
      session.transcriptPath && provider?.readTranscriptExcerpt
        ? await provider
            .readTranscriptExcerpt({
              transcriptPath: session.transcriptPath,
              maxChars: TRANSCRIPT_MAX_CHARS,
              maxTurns: TRANSCRIPT_MAX_TURNS,
            })
            .catch(() => null)
        : null;

    const terminalSnapshot =
      this.deps.terminalMgr.get(session.terminalId)?.ringBuffer.snapshot().toString('utf8') ?? '';
    const terminalExcerpt = terminalSnapshot
      .split('\n')
      .slice(-TERMINAL_MAX_LINES)
      .join('\n')
      .slice(-TERMINAL_MAX_CHARS);

    const getStatusSummary = this.deps.git?.getStatusSummary ?? getGitStatusSummary;
    const getDiffStatSummary = this.deps.git?.getDiffStatSummary ?? getGitDiffStatSummary;

    const gitStatusSummary = await getStatusSummary(workspace.path)
      .then((value) => value.slice(-GIT_SUMMARY_MAX_CHARS))
      .catch(() => '');
    const gitDiffStat = await getDiffStatSummary(workspace.path)
      .then((value) => value.slice(-GIT_SUMMARY_MAX_CHARS))
      .catch(() => '');

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
