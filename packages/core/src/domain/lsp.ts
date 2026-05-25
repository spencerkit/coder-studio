export type LspServerKind = "typescript" | "python" | "go" | "rust" | "vue";
export type LspToolSource = "override" | "managed" | "bundled" | "system";
export type LspRuntimeMode = "auto" | "off";

export interface LspRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface LspLocation {
  path: string;
  range: LspRange;
}

export interface LspDiagnostic {
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  code?: string;
  source?: string;
  range: LspRange;
}

export interface LspHoverResult {
  contents: string[];
  range?: LspRange;
  version?: number;
}

export interface LspDocumentSymbol {
  name: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
}

export interface LspSessionSummary {
  workspaceId: string;
  serverKind: LspServerKind;
  status: "unsupported" | "starting" | "ready" | "degraded" | "stopped";
  capabilities: {
    definition: boolean;
    declaration: boolean;
    typeDefinition: boolean;
    references: boolean;
    hover: boolean;
    documentSymbols: boolean;
    diagnostics: boolean;
  };
}

export interface LspToolRuntimeStatusEntry {
  serverKind: LspServerKind;
  displayName: string;
  available: boolean;
  source?: LspToolSource;
  autoInstallSupported: boolean;
  installReadiness: "ready" | "missing_prerequisite" | "unsupported_platform";
  missingCommands: string[];
  missingPrerequisites: string[];
  message?: string;
}

export interface LspToolInstallStepSnapshot {
  id: string;
  title: string;
  kind: "check" | "install" | "verify";
  status: "pending" | "running" | "succeeded" | "failed";
  command: string;
  args: string[];
  startedAt?: number;
  finishedAt?: number;
  exitCode?: number;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
}

export interface LspToolInstallFailure {
  code:
    | "missing_prerequisite"
    | "unsupported_platform"
    | "permission_denied"
    | "command_not_found"
    | "command_failed"
    | "verification_failed"
    | "download_failed"
    | "unknown_failure";
  serverKind: LspServerKind;
  message: string;
  failedStepId: string;
  command: string;
  args: string[];
  exitCode?: number;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
  missingCommands: string[];
}

export interface LspToolInstallJobSnapshot {
  jobId: string;
  serverKind: LspServerKind;
  status: "queued" | "running" | "succeeded" | "failed";
  currentStepId?: string;
  steps: LspToolInstallStepSnapshot[];
  failure?: LspToolInstallFailure;
}

export type LspEnsureSessionResult =
  | { kind: "unsupported_language" }
  | {
      kind: "disabled";
      mode: "off";
      message: string;
    }
  | {
      kind: "ready";
      summary: LspSessionSummary;
      displayName: string;
      source: LspToolSource;
    }
  | {
      kind: "tool_missing" | "installing" | "failed";
      serverKind: LspServerKind;
      displayName: string;
      errorCode:
        | "lsp_tool_missing"
        | "lsp_prerequisite_missing"
        | "lsp_install_in_progress"
        | "lsp_install_failed"
        | "lsp_start_failed";
      message: string;
      autoInstallSupported: boolean;
      missingCommands: string[];
      missingPrerequisites: string[];
      installJob?: LspToolInstallJobSnapshot;
    };

export interface LspDiagnosticsEvent {
  workspaceId: string;
  serverKind: LspServerKind;
  path: string;
  version?: number;
  diagnostics: LspDiagnostic[];
}
