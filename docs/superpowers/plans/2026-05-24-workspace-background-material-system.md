# Workspace Background Material System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ad hoc workspace background handling with a single workspace-scoped material token system so shells, content layers, xterm, and Monaco follow one consistent transparency and blur policy.

**Architecture:** Keep the existing theme foundation tokens and appearance runtime inputs, then introduce a new `--ws-*` workspace material layer in `tokens.css`. Migrate workspace CSS to consume semantic `--ws-*` tokens, make layout and content layers transparent, and adapt xterm and Monaco so renderer-backed content stops acting like a separate background system.

**Tech Stack:** React 19, Jotai, Monaco Editor, xterm.js, CSS custom properties, Vitest, Testing Library, and the shared stylesheet/token system in `packages/web/src/styles`.

---

**Spec reference:** `docs/superpowers/specs/2026-05-24-workspace-background-material-system-design.md`

**Git hygiene:** The current worktree contains unrelated modified app files and many untracked docs files. Stage only the files listed in each task, and never revert unrelated edits.

## File Structure

**Modified files:**
- `packages/web/src/styles/tokens.css` — define the workspace material token layer and the solid/glass/high-contrast resolution rules.
- `packages/web/src/styles/components.css` — migrate workspace shells to semantic `--ws-*` tokens and normalize layout/content layers to transparent.
- `packages/web/src/styles/components.theme.test.ts` — replace local material-formula assertions with workspace token assertions and add guardrails for transparent content layers.
- `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx` — remove xterm’s glass-only background branching and make workspace terminal backgrounds follow the shared content-layer policy.
- `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx` — update xterm theme expectations to assert shared transparent content behavior across workspace modes.
- `packages/web/src/theme/registry.ts` — make Monaco workspace themes use transparent editor backgrounds while keeping syntax, selection, and cursor colors intact.
- `packages/web/src/theme/registry.test.ts` — update Monaco theme assertions to lock transparent workspace editor backgrounds.
- `packages/web/src/features/code-editor/components/monaco-host.test.tsx` — add focused checks that defined Monaco themes carry the transparent editor background.

**No structural file splits in this phase:**
- `xterm-host.tsx` and `components.css` are already large, but the implementation should stay localized instead of restructuring them during this migration.

**Testing commands used in this plan:**
- `pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts`
- `pnpm --filter @coder-studio/web exec vitest run src/features/terminal-panel/__tests__/xterm-host.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/theme/registry.test.ts src/features/code-editor/components/monaco-host.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts src/features/terminal-panel/__tests__/xterm-host.test.tsx src/theme/registry.test.ts src/features/code-editor/components/monaco-host.test.tsx`

---

### Task 1: Define Workspace Material Tokens

**Files:**
- Modify: `packages/web/src/styles/tokens.css:108-116`
- Modify: `packages/web/src/styles/tokens.css:296-304`
- Modify: `packages/web/src/styles/tokens-touch.test.ts:140-170`

- [ ] **Step 1: Write the failing token test coverage**

Add this test to `packages/web/src/styles/tokens-touch.test.ts` near the existing surface token assertions:

```ts
  it("defines workspace material tokens for solid and glass workspace surfaces", () => {
    expect(root).toContain("--ws-backdrop-filter: none");
    expect(root).toContain("--ws-content-bg: transparent");
    expect(root).toContain("--ws-sidebar-bg: var(--surface-panel-bg)");
    expect(root).toContain("--ws-terminal-shell-bg: var(--surface-panel-bg)");
    expect(root).toContain("--ws-editor-toolbar-bg: var(--surface-elevated-bg)");
    expect(root).toContain("--ws-level-0: transparent");
    expect(root).toContain("--ws-level-1: color-mix(");
    expect(root).toContain("--ws-level-4: color-mix(");
  });
```

