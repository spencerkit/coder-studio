# Mobile Terminal Soft Keybar Design

> Date: 2026-05-04
> Status: Approved for planning
> Scope: Add a mobile-only soft keybar for interactive terminal and agent sessions

## 1. Goal

This design improves the mobile terminal experience by adding a focused soft key solution for interactive terminal surfaces. The immediate problem is not generic mobile navigation across the whole app. It is the lack of terminal-specific keys such as `Esc`, `Tab`, arrow keys, and `Ctrl` while using shell terminals or agent sessions from a phone.

The target is a first version that makes mobile terminal work viable for real command-line interaction without turning the app into a custom full keyboard. The system should fill the specific gaps mobile browsers leave in terminal use while preserving the current xterm + PTY input path.

## 2. In Scope

This design applies only to mobile interactive terminal surfaces that render through `XtermHost`:

- agent session terminals in the mobile workspace stage
- shell terminals in the mobile fullscreen terminal sheet

This design includes:

- a mobile-only soft keybar entry point
- a collapsible handle + expandable keybar interaction
- support for `Esc`, `Tab`, `Enter`, and arrow keys
- support for `Ctrl` single-use and locked modes
- unified input dispatch through the existing terminal input pipeline
- layout behavior that pushes the terminal viewport upward instead of overlaying it
- unit, component, and E2E coverage for the new interaction

## 3. Out of Scope

This phase does not include:

- desktop terminal controls
- global mobile keyboard navigation across modals, lists, or file views
- a full custom software keyboard
- configurable key layouts
- `Backspace`, `Paste`, or command snippet shortcuts in the first version
- advanced control combinations outside `Ctrl + A-Z`
- cross-session persistence of keybar state
- buffering or replaying soft-key input while disconnected

The first version is intentionally narrow: solve the highest-friction mobile terminal inputs first, then extend only if usage justifies it.

## 4. Problem

The current mobile shell already supports viewing and focusing terminal surfaces, but it is still biased toward observation rather than active terminal operation. Mobile browsers do not expose hardware-style keys such as:

- `Esc`
- `Tab`
- arrow keys
- reliable `Ctrl` combinations

That creates concrete failures in both shell and agent sessions:

- command-line completion and shell navigation are blocked without `Tab`
- terminal apps and REPLs are awkward or unusable without arrows and `Esc`
- interrupt and readline workflows such as `Ctrl+C`, `Ctrl+L`, and `Ctrl+R` are unavailable

Because both shell terminals and agent sessions converge on the same `XtermHost` input path, a fragmented per-surface solution would duplicate behavior and drift over time. The fix should live at the shared terminal interaction boundary.

## 5. Design Constraints

- The solution must only appear on mobile interactive terminals.
- Read-only or ended sessions must not show an input affordance that cannot send input.
- Terminal and agent mobile surfaces must share one implementation path.
- Soft-key input and system keyboard input must go through one sending pipeline.
- The keybar must not cover terminal output; expansion should reduce terminal viewport height and trigger a normal xterm refit.
- `Ctrl` must support both single-use and locked behavior.
- The first version should stay small enough to test thoroughly and extend safely later.
- Existing terminal replay, hydration, upload, resize, and focus behavior must remain intact.

## 6. Core Decision

Use a split design:

- keep terminal capabilities in `XtermHost`
- add a dedicated mobile UI component for the soft keybar
- let the xterm shell layout own expansion/collapse behavior

This means the system is not implemented as a workspace-level bottom bar and not as a monolithic expansion of `XtermHost` internals.

The recommended structure is:

- `XtermHost`
  - remains the owner of terminal instance lifecycle and input dispatch
  - exposes a small terminal-facing API for virtual key sending and focus recovery
- `MobileTerminalInputBar`
  - renders the handle, expanded key row, and `Ctrl` affordance
  - emits semantic UI events instead of writing terminal bytes directly
- `XtermHostShell`
  - owns mobile-only visibility, expanded/collapsed state, and shared `Ctrl` mode state
  - composes the xterm viewport and the keybar into one vertical layout

