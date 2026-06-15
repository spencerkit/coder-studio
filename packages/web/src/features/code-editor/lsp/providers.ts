import {
  LSP_SEMANTIC_TOKEN_MODIFIERS,
  LSP_SEMANTIC_TOKEN_TYPES,
  type LspDocumentSymbol,
  type LspHoverResult,
  type LspLocation,
  type LspSemanticTokens,
} from "@coder-studio/core";
import * as monaco from "monaco-editor";
import { toWorkspaceFileUri } from "../monaco/uri";

const SEMANTIC_TOKENS_LEGEND: monaco.languages.SemanticTokensLegend = {
  tokenTypes: [...LSP_SEMANTIC_TOKEN_TYPES],
  tokenModifiers: [...LSP_SEMANTIC_TOKEN_MODIFIERS],
};

export interface LspModelMetadata {
  workspaceId: string;
  workspaceRootPath: string;
  path: string;
}

export interface LspProviderRegistryDeps {
  lookupModelMetadata: (model: monaco.editor.ITextModel) => LspModelMetadata | undefined;
  ensureLocationModel?: (input: { meta: LspModelMetadata; location: LspLocation }) => Promise<void>;
  requestDefinition: (input: {
    meta: LspModelMetadata;
    line: number;
    column: number;
    version: number;
  }) => Promise<LspLocation[] | null>;
  requestDeclaration: (input: {
    meta: LspModelMetadata;
    line: number;
    column: number;
    version: number;
  }) => Promise<LspLocation[] | null>;
  requestTypeDefinition: (input: {
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
  requestSemanticTokens: (input: {
    meta: LspModelMetadata;
    version: number;
  }) => Promise<LspSemanticTokens | null>;
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
    monaco.languages.registerDeclarationProvider?.(languageId, {
      provideDeclaration,
    });
    monaco.languages.registerTypeDefinitionProvider?.(languageId, {
      provideTypeDefinition,
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
    monaco.languages.registerDocumentSemanticTokensProvider(languageId, {
      getLegend,
      provideDocumentSemanticTokens,
      releaseDocumentSemanticTokens,
    });
    if (supportsImportSpecifierLinks(languageId)) {
      monaco.languages.registerLinkProvider?.(languageId, {
        provideLinks,
        resolveLink,
      });
    }
  }

  async function provideDefinition(
    model: monaco.editor.ITextModel,
    position: monaco.Position
  ): Promise<monaco.languages.Location[]> {
    return await provideLocationRequest(model, position, [
      deps.requestDefinition,
      deps.requestDeclaration,
      deps.requestTypeDefinition,
    ]);
  }

  async function provideDeclaration(
    model: monaco.editor.ITextModel,
    position: monaco.Position
  ): Promise<monaco.languages.Location[]> {
    return await provideLocationRequest(model, position, [deps.requestDeclaration]);
  }

  async function provideTypeDefinition(
    model: monaco.editor.ITextModel,
    position: monaco.Position
  ): Promise<monaco.languages.Location[]> {
    return await provideLocationRequest(model, position, [deps.requestTypeDefinition]);
  }

  async function provideLocationRequest(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    requests: Array<
      (input: {
        meta: LspModelMetadata;
        line: number;
        column: number;
        version: number;
      }) => Promise<LspLocation[] | null>
    >
  ): Promise<monaco.languages.Location[]> {
    const meta = deps.lookupModelMetadata(model);
    if (!meta) {
      return [];
    }

    return await requestLocations(model, meta, position.lineNumber, position.column, requests);
  }

  async function requestLocations(
    model: monaco.editor.ITextModel,
    meta: LspModelMetadata,
    line: number,
    column: number,
    requests: Array<
      (input: {
        meta: LspModelMetadata;
        line: number;
        column: number;
        version: number;
      }) => Promise<LspLocation[] | null>
    >,
    version = model.getVersionId()
  ): Promise<monaco.languages.Location[]> {
    const requestVersion = version;

    for (const request of requests) {
      const result = await request({
        meta,
        line,
        column,
        version: requestVersion,
      });

      if (model.getVersionId() !== requestVersion) {
        return [];
      }

      if (!result || result.length === 0) {
        continue;
      }

      if (deps.ensureLocationModel) {
        await Promise.all(
          result.map((location) =>
            deps.ensureLocationModel?.({
              meta,
              location,
            })
          )
        );
      }

      return result.map((location) => ({
        uri: toWorkspaceFileUri(meta.workspaceRootPath, location.path),
        range: toMonacoRange(location.range),
      }));
    }

    return [];
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

  function getLegend(): monaco.languages.SemanticTokensLegend {
    return SEMANTIC_TOKENS_LEGEND;
  }

  async function provideDocumentSemanticTokens(
    model: monaco.editor.ITextModel,
    _lastResultId: string | null,
    token: monaco.CancellationToken
  ): Promise<monaco.languages.SemanticTokens | null> {
    if (token.isCancellationRequested) {
      return null;
    }

    const meta = deps.lookupModelMetadata(model);
    if (!meta) {
      return null;
    }

    const requestVersion = model.getVersionId();
    const result = await deps.requestSemanticTokens({
      meta,
      version: requestVersion,
    });

    if (token.isCancellationRequested || !result || model.getVersionId() !== requestVersion) {
      return null;
    }

    return {
      resultId: result.resultId,
      data: new Uint32Array(result.data),
    };
  }

  function releaseDocumentSemanticTokens(_resultId: string | undefined): void {}

  async function provideLinks(
    model: monaco.editor.ITextModel
  ): Promise<monaco.languages.ILinksList> {
    const meta = deps.lookupModelMetadata(model);
    if (!meta) {
      return { links: [] };
    }

    const links = collectImportSpecifierLinks(model.getValue());
    if (links.length === 0) {
      return { links: [] };
    }

    return {
      links: links.map((link) => ({
        range: link.range,
        tooltip: link.specifier,
        __lspImportLink: {
          model,
          meta,
          line: link.targetLineNumber,
          column: link.targetColumn,
          version: model.getVersionId(),
        },
      })),
    };
  }

  async function resolveLink(link: monaco.languages.ILink): Promise<monaco.languages.ILink | null> {
    const request = (link as ResolvableImportLink).__lspImportLink;
    if (!request) {
      return link;
    }
    if (request.model.getVersionId() !== request.version) {
      return link;
    }

    const locations = await requestLocations(
      request.model,
      request.meta,
      request.line,
      request.column,
      [deps.requestDefinition, deps.requestDeclaration, deps.requestTypeDefinition],
      request.version
    );
    if (locations.length === 0) {
      return link;
    }
    return {
      ...link,
      url: locations[0]!.uri,
    };
  }

  return {
    register,
    provideDefinition,
    provideDeclaration,
    provideTypeDefinition,
    provideHover,
    provideReferences,
    provideDocumentSymbols,
    provideDocumentSemanticTokens,
    provideLinks,
    resolveLink,
  };
}

interface ImportSpecifierLink {
  range: monaco.IRange;
  specifier: string;
  targetLineNumber: number;
  targetColumn: number;
}

interface ResolvableImportLink extends monaco.languages.ILink {
  __lspImportLink?: {
    model: monaco.editor.ITextModel;
    meta: LspModelMetadata;
    line: number;
    column: number;
    version: number;
  };
}

const importSpecifierPatterns = [
  /\bimport\s+(?:type\s+)?(?:[^"'`\n]+?\s+from\s+)?(["'])([^"'`\n]+)\1/g,
  /\bexport\s+(?:type\s+)?(?:[^"'`\n]+?\s+from\s+)(["'])([^"'`\n]+)\1/g,
  /\bimport\s*\(\s*(["'])([^"'`\n]+)\1\s*\)/g,
  /\brequire\s*\(\s*(["'])([^"'`\n]+)\1\s*\)/g,
];

function collectImportSpecifierLinks(text: string): ImportSpecifierLink[] {
  const links: ImportSpecifierLink[] = [];
  const lineStarts = computeLineStarts(text);

  for (const pattern of importSpecifierPatterns) {
    for (const match of text.matchAll(pattern)) {
      const specifier = match[2];
      if (!specifier) {
        continue;
      }

      const fullMatch = match[0];
      const specifierOffsetInMatch = fullMatch.indexOf(specifier);
      if (specifierOffsetInMatch < 0) {
        continue;
      }

      const specifierStartOffset = (match.index ?? 0) + specifierOffsetInMatch;
      const quoteStartOffset = specifierStartOffset - 1;
      const quoteEndOffset = specifierStartOffset + specifier.length + 1;
      const targetOffset = specifierStartOffset + getImportTargetOffset(specifier);
      const targetPosition = offsetToMonacoPosition(lineStarts, targetOffset);

      links.push({
        specifier,
        range: offsetRangeToMonacoRange(lineStarts, quoteStartOffset, quoteEndOffset),
        targetLineNumber: targetPosition.lineNumber,
        targetColumn: targetPosition.column,
      });
    }
  }

  return links;
}

function getImportTargetOffset(specifier: string): number {
  const slashIndex = specifier.lastIndexOf("/");
  if (slashIndex >= 0 && slashIndex + 1 < specifier.length) {
    return slashIndex + 1;
  }
  return 0;
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function offsetRangeToMonacoRange(
  lineStarts: number[],
  startOffset: number,
  endOffset: number
): monaco.IRange {
  const start = offsetToMonacoPosition(lineStarts, startOffset);
  const end = offsetToMonacoPosition(lineStarts, endOffset);
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
  };
}

function offsetToMonacoPosition(
  lineStarts: number[],
  offset: number
): { lineNumber: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const lineStart = lineStarts[mid]!;
    const nextLineStart = lineStarts[mid + 1] ?? Number.POSITIVE_INFINITY;

    if (offset < lineStart) {
      high = mid - 1;
      continue;
    }

    if (offset >= nextLineStart) {
      low = mid + 1;
      continue;
    }

    return {
      lineNumber: mid + 1,
      column: offset - lineStart + 1,
    };
  }

  const lastLineStart = lineStarts[lineStarts.length - 1] ?? 0;
  return {
    lineNumber: lineStarts.length,
    column: offset - lastLineStart + 1,
  };
}

function supportsImportSpecifierLinks(languageId: string): boolean {
  return (
    languageId === "typescript" ||
    languageId === "typescriptreact" ||
    languageId === "javascript" ||
    languageId === "javascriptreact"
  );
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
