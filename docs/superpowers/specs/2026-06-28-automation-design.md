# Automation Design

> Status: Draft for user review
> Date: 2026-06-28
> Scope: `packages/core`, `packages/server`, `packages/web`, tests

## Summary

Add a first-class `Automation` product surface to Coder Studio that lets users
define recurring or event-triggered agent work, then inspect each execution as
a reviewable run backed by the existing session model.

The key product move is not "saved workflows". The key move is:

- trigger an agent automatically at the right time
- run that work inside the existing session/runtime model
- deliver the result back as a durable run with transcript, changes, review,
  and analysis

Externally, the feature is named `Automation`. Internally, the model is:

- `Automation` = the long-lived definition
- `AutomationRun` = one execution attempt of that definition
- `Session` = the execution carrier for the run
- `Supervisor` = optional in-run continuation logic
- `Skill` = optional reusable execution method

## Goal

Let users create automations that can:

- start on a schedule
- start from an incoming webhook
- create an agent run without manual babysitting
- produce inspectable output rather than a blind pass/fail result
- be resumed, reviewed, retried, or disabled from the product UI

The design should strengthen Coder Studio's existing position as a local-first,
cross-device AI coding workbench rather than pushing it toward generic workflow
automation or generic CI orchestration.

## Product Framing

`Automation` solves a different problem than `Skill`.

- `Skill` answers: how should the agent do the work?
- `Automation` answers: when should the agent start, what should it run, and
  where should the resulting execution be inspected?

The intended user outcome is:

`trigger -> automation -> session-backed run -> reviewable result`

The feature is therefore not primarily about workflow templates. It is about
continuous delivery of agent work results that remain human-reviewable.

`manual Run now` is intentionally treated as an operator action on an existing
automation definition, not as a third automation definition trigger type.

## Decisions

- Name the feature `Automation` in the product UI and command surface.
- Treat `Automation` and `AutomationRun` as first-class persisted entities.
- Back every automation run with the existing `Session` runtime model.
- Do not create a separate execution engine parallel to sessions.
- Keep `Supervisor` as an optional per-run continuation layer, not as the
  automation trigger layer.
- Keep `Skill` as an optional input to automation execution, not as the
  scheduling or run-history layer.
- Make `Runs` the primary high-frequency surface and `Automations` the
  definition-management surface.
- Support only two trigger types in v1:
  - `schedule`
  - `incoming webhook`
- Default to conservative concurrency:
  - one active run per automation
  - queue the latest trigger rather than launching parallel runs
- Favor inspectability over silent recovery:
  - interrupted runs remain visible
  - server restart does not auto-resume active runs in v1

## Non-Goals

- Do not build a visual flow editor or DAG composer in v1.
- Do not turn automations into a second skills library.
- Do not add GitHub App, Slack, or Linear native integrations in v1.
- Do not add complex filter expressions in v1.
- Do not add team approvals, RBAC, or policy workflows in v1.
- Do not add full sandbox orchestration as a requirement for phase 1.
- Do not duplicate transcript, diff, or analysis payloads into a second run
  artifact store when existing session-derived data is sufficient.

## Existing Context

Relevant current code and product surfaces:

- `packages/server/src/session/manager.ts`
  - already owns provider launch, session state, terminal integration,
    hydration, and automation entry injection
- `packages/server/src/commands/session-review.ts`
  - already exposes session review summary and diff generation
- `packages/server/src/session-analysis/*`
  - already supports session analysis generation
- `packages/server/src/supervisor/*`
  - already supports per-session continuation and a lightweight scheduler model
- `packages/server/src/commands/task.ts`
  - supports task discovery and execution, but is terminal-first and not a fit
    for session-backed automation runs
- `packages/server/src/commands/automation.ts`
  - currently exposes automation capability discovery for agent-side automation
    entrypoints, not product-level orchestration
- `packages/core/src/domain/automation.ts`
  - already defines automation-related permissions and capability metadata for
    agent automation entrypoints
- `packages/web/src/features/tasks/*`
  - demonstrates a small run-history UI, but is designed around commands rather
    than agent sessions
- `packages/web/src/features/workspace/*`
  - provides the main review, diff, and session interaction environment
- `packages/web/src/features/notifications/*`
  - provides the current completion/attention notification primitives

These existing pieces strongly favor a session-backed automation design rather
than a new task runner or a new standalone orchestration runtime.

## Problem

