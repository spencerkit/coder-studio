# Session Token Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace password re-login for agent automation with a loopback-only session bearer token, restrict websocket automation to a small scoped command set, and fix the broken CLI memory payloads that still send legacy arguments.

**Architecture:** Server issues a per-session automation token and injects it into the agent environment. CLI automation forwards the token as a websocket bearer header, auth validates that bearer only for local `/ws`, and websocket dispatch derives a token-scoped authorization context that is narrower than browser cookie access. Core automation capability reporting and local CLI identify/capability output must reflect the same scoped permission set.

**Tech Stack:** TypeScript, Fastify, `@fastify/websocket`, `ws`, Vitest, pnpm monorepo, existing session manager/runtime env injection, existing websocket dispatch/hub, existing CLI `bin.test.ts` coverage.

---

## File Structure

- Create: `packages/server/src/auth/session-token-repo.ts`
  Holds in-memory automation session tokens keyed by bearer value and exposes create/get/revoke helpers.
- Modify: `packages/server/src/session/manager.ts`
  Issues automation tokens during session creation, injects `CODER_STUDIO_SESSION_TOKEN`, injects scoped permissions env, and revokes tokens when sessions end.
- Modify: `packages/server/src/server.ts`
  Instantiates the session token repo and passes it into auth/session/ws layers.
- Modify: `packages/server/src/app.ts`
  Passes the token repo into auth guard wiring and, if needed, ensures websocket route metadata remains available before auth decisions.
- Modify: `packages/server/src/auth/plugin.ts`
  Adds loopback-only bearer authentication for `/ws` while preserving cookie auth for browser requests.
- Modify: `packages/server/src/auth/index.ts`
  Re-export any new auth types/helpers needed by app wiring.
- Modify: `packages/server/src/ws/hub.ts`
  Stores per-client auth metadata so dispatch can distinguish browser-cookie sockets from token-auth sockets.
- Modify: `packages/server/src/ws/dispatch.ts`
  Adds token-scoped authorization and separates activation gating from automation command authorization.
- Modify: `packages/server/src/commands/automation.ts`
  Allows capability responses to use scoped permissions instead of unconditional defaults.
- Modify: `packages/core/src/domain/automation.ts`
  Defines the reduced automation permission set, adds env-aware permission parsing for local CLI identify/capabilities, and removes `workspace.list` from the token-scoped default surface.
- Modify: `packages/core/src/domain/automation.test.ts`
  Covers scoped permission reporting and capability filtering.
- Modify: `packages/server/src/__tests__/automation/commands.test.ts`
  Covers scoped capability responses on the command path.
- Modify: `packages/server/src/__tests__/activation-commands.test.ts`
  Covers token-auth websocket authorization alongside existing activation behavior.
- Modify: `packages/server/src/auth/plugin.test.ts`
  Covers loopback bearer accept/reject behavior.
- Modify: `packages/server/src/__tests__/ws-hub.test.ts`
  Covers websocket auth metadata propagation if hub metadata shape changes.
- Modify: `packages/server/src/__tests__/session-integration.test.ts`
  Verifies session env injection includes token and scoped permissions.
- Create or modify: `packages/server/src/__tests__/session-token-repo.test.ts`
  Verifies token repo create/get/revoke behavior if the repo is non-trivial enough to deserve direct tests.
- Modify: `packages/cli/src/automation-command-client.ts`
  Sends `Authorization: Bearer ...` when `CODER_STUDIO_SESSION_TOKEN` is present.
- Modify: `packages/cli/src/bin.test.ts`
  Covers websocket client header propagation via existing CLI test harness and fixes memory command expectations.
- Modify: `packages/cli/src/automation-client.ts`
  Uses env-derived scoped permissions for local `identify` / `capabilities` output instead of unconditional defaults.
- Modify: `packages/cli/src/cli.ts`
  Removes legacy memory `tag/tags` payload fields and updates help examples to current memory taxonomy.
- Modify: `packages/cli/src/parse-args.ts`
  Optionally rejects or ignores legacy memory tag usage if that is the chosen cleanup path; otherwise it can keep parsing `--tag` while transport no longer forwards it.
- Modify: `packages/server/src/commands/memory.test.ts`
  Adds explicit regression tests for rejecting legacy `tag/tags`.

## Task 1: Core Automation Scope Model

**Files:**
- Modify: `packages/core/src/domain/automation.ts`
- Modify: `packages/core/src/domain/automation.test.ts`
- Modify: `packages/cli/src/automation-client.ts`

