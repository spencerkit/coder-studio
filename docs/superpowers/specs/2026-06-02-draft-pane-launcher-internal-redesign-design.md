# Draft Pane Launcher Internal Redesign

> Status: Draft for review
> Date: 2026-06-02
> Scope: `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`, `packages/web/src/styles/components.css`, related launcher tests and theme tests

## Goal

Refine the `draft pane` launcher so it feels cleaner, flatter, and more stable without changing the surrounding pane shell or the product's existing visual language.

This redesign is intentionally narrow:

- keep the current `session-card` and `session-header`
- keep the current theme/token system
- keep the current two-entry mental model: `Agent` on the left, `file open` on the right
- only redesign the internal launcher area inside the draft pane

## Non-Goals

- Do not redesign the outer draft pane frame or header actions
- Do not introduce a new welcome-page-like layout language
- Do not turn the launcher into a new full-screen entry experience
- Do not remove provider install guidance, diagnostics links, or drag-and-drop behavior
- Do not replace the compact-width carousel model with a new navigation pattern

## Confirmed Constraints

The following constraints were explicitly confirmed during design review and are mandatory:

- Preserve the current overall product style
- Keep the redesign focused inside the `draft pane` body
- Avoid strong left/right split-panel tension
- Avoid large, tall provider cards that reduce provider density
- Avoid moving the helper copy into the outer draft pane header
- Keep the file-open affordance recognizable and still mapped to the right side on desktop

## Current Problems

### 1. The desktop launcher feels visually split in half

The current implementation renders two separate `agent-draft-panel` blocks with a strong side-by-side presence. This creates a "two panels fighting each other" effect instead of one coherent launcher surface.

### 2. Provider items are too tall for a launcher

The provider buttons behave more like stacked cards than launcher rows. Their vertical size makes the area feel heavy and reduces the number of providers that can be scanned quickly.

### 3. The file area is visually too isolated

The drag-and-drop zone reads like a separate empty module instead of a secondary utility inside the same launcher surface.

### 4. Helper copy lacks a natural home

The helper sentence:

`点击启动 Agent，或将文件拖到右侧区域直接打开。`

should explain the relationship between the two entry paths, but placing it in the outer header makes that header too large, while placing it as a heavy footer pulls attention downward too much.

## Design Conclusion

Adopt a `shared internal workarea` design for the draft launcher.

The draft pane keeps its existing outer shell, but the content area is reorganized into one shared internal surface:

- a lightweight helper-copy strip at the top of the internal workarea
- a primary `Agent` region on the left
- a secondary `file utility` region on the right
- a very light divider between the two regions

This keeps the existing interaction model intact while removing the current visual feeling of two independent cards.

## Detailed Design

### 1. Internal Structure

Replace the visual grammar of two independent `agent-draft-panel` blocks with one shared internal container, conceptually:

- `.agent-draft-workarea`
  - `.agent-draft-workarea-copy`
  - `.agent-draft-workarea-body`
    - `.agent-draft-workarea-main`
    - `.agent-draft-workarea-side`

Rules:

- The outer `session-card`, `session-header`, action buttons, and pane states remain unchanged
- The new workarea is the only visually framed surface inside the draft body
- The left and right regions share the same background and boundary
- The left region remains dominant at roughly `1.2fr`
- The right region remains secondary at roughly `0.8fr`

### 2. Helper Copy Placement

Move the helper sentence into the top of the internal workarea, not the outer header and not a heavy footer.

Rules:

- It spans the internal workarea width
- It uses small, low-contrast supporting text styling
- It should read as orientation copy, not as a standalone banner or badge
- It should visually sit above both entry areas so it explains both of them together

### 3. Provider Region

The provider area keeps the current provider list behavior, but changes its visual density and hierarchy.

Rules:

- Provider items shift from tall card-buttons to flatter launcher rows
- Each row keeps:
  - provider icon
  - title
  - subtitle
  - CTA
- Row height should compress to roughly `70% - 80%` of the current visual height
- Claude / Codex may retain subtle semantic tinting, but only as restrained row treatment
- The row should scan as one line-first unit, not as a three-layer mini-card
- Install or diagnostics guidance remains available, but should read as lightweight appended detail instead of expanding the main row into a large block whenever possible

### 4. File Utility Region

The right-side file-open area remains present, but it becomes a quieter utility region inside the same workarea.

Rules:

- Keep the right-side file entry mental model on desktop
- Reduce the visual size and emphasis of the drag-and-drop box
- Keep the drop target clear and discoverable
- Use a lighter dashed treatment and smaller icon footprint than today
- Ensure its weight is lower than the provider region so the launcher still reads as `Agent-first`

### 5. Shared Surface Styling

The redesign should flatten the internal area without creating a new design system.

Rules:

- Use one shared internal surface instead of two card-like sub-panels
- Reduce internal padding and gaps
- Weaken the center divider
- Reduce the visual contrast between left and right background treatments
- Preserve existing theme tokens and component vocabulary rather than inventing a separate style language

### 6. Compact Width Behavior

The current compact carousel behavior remains the interaction model for narrow widths.

Rules:

- Preserve the existing `agent / file` panel switching logic
- Preserve current swipe and dot navigation behavior
- Only adjust the compact-mode visuals to align with the flatter shared-workarea styling
- Do not introduce a third mode or a new mobile information architecture

## Interaction and Behavior Constraints

The redesign is visual and structural only. Existing behavior must remain intact:

- provider click still launches or opens install guidance
- drag-and-drop still targets the file-open area
- pane assignment / replacement behavior remains unchanged
- drag overlay and drop-target states remain unchanged
- diagnostics and provider documentation links remain accessible

## Test and Validation Requirements

Update tests to match the new internal launcher grammar without weakening behavior coverage.

Required updates:

- keep coverage for provider launch behavior
- keep coverage for drag-and-drop file open behavior
- keep coverage for compact carousel switching
- update assertions for helper-copy placement so the sentence is verified in the internal workarea, not the old footer position
- update structure/style assertions so tests stop depending on two strongly independent launcher panel visuals
- update theme/style tests so the new shared workarea and flatter rows remain token-aligned

## Scope Boundaries for Implementation

Implementation may adjust:

- markup structure inside the draft launcher body
- draft launcher class names
- launcher-specific CSS in `components.css`
- related unit and style tests

Implementation must not expand into:

- global pane header redesign
- unrelated workspace panel restyling
- provider behavior changes
- new localization copy beyond relocation or minimal wording polish if strictly needed

## Success Criteria

The redesign is successful if:

- the launcher reads as one coherent internal surface instead of two separate cards
- provider scanning feels denser and faster
- the right-side file area remains understandable but clearly secondary
- the helper sentence explains the two entry paths without enlarging the outer header
- the desktop layout feels less visually split while preserving existing interaction logic
