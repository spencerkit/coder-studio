import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { SessionMetadataRepo } from "../storage/repositories/session-metadata-repo.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";
import "../commands/session-metadata.js";

describe("session metadata commands", () => {
  let tempDir: string;
  let metadataRepo: SessionMetadataRepo;
  let ctx: CommandContext & { sessionMetadataRepo: SessionMetadataRepo };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "session-metadata-command-"));
    metadataRepo = new SessionMetadataRepo({
      filePath: join(tempDir, "session-metadata.json"),
    });
    metadataRepo.upsert({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      objective: "Fix the lint errors",
      baselineGitHead: "abc123",
      baselineCapturedAt: 100,
      verificationRuns: [],
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
    });
  });
});