- [ ] **Step 1: Write failing core automation scope tests**

Add tests that prove:

- `buildIdentifyResult()` reads a scoped permission env variable when present.
- `printCapabilities()` and `listAutomationCapabilities()` can produce a reduced set without `workspace.list`.
- the scoped permission set still includes `session.list`, `terminal.read`, `git.status`, `git.diff`, `memory.*`, and UI action capabilities.

- [ ] **Step 2: Run core tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/core test -- automation.test.ts
```

Expected: FAIL because identify/capabilities still hard-code `DEFAULT_AGENT_AUTOMATION_PERMISSIONS`.

- [ ] **Step 3: Implement scoped permission helpers**

Add:

- a token-safe automation permission constant, for example `SCOPED_SESSION_AUTOMATION_PERMISSIONS`
- an env parser such as `parseAutomationPermissionsEnv(value?: string): AutomationPermission[]`
- support in `buildIdentifyResult()` for an env var such as `CODER_STUDIO_AUTOMATION_PERMISSIONS`
- CLI `printCapabilities()` to read the same scoped env instead of always using defaults

Keep `DEFAULT_AGENT_AUTOMATION_PERMISSIONS` available for broader in-product contexts if other callers still need it.

- [ ] **Step 4: Run core tests to verify pass**

Run:

```bash
pnpm --filter @coder-studio/core test -- automation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/domain/automation.ts packages/core/src/domain/automation.test.ts packages/cli/src/automation-client.ts
git commit -m "feat(core): add scoped automation permissions"
```

## Task 2: Session Token Repository And Session Env Injection

**Files:**
- Create: `packages/server/src/auth/session-token-repo.ts`
- Create or modify: `packages/server/src/__tests__/session-token-repo.test.ts`
- Modify: `packages/server/src/session/manager.ts`
- Modify: `packages/server/src/__tests__/session-integration.test.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Write failing token lifecycle tests**

Add tests that prove:

- a created session receives `CODER_STUDIO_SESSION_TOKEN`
- the same session env also receives `CODER_STUDIO_AUTOMATION_PERMISSIONS`
- tokens are revoked when the session transitions to `ended`
- hydrated sessions do not regain live automation tokens after restart

- [ ] **Step 2: Run server session tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/server test -- session-integration.test.ts session-hydrate-restart.test.ts
```

Expected: FAIL because session creation does not issue automation tokens or permission env yet.

- [ ] **Step 3: Implement token repo and session wiring**

Implement a small in-memory repo:

```ts
interface SessionAutomationTokenRecord {
  token: string;
  sessionId: string;
  workspaceId: string;
  providerId: string;
  permissions: readonly AutomationPermission[];
  createdAt: number;
}
```

Design rules:

- use a high-entropy token such as `randomBytes(32).toString("hex")`
- store tokens in memory only
- revoke tokens when sessions end, are deleted, or are stopped as part of workspace teardown
- do not recreate tokens in `hydrate()` because rehydrated sessions are effectively ended when no live terminal exists

Inject into launched agent env:

- `CODER_STUDIO_SESSION_TOKEN`
- `CODER_STUDIO_AUTOMATION_PERMISSIONS`

- [ ] **Step 4: Run server session tests to verify pass**

Run:

```bash
pnpm --filter @coder-studio/server test -- session-integration.test.ts session-hydrate-restart.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/session-token-repo.ts packages/server/src/__tests__/session-token-repo.test.ts packages/server/src/session/manager.ts packages/server/src/__tests__/session-integration.test.ts packages/server/src/server.ts
git commit -m "feat(server): issue session automation tokens"
```

## Task 3: Loopback `/ws` Bearer Authentication

**Files:**
- Modify: `packages/server/src/auth/plugin.ts`
- Modify: `packages/server/src/auth/index.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/auth/plugin.test.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Write failing auth tests**

Add tests that prove:

- `GET /ws` without cookie or bearer still fails with `401` when auth is enabled
- `GET /ws` with a valid bearer token from `127.0.0.1` is accepted
- `GET /ws` with an invalid bearer token is rejected
- non-`/ws` requests cannot use bearer token auth as a cookie substitute
- non-loopback bearer requests are rejected even if the token exists

