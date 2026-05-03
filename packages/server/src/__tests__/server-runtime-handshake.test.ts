import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import WebSocket from 'ws';
import { createServer, type Server } from '../server.js';
import { getRuntimePath } from '../hooks/runtime-json.js';

function getBridgeDir() {
  return join(homedir(), '.coder-studio', 'hooks');
}

function cleanupRuntimeAndBridges() {
  const runtimePath = getRuntimePath();
  const bridgeDir = getBridgeDir();

  // Only remove files we own. Leave the ~/.coder-studio/ directory alone so
  // we don't delete backups or unrelated state.
  if (existsSync(runtimePath)) {
    rmSync(runtimePath);
  }
  for (const bridge of ['claude-bridge.js', 'codex-bridge.js']) {
    const path = join(bridgeDir, bridge);
    if (existsSync(path)) rmSync(path);
  }
}

function getBaseUrl(server: Server): string {
  const address = server.app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve server address');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function openWebSocket(url: string, cookie?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      headers: cookie ? { cookie } : undefined,
    });

    const handleOpen = () => {
      cleanup();
      resolve(socket);
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const handleUnexpectedResponse = (_request: unknown, response: { statusCode?: number }) => {
      cleanup();
      reject(new Error(`unexpected-response:${response.statusCode ?? 'unknown'}`));
    };
    const cleanup = () => {
      socket.off('open', handleOpen);
      socket.off('error', handleError);
      socket.off('unexpected-response', handleUnexpectedResponse);
    };

    socket.on('open', handleOpen);
    socket.on('error', handleError);
    socket.on('unexpected-response', handleUnexpectedResponse);
  });
}

async function expectWebSocketHandshakeStatus(url: string, expectedStatus: number, cookie?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url, {
      headers: cookie ? { cookie } : undefined,
    });

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const cleanup = () => {
      socket.removeAllListeners();
    };

    socket.on('open', () => {
      finish(() => {
        socket.close();
        reject(new Error(`Expected websocket handshake to fail with ${expectedStatus}`));
      });
    });
    socket.on('unexpected-response', (_request, response) => {
      response.resume();
      finish(() => {
        if (response.statusCode === expectedStatus) {
          resolve();
          return;
        }
        reject(new Error(`Expected websocket handshake status ${expectedStatus}, got ${response.statusCode ?? 'unknown'}`));
      });
    });
    socket.on('error', (error) => {
      if (!settled) {
        finish(() => reject(error));
      }
    });
  });
}

