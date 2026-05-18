# Overlay Governance Design

> **Date:** 2026-05-19
> **Status:** Draft
> **Scope:** `packages/web` overlay, dialog, drawer, sheet, and local runtime layer governance

## 1. Goal

Define a strict overlay governance model for `packages/web` so PC and mobile overlay experiences stop diverging in structure, styling, layering, and dismissal behavior.

This spec is intentionally governance-first:

- define a small allowed set of overlay primitives
- define what each primitive is allowed to contain
- define platform mapping between PC and mobile
- define a single z-index and dismissal contract
- produce a migration inventory for one-time convergence

The target outcome is not "similar visuals". The target outcome is that feature code can no longer invent new overlay types, custom backdrops, or ad-hoc layering rules.

## 2. Current Problems

The current codebase already has shared primitives such as `Modal`, `ConfirmDialog`, `Sheet`, `Popover`, and `Tooltip`, but desktop and runtime overlays are still partially fragmented.

Observed fragmentation in the current implementation:

- desktop business dialogs already use shared `Modal` and `ConfirmDialog`
- desktop command and launcher surfaces still use feature-owned overlays
- local terminal runtime overlays still use custom markup and local z-index values
- some large-content desktop modals are carrying drawer-like responsibilities
- mobile uses multiple sheet-like patterns with different shells and ownership boundaries

Concrete examples in the current tree:

- `packages/web/src/features/command-palette/components/command-palette.tsx`
  - desktop `command-palette-overlay`
- `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`
  - desktop `launch-overlay`
