import type { WorkspaceIntelligenceSummary } from "@coder-studio/core";

const REQUIRED_WORKFLOW_EXPECTATIONS = [
  "Keep changes focused on the requested task.",
  "Do not revert user changes unless explicitly asked.",
  "Prefer the project's existing patterns.",
  "Run the relevant verification command before reporting completion.",
  "Use the built-in `coder-studio-session-activity` skill to record meaningful session activity when plans change, important commands finish, important edits complete, or you reach a review checkpoint.",
] as const;

const REQUIRED_REVIEW_CHECKLIST = [
  "Summarize changed files.",
  "Report verification commands and results.",
  "Call out risks, skipped tests, and assumptions.",
] as const;

const REQUIRED_PROVIDER_NOTES = [
  "Claude Code: use the project rules above.",
  "Codex: use the project rules above.",
] as const;

export function buildAgentInstructionsGenerationPrompt(
  summary: WorkspaceIntelligenceSummary
): string {
  return [
    "You are generating a workspace-local agent instructions document.",
    "Return exactly one JSON object and nothing else.",
    "Do not wrap the JSON in code fences.",
    "Do not add commentary, explanation, or preamble.",
    "The JSON must follow this shape:",
    "{",
    '  "ok": true,',
    '  "content": "<full markdown document>"',
    "}",
    "If you cannot produce a reliable document from the provided facts, return:",
    "{",
    '  "ok": false,',
    '  "error": "<short reason>"',
    "}",
    "Rules for `content`:",
    "- It must be a complete Markdown document.",
    "- The first line must be exactly: # Agent Instructions",
    "Use exactly these second-level sections in this order:",
    "- Project Overview",
    "- Architecture Map",
    "- Key Directories",
    "- Development Commands",
    "- Workflow Expectations",
    "- File Constraints",
    "- Review Checklist",
    "- Provider Notes",
    "Do not add other sections.",
    "Do not invent commands, tools, frameworks, or workflows that are not supported by the provided workspace facts.",
    "If a command is unknown, omit it instead of guessing.",
    "Keep the document concise, concrete, and project-specific.",
    "Under 'Architecture Map', use a pure Markdown hierarchy only. Do not use Mermaid or code fences.",
    "Under 'Architecture Map', optimize for change routing rather than directory listing.",
    "Explain where an agent should usually start for UI changes, server/runtime changes, provider changes, shared-type changes, and CLI changes when the workspace facts support it.",
    "Prefer responsibility boundaries and call-flow guidance over flat package dumps.",
    "When the repository exposes recognizable source entrypoints, include representative file paths or folders that an agent should inspect first for each major workflow.",
    "Prefer concrete call chains such as web action hook -> ws dispatch -> server command -> provider/runtime layer when those paths are supported by the repository.",
    "If representative source entrypoints are provided in the workspace context, include them explicitly in the Architecture Map instead of collapsing them into package-only summaries.",
    "Under 'Key Directories', include only 3-6 items with one-line reasons.",
    "Under 'Development Commands', include at most 6 real commands, prioritizing repository-level verify/test/typecheck/build commands before local helper commands.",
    "Exclude report-only or baseline-update helper commands unless they are the primary verification entrypoint.",
    "Under 'Development Commands', prefer bullets in the form `- <label>: <command> - <when to use it>`.",
    "Under 'File Constraints', explain package boundaries in repository-specific terms when package roles are available.",
    "Use the file constraints to call out what should stay in web vs server vs provider vs shared-contract packages when the workspace facts support it.",
    "When documentation entries are available, identify which docs help with product overview, CLI behavior, provider integrations, or platform-specific behavior.",
    "Under 'Workflow Expectations', include these exact bullets:",
    ...REQUIRED_WORKFLOW_EXPECTATIONS.map((rule) => `- ${rule}`),
    "Under 'Review Checklist', include these exact bullets:",
    ...REQUIRED_REVIEW_CHECKLIST.map((rule) => `- ${rule}`),
    "Under 'Provider Notes', include these exact bullets:",
    ...REQUIRED_PROVIDER_NOTES.map((note) => `- ${note}`),
    "Use the workspace context below to write the document.",
    "Do not invent package roles, file constraints, or commands that are not supported by the workspace context.",
    "",
    "Workspace context:",
    ...buildWorkspaceContext(summary),
  ].join("\n");
}

