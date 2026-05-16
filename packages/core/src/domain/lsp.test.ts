import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  DomainEvent,
  LspDiagnostic,
  LspDiagnosticsEvent,
  LspDocumentSymbol,
  LspHoverResult,
  LspLocation,
  LspSessionSummary,
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

    expectTypeOf<Extract<DomainEvent, { type: "lsp.diagnostics.updated" }>>().toEqualTypeOf<{
      type: "lsp.diagnostics.updated";
      workspaceId: string;
      serverKind: "typescript" | "python" | "go" | "rust";
      path: string;
      version?: number;
      diagnostics: LspDiagnostic[];
    }>();
  });
});