This keeps the terminal core stable while making the mobile interaction layer testable and replaceable.

## 7. Component Model

### 7.1 Responsibility Split

`XtermHost` remains responsible for:

- xterm lifecycle
- PTY input dispatch
- focus and interactivity checks
- replay, hydration, resize, and upload coordination
- exposing terminal input helpers used by the mobile shell

`MobileTerminalInputBar` becomes responsible for:

- collapsed handle rendering
- expanded keybar rendering
- `Ctrl` visual states
- soft key press events
- long-press detection for `Ctrl` lock

`XtermHostShell` becomes responsible for:

- deciding whether the mobile keybar can render
- holding `expanded` and `ctrlMode` state
- translating semantic keybar events into terminal input actions
- arranging the terminal viewport and keybar in normal flow

### 7.2 Render Eligibility

The keybar entry point renders only when all of the following are true:

- viewport is mobile
- terminal is interactive
- terminal/session is not read-only
- agent session is not ended

If any of those conditions fail, the mobile keybar is absent and all related local state resets to defaults.

## 8. Interaction Model

### 8.1 Visibility States

The mobile shell has three visibility states:

- `hidden`
  - not rendered at all
- `collapsed`
  - a small bottom handle is visible
- `expanded`
  - the full soft keybar is visible

State rules:

- interactive mobile terminals start in `collapsed`
- tapping the handle toggles `collapsed <-> expanded`
- losing interactivity forces `hidden`
- switching terminal instances resets back to `collapsed`

### 8.2 Ctrl States

`Ctrl` is modeled separately from keybar visibility:

- `off`
- `armed`
- `locked`

State rules:

- single tap on `Ctrl`: `off -> armed`
- tap on `Ctrl` while `armed`: `armed -> off`
- long press on `Ctrl`: `off` or `armed` -> `locked`
- tap on `Ctrl` while `locked`: `locked -> off`

This gives mobile users both a one-shot modifier and a sticky control mode.

### 8.3 Focus Recovery

Handle taps, soft key presses, and `Ctrl` state changes should first attempt to focus the terminal before sending input or changing modifier state. This reduces the chance that the browser keyboard detaches from the terminal context after UI interaction.

## 9. Key Set And Mappings

The first version uses a fixed, non-configurable key set:

- `Esc`
- `Tab`
- `Ctrl`
- `Up`
- `Down`
- `Left`
- `Right`
- `Enter`

Mappings:

- `Esc` -> `\x1b`
- `Tab` -> `\t`
- `Enter` -> `\r`
- `Up` -> `\x1b[A`
- `Down` -> `\x1b[B`
- `Left` -> `\x1b[D`
- `Right` -> `\x1b[C`

`Ctrl` does not send bytes by itself. It modifies how the next compatible system keyboard input is interpreted.

Supported control combinations in phase one:

- `Ctrl + A-Z`

Examples:

- `Ctrl+C` -> `\x03`
- `Ctrl+L` -> `\x0c`
- `Ctrl+R` -> `\x12`

