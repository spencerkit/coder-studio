import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { SessionMetadataRepo } from "../storage/repositories/session-metadata-repo.js";
import { WorkspaceRepo } from "../storage/repositories/workspace-repo.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";
import "../commands/session-metadata.js";

describe("session metadata commands", () => {
  let tempDir: string;
  let workspacePath: string;
  let workspaceRepo: WorkspaceRepo;
  let metadataRepo: SessionMetadataRepo;
  let ctx: CommandContext & { sessionMetadataRepo: SessionMetadataRepo };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "session-metadata-command-"));
    workspacePath = join(tempDir, "workspace");
    await mkdir(workspacePath, { recursive: true });
    workspaceRepo = new WorkspaceRepo({
      filePath: join(tempDir, "workspaces.json"),
    });
    workspaceRepo.create({
      id: "ws-1",
      path: workspacePath,
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: { leftPanelWidth: 1, bottomPanelHeight: 1, focusMode: false },
    });
    metadataRepo = new SessionMetadataRepo({
      workspaceRepo,
    });
    metadataRepo.upsert({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      objective: "Fix the lint errors",
      baselineGitHead: "abc123",
      baselineCapturedAt: 100,
      verificationRuns: [],
      activityEntries: [],
    });

    ctx = {
      workspaceMgr: {} as never,
      sessionMgr: {} as never,
      terminalMgr: {} as never,
      eventBus: new EventBus(),
      broadcaster: { broadcast: vi.fn() } as never,
      db: {} as never,
      providerRegistry: [],
      fencingMgr: {} as never,
      supervisorMgr: {} as never,
      autoFetch: {} as never,
      activationMgr: {} as never,
      sessionMetadataRepo: metadataRepo,
    };
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns stored metadata", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "session-metadata-get",
        op: "session.metadata.get",
        args: {
          sessionId: "sess-1",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      objective: "Fix the lint errors",
      baselineGitHead: "abc123",
      baselineCapturedAt: 100,
      verificationRuns: [],
      activityEntries: [],
    });
  });

  it("appends verification runs through dispatch", async () => {
    const added = await dispatch(
      {
        kind: "command",
        id: "session-verification-add",
        op: "session.verification.add",
        args: {
          sessionId: "sess-1",
          command: "pnpm lint",
          status: "passed",
          exitCode: 0,
          summary: "lint clean",
        },
      },
      ctx
    );

    expect(added.ok).toBe(true);
    expect(added.data).toMatchObject({
      sessionId: "sess-1",
      verificationRuns: [
        expect.objectContaining({
          command: "pnpm lint",
          status: "passed",
          exitCode: 0,
          summary: "lint clean",
        }),
      ],
      activityEntries: [],
    });
  });

  it("records a session activity entry and broadcasts a workspace activity change", async () => {
    const recorded = await dispatch(
      {
        kind: "command",
        id: "session-activity-record",
        op: "session.activity.record",
        args: {
          sessionId: "sess-1",
          kind: "plan",
          phase: "start",
          title: "Plan started",
          summary: "Reviewing requirements",
          status: "info",
          command: "pnpm test",
          files: ["packages/server/src/commands/session-metadata.ts"],
          payload: {
            source: "test",
          },
        },
      },
      ctx
    );

    expect(recorded.ok).toBe(true);
    expect(recorded.data).toMatchObject({
      sessionId: "sess-1",
      activityEntries: [
        expect.objectContaining({
          sessionId: "sess-1",
          workspaceId: "ws-1",
          kind: "plan",
          phase: "start",
          title: "Plan started",
          summary: "Reviewing requirements",
          status: "info",
          command: "pnpm test",
          files: ["packages/server/src/commands/session-metadata.ts"],
          payload: {
            source: "test",
          },
        }),
      ],
    });
    expect(ctx.broadcaster.broadcast).toHaveBeenCalledWith(
      "workspace.ws-1.session-activity.changed",
      {
        sessionId: "sess-1",
      }
    );
  });

  it("lists recorded session activity entries", async () => {
    await dispatch(
      {
        kind: "command",
        id: "session-activity-record",
        op: "session.activity.record",
        args: {
          sessionId: "sess-1",
          kind: "review",
          phase: "finish",
          title: "Verification finished",
        },
      },
      ctx
    );

    const listed = await dispatch(
      {
        kind: "command",
        id: "session-activity-list",
        op: "session.activity.list",
        args: {
          sessionId: "sess-1",
        },
      },
      ctx
    );

    expect(listed.ok).toBe(true);
    expect(listed.data).toEqual({
      sessionId: "sess-1",
      entries: [
        expect.objectContaining({
          sessionId: "sess-1",
          workspaceId: "ws-1",
          kind: "review",
          phase: "finish",
          title: "Verification finished",
        }),
      ],
    });
  });
});
