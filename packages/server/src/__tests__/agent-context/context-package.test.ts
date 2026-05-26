import { execFile } from "child_process";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildDiffContextPackage,
  buildFileContextPackage,
  buildProjectSummaryContextPackage,
  buildSessionReviewContextPackage,
} from "../../agent-context/context-package.js";
import { SessionMetadataRepo } from "../../storage/repositories/session-metadata-repo.js";
import { WorkspaceRepo } from "../../storage/repositories/workspace-repo.js";
import {
  AGENT_INSTRUCTIONS_RELATIVE_PATH,
  WORKSPACE_STATE_DIR,
} from "../../workspace/workspace-state.js";

const execFileAsync = promisify(execFile);

describe("agent context package builders", () => {
  let metadataRepo: SessionMetadataRepo;
  let repoDir: string;
  let stateDir: string;
  let workspaceRepo: WorkspaceRepo;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "agent-context-"));
    stateDir = await mkdtemp(join(tmpdir(), "agent-context-state-"));
    workspaceRepo = new WorkspaceRepo({
      filePath: join(stateDir, "workspaces.json"),
    });
    workspaceRepo.create({
      id: "ws-1",
      path: repoDir,
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: { leftPanelWidth: 1, bottomPanelHeight: 1, focusMode: false },
    });
    metadataRepo = new SessionMetadataRepo({
      workspaceRepo,
    });

    await execFileAsync("git", ["init"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    await writeFile(join(repoDir, "sample.ts"), "export const value = 1;\n");
    await writeFile(
      join(repoDir, "package.json"),
      JSON.stringify(
        {
          dependencies: {
            react: "^19.0.0",
          },
          devDependencies: {
            vite: "^7.0.0",
          },
          scripts: {
            dev: "vite",
            test: "vitest run",
            build: "vite build",
            lint: "eslint .",
          },
        },
        null,
        2
      )
    );
    await writeFile(join(repoDir, "pnpm-lock.yaml"), "lockfileVersion: 9.0\n");
    await writeFile(join(repoDir, "README.md"), "# Demo\n");
    await mkdir(join(repoDir, "docs"), { recursive: true });
    await mkdir(join(repoDir, WORKSPACE_STATE_DIR), { recursive: true });
    await writeFile(join(repoDir, AGENT_INSTRUCTIONS_RELATIVE_PATH), "# Project\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "Initial commit"], { cwd: repoDir });

    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoDir });

    metadataRepo.upsert({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      providerId: "codex",
      baselineGitHead: stdout.trim(),
      baselineCapturedAt: 1,
      verificationRuns: [],
    });
  });

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true });
    await rm(repoDir, { recursive: true, force: true });
  });

  it("builds a deterministic file context package", async () => {
    const pkg = await buildFileContextPackage(
      {
        workspaceId: "ws-1",
        workspacePath: repoDir,
        path: "README.md",
      },
      {
        createId: () => "ctx-file-1",
        now: () => 111,
      }
    );

    expect(pkg).toEqual({
      id: "ctx-file-1",
      kind: "file",
      title: "File: README.md",
      body: "Context: File: README.md\nSource: workspace=ws-1 path=README.md\n\n# Demo\n",
      source: {
        workspaceId: "ws-1",
        path: "README.md",
      },
      createdAt: 111,
    });
  });

  it("builds a deterministic diff context package from a session baseline", async () => {
    await writeFile(join(repoDir, "sample.ts"), "export const value = 2;\n");

    const pkg = await buildDiffContextPackage(
      {
        sessionId: "sess-1",
        path: "sample.ts",
        workspacePath: repoDir,
        metadataRepo,
      },
      {
        createId: () => "ctx-diff-1",
        now: () => 222,
      }
    );

    expect(pkg.kind).toBe("git_diff");
    expect(pkg.title).toBe("Git Diff: sample.ts");
    expect(pkg.source).toEqual({
      workspaceId: "ws-1",
      path: "sample.ts",
      sessionId: "sess-1",
    });
    expect(pkg.createdAt).toBe(222);
    expect(pkg.body).toContain("Context: Git Diff: sample.ts");
    expect(pkg.body).toContain("Source: workspace=ws-1 session=sess-1 path=sample.ts");
    expect(pkg.body).toContain("-export const value = 1;");
    expect(pkg.body).toContain("+export const value = 2;");
  });

  it("builds a deterministic project summary context package", async () => {
    const pkg = await buildProjectSummaryContextPackage(
      {
        workspaceId: "ws-1",
        workspacePath: repoDir,
      },
      {
        createId: () => "ctx-project-1",
        now: () => 333,
      }
    );

    expect(pkg).toEqual({
      id: "ctx-project-1",
      kind: "project_summary",
      title: "Project Summary",
      body: [
        "Context: Project Summary",
        "Source: workspace=ws-1",
        "",
        "Git: repository detected",
        "Package manager: pnpm",
        "Frameworks: React, Vite, Node",
        "Recommended commands:",
        "- dev: pnpm dev",
        "- test: pnpm test",
        "- build: pnpm build",
        "- lint: pnpm lint",
        "Docs:",
        "- README.md",
        "- docs",
        `Agent instructions: ${AGENT_INSTRUCTIONS_RELATIVE_PATH} present`,
      ].join("\n"),
      source: {
        workspaceId: "ws-1",
      },
      createdAt: 333,
    });
  });

  it("builds a deterministic session review context package", async () => {
    await writeFile(join(repoDir, "sample.ts"), "export const value = 2;\n");
    metadataRepo.addVerificationRun("sess-1", {
      id: "verify-1",
      command: "pnpm test",
      status: "passed",
      createdAt: 44,
    });

    const pkg = await buildSessionReviewContextPackage(
      {
        sessionId: "sess-1",
        workspacePath: repoDir,
        metadataRepo,
      },
      {
        createId: () => "ctx-review-1",
        now: () => 444,
      }
    );

    expect(pkg.kind).toBe("session_review");
    expect(pkg.title).toBe("Session Review: sess-1");
    expect(pkg.source).toEqual({
      workspaceId: "ws-1",
      sessionId: "sess-1",
    });
    expect(pkg.createdAt).toBe(444);
    expect(pkg.body).toContain("Context: Session Review: sess-1");
    expect(pkg.body).toContain("Source: workspace=ws-1 session=sess-1");
    expect(pkg.body).toContain("Changed files:");
    expect(pkg.body).toContain("- modified: sample.ts");
    expect(pkg.body).toContain("Verification runs:");
    expect(pkg.body).toContain("- passed: pnpm test");
  });
});