describe('createServer runtime handshake', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  let server: Server | undefined;
  let testHomeDir: string;

  beforeEach(() => {
    testHomeDir = mkdtempSync(join(tmpdir(), 'cs-runtime-home-'));
    process.env.HOME = testHomeDir;
    process.env.USERPROFILE = testHomeDir;
    cleanupRuntimeAndBridges();
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = undefined;
    }
    cleanupRuntimeAndBridges();

    if (existsSync(testHomeDir)) {
      rmSync(testHomeDir, { recursive: true, force: true });
    }

    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
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

    expect(existsSync(getRuntimePath())).toBe(false);
  });

  it('writes runtime.json when writeRuntime is explicitly enabled and deletes it on stop', async () => {
    server = await createServer({
      dataDir: ':memory:',
      host: '127.0.0.1',
      port: 0,
      writeRuntime: true,
    } as any);

    expect(existsSync(getRuntimePath())).toBe(true);

    const runtime = JSON.parse(readFileSync(getRuntimePath(), 'utf-8'));
    expect(typeof runtime.port).toBe('number');
    expect(typeof runtime.pid).toBe('number');
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

    expect(existsSync(getRuntimePath())).toBe(false);
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
    expect(existsSync(join(getBridgeDir(), 'claude-bridge.js'))).toBe(true);
    expect(existsSync(join(getBridgeDir(), 'codex-bridge.js'))).toBe(true);
  });

  it('serves the web root entrypoint without auth cookie when auth is enabled', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'cs-web-root-'));
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><html><body>login shell</body></html>', 'utf-8');

    try {
      server = await createServer({
        dataDir: ':memory:',
        host: '127.0.0.1',
        port: 0,
        webRoot,
        auth: { enabled: true, password: 'sekrit' },
      } as any);

      const address = server.app.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to resolve server address');
      }
      const res = await fetch(`http://127.0.0.1:${address.port}/`);
      const body = await res.text();

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(body).toContain('login shell');
    } finally {
      rmSync(webRoot, { recursive: true, force: true });
    }
  });

  it('serves the SPA entrypoint for authenticated frontend routes', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'cs-web-root-spa-'));
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><html><body>spa shell</body></html>', 'utf-8');

    try {
      server = await createServer({
        dataDir: ':memory:',
        host: '127.0.0.1',
        port: 0,
        webRoot,
        auth: { enabled: true, password: 'sekrit' },
      } as any);

      const address = server.app.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to resolve server address');
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const login = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'sekrit' }),
      });
      const cookie = login.headers.get('set-cookie');
      if (!cookie) {
        throw new Error('Expected auth cookie');
      }

      const res = await fetch(`${baseUrl}/workspace`, {
        headers: { cookie },
      });
      const body = await res.text();

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(body).toContain('spa shell');
    } finally {
      rmSync(webRoot, { recursive: true, force: true });
    }
  });

  it('reports authenticated false before login and true after login with a session cookie', async () => {
    server = await createServer({
      dataDir: ':memory:',
      host: '127.0.0.1',
      port: 0,
      auth: { enabled: true, password: 'sekrit' },
    } as any);

    const baseUrl = getBaseUrl(server);

    const beforeLogin = await fetch(`${baseUrl}/auth/status`);
    expect(beforeLogin.status).toBe(200);
    await expect(beforeLogin.json()).resolves.toEqual({
      ok: true,
      authEnabled: true,
      authenticated: false,
    });

    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'sekrit' }),
    });
    const cookie = login.headers.get('set-cookie');
    if (!cookie) {
      throw new Error('Expected auth cookie');
    }

    expect(cookie).not.toContain('sekrit');

    const afterLogin = await fetch(`${baseUrl}/auth/status`, {
      headers: { cookie },
    });
    expect(afterLogin.status).toBe(200);
    await expect(afterLogin.json()).resolves.toEqual({
      ok: true,
      authEnabled: true,
      authenticated: true,
    });
  });

  it('serves the SPA entrypoint for authenticated frontend routes when the auth password contains cookie-sensitive characters', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'cs-web-root-spa-special-auth-'));
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><html><body>spa shell</body></html>', 'utf-8');

    try {
      server = await createServer({
        dataDir: ':memory:',
        host: '127.0.0.1',
        port: 0,
        webRoot,
        auth: { enabled: true, password: 'sek;rit = value,1' },
      } as any);

      const address = server.app.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to resolve server address');
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const login = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'sek;rit = value,1' }),
      });
      const cookie = login.headers.get('set-cookie');
      if (!cookie) {
        throw new Error('Expected auth cookie');
      }

      const res = await fetch(`${baseUrl}/workspace`, {
        headers: { cookie },
      });
      const body = await res.text();

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(body).toContain('spa shell');
    } finally {
      rmSync(webRoot, { recursive: true, force: true });
    }
  });

  it('rejects websocket connections without an auth session cookie when auth is enabled', async () => {
    server = await createServer({
      dataDir: ':memory:',
      host: '127.0.0.1',
      port: 0,
      auth: { enabled: true, password: 'sekrit' },
    } as any);

    const baseUrl = getBaseUrl(server);
    const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';

    await expectWebSocketHandshakeStatus(wsUrl, 401);
  });

  it('accepts websocket connections with a valid auth session cookie when auth is enabled', async () => {
    server = await createServer({
      dataDir: ':memory:',
      host: '127.0.0.1',
      port: 0,
      auth: { enabled: true, password: 'sekrit' },
    } as any);

    const baseUrl = getBaseUrl(server);
    const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';

    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'sekrit' }),
    });
    const cookie = login.headers.get('set-cookie');
    if (!cookie) {
      throw new Error('Expected auth cookie');
    }

    const socket = await openWebSocket(wsUrl, cookie);

    try {
      const firstMessage = await new Promise<string>((resolve, reject) => {
        socket.once('message', (payload) => resolve(payload.toString()));
        socket.once('error', reject);
      });

      expect(JSON.parse(firstMessage)).toMatchObject({
        kind: 'event',
        topic: 'connection.status',
        data: {
          status: 'connected',
          authEnabled: true,
        },
      });
    } finally {
      socket.close();
    }
  });

  it('serves the auth route entrypoint without auth cookie when auth is enabled', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'cs-web-root-auth-'));
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><html><body>auth shell</body></html>', 'utf-8');

    try {
      server = await createServer({
        dataDir: ':memory:',
        host: '127.0.0.1',
        port: 0,
        webRoot,
        auth: { enabled: true, password: 'sekrit' },
      } as any);

      const address = server.app.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to resolve server address');
      }

      const res = await fetch(`http://127.0.0.1:${address.port}/auth`);
      const body = await res.text();

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(body).toContain('auth shell');
    } finally {
      rmSync(webRoot, { recursive: true, force: true });
    }
  });

  it('redirects unauthenticated frontend routes to /auth when auth is enabled', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'cs-web-root-auth-redirect-'));
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><html><body>auth shell</body></html>', 'utf-8');

    try {
      server = await createServer({
        dataDir: ':memory:',
        host: '127.0.0.1',
        port: 0,
        webRoot,
        auth: { enabled: true, password: 'sekrit' },
      } as any);

      const baseUrl = getBaseUrl(server);

      for (const path of ['/workspace', '/settings']) {
        const res = await fetch(`${baseUrl}${path}`, {
          headers: { accept: 'text/html' },
          redirect: 'manual',
        });

        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe('/auth');
      }
    } finally {
      rmSync(webRoot, { recursive: true, force: true });
    }
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

    const runtime = JSON.parse(readFileSync(getRuntimePath(), 'utf-8'));
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

    const runtime = JSON.parse(readFileSync(getRuntimePath(), 'utf-8'));
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
