import * as monaco from "monaco-editor";
import { toWorkspaceFileUri } from "../monaco/uri";

const MARKER_OWNER = "coder-studio-lsp";

export function createDiagnosticsController() {
  return {
    apply(
      workspaceRootPath: string,
      input: {
        path: string;
        version?: number;
        diagnostics: Array<{
          message: string;
          severity: "error" | "warning" | "info" | "hint";
          source?: string;
          code?: string;
          range: {
            startLine: number;
            startColumn: number;
            endLine: number;
            endColumn: number;
          };
        }>;
      }
    ) {
      const model = monaco.editor.getModel(toWorkspaceFileUri(workspaceRootPath, input.path));
      if (!model) {
        return;
      }

      if (typeof input.version === "number" && input.version < model.getVersionId()) {
        return;
      }

      monaco.editor.setModelMarkers(
        model,
        MARKER_OWNER,
        input.diagnostics.map((diagnostic) => ({
          message: diagnostic.message,
          source: diagnostic.source,
          code: diagnostic.code,
          severity: toMonacoMarkerSeverity(diagnostic.severity),
          startLineNumber: diagnostic.range.startLine,
          startColumn: diagnostic.range.startColumn,
          endLineNumber: diagnostic.range.endLine,
          endColumn: diagnostic.range.endColumn,
        }))
      );
    },

    clearFile(workspaceRootPath: string, path: string) {
      const model = monaco.editor.getModel(toWorkspaceFileUri(workspaceRootPath, path));
      if (!model) {
        return;
      }

      monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
    },
  };
}

function toMonacoMarkerSeverity(
  severity: "error" | "warning" | "info" | "hint"
): monaco.MarkerSeverity {
  switch (severity) {
    case "error":
      return monaco.MarkerSeverity.Error;
    case "warning":
      return monaco.MarkerSeverity.Warning;
    case "info":
      return monaco.MarkerSeverity.Info;
    case "hint":
      return monaco.MarkerSeverity.Hint;
  }
}