- [ ] **Step 2: Run the token test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/tokens-touch.test.ts
```

Expected:
- FAIL because `--ws-*` tokens are not defined in `tokens.css`

- [ ] **Step 3: Add the workspace material token layer**

In `packages/web/src/styles/tokens.css`, add a new `Workspace Material System` section immediately after the existing foundation surface tokens:

```css
  --ws-backdrop-filter: none;
  --ws-content-bg: transparent;

  --ws-level-0: transparent;
  --ws-level-1: color-mix(
    in srgb,
    var(--surface-overlay-bg) calc(var(--app-surface-opacity, 0.96) * 40%),
    transparent
  );
  --ws-level-2: color-mix(
    in srgb,
    var(--surface-overlay-bg) calc(var(--app-surface-opacity, 0.96) * 56%),
    transparent
  );
  --ws-level-3: color-mix(
    in srgb,
    var(--surface-overlay-bg) calc(var(--app-surface-opacity, 0.96) * 72%),
    transparent
  );
  --ws-level-4: color-mix(
    in srgb,
    var(--surface-overlay-bg) calc(var(--app-surface-opacity, 0.96) * 88%),
    transparent
  );

  --ws-sidebar-bg: var(--surface-panel-bg);
  --ws-activitybar-bg: var(--surface-panel-bg);
  --ws-statusbar-bg: var(--surface-panel-bg);
  --ws-session-bg: var(--surface-panel-bg);
  --ws-session-active-bg: var(--surface-elevated-bg);
  --ws-session-header-bg: var(--surface-elevated-bg);
  --ws-terminal-shell-bg: var(--surface-panel-bg);
  --ws-terminal-toolbar-bg: var(--surface-elevated-bg);
  --ws-terminal-tabs-bg: var(--surface-elevated-bg);
  --ws-editor-shell-bg: var(--surface-panel-bg);
  --ws-editor-toolbar-bg: var(--surface-elevated-bg);
```

Then, near the theme/runtime state section that already reacts to `data-appearance-glass`, add the glass-state overrides:

```css
:root[data-appearance-glass="on"] {
  --ws-backdrop-filter: var(--app-surface-backdrop-filter, none);
  --ws-sidebar-bg: var(--ws-level-3);
  --ws-activitybar-bg: var(--ws-level-2);
  --ws-statusbar-bg: var(--ws-level-3);
  --ws-session-bg: var(--ws-level-2);
  --ws-session-active-bg: var(--ws-level-3);
  --ws-session-header-bg: var(--ws-level-3);
  --ws-terminal-shell-bg: var(--ws-level-3);
  --ws-terminal-toolbar-bg: var(--ws-level-2);
  --ws-terminal-tabs-bg: var(--ws-level-2);
  --ws-editor-shell-bg: var(--ws-level-2);
  --ws-editor-toolbar-bg: var(--ws-level-3);
}

:root[data-theme="hc-dark"],
:root[data-theme="hc-light"] {
  --ws-backdrop-filter: none;
  --ws-sidebar-bg: var(--surface-panel-bg);
  --ws-activitybar-bg: var(--surface-panel-bg);
  --ws-statusbar-bg: var(--surface-panel-bg);
  --ws-session-bg: var(--surface-panel-bg);
  --ws-session-active-bg: var(--surface-elevated-bg);
  --ws-session-header-bg: var(--surface-elevated-bg);
  --ws-terminal-shell-bg: var(--surface-panel-bg);
  --ws-terminal-toolbar-bg: var(--surface-elevated-bg);
  --ws-terminal-tabs-bg: var(--surface-elevated-bg);
  --ws-editor-shell-bg: var(--surface-panel-bg);
  --ws-editor-toolbar-bg: var(--surface-elevated-bg);
}
```

- [ ] **Step 4: Run the token test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/tokens-touch.test.ts
```

Expected:
- PASS with the new `--ws-*` token assertions succeeding

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/styles/tokens.css packages/web/src/styles/tokens-touch.test.ts
git commit -m "feat: add workspace material tokens"
```

### Task 2: Migrate Workspace Shells And Containers To Semantic Tokens

**Files:**
- Modify: `packages/web/src/styles/components.css:14133-14422`
- Modify: `packages/web/src/styles/components.theme.test.ts:1158-1276`

- [ ] **Step 1: Write the failing workspace material assertions**

Update `packages/web/src/styles/components.theme.test.ts` so the `routes settings and workspace shared surfaces through appearance-aware background tokens` test expects semantic workspace tokens instead of local formulas:

```ts
    expect(workspaceSidebarPanel).toContain("background: var(--ws-sidebar-bg)");
    expect(workspaceSidebarPanel).toContain("backdrop-filter: var(--ws-backdrop-filter)");
    expect(workspaceSidebarPanel).not.toContain("var(--surface-overlay-bg)");
    expect(workspaceActivityBar).toContain("background: var(--ws-activitybar-bg)");
    expect(workspaceStatusBar).toContain("background: var(--ws-statusbar-bg)");
    expect(sessionCard).toContain("background: var(--ws-session-bg)");
    expect(activeSessionCard).toContain("background: var(--ws-session-active-bg)");
    expect(activeSessionHeader).toContain("background: var(--ws-session-header-bg)");
    expect(terminalToolbar).toContain("background: var(--ws-terminal-toolbar-bg)");
    expect(bottomTerminalTabs).toContain("background: var(--ws-terminal-tabs-bg)");
    expect(bottomTerminal).toContain("background: var(--ws-terminal-shell-bg)");