- [ ] **Step 2: Run auth tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/server test -- auth/plugin.test.ts
```

Expected: FAIL because the auth guard only recognizes cookies.

- [ ] **Step 3: Implement loopback bearer auth**

Add helpers in `plugin.ts` to:

- read `Authorization: Bearer ...`
- verify request path is exactly `/ws`
- verify request IP is loopback (`127.0.0.1`, `::1`, or equivalent forwarded/local form already trusted by Fastify config)
- look up the token in the in-memory session token repo

Preserve existing behavior:

- browser cookie auth still works everywhere
- frontend navigation still redirects to `/login`
- bearer auth never mints or refreshes auth cookies

- [ ] **Step 4: Run auth tests to verify pass**

Run:

```bash
pnpm --filter @coder-studio/server test -- auth/plugin.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/plugin.ts packages/server/src/auth/index.ts packages/server/src/app.ts packages/server/src/auth/plugin.test.ts packages/server/src/server.ts
git commit -m "feat(server): allow loopback ws bearer auth"
```

## Task 4: WebSocket Auth Metadata And Scoped Dispatch Authorization

**Files:**
- Modify: `packages/server/src/ws/hub.ts`
- Modify: `packages/server/src/ws/dispatch.ts`
- Modify: `packages/server/src/__tests__/ws-hub.test.ts`
- Modify: `packages/server/src/__tests__/activation-commands.test.ts`
- Modify: `packages/server/src/__tests__/automation/commands.test.ts`
- Modify: `packages/server/src/commands/automation.ts`

- [ ] **Step 1: Write failing websocket authorization tests**

Add tests that prove:

- token-auth websocket clients can run allowed scoped commands without holding the active browser lease
- token-auth websocket clients are denied `workspace.list`
- browser websocket clients keep current activation behavior
- `automation.capabilities` on the command path can return a scoped permission-derived command list

- [ ] **Step 2: Run websocket/automation tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/server test -- activation-commands.test.ts automation/commands.test.ts ws-hub.test.ts
```

Expected: FAIL because websocket dispatch only knows activation allowlisting and does not distinguish token-auth clients.

- [ ] **Step 3: Implement scoped auth metadata and dispatch rules**

In `WsHub`:

- derive per-client auth metadata from the authenticated request, for example:

```ts
type WsClientAuthContext =
  | { mode: "browser" }
  | {
      mode: "session_token";
      sessionId: string;
      workspaceId: string;
      providerId: string;
      permissions: readonly AutomationPermission[];
    };
```

- expose a `getClientAuthContext(clientId)` method through `Broadcaster`

In `dispatch.ts`:

- keep existing activation lease checks for browser websocket clients
- short-circuit token-auth websocket clients into a token permission check
- maintain a command-to-permission map for scoped automation commands
- return a stable authorization error such as:

```ts
{ code: "forbidden", message: "Command not allowed for this automation session" }
```

For command naming, remember the server op is `memory.create` while capability names are still advertised as `memory.add`; map both correctly.

- [ ] **Step 4: Run websocket/automation tests to verify pass**

Run:

```bash
pnpm --filter @coder-studio/server test -- activation-commands.test.ts automation/commands.test.ts ws-hub.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/ws/hub.ts packages/server/src/ws/dispatch.ts packages/server/src/__tests__/ws-hub.test.ts packages/server/src/__tests__/activation-commands.test.ts packages/server/src/__tests__/automation/commands.test.ts packages/server/src/commands/automation.ts
git commit -m "feat(server): scope websocket automation commands"
```

## Task 5: CLI WebSocket Bearer Propagation

**Files:**
- Modify: `packages/cli/src/automation-command-client.ts`
- Modify: `packages/cli/src/bin.test.ts`

- [ ] **Step 1: Write failing CLI transport tests**

Add tests in `bin.test.ts` or a focused helper test if needed that prove:

- when `CODER_STUDIO_SESSION_TOKEN` is set, websocket automation connects with `Authorization: Bearer <token>`
- when no token is set, the client still connects without auth headers

- [ ] **Step 2: Run CLI tests to verify failure**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio test -- bin.test.ts
```

Expected: FAIL because websocket creation does not include headers.

- [ ] **Step 3: Implement CLI bearer forwarding**

Update `callCoderStudioCommand()` to read `process.env.CODER_STUDIO_SESSION_TOKEN` and pass:

```ts
const socket = new WebSocket(wsUrl, {
  headers: token ? { Authorization: `Bearer ${token}` } : undefined,
});
```

Do not read saved auth password or attempt login fallback here.

- [ ] **Step 4: Run CLI tests to verify pass**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio test -- bin.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/automation-command-client.ts packages/cli/src/bin.test.ts
git commit -m "feat(cli): send session token bearer auth"
```

