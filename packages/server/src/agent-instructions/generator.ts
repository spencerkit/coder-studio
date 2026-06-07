import type { WorkspaceIntelligenceSummary } from "@coder-studio/core";

const WORKFLOW_EXPECTATIONS = [
  "Keep changes focused on the requested task.",
  "Do not revert user changes unless explicitly asked.",
  "Prefer the project's existing patterns.",
  "Run the relevant verification command before reporting completion.",
] as const;

const REVIEW_CHECKLIST = [
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
  pushSection(lines, "Architecture Map", buildArchitectureMap(summary));
  pushSection(lines, "Key Directories", buildKeyDirectories(summary));
  pushSection(lines, "Development Commands", buildDevelopmentCommands(summary));
  pushSection(lines, "Workflow Expectations", [
    ...WORKFLOW_EXPECTATIONS.map((rule) => `- ${rule}`),
  ]);
  pushSection(lines, "File Constraints", buildFileConstraints(summary));
  pushSection(
    lines,
    "Review Checklist",
    REVIEW_CHECKLIST.map((rule) => `- ${rule}`)
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

  if (summary.workspaceKind) {
    lines.push(`- Workspace kind: ${summary.workspaceKind}`);
  }

  if (summary.frameworks.length > 0) {
    lines.push(`- Frameworks: ${summary.frameworks.join(", ")}`);
  }

  if (summary.docs.length > 0) {
    lines.push(`- Docs: ${summary.docs.map((doc) => doc.path).join(", ")}`);
  }

  lines.push(
    `- ${summary.agentInstructions.path}: ${summary.agentInstructions.exists ? "exists" : "missing"}`
  );

  return lines;
}

function buildArchitectureMap(summary: WorkspaceIntelligenceSummary): string[] {
  const lines: string[] = [];
  const packages = summary.packages ?? [];
  const packagePaths = new Set(packages.map((entry) => entry.path));
  const coderStudioWorkspace = isCoderStudioWorkspace(summary);

  const userFlow = buildUserFlow(packagePaths);
  if (userFlow.length > 0) {
    lines.push("- User-facing change routing:");
    lines.push(...userFlow.map((line) => `  - ${line}`));
  }

  const runtimeFlow = buildRuntimeFlow(packagePaths);
  if (runtimeFlow.length > 0) {
    lines.push("- Runtime and integration flow:");
    lines.push(...runtimeFlow.map((line) => `  - ${line}`));
  }

  if (packages.length > 0) {
    lines.push("- Package responsibilities:");
    for (const entry of packages.slice(0, 6)) {
      lines.push(`  - \`${entry.path}\`: ${describePackageRole(entry.role)}`);
    }
  }

  if (coderStudioWorkspace) {
    lines.push("- Common source entrypoints:");
    lines.push(
      "  - Workspace and UI-triggered actions usually start in `packages/web/src/features/workspace/actions/`, then cross into `packages/server/src/ws/dispatch.ts` and `packages/server/src/commands/*.ts`."
    );
    lines.push(
      "  - Agent-instructions work usually starts in `packages/web/src/features/workspace/actions/use-agent-instructions-actions.ts`, then flows through `packages/server/src/commands/agent-instructions.ts`, `packages/server/src/agent-instructions/agent-generator.ts`, `prompt.ts`, and `workspace/intelligence.ts`."
    );
    lines.push(
      "  - Provider behavior usually starts in `packages/providers/src/*/definition.ts` and the provider-specific headless/supervisor builders, then runs through `packages/server/src/provider-runtime/command-runner.ts`."
    );
    lines.push(
      "  - Shared contract changes usually start in `packages/core/src/domain/types.ts` and `packages/core/src/provider/definition.ts` before validating downstream server/web/provider consumers."
    );
  }

  const documentationMap = buildDocumentationMap(summary);
  if (documentationMap.length > 0) {
    lines.push("- Documentation entrypoints:");
    for (const entry of documentationMap) {
      lines.push(`  - ${entry}`);
    }
  }

  if (lines.length > 0) {
    return lines;
  }

  if ((summary.topLevelDirectories?.length ?? 0) > 0) {
    return summary.topLevelDirectories!.slice(0, 6).map((directory) => `- \`${directory}/\``);
  }

  return ["- No package structure inferred from the workspace."];
}

function buildKeyDirectories(summary: WorkspaceIntelligenceSummary): string[] {
  const keyDirectories = summary.keyDirectories ?? [];
  if (keyDirectories.length === 0) {
    return ["- No key directories inferred from the workspace."];
  }

  return keyDirectories.map((entry) => `- \`${entry.path}\`: ${entry.reason}`);
}

function buildDevelopmentCommands(summary: WorkspaceIntelligenceSummary): string[] {
  const lines: string[] = [];

  for (const entry of summary.verificationCommands ?? []) {
    lines.push(
      `- ${formatCommandLabel(entry.priority)}: \`${entry.command}\` - ${describeCommandReason(entry)}`
    );
  }

  for (const key of ["dev", "test", "build", "lint"] as const) {
    const entry = summary.recommendedCommands.find((item) => item.key === key);
    if (!entry || lines.some((line) => line.includes(`\`${entry.command}\``))) {
      continue;
    }

    lines.push(
      `- ${formatRecommendedCommandLabel(key)}: \`${entry.command}\` - ${describeRecommendedCommandReason(key)}`
    );
  }

  return lines.length > 0 ? lines : ["- No project commands were inferred."];
}

function buildFileConstraints(summary: WorkspaceIntelligenceSummary): string[] {
  if ((summary.fileConstraints?.length ?? 0) > 0) {
    return summary.fileConstraints!.map((constraint) => `- ${constraint}`);
  }

  return [
    "- Keep edits scoped to the requested task.",
    "- Follow the conventions of the package or directory you are touching.",
  ];
}

function formatCommandLabel(priority: "verification" | "quality" | "dev"): string {
  switch (priority) {
    case "verification":
      return "Verify";
    case "quality":
      return "Quality";
    case "dev":
    default:
      return "Dev";
  }
}

function formatRecommendedCommandLabel(key: "dev" | "test" | "build" | "lint"): string {
  switch (key) {
    case "dev":
      return "Dev";
    case "test":
      return "Test";
    case "build":
      return "Build";
    case "lint":
    default:
      return "Lint";
  }
}

function describePackageRole(
  role: NonNullable<WorkspaceIntelligenceSummary["packages"]>[number]["role"]
): string {
  switch (role) {
    case "frontend_ui":
      return "Owns UI, interaction flows, and client-side state orchestration.";
    case "backend_runtime":
      return "Owns commands, runtime behavior, workspace logic, and server-side orchestration.";
    case "provider_integrations":
      return "Owns provider definitions, headless scenarios, and external runtime adapters.";
    case "shared_contracts":
      return "Owns shared contracts, protocol shapes, and cross-package types.";
    case "cli_entrypoint":
      return "Owns CLI entrypoints and launcher behavior.";
    case "shared_utilities":
      return "Owns reusable helpers that should stay free of package-specific policy.";
    case "shared_package":
    default:
      return "Supporting shared package; follow local patterns before broadening scope.";
  }
}

function buildUserFlow(packagePaths: Set<string>): string[] {
  const lines: string[] = [];

  if (packagePaths.has("packages/web") && packagePaths.has("packages/server")) {
    lines.push(
      "UI and interaction changes usually start in `packages/web`, then cross into `packages/server` when they need commands, persistence, or runtime side effects."
    );
  }

  if (packagePaths.has("packages/web") && packagePaths.has("packages/core")) {
    lines.push(
      "If a UI change requires new shared data shapes, update `packages/core` deliberately and then verify downstream consumers in web/server/providers."
    );
  }

  return lines;
}

function buildRuntimeFlow(packagePaths: Set<string>): string[] {
  const lines: string[] = [];

  if (packagePaths.has("packages/server")) {
    let serverFlow =
      "`packages/server` is the orchestration layer for commands, runtime workflows, and workspace behavior";
    if (packagePaths.has("packages/providers")) {
      serverFlow += "; provider-backed behavior usually continues into `packages/providers`.";
    } else {
      serverFlow += ".";
    }
    lines.push(serverFlow);
  }

  if (packagePaths.has("packages/cli")) {
    lines.push(
      "CLI and launcher behavior should start in `packages/cli`; only drop into server/core when the entrypoint needs shared runtime logic."
    );
  }

  if (packagePaths.has("packages/providers")) {
    lines.push(
      "Provider-specific behavior belongs in `packages/providers`; avoid pushing provider adapters or headless scenario rules into UI packages."
    );
  }

  return lines;
}

function buildDocumentationMap(summary: WorkspaceIntelligenceSummary): string[] {
  const documentationEntries = summary.documentationEntries ?? [];
  if (documentationEntries.length === 0) {
    return summary.docs.map((entry) => `\`${entry.path}\`: general repository documentation.`);
  }

  return documentationEntries.slice(0, 4).map((entry) => {
    return `\`${entry.path}\`: ${describeDocumentationPurpose(entry.path)}`;
  });
}

function describeDocumentationPurpose(path: string): string {
  if (path.includes("app-overview")) {
    return "start here for product and application structure.";
  }
  if (path.includes("cli")) {
    return "use for CLI flows and command behavior.";
  }
  if (path.includes("provider")) {
    return "use for provider setup and integration behavior.";
  }
  if (path.includes("desktop")) {
    return "use for desktop-specific UX and runtime behavior.";
  }
  if (path.includes("mobile")) {
    return "use for mobile-specific UX behavior.";
  }
  if (path === "README.md") {
    return "start here for repository orientation.";
  }

  return "project documentation relevant to implementation details.";
}

function describeCommandReason(
  entry: NonNullable<WorkspaceIntelligenceSummary["verificationCommands"]>[number]
): string {
  if (entry.command.includes("ci:verify")) {
    return "full repository verification before handoff";
  }
  if (entry.command.includes("ci:test")) {
    return "main automated test entrypoint";
  }
  if (entry.command.includes("typecheck")) {
    return "cross-package type validation";
  }
  if (entry.command.includes("build")) {
    return "build validation for affected packages";
  }
  if (entry.command.includes("lint")) {
    return "repository lint checks";
  }
  if (entry.command.includes("acceptance")) {
    return "acceptance coverage when UI behavior changes";
  }

  return entry.reason.charAt(0).toLowerCase() + entry.reason.slice(1);
}

function describeRecommendedCommandReason(key: "dev" | "test" | "build" | "lint"): string {
  switch (key) {
    case "dev":
      return "local development entrypoint";
    case "test":
      return "package-level test entrypoint";
    case "build":
      return "package-level build entrypoint";
    case "lint":
    default:
      return "package-level lint entrypoint";
  }
}

function isCoderStudioWorkspace(summary: WorkspaceIntelligenceSummary): boolean {
  return (summary.packages ?? []).some((entry) => entry.name?.startsWith("@coder-studio/"));
}

function pushSection(lines: string[], heading: string, body: string[]): void {
  lines.push(`## ${heading}`, "");
  lines.push(...body);
  lines.push("");
}
