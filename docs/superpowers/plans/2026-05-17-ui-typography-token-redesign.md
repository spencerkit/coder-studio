# UI Typography Token Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ad-hoc UI font sizing with a two-layer desktop/mobile typography token system, migrate ordinary UI surfaces onto semantic typography roles, and add tests that prevent raw or legacy typography values from re-entering non-code UI.

**Architecture:** Introduce a new typography layer in `tokens.css` with neutral base scale tokens plus semantic UI typography tokens. Rebind `base.css`, shared CSS modules, and `components.css` feature shells to the semantic tokens in migration batches, while keeping terminal/editor/diff code surfaces on their own typography. Lock the contract in stylesheet-oriented tests and finish with an automated guardrail plus a final `rg` audit so only exempt code surfaces retain raw font sizes.

**Tech Stack:** TypeScript, React 19, Vitest, vanilla CSS custom properties, CSS Modules, Biome

**Spec reference:** `docs/superpowers/specs/2026-05-17-typography-design.md`

---

## File Structure

- Modify: `packages/web/src/styles/tokens.css`
  - Add the new base-scale and semantic typography tokens plus mobile overrides.
- Modify: `packages/web/src/styles/tokens-touch.test.ts`
  - Lock the new desktop/mobile typography token contract in tests.
- Modify: `packages/web/src/styles/base.css`
  - Rebind root text elements, heading tags, and helper classes to semantic typography tokens.
- Modify: `packages/web/src/styles/base.theme.test.ts`
  - Assert the new base typography bindings.
- Modify: `packages/web/src/styles/components.css`
  - Migrate shared chrome, settings, launch, welcome, auth, workspace empty states, and residual ordinary UI selectors to semantic typography tokens.
- Modify: `packages/web/src/styles/components.theme.test.ts`
  - Add stylesheet assertions for CSS modules and feature-shell typography mappings.
- Modify: `packages/web/src/components/ui/button/index.module.css`
  - Move shared button typography to semantic tokens.
- Modify: `packages/web/src/components/ui/input/index.module.css`
  - Move input typography to semantic tokens.
- Modify: `packages/web/src/components/ui/textarea/index.module.css`
  - Move textarea typography to semantic tokens.
- Modify: `packages/web/src/components/ui/tabs/index.module.css`
  - Move tab typography to semantic tokens.
- Modify: `packages/web/src/components/ui/tag/index.module.css`
  - Replace raw badge/tag sizes with semantic kicker tokens.
- Modify: `packages/web/src/components/ui/badge/index.module.css`
  - Replace raw badge sizes with semantic kicker tokens.
- Modify: `packages/web/src/components/ui/pill/index.module.css`
  - Replace pill sizes with semantic label tokens.
- Modify: `packages/web/src/components/ui/tooltip/index.module.css`
  - Replace tooltip sizes with semantic meta tokens.
- Modify: `packages/web/src/components/ui/notice/index.module.css`
  - Replace notice title/message sizes with semantic kicker/meta tokens.
- Modify: `packages/web/src/components/ui/modal/index.module.css`
  - Replace modal title size with semantic section-title tokens.
- Modify: `packages/web/src/components/ui/empty-state/index.module.css`
  - Replace empty-state title/description sizing with app-title/body tokens.
- Create: `packages/web/src/styles/typography.guard.test.ts`
  - Fail when shared UI files reintroduce raw or legacy font sizes outside exempt code surfaces.

## Task 1: Capture The Baseline And Lock The Token Contract

**Files:**
- Modify: `packages/web/src/styles/tokens-touch.test.ts`
- Modify: `packages/web/src/styles/tokens.css`
- Test: `packages/web/src/styles/tokens-touch.test.ts`

- [ ] **Step 1: Record the current font-size baseline before changing tokens**

Run:

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('packages/web/src/styles/components.css','utf8');const m=[...s.matchAll(/font-size:\\s*([^;]+);/g)].map(x=>x[1].trim());const c={};for(const v of m)c[v]=(c[v]||0)+1;console.log(Object.entries(c).sort((a,b)=>b[1]-a[1]).map(([k,v])=>v+' '+k).join('\\n'));"
```

Expected:

- output still shows the current legacy mix such as `var(--text-sm)`, `var(--text-xs)`, raw `10px`, raw `11px`, raw `12px`, raw `13px`, and `clamp(...)`

- [ ] **Step 2: Write the failing desktop/mobile typography token tests**

Add these tests to `packages/web/src/styles/tokens-touch.test.ts` after the existing touch-token assertions:

```ts
  it("defines the desktop typography scale and semantic aliases on :root", () => {
    const root = getRuleBlock(":root");

    expect(root).toContain("--font-size-100: 11px");
    expect(root).toContain("--font-size-200: 12px");
    expect(root).toContain("--font-size-300: 14px");
    expect(root).toContain("--font-size-400: 16px");
    expect(root).toContain("--font-size-500: 18px");
    expect(root).toContain("--font-size-600: 24px");
    expect(root).toContain("--font-size-700: 32px");

    expect(root).toContain("--type-kicker-size: var(--font-size-100)");
    expect(root).toContain("--type-kicker-line-height: 1.2");
    expect(root).toContain("--type-kicker-weight: var(--font-semibold)");
    expect(root).toContain("--type-kicker-letter-spacing: 0.08em");

    expect(root).toContain("--type-label-size: var(--font-size-200)");
    expect(root).toContain("--type-label-line-height: 1.35");
    expect(root).toContain("--type-label-weight: var(--font-medium)");

    expect(root).toContain("--type-meta-size: var(--font-size-200)");
    expect(root).toContain("--type-body-size: var(--font-size-300)");
    expect(root).toContain("--type-body-strong-size: var(--font-size-300)");
    expect(root).toContain("--type-code-inline-size: var(--font-size-200)");
    expect(root).toContain("--type-code-inline-family: var(--font-mono)");
    expect(root).toContain("--type-app-title-size: var(--font-size-400)");
    expect(root).toContain("--type-section-title-size: var(--font-size-500)");
    expect(root).toContain("--type-page-title-size: var(--font-size-600)");
    expect(root).toContain("--type-display-size: var(--font-size-700)");
  });

  it("overrides the typography scale and dense body line-heights for mobile viewports", () => {
    const mediaMatch = /@media\\s*\\(max-width:\\s*899px\\)\\s*\\{([\\s\\S]*?)\\}\\s*\\}/m.exec(stylesheet);

    expect(mediaMatch, "expected @media (max-width: 899px) block").not.toBeNull();

    const body = mediaMatch![1];

    expect(body).toContain("--font-size-100: 12px");
    expect(body).toContain("--font-size-200: 13px");
    expect(body).toContain("--font-size-300: 15px");
    expect(body).toContain("--font-size-400: 17px");
    expect(body).toContain("--font-size-500: 20px");
    expect(body).toContain("--font-size-600: 28px");
    expect(body).toContain("--font-size-700: 36px");
    expect(body).toContain("--type-body-line-height: 1.55");
    expect(body).toContain("--type-body-strong-line-height: 1.5");
  });
