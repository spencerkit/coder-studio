import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectWorkspaceIntelligence } from "../../workspace/intelligence.js";

describe("inspectWorkspaceIntelligence", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map(async (dir) => {
        try {
          await import("node:fs/promises").then(({ rm }) =>
            rm(dir, { recursive: true, force: true })
          );
        } catch {
          // Ignore temp cleanup failures in tests.
        }
      })
    );
  });

  it("summarizes git, package scripts, frameworks, docs, and AGENTS.md", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "workspace-intelligence-"));
    tempDirs.push(rootPath);

    await mkdir(join(rootPath, ".git"), { recursive: true });
    await writeFile(join(rootPath, ".git", "HEAD"), "ref: refs/heads/feature/agentic\n");
    await writeFile(
      join(rootPath, "package.json"),
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
    await writeFile(join(rootPath, "pnpm-lock.yaml"), "lockfileVersion: 9.0\n");
    await writeFile(join(rootPath, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    await writeFile(join(rootPath, "README.md"), "# Workspace\n");
    await mkdir(join(rootPath, "docs"), { recursive: true });
    await writeFile(join(rootPath, "AGENTS.md"), "# Instructions\n");

    const summary = await inspectWorkspaceIntelligence({
      workspaceId: "ws-1",
      rootPath,
    });

    expect(summary).toEqual({
      workspaceId: "ws-1",
      rootPath,
      git: {
        isRepo: true,
        branch: "feature/agentic",
      },
      packageManager: "pnpm",
      frameworks: ["React", "Vite", "Node", "Monorepo"],
      scripts: {
        dev: "vite",
        test: "vitest run",
        build: "vite build",
        lint: "eslint .",
      },
      recommendedCommands: [
        { key: "dev", command: "pnpm dev", source: "package_json" },
        { key: "test", command: "pnpm test", source: "package_json" },
        { key: "build", command: "pnpm build", source: "package_json" },
        { key: "lint", command: "pnpm lint", source: "package_json" },
      ],
      docs: [
        { path: "README.md", kind: "readme" },
        { path: "docs", kind: "docs" },
      ],
      agentInstructions: {
        exists: true,
        path: "AGENTS.md",
      },
    });
  });

  it("handles non-git folders without package.json", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "workspace-intelligence-plain-"));
    tempDirs.push(rootPath);

    await mkdir(join(rootPath, "docs"), { recursive: true });

    const summary = await inspectWorkspaceIntelligence({
      workspaceId: "ws-plain",
      rootPath,
    });

    expect(summary).toEqual({
      workspaceId: "ws-plain",
      rootPath,
      git: {
        isRepo: false,
      },
      packageManager: undefined,
      frameworks: [],
      scripts: {
        dev: undefined,
        test: undefined,
        build: undefined,
        lint: undefined,
      },
      recommendedCommands: [],
      docs: [{ path: "docs", kind: "docs" }],
      agentInstructions: {
        exists: false,
        path: "AGENTS.md",
      },
    });
  });

  it("reads branch metadata from a worktree-style .git file", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "workspace-intelligence-worktree-"));
    tempDirs.push(rootPath);

    const gitDir = join(rootPath, ".git-data", "worktrees", "feature-agentic");
    await mkdir(gitDir, { recursive: true });
    await writeFile(join(gitDir, "HEAD"), "ref: refs/heads/review/phase-3\n");
    await writeFile(join(rootPath, ".git"), "gitdir: .git-data/worktrees/feature-agentic\n");

    const summary = await inspectWorkspaceIntelligence({
      workspaceId: "ws-worktree",
      rootPath,
    });

    expect(summary.git).toEqual({
      isRepo: true,
      branch: "review/phase-3",
    });
  });
});
