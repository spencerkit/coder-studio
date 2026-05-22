# Markdown and HTML Preview Design

> Status: Draft
> Date: 2026-05-22
> Scope: `packages/web/src/features/code-editor/*`, `packages/web/src/features/workspace/atoms/files.ts`, `packages/server/src/app.ts`, new `packages/server/src/preview/*`, new `packages/server/src/routes/preview.ts`

## Goal

Add first-class preview support for Markdown and HTML files inside the existing editor `preview` mode.

The product should:

- preview `.md`, `.markdown`, `.html`, and `.htm` files inside the current editor surface
- render previews from the current in-memory editor buffer rather than only from saved disk state
- refresh preview output automatically while the user types, using a short debounce
- support relative static resources for HTML and Markdown preview content
- keep image preview, text edit, and git diff behavior aligned with the existing unified editor surface
- preserve a safe default sandbox boundary by not executing preview scripts in the first release

## Non-Goals

This design does not include:

- a split editor layout with source and preview visible side-by-side
- general-purpose file serving from the workspace outside preview sessions
- JavaScript execution inside HTML preview in the first release
- root-relative workspace URL rewriting such as `/assets/app.css` in the first release
- persistent preview sessions across browser reloads or server restarts
- a multi-tab editor resource model

## Problem

The current editor surface already supports:

- text editing through Monaco
- image preview through the `/api/file` image route
- a unified `preview / edit / diff` mode model

What it does not support is document preview for text-based content that wants browser rendering semantics.

Markdown needs rendered HTML, not read-only source text.

HTML needs a real browser document context so relative resources like `./style.css` and `../img/logo.png` resolve from the current file directory.

The existing `/api/file` route is deliberately image-only. That is correct for image preview safety, but insufficient for HTML and Markdown preview because browser documents can request CSS, fonts, SVG, and other static assets.

The hard part is therefore not toggling the UI into preview mode. The hard part is creating a safe, workspace-scoped preview origin that can:

- serve the current unsaved document content
- resolve relative resource requests against the current file location
- avoid turning preview into a generic unrestricted workspace file server

## Decision Summary

Adopt a session-backed preview architecture built on top of the existing editor `preview` mode.

The design has four layers:

1. File-type classification in the web editor
Markdown and HTML files become first-class previewable text files.

2. Frontend preview session lifecycle
When the active file is previewable and the editor is in `preview` mode, the web client creates a preview session, syncs unsaved content with a debounce, and renders an `iframe` against a server preview URL.

3. Server-side preview session store
The server keeps in-memory preview session records keyed by session id. Each record holds the active unsaved document content and metadata needed for routing.

4. Server-side preview route
The server serves either:
- the current document entrypoint from session content
- relative static assets resolved safely from the workspace

This is the recommended design because it preserves real browser URL resolution behavior for relative resources while keeping preview ownership inside the existing editor architecture.

## Product Behavior

## Supported File Types

The first release treats these files as previewable documents:

- `.md`
- `.markdown`
- `.html`
- `.htm`

Default mode rules:

- Markdown files open in `preview`
- HTML files open in `preview`
- image files keep the current image-preview behavior
- all other text files keep the current default `edit` behavior

## Preview Semantics

Preview renders the current in-memory buffer.

This means:

- the user does not need to save before seeing preview changes
- preview output updates automatically after a short debounce
- saved-on-disk content is not the source of truth while preview is active

Recommended debounce window:

- `300ms`

This is fast enough to feel live without rebuilding preview content on every keystroke.

## Markdown Behavior

Markdown preview is rendered as a full HTML document generated on the server.

The HTML output should include:

- semantic Markdown rendering
- a lightweight built-in typography stylesheet
- code block and table styling
- responsive image sizing

Markdown preview should be mounted at the Markdown file's own virtual path so relative links and images resolve from the Markdown file directory.

Example:

- entry file: `docs/guide/intro.md`
- image reference: `./img/cover.png`
- requested asset path resolves to: `docs/guide/img/cover.png`

## HTML Behavior

HTML preview is rendered as the current unsaved HTML document content with no source transformation in the first release.

The browser should load it through a normal `iframe src` URL rather than `srcdoc`.

This is required so relative URLs resolve naturally from the preview entrypoint path.

Example:

- entry file: `examples/demo/index.html`
- stylesheet reference: `./style.css`
- browser request path resolves to: `examples/demo/style.css`

