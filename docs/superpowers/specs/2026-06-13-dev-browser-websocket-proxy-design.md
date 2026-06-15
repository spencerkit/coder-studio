# Dev Browser WebSocket Proxy Design

> Status: Draft for user review
> Date: 2026-06-13
> Scope: `packages/server` dev-browser proxy routes and websocket tunneling, `packages/web` dev-browser bootstrap rewrite logic, related tests

## Goal

Add transparent WebSocket proxying to the existing dev-browser loopback proxy so a
proxied Coder Studio page can establish its own runtime WebSocket connections when
opened through the built-in browser.

The design stays intentionally narrow: one dev-browser session continues to bind to
one validated loopback `targetOrigin`, and only WebSocket connections that resolve
to that origin are rewritten and proxied.

## Current Problem

The HTTP fallback proxy path now allows proxied pages to load even when the
service-worker path is unavailable. HTML, CSS, JavaScript, images, form posts, and
same-origin fetch/XHR requests can already flow through:

```text
/dev-browser/session/:id/proxy/*
```

However, WebSocket upgrade requests to that same route are still rejected with:

```json
{ "error": "websocket_not_supported" }
```

That leaves proxied Coder Studio pages in a partially working state: the UI can
render, but the app's `/ws` connection fails and live runtime behavior does not
recover.

## User-Approved Scope

The user approved these constraints for this iteration:

1. Proxy only WebSocket traffic for the current session's single `targetOrigin`.
2. Do transparent frame forwarding only. No message rewriting or protocol-aware
   handling.
3. Keep each WebSocket independent:
   - one browser WebSocket becomes one proxy WebSocket
   - one proxy WebSocket becomes one upstream WebSocket
4. Keep Coder Studio's existing application WebSocket at `/ws` separate from the
   dev-browser proxy path.
5. Keep the current warning behavior, but only show the warning when the proxied
   WebSocket connection actually fails.

## In Scope

- front-end WebSocket URL rewriting for the current dev-browser session target
- server-side WebSocket upgrade handling on the existing dev-browser proxy route
- transparent text-frame and binary-frame tunneling between browser and upstream
- close and error propagation between proxied peer connections
- focused tests for successful proxying and failure behavior

## Out Of Scope

- multi-origin or multi-port allowlists inside one dev-browser session
- WebSocket message inspection or protocol translation
- sharing or multiplexing multiple browser sockets onto one upstream socket
- replacing Coder Studio's native `/ws` application transport
- generalized external-host WebSocket proxying

## Existing Context

The current dev-browser session model already stores:

- a validated loopback `targetOrigin`
- the target path and hash for browser navigation
- a proxy base rooted at `/dev-browser/session/:id/proxy`

The fallback HTML bootstrap in `packages/server/src/routes/dev-browser.ts` already
rewrites resource access for:

- `fetch`
- `XMLHttpRequest`
- `EventSource`
- `window.open`
- HTML attributes, CSS `url(...)`, and ESM specifiers in proxied responses

The same bootstrap currently wraps `window.WebSocket`, but only to observe failed
loopback connections and show a warning banner. It does not rewrite those WebSocket
URLs to the dev-browser proxy path.

Coder Studio's own frontend runtime resolves its application socket as:

```text
ws(s)://<current-host>/ws
```

or, in dev mode, reaches the same path through the Vite dev server's own `/ws`
proxy. That means a proxied Coder Studio page fits the single-`targetOrigin`
design: the page host and the page's WebSocket entry stay under the same browser
origin contract.

## Design

## 1. Preserve the Existing Route Family

The feature should reuse the current dev-browser proxy URL family instead of
introducing a second WebSocket-specific namespace.

HTTP and WebSocket traffic both remain conceptually rooted at:

```text
/dev-browser/session/:id/proxy/*
```

Examples:

```text
GET  /dev-browser/session/dev_1/proxy/app/
WS   /dev-browser/session/dev_1/proxy/ws
WS   /dev-browser/session/dev_1/proxy/socket.io/?EIO=4&transport=websocket
```

This keeps session lookup, target resolution, and access boundaries aligned across
protocols.

## 2. Rewrite Only WebSockets That Match the Session Target

The browser bootstrap should change from "observe loopback WebSocket failure" to
"rewrite matching target WebSockets to the proxy route, then observe the actual
connection result."

Rewrite rules:

- if the constructed WebSocket URL resolves to the current session `targetOrigin`,
  rewrite it to the session proxy path on the Coder Studio host
- preserve pathname, search, and hash components
- preserve the browser page's current `ws:` vs `wss:` scheme based on the outer
  page origin
- leave non-matching WebSocket URLs unchanged

Given:

```text
session.targetOrigin = http://127.0.0.1:5173
```

Examples:

```text
ws://127.0.0.1:5173/ws
  -> ws://studio.example/dev-browser/session/dev_1/proxy/ws

ws://127.0.0.1:5173/socket.io/?EIO=4&transport=websocket
  -> ws://studio.example/dev-browser/session/dev_1/proxy/socket.io/?EIO=4&transport=websocket

ws://127.0.0.1:4173/ws
  -> unchanged
```