Unsupported control combinations such as `Ctrl+[`, `Ctrl+\`, or `Ctrl+_` remain out of scope for this phase.

## 10. Unified Input Pipeline

All terminal input should continue through one pipeline. The keybar must not create a second sending path with different semantics.

The model is:

- system keyboard input reaches the terminal input processor
- soft key presses also reach that same processor
- `ctrlMode` acts as a modifier layer before input bytes are finalized

Expected behavior:

- soft keys for `Esc`, `Tab`, arrows, and `Enter` directly send their mapped sequences
- if `ctrlMode=off`, system keyboard input is forwarded normally
- if `ctrlMode=armed` and the next input is a single `A-Z` character, it is translated to a control character and `ctrlMode` returns to `off`
- if `ctrlMode=locked` and the next input is a single `A-Z` character, it is translated to a control character while staying locked
- if `ctrlMode=armed` and the next input is not a single `A-Z` character, the input is sent normally and `ctrlMode` remains `armed`

The intent is that `Ctrl` primarily upgrades the system keyboard, not that the keybar becomes a complete replacement keyboard.

## 11. Layout Behavior

The keybar should not be rendered as an absolute overlay on top of the terminal buffer. It should live inside the `XtermHostShell` layout as a normal flow element.

Recommended layout:

- `XtermHostShell` becomes a vertical flex container
- the xterm viewport remains the flexible top region
- the keybar region is a bottom sibling
- collapsed state reserves only handle height
- expanded state reserves the full keybar height

This choice is critical because it makes the terminal viewport shrink naturally. Existing resize observation and `fit()` behavior can then recalculate terminal rows without special collision math.

The expanded keybar should appear at the bottom of the terminal surface:

- in the agent stage, above the existing mobile dock region
- in the terminal fullscreen sheet, at the bottom of that fullscreen terminal surface

In both cases, the keybar should move with the current mobile safe-area and keyboard inset behavior instead of inventing a separate positioning system.

## 12. State Lifetime Rules

The design intentionally keeps keybar state local and ephemeral.

Rules:

- keybar state is scoped to a terminal instance
- terminal/session switch resets to `collapsed + ctrl=off`
- unmount resets state
- refresh does not persist expanded or `Ctrl` state
- read-only transition resets state and removes the UI

This avoids surprising state carryover across sessions with different semantics.

## 13. Error And Edge Handling

### 13.1 Read-Only And Ended Sessions

No handle should render for read-only or ended agent sessions. A disabled affordance is worse here than no affordance because it suggests input is still possible.

### 13.2 Replay / Hydration / Connection Gaps

If the terminal surface is visible but input is temporarily not usable because the connection is unavailable, the keybar may remain visible but soft keys should be disabled.

The first version should not queue soft key presses during disconnects. Discarding input while unavailable is safer than replaying control sequences into the wrong terminal context later.

### 13.3 Input Method Compatibility

`Ctrl` consumption applies only to the next single Latin letter input. It does not reinterpret:

- paste payloads
- multi-character text insertions
- IME composition results
- arbitrary string chunks

This keeps the modifier logic predictable and avoids corrupting non-Latin or buffered text entry flows.

## 14. Integration Shape

Expected implementation concentration:

- `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
- new mobile input bar component(s) under `packages/web/src/features/terminal-panel/`
- `packages/web/src/styles/components.css`
- terminal panel and session card tests
- mobile E2E coverage

Likely additions include:

- a small virtual-key mapping helper
- a `ctrlMode` reducer/helper
- mobile-only styling for the collapsed handle and expanded keybar
- test helpers for soft-key interactions

This change should not require workspace-level routing or shell-state redesign.

## 15. Testing Strategy

### 15.1 Unit Coverage

Required unit coverage:

- soft key to control-sequence mapping
- `Ctrl` state transitions
- single-use vs locked `Ctrl` behavior
- modifier application rules for compatible and incompatible input payloads

### 15.2 Component Coverage

Required component coverage:

- interactive mobile terminal shows a collapsed handle
- read-only terminal renders no handle
- expanding the keybar changes the layout footprint
- pressing soft keys sends the expected control sequences
- tapping `Ctrl` arms one-shot mode
- long-pressing `Ctrl` enters locked mode

### 15.3 E2E Coverage

Required end-to-end checks:

- mobile agent session can expand the keybar and send special keys
- mobile shell terminal can expand the keybar and send special keys
- one-shot `Ctrl+C` works from a mobile terminal
- locked `Ctrl` can send repeated control-letter inputs
- read-only or ended sessions do not expose the keybar entry point

## 16. Acceptance Criteria

This design is complete when:

- mobile interactive terminal surfaces expose a collapsible soft keybar
- the first version supports `Esc`, `Tab`, arrows, `Enter`, and `Ctrl`
- `Ctrl` supports both one-shot and locked modes
- keybar expansion pushes the terminal viewport upward instead of covering it
- agent sessions and shell terminals use the same terminal input implementation path
- read-only and ended sessions do not show the affordance
- focused regression coverage passes for unit, component, and mobile E2E behavior
