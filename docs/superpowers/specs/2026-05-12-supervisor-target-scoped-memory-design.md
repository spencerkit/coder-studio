# Supervisor Target-Scoped Memory Design

## Goal

Improve supervisor quality and observability by replacing the current effectively stateless, terminal-snapshot-only supervision loop with a lightweight target-scoped memory model stored in the workspace directory.

This design intentionally does **not** use git state as a primary supervision signal. It also avoids a heavyweight planner / workflow engine. The target is a simpler supervisor that can remember what it is supervising, where it believes the work currently stands, and why it decided to continue or stop.

## Why Change

The current supervisor pipeline already has a solid runtime skeleton:

- session-bound supervisor lifecycle and commands
- cycle persistence
- retry attempts
- evaluator subprocess execution
- guidance injection into the running session

However, the evaluation logic still behaves like a mostly stateless reviewer:

- each cycle primarily inspects the latest terminal snapshot
- only the latest submitted user input is carried forward
- prior supervision conclusions are not represented as durable working memory
- the UI shows very little of how a cycle conclusion was reached

This causes two practical problems:

1. Supervision quality is unstable because each cycle is close to a fresh read of terminal output.
2. Observability is weak because users cannot easily see what the supervisor thinks the current plan is, what progress it has observed, or why it chose to continue or stop.

## Scope

This design covers:

- target-scoped supervisor memory
- workspace-directory persistence under `.coder-studio/supervisor/targets/`
- first-trigger plan bootstrap
- simplified evaluator result model: `continue` or `stop`
- cycle history format for observability
- command semantics when the supervised objective changes

This design does **not** cover:

- multi-target concurrent UX in a single session
- syncing supervisor memory across machines
- long-term knowledge retrieval or semantic memory
- using git state as a required supervision input

## Core Model

The design separates four concepts that are currently too blurred together.

### Session

The execution host. A session is where the agent runs and where supervisor guidance is injected.

### Supervisor

The runtime controller attached to a session. It owns lifecycle and operational state such as:

- enabled / disabled
- paused / resumed
- evaluating / idle / error

The supervisor remains session-attached.

### Target

A single supervised objective instance. This is the true owner of supervision memory.

Targets are:

- created when the user enables supervisor for an objective
- identified by a generated `targetId`
- invalidated and replaced when the objective materially changes

### Memory

The durable working state for a single target. Memory tracks the current lightweight plan, active step, recent progress summary, last guidance, and stalled count.

The memory is **target-scoped**, not session-scoped.

## Storage Model

Supervisor memory and history live in the workspace directory, not in the database.

### Directory Layout

```text
.coder-studio/
  supervisor/
    targets/
      <targetId>/
        meta.json
        memory.json
        cycles.jsonl
```

### Why Workspace Storage

This fits the nature of supervision memory better than database-only storage:

- it follows the project
- it is easy to inspect manually
- it survives session replacement
- it is naturally target-scoped
- it avoids treating project supervision state as server-only runtime metadata

The database may still retain runtime supervisor state, but target memory and supervision history should be file-backed.

## File Responsibilities

### `meta.json`

Identity and lifecycle metadata for the target.

Example:

```json
{
  "targetId": "tgt_20260512_abcd123",
  "sessionId": "sess_123",
  "workspaceId": "ws_123",
  "objective": "Optimize supervisor quality and observability",
  "status": "active",
  "createdAt": 1747000000000,
  "updatedAt": 1747000000000,
  "supersededBy": null,
  "completedAt": null
}
```

Recommended status values:

- `active`
- `completed`
- `cancelled`
- `superseded`

### `memory.json`

The minimal durable working memory for the target.

Example:

```json
{
  "targetId": "tgt_20260512_abcd123",
  "planGenerated": true,
  "plan": [
    { "id": "step-1", "title": "Review current supervisor behavior", "status": "done" },
    { "id": "step-2", "title": "Design target-scoped memory", "status": "in_progress" },
    { "id": "step-3", "title": "Define cycle observability", "status": "pending" }
  ],
  "activeStepId": "step-2",
  "progressSummary": "Current behavior review is complete; memory and lifecycle design is in progress",
  "lastGuidance": "Define target lifecycle and stop semantics",
  "stalledCount": 0,
  "updatedAt": 1747000000000
}
```

