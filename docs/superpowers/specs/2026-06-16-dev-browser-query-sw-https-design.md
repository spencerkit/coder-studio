# Dev Browser Query + SW + HTTPS Design

> Status: Draft for user review
> Date: 2026-06-16
> Scope: `packages/web` dev-browser UI and service worker, `packages/server` dev-browser routes and startup TLS support, related tests and docs

## Goal

Redesign the built-in browser so it can preview a local development server while
preserving the browser-visible pathname of the target page.

The design keeps the original `path` visible to the app and to SPA routers, while
still routing requests through Coder Studio for loopback fetches. The design does
not attempt to make the browser report the target's real `host` or `origin`.

## User Problem

The current dev browser uses a path-based proxy URL such as
`/dev-browser/session/:id/proxy/...`. That creates two classes of failures:

1. iframe navigations that redirect to a different path can land on the wrong
   route because the proxy prefix leaks into the browser-visible URL
2. SPA apps receive the proxy path instead of their real route, so they render the
   wrong page or compute the wrong client-side route state

## Design Summary

The v1 redesign uses four pieces:

1. A browser-visible URL that keeps the original pathname, plus a hidden session
   token in query string form for the first load
2. A root-scope service worker that binds a browser client to a dev-browser
   session and routes later requests for that client
3. A hidden server-side proxy base that the service worker forwards to
4. Automatic HTTPS bootstrap for non-loopback IP access, backed by generated local
   certificates when needed

## In Scope

- browser-visible URLs that preserve the target pathname
- hidden session propagation through query parameters on the first load
- a root-scope service worker that routes requests by client/session binding
- server-side proxy routes that remain hidden from browser-visible navigation
- automatic HTTPS for non-loopback IP access
- automatic local certificate generation for development
- clear fallback when the browser refuses the certificate
- session cleanup and expiry
- tests for routing, query handling, secure-context handling, and HTTPS fallback

## Out Of Scope

- preserving the target's true `host` or `origin`
- browser automation or remote desktop rendering
- WebSocket proxying in v1
- HMR support in v1
- user-managed certificate configuration in v1
- changing file preview behavior

## Existing State

The current implementation lives in:

- `packages/server/src/routes/dev-browser.ts`
- `packages/web/public/dev-browser-sw.js`
- `packages/web/src/features/dev-browser/dev-browser-surface.tsx`

Today the iframe navigates through `/dev-browser/session/:id/proxy/...`, and the
service worker is scoped only to `/dev-browser/`. That arrangement exposes the
proxy path to the page and makes SPA route handling brittle.

The server startup path currently has no TLS configuration. HTTPS support for
non-loopback IP access must therefore be added as a new startup capability.

## UX Flow

1. The user opens the built-in browser tab.
2. The user enters a loopback URL.
3. The client creates a dev-browser session on the server.
4. The iframe loads the target pathname with a hidden session query token.
5. A root-scope service worker claims the page and binds that client to the session.
6. Subsequent navigations and resource requests are routed to the hidden proxy base.
7. The first document removes the session query from the visible URL after binding.

## URL Model

Given a target such as:

```text
http://localhost:8000/app/
```

The browser-visible URL should be the original path, not the proxy path. A first
load can use a query token, for example:

```text
/app/?__cs_sid=dev_abc
```

The hidden proxy base remains server-internal:

```text
/dev-browser/session/dev_abc/proxy
```

The service worker uses the session binding to map requests like:

```text
GET /app/?__cs_sid=dev_abc
GET /assets/main.js
GET /api/data
```

to the hidden proxy base and then to the real loopback target.

## Service Worker Model

The service worker should be registered at a root scope when the current browser
context supports it.

The worker responsibilities are:

- parse the session token from the initial request when present
- bind `clientId` to `sessionId`
- route same-client navigations and subresource requests to the hidden proxy base
- preserve browser-visible `pathname`, `search`, and `hash` semantics
- avoid rewriting the page into a proxy-prefixed path
- only intercept loopback requests such as `localhost`, `127.0.0.1`, and `::1`
- pass through non-loopback requests unchanged so the iframe can render them
  normally

The worker should not try to emulate a full browser. It should route requests at
fetch time and only perform a small bootstrap-level URL cleanup in the first
document.

## Server API

Session creation:

```text
POST /api/dev-proxy/session
body: { "url": "http://localhost:8000" }
response:
{
  "id": "dev_abc",
  "browserUrl": "/app/?__cs_sid=dev_abc",
  "browserProxyBase": "/dev-browser/session/dev_abc/proxy",
  "targetOrigin": "http://127.0.0.1:8000"
}
```

Session lookup and deletion remain authenticated API routes.

Proxy requests remain on the hidden server path:

```text
ANY /dev-browser/session/:id/proxy/*
```

The public browser should not rely on that proxy path for normal navigation.

