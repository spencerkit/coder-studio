#!/usr/bin/env node
// Quick LSP probe for rust-analyzer against `lsp-test/probe.rs` (or any path
// passed on argv). Spawns rust-analyzer directly, sends initialize +
// didOpen, then dumps the response shape for hover at a few canonical
// positions. Useful for verifying the protocol contract without going
// through the coder-studio LSP layer.
//
// Usage: node scripts/probe-rust.mjs [path/to/file.rs]

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(
  pathToFileURL(join(process.cwd(), "packages", "server", "package.json")).toString()
);
const {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} = require("vscode-jsonrpc/node.js");

const RUST_ANALYZER = process.env.RUST_ANALYZER ?? "rust-analyzer";
const sample = resolve(process.argv[2] ?? "lsp-test/probe.rs");
const text = readFileSync(sample, "utf8");
const uri = pathToFileURL(sample).toString();
const rootDir = process.cwd();

console.log("rust-analyzer:", RUST_ANALYZER);
console.log("sample:       ", sample);
console.log("rootDir:      ", rootDir);

const child = spawn(RUST_ANALYZER, [], {
  stdio: ["pipe", "pipe", "pipe"],
  shell: false,
  windowsHide: true,
});
child.stderr.on("data", (b) => process.stderr.write("[ra stderr] " + b.toString()));
child.on("exit", (code) => console.log("[ra] exit:", code));

const conn = createMessageConnection(
  new StreamMessageReader(child.stdout),
  new StreamMessageWriter(child.stdin)
);
conn.onUnhandledNotification((n) =>
  console.log("<- notification:", n.method, JSON.stringify(n.params).slice(0, 160))
);
conn.listen();

(async () => {
  try {
    const tInit = Date.now();
    console.log("-> initialize");
    const init = await Promise.race([
      conn.sendRequest("initialize", {
        processId: process.pid,
        rootUri: pathToFileURL(rootDir).toString(),
        workspaceFolders: [{ uri: pathToFileURL(rootDir).toString(), name: "probe-ws" }],
        capabilities: {},
        initializationOptions: {},
      }),
      new Promise((_, r) => setTimeout(() => r(new Error("init timeout 30s")), 30000)),
    ]);
    console.log(
      "initialize returned in",
      Date.now() - tInit,
      "ms, hoverProvider:",
      !!init?.capabilities?.hoverProvider
    );
    conn.sendNotification("initialized", {});

    console.log("-> didOpen", uri);
    conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId: "rust", version: 1, text },
    });

    // Reproduce the user's bug: hover *immediately*, before indexing is done.
    // With a tight timeout this should fail to return anything within budget.
    const tEarly = Date.now();
    try {
      const early = await Promise.race([
        conn.sendRequest("textDocument/hover", {
          textDocument: { uri },
          position: { line: 16, character: 5 },
        }),
        new Promise((_, rj) => setTimeout(() => rj(new Error("early hover timeout 8s")), 8000)),
      ]);
      console.log(
        `early hover after ${Date.now() - tEarly}ms:`,
        JSON.stringify(early, null, 0).slice(0, 160)
      );
    } catch (e) {
      console.log(`early hover failed after ${Date.now() - tEarly}ms:`, e.message);
    }

    // Wait for rust-analyzer to load (cold start can be slow). Wait either
    // for a "Loading: " progress notification ending or a fixed timeout.
    let loadDone = false;
    conn.onUnhandledNotification?.((n) => {
      if (n.method === "$/progress") {
        const v = n.params?.value ?? {};
        if (v.kind === "end") loadDone = true;
        console.log("[progress]", v.kind ?? "?", v.title ?? "", v.message ?? "");
      }
    });
    const start = Date.now();
    while (!loadDone && Date.now() - start < 25_000) {
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log("ready in", Date.now() - start, "ms");

    // Find positions of interest — `anchor` is the substring whose middle we
    // want to land on (so we don't hover the leading keyword).
    const lines = text.split(/\r?\n/);
    async function hoverAt(label, lineFragment, anchor) {
      let line = -1,
        ch = 0;
      for (let i = 0; i < lines.length; i++) {
        const lineIdx = lines[i].indexOf(lineFragment);
        if (lineIdx >= 0) {
          line = i;
          const anchorIdx = lines[i].indexOf(anchor, lineIdx);
          ch = anchorIdx + Math.floor(anchor.length / 2);
          break;
        }
      }
      if (line < 0) {
        console.log(`hover[${label}] - line fragment not found: '${lineFragment}'`);
        return;
      }
      const r = await Promise.race([
        conn.sendRequest("textDocument/hover", {
          textDocument: { uri },
          position: { line, character: ch },
        }),
        new Promise((_, rj) => setTimeout(() => rj(new Error(label + " timeout")), 15000)),
      ]).catch((e) => ({ __error: e.message }));
      console.log(
        `hover[${label}] L${line + 1}:${ch + 1}:`,
        JSON.stringify(r, null, 0).slice(0, 300)
      );
    }

    await hoverAt("fn-multiply_by-decl", "fn multiply_by", "multiply_by");
    await hoverAt("fn-multiply_by-call", "multiply_by(*n,", "multiply_by");
    await hoverAt("var-total", "let mut total", "total");
    await hoverAt("struct-Greeter", "struct Greeter", "Greeter");
    await hoverAt("method-greet", "fn greet(&self)", "greet");
  } catch (e) {
    console.error("PROBE FAILED:", e.message);
  } finally {
    try {
      await conn.sendRequest("shutdown", null);
    } catch {}
    child.kill();
    setTimeout(() => process.exit(0), 200).unref?.();
  }
})();
