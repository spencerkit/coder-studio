# Desktop Environment Launch Readiness Design

## Summary

Opening a Local Windows or WSL environment must remain visibly in progress until the target
environment has a usable window. Creating the target OS process is not sufficient evidence that
the environment opened successfully.

The current environment stays open. If the target environment is already running, the existing
window is focused. If it is still starting, activation requests are queued and completed after the
window becomes ready. Startup failures and bounded timeouts return control to the user so the
operation can be retried.

## Goals

- Show a persistent opening state from the initial click until the target window is ready.
- Focus an already-running target environment on the first activation request.
- Preserve activation requests received before the target window exists.
- Report startup failures and timeouts instead of treating `child_process.spawn` as success.
- Keep the source environment and its terminals and agent sessions running.
- Allow a timed-out or failed launch to be retried safely.

## Non-goals

- Closing or restarting the source environment during a launch.
- Replacing the separate-instance environment architecture.
- Streaming all target-process startup logs into the source window.
- Adding a general-purpose cross-process RPC system.
- Optimizing WSL discovery or backend startup time as part of this fix.

## Root Cause

`desktop:open-environment` currently returns `opened` as soon as Node emits the child process
`spawn` event. The web UI therefore clears its pending state before the target runtime, backend,
and BrowserWindow are ready.

Electron routes subsequent launches for the same target user-data directory through the target
process's `second-instance` event. The current handler returns when `mainWindow` is null, so an
activation request received during startup is lost. In the observed WSL launch, the target main
process existed for approximately 11.6 seconds before its renderer window was created, making this
race visible to users.

## Chosen Approach

Use a request-scoped, file-backed readiness handshake under the shared Desktop user-data root.
The source instance creates a launch request, passes its identifier to the target process, and waits
for a terminal result. The target acknowledges the request only after its window is ready or reports
a startup failure.

This is preferred over a fixed Loading timer because it distinguishes success from failure, and it
is preferred over returning to single-window relaunching because it preserves concurrent Local and
WSL environments.

## Launch Request Model

Each attempt has a cryptographically random request identifier and one status file:

```text
<rootUserDataDir>/environment-launches/<requestId>.json
```

Only a validated request identifier is passed on the command line. Every process computes the
status path from its trusted `rootUserDataDir`; command-line callers cannot supply an arbitrary file
path.

The status payload has this shape:

```ts
interface EnvironmentLaunchStatus {
  schemaVersion: 1;
  requestId: string;
  environmentId: string;
  status: "pending" | "ready" | "failed" | "timed-out";
  pid?: number;
  message?: string;
  updatedAt: number;
}
```

Status writes use a temporary file followed by rename so readers never observe partial JSON.
Requests older than 24 hours are removed during Desktop startup. A request identifier must match a
strict UUID format before it is accepted.

## Source Instance Flow

1. `desktop:open-environment` resolves and prepares the selected target as it does today.
2. It creates a `pending` launch request for that target.
3. It emits the existing `launching` progress phase with a message that the target window is being
   opened.
4. It starts the target executable with the existing environment arguments plus the request ID.
5. A successful OS `spawn` only transitions the operation into the readiness wait; it does not
   resolve the IPC call.
6. The source waits until the request becomes `ready` or `failed`, polling with a short bounded
   interval.
7. `ready` returns `{ status: "opened" }` to the renderer. `failed` rejects with the target's error
   summary.
8. If no terminal result arrives within 45 seconds, the source marks the request `timed-out` and
   rejects with an actionable message explaining that the target may still be starting and that the
   user can retry to focus it.

The 45-second timeout is longer than the observed warm launch and the existing 20-second URL wait,
while still ensuring that the UI cannot remain pending indefinitely.

## Target Instance Flow

The target reads the launch request ID before calling `app.requestSingleInstanceLock()` and includes
it in Electron's `additionalData` object.

### Newly started target

The new primary instance records its initial request as pending activation. It completes normal
runtime and backend startup. When the BrowserWindow emits `ready-to-show`, the target:

1. shows and focuses the window;
2. marks the initial launch request `ready` with its PID;
3. flushes any other activation requests queued during startup.

If startup reaches `handleStartupFailure`, all pending requests are marked `failed` before the
existing failure dialog is shown.

### Already-running target

The short-lived secondary process fails to acquire the target's single-instance lock and passes its
request ID to the primary process through `second-instance`.

