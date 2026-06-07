import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectWorkspaceIntelligence } from "../../workspace/intelligence.js";
import {
  AGENT_INSTRUCTIONS_RELATIVE_PATH,
  WORKSPACE_STATE_DIR,
} from "../../workspace/workspace-state.js";

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
    await mkdir(join(rootPath, WORKSPACE_STATE_DIR), { recursive: true });
    await writeFile(join(rootPath, AGENT_INSTRUCTIONS_RELATIVE_PATH), "# Instructions\n");

    const summary = await inspectWorkspaceIntelligence({
      workspaceId: "ws-1",
      rootPath,
    });

    expect(summary).toMatchObject({
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
        path: AGENT_INSTRUCTIONS_RELATIVE_PATH,
      },
    });
    expect(summary.workspaceKind).toBe("monorepo");
    expect(summary.topLevelDirectories).toEqual([".coder-studio", "docs"]);
  });

  it("handles non-git folders without package.json", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "workspace-intelligence-plain-"));
    tempDirs.push(rootPath);

    await mkdir(join(rootPath, "docs"), { recursive: true });

    const summary = await inspectWorkspaceIntelligence({
      workspaceId: "ws-plain",
      rootPath,
    });

    expect(summary).toMatchObject({
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
        path: AGENT_INSTRUCTIONS_RELATIVE_PATH,
      },
    });
    expect(summary.workspaceKind).toBe("unknown");
    expect(summary.topLevelDirectories).toEqual(["docs"]);
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

  it("infers a monorepo architecture summary with key directories and stronger verification commands", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "workspace-intelligence-rich-"));
    tempDirs.push(rootPath);

    await writeFile(join(rootPath, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    await writeFile(
      join(rootPath, "package.json"),
      JSON.stringify(
        {
          scripts: {
            dev: "tsx scripts/dev.ts",
            build: "tsx scripts/build.ts",
            lint: "biome lint .",
            "ci:test": "pnpm -r test",
            "ci:typecheck": "pnpm -r exec tsc -p tsconfig.json --noEmit",
            "ci:verify": "pnpm ci:test && pnpm ci:typecheck",
            "acceptance:phase1": "pnpm --dir e2e exec playwright test --grep @phase1",
          },
        },
        null,
        2
      )
    );
    await writeFile(join(rootPath, "README.md"), "# Repo\n");
    await mkdir(join(rootPath, "docs", "help"), { recursive: true });
    await writeFile(join(rootPath, "docs", "help", "quick-start.md"), "# Quick Start\n");
    await mkdir(join(rootPath, "packages", "web"), { recursive: true });
    await writeFile(
      join(rootPath, "packages", "web", "package.json"),
      JSON.stringify({ name: "@repo/web", scripts: { test: "vitest run" } })
    );
    await mkdir(join(rootPath, "packages", "server"), { recursive: true });
    await writeFile(
      join(rootPath, "packages", "server", "package.json"),
      JSON.stringify({ name: "@repo/server" })
    );

    const summary = await inspectWorkspaceIntelligence({
      workspaceId: "ws-1",
      rootPath,
    });

    expect(summary).toMatchObject({
      workspaceKind: "monorepo",
      keyDirectories: [
        {
          path: "packages/web",
          kind: "frontend",
          reason: expect.any(String),
        },
        {
          path: "packages/server",
          kind: "backend",
          reason: expect.any(String),
        },
        {
          path: "docs",
          kind: "docs",
          reason: expect.any(String),
        },
      ],
      packages: expect.arrayContaining([
        {
          path: "packages/web",
          name: "@repo/web",
          role: "frontend_ui",
          scripts: ["test"],
        },
        {
          path: "packages/server",
          name: "@repo/server",
          role: "backend_runtime",
          scripts: [],
        },
      ]),
      verificationCommands: expect.arrayContaining([
        {
          command: "pnpm ci:test",
          reason: expect.any(String),
          priority: "verification",
        },
        {
          command: "pnpm ci:typecheck",
          reason: expect.any(String),
          priority: "quality",
        },
        {
          command: "pnpm ci:verify",
          reason: expect.any(String),
          priority: "verification",
        },
      ]),
      fileConstraints: expect.arrayContaining([
        expect.stringContaining("package boundaries"),
        expect.stringContaining("unrelated refactors"),
      ]),
    });
  });

  it("caps key directories and skips noisy root folders", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "workspace-intelligence-noise-"));
    tempDirs.push(rootPath);

    await writeFile(join(rootPath, "package.json"), JSON.stringify({ scripts: {} }));
    await mkdir(join(rootPath, "packages", "core"), { recursive: true });
    await writeFile(
      join(rootPath, "packages", "core", "package.json"),
      JSON.stringify({ name: "@repo/core" })
    );
    await mkdir(join(rootPath, "packages", "providers"), { recursive: true });
    await writeFile(
      join(rootPath, "packages", "providers", "package.json"),
      JSON.stringify({ name: "@repo/providers" })
    );
    await mkdir(join(rootPath, "node_modules"), { recursive: true });
    await mkdir(join(rootPath, ".git"), { recursive: true });
    await mkdir(join(rootPath, "scripts"), { recursive: true });
    await mkdir(join(rootPath, "e2e"), { recursive: true });

    const summary = await inspectWorkspaceIntelligence({
      workspaceId: "ws-noise",
      rootPath,
    });

    expect(summary.keyDirectories?.length).toBeLessThanOrEqual(6);
    expect(summary.keyDirectories?.map((entry) => entry.path)).not.toContain("node_modules");
    expect(summary.topLevelDirectories).not.toContain(".git");
  });
});
