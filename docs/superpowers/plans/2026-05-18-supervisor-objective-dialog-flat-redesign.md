# Supervisor Objective Dialog Flat Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the desktop Supervisor objective dialog into a flatter, denser settings-panel style surface with smaller typography and smaller input text, without changing Supervisor behavior.

**Architecture:** Keep the existing `ObjectiveDialog` modal shell and command flow intact, then tighten the feature in three layers: component markup, feature-local styling, and regression tests. The redesign stays scoped to `.supervisor-dialog` so global modal or input tokens do not change.

**Tech Stack:** React, TypeScript, shared UI primitives (`Modal`, `Input`, `Textarea`, `Select`, `DateTimePicker`), Vitest, Testing Library, CSS design tokens

---

## File Structure

- Modify: `packages/web/src/features/supervisor/views/shared/objective-dialog.tsx`
  - Keep the canonical dialog header and footer.
  - Continue rendering the same modal shell.
  - Only adjust body structure if the intro strip is owned here.

- Modify: `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`
  - Add the flattened intro strip for enable/edit modes.
  - Downgrade form control sizes from `lg` to compact variants.
  - Keep disable mode semantics and field callbacks unchanged.

- Modify: `packages/web/src/styles/components.css`
  - Replace the heavy Supervisor intro card treatment with a flat inline strip.
  - Tighten spacing and typography inside `.supervisor-dialog`.
  - Shrink warning callout density and ensure inputs render at the smaller token scale.

- Modify: `packages/web/src/features/supervisor/views/shared/objective-dialog-content.test.tsx`
  - Add markup and size assertions for the intro strip and compact controls.

- Modify: `packages/web/src/features/supervisor/components/objective-dialog.test.tsx`
  - Add assertions that the dialog body renders the new intro strip only for enable/edit flows.

- Modify: `packages/web/src/styles/components.theme.test.ts`
  - Update the style contract from “large specialized card” assumptions to the new flat Supervisor dialog contract.

## Task 1: Update dialog structure and compact control sizing

**Files:**
- Modify: `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`
- Modify: `packages/web/src/features/supervisor/views/shared/objective-dialog.tsx`
- Test: `packages/web/src/features/supervisor/views/shared/objective-dialog-content.test.tsx`
- Test: `packages/web/src/features/supervisor/components/objective-dialog.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Add coverage for the flattened intro strip and compact control classes.

```tsx
it("renders a flat supervisor intro strip for enable mode", () => {
  render(
    <ObjectiveDialogContent
      mode="enable"
      draftObjective=""
      draftEvaluatorProviderId="claude"
      draftEvaluatorModel=""
      draftMaxSupervisionCount="0"
      draftScheduledAt=""
      disableObjective=""
      isMaxSupervisionCountValid
      onDraftObjectiveChange={vi.fn()}
      onDraftEvaluatorProviderChange={vi.fn()}
      onDraftEvaluatorModelChange={vi.fn()}
      onDraftMaxSupervisionCountChange={vi.fn()}
      onDraftScheduledAtChange={vi.fn()}
    />
  );

  expect(screen.getByText("supervisor.dialog.enable.title")).toBeInTheDocument();
  expect(document.querySelector(".supervisor-dialog-intro")).toBeTruthy();
});

it("renders compact control classes instead of large form controls", () => {
  render(
    <ObjectiveDialogContent
      mode="edit"
      draftObjective="Investigate regressions"
      draftEvaluatorProviderId="claude"
      draftEvaluatorModel=""
      draftMaxSupervisionCount="0"
      draftScheduledAt=""
      disableObjective=""
      isMaxSupervisionCountValid
      onDraftObjectiveChange={vi.fn()}
      onDraftEvaluatorProviderChange={vi.fn()}
      onDraftEvaluatorModelChange={vi.fn()}
      onDraftMaxSupervisionCountChange={vi.fn()}
      onDraftScheduledAtChange={vi.fn()}
    />
  );

  expect(screen.getByLabelText("supervisor.field.objective")).not.toHaveClass("textarea-lg");
  expect(screen.getByRole("button", { name: "supervisor.field.evaluator Claude" })).toHaveClass(
    "input-sm"
  );
  expect(screen.getByLabelText("supervisor.field.evaluator_model")).toHaveClass("input-sm");
  expect(screen.getByLabelText("supervisor.field.max_supervision_count")).toHaveClass("input-sm");
});
```

Extend the desktop dialog test with an enable-mode intro assertion and a disable-mode absence assertion.

```tsx
it("renders the intro strip inside the desktop dialog for enable mode", () => {
  render(
    <Provider store={store}>
      <ObjectiveDialog workspaceId="ws-1" />
    </Provider>
  );

  expect(document.querySelector(".supervisor-dialog-intro")).toBeTruthy();
});

