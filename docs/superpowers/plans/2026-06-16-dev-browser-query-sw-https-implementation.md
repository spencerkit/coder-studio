# Dev Browser Query + SW + HTTPS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the built-in browser so loopback previews keep the real visible pathname, root-scope service-worker interception only applies to bound loopback preview traffic, and non-loopback IP access to Coder Studio automatically uses HTTPS with generated local certificates.

**Architecture:** Keep loopback preview fetching behind the hidden `/dev-browser/session/:id/proxy` route, but change the browser-visible URL to a query-token form such as `/app/?__cs_sid=dev_1`. The first visible-path request is proxied server-side and receives a lightweight bootstrap that registers a root-scope service worker, binds the iframe client to the session, and removes the hidden query token with `history.replaceState`. The legacy `/dev-browser/session/:id/` shell remains as the fallback entry for insecure or service-worker-ineligible contexts. Auto-HTTPS applies only to the Coder Studio transport layer; preview targets remain loopback `http` in v1.

**Tech Stack:** TypeScript, Fastify, React, Jotai, Vite, Vitest, Service Worker, `node-forge`

---

### Task 1: Replace The Session URL Model With Visible Query URLs

**Files:**
- Create: `packages/server/src/dev-browser/browser-url.ts`
- Create: `packages/server/src/dev-browser/browser-url.test.ts`
- Modify: `packages/server/src/routes/dev-browser.ts`
- Modify: `packages/server/src/routes/dev-browser.test.ts`
- Test: `packages/server/src/dev-browser/browser-url.test.ts`
- Test: `packages/server/src/routes/dev-browser.test.ts`

- [ ] **Step 1: Write the failing URL helper test**

```ts
import { describe, expect, it } from "vitest";
import { DEV_BROWSER_SESSION_QUERY_PARAM, buildDevBrowserVisibleUrl } from "./browser-url.js";

describe("buildDevBrowserVisibleUrl", () => {
  it("preserves the target path and folds the session id into the query string", () => {
    expect(
      buildDevBrowserVisibleUrl({
        sessionId: "dev_1",
        targetPath: "/app/?draft=1",
        targetHash: "#top",
      })
    ).toBe(`/app/?draft=1&${DEV_BROWSER_SESSION_QUERY_PARAM}=dev_1#top`);
  });
});
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run: `pnpm --filter @coder-studio/server exec vitest run src/dev-browser/browser-url.test.ts`
Expected: FAIL because `browser-url.ts` does not exist yet.

- [ ] **Step 3: Write the failing route test for the new session response shape**

```ts
it("creates visible browser urls and retains the legacy fallback entry", async () => {
  const created = await createSession("/app/?draft=1#top");

  expect(created.browserUrl).toBe(`/app/?draft=1&__cs_sid=${created.id}#top`);
  expect(created.fallbackBrowserUrl).toBe(`/dev-browser/session/${created.id}/`);
  expect(created.browserProxyBase).toBe(`/dev-browser/session/${created.id}/proxy`);
});
```

- [ ] **Step 4: Run the route test to verify it fails**

Run: `pnpm --filter @coder-studio/server exec vitest run src/routes/dev-browser.test.ts -t "creates visible browser urls and retains the legacy fallback entry"`
Expected: FAIL because `browserUrl` still points at `/dev-browser/session/:id/` and `fallbackBrowserUrl` is missing.

- [ ] **Step 5: Implement the visible URL helper and session serialization**

```ts
export const DEV_BROWSER_SESSION_QUERY_PARAM = "__cs_sid";

export function buildDevBrowserVisibleUrl(input: {
  sessionId: string;
  targetPath: string;
  targetHash: string;
}): string {
  const parsed = new URL(input.targetPath || "/", "http://coder-studio.local");
  parsed.searchParams.set(DEV_BROWSER_SESSION_QUERY_PARAM, input.sessionId);
  return `${parsed.pathname}${parsed.search}${input.targetHash}`;
}

