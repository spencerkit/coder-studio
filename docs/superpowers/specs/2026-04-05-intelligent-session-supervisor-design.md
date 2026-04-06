# Intelligent Session Supervisor Design

**Date:** 2026-04-05

**Status:** Draft for review

## Goal

Add an intelligent supervisor mode for a business terminal session.

When enabled, the system launches a dedicated supervisor agent through shell, watches the business terminal session turn by turn, and after each completed turn asks the supervisor to produce the next message that should be sent to the business agent. That message is then injected back into the business terminal session automatically so the business agent can continue working.

The first version is intentionally focused on long-running execution workflows such as coding, bug fixing, testing, and iterative task completion.

## Product definition

This feature is a **one-to-one supervisor system for terminal-based agent sessions**.

- each business session can optionally enable supervisor mode
- each enabled business session gets exactly one dedicated supervisor agent
- the supervisor agent can be backed by Claude or Codex
- the business session remains the primary execution surface
- the supervisor exists to observe, evaluate, and push the next step

Core loop:

1. the business terminal finishes a turn
2. the system composes the supervision context
3. the supervisor returns the next message that should be sent to the business agent
4. the system injects that message into the business terminal
5. the business session continues

This is not a general workflow engine in v1. It is a narrowly scoped execution supervisor for long-running terminal sessions.

## User-facing behavior

### Enable supervisor mode

A user can enable supervisor mode for a single business session.

Supervisor startup has a required setup step before launch.

The user provides one natural-language objective entry in a single input box.

That entry may include, in the user's own words:

- the overall goal
- boundaries and non-goals
- priorities
- acceptance expectations

Without this objective entry, supervisor mode cannot start.

When enabled:

- the system stores the raw user objective text
- the system composes an objective prompt from that text
- the system starts a supervisor agent through shell
- the session becomes supervisor-managed
- the UI exposes a management tab for that session

### Ongoing supervision

After every completed business turn:

- the system captures the completed turn context
- the system includes the active objective prompt
- the system invokes the supervisor agent for that turn
- the supervisor returns the next message for the business agent
- if a valid message is returned, the system injects it into the business terminal automatically
- the business session continues without requiring manual user confirmation

### Visibility

The business session is shown directly in xterm and remains the main execution surface.

The system must not create a separate chat-style business session UI for this feature.

Supervisor activity must remain visible and traceable:

- the business terminal shows real input and output streams
- supervisor-injected input must be visually distinguishable from manual user input with a lightweight marker
- the management tab shows status, recent supervisor output, logs, and recovery actions

## UX design

### Main layout

Each supervised session uses two tabs:

1. **Business Terminal**
2. **Management Panel**

The Business Terminal tab stays primary.

The Management Panel exists for control, inspection, and recovery. It should not replace the terminal as the main work surface.

### Business Terminal tab

The Business Terminal tab reuses the existing xterm-based terminal.

It must:

- display the real terminal input and output stream
- show continued agent execution naturally after supervisor injection
- distinguish supervisor-injected input from manual user input with a lightweight marker or prefix

The terminal should feel like the real live execution surface, not a reconstructed message feed.

### Management Panel tab

The Management Panel shows the supervisor state and recent activity.

It contains four sections.

#### 1. Status header

Displays:

- supervisor mode status
- supervisor agent type
- auto-inject enabled state
- last completed supervision time

Actions:

- enable
- pause
- resume
- disable
- retry last failed cycle

#### 2. Current or latest cycle card

Displays:

- source business turn reference
- summarized supervision input
- supervisor reply message
- injection result
- timestamps

#### 3. Timeline log

A reverse chronological event list showing:

- business turn completed
- supervision started
- supervisor reply received
- injection succeeded or failed
- pause, resume, disable, and retry actions

#### 4. Light configuration area

v1 configuration should remain intentionally small:

- supervisor provider: Claude or Codex
- editable objective text
- objective prompt preview
- auto-inject enabled
- optional retry-on-error toggle

The objective text is editable after startup. Saving changes causes the system to recompose the objective prompt. The new version takes effect from the next supervision cycle forward and does not rewrite past cycle records.