## Task 6: CLI Memory Payload Cleanup

**Files:**
- Modify: `packages/cli/src/cli.ts`
- Modify: `packages/cli/src/parse-args.ts`
- Modify: `packages/cli/src/bin.test.ts`
- Modify: `packages/server/src/commands/memory.test.ts`
- Modify: `packages/core/src/domain/automation.test.ts`

- [ ] **Step 1: Write failing memory regression tests**

Add tests that prove:

- `memory list/search/create/update` no longer send `tag` or `tags`
- help/examples/capabilities use only current memory types: `feature | todo | bugfix | project | note`
- server command tests explicitly reject legacy `tag` / `tags` payloads with a validation error

- [ ] **Step 2: Run CLI and memory tests to verify failure**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio test -- bin.test.ts
pnpm --filter @coder-studio/server test -- memory.test.ts
pnpm --filter @coder-studio/core test -- automation.test.ts
```

Expected: FAIL because the CLI still forwards legacy tag payloads and still documents obsolete examples.

- [ ] **Step 3: Implement memory payload cleanup**

In `cli.ts`:

- remove `tag` from `memory.list` and `memory.search`
- remove `tags` from `memory.create` and `memory.update`
- update help examples from `decision` to a valid type such as `project` or `note`

In `parse-args.ts`, choose one of these minimal paths and implement it consistently:

- keep parsing `--tag` temporarily but ignore it in transport, or
- reject `--tag` with a clear error for all memory subcommands

Prefer the second option if it does not create excessive churn, because silent ignore is easy to miss.

- [ ] **Step 4: Run CLI and memory tests to verify pass**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio test -- bin.test.ts
pnpm --filter @coder-studio/server test -- memory.test.ts
pnpm --filter @coder-studio/core test -- automation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/cli.ts packages/cli/src/parse-args.ts packages/cli/src/bin.test.ts packages/server/src/commands/memory.test.ts packages/core/src/domain/automation.test.ts
git commit -m "fix(cli): remove legacy memory payload args"
```

## Task 7: End-To-End Verification

**Files:**
- Modify as needed from previous tasks only

- [ ] **Step 1: Run focused package verification**

Run:

```bash
pnpm --filter @coder-studio/core test -- automation.test.ts
pnpm --filter @coder-studio/server test -- auth/plugin.test.ts activation-commands.test.ts automation/commands.test.ts session-integration.test.ts session-hydrate-restart.test.ts memory.test.ts
pnpm --filter @spencer-kit/coder-studio test -- bin.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repository verification**

Run:

```bash
pnpm ci:verify
```

Expected: PASS.

- [ ] **Step 3: Inspect changed files before handoff**

Run:

```bash
git status --short
git diff -- packages/core/src/domain/automation.ts packages/server/src/auth/plugin.ts packages/server/src/session/manager.ts packages/server/src/ws/dispatch.ts packages/cli/src/automation-command-client.ts packages/cli/src/cli.ts
```

Expected: only the planned files are changed for this feature, aside from unrelated pre-existing user changes that must be left intact.

- [ ] **Step 4: Commit final integration work if needed**

```bash
git add packages/core/src/domain/automation.ts packages/core/src/domain/automation.test.ts packages/server/src/auth/session-token-repo.ts packages/server/src/auth/plugin.ts packages/server/src/auth/index.ts packages/server/src/app.ts packages/server/src/server.ts packages/server/src/session/manager.ts packages/server/src/ws/hub.ts packages/server/src/ws/dispatch.ts packages/server/src/commands/automation.ts packages/server/src/auth/plugin.test.ts packages/server/src/__tests__/activation-commands.test.ts packages/server/src/__tests__/automation/commands.test.ts packages/server/src/__tests__/ws-hub.test.ts packages/server/src/__tests__/session-integration.test.ts packages/server/src/__tests__/session-token-repo.test.ts packages/cli/src/automation-command-client.ts packages/cli/src/automation-client.ts packages/cli/src/cli.ts packages/cli/src/parse-args.ts packages/cli/src/bin.test.ts packages/server/src/commands/memory.test.ts
git commit -m "feat(server): add scoped session token automation"
```

- [ ] **Step 5: Handoff summary**

Report:

- changed files
- focused test commands and results
- `pnpm ci:verify` result
- any residual risks around loopback IP detection or future IPC migration