Recommended fields:

- `targetId`
- `planGenerated`
- `plan`
- `activeStepId`
- `progressSummary`
- `lastGuidance`
- `stalledCount`
- `updatedAt`

Fields intentionally excluded:

- raw terminal snapshots
- git summaries
- retry history
- long reasoning logs
- transient runtime state such as `evaluating` or `paused`

### `cycles.jsonl`

Append-only supervision history for observability. One JSON object per line.

Example continue result:

```json
{
  "cycleId": "cycle_xxx",
  "targetId": "tgt_20260512_abcd123",
  "startedAt": 1747000000000,
  "completedAt": 1747000005000,
  "result": "continue",
  "stopReason": null,
  "reason": "The target design is partially complete but command semantics are not yet defined",
  "guidance": "Define how supervisor.update should behave when the objective changes",
  "progressSummary": "Target-scoped memory and first-trigger plan bootstrap are now defined",
  "activeStepId": "step-2",
  "stepUpdates": [
    { "id": "step-1", "status": "done" },
    { "id": "step-2", "status": "in_progress" }
  ],
  "injected": true,
  "attemptCount": 1
}
```

Example stop result:

```json
{
  "cycleId": "cycle_yyy",
  "targetId": "tgt_20260512_abcd123",
  "startedAt": 1747000010000,
  "completedAt": 1747000013000,
  "result": "stop",
  "stopReason": "objective_complete",
  "reason": "The target has been completed and no further supervision is needed",
  "guidance": null,
  "progressSummary": "The design is complete",
  "activeStepId": "step-3",
  "stepUpdates": [
    { "id": "step-3", "status": "done" }
  ],
  "injected": false,
  "attemptCount": 1
}
```

Example runtime failure record:

```json
{
  "cycleId": "cycle_err",
  "targetId": "tgt_20260512_abcd123",
  "startedAt": 1747000020000,
  "completedAt": 1747000029000,
  "result": "error",
  "errorReason": "Supervisor evaluator timed out after 600000ms",
  "attemptCount": 3
}
```

## Evaluation Inputs

The new supervisor should only use four primary inputs:

- current `objective`
- latest submitted user input
- current terminal snapshot
- target memory

Git state should not be part of the primary supervision signal.

Git information may still exist as optional debug-only context, but it should not participate in the normal decision path because workspace changes may not belong to the supervised agent or current target.

## Plan Bootstrap

The target plan should **not** be generated when supervisor is enabled.

Instead, plan generation happens on the **first trigger**.

### Why First Trigger

- enabling supervisor should stay lightweight
- the first real supervision pass has fresher terminal evidence
- this avoids generating plans that are stale before supervision even begins

### First Trigger Flow

When `supervisor.trigger` runs against a target whose `memory.planGenerated` is `false`:

1. load target metadata
2. gather objective, latest user input, and terminal snapshot
3. generate a lightweight plan with 3 to 7 steps
4. write `memory.json`
5. continue directly into the same supervision cycle

The generated plan should be milestone-oriented, not overly granular.

## Ongoing Memory Update Rules

After bootstrap, normal cycles should update memory incrementally rather than regenerating the full plan.

### Allowed updates

- step status changes
- `activeStepId`
- `progressSummary`
- `lastGuidance`
- `stalledCount`

### Disallowed behavior

- rewriting the entire plan every cycle
- drifting the target objective
- using cycle history as memory instead of a separate working state

### `stalledCount`

Increment `stalledCount` when the cycle finds no meaningful visible progress, for example:

- active step stays unchanged
- no step advances to `done`
- progress summary does not reflect a concrete new outcome

Reset `stalledCount` to `0` when a cycle observes clear progress.

## Simplified Evaluator Result Model

The evaluator result model should stay narrow.

