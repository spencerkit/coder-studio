import type { WorkspaceIntelligenceSummary } from "@coder-studio/core";
import { describe, expect, it } from "vitest";
import { buildAgentInstructionsMarkdown } from "../../agent-instructions/generator.js";
import { AGENT_INSTRUCTIONS_RELATIVE_PATH } from "../../workspace/workspace-state.js";

describe("buildAgentInstructionsMarkdown", () => {
  it("builds a deterministic AGENTS.md document from workspace intelligence", () => {
    const summary: WorkspaceIntelligenceSummary = {
      workspaceId: "ws-1",
      rootPath: "/repo",
      git: {
        isRepo: true,
        branch: "main",
      },
      packageManager: "pnpm",
      frameworks: ["React"],
      scripts: {
        dev: "vite",
        test: "vitest run",
        build: undefined,
        lint: undefined,
      },
      recommendedCommands: [
        { key: "dev", command: "pnpm dev", source: "package_json" },
        { key: "test", command: "pnpm test", source: "package_json" },
      ],
      docs: [{ path: "README.md", kind: "readme" }],
      workspaceKind: "monorepo",
      topLevelDirectories: ["docs", "packages"],
      keyDirectories: [
        {
          path: "packages/web",
          kind: "frontend",
          reason: "Primary frontend UI package for user-facing behavior.",
        },
        {
          path: "packages/server",
          kind: "backend",
          reason: "Backend runtime package that owns server-side behavior.",
        },
      ],
      packages: [
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
      ],
      verificationCommands: [
        {
          command: "pnpm ci:verify",
          reason: "Repository-level validation workflow to run before handoff.",
          priority: "verification",
        },
      ],
      fileConstraints: [
        "Respect package boundaries and keep changes scoped to the package you are touching unless cross-package edits are required.",
      ],
      agentInstructions: {
        exists: false,
        path: AGENT_INSTRUCTIONS_RELATIVE_PATH,
      },
    };

    expect(buildAgentInstructionsMarkdown(summary)).toBe(
      [
        "# Agent Instructions",
        "",
        "## Project Overview",
        "",
        "- Git branch: main",
        "- Package manager: pnpm",
        "- Workspace kind: monorepo",
        "- Frameworks: React",
        "- Docs: README.md",
        `- ${AGENT_INSTRUCTIONS_RELATIVE_PATH}: missing`,
        "",
        "## Architecture Map",
        "",
        "- User-facing change routing:",
        "  - UI and interaction changes usually start in `packages/web`, then cross into `packages/server` when they need commands, persistence, or runtime side effects.",
        "- Runtime and integration flow:",
        "  - `packages/server` is the orchestration layer for commands, runtime workflows, and workspace behavior.",
        "- Package responsibilities:",
        "  - `packages/web`: Owns UI, interaction flows, and client-side state orchestration.",
        "  - `packages/server`: Owns commands, runtime behavior, workspace logic, and server-side orchestration.",
        "- Documentation entrypoints:",
        "  - `README.md`: general repository documentation.",
        "",
        "## Key Directories",
        "",
        "- `packages/web`: Primary frontend UI package for user-facing behavior.",
        "- `packages/server`: Backend runtime package that owns server-side behavior.",
        "",
        "## Development Commands",
        "",
        "- Verify: `pnpm ci:verify` - full repository verification before handoff",
        "- Dev: `pnpm dev` - local development entrypoint",
        "- Test: `pnpm test` - package-level test entrypoint",
        "",
        "## Workflow Expectations",
        "",
        "- Keep changes focused on the requested task.",
        "- Do not revert user changes unless explicitly asked.",
        "- Prefer the project's existing patterns.",
        "- Run the relevant verification command before reporting completion.",
        "",
        "## File Constraints",
        "",
        "- Respect package boundaries and keep changes scoped to the package you are touching unless cross-package edits are required.",
        "",
        "## Review Checklist",
        "",
        "- Summarize changed files.",
        "- Report verification commands and results.",
        "- Call out risks, skipped tests, and assumptions.",
        "",
        "## Provider Notes",
        "",
        "- Claude Code: use the project rules above.",
        "- Codex: use the project rules above.",
        "",
      ].join("\n")
    );
  });

  it("adds concrete source entrypoints for coder-studio style workspaces", () => {
    const summary: WorkspaceIntelligenceSummary = {
      workspaceId: "ws-2",
      rootPath: "/repo",
      git: {
        isRepo: true,
      },
      packageManager: "pnpm",
      frameworks: ["Node", "Monorepo"],
      scripts: {
        dev: undefined,
        test: undefined,
        build: undefined,
        lint: undefined,
      },
      recommendedCommands: [],
      docs: [],
      workspaceKind: "monorepo",
      keyDirectories: [],
      packages: [
        {
          path: "packages/web",
          name: "@coder-studio/web",
          role: "frontend_ui",
          scripts: [],
        },
        {
          path: "packages/server",
          name: "@coder-studio/server",
          role: "backend_runtime",
          scripts: [],
        },
        {
          path: "packages/providers",
          name: "@coder-studio/providers",
          role: "provider_integrations",
          scripts: [],
        },
        {
          path: "packages/core",
          name: "@coder-studio/core",
          role: "shared_contracts",
          scripts: [],
        },
      ],
      agentInstructions: {
        exists: false,
        path: AGENT_INSTRUCTIONS_RELATIVE_PATH,
      },
    };

    const content = buildAgentInstructionsMarkdown(summary);

    expect(content).toContain(
      "`packages/web/src/features/workspace/actions/`, then cross into `packages/server/src/ws/dispatch.ts` and `packages/server/src/commands/*.ts`"
    );
    expect(content).toContain(
      "`packages/server/src/commands/agent-instructions.ts`, `packages/server/src/agent-instructions/agent-generator.ts`, `prompt.ts`, and `workspace/intelligence.ts`"
    );
    expect(content).toContain(
      "`packages/core/src/domain/types.ts` and `packages/core/src/provider/definition.ts`"
    );
  });
});