Coder Studio currently supports:

- manual session creation
- provider-backed agent execution
- supervisor-assisted continuation
- terminal/task execution
- reviewable git changes
- work analysis and session analysis

What it does not support is a first-class way to say:

- start this work every night
- start this work when a webhook arrives
- keep a history of each attempt
- let me inspect the result as an agent run
- let me continue from the exact run that needs my help

Without that layer, repeated agent workflows remain manual, fragile, and
ephemeral. Users can save instructions or skills, but they cannot turn those
patterns into ongoing, inspectable operations.

## Alternatives Considered

### Option A: Workflow Template Layer

Model automation as a saved prompt + provider + skill preset with optional
manual rerun support.

Pros:

- cheapest to implement
- easy to understand
- close to current session presets

Cons:

- heavily overlaps with skills
- does not solve asynchronous delivery
- does not create durable run history

Decision:

- rejected as the primary model

### Option B: Session-Backed Automations

Model automation as a long-lived definition that creates one session-backed run
 per trigger.

Pros:

- clear boundary from skills
- reuses current runtime and review model
- supports schedule, webhooks, run history, and human takeover

Cons:

- requires new persistence and orchestration layers
- needs a new inbox/detail UI

Decision:

- chosen for v1

### Option C: Full Automation Platform

Model automation as a general event-driven orchestration platform with advanced
sources, filters, approvals, and sandboxing.

Pros:

- highest long-term ceiling
- strongest competitive parity with agent operations platforms

Cons:

- too large for phase 1
- adds platform complexity before basic value is proven

Decision:

- deferred until the v1 run model proves useful

## Proposed Model

### Core entities

#### Automation

A long-lived definition that describes:

- where the work runs
- when it starts
- how it starts
- which provider and optional skills/supervision settings to use

Recommended v1 shape:

```ts
interface Automation {
  id: string;
  workspaceId: string;
  name: string;
  enabled: boolean;
  triggerType: "schedule" | "webhook";
  triggerConfig: ScheduleTriggerConfig | WebhookTriggerConfig;
  providerId: string;
  objective: string;
  skillSlugs: string[];
  supervisorPreset?: AutomationSupervisorPreset;
  runPolicy: "single_active_run" | "allow_parallel";
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
}
```

#### AutomationRun

A durable record of one automation execution attempt.

Recommended v1 shape:

```ts
interface AutomationRun {
  id: string;
  automationId: string;
  workspaceId: string;
  sessionId?: string;
  triggerType: "schedule" | "webhook" | "manual";
  triggerSnapshot: Record<string, unknown>;
  status:
    | "queued"
    | "starting"
    | "running"
    | "needs_review"
    | "needs_input"
    | "succeeded"
    | "failed"
    | "stopped"
    | "interrupted";
  requestedAt: number;
  startedAt?: number;
  endedAt?: number;
  resultSummary?: {
    changedFiles?: number;
    reviewHeadline?: string;
    analysisHeadline?: string;
  };
  errorMessage?: string;
}
```

### Relationship to existing models

- one `Automation` can create many `AutomationRun`s
- one `AutomationRun` maps to one `Session`
- one `Session` may optionally host one `Supervisor`
- one `Automation` may reference zero or more `Skill`s

## Trigger Model

### Schedule trigger

The initial schedule trigger should support a compact shape such as:

```ts
interface ScheduleTriggerConfig {
  timezone: string;
  cron: string;
}
```

The server remains responsible for next-run computation and scheduling.

### Webhook trigger

The initial webhook model should stay intentionally narrow:

```ts
interface WebhookTriggerConfig {
  secretId: string;
}
```

Phase 1 behavior:

- each automation gets a webhook endpoint
- each webhook endpoint validates a secret
- accepted requests create a run and store a trigger snapshot

Phase 1 does not need:

- source registries
- rich event type extraction
- advanced filters

Those can be layered later without changing the core run model.

## Run Lifecycle

### High-level flow

```text
Trigger fires
  -> create AutomationRun(status=queued)
  -> executor claims run
  -> create Session
  -> run status becomes starting/running
  -> session ends
  -> derive review/analysis summary
  -> finalize AutomationRun status
```

### Run status semantics

- `queued`
  - accepted and waiting for execution
- `starting`
  - execution claimed and session creation in progress
- `running`
  - session exists and is active
- `needs_review`
  - session ended and created a result that should be inspected
