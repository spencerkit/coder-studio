# Mobile-Friendly Phase 5C Design

> Date: 2026-05-01
> Status: Approved for planning
> Scope: Micro-animation tuning for the mobile shell

## 1. Goal

Phase `5C` finishes the mobile adaptation work by giving the shell a small, coherent motion system that makes state changes easier to read without turning the product into a highly animated surface.

The mobile shell already works functionally after `5A` and `5B`, but the remaining interactions still feel abrupt:

- recovery strip appears without a clear entrance
- chips, dock items, and drawer rows respond instantly but without tactile continuity
- sheet and drawer surfaces appear structurally correct yet visually “teleport”

`5C` adds restrained motion to the shell so interaction feedback feels intentional while still respecting reduced-motion preferences.

## 2. In Scope

- Motion-mode detection for normal vs reduced-motion environments
- Mobile shell root motion state
- Micro-animation tuning for:
  - recovery strip
  - agent chips
  - dock items
  - mobile sheet / drawer surface entry
  - topbar action surfaces
- Reduced-motion fallbacks for the above shell-only elements

## 3. Out of Scope

Phase `5C` does not include:

- new gestures
- spring physics libraries
- animation changes inside feature components like Monaco, terminal, or chat content
- desktop motion redesign
- route transition animation across the full app

## 4. Design Constraints

- Motion must stay lightweight and fast; the shell should feel more polished, not slower
- Motion changes must remain shell-local and not leak into shared feature components
- Every new animated surface must have a reduced-motion fallback
- Prefer transforms and opacity over layout-shifting animation
- Avoid long looping animations; state changes should communicate and settle quickly

## 5. Core Decisions

### 5.1 Expose Motion Mode on the Mobile Shell Root

The mobile shell should expose whether the environment prefers reduced motion.

This should become a shell-level attribute/class so CSS can branch cleanly:

- `default`
- `reduced`

That gives deterministic tests and keeps the motion rules centralized in CSS.

### 5.2 Use Purposeful Motion Only Where It Improves Readability

The best candidates for `5C` are shell-level state changes that benefit from visual continuity:

- a recovery strip easing into place instead of appearing abruptly
- sheet/drawer surfaces sliding into view with matched backdrop fade
- press/active feedback on chips and dock items

These are the changes users will actually notice during navigation and recovery.

### 5.3 Keep Durations Short and Hierarchical

Motion should reinforce hierarchy:

- press feedback: shortest
- chip/dock state transitions: short
- recovery strip / overlay surface entrance: slightly longer

Everything should still settle quickly enough for task-oriented use.

### 5.4 Reduced Motion Should Remove Nonessential Entrance Motion, Not Break Feedback

In reduced-motion environments:

- remove entrance transforms and fades for shell overlays and strips
- keep minimal color/background transitions where useful
- keep the interface readable and responsive without sudden large movements

## 6. Motion Model

### 6.1 Recovery Strip

The recovery strip should:

- fade and lift into place when mounted
- avoid repeated pulsing or looping
- settle quickly

### 6.2 Agent Chips and Dock Items

These controls should get:

- a subtle transform/background transition on hover/press/active state
- a very small downward press response on active press

The goal is tactile clarity, not decoration.

### 6.3 Sheet and Drawer Surfaces

Bottom sheets and workspace drawer should get:

- backdrop fade
- translate-based entrance from their natural edge

This should remain consistent with the shell’s current spatial model:

- sheet rises from the bottom
- drawer slides from the left

## 7. Integration Shape

Expected code changes are concentrated in:

- `packages/web/src/shells/mobile-shell/index.tsx`
- `packages/web/src/shells/mobile-shell/index.test.tsx`
- `packages/web/src/shells/mobile-shell/hooks/use-mobile-motion-mode.ts`
- `packages/web/src/styles/components.css`

Expected implementation approach:

- add a small `prefers-reduced-motion` hook
- expose `data-motion-mode` on the mobile shell root
- add shell-specific transitions/animations in CSS
- add a reduced-motion CSS branch that removes entrance motion

## 8. Testing Strategy

### 8.1 Primary Coverage

Required coverage for `5C`:

- reduced-motion media preference marks the shell root as `reduced`
- normal environments keep the default motion mode
- existing mobile shell behavior remains intact while the motion-mode attribute is present

### 8.2 Regression Focus

Regression checks should preserve:

- workspace shell rendering
- compact landscape mode
- keyboard inset handling

## 9. Acceptance Criteria

`5C` is complete when:

- shell-level surfaces animate in a restrained, consistent way
- reduced-motion environments disable nonessential entrance motion
- motion-mode is testable from the shell root
- focused regressions pass
