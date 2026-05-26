# Welcome Screenshot Layout Refinement

## Goal

Refine the existing welcome page redesign using real desktop and mobile screenshots so the first-run flow is clearer, shorter, and more balanced across screen sizes.

This refinement keeps the same product message:

1. Open a workspace
2. Start an AI coding session inside it

The change focuses on layout hierarchy, action placement, and responsive density rather than new functionality.

## Evidence From Current Screenshots

The current welcome scene was captured from the existing `ui-preview` welcome route on both desktop and mobile.

### Desktop Findings

- The hero copy column feels visually heavier than the workflow column.
- Step 1 and Step 2 render in a single vertical stack, so the workflow does not feel like the main object on wide screens.
- The settings action lives inside the Step 2 card, which makes it look like part of the main workflow instead of optional setup help.
- The lower support section is relatively prominent compared with the step flow.
- The card leaves unused horizontal space that can be reassigned to the two core steps.

### Mobile Findings

- The first screen spends too much height on the hero before the user reaches the full workflow.
- Step cards are readable, but the support section still competes for attention after the flow.
- The settings action consumes large step-card space even though it is secondary.
- The screen can scroll, but the information density still makes short devices feel long and top-heavy.

## Chosen Approach

Use a step-priority layout with responsive step grouping.

### Why This Approach

- It preserves the current welcome-page architecture and copy model.
- It addresses the user’s explicit requirement that desktop Step 1 and Step 2 sit on one row while mobile stacks them vertically.
- It separates the settings action from the main workflow without introducing extra navigation complexity.
- It reduces mobile perceived length by demoting secondary content instead of deleting useful context.

## Layout Design

### Desktop

- Keep the landing card as a two-column shell:
  - left: kicker, title, short description
  - right: workflow section
- Change the workflow body to a two-column steps grid:
  - Step 1 card on the left
  - Step 2 card on the right
- Move the settings action out of Step 2 and place it below the steps as a separate, low-emphasis support row.
- Keep the support summary below the main grid, but visually lighter than the workflow cards.

### Mobile

- Keep a single-column shell.
- Reduce hero perceived height through tighter spacing and shorter line-length presentation.
- Stack Step 1 and Step 2 vertically.
- Place the settings action below the step stack as a standalone secondary row.
- Keep the support items below the workflow as compact summary cards.

## Information Hierarchy

The page should read in this order:

1. What this page is for
2. Step 1: open a workspace
3. Step 2: start Claude or Codex
4. Optional settings/setup help
5. Small supporting reasons to use the product here

The settings action must no longer appear to be a required part of Step 2.

## Component-Level Changes

### Welcome Page Structure

- Keep `welcome-card__hero` for the left/top explanatory block.
- Keep `welcome-flow` as the workflow container.
- Change `welcome-flow__steps` into:
  - desktop: two columns
  - mobile: one column
- Add a dedicated secondary settings/support block directly under the steps.
- Keep the lower support section, but treat it as compact context rather than feature marketing.

### Settings Placement

- The settings CTA remains a button that navigates to `/settings`.
- It moves into its own layout block with its own hint copy.
- It should visually read as optional preparation help, not a main-step action.

## Styling Contract

### Desktop Contract

- The main welcome card remains width-constrained and centered.
- `welcome-flow__steps` uses a two-column grid.
- Both step cards share equal visual weight.
- The settings support row spans the workflow width below the two step cards.
- The support summary remains below the main top grid and should not overpower the workflow.

### Mobile Contract

- The container remains vertically scrollable.
- The card sizes to content and does not trap overflow.
- The hero, steps, settings row, and support summary stack in one column.
- Primary CTA remains full-width within Step 1.
- Settings CTA is full-width in its own secondary block.

## Copy Strategy

- Reuse the existing title, description, step copy, support copy, and action labels where possible.
- Keep the current settings hint copy, but associate it with the standalone settings block instead of Step 2.
- Avoid adding new marketing copy unless needed for layout clarity.

## Testing

### Component Tests

- Assert that the welcome page renders two step cards inside the workflow.
- Assert that the settings button is no longer inside the Step 2 card.
- Assert that the standalone settings support block exists.
- Preserve modal opening and settings navigation behavior coverage.

### Style Tests

- Assert that `welcome-flow__steps` is a grid and includes an explicit desktop two-column layout.
- Assert that the mobile welcome layout remains single-column and scrollable.
- Assert that the mobile support list remains one column.

### Visual Verification

- Capture welcome screenshots again from `e2e-ui` for both desktop and mobile after implementation.
- Compare post-change screenshots against the current captured baseline to confirm:
  - desktop steps sit side by side
  - settings is separated from Step 2
  - mobile flow reaches the core actions sooner

## Out of Scope

- No new welcome-page functionality
- No auth-page redesign
- No not-found-page redesign
- No changes to the workspace launch modal flow