function fallbackBrowserUrl(id: string): string {
  return `/dev-browser/session/${id}/`;
}

function serializeSession(session: DevBrowserSession) {
  return {
    id: session.id,
    browserUrl: buildDevBrowserVisibleUrl({
      sessionId: session.id,
      targetPath: session.targetPath,
      targetHash: session.targetHash,
    }),
    fallbackBrowserUrl: fallbackBrowserUrl(session.id),
    browserProxyBase: browserProxyBase(session.id),
    displayUrl: session.displayUrl,
    targetOrigin: session.targetOrigin,
    targetPath: session.targetPath,
    targetHash: session.targetHash,
    expiresAt: session.expiresAt,
    ...(session.preserveStudioPlatformPaths ? { preserveStudioPlatformPaths: true } : {}),
  };
}
```

- [ ] **Step 6: Run the focused server tests to verify they pass**

Run: `pnpm --filter @coder-studio/server exec vitest run src/dev-browser/browser-url.test.ts src/routes/dev-browser.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/dev-browser/browser-url.ts \
  packages/server/src/dev-browser/browser-url.test.ts \
  packages/server/src/routes/dev-browser.ts \
  packages/server/src/routes/dev-browser.test.ts
git commit -m "feat: add visible dev browser session urls"
```

### Task 2: Add Visible-Path Proxying And Root-Scope Service Worker Routing

**Files:**
- Modify: `packages/server/src/dev-browser/proxy-headers.ts`
- Modify: `packages/server/src/dev-browser/proxy-headers.test.ts`
- Modify: `packages/server/src/routes/dev-browser.ts`
- Modify: `packages/server/src/routes/dev-browser.test.ts`
- Modify: `packages/web/public/dev-browser-sw.js`
- Modify: `packages/web/src/features/dev-browser/dev-browser-sw.test.ts`
- Test: `packages/server/src/dev-browser/proxy-headers.test.ts`
- Test: `packages/server/src/routes/dev-browser.test.ts`
- Test: `packages/web/src/features/dev-browser/dev-browser-sw.test.ts`

- [ ] **Step 1: Write the failing route test for the first visible-path request**

```ts
it("serves visible-path bootstrap html for the first query-based request", async () => {
  const created = await createSession("/app/?draft=1#top");
  const response = await app.inject({
    method: "GET",
    url: created.browserUrl,
  });

  expect(response.statusCode).toBe(200);
  expect(response.body).toContain('<script src="/assets/app.js"></script>');
  expect(response.body).toContain('navigator.serviceWorker.register("/dev-browser-sw.js", { scope: "/" })');
  expect(response.body).toContain('searchParams.delete("__cs_sid")');
  expect(response.body).not.toContain(`${created.browserProxyBase}/assets/app.js`);
});
```

- [ ] **Step 2: Run the route test to verify it fails**

Run: `pnpm --filter @coder-studio/server exec vitest run src/routes/dev-browser.test.ts -t "serves visible-path bootstrap html for the first query-based request"`
Expected: FAIL because `/app/?__cs_sid=...` currently falls through to the wrong route model.

- [ ] **Step 3: Write the failing redirect and service worker mapper tests**

```ts
it("rewrites loopback redirects back into visible paths for visible-mode proxy responses", () => {
  expect(
    rewriteVisibleLocationHeader("http://localhost:8000/dashboard?tab=1", {
      port: 8000,
      targetOrigin: "http://127.0.0.1:8000",
    })
  ).toBe("/dashboard?tab=1");
});

it("maps controlled visible-path requests to the hidden proxy base", () => {
  const harness = loadHarness();
  expect(
    harness.mapRequest({
      requestUrl: "https://studio.example/assets/app.js",
      clientSessionId: "dev_1",
      sessions: {
        dev_1: {
          id: "dev_1",
          browserProxyBase: "/dev-browser/session/dev_1/proxy",
          targetOrigin: "http://127.0.0.1:8000",
          targetPath: "/app/",
        },
      },
    })
  ).toEqual({
    mode: "visible",
    url: "https://studio.example/dev-browser/session/dev_1/proxy/assets/app.js",
  });
});

