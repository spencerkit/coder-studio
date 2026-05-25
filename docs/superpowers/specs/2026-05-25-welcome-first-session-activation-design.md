# Welcome First-Session Activation Design

> Status: Draft
> Date: 2026-05-25
> Scope: `packages/web/src/features/welcome/index.tsx`, `packages/web/src/features/welcome/index.test.tsx`, `packages/web/src/locales/en.json`, `packages/web/src/locales/zh.json`, `packages/web/src/styles/components.css`

## Goal

Improve first-session activation for new users by making the welcome page explain the first successful path clearly:

- open a workspace
- understand that the next step is to start Claude Code or Codex inside that workspace

This work targets comprehension before environment repair, cross-device continuation, or Supervisor differentiation.

## Problem

The current welcome page is structurally simple but still behaves more like a product-introduction surface than a first-task surface.

Current issues:

- the hero copy emphasizes product positioning more than the next user action
- `Open Workspace` is the right primary CTA, but the page does not make the two-step path explicit
- `Settings` is available, but the page does not explain when a user should choose it
- the three feature cards describe capabilities broadly instead of telling the user what they can do immediately after opening a workspace

For the target outcome in this iteration, the failure mode is not “the product lacks onboarding.” The failure mode is “a new user lands here and does not immediately understand what to click first.”

## Decision

Adopt a task-oriented welcome page that keeps the existing direct launch flow while changing the page from a brand-forward intro surface into a first-task activation surface.

The welcome page should communicate this path explicitly:

`Open Workspace -> Enter workspace -> Start Claude or Codex session`

This remains an inline-first activation change.

It does **not** introduce:

- a dedicated onboarding route
- a wizard or forced first-run flow
- tooltip tours
- first-run persistence state
- changes to workspace launch behavior

## Why This Approach

Three implementation directions were considered:

### 1. Copy-only polish

Pros:

- smallest change
- lowest implementation risk

Cons:

- likely too weak to fix the main comprehension problem
- does not create a clear first-step / second-step mental model

### 2. Task-oriented welcome page rewrite

Pros:

- directly addresses the “what do I click first?” problem
- keeps healthy flows uninterrupted
- requires only welcome-page copy, layout, and test updates
- aligns with the existing conversion-first activation direction

Cons:

- does not help users who become confused after entering the workspace

### 3. Dedicated onboarding interaction

Pros:

- strongest prompt strength

Cons:

- adds ceremony to a flow that already has a correct primary action
- introduces first-run state and more behavioral surface area
- conflicts with the inline-first activation direction already defined elsewhere

Chosen approach: **2. Task-oriented welcome page rewrite**

## Experience Principles

### One Primary Action

The page should continue to optimize for a single first action: `Open Workspace`.

### Explain The Immediate Next Step

The page should tell the user what happens after the workspace opens so that the first action feels purposeful, not blind.

### Do Not Interrupt Healthy Users

Users who already know the flow should still be able to click the button and proceed immediately.

### Keep Settings Secondary

`Settings` should remain available, but only as a recovery or preparation path for users who already know they need provider configuration.

### Sell Outcomes, Not Product Breadth

The three supporting cards should emphasize what the user can do right after activation instead of advertising broad platform features.

## Proposed Page Structure

The existing welcome page keeps the same overall shell:

- hero section
- action section
- three-card supporting section

The change is in information hierarchy and content, not in route structure or major interaction design.

### Hero

The hero should answer:

- what is this surface for
- what is the first action
- what happens next

Required copy direction:

- kicker becomes product-category oriented, not slogan oriented
- title becomes action-oriented
- description explains that the user first chooses a local project folder and then starts Claude Code or Codex inside that workspace

### Action Section

The action section becomes the page’s center of gravity.

Required content:

- a short pre-CTA hint: `Step 1`
- the existing `Open Workspace` button as the only primary action
- a short post-CTA hint: `Step 2 happens inside the workspace`
- a secondary settings hint explaining when `Settings` is relevant
- the existing `Settings` button as a secondary action

This creates guidance without adding any new step enforcement.

### Supporting Cards

Keep exactly three cards to avoid visual churn and preserve the existing structure.

Required card themes:

1. start Claude or Codex sessions
2. review files and Git changes beside the agent
3. run commands in the same workspace

These cards should describe immediate, post-activation outcomes instead of broad product capabilities.

## Copy Model

The recommended content model is:

- `welcome.kicker`
- `welcome.title`
- `welcome.description`
- `welcome.primary_hint`
- `welcome.secondary_hint`
- `welcome.settings_hint`
- existing `action.open_workspace`
- existing `action.settings`
- updated `welcome.features.*`

The new hint keys should remain short and literal. They are instructional copy, not marketing copy.

## Layout And Styling

This design intentionally avoids a new visual shell. The welcome page already has a stable structure and recent welcome/auth work has established the flat entry-page direction.

Required layout changes:

- keep the current hero / actions / features stacking
- add the new hint lines inside the existing action group
- visually separate:
  - pre-CTA hint
  - primary CTA
  - post-CTA hint
  - settings hint
  - secondary action

Styling guidelines:

- `primary_hint` should be more noticeable than generic body copy, but lower than the page title
- `secondary_hint` and `settings_hint` should use secondary text treatment
- mobile should keep the same reading order without introducing a new layout mode

Expected CSS additions are small utility classes rather than a welcome-page redesign.

## Behavior

No interaction behavior changes are required.

Specifically:

- `Open Workspace` still opens `WorkspaceLaunchModal`
- `Settings` still navigates to `/settings`
- no local storage state is introduced
- no first-run detection is introduced
- no workspace-launch modal changes are required in this iteration

## File-Level Impact

### `packages/web/src/features/welcome/index.tsx`

- add the three new hint text nodes
- keep the existing button behavior
- keep the existing feature-card count and icon semantics

### `packages/web/src/locales/en.json`

- replace existing welcome hero copy
- replace feature-card copy
- add `welcome.primary_hint`
- add `welcome.secondary_hint`
- add `welcome.settings_hint`

### `packages/web/src/locales/zh.json`

- mirror the English content model with concise Chinese instructional copy

### `packages/web/src/styles/components.css`

- add lightweight classes for the new hints
- keep the rest of the welcome shell stable

### `packages/web/src/features/welcome/index.test.tsx`

- update copy assertions for the new hero text
- assert the presence of the three new hint lines
- preserve existing structural assertions around hero, actions, and features

## Out Of Scope

This iteration does not include:

- post-workspace guidance inside the workspace
- provider recommendation logic
- provider install or auth guidance changes
- diagnostics changes
- analytics infrastructure changes
- mobile continuation or Supervisor onboarding
- return-user summary behavior

## Success Criteria

This iteration should make the first activation path easier to understand before any deeper onboarding work is considered.

Signals to watch after implementation:

- higher rate of `Open Workspace` clicks from the welcome page
- shorter time from welcome page render to workspace-launch modal open
- lower likelihood that new users detour into `Settings` as their first action
- faster progression from welcome page to the first provider launch attempt

## Testing

The change should be covered by targeted welcome-page tests:

- English copy rendering
- mobile class retention
- `Open Workspace` button still opens the modal
- `Settings` button still navigates correctly
- new hint lines render in the action section

Styling work should stay small enough that targeted component/theme assertions are only updated if the new classes require them.

## Open Questions

No blocking product questions remain for this MVP.

The only deferred question is whether a second-stage in-workspace hint is needed after this welcome-page pass ships. That should be decided from user behavior after the current iteration, not folded into the same scope now.
