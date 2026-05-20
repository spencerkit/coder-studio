import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  DomainEvent,
  LspDiagnostic,
  LspDiagnosticsEvent,
  LspDocumentSymbol,
  LspEnsureSessionResult,
  LspHoverResult,
  LspLocation,
  LspSessionSummary,
  LspToolInstallFailure,
  LspToolInstallJobSnapshot,
  LspToolInstallStepSnapshot,
  LspToolRuntimeStatusEntry,
  LspToolSource,
} from "../index";
import { Topics } from "../index";

describe("LSP shared surface", () => {
  it("builds the workspace diagnostics topic", () => {
    expect(Topics.workspaceLspDiagnostics("ws-1")).toBe("workspace.ws-1.lsp.diagnostics");
  });

  it("keeps the editor-facing range and payload shapes stable", () => {
    expectTypeOf<LspLocation>().toEqualTypeOf<{
      path: string;
      range: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
      };
    }>();

    expectTypeOf<LspDiagnostic>().toEqualTypeOf<{
      message: string;
      severity: "error" | "warning" | "info" | "hint";
      code?: string;
      source?: string;
      range: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
      };
    }>();

    expectTypeOf<LspDocumentSymbol>().toEqualTypeOf<{
      name: string;
      kind: number;
      range: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
      };
      selectionRange: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
      };
      children?: LspDocumentSymbol[];
    }>();

    expectTypeOf<LspDiagnosticsEvent>().toEqualTypeOf<{
      workspaceId: string;
      serverKind: "typescript" | "python" | "go" | "rust";
      path: string;
      version?: number;
      diagnostics: LspDiagnostic[];
    }>();

    expectTypeOf<LspSessionSummary>().toEqualTypeOf<{
      workspaceId: string;
      serverKind: "typescript" | "python" | "go" | "rust";
      status: "unsupported" | "starting" | "ready" | "degraded" | "stopped";
      capabilities: {
        definition: boolean;
        references: boolean;
        hover: boolean;
        documentSymbols: boolean;
        diagnostics: boolean;
      };
    }>();

    expectTypeOf<LspToolSource>().toEqualTypeOf<"override" | "managed" | "bundled" | "system">();

    expectTypeOf<LspToolRuntimeStatusEntry>().toEqualTypeOf<{
      serverKind: "typescript" | "python" | "go" | "rust";
      displayName: string;
      available: boolean;
      source?: LspToolSource;
      autoInstallSupported: boolean;
      installReadiness: "ready" | "missing_prerequisite" | "unsupported_platform";
      missingCommands: string[];
      missingPrerequisites: string[];
      message?: string;
    }>();

    expectTypeOf<LspToolInstallStepSnapshot>().toEqualTypeOf<{
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
    }>();

    expectTypeOf<LspToolInstallFailure>().toEqualTypeOf<{
      code:
        | "missing_prerequisite"
        | "unsupported_platform"
        | "permission_denied"
        | "command_not_found"
        | "command_failed"
        | "verification_failed"
        | "download_failed"
        | "unknown_failure";
      serverKind: "typescript" | "python" | "go" | "rust";
      message: string;
      failedStepId: string;
      command: string;
      args: string[];
      exitCode?: number;
      stdoutExcerpt?: string;
      stderrExcerpt?: string;
      missingCommands: string[];
    }>();

    expectTypeOf<LspToolInstallJobSnapshot>().toEqualTypeOf<{
      jobId: string;
      serverKind: "typescript" | "python" | "go" | "rust";
      status: "queued" | "running" | "succeeded" | "failed";
      currentStepId?: string;
      steps: LspToolInstallStepSnapshot[];
      failure?: LspToolInstallFailure;
    }>();

    expectTypeOf<LspEnsureSessionResult>().toEqualTypeOf<
      | { kind: "unsupported_language" }
      | {
          kind: "ready";
          summary: LspSessionSummary;
          displayName: string;
          source: LspToolSource;
        }
      | {
          kind: "tool_missing" | "installing" | "failed";
          serverKind: "typescript" | "python" | "go" | "rust";
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
        }
    >();

    expectTypeOf<LspHoverResult>().toEqualTypeOf<{
      contents: string[];
      range?: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
      };
      version?: number;
    }>();

    type LspDiagnosticsUpdatedEvent = Extract<DomainEvent, { type: "lsp.diagnostics.updated" }>;
    expectTypeOf<LspDiagnosticsUpdatedEvent>().toMatchTypeOf<{
      type: "lsp.diagnostics.updated";
      workspaceId: string;
      serverKind: "typescript" | "python" | "go" | "rust";
      path: string;
      version?: number;
      diagnostics: LspDiagnostic[];
    }>();
  });
});
