# Dev Browser Loopback Proxy Design

> Status: Draft for user review
> Date: 2026-06-11
> Scope: `packages/web` built-in browser UI and service worker, `packages/server` HTTP proxy routes, related tests and help docs

## Goal

Add a Coder Studio built-in browser path that can open a locally running development
server, such as `http://localhost:8000`, even when the user is connected to Coder
Studio from another device or an external URL.

The built-in browser must make local validation possible without exposing the target
development server directly to the network. Coder Studio server remains the only
externally reachable process. It fetches loopback resources on behalf of the browser
and returns them through authenticated Coder Studio routes.

## User Flow

The v1 entry is an editor-header browser action plus manual URL input inside the
browser tab:

1. The user starts a local development server in a Coder Studio terminal.
2. The user clicks a `Browser` action in the editor header.
3. Coder Studio opens or activates a browser editor tab.
4. The browser tab shows a URL input when no target is active. The user enters a
   loopback URL such as `http://localhost:8000` or `http://127.0.0.1:5173`.
5. The web client asks Coder Studio server to create a short-lived dev browser
   session for that target.
6. The browser tab iframe loads the proxied page under the `/dev-browser/`
   route scope.
7. A service worker scoped to the dev browser rewrites resource requests to the
   matching server proxy session.

Future terminal-output detection can add an `Open in Browser` shortcut, but v1 does
not depend on framework-specific terminal output parsing.

## In Scope

- manual loopback URL input in the built-in browser
- an editor-header action that opens or activates a browser editor tab
- a browser editor tab that is separate from file editor tabs
- authenticated HTTP proxy sessions for loopback targets
- service-worker-based request routing for proxied pages loaded under the dev
  browser scope
- support for ordinary HTML, CSS, JavaScript, images, fonts, source maps, and
  normal `fetch` or `XMLHttpRequest` calls
- clear unsupported-state handling for WebSocket and HMR URLs
- tests for URL validation, proxy routing, service worker routing decisions, and
  core UI flow
- documentation of v1 capabilities and limitations

## Out Of Scope

- WebSocket proxying
- Vite, Next, or framework HMR support
- arbitrary external URL proxying
- automatic terminal-output URL detection
- wildcard-host or subdomain-based proxying
- browser automation or remote debugging
- replacing the existing file-backed Markdown and HTML document preview
- a desktop Activity Bar or mobile Dock browser entry as the primary v1 entry

## Existing Context

Coder Studio already has `/api/preview/session` for Markdown and HTML file previews.
That route serves editor document content and local workspace assets. It is not a
running-server proxy and should remain separate.

The server also has a global Fastify `onRequest` auth guard. New dev proxy routes
should inherit this guard, then add their own target validation and session checks.

The existing document preview iframe uses a restrictive sandbox that is appropriate
for file previews. A running app browser needs a separate component and sandbox
policy, because service workers and many development apps require same-origin
browser behavior.

The proxied app document must itself load under the service worker scope. If the
iframe loads `/api/dev-proxy/...` directly while the service worker is scoped to
`/dev-browser/`, the service worker cannot reliably control that document. The v1
route model therefore serves app documents and resources under `/dev-browser/...`
and reserves `/api/dev-proxy/...` for session management APIs if needed.

## UI Placement

The browser lives inside the editor surface, not as an Activity Bar workspace view.

Desktop behavior:

- The editor header tabbar has a compact `Browser` action near the existing tabbar
  actions.
- Clicking the action opens a browser editor tab or focuses the existing browser
  tab for the workspace.
- The browser tab title is `Browser` before a session is active, then reflects the
  target when practical, such as `Browser :8000` or `localhost:8000`.
- The URL input appears only inside the browser tab's own toolbar or empty state.
  It should not be a persistent global editor-header input because it applies only
  to browser tabs.
- File tabs keep the existing path breadcrumb, dirty state, and edit, preview, diff,
  pin, and close controls.
- Browser tabs show browser-specific controls such as address input, open, refresh,
  and close. They do not show file mode controls.

Mobile behavior:

- The mobile files/editor sheet should expose the same editor-header browser action
  where space permits, or a compact equivalent in the editor header actions.
- Opening the browser action shows the browser tab content in the editor sheet
  rather than a separate Dock browser sheet.

The Activity Bar should not include a Browser item in this design. If a future
version needs terminal-output detection, that shortcut should open the same browser
editor tab instead of introducing a second browser surface.

