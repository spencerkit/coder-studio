# Session Activity Logs Design

> Status: Draft for user review
> Date: 2026-06-27
> Scope: `packages/core`, `packages/server`, `packages/cli`, `packages/web`, built-in skills

## Goal

Add a lightweight session-scoped activity log capability for agent sessions in
Coder Studio. The agent will report structured activity records at key moments
through a built-in skill, the runtime will persist those records as session
metadata, and the web UI will expose a `Logs` entry near the current session
strip that opens a structured session log dialog.

This is a current-session introspection feature. It lets users review what the
agent actually did in this session and gives later agent flows a small,
structured activity trail they can use for review-oriented tasks such as
session-level CR or recap.

## Decisions

- V1 scope is one agent session. Logs belong to `sessionId`, not workspace, not
  supervisor, and not provider-global state.
- The capability is independent from Supervisor. The first UI entry is only
  placed near the current Supervisor/session strip for discoverability.
- V1 uses a built-in skill to instruct the agent to self-report activity at
  important points. We do not add deep provider/runtime instrumentation first.
- Activity records are structured JSON entries, not free-form transcript text.
- The write path reuses the built-in automation bridge and session automation
  command flow (`cmd.mjs` -> CLI automation entry -> websocket command).
- Activity storage lives inside existing `AgentSessionMetadata` for the current
  session.
- V1 is append-only from the agent/UI perspective. Optional clear/delete flows
  can wait.
- The initial user-facing label is `Logs`. The dialog title is `Session Logs`.
- The UI should clearly reflect that the content belongs to the current session.

## Non-Goals

- Do not build low-level automatic capture of every shell command, token event,
  or filesystem write in the runtime.
- Do not build a workspace-wide logging system in v1.
- Do not couple storage or UI visibility to Supervisor lifecycle/state.
- Do not create a second review or analytics subsystem for these records.
- Do not expose a general-purpose export/search/index pipeline in v1.
- Do not block agent actions if it fails to record an activity entry.

## Existing Context

Relevant current structure and reuse points:

- `packages/core/src/domain/types.ts` already defines `AgentSessionMetadata` and
  `AgentSessionVerificationRun`.
- `packages/server/src/storage/repositories/session-metadata-repo.ts` already
  persists per-session metadata in `.coder-studio/session-metadata.json`.
- `packages/server/src/commands/session-metadata.ts` already exposes
  `session.metadata.get` and `session.verification.add`.
- `packages/server/src/commands/session.ts` already initializes session metadata
  during `session.create`.
- `packages/server/src/skills/builtin/automation-bridge.ts` defines the shared
  built-in skill launcher contract through mounted `cmd.mjs`.
- `packages/cli/src/automation-entry.ts` already maps built-in skill commands
  like `memory.create` and `ui.open-file` into websocket commands.
- `packages/server/src/skills/builtin/definitions/*.ts` already define built-in
  skills such as memory, open, and canvas.
- `packages/web/src/features/workspace/actions/use-memory-panel.ts` shows the
  standard fetch and subscription pattern for live-updating panels.
- `packages/web/src/features/supervisor/views/shared/supervisor-details-dialog.tsx`
  shows the current modal pattern near the intended entry area.
- `packages/web/src/features/supervisor/views/shared/supervisor-card.tsx`
  renders the current strip where the temporary `Logs` button can be added.
