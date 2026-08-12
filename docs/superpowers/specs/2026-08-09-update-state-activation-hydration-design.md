# Update State Activation-Aware Hydration Design

## Problem

On a fresh Desktop connection, `AppProviders` requests `updates.getState` before the WebSocket client has claimed the activation lease. The server rejects the request with `activation_required`, the result is ignored, and the update controller never receives the Desktop product state. The About page can still show the server version through its fallback, but it has no equivalent fallback for `productPublishedAt`, so the release time appears unknown.

## Considered Approaches

1. **Wait for activation before hydrating update state (selected).** Make update-state hydration depend on the activation status and run only when the client is active. This follows the server's command-authorization contract and keeps the change local to provider lifecycle wiring.
2. **Retry only after `activation_required`.** This repairs the observed failure but treats an expected startup ordering requirement as an error path and duplicates activation knowledge in retry handling.
3. **Queue all commands in the shared dispatcher until activation.** This is broader than the bug and risks changing behavior for activation-allowlisted commands and unrelated features.

## Design

`AppProviders` will hydrate `updates.getState` only when both the connection status is `connected` and the activation status is `active`. Activation status will be an effect dependency, so initial activation and post-reconnect activation each trigger a fresh hydration. If the connection drops or activation changes before the request completes, the effect cleanup prevents the stale result from being stored.

The existing `createUpdateController` flow remains unchanged. Once the server state is stored, it reads the authoritative Desktop state through `window.coderStudioDesktop.getUpdateState()`, including the Runtime release timestamp.

## Error Handling

Failed update-state requests remain non-fatal and do not replace an existing state. A later activation transition or reconnect provides the retry boundary. No general-purpose retry loop is added.

## Testing

Provider lifecycle tests will verify that:

- `updates.getState` is not sent merely because the socket connected;
- it is sent after activation becomes active;
- Desktop controller hydration then consumes the Desktop bridge state;
- a reconnect followed by reactivation hydrates again.

The focused Web test suite and relevant package checks will run before handoff.
