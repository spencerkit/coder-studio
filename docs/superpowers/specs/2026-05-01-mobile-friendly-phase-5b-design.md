# Mobile-Friendly Phase 5B Design

> Date: 2026-05-01
> Status: Approved for planning
> Scope: Landscape compaction and safe-area coverage for the mobile shell

## 1. Goal

Phase `5B` hardens the mobile shell against the remaining layout breakpoints that only show up on real devices after rotation:

- short landscape viewports where the bottom stack becomes too tall
- devices with left/right safe-area insets where shell chrome or sheet content can sit too close to the edges
- keyboard inset behavior that currently overrides safe-area bottom padding instead of composing with it

The target is simple: rotating the device should not make the mobile workspace feel cramped, clipped, or uneven.

## 2. In Scope

- Landscape compaction for the mobile workspace shell on short-height viewports
- Safe-area-aware horizontal and vertical padding for mobile shell chrome
- Safe-area-aware padding for mobile sheets, drawer, and mobile full-screen routes
- Fixing keyboard inset composition so bottom safe-area padding is preserved
- Tests covering layout-mode detection and keyboard-inset composition

## 3. Out of Scope

Phase `5B` does not include:

- websocket recovery behavior
- new gestures or navigation changes
- animation tuning
- redesigning the dock information architecture
- desktop shell spacing or responsive behavior

## 4. Design Constraints

- Keep the existing mobile information architecture: topbar, agent strip, composer, dock, sheet, drawer
- Compaction should be additive and reversible; rotating back to portrait should restore the standard layout
- Only short landscape mobile viewports should enter compact mode automatically
- Safe-area handling must compose with keyboard inset handling rather than replacing it
- Full-screen mobile routes outside the workspace shell still need safe-area coverage even if they do not use the compact workspace mode

## 5. Core Decisions

### 5.1 Introduce an Explicit Short-Landscape Compact Mode

`5B` should distinguish between:

- normal mobile layout
- short landscape compact layout

Compact mode should activate only when both are true:

- `orientation: landscape`
- viewport height is short enough that vertical pressure is real

This avoids over-compressing taller tablet landscapes while still fixing the common phone-rotation case.

### 5.2 Drive Layout Mode from React, Apply the Changes in CSS

The mobile shell should expose the current layout mode as a class / data attribute on the shell root. CSS remains responsible for the visual changes.

This gives two benefits:

- deterministic tests can assert that compact mode activates
- the actual spacing, density, and safe-area adjustments remain centralized in CSS

### 5.3 Centralize Safe-Area Spacing Through Shell Variables

The mobile shell should define safe-area-derived CSS variables once and let child surfaces consume them.

These variables should cover:

- top inset
- bottom inset
- left inset
- right inset
- keyboard inset

That makes it possible to keep shell chrome, drawer, and sheet surfaces aligned even when the device rotates or the keyboard opens.

### 5.4 Compose Keyboard Inset with Safe-Area Bottom Padding

The current bottom-stack implementation writes an inline `paddingBottom`, which overwrites the CSS safe-area bottom value.

`5B` should switch that behavior to a custom property so CSS can compute:

- base shell spacing
- bottom safe-area inset
- keyboard inset

together.

This is the most important correctness fix in the phase because it affects every modern phone with a home indicator.

## 6. Compact Landscape Model

### 6.1 What Compacts

In short landscape mode, the mobile workspace shell should compress these areas:

- topbar vertical padding
- recovery strip margin/padding
- agent stage padding / radius
- composer padding and control height
- dock spacing and item height
- sheet height and drawer width

The layout should still read as the same product, just denser.

### 6.2 What Does Not Change

Compact mode should not:

- remove labels from the dock
- hide the topbar status
- collapse the agent strip into another menu
- change sheet routing or drawer behavior

This phase is density tuning, not interaction redesign.

## 7. Safe-Area Coverage Model

### 7.1 Workspace Shell

The workspace shell should respect safe-area insets for:

- topbar
- recovery strip
- main viewport padding
- bottom stack

### 7.2 Overlay Surfaces

Overlay surfaces should inherit the same safe-area system:

- bottom sheets keep content away from the left/right edges and home indicator
- workspace drawer keeps content away from notch / rounded-corner edges

### 7.3 Full-Screen Mobile Routes

Existing mobile full-screen routes should also get left/right safe-area coverage:

- welcome
- auth
- settings

These routes already handle top/bottom padding; `5B` closes the horizontal gap.

## 8. Integration Shape

Expected code changes are concentrated in:

- `packages/web/src/shells/mobile-shell/index.tsx`
- `packages/web/src/shells/mobile-shell/index.test.tsx`
- `packages/web/src/shells/mobile-shell/hooks/use-mobile-layout-mode.ts`
- `packages/web/src/styles/components.css`

Expected implementation approach:

- add a small layout-mode hook based on `matchMedia`
- expose the current mode on the mobile shell root
- replace inline bottom padding with a keyboard-inset CSS variable
- use CSS variables + a compact-mode modifier class for spacing changes
- extend mobile route padding rules to include left/right safe-area coverage

## 9. Testing Strategy

### 9.1 Primary Coverage

Required coverage for `5B`:

- short landscape viewports activate compact mode on the mobile shell root
- keyboard inset is written as a CSS variable instead of overriding `padding-bottom`
- core workspace rendering still works in compact mode

### 9.2 Regression Focus

Regression checks should preserve:

- portrait mobile shell rendering
- files / terminal sheet access
- visualViewport keyboard inset behavior
- existing workspace route behavior

## 10. Acceptance Criteria

`5B` is complete when:

- short landscape rotation activates a denser workspace layout
- shell chrome and overlay content respect left/right/top/bottom safe-area insets
- keyboard inset no longer removes bottom safe-area padding
- focused tests pass and the mobile shell remains fully navigable
