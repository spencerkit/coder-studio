# Contextual Diagnostics Assistant Design

> Status: Draft
> Date: 2026-05-15
> Scope: `packages/web/src/features/welcome/index.tsx`, `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`, `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`, `packages/web/src/features/agent-panes/actions/use-provider-launcher.ts`, `packages/web/src/features/settings/*`, `packages/web/src/hooks/use-bootstrap.ts`, new `packages/web/src/features/diagnostics/*`, new diagnostics server command surface

## Goal

Replace the proposed setup-first activation funnel with a quieter diagnostics assistant that only appears when the user is blocked or highly likely to become blocked.

The product should preserve direct paths for users who already know what they want to do. Diagnostics should help recover from failure, repair the environment, and return the user to the original task without turning setup into a mandatory ritual.

## Problem

The current conversion-first activation proposal assumes that all users should enter a dedicated setup flow before the product can deliver value.

That approach conflicts with the desired interaction model:

- setup should not become the default front door
- users should not be interrupted when their current path is already working
- diagnostics should feel like a capable assistant, not a funnel
- the product should help most when the user is stuck, not when they are still exploring

If the product replaces the welcome-page primary action with a setup-first route, it creates new friction for users who simply want to open a workspace or start coding immediately.

## Decision

Reposition setup as a contextual diagnostics assistant instead of a mandatory activation flow.

The new model is:

`User intent -> normal product flow -> blocking/high-risk failure detected -> Diagnostics assistant -> repair -> continue original task`

This changes the role of the feature in four ways:

- it becomes reactive by default, not proactive by default
- it is triggered by context and user intent, not by first-run status alone
- it preserves the original user goal instead of replacing it with a new funnel
- it stays mostly invisible when the environment is already healthy

## Product Principles

### Do Not Interrupt Healthy Flows

If the user can open a workspace, start a session, or continue work normally, diagnostics should stay out of the way.

### Intervene at the Moment of Friction

Diagnostics should appear when the product knows the user is blocked or very likely to fail on the next step.

### Preserve User Intent

The assistant should always remember what the user was trying to do:

- open a workspace
- start a session
- continue on phone

The recovery surface exists to complete that task, not to start a separate journey.

### Keep the Surface Small

Diagnostics should not become a generic dashboard or onboarding center. It should be a focused recovery surface with a short list of relevant issues and concrete next actions.

## Entry Strategy

### Welcome Page

The welcome page should keep `Open Workspace` as its primary action.

It should not present setup or diagnostics as a primary call to action. Users visiting the product for the first time should still be able to try the product directly without first being asked to enter a wizard.

Diagnostics may be accessible later from settings or error recovery paths, but it should not compete with the welcome-page primary action.

### Settings

Settings should expose a low-emphasis manual entry point such as `Diagnostics` or `Help & Diagnostics`.

This supports proactive users who want to inspect or repair their environment without making diagnostics part of the default first-run experience.

### Recovery Redirects

The product may route a user into diagnostics when:

- an action has already failed
- the next action is very likely to fail based on known readiness state

This redirect should be contextual and intentional. It is not a generic “you should probably run setup” reminder.

## Trigger Matrix

Diagnostics should initially support these contexts.

### 1. Workspace Recovery

Trigger when the user is trying to open a workspace and:

- the open action fails
- the selected path is invalid or inaccessible
- the product determines that the current workspace selection cannot continue

Do not trigger if the workspace opens successfully.

### 2. Session Recovery

Trigger when the user is trying to start a session and:

- the required provider is not installed
- the provider CLI is missing
- authentication is required but incomplete
- runtime readiness is missing and session creation is highly likely to fail

This is the highest-value preemptive trigger because the product can often detect the problem before a failed session launch.

### 3. Mobile Continuation Recovery

Trigger only when the user explicitly asks to continue on phone and:

- the server is not reachable on LAN
- host exposure is incompatible with phone continuation
- authentication or password requirements are not satisfied

Do not show mobile diagnostics before the user expresses mobile intent.

### 4. Manual Diagnostics

Allow a user to open diagnostics from settings even if they are not currently blocked.

This entry point is secondary and should not drive the overall product architecture.

For v1, settings is the only always-available manual entry point.

## URL and Naming

Keep a dedicated route, but weaken the setup wording.

Chosen route and labels for v1:

- route: `/diagnostics`
- page title: `Diagnostics`
- settings entry label: `Diagnostics`

Avoid presenting the route as `Setup` in product language. The assistant should read like a support and repair tool, not an onboarding step.

Deep-linking remains useful for redirects from failure states and for manual access from settings.

## Interaction Model

Diagnostics should use a dedicated page rather than an inline banner or side panel for the first version.

Reasoning:

- the blocked state is important enough to justify focused recovery
- a dedicated page can carry clearer context and stronger next actions
- it avoids overloading existing workspace, provider, and welcome surfaces with too much failure logic

However, entry into this page should be conditional and infrequent.

The user flow should be:

1. user attempts an action
2. product detects a blocking or high-risk issue
3. product routes to diagnostics with task context
4. diagnostics explains the issue, offers repair actions, and refreshes status
5. once recovery conditions are satisfied, the page promotes continuing the original task

## Page Information Architecture

The page should stay intentionally small.