it("passes non-loopback cross-origin requests through unchanged", () => {
  const harness = loadHarness();
  expect(
    harness.mapRequest({
      requestUrl: "https://example.com/app.js",
      clientSessionId: "dev_1",
      sessions: {
        dev_1: {
          id: "dev_1",
          browserProxyBase: "/dev-browser/session/dev_1/proxy",
          targetOrigin: "http://127.0.0.1:8000",
          targetPath: "/app/",
        },
      },
    })
  ).toBeNull();
});
```

- [ ] **Step 4: Run the mapper and redirect tests to verify they fail**

Run: `pnpm --filter @coder-studio/server exec vitest run src/dev-browser/proxy-headers.test.ts src/routes/dev-browser.test.ts && pnpm --filter @coder-studio/web exec vitest run src/features/dev-browser/dev-browser-sw.test.ts`
Expected: FAIL because there is no visible-path redirect helper, the service worker still assumes `/dev-browser/` scope, and query-based bootstrap requests are not handled.

- [ ] **Step 5: Implement visible-mode proxy handling and root-scope service worker routing**

```ts
export function rewriteVisibleLocationHeader(
  location: string,
  input: { browserProxyBase?: string; port: number; targetOrigin: string }
): string {
  if (location.startsWith("/") && !location.startsWith("//")) {
    return location;
  }

  let parsed: URL;
  try {
    parsed = new URL(location, input.targetOrigin);
  } catch {
    return location;
  }

  const proxied = toProxiedLoopbackUrl(parsed, input);
  if (!proxied) {
    return location;
  }

  const proxiedUrl = new URL(`http://coder-studio.local${proxied}`);
  return `${proxiedUrl.pathname}${proxiedUrl.search}${proxiedUrl.hash}`;
}

app.addHook("preHandler", async (request, reply) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return;
  }

  const incomingUrl = new URL(request.url, "http://coder-studio.local");
  const sessionId = incomingUrl.searchParams.get(DEV_BROWSER_SESSION_QUERY_PARAM);
  if (!sessionId) {
    return;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    reply.status(410).send({ error: "dev_browser_session_missing" });
    return reply;
  }

  await proxyRequest(request, reply, session, {
    mode: "visible",
    requestUrl: incomingUrl,
    stripSessionQuery: true,
  });
  return reply;
});
```

```js
const DEV_BROWSER_PROXY_MODE_HEADER = "x-coder-studio-dev-browser-mode";

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
    if (shouldBypassStudioPath(requestUrl, session)) {
      return null;
    }
    return {
      mode: "visible",
      url: `${self.location.origin}${session.browserProxyBase}${requestUrl.pathname}${requestUrl.search}`,
    };
  }

  if (!isLoopbackUrlForSession(requestUrl, session)) {
    return null;
  }

  return {
    mode: "visible",
    url: `${self.location.origin}${session.browserProxyBase}${requestUrl.pathname}${requestUrl.search}`,
  };
}