## Unsupported URL Forms in Phase 1

The first release supports relative paths only.

Supported:

- `./style.css`
- `../img/logo.png`
- `fonts/app.woff2`

Not supported in phase 1:

- `/assets/app.css`
- protocol-relative URLs
- custom URL rewriting conventions

Root-relative workspace URL mapping is deferred to phase 2 because it requires an explicit product rule for what `/` means inside preview.

## UI Architecture

This feature extends the existing unified editor surface rather than creating a new page or panel.

### Editor Surface Integration

`EditorSurface` keeps ownership of:

- file title
- mode controls
- close behavior
- save behavior
- error banners

Mode rendering changes only inside the editor body.

The preview branch becomes:

- image file -> existing `ImagePreview`
- Markdown or HTML text file -> new document preview renderer
- other text file -> existing Monaco read-only preview behavior

### Document Preview Renderer

Add a dedicated document preview component inside `packages/web/src/features/code-editor/components`.

Responsibilities:

- render the preview `iframe`
- show loading state while the session is being created
- show inline error state when preview bootstrap or sync fails
- expose a simple retry action

This component should not own file reading, file writes, or editor mode selection.

### Preview Session Hook

Add a frontend hook dedicated to preview session lifecycle.

Responsibilities:

- detect whether the active file should use document preview
- create a preview session when preview starts
- debounce content updates while the user types
- destroy the session when the file closes or the preview target changes
- expose the stable iframe URL and loading/error state

This logic should stay separate from `useCodeEditorActions` so editor file IO and preview HTTP lifecycle do not become tangled.

## Server Architecture

## Preview Session Store

Add a server-side in-memory `PreviewSessionStore`.

Each session record contains:

- `id`
- `workspaceId`
- `entryPath`
- `kind`: `markdown` or `html`
- `content`
- `revision`
- `updatedAt`
- `allowScripts`

`revision` increments on every successful content update.

This gives the client a stable way to force iframe reloads when the source document changes.

The store is intentionally in-memory only for v1:

- no persistence across restart
- no cross-process coordination
- no durable audit history

## Preview Route

Add a new HTTP route family under `/api/preview/session`.

Required endpoints:

- `POST /api/preview/session`
- `PUT /api/preview/session/:id`
- `DELETE /api/preview/session/:id`
- `GET /api/preview/session/:id/*`

The route must be registered before the web app SPA fallback so preview requests do not collapse into `index.html`.

## Route Responsibilities

### `POST /api/preview/session`

Creates a new session from:

- `workspaceId`
- `entryPath`
- `kind`
- `content`
- optional `allowScripts`

Returns:

- `id`
- `previewUrl`
- `revision`

### `PUT /api/preview/session/:id`

Updates:

- `content`
- optional `allowScripts`

Returns the latest `revision`.

### `DELETE /api/preview/session/:id`

Removes the session.

The route should be idempotent from the client's perspective. Deleting an already-missing session should not force the frontend into an unrecoverable state.

### `GET /api/preview/session/:id/*`

Handles two cases:

1. Entry document request
If the requested path matches the session entrypoint, return the current session content.

2. Relative asset request
If the requested path differs from the entrypoint, resolve it relative to the entrypoint directory and stream the workspace file if it stays inside the workspace root.

All responses should use:

- `Cache-Control: no-store`

## Resource Resolution Rules

Resource resolution must happen on the server, not via client-side string rewriting.

Resolution algorithm:

1. Take the session `entryPath`, such as `docs/guide/intro.md`.
2. Determine its directory, such as `docs/guide`.
3. Resolve the requested browser path relative to that directory.
4. Normalize the result.
5. Reject any path that escapes the workspace root.

Examples:

- entry: `docs/guide/intro.md`
- request: `./img/a.png`
- resolved workspace path: `docs/guide/img/a.png`

- entry: `examples/demo/index.html`
- request: `../shared/theme.css`
- resolved workspace path: `examples/shared/theme.css`

- entry: `examples/demo/index.html`
- request: `../../../../etc/passwd`
- rejected as path escape

## MIME Handling

Unlike the existing `/api/file` route, the preview route is not image-only.

The preview resource loader must return correct MIME types for at least:

- `text/html`
- `text/css`
- `image/*`
- `font/*`
- `image/svg+xml`
- `application/javascript`
- `application/json`

