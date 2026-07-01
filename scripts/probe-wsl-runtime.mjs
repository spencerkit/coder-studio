import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const entry = resolve("packages/runtime/dist/esm/wsl-runtime-entry.mjs");
if (!existsSync(entry)) {
  console.error("Missing", entry);
  process.exit(1);
}

const bootstrap = JSON.stringify({
  runtimeId: "wsl:test",
  workspace: {
    id: "ws-test",
    path: "/home/w/workspace",
    targetRuntime: "wsl",
    wslDistro: "Ubuntu-24.04",
    uiState: { leftPanelWidth: 250, bottomPanelHeight: 200, focusMode: false },
  },
  stateRoot: "~/.coder-studio/runtimes/wsl_test",
  settings: {},
  workspaces: [],
  customProviders: [],
});

const script = [
  'ENTRY="${1-}"',
  'NODE="$(command -v node 2>/dev/null || command -v nodejs 2>/dev/null)"',
  'if [ -z "$NODE" ] && [ -x "$HOME/.local/share/fnm/aliases/default/bin/node" ]; then NODE="$HOME/.local/share/fnm/aliases/default/bin/node"; fi',
  'if [ -z "$NODE" ] && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; NODE="$(command -v node 2>/dev/null)"; fi',
  'if [ -z "$NODE" ] && [ -x "$HOME/.local/share/fnm/fnm" ]; then eval "$("$HOME/.local/share/fnm/fnm" env)"; NODE="$(command -v node 2>/dev/null)"; fi',
  'if [ -z "$NODE" ]; then exit 127; fi',
  'exec "$NODE" "$ENTRY"',
].join("; ");

const wslEntry = entry.replace(/^C:/i, "/mnt/c").replace(/\\/g, "/");

const args = [
  "-d",
  "Ubuntu-24.04",
  "--cd",
  "/home/w/workspace",
  "-e",
  "sh",
  "-c",
  script,
  "sh",
  wslEntry,
];

console.log("Launching:", args.join(" "));

const child = spawn("wsl.exe", args, {
  env: {
    ...process.env,
    WSLENV: "CODER_STUDIO_WSL_RUNTIME_BOOTSTRAP/u",
    CODER_STUDIO_WSL_RUNTIME_BOOTSTRAP: bootstrap,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout.on("data", (d) => process.stdout.write(d));
child.stderr.on("data", (d) => process.stderr.write(d));
child.on("close", (code) => {
  console.log("\nexit", code);
  process.exit(code ?? 1);
});
