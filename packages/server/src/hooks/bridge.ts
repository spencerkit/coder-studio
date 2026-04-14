import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

/**
 * Hooks bridge directory where bridge scripts are deployed
 */
export const HOOKS_BRIDGE_DIR = join(homedir(), '.coder-studio', 'hooks');

/**
 * Generates bridge script content for a specific provider
 * The bridge script:
 * 1. Reads runtime.json to get server port and token
 * 2. Reads payload from stdin
 * 3. POSTs to /internal/hooks/:event endpoint
 * 4. Fails silently on any error (critical for CLI integration)
 */
export function generateBridgeScript(providerId: string): string {
  return `// Coder Studio hook bridge for ${providerId}
// Auto-generated - do not edit
const fs = require("fs");
const http = require("http");
const path = require("path");
const os = require("os");

const event = process.argv[2];
const runtimePath = path.join(os.homedir(), ".coder-studio", "runtime.json");

let runtime;
try {
  runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
} catch {
  process.exit(0);  // Coder Studio not running → silent exit
}

let payload = "";
try {
  payload = fs.readFileSync(0, "utf8");  // stdin
} catch {}

let body;
try {
  body = JSON.parse(payload || "{}");
} catch {
  body = { raw: payload };
}

const req = http.request({
  hostname: "127.0.0.1",
  port: runtime.port,
  path: \`/internal/hooks/\${encodeURIComponent(event)}?token=\${encodeURIComponent(runtime.token)}\`,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  timeout: 500,
});

req.on("error", () => process.exit(0));  // Silent failure
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

  // Ensure directory exists
  if (!existsSync(HOOKS_BRIDGE_DIR)) {
    mkdirSync(HOOKS_BRIDGE_DIR, { recursive: true });
  }

  // Check if content has changed
  if (existsSync(scriptPath)) {
    const existingContent = readFileSync(scriptPath, 'utf-8');
    const existingHash = hashContent(existingContent);
    const newHash = hashContent(scriptContent);

    if (existingHash === newHash) {
      // Content unchanged, skip write
      return;
    }
  }

  // Write new content
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
 * Used to detect changes
 */
function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