```

- [ ] **Step 3: Run the token tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/tokens-touch.test.ts
```

Expected:

- FAIL because `tokens.css` does not yet define `--font-size-100` through `--font-size-700`
- FAIL because the mobile `@media (max-width: 899px)` block does not yet override typography tokens

- [ ] **Step 4: Implement the minimal token layer in `tokens.css`**

Add the new typography tokens near the current font-size section in `packages/web/src/styles/tokens.css`:

```css
  /* Typography scale for semantic UI tokens */
  --font-size-100: 11px;
  --font-size-200: 12px;
  --font-size-300: 14px;
  --font-size-400: 16px;
  --font-size-500: 18px;
  --font-size-600: 24px;
  --font-size-700: 32px;

  /* Semantic typography */
  --type-kicker-size: var(--font-size-100);
  --type-kicker-line-height: 1.2;
  --type-kicker-weight: var(--font-semibold);
  --type-kicker-letter-spacing: 0.08em;

  --type-label-size: var(--font-size-200);
  --type-label-line-height: 1.35;
  --type-label-weight: var(--font-medium);

  --type-meta-size: var(--font-size-200);
  --type-meta-line-height: 1.45;
  --type-meta-weight: var(--font-normal);

  --type-body-size: var(--font-size-300);
  --type-body-line-height: 1.5;
  --type-body-weight: var(--font-normal);

  --type-body-strong-size: var(--font-size-300);
  --type-body-strong-line-height: 1.45;
  --type-body-strong-weight: var(--font-medium);

  --type-code-inline-size: var(--font-size-200);
  --type-code-inline-line-height: 1.4;
  --type-code-inline-weight: var(--font-medium);
  --type-code-inline-family: var(--font-mono);

  --type-app-title-size: var(--font-size-400);
  --type-app-title-line-height: 1.25;
  --type-app-title-weight: var(--font-semibold);

  --type-section-title-size: var(--font-size-500);
  --type-section-title-line-height: 1.2;
  --type-section-title-weight: var(--font-semibold);

  --type-page-title-size: var(--font-size-600);
  --type-page-title-line-height: 1.1;
  --type-page-title-weight: var(--font-semibold);

  --type-display-size: var(--font-size-700);
  --type-display-line-height: 1.05;
  --type-display-weight: var(--font-semibold);
  --type-display-letter-spacing: -0.03em;

  /* Legacy compatibility aliases during migration */
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 13px;
  --text-lg: 14px;
  --text-xl: 16px;
  --text-2xl: 18px;
  --text-3xl: 20px;
```

Then extend the existing mobile media override block at the bottom of `tokens.css`:

```css
    --font-size-100: 12px;
    --font-size-200: 13px;
    --font-size-300: 15px;
    --font-size-400: 17px;
    --font-size-500: 20px;
    --font-size-600: 28px;
    --font-size-700: 36px;
    --type-body-line-height: 1.55;
    --type-body-strong-line-height: 1.5;
```

