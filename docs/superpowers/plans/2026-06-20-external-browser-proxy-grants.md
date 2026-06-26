# External Browser Proxy Grants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated-origin browser proxy with grant-based authorization, HTTP and WebSocket forwarding, and a lightweight Settings panel for creating, rotating, extending, and revoking grants.

**Architecture:** The server keeps the main Coder Studio UI listener and adds a second proxy listener on the same host with a different port. Main-origin APIs manage persisted proxy grants, while the proxy origin validates both the existing browser auth cookie and the per-request grant headers before forwarding HTTP or WebSocket traffic to one validated target origin and maintaining a server-side per-grant cookie jar.

**Tech Stack:** TypeScript, Fastify 5, `@fastify/websocket`, `ws`, Node `fetch`, React 19, Jotai, existing Settings page architecture, Vitest, Testing Library, pnpm monorepo.

---

## File Structure

- Create: `packages/server/src/proxy/grant-token.ts`
  Generates and hashes high-entropy proxy grant tokens.
- Create: `packages/server/src/proxy/target-policy.ts`
  Normalizes target origins and enforces host, CIDR, protocol, and DNS-rebinding policy.
- Create: `packages/server/src/proxy/cookie-jar.ts`
  Stores per-grant upstream cookies in memory and applies them to HTTP and WebSocket upstream requests.
- Create: `packages/server/src/proxy/headers.ts`
  Filters proxy request and response headers, rewrites redirect locations, and blocks unsafe hop-by-hop metadata.
- Create: `packages/server/src/proxy/errors.ts`
  Defines stable proxy error codes and HTML navigation error rendering helpers.
- Create: `packages/server/src/proxy/grant-service.ts`
  Coordinates grant create/list/extend/rotate/revoke flows on top of the repo and target policy.
- Create: `packages/server/src/proxy/proxy-app.ts`
  Builds the dedicated proxy Fastify listener and registers root HTTP and WebSocket forwarding routes.
- Create: `packages/server/src/routes/proxy-grants.ts`
  Registers main-origin management APIs under `/api/proxy/*`.
- Create: `packages/server/src/storage/repositories/proxy-grant-repo.ts`
  Persists hashed proxy grant records in `state/proxy-grants.json`.
- Create: `packages/server/src/storage/repositories/proxy-grant-repo.test.ts`
  Covers repo normalization, persistence, and mutation semantics.
- Create: `packages/server/src/proxy/target-policy.test.ts`
  Covers target normalization, allowlist behavior, and DNS rebinding rejection.
- Create: `packages/server/src/proxy/cookie-jar.test.ts`
  Covers per-grant upstream cookie capture, replay, and cleanup.
- Create: `packages/server/src/proxy/headers.test.ts`
  Covers request filtering, redirect rewrite, and `Set-Cookie` capture behavior.
- Create: `packages/server/src/proxy/grant-service.test.ts`
  Covers lifecycle actions and token return rules.
- Create: `packages/server/src/proxy/proxy-app.test.ts`
  Covers end-to-end HTTP and WebSocket proxy behavior with auth and grant enforcement.
- Create: `packages/server/src/routes/proxy-grants.test.ts`
  Covers main-origin management APIs and one-time token response behavior.
- Modify: `packages/server/src/config.ts`
  Adds proxy config parsing and defaults.
- Modify: `packages/server/src/server.ts`
  Instantiates proxy grant repos and services, starts/stops the dedicated proxy listener, and exposes proxy runtime info for tests.
- Modify: `packages/server/src/app.ts`
  Registers `/api/proxy/*` management routes on the main origin.
- Modify: `packages/server/src/auth/plugin.ts`
  Exports cookie parsing or auth helpers needed by the dedicated proxy app to reuse normal browser auth semantics.
- Modify: `packages/server/src/__tests__/server-runtime-config.test.ts`
  Covers second-listener startup and shutdown behavior.
- Modify: `packages/web/src/features/settings/components/settings-sections.tsx`
  Adds `proxy` as a visible Settings section.
- Modify: `packages/web/src/features/more/routes.ts`
  Adds `proxy` to the More/Settings route map.
- Modify: `packages/web/src/features/more/page.tsx`
  Extends embedded More-page settings routing so `/more/settings/proxy` renders the new section.
- Modify: `packages/web/src/features/more/page.test.tsx`
  Covers the new More-page proxy section route.
- Create: `packages/web/src/features/settings/components/proxy-access-settings.tsx`
  Renders the `Proxy Access` panel, one-time token modal, create form, and grant rows.
- Create: `packages/web/src/features/settings/components/proxy-access-settings.test.tsx`
  Covers create flow, modal display, row actions, and empty/error states.
- Create: `packages/web/src/features/settings/components/proxy-access-api.ts`
  Wraps the `/api/proxy/*` endpoints.
- Create: `packages/web/src/features/settings/components/proxy-access-api.test.ts`
  Covers fetch payloads and error handling.
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
  Mounts the new section and updates embedded/mobile settings routing helpers so the new section is reachable everywhere.
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
  Covers navigation and section rendering for `proxy`.
- Modify: `packages/web/src/locales/en.json`
  Adds `Proxy Access` UI strings and error labels.
- Modify: `packages/web/src/locales/zh.json`
  Adds Chinese `Proxy Access` UI strings and error labels.
- Modify: `packages/web/src/styles/components.css`
  Adds targeted styles for the grant table, setup modal, and form layout.

## Task 1: Proxy Config, Target Policy, and Grant Persistence

**Files:**
- Modify: `packages/server/src/config.ts`
- Create: `packages/server/src/proxy/grant-token.ts`
- Create: `packages/server/src/proxy/target-policy.ts`
- Create: `packages/server/src/proxy/target-policy.test.ts`
- Create: `packages/server/src/storage/repositories/proxy-grant-repo.ts`
- Create: `packages/server/src/storage/repositories/proxy-grant-repo.test.ts`

- [ ] **Step 1: Write the failing target-policy and repo tests**

Create `packages/server/src/proxy/target-policy.test.ts` with coverage for:

```ts
import { describe, expect, it } from "vitest";
import {
  ProxyTargetPolicyError,
  createProxyTargetPolicy,
  normalizeProxyTargetOrigin,
} from "./target-policy.js";

describe("normalizeProxyTargetOrigin", () => {
  it("normalizes protocol, host case, and default ports", () => {
    expect(normalizeProxyTargetOrigin("HTTP://LOCALHOST:8080/")).toBe("http://localhost:8080");
    expect(normalizeProxyTargetOrigin("https://example.internal:443")).toBe(
      "https://example.internal"
    );
  });

  it("rejects paths, credentials, and unsupported schemes", () => {
    const values = [
      "http://localhost:8080/app",
      "http://user:pass@localhost:8080",
      "ws://localhost:8080",
      "file:///tmp/demo",
      "localhost:8080",
    ];

    for (const value of values) {
      expect(() => normalizeProxyTargetOrigin(value)).toThrow(ProxyTargetPolicyError);
    }
  });
});

describe("createProxyTargetPolicy", () => {
  it("allows loopback by default and rejects private intranet hosts without allow rules", async () => {
    const policy = createProxyTargetPolicy({
      allowLoopback: true,
      allowedHosts: [],
      allowedCidrs: [],
      resolveHostname: async (hostname) => {
        if (hostname === "localhost") {
          return ["127.0.0.1"];
        }
        if (hostname === "grafana.internal") {
          return ["10.20.0.15"];
        }
        return [];
      },
    });

    await expect(policy.assertAllowed("http://localhost:3000")).resolves.toEqual({
      hostname: "localhost",
      origin: "http://localhost:3000",
      protocol: "http:",
      port: 3000,
      resolvedIps: ["127.0.0.1"],
    });

    await expect(policy.assertAllowed("http://grafana.internal:3000")).rejects.toThrow(
      ProxyTargetPolicyError
    );
  });

  it("re-checks resolved IPs against allowed hosts and cidrs", async () => {
    const policy = createProxyTargetPolicy({
      allowLoopback: false,
      allowedHosts: ["grafana.internal"],
      allowedCidrs: ["10.20.0.0/16"],
      resolveHostname: async () => ["10.20.0.15"],
    });

    await expect(policy.assertAllowed("http://grafana.internal:8080")).resolves.toMatchObject({
      resolvedIps: ["10.20.0.15"],
    });
  });
});
```

