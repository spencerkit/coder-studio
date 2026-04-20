import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

/**
 * Hooks bridge directory where bridge scripts are deployed
 */
export const HOOKS_BRIDGE_DIR = join(homedir(), '.coder-studio', 'hooks');

/**
 * Generates bridge script content for a specific provider.
 *
 * Claude reads payload from stdin (Claude hook contract).
 * Codex reads payload from last argv argument (Codex -c notify contract).
 */
export function generateBridgeScript(providerId: string): string {
  const isCodex = providerId === 'codex';

  return `// Coder Studio hook bridge for ${providerId}
// Auto-generated - do not edit
const fs = require("fs");
const http = require("http");
const path = require("path");
const os = require("os");

const runtimePath = path.join(os.homedir(), ".coder-studio", "runtime.json");

let runtime;
try {
  runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
} catch {
  process.exit(0);
}

let body;
${isCodex ? `
// Codex: payload is the last argv argument (JSON string)
const lastArg = process.argv[process.argv.length - 1];
try {
  body = JSON.parse(lastArg || "{}");
} catch {
  body = { raw: lastArg };
}
` : `
// Claude: payload from stdin
let payload = "";
try {
  payload = fs.readFileSync(0, "utf8");
} catch {}
try {
  body = JSON.parse(payload || "{}");
} catch {
  body = { raw: payload };
}
`}

const event = process.argv[2] || body.type || "unknown";

const req = http.request({
  hostname: "127.0.0.1",
  port: runtime.port,
  path: \`/internal/hooks/\${encodeURIComponent(event)}?token=\${encodeURIComponent(runtime.token)}&coder_studio_session_id=\${encodeURIComponent(process.env.CODER_STUDIO_SESSION_ID || "")}\`,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  timeout: 500,
});
const bodyJson = JSON.stringify(body);
req.setHeader("Content-Length", Buffer.byteLength(bodyJson));

req.on("error", () => process.exit(0));
req.on("timeout", () => { req.destroy(); process.exit(0); });
req.write(JSON.stringify(body));
req.end();
req.on("response", () => process.exit(0));
`;
}

/**
 * Deploys bridge scripts for all providers
 * Only writes if content has changed (based on hash)
 */
export function deployBridgeScript(providerId: string): void {
  const scriptContent = generateBridgeScript(providerId);
  const scriptPath = getBridgeScriptPath(providerId);

  if (!existsSync(HOOKS_BRIDGE_DIR)) {
    mkdirSync(HOOKS_BRIDGE_DIR, { recursive: true });
  }

  if (existsSync(scriptPath)) {
    const existingContent = readFileSync(scriptPath, 'utf-8');
    const existingHash = hashContent(existingContent);
    const newHash = hashContent(scriptContent);

    if (existingHash === newHash) {
      return;
    }
  }

  writeFileSync(scriptPath, scriptContent, 'utf-8');
}

/**
 * Gets the path to a provider's bridge script
 */
export function getBridgeScriptPath(providerId: string): string {
  return join(HOOKS_BRIDGE_DIR, `${providerId}-bridge.js`);
}

/**
 * Computes SHA-256 hash of content
 */
function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
