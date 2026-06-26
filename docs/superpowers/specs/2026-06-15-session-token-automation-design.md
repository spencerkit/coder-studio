# Session Token Automation Design

> **Status:** Draft for user review  
> **Date:** 2026-06-15  
> **Scope:** `packages/server`, `packages/cli`, `packages/core`, tests

## Goal

Replace password-based re-login for agent automation with a per-session bearer token. The token should authorize local CLI/WebSocket automation for one active agent session without exposing the browser cookie auth path or broadening `/ws` access.

## Decisions

- Keep browser/UI auth unchanged. Existing cookie auth remains the only path for normal web sessions.
- Add a separate session token for agent automation.
- Bind each token to one `sessionId`, `workspaceId`, and `providerId`.
- Accept the token only on loopback `/ws` requests.
- Send the token as `Authorization: Bearer <token>` from CLI automation clients.
- Use the token to derive a reduced automation permission set, not a full admin identity.
- Do not add blanket `/ws` bypass or password re-login for automation.

## Non-Goals

- Do not replace browser login/session cookies.
- Do not add a general-purpose personal access token system.
- Do not introduce local IPC in this iteration.
- Do not widen the auth model beyond local agent automation.

## Existing Context

- `packages/server/src/auth/plugin.ts` currently only validates cookie auth.
- `packages/server/src/ws/dispatch.ts` currently enforces activation gating for websocket commands.
- `packages/server/src/session/manager.ts` already injects `CODER_STUDIO_SESSION_ID`, `CODER_STUDIO_WORKSPACE_ID`, `CODER_STUDIO_PROVIDER_ID`, and `CODER_STUDIO_API_URL`.
- `packages/cli/src/automation-command-client.ts` currently opens `/ws` without auth headers.
- `packages/core/src/domain/automation.ts` defines automation identify/capability data and permission filtering.
- `packages/server/src/commands/memory.ts` now rejects legacy `tag/tags` args and only accepts the current memory type set.

## Architecture

The change is a narrow automation auth layer:

1. Session creation issues a high-entropy token and injects it into the agent environment.
2. The CLI reads that token and sends it in the websocket `Authorization` header.
3. The server accepts bearer auth for `/ws` only when the request is local.
4. Websocket dispatch checks a token-scoped authorization context before running commands.
5. Automation capability discovery reflects the scoped permissions for that token.

The token is not a replacement for user auth; it is a session-bound credential for the agent process that already owns the session.

## Token Model

Create a server-side session-token store with entries shaped like:

```ts
{
  token: string;
  sessionId: string;
  workspaceId: string;
  providerId: string;
  createdAt: number;
  revokedAt?: number;
}
```

Rules:

- Token value must be high entropy and unguessable.
- Token is valid only while the linked session exists and is not revoked.
- Token is not reusable across sessions.
- Token scope is the linked session's workspace and provider only.
- Token never becomes a browser login cookie.

## Auth Flow

### Session creation

When `SessionManager.create()` launches the agent terminal, it also generates a session token and injects it into the child environment as `CODER_STUDIO_SESSION_TOKEN`.

### CLI transport

`packages/cli/src/automation-command-client.ts` reads `CODER_STUDIO_SESSION_TOKEN` and adds:

```ts
headers: {
  Authorization: `Bearer ${token}`,
}
```

to the websocket connection.

### Server validation

`packages/server/src/auth/plugin.ts` accepts bearer auth for `/ws` only when:

- auth is enabled,
- the request is loopback/local,
- the bearer token matches a live session token.

Browser requests continue to rely on cookie auth.

## Command Authorization

Token auth must not imply unrestricted websocket command access.

Allowed automation commands should remain small and session-scoped, including:

- `automation.identify`
- `automation.capabilities`
- `session.list`
- `terminal.read`
- `git.status`
- `git.diff`
- `memory.list`
- `memory.search`
- `memory.get`
- `memory.add`
- `memory.update`
- `memory.delete`
- `uiAction.capabilities`
- `uiAction.dispatch`

Denied by default:

- `workspace.list`
- `session.create`
- workspace admin / settings / install / destructive maintenance commands

The token should also narrow the `automation.identify` and `automation.capabilities` responses so they only advertise commands the token can actually use.

## CLI Memory Cleanup

The `memory` CLI transport should be cleaned up as part of the same change:

- stop sending legacy `tag/tags` arguments
- align CLI memory type examples with the current server schema
- keep `memory add/update/search/list/get/delete` wired to the current command names only

This is a compatibility fix, not a new memory feature.

## Tests

Add coverage for:

- valid session token can open `/ws`
- invalid or missing token is rejected
- non-loopback bearer auth is rejected
- token-scoped commands allow `memory`, `git`, `ui`, and `session.list`
- token-scoped commands deny `workspace.list` and `session.create`
- CLI websocket client sends `Authorization`
- `memory` CLI no longer emits legacy `tag/tags`

## Risks

- If token scope is too broad, the bearer token becomes a hidden admin credential.
- If token scope is too narrow, automation will keep failing on common read paths.
- If token revocation is not tied to session lifecycle, stale sessions may keep working after restart.

## Open Questions

- Should revoked session tokens be persisted or kept in memory only?
- Should token invalidation happen on session end, workspace close, or both?
- Should `automation.capabilities` expose only explicitly allowed commands or also return denied metadata for diagnostics?