- `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
  - `paste-dialog-overlay`
  - upload busy overlay
  - `xterm-replay-overlay`
- `packages/web/src/features/workspace/views/shared/worktree-modal.tsx`
  - desktop large modal carrying detail-surface responsibility
- `packages/web/src/features/workspace/views/shared/worktree-manager-surface.tsx`
  - desktop large modal carrying complex management-surface responsibility

The result is inconsistency in four dimensions:

- visual style
- z-index / stacking order
- dismissal behavior
- semantic container choice

## 3. Non-Goals

- redesign every overlay visual from scratch
- introduce a general-purpose overlay manager in this phase
- merge all floating UI into a single primitive
- change `Popover`, `Tooltip`, `Select`, or `Toast` into dialog primitives
- perform incremental piecemeal migration without first defining governance

## 4. Governance Model

### 4.1 Allowed Overlay Families

Only the following families are allowed after convergence.

#### PC

- `PC Modal`
  - centered, blocking dialog
  - for confirmation, short forms, short decision points, bounded auth prompts
- `PC Drawer`
  - right-side blocking surface
  - for complex editing, long detail views, multi-section workflows, context-preserving work
- `PC Workbench Layer`
  - global workspace-level command surface
  - for command palette, launcher, global quick-switch, and similar product-shell interactions

#### Mobile

- `Mobile Centered Modal`
  - small blocking confirmation dialog
  - for destructive or short binary decisions only
- `Mobile Half Sheet`
  - bottom sheet for selection, light forms, light action lists
- `Mobile Full Sheet`
  - full-height mobile workflow surface
  - for complex creation, search, editing, and multi-section flows
- `Mobile Drawer`
  - side drawer only for navigation / workspace-switching shells
  - not a general business workflow container

#### Shared Cross-Platform Family

- `Local Runtime Overlay`
  - scoped to a host surface such as terminal, editor, or panel
  - for local blocking states, replay/loading overlays, inline paste dialogs, upload states
  - not allowed to behave like a global page dialog

### 4.2 Explicit Exclusions

The following are not part of the dialog/drawer governance family:

- `Popover`
- `Tooltip`
- `Select`
- `ActionMenu`
- `Toast`

They remain floating UI primitives and must not be treated as modal or drawer variants.

## 5. Semantic Contract Per Family

### 5.1 PC Modal

Allowed:

- confirm / cancel flows
- destructive confirmation
- short form entry
- auth prompts
- short explanatory dialogs

Disallowed:

- long-detail browsing
- multi-panel editing
- large multi-step workflows
- command palette or launcher use cases
- local terminal/editor runtime blocking

Sizing:

- `sm`, `md`, `lg`
- no feature-owned size inventions beyond the shared contract

Canonical primitive:

- shared `Modal`
- `ConfirmDialog` for strictly bounded confirm/cancel flows

### 5.2 PC Drawer

Allowed:

- large detail views
- worktree management
- editing flows that benefit from preserving page context
- multi-section content with richer internal layout

Disallowed:

- tiny confirmations
- global workspace command surfaces
- local runtime overlays inside terminal/editor hosts

Canonical primitive:

- new shared `Drawer`

### 5.3 PC Workbench Layer

Allowed:

- command palette
- workspace launcher
- global search / quick switch surfaces if added later

Disallowed:

- file deletion confirm
- auth prompts
- feature-local editing forms

Canonical primitive:

- new shared `WorkbenchLayer`

### 5.4 Mobile Centered Modal

Allowed:

- short confirmation
- destructive action confirmation
- bounded binary decisions with at most a few actions

Disallowed:

- long forms
- search
- complex editing
- dense lists

Canonical primitive:

- shared mobile confirm / small modal path

### 5.5 Mobile Half Sheet

Allowed:

- selection lists
- light forms
- lightweight action menus
- compact task flows

Disallowed:

- complex creation/editing
- multi-section workflows that need durable context

Canonical primitive:

- shared `Sheet` in half-height mode

### 5.6 Mobile Full Sheet

Allowed:

- complex edit/create/search surfaces
- full workflow containers
- mobile equivalent of desktop drawer

Disallowed:

- tiny confirmation-only flows that should stay centered

Canonical primitive:

- shared `Sheet` in fullscreen mode

### 5.7 Mobile Drawer

Allowed:

- workspace / navigation side drawer only

Disallowed:

- business workflow dialogs
- general-purpose detail forms

Canonical primitive:

- current mobile drawer shell, governed as a separate product-shell primitive

### 5.8 Local Runtime Overlay

Allowed:

- terminal paste dialogs
- local upload blocking states
- replay / hydration overlays
- other host-scoped runtime status layers

Disallowed:

- page-level confirmation
- feature-global dialog behavior
- custom page backdrops

Canonical primitive:

- new shared `LocalOverlay`

## 6. Platform Mapping Rules

The same business scenario must map to a single canonical container per platform.

| Scenario | Desktop | Mobile |
|---|---|---|
| destructive confirm | `PC Modal` / `ConfirmDialog` | `Mobile Centered Modal` |
| short form / auth prompt | `PC Modal` | `Mobile Half Sheet` or `Mobile Centered Modal` depending on density |
| complex edit / long detail | `PC Drawer` | `Mobile Full Sheet` |
| global command / launcher | `PC Workbench Layer` | `Mobile Full Sheet` or dedicated workbench page |
| local runtime blocking | `Local Runtime Overlay` | `Local Runtime Overlay` |

Hard rule:

- one scenario cannot map to multiple competing desktop containers
- one scenario cannot use a shared primitive in one place and a feature-owned overlay in another

## 7. Layering Contract

### 7.1 Current State

Current shared tokens already include:

- `--z-dropdown: 100`
- `--z-sticky: 200`
- `--z-modal-backdrop: 300`
- `--z-modal: 400`
- `--z-popover: 500`
- `--z-tooltip: 600`
- `--z-toast: 700`

Current fragmentation shows missing semantic slots:

- desktop launcher overlay uses `z-index: 100`
- local paste overlay uses `z-index: 10`
- no explicit workbench-layer token
- no explicit local runtime overlay token

### 7.2 Proposed Token Scale

Replace the implicit layering assumptions with explicit semantic slots:

- `--z-dropdown: 100`
- `--z-sticky: 200`
- `--z-local-overlay: 240`
- `--z-modal-backdrop: 300`
- `--z-modal: 310`
- `--z-drawer-backdrop: 320`
- `--z-drawer: 330`
- `--z-workbench-backdrop: 340`
- `--z-workbench: 350`
- `--z-popover: 360`
- `--z-tooltip: 370`
- `--z-toast: 380`

### 7.3 Layering Rules

- business features may not introduce raw numeric `z-index` values for overlays
- all global blocking surfaces must consume semantic z-index tokens
- `Local Runtime Overlay` must remain scoped to its host container and must not compete with page-level layers
- `Workbench Layer` must sit above normal page dialogs
- `Toast` is top-most but never focus-stealing

## 8. Dismissal and Focus Contract

### 8.1 Root Blocking Families

Root blocking families are:

- `PC Modal`
- `PC Drawer`
- `PC Workbench Layer`
- `Mobile Centered Modal`
- `Mobile Half Sheet`
- `Mobile Full Sheet`

Shared rules:

- focus must move into the surface on open
- focus must restore to the trigger on close
- only one root blocking surface should be active at a time for standard business flows
- opening a root blocking surface should lock document scrolling

### 8.2 Family-Specific Dismissal Rules

#### PC Modal

- supports `Escape`
- supports explicit close affordance
- backdrop click allowed by default
- blocking submit states may temporarily disable dismissal

#### PC Drawer

- supports `Escape`
- supports explicit close affordance
- backdrop click allowed only for preview/read-only cases
- edit flows should default to non-accidental dismissal

#### PC Workbench Layer

- supports `Escape`
- supports outside click dismissal
- does not use confirm/cancel footer semantics by default

#### Mobile Centered Modal

- dismissal should be explicit and minimal
- no complex branching controls

#### Mobile Half Sheet

- supports header close/back
- backdrop dismissal allowed only for light, non-destructive flows

#### Mobile Full Sheet

- supports header close/back
- backdrop dismissal disabled by default

#### Local Runtime Overlay

- backdrop click does not dismiss by default
- cancelability is determined by runtime state, not by generic dialog rules
- no document scroll locking beyond the host surface

## 9. Component Contract

The overlay governance must be enforced through a small component whitelist.

### 9.1 Shared Primitive Set

Keep:

- `Modal`
- `ConfirmDialog`
- `Sheet`
- `Popover`
- `Tooltip`
- `Toast`

Add:

- `Drawer`
- `WorkbenchLayer`
- `LocalOverlay`

### 9.2 Enforcement Rules

- business code may not hand-roll overlay backdrops
- business code may not hand-roll overlay portal shells for governed families
- new overlay scenarios must be expressed using a shared primitive
- exceptions are allowed only when a primitive is explicitly defined as a shell-level product primitive

## 10. Migration Inventory

### 10.1 Keep on Modal / ConfirmDialog

These are already aligned with bounded modal semantics:

- `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
  - `CreatePathModal` stays on `Modal`
  - `DeleteFileModal` stays on `ConfirmDialog`