Do not add advanced strategy templates, multi-stage control flows, or large tuning surfaces in v1.

## Scope and non-goals

### In scope for v1

- one business session can enable one supervisor
- shell-launched supervisor agent
- required objective entry before startup using a single natural-language input box
- system-composed objective prompt derived from the user's objective text
- support Claude or Codex as supervisor backend
- automatic supervision after every completed business turn
- automatic injection back into the business terminal
- editing the active objective text for future cycles
- management panel with state, logs, latest cycle details, and basic controls
- recovery behavior for pause, resume, retry, and failure display

### Out of scope for v1

- one supervisor managing multiple business sessions
- multiple supervisors per business session
- user approval before every injection
- scoring systems, grading dashboards, or planner frameworks
- general workflow orchestration across unrelated tasks
- goal-achieved auto-stop logic
- complex strategy templates or policy libraries

## State model

### Supervisor binding

A durable record that says a business session has supervisor mode enabled.

Suggested fields:

- `sessionId`
- `supervisorSessionId`
- `provider`
- `objectiveText`
- `objectivePrompt`
- `objectiveVersion`
- `status`
- `autoInjectEnabled`
- `createdAt`
- `updatedAt`

Purpose:

- identify whether a session is supervised
- associate the business session with the supervisor runtime
- store the active user intent and active composed objective prompt
- restore visible state after refresh or restart

### Supervisor cycle

A record of one supervision loop.

Suggested fields:

- `cycleId`
- `sessionId`
- `sourceTurnId`
- `objectiveVersion`
- `supervisorInput`
- `supervisorReply`
- `injectionMessageId` or injection record id
- `status`
- `startedAt`
- `finishedAt`
- optional error details

Purpose:

- power logs and the latest cycle card
- support retry and failure diagnosis
- preserve traceability for automatic injections
- record which objective version the cycle evaluated against

## Objective lifecycle

The supervision objective is a first-class part of the feature.

### Startup input

The user sets the objective during supervisor startup through a single input box.

The user writes one natural-language objective entry that can describe the intended outcome, boundaries, priorities, completion expectations, and anything the supervisor should keep in mind.

This makes the objective a required launch input rather than an optional note.

### Objective composition

The system does not supervise directly against raw UI fields.

Instead it:

1. stores the user's raw objective text
2. composes a stable objective prompt from that text
3. uses the composed objective prompt as the fixed supervision context for every cycle

The composed prompt is the canonical instruction the supervisor evaluates against.

### How the supervisor keeps using it

The active objective prompt is included in every supervision input package.

That means the supervisor does not need to rely on long-term memory to remember the goal. Even if session history grows, each cycle receives the current objective again.

### Editing the objective

The user may edit the objective text after supervisor startup from the management panel.

Editing flow:

1. the user opens `Edit Objective`
2. the current objective text is prefilled in a single input box
3. the user rewrites or appends new intent in natural language
4. the system saves the new raw text
5. the system recomposes the objective prompt
6. `objectiveVersion` increments
7. the new objective takes effect from the next supervision cycle

Rules:

- if no cycle is currently running, the new objective becomes active immediately for the next trigger
- if a cycle is already running, that cycle finishes with the old objective and the new version is marked pending for the next cycle
- old cycle records keep the `objectiveVersion` they were evaluated against
- editing the objective does not retroactively rewrite logs or prior supervisor outputs

This gives the user a clean way to change direction without forcing supervisor restart.

## Runtime architecture

The system should be split into clear, focused units.

### 1. TurnObserver

Responsibility:

- detect when a business terminal turn starts and ends
- determine when streamed output is actually complete
- emit a `turn.completed` event only once per completed turn

Why it exists:

- the supervisor must run only after a real turn boundary
- the trigger logic must not be scattered through UI or transport code

### 2. SupervisorOrchestrator

Responsibility:

- decide whether supervision should run for a completed turn
- ensure only one supervision cycle is active at a time per business session
- assemble the supervisor input package
- call the supervisor adapter
- hand valid output to injection
- transition state and record logs

Why it exists:

- it centralizes business rules for triggering, deduplication, retries, and recovery
- future upgrades such as strategy switching or stopping conditions can hang off this unit cleanly

