// Core domain types (spec §12.1)

export type {
  ProviderInstallDocUrls,
  ProviderInstallFailure,
  ProviderInstallJobSnapshot,
  ProviderInstallStepSnapshot,
  ProviderRuntimeStatusEntry,
  ProviderRuntimeStatusResponse,
} from "./provider-install";

export interface Workspace {
  name?: string;
  isActive?: boolean;
  unreadCount?: number;
  id: string;
  path: string;
  targetRuntime: "native" | "wsl";
  wslDistro?: string;
  openedAt: number;
  lastActiveAt: number;
  uiState: UiState;
}

export type WorkspacePaneLeafKind = "draft" | "session" | "editor";

export interface LegacyWorkspacePaneLeaf {
  id: string;
  type: "leaf";
  sessionId?: string;
  leafKind?: undefined;
}

export interface WorkspaceDraftPaneLeaf {
  id: string;
  type: "leaf";
  leafKind: "draft";
}

export interface WorkspaceSessionPaneLeaf {
  id: string;
  type: "leaf";
  leafKind: "session";
  sessionId: string;
}

export interface WorkspaceEditorPaneLeaf {
  id: string;
  type: "leaf";
  leafKind: "editor";
}

export type WorkspacePaneLeaf =
  | LegacyWorkspacePaneLeaf
  | WorkspaceDraftPaneLeaf
  | WorkspaceSessionPaneLeaf
  | WorkspaceEditorPaneLeaf;

export interface WorkspacePaneSplit {
  id: string;
  type: "split";
  direction?: "horizontal" | "vertical";
  children?: WorkspacePaneNode[];
}

export type WorkspacePaneNode = WorkspacePaneLeaf | WorkspacePaneSplit;

export interface UiState {
  leftPanelWidth: number;
  bottomPanelHeight: number;
  focusMode: boolean;
  activeSessionId?: string;
  paneLayout?: WorkspacePaneNode;
  fileTreeExpandedDirs?: string[];
  openEditorPaths?: string[];
  activeEditorPath?: string | null;
  agentInstructionsExpanded?: boolean;
}

export interface WorkspaceLastViewedTarget {
  workspaceId: string;
  sessionId?: string;
  updatedAt: number;
}

export interface WorkspaceHistoryEntry {
  path: string;
  name: string;
  lastOpenedAt: number;
}

export interface WorkspaceIntelligenceCommandReference {
  command: string;
}

export interface WorkspaceIntelligenceRecommendedCommand
  extends WorkspaceIntelligenceCommandReference {
  key: "dev" | "test" | "build" | "lint";
  source: "package_json" | "makefile" | "detected";
  intent?: "recommended_entrypoint";
}

export interface WorkspaceIntelligenceKeyDirectory {
  path: string;
  kind:
    | "frontend"
    | "backend"
    | "providers"
    | "shared"
    | "cli"
    | "docs"
    | "tests"
    | "scripts"
    | "other";
  reason: string;
}

export interface WorkspaceIntelligencePackageSummary {
  path: string;
  name?: string;
  role:
    | "frontend_ui"
    | "backend_runtime"
    | "provider_integrations"
    | "shared_contracts"
    | "cli_entrypoint"
    | "shared_utilities"
    | "shared_package";
  scripts: string[];
}

export interface WorkspaceIntelligenceVerificationCommand
  extends WorkspaceIntelligenceCommandReference {
  reason: string;
  priority: "verification" | "quality" | "dev";
  intent?: "verification_workflow";
}

export type WorkspaceIntelligenceDocumentationKind = "readme" | "docs" | "guide" | "wiki";

export interface WorkspaceIntelligenceDocumentationEntry {
  path: string;
  kind: WorkspaceIntelligenceDocumentationKind;
}

export interface WorkspaceIntelligenceDocEntry extends WorkspaceIntelligenceDocumentationEntry {
  kind: "readme" | "docs";
}

export interface WorkspaceIntelligenceSummary {
  workspaceId: string;
  rootPath: string;
  git: {
    isRepo: boolean;
    branch?: string;
  };
  packageManager?: "npm" | "pnpm" | "yarn" | "bun";
  frameworks: string[];
  scripts: {
    dev?: string;
    test?: string;
    build?: string;
    lint?: string;
  };
  recommendedCommands: WorkspaceIntelligenceRecommendedCommand[];
  docs: WorkspaceIntelligenceDocEntry[];
  workspaceKind?: "monorepo" | "node_app" | "unknown";
  topLevelDirectories?: string[];
  keyDirectories?: WorkspaceIntelligenceKeyDirectory[];
  packages?: WorkspaceIntelligencePackageSummary[];
  documentationEntries?: WorkspaceIntelligenceDocumentationEntry[];
  verificationCommands?: WorkspaceIntelligenceVerificationCommand[];
  fileConstraints?: string[];
  agentInstructions: {
    exists: boolean;
    path: ".coder-studio/agent.md";
  };
}

