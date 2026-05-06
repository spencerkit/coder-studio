# Mobile-Friendly Phase 4B1 Design

> Date: 2026-05-01
> Status: Draft for review
> Scope: Mobile floating-surface adaptation for `WorkspaceLaunchModal`, `WorktreeModal`, and `ObjectiveDialog`

## 1. Goal

Phase 4B1 adapts the first group of desktop-centered floating surfaces into mobile-friendly sheet experiences without changing their business logic, command contracts, or desktop behavior.

This phase exists because Phase 4A already made the page-level secondary routes usable on phones, but several important flows still open as desktop overlays:

- opening a workspace from `Welcome`, `TopBar`, or `CommandPalette`
- inspecting a worktree from Git-related entry points
- enabling, editing, or disabling a supervisor objective

On mobile, those centered overlays create three recurring problems:

- they do not respect the existing mobile shell sheet model
- they compete poorly with the on-screen keyboard and safe-area insets
- they break the single-surface mental model established in Phases 1-3

## 2. In Scope

- Mobile sheet treatment for `WorkspaceLaunchModal`
- Mobile sheet treatment for `WorktreeModal`
- Mobile supervisor-objective editing flow that replaces the desktop `ObjectiveDialog` overlay with a mobile sheet-hosted detail step
- Shared mobile floating-surface structure for header, body, footer, safe-area handling, and close/back behavior
- Tests that prove mobile presentation changes without regressing desktop flows

## 3. Out of Scope

Phase 4B1 does not include the remaining Phase 4B surfaces:

- `CommandPalette`
- toast repositioning
- config-drift banner compaction outside the `Settings` page context

This phase also does not change:

- route structure
- workspace launch command semantics
- worktree websocket commands or data shape
- supervisor websocket commands or atom contracts
- desktop modal layout beyond minimal neutral refactoring needed to share logic

## 4. Design Constraints

- Mobile breakpoint behavior remains aligned with the shared viewport rule: `(max-width: 899px)` or `(pointer: coarse)`
- Desktop remains the source of truth for current centered modal behavior
- Mobile should preserve the Phase 0 design constraint that only one top-level sheet exists at a time
- Existing call sites should stay simple; callers should not need to understand separate desktop/mobile feature implementations
- Business logic should remain inside feature components, while mobile shell chrome stays responsible only for shared sheet framing
- Mobile adaptations should favor shared internal content extraction over parallel component copies

## 5. Core Decisions

### 5.1 Split Phase 4B into Smaller Deliverables

Phase 4B is intentionally split into:

- `4B1`: `WorkspaceLaunchModal`, `WorktreeModal`, `ObjectiveDialog`
- `4B2`: `CommandPalette`
- `4B3`: toast repositioning and config-drift compaction

`4B1` is the first deliverable because these three surfaces are all modal-to-sheet adaptations and can establish a reusable pattern before the command palette and polish work.

### 5.2 Reuse One Mobile Floating-Surface Scaffold

The existing `MobileSheet` should become the shared mobile floating-surface scaffold for this phase. It should support:

- optional kicker
- title
- optional back action
- close action
- scrollable body slot
- optional sticky footer slot
- content-class hooks for per-surface styling

This keeps mobile overlay behavior visually and structurally consistent across the shell.

### 5.3 Keep Feature Ownership in the Feature Components

`WorkspaceLaunchModal` and `WorktreeModal` should adapt themselves based on the shared viewport hook rather than introducing separate mobile-only entry-point wrappers at each caller.

That keeps these properties true:

- `Welcome`, `TopBar`, and `CommandPalette` can keep rendering `WorkspaceLaunchModal` the same way
- future worktree entry points can keep rendering `WorktreeModal` the same way
- feature-local state, data loading, and submit/close behavior stay close to the feature implementation

### 5.4 Preserve the One-Sheet Rule for Supervisor Objective Editing

`ObjectiveDialog` is the only surface in `4B1` that conflicts with the mobile shell’s existing sheet stack. On mobile, it is already opened from inside `MobileSupervisorSheet`. Opening a second backdrop/sheet from there would violate the Phase 0 design rule that only one top-level sheet exists at a time.

Therefore the mobile objective flow should not render a second overlay.

Instead:

- desktop keeps the current centered `ObjectiveDialog`
- mobile `Supervisor` keeps a single sheet
- objective enable/edit/disable becomes a detail step inside that existing supervisor sheet