- `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
  is the session-scoped host that already passes `sessionId` and `workspaceId`
  into the inline strip area.

## User Decisions Captured

- Keep the feature lightweight.
- Use a built-in skill, not a heavy runtime instrumentation system.
- Tell the agent to report key actions according to the skill contract.
- Let the skill call runtime commands directly through `cmd.mjs`.
- Show logs for the current agent session in a dedicated structured panel/dialog.
- Put the first entry point near the current Supervisor/session strip.
- Do not couple the capability to Supervisor, even if the button lives near it.
- Prefer a visible text button like `Logs` for the first version.

## Approaches Considered

### Option A: Deep automatic runtime instrumentation

Examples:

- hook all command execution in the server runtime
- hook edit actions in the editor/runtime
- infer activity entirely from backend behavior

Pros:

- low reliance on model compliance
- richer machine-generated audit trail

Cons:

- much heavier than the requested scope
- touches more runtime surfaces and provider paths
- produces noisy low-level events before the UI and data model are validated
- does not match the user's desired skill-driven reporting model

Decision: reject for v1.

### Option B: Session log capability with built-in skill self-reporting

Examples:

- agent reports plan updates
- agent reports important commands
- agent reports meaningful edits
- agent reports review/summary events

Pros:

- matches the requested lightweight architecture
- reuses existing automation bridge
- keeps the schema small and understandable
- easy to expose in the UI without building a full telemetry stack

Cons:

- depends on the agent following the skill instructions
- not every action will be captured perfectly

Decision: accept for v1.

### Option C: Logs as a Supervisor feature

Pros:

- easy initial placement because the UI strip already exists

Cons:

- wrong ownership model
- excludes non-supervised sessions
- makes future session tooling depend on Supervisor state and data

Decision: reject. Placement can be near Supervisor, but capability ownership
stays at the session layer.

## Final Design

## 1. Capability Shape

Introduce a new session-level capability named `session activity`.

The capability has three parts:

1. a structured activity model stored on `AgentSessionMetadata`
2. runtime commands for recording and listing entries
3. a built-in skill that teaches the agent when and how to record entries

The core rule is simple:

- the agent reports meaningful milestones
- the runtime persists them under the current session
- the UI renders them as a readable timeline for that session

## 2. Data Model

Extend `packages/core/src/domain/types.ts` with session activity types and add
the entries to `AgentSessionMetadata`.

Recommended shape:

```ts
export const SESSION_ACTIVITY_KINDS = [
  "plan",
  "command",
  "edit",
  "review",
  "note",
] as const;

export type SessionActivityKind = (typeof SESSION_ACTIVITY_KINDS)[number];

export const SESSION_ACTIVITY_PHASES = ["start", "update", "finish"] as const;

export type SessionActivityPhase = (typeof SESSION_ACTIVITY_PHASES)[number];

export const SESSION_ACTIVITY_STATUSES = [
  "info",
  "success",
  "warning",
  "error",
] as const;

export type SessionActivityStatus = (typeof SESSION_ACTIVITY_STATUSES)[number];

export interface SessionActivityEntry {
  id: string;
  sessionId: string;
  workspaceId: string;
  kind: SessionActivityKind;
  phase?: SessionActivityPhase;
  title: string;
  summary?: string;
  status?: SessionActivityStatus;
  command?: string;
  files?: string[];
  payload?: Record<string, unknown>;
  createdAt: number;
}
```

`AgentSessionMetadata` gains:

```ts
activityEntries: SessionActivityEntry[];
```

Validation and normalization rules:

- `title`: trim, 1-160 characters
- `summary`: optional, trim, max 2,000 characters
- `command`: optional, trim, max 2,000 characters
- `files`: optional, unique normalized workspace-relative file paths, max 20
- `payload`: optional shallow JSON object for extra machine-readable context
- entries are appended in created order
- UI reads them in reverse chronological order

V1 should keep all activity entries in one array on session metadata. If growth
or retention becomes a problem later, this can move into a dedicated store.

## 3. Persistence and Repository Behavior

Reuse `SessionMetadataRepo` instead of adding a new storage subsystem.

Repository changes:

- `normalizeMetadata()` must preserve `activityEntries`
- missing `activityEntries` should normalize to `[]`
- add `addActivityEntry(sessionId, entry)` helper
- add `listActivityEntries(sessionId)` helper if a convenience method improves
  command readability

Append behavior:

- `addActivityEntry` looks up existing metadata by `sessionId`
- if metadata does not exist, return a `session_metadata_not_found` style error
- the helper appends the normalized entry and persists the whole metadata record

Session initialization:

- `packages/server/src/commands/session.ts` should initialize new sessions with
  `activityEntries: []`

## 4. Runtime Commands

Extend `packages/server/src/commands/session-metadata.ts` with session activity
commands.

### `session.activity.record`

Args:

```ts
{
  sessionId: string;
  kind: "plan" | "command" | "edit" | "review" | "note";
  phase?: "start" | "update" | "finish";
  title: string;
  summary?: string;
  status?: "info" | "success" | "warning" | "error";
  command?: string;
  files?: string[];
  payload?: Record<string, unknown>;
}
```

Behavior:

- validate required fields
- generate `id` server-side with `randomUUID()`
- derive `workspaceId` from the existing session metadata record
- set `createdAt = Date.now()`
- append the entry through `SessionMetadataRepo`
- return the stored `SessionActivityEntry`

### `session.activity.list`

Args:

```ts
{
  sessionId: string;
}
```

Behavior:

- load session metadata
- return the current `activityEntries` array

Return shape for v1:

```ts
{
  sessionId: string;
  entries: SessionActivityEntry[];
}
```

### Optional future command

- `session.activity.clear`

This should stay out of the first implementation unless the UI needs it.

## 5. Broadcast Model

Mirror the memory-panel live update pattern so the web dialog refreshes when the
agent records new entries.

After a successful append, broadcast:

```text
workspace.<workspaceId>.session-activity.changed
```

Payload:

```ts
{
  workspaceId: string;
  sessionId: string;
  entryId: string;
  action: "recorded";
}
```

The topic is workspace-scoped because the current websocket subscription model
already keys many realtime updates by workspace. The payload still includes
`sessionId`, and the UI filters by the current session.

## 6. CLI Automation Entry

Extend `packages/cli/src/automation-entry.ts` with the new automation op family:

- `session.activity.record`
- `session.activity.list`

Recommended command examples:

```bash
node "<absolute-mounted-skill-path>/cmd.mjs" session.activity.record \
  --kind plan \
  --phase update \
  --title "Inspect session wiring" \
  --summary "Reading session metadata and activity commands." \
  --json
