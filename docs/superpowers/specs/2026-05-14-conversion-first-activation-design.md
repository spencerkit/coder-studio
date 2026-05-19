# Conversion-First Activation Design

> Status: Draft
> Date: 2026-05-14
> Scope: `packages/web/src/features/welcome/index.tsx`, `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`, `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`, `packages/web/src/features/agent-panes/actions/use-provider-launcher.ts`, `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`, `packages/web/src/features/settings/*`, `packages/web/src/features/diagnostics/*`, `packages/web/src/features/supervisor/*`, `packages/web/src/hooks/use-bootstrap.ts`, new diagnostics server command surface, future `home.summary`

## Goal

Improve product conversion by getting users to first value quickly while keeping the product quiet when things are already working.

For the next 30 days, the product should optimize for three outcomes:

- a new user can complete a first useful AI task without reading docs
- the user can continue the same workspace from a phone once they explicitly want to do so
- the user can return later and immediately understand what happened while away

This design treats conversion as a product-comprehension, recovery, and continuation problem before it treats it as a pricing, traffic, or feature-breadth problem.

## Problem

The product already has meaningful depth:

- browser-based workspace
- local file access
- Claude and Codex provider support
- mobile workspace shell
- Supervisor for long-running task orchestration

The main conversion problem is not lack of capability. The main problem is that users can hit avoidable friction before they reach a successful outcome, and the recovery path is not yet productized clearly enough.

Current friction points:

- the welcome page does not always clarify the best first step or the strongest workflow outcomes
- workspace selection can still feel like raw filesystem plumbing rather than part of a guided product path
- provider launch issues are understandable to engineering, but not always translated into clear product-language recovery
- phone continuation exists, but too much of its readiness model still lives in implicit host/auth knowledge
- return visits still depend too much on user memory

At the same time, a dedicated wizard-first funnel would create new friction:

- it would interrupt users whose normal path is already healthy
- it would duplicate existing workspace and launcher surfaces
- it would turn environment help into a ceremony instead of a quiet assistant

## Decision

Adopt an inline-first activation model with diagnostics as a secondary repair surface.

The primary model becomes:

`Welcome or returning home -> Open Workspace -> Start Agent -> Recover inline when possible -> Open diagnostics only when needed -> Continue on Phone -> Return Summary`

This means:

- the welcome page stays workspace-first
- agent launch stays direct when the runtime is healthy
- missing provider CLI installation stays inline when supported
- deeper environment visibility moves to `/diagnostics`
- phone continuation is explicit but opt-in
- return and resume build on real usage state instead of a separate onboarding state machine

There is no dedicated onboarding route, no readiness-gate command surface, and no product requirement to pass through an environment wizard before using the product.

## Product Funnel

The design optimizes this funnel in order:

1. `Comprehension`
   - the user understands what to do first
2. `First Value`
   - the user reaches a real workspace and starts useful AI work
3. `Recovery`
   - when blocked, the product helps inline first and then escalates to diagnostics
4. `Differentiation`
   - the user experiences cross-device continuation or longer-running workflows
5. `Retention`
   - the user returns and resumes without reconstructing context manually

This ordering is intentional. It is not worth investing in broader feature breadth or heavy visual exploration until this path is substantially smoother.

## Experience Principles

### Do Not Interrupt Healthy Flows

If the user can open a workspace or start an agent normally, the product should let them proceed.

### Preserve User Intent

Recovery should remember what the user was trying to do:

- open a workspace
- start an agent
- continue on phone

The system should help complete that task, not replace it with a different journey.

### Recover Inline First

If a problem can be resolved inside the current surface, that is preferable to sending the user elsewhere.

Examples:

- install a missing provider CLI inline when supported
- explain missing prerequisites inline when installation cannot proceed
- keep diagnostics as a secondary option for deeper inspection

### Use Diagnostics For Depth, Not Ceremony

`/diagnostics` is a real product surface, but it is not the front door.

It should:

- expose a full environment report
- highlight the issues most relevant to the current context
- support recheck and continuation
- stay manually reachable from Settings

It should not:

- replace normal workspace or launch flows
- become a mandatory first-run gate

### Differentiate Through Continuation And Resume

The product's strongest advantages are:

- cross-device continuity
- long-running Supervisor workflows

