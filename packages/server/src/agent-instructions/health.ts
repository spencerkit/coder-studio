import type { AgentInstructionsHealth, AgentInstructionsHealthIssue } from "@coder-studio/core";
import { AGENT_INSTRUCTIONS_RELATIVE_PATH } from "../workspace/workspace-state.js";

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

const PROVIDER_NOTE_MARKERS = ["Claude Code:", "Codex:"] as const;

export function evaluateAgentInstructionsMarkdown(content: string): AgentInstructionsHealth {
  if (!content.trim()) {
    return {
      path: AGENT_INSTRUCTIONS_RELATIVE_PATH,
      exists: false,
      status: "missing",
      checks: {
        projectOverview: false,
        developmentCommands: false,
        workingRules: false,
        reviewExpectations: false,
        safetyRules: false,
        providerNotes: false,
      },
      issues: [
        {
          code: "missing_document",
          message: `${AGENT_INSTRUCTIONS_RELATIVE_PATH} is missing`,
        },
      ],
    };
  }

  const sections = indexSections(content);
  const projectOverview = sections.has("Project Overview");
  const developmentCommands = hasAnyBullet(sections.get("Development Commands"));
  const workingRulesSection =
    sections.get("Workflow Expectations") ?? sections.get("Working Rules");
  const reviewExpectationsSection =
    sections.get("Review Checklist") ?? sections.get("Review Expectations");
  const providerNotesSection = sections.get("Provider Notes");
  const workingRules = hasAnyBullet(workingRulesSection);
  const reviewExpectations =
    hasAnyBullet(reviewExpectationsSection) &&
    REQUIRED_REVIEW_CHECKLIST.every((rule) =>
      reviewExpectationsSection?.some((line) => line.includes(rule))
    );
  const providerNotes =
    hasAnyBullet(providerNotesSection) &&
    PROVIDER_NOTE_MARKERS.some((marker) =>
      providerNotesSection?.some((line) => line.includes(marker))
    );
  const safetyRules = REQUIRED_WORKFLOW_EXPECTATIONS.every((rule) =>
    workingRulesSection?.some((line) => line.includes(rule))
  );

  const issues: AgentInstructionsHealthIssue[] = [];
  if (!projectOverview) {
    issues.push({
      code: "missing_project_overview",
      message: "Project Overview section is missing",
    });
  }
  if (!developmentCommands) {
    issues.push({
      code: "missing_development_commands",
      message: "Development Commands section is missing",
    });
  }
  if (!workingRules) {
    issues.push({
      code: "missing_working_rules",
      message: "Workflow Expectations section is missing",
    });
  }
  if (!reviewExpectations) {
    issues.push({
      code: "missing_review_expectations",
      message: "Review Checklist section is missing",
    });
  }
  if (!safetyRules) {
    issues.push({
      code: "missing_safety_rules",
      message: "Workflow expectations do not include the required safety rules",
    });
  }
  if (!providerNotes) {
    issues.push({
      code: "missing_provider_notes",
      message: "Provider Notes section is missing",
    });
  }

  const status: AgentInstructionsHealth["status"] = issues.length === 0 ? "healthy" : "warning";

  return {
    path: AGENT_INSTRUCTIONS_RELATIVE_PATH,
    exists: true,
    status,
    checks: {
      projectOverview,
      developmentCommands,
      workingRules,
      reviewExpectations,
      safetyRules,
      providerNotes,
    },
    issues,
  };
}

function indexSections(content: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  const lines = content.split(/\r?\n/);
  let currentHeading: string | null = null;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/)?.[1];
    if (heading) {
      currentHeading = heading;
      if (!sections.has(heading)) {
        sections.set(heading, []);
      }
      continue;
    }

    if (currentHeading) {
      sections.get(currentHeading)?.push(line);
    }
  }

  return sections;
}

function hasAnyBullet(lines: string[] | undefined): boolean {
  return Boolean(lines?.some((line) => line.trimStart().startsWith("- ")));
}
