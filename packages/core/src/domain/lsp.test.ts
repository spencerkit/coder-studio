import { describe, expect, expectTypeOf, it } from "vitest";
import { Topics } from "../protocol/topics";
import type {
  LspDiagnostic,
  LspDiagnosticsEvent,
  LspDocumentSymbol,
  LspLocation,
  LspServerKind,
  LspSessionSummary,
} from "./lsp";

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
      serverKind: LspServerKind;
      path: string;
      version?: number;
      diagnostics: LspDiagnostic[];
    }>();

    expectTypeOf<LspSessionSummary>().toEqualTypeOf<{
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
    }>();
  });
});