These should be experienced through clear follow-up actions after first value, not by putting more friction in front of the first task.

## Proposed User Journey

### Step 1: Welcome And Workspace Intent

The welcome page should answer three questions quickly:

- what is this
- why is it useful
- what should I do first

Required behavior:

- `Open Workspace` remains the primary CTA
- copy can emphasize starting on desktop, continuing on phone, and using Supervisor for longer-running work
- a returning-user variant can later summarize prior activity

The goal is clarity, not redirection into a separate wizard.

### Step 2: Open A Workspace

Workspace selection remains part of the normal product path.

Required changes:

- remove credibility-damaging default paths such as hardcoded personal directories
- improve root path chips and default directory behavior
- keep error messages action-oriented
- preserve the selected path if the product needs to route into diagnostics

On success, the user continues directly. On failure, diagnostics can help explain and recover.

### Step 3: Start An Agent

Agent launch remains direct when possible.

Required behavior:

- if provider runtime is ready, create the session immediately
- if the provider CLI is missing and auto-install is supported, keep installation inline
- if prerequisites are missing or install is unsupported, show inline manual guidance
- expose diagnostics as a secondary path for full environment visibility

Desktop draft launchers and mobile launch surfaces should share the same state vocabulary and recovery behavior.

### Step 4: Diagnostics As A Full Environment Report

Diagnostics is the product's deeper inspection surface.

Required behavior:

- dedicated route: `/diagnostics`
- manual entry point from Settings
- failure entry points from blocked workspace open and blocked or high-risk session start
- context-specific header and continuation action
- full environment checks covering workspace state, provider runtime, auth exposure, and phone continuation readiness
- recheck and copy-details actions

The entry context should determine emphasis, but the page itself should still behave like a full environment report.

### Step 5: Continue On Phone

Phone continuation becomes an explicit optional next step.

Required behavior:

- user can start it from Settings or relevant workspace surfaces
- if the environment is ready, the product provides a usable mobile link
- if host exposure or auth is not ready, diagnostics explains what is blocking continuation
- the continuation action preserves the original workspace or session context

This is where the product's cross-device promise becomes concrete.

### Step 6: Return Summary And Resume

The first return experience should not drop users back into a generic welcome state.

When a user comes back after prior activity, the product should summarize:

- what completed
- what failed
- what changed
- what to do next

The primary action should be `Continue where you left off`.

This is important for retention because it reduces the cognitive cost of reopening the product.

## Diagnostics Context Model

Diagnostics should operate on a small set of explicit contexts:

- `workspace_open`
- `session_start`
- `mobile_continue`
- `manual_check`

This context should determine:

- the page header
- the continuation action
- which issues are highlighted first

But it should not reduce the page to a single narrow check. The user still benefits from seeing the broader environment state when they are already in diagnostics.

## Server Contract

The server contract should move toward:

- `diagnostics.get`
- `diagnostics.recheck`

Input should include:

- `context`
- `workspaceId` when relevant
- `providerId` when relevant
- `workspacePath` or equivalent path context when relevant

Output should include:

- a full environment report
- highlighted checks relevant to the current intent
- continuation metadata
- doc links or actionable repair hints

This should replace the old idea of broad readiness-gate command surfaces.

Return-state data remains separate:

- `home.summary`

## Page And Surface Changes

### Welcome Page

Primary changes:

- keep `Open Workspace` as the primary CTA
- tighten copy around workflow value instead of generic IDE framing
- support a returning-user summary variant later in the rollout

Centered in:

- `packages/web/src/features/welcome/index.tsx`

### Diagnostics

Primary changes:

- add `/diagnostics` to desktop and mobile shells
- create shared navigation helpers for intent-preserving redirects
- render a full environment report with contextual emphasis

Centered in:

- `packages/web/src/shells/desktop-shell.tsx`
- `packages/web/src/shells/mobile-shell/index.tsx`
- `packages/web/src/features/diagnostics/*`
- new diagnostics-oriented server command files

### Workspace Selection

Primary changes:

- remove credibility leaks
- improve path defaults and failure messaging
- preserve selected-path context for diagnostics redirects

Centered in:

- `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`
- `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`
- `packages/server/src/commands/workspace.ts`

### Agent Launch Recovery

Primary changes:

- keep runtime install and manual guidance inline
- unify provider-state vocabulary across launcher and settings surfaces
- expose diagnostics only as a secondary recovery path

