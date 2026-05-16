export type LspServerKind = "typescript" | "python" | "go" | "rust";

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
    references: boolean;
    hover: boolean;
    documentSymbols: boolean;
    diagnostics: boolean;
  };
}

export interface LspDiagnosticsEvent {
  workspaceId: string;
  serverKind: LspServerKind;
  path: string;
  version?: number;
  diagnostics: LspDiagnostic[];
}