```

Also add guardrails for transparent structural/content nodes:

```ts
    expect(workspaceBody).toContain("background: transparent");
    expect(workspaceMainStage).toContain("background: transparent");
    expect(agentPanes).toContain("background: transparent");
    expect(agentPane).toContain("background: transparent");
    expect(paneLayout).toContain("background: transparent");
    expect(paneLayoutChild).toContain("background: transparent");
    expect(bottomTerminalContent).toContain("background: transparent");
    expect(bottomTerminalXterm).toContain("background: transparent");
```

- [ ] **Step 2: Run the theme test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:
- FAIL because workspace shells still use raw `color-mix(...)` formulas and runtime appearance variables directly

- [ ] **Step 3: Replace workspace shell backgrounds with `--ws-*` tokens**

In `packages/web/src/styles/components.css`, edit the workspace appearance block so the shell selectors read like this:

```css
.workspace-sidebar-panel {
  background: var(--ws-sidebar-bg);
  border-right: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  backdrop-filter: var(--ws-backdrop-filter);
}

.workspace-activity-bar {
  background: var(--ws-activitybar-bg);
  border-right-color: color-mix(in srgb, var(--border) 72%, transparent);
  backdrop-filter: var(--ws-backdrop-filter);
}

.workspace-status-bar {
  background: var(--ws-statusbar-bg);
  backdrop-filter: var(--ws-backdrop-filter);
}

.session-card {
  background: var(--ws-session-bg);
  backdrop-filter: var(--ws-backdrop-filter);
}

.session-card.session-card--active {
  background: var(--ws-session-active-bg);
}

.session-header,
.session-card.session-card--active > .panel-header,
.session-card.session-card--active .session-header {
  background: var(--ws-session-header-bg);
  backdrop-filter: var(--ws-backdrop-filter);
}

.terminal-toolbar {
  background: var(--ws-terminal-toolbar-bg);
  backdrop-filter: var(--ws-backdrop-filter);
}

.bottom-terminal-tabs {
  background: var(--ws-terminal-tabs-bg);
  backdrop-filter: var(--ws-backdrop-filter);
}

.workspace-bottom-panel > .bottom-terminal {
  background: var(--ws-terminal-shell-bg);
  box-shadow: none;
  backdrop-filter: var(--ws-backdrop-filter);
}

.workspace-git-editor {
  background: var(--ws-editor-shell-bg);
  backdrop-filter: var(--ws-backdrop-filter);
}

.code-editor-header {
  background: var(--ws-editor-toolbar-bg);
  backdrop-filter: var(--ws-backdrop-filter);
}
```

Keep the transparent layout/content rules in place and remove raw workspace-local shell `color-mix(...)` formulas from this block.

- [ ] **Step 4: Run the theme test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:
- PASS with workspace shell selectors reading from semantic `--ws-*` tokens

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/styles/components.css packages/web/src/styles/components.theme.test.ts
git commit -m "feat: migrate workspace shells to material tokens"
```

### Task 3: Make xterm Follow The Shared Transparent Content Layer

**Files:**
- Modify: `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx:2703-2838`
- Modify: `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx:329-338`
- Modify: `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx:528-534`
- Modify: `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx:1376-1384`
- Modify: `packages/web/src/styles/components.css:1853-1858`

- [ ] **Step 1: Write the failing xterm behavior tests**

In `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`, replace the glass-specific test intent with shared transparent content behavior:

```tsx
  it("uses a transparent xterm background for workspace terminals", async () => {
    const { Terminal } = await import("@xterm/xterm");

    render(
      <JotaiProvider>
        <XtermHost terminalId="workspace-terminal" workspaceId="test-workspace" />
      </JotaiProvider>
    );

    expect(Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: expect.objectContaining({
          ...getThemeById("mint-dark").terminalTheme,
          background: "transparent",
        }),
      })
    );
  });

  it("keeps the live xterm background transparent after theme switches", async () => {
    const store = createStore();
    store.set(themeAtom, "mint-dark");

    render(
      <Provider store={store}>
        <XtermHost terminalId="workspace-theme-sync-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    await act(async () => {
      store.set(themeAtom, "graphite-light");
    });

    await waitFor(() => {
      expect(mockTerminal.options).toEqual(
        expect.objectContaining({
          theme: expect.objectContaining({
            ...getThemeById("graphite-light").terminalTheme,
            background: "transparent",
          }),
        })
      );
    });
  });
```

Also update `components.theme.test.ts` expectations so:

```ts
    expect(xtermScreen).toContain("background: var(--ws-content-bg)");
```

and drop the separate `[data-appearance-glass="on"]` selector assertion.

- [ ] **Step 2: Run the xterm and theme tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/terminal-panel/__tests__/xterm-host.test.tsx \
  src/styles/components.theme.test.ts
```

Expected:
- FAIL because xterm still only becomes transparent when glass is enabled
- FAIL because `.xterm-screen` still uses `var(--bg-terminal)`

- [ ] **Step 3: Remove the glass-only xterm background branch**

In `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`, simplify the helper so it always returns a transparent background:

```ts
function resolveXtermTheme(themeId: string): TerminalThemeDefinition {
  return {
    ...getThemeById(themeId).terminalTheme,
    background: "transparent",
  };
}
```

Then update its call sites:

```ts
  const resolvedTerminalTheme = resolveXtermTheme(uiTheme);
```

and

```ts
      theme: resolveXtermTheme(initialThemeRef.current),
```

Also remove any no-longer-needed `appearancePersonalization` / `resolveAppearancePersonalizationForViewport` / `glassEnabled` background gating that exists only for the terminal theme.

In `packages/web/src/styles/components.css`, replace:

```css
.xterm-host .xterm-screen {
  background: var(--bg-terminal);
}

[data-appearance-glass="on"] .xterm-host .xterm-screen {
  background: transparent;
}
```

with:

```css
.xterm-host .xterm-screen {
  background: var(--ws-content-bg);
}
```

- [ ] **Step 4: Run the xterm and theme tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/terminal-panel/__tests__/xterm-host.test.tsx \
  src/styles/components.theme.test.ts
```

Expected:
- PASS with xterm always following the transparent workspace content-layer policy

- [ ] **Step 5: Commit**

```bash
git add \
  packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx \
  packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts
git commit -m "feat: align xterm with workspace content surfaces"
```

### Task 4: Make Monaco Use Transparent Workspace Content Backgrounds

**Files:**
- Modify: `packages/web/src/theme/registry.test.ts:135-176`
- Modify: `packages/web/src/features/code-editor/components/monaco-host.test.tsx:330-350`
- Modify: `packages/web/src/theme/registry.ts:175-184`
- Modify: `packages/web/src/theme/registry.ts:255-264`
- Modify: `packages/web/src/theme/registry.ts:342-351`
- Modify: `packages/web/src/theme/registry.ts:429-438`
- Modify: `packages/web/src/theme/registry.ts:532-541`
- Modify: `packages/web/src/theme/registry.ts:635-644`

- [ ] **Step 1: Write the failing Monaco theme tests**

In `packages/web/src/theme/registry.test.ts`, update the light theme assertions so each workspace Monaco palette expects:

```ts
    expect(mintLight?.monaco.colors).toEqual(
      expect.objectContaining({
        "editor.background": "#00000000",
        "editorCursor.foreground": "#148a7a",
        "editor.selectionBackground": "#ddefe5",
      })
    );
```

Apply the same `"editor.background": "#00000000"` expectation to `graphiteLight` and `nordLight`.

Add a focused theme-definition test to `packages/web/src/features/code-editor/components/monaco-host.test.tsx` near the existing `defineTheme` assertion:

```tsx
  it("defines Monaco themes with transparent editor backgrounds for workspace shells", async () => {
    renderMonacoHost();

    expect(mockDefineTheme).toHaveBeenCalledWith(
      "coder-studio-mint-light",
      expect.objectContaining({
        colors: expect.objectContaining({
          "editor.background": "#00000000",
        }),
      })
    );
  });
```

- [ ] **Step 2: Run the Monaco/theme tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/theme/registry.test.ts \
  src/features/code-editor/components/monaco-host.test.tsx