### 3. SupervisorAgentAdapter

Responsibility:

- hide differences between Claude-backed and Codex-backed supervisor invocations
- expose a small common interface for one-shot supervision turns

Suggested interface:

- `invoke(turnContext)`
- `healthCheck()`

Why it exists:

- the orchestrator and UI should not care which provider is backing the supervisor
- v1 supervision is turn-scoped, so the adapter should not require a long-lived supervisor terminal session

### 4. InjectionDispatcher

Responsibility:

- take the supervisor output and inject it into the business terminal session
- tag it as supervisor-originated input
- enforce idempotency so the same cycle does not inject twice

Why it exists:

- injection is high impact and must be reliable, visible, and auditable

### 5. Supervisor state store

Responsibility:

- persist bindings and recent cycle records
- restore visible status after page refresh or backend restart

This store may share infrastructure with current session persistence, but the supervisor state model should remain its own clear concept.

## Data flow

For each completed business turn, the system follows this flow:

1. TurnObserver detects that terminal output for the turn has completed
2. TurnObserver emits `turn.completed`
3. SupervisorOrchestrator checks whether the session is supervisor-managed and active
4. Orchestrator verifies no other cycle is currently in flight for the same business session
5. Orchestrator builds a structured supervision package using the active objective prompt plus current turn context
6. Orchestrator invokes the SupervisorAgentAdapter for this turn
7. Adapter returns the next message that should be sent to the business agent
8. InjectionDispatcher injects that message into the business terminal
9. the cycle is recorded as success or failure
10. the business terminal continues executing with the injected message

## Supervisor invocation model

v1 does not require a long-lived supervisor terminal session.

Instead, supervision is turn-scoped:

1. a business turn completes
2. the system assembles the active objective prompt plus turn context
3. the system launches or invokes the supervisor agent for that single turn
4. the supervisor returns one reply message for the business agent
5. the system injects that reply into the business terminal
6. the supervisor invocation ends

This means supervisor mode is durable, but the supervisor process itself does not need to stay alive between turns.

Implications:

- no dedicated xterm view is needed for the supervisor in v1
- the management panel is enough for status, last reply, and error reporting
- backend recovery is simpler because the system restores bindings and cycle records, not a long-lived supervisor shell session
- objective drift is reduced because every turn invocation receives the current objective prompt again

## Supervisor input package

Do not forward raw unlimited terminal history in v1.

The supervisor should receive a structured package with bounded content.

Required contents:

- active objective prompt
- current `objectiveVersion`
- most recent user input or controlling instruction
- most recent business agent output summary
- current progress or state summary
- optional last supervisor reply
- explicit instruction telling the supervisor to evaluate progress against the active objective prompt and produce the next message that should be sent to the business agent

Expected behavior:

- keep the supervisor focused on immediate forward progress
- reduce noise and token cost
- avoid unstable behavior caused by overly large raw transcripts
- avoid dependence on the supervisor remembering the original goal from startup time alone

## Status machine

The supervisor state machine for v1 is:

- `inactive` — supervisor mode is not enabled
- `idle` — supervisor mode is enabled and waiting for the next completed business turn
- `evaluating` — a turn-scoped supervisor invocation is running
- `injecting` — a valid supervisor reply is being injected into the business terminal
- `paused` — supervisor mode is enabled but automatic cycles are suspended
- `error` — the supervisor pipeline failed and requires user action or retry

### State transition rules

- `inactive -> idle` when user enables supervisor mode successfully
- `idle -> evaluating` when a completed business turn triggers supervision
- `evaluating -> injecting` when the supervisor returns a valid reply
- `injecting -> idle` when injection succeeds
- `idle -> paused` when user pauses supervision
- `paused -> idle` when user resumes supervision
- `evaluating -> error` when supervisor invocation fails or returns an unusable reply
- `injecting -> error` when injection fails
- `error -> idle` when retry succeeds
- any non-inactive state -> `inactive` when user disables supervision or the business session is fully closed

## Failure handling

v1 must explicitly handle these cases.

### Supervisor startup failure

- binding enters `error`
- management panel shows failure reason
- user can retry or disable supervision

