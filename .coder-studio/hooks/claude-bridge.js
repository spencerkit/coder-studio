/**
 * Claude Hook Bridge
 *
 * Single-file Node.js script that bridges Claude hooks to Coder Studio
 * Reads payload from stdin, reads runtime.json, POSTs to server
 *
 * CRITICAL: Zero external dependencies - pure Node.js
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// Runtime directory (default: ~/.coder-studio)
const RUNTIME_DIR =
  process.env.CODER_STUDIO_RUNTIME_DIR ||
  path.join(process.env.HOME || process.env.USERPROFILE, '.coder-studio');

const RUNTIME_JSON_PATH = path.join(RUNTIME_DIR, 'runtime.json');

/**
 * Read runtime configuration
 */
function readRuntimeConfig() {
  try {
    const content = fs.readFileSync(RUNTIME_JSON_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    // Silently fail - server may not be running
    return null;
  }
}

/**
 * Read payload from stdin
 */
async function readStdinPayload() {
  return new Promise((resolve, reject) => {
    const chunks = [];

    process.stdin.on('data', (chunk) => {
      chunks.push(chunk);
    });

    process.stdin.on('end', () => {
      const content = Buffer.concat(chunks).toString('utf-8');
      try {
        resolve(JSON.parse(content));
      } catch (err) {
        resolve(content); // Return raw string if not JSON
      }
    });

    process.stdin.on('error', reject);
  });
}

/**
 * POST hook event to server
 */
function postHookEvent(port, token, event, payload) {
  const options = {
    hostname: '127.0.0.1',
    port: port,
    path: `/internal/hooks/${event}?token=${token}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(JSON.stringify(payload)),
    },
  };

  const req = http.request(options, (res) => {
    // Ignore response - fire and forget
    res.on('data', () => {});
    res.on('end', () => {});
  });

  req.on('error', (err) => {
    // Silently handle connection errors - server may not be running
    if (err.code === 'ECONNREFUSED') {
      // Expected: server not running
      process.exit(0);
    } else {
      // Unexpected error - still silent exit
      process.exit(0);
    }
  });

  req.write(JSON.stringify(payload));
  req.end();
}

/**
 * Main entry point
 */
async function main() {
  // Read runtime config
  const runtime = readRuntimeConfig();
  if (!runtime || !runtime.port || !runtime.token) {
    // Server not running or config missing - silent exit
    process.exit(0);
  }

  // Read hook payload from stdin
  const payload = await readStdinPayload();

  // Extract event name from Claude's hook invocation
  // Claude passes event name as argument or in payload
  const event =
    process.argv[2] || // Event name from CLI argument
    payload.event || // Event name in payload
    'unknown';

  // POST to server
  postHookEvent(runtime.port, runtime.token, event, payload);

  // Exit immediately - fire and forget
  // Give request time to complete (100ms)
  setTimeout(() => {
    process.exit(0);
  }, 100);
}

// Run
main().catch(() => {
  // Silent exit on any error
  process.exit(0);
});