- `needs_input`
  - session ended or paused in a state that asks for human continuation
- `succeeded`
  - session ended cleanly and produced no pending human action
- `failed`
  - trigger or execution failed
- `stopped`
  - user manually stopped the run
- `interrupted`
  - server restarted while the run was active

### Final status classification

Recommended v1 rules:

- session creation failure -> `failed`
- abnormal session exit -> `failed`
- completed session with changed files or meaningful review summary
  -> `needs_review`
- completed session that explicitly needs more human prompting
  -> `needs_input`
- completed session with no follow-up action
  -> `succeeded`
- manual stop action
  -> `stopped`

## Architecture

### Chosen execution pipeline

```text
schedule/webhook/manual trigger
  -> trigger router
  -> automation run queue
  -> automation executor
  -> session manager
  -> session review / analysis
  -> notifications + runs inbox
```

### Why the run must reuse session

The current session model already provides:

- provider launch and provider configuration
- PTY-backed terminal lifecycle
- state broadcasting
- hydration/restart behavior
- session metadata
- review and analysis attachment points

Creating a second execution engine for automation would duplicate:

- terminal wiring
- provider runtime integration
- review extraction
- session continuation
- notification semantics

That duplication would be costly and would make run inspection inconsistent.

## Backend Design

### File and module layout

Add or extend the following:

- `packages/core/src/domain/automation.ts`
  - product-level automation domain types
- `packages/server/src/storage/repositories/automation-repo.ts`
- `packages/server/src/storage/repositories/automation-run-repo.ts`
- `packages/server/src/automation/manager.ts`
- `packages/server/src/automation/executor.ts`
- `packages/server/src/automation/trigger-router.ts`
- `packages/server/src/automation/scheduler.ts`
- `packages/server/src/automation/webhook-registry.ts`
- `packages/server/src/commands/automation.ts`
  - extend the current command family rather than creating a second family

### Repository responsibilities

`AutomationRepo`

- create
- update
- enable/disable
- delete
- list by workspace
- get by id

`AutomationRunRepo`

- create run
- update run status
- list runs by workspace and automation
- get run by id
- list active runs

### Manager responsibilities

`AutomationManager`

- orchestrates definition-level operations
- validates run policies
- creates manual runs
- bridges repository state to trigger registration

`TriggerRouter`

- accepts events from:
  - scheduler
  - webhook endpoint
  - manual `Run now`
- creates queued runs
- applies run policy decisions

`AutomationExecutor`

- claims queued runs
- creates backing sessions
- updates run lifecycle state
- derives result summary from session review and analysis

### Session integration

Minimal session changes should include:

- attach automation metadata to session creation when the session is launched by
  an automation run
- preserve a lookup from `AutomationRun` to `Session`
- support "Continue in session" by navigating to the run's backing session

The execution model itself should remain session-owned.

## Commands and API

### Automation definition commands

- `automation.list`
- `automation.get`
- `automation.create`
- `automation.update`
- `automation.delete`
- `automation.enable`
- `automation.disable`

### Run commands

- `automation.run.list`
- `automation.run.get`
- `automation.run.start`
- `automation.run.retry`
- `automation.run.stop`

### Webhook API

- `automation.webhook.register`
- `automation.webhook.rotateSecret`
- `POST /api/automation/webhooks/:automationId`

Phase 1 keeps one direct endpoint shape per automation. If later phases need
shared source registries or source-based routing, they can be layered without
changing the run model.

### Event broadcasting

Add two workspace-scoped event families:

- `workspace.{id}.automation.list.changed`
- `workspace.{id}.automation.run.changed`

These events should let the web app update definition lists and run inboxes
without polling.

## Frontend Design

### Product structure

Automation should not be added as another workspace sidebar tab in phase 1.

Reason:

- workspace sidebar views are optimized for current-workspace context
- automations are long-lived definitions
- runs are asynchronous results across sessions
- the interaction model is closer to an operations surface than a sidebar tool

### Entry points

Recommended entry points:

- `Save as Automation` from an existing session
- command palette command to open automations
- `/more` page entry into the automations surface
- notification deep links into run detail

### Primary routes

Add a dedicated top-level route:

- `/automations`

Suggested internal tabs:

- `Runs`
- `Automations`

Example URLs:

- `/automations?tab=runs`
- `/automations?tab=automations`

### Desktop layout

`Runs` view:

- left: filters and status groups
- center: run list
- right: run detail

