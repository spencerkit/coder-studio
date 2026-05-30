#!/usr/bin/env node
// Probe the Vue + tsserver bridge end-to-end against a real Volar + TS server.
// Usage: node scripts/probe-vue-bridge.mjs [path/to/some.vue]
//
// Spawns @vue/language-server (managed install) and typescript-language-server
// (bundled), initializes both with the same payloads our LspSession uses, opens
// a .vue document on Volar, and asks Volar for hover at a specific position.
// Bridges tsserver/request <-> workspace/executeCommand inline so we can print
// each step of the round-trip.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Resolve from packages/server which has vscode-jsonrpc in its node_modules.
const require = createRequire(
  pathToFileURL(join(process.cwd(), "packages", "server", "package.json")).toString()
);
const jsonrpc = require("vscode-jsonrpc/node.js");
const { createMessageConnection, StreamMessageReader, StreamMessageWriter } = jsonrpc;

const STATE_DIR = process.env.STATE_DIR ?? join(tmpdir(), "coder-studio-dev");
const VUE_INSTALL_ROOT = join(STATE_DIR, "lsp-tools", "vue", "3.3.2-typescript-6.0.3");
const VUE_BIN =
  process.platform === "win32"
    ? join(VUE_INSTALL_ROOT, "node_modules", ".bin", "vue-language-server.cmd")
    : join(VUE_INSTALL_ROOT, "node_modules", ".bin", "vue-language-server");
const VUE_PKG = join(VUE_INSTALL_ROOT, "node_modules", "@vue", "language-server");
const TSDK = join(VUE_INSTALL_ROOT, "node_modules", "typescript", "lib");

const TSLS_CLI = require.resolve("typescript-language-server/lib/cli.mjs", {
  paths: [join(process.cwd(), "packages", "server"), process.cwd()],
});

const sample = process.argv[2] ? resolve(process.argv[2]) : writeSample();

const sampleText = readFileSync(sample, "utf8");
const sampleUri = pathToFileURL(sample).toString();
const rootDir = dirname(sample);
const rootUri = pathToFileURL(rootDir).toString();

console.log("paths:");
console.log("  vue bin:        ", VUE_BIN);
console.log("  vue install:    ", VUE_PKG);
console.log("  tsdk:           ", TSDK);
console.log("  tsls cli:       ", TSLS_CLI);
console.log("  sample:         ", sample);
console.log("  sample exists?  ", existsSync(sample));
console.log("  vue bin exists? ", existsSync(VUE_BIN));
console.log();

if (!existsSync(VUE_BIN)) {
  console.error("Vue bin missing; run the app once so it installs Volar.");
  process.exit(1);
}