Create `packages/server/src/storage/repositories/proxy-grant-repo.test.ts` with coverage for:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProxyGrantRepo } from "./proxy-grant-repo.js";

describe("ProxyGrantRepo", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createRepo() {
    const dir = mkdtempSync(join(tmpdir(), "proxy-grant-repo-"));
    tempDirs.push(dir);
    return new ProxyGrantRepo({ filePath: join(dir, "proxy-grants.json") });
  }

  it("persists hashed grants by id", () => {
    const repo = createRepo();

    repo.set({
      id: "pgr_1",
      label: "grafana",
      targetOrigin: "http://localhost:3000",
      allowWebSocket: true,
      tokenHash: "hash_1",
      createdAt: 1,
      expiresAt: 2,
      revokedAt: null,
      lastUsedAt: null,
      lastUsedIp: null,
    });

    expect(repo.get("pgr_1")).toMatchObject({
      tokenHash: "hash_1",
      targetOrigin: "http://localhost:3000",
    });
    expect(repo.list()).toHaveLength(1);
  });

  it("updates and deletes grants without mutating unrelated rows", () => {
    const repo = createRepo();
    repo.set({
      id: "pgr_1",
      label: "grafana",
      targetOrigin: "http://localhost:3000",
      allowWebSocket: true,
      tokenHash: "hash_1",
      createdAt: 1,
      expiresAt: 2,
      revokedAt: null,
      lastUsedAt: null,
      lastUsedIp: null,
    });
    repo.set({
      id: "pgr_2",
      label: "wiki",
      targetOrigin: "http://localhost:4000",
      allowWebSocket: false,
      tokenHash: "hash_2",
      createdAt: 3,
      expiresAt: 4,
      revokedAt: null,
      lastUsedAt: null,
      lastUsedIp: null,
    });

    repo.set({
      id: "pgr_1",
      label: "grafana-prod",
      targetOrigin: "http://localhost:3000",
      allowWebSocket: true,
      tokenHash: "hash_3",
      createdAt: 1,
      expiresAt: 5,
      revokedAt: null,
      lastUsedAt: 4,
      lastUsedIp: "127.0.0.1",
    });
    repo.delete("pgr_2");

    expect(repo.get("pgr_1")).toMatchObject({
      label: "grafana-prod",
      tokenHash: "hash_3",
      lastUsedIp: "127.0.0.1",
    });
    expect(repo.get("pgr_2")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the failing policy and repo tests**

Run:

```bash
pnpm --filter @coder-studio/server test -- proxy/target-policy.test.ts storage/repositories/proxy-grant-repo.test.ts
```

Expected: FAIL because the policy and repo files do not exist yet.

- [ ] **Step 3: Implement proxy config parsing, target normalization, token hashing, and grant persistence**

Add a proxy config branch in `packages/server/src/config.ts` similar to:

```ts
proxy: overrides?.proxy ?? {
  enabled: process.env.PROXY_ENABLED === "true",
  host: process.env.PROXY_HOST || (overrides?.host || process.env.HOST || "localhost"),
  port:
    overrides?.proxy?.port ??
    (process.env.PROXY_PORT ? Number(process.env.PROXY_PORT) : (overrides?.port ?? parseInt(process.env.PORT || "4173", 10)) + 1),
  publicOrigin: process.env.PROXY_PUBLIC_ORIGIN,
  maxGrantTtlMs: parseInt(process.env.PROXY_MAX_GRANT_TTL_MS || String(7 * 24 * 60 * 60 * 1000), 10),
  allowedHosts: (process.env.PROXY_ALLOWED_HOSTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  allowedCidrs: (process.env.PROXY_ALLOWED_CIDRS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  allowLoopback: process.env.PROXY_ALLOW_LOOPBACK !== "false",
}
```

Create `packages/server/src/proxy/grant-token.ts` with:

```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_PREFIX = "pgt_";

export function createProxyGrantToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
}

export function hashProxyGrantToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function proxyGrantTokenMatches(token: string, tokenHash: string): boolean {
  const actual = Buffer.from(hashProxyGrantToken(token), "hex");
  const expected = Buffer.from(tokenHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
```

Create `packages/server/src/proxy/target-policy.ts` with:

```ts
import dns from "node:dns/promises";
import net from "node:net";

export class ProxyTargetPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProxyTargetPolicyError";
  }
}

export interface ResolvedProxyTarget {
  origin: string;
  protocol: "http:" | "https:";
  hostname: string;
  port: number;
  resolvedIps: string[];
}

export function normalizeProxyTargetOrigin(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProxyTargetPolicyError("unsupported_protocol");
  }
  if (url.username || url.password) {
    throw new ProxyTargetPolicyError("credentials_not_allowed");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new ProxyTargetPolicyError("origin_only_required");
  }

  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
    url.port = "";
  }
  return url.toString().replace(/\/$/, "");
}

function isLoopbackIp(value: string) {
  return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
}

export function createProxyTargetPolicy({
  allowLoopback,
  allowedHosts,
  allowedCidrs,
  resolveHostname = async (hostname: string) => (await dns.lookup(hostname, { all: true })).map((entry) => entry.address),
}: {
  allowLoopback: boolean;
  allowedHosts: string[];
  allowedCidrs: string[];
  resolveHostname?: (hostname: string) => Promise<string[]>;
}) {
  const normalizedHosts = new Set(allowedHosts.map((value) => value.toLowerCase()));
  const blockList = new net.BlockList();

  for (const cidr of allowedCidrs) {
    const [network, prefixLengthText] = cidr.split("/");
    const family = net.isIP(network) === 6 ? "ipv6" : "ipv4";
    const prefixLength = Number(prefixLengthText);
    if (!network || !Number.isInteger(prefixLength)) {
      throw new ProxyTargetPolicyError("invalid_allowed_cidr");
    }
    blockList.addSubnet(network, prefixLength, family);
  }

  function assertAllowedIp(ip: string) {
    if (allowLoopback && isLoopbackIp(ip)) {
      return;
    }
    if (!net.isIP(ip)) {
      throw new ProxyTargetPolicyError("invalid_resolved_ip");
    }
    const family = net.isIP(ip) === 6 ? "ipv6" : "ipv4";
    if (blockList.check(ip, family)) {
      return;
    }
    throw new ProxyTargetPolicyError("target_ip_not_allowed");
  }

  return {
    async assertAllowed(input: string): Promise<ResolvedProxyTarget> {
      const origin = normalizeProxyTargetOrigin(input);
      const url = new URL(origin);
      const hostname = url.hostname.toLowerCase();
      const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
      const resolvedIps =
        net.isIP(hostname) > 0 ? [hostname] : await resolveHostname(hostname);

      if (!resolvedIps.length) {
        throw new ProxyTargetPolicyError("hostname_resolution_failed");
      }

      if (normalizedHosts.size > 0 && !normalizedHosts.has(hostname) && !resolvedIps.every(isLoopbackIp)) {
        throw new ProxyTargetPolicyError("target_host_not_allowed");
      }

      for (const ip of resolvedIps) {
        assertAllowedIp(ip);
      }

      return {
        origin,
        protocol: url.protocol as "http:" | "https:",
        hostname,
        port,
        resolvedIps,
      };
    },
  };
}
```

Use `net.BlockList` instead of string-prefix CIDR matching. The point of this task is to ship an actual policy boundary, not a placeholder approximation that only works for a narrow IPv4 subset.

Create `packages/server/src/storage/repositories/proxy-grant-repo.ts` modeled after other JSON repos:

```ts
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

export interface ProxyGrantRecord {
  id: string;
  label: string;
  targetOrigin: string;
  allowWebSocket: boolean;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  lastUsedAt: number | null;
  lastUsedIp: string | null;
}

interface ProxyGrantFileRecord {
  version: 1;
  grants: Record<string, ProxyGrantRecord>;
}

export class ProxyGrantRepo {
  constructor(private readonly options: { filePath: string }) {}

  private load(): Record<string, ProxyGrantRecord> {
    const parsed = readJsonFile<ProxyGrantFileRecord>(this.options.filePath);
    if (!parsed || parsed.version !== 1 || typeof parsed.grants !== "object") {
      return {};
    }
    return parsed.grants;
  }

  private save(grants: Record<string, ProxyGrantRecord>) {
    writeJsonFileAtomic(this.options.filePath, { version: 1, grants });
  }

  list(): ProxyGrantRecord[] {
    return Object.values(this.load()).sort((left, right) => right.createdAt - left.createdAt);
  }

  get(id: string): ProxyGrantRecord | undefined {
    return this.load()[id];
  }

  set(record: ProxyGrantRecord) {
    const grants = this.load();
    grants[record.id] = record;
    this.save(grants);
  }

  delete(id: string) {
    const grants = this.load();
    if (!Object.prototype.hasOwnProperty.call(grants, id)) {
      return;
    }
    delete grants[id];
    this.save(grants);
  }
}
```

- [ ] **Step 4: Run the policy and repo tests again**

Run:

```bash
pnpm --filter @coder-studio/server test -- proxy/target-policy.test.ts storage/repositories/proxy-grant-repo.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/config.ts packages/server/src/proxy/grant-token.ts packages/server/src/proxy/target-policy.ts packages/server/src/proxy/target-policy.test.ts packages/server/src/storage/repositories/proxy-grant-repo.ts packages/server/src/storage/repositories/proxy-grant-repo.test.ts
git commit -m "feat(server): add proxy grant policy and persistence"
```

## Task 2: Grant Service and Main-Origin Management APIs

**Files:**
- Create: `packages/server/src/proxy/grant-service.ts`
- Create: `packages/server/src/proxy/grant-service.test.ts`
- Create: `packages/server/src/routes/proxy-grants.ts`
- Create: `packages/server/src/routes/proxy-grants.test.ts`
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: Write the failing grant-service and route tests**

Create `packages/server/src/proxy/grant-service.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";
import { GrantService } from "./grant-service.js";

describe("GrantService", () => {
  it("creates a grant and returns the raw token only once", async () => {
    const repo = {
      list: vi.fn(() => []),
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    };
    const service = new GrantService({
      repo: repo as never,
      now: () => 10,
      maxGrantTtlMs: 1_000,
      targetPolicy: {
        assertAllowed: vi.fn(async (origin: string) => ({
          origin,
          protocol: "http:",
          hostname: "localhost",
          port: 3000,
          resolvedIps: ["127.0.0.1"],
        })),
      },
    });

    const created = await service.create({
      label: "grafana",
      targetOrigin: "http://localhost:3000",
      allowWebSocket: true,
      ttlMs: 500,
    });

    expect(created.grantToken).toMatch(/^pgt_/);
    expect(created.record).toMatchObject({
      label: "grafana",
      targetOrigin: "http://localhost:3000",
      allowWebSocket: true,
    });
    expect(repo.set).toHaveBeenCalledTimes(1);
  });

  it("extends, rotates, and revokes existing grants", async () => {
    const existing = {
      id: "pgr_1",
      label: "grafana",
      targetOrigin: "http://localhost:3000",
      allowWebSocket: true,
      tokenHash: "hash_1",
      createdAt: 1,
      expiresAt: 20,
      revokedAt: null,
      lastUsedAt: null,
      lastUsedIp: null,
    };
    const repo = {
      list: vi.fn(() => [existing]),
      get: vi.fn(() => existing),
      set: vi.fn(),
      delete: vi.fn(),
    };
    const service = new GrantService({
      repo: repo as never,
      now: () => 10,
      maxGrantTtlMs: 1_000,
      targetPolicy: {
        assertAllowed: vi.fn(async (origin: string) => ({
          origin,
          protocol: "http:",
          hostname: "localhost",
          port: 3000,
          resolvedIps: ["127.0.0.1"],
        })),
      },
    });

    const extended = await service.extend("pgr_1", 900);
    const rotated = await service.rotate("pgr_1");
    const revoked = await service.revoke("pgr_1");

    expect(extended.expiresAt).toBeGreaterThan(existing.expiresAt);
    expect(rotated.grantToken).toMatch(/^pgt_/);
    expect(revoked.revokedAt).toBe(10);
  });
});
```

Create `packages/server/src/routes/proxy-grants.test.ts` with:

```ts
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerProxyGrantRoutes } from "./proxy-grants.js";

describe("registerProxyGrantRoutes", () => {
  it("returns the raw token on create and omits it from list responses", async () => {
    const app = Fastify();
    const service = {
      list: vi.fn(() => [
        {
          id: "pgr_1",
          label: "grafana",
          targetOrigin: "http://localhost:3000",
          allowWebSocket: true,
          createdAt: 1,
          expiresAt: 2,
          revokedAt: null,
          lastUsedAt: null,
          lastUsedIp: null,
        },
      ]),
      create: vi.fn(async () => ({
        record: {
          id: "pgr_2",
          label: "wiki",
          targetOrigin: "http://localhost:4000",
          allowWebSocket: false,
          createdAt: 3,
          expiresAt: 4,
          revokedAt: null,
          lastUsedAt: null,
          lastUsedIp: null,
          tokenHash: "hash",
        },
        grantToken: "pgt_created",
      })),
      extend: vi.fn(),
      rotate: vi.fn(),
      revoke: vi.fn(),
    };

    registerProxyGrantRoutes(app, {
      service: service as never,
      proxyOrigin: "http://localhost:4445",
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/proxy/grants",
      payload: {
        label: "wiki",
        targetOrigin: "http://localhost:4000",
        allowWebSocket: false,
        ttlMs: 1000,
      },
    });
    const listResponse = await app.inject({
      method: "GET",
      url: "/api/proxy/grants",
    });

    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json()).toMatchObject({
      grantToken: "pgt_created",
      proxyOrigin: "http://localhost:4445",
    });
    expect(listResponse.json()).toEqual({
      proxyOrigin: "http://localhost:4445",
      grants: [
        expect.not.objectContaining({
          grantToken: expect.anything(),
        }),
      ],
    });
  });
});
```

- [ ] **Step 2: Run the failing grant-service and route tests**

Run:

```bash
pnpm --filter @coder-studio/server test -- proxy/grant-service.test.ts routes/proxy-grants.test.ts
```

Expected: FAIL because the service and route files do not exist.

- [ ] **Step 3: Implement the grant lifecycle service and `/api/proxy/*` routes**

Create `packages/server/src/proxy/grant-service.ts` with a service shaped like:

```ts
import { randomUUID } from "node:crypto";
import { createProxyGrantToken, hashProxyGrantToken } from "./grant-token.js";
import type { ProxyGrantRepo, ProxyGrantRecord } from "../storage/repositories/proxy-grant-repo.js";

export class GrantService {
  constructor(
    private readonly deps: {
      repo: ProxyGrantRepo;
      now: () => number;
      maxGrantTtlMs: number;
      targetPolicy: { assertAllowed(origin: string): Promise<{ origin: string }> };
    }
  ) {}

  list() {
    return this.deps.repo.list().map(({ tokenHash: _tokenHash, ...record }) => record);
  }

  findByTokenHash(tokenHash: string) {
    return this.deps.repo.list().find((record) => record.tokenHash === tokenHash) ?? null;
  }

  async create(input: {
    label: string;
    targetOrigin: string;
    allowWebSocket: boolean;
    ttlMs: number;
  }) {
    const now = this.deps.now();
    const ttlMs = Math.min(input.ttlMs, this.deps.maxGrantTtlMs);
    const resolved = await this.deps.targetPolicy.assertAllowed(input.targetOrigin);
    const grantToken = createProxyGrantToken();
    const record: ProxyGrantRecord = {
      id: `pgr_${randomUUID()}`,
      label: input.label.trim(),
      targetOrigin: resolved.origin,
      allowWebSocket: input.allowWebSocket,
      tokenHash: hashProxyGrantToken(grantToken),
      createdAt: now,
      expiresAt: now + ttlMs,
      revokedAt: null,
      lastUsedAt: null,
      lastUsedIp: null,
    };
    this.deps.repo.set(record);
    return { record, grantToken };
  }

  async extend(id: string, ttlMs: number) {
    const existing = this.requireGrant(id);
    const now = this.deps.now();
    const expiresAt = now + Math.min(ttlMs, this.deps.maxGrantTtlMs);
    const updated = { ...existing, expiresAt };
    this.deps.repo.set(updated);
    return updated;
  }

  async rotate(id: string) {
    const existing = this.requireGrant(id);
    const grantToken = createProxyGrantToken();
    const updated = { ...existing, tokenHash: hashProxyGrantToken(grantToken), revokedAt: null };
    this.deps.repo.set(updated);
    return { record: updated, grantToken };
  }

  async revoke(id: string) {
    const existing = this.requireGrant(id);
    const updated = { ...existing, revokedAt: this.deps.now() };
    this.deps.repo.set(updated);
    return updated;
  }

  private requireGrant(id: string) {
    const existing = this.deps.repo.get(id);
    if (!existing) {
      throw new Error("proxy_grant_not_found");
    }
    return existing;
  }
}
```

Create `packages/server/src/routes/proxy-grants.ts` with route registration like:

```ts
import { z } from "zod";
import type { FastifyInstance } from "fastify";

const CreateGrantSchema = z.object({
  label: z.string().trim().min(1),
  targetOrigin: z.string().trim().min(1),
  allowWebSocket: z.boolean(),
  ttlMs: z.number().int().positive(),
});

const ExtendGrantSchema = z.object({
  ttlMs: z.number().int().positive(),
});

export function registerProxyGrantRoutes(
  app: FastifyInstance,
  deps: {
    service: {
      list(): unknown;
      create(input: z.infer<typeof CreateGrantSchema>): Promise<{ record: Record<string, unknown>; grantToken: string }>;
      extend(id: string, ttlMs: number): Promise<Record<string, unknown>>;
      rotate(id: string): Promise<{ record: Record<string, unknown>; grantToken: string }>;
      revoke(id: string): Promise<Record<string, unknown>>;
    };
    proxyOrigin: string;
  }
) {
  app.get("/api/proxy/config", async () => ({
    proxyOrigin: deps.proxyOrigin,
  }));

  app.get("/api/proxy/grants", async () => ({
    grants: deps.service.list(),
  }));

  app.post("/api/proxy/grants", async (request, reply) => {
    const parsed = CreateGrantSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "invalid_proxy_grant_payload" });
    }
    const created = await deps.service.create(parsed.data);
    const { tokenHash: _tokenHash, ...record } = created.record as { tokenHash?: string };
    return reply.send({
      ...record,
      grantToken: created.grantToken,
      proxyOrigin: deps.proxyOrigin,
    });
  });

  app.post("/api/proxy/grants/:id/extend", async (request, reply) => {
    const parsed = ExtendGrantSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "invalid_proxy_grant_payload" });
    }
    return reply.send(await deps.service.extend((request.params as { id: string }).id, parsed.data.ttlMs));
  });

  app.post("/api/proxy/grants/:id/rotate", async (request) => {
    const rotated = await deps.service.rotate((request.params as { id: string }).id);
    const { tokenHash: _tokenHash, ...record } = rotated.record as { tokenHash?: string };
    return {
      ...record,
      grantToken: rotated.grantToken,
      proxyOrigin: deps.proxyOrigin,
    };
  });

  app.delete("/api/proxy/grants/:id", async (request) => {
    return await deps.service.revoke((request.params as { id: string }).id);
  });
}
```

Register those routes in `packages/server/src/app.ts` before static web fallback routes using a concrete service instance from `server.ts`.

Keep the API shapes consistent with the UI flow:

- `GET /api/proxy/config` returns `{ proxyOrigin }`
- `GET /api/proxy/grants` returns `{ proxyOrigin, grants }`
- `POST /api/proxy/grants` and `POST /api/proxy/grants/:id/rotate` return `{ ...grantView, proxyOrigin, grantToken }`

That lets the web panel either read `proxyOrigin` from the list call or from the separate config call without maintaining two incompatible response shapes.

- [ ] **Step 4: Run the grant-service and route tests again**

Run:

```bash
pnpm --filter @coder-studio/server test -- proxy/grant-service.test.ts routes/proxy-grants.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/proxy/grant-service.ts packages/server/src/proxy/grant-service.test.ts packages/server/src/routes/proxy-grants.ts packages/server/src/routes/proxy-grants.test.ts packages/server/src/app.ts
git commit -m "feat(server): add proxy grant management APIs"
```

## Task 3: Dedicated Proxy Listener, Cookie Jar, and HTTP/WS Forwarding

**Files:**
- Create: `packages/server/src/proxy/cookie-jar.ts`
- Create: `packages/server/src/proxy/cookie-jar.test.ts`
- Create: `packages/server/src/proxy/headers.ts`
- Create: `packages/server/src/proxy/headers.test.ts`
- Create: `packages/server/src/proxy/errors.ts`
- Create: `packages/server/src/proxy/proxy-app.ts`
- Create: `packages/server/src/proxy/proxy-app.test.ts`
- Modify: `packages/server/src/auth/plugin.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/__tests__/server-runtime-config.test.ts`

- [ ] **Step 1: Write failing cookie-jar, header, and proxy-listener tests**

Create `packages/server/src/proxy/cookie-jar.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { ProxyCookieJar } from "./cookie-jar.js";

describe("ProxyCookieJar", () => {
  it("captures and replays per-grant cookies", () => {
    const jar = new ProxyCookieJar();
    jar.capture("pgr_1", [
      "sid=abc; Path=/; HttpOnly",
      "theme=dark; Path=/",
    ]);

    expect(jar.getCookieHeader("pgr_1", "http://localhost:3000/app")).toBe("sid=abc; theme=dark");
    expect(jar.getCookieHeader("pgr_2", "http://localhost:3000/app")).toBe("");
  });

  it("clears cookies when a grant is rotated or revoked", () => {
    const jar = new ProxyCookieJar();
    jar.capture("pgr_1", ["sid=abc; Path=/"]);
    jar.clear("pgr_1");
    expect(jar.getCookieHeader("pgr_1", "http://localhost:3000/app")).toBe("");
  });
});
```

Create `packages/server/src/proxy/headers.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { buildUpstreamHeaders, rewriteProxyLocationHeader } from "./headers.js";

describe("buildUpstreamHeaders", () => {
  it("strips proxy and hop-by-hop headers while rewriting host and origin", () => {
    const headers = buildUpstreamHeaders({
      incoming: {
        host: "localhost:4445",
        origin: "http://localhost:4445",
        referer: "http://localhost:4445/app",
        connection: "keep-alive",
        "x-cs-proxy-target": "http://localhost:3000",
        "x-cs-proxy-grant": "pgt_1",
      },
      upstreamOrigin: "http://localhost:3000",
      cookieHeader: "sid=abc",
    });

    expect(headers.host).toBe("localhost:3000");
    expect(headers.origin).toBe("http://localhost:3000");
    expect(headers.referer).toBe("http://localhost:3000/app");
    expect(headers.cookie).toBe("sid=abc");
    expect(headers).not.toHaveProperty("connection");
    expect(headers).not.toHaveProperty("x-cs-proxy-target");
  });
});

describe("rewriteProxyLocationHeader", () => {
  it("rewrites target-origin redirects back to the proxy origin", () => {
    expect(
      rewriteProxyLocationHeader({
        location: "http://localhost:3000/login?next=%2Fapp",
        targetOrigin: "http://localhost:3000",
        proxyOrigin: "http://localhost:4445",
      })
    ).toBe("http://localhost:4445/login?next=%2Fapp");
  });
});
```

Create `packages/server/src/proxy/proxy-app.test.ts` with:

```ts
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildProxyApp } from "./proxy-app.js";

describe("buildProxyApp", () => {
  let upstreamHttp: ReturnType<typeof Fastify>;
  let upstreamPort = 0;

  beforeEach(async () => {
    upstreamHttp = Fastify();
    await upstreamHttp.register(websocket);
    upstreamHttp.get("/app", async (_request, reply) => {
      reply
        .header("Set-Cookie", "sid=abc; Path=/")
        .header("Location", "http://localhost:3000/login")
        .status(302);
      return "";
    });
    upstreamHttp.get("/ok", async () => ({ ok: true }));
    upstreamHttp.get("/ws", { websocket: true }, (socket) => {
      socket.on("message", (payload) => {
        socket.send(`echo:${payload.toString()}`);
      });
    });
    await upstreamHttp.listen({ host: "127.0.0.1", port: 0 });
    upstreamPort = Number((upstreamHttp.server.address() as { port: number }).port);
  });

  afterEach(async () => {
    await upstreamHttp.close();
  });

  it("requires auth and matching grant headers, captures cookies, and rewrites redirects", async () => {
    const app = await buildProxyApp({
      authSessionRepo: {
        touch: () => true,
      } as never,
      targetPolicy: {
        assertAllowed: async (origin: string) => ({
          origin,
          protocol: "http:",
          hostname: "127.0.0.1",
          port: upstreamPort,
          resolvedIps: ["127.0.0.1"],
        }),
      },
      grantLookup: async () => ({
        id: "pgr_1",
        targetOrigin: `http://127.0.0.1:${upstreamPort}`,
        allowWebSocket: true,
        expiresAt: Date.now() + 60_000,
        revokedAt: null,
      }),
      proxyOrigin: "http://localhost:4445",
    });

    const response = await app.inject({
      method: "GET",
      url: "/app",
      headers: {
        cookie: "coder_studio_auth=ok",
        "x-cs-proxy-target": `http://127.0.0.1:${upstreamPort}`,
        "x-cs-proxy-grant": "pgt_1",
      },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("http://localhost:4445/login");
    expect(response.headers["set-cookie"]).toBeUndefined();
    await app.close();
  });
});
```

- [ ] **Step 2: Run the failing proxy-listener test suite**

Run:

```bash
pnpm --filter @coder-studio/server test -- proxy/cookie-jar.test.ts proxy/headers.test.ts proxy/proxy-app.test.ts __tests__/server-runtime-config.test.ts
```

Expected: FAIL because the cookie jar, header helpers, and proxy app do not exist and the runtime config test does not yet account for a second listener.

- [ ] **Step 3: Implement the dedicated proxy Fastify app and second listener startup**

Create `packages/server/src/proxy/cookie-jar.ts` with:

```ts
type CookieEntry = {
  name: string;
  value: string;
};