self.addEventListener("fetch", (event) => {
  const mapped = mapRequestToProxy({
    requestUrl: event.request.url,
    referrer: event.request.referrer,
    clientSessionId: event.clientId ? clientSessions.get(event.clientId) : undefined,
    sessions: Object.fromEntries(sessions.entries()),
  });
  if (!mapped) {
    return;
  }

  if (event.request.mode === "navigate" && event.resultingClientId && event.clientId) {
    const sessionId = clientSessions.get(event.clientId);
    if (sessionId) {
      clientSessions.set(event.resultingClientId, sessionId);
    }
  }

  const headers = new Headers(event.request.headers);
  headers.set(DEV_BROWSER_PROXY_MODE_HEADER, mapped.mode);
  const proxiedRequest = new Request(mapped.url, {
    method: event.request.method,
    headers,
    body: event.request.body,
    mode: event.request.mode,
    credentials: event.request.credentials,
    cache: event.request.cache,
    redirect: event.request.redirect,
    referrer: event.request.referrer,
    referrerPolicy: event.request.referrerPolicy,
    integrity: event.request.integrity,
    keepalive: event.request.keepalive,
    signal: event.request.signal,
  });
  event.respondWith(fetch(proxiedRequest));
});
```

- [ ] **Step 6: Run the focused tests to verify they pass**

Run: `pnpm --filter @coder-studio/server exec vitest run src/dev-browser/proxy-headers.test.ts src/routes/dev-browser.test.ts && pnpm --filter @coder-studio/web exec vitest run src/features/dev-browser/dev-browser-sw.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/dev-browser/proxy-headers.ts \
  packages/server/src/dev-browser/proxy-headers.test.ts \
  packages/server/src/routes/dev-browser.ts \
  packages/server/src/routes/dev-browser.test.ts \
  packages/web/public/dev-browser-sw.js \
  packages/web/src/features/dev-browser/dev-browser-sw.test.ts
git commit -m "feat: add visible-path dev browser routing"
```

### Task 3: Wire The Web Client And Vite Dev Server To The New URL Model

**Files:**
- Modify: `packages/web/src/features/dev-browser/api.ts`
- Modify: `packages/web/src/features/dev-browser/api.test.ts`
- Modify: `packages/web/src/features/dev-browser/dev-browser-surface.tsx`
- Modify: `packages/web/src/features/dev-browser/dev-browser-surface.test.tsx`
- Modify: `packages/web/vite.config.ts`
- Modify: `packages/web/src/features/dev-browser/dev-browser-vite-proxy.test.ts`
- Test: `packages/web/src/features/dev-browser/api.test.ts`
- Test: `packages/web/src/features/dev-browser/dev-browser-surface.test.tsx`
- Test: `packages/web/src/features/dev-browser/dev-browser-vite-proxy.test.ts`

- [ ] **Step 1: Write the failing API and iframe-source tests**

```ts
it("parses the visible browserUrl and fallbackBrowserUrl from create-session responses", async () => {
  const fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify({
        id: "dev_1",
        browserUrl: "/app/?__cs_sid=dev_1",
        fallbackBrowserUrl: "/dev-browser/session/dev_1/",
        browserProxyBase: "/dev-browser/session/dev_1/proxy",
        targetOrigin: "http://127.0.0.1:8000",
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )
  );
  vi.stubGlobal("fetch", fetchMock);

  const created = await createDevBrowserSession("localhost:8000");

  expect(created.browserUrl).toBe("/app/?__cs_sid=dev_1");
  expect(created.fallbackBrowserUrl).toBe("/dev-browser/session/dev_1/");
});
```

```ts
it("uses the visible browser url when service workers are supported", async () => {
  enableServiceWorkerSupport();
  const activeTab = browserTab("browser-1", null);
  const store = createWorkspaceStore([activeTab], activeTab);

  render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
    wrapper: wrapperFor(store),
  });

  await submitLocalUrl(userEvent.setup(), "localhost:8000");

  expect(await screen.findByTitle("Browser")).toHaveAttribute("src", "/app/?__cs_sid=dev_1");
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/dev-browser/api.test.ts src/features/dev-browser/dev-browser-surface.test.tsx`
Expected: FAIL because the API type has no `fallbackBrowserUrl` and the surface still expects the old `/dev-browser/session/:id/` source.

- [ ] **Step 3: Write the failing fallback and Vite bootstrap proxy tests**

```ts
it("falls back to the legacy browser entry when service workers are unavailable", async () => {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: undefined,
  });
  const activeTab = browserTab("browser-1", null);
  const store = createWorkspaceStore([activeTab], activeTab);

  render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
    wrapper: wrapperFor(store),
  });

  await submitLocalUrl(userEvent.setup(), "localhost:8000");

  expect(await screen.findByTitle("Browser")).toHaveAttribute("src", "/dev-browser/session/dev_1/");
});
```

```ts
it("proxies visible-path bootstrap requests with __cs_sid to the backend", async () => {
  const response = await fetch(`http://127.0.0.1:${vitePort}/app/?__cs_sid=test`);

  expect(response.status).toBe(200);
  expect(await response.text()).toContain("proxied dev browser session");
});
```

- [ ] **Step 4: Run the fallback and Vite tests to verify they fail**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/dev-browser/dev-browser-surface.test.tsx src/features/dev-browser/dev-browser-vite-proxy.test.ts`
Expected: FAIL because the surface has no explicit visible/fallback split and Vite only proxies `/dev-browser/session`.