This still gives `ObjectiveDialog` a mobile sheet experience, but it is sheet-hosted rather than stacked as a second global overlay.

## 6. Shared Mobile Surface Model

### 6.1 Container Structure

The shared mobile surface scaffold should follow this structure:

```text
┌──────────────────────────────┐
│ grab handle                  │
│ kicker                  关闭 │
│ title                        │
├──────────────────────────────┤
│ scroll body                  │
│                              │
│ ...                          │
├──────────────────────────────┤
│ sticky footer actions        │
└──────────────────────────────┘
```

Behavior:

- backdrop tap closes the surface unless the current flow already uses in-sheet back navigation instead
- header stays visible
- footer stays visible when actions are important for completion
- body owns overflow scrolling
- bottom padding respects safe-area insets

### 6.2 Navigation Behavior

Mobile floating surfaces in `4B1` use two navigation patterns:

- root-only sheet: `WorkspaceLaunchModal`, `WorktreeModal`
- root/detail in-sheet navigation: `MobileSupervisorSheet` with objective editing

For root/detail behavior:

- leading back returns to the previous in-sheet level
- close dismisses the entire sheet
- only one visible layer exists at a time

### 6.3 Keyboard Behavior

The mobile scaffold should be robust under the software keyboard:

- action footer remains reachable
- textarea content remains scrollable
- the surface uses safe-area aware spacing rather than desktop fixed centering

This is especially important for the `ObjectiveDialog` enable/edit modes.

## 7. Workspace Launch Modal on Mobile

### 7.1 Mobile Form

`WorkspaceLaunchModal` becomes a near full-screen mobile sheet while preserving its existing workspace browsing and opening behavior.

Wireframe:

```text
┌──────────────────────────────┐
│ grab                         │
│ START WORKSPACE         关闭 │
│ Local Folder                 │
│ 选择一个目录作为 workspace     │
├──────────────────────────────┤
│ [Local Folder] [Remote Git]  │
│ [Home] [Up]                  │
│ [/] [~] [/home/spencer]      │
│ ---------------------------- │
│ directory list               │
│ > project-a                  │
│ > project-b                  │
│ > project-c                  │
├──────────────────────────────┤
│ selected path                │
│ [取消]              [打开]   │
└──────────────────────────────┘
```

### 7.2 Preserved Behavior

The mobile sheet must keep:

- automatic initial directory browse
- root path quick navigation
- parent traversal
- selected directory state
- `workspace.open` submission
- post-open navigation to `/workspace` when launched outside the workspace route

### 7.3 Presentation Changes Only

This phase does not add:

- remote Git flow
- multi-step wizard logic
- search
- new entry-point-specific wrappers

## 8. Worktree Modal on Mobile

### 8.1 Mobile Form

`WorktreeModal` becomes a full-screen mobile sheet with a sticky tab row and a scrollable content body.

Wireframe:

```text
┌──────────────────────────────┐
│ grab                         │
│ WORKTREE                关闭 │
│ my-feature-branch            │
│ branch / path / status       │
├──────────────────────────────┤
│ [Status] [Diff] [Tree]       │
│ ---------------------------- │
│ tab content                  │
│                              │
│ Status / Diff / Tree         │
│                              │
└──────────────────────────────┘
```

### 8.2 Preserved Behavior

The mobile version must keep:

- existing `status`, `diff`, and `tree` tabs
- the current fetch-on-tab-change model
- error handling
- loading states

### 8.3 Mobile Improvements

The mobile sheet should improve readability by:

- keeping the metadata header compact
- making the tab row sticky
- allowing `diff` and `tree` views to consume the available vertical space

This is a container/layout adaptation, not a content-model change.

## 9. Supervisor Objective Editing on Mobile

### 9.1 Root/Detail Model Inside the Existing Supervisor Sheet

On mobile, `MobileSupervisorSheet` should gain a local navigation model:

- `root`: supervisor summary or empty state
- `detail(mode)`: objective enable, edit, or disable content

Wireframe:

```text
root
┌──────────────────────────────┐
│ grab                         │
│ SUPERVISOR              关闭 │
├──────────────────────────────┤
│ supervisor summary / empty   │
│                              │
│ [启用目标] / [编辑目标]       │
└──────────────────────────────┘

detail
┌──────────────────────────────┐
│ grab                         │
│ ← SUPERVISOR            关闭 │
│ 启用 / 编辑 / 禁用            │
├──────────────────────────────┤
│ form or danger content       │
│                              │
├──────────────────────────────┤
│ [取消] [启用/保存/禁用]       │
└──────────────────────────────┘
```

### 9.2 Why This Is Not a Second Overlay

This is the most important design rule in `4B1`:

- mobile objective editing must not open a second `modal-overlay`
- mobile objective editing must not create a second backdrop above the supervisor sheet
- mobile objective editing must reuse the currently open sheet and swap its visible body

That preserves the existing mobile mental model and avoids layered-dismiss confusion.

### 9.3 Shared Objective Content

To preserve behavior across desktop and mobile, the implementation should extract a small shared internal content/action component from `ObjectiveDialog`, while keeping the feature logic unified.

Shared behaviors that must remain identical:

- enable mode submits `supervisor.create`
- edit mode submits `supervisor.update`
- disable mode submits `supervisor.delete`
- objective validation still blocks empty enable/edit submissions
- evaluator provider selection stays intact

### 9.4 Disable Mode

`disable` mode stays in the same mobile detail container even though its content is shorter. It should not introduce a separate confirmation-modal system.

This keeps mode-switching consistent:

- same header structure
- same footer action placement
- same close/back behavior

## 10. Integration Shape

Expected code changes are concentrated in:

- `packages/web/src/shells/mobile-shell/mobile-sheet.tsx`
- `packages/web/src/shells/mobile-shell/mobile-supervisor-sheet.tsx`
- `packages/web/src/features/workspace/components/workspace-launch-modal.tsx`
- `packages/web/src/features/workspace/components/worktree-modal.tsx`
- `packages/web/src/features/supervisor/components/objective-dialog.tsx`
- `packages/web/src/styles/components.css`

Expected supporting test changes are concentrated in:

- `packages/web/src/features/workspace/components/workspace-launch-modal.test.tsx`
- a new focused `worktree-modal` test file if coverage does not already exist
- `packages/web/src/features/supervisor/components/objective-dialog.test.tsx`
- `packages/web/src/shells/mobile-shell/index.test.tsx` or a focused supervisor-sheet test if the mobile supervisor navigation branch needs direct coverage

## 11. Testing Strategy

### 11.1 Primary Coverage

Required coverage for `WorkspaceLaunchModal`:

- mobile variant classes or mobile scaffold rendering
- existing folder navigation still works
- opening a selected workspace still dispatches the same command and closes correctly

Required coverage for `WorktreeModal`:

- mobile sheet presentation renders for mobile viewport
- tab switching still triggers the expected command loading path

Required coverage for mobile supervisor objective flow:

- mobile supervisor root view can enter objective detail
- detail back returns to the supervisor root view
- confirm actions still dispatch the correct websocket commands
- no nested second overlay/backdrop is created on mobile

### 11.2 Regression Boundaries

Desktop regression coverage should prove:

- `WorkspaceLaunchModal` still renders its existing desktop modal shell
- `WorktreeModal` still renders its existing desktop modal shell
- `ObjectiveDialog` desktop behavior remains centered-modal based

### 11.3 Verification

At minimum, `4B1` should be verified with:

- focused modal/dialog tests for all touched feature components
- focused mobile shell tests for supervisor detail behavior
- lint on all touched files
- full web test suite after the surface changes land

## 12. Risks and Mitigations

### Risk 1: Nested mobile overlays around supervisor editing

Mitigation:

- keep one top-level sheet only
- implement objective editing as in-sheet detail navigation
- add explicit tests that mobile objective editing does not render a second overlay

### Risk 2: Desktop-neutral refactors accidentally change modal markup

Mitigation:

- isolate mobile branching behind viewport checks
- preserve existing desktop class structure unless extraction is required
- run focused desktop-facing component tests plus full web regression

### Risk 3: Keyboard and footer collisions in objective edit mode

Mitigation:

- use sticky footer actions
- keep form body scrollable
- apply safe-area aware padding under the mobile breakpoint

### Risk 4: Scope creep into `CommandPalette` or cross-app polish

Mitigation:

- keep `4B1` strictly limited to three surfaces
- defer command palette, toast, and config-drift compacting to `4B2` and `4B3`