Using `mime-types` is preferred over a hand-maintained list because the preview route needs broader static coverage than the image preview route.

## Security Model

## Browser Isolation

Document preview renders inside an `iframe` with sandbox restrictions.

Phase 1 rule:

- scripts are not allowed

The first release therefore supports:

- static HTML layout
- CSS styling
- static images
- static fonts

But not:

- inline script execution
- external script execution
- runtime apps that depend on JavaScript boot

`allowScripts` should still exist in the preview session model so the protocol does not need to change in phase 2, but the first release should keep it effectively disabled.

## Workspace Safety

Preview must not become a generic unrestricted file endpoint.

Safety boundaries:

- every request is tied to an existing preview session
- every session is tied to a specific workspace
- entry and asset paths are resolved through `resolveSafe`
- requests that escape the workspace root are rejected

This preserves the same workspace boundary discipline already used in current file routes and commands.

## Data Flow

## Markdown and HTML Preview Lifecycle

1. User opens a Markdown or HTML file.
2. The editor file classifier marks it previewable by default.
3. `EditorSurface` enters `preview` mode for that file.
4. The preview session hook creates a server preview session with the current file content.
5. The hook exposes `iframeSrc = previewUrl + ?rev=<revision>`.
6. The document preview renderer mounts the iframe.
7. As the user types, content changes are debounced and sent through `PUT /api/preview/session/:id`.
8. Each accepted update increments the session revision.
9. The iframe URL changes to the new revision and reloads the preview document.
10. When the user closes the file or switches to a different preview target, the old session is deleted.

## Error Handling

The preview feature must fail visibly and locally rather than crashing the editor surface.

Required failure cases:

- session creation fails
- session update fails
- entry document request fails
- asset request returns `404`
- asset request is rejected for path escape
- iframe load fails

Frontend behavior:

- keep the editor chrome visible
- replace the preview body with an inline empty/error state
- provide a `Retry` action for bootstrap failures

Server behavior:

- return concise machine-readable error codes
- avoid leaking absolute host file paths

## Testing Strategy

## Server Tests

Add route and store coverage for:

- preview session create, update, get, and delete behavior
- entry document responses for both Markdown and HTML sessions
- relative asset resolution from nested directories
- path escape rejection
- missing workspace and missing session behavior
- MIME correctness for CSS, images, and fonts
- route registration precedence over the SPA fallback

## Web Tests

Add editor and hook coverage for:

- previewable file classification
- document preview renderer selection inside `EditorSurface`
- preview session bootstrap when entering preview mode
- debounced session updates while typing
- iframe revision URL updates after successful sync
- cleanup when switching files or closing the current file
- inline error fallback when preview bootstrap fails

## Phase Plan

## Phase 1: MVP

Ship:

- Markdown preview
- HTML preview
- unsaved-content live preview
- relative static asset loading
- safe sandbox without scripts
- basic loading and error states

Do not ship:

- workspace root URL rewriting for `/...`
- script execution
- preview debugging tools
- side-by-side source and preview

## Phase 2: Enhancements

Add:

- explicit `Allow scripts` preview toggle for HTML
- workspace-root URL mapping for `/...`
- preview toolbar actions such as reload and open in new tab
- better reload behavior and lower flicker
- session expiry cleanup

## Rationale for Not Using `iframe srcdoc`

`srcdoc` is attractive for a simple prototype, but it is the wrong foundation here.

It makes relative resource semantics less natural, pushes more URL rewriting complexity into the client, and increases the amount of document shaping needed outside the browser's normal navigation model.

A session-backed URL preview keeps browser behavior closer to real document loading, which is exactly what HTML preview needs.

## Implementation Notes

- Put Markdown rendering on the server rather than in the client so both Markdown and HTML preview flow through the same iframe document pipeline.
- Keep preview HTTP calls as direct `fetch` helpers in the web package. The current codebase already uses `fetch` directly for non-WS routes.
- Do not reuse `/api/file` for document preview resources. Its image-only boundary is correct and should stay narrow.

## Acceptance Criteria

The feature is complete for phase 1 when all of the following are true:

- opening a Markdown file shows rendered preview by default
- opening an HTML file shows rendered preview by default
- editing either file updates preview without saving
- `./` and `../` static resources resolve correctly from the current file directory
- image preview and normal text editing behavior remain unchanged
- preview does not execute scripts
- failed preview requests show a bounded inline error state instead of breaking the workspace screen
