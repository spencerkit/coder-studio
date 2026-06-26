# External Browser Proxy Grants Design

> Status: Draft for user review
> Date: 2026-06-20
> Scope: `packages/server` proxy grant APIs and dedicated proxy listener, `packages/web` proxy management panel, related tests and docs

## Goal

Allow users to open an internal or otherwise browser-inaccessible HTTP service in a
normal browser tab by routing traffic through Coder Studio, while keeping Coder
Studio's own UI origin isolated from the proxied application origin.

The feature must support:

- ordinary HTTP page loads and static assets
- same-origin `fetch` and `XMLHttpRequest`
- browser WebSocket connections
- short-lived, revocable authorization grants
- browser-extension-based request header injection such as ModHeader or Requestly

## Decisions

- Keep the proxy entry outside the built-in dev browser. This is for normal browser
  tabs, not iframe-based workspace previews.
- Require two request headers on proxy traffic:
  - `X-CS-Proxy-Target`
  - `X-CS-Proxy-Grant`
- Bind every grant to exactly one normalized target origin.
- Run the proxy on a dedicated origin, not on the main Coder Studio UI origin.
- Require both normal Coder Studio browser auth and a valid proxy grant.
- Return the raw grant token only at create time and rotate time.
- Add a lightweight `Proxy Access` management panel in the Coder Studio UI.
- Support WebSocket tunneling on the dedicated proxy origin.

## Non-Goals

- Do not proxy through the main UI origin such as `http://localhost:4444/...`.
- Do not support unauthenticated or open-proxy behavior.
- Do not add plugin-specific browser extension installation flows in v1.
- Do not rewrite arbitrary HTML or JavaScript response bodies to fix hard-coded
  absolute upstream URLs.
- Do not support non-HTTP targets such as `file:`, unix sockets, or raw TCP.
- Do not add per-grant insecure TLS bypass toggles in v1.

## Why a Dedicated Origin Is Required

If proxied content is served from the same origin as Coder Studio itself, the
proxied page becomes same-origin with Coder Studio APIs, websocket transport, and
cookie-backed session state. That breaks the application's security boundary.

The proxy must therefore live on a separate origin, for example:

- main UI: `http://localhost:4444`
- proxy: `http://localhost:4445`

The safest v1 shape is the same hostname plus a different port. Same host plus
different port is a different browser origin and still allows the browser to send
the existing host-scoped auth cookie to both listeners.

Using a different hostname is a possible future option, but it is out of scope for
v1 unless the auth cookie model is extended to support an explicit shared cookie
domain. The current browser auth model should be assumed to be host-scoped.

## Existing Context

Coder Studio already has:

- cookie-backed browser auth enforced by a global Fastify auth guard
- a built-in dev browser proxy path family under `/dev-browser/`
- existing route reservations for `/api`, `/auth`, `/internal`, `/assets`, and
  `/dev-browser`

Those existing dev-browser routes are not the right foundation here. They were
designed for iframe-hosted preview behavior, not for a first-class external browser
entry protected by extension-injected headers.

## User Flow

1. The user signs in to Coder Studio on the main UI origin.
2. The user opens `Settings > Proxy Access`.
3. The user creates a grant by entering:
   - a label
   - a target origin such as `http://10.20.0.15:8080` or `https://git.corp.local`
   - whether WebSocket proxying is allowed
   - a TTL preset such as `1 hour`, `24 hours`, or `7 days`
4. The server validates the target against proxy target policy and creates the
   grant.
5. The UI shows a one-time setup modal containing:
   - the dedicated proxy origin
   - the exact `X-CS-Proxy-Target` header value
   - the exact `X-CS-Proxy-Grant` token
   - example browser-extension match rules for both HTTP and WebSocket traffic
6. The user configures a browser extension to inject those headers for the proxy
   origin.
7. The user opens the proxy origin in a normal browser tab, for example
   `http://localhost:4445/`.
8. Requests reaching the proxy origin include the extension headers, so the server
   authenticates and forwards them to the bound upstream target.
9. The `Proxy Access` panel later lets the user inspect, extend, rotate, or revoke
   grants.

## Interaction Design

## Panel Placement

Add a lightweight `Proxy Access` panel under Settings. This is a global account or
server-session feature, not a workspace tab feature.

The panel has two areas:

- `Create Grant`
- `Active and Recent Grants`

## Create Grant Form

Fields:

- `Label`
- `Target Origin`
- `Allow WebSocket`
- `TTL`

Validation:

- require an absolute `http://` or `https://` origin
- normalize host casing, default ports, and trailing slash
- reject paths, hashes, usernames, and passwords in the target field
- reject targets outside configured allow policy

## Post-Create Modal

After create and after rotate, the UI opens a modal with:

- `Proxy Origin`
- `Header 1: X-CS-Proxy-Target`
- `Header 2: X-CS-Proxy-Grant`
- copy buttons for each value
- copyable extension match patterns for:
  - `http://<proxy-host>:<proxy-port>/*`
  - `https://<proxy-host>:<proxy-port>/*`
  - `ws://<proxy-host>:<proxy-port>/*`
  - `wss://<proxy-host>:<proxy-port>/*`

The modal must explicitly say that the raw grant token is shown only once. If the
user loses it, the recovery path is `Rotate`, not `Reveal`.

## Grant List

Each row shows:

- label
- target origin
- websocket enabled state
- created at
- expires at
- last used at
- status: `active`, `expired`, or `revoked`

Row actions:

- `Extend`
- `Rotate`
- `Revoke`

`Extend` keeps the existing token and lengthens validity.  
`Rotate` returns a new raw token and invalidates the old token immediately.  
`Revoke` permanently disables the grant and clears proxy session state tied to it.

## Architecture

The feature has three layers:

1. Main UI app on the existing Coder Studio origin
2. Dedicated proxy app on a separate origin
3. Shared grant and cookie-jar state inside the same server process

The main UI app handles grant management APIs and panel rendering.

The dedicated proxy app handles:

- authenticated HTTP proxying
- authenticated WebSocket upgrades
- upstream cookie-jar management
- top-level proxy error pages

The server process starts both listeners together and stops them together.

## Server Configuration

Extend server config with a proxy section similar to:

```ts
proxy: {
  enabled: boolean;
  host: string;
  port: number;
  publicOrigin?: string;
  maxGrantTtlMs: number;
  allowedHosts: string[];
  allowedCidrs: string[];
  allowLoopback: boolean;
}
```

Defaults:

- proxy disabled unless explicitly enabled
- proxy host defaults to main server host
- proxy port defaults to `mainPort + 1`
- loopback allowed when proxy is enabled
- non-loopback intranet targets require explicit allow policy

`publicOrigin` is needed when Coder Studio sits behind a reverse proxy and the
externally visible proxy URL differs from the internal listener address.

For v1, `publicOrigin` should preserve the same hostname as the main UI origin and
only vary by port or outer reverse-proxy port mapping, so existing browser auth
cookies continue to apply.

## Grant Model

Persist grants in a new server-side repository, for example `proxy-grants.json`.

```ts
type ProxyGrantRecord = {
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
};
```

Rules:

- store only a hash of the token, never the raw token
- token must be high entropy and unguessable
- one grant maps to one exact target origin
- a revoked grant never becomes active again
- an expired grant may be extended or rotated
- rotate clears the previous token and generates a new token

## Target Policy

Proxying internal services is SSRF-sensitive. Target validation must happen both at
grant creation time and at connection time.

Rules:

- allow only `http` and `https`
- require an explicit origin, not an arbitrary URL with path
- deny `file:`, `ftp:`, `ws:`, `wss:`, unix sockets, and raw hostless forms
- deny targets that fall outside configured host and CIDR policy
- re-resolve hostname targets on each new upstream connection and re-check the
  resolved IPs against policy to avoid DNS rebinding

Recommended default:

- allow loopback
- deny all non-loopback private network targets unless the admin explicitly
  configured allow rules

## Cookie and Session Handling

The proxy must not blindly expose upstream cookies to the browser because all proxy
targets would otherwise share one browser cookie namespace on the proxy origin.

Instead, the server keeps a per-grant upstream cookie jar in memory:

- inbound browser `Cookie` headers are not forwarded upstream except for cookies the
  proxy itself owns
- upstream `Set-Cookie` headers are captured into the per-grant jar
- later HTTP requests and WebSocket handshakes for the same grant replay those
  upstream cookies
- revoking, rotating, or expiring a grant clears its cookie jar
- proxy cookie jars do not need to survive server restart in v1

This preserves most cookie-based upstream sessions without leaking one target's
cookies into another target's requests.

## Authentication Model

Every proxy request must pass two checks:

1. existing browser auth cookie validation
2. proxy grant validation

The proxy app reuses the same auth-session repository as the main UI app, so a user
must still be logged in through the normal Coder Studio auth flow.

Then the proxy app validates:

- `X-CS-Proxy-Grant` exists
- `X-CS-Proxy-Target` exists
- the token hash matches a live, unrevoked grant
- the header target exactly matches the grant's normalized `targetOrigin`
- the target still satisfies current target policy

This keeps grant leakage from becoming a complete bypass when the user is no longer
authenticated in the browser.

## Main UI APIs

Add management endpoints on the main UI origin:

- `GET /api/proxy/config`
- `POST /api/proxy/grants`
- `GET /api/proxy/grants`
- `POST /api/proxy/grants/:id/extend`
- `POST /api/proxy/grants/:id/rotate`
- `DELETE /api/proxy/grants/:id`

Create response shape:

```json
{
  "id": "pgr_123",
  "label": "grafana staging",
  "targetOrigin": "http://10.20.0.15:8080",
  "allowWebSocket": true,
  "expiresAt": 1780000000000,
  "proxyOrigin": "http://localhost:4445",
  "grantToken": "pgt_..."
}
```

`grantToken` is returned only by `create` and `rotate`.

List responses must omit the raw token.

## Dedicated Proxy Routing

The dedicated proxy origin proxies requests from `/` downward:

- `GET /`
- `GET /assets/app.js`
- `POST /api/login`
- `WS /ws`

All of those use the bound target origin from the headers and grant lookup.

A request like:

```text
GET http://localhost:4445/app?tab=1
X-CS-Proxy-Target: http://10.20.0.15:8080
X-CS-Proxy-Grant: pgt_...
```

becomes:

```text
GET http://10.20.0.15:8080/app?tab=1
```

This root-level proxy model preserves compatibility with applications that use
absolute root paths such as `/assets/main.js` or `/ws`.

## HTTP Forwarding Rules

For each proxied HTTP request:

1. validate auth cookie and grant headers
2. build upstream URL from:
   - grant target origin
   - incoming pathname
   - incoming query string
3. stream the request body upstream
4. strip proxy-only and hop-by-hop headers
5. rewrite request metadata where needed:
   - `Host` becomes upstream host
   - `Origin` becomes upstream origin when present
   - `Referer` is rewritten when it points at the proxy origin
6. attach cookies from the server-side cookie jar
7. stream the upstream response back to the browser
8. capture upstream `Set-Cookie` into the jar instead of forwarding it directly
9. rewrite redirect `Location` headers that point at the target origin so the
   browser stays on the proxy origin

Response body rewriting is out of scope in v1. Applications that hard-code absolute
upstream URLs inside HTML or JavaScript may still fail.

## WebSocket Forwarding Rules

For each WebSocket upgrade:

1. validate auth cookie and grant headers
2. verify the grant allows WebSocket traffic
3. convert target protocol:
   - `http` -> `ws`
   - `https` -> `wss`
4. preserve incoming pathname and query string
5. open one upstream WebSocket connection for one browser WebSocket connection
6. rewrite `Origin` to the upstream origin
7. attach cookies from the server-side cookie jar
8. tunnel frames transparently in both directions
9. propagate close codes and errors

No multiplexing, message inspection, or protocol-aware rewriting is needed.

## Error Handling

Expected error codes:

- `400 proxy_headers_required`
- `400 invalid_proxy_target`
- `401 auth_required`
- `403 proxy_grant_invalid`
- `403 proxy_grant_expired`
- `403 proxy_grant_revoked`
- `403 proxy_target_not_allowed`
- `403 proxy_websocket_not_allowed`
- `409 proxy_target_mismatch`
- `502 upstream_unreachable`
- `504 upstream_timeout`

For top-level HTML navigations on the proxy origin, return a simple HTML error page
with:

- a short human-readable message
- the failing target
- a link back to the main Coder Studio UI

For subresources, XHR, and WebSocket failures, return protocol-appropriate status
codes only.

## Limitations

The v1 proxy is intended for applications that primarily use:

- relative asset URLs
- same-origin API calls
- same-origin WebSocket URLs

Applications that hard-code absolute URLs to their original upstream origin may
bypass the proxy model and fail in the browser. That limitation should be called out
in the panel help text and user-facing docs.

Simultaneous multi-target browsing from one browser profile is also intentionally
simple in v1. Because the browser extension injects one header rule set per proxy
origin, users will typically enable one grant configuration at a time unless their
extension supports multiple toggled profiles.

## Testing

Add coverage for:

- grant create, list, extend, rotate, revoke lifecycle
- raw token returned only on create and rotate
- token hash persistence and invalid token rejection
- target normalization and policy enforcement
- DNS rebinding protection checks
- proxy app auth cookie plus grant enforcement
- HTTP forwarding, redirect rewrite, and cookie-jar capture
- WebSocket upgrade success, close propagation, and websocket-disabled rejection
- panel create flow, one-time token modal, and grant row actions

## Risks

- If target allow policy is too broad, the proxy becomes an internal SSRF tool.
- If cookie handling is too permissive, one upstream service can leak state into
  another target's requests.
- If the proxy origin accidentally collapses back onto the main UI origin, the
  design becomes unsafe even if grant validation is correct.
- If grant rotation does not invalidate the old token immediately, leaked tokens
  remain useful longer than expected.
