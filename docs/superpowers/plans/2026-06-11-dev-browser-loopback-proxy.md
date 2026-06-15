# Dev Browser Loopback Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Coder Studio built-in browser that opens manually entered loopback dev-server URLs through an authenticated HTTP proxy and service-worker resource router.

**Architecture:** Server owns loopback target validation, short-lived sessions, dev-browser shell HTML, and HTTP proxying under `/dev-browser/session/:id/proxy/*`. Web owns the workspace browser UI, service worker script, URL mapping, lifecycle cleanup, and visible unsupported states. WebSocket/HMR are explicitly unsupported in v1 and fail with a clear message.

**Tech Stack:** Fastify 5, Node 24 `fetch`, React 19, Jotai, Vite public assets, Vitest, Testing Library, TypeScript.

---

## File Structure

- Create `packages/server/src/dev-browser/target-url.ts`: parse and validate manual loopback URLs.
- Create `packages/server/src/dev-browser/target-url.test.ts`: URL validation tests.
- Create `packages/server/src/dev-browser/session-store.ts`: in-memory short-lived dev browser session store.
- Create `packages/server/src/dev-browser/session-store.test.ts`: session lifecycle and expiry tests.
- Create `packages/server/src/dev-browser/proxy-headers.ts`: request and response header filtering plus redirect location rewriting.
- Create `packages/server/src/dev-browser/proxy-headers.test.ts`: hop-by-hop stripping and redirect rewrite tests.
- Create `packages/server/src/routes/dev-browser.ts`: create/read/delete session API, dev-browser shell route, HTTP proxy route.
- Create `packages/server/src/routes/dev-browser.test.ts`: route, proxy, and error handling tests.
- Modify `packages/server/src/app.ts`: register dev browser routes before static fallback routes.
- Modify `packages/server/src/app-routing.test.ts`: assert `/dev-browser/session/:id/proxy/*` is not swallowed by SPA fallback.
- Create `packages/web/public/dev-browser-sw.js`: service worker script scoped to `/dev-browser/`.
- Create `packages/web/src/features/dev-browser/dev-browser-sw.test.ts`: load the public SW script in a mocked worker global and test mapper behavior.
- Create `packages/web/src/features/dev-browser/api.ts`: client API for create/read/delete dev browser sessions.
- Create `packages/web/src/features/dev-browser/api.test.ts`: credentialed fetch and error handling tests.
- Create `packages/web/src/features/dev-browser/dev-browser-surface.tsx`: address bar, session lifecycle, iframe, and unsupported-state UI.
- Create `packages/web/src/features/dev-browser/dev-browser-surface.test.tsx`: form, iframe, cleanup, and unsupported-state tests.
- Modify `packages/web/src/features/workspace/atoms/layout.ts`: add `browser` desktop sidebar view.
- Modify `packages/web/src/features/workspace/actions/use-workspace-screen-model.ts`: add browser main-area mode and mobile sheet kind.
- Modify `packages/web/src/features/workspace/views/shared/workspace-activity-bar.tsx`: add desktop Browser activity item.
- Modify `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`: render `DevBrowserSurface` in the desktop main stage.
- Modify `packages/web/src/features/workspace/views/mobile/mobile-dock.tsx`: add mobile Browser dock item.
- Modify `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx`: render Browser sheet.
- Modify related workspace view tests under `packages/web/src/features/workspace/views/**`: cover desktop and mobile browser entry points.
- Modify `packages/web/src/theme/icon-theme.ts`: add `nav.browser` and `mobile.dock.browser`.
- Modify `packages/web/src/locales/en.json` and `packages/web/src/locales/zh.json`: add dev browser labels and errors.
- Modify `packages/web/src/styles/components.css`: add dev browser layout styles.
- Modify `packages/web/vite.config.ts`: proxy `/dev-browser` during web dev so Vite-hosted UI can reach backend shell and proxy routes.
- Modify `docs/help/mobile-guide.md`: document manual local dev-server browser use and WebSocket/HMR limitation.

---

### Task 1: Server Target URL Validation

**Files:**
- Create: `packages/server/src/dev-browser/target-url.ts`
- Create: `packages/server/src/dev-browser/target-url.test.ts`

- [ ] **Step 1: Write failing validation tests**

Create `packages/server/src/dev-browser/target-url.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { parseDevBrowserTargetUrl, DevBrowserTargetUrlError } from "./target-url.js";

describe("parseDevBrowserTargetUrl", () => {
  it("accepts loopback HTTP URLs with explicit ports", () => {
    expect(parseDevBrowserTargetUrl("http://localhost:8000/app?draft=1#top")).toMatchObject({
      targetOrigin: "http://127.0.0.1:8000",
      targetPath: "/app?draft=1",
      targetHash: "#top",
      connectHost: "127.0.0.1",
      port: 8000,
    });

    expect(parseDevBrowserTargetUrl("http://127.0.0.1:5173/")).toMatchObject({
      targetOrigin: "http://127.0.0.1:5173",
      targetPath: "/",
      targetHash: "",
      connectHost: "127.0.0.1",
      port: 5173,
    });

    expect(parseDevBrowserTargetUrl("http://[::1]:3000/docs")).toMatchObject({
      targetOrigin: "http://[::1]:3000",
      targetPath: "/docs",
      targetHash: "",
      connectHost: "::1",
      port: 3000,
    });
  });

  it("normalizes manual input without an explicit protocol to HTTP", () => {
    expect(parseDevBrowserTargetUrl("localhost:8000")).toMatchObject({
      displayUrl: "http://localhost:8000/",
      targetOrigin: "http://127.0.0.1:8000",
      targetPath: "/",
    });
  });

  it("rejects non-loopback and unsafe targets", () => {
    const invalidInputs = [
      "https://localhost:8000",
      "http://localhost",
      "http://localhost:0",
      "http://localhost:8000@evil.test",
      "http://user:pass@localhost:8000",
      "http://192.168.1.20:8000",
      "http://example.com:8000",
      "file:///tmp/index.html",
      "",
    ];

    for (const input of invalidInputs) {
      expect(() => parseDevBrowserTargetUrl(input), input).toThrow(DevBrowserTargetUrlError);
    }
  });
});
```

- [ ] **Step 2: Run the validation test and confirm it fails**

Run:

```bash
pnpm --filter @coder-studio/server test src/dev-browser/target-url.test.ts
```

Expected: fails because `packages/server/src/dev-browser/target-url.ts` does not exist.

- [ ] **Step 3: Implement the validator**

Create `packages/server/src/dev-browser/target-url.ts` with:

