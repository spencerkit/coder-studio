# Workspace Background Material System Design

## Goal

Define a single workspace-scoped background and material system so background images, transparency, and blur behave consistently across the desktop workspace without per-component exceptions.

The first rollout is intentionally limited to workspace surfaces:

- app workspace scene
- sidebar and activity bar
- session cards
- terminal shell and terminal content
- editor shell and editor content
- status bar and footer-style workspace chrome

## Problem

The current workspace background behavior is inconsistent because three different systems overlap:

1. theme foundation background tokens such as `--bg-page`, `--bg-surface`, and `--bg-terminal`
2. surface tokens such as `--surface-overlay-bg`
3. component-local `color-mix(...)` expressions and renderer-specific overrides

This causes several failure modes:

- layout wrappers accidentally block the background image
- session, footer, terminal, and editor surfaces do not follow one shared material rule
- xterm and other renderers become special cases with their own background logic
- changing glass opacity or blur requires editing many unrelated components
- tests can verify local selectors but not the consistency of the full workspace material model

## Product Direction

For the initial workspace-only rollout, the material behavior follows this rule:

- layout containers are transparent
- content rendering layers are transparent
- visible shells carry the material treatment
- readability is controlled by shell tint, shell blur, and global appearance settings

This means the background image should be able to visually pass through the full workspace, including the session and terminal content regions, while shell surfaces still provide readable framing.

## Scope

### In scope

- workspace-only background and material token system
- shared rules for transparent layout containers
- shared rules for shell surfaces
- shared rules for content layers
- xterm and Monaco background policy within the workspace
- tests that enforce the new token and selector usage inside workspace surfaces

### Out of scope

- global app-wide conversion of every surface token outside workspace
- hover, active, selection, and state color system redesign
- non-workspace dialogs, sheets, modals, and toasts
- server-side appearance behavior
- introducing a brand new color-space or RGB-channel token architecture across the whole app

## Constraints

- Keep the existing theme foundation tokens for now.
- Keep the existing runtime appearance controls for blur and opacity.
- Avoid a repo-wide migration to RGB channel tokens in this phase.
- Do not allow new per-component glass formulas inside workspace CSS after this system lands.

## Design Principles

### 1. One source of truth per layer

Each workspace node should belong to exactly one of these layers:

- scene/layout layer
- shell/material layer
- content/rendering layer

No element should mix responsibilities across multiple layers.

### 2. Components consume semantics, not math

Workspace components must consume semantic `--ws-*` tokens.

They must not directly consume:

- `--app-surface-opacity`
- `--app-surface-backdrop-filter`
- `--surface-overlay-bg`
- raw `color-mix(...)` formulas for shell backgrounds

### 3. Renderer parity

Renderer-backed content such as xterm and Monaco must follow the same content-layer rule as normal DOM content:

- content background is transparent
- shell background provides the visible material

### 4. Workspace-first rollout

This system is scoped to workspace first so the migration can be completed and validated before expanding to other app surfaces.

## Token Architecture

The system has four layers of tokens and runtime state.

### 1. Theme Foundation

Existing theme tokens remain the color foundation and are not directly removed in this phase.

Examples:

- `--bg-page`
- `--bg-surface`
- `--bg-panel`
- `--bg-elevated`
- `--bg-terminal`
- `--surface-page-bg`
- `--surface-panel-bg`
- `--surface-elevated-bg`
- `--surface-overlay-bg`

Responsibility:

- define theme-family and light/dark specific colors

Non-responsibility:

- do not encode workspace material semantics directly

### 2. Appearance Runtime

Existing runtime appearance state remains the workspace material input.

Examples:

- `data-appearance-glass`
- `--app-surface-opacity`
- `--app-surface-backdrop-filter`

Responsibility:

- express current user-selected blur and transparency behavior

Non-responsibility:

- components must not directly reference these values

### 3. Workspace Material System

Introduce a new workspace-scoped material layer with `--ws-*` tokens.

#### Level tokens

- `--ws-level-0`
- `--ws-level-1`
- `--ws-level-2`
- `--ws-level-3`
- `--ws-level-4`

Responsibility:

- define the allowed opacity steps for workspace shell surfaces

#### Behavior tokens

- `--ws-backdrop-filter`
- `--ws-content-bg`

Responsibility:

- define shared blur behavior
- define the default background for workspace content layers

#### Semantic surface tokens

- `--ws-sidebar-bg`
- `--ws-activitybar-bg`
- `--ws-statusbar-bg`
- `--ws-session-bg`
- `--ws-session-active-bg`
- `--ws-session-header-bg`
- `--ws-terminal-shell-bg`
- `--ws-terminal-toolbar-bg`
- `--ws-terminal-tabs-bg`
- `--ws-editor-shell-bg`
- `--ws-editor-toolbar-bg`

