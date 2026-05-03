/**
 * Codex Hook Bridge
 *
 * Reads event payload from last argv argument (Codex -c notify contract).
 * Reads runtime.json for server port + token.
 * POSTs to /internal/hooks/:event on Coder Studio server.
 *
 * CRITICAL: Zero external dependencies - pure Node.js
 * CRITICAL: Fail silently — hooks must not interrupt the user's CLI session.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const RUNTIME_DIR =
  process.env.CODER_STUDIO_RUNTIME_DIR ||
  path.join(process.env.HOME || process.env.USERPROFILE, '.coder-studio');
const RUNTIME_JSON_PATH =
  process.env.CODER_STUDIO_RUNTIME_JSON_PATH ||
  path.join(RUNTIME_DIR, 'runtime.json');

function readRuntimeConfig() {
  try {
    return JSON.parse(fs.readFileSync(RUNTIME_JSON_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function postHookEvent(port, token, event, payload, sessionId) {
  const encodedEvent = encodeURIComponent(event);
  const encodedToken = encodeURIComponent(token);
  const encodedSessionId = encodeURIComponent(sessionId || '');
  const qs = sessionId
    ? `token=${encodedToken}&coder_studio_session_id=${encodedSessionId}`
    : `token=${encodedToken}`;

  const bodyStr = JSON.stringify(payload);
  const options = {
    hostname: '127.0.0.1',
    port,
    path: `/internal/hooks/${encodedEvent}?${qs}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
    },
  };

  const req = http.request(options, () => {});
  req.on('error', () => process.exit(0));
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.write(bodyStr);
  req.end();
}

async function main() {
  const runtime = readRuntimeConfig();
  if (!runtime || !runtime.port || !runtime.token) {
    process.exit(0);
  }

  // Codex passes payload as last argv argument
  const lastArg = process.argv[process.argv.length - 1];
  let payload;
  try {
    payload = JSON.parse(lastArg || '{}');
  } catch {
    payload = { raw: lastArg };
  }

  const event = process.argv[2] || payload.type || 'unknown';
  const sessionId = process.env.CODER_STUDIO_SESSION_ID || '';

  postHookEvent(runtime.port, runtime.token, event, payload, sessionId);

  setTimeout(() => process.exit(0), 100);
}

main().catch(() => process.exit(0));