it("does not render the intro strip for disable mode", () => {
  render(
    <Provider store={store}>
      <ObjectiveDialog workspaceId="ws-1" />
    </Provider>
  );

  expect(document.querySelector(".supervisor-dialog-intro")).toBeNull();
});
```

- [ ] **Step 2: Run the targeted component tests to verify they fail**

Run:

```bash
pnpm vitest run \
  packages/web/src/features/supervisor/views/shared/objective-dialog-content.test.tsx \
  packages/web/src/features/supervisor/components/objective-dialog.test.tsx
```

Expected:

- FAIL because `.supervisor-dialog-intro` does not exist yet
- FAIL because form controls still render `lg` sizing

- [ ] **Step 3: Implement the flat intro strip and compact form control props**

In `objective-dialog-content.tsx`, add a small intro block for enable/edit and move control sizes to compact variants.

```tsx
function SupervisorDialogIntro({
  mode,
  title,
  subtitle,
}: {
  mode: "enable" | "edit";
  title: string;
  subtitle: string;
}) {
  return (
    <div className={`supervisor-dialog-intro supervisor-dialog-intro--${mode}`}>
      <span className="supervisor-dialog-intro__icon" aria-hidden="true">
        <ObjectiveDialogModeIcon mode={mode} />
      </span>
      <div className="supervisor-dialog-intro__copy">
        <strong className="supervisor-dialog-intro__title">{title}</strong>
        <p className="supervisor-dialog-intro__description">{subtitle}</p>
      </div>
    </div>
  );
}
```

Render it above the form fields for non-disable modes.

```tsx
{mode !== "disable" ? (
  <SupervisorDialogIntro
    mode={mode}
    title={t(`supervisor.dialog.${mode}.title`)}
    subtitle={t(`supervisor.dialog.${mode}.subtitle`)}
  />
) : null}
```

Downgrade the form controls from large sizing.

```tsx
<Textarea
  id="objective"
  rows={5}
  value={draftObjective}
  onChange={(event) => onDraftObjectiveChange(event.target.value)}
  aria-describedby={objectiveHelperId}
  placeholder={t("supervisor.field.objective_placeholder")}
  className="supervisor-dialog__objective"
  autoFocus
/>

<Select
  id="evaluator-provider"
  size="sm"
  desktopMode="listbox"
  mobileSheetTitle={t("supervisor.field.evaluator")}
  mobileSheetPresentation="inline"
  options={evaluatorOptions}
  value={draftEvaluatorProviderId}
  aria-labelledby={evaluatorLabelId}
  aria-describedby={evaluatorHelperId}
  onValueChange={onDraftEvaluatorProviderChange}
/>

<Input
  id="evaluator-model"
  size="sm"
  value={draftEvaluatorModel}
  onChange={(event) => onDraftEvaluatorModelChange(event.target.value)}
  aria-describedby={evaluatorModelHelperId}
  placeholder={t("supervisor.field.evaluator_model_placeholder")}
/>

<Input
  id="max-supervision-count"
  size="sm"
  type="number"
  min={0}
  step={1}
  value={draftMaxSupervisionCount}
  onChange={(event) => onDraftMaxSupervisionCountChange(event.target.value)}
  invalid={!isMaxSupervisionCountValid}
  aria-invalid={!isMaxSupervisionCountValid}
  aria-describedby={maxSupervisionCountHelperId}
/>