- [ ] **Step 5: Implement the API shape, iframe source selection, and Vite query bootstrap proxy**

```ts
export interface DevBrowserSessionResponse {
  browserProxyBase: string;
  browserUrl: string;
  fallbackBrowserUrl: string;
  displayUrl?: string;
  expiresAt?: number;
  id: string;
  targetOrigin: string;
}
```

```tsx
const frameSrc =
  serviceWorkerSupported || !session?.fallbackBrowserUrl
    ? session?.browserUrl ?? null
    : session.fallbackBrowserUrl;

<iframe
  className="dev-browser-frame"
  title={t("dev_browser.title")}
  src={frameSrc ?? undefined}
  sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
/>;
```

```ts
function isDevBrowserBootstrapRequest(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  const parsed = new URL(url, "http://vite.local");
  return parsed.searchParams.has("__cs_sid");
}

function devBrowserBootstrapProxyPlugin() {
  return {
    name: "dev-browser-bootstrap-proxy",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!isDevBrowserBootstrapRequest(req.url)) {
          next();
          return;
        }

        const upstream = await fetch(new URL(req.url!, backendHttpTarget), {
          method: req.method,
          headers: new Headers(req.headers as Record<string, string>),
          body: req.method === "GET" || req.method === "HEAD" ? undefined : req,
        });
        res.statusCode = upstream.status;
        upstream.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(Buffer.from(await upstream.arrayBuffer()));
      });
    },
  };
}
```

- [ ] **Step 6: Run the focused web tests to verify they pass**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/dev-browser/api.test.ts src/features/dev-browser/dev-browser-surface.test.tsx src/features/dev-browser/dev-browser-vite-proxy.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/features/dev-browser/api.ts \
  packages/web/src/features/dev-browser/api.test.ts \
  packages/web/src/features/dev-browser/dev-browser-surface.tsx \
  packages/web/src/features/dev-browser/dev-browser-surface.test.tsx \
  packages/web/vite.config.ts \
  packages/web/src/features/dev-browser/dev-browser-vite-proxy.test.ts
git commit -m "feat: wire visible dev browser urls through the web client"
```

### Task 4: Auto-Enable HTTPS For Non-Loopback IP Access

**Files:**
- Modify: `packages/server/package.json`
- Create: `packages/server/src/dev-browser/local-https.ts`
- Create: `packages/server/src/dev-browser/local-https.test.ts`
- Create: `packages/server/src/__tests__/server-transport.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `pnpm-lock.yaml`
- Test: `packages/server/src/dev-browser/local-https.test.ts`
- Test: `packages/server/src/__tests__/server-transport.test.ts`

- [ ] **Step 1: Write the failing transport helper tests**

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureLocalHttpsMaterial, shouldAutoEnableHttps } from "./local-https.js";

