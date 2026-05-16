import { readFileSync } from "node:fs";

import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";

const connection = createMessageConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout)
);

const docs = new Map();

connection.onRequest("initialize", () => ({
  capabilities: {
    definitionProvider: true,
    referencesProvider: true,
    hoverProvider: true,
    documentSymbolProvider: true,
    textDocumentSync: 1,
  },
}));

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

  return {
    contents: {
      kind: "markdown",
      value: "```ts\\nconst sharedValue: number\\n```",
    },
  };
});

connection.onRequest("textDocument/documentSymbol", ({ textDocument }) => {
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
