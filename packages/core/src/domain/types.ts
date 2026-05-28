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
}

export interface WorkspaceLastViewedTarget {
  workspaceId: string;
  sessionId?: string;
  updatedAt: number;
}

export interface WorkspaceIntelligenceRecommendedCommand {
  key: "dev" | "test" | "build" | "lint";
  command: string;
  source: "package_json" | "makefile" | "detected";
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
  docs: Array<{
    path: string;
    kind: "readme" | "docs";
  }>;
  agentInstructions: {
    exists: boolean;
    path: ".coder-studio/AGENTS.md";
  };
}

export interface AgentInstructionsDocument {
  path: ".coder-studio/AGENTS.md";
  exists: boolean;
  content: string;
  baseHash?: string;
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
  path: ".coder-studio/AGENTS.md";
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

export interface Terminal {
  id: string;
  workspaceId: string;
  kind: "agent" | "shell";
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
}

export type GitChangeStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

export type GitDiffRenderMode = "text" | "image";

export type GitRevisionSource = "HEAD" | "INDEX" | "WORKTREE" | string;

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
  status: Exclude<GitChangeStatus, "untracked">;
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
export function deriveSessionTitle(raw: string): string | undefined {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;

  if (normalized.length <= SESSION_TITLE_MAX_LENGTH) {
    return normalized;
  }

  // Reserve the last slot for the ellipsis so we stay within the budget.
  return normalized.slice(0, SESSION_TITLE_MAX_LENGTH - 1) + "…";
}
