import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} = require("vscode-jsonrpc/node.js");

const connection = createMessageConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout)
);

const docs = new Map();
const exitAfterInitMs = Number(process.env.CODER_STUDIO_FAKE_LSP_EXIT_AFTER_INIT_MS ?? "0");
const hoverDelayMs = Number(process.env.CODER_STUDIO_FAKE_LSP_HOVER_DELAY_MS ?? "0");
const stderrOnInit = process.env.CODER_STUDIO_FAKE_LSP_STDERR_ON_INIT ?? "";

connection.onRequest("initialize", () => {
  if (stderrOnInit) {
    process.stderr.write(`${stderrOnInit}\n`);
  }

  if (exitAfterInitMs > 0) {
    const timer = setTimeout(() => process.exit(0), exitAfterInitMs);
    timer.unref?.();
  }

  return {
    capabilities: {
      definitionProvider: true,
      declarationProvider: true,
      typeDefinitionProvider: true,
      referencesProvider: true,
      hoverProvider: true,
      documentSymbolProvider: true,
      textDocumentSync: 1,
    },
  };
});

connection.onNotification("textDocument/didOpen", ({ textDocument }) => {
  docs.set(textDocument.uri, textDocument.text);
  publishDiagnostics(textDocument.uri);
});

connection.onNotification("textDocument/didChange", ({ textDocument, contentChanges }) => {
  docs.set(textDocument.uri, contentChanges.at(-1)?.text ?? "");
  publishDiagnostics(textDocument.uri);
});

connection.onNotification("textDocument/didClose", ({ textDocument }) => {
  docs.delete(textDocument.uri);
  connection.sendNotification("textDocument/publishDiagnostics", {
    uri: textDocument.uri,
    diagnostics: [],
  });
});

connection.onRequest("textDocument/definition", ({ textDocument }) => {
  if (textDocument.uri.endsWith("/single.ts")) {
    return {
      uri: textDocument.uri.replace("/single.ts", "/shared.ts"),
      range: {
        start: { line: 0, character: 13 },
        end: { line: 0, character: 24 },
      },
    };
  }

  if (textDocument.uri.endsWith("/linked.ts")) {
    return [
      {
        targetUri: textDocument.uri.replace("/linked.ts", "/shared.ts"),
        targetRange: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 29 },
        },
        targetSelectionRange: {
          start: { line: 0, character: 13 },
          end: { line: 0, character: 24 },
        },
      },
    ];
  }

  if (!textDocument.uri.endsWith("/consumer.ts")) {
    return [];
  }

  return [
    {
      uri: textDocument.uri.replace("/consumer.ts", "/shared.ts"),
      range: {
        start: { line: 0, character: 13 },
        end: { line: 0, character: 24 },
      },
    },
  ];
});

connection.onRequest("textDocument/declaration", ({ textDocument }) => {
  if (!textDocument.uri.endsWith("/declaration.ts")) {
    return [];
  }

  return {
    uri: textDocument.uri.replace("/declaration.ts", "/shared.ts"),
    range: {
      start: { line: 0, character: 13 },
      end: { line: 0, character: 24 },
    },
  };
});

connection.onRequest("textDocument/typeDefinition", ({ textDocument }) => {
  if (!textDocument.uri.endsWith("/type-target.ts")) {
    return [];
  }

  return [
    {
      uri: textDocument.uri.replace("/type-target.ts", "/types.d.ts"),
      range: {
        start: { line: 0, character: 12 },
        end: { line: 0, character: 21 },
      },
    },
  ];
});

connection.onRequest("textDocument/references", ({ textDocument }) => {
  if (!textDocument.uri.endsWith("/shared.ts")) {
    return [];
  }

  return [
    {
      uri: textDocument.uri,
      range: {
        start: { line: 0, character: 13 },
        end: { line: 0, character: 24 },
      },
    },
    {
      uri: textDocument.uri.replace("/shared.ts", "/consumer.ts"),
      range: {
        start: { line: 0, character: 9 },
        end: { line: 0, character: 20 },
      },
    },
  ];
});

connection.onRequest("textDocument/hover", ({ textDocument }) => {
  if (!textDocument.uri.endsWith("/shared.ts")) {
    return null;
  }

  const response = {
    contents: {
      kind: "markdown",
      value: "```ts\\nconst sharedValue: number\\n```",
    },
  };

  if (hoverDelayMs <= 0) {
    return response;
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(response), hoverDelayMs);
    timer.unref?.();
  });
});

connection.onRequest("textDocument/documentSymbol", ({ textDocument }) => {
  if (textDocument.uri.endsWith("/symbols-flat.ts")) {
    return [
      {
        name: "flatSymbol",
        kind: 13,
        location: {
          uri: textDocument.uri,
          range: {
            start: { line: 0, character: 13 },
            end: { line: 0, character: 23 },
          },
        },
      },
    ];
  }

  if (!textDocument.uri.endsWith("/shared.ts")) {
    return [];
  }

  return [
    {
      name: "sharedValue",
      kind: 13,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 29 },
      },
      selectionRange: {
        start: { line: 0, character: 13 },
        end: { line: 0, character: 24 },
      },
    },
  ];
});

function publishDiagnostics(uri) {
  const text = docs.get(uri) ?? readFileSync(new URL(uri), "utf8");
  const diagnostics = text.includes("missingSymbol")
    ? [
        {
          severity: 1,
          message: "Cannot find name 'missingSymbol'.",
          range: {
            start: { line: 0, character: 22 },
            end: { line: 0, character: 35 },
          },
          source: "fake-lsp",
        },
      ]
    : [];

  connection.sendNotification("textDocument/publishDiagnostics", {
    uri,
    diagnostics,
  });
}

connection.listen();
