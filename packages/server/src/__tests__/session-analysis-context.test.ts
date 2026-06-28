import type { Session, Workspace } from "@coder-studio/core";
import { describe, expect, it, vi } from "vitest";
import * as gitCli from "../git/cli.js";
import { createSessionAnalysisContextCollector } from "../session-analysis/context.js";
import type { SessionAnalysisContext } from "../session-analysis/types.js";

type SessionManagerStub = Pick<
  import("../session/manager.js").SessionManager,
  "get" | "getPersisted" | "getRenderedSnapshot" | "getLatestSubmittedUserInput"
>;

type WorkspaceManagerStub = Pick<import("../workspace/manager.js").WorkspaceManager, "get">;

function createSession(overrides?: Partial<Session>): Session {
  return {
    id: "sess-1",
    workspaceId: "ws-1",
    terminalId: "term-1",
    providerId: "codex",
    capability: "full",
    state: "idle",
    startedAt: 100,
    lastActiveAt: 200,
    ...overrides,
  };
}

function createWorkspace(overrides?: Partial<Workspace>): Workspace {
  return {
    id: "ws-1",
    path: "/repo/project",
    targetRuntime: "native",
    openedAt: 1,
    lastActiveAt: 2,
    uiState: { leftPanelWidth: 320, bottomPanelHeight: 240, focusMode: false },
    ...overrides,
  };
}

function createSessionMgr(session?: Session): SessionManagerStub {
  return {
    get: vi.fn((sessionId: string) => (sessionId === session?.id ? session : undefined)),
    getPersisted: vi.fn((sessionId: string) => (sessionId === session?.id ? session : undefined)),
    getRenderedSnapshot: vi.fn(async () => "build failed\nfix tests\n"),
    getLatestSubmittedUserInput: vi.fn(() => "fix the failing test"),
  };
}

function createWorkspaceMgr(workspace?: Workspace): WorkspaceManagerStub {
  return {
    get: vi.fn((workspaceId: string) => (workspaceId === workspace?.id ? workspace : undefined)),
  };
}

describe("createSessionAnalysisContextCollector", () => {
  it("collects the current session and workspace context without invoking any runner", async () => {
    vi.spyOn(gitCli, "getGitStatusSummary").mockResolvedValue(" M package.json");
    vi.spyOn(gitCli, "getGitDiffStatSummary").mockResolvedValue("1 file changed, 2 insertions(+)");
    vi.spyOn(gitCli, "getGitStatus").mockResolvedValue({
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [],
      modified: [{ path: "package.json", status: "modified" }],
      untracked: [],
      deleted: [],
    });

    const session = createSession();
    const workspace = createWorkspace();
    const sessionMgr = createSessionMgr(session);
    const workspaceMgr = createWorkspaceMgr(workspace);

    const collect = createSessionAnalysisContextCollector({
      sessionMgr: sessionMgr as import("../session/manager.js").SessionManager,
      workspaceMgr: workspaceMgr as import("../workspace/manager.js").WorkspaceManager,
    });

    await expect(collect({ sessionId: "sess-1" })).resolves.toEqual<SessionAnalysisContext>({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      workspacePath: "/repo/project",
      providerId: "codex",
      sessionState: "idle",
      startedAt: 100,
      lastActiveAt: 200,
      gitStatus: " M package.json",
      changedFiles: ["package.json"],
      diffSummary: "1 file changed, 2 insertions(+)",
      latestUserInput: "fix the failing test",
      terminalSnapshot: "build failed\nfix tests\n",
    });

    expect(sessionMgr.get).toHaveBeenCalledWith("sess-1");
    expect(workspaceMgr.get).toHaveBeenCalledWith("ws-1");
    expect(sessionMgr.getRenderedSnapshot).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({
        maxChars: expect.any(Number),
        maxLines: expect.any(Number),
      })
    );
    expect(sessionMgr.getLatestSubmittedUserInput).toHaveBeenCalledWith("sess-1");
  });

  it("omits optional context fields when no terminal snapshot or latest input exists", async () => {
    vi.spyOn(gitCli, "getGitStatusSummary").mockResolvedValue("");
    vi.spyOn(gitCli, "getGitDiffStatSummary").mockResolvedValue("");
    vi.spyOn(gitCli, "getGitStatus").mockResolvedValue({
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [],
      modified: [],
      untracked: [],
      deleted: [],
    });

    const session = createSession({ state: "running" });
    const workspace = createWorkspace({ path: "/repo/alt" });
    const sessionMgr = {
      ...createSessionMgr(session),
      getRenderedSnapshot: vi.fn(async () => ""),
      getLatestSubmittedUserInput: vi.fn(() => undefined),
    };
    const workspaceMgr = createWorkspaceMgr(workspace);

    const collect = createSessionAnalysisContextCollector({
      sessionMgr: sessionMgr as import("../session/manager.js").SessionManager,
      workspaceMgr: workspaceMgr as import("../workspace/manager.js").WorkspaceManager,
    });

    await expect(collect({ sessionId: "sess-1" })).resolves.toEqual<SessionAnalysisContext>({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      workspacePath: "/repo/alt",
      providerId: "codex",
      sessionState: "running",
      startedAt: 100,
      lastActiveAt: 200,
      changedFiles: [],
    });
  });

  it("uses a provided session snapshot when the live session has already been removed", async () => {
    const session = createSession({ state: "ended", endedAt: 300 });
    const workspace = createWorkspace();
    const collect = createSessionAnalysisContextCollector({
      sessionMgr: createSessionMgr() as import("../session/manager.js").SessionManager,
      workspaceMgr: createWorkspaceMgr(
        workspace
      ) as import("../workspace/manager.js").WorkspaceManager,
    });

    await expect(
      collect({ sessionId: session.id, sessionSnapshot: session })
    ).resolves.toMatchObject({
      sessionId: session.id,
      workspaceId: workspace.id,
      sessionState: "ended",
    });
  });

  it("throws a stable not found error when the session or workspace is unavailable", async () => {
    const collectMissingSession = createSessionAnalysisContextCollector({
      sessionMgr: createSessionMgr() as import("../session/manager.js").SessionManager,
      workspaceMgr: createWorkspaceMgr(
        createWorkspace()
      ) as import("../workspace/manager.js").WorkspaceManager,
    });

    await expect(collectMissingSession({ sessionId: "missing" })).rejects.toMatchObject({
      code: "session_analysis_context_unavailable",
      message: "Session analysis context is unavailable",
    });

    const session = createSession();
    const collectMissingWorkspace = createSessionAnalysisContextCollector({
      sessionMgr: createSessionMgr(session) as import("../session/manager.js").SessionManager,
      workspaceMgr: createWorkspaceMgr() as import("../workspace/manager.js").WorkspaceManager,
    });

    await expect(collectMissingWorkspace({ sessionId: "sess-1" })).rejects.toMatchObject({
      code: "session_analysis_context_unavailable",
      message: "Session analysis context is unavailable",
    });
  });
});