function buildWorkspaceContext(summary: WorkspaceIntelligenceSummary): string[] {
  const lines = [
    `- Workspace root: ${summary.rootPath}`,
    summary.git.isRepo
      ? summary.git.branch
        ? `- Git branch: ${summary.git.branch}`
        : "- Git repository: yes"
      : "- Git repository: no",
    `- Agent instructions file ${summary.agentInstructions.path}: ${
      summary.agentInstructions.exists ? "exists" : "missing"
    }`,
  ];

  if (summary.packageManager) {
    lines.push(`- Package manager: ${summary.packageManager}`);
  }

  if (summary.frameworks.length > 0) {
    lines.push(`- Frameworks: ${summary.frameworks.join(", ")}`);
  }

  if (summary.workspaceKind) {
    lines.push(`- Workspace kind: ${summary.workspaceKind}`);
  }

  if (summary.docs.length > 0) {
    lines.push(`- Docs: ${summary.docs.map((doc) => `${doc.path} (${doc.kind})`).join(", ")}`);
  }

  if ((summary.documentationEntries?.length ?? 0) > 0) {
    lines.push(
      `- Documentation entries: ${summary
        .documentationEntries!.map((entry) => `${entry.path} (${entry.kind})`)
        .join(", ")}`
    );
  }

  if (summary.recommendedCommands.length > 0) {
    lines.push("- Recommended commands:");
    for (const command of summary.recommendedCommands) {
      lines.push(`  - ${command.key}: ${command.command}`);
    }
  }

  if ((summary.verificationCommands?.length ?? 0) > 0) {
    lines.push("- Verification commands:");
    for (const command of summary.verificationCommands!) {
      lines.push(`  - ${command.priority}: ${command.command} (${command.reason})`);
    }
  }

  if ((summary.packages?.length ?? 0) > 0) {
    lines.push("- Packages:");
    for (const entry of summary.packages!) {
      lines.push(
        `  - ${entry.path}${entry.name ? ` [${entry.name}]` : ""}: ${entry.role}${
          entry.scripts.length > 0 ? `; scripts=${entry.scripts.join(",")}` : ""
        }`
      );
    }
  }

  if ((summary.keyDirectories?.length ?? 0) > 0) {
    lines.push("- Key directories:");
    for (const entry of summary.keyDirectories!) {
      lines.push(`  - ${entry.path} (${entry.kind}): ${entry.reason}`);
    }
  }

  if ((summary.fileConstraints?.length ?? 0) > 0) {
    lines.push("- File constraints:");
    for (const constraint of summary.fileConstraints!) {
      lines.push(`  - ${constraint}`);
    }
  }

  if (isCoderStudioWorkspace(summary)) {
    lines.push("- Representative source entrypoints:");
    lines.push(
      "  - UI/workspace actions: packages/web/src/features/workspace/actions/ -> packages/server/src/ws/dispatch.ts -> packages/server/src/commands/*.ts"
    );
    lines.push(
      "  - Agent instructions generation: packages/web/src/features/workspace/actions/use-agent-instructions-actions.ts -> packages/server/src/commands/agent-instructions.ts -> packages/server/src/agent-instructions/agent-generator.ts -> packages/server/src/agent-instructions/prompt.ts -> packages/server/src/workspace/intelligence.ts"
    );
    lines.push(
      "  - Provider execution: packages/providers/src/*/definition.ts + provider-specific headless/supervisor builders -> packages/server/src/provider-runtime/command-runner.ts"
    );
    lines.push(
      "  - Shared contracts: packages/core/src/domain/types.ts + packages/core/src/provider/definition.ts"
    );
  }

  return lines;
}

function isCoderStudioWorkspace(summary: WorkspaceIntelligenceSummary): boolean {
  return (summary.packages ?? []).some((entry) => entry.name?.startsWith("@coder-studio/"));
}