Centered in:

- `packages/web/src/features/agent-panes/actions/use-provider-launcher.ts`
- `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`
- `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.tsx`
- `packages/web/src/features/settings/components/provider-settings.tsx`

### Phone Continuation

Primary changes:

- expose `Continue on Phone` from Settings and relevant workspace surfaces
- make mobile readiness legible in product UI rather than leaving it implicit
- reuse diagnostics for deeper host/auth/network inspection

Centered in:

- `packages/web/src/features/settings/*`
- `packages/web/src/features/diagnostics/*`
- desktop workspace continuation surfaces

### Return Summary And Resume

Primary changes:

- distinguish first-time welcome from returning welcome
- restore recent workspace and session context
- summarize recent progress and next action

Centered in:

- `packages/web/src/features/welcome/index.tsx`
- `packages/web/src/features/workspace/views/shared/workspace-route-gate.tsx`
- `packages/web/src/hooks/use-bootstrap.ts`
- future `home.summary` server command

## Rollout Plan

### Phase P0: First Successful Task

Ship first:

- quiet diagnostics foundation
- workspace selection cleanup
- inline provider launch recovery
- diagnostics fallback for blocked workspace/session flows

This phase exists to reduce the time from opening the product to seeing the first useful result without adding a gate.

### Phase P1: Cross-Device Continuation

Ship second:

- explicit `Continue on Phone`
- host and auth readiness surfaced through diagnostics
- copyable mobile links and continuation actions

This phase exists to ensure users experience the product's strongest differentiator, not merely read about it.

### Phase P2: Return And Resume

Ship third:

- return summary
- resume last session or workspace target
- Supervisor quick-start templates

This phase exists to reduce the cost of coming back and continuing work.

## UI Guidance

The highest-ROI UI work is:

- stronger first-screen hierarchy
- clearer inline provider states
- clearer diagnostics framing and continuation actions
- clearer phone continuation entry points
- clearer return summary hierarchy

Avoid spending the first 30 days on:

- global theme redesign
- broad visual experimentation
- non-critical decorative motion
- unrelated page polish

The product issue is primarily path clarity and state communication, not foundational visual weakness.

## Risks

### Risk: diagnostics becomes too loud

Mitigation:

- keep diagnostics secondary
- preserve direct success paths
- only elevate into diagnostics on explicit friction or manual request

### Risk: inline recovery and diagnostics drift apart

Mitigation:

- share provider-state vocabulary
- keep server diagnostics as the source of deeper environment truth
- test desktop and mobile launch recovery together

### Risk: phone continuation feels unsafe or confusing

Mitigation:

- make auth readiness explicit
- make host exposure explicit
- do not treat localhost fallback as phone-ready

### Risk: return-state logic adds complexity too early

Mitigation:

- defer summary and resume work until the first-value path is stable
- keep the first version concise and action-oriented

## Non-Goals

This design does not include:

- a mandatory onboarding wizard
- a dedicated onboarding feature area
- a product-level requirement to pass environment checks before opening the product
- full-site visual redesign
- plugin system expansion
- multi-workspace management overhaul
- cloud sync and cross-device preference sync
- broader editor and Git feature expansion

These may become useful later, but they do not address the current conversion bottleneck.

## Verification

After implementation, verify these user journeys manually:

1. a new user can open the product and complete a first useful task in under five minutes without reading documentation
2. when the provider runtime is missing, the launcher keeps recovery inline and offers diagnostics only as a secondary path
3. when a workspace open fails, the user can enter diagnostics with the original path preserved and understand what to do next
4. after the user explicitly asks to continue on phone, the product can either provide a valid mobile link or clearly explain what is still blocking it
5. a returning user can understand the previous task state and continue work within roughly ten seconds
6. no first-run surface exposes credibility-damaging local assumptions such as hardcoded personal paths

## Implementation Boundary

This phase should prefer targeted product-path work over broad refactoring.

Allowed implementation shape:

- add diagnostics-specific core and server contracts
- add a dedicated diagnostics page and routing helpers
- reuse existing provider-install and workspace-open behaviors
- update current welcome, settings, workspace-launch, launcher, and supervisor surfaces only where they directly support the conversion path

This phase should not expand into unrelated platform work while the activation path is still being established.