export const SYSTEM_AGENT_INSTRUCTIONS_PROVIDER_IDS = [
  "codex",
  "claude",
  "gemini",
  "opencode",
] as const;

export type SystemAgentInstructionsProviderId =
  (typeof SYSTEM_AGENT_INSTRUCTIONS_PROVIDER_IDS)[number];

export const SYSTEM_AGENT_INSTRUCTIONS_PATHS = {
  codex: {
    displayName: "Codex",
    relPath: ".codex/AGENTS.md",
    displayPath: "~/.codex/AGENTS.md",
    editable: true,
  },
  claude: {
    displayName: "Claude Code",
    relPath: ".claude/CLAUDE.md",
    displayPath: "~/.claude/CLAUDE.md",
    editable: true,
  },
  gemini: {
    displayName: "Gemini CLI",
    relPath: ".gemini/GEMINI.md",
    displayPath: "~/.gemini/GEMINI.md",
    editable: true,
  },
  opencode: {
    displayName: "OpenCode",
    relPath: ".config/opencode/AGENTS.md",
    displayPath: "~/.config/opencode/AGENTS.md",
    editable: true,
  },
} as const satisfies Record<
  SystemAgentInstructionsProviderId,
  {
    displayName: string;
    relPath?: string;
    displayPath: string;
    editable: boolean;
  }
>;

export interface AgentInstructionsDocument {
  path: string;
  displayPath?: string;
  exists: boolean;
  content: string;
  baseHash?: string;
}

export type AgentInstructionsDocumentKind = "custom" | "system";

export interface AgentInstructionsPanelProjectStatus {
  path: ".coder-studio/agent.md";
  displayPath: "项目 Agent.md";
  exists: boolean;
  stale: boolean;
}

export interface AgentInstructionsSystemStatusEntry {
  providerId: SystemAgentInstructionsProviderId;
  displayName: string;
  path?: string;
  displayPath: string;
  exists: boolean;
  editable: boolean;
  status: "ready" | "missing" | "unsupported" | "error";
  reason?: string;
}

export interface AgentInstructionsPanelStatus {
  project: AgentInstructionsPanelProjectStatus;
  system: AgentInstructionsSystemStatusEntry[];
  document: AgentInstructionsPanelProjectStatus;
}

export interface AgentInstructionsSystemDocument extends AgentInstructionsDocument {
  providerId: SystemAgentInstructionsProviderId;
  displayPath: string;
}

export interface AgentInstructionsHealthIssue {
  code:
    | "missing_document"
    | "missing_project_overview"
    | "missing_development_commands"
    | "missing_working_rules"
    | "missing_review_expectations"
    | "missing_safety_rules"
    | "missing_provider_notes";
  message: string;
}

export interface AgentInstructionsHealthChecks {
  projectOverview: boolean;
  developmentCommands: boolean;
  workingRules: boolean;
  reviewExpectations: boolean;
  safetyRules: boolean;
  providerNotes: boolean;
}

export interface AgentInstructionsHealth {
  path: ".coder-studio/agent.md";
  exists: boolean;
  status: "healthy" | "warning" | "missing";
  checks: AgentInstructionsHealthChecks;
  issues: AgentInstructionsHealthIssue[];
}

export type CustomProviderSessionMode = "interactive";

export interface CustomProviderConfig {
  id: string;
  displayName: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwdMode: "workspace_root";
  sessionMode: CustomProviderSessionMode;
  startupPrompt?: string;
  capabilities: import("../provider/definition").ProviderCapabilityDescriptor[];
  createdAt: number;
  updatedAt: number;
}

export interface AgentSessionVerificationRun {
  id: string;
  command: string;
  status: "passed" | "failed" | "unknown";
  exitCode?: number;
  summary?: string;
  createdAt: number;
}

export interface AgentSessionMetadata {
  sessionId: string;
  workspaceId: string;
  providerId: string;
  objective?: string;
  baselineGitHead?: string;
  baselineCapturedAt?: number;
  verificationRuns: AgentSessionVerificationRun[];
  attachedAgentInstructions?: {
    effectiveHash: string;
    mode: "auto" | "manual";
    attachedAt: number;
  };
}

export interface SessionReviewWarning {
  code: "missing_baseline" | "not_git_repo";
  message: string;
}

export interface SessionReviewSummary {
  sessionId: string;
  workspaceId: string;
  baselineGitHead?: string;
  changedFiles: GitFileChange[];
  verificationRuns: AgentSessionVerificationRun[];
  warnings: SessionReviewWarning[];
}

