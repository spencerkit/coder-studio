# Dev Browser Device Mode Design

## Goal

Add a first-pass device mode to the dev browser so a browser tab can reopen the proxied page with a mobile or desktop user agent and render it inside a configurable device-sized viewport with portrait or landscape orientation.

## Scope

This design covers:

- per-browser-tab device configuration
- device viewport width and height controls
- portrait and landscape switching
- desktop or mobile user agent selection
- server-side `User-Agent` forwarding through the dev-browser proxy
- lightweight client-side navigator overrides for common device detection

This design does not cover:

- DPR simulation
- touch event emulation
- `navigator.userAgentData`
- CPU or network throttling
- browser chrome skinning or decorative phone frames
- exact emulation of Chrome DevTools protocol behavior

## Current Architecture

The dev browser is represented as a `WorkspaceBrowserEditorTab` and rendered by `packages/web/src/features/dev-browser/dev-browser-surface.tsx`. Opening a URL creates a dev-browser session through `POST /api/dev-proxy/session`, then mounts an iframe pointed at `session.browserUrl`.

The backend proxy is implemented in `packages/server/src/routes/dev-browser.ts`. The server session currently stores target URL metadata and routes proxied HTTP and WebSocket traffic to the target origin.

Workspace UI state persistence already stores browser tabs in `openEditorTabs` and `activeEditorTab`, which makes browser-tab-local device settings the right persistence boundary.

## Requirements

### Functional requirements

1. A browser tab can be configured independently from other browser tabs, even when multiple tabs point to the same URL.
2. The dev browser toolbar exposes a device preset, viewport width, viewport height, orientation toggle, and apply action.
3. Applying a device configuration reopens the dev browser session with the updated user agent.
4. The preview iframe renders inside a centered scaled viewport that preserves the configured logical width and height.
5. Portrait and landscape mode swap the logical viewport dimensions.
6. HTTP proxy requests forward the configured `User-Agent`.
7. WebSocket proxy handshakes also forward the configured `User-Agent`.
8. The injected bootstrap script overrides a small set of navigator fields so client-side device checks align with the selected mode well enough for common responsive workflows.
9. Device settings survive workspace refresh because they persist with the browser tab.

### Non-functional requirements

1. The first version must stay within the existing dev-browser architecture.
2. Device configuration changes may refresh the page and recreate the session.
3. The implementation must remain compatible with multiple concurrent dev-browser tabs.
4. The UI must not trigger a session rebuild on every keystroke while editing width or height.

## Proposed Design

### 1. State model

Extend `WorkspaceBrowserEditorTab` in both `packages/core/src/domain/types.ts` and `packages/web/src/features/workspace/atoms/files.ts` with a device configuration payload:

- `devicePreset: "desktop" | "iphone-14" | "pixel-7" | "custom"`
- `viewportWidth: number | null`
- `viewportHeight: number | null`
- `orientation: "portrait" | "landscape"`
- `userAgentMode: "desktop" | "mobile"`

These fields belong on the tab instead of global workspace UI state because:

- multiple browser tabs already exist
- duplicate URLs in separate tabs are supported
- the user may want desktop and mobile previews open simultaneously

The tab stores the selected mode and viewport dimensions, not an opaque raw user-agent string. The actual UA string is derived from the preset or mode when opening the session. This keeps persisted state stable if the default UA templates change later.

### 2. Device presets

The first version should ship with a minimal preset set:

- `desktop`
- `iphone-14`
- `pixel-7`
- `custom`

Each preset maps to:

- a default viewport width
- a default viewport height
- a user-agent mode

`custom` preserves the current editable width and height values and does not auto-reset them after the user changes dimensions manually.

### 3. Toolbar behavior

The existing `dev-browser-toolbar` remains the control surface. It gains:

- a preset selector
- width input
- height input
- orientation toggle button
- apply button

Behavior rules:

- changing presets fills width, height, and user-agent mode
- changing orientation swaps width and height
- width and height edits only update local form state until the user applies changes
- opening a new URL or applying device changes uses the same session creation path

This keeps the interaction predictable and avoids recreating the session while the user is still typing values.

### 4. Viewport rendering

The preview area changes from a full-bleed iframe to a three-layer structure:

- shell: fills the editor area
- stage: centers the preview and computes scaling
- iframe viewport: fixed logical device width and height

The iframe keeps the configured logical dimensions. When the editor area is smaller than the logical device viewport, the stage applies a uniform scale transform so the full page remains visible. When there is enough room, the scale is `1`.

This mirrors the useful part of Chrome device mode: a fixed logical viewport shown inside a responsive outer canvas.

