import { describe, expect, expectTypeOf, it } from "vitest";
import { Topics } from "../protocol/topics";
import type {
  LspDiagnostic,
  LspDiagnosticsEvent,
  LspDocumentSymbol,
  LspLocation,
  LspSessionSummary,
} from "./lsp";

describe("LSP shared surface", () => {
  it("builds the workspace diagnostics topic", () => {
    expect(Topics.workspaceLspDiagnostics("ws-1")).toBe("workspace.ws-1.lsp.diagnostics");
  });

  it("keeps the editor-facing range and payload shapes stable", () => {
    expectTypeOf<LspLocation>().toMatchTypeOf<{
      path: string;
      range: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
      };
    }>();

    expectTypeOf<LspDiagnostic>().toMatchTypeOf<{
      message: string;
      severity: "error" | "warning" | "info" | "hint";
      range: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
      };
    }>();

    expectTypeOf<LspDocumentSymbol>().toMatchTypeOf<{
      name: string;
      kind: number;
      range: unknown;
      selectionRange: unknown;
      children?: unknown[];
    }>();

    expectTypeOf<LspDiagnosticsEvent>().toMatchTypeOf<{
      workspaceId: string;
      serverKind: string;
      path: string;
      diagnostics: LspDiagnostic[];
    }>();

    expectTypeOf<LspSessionSummary>().toMatchTypeOf<{
      workspaceId: string;
      serverKind: string;
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