## Editor Tab Model

The browser tab should be modeled as a first-class non-file editor tab, not as a
fake path in `openEditorPaths`.

The current editor state is file-centric:

- `openEditorPaths` stores file paths.
- `activeFilePath` drives file loading and mode selection.
- search, open editors, file tree selection, persistence, and document previews all
  assume paths refer to workspace files.

Using a virtual path such as `__browser__/localhost:8000` would leak into those file
flows and create brittle exceptions. The design should introduce a small typed tab
layer, for example:

```ts
type WorkspaceEditorTab =
  | { kind: "file"; path: string }
  | { kind: "browser"; id: "dev-browser"; targetUrl?: string; sessionId?: string };
```

The implementation can keep existing file atoms as the file-buffer source of truth,
but the rendered editor tabs and active editor target should understand both file
and browser tabs. File-only consumers should continue receiving file paths only.

## Architecture

The feature has three parts:

- Web UI: a browser editor tab, opened from the editor header, that accepts a
  loopback URL and hosts the proxied page in an iframe.
- Service worker: a dev-browser-scoped routing shim that maps page resource requests
  to the correct server proxy base.
- Server proxy: a short-lived session store plus authenticated HTTP proxy routes that
  fetch resources from the loopback target.

The key rule is that the browser never needs to reach `localhost:8000` directly.
Every external browser request is sent to Coder Studio first, and Coder Studio server
performs the local loopback request.

## URL Model

Given a target of:

```text
http://localhost:8000/app/
```

Server creates a session like:

```text
sessionId = dev_abc
targetOrigin = http://127.0.0.1:8000
targetBasePath = /app/
browserBase = /dev-browser/session/dev_abc/
browserProxyBase = /dev-browser/session/dev_abc/proxy
```

The iframe first loads a dev browser shell under `browserBase`. That shell registers
the service worker and then navigates to the app document under `browserProxyBase`.
Because both the shell and the app document live under `/dev-browser/`, the service
worker can control the app document and its later resource requests.

Request examples:

```text
GET /dev-browser/session/dev_abc/proxy/app/
  -> http://127.0.0.1:8000/app/

GET /dev-browser/session/dev_abc/proxy/assets/main.js
  -> http://127.0.0.1:8000/assets/main.js

GET /dev-browser/session/dev_abc/proxy/api/data
  -> http://127.0.0.1:8000/api/data
```

## Server API

Create session:

```text
POST /api/dev-proxy/session
body: { "url": "http://localhost:8000" }
response: {
  "id": "dev_abc",
  "browserUrl": "/dev-browser/session/dev_abc/",
  "browserProxyBase": "/dev-browser/session/dev_abc/proxy",
  "targetOrigin": "http://127.0.0.1:8000"
}
```

Read session metadata:

```text
GET /api/dev-proxy/session/:id
```

Proxy request:

```text
ANY /dev-browser/session/:id/proxy/*
```

Delete session:

```text
DELETE /api/dev-proxy/session/:id
```

The proxy request route should forward common HTTP methods. Request and response
headers must be filtered rather than blindly copied. Hop-by-hop headers, websocket
upgrade headers, and host-specific headers should not be forwarded unchanged.

## Target Validation

Allowed targets:

- `http://localhost:<port>`
- `http://127.0.0.1:<port>`
- `http://[::1]:<port>`

Rejected targets:

- non-HTTP protocols
- external hosts
- private LAN hosts such as `192.168.x.x`
- public hosts
- missing or invalid ports
- credentials in the URL

The server should canonicalize `localhost` and `::1` to loopback connection targets
and preserve the original path, search, and hash for browser navigation semantics.

## Service Worker Routing

The service worker is scoped under `/dev-browser/` so it does not affect the main
Coder Studio application.

The dev browser shell sends active session metadata to the service worker:

- session id
- target origin
- browser proxy base
- initial target pathname

The service worker handles normal HTTP(S) fetch events. It rewrites:

- requests to `http://localhost:<port>/*`
- requests to `http://127.0.0.1:<port>/*`
- requests to `http://[::1]:<port>/*`
- same-origin root paths such as `/assets/*` and `/api/*` when they belong to the
  active dev browser frame
- relative URLs after the browser resolves them inside the dev browser scope

