import type { WorkspaceIntelligenceSummary } from "@coder-studio/core";

const WORKING_RULES = [
  "Keep changes focused on the requested task.",
  "Do not revert user changes unless explicitly asked.",
  "Prefer the project's existing patterns.",
  "Run the relevant verification command before reporting completion.",
] as const;

const REVIEW_EXPECTATIONS = [
  "Summarize changed files.",
  "Report verification commands and results.",
  "Call out risks, skipped tests, and assumptions.",
] as const;

const PROVIDER_NOTES = [
  "Claude Code: use the project rules above.",
  "Codex: use the project rules above.",
] as const;

export function buildAgentInstructionsMarkdown(summary: WorkspaceIntelligenceSummary): string {
  const lines: string[] = ["# Agent Instructions", ""];

  pushSection(lines, "Project Overview", buildProjectOverview(summary));
  pushSection(lines, "Development Commands", buildDevelopmentCommands(summary));
  pushSection(lines, "Working Rules", [...WORKING_RULES.map((rule) => `- ${rule}`)]);
  pushSection(
    lines,
    "Review Expectations",
    REVIEW_EXPECTATIONS.map((rule) => `- ${rule}`)
  );
  pushSection(
    lines,
    "Provider Notes",
    PROVIDER_NOTES.map((note) => `- ${note}`)
  );

  return lines.join("\n");
}

function buildProjectOverview(summary: WorkspaceIntelligenceSummary): string[] {
  const lines: string[] = [];

  if (summary.git.isRepo) {
    if (summary.git.branch) {
      lines.push(`- Git branch: ${summary.git.branch}`);
    } else {
      lines.push("- Git repository: yes");
    }
  } else {
    lines.push("- Git repository: no");
  }

  if (summary.packageManager) {
    lines.push(`- Package manager: ${summary.packageManager}`);
  }

  if (summary.frameworks.length > 0) {
    lines.push(`- Frameworks: ${summary.frameworks.join(", ")}`);
  }

  if (summary.docs.length > 0) {
    lines.push(`- Docs: ${summary.docs.map((doc) => doc.path).join(", ")}`);
  }

  lines.push(`- AGENTS.md: ${summary.agentInstructions.exists ? "exists" : "missing"}`);

  return lines;
}

function buildDevelopmentCommands(summary: WorkspaceIntelligenceSummary): string[] {
  const lines: string[] = [];
  const commandLabels: Record<"dev" | "test" | "build" | "lint", string> = {
    dev: "Dev",
    test: "Test",
    build: "Build",
    lint: "Lint",
  };

  for (const key of ["dev", "test", "build", "lint"] as const) {
    const command = summary.recommendedCommands.find((item) => item.key === key)?.command;
    if (!command) {
      continue;
    }

    lines.push(`- ${commandLabels[key]}: \`${command}\``);
  }

  return lines;
}

function pushSection(lines: string[], heading: string, body: string[]): void {
  lines.push(`## ${heading}`, "");
  lines.push(...body);
  lines.push("");
}
