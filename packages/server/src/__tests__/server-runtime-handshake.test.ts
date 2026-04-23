import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createServer, type Server } from '../server.js';
import { getRuntimePath } from '../hooks/runtime-json.js';

const RUNTIME_PATH = getRuntimePath();
const BRIDGE_DIR = join(homedir(), '.coder-studio', 'hooks');

function cleanupRuntimeAndBridges() {
  // Only remove files we own. Leave the ~/.coder-studio/ directory alone so
  // we don't delete backups or unrelated state.
  if (existsSync(RUNTIME_PATH)) {
    rmSync(RUNTIME_PATH);
  }
  for (const bridge of ['claude-bridge.js', 'codex-bridge.js']) {
    const path = join(BRIDGE_DIR, bridge);
    if (existsSync(path)) rmSync(path);
  }
}

describe('createServer runtime handshake', () => {
  let server: Server | undefined;

  beforeEach(() => {
    cleanupRuntimeAndBridges();
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = undefined;
    }
    cleanupRuntimeAndBridges();
  });

  it('does not touch ~/.coder-studio/ by default under vitest', async () => {
    // Baseline: in a vitest run parseServerConfig defaults writeRuntime to
    // false, so multiple parallel createServer calls don't race on the
    // shared runtime.json. This is what all other integration tests rely
    // on.
    server = await createServer({
      dataDir: ':memory:',
      host: '127.0.0.1',
      port: 0,
    } as any);

    expect(existsSync(RUNTIME_PATH)).toBe(false);
  });

  it('writes runtime.json when writeRuntime is explicitly enabled and deletes it on stop', async () => {
    server = await createServer({
      dataDir: ':memory:',
      host: '127.0.0.1',
      port: 0,
      writeRuntime: true,
    } as any);

    expect(existsSync(RUNTIME_PATH)).toBe(true);

    const runtime = JSON.parse(readFileSync(RUNTIME_PATH, 'utf-8'));
    expect(typeof runtime.port).toBe('number');
    // port=0 was requested; the OS picks a real port >= 1024 (usually).
    // The important invariant is that we persist the resolved port, not the
    // placeholder value callers passed in.
    expect(runtime.port).toBeGreaterThan(0);
    expect(typeof runtime.token).toBe('string');
    expect(runtime.token.length).toBeGreaterThanOrEqual(32);
    expect(typeof runtime.serverInstanceId).toBe('string');
    expect(typeof runtime.startedAt).toBe('number');

    await server.stop();
    server = undefined;

    expect(existsSync(RUNTIME_PATH)).toBe(false);
  });

  it('deploys per-provider bridge scripts on startup when writeRuntime is enabled', async () => {
    server = await createServer({
      dataDir: ':memory:',
      host: '127.0.0.1',
      port: 0,
      writeRuntime: true,
    } as any);

    // Without these files on disk, Codex's `-c notify=["node","<path>"]`
    // argv would spawn nothing (and Claude's SessionStart hook similarly
    // never runs), so the session state would be stuck in 'starting'
    // forever. This is the regression we're preventing.
    expect(existsSync(join(BRIDGE_DIR, 'claude-bridge.js'))).toBe(true);
    expect(existsSync(join(BRIDGE_DIR, 'codex-bridge.js'))).toBe(true);
  });

  it('accepts /internal/hooks/:event only when the per-process token matches', async () => {
    server = await createServer({
      dataDir: ':memory:',
      host: '127.0.0.1',
      port: 0,
      writeRuntime: true,
      // Disable the auth cookie guard entirely so we're exclusively
      // exercising the token check inside registerHooksEndpoint, not the
      // outer /auth gate.
      auth: { enabled: false },
    } as any);

    const runtime = JSON.parse(readFileSync(RUNTIME_PATH, 'utf-8'));
    const baseUrl = `http://127.0.0.1:${runtime.port}`;

    // Missing token -> 403 from the endpoint (not 401 from auth guard).
    const missing = await fetch(`${baseUrl}/internal/hooks/agent-turn-complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ 'thread-id': 't', 'turn-id': 't' }),
    });
    expect(missing.status).toBe(403);

    // Wrong token -> 403.
    const wrong = await fetch(
      `${baseUrl}/internal/hooks/agent-turn-complete?token=definitely-not-it`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ 'thread-id': 't', 'turn-id': 't' }),
      }
    );
    expect(wrong.status).toBe(403);

    // Correct token -> 200 (the session doesn't exist so the hook routing
    // is a no-op, but the endpoint itself is reachable and authenticated).
    const good = await fetch(
      `${baseUrl}/internal/hooks/agent-turn-complete?token=${encodeURIComponent(runtime.token)}&coder_studio_session_id=nope`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ 'thread-id': 't', 'turn-id': 't' }),
      }
    );
    expect(good.status).toBe(200);
  });

  it('lets bridge scripts reach /internal/hooks/:event even when the auth cookie guard is on', async () => {
    server = await createServer({
      dataDir: ':memory:',
      host: '127.0.0.1',
      port: 0,
      writeRuntime: true,
      auth: { enabled: true, password: 'sekrit' },
    } as any);

    const runtime = JSON.parse(readFileSync(RUNTIME_PATH, 'utf-8'));
    const baseUrl = `http://127.0.0.1:${runtime.port}`;

    // No cookie header — the auth guard would normally 401 this. Our fix
    // whitelists `/internal/hooks/*` so the token check inside the endpoint
    // is what actually gates the request.
    const res = await fetch(
      `${baseUrl}/internal/hooks/agent-turn-complete?token=${encodeURIComponent(runtime.token)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ 'thread-id': 't', 'turn-id': 't' }),
      }
    );
    expect(res.status).toBe(200);
  });
});
