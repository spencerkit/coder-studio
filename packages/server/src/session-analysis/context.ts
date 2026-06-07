import { getGitDiffStatSummary, getGitStatus, getGitStatusSummary } from "../git/cli.js";
import type { SessionManager } from "../session/manager.js";
import type { WorkspaceManager } from "../workspace/manager.js";
import type { SessionAnalysisContext } from "./types.js";

const TERMINAL_MAX_LINES = 200;
const TERMINAL_MAX_CHARS = 12_000;

export interface SessionAnalysisContextCollectorInput {
  sessionId: string;
}

export interface SessionAnalysisContextCollectorDeps {
  sessionMgr: Pick<SessionManager, "get" | "getRenderedSnapshot" | "getLatestSubmittedUserInput">;
  workspaceMgr: Pick<WorkspaceManager, "get">;
}

export function createSessionAnalysisContextCollector(
  deps: SessionAnalysisContextCollectorDeps
): (input: SessionAnalysisContextCollectorInput) => Promise<SessionAnalysisContext> {
  return async ({ sessionId }) => {
    const session = deps.sessionMgr.get(sessionId);
    if (!session) {
      throw {
        code: "session_analysis_context_unavailable",
        message: "Session analysis context is unavailable",
      };
    }

    const workspace = deps.workspaceMgr.get(session.workspaceId);
    if (!workspace) {
      throw {
        code: "session_analysis_context_unavailable",
        message: "Session analysis context is unavailable",
      };
    }

    const [terminalSnapshot, latestUserInput, gitStatus, diffSummary, gitState] = await Promise.all(
      [
        deps.sessionMgr.getRenderedSnapshot(session.id, {
          maxLines: TERMINAL_MAX_LINES,
          maxChars: TERMINAL_MAX_CHARS,
        }),
        Promise.resolve(deps.sessionMgr.getLatestSubmittedUserInput(session.id)),
        getGitStatusSummary(workspace.path).catch(() => undefined),
        getGitDiffStatSummary(workspace.path).catch(() => undefined),
        getGitStatus(workspace.path).catch(() => undefined),
      ]
    );

    const changedFiles = [
      ...(gitState?.staged ?? []),
      ...(gitState?.modified ?? []),
      ...(gitState?.untracked ?? []),
      ...(gitState?.deleted ?? []),
    ].map((change) => change.path);

    return {
      sessionId: session.id,
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      providerId: session.providerId,
      sessionState: session.state,
      startedAt: session.startedAt,
      lastActiveAt: session.lastActiveAt,
      changedFiles: [...new Set(changedFiles)],
      ...(session.title ? { sessionTitle: session.title } : {}),
      ...(session.endedAt ? { endedAt: session.endedAt } : {}),
      ...(gitStatus ? { gitStatus } : {}),
      ...(diffSummary ? { diffSummary } : {}),
      ...(latestUserInput ? { latestUserInput } : {}),
      ...(terminalSnapshot ? { terminalSnapshot } : {}),
    };
  };
}