### Section 1: Context Header

The header should say what the user was trying to do and what went wrong.

Examples:

- `We couldn't open your workspace`
- `Your Codex session is not ready to start`
- `Phone continuation needs a few fixes`

Avoid abstract titles like `Setup` or `Environment Doctor` as the primary heading.

### Section 2: Short Explanation

Add one sentence explaining why the user is here.

Examples:

- `A few issues need attention before we can continue.`
- `We found a problem that would block session startup.`

### Section 3: Relevant Issues List

Only show issues relevant to the current intent.

Each issue item should include:

- a simple status
- a short problem statement
- one clear next action

The initial user-facing state vocabulary should be limited to:

- `checking`
- `ready`
- `needs_attention`

The UI should avoid exposing a large internal state machine unless there is a concrete user benefit.

### Section 4: Primary Continuation Action

The bottom of the page should always preserve the original goal with a strong primary action.

Examples:

- `Retry Opening Workspace`
- `Continue Starting Session`
- `Continue on Phone`

If requirements are not yet met, the button may be disabled with a brief reason.

### Section 5: Secondary Actions

Secondary actions for v1 may include:

- `Back`
- `Open Settings`
- `Copy error details`

These actions should not compete with the primary continuation action.

The v1 page should not include a separate expandable advanced-details section. If technical detail is needed, `Copy error details` is the escape hatch.

## Diagnostics Context Model

The assistant should operate on a small set of explicit contexts instead of a single monolithic setup flow.

Initial contexts:

- `workspace_open`
- `session_start`
- `mobile_continue`
- `manual_check`

This context should be passed into the diagnostics page and the diagnostics data fetch.

The main reason for this model is relevance: the user should only see the checks and recovery actions needed for the task they are actually trying to complete.

## Server Contract

The server should not expose a broad onboarding-oriented `setup.status` as the main future-facing abstraction.

Instead, the diagnostics surface should move toward a contextual command model such as:

- `diagnostics.get`
- `diagnostics.recheck`

Input:

- `context`
- optional task metadata, such as target provider or selected workspace path

Output:

- page context metadata
- relevant checks
- recommended actions
- a boolean or derived state indicating whether continuation is allowed

For migration purposes, existing setup-oriented command work may be adapted behind a new diagnostics facade if that reduces churn, but product-facing naming and usage should move to diagnostics language.

## Check Categories

The actual checks should be filtered by context.

### Workspace Context

Relevant checks:

- workspace path selected
- path exists
- path is readable
- path is openable by the workspace manager

### Session Context

Relevant checks:

- provider installed
- provider CLI available
- provider authenticated if required
- runtime ready enough to launch
- workspace selected if session launch depends on it

### Mobile Continuation Context

Relevant checks:

- host exposure mode
- reachable LAN candidates
- auth enabled when required
- password configured if the mobile flow depends on it

### Manual Check Context

This context may show a broader system summary, but it should still be grouped and readable rather than presented as a raw technical dump.

## Repair Actions

Each issue should map to a concrete action owned by the product where possible.

Examples:

- `Choose Workspace`
- `Retry Open`
- `Install Provider`
- `Open Provider Settings`
- `Refresh Status`
- `Enable Password Protection`

Prefer direct actions over doc links.

When the product cannot repair automatically, it should still describe the next step in product language and then offer the nearest helpful destination.

## Resume and Continuation

Diagnostics must preserve the pending task across repair attempts.

Examples:

- after selecting a valid workspace, continue the original workspace-open path
- after provider installation or authentication, continue the original session-start path
- after network or auth fixes, continue the original phone-handoff path

This is a core requirement. Diagnostics should not repair the environment and then abandon the user in a generic state.

## Error Handling

The diagnostics page should distinguish between:

- a known recoverable problem
- an unknown error while attempting recovery
- stale readiness data

Guidelines:

- known recoverable problems should surface one recommended next action
- unknown recovery errors should show a short failure message and allow retry
- stale readiness data should bias toward recheck rather than inventing new warnings

The page should never collapse into a blank state after a failed fix attempt.

## Testing Strategy

Add coverage in three layers.

### Route and Access

- diagnostics route renders correctly
- manual entry from settings works
- redirects into diagnostics preserve context metadata

### Contextual Recovery

- workspace failure routes into workspace diagnostics
- provider/session failure routes into session diagnostics
- mobile continuation failure routes into mobile diagnostics

### Continuation

- successful repair re-enables the correct primary continuation action
- retry resumes the original intent rather than sending the user to a generic landing state

## Migration Impact

This design deliberately rejects the earlier setup-first interaction model.

That means the following planned changes should be revised before implementation:

- do not replace the welcome-page primary CTA with `Start Setup`
- do not make `/setup` the default front door for first-run users
- do not frame diagnostics as a mandatory wizard
- do not expose all checks for all contexts by default

Existing useful work from the prior proposal can still be reused:

- readiness DTOs
- provider/runtime checks
- mobile access status logic
- reusable directory picker work

The implementation should reuse these capabilities while changing the user-facing orchestration model.

## Recommendation

Proceed with a diagnostics-first design rather than a setup-first funnel.

This approach preserves fast paths for confident users, keeps failure recovery coherent, and matches the intended product personality: helpful when needed, invisible when not.