- [ ] **Step 5: Re-run the token tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/tokens-touch.test.ts
```

Expected:

- PASS for the new typography scale and mobile override tests
- PASS for the existing touch-token tests

- [ ] **Step 6: Commit the token contract**

```bash
git add packages/web/src/styles/tokens.css packages/web/src/styles/tokens-touch.test.ts
git commit -m "feat(web): add semantic typography token scale"
```

## Task 2: Rebind Base Typography Defaults

**Files:**
- Modify: `packages/web/src/styles/base.css`
- Modify: `packages/web/src/styles/base.theme.test.ts`
- Test: `packages/web/src/styles/base.theme.test.ts`

- [ ] **Step 1: Write the failing base typography tests**

Replace the current legacy heading-helper assertions in `packages/web/src/styles/base.theme.test.ts` with these tests:

```ts
  it("maps base text elements onto semantic typography tokens", () => {
    expect(getRuleBlock("body")).toContain("font-size: var(--type-body-size)");
    expect(getRuleBlock("body")).toContain("line-height: var(--type-body-line-height)");
    expect(getRuleBlock("body")).toContain("font-weight: var(--type-body-weight)");

    expect(getRuleBlock("button")).toContain("font-size: var(--type-body-strong-size)");
    expect(getRuleBlock("button")).toContain("line-height: var(--type-body-strong-line-height)");
    expect(getRuleBlock("input")).toContain("font-size: var(--type-body-strong-size)");
    expect(getRuleBlock("textarea")).toContain("font-size: var(--type-body-strong-size)");
    expect(getRuleBlock("select")).toContain("font-size: var(--type-body-strong-size)");
  });

  it("maps headings and helper text onto the new semantic hierarchy", () => {
    expect(getRuleBlock("h1")).toContain("font-size: var(--type-page-title-size)");
    expect(getRuleBlock("h2")).toContain("font-size: var(--type-section-title-size)");
    expect(getRuleBlock("h3")).toContain("font-size: var(--type-app-title-size)");
    expect(getRuleBlock("h4")).toContain("font-size: var(--type-body-strong-size)");
    expect(getRuleBlock("h5")).toContain("font-size: var(--type-label-size)");
    expect(getRuleBlock("h6")).toContain("font-size: var(--type-meta-size)");

    expect(getRuleBlock(".page-kicker")).toContain("font-size: var(--type-kicker-size)");
    expect(getRuleBlock(".page-title")).toContain("font-size: var(--type-page-title-size)");
    expect(getRuleBlock(".section-title")).toContain("font-size: var(--type-kicker-size)");
    expect(getRuleBlock(".meta-text")).toContain("font-size: var(--type-meta-size)");
    expect(getRuleBlock(".hint-text")).toContain("font-size: var(--type-meta-size)");
    expect(getRuleBlock(".mono-meta")).toContain("font-size: var(--type-code-inline-size)");
    expect(getRuleBlock(".mono-meta")).toContain("font-family: var(--type-code-inline-family)");
  });
```

- [ ] **Step 2: Run the base stylesheet tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/base.theme.test.ts
```

Expected:

- FAIL because `base.css` still points `body`, `button`, headings, and helper classes at legacy `--text-*` tokens

- [ ] **Step 3: Rebind the base stylesheet to the semantic typography tokens**

Update `packages/web/src/styles/base.css` with these declarations:

```css
body {
  font-family: var(--font-sans);
  font-size: var(--type-body-size);
  line-height: var(--type-body-line-height);
  font-weight: var(--type-body-weight);
  color: var(--text-primary);
  background-color: var(--bg-page);
  overflow: hidden;
}

h1 {
  font-size: var(--type-page-title-size);
  line-height: var(--type-page-title-line-height);
  font-weight: var(--type-page-title-weight);
}

h2 {
  font-size: var(--type-section-title-size);
  line-height: var(--type-section-title-line-height);
  font-weight: var(--type-section-title-weight);
}

h3 {
  font-size: var(--type-app-title-size);
  line-height: var(--type-app-title-line-height);
  font-weight: var(--type-app-title-weight);
}

h4 {
  font-size: var(--type-body-strong-size);
  line-height: var(--type-body-strong-line-height);
  font-weight: var(--type-body-strong-weight);
}

h5 {
  font-size: var(--type-label-size);
  line-height: var(--type-label-line-height);
  font-weight: var(--type-label-weight);
}

h6 {
  font-size: var(--type-meta-size);
  line-height: var(--type-meta-line-height);
  font-weight: var(--type-meta-weight);
}

.page-kicker,
.section-kicker,
.section-title {
  font-size: var(--type-kicker-size);
  line-height: var(--type-kicker-line-height);
  font-weight: var(--type-kicker-weight);
  text-transform: uppercase;
  letter-spacing: var(--type-kicker-letter-spacing);
  color: var(--text-tertiary);
}

.page-title {
  font-size: var(--type-page-title-size);
  line-height: var(--type-page-title-line-height);
  font-weight: var(--type-page-title-weight);
  color: var(--text-primary);
}

.meta-text,
.hint-text {
  font-size: var(--type-meta-size);
  line-height: var(--type-meta-line-height);
  font-weight: var(--type-meta-weight);
}

.mono-meta,
code,
pre,
kbd,
samp {
  font-family: var(--type-code-inline-family);
  font-size: var(--type-code-inline-size);
  line-height: var(--type-code-inline-line-height);
  font-weight: var(--type-code-inline-weight);
}

button {
  font-family: var(--font-sans);
  font-size: var(--type-body-strong-size);
  line-height: var(--type-body-strong-line-height);
  font-weight: var(--type-body-strong-weight);
}

input,
textarea,
select {
  font-family: var(--font-sans);
  font-size: var(--type-body-strong-size);
  line-height: var(--type-body-strong-line-height);
  font-weight: var(--type-body-strong-weight);
}
```

- [ ] **Step 4: Re-run the base stylesheet tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/base.theme.test.ts
```

Expected:

- PASS for the new semantic base typography tests
- PASS for the existing theme-sensitive shell assertions

- [ ] **Step 5: Commit the base typography remap**

```bash
git add packages/web/src/styles/base.css packages/web/src/styles/base.theme.test.ts
git commit -m "feat(web): rebind base typography to semantic tokens"
```

## Task 3: Migrate Text Entry And Navigation Primitives

**Files:**
- Modify: `packages/web/src/components/ui/button/index.module.css`
- Modify: `packages/web/src/components/ui/input/index.module.css`
- Modify: `packages/web/src/components/ui/textarea/index.module.css`
- Modify: `packages/web/src/components/ui/tabs/index.module.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Add failing style assertions for button, input, textarea, and tabs**

At the top of `packages/web/src/styles/components.theme.test.ts`, add the missing stylesheet sources:

```ts
const buttonStyles = readFileSync(`${process.cwd()}/src/components/ui/button/index.module.css`, "utf8");
const inputStyles = readFileSync(`${process.cwd()}/src/components/ui/input/index.module.css`, "utf8");
const textareaStyles = readFileSync(`${process.cwd()}/src/components/ui/textarea/index.module.css`, "utf8");
const tabsStyles = readFileSync(`${process.cwd()}/src/components/ui/tabs/index.module.css`, "utf8");
```

