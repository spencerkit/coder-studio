# Session Header Running Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `running` agent session headers easier to recognize at a glance by adding a light motion-based active state without changing header layout or text.

**Architecture:** Keep the existing `SessionCard` and `PanelHeader` DOM contract intact, and implement the visibility upgrade through shared `StatusDot` and session badge styling only. The change should propagate to mobile `SessionCard` usage automatically because mobile reuses the same header markup, while other mobile status systems remain out of scope.

**Tech Stack:** React 19, Vitest, Testing Library, CSS modules, shared `components.css` theme assertions

---

## File Map

- Modify: `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
  - Adjust the `running` dot to opt into the shared pulse path while preserving existing compatibility classes and state mapping.
- Modify: `packages/web/src/components/ui/status-dot/index.module.css`
  - Add the `running` active-state motion, ring, and reduced-motion fallback to the shared dot primitive without regressing `starting` or connection status dots.
- Modify: `packages/web/src/styles/components.css`
  - Add the `running` badge emphasis, theme-sensitive glow/border behavior, and mobile-safe shared session header rules.
- Modify: `packages/web/src/features/agent-panes/components/session-card.test.tsx`
  - Extend the component contract tests so `running` keeps the legacy classes and now opts into the shared pulse behavior.
- Modify: `packages/web/src/components/ui/status-dot/index.test.tsx`
  - Add shared primitive assertions for the `running` compatibility class path and pulse flag behavior.
- Modify: `packages/web/src/styles/components.theme.test.ts`
  - Assert the new `running` badge emphasis, reduced-motion guardrails, and the shared mobile-session-header styling contract.

## Task 1: Lock in the Failing Session and Style Tests

**Files:**
- Modify: `packages/web/src/features/agent-panes/components/session-card.test.tsx`
- Modify: `packages/web/src/components/ui/status-dot/index.test.tsx`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Add a failing `SessionCard` test that expects the running dot to opt into the shared pulse path**

Add this test near the existing `session-dot-running` coverage in `packages/web/src/features/agent-panes/components/session-card.test.tsx`:

```tsx
  it("routes running sessions through the shared pulse dot behavior", () => {
    const { container } = render(
      <Provider
        store={
          createSessionStore({
            terminalId: "term-live",
            state: "running",
            endedAt: undefined,
          }).store
        }
      >
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    const dot = container.querySelector(".session-dot.session-dot-running");

    expect(dot).not.toBeNull();
    expect(dot?.className).toMatch(/pulse/);
  });
```

- [ ] **Step 2: Run the focused `SessionCard` test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/agent-panes/components/session-card.test.tsx -t "routes running sessions through the shared pulse dot behavior"
```

Expected: FAIL because the `running` dot does not yet receive the shared `pulse` class.

- [ ] **Step 3: Add a shared `StatusDot` regression test for the running compatibility path**

Append this test to `packages/web/src/components/ui/status-dot/index.test.tsx`:

```tsx
  it("allows running session dots to combine legacy classes with the shared pulse variant", () => {
    render(
      <StatusDot
        tone="info"
        pulse
        className="session-dot session-dot-running"
        data-testid="dot"
      />
    );

    const dot = screen.getByTestId("dot");

    expect(dot).toHaveClass("session-dot", "session-dot-running");
    expect(dot.className).toContain("pulse");
    expect(dot.style.getPropertyValue("--status-dot-current-color")).toBe("var(--color-info)");
  });
```

- [ ] **Step 4: Add a failing style-contract test for running session motion and theme-safe badge emphasis**

First add this stylesheet fixture near the other `readFileSync(...)` declarations in `packages/web/src/styles/components.theme.test.ts`:

```ts
const statusDotStylesheet = readFileSync(
  `${process.cwd()}/src/components/ui/status-dot/index.module.css`,
  "utf8"
);
```

Then add this test near the existing session/mobile header assertions:

```ts
  it("keeps running session header emphasis theme-safe and motion-aware", () => {
    const runningDot = getLastRuleBlock(".session-dot-running");
    const runningBadge = getLastRuleBlock(".session-state-badge.badge-green");
    const darkRunningBadge = getLastRuleBlock(
      '[data-theme$="-dark"] .session-card > .panel-header .session-state-badge.badge-green'
    );
    const lightRunningBadge = getLastRuleBlock(
      '[data-theme$="-light"] .session-card > .panel-header .session-state-badge.badge-green'
    );
    const statusDotStyles = getLastRuleBlockFrom(statusDotStylesheet, ":global(.session-dot-running)");
    const runningRingStyles = getLastRuleBlockFrom(
      statusDotStylesheet,
      ":global(.session-dot-running)::after"
    );
    const reducedDotMotion = getLastGroupedRuleBlockFrom(
      statusDotStylesheet,
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?:global\(\.session-dot-running\)::after\s*\{([^}]*)\}/g
    );

    expect(runningDot).toContain("box-shadow:");
    expect(runningBadge).toContain("border: 1px solid color-mix(");
    expect(runningBadge).toContain("background: color-mix(in srgb, currentColor");
    expect(darkRunningBadge).toContain("box-shadow:");
    expect(lightRunningBadge).toContain("box-shadow:");
    expect(statusDotStyles).toContain("animation: statusDotRunningPulse 1.7s ease-in-out infinite");
    expect(runningRingStyles).toContain("animation: statusDotRunningRing 1.7s ease-out infinite");
    expect(reducedDotMotion).toContain("animation: none");
  });
```

- [ ] **Step 5: Run the focused `StatusDot` test to verify the shared primitive already supports the explicit pulse variant**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/components/ui/status-dot/index.test.tsx -t "allows running session dots to combine legacy classes with the shared pulse variant"
```

Expected: PASS because `StatusDot` already supports explicit `pulse`, and this new test locks that shared primitive contract before feature styling changes.

- [ ] **Step 6: Run the focused theme-contract test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts -t "keeps running session header emphasis theme-safe and motion-aware"
```

Expected: FAIL because the `running` dot ring, theme-tuned badge selectors, and reduced-motion overrides are not implemented yet.

- [ ] **Step 7: Commit the test-only checkpoint**

```bash
git add packages/web/src/features/agent-panes/components/session-card.test.tsx packages/web/src/components/ui/status-dot/index.test.tsx packages/web/src/styles/components.theme.test.ts
git commit -m "test: cover running session header pulse behavior"
```

## Task 2: Implement the Shared Running Dot Motion and Badge Emphasis

**Files:**
- Modify: `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
- Modify: `packages/web/src/components/ui/status-dot/index.module.css`
- Modify: `packages/web/src/styles/components.css`
- Test: `packages/web/src/features/agent-panes/components/session-card.test.tsx`
- Test: `packages/web/src/components/ui/status-dot/index.test.tsx`

- [ ] **Step 1: Make `running` sessions opt into the shared pulse behavior**

Update `shouldPulseSessionDot` in `packages/web/src/features/agent-panes/views/shared/session-card.tsx` to keep `starting` pulsing and add `running`:

```tsx
function shouldPulseSessionDot(state: SessionState) {
  switch (state) {
    case "starting":
    case "running":
      return true;
    default:
      return false;
  }
}
```

- [ ] **Step 2: Extend the shared status dot CSS with a low-frequency running treatment and reduced-motion fallback**

Update `packages/web/src/components/ui/status-dot/index.module.css` so `running` uses a slower motion profile and an animated ring without changing the existing compatibility selectors:

```css
.dot {
  position: relative;
  display: inline-flex;
  width: var(--status-dot-current-size, var(--status-dot-size));
  height: var(--status-dot-current-size, var(--status-dot-size));
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--status-dot-current-color, var(--text-tertiary));
  box-shadow: 0 0 0 1px
    color-mix(in srgb, var(--status-dot-current-color, var(--text-tertiary)) 18%, transparent);
}

