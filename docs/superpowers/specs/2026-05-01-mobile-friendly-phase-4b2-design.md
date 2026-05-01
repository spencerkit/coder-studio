# Mobile-Friendly Phase 4B2 Design

> Date: 2026-05-01
> Status: Approved for planning
> Scope: Mobile floating-surface adaptation for `CommandPalette`

## 1. Goal

Phase 4B2 adapts `CommandPalette` from a desktop-centered overlay into a mobile-friendly sheet without changing its command registry, keyboard shortcut semantics, or desktop behavior.

This phase exists because the broader mobile shell work already established a consistent sheet model for phones, but `CommandPalette` still behaves like a desktop modal:

- fixed-width centered overlay
- desktop-first spacing and hierarchy
- no alignment with the existing mobile sheet chrome

On mobile, that creates three problems:

- it breaks the single-surface language established by earlier phases
- it wastes vertical space around the command list
- it risks layered-surface confusion when a command opens another floating surface such as `WorkspaceLaunchModal`

## 2. In Scope

- Mobile sheet treatment for `CommandPalette`
- Shared viewport-based branching inside the feature component
- Mobile-safe search, result list, and command execution behavior
- Preservation of existing `WorkspaceLaunchModal` trigger behavior from within the palette
- Tests that prove mobile presentation changes without regressing desktop flows

## 3. Out of Scope

Phase 4B2 does not include:

- new commands
- command grouping or categorization
- route-based command palette navigation
- changes to keyboard shortcut registration
- changes to command filtering logic beyond layout-driven presentation updates
- toast repositioning or config-drift banner compaction reserved for `4B3`

This phase also does not change:

- command action semantics
- workspace switching behavior
- `WorkspaceLaunchModal` business logic
- desktop command palette layout beyond minimal neutral refactoring needed for reuse

## 4. Design Constraints

- Mobile breakpoint behavior remains aligned with the shared viewport rule: `(max-width: 899px)` or `(pointer: coarse)`
- Desktop remains the source of truth for the current centered command palette overlay
- Existing call sites stay unchanged; `DesktopShell` and `MobileShell` should keep rendering `<CommandPalette />`
- Mobile must preserve the one-sheet rule: only one visible top-level floating surface at a time
- Command list, search semantics, and action handlers remain feature-owned inside `CommandPalette`
- This phase should reuse the existing `MobileSheet` scaffold rather than inventing a palette-specific mobile chrome

## 5. Core Decisions

### 5.1 Keep Feature Ownership Inside `CommandPalette`

`CommandPalette` should self-adapt based on the shared viewport hook instead of introducing a separate mobile-only wrapper in `MobileShell`.

That keeps these properties true:

- desktop and mobile still share one command source
- global open/close state remains driven by `commandPaletteOpenAtom`
- command execution, search filtering, keyboard navigation, and launch-modal handoff remain in one component

### 5.2 Use `MobileSheet` as the Mobile Container

On mobile, `CommandPalette` should render inside `MobileSheet` with:

- kicker
- title
- close action
- scrollable result body
- no footer

The palette does not need a back action because it is a root-only surface in `4B2`.

### 5.3 Preserve the One-Sheet Rule When Launching a Workspace

The most important interaction rule in `4B2` is what happens when the palette triggers `WorkspaceLaunchModal`.

On mobile:

- executing the workspace-launch command must close the command palette first
- the mobile-adapted `WorkspaceLaunchModal` from `4B1` then opens as the next sheet
- there must not be two stacked backdrops or two visible `MobileSheet` layers at once

This keeps the mental model consistent with the mobile supervisor objective work from `4B1`.

### 5.4 Keep the Command Set and Search Model Unchanged

`4B2` is a container and interaction adaptation, not an information-architecture rewrite.

Therefore this phase intentionally keeps:

- the existing command set
- the current command ordering
- filtering by `label`, `description`, and `shortcut`
- current command action side effects

It does not add:

- grouped sections
- recent commands
- pinned commands
- provider- or route-specific palette variants

## 6. Mobile Surface Model

### 6.1 Container Structure

The mobile palette should follow this structure:

```text
┌──────────────────────────────┐
│ grab                         │
│ COMMAND PALETTE        关闭  │
│ Quick Actions                │
├──────────────────────────────┤
│ [search input         ]      │
│ 12 actions                   │
├──────────────────────────────┤
│ command list                 │
│ label                        │
│ description          [kbd]   │
│ ---------------------------- │
│ ...                          │
└──────────────────────────────┘
```

Behavior:

- header remains visible
- search region stays near the top of the sheet
- result list owns scrolling
- body spacing respects safe-area insets

### 6.2 Item Layout on Mobile

The mobile list item should remain a single tap target, but adapt to narrow widths by treating content as a two-line block:

- first line: command label
- second line: command description
- shortcut badge remains visible when present, but should not dominate horizontal space

This is a presentation change only. It should not introduce a second metadata line, grouping header, or expandable item behavior.

### 6.3 Search and Keyboard Behavior

Search behavior remains the same on all viewports:

- search query updates the filtered list
- selection resets to the first result when the query changes
- empty state appears when no results match

Keyboard behavior should remain intact even on mobile-capable devices with hardware keyboards:

- `ArrowDown` and `ArrowUp` move the selected row
- `Enter` executes the selected command
- `Escape` closes the palette
- `Ctrl/Cmd+K` continues to toggle the palette globally

Touch interaction must remain first-class:

- tapping a row executes it
- tapping the backdrop closes the sheet

## 7. Desktop Preservation

Desktop behavior is explicitly preserved:

- `CommandPalette` continues to render its existing centered overlay shell
- current markup classes such as `.command-palette-overlay` remain the desktop path
- current keyboard navigation and click-to-execute behavior remain unchanged

If the implementation needs to branch, prefer a mobile-specific render branch rather than broad shared markup changes that could disturb desktop spacing or animation.

## 8. Integration Shape

Expected code changes are concentrated in:

- `packages/web/src/features/command-palette/components/command-palette.tsx`
- `packages/web/src/features/command-palette/components/command-palette.test.tsx`
- `packages/web/src/styles/components.css`

Supporting reuse should come from existing components only:

- `packages/web/src/hooks/use-viewport.ts`
- `packages/web/src/shells/mobile-shell/mobile-sheet.tsx`
- `packages/web/src/features/workspace/components/workspace-launch-modal.tsx`

Expected implementation approach:

- keep `CommandPalette` mounted the same way in both shells
- branch between desktop overlay and mobile `MobileSheet` inside the feature component
- keep command-building and filtering logic in one place
- close the palette before rendering the workspace launch flow on mobile

## 9. Testing Strategy

### 9.1 Primary Coverage

Required coverage for `CommandPalette`:

- desktop still renders the existing overlay shell
- mobile renders inside `MobileSheet`
- mobile search still filters commands
- mobile command execution still runs the original action and closes the sheet
- launching a workspace from the palette does not leave the palette sheet open underneath the launcher

### 9.2 Regression Boundaries

Desktop regression coverage should continue to prove:

- workspace switching still updates `activeWorkspaceIdAtom`
- non-workspace routes still navigate to `/workspace` when switching workspaces
- keyboard selection and execution behavior remain intact

### 9.3 Verification

At minimum, `4B2` should be verified with:

- focused `CommandPalette` tests
- any required lightweight shell regression tests if the mobile rendering path needs coverage there
- lint on all touched files
- full web test suite after the change lands

## 10. Risks and Mitigations

### Risk 1: Nested mobile sheets when launching a workspace from the palette

Mitigation:

- close the palette before opening the workspace launcher
- add explicit tests for no overlapping mobile palette and launcher surfaces

### Risk 2: Desktop-neutral refactors accidentally changing overlay behavior

Mitigation:

- keep desktop markup path explicit
- isolate mobile treatment behind viewport branching
- preserve existing keyboard handler behavior

### Risk 3: Mobile sheet body becoming cramped under the software keyboard

Mitigation:

- keep the result list as the only scroll container
- avoid adding a footer
- let the shared mobile sheet spacing and safe-area handling do the container work

### Risk 4: Scope creep into information architecture changes

Mitigation:

- freeze the command set and filtering model for `4B2`
- defer grouping, recents, and command curation work to a future phase if needed
