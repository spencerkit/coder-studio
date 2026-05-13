# Supervisor Execution Policy Design

## 1. Goal

Extend the current supervisor feature so a single supervisor session can:

- cap total supervision cycles with `maxSupervisionCount`
- optionally schedule one extra automatic run at a specific date/time
- optionally override the evaluator model per supervisor
- pause even while evaluation/injection/retry wait is in progress
- stop permanently once the evaluator declares the objective complete
- use global retry settings for timeout/evaluator failures
- preserve existing data through a lightweight `v1 -> v2` database upgrade

This design intentionally keeps the new behavior narrow:

- retry policy stays global in Settings
- `turn_completed` auto-trigger remains always-on and is not configurable
- scheduled execution is one-shot, not cron and not fixed interval
- unknown database versions are not auto-repaired; the app offers delete-and-rebuild instead

## 2. Current Baseline

Current supervisor behavior is implemented mainly in:

- `packages/server/src/supervisor/manager.ts`
- `packages/server/src/supervisor/scheduler.ts`
- `packages/server/src/supervisor/evaluator.ts`
- `packages/server/src/storage/repositories/supervisor-repo.ts`
- `packages/server/src/storage/repositories/supervisor-cycle-repo.ts`
- `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`

Today:

- a supervisor stores `objective` and `evaluatorProviderId`
- auto-run happens only on `turn_completed`
- evaluator timeout is global
- retry does not exist
- scheduled execution does not exist
- pausing during an in-flight evaluation is not supported
- evaluator model is inherited from provider config only
- returning `"[objective complete]"` does not stop the whole supervisor lifecycle

## 3. Requirements

### 3.1 Per-supervisor persisted fields

Each supervisor must persist:

- `objective`
- `evaluatorProviderId`
- `evaluatorModel` as an optional override
- `maxSupervisionCount`
- `scheduledAt` as an optional one-shot timestamp

### 3.2 Global settings

Retry policy remains global and is read from Settings:

- `supervisor.evaluationTimeoutSec`
- `supervisor.retryEnabled`
- `supervisor.retryMaxCount`
- `supervisor.retryDelaySec`
- `supervisor.retryOnTimeout`
- `supervisor.retryOnEvaluatorError`

### 3.3 Behavior rules

- `turn_completed` automatic supervision remains enabled by default and is not configurable.
- If `scheduledAt` is configured, that timestamp triggers one extra automatic cycle.
- `maxSupervisionCount = 0` means unlimited, preserving current behavior.
- If evaluator returns `"[objective complete]"`, the current cycle ends successfully and the whole supervisor stops permanently.
- If the evaluator has not declared completion and retry policy still allows retry, retry continues until:
  - retry succeeds
  - retry budget is exhausted
  - user pauses
  - user deletes supervisor
  - session disappears
- Pausing must work while evaluating, injecting, or waiting for the next retry.

## 4. Configuration Ownership

### 4.1 Settings page

Settings owns environment-wide execution defaults and safety limits:

- evaluator timeout
- retry enablement
- retry count
- retry delay
- retry on timeout
- retry on evaluator error

Settings does not own:

- supervisor model override
- max supervision count
- scheduled execution time

### 4.2 Supervisor session

The objective dialog and the stored supervisor record own:

- objective
- evaluator provider
- optional evaluator model override
- max supervision count
- optional scheduled execution time

No supervisor-local retry settings are introduced in this phase.

## 5. Trigger Model

Supervisor cycles can start from three trigger sources:

- `manual`
- `turn_completed`
- `scheduled`

`turn_completed` remains the default continuous trigger. `scheduledAt` adds a one-shot trigger and does not disable `turn_completed`.

If `scheduledAt` fires successfully, the field is consumed and cleared. The scheduled trigger does not repeat.

## 6. Completion and Stop Semantics

### 6.1 Objective-complete handling

`packages/server/src/supervisor/evaluator.ts` already instructs the evaluator to return `"[objective complete]"` when the objective is done. This must become a first-class control path.

When that sentinel is returned:

- do not inject more work
- do not retry
- finalize the current cycle as successful
- stop the whole supervisor

### 6.2 Max supervision count

`maxSupervisionCount` counts completed cycle starts, not retry attempts.

- `0` means unlimited
- positive values mean hard cap

Before a new cycle starts, the manager checks the limit. If the cap is reached:

- no new cycle is created
- supervisor transitions to stopped
- stop reason is recorded

### 6.3 New supervisor stop state

Add a terminal supervisor state:

- `stopped`

Add a persisted stop reason:

- `objective_complete`
- `max_supervision_count_reached`
- `null`

`stopped` is distinct from `paused`:

- `paused` means user temporarily halted execution
- `stopped` means the supervisor has logically finished and should no longer auto-run

## 7. Pause Semantics

Current `pause()` only flips state. It must also interrupt active work.

New pause behavior:

- if evaluating: abort evaluator process immediately
- if injecting: abort the in-flight sequence as soon as possible and prevent further retry
- if waiting between retries: cancel the timer immediately
- final supervisor state becomes `paused`

Cycle result for a user-initiated interruption should be:

- `cancelled`

This avoids conflating user intent with actual evaluator failure.

## 8. Retry Model

Retry is global, but execution is cycle-local.

Each new cycle snapshots the current retry settings at cycle start. Mid-cycle Settings changes do not affect already-running retries.

### 8.1 Retry scope

Automatic retry applies only to:

- evaluator timeout
- evaluator process/runtime failure

Automatic retry does not apply to:

- injector failure
- invalid provider configuration
- missing session/supervisor
- user pause/delete

### 8.2 Retry loop

One cycle contains one or more attempts:

1. build context
2. run evaluator
3. if evaluator returns `"[objective complete]"`, stop supervisor
4. if evaluator returns actionable text, continue into injection
5. if evaluator fails and retry policy allows, wait `retryDelaySec`
6. rerun evaluator inside the same cycle

### 8.3 Attempt recording

Add a new table to persist attempt history per cycle:

- `supervisor_cycle_attempts`

Suggested columns:

- `id TEXT PRIMARY KEY`
- `cycle_id TEXT NOT NULL`
- `attempt_index INTEGER NOT NULL`
- `status TEXT NOT NULL`
- `started_at INTEGER NOT NULL`
- `completed_at INTEGER`
- `error_reason TEXT`
- `provider_model TEXT`

This keeps the cycle as the user-facing supervision event while preserving retry detail for debugging and later UI.

## 9. Model Override

Each supervisor may optionally provide an evaluator model override.

Rules:

- if `evaluatorModel` is empty or null, use current provider config behavior unchanged
- if `evaluatorModel` is set, it overrides the provider config model only for supervisor evaluation
- it does not affect the business agent session model

Implementation impact:

- `packages/server/src/supervisor/evaluator.ts` builds an effective provider config for evaluation
- provider command builders receive the overridden model if supported

UI should not try to ship a provider-specific model catalog in this phase. A plain optional text input is enough.

## 10. Scheduler Design

Current scheduler only subscribes to `session.lifecycle.turn_completed`.

It should be extended to support:

- event-driven trigger on `turn_completed`
- one-shot timestamp trigger on `scheduledAt`

Recommended implementation:

- keep the existing event-bus subscription
- add an in-memory nearest-deadline timer
- on hydrate/create/update/delete/pause/resume/stop, recalculate the next due `scheduledAt`

Do not implement:

- cron parsing
- fixed-interval polling loops
- per-second global scan

## 11. Data Model Changes

### 11.1 Core domain

Update `packages/core/src/domain/supervisor.ts`:

- add `scheduled` to `CycleTrigger`
- add `cancelled` to `CycleStatus`
- add `stopped` to `SupervisorState`
- add `evaluatorModel?: string`
- add `maxSupervisionCount: number`
- add `completedSupervisionCount: number`
- add `scheduledAt?: number`
- add `stopReason?: "objective_complete" | "max_supervision_count_reached"`

### 11.2 Storage schema

Update `supervisors` table:

- `evaluator_model TEXT`
- `max_supervision_count INTEGER NOT NULL DEFAULT 0`
- `completed_supervision_count INTEGER NOT NULL DEFAULT 0`
- `scheduled_at INTEGER`
- `stop_reason TEXT`

Add new table `supervisor_cycle_attempts`.

`supervisor_cycles` remains the top-level event record. It may need enum/test updates for `scheduled` and `cancelled`, but not necessarily new columns in this phase.

## 12. Database Upgrade Strategy

This work must support migration/upgrade. It should stay deliberately lightweight.

### 12.1 Supported path

Only support:

- empty database -> latest schema
- known `v1` supervisor schema -> `v2`

Do not restore the old `_migrations` chain and do not add generic migration scanning.

### 12.2 Startup decision matrix

On startup:

1. empty database
- initialize latest schema

2. known `v1`
- run automatic `v1 -> v2` upgrade

3. latest `v2`
- continue normally

4. unknown or incompatible schema
- do not guess
- surface a rebuild choice to the user

### 12.3 Unknown schema handling

Keep it simple:

- backend returns a specific incompatible-schema startup error
- UI or CLI offers:
  - delete and rebuild database
  - cancel

No automatic repair, no automatic backup flow, no generic downgrade path.

### 12.4 `v1 -> v2` upgrade contents

Upgrade should be explicit and transactional:

- add new columns on `supervisors`
- create `supervisor_cycle_attempts`
- initialize defaults:
  - `max_supervision_count = 0`
  - `completed_supervision_count = 0`
  - `stop_reason = NULL`
- set new schema version marker

After upgrade, run normal latest-schema validation.

## 13. Command and API Changes

Update `packages/server/src/commands/supervisor.ts`:

- `supervisor.create`
  - accept optional `evaluatorModel`
  - accept `maxSupervisionCount`
  - accept optional `scheduledAt`
- `supervisor.update`
  - same fields as mutable edits
- `supervisor.get`
  - return new fields

Validation:

- `maxSupervisionCount` must be an integer `>= 0`
- `scheduledAt` must be a valid timestamp or omitted
- `evaluatorModel` may be empty in the UI but should persist as `null`

## 14. Frontend Changes

Update the shared objective dialog:

- keep objective textarea
- keep evaluator provider selection
- add optional model input
- add max supervision count input
- add one-shot schedule input

Settings page gains a bounded retry configuration section:

- retry enabled
- retry count
- retry delay
- retry on timeout
- retry on evaluator error
- evaluation timeout

Supervisor card and mobile sheet should also understand:

- `stopped` state
- stop reason display
- cancelled latest cycle

## 15. State Machine Summary

### 15.1 Supervisor

Main states after this change:

- `idle`
- `evaluating`
- `injecting`
- `paused`
- `error`
- `stopped`

Transitions:

- `idle -> evaluating`
- `evaluating -> injecting`
- `evaluating -> paused` on user pause
- `injecting -> paused` on user pause
- `evaluating/injecting -> error` on unrecoverable failure
- `evaluating/injecting -> stopped` on objective completion
- `idle -> stopped` on max supervision cap reached before next cycle

### 15.2 Cycle

Cycle statuses after this change:

- `evaluating`
- `completed`
- `injected`
- `failed`
- `cancelled`

Retry attempts do not create new cycles.

## 16. Out of Scope

This phase explicitly does not include:

- cron expressions
- repeating intervals
- per-supervisor retry policy
- provider-specific model discovery UI
- generic database migration framework reintroduction
- automatic repair of unknown database schemas

## 17. Testing

### 17.1 Storage and startup

- empty DB initializes directly to latest schema
- known `v1` DB upgrades to `v2`
- unknown DB surfaces incompatible-schema rebuild flow
- upgraded DB passes latest schema validation

### 17.2 Manager behavior

- `maxSupervisionCount = 0` behaves as unlimited
- cap reached stops supervisor
- `"[objective complete]"` stops supervisor immediately
- retry obeys global Settings
- retry only applies to configured evaluator failure classes
- pause during evaluation aborts current work and lands in `paused`
- pause during retry wait cancels pending retry

### 17.3 Scheduler

- `turn_completed` still triggers automatically
- `scheduledAt` triggers once and is consumed
- stopped supervisors do not auto-trigger again
- paused supervisors do not auto-trigger until resumed

### 17.4 Frontend

- objective dialog submits and rehydrates new fields
- settings page saves retry settings
- supervisor card renders stopped state and reason
- mobile supervisor sheet mirrors the same behavior

## 18. Recommended Implementation Order

1. add lightweight DB version upgrade support for `v1 -> v2`
2. update core domain types
3. update storage schema and repositories
4. extend evaluator model override support
5. refactor manager into cycle + retry execution flow
6. extend scheduler with one-shot time trigger
7. wire WS commands and validation
8. update supervisor dialog and settings UI
9. add tests across startup, manager, scheduler, commands, and UI