Then add this test near the existing shared UI primitive assertions:

```ts
  it("maps text-entry and navigation primitives onto semantic typography tokens", () => {
    expect(getLastRuleBlockFrom(buttonStyles, ".btn")).toContain(
      "font-size: var(--type-body-strong-size)"
    );
    expect(getLastRuleBlockFrom(buttonStyles, ".btn")).toContain(
      "line-height: var(--type-body-strong-line-height)"
    );
    expect(getLastRuleBlockFrom(buttonStyles, ".sm")).toContain(
      "font-size: var(--type-label-size)"
    );
    expect(getLastRuleBlockFrom(buttonStyles, ".lg")).not.toContain("font-size:");

    expect(getLastRuleBlockFrom(inputStyles, ".input")).toContain(
      "font-size: var(--type-body-strong-size)"
    );
    expect(getLastRuleBlockFrom(inputStyles, ".sm")).toContain(
      "font-size: var(--type-label-size)"
    );
    expect(getLastRuleBlockFrom(inputStyles, ".lg")).not.toContain("font-size:");

    expect(getLastRuleBlockFrom(textareaStyles, ".input")).toContain(
      "font-size: var(--type-body-strong-size)"
    );
    expect(getLastRuleBlockFrom(textareaStyles, ".lg")).not.toContain("font-size:");

    expect(getLastRuleBlockFrom(tabsStyles, ":global(.panel-tab)")).toContain(
      "font-size: var(--type-label-size)"
    );
    expect(getLastRuleBlockFrom(tabsStyles, ":global(.panel-tab)")).toContain(
      "line-height: var(--type-label-line-height)"
    );
    expect(getLastRuleBlockFrom(tabsStyles, ":global(.worktree-tab)")).toContain(
      "font-size: var(--type-label-size)"
    );
  });
```

- [ ] **Step 2: Run the theme stylesheet test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:

- FAIL because the shared primitives still use `var(--text-*)` or raw font sizes

- [ ] **Step 3: Rebind the primitives to semantic tokens**

Update `packages/web/src/components/ui/button/index.module.css`:

```css
.btn,
:global(.btn) {
  font-size: var(--type-body-strong-size);
  line-height: var(--type-body-strong-line-height);
  font-weight: var(--type-body-strong-weight);
}

.sm,
:global(.btn-sm) {
  height: 24px;
  padding: 0 var(--sp-2);
  border-radius: var(--radius-sm);
  font-size: var(--type-label-size);
  line-height: var(--type-label-line-height);
  font-weight: var(--type-label-weight);
}

.lg,
:global(.btn-lg) {
  height: 40px;
  padding: 0 var(--sp-6);
  border-radius: var(--radius-lg);
}
```

Update `packages/web/src/components/ui/input/index.module.css`:

```css
.input {
  font-size: var(--type-body-strong-size);
  line-height: var(--type-body-strong-line-height);
  font-weight: var(--type-body-strong-weight);
}

.sm {
  height: var(--input-height-sm);
  border-radius: var(--radius-sm);
  font-size: var(--type-label-size);
  line-height: var(--type-label-line-height);
  font-weight: var(--type-label-weight);
}

.lg {
  height: var(--input-height-lg);
  border-radius: var(--radius-lg);
}
```

Update `packages/web/src/components/ui/textarea/index.module.css`:

```css
.input {
  font-size: var(--type-body-strong-size);
  line-height: var(--type-body-strong-line-height);
  font-weight: var(--type-body-strong-weight);
}

.lg {
  min-height: 120px;
  border-radius: var(--radius-lg);
}
```

Update `packages/web/src/components/ui/tabs/index.module.css`:

```css
:global(.panel-tab) {
  font-size: var(--type-label-size);
  line-height: var(--type-label-line-height);
  font-weight: var(--type-label-weight);
  padding: 2px 8px;
  border-radius: 4px;
  color: var(--text-ter);
}

:global(.worktree-tab) {
  padding: var(--sp-3) var(--sp-4);
  font-size: var(--type-label-size);
  line-height: var(--type-label-line-height);
  font-weight: var(--type-label-weight);
  color: var(--text-secondary);
}
```

- [ ] **Step 4: Re-run the theme stylesheet test**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:

- PASS for the new button/input/textarea/tabs typography assertions
- PASS for the pre-existing `components.theme.test.ts` assertions that are unaffected by this slice

- [ ] **Step 5: Commit the text-entry and navigation primitive migration**

```bash
git add \
  packages/web/src/components/ui/button/index.module.css \
  packages/web/src/components/ui/input/index.module.css \
  packages/web/src/components/ui/textarea/index.module.css \
  packages/web/src/components/ui/tabs/index.module.css \
  packages/web/src/styles/components.theme.test.ts
git commit -m "feat(web): migrate text entry primitives to semantic typography"
```

## Task 4: Migrate Display And Status Primitives