const volar = spawn(VUE_BIN, ["--stdio"], {
  cwd: rootDir,
  stdio: ["pipe", "pipe", "pipe"],
  shell: process.platform === "win32",
  windowsHide: true,
});
const tsls = spawn(process.execPath, [TSLS_CLI, "--stdio"], {
  cwd: rootDir,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

volar.stderr.on("data", (b) => process.stderr.write("[volar stderr] " + b.toString()));
tsls.stderr.on("data", (b) => process.stderr.write("[tsls stderr]  " + b.toString()));
volar.on("exit", (code) => console.log("[volar] exit code:", code));
tsls.on("exit", (code) => console.log("[tsls] exit code:", code));

const volarConn = createMessageConnection(
  new StreamMessageReader(volar.stdout),
  new StreamMessageWriter(volar.stdin)
);
const tslsConn = createMessageConnection(
  new StreamMessageReader(tsls.stdout),
  new StreamMessageWriter(tsls.stdin)
);

volarConn.onUnhandledNotification((n) =>
  console.log("[volar->] unhandled notification:", n.method, JSON.stringify(n.params).slice(0, 200))
);
tslsConn.onUnhandledNotification((n) =>
  console.log("[tsls->]  unhandled notification:", n.method, JSON.stringify(n.params).slice(0, 200))
);

function unwrap(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return raw;
  if (!("body" in raw) && raw.type !== "response") return raw;
  if (raw.success === false) return null;
  return raw.body ?? null;
}

// Bridge tsserver/request -> workspace/executeCommand on tsls
volarConn.onNotification("tsserver/request", async (payload) => {
  if (!Array.isArray(payload) || payload.length < 2) {
    console.log("[bridge] malformed tsserver/request payload:", payload);
    return;
  }
  const [id, command, args] = payload;
  console.log("[bridge] tsserver/request id=", id, "command=", command);
  try {
    const raw = await Promise.race([
      tslsConn.sendRequest("workspace/executeCommand", {
        command: "typescript.tsserverRequest",
        arguments: [command, args],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("bridge timeout")), 8000)),
    ]);
    const unwrapped = unwrap(raw);
    console.log("[bridge] tsserver response (unwrapped):", trim(unwrapped));
    volarConn.sendNotification("tsserver/response", [id, unwrapped]);
  } catch (e) {
    console.log("[bridge] tsserver request failed:", e.message);
    volarConn.sendNotification("tsserver/response", [id, null]);
  }
});

volarConn.listen();
tslsConn.listen();

const VUE_INIT_OPTIONS = { typescript: { tsdk: TSDK } };
// Override location with PROBE_LOCATION env if set, so we can try alternative
// paths without editing the file.
const LOCATION = process.env.PROBE_LOCATION ?? VUE_PKG;
console.log("plugin location:", LOCATION);
const TSLS_INIT_OPTIONS = {
  plugins: [
    {
      name: "@vue/typescript-plugin",
      location: LOCATION,
      languages: ["vue"],
      configNamespace: "typescript",
    },
  ],
  tsserver: {
    logVerbosity: "verbose",
    logDirectory: process.env.TSSERVER_LOG_DIR ?? join(tmpdir(), "tsserver-probe-logs"),
    trace: "verbose",
  },
};

const initParams = {
  processId: process.pid,
  rootUri,
  workspaceFolders: [{ uri: rootUri, name: "probe-workspace" }],
  capabilities: {},
};

(async () => {
  try {
    console.log("-> initialize both servers in parallel");
    const [vInit, tInit] = await Promise.all([
      volarConn.sendRequest("initialize", {
        ...initParams,
        initializationOptions: VUE_INIT_OPTIONS,
      }),
      tslsConn.sendRequest("initialize", {
        ...initParams,
        initializationOptions: TSLS_INIT_OPTIONS,
      }),
    ]);
    console.log("volar capabilities.hoverProvider:", !!vInit?.capabilities?.hoverProvider);
    console.log(
      "tsls capabilities.executeCommandProvider:",
      trim(tInit?.capabilities?.executeCommandProvider)
    );

    volarConn.sendNotification("initialized", {});
    tslsConn.sendNotification("initialized", {});

    console.log("-> didOpen on both ends");
    volarConn.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: sampleUri,
        languageId: "vue",
        version: 1,
        text: sampleText,
      },
    });
    tslsConn.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: sampleUri,
        languageId: "vue",
        version: 1,
        text: sampleText,
      },
    });

    // Wait longer so tsserver fully boots and indexes the plugin.
    await new Promise((r) => setTimeout(r, 3500));

    const lines = sampleText.split(/\r?\n/);
    async function probeAt(label, target) {
      let line = 0;
      let char = 0;
      for (let i = 0; i < lines.length; i++) {
        const idx = lines[i].indexOf(target);
        if (idx >= 0) {
          line = i;
          char = idx + Math.max(0, Math.floor(target.length / 2));
          break;
        }
      }
      console.log(
        `\n>>> ${label} at L${line + 1}:${char + 1}  >> '${lines[line]?.slice(Math.max(0, char - 3), char + target.length + 3)}'`
      );
      const position = { line, character: char };

      // Fan out: ask Volar and TSLS in parallel, then merge as the real
      // LspSession does. This mirrors what coder-studio's server does today
      // and is the actual user-visible behavior.
      const tasks = [
        Promise.race([
          volarConn.sendRequest("textDocument/hover", {
            textDocument: { uri: sampleUri },
            position,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("volar hover timeout")), 8000)
          ),
        ]).catch((e) => ({ __error: e.message })),
        Promise.race([
          tslsConn.sendRequest("textDocument/hover", {
            textDocument: { uri: sampleUri },
            position,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("tsls hover timeout")), 8000)
          ),
        ]).catch((e) => ({ __error: e.message })),
      ];
      const [vh, th] = await Promise.all(tasks);
      console.log(`hover[${label}] volar :`, JSON.stringify(vh, null, 0));
      console.log(`hover[${label}] tsls  :`, JSON.stringify(th, null, 0));
      const mergedContents = [];
      for (const r of [vh, th]) {
        if (r && !r.__error && r?.contents) {
          if (typeof r.contents === "string") mergedContents.push(r.contents);
          else if (typeof r.contents?.value === "string") mergedContents.push(r.contents.value);
          else if (Array.isArray(r.contents))
            for (const c of r.contents) {
              if (typeof c === "string") mergedContents.push(c);
              else if (typeof c?.value === "string") mergedContents.push(c.value);
            }
        }
      }
      console.log(`MERGED[${label}]:`, mergedContents.length ? mergedContents : "(empty)");
    }

    async function probeTslsHoverAt(label, target) {
      let line = 0;
      let char = 0;
      for (let i = 0; i < lines.length; i++) {
        const idx = lines[i].indexOf(target);
        if (idx >= 0) {
          line = i;
          char = idx + Math.max(0, Math.floor(target.length / 2));
          break;
        }
      }
      try {
        const hover = await Promise.race([
          tslsConn.sendRequest("textDocument/hover", {
            textDocument: { uri: sampleUri },
            position: { line, character: char },
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`tsls hover timeout`)), 8000)
          ),
        ]);
        console.log(`tslsHover[${label}]:`, JSON.stringify(hover, null, 0));
      } catch (e) {
        console.log(`tslsHover[${label}] failed:`, e.message);
      }
    }

    await probeAt("count-decl", "const count");
    await probeTslsHoverAt("count-decl", "const count");
    await probeAt("ref-import", "ref, computed");
    await probeTslsHoverAt("ref-import", "ref, computed");
    await probeAt("count-usage-in-template", "{{ count");
    await probeTslsHoverAt("count-usage-in-template", "{{ count");

    // Inspect document symbols to confirm Volar parses the SFC at all.
    try {
      const symbols = await volarConn.sendRequest("textDocument/documentSymbol", {
        textDocument: { uri: sampleUri },
      });
      console.log("\ndocumentSymbols:", trim(symbols));
    } catch (e) {
      console.log("documentSymbol failed:", e.message);
    }
  } catch (e) {
    console.error("PROBE FAILED:", e.message);
  } finally {
    console.log("-> shutting down");
    try {
      await volarConn.sendRequest("shutdown", null);
    } catch {}
    try {
      await tslsConn.sendRequest("shutdown", null);
    } catch {}
    volar.kill();
    tsls.kill();
    setTimeout(() => process.exit(0), 500).unref?.();
  }
})();

function trim(value) {
  const s = JSON.stringify(value);
  return s == null ? String(value) : s.length > 240 ? s.slice(0, 240) + "..." : s;
}

function writeSample() {
  const path = join(tmpdir(), "probe-vue-bridge-sample.vue");
  const content = `<script setup lang="ts">
import { ref, computed } from 'vue'

const count = ref(0)
const doubled = computed(() => count.value * 2)
</script>

<template>
  <button>{{ count }} {{ doubled }}</button>
</template>
`;
  if (!existsSync(path)) {
    const fs = require("node:fs");
    fs.writeFileSync(path, content);
  }
  return path;
}