export type AgentContextKind =
  | "file"
  | "selection"
  | "git_diff"
  | "terminal_output"
  | "project_summary"
  | "session_review";

export interface AgentContextPackage {
  id: string;
  kind: AgentContextKind;
  title: string;
  body: string;
  source: {
    workspaceId: string;
    path?: string;
    sessionId?: string;
    terminalId?: string;
  };
  createdAt: number;
}

export type TerminalKind = "agent" | "shell" | "task";

export interface Terminal {
  id: string;
  workspaceId: string;
  kind: TerminalKind;
  pid?: number;
  title: string;
  cwd: string;
  argv: string[];
  env?: Record<string, string>;
  cols: number;
  rows: number;
  alive: boolean;
  createdAt: number;
  endedAt?: number;
  exitCode?: number;
}

export type TaskKind = "verify" | "test" | "lint" | "build" | "dev" | "custom";

export type TaskSource =
  | "coder-studio"
  | "package-json"
  | "pnpm-workspace"
  | "cargo"
  | "go"
  | "python"
  | "makefile"
  | "inferred";

export type TaskRunStatus = "queued" | "running" | "passed" | "failed" | "stopped";

export interface TaskDefinition {
  id: string;
  workspaceId: string;
  kind: TaskKind;
  label: string;
  command: string;
  args: string[];
  displayCommand?: string;
  cwdPath?: string;
  source: TaskSource;
  priority: number;
}

export interface TaskRun {
  id: string;
  workspaceId: string;
  taskId: string;
  terminalId: string;
  status: TaskRunStatus;
  command: string;
  args: string[];
  cwdPath?: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
  summary?: {
    tailLines: string[];
  };
}

export interface Session {
  id: string;
  workspaceId: string;
  terminalId: string;
  providerId: string;
  state: SessionState;
  capability: "full" | "limited" | "unsupported";
  startedAt: number;
  lastActiveAt: number;
  endedAt?: number;
  completionPercent?: number;
  errorReason?: string;
  /**
   * Human-friendly title derived from the user's first submitted instruction
   * (trimmed/truncated to SESSION_TITLE_MAX_LENGTH). Assigned once on first
   * submit and never overwritten afterwards. Undefined until the user sends
   * their first message.
   */
  title?: string;
  /**
   * Full normalized first submitted instruction used for title hover details.
   * Assigned together with `title` and never overwritten afterwards.
   */
  firstSubmittedUserInput?: string;
}

/**
 * Maximum character length for {@link Session.title}. The first submitted
 * instruction is trimmed and truncated to this length (with an ellipsis when
 * clipped) before being persisted.
 */
export const SESSION_TITLE_MAX_LENGTH = 10;

export type SessionState = "draft" | "starting" | "running" | "idle" | "ended";

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  headSha?: string;
  headShortSha?: string;
  headSubject?: string;
  /**
   * Files with a non-blank index status. Includes staged deletions (index
   * status 'D'); consumers showing a staged-files badge should count this
   * array directly rather than diffing against `deleted`.
   */
  staged: GitFileChange[];
  modified: GitFileChange[];
  untracked: GitFileChange[];
  /** Worktree-only deletions (index unchanged, file removed in working tree). */
  deleted: GitFileChange[];
  /** Unmerged files reported by porcelain v2 `u` records during merge conflicts. */
  conflicted?: GitFileChange[];
}

export type GitChangeStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflicted";

export type GitDiffRenderMode = "text" | "image";

export type GitRevisionSource = "HEAD" | "INDEX" | "WORKTREE" | string;

export interface GitDiffHunk {
  id: string;
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  patch: string;
  lines: string[];
}

export interface GitHunkOperation {
  workspaceId: string;
  path: string;
  staged: boolean;
  hunkId: string;
  operation: "stage" | "unstage" | "discard";
}

export interface GitFileChange {
  path: string;
  oldPath?: string; // for renames
  status?: GitChangeStatus;
}

export interface GitCommitSummary {
  sha: string;
  shortSha: string;
  subject: string;
  authorName: string;
  authoredAt: number;
}

export interface GitCommitFileEntry {
  path: string;
  oldPath?: string;
  status: Exclude<GitChangeStatus, "untracked" | "conflicted">;
  renderAs: GitDiffRenderMode;
}

export interface GitCommitDetail {
  commit: GitCommitSummary & {
    parentSha?: string;
  };
  files: GitCommitFileEntry[];
}

