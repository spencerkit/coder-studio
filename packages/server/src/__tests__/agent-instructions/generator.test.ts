import type { WorkspaceIntelligenceSummary } from "@coder-studio/core";
import { describe, expect, it } from "vitest";
import { buildAgentInstructionsMarkdown } from "../../agent-instructions/generator.js";

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
      agentInstructions: {
        exists: false,
        path: "AGENTS.md",
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
        "- Frameworks: React",
        "- Docs: README.md",
        "- AGENTS.md: missing",
        "",
        "## Development Commands",
        "",
        "- Dev: `pnpm dev`",
        "- Test: `pnpm test`",
        "",
        "## Working Rules",
        "",
        "- Keep changes focused on the requested task.",
        "- Do not revert user changes unless explicitly asked.",
        "- Prefer the project's existing patterns.",
        "- Run the relevant verification command before reporting completion.",
        "",
        "## Review Expectations",
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
});
