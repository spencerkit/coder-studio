import { execFile } from "child_process";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSessionReviewSummary, getSessionReviewDiff } from "../../session-review/review.js";
import { closeDatabase, openDatabase } from "../../storage/db.js";
import { SessionMetadataRepo } from "../../storage/repositories/session-metadata-repo.js";

const execFileAsync = promisify(execFile);

describe("session review", () => {
  let db: ReturnType<typeof openDatabase>;
  let repo: SessionMetadataRepo;
  let repoDir: string;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    repo = new SessionMetadataRepo(db);
    repoDir = await mkdtemp(join(tmpdir(), "session-review-"));

    await execFileAsync("git", ["init"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    await writeFile(join(repoDir, "sample.ts"), "export const value = 1;\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "Initial commit"], { cwd: repoDir });

    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoDir });
    const baseline = stdout.trim();

    db.prepare(
      `INSERT INTO workspaces (id, path, target_runtime, opened_at, last_active_at, ui_state)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      "ws-1",
      repoDir,
      "native",
      1,
      1,
      JSON.stringify({ leftPanelWidth: 1, bottomPanelHeight: 1, focusMode: false })
    );
    db.prepare(
      `INSERT INTO terminals (id, workspace_id, kind, cwd, argv, cols, rows, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("term-1", "ws-1", "agent", repoDir, JSON.stringify(["codex"]), 80, 24, 1);
    db.prepare(
      `INSERT INTO sessions (id, workspace_id, terminal_id, provider_id, capability, state, started_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("sess-1", "ws-1", "term-1", "codex", "full", "starting", 1, 1);
    repo.upsert({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      baselineGitHead: baseline,
      baselineCapturedAt: 1,
      verificationRuns: [],
    });
  });

  afterEach(async () => {
    closeDatabase(db);
    await rm(repoDir, { recursive: true, force: true });
  });

  it("returns changed files since the stored baseline", async () => {
    await writeFile(join(repoDir, "sample.ts"), "export const value = 2;\n");
    await writeFile(join(repoDir, "new-file.ts"), "export const next = true;\n");

    const summary = await buildSessionReviewSummary({
      sessionId: "sess-1",
      workspacePath: repoDir,
      metadataRepo: repo,
    });

    expect(summary.changedFiles).toEqual([
      { path: "sample.ts", status: "modified" },
      { path: "new-file.ts", status: "untracked" },
    ]);
    expect(summary.warnings).toEqual([]);
  });

  it("returns a warning when baseline is missing", async () => {
    db.prepare("DELETE FROM session_metadata WHERE session_id = ?").run("sess-1");
    repo.upsert({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      verificationRuns: [],
    });

    const summary = await buildSessionReviewSummary({
      sessionId: "sess-1",
      workspacePath: repoDir,
      metadataRepo: repo,
    });

    expect(summary.changedFiles).toEqual([]);
    expect(summary.warnings).toEqual([
      {
        code: "missing_baseline",
        message: "Session baseline is missing.",
      },
    ]);
  });

  it("returns a warning for non-git workspaces", async () => {
    const plainDir = await mkdtemp(join(tmpdir(), "session-review-plain-"));
    try {
      const summary = await buildSessionReviewSummary({
        sessionId: "sess-1",
        workspacePath: plainDir,
        metadataRepo: repo,
      });

      expect(summary.changedFiles).toEqual([]);
      expect(summary.warnings).toEqual([
        {
          code: "not_git_repo",
          message: "Workspace is not a Git repository.",
        },
      ]);
    } finally {
      await rm(plainDir, { recursive: true, force: true });
    }
  });

  it("returns a per-file diff against baseline", async () => {
    await writeFile(join(repoDir, "sample.ts"), "export const value = 2;\n");

    const diff = await getSessionReviewDiff({
      sessionId: "sess-1",
      workspacePath: repoDir,
      metadataRepo: repo,
      path: "sample.ts",
    });

    expect(diff).toContain("-export const value = 1;");
    expect(diff).toContain("+export const value = 2;");
  });
});