export interface GitFileDiffPayload {
  diff: string;
  renderAs: GitDiffRenderMode;
  status: "modified" | "added" | "deleted";
  mime?: string;
  originalPath?: string;
  modifiedPath?: string;
  originalContent?: string;
  modifiedContent?: string;
  originalRevision?: GitRevisionSource;
  modifiedRevision?: GitRevisionSource;
  hunks?: GitDiffHunk[];
}

export interface GitBranch {
  name: string; // Branch name (e.g., "main", "origin/feature")
  isRemote: boolean; // Whether it's a remote branch
  isCurrent: boolean; // Whether it's the current branch
  remote?: string; // Remote name (e.g., "origin")
  linkedWorktreePath?: string; // Path of another worktree using this branch, if any
}

export interface WorktreeInfo {
  name: string;
  path: string;
  branch: string;
  commit: string;
  status: "clean" | "dirty";
}

export interface FileNode {
  name: string;
  path: string;
  kind: "file" | "dir";
  children?: FileNode[];
  size?: number;
  mtime?: number;
  isGitIgnored?: boolean;
  isSymlink?: boolean;
}

export interface SearchContentMatch {
  line: number;
  column: number;
  endColumn: number;
  preview: string;
  previewColumnStart: number;
  previewColumnEnd: number;
}

export interface SearchContentFileResult {
  path: string;
  name: string;
  matchCount: number;
  hasMoreMatches: boolean;
  matches: SearchContentMatch[];
}

export interface SearchContentResult {
  files: SearchContentFileResult[];
  totalMatchCount: number;
  hasMoreFiles: boolean;
  truncatedMatchFileCount: number;
}

export interface SearchSessionMatchPreview {
  id: string;
  line: number;
  column: number;
  endColumn: number;
  preview: string;
  previewColumnStart: number;
  previewColumnEnd: number;
  replacementPreview: string;
  replacementPreviewColumnStart: number;
  replacementPreviewColumnEnd: number;
  isReplacementPreviewTruncated: boolean;
}

export interface SearchSessionFileResult {
  path: string;
  name: string;
  matchCount: number;
  hasMoreMatches: boolean;
  baseHash: string;
  matches: SearchSessionMatchPreview[];
}

export interface SearchSessionStartResult {
  sessionId: string;
  files: SearchSessionFileResult[];
  totalMatchCount: number;
  totalFileCount: number;
  hasMoreFiles: boolean;
  truncatedMatchFileCount: number;
  skippedBinaryFileCount: number;
  skippedLargeFileCount: number;
}

export interface SearchSessionFilePreview {
  kind: "search-replace-file-diff";
  path: string;
  title?: string;
  sessionId: string;
  baseHash: string;
  originalContent: string;
  modifiedContent: string;
}

export type SearchSessionApplyScope =
  | { kind: "all" }
  | { kind: "file"; path: string }
  | { kind: "match"; path: string; matchId: string };

export interface SearchSessionApplyFileResult {
  path: string;
  status: "applied" | "conflict" | "skipped" | "not_found";
  replacedMatchCount: number;
}

export interface SearchSessionApplyResult {
  sessionId: string;
  status: "ok" | "partial" | "stale_session";
  appliedFileCount: number;
  conflictFileCount: number;
  skippedFileCount: number;
  results: SearchSessionApplyFileResult[];
}

export interface Settings {
  defaultProviderId: string;
  notifications: {
    enabled: boolean;
    soundEnabled: boolean;
  };
  supervisor: {
    evaluationTimeoutSec: number;
  };
  appearance: {
    themeId: string;
    terminalRenderer: "standard" | "compatibility";
    locale: "zh" | "en";
  };
  providerConfigs: Record<string, ProviderConfig>;
}

export interface ProviderConfig {
  [key: string]: unknown;
}

/**
 * Derive a compact session title from a raw input buffer (the bytes a user
 * just submitted to the agent terminal). Returns undefined when the buffer
 * contains nothing meaningful after trimming.
 *
 * Rules:
 *   - Collapse all whitespace (including newlines) into single spaces.
 *   - Trim leading/trailing whitespace.
 *   - Truncate to SESSION_TITLE_MAX_LENGTH; if clipped, the final character is
 *     replaced with an ellipsis ("…") so the total length is still at most
 *     SESSION_TITLE_MAX_LENGTH.
 */
export function normalizeSessionTitleInput(raw: string): string | undefined {
  const normalized = raw.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

export function deriveSessionTitle(raw: string): string | undefined {
  const normalized = normalizeSessionTitleInput(raw);
  if (!normalized) return undefined;

  if (normalized.length <= SESSION_TITLE_MAX_LENGTH) {
    return normalized;
  }

  // Reserve the last slot for the ellipsis so we stay within the budget.
  return normalized.slice(0, SESSION_TITLE_MAX_LENGTH - 1) + "…";
}
