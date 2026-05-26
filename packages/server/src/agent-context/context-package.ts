import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AgentContextPackage } from "@coder-studio/core";
import { resolveSafe } from "../fs/file-io.js";
import { buildSessionReviewSummary, getSessionReviewDiff } from "../session-review/review.js";
import { SessionMetadataRepo } from "../storage/repositories/session-metadata-repo.js";
import { inspectWorkspaceIntelligence } from "../workspace/intelligence.js";

interface ContextPackageOptions {
  createId?: () => string;
  now?: () => number;
}

interface FileContextInput {
  workspaceId: string;
  workspacePath: string;
  path: string;
}

interface ProjectSummaryContextInput {
  workspaceId: string;
  workspacePath: string;
}

interface SessionScopedContextInput {
  sessionId: string;
  workspacePath: string;
  metadataRepo: SessionMetadataRepo;
}

interface DiffContextInput extends SessionScopedContextInput {
  path: string;
}

function resolveOptions(
  options: ContextPackageOptions | undefined
): Required<ContextPackageOptions> {
  return {
    createId: options?.createId ?? randomUUID,
    now: options?.now ?? Date.now,
  };
}

function formatSource(source: AgentContextPackage["source"]): string {
  const parts = [`workspace=${source.workspaceId}`];

  if (source.sessionId) {
    parts.push(`session=${source.sessionId}`);
  }

  if (source.path) {
    parts.push(`path=${source.path}`);
  }

  if (source.terminalId) {
    parts.push(`terminal=${source.terminalId}`);
  }

  return parts.join(" ");
}

function wrapContext(title: string, source: AgentContextPackage["source"], body: string): string {
  return `Context: ${title}\nSource: ${formatSource(source)}\n\n${body}`;
}

function createContextPackage(
  kind: AgentContextPackage["kind"],
  title: string,
  source: AgentContextPackage["source"],
  body: string,
  options?: ContextPackageOptions
): AgentContextPackage {
  const resolved = resolveOptions(options);
  return {
    id: resolved.createId(),
    kind,
    title,
    body: wrapContext(title, source, body),
    source,
    createdAt: resolved.now(),
  };
}

function requireSessionMetadata(
  metadataRepo: SessionMetadataRepo,
  sessionId: string
): { sessionId: string; workspaceId: string } {
  const metadata = metadataRepo.get(sessionId);
  if (!metadata) {
    throw {
      code: "session_metadata_not_found",
      message: `Session metadata not found: ${sessionId}`,
    };
  }

  return metadata;
}

function buildProjectSummaryBody(
  summary: Awaited<ReturnType<typeof inspectWorkspaceIntelligence>>
): string {
  const lines = [
    `Git: ${summary.git.isRepo ? "repository detected" : "no repository detected"}`,
    `Package manager: ${summary.packageManager ?? "unknown"}`,
    `Frameworks: ${summary.frameworks.length > 0 ? summary.frameworks.join(", ") : "none"}`,
  ];

  if (summary.recommendedCommands.length > 0) {
    lines.push("Recommended commands:");
    for (const command of summary.recommendedCommands) {
      lines.push(`- ${command.key}: ${command.command}`);
    }
  } else {
    lines.push("Recommended commands: none");
  }

  if (summary.docs.length > 0) {
    lines.push("Docs:");
    for (const doc of summary.docs) {
      lines.push(`- ${doc.path}`);
    }
  } else {
    lines.push("Docs: none");
  }

  lines.push(
    `Agent instructions: ${summary.agentInstructions.exists ? "AGENTS.md present" : "AGENTS.md missing"}`
  );

  return lines.join("\n");
}

export async function buildFileContextPackage(
  input: FileContextInput,
  options?: ContextPackageOptions
): Promise<AgentContextPackage> {
  const content = await readFile(resolveSafe(input.workspacePath, input.path), "utf8");
  return createContextPackage(
    "file",
    `File: ${input.path}`,
    {
      workspaceId: input.workspaceId,
      path: input.path,
    },
    content,
    options
  );
}

export async function buildDiffContextPackage(
  input: DiffContextInput,
  options?: ContextPackageOptions
): Promise<AgentContextPackage> {
  const metadata = requireSessionMetadata(input.metadataRepo, input.sessionId);
  const diff = await getSessionReviewDiff({
    sessionId: input.sessionId,
    workspacePath: input.workspacePath,
    metadataRepo: input.metadataRepo,
    path: input.path,
  });

  return createContextPackage(
    "git_diff",
    `Git Diff: ${input.path}`,
    {
      workspaceId: metadata.workspaceId,
      sessionId: input.sessionId,
      path: input.path,
    },
    diff,
    options
  );
}

export async function buildProjectSummaryContextPackage(
  input: ProjectSummaryContextInput,
  options?: ContextPackageOptions
): Promise<AgentContextPackage> {
  const summary = await inspectWorkspaceIntelligence({
    workspaceId: input.workspaceId,
    rootPath: input.workspacePath,
  });

  return createContextPackage(
    "project_summary",
    "Project Summary",
    {
      workspaceId: input.workspaceId,
    },
    buildProjectSummaryBody(summary),
    options
  );
}

export async function buildSessionReviewContextPackage(
  input: SessionScopedContextInput,
  options?: ContextPackageOptions
): Promise<AgentContextPackage> {
  const metadata = requireSessionMetadata(input.metadataRepo, input.sessionId);
  const summary = await buildSessionReviewSummary({
    sessionId: input.sessionId,
    workspacePath: input.workspacePath,
    metadataRepo: input.metadataRepo,
  });

  const lines = [
    `Baseline: ${summary.baselineGitHead ?? "missing"}`,
    "Changed files:",
    ...(summary.changedFiles.length > 0
      ? summary.changedFiles.map((change) => `- ${change.status ?? "modified"}: ${change.path}`)
      : ["- none"]),
    "Verification runs:",
    ...(summary.verificationRuns.length > 0
      ? summary.verificationRuns.map((run) => `- ${run.status}: ${run.command}`)
      : ["- none"]),
  ];

  if (summary.warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of summary.warnings) {
      lines.push(`- ${warning.code}: ${warning.message}`);
    }
  }

  return createContextPackage(
    "session_review",
    `Session Review: ${summary.sessionId}`,
    {
      workspaceId: metadata.workspaceId,
      sessionId: input.sessionId,
    },
    lines.join("\n"),
    options
  );
}
