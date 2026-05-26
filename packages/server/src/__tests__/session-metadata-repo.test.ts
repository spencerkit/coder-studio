import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionMetadataRepo } from "../storage/repositories/session-metadata-repo.js";

describe("SessionMetadataRepo", () => {
  let tempDir: string;
  let repo: SessionMetadataRepo;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "session-metadata-repo-"));
    repo = new SessionMetadataRepo({
      filePath: join(tempDir, "session-metadata.json"),
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates and reads session metadata without verification runs", () => {
    repo.upsert({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      objective: "Fix the failing tests",
      baselineGitHead: "abc123",
      baselineCapturedAt: 1000,
      verificationRuns: [],
    });

    expect(repo.get("sess-1")).toEqual({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      objective: "Fix the failing tests",
      baselineGitHead: "abc123",
      baselineCapturedAt: 1000,
      verificationRuns: [],
    });
  });

  it("appends verification runs in created order", () => {
    repo.upsert({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      verificationRuns: [],
    });

    repo.addVerificationRun("sess-1", {
      id: "verify-1",
      command: "pnpm test",
      status: "failed",
      exitCode: 1,
      summary: "2 tests failing",
      createdAt: 100,
    });
    repo.addVerificationRun("sess-1", {
      id: "verify-2",
      command: "pnpm test",
      status: "passed",
      exitCode: 0,
      summary: "all green",
      createdAt: 200,
    });

    expect(repo.get("sess-1")?.verificationRuns).toEqual([
      {
        id: "verify-1",
        command: "pnpm test",
        status: "failed",
        exitCode: 1,
        summary: "2 tests failing",
        createdAt: 100,
      },
      {
        id: "verify-2",
        command: "pnpm test",
        status: "passed",
        exitCode: 0,
        summary: "all green",
        createdAt: 200,
      },
    ]);
  });
});
