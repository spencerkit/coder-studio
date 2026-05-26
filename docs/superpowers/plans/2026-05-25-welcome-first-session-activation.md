# Welcome First-Session Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the welcome page tell new users exactly what to do first so they open a workspace and understand that the next step is starting Claude Code or Codex inside it.

**Architecture:** Keep the existing welcome-page shell, modal launch behavior, and settings navigation intact. Implement the change as a narrow welcome-page copy and structure update: add three action hints around the existing buttons, rewrite the localized hero and feature-card copy, then add lightweight CSS rules so the new instructional text reads clearly on desktop and mobile.

**Tech Stack:** React 19, React Router, Jotai-powered locale switching, JSON locale files, shared CSS in `packages/web/src/styles/components.css`, Vitest, and Testing Library.

**Spec reference:** `docs/superpowers/specs/2026-05-25-welcome-first-session-activation-design.md`

---

## File Structure

**Modify:**
- `packages/web/src/features/welcome/index.tsx` — add instructional hint copy around the existing primary and secondary actions
- `packages/web/src/features/welcome/index.test.tsx` — cover the new English and Chinese activation copy and the new hint nodes
- `packages/web/src/locales/en.json` — replace welcome hero / feature copy and add the three new hint keys
- `packages/web/src/locales/zh.json` — mirror the English copy model with concise Chinese guidance
- `packages/web/src/styles/components.css` — add lightweight classes for the new hint rows and mobile width overrides
- `packages/web/src/styles/components.theme.test.ts` — verify the new welcome hint selectors stay within the existing flat-shell design language

**Testing commands used in this plan:**
- `pnpm --filter @coder-studio/web exec vitest run src/features/welcome/index.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts`
- `pnpm --filter @coder-studio/web exec vitest run src/features/welcome/index.test.tsx src/styles/components.theme.test.ts`

---

### Task 1: Update Welcome Copy And Hint Rendering