<DateTimePicker
  label={t("supervisor.field.scheduled_at")}
  value={draftScheduledAt}
  onValueChange={onDraftScheduledAtChange}
  placeholder={t("supervisor.field.scheduled_at_placeholder")}
  clearable
  minDate={new Date()}
  aria-describedby={scheduledAtHelperId}
  size="sm"
/>
```

If the dialog header is now visually redundant with the intro copy, keep the header title but trim duplicated text in the body only through layout, not by removing the canonical modal description API.

- [ ] **Step 4: Run the targeted component tests to verify they pass**

Run:

```bash
pnpm vitest run \
  packages/web/src/features/supervisor/views/shared/objective-dialog-content.test.tsx \
  packages/web/src/features/supervisor/components/objective-dialog.test.tsx
```

Expected:

- PASS for the new intro strip assertions
- PASS for the compact size assertions
- PASS for unchanged supervisor submit behavior

- [ ] **Step 5: Commit**

```bash
git add \
  packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx \
  packages/web/src/features/supervisor/views/shared/objective-dialog.tsx \
  packages/web/src/features/supervisor/views/shared/objective-dialog-content.test.tsx \
  packages/web/src/features/supervisor/components/objective-dialog.test.tsx
git commit -m "Refine supervisor dialog structure and compact controls"
```

## Task 2: Replace heavy chrome with flat, denser Supervisor dialog styling

**Files:**
- Modify: `packages/web/src/styles/components.css`
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write the failing style contract assertions**

Add contract coverage for the new flat intro strip, compact input typography, and denser warning callout.

```ts
it("keeps supervisor dialogs on the compact flat-panel contract", () => {
  const intro = getLastRuleBlock(".supervisor-dialog-intro");
  const introTitle = getLastRuleBlock(".supervisor-dialog-intro__title");
  const introDescription = getLastRuleBlock(".supervisor-dialog-intro__description");
  const supervisorInput = getLastRuleBlock(".supervisor-dialog .input");
  const supervisorTextarea = getLastRuleBlock(".supervisor-dialog .textarea");
  const warning = getLastRuleBlock(".supervisor-danger-callout");

  expect(intro).toContain("display: flex");
  expect(intro).toContain("padding: var(--sp-3)");
  expect(introTitle).toContain("font-size: var(--type-body-size)");
  expect(introDescription).toContain("font-size: var(--type-meta-size)");
  expect(supervisorInput).toContain("font-size: var(--type-label-size)");
  expect(supervisorTextarea).toContain("font-size: var(--type-code-inline-size)");
  expect(warning).toContain("padding: var(--sp-2) var(--sp-3)");
});
```

Also make the old “specialized large card” contract stop asserting against a now-removed treatment.

- [ ] **Step 2: Run the style contract test to verify it fails**

Run:

```bash
pnpm vitest run packages/web/src/styles/components.theme.test.ts
```

Expected:

- FAIL because `.supervisor-dialog-intro*` rules do not exist yet
- FAIL because `.supervisor-dialog .input` still inherits the larger body-strong text size

- [ ] **Step 3: Implement the feature-local CSS redesign**

In `components.css`, replace the top-heavy dialog-specific rules with a flat, denser Supervisor block.

```css
.supervisor-dialog .modal-body {
  gap: var(--sp-3);
}

.supervisor-dialog .form-group {
  gap: 6px;
}

.supervisor-dialog-intro {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  padding: var(--sp-3);
  border: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-surface) 88%, var(--bg-hover));
}

.supervisor-dialog-intro__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  background: var(--icon-surface-success);
  color: var(--icon-success);
  flex-shrink: 0;
}

.supervisor-dialog-intro__title {
  display: block;
  font-size: var(--type-body-size);
  line-height: var(--type-body-line-height);
  font-weight: var(--font-medium);
  color: var(--text-primary);
}

.supervisor-dialog-intro__description {
  margin: 2px 0 0;
  font-size: var(--type-meta-size);
  line-height: var(--type-meta-line-height);
  color: var(--text-secondary);
}
```

Shrink control typography and textarea density only inside Supervisor dialogs.

```css
.supervisor-dialog .input,
.supervisor-dialog .mobile-select-trigger {
  font-size: var(--type-label-size);
  line-height: var(--type-label-line-height);
  font-weight: var(--type-label-weight);
}

