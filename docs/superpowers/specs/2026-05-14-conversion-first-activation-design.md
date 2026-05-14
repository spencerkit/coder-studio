# Conversion-First Activation Design

> Status: Draft
> Date: 2026-05-14
> Scope: `packages/web/src/features/welcome/index.tsx`, `packages/web/src/shells/desktop-shell.tsx`, `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`, `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`, `packages/web/src/features/agent-panes/actions/use-provider-launcher.ts`, `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`, `packages/web/src/features/settings/*`, `packages/web/src/features/supervisor/*`, new `packages/web/src/features/setup/*`, new `packages/web/src/features/mobile-access/*`, new setup/mobile server commands

## Goal

Improve product conversion by making first-time activation the primary product path.

For the next 30 days, the product should optimize for three user outcomes:

- a new user can complete a first useful AI task without reading docs
- the user can continue the same workspace from a phone with minimal setup
- the user can return later and immediately understand what happened while away

This design treats conversion as a product-comprehension and activation problem before it treats it as a traffic, pricing, or feature-breadth problem.

## Problem

The current product already has meaningful depth:

- browser-based workspace
- local file access
- Claude and Codex provider support
- mobile workspace shell
- Supervisor for long-running task orchestration

The main conversion problem is not lack of product capability. The main problem is that the first-run path does not reliably carry users to their first successful outcome.

Current friction points:

- the welcome page leads with broad IDE framing instead of the strongest differentiators
- opening a workspace is the primary CTA, even though workspace access alone does not prove product value
- provider setup happens too late in the flow and still feels partly manual
- cross-device continuation is a real capability, but not the default happy path
- mobile access still behaves more like documentation knowledge than productized workflow
- the product has no strong return experience after the first session

As a result, the likely drop-off occurs between:

`open product -> understand value -> prepare environment -> start first session -> complete first task -> continue on another device`

## Decision

Reframe the product around a conversion-first activation funnel.

The new primary path should be:

`Welcome -> Setup Wizard -> Environment Doctor -> Workspace Ready -> Provider Ready -> First Task -> Continue on Phone -> Return Summary`

This means:

- the first screen sells the workflow, not the shell
- setup becomes an explicit route, not an implicit cluster of modals and scattered states
- environment and provider readiness are first-class product surfaces
- mobile continuation is promoted from hidden capability to standard next step
- return and resume are productized instead of left to user memory

## Product Funnel

The design optimizes this funnel in order:

1. `Comprehension`
   - the user immediately understands what makes the product different
2. `Activation`
   - the user can get the environment ready inside the product
3. `First Value`
   - the user completes one useful AI task
4. `Differentiation`
   - the user continues from a phone or enables a long-running workflow
5. `Retention`
   - the user returns and resumes work without starting over

This ordering is intentional. It is not worth investing in more feature breadth, broader polishing, or deeper growth mechanics until this path is substantially smoother.

## Experience Principles

### Activation Before Configuration

The product should stop assuming users want to manually assemble the environment from settings, docs, and launcher surfaces.

Instead, the product should guide users to readiness before asking them to make advanced choices.

### One Primary Next Step

Every critical screen in the first-run path should have one obvious primary action.

Avoid branching the first experience into many equal-looking choices.

### Productized State, Not Tooling State

Users should see product states such as:

- ready
- needs fix
- continue on phone
- resume last task

They should not need to infer meaning from lower-level engineering facts like host binding, missing runtime, or auth mode.

### Differentiation Must Be Experienced, Not Explained

The product's strongest advantages are:

- cross-device continuity
- long-running Supervisor workflows

These are not convincing enough when they live only in docs or passive feature bullets. The product must lead users into these behaviors directly.

## Proposed User Journey

### Step 1: Welcome

The welcome page should stop acting like a generic empty workspace shell.

It should answer three questions quickly:

- what is this
- why is it different
- what should I do first

Required changes:

- primary CTA becomes `开始设置`
- manual workspace opening becomes secondary
- message centers on starting on desktop, continuing on phone, and keeping tasks moving with Supervisor
- feature bullets shift from generic tools to workflow outcomes

The welcome page should also support a returning-user mode later in this design.

### Step 2: Setup Wizard

Setup becomes a dedicated route, such as `/setup`, instead of being stitched together from welcome, workspace modal, provider launcher, and settings.

