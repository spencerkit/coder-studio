import { describe, expect, it } from "vitest";
import { evaluateAgentInstructionsMarkdown } from "../../agent-instructions/health.js";

describe("evaluateAgentInstructionsMarkdown", () => {
  it("flags missing instruction sections", () => {
    const result = evaluateAgentInstructionsMarkdown(
      [
        "# Agent Instructions",
        "",
        "## Project Overview",
        "",
        "- Git branch: main",
        "",
        "## Development Commands",
        "",
        "- Dev: `pnpm dev`",
        "",
        "## Working Rules",
        "",
        "- Keep changes focused on the requested task.",
        "",
        "## Provider Notes",
        "",
        "- Claude Code: use the project rules above.",
        "",
      ].join("\n")
    );

    expect(result.status).toBe("warning");
    expect(result.checks).toEqual({
      projectOverview: true,
      developmentCommands: true,
      workingRules: true,
      reviewExpectations: false,
      safetyRules: false,
      providerNotes: true,
    });
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "missing_review_expectations",
      "missing_safety_rules",
    ]);
  });

  it("accepts a complete generated document", () => {
    const result = evaluateAgentInstructionsMarkdown(
      [
        "# Agent Instructions",
        "",
        "## Project Overview",
        "",
        "- Git branch: main",
        "- Package manager: pnpm",
        "",
        "## Development Commands",
        "",
        "- Dev: `pnpm dev`",
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

    expect(result.status).toBe("healthy");
    expect(result.issues).toEqual([]);
  });
});