.supervisor-dialog .textarea {
  min-height: 104px;
  font-family: var(--type-code-inline-family);
  font-size: var(--type-code-inline-size);
  line-height: var(--type-code-inline-line-height);
  font-weight: var(--type-code-inline-weight);
}

.supervisor-danger-callout {
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-left-width: 1px;
}

.supervisor-danger-callout-copy {
  font-size: var(--type-label-size);
  line-height: var(--type-label-line-height);
}
```

Keep the existing enable/edit/disable semantic color mapping by reusing the same icon surface tokens on the new compact intro icon.

- [ ] **Step 4: Run the style contract test to verify it passes**

Run:

```bash
pnpm vitest run packages/web/src/styles/components.theme.test.ts
```

Expected:

- PASS with the new flat-panel Supervisor contract
- PASS for unchanged modal header token expectations

- [ ] **Step 5: Commit**

```bash
git add \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts
git commit -m "Restyle supervisor dialog as flat settings panel"
```

## Task 3: Run end-to-end regression checks for the redesign slice

**Files:**
- No code changes expected
- Verify: `packages/web/src/features/supervisor/views/shared/objective-dialog-content.test.tsx`
- Verify: `packages/web/src/features/supervisor/components/objective-dialog.test.tsx`
- Verify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Run the focused Supervisor test suite**

Run:

```bash
pnpm vitest run \
  packages/web/src/features/supervisor/views/shared/objective-dialog-content.test.tsx \
  packages/web/src/features/supervisor/components/objective-dialog.test.tsx \
  packages/web/src/styles/components.theme.test.ts
```

Expected:

- PASS for dialog structure, behavior, and style contracts

- [ ] **Step 2: Run the targeted UI preview or scene test if the dialog scene is part of the current inventory**

Run:

```bash
pnpm vitest run \
  packages/web/src/ui-preview/catalog.test.tsx \
  packages/web/src/ui-preview/scene-metadata.test.ts
```

Expected:

- PASS if no selector or scene metadata was broken by the dialog markup changes

- [ ] **Step 3: Inspect the git diff for scope control**

Run:

```bash
git diff -- \
  packages/web/src/features/supervisor/views/shared/objective-dialog.tsx \
  packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx \
  packages/web/src/styles/components.css \
  packages/web/src/features/supervisor/views/shared/objective-dialog-content.test.tsx \
  packages/web/src/features/supervisor/components/objective-dialog.test.tsx \
  packages/web/src/styles/components.theme.test.ts
```

Expected:

- Only the intended Supervisor dialog files and related tests are changed
- No unrelated workspace edits are reverted

- [ ] **Step 4: Commit the verification-complete slice**

```bash
git add \
  packages/web/src/features/supervisor/views/shared/objective-dialog.tsx \
  packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx \
  packages/web/src/styles/components.css \
  packages/web/src/features/supervisor/views/shared/objective-dialog-content.test.tsx \
  packages/web/src/features/supervisor/components/objective-dialog.test.tsx \
  packages/web/src/styles/components.theme.test.ts
git commit -m "Verify supervisor dialog flat redesign"
```

## Self-Review

Spec coverage check:

- Flat intro strip replacing the large top card: covered in Task 1 and Task 2.
- Smaller overall typography and `~12px` input text: covered in Task 1 control sizing and Task 2 CSS typography overrides.
- Flatter, denser warning panel: covered in Task 2.
- No Supervisor behavior regression: covered in Task 1 and Task 3 focused test runs.

Placeholder scan:

- No `TODO`, `TBD`, or “implement later” placeholders remain.
- Every code-changing task includes the concrete file paths and representative code blocks.

Type consistency:

- `ObjectiveDialogModeIcon`, `DateTimePicker`, `Input`, `Select`, and `Textarea` names match the existing codebase.
- The plan keeps `mode`, `draft*` props, and existing callback names unchanged.