```ts
export class DevBrowserTargetUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevBrowserTargetUrlError";
  }
}

export interface DevBrowserTarget {
  connectHost: "127.0.0.1" | "::1";
  displayUrl: string;
  originalHost: "localhost" | "127.0.0.1" | "[::1]";
  port: number;
  targetHash: string;
  targetOrigin: string;
  targetPath: string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function withDefaultProtocol(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new DevBrowserTargetUrlError("empty_url");
  }
  return /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function parsePort(url: URL): number {
  if (!url.port) {
    throw new DevBrowserTargetUrlError("missing_port");
  }

  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DevBrowserTargetUrlError("invalid_port");
  }

  return port;
}

export function parseDevBrowserTargetUrl(input: string): DevBrowserTarget {
  let url: URL;
  try {
    url = new URL(withDefaultProtocol(input));
  } catch {
    throw new DevBrowserTargetUrlError("invalid_url");
  }

  if (url.protocol !== "http:") {
    throw new DevBrowserTargetUrlError("unsupported_protocol");
  }

  if (url.username || url.password) {
    throw new DevBrowserTargetUrlError("credentials_not_allowed");
  }

  const host = url.hostname as "localhost" | "127.0.0.1" | "[::1]";
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new DevBrowserTargetUrlError("host_not_allowed");
  }

  const port = parsePort(url);
  const connectHost = host === "[::1]" ? "::1" : "127.0.0.1";
  const targetOrigin = connectHost === "::1" ? `http://[::1]:${port}` : `http://127.0.0.1:${port}`;
  const targetPath = `${url.pathname || "/"}${url.search}`;

  return {
    connectHost,
    displayUrl: url.href,
    originalHost: host,
    port,
    targetHash: url.hash,
    targetOrigin,
    targetPath,
  };
}
```

- [ ] **Step 4: Run the validation test and confirm it passes**

Run:

```bash
pnpm --filter @coder-studio/server test src/dev-browser/target-url.test.ts
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/dev-browser/target-url.ts packages/server/src/dev-browser/target-url.test.ts
git commit -m "feat: validate dev browser loopback targets"
```

---

### Task 2: Server Session Store

**Files:**
- Create: `packages/server/src/dev-browser/session-store.ts`
- Create: `packages/server/src/dev-browser/session-store.test.ts`

- [ ] **Step 1: Write failing session store tests**

Create `packages/server/src/dev-browser/session-store.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import type { DevBrowserTarget } from "./target-url.js";
import { DevBrowserSessionStore } from "./session-store.js";

function target(overrides: Partial<DevBrowserTarget> = {}): DevBrowserTarget {
  return {
    connectHost: "127.0.0.1",
    displayUrl: "http://localhost:8000/app",
    originalHost: "localhost",
    port: 8000,
    targetHash: "",
    targetOrigin: "http://127.0.0.1:8000",
    targetPath: "/app",
    ...overrides,
  };
}