describe("local dev-browser https", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "cs-local-https-"));

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("only auto-enables https for wildcard or non-loopback ip hosts", () => {
    expect(shouldAutoEnableHttps("localhost")).toBe(false);
    expect(shouldAutoEnableHttps("127.0.0.1")).toBe(false);
    expect(shouldAutoEnableHttps("192.168.1.20")).toBe(true);
    expect(shouldAutoEnableHttps("0.0.0.0")).toBe(true);
  });

  it("reuses generated certificate material from the state directory", () => {
    const first = ensureLocalHttpsMaterial({
      stateRoot: tempDir,
      primaryHost: "192.168.1.20",
    });
    const second = ensureLocalHttpsMaterial({
      stateRoot: tempDir,
      primaryHost: "192.168.1.20",
    });

    expect(first.cert).toContain("BEGIN CERTIFICATE");
    expect(first.key).toContain("BEGIN PRIVATE KEY");
    expect(second.cert).toBe(first.cert);
    expect(second.key).toBe(first.key);
  });
});
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run: `pnpm --filter @coder-studio/server exec vitest run src/dev-browser/local-https.test.ts`
Expected: FAIL because `local-https.ts` does not exist and there is no HTTPS material generator.

- [ ] **Step 3: Write the failing server transport wiring test**

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("createServer transport", () => {
  let tempDir = "";

  afterEach(() => {
    vi.resetModules();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("passes generated https options into buildFastifyApp for LAN hosts", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "cs-server-transport-"));
    const listen = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const address = vi.fn(() => ({ port: 4173 }));
    const buildFastifyApp = vi.fn(async ({ fastifyOptions }) => ({
      listen,
      close,
      server: { address },
      log: { info: vi.fn(), warn: vi.fn() },
    }));

    vi.doMock("../app.js", () => ({
      buildFastifyApp,
    }));

    const { createServer } = await import("../server.js");
    const server = await createServer({
      host: "192.168.1.20",
      port: 4173,
      stateDir: join(tempDir, "state"),
      uploadsDir: join(tempDir, "uploads"),
    });
    await server.stop();

    expect(buildFastifyApp).toHaveBeenCalledWith(
      expect.objectContaining({
        fastifyOptions: {
          https: expect.objectContaining({
            cert: expect.stringContaining("BEGIN CERTIFICATE"),
            key: expect.stringContaining("BEGIN PRIVATE KEY"),
          }),
        },
      })
    );
  });
});
```

- [ ] **Step 4: Run the transport wiring test to verify it fails**

Run: `pnpm --filter @coder-studio/server exec vitest run src/__tests__/server-transport.test.ts`
Expected: FAIL because `buildFastifyApp` does not accept `fastifyOptions` and `createServer` never generates HTTPS options.

- [ ] **Step 5: Implement local HTTPS material generation and server wiring**

```json
{
  "dependencies": {
    "node-forge": "^1.3.1"
  }
}
```

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import forge from "node-forge";

export function shouldAutoEnableHttps(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || /^[0-9a-f:.]+$/i.test(host) && !/^127(?:\.\d{1,3}){3}$/.test(host) && host !== "::1";
}

export function ensureLocalHttpsMaterial(input: {
  stateRoot: string;
  primaryHost: string;
}): { cert: string; key: string; ca: string } {
  const tlsDir = join(input.stateRoot, "tls");
  const certPath = join(tlsDir, "dev-browser-cert.pem");
  const keyPath = join(tlsDir, "dev-browser-key.pem");
  const caPath = join(tlsDir, "dev-browser-ca.pem");

  if (existsSync(certPath) && existsSync(keyPath) && existsSync(caPath)) {
    return {
      cert: readFileSync(certPath, "utf8"),
      key: readFileSync(keyPath, "utf8"),
      ca: readFileSync(caPath, "utf8"),
    };
  }

  mkdirSync(tlsDir, { recursive: true });
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = String(Date.now());
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000);
  cert.setSubject([{ name: "commonName", value: input.primaryHost }]);
  cert.setIssuer([{ name: "commonName", value: "Coder Studio Local Dev Browser CA" }]);
  cert.setExtensions([
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", keyCertSign: true, digitalSignature: true },
    {
      name: "subjectAltName",
      altNames: [
        ...(input.primaryHost === "localhost" || input.primaryHost.endsWith(".localhost")
          ? [{ type: 2, value: input.primaryHost }]
          : []),
        ...(input.primaryHost !== "localhost" && !input.primaryHost.endsWith(".localhost")
          ? [{ type: 7, ip: input.primaryHost }]
          : []),
        { type: 2, value: "localhost" },
        { type: 2, value: "*.localhost" },
        { type: 7, ip: "127.0.0.1" },
        { type: 7, ip: "::1" },
      ],
    },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  const certPem = forge.pki.certificateToPem(cert);
  writeFileSync(keyPath, keyPem, "utf8");
  writeFileSync(certPath, certPem, "utf8");
  writeFileSync(caPath, certPem, "utf8");

  return { cert: certPem, key: keyPem, ca: certPem };
}
```