- `packages/web/src/features/workspace/views/shared/git-status-bar.tsx`
  - sync confirm stays on `ConfirmDialog`
  - auth prompt stays on `Modal`
- `packages/web/src/features/supervisor/views/shared/objective-dialog.tsx`
  - stays on `Modal` for now, with a governance cap to prevent it from expanding into a drawer-scale flow

### 10.2 Migrate to Drawer

These currently behave more like complex detail/edit surfaces than bounded dialogs:

- `packages/web/src/features/workspace/views/shared/worktree-modal.tsx`
  - desktop path should move from large modal to `Drawer`
- `packages/web/src/features/workspace/views/shared/worktree-manager-surface.tsx`
  - desktop managed surface should move from large modal to `Drawer`
  - inline preview mode must either be removed, made preview-only, or explicitly documented as a non-business preview surface

### 10.3 Migrate to WorkbenchLayer

These are global workspace/product-shell command surfaces and should not remain feature-owned modal overlays:

- `packages/web/src/features/command-palette/components/command-palette.tsx`
  - desktop `command-palette-overlay`
- `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`
  - desktop `launch-overlay`

### 10.4 Migrate to LocalOverlay

These should become host-scoped runtime overlays with one consistent contract:

- `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
  - `paste-dialog-overlay`
  - upload busy overlay
  - `xterm-replay-overlay`
- `packages/web/src/features/terminal-panel/views/shared/xterm-placeholder.tsx`
  - replay/placeholder visuals should align with the same local runtime overlay contract

### 10.5 Mobile-Side Governance Alignment

These are already mobile-shell families and should be preserved but normalized against the governance model:

- `packages/web/src/components/ui/sheet/index.tsx`
  - base mobile sheet shell
- `packages/web/src/features/workspace/views/mobile/mobile-workspace-drawer.tsx`
  - remains a navigation/workspace drawer family, not a general workflow dialog
- `packages/web/src/features/mobile-select/components/mobile-select-sheet.tsx`
  - remains in floating/select family, not dialog family

## 11. One-Time Convergence Strategy

The user requirement is:

1. define the rules first
2. define the migration scope next
3. converge in a one-time coordinated pass

This spec follows that model.

### 11.1 Phase 1: Governance and Token Contract

- publish this spec
- add overlay family definitions to shared UI docs
- add semantic z-index tokens
- define the primitive whitelist and explicit exclusions

### 11.2 Phase 2: Primitive Completion

- implement `Drawer`
- implement `WorkbenchLayer`
- implement `LocalOverlay`

No feature migration should start before all three missing primitives exist.

### 11.3 Phase 3: One-Time Migration

Perform a coordinated migration covering:

- desktop feature-owned overlays
- oversized modal-like surfaces that should become drawers
- local runtime overlays in terminal
- any remaining raw numeric overlay z-index usage

### 11.4 Phase 4: Post-Migration Enforcement

- add docs and migration inventory updates
- scan for raw overlay/backdrop implementations
- fail review on new feature-owned overlay shells in governed families

## 12. Acceptance Criteria

The convergence is complete when all of the following are true:

- no desktop business overlay uses feature-owned global backdrop markup outside approved shell families
- no governed overlay family uses raw numeric z-index values
- `CommandPalette` and `WorkspaceLaunchModal` desktop flows use `WorkbenchLayer`
- worktree detail/management desktop surfaces use `Drawer`
- terminal runtime overlays use shared `LocalOverlay`
- PC and mobile overlay families map consistently by scenario
- dismissal and focus behavior is consistent inside each family

## 13. Risks and Mitigations

### Risk 1: "Modal vs Drawer" drift returns

Mitigation:

- enforce semantic family selection in code review
- keep the whitelist small
- document explicit "disallowed" use cases per family

### Risk 2: Workbench surfaces get folded back into modal patterns

Mitigation:

- keep `WorkbenchLayer` as a first-class primitive
- treat global command surfaces as shell-level UI, not business dialogs

### Risk 3: Runtime overlays keep reappearing as one-off CSS

Mitigation:

- formalize `LocalOverlay`
- forbid local numeric z-index overlay hacks in governed host surfaces

## 14. Recommended Next Step

After this spec is approved:

- write an implementation plan for the one-time convergence pass
- implement the missing primitives first
- then migrate the inventoried callers in a single coordinated overlay-governance change set