### 5. Session creation contract

Extend the dev-browser session creation payload in `packages/web/src/features/dev-browser/api.ts` and `packages/server/src/routes/dev-browser.ts`.

Current payload:

- `url`

Proposed payload:

- `url`
- `userAgent`

The backend stores `userAgent` in the dev-browser session. The first version does not require the backend to interpret viewport dimensions for proxy behavior; those stay frontend-driven. If a future iteration needs more complete navigator or screen emulation, the request contract can be extended without redesigning the route family.

### 6. Proxy request behavior

On HTTP proxy requests, the server already filters incoming headers before forwarding. After that filtering step, if the session carries a configured user agent, the proxy sets the outbound `user-agent` header to that configured value.

On WebSocket proxy requests, the request option builder should accept an override user agent so the handshake mirrors the selected mode.

This gives the upstream target a consistent identity across HTTP and WebSocket connections.

### 7. Client-side navigator overrides

The current HTML bootstrap script injected by the proxy already patches fetch, XHR, EventSource, history, and WebSocket behavior. Extend this bootstrap to expose a lightweight device-mode object derived from the session and override a small navigator surface:

- `navigator.userAgent`
- `navigator.platform`
- `navigator.maxTouchPoints`

Desktop mode should keep touch points at `0` and use desktop-oriented platform values. Mobile mode should expose a mobile UA string, a mobile platform value, and a non-zero touch-point count.

This is intentionally limited. The goal is to align common client-side checks, not to build a full browser fingerprint emulation layer.

### 8. Session lifecycle

Changing device configuration recreates the dev-browser session.

This is the preferred first implementation because:

- it fits the current session model
- it avoids adding a session mutation API
- it keeps backend state management simple

Trade-off:

- page memory state is lost when the user applies a new device mode

That is acceptable for the first version because the feature is primarily for preview and responsive validation rather than in-page workflow continuity.

## Data Flow

1. User edits device settings in the toolbar.
2. Local component state tracks in-progress form values.
3. User clicks apply.
4. The browser tab object is updated with the new device configuration and persisted through existing workspace UI state persistence.
5. The frontend derives the selected user-agent string from the chosen mode or preset.
6. The frontend calls session creation with the URL and derived user agent.
7. The backend stores the user agent in the session.
8. The iframe reloads against the new session URL.
9. Proxied HTTP and WebSocket traffic use the configured user agent.
10. Injected bootstrap script overrides common navigator fields for the page context.

## Error Handling

- Invalid width or height values should block apply and keep the existing session intact.
- Width and height must be positive integers inside a conservative supported range.
- If session recreation fails, the previous persisted tab settings may remain updated, but the UI should surface the existing dev-browser error notice and avoid hiding the failure.
- Navigator override failures inside the bootstrap script must fail open and leave the page usable.

## Testing Strategy

### Frontend

- extend browser-tab normalization and persistence tests to cover the new tab fields
- add dev-browser surface tests for preset selection, orientation swap, width and height edits, and apply behavior
- add viewport rendering tests that verify fixed logical dimensions and scaling class or style behavior

### Backend

- extend dev-browser route tests to verify session creation accepts `userAgent`
- verify proxied HTTP requests receive the overridden `User-Agent`
- verify proxied WebSocket requests receive the overridden `User-Agent`
- verify bootstrap injection includes navigator override logic

## Risks

1. Some targets may rely on `navigator.userAgentData` or more detailed browser APIs. The first version will not match those checks.
2. Recreating sessions on apply causes page reloads, which may be noisy for pages with expensive boot sequences.
3. Scaling math can produce poor visuals if the shell layout does not provide clean centering and overflow boundaries.

## Open decisions resolved for this version

- Device settings persist per browser tab, not globally.
- Device changes apply through explicit user action, not live keystroke updates.
- The backend stores and forwards a concrete user-agent string.
- The first release supports desktop and mobile modes with a small preset list.

## Implementation boundaries

Primary files expected to change in implementation:

- `packages/core/src/domain/types.ts`
- `packages/web/src/features/workspace/atoms/files.ts`
- `packages/web/src/features/dev-browser/dev-browser-surface.tsx`
- `packages/web/src/features/dev-browser/api.ts`
- `packages/server/src/dev-browser/session-store.ts`
- `packages/server/src/routes/dev-browser.ts`
- related tests in `packages/web/src/features/dev-browser/` and `packages/server/src/routes/`

The implementation should stay within `packages/web`, `packages/server`, and `packages/core`. No provider or CLI changes are required.