```

Expected:
- FAIL because Monaco themes still define opaque editor backgrounds

- [ ] **Step 3: Change Monaco theme backgrounds to transparent**

In `packages/web/src/theme/registry.ts`, replace every workspace Monaco `editor.background` value with `#00000000` while keeping all other color keys unchanged:

```ts
      colors: {
        "editor.background": "#00000000",
        "editor.foreground": "#e5edf3",
        "editorLineNumber.foreground": "#4a5b6a",
        "editorCursor.foreground": "#78d7b2",
        "editor.selectionBackground": "#1e3040",
      },
```

Apply the same transparent background change to:

- `mint-dark`
- `mint-light`
- `graphite-dark`
- `graphite-light`
- `nord-dark`
- `nord-light`

Do not change the high-contrast Monaco themes in this task.

- [ ] **Step 4: Run the Monaco/theme tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/theme/registry.test.ts \
  src/features/code-editor/components/monaco-host.test.tsx
```

Expected:
- PASS with `defineTheme` and registry assertions showing transparent editor backgrounds

- [ ] **Step 5: Commit**

```bash
git add \
  packages/web/src/theme/registry.ts \
  packages/web/src/theme/registry.test.ts \
  packages/web/src/features/code-editor/components/monaco-host.test.tsx
git commit -m "feat: make workspace monaco backgrounds transparent"
```

### Task 5: Run Integrated Verification And Audit Workspace Rules

**Files:**
- Modify: `packages/web/src/styles/components.theme.test.ts:860-1276`

- [ ] **Step 1: Add a guardrail assertion against raw workspace shell formulas**

Extend `packages/web/src/styles/components.theme.test.ts` with one final assertion inside the workspace material test:

```ts
    expect(workspaceSidebarPanel).not.toContain("calc(var(--app-surface-opacity");
    expect(workspaceActivityBar).not.toContain("calc(var(--app-surface-opacity");
    expect(workspaceStatusBar).not.toContain("calc(var(--app-surface-opacity");
    expect(sessionCard).not.toContain("calc(var(--app-surface-opacity");
    expect(bottomTerminal).not.toContain("calc(var(--app-surface-opacity");
    expect(terminalToolbar).not.toContain("calc(var(--app-surface-opacity");
    expect(bottomTerminalTabs).not.toContain("calc(var(--app-surface-opacity");
```

- [ ] **Step 2: Run the full focused verification suite**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/styles/components.theme.test.ts \
  src/features/terminal-panel/__tests__/xterm-host.test.tsx \
  src/theme/registry.test.ts \
  src/features/code-editor/components/monaco-host.test.tsx
```

Expected:
- PASS for all four suites

- [ ] **Step 3: Review the final diff for scope control**

Run:

```bash
git diff -- packages/web/src/styles/tokens.css \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts \
  packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx \
  packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx \
  packages/web/src/theme/registry.ts \
  packages/web/src/theme/registry.test.ts \
  packages/web/src/features/code-editor/components/monaco-host.test.tsx
```

Expected:
- only the planned workspace material, xterm, Monaco, and test files changed

- [ ] **Step 4: Commit**

```bash
git add \
  packages/web/src/styles/components.theme.test.ts \
  packages/web/src/styles/tokens.css \
  packages/web/src/styles/components.css \
  packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx \
  packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx \
  packages/web/src/theme/registry.ts \
  packages/web/src/theme/registry.test.ts \
  packages/web/src/features/code-editor/components/monaco-host.test.tsx
git commit -m "test: lock workspace material system behavior"
```

## Self-Review

### Spec coverage

- Workspace-only scope is covered by Tasks 1-5.
- Transparent layout chain is covered by Task 2.
- Shared shell tokenization is covered by Tasks 1 and 2.
- Transparent content layers are covered by Tasks 2 and 3.
- xterm renderer parity is covered by Task 3.
- Monaco renderer parity is covered by Task 4.
- Guardrail testing against future ad hoc formulas is covered by Task 5.

### Placeholder scan

- No `TBD`, `TODO`, or “implement later” placeholders remain.
- Every task lists exact files, exact tests, and concrete commands.
- Each code-changing step includes concrete code to introduce or update.

### Type consistency

- The plan consistently uses `--ws-*` token names from the approved spec.
- The xterm helper remains `resolveXtermTheme(...)` rather than introducing a second naming variant.
- Monaco theme expectations use the exact `editor.background` key already present in `registry.ts`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-24-workspace-background-material-system.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