**Files:**
- Modify: `packages/web/src/components/ui/tag/index.module.css`
- Modify: `packages/web/src/components/ui/badge/index.module.css`
- Modify: `packages/web/src/components/ui/pill/index.module.css`
- Modify: `packages/web/src/components/ui/tooltip/index.module.css`
- Modify: `packages/web/src/components/ui/notice/index.module.css`
- Modify: `packages/web/src/components/ui/modal/index.module.css`
- Modify: `packages/web/src/components/ui/empty-state/index.module.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Add failing style assertions for display/status primitives**

Extend `packages/web/src/styles/components.theme.test.ts` with the missing stylesheet sources:

```ts
const tagStyles = readFileSync(`${process.cwd()}/src/components/ui/tag/index.module.css`, "utf8");
const badgeStyles = readFileSync(`${process.cwd()}/src/components/ui/badge/index.module.css`, "utf8");
const tooltipStyles = readFileSync(`${process.cwd()}/src/components/ui/tooltip/index.module.css`, "utf8");
const modalStyles = readFileSync(`${process.cwd()}/src/components/ui/modal/index.module.css`, "utf8");
const emptyStateStyles = readFileSync(`${process.cwd()}/src/components/ui/empty-state/index.module.css`, "utf8");
```

Add this test:

```ts
  it("maps display and status primitives onto semantic typography roles", () => {
    expect(getLastRuleBlockFrom(tagStyles, ":where(.tag)")).toContain(
      "font-size: var(--type-kicker-size)"
    );
    expect(getLastRuleBlockFrom(tagStyles, ":where(.tag)")).toContain(
      "letter-spacing: var(--type-kicker-letter-spacing)"
    );
    expect(getLastRuleBlockFrom(tagStyles, ".sm")).not.toContain("font-size:");

    expect(getLastRuleBlockFrom(badgeStyles, ":where(.badge)")).toContain(
      "font-size: var(--type-kicker-size)"
    );
    expect(getLastRuleBlockFrom(pillStylesheet, ".pill")).toContain(
      "font-size: var(--type-label-size)"
    );
    expect(getLastRuleBlockFrom(tooltipStyles, ".tooltip")).toContain(
      "font-size: var(--type-meta-size)"
    );
    expect(getLastRuleBlockFrom(noticeStylesheet, ".title")).toContain(
      "font-size: var(--type-kicker-size)"
    );
    expect(getLastRuleBlockFrom(noticeStylesheet, ".message")).toContain(
      "font-size: var(--type-meta-size)"
    );
    expect(getLastRuleBlockFrom(modalStyles, ".title")).toContain(
      "font-size: var(--type-section-title-size)"
    );
    expect(getLastRuleBlockFrom(emptyStateStyles, ".title")).toContain(
      "font-size: var(--type-app-title-size)"
    );
    expect(getLastRuleBlockFrom(emptyStateStyles, ".description")).toContain(
      "font-size: var(--type-body-size)"
    );
  });
```

- [ ] **Step 2: Run the theme stylesheet test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:

- FAIL because tag, badge, tooltip, modal, and empty-state still use raw or legacy typography values

- [ ] **Step 3: Rebind the display/status primitives**

Update `packages/web/src/components/ui/tag/index.module.css`:

```css
:where(.tag),
:global(:where(.badge)) {
  font-size: var(--type-kicker-size);
  line-height: var(--type-kicker-line-height);
  font-weight: var(--type-kicker-weight);
  letter-spacing: var(--type-kicker-letter-spacing);
  text-transform: uppercase;
}

.sm {
  height: 18px;
  padding: 0 var(--sp-1);
}
```

Update `packages/web/src/components/ui/badge/index.module.css`:

```css
:where(.badge),
:global(:where(.topbar-unread)) {
  font-size: var(--type-kicker-size);
  line-height: var(--type-kicker-line-height);
  font-weight: var(--type-kicker-weight);
}
```

Update `packages/web/src/components/ui/pill/index.module.css`:

```css
.pill {
  font-size: var(--type-label-size);
  line-height: var(--type-label-line-height);
  font-weight: var(--type-label-weight);
}
```

Update `packages/web/src/components/ui/tooltip/index.module.css`:

```css
.tooltip {
  font-size: var(--type-meta-size);
  line-height: var(--type-meta-line-height);
  font-weight: var(--type-meta-weight);
}
```

Update `packages/web/src/components/ui/notice/index.module.css`:

```css
.title {
  font-size: var(--type-kicker-size);
  line-height: var(--type-kicker-line-height);
  font-weight: var(--type-kicker-weight);
  letter-spacing: var(--type-kicker-letter-spacing);
  text-transform: uppercase;
  color: var(--text-primary);
}

.message {
  font-size: var(--type-meta-size);
  line-height: var(--type-meta-line-height);
  font-weight: var(--type-meta-weight);
  color: var(--text-secondary);
  word-break: break-word;
}
```

Update `packages/web/src/components/ui/modal/index.module.css`:

```css
.title,
:global(.modal-title) {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  font-size: var(--type-section-title-size);
  line-height: var(--type-section-title-line-height);
  font-weight: var(--type-section-title-weight);
  color: var(--text-primary);
}
```

Update `packages/web/src/components/ui/empty-state/index.module.css`:

```css
.title {
  color: var(--text-primary);
  font-size: var(--type-app-title-size);
  line-height: var(--type-app-title-line-height);
  font-weight: var(--type-app-title-weight);
}

.description {
  width: min(100%, 30rem);
  max-width: 30rem;
  color: var(--text-secondary);
  font-size: var(--type-body-size);
  line-height: var(--type-body-line-height);
  font-weight: var(--type-body-weight);
}
```

- [ ] **Step 4: Re-run the theme stylesheet test**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:

- PASS for the new display/status primitive assertions
- PASS for the existing pill and notice behavior assertions

- [ ] **Step 5: Commit the display/status primitive migration**

```bash
git add \
  packages/web/src/components/ui/tag/index.module.css \
  packages/web/src/components/ui/badge/index.module.css \
  packages/web/src/components/ui/pill/index.module.css \
  packages/web/src/components/ui/tooltip/index.module.css \
  packages/web/src/components/ui/notice/index.module.css \
  packages/web/src/components/ui/modal/index.module.css \
  packages/web/src/components/ui/empty-state/index.module.css \
  packages/web/src/styles/components.theme.test.ts
