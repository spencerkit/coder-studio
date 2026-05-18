# Mobile Supervisor Sheet Flat Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the mobile Supervisor fullscreen sheet into a flatter, denser settings-panel surface without changing Supervisor behavior.

**Architecture:** Keep the existing `Sheet` flow and shared `ObjectiveDialogContent` logic intact, then tighten the mobile experience in three layers: remove redundant detail chrome in the React structure, flatten the mobile-only container styling, and lock the result with mobile regression and style-contract tests.

**Tech Stack:** React, TypeScript, shared `Sheet` and form primitives, Vitest, Testing Library, CSS design tokens

---

## File Structure

- Modify: `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx`
  - Keep the current root/detail workflow.
  - Remove the redundant detail header card from the mobile body.
  - Continue wiring the same draft state and submit callbacks.

- Modify: `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx`
  - Add assertions that the mobile detail view no longer renders duplicate body chrome.
  - Keep existing enable/edit/disable behavior coverage intact.

- Modify: `packages/web/src/styles/components.css`
  - Flatten `.mobile-supervisor-sheet__root`, `.mobile-supervisor-sheet__detail`, and `.mobile-supervisor-sheet__footer`.
  - Remove the dedicated `.mobile-supervisor-sheet__detail-header` treatment.

- Modify: `packages/web/src/styles/components.theme.test.ts`
  - Update the mobile Supervisor style contract from thick inner-card chrome to flat fullscreen settings chrome.

## Task 1: Remove duplicate mobile detail header chrome

**Files:**
- Modify: `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx`
- Test: `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx`

- [ ] **Step 1: Write the failing mobile structure tests**

Add coverage that the fullscreen mobile detail flow relies on the shared `Sheet` header only.

```tsx
it("does not render a duplicate detail header card inside the mobile enable form", () => {
  const store = createStore();
  window.localStorage.setItem("ui.locale", JSON.stringify("en"));
  store.set(localeAtom, "en");
  store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
  store.set(supervisorsAtom, new Map());

  render(
    <Provider store={store}>
      <MobileSupervisorSheet sessionId="sess-1" workspaceId="ws-1" onClose={vi.fn()} />
    </Provider>
  );

  expect(document.querySelector(".mobile-supervisor-sheet__detail-header")).toBeNull();
  expect(screen.getByRole("heading", { name: "Enable Supervisor", level: 2 })).toBeInTheDocument();
});

it("does not render a duplicate detail header card after opening edit mode", () => {
  const store = createStore();
  window.localStorage.setItem("ui.locale", JSON.stringify("en"));
  store.set(localeAtom, "en");
  store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
  store.set(supervisorsAtom, new Map([["sess-1", createSupervisor()]]));

  render(
    <Provider store={store}>
      <MobileSupervisorSheet sessionId="sess-1" workspaceId="ws-1" onClose={vi.fn()} />
    </Provider>
  );

  fireEvent.click(screen.getByRole("button", { name: "Edit Supervisor" }));

  expect(document.querySelector(".mobile-supervisor-sheet__detail-header")).toBeNull();
  expect(screen.getByRole("heading", { name: "Edit Supervisor", level: 2 })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the mobile sheet test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx
```

Expected:

- FAIL because `.mobile-supervisor-sheet__detail-header` still exists in mobile detail views

- [ ] **Step 3: Remove the duplicate body header from the mobile detail structure**

In `mobile-supervisor-sheet.tsx`, delete the dedicated detail header block and let the `Sheet` header carry the title.

```tsx
const detailBody = (
  <div className="mobile-supervisor-sheet__detail">
    <ObjectiveDialogContent
      mode={mode}
      draftObjective={dialog.draftObjective}
      draftEvaluatorProviderId={dialog.draftEvaluatorProviderId}
      draftEvaluatorModel={dialog.draftEvaluatorModel}
      draftMaxSupervisionCount={dialog.draftMaxSupervisionCount}
      draftScheduledAt={dialog.draftScheduledAt}
      isMaxSupervisionCountValid={isMaxSupervisionCountValid}
      disableObjective={disableObjective}
      onDraftObjectiveChange={(draftObjective) => updateDraft({ draftObjective })}
      onDraftEvaluatorProviderChange={(draftEvaluatorProviderId) =>
        updateDraft({ draftEvaluatorProviderId })
      }
      onDraftEvaluatorModelChange={(draftEvaluatorModel) => updateDraft({ draftEvaluatorModel })}
      onDraftMaxSupervisionCountChange={(draftMaxSupervisionCount) =>
        updateDraft({ draftMaxSupervisionCount })
      }
      onDraftScheduledAtChange={(draftScheduledAt) => updateDraft({ draftScheduledAt })}
    />
  </div>
);
```

Remove now-unused imports related to the deleted header chrome.

- [ ] **Step 4: Run the mobile sheet test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx
```

Expected:

- PASS for the duplicate-header assertions
- PASS for unchanged enable/edit/picker behavior

- [ ] **Step 5: Commit**

```bash
git add \
  packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx \
  packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx
git commit -m "Flatten mobile supervisor detail structure"
```

## Task 2: Flatten the mobile Supervisor sheet surface and footer chrome

**Files:**
- Modify: `packages/web/src/styles/components.css`
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write the failing mobile style contract assertions**

Replace the current “inner card” assumptions with flat mobile sheet expectations.

```ts
it("keeps mobile supervisor sheets on a flat fullscreen settings-panel contract", () => {
  const supervisorRoot = getLastRuleBlock(".mobile-supervisor-sheet__root").replace(/\s+/g, " ");
  const supervisorDetail = getLastRuleBlock(".mobile-supervisor-sheet__detail").replace(/\s+/g, " ");
  const supervisorFooter = getLastRuleBlock(".mobile-supervisor-sheet__footer").replace(/\s+/g, " ");
  const fullscreenFooter = getLastRuleBlock(
    ".mobile-supervisor-sheet.mobile-sheet--fullscreen .mobile-sheet__footer"
  ).replace(/\s+/g, " ");

  expect(hasRuleBlock(".mobile-supervisor-sheet__detail-header")).toBe(false);
  expect(supervisorRoot).toContain("padding: var(--sp-3)");
  expect(supervisorRoot).not.toContain("border: 1px solid");
  expect(supervisorRoot).not.toContain("box-shadow:");
  expect(supervisorDetail).toContain("padding: var(--sp-3)");
  expect(supervisorDetail).not.toContain("border: 1px solid");
  expect(supervisorDetail).not.toContain("box-shadow:");
  expect(supervisorFooter).toContain("padding: var(--sp-1) var(--sp-2)");
  expect(supervisorFooter).not.toContain("border-radius: var(--radius-xl)");
  expect(fullscreenFooter).toContain(
    "padding: var(--sp-1) var(--sp-3) calc(var(--mobile-safe-bottom) + var(--sp-3))"
  );
});
```

- [ ] **Step 2: Run the style contract test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:

- FAIL because the mobile Supervisor stylesheet still defines `__detail-header`
- FAIL because root/detail still have border, radius, and shadow-heavy inner-card styling

- [ ] **Step 3: Implement the flat mobile sheet styling**

In `components.css`, replace the current mobile Supervisor card-shell treatment with flatter mobile fullscreen spacing.

```css
.mobile-sheet__body--supervisor-detail {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.mobile-supervisor-sheet {
  gap: 0;
  padding: 0;
  background: color-mix(in srgb, var(--bg-page) 98%, var(--bg-surface) 2%);
}

.mobile-supervisor-sheet__root,
.mobile-supervisor-sheet__detail {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-3);
  padding-bottom: var(--sp-4);
  background: transparent;
  overflow: auto;
}

.mobile-supervisor-sheet__footer {
  width: 100%;
  padding: var(--sp-1) var(--sp-2);
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.mobile-supervisor-sheet.mobile-sheet--fullscreen .mobile-sheet__footer {
  padding: var(--sp-1) var(--sp-3) calc(var(--mobile-safe-bottom) + var(--sp-3));
  background: color-mix(in srgb, var(--bg-page) 94%, var(--bg-surface) 6%);
}
```

Delete the obsolete `.mobile-supervisor-sheet__detail-header*` rules.

- [ ] **Step 4: Run the style contract test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:

- PASS for the new flat mobile Supervisor contract
- PASS for unchanged mobile fullscreen header/footer token expectations elsewhere

- [ ] **Step 5: Commit**

```bash
git add \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts
git commit -m "Restyle mobile supervisor sheet as flat settings panel"
```

## Task 3: Verify the mobile redesign slice end-to-end

**Files:**
- No code changes expected
- Verify: `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx`
- Verify: `packages/web/src/features/supervisor/views/shared/objective-dialog-content.test.tsx`
- Verify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Run the focused mobile Supervisor regression suite**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx \
  src/features/supervisor/views/shared/objective-dialog-content.test.tsx \
  src/styles/components.theme.test.ts
```

Expected:

- PASS for mobile flow behavior, shared compact control behavior, and updated style contracts

- [ ] **Step 2: Run the targeted UI preview metadata tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/ui-preview/catalog.test.tsx \
  src/ui-preview/scene-metadata.test.ts
```

Expected:

- PASS if no shared preview inventory assumptions were broken by the Supervisor sheet changes

- [ ] **Step 3: Inspect the git diff for scope control**

Run:

```bash
git diff -- \
  docs/superpowers/specs/2026-05-19-mobile-supervisor-sheet-flat-redesign-design.md \
  docs/superpowers/plans/2026-05-19-mobile-supervisor-sheet-flat-redesign.md \
  packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx \
  packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts
```

Expected:

- Only the intended mobile Supervisor files, plan/spec docs, and related tests are changed
- No unrelated workspace edits are reverted

## Self-Review

Spec coverage check:

- Mobile-only scope correction: covered by Task 1 and Task 2 file scope.
- Remove duplicate mobile detail header: covered in Task 1.
- Flatten root/detail container chrome and footer: covered in Task 2.
- Preserve shared compact form behavior: verified in Task 3 with shared form tests.

Placeholder scan:

- No `TODO`, `TBD`, or deferred implementation notes remain.
- Every code-changing task includes exact files, commands, and representative code.

Type consistency:

- `MobileSupervisorSheet`, `ObjectiveDialogContent`, `Sheet`, and the existing draft callbacks keep their current names.
- No new public component APIs are introduced.