```ts
interface AppDeps {
  // existing deps...
  fastifyOptions?: Pick<FastifyServerOptions, "https">;
}

const app = Fastify({
  ...deps.fastifyOptions,
  logger: deps.logger ?? {
    level: "info",
    transport: {
      target: "pino-pretty",
      options: {
        translateTime: "HH:MM:ss Z",
        ignore: "pid,hostname",
      },
    },
  },
});
```

```ts
const httpsMaterial = shouldAutoEnableHttps(config.host)
  ? ensureLocalHttpsMaterial({
      stateRoot,
      primaryHost: config.host,
    })
  : null;

const app = await buildFastifyApp({
  wsHub,
  webRoot: config.webRoot,
  workspaceMgr,
  config,
  authSessionRepo,
  authLoginBlockRepo,
  sessionTokenRepo,
  appearanceAssetRepo,
  fastifyOptions: httpsMaterial
    ? {
        https: {
          cert: httpsMaterial.cert,
          key: httpsMaterial.key,
          ca: httpsMaterial.ca,
        },
      }
    : undefined,
});

const listenProtocol = httpsMaterial ? "https" : "http";
console.log(`Server listening on ${listenProtocol}://${config.host}:${actualPort}`);
if (httpsMaterial) {
  console.log(
    "If the browser shows a local certificate warning, open the HTTPS URL manually and proceed once."
  );
}
```

- [ ] **Step 6: Run the focused HTTPS tests to verify they pass**

Run: `pnpm --filter @coder-studio/server exec vitest run src/dev-browser/local-https.test.ts src/__tests__/server-transport.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/server/package.json \
  pnpm-lock.yaml \
  packages/server/src/dev-browser/local-https.ts \
  packages/server/src/dev-browser/local-https.test.ts \
  packages/server/src/__tests__/server-transport.test.ts \
  packages/server/src/app.ts \
  packages/server/src/server.ts
git commit -m "feat: auto-enable https for remote dev browser access"
```

### Task 5: Full Verification

**Files:**
- Modify: `docs/superpowers/specs/2026-06-16-dev-browser-query-sw-https-design.md` only if implementation forces an explicit spec clarification
- Test: repository working tree

- [ ] **Step 1: Run the focused server and web suites**

Run: `pnpm --filter @coder-studio/server exec vitest run src/dev-browser/browser-url.test.ts src/dev-browser/proxy-headers.test.ts src/dev-browser/local-https.test.ts src/routes/dev-browser.test.ts src/__tests__/server-transport.test.ts && pnpm --filter @coder-studio/web exec vitest run src/features/dev-browser/api.test.ts src/features/dev-browser/dev-browser-sw.test.ts src/features/dev-browser/dev-browser-surface.test.tsx src/features/dev-browser/dev-browser-vite-proxy.test.ts`
Expected: PASS

- [ ] **Step 2: Run package-level tests for the touched packages**

Run: `pnpm --filter @coder-studio/server test && pnpm --filter @coder-studio/web test`
Expected: PASS

- [ ] **Step 3: Run repository verification**

Run: `pnpm ci:verify`
Expected: PASS

- [ ] **Step 4: Check git status before handoff**

Run: `git status --short`
Expected: clean working tree except for any deliberate spec clarification or release metadata added during implementation.

- [ ] **Step 5: Final handoff commit if Task 5 required follow-up changes**

```bash
git add -A
git commit -m "chore: finalize dev browser query sw https rollout"
```