.pulse {
  animation: statusDotPulse 1s ease-in-out infinite;
}

:global(.session-dot-running) {
  --status-dot-current-color: var(--color-info);
  animation: statusDotRunningPulse 1.7s ease-in-out infinite;
}

:global(.session-dot-running)::after {
  content: "";
  position: absolute;
  inset: -6px;
  border-radius: inherit;
  border: 1px solid color-mix(in srgb, var(--status-dot-current-color) 18%, transparent);
  animation: statusDotRunningRing 1.7s ease-out infinite;
}

@keyframes statusDotRunningPulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.96;
  }

  50% {
    transform: scale(1.12);
    opacity: 1;
  }
}

@keyframes statusDotRunningRing {
  0% {
    transform: scale(0.92);
    opacity: 0;
  }

  35% {
    opacity: 0.52;
  }

  100% {
    transform: scale(1.18);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pulse,
  :global(.session-dot-starting),
  :global(.session-dot-running),
  :global(.connection-status-dot-connecting),
  :global(.connection-status-dot-reconnecting),
  :global(.session-dot-running)::after {
    animation: none;
  }
}
```

Implementation notes:

- Keep the faster shared pulse for `starting`.
- Let `.session-dot-running` override the generic `.pulse` animation with the slower running-specific animation.
- Do not add similar ring treatment to connection dots or completed dots.

- [ ] **Step 3: Add light-theme-safe running badge emphasis without changing layout**

Update the session badge rules in `packages/web/src/styles/components.css` around the existing `.session-provider-badge, .session-state-badge` block:

```css
.session-card > .panel-header .session-state-badge.badge-green {
  position: relative;
  border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
  background: color-mix(in srgb, currentColor 14%, transparent);
}

.session-dot-running {
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--status-dot-current-color) 10%, transparent);
}