The supervisor only needs two outcomes:

- `continue`
- `stop`

`stop` must include a reason.

### Recommended stop reasons

- `objective_complete`
- `supervisor_uncertain`
- `needs_user_input`

### Continue result example

```json
{
  "status": "continue",
  "reason": "The lifecycle design is complete but the command semantics are still missing",
  "guidance": "Define how objective edits supersede an existing target"
}
```

### Stop result example

```json
{
  "status": "stop",
  "stopReason": "objective_complete",
  "reason": "The current supervision target is complete"
}
```

Runtime failures such as timeout, abort, or evaluator errors are not business decisions and should remain runtime/cycle concerns rather than part of the evaluator decision vocabulary.

## Target Lifecycle

### Create

`supervisor.create`:

- creates a new runtime supervisor
- generates a `targetId`
- creates the target directory
- writes `meta.json`
- either omits `memory.json` or writes a minimal file with `planGenerated: false`

### First Trigger

`supervisor.trigger`:

- bootstraps the plan if needed
- runs the normal cycle
- updates `memory.json`
- appends a line to `cycles.jsonl`

### Subsequent Trigger

Later triggers:

- reuse existing plan
- update step state and progress
- either continue with guidance or stop the target

### Objective Change

An objective change should **not** reuse the old memory.

When the objective materially changes:

1. mark the old target as `superseded`
2. create a new target with a new `targetId`
3. initialize new target metadata
4. leave plan generation deferred until first trigger on the new target

This is the key reason the design is target-scoped: once the objective changes, prior memory becomes untrustworthy.

### Delete / Disable

`supervisor.delete`:

- disables the runtime supervisor
- marks the active target as `cancelled` or archives it

The target directory does not need to be physically deleted immediately.

### Evaluator Stop

When the evaluator returns `stop`:

- the target is marked completed or ended for the given stop reason
- the runtime supervisor transitions accordingly

## Relationship to Existing Runtime State

Target memory and target history move to the workspace directory.

Database-backed runtime state may still exist for:

- whether a supervisor is enabled for the session
- current runtime state such as `idle`, `paused`, `evaluating`, `error`
- current evaluator provider and model
- the currently active `targetId`

This preserves the existing supervisor runtime control flow while shifting long-lived target cognition out of the database.

## UI Design

The UI should stop presenting only the latest one-line cycle result.

Recommended minimum surface:

### Current Target

- objective
- active step
- `progressSummary`
- `stalledCount`

### Plan

- list of current steps
- clear status display
- active step highlighted

### Recent Cycles

- recent `continue`, `stop`, or `error` results
- per-cycle `reason`
- per-cycle `guidance` when continuing
- `stopReason` when stopping
- `errorReason` when runtime failure occurs

This gives users visibility into:

- what the supervisor believes the current target is
- where it thinks work stands
- why it decided to continue or stop
- whether supervision has been stalled across multiple cycles

## Implementation Notes

This design can be introduced incrementally.

Recommended order:

1. add `targetId` ownership and target directory layout
2. add file-backed `meta.json` and `memory.json`
3. move first-plan generation to first trigger
4. change evaluator output from plain text to structured `continue` / `stop`
5. append `cycles.jsonl`
6. update UI to read and render current plan and recent cycle history

## Risks and Tradeoffs

### Benefits

- better supervision continuity across cycles
- clearer project-local ownership of memory
- easier manual inspection and debugging
- simpler mental model than a fully general planner

### Risks

- file format evolution must be handled carefully
- concurrent writes need serialization if multiple runtime paths touch the same target files
- target lifecycle and runtime supervisor lifecycle are now distinct and must stay synchronized

## Open Constraints Chosen Deliberately

The design intentionally chooses:

- target-scoped memory over session-scoped memory
- workspace files over database-backed cognition
- first-trigger plan bootstrap over enable-time planning
- `continue` / `stop` over a larger decision taxonomy
- no git signal in normal supervision

These constraints keep the design narrow, inspectable, and aligned with the actual job of supervisor: guide the current target forward until it should stop.