git commit -m "feat(web): migrate display primitives to semantic typography"
```

## Task 5: Migrate Shared Chrome, Settings, And Launch Surfaces

**Files:**
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Add failing assertions for shared chrome and settings typography**

In `packages/web/src/styles/components.theme.test.ts`, add these assertions to the existing desktop/mobile shell tests:

```ts
    const commandPaletteKicker = getLastRuleBlock(".command-palette-kicker");
    const commandPaletteMeta = getLastRuleBlock(".command-palette-meta");
    const commandPaletteInput = getLastRuleBlock(".command-palette-input");
    const commandPaletteItemLabel = getLastRuleBlock(".command-palette-item-label");
    const commandPaletteItemDesc = getLastRuleBlock(".command-palette-item-desc");
    const commandPaletteItemShortcut = getLastRuleBlock(".command-palette-item-shortcut");
    const pageHeaderKicker = getLastRuleBlock(".page-header__kicker");
    const pageHeaderTitle = getLastRuleBlock(".page-header__title");
    const topbarTabName = getLastRuleBlock(".topbar-tab-name");
    const topbarBtnLabel = getLastRuleBlock(".topbar-btn-label");
    const dockLabel = getLastRuleBlock(".mobile-dock__label");
    const statusStrip = getLastRuleBlock(".mobile-shell__bottom-stack .git-panel-status-strip");

    expect(commandPaletteKicker).toContain("font-size: var(--type-kicker-size)");
    expect(commandPaletteMeta).toContain("font-size: var(--type-meta-size)");
    expect(commandPaletteInput).toContain("font-size: var(--type-body-strong-size)");
    expect(commandPaletteItemLabel).toContain("font-size: var(--type-body-strong-size)");
    expect(commandPaletteItemDesc).toContain("font-size: var(--type-meta-size)");
    expect(commandPaletteItemShortcut).toContain("font-size: var(--type-code-inline-size)");
    expect(pageHeaderKicker).toContain("font-size: var(--type-kicker-size)");
    expect(pageHeaderTitle).toContain("font-size: var(--type-app-title-size)");
    expect(topbarTabName).toContain("font-size: var(--type-label-size)");
    expect(topbarBtnLabel).toContain("font-size: var(--type-label-size)");
    expect(dockLabel).toContain("font-size: var(--type-kicker-size)");
    expect(statusStrip).toContain("font-size: var(--type-kicker-size)");
```

Then update the existing settings/launch assertions in the same file:

```ts
    expect(settingsGroupTitle).toContain("font-size: var(--type-kicker-size)");
    expect(settingsGroupDesc).toContain("font-size: var(--type-meta-size)");
    expect(settingsInfoLabel).toContain("font-size: var(--type-kicker-size)");
    expect(settingsStatusHint).toContain("font-size: var(--type-meta-size)");
    expect(desktopSettingsTitle).toContain("font-size: var(--type-section-title-size)");
    expect(launchActionButton).toContain("font-size: var(--type-body-strong-size)");
```

- [ ] **Step 2: Run the theme stylesheet test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:

- FAIL because `components.css` still uses `var(--text-*)`, raw `10px`, raw `13px`, and raw `18px` for shared chrome and settings copy

- [ ] **Step 3: Rebind the shared chrome and settings selectors**

Update `packages/web/src/styles/components.css` with these semantic mappings:

```css
.command-palette-kicker {
  font-size: var(--type-kicker-size);
  line-height: var(--type-kicker-line-height);
  font-weight: var(--type-kicker-weight);
  letter-spacing: var(--type-kicker-letter-spacing);
}

.command-palette-meta,
.command-palette-item-desc,
.settings-group-desc,
.settings-status-hint {
  font-size: var(--type-meta-size);
  line-height: var(--type-meta-line-height);
  font-weight: var(--type-meta-weight);
}

.command-palette-input,
.command-palette-item-label,
.mobile-launch-sheet__footer .launch-start-btn--mobile {
  font-size: var(--type-body-strong-size);
  line-height: var(--type-body-strong-line-height);
  font-weight: var(--type-body-strong-weight);
}

.command-palette-item-shortcut {
  font-family: var(--type-code-inline-family);
  font-size: var(--type-code-inline-size);
  line-height: var(--type-code-inline-line-height);
  font-weight: var(--type-code-inline-weight);
}

.page-header__kicker,
.settings-group-title,
.settings-info-label,
.mobile-dock__label,
.mobile-shell__bottom-stack .git-panel-status-strip {
  font-size: var(--type-kicker-size);
  line-height: var(--type-kicker-line-height);
  font-weight: var(--type-kicker-weight);
  letter-spacing: var(--type-kicker-letter-spacing);
  text-transform: uppercase;
}

.page-header__title,
.settings-header .page-header__title {
  font-size: var(--type-app-title-size);
  line-height: var(--type-app-title-line-height);
  font-weight: var(--type-app-title-weight);
}

.settings-page--desktop .settings-header .page-header__title {
  font-size: var(--type-section-title-size);
  line-height: var(--type-section-title-line-height);
  font-weight: var(--type-section-title-weight);
}