**Files:**
- Modify: `packages/web/src/features/welcome/index.test.tsx`
- Modify: `packages/web/src/features/welcome/index.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Write the failing welcome-page tests**

In `packages/web/src/features/welcome/index.test.tsx`, replace the existing English copy test with the following block and insert the Chinese test immediately after it:

```tsx
  it("renders task-oriented English activation copy and action hints", () => {
    const store = createStore();
    store.set(localeAtom, "en");

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WelcomePage />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByText("LOCAL AI CODING WORKSPACE")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Open a workspace. Start an AI coding session.",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Choose a local project folder to get started. Inside the workspace, you can launch Claude Code or Codex in the same place where you edit files, inspect Git changes, and watch terminal output."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Step 1: Open your project folder")).toBeInTheDocument();
    expect(
      screen.getByText("Step 2 happens inside the workspace: start Claude or Codex.")
    ).toBeInTheDocument();
    expect(screen.getByText("Need to configure providers first?")).toBeInTheDocument();
    expect(screen.getByText("Start Claude or Codex sessions")).toBeInTheDocument();
    expect(screen.getByText("Review code and Git side by side")).toBeInTheDocument();
    expect(screen.getByText("Run commands in the same workspace")).toBeInTheDocument();
    expect(document.querySelector(".welcome-card__hero")).toBeTruthy();
    expect(document.querySelector(".welcome-card__actions")).toBeTruthy();
    expect(document.querySelector(".welcome-card__features")).toBeTruthy();
    expect(document.querySelector(".welcome-actions-group")).toBeTruthy();

    const openWorkspaceButton = screen.getByRole("button", { name: "Open Workspace" });
    const settingsButton = screen.getByRole("button", { name: "Settings" });
    const featureCards = Array.from(document.querySelectorAll(".welcome-feature"));

    expect(featureCards).toHaveLength(3);
    expect(
      openWorkspaceButton.querySelector('[data-icon-semantic="nav.newWorkspace"]')
    ).toBeTruthy();
    expect(settingsButton.querySelector('[data-icon-semantic="nav.settings"]')).toBeTruthy();
  });

  it("renders translated Chinese activation copy and action hints when locale is set to zh", () => {
    const store = createStore();
    store.set(localeAtom, "zh");

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WelcomePage />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByText("本地 AI 编码工作台")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "先打开工作区，再启动 AI 编码会话" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "先选择一个本地项目目录。进入工作区后，你就可以在同一个界面里启动 Claude Code 或 Codex，同时查看文件、Git 变更和终端输出。"
      )
    ).toBeInTheDocument();
    expect(screen.getByText("第 1 步：打开你的项目目录")).toBeInTheDocument();
    expect(
      screen.getByText("第 2 步会在工作区里完成：启动 Claude 或 Codex。")
    ).toBeInTheDocument();
    expect(
      screen.getByText("如果你需要先配置 Provider，可以先去设置。")
    ).toBeInTheDocument();
    expect(screen.getByText("启动 Claude 或 Codex 会话")).toBeInTheDocument();
    expect(screen.getByText("并排查看代码和 Git 变更")).toBeInTheDocument();
    expect(screen.getByText("在同一工作区运行命令")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the welcome-page test to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/welcome/index.test.tsx
```

Expected:
- FAIL because the current locale files still contain the old welcome copy
- FAIL because the current component does not render `welcome.primary_hint`, `welcome.secondary_hint`, or `welcome.settings_hint`

- [ ] **Step 3: Implement the minimal welcome-page and locale changes**

In `packages/web/src/features/welcome/index.tsx`, replace the current `.welcome-card__actions` block with:

```tsx
          <div className="welcome-card__actions">
            <div className="welcome-actions-group">
              <p className="welcome-step-hint meta-text">{t("welcome.primary_hint")}</p>

              <button className="welcome-btn" onClick={handleOpenWorkspace}>
                <ThemedIcon semantic="nav.newWorkspace" size={18} />
                <span>{t("action.open_workspace")}</span>
              </button>

              <p className="welcome-step-detail meta-text">{t("welcome.secondary_hint")}</p>
              <p className="welcome-settings-hint meta-text">{t("welcome.settings_hint")}</p>

              <button className="welcome-link" onClick={handleOpenSettings}>
                <ThemedIcon semantic="nav.settings" size={14} />
                <span>{t("action.settings")}</span>
              </button>
            </div>
          </div>
```

In `packages/web/src/locales/en.json`, replace the entire `welcome` object with:

```json
  "welcome": {
    "kicker": "LOCAL AI CODING WORKSPACE",
    "title": "Open a workspace. Start an AI coding session.",
    "description": "Choose a local project folder to get started. Inside the workspace, you can launch Claude Code or Codex in the same place where you edit files, inspect Git changes, and watch terminal output.",
    "primary_hint": "Step 1: Open your project folder",
    "secondary_hint": "Step 2 happens inside the workspace: start Claude or Codex.",
    "settings_hint": "Need to configure providers first?",
    "features": {
      "agent_first": {
        "title": "Start Claude or Codex sessions",
        "description": "Open a workspace first, then launch an AI session for that project."
      },
      "git_tools": {
        "title": "Review code and Git side by side",
        "description": "Inspect files and changes next to the agent instead of switching between tools."
      },
      "terminals": {
        "title": "Run commands in the same workspace",
        "description": "Use integrated terminals alongside your AI session when you need manual control."
      }
    }
  },
```

In `packages/web/src/locales/zh.json`, replace the entire `welcome` object with:

```json
  "welcome": {
    "kicker": "本地 AI 编码工作台",
    "title": "先打开工作区，再启动 AI 编码会话",
    "description": "先选择一个本地项目目录。进入工作区后，你就可以在同一个界面里启动 Claude Code 或 Codex，同时查看文件、Git 变更和终端输出。",
    "primary_hint": "第 1 步：打开你的项目目录",
    "secondary_hint": "第 2 步会在工作区里完成：启动 Claude 或 Codex。",
    "settings_hint": "如果你需要先配置 Provider，可以先去设置。",
    "features": {
      "agent_first": {
        "title": "启动 Claude 或 Codex 会话",
        "description": "先打开工作区，再为当前项目启动一个 AI 会话。"
      },
      "git_tools": {
        "title": "并排查看代码和 Git 变更",
        "description": "在 Agent 旁边直接查看文件和改动，不用在多个工具之间来回切换。"
      },
      "terminals": {
        "title": "在同一工作区运行命令",
        "description": "需要手动操作时，可以直接在集成终端里配合 AI 会话执行命令。"
      }
    }
  },
```

- [ ] **Step 4: Run the welcome-page test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/welcome/index.test.tsx
```

Expected:
- PASS for the updated English copy assertions
- PASS for the new Chinese copy assertions
- PASS for the existing modal-open, settings-navigation, and mobile-shell assertions

- [ ] **Step 5: Commit the rendering and locale changes**

Run:

```bash
git add \
  packages/web/src/features/welcome/index.tsx \
  packages/web/src/features/welcome/index.test.tsx \
  packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json
git commit -m "feat(web): clarify welcome first-session activation copy"
```

---

### Task 2: Add Lightweight Welcome Hint Styling

**Files:**
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write the failing style test**

In `packages/web/src/styles/components.theme.test.ts`, insert the following test immediately after `it("keeps auth and welcome shells on flat page surfaces", () => { ... })`:

```ts
  it("styles welcome activation hints as supporting copy around the primary action", () => {
    const actionsGroup = getLastRuleBlock(".welcome-actions-group");
    const stepHint = getLastRuleBlock(".welcome-step-hint");
    const stepDetail = getLastRuleBlock(".welcome-step-detail");
    const settingsHint = getLastRuleBlock(".welcome-settings-hint");
    const mobileStepDetail = getLastRuleBlock(".welcome-card--mobile .welcome-step-detail");

    expect(actionsGroup).toContain("align-items: flex-start");
    expect(stepHint).toContain("width: 100%");
    expect(stepHint).toContain("text-transform: uppercase");
    expect(stepHint).toContain("color: var(--text-ter)");
    expect(stepDetail).toContain("max-width: 440px");
    expect(stepDetail).toContain("color: var(--text-secondary)");
    expect(settingsHint).toContain("padding-top: var(--sp-2)");
    expect(settingsHint).toContain("color: var(--text-ter)");
    expect(mobileStepDetail).toContain("max-width: none");
  });
```

- [ ] **Step 2: Run the style test to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:
- FAIL because `.welcome-step-hint`, `.welcome-step-detail`, and `.welcome-settings-hint` do not exist yet
- FAIL because `.welcome-actions-group` still uses `align-items: center`

- [ ] **Step 3: Implement the minimal CSS**

In `packages/web/src/styles/components.css`, replace the existing `.welcome-actions-group` rule and add the new welcome hint rules directly below it:

```css
.welcome-actions-group {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  flex-wrap: wrap;
}

.welcome-step-hint,
.welcome-step-detail,
.welcome-settings-hint {
  width: 100%;
  margin: 0;
}

.welcome-step-hint {
  font-size: var(--type-body-6-size);
  line-height: var(--type-body-6-line-height);
  font-weight: var(--type-body-6-weight);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-ter);
}

.welcome-step-detail {
  max-width: 440px;
  font-size: var(--type-body-5-size);
  line-height: var(--type-body-5-line-height);
  font-weight: var(--type-body-5-weight);
  color: var(--text-secondary);
}

.welcome-settings-hint {
  padding-top: var(--sp-2);
  font-size: var(--type-body-6-size);
  line-height: var(--type-body-6-line-height);
  font-weight: var(--type-body-6-weight);
  color: var(--text-ter);
}
```

In the existing mobile welcome section of `packages/web/src/styles/components.css`, add this block immediately after `.welcome-card--mobile .welcome-body`:

```css
  .welcome-card--mobile .welcome-step-detail,
  .welcome-card--mobile .welcome-settings-hint {
    max-width: none;
  }
```

- [ ] **Step 4: Run the focused verification suite**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/welcome/index.test.tsx \
  src/styles/components.theme.test.ts
```

Expected:
- PASS for the welcome-page rendering tests
- PASS for the new CSS rule assertions
- PASS for the existing flat-shell assertions in `components.theme.test.ts`

- [ ] **Step 5: Commit the CSS changes**

Run:

```bash
git add \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts
git commit -m "style(web): support welcome activation hints"
```