```

```bash
node "<absolute-mounted-skill-path>/cmd.mjs" session.activity.record \
  --kind command \
  --phase finish \
  --title "Run focused tests" \
  --command "pnpm --filter web test" \
  --status success \
  --json
```

```bash
node "<absolute-mounted-skill-path>/cmd.mjs" session.activity.record \
  --kind edit \
  --phase finish \
  --title "Update metadata schema" \
  --files '["packages/core/src/domain/types.ts"]' \
  --summary "Added session activity entry definitions." \
  --json
```

Parsing rules:

- read `workspaceId` from env as usual
- prefer `sessionId` from `CODER_STUDIO_SESSION_ID`
- allow optional `--session` / `--session-id` override for direct tooling if
  needed
- `--files` accepts JSON array input
- `--payload-json` accepts JSON object input
- `--json` continues to print the result payload

The mapped websocket ops stay aligned with the backend command names:

- `session.activity.record`
- `session.activity.list`

## 7. Built-in Skill

Add a built-in skill definition, for example:

- slug: `coder-studio-session-activity`
- display name: `Coder Studio Session Activity`

This skill reuses the shared built-in automation bridge and ships the same
mounted `cmd.mjs` pattern used by memory/open/canvas.

The skill content should instruct the agent to record entries at important
moments rather than every tiny action.

Recommended recording points:

- when starting or revising a plan
- before or after an important verification/build/test command
- after meaningful file edits are completed
- when switching into review/explanation mode
- when an error or blocker materially changes the session state

Recommended non-recording rules:

- skip trivial reads and tiny navigation actions
- skip repetitive noise
- avoid storing secrets or large command output
- keep summaries concise and user-readable

Recommended examples in the skill:

- `plan` for inspection/planning milestones
- `command` for notable shell/test/build runs
- `edit` for meaningful code or document changes
- `review` for CR/summary passes
- `note` for blockers or important context not covered by the other kinds

Mounting:

- default enabled
- auto-mounted for providers that already support built-in skills
- independent from Supervisor enablement

## 8. Web UI Entry

The first visible entry point should be a text button labeled `Logs` placed near
the current session strip, adjacent to the current Supervisor area.

Important ownership rule:

- placement is near Supervisor
- behavior is session-scoped
- availability should not depend on whether Supervisor is enabled

Recommended integration path:

- update `SupervisorCard` to render a `Logs` action beside the existing
  Supervisor affordances when the session supports inline controls
- reuse the existing inactive `SupervisorCard` surface for sessions where
  Supervisor is not enabled yet, so `Logs` remains available without a
  Supervisor dependency
- if the session is not currently showing an active Supervisor card, the same
  session-level trigger can later be lifted to the surrounding session header or
  a small dedicated strip component

For v1, it is acceptable to add the button in the current `SupervisorCard`
surface as long as the underlying state and actions remain in a separate
`session-activity` feature.

## 9. Web UI Dialog

Create a new session-activity feature in `packages/web/src/features/session-activity`.

Recommended files:

- `actions/use-session-activity.ts`
- `atoms.ts` if dialog visibility needs global state
- `views/session-activity-dialog.tsx`
- `views/session-activity-button.tsx`
- optional `views/session-activity-list.tsx`

Dialog behavior:

- title: `Session Logs`
- scope label: current session title/provider/state
- fetch entries via `session.activity.list`
- subscribe to `workspace.<workspaceId>.session-activity.changed`
- refresh when the current session receives a new activity record

Recommended content structure:

- header with session title, provider badge, session state badge
- simple kind filter tabs or segmented controls:
  `All`, `Plans`, `Commands`, `Edits`, `Reviews`
- reverse chronological timeline list
- each item shows:
  - timestamp
  - kind badge
  - optional phase badge
  - title
  - summary
  - command snippet if present
  - file chips or compact file list if present
  - optional expanded raw details for `payload`

Empty state copy:

```text
No logs recorded for this session yet.
```

The dialog should work on desktop first and follow the current modal patterns in
the workspace/supervisor feature set.

## 10. Agent and Review Workflows

This feature is intentionally dual-purpose:

1. users can manually inspect what happened in the current session
2. later agent workflows can reuse the structured activity history for recap,
   review, or CR-style reasoning

Examples of downstream uses:

- summarize what the agent changed before a handoff
- generate a review pass focused on files the session reported editing
- inspect failed command history without parsing the whole terminal transcript

These downstream consumers should treat activity logs as hints, not as a perfect
audit log.

## 11. Error Handling

Requirements:

- if session activity storage is unavailable, command handlers should return a
  clear error such as `session_metadata_unavailable`
- if the session record is missing, return `session_metadata_not_found`
- if the activity record command fails inside the agent, the primary work should
  continue; the log write is best-effort
- the UI should show a compact load error state if `session.activity.list` fails
- invalid `files` or `payload-json` inputs should fail validation early in the
  CLI automation entry

## 12. Testing

Add focused tests across the existing surfaces:

### Core / server

- `packages/server/src/__tests__/session-metadata-repo.test.ts`
  - rehydrates `activityEntries`
  - appends entries in created order
- `packages/server/src/__tests__/session-metadata-command.test.ts`
  - `session.activity.record` stores the expected entry
  - `session.activity.list` returns the stored entries
  - broadcast payload is emitted after record

### CLI

- `packages/cli/src/automation-entry.test.ts`
  - maps `session.activity.record` to the correct websocket command
  - parses `--files` JSON
  - parses `--payload-json`
  - resolves session id correctly

### Web

- add a focused button/dialog rendering test near the current
  `supervisor-card`/session-strip tests
- test empty state and filtered rendering
- test refresh on websocket event if the feature uses live subscription

## 13. Risks

- Agent compliance is imperfect, so logs will not be a complete low-level audit.
- If the skill over-instructs, the log will become noisy and users will ignore
  it.
- If `activityEntries` grows without limit, storing it in session metadata may
  eventually need truncation or migration.
- If the UI entry is implemented inside `SupervisorCard` too literally, later
  refactors may accidentally make the feature Supervisor-dependent.

## 14. Recommended Implementation Order

1. Extend core session metadata types with `SessionActivityEntry`.
2. Extend `SessionMetadataRepo` normalization and append helpers.
3. Add `session.activity.record` and `session.activity.list` server commands.
4. Initialize `activityEntries: []` during `session.create`.
5. Extend `packages/cli/src/automation-entry.ts` and tests.
6. Add the built-in `coder-studio-session-activity` skill definition.
7. Add the web `session-activity` feature and dialog.
8. Add the `Logs` button near the current session strip without coupling
   behavior to Supervisor state.
9. Run focused tests, then broader verification if the change grows.