.topbar-tab-name,
.topbar-btn-label {
  font-size: var(--type-label-size);
  line-height: var(--type-label-line-height);
  font-weight: var(--type-label-weight);
}
```

- [ ] **Step 4: Re-run the theme stylesheet test**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:

- PASS for the updated command palette, settings, topbar, launch, dock, and status-strip typography assertions

- [ ] **Step 5: Commit the shared chrome migration**

```bash
git add packages/web/src/styles/components.css packages/web/src/styles/components.theme.test.ts
git commit -m "feat(web): migrate shared chrome typography"
```

## Task 6: Migrate Welcome, Auth, Workspace Empty States, And Display Titles

**Files:**
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Add failing assertions for page-level titles and body copy**

Update `packages/web/src/styles/components.theme.test.ts` where it currently asserts legacy `clamp(...)` or raw `14px/18px` values:

```ts
    const welcomeKicker = getLastRuleBlock(".welcome-kicker");
    const welcomeTitle = getLastRuleBlock(".welcome-title");
    const welcomeBody = getLastRuleBlock(".welcome-body");
    const workspaceResolvingKicker = getLastRuleBlock(".workspace-resolving-kicker");
    const workspaceResolvingTitle = getLastRuleBlock(".workspace-resolving-title");
    const workspaceResolvingDesc = getLastRuleBlock(".workspace-resolving-desc");
    const mobileEmptyTitle = getLastRuleBlock(".mobile-shell__empty-title");
    const mobileEmptyCopy = getLastRuleBlock(".mobile-shell__placeholder-copy p");
    const mobileEmptyCta = getLastRuleBlock(".mobile-shell__empty-cta");

    expect(welcomeKicker).toContain("font-size: var(--type-kicker-size)");
    expect(welcomeTitle).toContain("font-size: var(--type-page-title-size)");
    expect(welcomeBody).toContain("font-size: var(--type-body-size)");
    expect(workspaceResolvingKicker).toContain("font-size: var(--type-kicker-size)");
    expect(workspaceResolvingTitle).toContain("font-size: var(--type-display-size)");
    expect(workspaceResolvingDesc).toContain("font-size: var(--type-body-size)");
    expect(mobileEmptyTitle).toContain("font-size: var(--type-display-size)");
    expect(mobileEmptyCopy).toContain("font-size: var(--type-body-size)");
    expect(mobileEmptyCta).toContain("font-size: var(--type-body-strong-size)");
```

- [ ] **Step 2: Run the theme stylesheet test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:

- FAIL because welcome, workspace resolving, and mobile empty-state shells still use legacy `--text-*`, raw `14px`, or `clamp(...)`

- [ ] **Step 3: Rebind the page-level display and body selectors**

Update `packages/web/src/styles/components.css`:

```css
.welcome-kicker,
.workspace-resolving-kicker {
  font-size: var(--type-kicker-size);
  line-height: var(--type-kicker-line-height);
  font-weight: var(--type-kicker-weight);
  letter-spacing: var(--type-kicker-letter-spacing);
  text-transform: uppercase;
}

.welcome-title,
.auth-card-shell .welcome-title,
.welcome-card--mobile .welcome-title,
.auth-card-shell--mobile .welcome-title {
  font-size: var(--type-page-title-size);
  line-height: var(--type-page-title-line-height);
  font-weight: var(--type-page-title-weight);
}

.welcome-body,
.workspace-resolving-desc,
.mobile-shell__placeholder-copy p {
  font-size: var(--type-body-size);
  line-height: var(--type-body-line-height);
  font-weight: var(--type-body-weight);
}

.welcome-btn,
.mobile-shell__empty-cta {
  font-size: var(--type-body-strong-size);
  line-height: var(--type-body-strong-line-height);
  font-weight: var(--type-body-strong-weight);
}

.welcome-link {
  font-size: var(--type-meta-size);
  line-height: var(--type-meta-line-height);
  font-weight: var(--type-meta-weight);
}

.workspace-resolving-title,
.mobile-shell__empty-title {
  font-size: var(--type-display-size);
  line-height: var(--type-display-line-height);
  font-weight: var(--type-display-weight);
  letter-spacing: var(--type-display-letter-spacing);
}
```

- [ ] **Step 4: Re-run the theme stylesheet test**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:

- PASS for the updated page-level typography assertions
- PASS for the existing welcome/mobile empty-state structural assertions that still apply

- [ ] **Step 5: Commit the page-level migration**

```bash
git add packages/web/src/styles/components.css packages/web/src/styles/components.theme.test.ts
git commit -m "feat(web): migrate page-level typography surfaces"
```

## Task 7: Add A Typography Guardrail And Finish Verification

**Files:**
- Create: `packages/web/src/styles/typography.guard.test.ts`
- Modify: `packages/web/src/styles/components.css`
- Test: `packages/web/src/styles/typography.guard.test.ts`

- [ ] **Step 1: Write the failing typography guardrail test**

Create `packages/web/src/styles/typography.guard.test.ts` with this content:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const baseStyles = readFileSync(`${process.cwd()}/src/styles/base.css`, "utf8");
const componentsStyles = readFileSync(`${process.cwd()}/src/styles/components.css`, "utf8");
const sharedUiSources = [
  "src/components/ui/button/index.module.css",
  "src/components/ui/input/index.module.css",
  "src/components/ui/textarea/index.module.css",
  "src/components/ui/tabs/index.module.css",
  "src/components/ui/tag/index.module.css",
  "src/components/ui/badge/index.module.css",
  "src/components/ui/pill/index.module.css",
  "src/components/ui/tooltip/index.module.css",
  "src/components/ui/notice/index.module.css",
  "src/components/ui/modal/index.module.css",
  "src/components/ui/empty-state/index.module.css",
].map((file) => [file, readFileSync(`${process.cwd()}/${file}`, "utf8")] as const);

const forbiddenSharedPattern = /font-size:\\s*(?:\\d+px|clamp\\(|var\\(--text-)/;
const exemptComponentSelectors = [
  /\\.session-terminal/,
  /\\.bottom-terminal/,
  /\\.xterm/,
  /\\.code-editor/,
  /\\.monaco/,
  /\\.git-diff/,
  /\\.diff-/,
  /\\.review-/,
];

describe("typography guardrails", () => {
  it("keeps base.css and shared UI modules off raw and legacy font sizes", () => {
    expect(baseStyles).not.toMatch(forbiddenSharedPattern);

    for (const [file, source] of sharedUiSources) {
      expect(source, file).not.toMatch(forbiddenSharedPattern);
    }
  });

  it("limits raw or legacy font-size values in components.css to exempt code surfaces", () => {
    const offenderBlocks = Array.from(
      componentsStyles.matchAll(/([^{}]+)\\{([^}]*font-size:\\s*(?:\\d+px|clamp\\(|var\\(--text-)[^}]*)\\}/g)
    )
      .map((match) => `${match[1]}{${match[2]}}`)
      .filter((block) => !exemptComponentSelectors.some((pattern) => pattern.test(block)));

    expect(offenderBlocks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the guardrail test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/typography.guard.test.ts
```