describe("DevBrowserSessionStore", () => {
  it("creates and reads short-lived sessions", () => {
    let now = 1_000;
    const store = new DevBrowserSessionStore({ now: () => now, ttlMs: 10_000 });
    const session = store.create(target());

    expect(session.id).toMatch(/^dev_/);
    expect(session.createdAt).toBe(1_000);
    expect(session.expiresAt).toBe(11_000);
    expect(store.get(session.id)).toMatchObject({
      id: session.id,
      targetOrigin: "http://127.0.0.1:8000",
      targetPath: "/app",
    });

    now = 2_000;
    expect(store.get(session.id)?.lastAccessedAt).toBe(2_000);
  });

  it("expires inactive sessions", () => {
    let now = 1_000;
    const store = new DevBrowserSessionStore({ now: () => now, ttlMs: 500 });
    const session = store.create(target());

    now = 1_501;

    expect(store.get(session.id)).toBeNull();
  });

  it("deletes sessions explicitly", () => {
    const store = new DevBrowserSessionStore({ now: () => 1_000, ttlMs: 10_000 });
    const session = store.create(target());

    expect(store.delete(session.id)).toBe(true);
    expect(store.get(session.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the session store test and confirm it fails**

Run:

```bash
pnpm --filter @coder-studio/server test src/dev-browser/session-store.test.ts
```

Expected: fails because `session-store.ts` does not exist.

- [ ] **Step 3: Implement the session store**

Create `packages/server/src/dev-browser/session-store.ts` with:

```ts
import { randomUUID } from "node:crypto";
import type { DevBrowserTarget } from "./target-url.js";

export interface DevBrowserSession extends DevBrowserTarget {
  createdAt: number;
  expiresAt: number;
  id: string;
  lastAccessedAt: number;
}

export interface DevBrowserSessionStoreOptions {
  now?: () => number;
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1_000;

function cloneSession(session: DevBrowserSession): DevBrowserSession {
  return { ...session };
}

export class DevBrowserSessionStore {
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #sessions = new Map<string, DevBrowserSession>();

  constructor(options: DevBrowserSessionStoreOptions = {}) {
    this.#now = options.now ?? (() => Date.now());
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  create(target: DevBrowserTarget): DevBrowserSession {
    const now = this.#now();
    const session: DevBrowserSession = {
      ...target,
      id: `dev_${randomUUID()}`,
      createdAt: now,
      lastAccessedAt: now,
      expiresAt: now + this.#ttlMs,
    };
    this.#sessions.set(session.id, session);
    return cloneSession(session);
  }

  get(id: string): DevBrowserSession | null {
    const session = this.#sessions.get(id);
    if (!session) {
      return null;
    }

    const now = this.#now();
    if (session.expiresAt <= now) {
      this.#sessions.delete(id);
      return null;
    }

    const nextSession = {
      ...session,
      lastAccessedAt: now,
      expiresAt: now + this.#ttlMs,
    };
    this.#sessions.set(id, nextSession);
    return cloneSession(nextSession);
  }

  delete(id: string): boolean {
    return this.#sessions.delete(id);
  }
}
```

- [ ] **Step 4: Run target and session tests**

Run:

```bash
pnpm --filter @coder-studio/server test src/dev-browser/target-url.test.ts src/dev-browser/session-store.test.ts
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/dev-browser/session-store.ts packages/server/src/dev-browser/session-store.test.ts
git commit -m "feat: store dev browser proxy sessions"
```

---

### Task 3: Proxy Header Filtering

**Files:**
- Create: `packages/server/src/dev-browser/proxy-headers.ts`
- Create: `packages/server/src/dev-browser/proxy-headers.test.ts`

- [ ] **Step 1: Write failing header tests**

Create `packages/server/src/dev-browser/proxy-headers.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
  filterProxyRequestHeaders,
  filterProxyResponseHeaders,
  rewriteProxyLocationHeader,
} from "./proxy-headers.js";

describe("dev browser proxy headers", () => {
  it("strips hop-by-hop request headers and sets the target host", () => {
    expect(
      Object.fromEntries(
        filterProxyRequestHeaders(
          {
            connection: "upgrade",
            host: "coder.example",
            upgrade: "websocket",
            cookie: "coder_studio_auth=secret",
            accept: "text/html",
          },
          "127.0.0.1:8000"
        )
      )
    ).toEqual({
      accept: "text/html",
      host: "127.0.0.1:8000",
    });
  });

  it("strips unsafe response headers", () => {
    const headers = new Headers({
      "content-type": "text/html",
      "content-length": "200",
      "content-encoding": "gzip",
      connection: "keep-alive",
      "set-cookie": "sid=abc",
    });

    expect(Object.fromEntries(filterProxyResponseHeaders(headers))).toEqual({
      "content-type": "text/html",
    });
  });

  it("rewrites loopback redirect locations into browser proxy paths", () => {
    expect(
      rewriteProxyLocationHeader("http://localhost:8000/dashboard?tab=1", {
        browserProxyBase: "/dev-browser/session/dev_1/proxy",
        targetOrigin: "http://127.0.0.1:8000",
        port: 8000,
      })
    ).toBe("/dev-browser/session/dev_1/proxy/dashboard?tab=1");

    expect(
      rewriteProxyLocationHeader("/login", {
        browserProxyBase: "/dev-browser/session/dev_1/proxy",
        targetOrigin: "http://127.0.0.1:8000",
        port: 8000,
      })
    ).toBe("/dev-browser/session/dev_1/proxy/login");
  });
});
```

- [ ] **Step 2: Run the header test and confirm it fails**

Run:

```bash
pnpm --filter @coder-studio/server test src/dev-browser/proxy-headers.test.ts
```

Expected: fails because `proxy-headers.ts` does not exist.

- [ ] **Step 3: Implement header filtering**

Create `packages/server/src/dev-browser/proxy-headers.ts` with:

```ts
import type { IncomingHttpHeaders } from "node:http";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const BLOCKED_REQUEST_HEADERS = new Set(["cookie", "authorization", "origin"]);
const BLOCKED_RESPONSE_HEADERS = new Set(["content-length", "content-encoding", "set-cookie"]);

function appendHeader(target: Headers, key: string, value: string | string[] | undefined): void {
  if (value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      target.append(key, entry);
    }
    return;
  }

  target.set(key, value);
}

export function filterProxyRequestHeaders(
  headers: IncomingHttpHeaders,
  targetHost: string
): Headers {
  const filtered = new Headers();

  for (const [rawKey, value] of Object.entries(headers)) {
    const key = rawKey.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(key) || BLOCKED_REQUEST_HEADERS.has(key) || key === "host") {
      continue;
    }

    appendHeader(filtered, key, value);
  }

  filtered.set("host", targetHost);
  return filtered;
}

export function filterProxyResponseHeaders(headers: Headers): Headers {
  const filtered = new Headers();

  headers.forEach((value, rawKey) => {
    const key = rawKey.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(key) || BLOCKED_RESPONSE_HEADERS.has(key)) {
      return;
    }

    filtered.set(key, value);
  });

  return filtered;
}

export function rewriteProxyLocationHeader(
  location: string,
  input: { browserProxyBase: string; port: number; targetOrigin: string }
): string {
  if (location.startsWith("/")) {
    return `${input.browserProxyBase}${location}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(location);
  } catch {
    return location;
  }

  const isLoopback =
    parsed.protocol === "http:" &&
    Number(parsed.port) === input.port &&
    (parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]");

  if (!isLoopback) {
    return location;
  }

  return `${input.browserProxyBase}${parsed.pathname}${parsed.search}${parsed.hash}`;
}
```

- [ ] **Step 4: Run dev-browser server unit tests**

Run:

```bash
pnpm --filter @coder-studio/server test src/dev-browser
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/dev-browser/proxy-headers.ts packages/server/src/dev-browser/proxy-headers.test.ts
git commit -m "feat: filter dev browser proxy headers"
```

---

### Task 4: Server Routes And App Wiring

**Files:**
- Create: `packages/server/src/routes/dev-browser.ts`
- Create: `packages/server/src/routes/dev-browser.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app-routing.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `packages/server/src/routes/dev-browser.test.ts` with focused tests for create, proxy, redirect, invalid target, and unsupported websocket:

```ts
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DevBrowserSessionStore } from "../dev-browser/session-store.js";
import { registerDevBrowserRoutes } from "./dev-browser.js";

describe("dev browser routes", () => {
  let target: ReturnType<typeof Fastify>;
  let app: ReturnType<typeof Fastify>;
  let targetOrigin: string;

  beforeEach(async () => {
    target = Fastify({ logger: false });
    target.get("/app/", async (_request, reply) =>
      reply
        .type("text/html")
        .send('<!doctype html><html><head></head><body><script src="/assets/app.js"></script></body></html>')
    );
    target.get("/assets/app.js", async (_request, reply) =>
      reply.type("application/javascript").send('window.loaded = true;')
    );
    target.post("/api/echo", async (request) => request.body);
    target.get("/redirect", async (_request, reply) => reply.redirect("/app/"));
    await target.listen({ host: "127.0.0.1", port: 0 });

    const address = target.server.address();
    if (!address || typeof address === "string") {
      throw new Error("target listen failed");
    }
    targetOrigin = `http://127.0.0.1:${address.port}`;

    app = Fastify({ logger: false });
    registerDevBrowserRoutes(app, {
      sessions: new DevBrowserSessionStore(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await target.close();
  });

  async function createSession(path = "/app/") {
    const response = await app.inject({
      method: "POST",
      url: "/api/dev-proxy/session",
      payload: { url: `${targetOrigin}${path}` },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as {
      browserProxyBase: string;
      browserUrl: string;
      id: string;
      targetOrigin: string;
    };
  }

  it("creates sessions for loopback targets", async () => {
    const created = await createSession();

    expect(created.id).toMatch(/^dev_/);
    expect(created.browserUrl).toBe(`/dev-browser/session/${created.id}/`);
    expect(created.browserProxyBase).toBe(`/dev-browser/session/${created.id}/proxy`);
    expect(created.targetOrigin).toBe(targetOrigin);
  });

  it("rejects invalid session targets", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/dev-proxy/session",
      payload: { url: "http://example.com:8000" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "invalid_dev_browser_target" });
  });

  it("serves shell HTML that registers the service worker", async () => {
    const created = await createSession();
    const response = await app.inject({
      method: "GET",
      url: created.browserUrl,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("/dev-browser-sw.js");
    expect(response.body).toContain(created.browserProxyBase);
  });

  it("proxies HTML and injects the websocket failure bootstrap", async () => {
    const created = await createSession();
    const response = await app.inject({
      method: "GET",
      url: `${created.browserProxyBase}/app/`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Coder Studio dev browser does not proxy WebSocket");
    expect(response.body).toContain('<script src="/assets/app.js"></script>');
  });

  it("proxies static assets and JSON posts", async () => {
    const created = await createSession();
    const asset = await app.inject({
      method: "GET",
      url: `${created.browserProxyBase}/assets/app.js`,
    });
    const post = await app.inject({
      method: "POST",
      url: `${created.browserProxyBase}/api/echo`,
      headers: { "content-type": "application/json" },
      payload: { ok: true },
    });

    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toContain("javascript");
    expect(asset.body).toContain("window.loaded");
    expect(post.statusCode).toBe(200);
    expect(post.json()).toEqual({ ok: true });
  });

  it("rewrites loopback redirects to browser proxy paths", async () => {
    const created = await createSession("/redirect");
    const response = await app.inject({
      method: "GET",
      url: `${created.browserProxyBase}/redirect`,
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(300);
    expect(response.statusCode).toBeLessThan(400);
    expect(response.headers.location).toBe(`${created.browserProxyBase}/app/`);
  });

  it("rejects websocket upgrade attempts", async () => {
    const created = await createSession();
    const response = await app.inject({
      method: "GET",
      url: `${created.browserProxyBase}/socket`,
      headers: {
        connection: "upgrade",
        upgrade: "websocket",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "websocket_not_supported" });
  });
});
```

- [ ] **Step 2: Run route tests and confirm they fail**

Run:

```bash
pnpm --filter @coder-studio/server test src/routes/dev-browser.test.ts
```

Expected: fails because `registerDevBrowserRoutes` does not exist.

- [ ] **Step 3: Implement dev browser routes**

Create `packages/server/src/routes/dev-browser.ts` with the following route shape:

```ts
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  filterProxyRequestHeaders,
  filterProxyResponseHeaders,
  rewriteProxyLocationHeader,
} from "../dev-browser/proxy-headers.js";
import type { DevBrowserSession } from "../dev-browser/session-store.js";
import { DevBrowserSessionStore } from "../dev-browser/session-store.js";
import { DevBrowserTargetUrlError, parseDevBrowserTargetUrl } from "../dev-browser/target-url.js";

const createSessionSchema = z.object({
  url: z.string().min(1),
});

function browserProxyBase(id: string): string {
  return `/dev-browser/session/${id}/proxy`;
}

function browserUrl(id: string): string {
  return `/dev-browser/session/${id}/`;
}

function serializeSession(session: DevBrowserSession) {
  return {
    id: session.id,
    browserUrl: browserUrl(session.id),
    browserProxyBase: browserProxyBase(session.id),
    displayUrl: session.displayUrl,
    targetOrigin: session.targetOrigin,
    targetPath: session.targetPath,
    targetHash: session.targetHash,
    expiresAt: session.expiresAt,
  };
}

function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function renderDevBrowserShell(session: DevBrowserSession): string {
  const payload = serializeSession(session);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Coder Studio Dev Browser</title>
</head>
<body>
  <p>Opening local preview...</p>
  <script>
    const session = ${escapeJsonForScript(payload)};
    async function openDevBrowserSession() {
      if (!("serviceWorker" in navigator) || !window.isSecureContext) {
        document.body.textContent = "Coder Studio dev browser requires service worker support and a secure context.";
        return;
      }
      const registration = await navigator.serviceWorker.register("/dev-browser-sw.js", { scope: "/dev-browser/" });
      await navigator.serviceWorker.ready;
      const worker = registration.active || registration.waiting || registration.installing;
      worker?.postMessage({ type: "coder-studio-dev-browser-session", session });
      window.location.replace(session.browserProxyBase + session.targetPath + session.targetHash);
    }
    openDevBrowserSession().catch((error) => {
      console.error(error);
      document.body.textContent = "Coder Studio could not open the dev browser session.";
    });
  </script>
</body>
</html>`;
}

function createHtmlBootstrap(session: DevBrowserSession): string {
  const payload = serializeSession(session);
  return `<script>
(function () {
  const session = ${escapeJsonForScript(payload)};
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "coder-studio-dev-browser-session", session });
  }
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = function CoderStudioDevBrowserWebSocket(url, protocols) {
    const value = String(url);
    if (/^wss?:\\/\\/(localhost|127\\.0\\.0\\.1|\\[::1\\])(?::\\d+)?\\b/.test(value)) {
      console.warn("Coder Studio dev browser does not proxy WebSocket connections yet.");
      throw new Error("Coder Studio dev browser does not proxy WebSocket connections yet.");
    }
    return new NativeWebSocket(url, protocols);
  };
  window.WebSocket.prototype = NativeWebSocket.prototype;
})();
</script>`;
}

function injectHtmlBootstrap(html: string, session: DevBrowserSession): string {
  const bootstrap = createHtmlBootstrap(session);
  return html.includes("</head>")
    ? html.replace("</head>", `${bootstrap}</head>`)
    : `${bootstrap}${html}`;
}

function isWebSocketUpgrade(request: FastifyRequest): boolean {
  return (
    String(request.headers.upgrade ?? "").toLowerCase() === "websocket" ||
    String(request.headers.connection ?? "").toLowerCase().includes("upgrade")
  );
}

function resolveProxyTargetUrl(session: DevBrowserSession, request: FastifyRequest): URL {
  const incoming = new URL(request.url, "http://coder-studio.local");
  const prefix = `/dev-browser/session/${session.id}/proxy`;
  const path = incoming.pathname.startsWith(prefix)
    ? incoming.pathname.slice(prefix.length) || "/"
    : "/";
  return new URL(`${path}${incoming.search}`, session.targetOrigin);
}

async function proxyRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  session: DevBrowserSession
) {
  if (isWebSocketUpgrade(request)) {
    return reply.status(400).send({ error: "websocket_not_supported" });
  }

  const targetUrl = resolveProxyTargetUrl(session, request);
  const targetHeaders = filterProxyRequestHeaders(request.headers, targetUrl.host);
  const method = request.method.toUpperCase();
  const init: RequestInit = {
    method,
    headers: targetHeaders,
    redirect: "manual",
  };

  if (method !== "GET" && method !== "HEAD" && request.body !== undefined) {
    if (Buffer.isBuffer(request.body) || typeof request.body === "string") {
      init.body = request.body;
    } else {
      init.body = JSON.stringify(request.body);
      targetHeaders.set("content-type", "application/json");
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, init);
  } catch {
    return reply.status(502).send({ error: "dev_browser_target_unavailable" });
  }

  const responseHeaders = filterProxyResponseHeaders(upstream.headers);
  const location = upstream.headers.get("location");
  if (location) {
    responseHeaders.set(
      "location",
      rewriteProxyLocationHeader(location, {
        browserProxyBase: browserProxyBase(session.id),
        port: session.port,
        targetOrigin: session.targetOrigin,
      })
    );
  }

  responseHeaders.forEach((value, key) => reply.header(key, value));
  reply.status(upstream.status);

  const contentType = upstream.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    const html = injectHtmlBootstrap(await upstream.text(), session);
    return reply.type("text/html; charset=utf-8").send(html);
  }

  if (!upstream.body) {
    return reply.send();
  }

  return reply.send(Readable.fromWeb(upstream.body));
}

export function registerDevBrowserRoutes(
  app: FastifyInstance,
  deps: { sessions?: DevBrowserSessionStore } = {}
): void {
  const sessions = deps.sessions ?? new DevBrowserSessionStore();

  app.post("/api/dev-proxy/session", async (request, reply) => {
    const parsed = createSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_dev_browser_payload" });
    }

    try {
      const session = sessions.create(parseDevBrowserTargetUrl(parsed.data.url));
      return reply.send(serializeSession(session));
    } catch (error) {
      if (error instanceof DevBrowserTargetUrlError) {
        return reply.status(400).send({ error: "invalid_dev_browser_target" });
      }
      throw error;
    }
  });

  app.get("/api/dev-proxy/session/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = sessions.get(id);
    return session
      ? reply.send(serializeSession(session))
      : reply.status(404).send({ error: "dev_browser_session_not_found" });
  });

  app.delete("/api/dev-proxy/session/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    sessions.delete(id);
    return reply.send({ ok: true });
  });

  app.get("/dev-browser/session/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.redirect(`/dev-browser/session/${id}/`);
  });

  app.get("/dev-browser/session/:id/", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = sessions.get(id);
    if (!session) {
      return reply.status(404).send({ error: "dev_browser_session_not_found" });
    }
    return reply.type("text/html; charset=utf-8").send(renderDevBrowserShell(session));
  });

  app.all("/dev-browser/session/:id/proxy/*", async (request, reply) => {
    const { id } = request.params as { id: string; "*": string };
    const session = sessions.get(id);
    if (!session) {
      return reply.status(404).send({ error: "dev_browser_session_not_found" });
    }
    return proxyRequest(request, reply, session);
  });
}
```

- [ ] **Step 4: Register routes in the app**

Modify `packages/server/src/app.ts`:

```ts
import { registerDevBrowserRoutes } from "./routes/dev-browser.js";
```

Register before `registerPreviewRoutes` and before static fallback:

```ts
  registerDevBrowserRoutes(app);

  const previewSessions = new PreviewSessionStore();
  registerPreviewRoutes(app, {
    workspaceMgr: deps.workspaceMgr,
    previewSessions,
  });
```

- [ ] **Step 5: Extend app routing test**

Add this test to `packages/server/src/app-routing.test.ts`:

```ts
  it("does not serve index.html for dev browser proxy paths", async () => {
    const instance = await createApp();

    const response = await instance.inject({
      method: "GET",
      url: "/dev-browser/session/missing/proxy/app.js",
      headers: {
        accept: "application/javascript",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("<!doctype html>");
  });
```

- [ ] **Step 6: Run server route tests**

Run:

```bash
pnpm --filter @coder-studio/server test src/dev-browser src/routes/dev-browser.test.ts src/app-routing.test.ts
```

Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/dev-browser packages/server/src/routes/dev-browser.ts packages/server/src/routes/dev-browser.test.ts packages/server/src/app.ts packages/server/src/app-routing.test.ts
git commit -m "feat: proxy loopback dev browser HTTP requests"
```

---

### Task 5: Service Worker Routing

**Files:**
- Create: `packages/web/public/dev-browser-sw.js`
- Create: `packages/web/src/features/dev-browser/dev-browser-sw.test.ts`

- [ ] **Step 1: Write failing service worker tests**

Create `packages/web/src/features/dev-browser/dev-browser-sw.test.ts` with:

```ts
// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

interface SwHarness {
  mapRequest(input: {
    clientSessionId?: string;
    referrer?: string;
    requestUrl: string;
    sessions: Record<string, unknown>;
  }): string | null;
}

function loadHarness(): SwHarness {
  const script = readFileSync(resolve(process.cwd(), "public/dev-browser-sw.js"), "utf8");
  const listeners: Record<string, unknown> = {};
  const context = {
    URL,
    console,
    clients: { get: async () => null },
    fetch: async () => new Response("ok"),
    self: {
      __coderStudioDevBrowserSwTest: undefined as SwHarness | undefined,
      addEventListener: (name: string, handler: unknown) => {
        listeners[name] = handler;
      },
      location: {
        origin: "https://studio.example",
      },
      skipWaiting: () => undefined,
    },
  };

  vm.runInNewContext(script, context);
  const harness = context.self.__coderStudioDevBrowserSwTest;
  if (!harness) {
    throw new Error("service worker test harness missing");
  }
  return harness;
}

describe("dev browser service worker mapper", () => {
  const session = {
    id: "dev_1",
    browserProxyBase: "/dev-browser/session/dev_1/proxy",
    targetOrigin: "http://127.0.0.1:8000",
    targetPath: "/app/",
  };

  it("maps root-relative resource URLs using the proxied referrer", () => {
    const harness = loadHarness();

    expect(
      harness.mapRequest({
        requestUrl: "https://studio.example/assets/app.js",
        referrer: "https://studio.example/dev-browser/session/dev_1/proxy/app/",
        sessions: { dev_1: session },
      })
    ).toBe("https://studio.example/dev-browser/session/dev_1/proxy/assets/app.js");
  });

  it("maps hardcoded localhost URLs to the active proxy base", () => {
    const harness = loadHarness();

    expect(
      harness.mapRequest({
        requestUrl: "http://localhost:8000/chunk.js?x=1",
        referrer: "https://studio.example/dev-browser/session/dev_1/proxy/app/",
        sessions: { dev_1: session },
      })
    ).toBe("https://studio.example/dev-browser/session/dev_1/proxy/chunk.js?x=1");
  });

  it("does not rewrite unrelated Coder Studio requests", () => {
    const harness = loadHarness();

    expect(
      harness.mapRequest({
        requestUrl: "https://studio.example/assets/main-app.js",
        referrer: "https://studio.example/workspace",
        sessions: { dev_1: session },
      })
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the service worker test and confirm it fails**

Run:

```bash
pnpm --filter @coder-studio/web test src/features/dev-browser/dev-browser-sw.test.ts
```

Expected: fails because `public/dev-browser-sw.js` does not exist.

- [ ] **Step 3: Implement the service worker**

Create `packages/web/public/dev-browser-sw.js` with:

```js
const SESSION_MESSAGE_TYPE = "coder-studio-dev-browser-session";
const sessions = new Map();
const clientSessions = new Map();

function getSessionIdFromProxyPath(pathname) {
  const match = /^\/dev-browser\/session\/([^/]+)\/proxy(?:\/|$)/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function getSessionForRequest(input) {
  if (input.clientSessionId && input.sessions[input.clientSessionId]) {
    return input.sessions[input.clientSessionId];
  }

  const requestUrl = new URL(input.requestUrl);
  const fromRequest = getSessionIdFromProxyPath(requestUrl.pathname);
  if (fromRequest && input.sessions[fromRequest]) {
    return input.sessions[fromRequest];
  }

  if (input.referrer) {
    const referrerUrl = new URL(input.referrer);
    const fromReferrer = getSessionIdFromProxyPath(referrerUrl.pathname);
    if (fromReferrer && input.sessions[fromReferrer]) {
      return input.sessions[fromReferrer];
    }
  }

  return null;
}

function isLoopbackUrlForSession(url, session) {
  if (url.protocol !== "http:") {
    return false;
  }

  const target = new URL(session.targetOrigin);
  return (
    url.port === target.port &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")
  );
}

function mapRequestToProxy(input) {
  const requestUrl = new URL(input.requestUrl);
  const session = getSessionForRequest(input);
  if (!session) {
    return null;
  }

  if (requestUrl.pathname.startsWith(session.browserProxyBase)) {
    return null;
  }

  if (requestUrl.origin === self.location.origin) {
    if (requestUrl.pathname.startsWith("/dev-browser/")) {
      return null;
    }
    return `${self.location.origin}${session.browserProxyBase}${requestUrl.pathname}${requestUrl.search}`;
  }

  if (isLoopbackUrlForSession(requestUrl, session)) {
    return `${self.location.origin}${session.browserProxyBase}${requestUrl.pathname}${requestUrl.search}`;
  }

  return null;
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== SESSION_MESSAGE_TYPE || !event.data.session?.id) {
    return;
  }

  sessions.set(event.data.session.id, event.data.session);
  if (event.source?.id) {
    clientSessions.set(event.source.id, event.data.session.id);
  }
});

self.addEventListener("fetch", (event) => {
  const clientSessionId = event.clientId ? clientSessions.get(event.clientId) : undefined;
  const mappedUrl = mapRequestToProxy({
    requestUrl: event.request.url,
    referrer: event.request.referrer,
    clientSessionId,
    sessions: Object.fromEntries(sessions.entries()),
  });

  if (!mappedUrl) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(Response.redirect(mappedUrl, 302));
    return;
  }

  const proxiedRequest = new Request(mappedUrl, event.request);
  event.respondWith(fetch(proxiedRequest));
});

self.__coderStudioDevBrowserSwTest = {
  mapRequest: mapRequestToProxy,
};
```

- [ ] **Step 4: Run service worker tests**

Run:

```bash
pnpm --filter @coder-studio/web test src/features/dev-browser/dev-browser-sw.test.ts
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add packages/web/public/dev-browser-sw.js packages/web/src/features/dev-browser/dev-browser-sw.test.ts
git commit -m "feat: route dev browser resources with service worker"
```

---

### Task 6: Web API And Dev Browser Surface

**Files:**
- Create: `packages/web/src/features/dev-browser/api.ts`
- Create: `packages/web/src/features/dev-browser/api.test.ts`
- Create: `packages/web/src/features/dev-browser/dev-browser-surface.tsx`
- Create: `packages/web/src/features/dev-browser/dev-browser-surface.test.tsx`

- [ ] **Step 1: Write failing API tests**

Create `packages/web/src/features/dev-browser/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDevBrowserSession, deleteDevBrowserSession } from "./api";

describe("dev browser api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates and deletes sessions with credentialed fetch", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/dev-proxy/session" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            id: "dev_1",
            browserUrl: "/dev-browser/session/dev_1/",
            browserProxyBase: "/dev-browser/session/dev_1/proxy",
            targetOrigin: "http://127.0.0.1:8000",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (url === "/api/dev-proxy/session/dev_1" && init?.method === "DELETE") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      return new Response("missing", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const created = await createDevBrowserSession("localhost:8000");
    await deleteDevBrowserSession("dev_1");

    expect(created.browserUrl).toBe("/dev-browser/session/dev_1/");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dev-proxy/session",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ url: "localhost:8000" }),
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dev-proxy/session/dev_1",
      expect.objectContaining({ method: "DELETE", credentials: "include" })
    );
  });
});
```

- [ ] **Step 2: Implement API helpers**

Create `packages/web/src/features/dev-browser/api.ts`:

```ts
export interface DevBrowserSessionResponse {
  browserProxyBase: string;
  browserUrl: string;
  displayUrl?: string;
  expiresAt?: number;
  id: string;
  targetOrigin: string;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`dev_browser_request_failed:${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function createDevBrowserSession(url: string): Promise<DevBrowserSessionResponse> {
  const response = await fetch("/api/dev-proxy/session", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  return readJson<DevBrowserSessionResponse>(response);
}

export async function deleteDevBrowserSession(sessionId: string): Promise<void> {
  const response = await fetch(`/api/dev-proxy/session/${sessionId}`, {
    method: "DELETE",
    credentials: "include",
  });

  await readJson<{ ok: true }>(response);
}
```

- [ ] **Step 3: Run API tests**

Run:

```bash
pnpm --filter @coder-studio/web test src/features/dev-browser/api.test.ts
```

Expected: passes.

- [ ] **Step 4: Write failing surface tests**

Create `packages/web/src/features/dev-browser/dev-browser-surface.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevBrowserSurface } from "./dev-browser-surface";

vi.mock("../../lib/i18n", () => ({
  useTranslation: () => (key: string) => {
    const translations: Record<string, string> = {
      "dev_browser.title": "Browser",
      "dev_browser.url_label": "Local URL",
      "dev_browser.url_placeholder": "localhost:8000",
      "dev_browser.open": "Open",
      "dev_browser.loading": "Opening local preview",
      "dev_browser.unsupported": "Service workers are unavailable",
      "dev_browser.error": "Could not open local preview",
    };
    return translations[key] ?? key;
  },
}));

vi.mock("./api", () => ({
  createDevBrowserSession: vi.fn(async () => ({
    id: "dev_1",
    browserUrl: "/dev-browser/session/dev_1/",
    browserProxyBase: "/dev-browser/session/dev_1/proxy",
    targetOrigin: "http://127.0.0.1:8000",
  })),
  deleteDevBrowserSession: vi.fn(async () => undefined),
}));

describe("DevBrowserSurface", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a session and renders the iframe", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: {},
    });

    render(<DevBrowserSurface />);

    fireEvent.change(screen.getByLabelText("Local URL"), {
      target: { value: "localhost:8000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    const frame = await screen.findByTitle("Browser");
    expect(frame).toHaveAttribute("src", "/dev-browser/session/dev_1/");
  });

  it("shows unsupported state when service workers are unavailable", () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: undefined,
    });

    render(<DevBrowserSurface />);

    expect(screen.getByText("Service workers are unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
  });

  it("deletes the active session on unmount", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: {},
    });
    const api = await import("./api");

    const { unmount } = render(<DevBrowserSurface />);
    fireEvent.change(screen.getByLabelText("Local URL"), {
      target: { value: "localhost:8000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByTitle("Browser");

    unmount();

    await waitFor(() => expect(api.deleteDevBrowserSession).toHaveBeenCalledWith("dev_1"));
  });
});
```

- [ ] **Step 5: Implement `DevBrowserSurface`**

Create `packages/web/src/features/dev-browser/dev-browser-surface.tsx`:

```tsx
import { type FormEvent, useEffect, useRef, useState } from "react";
import { EmptyState, Notice } from "../../components/ui";
import { useTranslation } from "../../lib/i18n";
import {
  createDevBrowserSession,
  deleteDevBrowserSession,
  type DevBrowserSessionResponse,
} from "./api";

function supportsDevBrowserServiceWorker(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator
  );
}

export function DevBrowserSurface() {
  const t = useTranslation();
  const [url, setUrl] = useState("");
  const [session, setSession] = useState<DevBrowserSessionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<DevBrowserSessionResponse | null>(null);
  const supported = supportsDevBrowserServiceWorker();

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    return () => {
      const activeSession = sessionRef.current;
      if (activeSession) {
        void deleteDevBrowserSession(activeSession.id).catch(() => undefined);
      }
    };
  }, []);

  const open = async (event: FormEvent) => {
    event.preventDefault();
    if (!supported || loading || !url.trim()) {
      return;
    }

    setLoading(true);
    setError(null);
    const previousSession = sessionRef.current;
    try {
      const created = await createDevBrowserSession(url.trim());
      setSession(created);
      if (previousSession) {
        void deleteDevBrowserSession(previousSession.id).catch(() => undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "dev_browser_open_failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="dev-browser-surface" aria-label={t("dev_browser.title")}>
      <form className="dev-browser-toolbar" onSubmit={open}>
        <label className="dev-browser-toolbar__label">
          <span>{t("dev_browser.url_label")}</span>
          <input
            className="dev-browser-toolbar__input"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={t("dev_browser.url_placeholder")}
          />
        </label>
        <button className="dev-browser-toolbar__button" type="submit" disabled={!supported || loading}>
          {loading ? t("dev_browser.loading") : t("dev_browser.open")}
        </button>
      </form>

      {!supported ? <Notice tone="warning" message={t("dev_browser.unsupported")} /> : null}
      {error ? <Notice tone="error" message={t("dev_browser.error")} /> : null}

      <div className="dev-browser-frame-shell">
        {session ? (
          <iframe
            className="dev-browser-frame"
            title={t("dev_browser.title")}
            src={session.browserUrl}
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
          />
        ) : (
          <EmptyState
            className="dev-browser-empty"
            title={<p>{t("dev_browser.title")}</p>}
            description={<p>{t("dev_browser.empty_description")}</p>}
          />
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Run dev browser web tests**

Run:

```bash
pnpm --filter @coder-studio/web test src/features/dev-browser
```

Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/features/dev-browser
git commit -m "feat: add dev browser workspace surface"
```

---

### Task 7: Desktop And Mobile Workspace Integration

**Files:**
- Modify: `packages/web/src/features/workspace/atoms/layout.ts`
- Modify: `packages/web/src/features/workspace/actions/use-workspace-screen-model.ts`
- Modify: `packages/web/src/features/workspace/views/shared/workspace-activity-bar.tsx`
- Modify: `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-dock.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx`
- Modify: `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.test.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.test.tsx`
- Modify: `packages/web/src/theme/icon-theme.ts`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write failing desktop integration test**

In `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.test.tsx`, mock the dev browser component:

```ts
vi.mock("../../../dev-browser/dev-browser-surface", () => ({
  DevBrowserSurface: () => <div data-testid="dev-browser-surface" />,
}));
```

Add translation entries to the existing mock:

```ts
      "workspace.sidebar.browser": "Browser",
```

Add a test:

```tsx
  it("opens the dev browser from the activity bar", () => {
    renderDesktopView("explorer");

    fireEvent.click(screen.getByRole("button", { name: "Browser" }));

    expect(screen.getByTestId("dev-browser-surface")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Write failing mobile integration test**

In `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.test.tsx`, update the `MobileDock` mock type to include `browser` and expose a button:

```tsx
  MobileDock: ({
    activeItem,
    onSelectItem,
  }: {
    activeItem: "agent" | "files" | "terminal" | "browser" | null;
    onSelectItem: (item: "agent" | "files" | "terminal" | "browser") => void;
  }) => (
    <div data-testid="mobile-dock" data-active-item={activeItem ?? ""}>
      <button type="button" onClick={() => onSelectItem("browser")}>
        Browser
      </button>
    </div>
  ),
```

Mock dev browser:

```ts
vi.mock("../../../dev-browser/dev-browser-surface", () => ({
  DevBrowserSurface: () => <div data-testid="dev-browser-surface" />,
}));
```

Add a test near the existing sheet tests:

```tsx
  it("opens the dev browser sheet from the mobile dock", async () => {
    renderMobileView();

    fireEvent.click(screen.getByRole("button", { name: "Browser" }));

    expect(await screen.findByTestId("dev-browser-surface")).toBeInTheDocument();
  });
```

- [ ] **Step 3: Run workspace integration tests and confirm they fail**

Run:

```bash
pnpm --filter @coder-studio/web test src/features/workspace/views/desktop/workspace-desktop-view.test.tsx src/features/workspace/views/mobile/workspace-mobile-view.test.tsx
```

Expected: fails because the browser view is not wired.

- [ ] **Step 4: Add browser layout state**

Modify `packages/web/src/features/workspace/atoms/layout.ts`:

```ts
export type DesktopSidebarView =
  | "explorer"
  | "search"
  | "source-control"
  | "agent-instructions"
  | "skills"
  | "browser";
```

Add to `DESKTOP_SIDEBAR_VIEW_VALUES`:

```ts
  "browser",
```

- [ ] **Step 5: Add icon semantics**

Modify `packages/web/src/theme/icon-theme.ts`:

```ts
  "nav.browser",
  "mobile.dock.browser",
```

Add to `BASE_ICON_THEME.icons`:

```ts
    "nav.browser": { glyph: Globe, tone: "current" },
    "mobile.dock.browser": { glyph: Globe, tone: "current" },
```

- [ ] **Step 6: Add desktop activity item**

Modify `packages/web/src/features/workspace/views/shared/workspace-activity-bar.tsx` items:

```ts
    { view: "browser", label: t("workspace.sidebar.browser"), icon: "nav.browser" },
```

- [ ] **Step 7: Add browser main area mode**

Modify `packages/web/src/features/workspace/actions/use-workspace-screen-model.ts`:

```ts
export type WorkspaceMainAreaMode = "agent" | "editor" | "browser";
export type MobileWorkspaceSheetKind = "files" | "terminal" | "supervisor" | "browser" | null;
```

Change main area mode derivation:

```ts
  const mainAreaMode: WorkspaceMainAreaMode =
    desktopSidebarView === "browser"
      ? "browser"
      : activeFilePath ||
          editorViewVisible ||
          diffPreview?.kind === "commit-file-list" ||
          diffPreview?.kind === "commit-file-diff"
        ? "editor"
        : "agent";
```

- [ ] **Step 8: Render desktop browser surface**

Modify `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx` imports:

```ts
import { DevBrowserSurface } from "../../../dev-browser/dev-browser-surface";
```

Render sidebar helper content:

```tsx
                  {activeSidebarView === "browser" ? (
                    <div className="workspace-sidebar-view">
                      <div className="workspace-sidebar-panel__body workspace-sidebar-panel__body--browser">
                        <p className="workspace-sidebar-note">{t("dev_browser.sidebar_description")}</p>
                      </div>
                    </div>
                  ) : null}
```

Render browser in the main stage before the agent panes:

```tsx
            {mainAreaMode === "browser" ? <DevBrowserSurface /> : null}
            <div
              className="agent-panes"
              aria-hidden={
                (mainAreaMode === "editor" && editorPinned) || mainAreaMode === "browser"
                  ? true
                  : undefined
              }
            >
              {mainAreaMode === "browser" ? null : <AgentPanes hydrateSessions={false} />}
            </div>
```

- [ ] **Step 9: Add mobile dock browser item**

Modify `packages/web/src/features/workspace/views/mobile/mobile-dock.tsx`:

```ts
type MobileDockItem = "agent" | "files" | "terminal" | "browser";

interface MobileDockProps {
  activeItem: MobileDockItem | null;
  onSelectItem: (item: MobileDockItem) => void;
}
```

Add the browser button:

```tsx
      <button
        type="button"
        className={`mobile-dock__item ${activeItem === "browser" ? "mobile-dock__item--active" : ""}`}
        onClick={() => onSelectItem("browser")}
        aria-label={t("mobile.dock.open_browser")}
      >
        <span className="mobile-dock__icon" aria-hidden="true">
          <ThemedIcon semantic="mobile.dock.browser" size={18} />
        </span>
        <span className="mobile-dock__label">{t("dev_browser.short_title")}</span>
      </button>
```

- [ ] **Step 10: Render mobile browser sheet**

Modify `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx` imports:

```ts
import { DevBrowserSurface } from "../../../dev-browser/dev-browser-surface";
```

Update `handleDockSelect`:

```ts
  const handleDockSelect = (item: "agent" | "files" | "terminal" | "browser") => {
```

Update active dock item:

```ts
    : mobileSheet === "files" || mobileSheet === "terminal" || mobileSheet === "browser"
      ? mobileSheet
      : null;
```

Add sheet body branch:

```tsx
      : mobileSheet === "browser"
        ? {
            title: t("dev_browser.title"),
            body: <DevBrowserSurface />,
            footer: activeWorkspaceId ? (
              <WorkspaceStatusBar
                workspaceId={activeWorkspaceId}
                gitState={gitState}
                onOpenBranchSwitcher={handleOpenBranchSwitcher}
                flush
              />
            ) : null,
            kicker: null,
            fullscreen: true,
            bodyClassName: "mobile-sheet__body--flush mobile-sheet__body--fullscreen",
            contentClassName: "mobile-sheet--browser",
          }
```

- [ ] **Step 11: Add locale entries**

Modify `packages/web/src/locales/en.json` under the existing nested objects:

```json
{
  "workspace": {
    "sidebar": {
      "browser": "Browser"
    }
  },
  "mobile": {
    "dock": {
      "open_browser": "Open Browser sheet"
    }
  },
  "dev_browser": {
    "title": "Browser",
    "short_title": "Browser",
    "url_label": "Local URL",
    "url_placeholder": "localhost:8000",
    "open": "Open",
    "loading": "Opening...",
    "unsupported": "Service workers are unavailable in this browser or connection. Use HTTPS or localhost to enable the built-in browser.",
    "error": "Could not open the local preview.",
    "empty_description": "Enter a loopback URL from a local dev server, such as localhost:8000.",
    "sidebar_description": "Open a local dev server through Coder Studio without exposing that server directly."
  }
}
```

Modify `packages/web/src/locales/zh.json` with equivalent Chinese labels:

```json
{
  "workspace": {
    "sidebar": {
      "browser": "浏览器"
    }
  },
  "mobile": {
    "dock": {
      "open_browser": "打开浏览器面板"
    }
  },
  "dev_browser": {
    "title": "浏览器",
    "short_title": "浏览器",
    "url_label": "本地 URL",
    "url_placeholder": "localhost:8000",
    "open": "打开",
    "loading": "正在打开...",
    "unsupported": "当前浏览器或连接不支持 Service Worker。请使用 HTTPS 或 localhost 访问 Coder Studio 后再使用内置浏览器。",
    "error": "无法打开本地预览。",
    "empty_description": "输入本地开发服务的 loopback 地址，例如 localhost:8000。",
    "sidebar_description": "通过 Coder Studio 打开本地开发服务，无需直接暴露该服务端口。"
  }
}
```

- [ ] **Step 12: Add CSS**

Append to `packages/web/src/styles/components.css` near workspace/editor surface styles:

```css
.dev-browser-surface {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-height: 0;
  height: 100%;
  width: 100%;
  background: var(--surface-base);
}

.dev-browser-toolbar {
  display: flex;
  align-items: end;
  gap: var(--sp-3);
  padding: var(--sp-3);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-raised);
}

.dev-browser-toolbar__label {
  display: grid;
  gap: var(--sp-1);
  flex: 1;
  min-width: 0;
  color: var(--text-muted);
  font-size: var(--font-size-xs);
}

.dev-browser-toolbar__input {
  width: 100%;
  min-height: 34px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-input);
  color: var(--text-primary);
}

.dev-browser-toolbar__button {
  min-height: 34px;
  padding: 0 var(--sp-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--button-primary-bg);
  color: var(--button-primary-text);
}

.dev-browser-frame-shell {
  min-height: 0;
  height: 100%;
}

.dev-browser-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: white;
}

.dev-browser-empty {
  min-height: 100%;
}
```

- [ ] **Step 13: Run workspace integration tests**

Run:

```bash
pnpm --filter @coder-studio/web test src/features/workspace/views/desktop/workspace-desktop-view.test.tsx src/features/workspace/views/mobile/workspace-mobile-view.test.tsx src/features/dev-browser
```

Expected: passes.

- [ ] **Step 14: Commit**

```bash
git add packages/web/src/features/workspace packages/web/src/features/dev-browser packages/web/src/theme/icon-theme.ts packages/web/src/locales/en.json packages/web/src/locales/zh.json packages/web/src/styles/components.css
git commit -m "feat: add dev browser workspace entry points"
```

---

### Task 8: Development Proxy Config And Docs

**Files:**
- Modify: `packages/web/vite.config.ts`
- Modify: `docs/help/mobile-guide.md`
- Create or modify tests if existing docs validation flags links or headings.

- [ ] **Step 1: Add Vite dev proxy paths**

Modify `packages/web/vite.config.ts` server proxy. Add only `/dev-browser`; do not proxy `/dev-browser-sw.js` because Vite serves `packages/web/public/dev-browser-sw.js` directly during frontend development:

```ts
        "/dev-browser": {
          target: backendHttpTarget,
        },
```

After this change, verify `http://localhost:5173/dev-browser-sw.js` serves the public service worker file while `http://localhost:5173/dev-browser/session/missing/` proxies to the backend.

- [ ] **Step 2: Add mobile guide documentation**

Add this section to `docs/help/mobile-guide.md` after the remote-access options:

```md
## 打开本机开发服务

如果你在 Coder Studio 终端里启动了本地开发服务，例如：

    pnpm dev --host 127.0.0.1 --port 8000

可以在 Coder Studio 的内置浏览器中输入：

    localhost:8000

Coder Studio 会通过自身服务转发到本机 loopback 地址，因此手机或外部浏览器不需要直接访问 `localhost:8000`。

v1 支持普通 HTTP 页面、CSS、JS、图片、字体和常规 `fetch` / `XMLHttpRequest` 请求。v1 不支持 WebSocket 和 HMR。如果框架页面依赖 Vite HMR 或应用 WebSocket，页面主体通常仍可加载，但热更新或实时连接会失败。
```

- [ ] **Step 3: Run focused docs and build checks**

Run:

```bash
pnpm --filter @coder-studio/web test src/features/dev-browser src/features/workspace/views/desktop/workspace-desktop-view.test.tsx src/features/workspace/views/mobile/workspace-mobile-view.test.tsx
pnpm --filter @coder-studio/server test src/dev-browser src/routes/dev-browser.test.ts src/app-routing.test.ts
pnpm --filter @coder-studio/web build
```

Expected: all commands pass.

- [ ] **Step 4: Commit**

```bash
git add packages/web/vite.config.ts docs/help/mobile-guide.md
git commit -m "docs: document dev browser loopback preview"
```

---

### Task 9: Final Verification

**Files:**
- No new files.
- Verify all files changed by prior tasks.

- [ ] **Step 1: Run repository verification**

Run:

```bash
pnpm ci:verify
```

Expected: passes.

- [ ] **Step 2: Manual smoke test**

Run a simple local target in one terminal:

```bash
node -e "require('node:http').createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><h1>Dev Browser Smoke</h1><script src=\"/app.js\"></script>')}).listen(8000,'127.0.0.1',()=>console.log('http://localhost:8000'))"
```

Start Coder Studio, open the workspace browser, enter:

```text
localhost:8000
```

Expected: the iframe shows `Dev Browser Smoke`.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: only intentional feature changes are present, and commits from Tasks 1-8 are visible.

- [ ] **Step 4: Handoff summary**

Report:

```text
Implemented dev browser loopback HTTP proxy.
Verification: pnpm ci:verify passed.
Limitations: WebSocket and HMR are intentionally unsupported in v1.
Manual smoke: localhost:8000 loaded through the built-in browser.
```