- If the primary window is ready, it restores, shows, and focuses the window, then marks the request
  `ready`.
- If the primary window is not ready, it stores the request ID in a deduplicated pending set.
- When the window becomes ready, every queued request is focused and acknowledged.

No activation request is discarded solely because `mainWindow` is null.

## Renderer Behavior

The existing `openingId` state remains active while `api.openEnvironment()` is pending. This already
provides the required behavior once the main-process promise reflects actual readiness:

- the selected row shows its preparing/opening state;
- the environment trigger shows a spinner;
- environment rows cannot start duplicate launches;
- closing and reopening the popover still shows the current pending state;
- success closes the popover;
- failure or timeout displays an error and re-enables the target row for retry.

The renderer must not add an independent timeout. The Desktop main process owns the launch timeout
so all callers observe the same result.

## Components and File Boundaries

### `packages/desktop/src/environment-launch.ts`

Owns the launch request contract and file operations:

- create and validate request IDs;
- derive request paths from the trusted root;
- atomically create and update statuses;
- wait for a terminal status with a bounded timeout;
- expire old request files.

This module contains no Electron or BrowserWindow dependencies and is unit-testable.

### `packages/desktop/src/environment-instance.ts`

Adds the launch request command-line switch and parsing helpers. Existing environment target and
user-data-directory behavior remains unchanged.

### `packages/desktop/src/main.ts`

Coordinates the source and target roles:

- create a request before spawning a target;
- wait for readiness after spawn;
- pass request data into `requestSingleInstanceLock`;
- queue activation requests while the window is unavailable;
- acknowledge requests from `ready-to-show`;
- report startup failures to pending requests.

### `packages/web/src/features/topbar/components/environment-switcher.tsx`

No new state machine is required. Minor copy or progress adjustments may be made, but the existing
pending, success, and error paths remain the UI authority.

## Error Handling

- A synchronous spawn failure immediately marks the request failed and rejects the renderer call.
- A target startup exception marks every request known to that target failed with a serializable
  error summary.
- Invalid, unknown, expired, or target-mismatched request IDs are ignored by the target and never
  cause writes outside the launch-status directory.
- A readiness timeout re-enables retry but does not terminate the target process, because the target
  may still become usable after a slow cold start.
- Retrying creates a new request. If the target has since become ready, the retry follows the
  `second-instance` path and focuses it.
- Status cleanup failures are non-fatal and must not block Desktop startup.

## Testing Strategy

### Unit tests

Add deterministic tests for the file-backed launch request module:

- request paths stay below the trusted launch-status root;
- invalid request IDs are rejected;
- status writes are read atomically;
- a wait remains pending after OS spawn and resolves only on `ready`;
- a `failed` status rejects with its message;
- a missing acknowledgement becomes `timed-out`;
- stale status files are removed without deleting current requests.

Add command-line tests proving the request ID is preserved alongside native and WSL target
arguments.

### Main-process coordination tests

Extract the pending activation bookkeeping into a small unit-testable coordinator or helper and
verify:

- `second-instance` before window readiness is queued;
- duplicate request IDs are acknowledged once;
- attaching a ready window flushes queued requests;
- an already-ready window is restored and focused immediately;
- startup failure rejects all pending requests.

### Renderer tests

Extend the environment switcher tests with a deferred `openEnvironment` promise:

- Loading remains visible while the promise is pending;
- reopening the popover preserves the pending state;
- resolving closes the popover;
- rejecting shows an error and enables retry.

### Windows packaged validation

Validate both directions in a packaged Windows build:

1. Local to a stopped WSL environment: one click shows Loading until the WSL window appears.
2. Local to an already-running WSL environment: one click focuses the existing window.
3. WSL to an already-running Local environment: one click focuses Local.
4. Repeated activation while a cold WSL instance is starting: no request is lost and the first
   source operation completes when the window appears.
5. Forced target startup failure: the source displays the error and permits retry.

## Success Criteria

- A single click is sufficient to open or focus a target environment.
- The source UI never reports `opened` before the target window is ready.
- Loading is continuously visible during a legitimate startup attempt.
- Activation requests received during target startup are eventually fulfilled.
- A launch cannot leave the UI pending beyond 45 seconds.
- Existing environment, WSL discovery, runtime installation, and multi-instance isolation tests
  continue to pass.