[data-theme$="-dark"] .session-card > .panel-header .session-state-badge.badge-green {
  box-shadow: 0 0 12px color-mix(in srgb, currentColor 12%, transparent);
}

[data-theme$="-light"] .session-card > .panel-header .session-state-badge.badge-green {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 10%, transparent);
}

.mobile-shell__agent-stage .session-state-badge.badge-green {
  max-width: 100%;
}
```

Implementation notes:

- Keep height, padding, border radius, and badge line-height unchanged.
- Use semantic/current colors only; do not hardcode separate final colors for light and dark.
- Mobile gets the same shared badge treatment because it reuses `SessionCard`; do not add topbar/tab selectors here.

- [ ] **Step 4: Run the focused session, primitive, and theme tests to verify the implementation passes**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/agent-panes/components/session-card.test.tsx src/components/ui/status-dot/index.test.tsx src/styles/components.theme.test.ts
```

Expected: PASS with the new running pulse contract covered, the compatibility classes preserved, and the style contract satisfied.

- [ ] **Step 5: Commit the running-state implementation**

```bash
git add packages/web/src/features/agent-panes/views/shared/session-card.tsx packages/web/src/components/ui/status-dot/index.module.css packages/web/src/styles/components.css packages/web/src/features/agent-panes/components/session-card.test.tsx packages/web/src/components/ui/status-dot/index.test.tsx packages/web/src/styles/components.theme.test.ts
git commit -m "feat: emphasize running session headers"
```

## Task 3: Verify Theme and Reduced-Motion Coverage

**Files:**
- Modify: none
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Run the focused theme test to verify the final selectors and reduced-motion overrides are green**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts -t "keeps running session header emphasis theme-safe and motion-aware"
```

Expected: PASS with shared session-header selectors using semantic colors, explicit light/dark theme hooks, and a reduced-motion override for the running dot ring.

- [ ] **Step 2: Run the full style and session-related verification set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts src/features/agent-panes/components/session-card.test.tsx src/components/ui/status-dot/index.test.tsx
```

Expected: PASS with no regressions in session header structure, shared status-dot behavior, or style-contract assertions.

## Task 4: Final Verification

**Files:**
- Modify: none
- Test: `packages/web/src/features/agent-panes/components/session-card.test.tsx`
- Test: `packages/web/src/components/ui/status-dot/index.test.tsx`
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Run the final targeted verification commands**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/agent-panes/components/session-card.test.tsx src/components/ui/status-dot/index.test.tsx src/styles/components.theme.test.ts
```

Expected: PASS with the new running-state tests and existing session/theme assertions all green.

- [ ] **Step 2: Run a focused type-aware workspace test sweep if CSS selector or React prop changes touched neighboring code**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/agent-panes/components/session-card.test.tsx src/styles/components.theme.test.ts --no-file-parallelism
```

Expected: PASS with the same assertions succeeding under serialized file execution.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git diff --stat HEAD~2..HEAD -- packages/web/src/features/agent-panes/views/shared/session-card.tsx packages/web/src/components/ui/status-dot/index.module.css packages/web/src/styles/components.css packages/web/src/features/agent-panes/components/session-card.test.tsx packages/web/src/components/ui/status-dot/index.test.tsx packages/web/src/styles/components.theme.test.ts
git diff HEAD~2..HEAD -- packages/web/src/features/agent-panes/views/shared/session-card.tsx packages/web/src/components/ui/status-dot/index.module.css packages/web/src/styles/components.css packages/web/src/features/agent-panes/components/session-card.test.tsx packages/web/src/components/ui/status-dot/index.test.tsx packages/web/src/styles/components.theme.test.ts
```

Expected: only the planned running-session-header files are touched across the test and implementation commits, with no spillover into topbar/tab/supervisor status systems.

- [ ] **Step 4: Commit any final cleanup if needed**

```bash
git add packages/web/src/features/agent-panes/views/shared/session-card.tsx packages/web/src/components/ui/status-dot/index.module.css packages/web/src/styles/components.css packages/web/src/features/agent-panes/components/session-card.test.tsx packages/web/src/components/ui/status-dot/index.test.tsx packages/web/src/styles/components.theme.test.ts
git commit -m "chore: finalize running session header visibility"
```

Skip this commit if Task 2 and Task 3 already left the branch clean.