`Automations` view:

- left: automation list
- right: automation detail, configuration, recent runs

### Mobile layout

Mobile should favor inspection over configuration.

Recommended mobile behavior:

- top-level tabs: `Runs | Automations`
- default to `Runs`
- use full-screen detail pages or sheets
- prioritize:
  - review
  - changes
  - status
  - transcript

This matches current mobile positioning as a monitor/review surface rather than
a heavy authoring surface.

### Run detail tabs

The run detail surface should reuse existing session-derived artifacts:

- `Overview`
- `Transcript`
- `Changes`
- `Review`
- `Analysis`

### Creation flows

Preferred creation flow:

1. user finishes or inspects a manual session
2. user clicks `Save as Automation`
3. the system pre-fills:
   - workspace
   - provider
   - objective
   - optional skills and supervisor preset
4. the user supplies:
   - trigger
   - enable/disable choice
   - run policy

The direct "new automation" flow should also exist, but phase 1 should bias
toward session-derived creation because it better matches the current product.

## Concurrency and Safety

### Default policy

Use conservative defaults:

- one active run per automation
- queue the latest trigger if one arrives during an active run
- do not launch multiple modifying agent runs in the same workspace by default

### Parallel execution

`allow_parallel` may exist in the type model, but phase 1 should treat it as
deferred or guarded.

True parallel execution becomes safe only when combined with:

- isolated worktrees
- clearer conflict policies
- more mature run and approval semantics

### Restart behavior

If the server restarts while runs are `queued`, `starting`, or `running`:

- preserve the run record
- mark the run as `interrupted`
- do not auto-resume in phase 1

This is simpler and more explainable than attempting silent recovery.

## Error Handling

### Trigger failures

- invalid or unauthorized webhook requests do not create runs
- accepted trigger failures should still produce a visible failed run where
  useful for operator understanding

### Execution failures

- session creation failure -> run `failed`
- provider unavailable -> run `failed`
- automation disabled before execution -> run `failed` or canceled-equivalent
  summary in the run record

### Post-processing failures

If review or analysis generation fails:

- do not discard the run
- do not change a successful session into a failed run solely because summary
  generation failed
- surface partial availability in the run detail UI

## Security

Phase 1 security requirements:

- webhook endpoints must validate secrets
- secret rotation must be supported
- manual run and webhook actions should be audit logged
- disabling an automation must be immediate
- automation execution should respect current provider/runtime permissions and
  workspace boundaries

Longer term, isolated worktree execution should become the recommended path for
automations that modify code, but it is not a hard requirement for phase 1.

## Testing

### Backend

- repository tests for automation definition and run persistence
- manager and executor tests for queueing and state transitions
- scheduler tests for schedule trigger handling
- webhook tests for secret validation and run creation
- session-backed integration tests for run-to-session lifecycle and final status
  classification
- command tests for definition and run commands

### Frontend

- automation list rendering and state updates
- runs inbox grouping and filtering
- run detail tab rendering
- `Save as Automation` creation flow
- mobile inspection flow for run detail

## Acceptance Criteria

The v1 MVP is successful when all of the following are true:

1. A user can create an automation from an existing session.
2. A schedule trigger can create a run and its backing session.
3. A webhook trigger can create a run and its backing session.
4. Completed runs expose transcript, changes, and review summary when available.
5. A user can retry a failed run.
6. A user can continue an automation-backed session from run detail.
7. The system preserves visible run history across restarts.

## Rollout Plan

### Phase 0

- hidden or developer-only surface
- validate persistence and state transitions
- validate session-backed execution and event updates

### Phase 1

- `Save as Automation`
- schedule trigger
- webhook trigger
- manual `Run now`
- retry
- continue in session
- runs inbox

### Phase 2

- richer run notifications
- webhook delivery diagnostics
- improved mobile run inspection

### Phase 3

- isolated worktree defaults
- GitHub-native sources
- richer filters and dedupe rules
- more advanced approval and policy controls

## Open Questions Deferred Deliberately

These questions are intentionally deferred, not unresolved bugs in the design:

- whether isolated worktree should become the default in phase 2 or phase 3
- whether webhook sources should evolve into a shared source registry
- how native GitHub or Slack sources should map onto the basic trigger model
- whether runs should support multi-step approval checkpoints

Deferring them keeps phase 1 focused on proving the core value:

`automatic trigger -> session-backed run -> reviewable result`
