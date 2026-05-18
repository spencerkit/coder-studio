import type { LspDocumentSymbol, LspHoverResult, LspLocation } from "@coder-studio/core";
import * as monaco from "monaco-editor";
import { toWorkspaceFileUri } from "../monaco/uri";

export interface LspModelMetadata {
  workspaceId: string;
  workspaceRootPath: string;
  path: string;
}

export interface LspProviderRegistryDeps {
  lookupModelMetadata: (model: monaco.editor.ITextModel) => LspModelMetadata | undefined;
  requestDefinition: (input: {
    meta: LspModelMetadata;
    line: number;
    column: number;
    version: number;
  }) => Promise<LspLocation[] | null>;
  requestHover: (input: {
    meta: LspModelMetadata;
    line: number;
    column: number;
    version: number;
  }) => Promise<LspHoverResult | null>;
  requestReferences: (input: {
    meta: LspModelMetadata;
    line: number;
    column: number;
    version: number;
  }) => Promise<LspLocation[] | null>;
  requestDocumentSymbols: (input: {
    meta: LspModelMetadata;
    version: number;
  }) => Promise<LspDocumentSymbol[] | null>;
}

export function createLspProviderRegistry(deps: LspProviderRegistryDeps) {
  const registeredLanguages = new Set<string>();

  function register(languageId: string): void {
    if (registeredLanguages.has(languageId)) {
      return;
    }

    registeredLanguages.add(languageId);

    monaco.languages.registerDefinitionProvider(languageId, {
      provideDefinition,
    });
    monaco.languages.registerHoverProvider(languageId, {
      provideHover,
    });
    monaco.languages.registerReferenceProvider(languageId, {
      provideReferences,
    });
    monaco.languages.registerDocumentSymbolProvider(languageId, {
      provideDocumentSymbols,
    });
  }

  async function provideDefinition(
    model: monaco.editor.ITextModel,
    position: monaco.Position
  ): Promise<monaco.languages.Location[]> {
    const meta = deps.lookupModelMetadata(model);
    if (!meta) {
      return [];
    }

    const requestVersion = model.getVersionId();
    const result = await deps.requestDefinition({
      meta,
      line: position.lineNumber,
      column: position.column,
      version: requestVersion,
    });

    if (!result || model.getVersionId() !== requestVersion) {
      return [];
    }

    return result.map((location) => ({
      uri: toWorkspaceFileUri(meta.workspaceRootPath, location.path),
      range: toMonacoRange(location.range),
    }));
  }

  async function provideHover(
    model: monaco.editor.ITextModel,
    position: monaco.Position
  ): Promise<monaco.languages.Hover | null> {
    const meta = deps.lookupModelMetadata(model);
    if (!meta) {
      return null;
    }

    const requestVersion = model.getVersionId();
    const result = await deps.requestHover({
      meta,
      line: position.lineNumber,
      column: position.column,
      version: requestVersion,
    });

    if (!result || model.getVersionId() !== requestVersion) {
      return null;
    }

    return {
      contents: result.contents.map((value) => ({ value })),
      range: result.range ? toMonacoRange(result.range) : undefined,
    };
  }

  async function provideReferences(
    model: monaco.editor.ITextModel,
    position: monaco.Position
  ): Promise<monaco.languages.Location[]> {
    const meta = deps.lookupModelMetadata(model);
    if (!meta) {
      return [];
    }

    const requestVersion = model.getVersionId();
    const result = await deps.requestReferences({
      meta,
      line: position.lineNumber,
      column: position.column,
      version: requestVersion,
    });

    if (!result || model.getVersionId() !== requestVersion) {
      return [];
    }

    return result.map((location) => ({
      uri: toWorkspaceFileUri(meta.workspaceRootPath, location.path),
      range: toMonacoRange(location.range),
    }));
  }

  async function provideDocumentSymbols(
    model: monaco.editor.ITextModel
  ): Promise<monaco.languages.DocumentSymbol[]> {
    const meta = deps.lookupModelMetadata(model);
    if (!meta) {
      return [];
    }

    const requestVersion = model.getVersionId();
    const result = await deps.requestDocumentSymbols({
      meta,
      version: requestVersion,
    });

    if (!result || model.getVersionId() !== requestVersion) {
      return [];
    }

    return result.map(toMonacoSymbol);
  }

  return {
    register,
    provideDefinition,
    provideHover,
    provideReferences,
    provideDocumentSymbols,
  };
}

function toMonacoRange(range: {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}): monaco.IRange {
  return {
    startLineNumber: range.startLine,
    startColumn: range.startColumn,
    endLineNumber: range.endLine,
    endColumn: range.endColumn,
  };
}

function toMonacoSymbol(symbol: LspDocumentSymbol): monaco.languages.DocumentSymbol {
  return {
    name: symbol.name,
    detail: "",
    kind: symbol.kind as monaco.languages.SymbolKind,
    tags: [],
    containerName: "",
    range: toMonacoRange(symbol.range),
    selectionRange: toMonacoRange(symbol.selectionRange),
    children: Array.isArray(symbol.children) ? symbol.children.map(toMonacoSymbol) : [],
  };
}