Responsibility:

- provide final component-facing backgrounds

### 4. Component Usage

Workspace components may only use:

- `background: var(--ws-...-bg)`
- `background: var(--ws-content-bg)`
- `background: transparent`
- `backdrop-filter: var(--ws-backdrop-filter)`

Workspace components must not embed custom material math.

## Material Behavior States

The workspace material system resolves into three states.

### Solid

Condition:

- `data-appearance-glass="off"`

Behavior:

- `--ws-backdrop-filter: none`
- `--ws-*` shell backgrounds resolve to solid workspace surface colors
- content backgrounds stay transparent where required by structure

Purpose:

- stable non-glass workspace appearance without renderer exceptions

### Glass

Condition:

- `data-appearance-glass="on"`
- theme is not high contrast

Behavior:

- `--ws-backdrop-filter` resolves from `--app-surface-backdrop-filter`
- `--ws-level-*` tokens are derived once from `--surface-overlay-bg` and `--app-surface-opacity`
- semantic shell tokens resolve from the level scale
- content backgrounds remain transparent

Purpose:

- consistent background-image pass-through and shared material response across all workspace surfaces

### High Contrast

Condition:

- `data-theme="hc-dark"` or `data-theme="hc-light"`

Behavior:

- `--ws-backdrop-filter: none`
- semantic shell tokens resolve to solid high-contrast surfaces
- no glass transparency or blur is applied

Purpose:

- preserve accessibility and predictable contrast

## Recommended Token Resolution

The exact percentages can still be tuned during implementation, but the architecture should follow this shape:

```css
:root {
  --ws-backdrop-filter: none;
  --ws-content-bg: transparent;

  --ws-sidebar-bg: var(--surface-panel-bg);
  --ws-activitybar-bg: var(--surface-panel-bg);
  --ws-statusbar-bg: var(--surface-panel-bg);
  --ws-session-bg: var(--surface-panel-bg);
  --ws-session-active-bg: var(--surface-elevated-bg);
  --ws-session-header-bg: var(--surface-elevated-bg);
  --ws-terminal-shell-bg: var(--surface-panel-bg);
  --ws-terminal-toolbar-bg: var(--surface-elevated-bg);
  --ws-terminal-tabs-bg: var(--surface-elevated-bg);
  --ws-editor-shell-bg: var(--surface-panel-bg);
  --ws-editor-toolbar-bg: var(--surface-elevated-bg);
}

:root[data-appearance-glass="on"] {
  --ws-backdrop-filter: var(--app-surface-backdrop-filter, none);

  --ws-level-0: transparent;
  --ws-level-1: color-mix(in srgb, var(--surface-overlay-bg) calc(var(--app-surface-opacity) * 40%), transparent);
  --ws-level-2: color-mix(in srgb, var(--surface-overlay-bg) calc(var(--app-surface-opacity) * 56%), transparent);
  --ws-level-3: color-mix(in srgb, var(--surface-overlay-bg) calc(var(--app-surface-opacity) * 72%), transparent);
  --ws-level-4: color-mix(in srgb, var(--surface-overlay-bg) calc(var(--app-surface-opacity) * 88%), transparent);

  --ws-sidebar-bg: var(--ws-level-3);
  --ws-activitybar-bg: var(--ws-level-2);
  --ws-statusbar-bg: var(--ws-level-3);
  --ws-session-bg: var(--ws-level-2);
  --ws-session-active-bg: var(--ws-level-3);
  --ws-session-header-bg: var(--ws-level-3);
  --ws-terminal-shell-bg: var(--ws-level-3);
  --ws-terminal-toolbar-bg: var(--ws-level-2);
  --ws-terminal-tabs-bg: var(--ws-level-2);
  --ws-editor-shell-bg: var(--ws-level-2);
  --ws-editor-toolbar-bg: var(--ws-level-3);
}

:root[data-theme="hc-dark"],
:root[data-theme="hc-light"] {
  --ws-backdrop-filter: none;
}
```

## Component Mapping Rules

### Scene / Layout layer

These nodes must remain transparent and structural only:

- `.workspace-page`
- `.workspace-body`
- `.workspace-main-area`
- `.workspace-main-stage`
- `.agent-panes`
- `.agent-pane`
- `.pane-layout`
- `.pane-layout-child`
- `.workspace-sidebar-panel__content`
- `.workspace-sidebar-view`
- `.workspace-sidebar-panel__body`

Allowed responsibilities:

- sizing
- layout
- overflow
- clipping
- stacking context when required

Disallowed responsibilities:

- visible shell tint
- surface blur
- direct terminal/editor background color

### Shell / Material layer

These nodes must consume semantic workspace shell tokens:

- `.workspace-sidebar-panel` -> `--ws-sidebar-bg`
- `.workspace-activity-bar` -> `--ws-activitybar-bg`
- `.workspace-status-bar` -> `--ws-statusbar-bg`
- `.session-card` -> `--ws-session-bg`
- `.session-card--active` -> `--ws-session-active-bg`
- `.session-header` -> `--ws-session-header-bg`
- `.workspace-bottom-panel > .bottom-terminal` -> `--ws-terminal-shell-bg`
- `.terminal-toolbar` -> `--ws-terminal-toolbar-bg`
- `.bottom-terminal-tabs` -> `--ws-terminal-tabs-bg`
- `.workspace-git-editor` -> `--ws-editor-shell-bg`
- `.code-editor-header` -> `--ws-editor-toolbar-bg`

These shell nodes also consume:

- `backdrop-filter: var(--ws-backdrop-filter)`

### Content / Rendering layer

These nodes must be transparent:

- `.session-terminal`
- `.bottom-terminal-content`
- `.bottom-terminal-xterm`
- `.bottom-terminal-empty`
- `.xterm-host`
- `.xterm-screen`
- editor inner rendering surface

Rule:

- visible content should sit on the shell material, not create a second competing background

## Renderer Policy

### xterm

xterm must stop acting as a separate background system inside workspace.

Rules:

- xterm content background is transparent
- the shell around xterm provides the material
- workspace background behavior must not depend on ad hoc JS branching per terminal

Desired end state:

- xterm background policy is expressed as workspace content semantics, not renderer-specific exception logic

### Monaco

Monaco should follow the same content-layer behavior.

Rules:

- editor rendering background becomes transparent
- selection, cursor, line numbers, and syntax colors still come from the active theme
- editor shell provides the visible material tint

## Prohibited Patterns

Inside workspace-related rules, the following patterns should be treated as violations once migration starts:

- direct `background: var(--bg-page)`
- direct `background: var(--bg-surface)`
- direct `background: var(--bg-terminal)`
- direct `background: var(--surface-overlay-bg)`
- direct use of `--app-surface-opacity`
- direct use of `--app-surface-backdrop-filter`
- new raw `color-mix(...)` shell formulas inside components

Exceptions:

- theme foundation and token-definition files
- the centralized workspace material token definition block

## Migration Plan

### Phase 1. Transparent container chain

Normalize the workspace layout chain to transparent:

- workspace body
- workspace main stage
- agent panes
- agent pane
- pane layout
- pane layout child

This is the structural prerequisite for background-image pass-through.

### Phase 2. Shell tokenization

Replace component-local glass formulas with semantic workspace shell tokens for:

- sidebar
- activity bar
- status bar
- session card
- terminal shell
- terminal toolbar
- terminal tabs
- editor shell and editor header

### Phase 3. Transparent content layers

Normalize all workspace content surfaces to transparent:

- session terminal
- bottom terminal content
- bottom terminal xterm
- xterm screen
- editor inner content

This phase is what makes the background image actually visible through the content regions.

### Phase 4. Renderer adaptation

Adapt renderer-backed surfaces to follow the workspace content model:

- xterm theme background
- Monaco editor background
- remove JS-side special casing that exists only to keep old opaque terminal behavior

## Testing Strategy

### Theme and token tests

Extend theme-sensitive stylesheet tests to assert that:

- workspace containers are transparent
- shell surfaces consume `--ws-*` tokens
- content surfaces are transparent
- workspace components do not carry raw material formulas after migration

### Renderer tests

Add focused tests for:

- xterm background policy inside workspace
- theme switches preserving transparent renderer backgrounds where required
- high-contrast fallback behavior

### Guardrail tests

Add assertions or lightweight audits that prevent:

- new workspace component rules from directly consuming runtime appearance variables
- new workspace component rules from introducing ad hoc shell `color-mix(...)` math

## Acceptance Criteria

- background images visually pass through the full workspace scene and content regions
- session, sidebar, terminal shell, footer, and editor surfaces follow one shared workspace material system
- terminal and editor renderers no longer behave as independent background systems
- changing workspace blur or opacity updates all workspace shells consistently
- high-contrast themes bypass glass behavior cleanly
- workspace CSS consumes semantic `--ws-*` tokens instead of local material formulas
- workspace content layers are transparent by default

## Files Expected To Change During Implementation

- `packages/web/src/styles/tokens.css`
- `packages/web/src/styles/components.css`
- `packages/web/src/styles/components.theme.test.ts`
- `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
- Monaco theme integration files used by the workspace editor

## Open Questions Deferred

- whether the same material system should later expand beyond workspace into settings and global overlays
- whether the long-term token foundation should migrate to RGB channel tokens
- whether editor shell and terminal shell should share one semantic token or remain separate