## Target Validation

Allowed preview targets:

- `http://localhost:<port>`
- `http://127.0.0.1:<port>`
- `http://[::1]:<port>`

Rejected targets:

- non-HTTP/HTTPS protocols
- loopback-free HTTP hosts
- loopback-free HTTPS hosts
- credentials in the URL
- missing or invalid ports

The server should canonicalize loopback connection targets for upstream access, but
the browser-visible pathname must remain the original pathname.

## HTTPS Strategy

The dev browser needs a secure context when the browser is not already on HTTPS or
loopback.

Rules:

- if the Coder Studio UI is already on HTTPS, enable the new service worker flow
- if the UI is on `localhost`, `127.0.0.1`, `::1`, or `*.localhost`, enable the
  new flow without additional certificates
- if the UI is accessed through a non-loopback IP over HTTP, the server should
  automatically switch to HTTPS
- if HTTPS is required, the server should auto-generate local certificates on
  startup or first use
- if the certificate is not trusted by the browser, show a clear warning and allow
  the user to continue manually or fall back to the legacy proxy path

The first version should use automatic certificate generation only. User-managed
certificate inputs are out of scope.

## Certificate Handling

The certificate mechanism should be development-friendly rather than production
grade.

Recommended behavior:

- generate and reuse a local CA under the Coder Studio state directory
- issue a leaf certificate for the current server host or IP
- include SAN entries for the current access host and common loopback names where
  practical
- prefer HTTPS when the server is started on a non-loopback IP

The design does not require perfect automatic trust installation. When trust is
missing, the browser may present its normal TLS warning and the UI should explain
what to do.

## Browser Bootstrap

The first document loaded by the iframe should:

- read the hidden session token from query parameters
- register or update the root-scope service worker when available
- bind the client to the active dev-browser session
- call `history.replaceState` to remove the session query from the visible URL
- avoid broad `fetch`, `XMLHttpRequest`, or `WebSocket` monkey-patching unless a
  test proves the worker cannot cover a required case

## Hidden Proxy

The server-side proxy continues to own actual loopback fetching.

Responsibilities:

- forward HTTP methods and request bodies to the target origin
- filter hop-by-hop and sensitive headers
- rewrite redirect locations only into browser-visible paths, not proxy paths
- preserve response types for HTML, CSS, JavaScript, images, JSON, and other
  ordinary assets

WebSocket proxying remains out of scope for v1.

## Error Handling

The browser should show explicit states for:

- invalid URL input
- unsupported non-loopback HTTP URL
- HTTPS required for IP access
- TLS trust failure
- expired or missing session token
- service worker unsupported in this browser context

When the certificate is blocked, the UI should present a direct explanation and a
manual proceed option before falling back.

Requests that do not match the local loopback interception rules should not be
treated as dev-browser errors.

## Security

This remains a local proxy feature, not a general proxy.

Required protections:

- inherit existing Coder Studio authentication
- require a valid dev-browser session for all proxy traffic
- validate upstream targets server-side
- keep proxy routes hidden from normal browser navigation
- expire sessions after inactivity
- delete sessions when the browser tab closes when possible
- do not expose the hidden proxy base as the browser-visible route model

## Testing

Server tests:

- accept loopback HTTP URLs
- accept HTTPS URLs for secure-context flows
- reject unsupported HTTP IP access until HTTPS is available
- create browser URLs that preserve the target path and carry a hidden session token
- proxy requests from the hidden base to the loopback target
- rewrite redirects to browser-visible paths
- generate or select TLS material for non-loopback IP access

Web tests:

- browser tab opens with a visible path, not a proxy path
- initial session query is removed after binding
- root-scope service worker receives the session binding
- SPA-style navigation keeps the visible pathname correct
- certificate-blocked states surface the expected UI

## Risks

- Root-scope service worker behavior differs across browsers and security contexts.
- Certificate generation and trust behavior varies by platform.
- Session binding must survive reloads and navigation without leaking into the
  visible route.
- The legacy proxy path should remain as a fallback until the new flow is stable.

## Rollout Plan

1. Add the new query-based URL model behind the dev browser entry path.
2. Add root-scope service worker routing and session binding.
3. Add HTTPS startup support for non-loopback IP access.
4. Keep the legacy proxy flow as fallback until the new flow is verified.
5. Remove or de-emphasize the old proxy-prefixed browser-visible path once the new
   flow is stable.

## Implementation Notes

This work should stay focused on the built-in browser feature.

Recommended file boundaries:

- session and URL model in `packages/server/src/routes/dev-browser.ts`
- service worker routing in `packages/web/public/dev-browser-sw.js`
- browser tab UI and bootstrap handling in
  `packages/web/src/features/dev-browser/dev-browser-surface.tsx`
- TLS bootstrap in the server startup path
- tests next to the touched modules
