# Coder Studio Visual Style Guide

## Scope
This document defines the global visual standard for Coder Studio. All new UI, refactors, and theme changes must follow this guide. `theme.css` is the single source of truth for design tokens. Component styles in `app.css` or future module styles may only consume tokens, not redefine ad hoc values unless there is a clear product-level reason.

## Design Principles
1. Flat first. Prefer subtle surfaces and separators over stacked cards, shadows, and heavy outlines.
2. Dense but readable. The product is a professional workspace, not a marketing site. Prioritize information density, alignment, and scanability.
3. One source of truth. Typography, spacing, radius, color, and control sizes must come from theme tokens.
4. Workspace oriented. Top-level navigation represents workspaces. Sessions and panes are secondary views inside a workspace.
5. State by contrast, not decoration. Use color, opacity, and lightweight highlights to show active, unread, running, warning, and error states.

## Theme Architecture
1. `src/styles/theme.css`
   Defines semantic tokens only.
   Includes typography, spacing, radius, layout constants, and light/dark theme color tokens.
2. `src/styles/app.css`
   Defines layout and component rules.
   Must use semantic tokens from `theme.css`.
3. No component should hardcode:
   Raw hex colors, arbitrary rgba values, one-off radii, one-off spacing, or control heights.

## Token Model
### Typography
- `--font-sans`: default UI typeface
- `--font-mono`: code / terminal / diff typeface
- `--font-xs` to `--font-2xl`: type scale
- `--font-weight-medium`, `--font-weight-semibold`
- `--line-tight`, `--line-normal`

### Spacing
- `--space-1`: 2px
- `--space-2`: 4px
- `--space-3`: 8px
- `--space-4`: 12px
- `--space-5`: 16px
- `--space-6`: 20px
- `--space-7`: 24px

Do not introduce random 6px, 10px, 14px, 18px values unless they become formal tokens.

### Radius
- `--radius-2xs`: 2px
- `--radius-xs`: 4px
- `--radius-sm`: 6px
- `--radius-md`: 8px
- `--radius-lg`: 12px
- `--radius-xl`: 16px
- `--button-radius`
- `--panel-radius`
- `--nav-item-radius`
- `--chip-radius`

Rules:
- Primary navigation and small controls use `--radius-2xs` or `--button-radius`.
- Panels use `--panel-radius`.
- Avoid large rounded shapes in workspace UI.

### Control Sizes
- `--control-h-sm`: compact controls
- `--control-h-md`: default controls
- `--control-h-lg`: primary navigation / dense panel headers

### Layout
- `--header-h`
- `--left-w`
- `--right-w`

Layout rules:
- Header height is compact and stable.
- Left and right columns are resizable but visually subordinate to the center workspace.
- Main work areas scroll internally, never through the whole app shell.

### Semantic Color Tokens
- `--bg`, `--bg-elevated`, `--bg-soft`
- `--bg-panel`, `--bg-card`
- `--text`, `--muted`, `--muted-strong`
- `--border`, `--border-strong`
- `--accent`, `--accent-soft`
- `--accent-2`, `--accent-2-soft`
- `--danger`, `--danger-soft`
- `--warning`
- `--success`
- `--surface-1`, `--surface-2`, `--surface-3`
- `--surface-ghost`
- `--surface-hover`, `--surface-hover-strong`
- `--surface-active`
- `--surface-border-soft`
- `--input-bg`
- `--header-bg`, `--header-tab-bg`, `--header-tab-bg-active`

Rules:
- Use semantic surface tokens for panels and controls.
- Use accent colors only for active, selected, focused, or live states.
- Use green for idle/healthy, blue for active/running, amber for warning, red for destructive/error.
- Avoid raw white overlays and decorative gradients in component styles.

## Component Standards
### Header
- Flat surface with a single bottom divider.
- Minimal horizontal padding.
- Workspace tabs are compact, horizontally scrollable, and clipped with ellipsis.
- Header actions are icon-first and low emphasis.

### Navigation
- Left rail icons are compact and tab-like.
- Session list items are lightweight rows, not heavy cards.
- Selected state uses `--surface-active` or `--surface-hover`, not thick borders.

### Panels
- Prefer divider-separated regions over nested cards.
- If a panel must be visually grouped, use `--surface-1` or `--surface-2` with `--surface-border-soft`.
- Keep shadows off by default in the main workspace.

### Buttons
- Use tokenized heights and radii only.
- Primary buttons are reserved for the main action in a local context.
- Icon buttons should not look like pills unless explicitly needed.

### Icons
- All product icons must come from the shared icon layer in `src/components/icons.tsx`.
- Do not add inline SVG icon components inside view files such as `App.tsx`.
- If an icon is missing, add it to the shared layer first and keep sizing/stroke defaults centralized.

### Inputs
- Input fields should use `--input-bg` and token radii.
- In dense work areas, inputs should align to one row where possible.
- Placeholder text must use muted tokens.

### Agent Pane
- Every pane must contain:
  - lightweight pane header
  - agent output body
  - input row
- Pane headers should show state and session identity with minimal chrome.
- Pane split dividers should be 1px tokenized separators.

### Code and Terminal Areas
- Editors and terminals should visually align with the same surface language as the agent pane.
- Context bars use subtle separators, not elevated cards.
- Progress indicators should be thin, quiet, and state-driven.

## Motion and Feedback
- Motion should be low amplitude and functional.
- Allowed:
  active glow, running pulse, progress shimmer, hover background transitions
- Avoid:
  bounce, large transforms, decorative motion, floating cards

## Do / Don’t
### Do
- Reuse tokens.
- Keep edges crisp and compact.
- Use dividers to create structure.
- Keep tab labels and metadata clipped cleanly.

### Don’t
- Add new raw hex values inside component rules.
- Add one-off border-radius values.
- Reintroduce prototype-style oversized cards.
- Mix multiple unrelated visual languages in the same workspace.

## Implementation Rules
1. Add or modify tokens in `src/styles/theme.css` first.
2. Use semantic tokens in component CSS.
3. If a new component needs a value not covered by tokens, extend the token layer first.
4. Before merging visual work, check:
   - dark and light theme both render correctly
   - spacing follows the token scale
   - no new ad hoc color/radius values were introduced