export class ProxyCookieJar {
  private readonly jars = new Map<string, CookieEntry[]>();

  capture(grantId: string, setCookieHeaders: string[]) {
    const next: CookieEntry[] = [];
    for (const header of setCookieHeaders) {
      const [pair] = header.split(";", 1);
      const [name, ...rest] = pair.split("=");
      if (!name) {
        continue;
      }
      next.push({ name: name.trim(), value: rest.join("=").trim() });
    }
    this.jars.set(grantId, next);
  }

  getCookieHeader(grantId: string, _url: string): string {
    return (this.jars.get(grantId) ?? [])
      .map((entry) => `${entry.name}=${entry.value}`)
      .join("; ");
  }

  clear(grantId: string) {
    this.jars.delete(grantId);
  }
}
```

Create `packages/server/src/proxy/headers.ts` with:

```ts
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-cs-proxy-target",
  "x-cs-proxy-grant",
]);

export function buildUpstreamHeaders({
  incoming,
  upstreamOrigin,
  cookieHeader,
}: {
  incoming: Record<string, string | string[] | undefined>;
  upstreamOrigin: string;
  cookieHeader: string;
}) {
  const url = new URL(upstreamOrigin);
  const headers: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(incoming)) {
    if (!rawValue) {
      continue;
    }
    const lowerKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerKey)) {
      continue;
    }
    headers[lowerKey] = Array.isArray(rawValue) ? rawValue.join(", ") : rawValue;
  }

  headers.host = url.host;
  if (headers.origin) {
    headers.origin = upstreamOrigin;
  }
  if (headers.referer) {
    headers.referer = headers.referer.replace(/^https?:\/\/[^/]+/, upstreamOrigin);
  }
  if (cookieHeader) {
    headers.cookie = cookieHeader;
  } else {
    delete headers.cookie;
  }

  return headers;
}