The warning banner remains, but it should attach to the rewritten proxy-backed
socket result instead of warning preemptively for every loopback-looking socket.

## 3. Add Transparent WebSocket Tunneling on the Server

The server should accept WebSocket upgrades on the dev-browser proxy path and map
them to an upstream WebSocket URL derived from the same session target resolution
used by HTTP proxy requests.

Processing flow:

1. receive browser upgrade at `/dev-browser/session/:id/proxy/*`
2. load the dev-browser session by `id`
3. resolve the requested proxy path and query string against the session target
4. convert target protocol:
   - `http:` -> `ws:`
   - `https:` -> `wss:`
5. establish a new upstream WebSocket client connection to that resolved URL
6. once both sides are open, transparently forward frames in both directions
7. propagate close and error conditions and clean up both peers

This is a pure tunnel. The proxy must not parse, mutate, or reinterpret frame
payloads.

## 4. Keep Connection Independence

No connection reuse or multiplexing should be introduced.

The connection model is:

```text
1 browser WebSocket
  -> 1 dev-browser proxy connection
  -> 1 upstream WebSocket
```

Implications:

- multiple `new WebSocket(...)` calls inside one proxied page create multiple
  independent tunnels
- multiple browser tabs or multiple dev-browser sessions create separate WebSocket
  sets
- refresh, close, or failure in one page affects only that page's own sockets

This keeps the proxy behavior close to normal browser semantics and avoids coupling
unrelated runtime streams.

## 5. Preserve Failure Transparency

The dev-browser proxy should not fake successful WebSocket connections when the
upstream target is unavailable.

Expected behavior:

- HTML and HTTP resources remain independently loadable
- if the proxy can connect upstream, no warning is shown
- if the proxy cannot connect upstream, the browser-side socket fails normally and
  the existing warning banner is shown
- if the upstream closes, the browser receives the corresponding close event
- if the browser closes, the proxy closes the upstream connection

The warning remains user-facing diagnostics only. It does not change protocol
semantics or suppress close/error delivery.

## 6. Keep Coder Studio Application Transport Separate

Coder Studio's own application WebSocket at `/ws` remains untouched.

The dev-browser proxy must not attempt to route proxied-page traffic through the
main application socket, because:

- protocol payloads are unrelated
- the main socket carries authenticated command and event traffic
- transparent proxying requires one upstream socket per browser socket

The feature therefore adds a separate WebSocket tunnel path under the dev-browser
session route family, even though both route families live on the same Fastify
server instance.

## 7. Error Boundaries and Rejection Cases

The server should reject or fail fast for these cases:

- missing or expired dev-browser session
- proxy path that cannot be resolved against the current session target
- upstream connection refusal or network failure

For the single-origin scope, the browser-side rewrite logic should avoid generating
proxy URLs for WebSockets outside the current session target. Those sockets stay on
their original URL and are not promoted to proxy traffic.

## Package Boundaries

### `packages/server`

- extend `registerDevBrowserRoutes` and supporting helpers to handle WebSocket
  upgrades on the existing proxy route family
- reuse current session lookup and target URL resolution rules
- add websocket-tunnel cleanup and upstream error handling
- update route tests to cover WebSocket success and failure paths

### `packages/web`

- update the dev-browser fallback bootstrap so `window.WebSocket` rewrites only
  URLs matching the current session target
- keep the warning banner behavior but tie it to actual proxy-backed socket failure
- add focused tests for URL rewriting and warning behavior expectations

## Testing Strategy

Add test coverage in the smallest layers that prove the tunnel behavior.

### Server

Use real WebSocket integration tests for the dev-browser route instead of only
`app.inject`, because upgrade handling and bidirectional frame flow need live socket
behavior.

Cover at least:

1. a proxied WebSocket can upgrade through the dev-browser route
2. text frames flow browser -> upstream and upstream -> browser
3. binary frames flow browser -> upstream and upstream -> browser
4. missing sessions are rejected
5. upstream connection failure causes the proxied socket to fail rather than hang
6. close propagation works in both directions

### Web

Keep a focused bootstrap-level test that proves:

1. a WebSocket URL matching the current session target is rewritten to the
   session's proxy path
2. a non-matching WebSocket URL is left alone
3. the warning hook still exists for failed proxy-backed connections

## Acceptance Criteria

- a proxied Coder Studio page can establish its `/ws` connection through the
  dev-browser proxy
- WebSocket traffic uses the dev-browser session proxy route, not the main
  application `/ws` socket
- each browser WebSocket is tunneled through an independent upstream WebSocket
- text and binary frames are forwarded without payload rewriting
- WebSocket failure no longer blocks page load, but failed connections still
  surface the warning banner
- non-target WebSocket URLs are not silently widened into arbitrary local proxying