Expected:

- FAIL because `components.css` still has residual raw or legacy font-size declarations outside exempt code surfaces

- [ ] **Step 3: Finish the residual cleanup until only exempt code surfaces remain**

Run this audit to find the remaining non-exempt offenders:

```bash
rg -n "font-size:\\s*(?:[0-9]+px|var\\(--text-|clamp\\()" \
  packages/web/src/styles/base.css \
  packages/web/src/styles/components.css \
  packages/web/src/components/ui \
  -g '*.css' \
  -g '*.module.css'
```

Use the audit output to clean the remaining ordinary UI selectors in `packages/web/src/styles/components.css`. The first residual fixes should look like this:

```css
.topbar-unread {
  font-size: var(--type-kicker-size);
  line-height: var(--type-kicker-line-height);
  font-weight: var(--type-kicker-weight);
}

.settings-command-preview,
.settings-provider-mobile-entry-meta {
  font-family: var(--type-code-inline-family);
  font-size: var(--type-code-inline-size);
  line-height: var(--type-code-inline-line-height);
  font-weight: var(--type-code-inline-weight);
}

.mobile-topbar__session-label,
.mobile-topbar__workspace-name,
.mobile-topbar__session-name,
.mobile-topbar__session-empty {
  font-size: var(--type-label-size);
  line-height: var(--type-label-line-height);
  font-weight: var(--type-label-weight);
}
```

Keep iterating until the `rg` audit only reports terminal/editor/diff-related code-surface selectors that the guardrail intentionally allows.

- [ ] **Step 4: Run the full typography verification set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/styles/tokens-touch.test.ts \
  src/styles/base.theme.test.ts \
  src/styles/components.theme.test.ts \
  src/styles/typography.guard.test.ts
```

Run:

```bash
pnpm --filter @coder-studio/web exec biome check \
  src/styles/tokens.css \
  src/styles/base.css \
  src/styles/components.css \
  src/styles/tokens-touch.test.ts \
  src/styles/base.theme.test.ts \
  src/styles/components.theme.test.ts \
  src/styles/typography.guard.test.ts \
  src/components/ui/button/index.module.css \
  src/components/ui/input/index.module.css \
  src/components/ui/textarea/index.module.css \
  src/components/ui/tabs/index.module.css \
  src/components/ui/tag/index.module.css \
  src/components/ui/badge/index.module.css \
  src/components/ui/pill/index.module.css \
  src/components/ui/tooltip/index.module.css \
  src/components/ui/notice/index.module.css \
  src/components/ui/modal/index.module.css \
  src/components/ui/empty-state/index.module.css
```

Run the raw-font audit one last time:

```bash
rg -n "font-size:\\s*(?:[0-9]+px|var\\(--text-|clamp\\()" \
  packages/web/src/styles/base.css \
  packages/web/src/styles/components.css \
  packages/web/src/components/ui \
  -g '*.css' \
  -g '*.module.css'
```

Expected:

- all four Vitest files PASS
- `biome check` reports no issues
- the final `rg` audit only prints exempt terminal/editor/diff code-surface selectors, or prints nothing if all raw/legacy sizes are gone

- [ ] **Step 5: Commit the guardrail and final cleanup**

```bash
git add \
  packages/web/src/styles/base.css \
  packages/web/src/styles/components.css \
  packages/web/src/styles/tokens.css \
  packages/web/src/styles/tokens-touch.test.ts \
  packages/web/src/styles/base.theme.test.ts \
  packages/web/src/styles/components.theme.test.ts \
  packages/web/src/styles/typography.guard.test.ts \
  packages/web/src/components/ui/button/index.module.css \
  packages/web/src/components/ui/input/index.module.css \
  packages/web/src/components/ui/textarea/index.module.css \
  packages/web/src/components/ui/tabs/index.module.css \
  packages/web/src/components/ui/tag/index.module.css \
  packages/web/src/components/ui/badge/index.module.css \
  packages/web/src/components/ui/pill/index.module.css \
  packages/web/src/components/ui/tooltip/index.module.css \
  packages/web/src/components/ui/notice/index.module.css \
  packages/web/src/components/ui/modal/index.module.css \
  packages/web/src/components/ui/empty-state/index.module.css
git commit -m "feat(web): enforce semantic ui typography"
```

## Self-Review

- Spec coverage: token architecture, desktop/mobile typography scale, base-element rebinding, shared primitive migration, chrome/page migration, raw-font guardrail, and final verification all map to concrete tasks above.
- Placeholder scan: no `TODO`, `TBD`, “implement later”, or “add tests for the above” placeholders remain.
- Type consistency: all tasks use the same token names:
  - `--font-size-100` through `--font-size-700`
  - `--type-kicker-*`
  - `--type-label-*`
  - `--type-meta-*`
  - `--type-body-*`
  - `--type-body-strong-*`
  - `--type-code-inline-*`
  - `--type-app-title-*`
  - `--type-section-title-*`
  - `--type-page-title-*`
  - `--type-display-*`