The wizard should use four steps:

1. `Choose Goal`
2. `Check Environment`
3. `Fix Issues`
4. `Launch First Task`

The goal-selection step should stay intentionally narrow. Recommended options:

- `开始本地编码`
- `从手机继续接力`
- `启动一个长任务`

The wizard must be interruptible and resumable. A user who leaves and returns should not feel forced to restart from scratch.

### Step 3: Environment Doctor

Environment Doctor is the diagnostic and repair engine inside the Setup Wizard.

It is responsible for converting setup friction into explicit, actionable product states.

Required checks:

- Node.js availability and supported version
- Git availability
- provider installed state
- provider authenticated state
- workspace root selected and accessible
- server host exposure mode
- password protection status
- LAN access readiness for mobile continuation

Each check should expose a consistent state model:

- `checking`
- `ready`
- `needs_fix`
- `fixing`
- `fixed`
- `failed`

Each failing item should answer:

- what is wrong
- why it blocks product use
- what action the user can take now

Where possible, the product should prefer one-click repair over redirecting users to documentation.

### Step 4: Workspace Readiness

Workspace opening should no longer be the product's main CTA, but it remains a prerequisite for first value.

Required changes:

- remove hardcoded and credibility-damaging default paths such as `/home/spencer`
- improve root path chips and default directory behavior
- unify error messages so they describe what the user can do next
- allow setup to reuse workspace selection behavior without forcing the user through the legacy modal pattern

The goal is to make workspace selection feel like a clear step in activation, not a raw filesystem operation.

### Step 5: Provider Readiness

Provider setup is currently too late in the journey.

The new flow should move provider readiness into setup and treat it as part of product activation, not as a detail hidden inside session creation.

Required behavior:

- show provider availability before session launch
- offer one-click install when supported
- route the user into authentication when installation succeeds but login is still required
- return the user to the setup flow automatically after provider readiness is achieved

Provider states should be expressed consistently across setup, session launcher, and settings:

- not installed
- installed but not authenticated
- ready
- installing
- failed

### Step 6: First Task Templates

The product should not ask a new user to invent the first prompt.

After workspace and provider readiness, the wizard should offer a small set of first-task templates that produce visible value quickly.

Recommended templates:

- explain the current project structure
- run tests and summarize failures
- read the codebase and suggest improvements

This step should terminate only when the user sees a real session and real output, not merely when setup checks have passed.

### Step 7: Continue On Phone

After first value, the most important next experience is cross-device continuation.

The product should explicitly guide the user into it.

Required behavior:

- desktop success state exposes `Continue on Phone`
- the user sees a mobile-access assistant instead of needing to consult docs
- the product shows the reachable address, password status, and connection instructions
- the product supports QR-based handoff

This is where the product's cross-device promise becomes concrete.

### Step 8: Return Summary

The first return experience should not drop users back into a generic welcome state.

When a user comes back after prior activity, the product should summarize:

- what completed
- what failed
- what changed
- what to do next

The primary action in this state should be `继续上次任务`.

This part of the experience is important for retention because it reduces the cognitive cost of reopening the product.

## Page And Surface Changes

### Welcome Page

Primary changes:

- replace `Open Workspace` as the dominant action
- make `开始设置` the primary CTA
- rewrite feature block copy around workflow value instead of generic IDE features
- support a returning-user variant later in the rollout

This work is centered in:

- `packages/web/src/features/welcome/index.tsx`

### Setup Wizard

Primary changes:

- add a dedicated setup route in the desktop shell
- create a new feature area for wizard steps and setup state
- keep the step count small and highly legible

This work is centered in:

- `packages/web/src/shells/desktop-shell.tsx`
- new `packages/web/src/features/setup/*`

### Environment Doctor

Primary changes:

- add a frontend doctor surface in the setup feature
- add server commands that summarize setup readiness
- translate engineering checks into user-facing states and repair actions

This work is centered in:

- new `packages/web/src/features/setup/doctor/*`
- new setup-oriented server command files

### Workspace Selection

Primary changes:

- remove credibility leaks
- refactor reusable directory-selection behavior
- improve path defaults and failure messages

This work is centered in:

- `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`
- `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`

### Provider Setup

Primary changes:

- reuse runtime status and install-job behavior inside setup
- unify provider-state vocabulary across setup, settings, and session launcher

This work is centered in:

- `packages/web/src/features/agent-panes/actions/use-provider-launcher.ts`
- `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`
- `packages/web/src/features/settings/components/provider-settings.tsx`
- `packages/server/src/commands/provider.ts`

### Mobile Access Assistant

Primary changes:

- create a new product surface for phone continuation
- expose mobile setup in product UI, not only in docs
- make QR handoff a first-class action

This work is centered in:

- new `packages/web/src/features/mobile-access/*`
- `packages/web/src/features/settings/*`
- desktop workspace success surfaces

### Return Summary And Resume

Primary changes:

- distinguish first-time welcome from returning-user welcome
- restore recent workspace and session context
- summarize recent progress and next action

This work is centered in:

- `packages/web/src/features/welcome/index.tsx`
- `packages/web/src/features/workspace/views/shared/workspace-route-gate.tsx`
- `packages/web/src/features/workspace/actions/use-persist-workspace-last-viewed-target.ts`
- new returning-summary server command or equivalent summary data source for recent workspace, session, and supervisor state

## Rollout Plan

### Phase P0: First Successful Task

Ship first:

- welcome rewrite
- setup route and step container
- environment doctor
- workspace selection cleanup
- provider readiness inside setup
- first-task templates
- success and failure state rewrite

This phase exists to reduce the time from opening the product to seeing the first useful result.

### Phase P1: Cross-Device Continuation

Ship second:

- mobile access assistant
- host and password readiness surfaces
- QR-based handoff
- `Continue on Phone`
- provider-state consistency across surfaces

This phase exists to ensure users experience the product's strongest differentiator, not merely read about it.

### Phase P2: Return And Resume

Ship third:

- return summary
- resume last session
- supervisor quick-start templates
- recent workspace restoration

This phase exists to reduce the cost of coming back and continuing work.

## UI Guidance

The current UI does not require a full visual redesign to improve conversion.

The highest-ROI UI work is:

- stronger first-screen hierarchy
- clearer setup and provider states
- clearer success states
- clearer failure states
- clearer mobile continuation call-to-action

Avoid spending the first 30 days on:

- global theme redesign
- broad visual experimentation
- non-critical page polish
- decorative motion work disconnected from activation

The product issue is primarily one of path clarity and state communication, not foundational aesthetic weakness.

## Risks

### Risk: the setup flow becomes too heavy

Mitigation:

- keep the wizard to four steps
- default to auto-repair where possible
- keep manual advanced configuration behind settings, not in the main flow

### Risk: adding setup duplicates existing surfaces

Mitigation:

- reuse existing workspace and provider logic where possible
- treat setup as orchestration and copy rewrite, not a parallel product

### Risk: cross-device access feels unsafe

Mitigation:

- make password readiness explicit
- make host exposure explicit
- keep safe defaults visible instead of implicit

### Risk: returning-user logic adds state complexity too early

Mitigation:

- defer return summary and resume work until the first-run path is stable
- keep return logic read-oriented before adding deeper automation

## Non-Goals

This design does not include:

- full-site visual redesign
- plugin system expansion
- multi-workspace management overhaul
- cloud sync and cross-device preference sync
- broader editor and Git feature expansion
- growth analytics infrastructure in this phase

These may become useful later, but they do not address the current conversion bottleneck.

## Verification

After implementation, verify these user journeys manually:

1. a new user can open the product and complete a first useful task in under five minutes without reading documentation
2. after the first task starts or completes, the user can continue from a phone in under one minute on the same network
3. a returning user can understand the previous task state and continue work within roughly ten seconds
4. provider readiness is expressed consistently in setup, settings, and session-launch surfaces
5. no first-run surface exposes credibility-damaging local assumptions such as hardcoded personal paths

## Implementation Boundary

This phase should prefer targeted product-path work over broad refactoring.

Allowed implementation shape:

- add new setup and mobile-access feature folders
- add narrowly scoped server commands for setup readiness and mobile readiness
- reuse existing provider-install and workspace-open behaviors
- update current welcome, settings, workspace-launch, and supervisor surfaces only where they directly support the conversion path

This phase should not expand into unrelated platform work while the activation path is still being established.
