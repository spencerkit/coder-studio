# Mobile Terminal Long-Press Line Copy Design

## 1. Goal

Replace the current mobile terminal copy-mode overlay with a simpler interaction:

- when `Copy on select` is enabled on mobile, long-pressing terminal output copies the current wrapped logical line directly
- the copied text comes from the frontend xterm active buffer, not a server request
- wrapped terminal rows are merged into one logical line before copying
- right-side terminal padding whitespace is trimmed from the logical line ending, while meaningful internal spaces are preserved
- success feedback is a toast plus a short vibration

This change intentionally removes the current mobile copy-mode overlay flow instead of refining it.

## 2. Current Baseline

Relevant current implementation:

- `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
- `packages/web/src/features/terminal-panel/mobile/copy-mode-snapshot.ts`
- `packages/web/src/styles/components.css`
- `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`
- `e2e/specs/settings/mobile-copy-on-select.spec.ts`
- `packages/web/src/locales/en.json`
- `packages/web/src/locales/zh.json`

Today:

- mobile long press enters a full copy-mode overlay
- the overlay is built from cloned `.xterm-rows` DOM
- once copy mode is active, our custom terminal touch handling exits and the browser takes over native text-selection behavior
- the overlay is rendered inside the fullscreen mobile terminal sheet

This baseline caused a UX problem on mobile:

- after entering copy mode, long-pressing and dragging overlay text can trigger browser-native selection and viewport/layer movement that feels like the whole DOM is being dragged

## 3. User Decisions Captured

Confirmed product decisions:

- completely replace the current mobile copy-mode overlay
- keep the new behavior gated by the existing `Copy on select` setting
- copy the wrapped logical line, not a single visual row
- merge wrapped rows into one logical line
- preserve meaningful internal spaces
- trim only trailing padding whitespace from the logical line ending
- show success feedback as `copied current line` toast plus short vibration
- use a simple phase-one targeting model:
  - start from `touchstart.target`
  - walk upward to find the nearest xterm row element
  - if no row element is found, do nothing
  - do not add coordinate-based fallback in this phase

## 4. Requirements

### 4.1 Functional rules

- On mobile, `Copy on select = true` enables long-press copy.
- On mobile, `Copy on select = false` keeps the current non-copy long-press behavior.
- A stable long press on terminal output must copy the current wrapped logical line directly to the clipboard.
- The copied line must come from the frontend xterm active buffer.
- No server request is allowed for this copy path.
- If the long-press target does not resolve to a rendered xterm row, nothing should be copied.
- If the clipboard write fails, existing failure toast behavior must be reused.
- Desktop behavior must remain unchanged.

### 4.2 Non-functional rules

- The new behavior must remove the mobile copy overlay entirely.
- The implementation should stay small and phase-one scoped.
- The targeting logic should avoid speculative heuristics for empty areas in this phase.
- The line-resolution logic should be extracted from `xterm-host.tsx` into a focused helper.

## 5. Why The Old Overlay Is Being Removed

The old design intentionally opened browser-native text selection inside a fullscreen fixed mobile sheet:

- `user-select: text`
- `-webkit-touch-callout: default`
- native scrolling inside the overlay
- custom terminal touch handling disabled while copy mode is active

That combination makes the mobile browser the primary gesture handler after copy mode opens. In practice, this can produce viewport or composited-layer movement that feels like dragging the whole page instead of just selecting text.

The new design avoids that class of problem by eliminating the text-selection overlay entirely.

## 6. High-Level Approach

Recommended approach:

- keep the existing long-press detection and movement tolerance in `XtermHost`
- when the long press matures on mobile and `Copy on select` is enabled:
  - resolve the pressed xterm row from `touchstart.target`
  - convert that row to a visual row index within `.xterm-rows`
  - map the visual row index into `terminal.buffer.active`
  - walk upward and downward across wrapped rows to collect one logical line
  - copy the final logical line to the clipboard
  - show success feedback
- remove all mobile copy-mode overlay state, rendering, styles, and tests

## 7. Interaction Model

### 7.1 Normal mobile terminal behavior

When the feature setting is disabled:

- long press does not copy
- drag continues to behave as terminal scrolling

When the feature setting is enabled:

- a stable long press on rendered terminal text copies one logical line
- if the gesture turns into a scroll before the long-press timer fires, copying is cancelled

### 7.2 Long-press trigger

The current long-press model already has the right shape and should remain:

- single-touch only
- movement over the tolerance cancels the long press
- scroll gestures win over copy
- long-press maturity is still driven by the existing timer

The copied target is locked to the original `touchstart.target`.

### 7.3 Success and failure feedback

On success:

- push a lightweight success toast: `Copied current line`
- vibrate briefly if `navigator.vibrate` is available

On failure:

- reuse the existing copy failure toast path
- do not open any fallback overlay

## 8. Target Resolution Rules

Phase one deliberately uses a minimal targeting rule.

### 8.1 Source of truth for hit testing

Use `touchstart.target` captured when the long-press gesture begins.

Do not use the release target.
Do not use a `clientY` fallback in this phase.

### 8.2 Row resolution

Resolve the nearest xterm row by walking upward from `touchstart.target`.

Accepted row shape:

- an element that is a direct child of `.xterm-rows`

If upward traversal finds no such row:

- treat the gesture as non-copyable
- do nothing

This intentionally excludes:

- empty space outside rendered rows
- unrelated xterm layers
- ambiguous targets

Those cases are accepted phase-one limitations.

### 8.3 Visual row index

Once the row element is found:

- use its position within `.xterm-rows.children`
- that zero-based child position is the visual row index

If the resolved row is missing from the current children list:

- do nothing

## 9. Buffer Mapping Rules

The copied text comes from the frontend xterm buffer, not the DOM text.

### 9.1 Buffer source

Use:

- `terminal.buffer.active.viewportY`
- `terminal.buffer.active.getLine(y)`
- `IBufferLine.isWrapped`
- `IBufferLine.translateToString(...)`

This is the active frontend xterm buffer only.
No backend lookup is needed.

### 9.2 Mapping visual row to buffer row

Compute:

- `bufferRow = terminal.buffer.active.viewportY + visualRowIndex`

If `getLine(bufferRow)` returns `undefined`:

- do nothing

### 9.3 Finding the logical line start

The visual row may be the first segment of a logical line or a wrapped continuation.

Starting from `bufferRow`:

- walk upward while the current line exists and `currentLine.isWrapped === true`
- the first row where `isWrapped !== true` is the logical line start

### 9.4 Collecting wrapped continuation rows

From the logical line start:

- include that row
- walk downward while the next row exists and `nextLine.isWrapped === true`
- include each wrapped continuation row

The resulting ordered row list is the wrapped logical line.

## 10. Text Assembly Rules

The copied text must preserve meaningful spaces while removing terminal padding noise at the end.

### 10.1 Per-row conversion

For a collected logical line with multiple buffer rows:

- every row except the last uses `translateToString(false)`
- the last row uses `translateToString(true)`

Why:

- wrapped intermediate rows may legitimately end in a space that is part of the logical line continuation
- trimming every segment would risk deleting meaningful spaces in the middle of the reconstructed line
- trimming only the last segment removes right-side terminal padding from the final logical line ending

### 10.2 Final join behavior

Join all collected row strings with no separator.

This produces one single logical line string.

### 10.3 Phase-one scope

This feature copies one logical line only.

It does not:

- copy multiple logical lines
- preserve per-cell styling
- expose browser-native text selection

## 11. File-Level Design

### 11.1 `xterm-host.tsx`

Keep ownership of:

- touch gesture state
- long-press timer
- movement tolerance cancellation
- clipboard side effects
- toast side effects
- success vibration

Change behavior so that mobile long-press success runs direct logical-line copy instead of entering copy mode.

Remove:

- mobile copy-mode snapshot state
- mobile copy-mode overlay rendering
- mobile copy-mode background click handling
- copy-mode entry failure path tied to snapshot generation

### 11.2 New mobile helper

Add a small helper under `packages/web/src/features/terminal-panel/mobile/` that owns:

- resolving the nearest xterm row from a target node
- computing the visual row index
- mapping that index into `terminal.buffer.active`
- expanding the wrapped logical line
- building the final copy string

Recommended shape:

- accept the target node
- accept the terminal instance
- return `string | null`

The helper should not touch clipboard APIs or UI toasts.

### 11.3 Remove `copy-mode-snapshot.ts`

The DOM snapshot builder is specific to the removed overlay workflow.

Once the overlay is removed:

- delete `packages/web/src/features/terminal-panel/mobile/copy-mode-snapshot.ts`
- delete or replace tests that only exist for overlay DOM snapshot behavior

### 11.4 Styles and locales

Remove overlay-only CSS and copy-mode-only locale strings.

Add new success-toast locale strings for:

- English
- Chinese

The `Copy on select` setting stays in place but mobile semantics change.

## 12. Testing Strategy

### 12.1 Helper unit tests

Add focused tests for:

- resolves the nearest row from a nested span target
- returns `null` when no xterm row is found
- maps visual row index through `viewportY`
- expands upward to the logical line start when the hit row is wrapped
- expands downward through wrapped continuation rows
- trims only the final segment right side
- preserves meaningful internal spaces

### 12.2 `xterm-host` behavior tests

Rewrite mobile-copy tests around the new flow:

- long press copies the current logical line when the setting is enabled
- wrapped logical line copies as one merged string
- long press does not copy when the gesture becomes a scroll
- long press does not copy when horizontal drift exceeds tolerance
- long press does not copy when the setting is disabled
- long press does not scroll the live terminal while the copy action is executing
- clipboard failure still shows the failure toast
- success path triggers toast and vibration

Remove tests that only verify overlay behaviors, such as:

- rendering `Copy Mode`
- exiting via Done
- background click dismissal
- overlay content DOM sizing
- overlay text tap selection guards

### 12.3 E2E regression coverage

Replace the existing mobile copy-mode e2e assertions with:

- enable `Copy on select`
- seed a wrapped line in the mobile terminal
- long press rendered text
- verify clipboard content matches the merged logical line
- verify success feedback appears
- verify no copy-mode overlay is shown

Keep the disabled-setting e2e:

- when `Copy on select` is off, long press should not copy

## 13. Accepted Phase-One Limitations

The following are intentional and should not be treated as bugs in this phase:

- pressing empty terminal space does nothing
- pressing ambiguous non-row xterm layers does nothing
- no coordinate fallback when target traversal cannot resolve a row
- only one logical line is copied per long press
- no native selection UI
- no recovery path to copy from older scrollback once it has fallen out of frontend xterm buffer retention

If real-world usage shows the target-only resolution is too strict, a future iteration may add a `clientY` fallback. That is explicitly out of scope for this phase.