export function rewriteProxyLocationHeader({
  location,
  targetOrigin,
  proxyOrigin,
}: {
  location: string;
  targetOrigin: string;
  proxyOrigin: string;
}) {
  return location.startsWith(targetOrigin)
    ? `${proxyOrigin}${location.slice(targetOrigin.length)}`
    : location;
}
```

Create `packages/server/src/proxy/errors.ts` with:

```ts
export function renderProxyNavigationErrorHtml(error: string, targetOrigin: string, mainUiOrigin: string) {
  return `<!doctype html><html><body><h1>Proxy Error</h1><p>${error}</p><p>${targetOrigin}</p><p><a href="${mainUiOrigin}">Back to Coder Studio</a></p></body></html>`;
}
```

Create `packages/server/src/proxy/proxy-app.ts` with a builder that:

- registers `@fastify/websocket`
- reads and validates `coder_studio_auth` from the shared `AuthSessionRepo`
- validates `X-CS-Proxy-Target` and `X-CS-Proxy-Grant`
- checks grant expiration, revocation, target equality, and `allowWebSocket`
- forwards HTTP with `fetch`
- captures upstream `Set-Cookie` into `ProxyCookieJar`
- rewrites `Location` response headers back to the proxy origin
- creates a `ws` upstream client per browser WebSocket connection

Prefer route registration that matches this codebase's current Fastify usage:

- register `@fastify/websocket` inside the dedicated proxy app
- use one HTTP catch-all such as `app.route({ method: ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"], url: "/*", handler })`
- register a separate WebSocket `GET "/*"` route with `{ websocket: true }`

Do not rely on a single mixed `app.all("/*", ...)` route to cover WebSocket upgrades. Keep HTTP and WebSocket handlers explicit.

Use a shape like:

```ts
import websocket, { type WebSocket } from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import Ws from "ws";
import { hashProxyGrantToken } from "./grant-token.js";
import { buildUpstreamHeaders, rewriteProxyLocationHeader } from "./headers.js";
import { ProxyCookieJar } from "./cookie-jar.js";

function parseAuthCookie(request: FastifyRequest) {
  const cookie = request.headers.cookie ?? "";
  const match = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("coder_studio_auth="));
  return match ? decodeURIComponent(match.slice("coder_studio_auth=".length)) : null;
}

export async function buildProxyApp(deps: {
  authSessionRepo: { touch(token: string, now: number): boolean };
  targetPolicy: { assertAllowed(origin: string): Promise<{ origin: string; protocol: "http:" | "https:" }> };
  grantLookup: (tokenHash: string) => Promise<{
    id: string;
    targetOrigin: string;
    allowWebSocket: boolean;
    expiresAt: number;
    revokedAt: number | null;
  } | null>;
  proxyOrigin: string;
  mainUiOrigin?: string;
}) {
  const app = Fastify();
  const cookieJar = new ProxyCookieJar();
  await app.register(websocket);

  async function authenticate(request: FastifyRequest) {
    const authToken = parseAuthCookie(request);
    if (!authToken || !deps.authSessionRepo.touch(authToken, Date.now())) {
      throw new Error("auth_required");
    }

    const targetOrigin = request.headers["x-cs-proxy-target"];
    const grantToken = request.headers["x-cs-proxy-grant"];
    if (typeof targetOrigin !== "string" || typeof grantToken !== "string") {
      throw new Error("proxy_headers_required");
    }

    const grant = await deps.grantLookup(hashProxyGrantToken(grantToken));
    if (!grant) {
      throw new Error("proxy_grant_invalid");
    }
    if (grant.revokedAt !== null) {
      throw new Error("proxy_grant_revoked");
    }
    if (grant.expiresAt <= Date.now()) {
      throw new Error("proxy_grant_expired");
    }

    const resolved = await deps.targetPolicy.assertAllowed(targetOrigin);
    if (resolved.origin !== grant.targetOrigin) {
      throw new Error("proxy_target_mismatch");
    }

    return {
      grant,
      targetOrigin: resolved.origin,
      protocol: resolved.protocol,
    };
  }

  app.route({
    method: ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"],
    url: "/*",
    async handler(request, reply) {
    try {
      const auth = await authenticate(request);
      const upstreamUrl = `${auth.targetOrigin}${request.url}`;
      const upstreamResponse = await fetch(upstreamUrl, {
        method: request.method,
        headers: buildUpstreamHeaders({
          incoming: request.headers as Record<string, string | string[] | undefined>,
          upstreamOrigin: auth.targetOrigin,
          cookieHeader: cookieJar.getCookieHeader(auth.grant.id, upstreamUrl),
        }),
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        redirect: "manual",
      });

      const setCookie = upstreamResponse.headers.getSetCookie?.() ?? [];
      if (setCookie.length > 0) {
        cookieJar.capture(auth.grant.id, setCookie);
      }

      for (const [key, value] of upstreamResponse.headers.entries()) {
        if (key.toLowerCase() === "set-cookie") {
          continue;
        }
        if (key.toLowerCase() === "location") {
          reply.header(
            "Location",
            rewriteProxyLocationHeader({
              location: value,
              targetOrigin: auth.targetOrigin,
              proxyOrigin: deps.proxyOrigin,
            })
          );
          continue;
        }
        reply.header(key, value);
      }

      reply.status(upstreamResponse.status);
      return reply.send(Buffer.from(await upstreamResponse.arrayBuffer()));
    } catch (error) {
      const code = (error as Error).message;
      return reply.status(code === "auth_required" ? 401 : 403).send({ ok: false, error: code });
    }
    },
  });

  app.get("/*", { websocket: true }, async (connection: WebSocket, request: FastifyRequest) => {
    const auth = await authenticate(request);
    if (!auth.grant.allowWebSocket) {
      connection.close(1008, "proxy_websocket_not_allowed");
      return;
    }

    const upstreamBase = auth.protocol === "https:" ? auth.targetOrigin.replace(/^https:/, "wss:") : auth.targetOrigin.replace(/^http:/, "ws:");
    const upstream = new Ws(`${upstreamBase}${request.url}`, {
      headers: buildUpstreamHeaders({
        incoming: request.headers as Record<string, string | string[] | undefined>,
        upstreamOrigin: auth.targetOrigin,
        cookieHeader: cookieJar.getCookieHeader(auth.grant.id, `${auth.targetOrigin}${request.url}`),
      }),
    });

    upstream.on("message", (payload, isBinary) => {
      connection.send(payload, { binary: isBinary });
    });
    connection.on("message", (payload, isBinary) => {
      upstream.send(payload, { binary: isBinary });
    });
    upstream.on("close", (code, reason) => connection.close(code, reason.toString()));
    connection.on("close", (code, reason) => upstream.close(code, reason.toString()));
    upstream.on("error", () => connection.close(1011, "upstream_unreachable"));
  });

  return app;
}
```

Modify `packages/server/src/server.ts` to:

- instantiate `ProxyGrantRepo`
- instantiate `GrantService`
- build a proxy app when `config.proxy.enabled`
- pass `grantLookup: (tokenHash) => grantService.findByTokenHash(tokenHash)`
- start the proxy listener after the main listener
- stop it inside `stopServer`
- include proxy runtime info in test-only metadata if useful

Add a runtime test in `packages/server/src/__tests__/server-runtime-config.test.ts` like:

```ts
it("starts and stops the dedicated proxy listener when proxy is enabled", async () => {
  server = await createRuntimeServer({
    stateDir: join(testHomeDir, "server-state-proxy"),
    host: "127.0.0.1",
    port: 0,
    proxy: {
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      publicOrigin: undefined,
      maxGrantTtlMs: 60_000,
      allowedHosts: [],
      allowedCidrs: [],
      allowLoopback: true,
    },
  });

  expect(server.app.server.listening).toBe(true);
});
```

- [ ] **Step 4: Run the proxy listener and runtime tests again**

Run:

```bash
pnpm --filter @coder-studio/server test -- proxy/cookie-jar.test.ts proxy/headers.test.ts proxy/proxy-app.test.ts __tests__/server-runtime-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/proxy/cookie-jar.ts packages/server/src/proxy/cookie-jar.test.ts packages/server/src/proxy/headers.ts packages/server/src/proxy/headers.test.ts packages/server/src/proxy/errors.ts packages/server/src/proxy/proxy-app.ts packages/server/src/proxy/proxy-app.test.ts packages/server/src/auth/plugin.ts packages/server/src/server.ts packages/server/src/__tests__/server-runtime-config.test.ts
git commit -m "feat(server): add dedicated proxy listener"
```

## Task 4: Proxy Access Settings Panel and Client API

**Files:**
- Modify: `packages/web/src/features/settings/components/settings-sections.tsx`
- Modify: `packages/web/src/features/more/routes.ts`
- Modify: `packages/web/src/features/more/page.tsx`
- Modify: `packages/web/src/features/more/page.test.tsx`
- Create: `packages/web/src/features/settings/components/proxy-access-api.ts`
- Create: `packages/web/src/features/settings/components/proxy-access-api.test.ts`
- Create: `packages/web/src/features/settings/components/proxy-access-settings.tsx`
- Create: `packages/web/src/features/settings/components/proxy-access-settings.test.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write the failing client-API and settings-panel tests**

Create `packages/web/src/features/settings/components/proxy-access-api.test.ts` with:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProxyGrant,
  extendProxyGrant,
  listProxyGrants,
  revokeProxyGrant,
  rotateProxyGrant,
} from "./proxy-access-api";

describe("proxy-access-api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the expected proxy management endpoints with credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ proxyOrigin: "http://localhost:4445", grants: [] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ proxyOrigin: "http://localhost:4445", grants: [] }), {
          status: 200,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await listProxyGrants();
    await createProxyGrant({
      label: "grafana",
      targetOrigin: "http://localhost:3000",
      allowWebSocket: true,
      ttlMs: 60_000,
    });
    await extendProxyGrant("pgr_1", 120_000);
    await rotateProxyGrant("pgr_1");
    await revokeProxyGrant("pgr_1");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/proxy/grants",
      expect.objectContaining({
        credentials: "include",
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/proxy/grants",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      })
    );
  });
});
```

Create `packages/web/src/features/settings/components/proxy-access-settings.test.tsx` with:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProxyAccessSettings } from "./proxy-access-settings";

describe("ProxyAccessSettings", () => {
  it("creates a grant and shows the one-time token modal", async () => {
    const api = {
      listProxyGrants: vi.fn(async () => ({
        proxyOrigin: "http://localhost:4445",
        grants: [],
      })),
      createProxyGrant: vi.fn(async () => ({
        id: "pgr_1",
        label: "grafana",
        targetOrigin: "http://localhost:3000",
        allowWebSocket: true,
        expiresAt: 1000,
        proxyOrigin: "http://localhost:4445",
        grantToken: "pgt_created",
      })),
      extendProxyGrant: vi.fn(),
      rotateProxyGrant: vi.fn(),
      revokeProxyGrant: vi.fn(),
    };

    render(<ProxyAccessSettings api={api as never} />);

    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "grafana" } });
    fireEvent.change(screen.getByLabelText("Target Origin"), {
      target: { value: "http://localhost:3000" },
    });
    fireEvent.click(screen.getByLabelText("Allow WebSocket"));
    fireEvent.click(screen.getByRole("button", { name: "Create Grant" }));

    await waitFor(() => {
      expect(api.createProxyGrant).toHaveBeenCalledWith({
        label: "grafana",
        targetOrigin: "http://localhost:3000",
        allowWebSocket: true,
        ttlMs: expect.any(Number),
      });
    });

    expect(screen.getByText("pgt_created")).toBeInTheDocument();
    expect(screen.getByText("http://localhost:4445")).toBeInTheDocument();
  });

  it("renders grant rows and wires extend, rotate, and revoke actions", async () => {
    const api = {
      listProxyGrants: vi.fn(async () => ({
        proxyOrigin: "http://localhost:4445",
        grants: [
          {
            id: "pgr_1",
            label: "grafana",
            targetOrigin: "http://localhost:3000",
            allowWebSocket: true,
            createdAt: 1,
            expiresAt: 2,
            revokedAt: null,
            lastUsedAt: null,
            lastUsedIp: null,
          },
        ],
      })),
      createProxyGrant: vi.fn(),
      extendProxyGrant: vi.fn(async () => ({})),
      rotateProxyGrant: vi.fn(async () => ({
        id: "pgr_1",
        proxyOrigin: "http://localhost:4445",
        grantToken: "pgt_rotated",
      })),
      revokeProxyGrant: vi.fn(async () => ({})),
    };

    render(<ProxyAccessSettings api={api as never} />);

    expect(await screen.findByText("grafana")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Extend" }));
    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(api.extendProxyGrant).toHaveBeenCalledWith("pgr_1", expect.any(Number));
      expect(api.rotateProxyGrant).toHaveBeenCalledWith("pgr_1");
      expect(api.revokeProxyGrant).toHaveBeenCalledWith("pgr_1");
    });
  });
});
```

- [ ] **Step 2: Run the failing web tests**

Run:

```bash
pnpm --filter @coder-studio/web test -- proxy-access-api.test.ts proxy-access-settings.test.tsx settings-page.test.tsx
```

Expected: FAIL because the API wrapper and panel components do not exist and Settings does not yet expose a `proxy` section.

- [ ] **Step 3: Implement the client API, panel, route wiring, and strings**

Create `packages/web/src/features/settings/components/proxy-access-api.ts`:

```ts
export interface ProxyGrantView {
  id: string;
  label: string;
  targetOrigin: string;
  allowWebSocket: boolean;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  lastUsedAt: number | null;
  lastUsedIp: string | null;
}

export interface ProxyGrantSecretView extends ProxyGrantView {
  proxyOrigin: string;
  grantToken: string;
}

async function readJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`proxy_request_failed:${response.status}`);
  }

  return (await response.json()) as T;
}

export function listProxyGrants() {
  return readJson<{ proxyOrigin?: string; grants: ProxyGrantView[] }>("/api/proxy/grants");
}

export function createProxyGrant(input: {
  label: string;
  targetOrigin: string;
  allowWebSocket: boolean;
  ttlMs: number;
}) {
  return readJson<ProxyGrantSecretView>("/api/proxy/grants", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function extendProxyGrant(id: string, ttlMs: number) {
  return readJson<ProxyGrantView>(`/api/proxy/grants/${id}/extend`, {
    method: "POST",
    body: JSON.stringify({ ttlMs }),
  });
}

export function rotateProxyGrant(id: string) {
  return readJson<ProxyGrantSecretView>(`/api/proxy/grants/${id}/rotate`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function revokeProxyGrant(id: string) {
  return readJson<ProxyGrantView>(`/api/proxy/grants/${id}`, {
    method: "DELETE",
  });
}
```

Create `packages/web/src/features/settings/components/proxy-access-settings.tsx` with a focused component that:

- loads grant data on mount
- renders a create form with `label`, `targetOrigin`, `allowWebSocket`, and `TTL`
- shows a setup modal after create and rotate
- renders a flat row list with `Extend`, `Rotate`, and `Revoke`
- accepts an optional `api` prop to ease testing

Use a structure like:

```tsx
import { useEffect, useState } from "react";
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Notice,
  Switch,
} from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";
import * as defaultApi from "./proxy-access-api";

const TTL_OPTIONS = [
  { label: "1 hour", value: 60 * 60 * 1000 },
  { label: "24 hours", value: 24 * 60 * 60 * 1000 },
  { label: "7 days", value: 7 * 24 * 60 * 60 * 1000 },
];

export function ProxyAccessSettings({
  api = defaultApi,
}: {
  api?: typeof defaultApi;
}) {
  const t = useTranslation();
  const [label, setLabel] = useState("");
  const [targetOrigin, setTargetOrigin] = useState("");
  const [allowWebSocket, setAllowWebSocket] = useState(true);
  const [ttlMs, setTtlMs] = useState(TTL_OPTIONS[1]!.value);
  const [grants, setGrants] = useState<defaultApi.ProxyGrantView[]>([]);
  const [proxyOrigin, setProxyOrigin] = useState("");
  const [secret, setSecret] = useState<defaultApi.ProxyGrantSecretView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    try {
      const result = await api.listProxyGrants();
      setGrants(result.grants);
      if (result.proxyOrigin) {
        setProxyOrigin(result.proxyOrigin);
      }
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  return (
    <div className="settings-section proxy-access-settings">
      <div className="settings-group">
        <h3 className="settings-group-title">{t("settings.proxy.title")}</h3>
        <p className="settings-group-desc">{t("settings.proxy.description")}</p>
        {error ? <Notice tone="error" message={error} /> : null}
        <label>
          <span>{t("settings.proxy.label")}</span>
          <Input aria-label={t("settings.proxy.label")} value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <label>
          <span>{t("settings.proxy.target_origin")}</span>
          <Input
            aria-label={t("settings.proxy.target_origin")}
            value={targetOrigin}
            onChange={(event) => setTargetOrigin(event.target.value)}
          />
        </label>
        <label className="settings-toggle-row">
          <span>{t("settings.proxy.allow_websocket")}</span>
          <Switch
            aria-label={t("settings.proxy.allow_websocket")}
            checked={allowWebSocket}
            onCheckedChange={setAllowWebSocket}
          />
        </label>
        <div className="settings-actions-row">
          {TTL_OPTIONS.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant={ttlMs === option.value ? "primary" : "secondary"}
              onClick={() => setTtlMs(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <Button
          onClick={async () => {
            const created = await api.createProxyGrant({
              label,
              targetOrigin,
              allowWebSocket,
              ttlMs,
            });
            setSecret(created);
            setProxyOrigin(created.proxyOrigin);
            await reload();
          }}
        >
          {t("settings.proxy.create_grant")}
        </Button>
      </div>

      <div className="settings-group">
        {grants.map((grant) => (
          <div key={grant.id} className="proxy-access-settings__row">
            <div>
              <strong>{grant.label}</strong>
              <div>{grant.targetOrigin}</div>
            </div>
            <div className="settings-actions-row">
              <Button type="button" variant="secondary" onClick={async () => { await api.extendProxyGrant(grant.id, ttlMs); await reload(); }}>
                {t("settings.proxy.extend")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  const rotated = await api.rotateProxyGrant(grant.id);
                  setSecret(rotated);
                  setProxyOrigin(rotated.proxyOrigin);
                  await reload();
                }}
              >
                {t("settings.proxy.rotate")}
              </Button>
              <Button type="button" variant="danger" onClick={async () => { await api.revokeProxyGrant(grant.id); await reload(); }}>
                {t("settings.proxy.revoke")}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={Boolean(secret)}
        onOpenChange={(open) => {
          if (!open) {
            setSecret(null);
          }
        }}
      >
        <ModalHeader>
          <ModalTitle>{t("settings.proxy.one_time_modal_title")}</ModalTitle>
        </ModalHeader>
        <ModalBody>
        {secret ? (
          <div className="proxy-access-settings__secret">
            <p>{t("settings.proxy.one_time_modal_hint")}</p>
            <code>{proxyOrigin}</code>
            <code>{secret.targetOrigin}</code>
            <code>{secret.grantToken}</code>
          </div>
        ) : null}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={() => setSecret(null)}>
            {t("action.close")}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
```

Wire the section into `packages/web/src/features/settings/components/settings-sections.tsx`:

```ts
export type SettingsSection =
  | "general"
  | "providers"
  | "appearance"
  | "shortcuts"
  | "proxy"
  | "monitoring"
  | "analysis"
  | "diagnostics"
  | "about";

const VISIBLE_SETTINGS_SECTIONS = [
  { id: "general", labelKey: "settings.general", iconSemantic: "nav.settings.general" },
  { id: "providers", labelKey: "settings.providers", iconSemantic: "nav.settings.providers" },
  { id: "appearance", labelKey: "settings.appearance", iconSemantic: "nav.settings.appearance" },
  { id: "shortcuts", labelKey: "settings.shortcuts.title", iconSemantic: "nav.settings.shortcuts" },
  { id: "proxy", labelKey: "settings.proxy.title", iconSemantic: "nav.settings.general" },
] as const;
```

Wire `proxy` into `packages/web/src/features/more/routes.ts`:

```ts
{
  id: "proxy",
  labelKey: "settings.proxy.title",
  hintKey: "more.section.settings.proxy_hint",
  iconSemantic: "nav.settings.general",
}
```

Mount the component inside `packages/web/src/features/settings/components/settings-page.tsx` wherever other settings sections render:

```tsx
import { ProxyAccessSettings } from "./proxy-access-settings";

case "proxy":
  return <ProxyAccessSettings />;
```

Also update the existing settings helpers in `settings-page.tsx` so the new section is valid everywhere:

- add `"proxy"` to `EmbeddedSettingsSection`
- add a `case "proxy"` branch in `getMobileSectionHintKey`
- add `"proxy"` into one `MOBILE_SETTINGS_GROUPS` bucket
- make `renderContent` return `<ProxyAccessSettings />` for the new branch

Update `packages/web/src/features/more/page.tsx` and `packages/web/src/features/more/page.test.tsx` so `isEmbeddedSettingsSection("proxy")` is accepted and `/more/settings/proxy` renders the embedded settings page instead of falling back.

Add locale keys in both locale files:

```json
"settings": {
  "proxy": {
    "title": "Proxy Access",
    "description": "Create short-lived browser proxy grants for internal services.",
    "label": "Label",
    "target_origin": "Target Origin",
    "allow_websocket": "Allow WebSocket",
    "create_grant": "Create Grant",
    "extend": "Extend",
    "rotate": "Rotate",
    "revoke": "Revoke",
    "one_time_modal_title": "Grant Token",
    "one_time_modal_hint": "This token is shown only once. Rotate the grant if you lose it."
  }
}
```

Add matching Chinese strings in `packages/web/src/locales/zh.json`.

Add minimal CSS in `packages/web/src/styles/components.css`:

```css
.proxy-access-settings {
  display: grid;
  gap: 16px;
}

.proxy-access-settings__row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  border-top: 1px solid var(--color-border-subtle);
}

.proxy-access-settings__secret {
  display: grid;
  gap: 8px;
}

.proxy-access-settings__secret code {
  display: block;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--color-surface-elevated);
  word-break: break-all;
}
```

- [ ] **Step 4: Run the web tests again**

Run:

```bash
pnpm --filter @coder-studio/web test -- proxy-access-api.test.ts proxy-access-settings.test.tsx settings-page.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/settings/components/settings-sections.tsx packages/web/src/features/more/routes.ts packages/web/src/features/more/page.tsx packages/web/src/features/more/page.test.tsx packages/web/src/features/settings/components/proxy-access-api.ts packages/web/src/features/settings/components/proxy-access-api.test.ts packages/web/src/features/settings/components/proxy-access-settings.tsx packages/web/src/features/settings/components/proxy-access-settings.test.tsx packages/web/src/features/settings/components/settings-page.tsx packages/web/src/features/settings/components/settings-page.test.tsx packages/web/src/locales/en.json packages/web/src/locales/zh.json packages/web/src/styles/components.css
git commit -m "feat(web): add proxy access settings panel"
```

## Task 5: Integration Verification and Cleanup

**Files:**
- Modify as needed based on failures from previous tasks only

- [ ] **Step 1: Run focused server verification**

Run:

```bash
pnpm --filter @coder-studio/server test -- proxy/target-policy.test.ts storage/repositories/proxy-grant-repo.test.ts proxy/grant-service.test.ts routes/proxy-grants.test.ts proxy/cookie-jar.test.ts proxy/headers.test.ts proxy/proxy-app.test.ts __tests__/server-runtime-config.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused web verification**

Run:

```bash
pnpm --filter @coder-studio/web test -- proxy-access-api.test.ts proxy-access-settings.test.tsx settings-page.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run repository-level verification for touched packages**

Run:

```bash
pnpm lint
pnpm ci:test
```

Expected: PASS. If `pnpm ci:test` is too slow for the current execution budget, at minimum capture which package suites were run and explicitly note the skipped repository-level command before handoff.

- [ ] **Step 4: Commit any last verification-driven fixes**

```bash
git add -A
git commit -m "test: verify external browser proxy grants flow"
```

- [ ] **Step 5: Prepare handoff notes**

Record:

- proxy origin and main UI origin assumptions
- environment variables required to enable non-loopback targets
- the current v1 limitation around hard-coded absolute upstream URLs
- whether repository-level verification completed successfully