For subresource requests, the service worker should fetch the mapped
`browserProxyBase` URL. For navigation requests that would leave `/dev-browser/`,
the service worker should redirect to the equivalent `browserProxyBase` URL so the
new document remains inside the service worker scope.

The service worker should not try to implement a JavaScript parser. It should route
requests at fetch time, which covers static tags, CSS-triggered resource loads,
dynamic `import()`, and ordinary `fetch` or `XMLHttpRequest` calls when those calls
produce fetch events.

## HTML Bootstrap

The proxy can inject a minimal bootstrap into HTML responses when needed. The
bootstrap should:

- register or refresh dev browser session metadata with the service worker
- patch `window.WebSocket` only to fail fast for loopback WebSocket URLs with a clear
  console message
- avoid broad monkey-patching of `fetch` or `XMLHttpRequest` unless tests show the
  service worker cannot cover a required v1 case

The default should be request-time routing through the service worker, not fragile
HTML, CSS, or JavaScript rewriting.

## Unsupported WebSocket Behavior

WebSocket is intentionally out of scope for v1.

When a page tries to open `ws://localhost:<port>` or `wss://localhost:<port>`, the
browser should fail clearly. The preferred v1 behavior is a console warning such as:

```text
Coder Studio dev browser does not proxy WebSocket connections yet.
```

The server should reject websocket upgrade attempts on dev proxy routes rather than
silently hanging.

## Security

This feature is a controlled local loopback proxy, not a general-purpose proxy.

Required protections:

- inherit existing Coder Studio authentication
- require a valid dev browser session id for every proxy request
- allow only loopback targets
- serve proxied app documents under `/dev-browser/` so the service worker can
  control them without broadening scope to the whole application
- reject websocket upgrades in v1
- strip hop-by-hop headers
- bound request and response handling to avoid unbounded buffering where practical
- expire sessions after inactivity
- delete sessions when the built-in browser tab is closed when possible
- do not expose raw target URLs in public unauthenticated routes

The important SSRF boundary is server-side target validation. The client and service
worker may improve ergonomics, but the server must remain the enforcement point.

## Error Handling

The built-in browser should show actionable states:

- invalid URL: ask for a loopback HTTP URL with an explicit port
- target unavailable: show that Coder Studio could not connect to the local service
- unsupported websocket: explain that HMR and app WebSockets are not available in v1
- expired session: offer to reload or recreate the browser session
- service worker unsupported: show that this browser context cannot run the dev
  browser proxy

Proxy errors should preserve enough status information for debugging without leaking
stack traces.

## Testing

Server tests:

- accepts `localhost`, `127.0.0.1`, and `[::1]` loopback HTTP URLs
- rejects external, LAN, non-HTTP, credentialed, and malformed URLs
- proxies HTML, CSS, JS, image, JSON, and non-GET requests to a local Fastify target
- strips hop-by-hop headers
- rejects missing or expired sessions
- rejects websocket upgrade attempts

Web tests:

- editor header action opens or focuses the browser editor tab
- browser tab creates a session from manual URL input
- file editor tabs still render file breadcrumbs and mode actions
- browser editor tabs render browser controls and omit file mode actions
- invalid manual input is reported inline
- service worker routing maps loopback and same-origin resource URLs to
  `browserProxyBase`
- unsupported WebSocket patch produces a clear failure path
- browser tab cleanup deletes the server session when feasible

Docs:

- document manual URL entry
- document supported resource types
- document that WebSocket and HMR are not supported in v1

## Risks

Service worker availability depends on browser security context. It works on HTTPS
and on localhost, but plain HTTP access from another device may not allow service
worker registration in all browsers. The UI should detect this and either show a
clear unsupported message or fall back to a more limited server-side HTML rewrite
later.

Path-based proxying can still miss unusual application behavior, especially code
that relies on exact origins or custom WebSocket protocols. v1 should be positioned
as local page validation, not a complete remote browser replacement.

## Implementation Notes

Keep the new dev browser separate from editor document preview. The file preview
system has different security assumptions, lifecycle, and sandbox behavior.

Prefer small, testable units:

- target URL parser and validator
- in-memory dev browser session store
- Fastify proxy route registration
- service worker request-to-proxy URL mapper
- typed editor tab state for file and browser tabs
- browser editor tab UI state and lifecycle

The server validator and service worker mapper should have direct unit tests because
they are the highest-risk parts of the feature.
