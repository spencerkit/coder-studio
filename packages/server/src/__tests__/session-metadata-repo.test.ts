import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionMetadataRepo } from "../storage/repositories/session-metadata-repo.js";
import { WorkspaceRepo } from "../storage/repositories/workspace-repo.js";

describe("SessionMetadataRepo", () => {
  let tempDir: string;
  let workspacePath: string;
  let workspaceRepo: WorkspaceRepo;
  let repo: SessionMetadataRepo;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "session-metadata-repo-"));
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
    repo = new SessionMetadataRepo({
      workspaceRepo,
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("constructs with a workspaceRepo option object", () => {
    const constructed = new SessionMetadataRepo({ workspaceRepo });

    expect(constructed).toBeInstanceOf(SessionMetadataRepo);
  });

  it("stores session metadata under .coder-studio", async () => {
    repo.upsert({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      objective: "Fix the failing tests",
      baselineGitHead: "abc123",
      baselineCapturedAt: 1000,
      verificationRuns: [],
    });

    await expect(
      stat(join(workspacePath, ".coder-studio", "session-metadata.json"))
    ).resolves.toBeDefined();
  });

  it("rehydrates session metadata without verification runs in a fresh repo instance", () => {
    repo.upsert({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      objective: "Fix the failing tests",
      baselineGitHead: "abc123",
      baselineCapturedAt: 1000,
      verificationRuns: [],
    });

    const reloadedRepo = new SessionMetadataRepo({ workspaceRepo });

    expect(reloadedRepo.get("sess-1")).toEqual({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      objective: "Fix the failing tests",
      baselineGitHead: "abc123",
      baselineCapturedAt: 1000,
      verificationRuns: [],
    });
  });

  it("rehydrates appended verification runs in created order in a fresh repo instance", () => {
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

    const reloadedRepo = new SessionMetadataRepo({ workspaceRepo });

    expect(reloadedRepo.get("sess-1")?.verificationRuns).toEqual([
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

  it("rehydrates attached agent instructions in a fresh repo instance", () => {
    repo.upsert({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      verificationRuns: [],
      attachedAgentInstructions: {
        effectiveHash: "hash-123",
        mode: "manual",
        attachedAt: 1234,
      },
    });

    const reloadedRepo = new SessionMetadataRepo({ workspaceRepo });

    expect(reloadedRepo.get("sess-1")).toEqual({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      verificationRuns: [],
      attachedAgentInstructions: {
        effectiveHash: "hash-123",
        mode: "manual",
        attachedAt: 1234,
      },
    });
  });

  it("finds metadata across registered workspaces by session id", async () => {
    const otherWorkspacePath = join(tempDir, "workspace-2");
    await mkdir(otherWorkspacePath, { recursive: true });
    workspaceRepo.create({
      id: "ws-2",
      path: otherWorkspacePath,
      targetRuntime: "native",
      openedAt: 2,
      lastActiveAt: 2,
      uiState: { leftPanelWidth: 1, bottomPanelHeight: 1, focusMode: false },
    });

    repo.upsert({
      sessionId: "sess-2",
      workspaceId: "ws-2",
      providerId: "codex",
      verificationRuns: [],
    });

    expect(repo.get("sess-2")).toMatchObject({
      sessionId: "sess-2",
      workspaceId: "ws-2",
      providerId: "codex",
      verificationRuns: [],
    });
    await expect(
      stat(join(otherWorkspacePath, ".coder-studio", "session-metadata.json"))
    ).resolves.toBeDefined();
  });
});