### Supervisor invocation failure or unusable reply

- the cycle is recorded as failed
- no empty or unusable message is injected
- the binding moves to `error` or remains retryable according to product policy, but the outcome must be explicit in the UI

### Injection failure

- preserve the supervisor reply for retry
- do not silently drop the message
- transition to `error`
- show a retry action in the management panel

### Business session closed

- end supervisor mode cleanly
- mark the binding inactive or removed according to session lifecycle rules
- do not leave orphaned pending cycles

### Page refresh

- restore binding state and recent cycle state in the UI
- if a cycle is in progress, surface that state correctly rather than pretending nothing is happening

### Backend restart

- restore binding and recent cycle records
- do not require recovery of a long-lived supervisor shell session
- the next completed business turn can invoke supervision again using the active objective prompt

## Core product rules

The following rules must hold.

1. A business session can have at most one supervisor mode binding in v1.
2. A supervisor mode binding can supervise only one business session in v1.
3. Supervisor startup requires one natural-language objective entry.
4. The system must compose a canonical objective prompt from that entry.
5. Only one supervision cycle may be in flight for a business session at a time.
6. Supervision runs only after a true completed turn boundary.
7. Every cycle must evaluate against the active objective prompt.
8. Every successful cycle returns one message intended for the business agent.
9. Empty or invalid supervisor replies must never be injected.
10. Supervisor-originated terminal input must be distinguishable from user-originated input.
11. Automatic injection must be traceable through cycle logs and UI state.
12. Failure states must preserve enough context for retry and diagnosis.

## Testing requirements

The implementation must prove the following behaviors.

### Unit and integration coverage

- enabling supervision requires objective text in the startup input
- enabling supervision composes and stores an objective prompt
- enabling supervision creates the expected binding and supervisor mode state
- a completed business turn triggers exactly one supervision cycle
- duplicate turn completion events do not cause duplicate injections
- every cycle includes the active objective prompt in the supervisor input package
- the system invokes the supervisor in a turn-scoped way and does not require a long-lived supervisor terminal session
- editing the objective recomposes the objective prompt, increments `objectiveVersion`, and affects only future cycles
- a cycle already in flight continues using its original objective version
- a valid supervisor reply is injected into the correct business terminal session
- invalid or empty supervisor replies are rejected without injection
- supervisor-originated input is tagged distinctly from manual input
- pause stops automatic supervision
- resume restarts automatic supervision
- disabling supervision stops supervisor mode cleanly
- supervisor invocation failure enters `error` or explicit retryable failure state
- injection failure is logged and recoverable
- refresh and restart restore supervisor state correctly

### End-to-end coverage

- create a business terminal session, enter objective text in the startup dialog, enable supervision, and verify automatic re-injection after a completed turn
- verify management panel status updates across idle, evaluating, injecting, and error states
- verify the business terminal shows visibly marked supervisor-originated input
- verify editing the objective text creates a new prompt version that changes future supervision behavior without rewriting past logs
- verify a currently running cycle finishes on the old version while the new objective waits for the next cycle
- verify pause and resume behavior from the UI
- verify retry after failure works and does not duplicate injections
- verify closing the business session cleans up supervisor mode state

## Acceptance criteria

This design is complete when all of the following are true:

- a business terminal session can enable one dedicated supervisor mode binding
- supervisor startup requires one natural-language objective entry in a single input box
- the system composes an objective prompt from that entry
- the system invokes Claude or Codex as a turn-scoped supervisor agent through shell
- the system detects completed turns and triggers supervision automatically
- every cycle evaluates against the active objective prompt
- every successful cycle returns one message intended for the business agent
- that message is injected back into the business terminal automatically
- the business terminal remains the primary real xterm view
- no dedicated xterm view is required for the supervisor in v1
- supervisor-originated input is visibly distinguishable in the terminal flow
- a separate management panel shows state, latest cycle details, timeline logs, and recovery actions
- objective edits recompose the prompt, affect future cycles only, and do not rewrite past records
- pause, resume, disable, retry, refresh, and restart scenarios behave predictably
- v1 remains narrowly scoped to one-to-one terminal supervision rather than growing into a general orchestration platform
