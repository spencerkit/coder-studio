# Terminal Settings Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all terminal-related settings into a dedicated `Terminal` section, remove the legacy `/settings` route, and update every affected entry point to the canonical `/more/settings/...` routes.

**Architecture:** Keep `MoreFeaturesPage` as the only public settings router, add `terminal` to the shared settings-section registry, and extract terminal-only UI into its own settings section component so `General` and `Appearance` can shed terminal responsibilities cleanly. Reuse the existing settings persistence APIs and terminal-profile data flow rather than introducing new commands.

**Tech Stack:** TypeScript, React 19, Jotai, React Router, Vitest, existing settings and more-route infrastructure in `packages/web`.

---

## File Map

- Create: `packages/web/src/features/settings/components/terminal-settings-section.tsx` — dedicated terminal settings UI section with renderer, copy-on-select, profiles, and font-size controls.
- Modify: `packages/web/src/features/settings/components/settings-sections.tsx` — add `terminal` to the visible settings registry and section order.
- Modify: `packages/web/src/features/settings/components/settings-page.tsx` — render the terminal section, remove terminal UI from general/appearance, and update mobile grouping.
- Modify: `packages/web/src/features/more/routes.ts` — add `/more/settings/terminal` metadata.
- Modify: `packages/web/src/features/more/page.tsx` — allow embedded terminal settings rendering.
- Modify: `packages/web/src/shells/desktop-shell.tsx` — remove `/settings` route and legacy auth-bypass path handling.
- Modify: `packages/web/src/shells/mobile-shell/index.tsx` — remove `/settings` route and legacy auth-bypass path handling.
- Modify: `packages/web/src/theme/icon-theme.ts` — add `nav.settings.terminal`.
- Modify: `packages/web/src/features/terminal-panel/views/shared/terminal-profile-create-button.tsx` — point terminal profile config link at `/more/settings/terminal#terminal-profiles`.
- Modify: `packages/web/src/features/workspace/views/shared/footer-update-rail.tsx` — point update details at `/more/about/update-status`.
- Modify: `packages/web/src/features/command-palette/components/command-palette.tsx` — open `/more/settings/general`.
- Modify: `packages/web/src/ui-preview/scenes/page-scenes.tsx` — replace old settings preview routes.
- Modify: `packages/web/src/ui-preview/scenes/showcase-scenes.tsx` — replace old settings preview routes.
- Modify: `packages/web/src/ui-preview/scenes/desktop-review-scenes.tsx` — replace old settings preview routes.
- Modify: `packages/web/src/locales/en.json` — add terminal section labels/hints and clearer terminal-profile copy.
- Modify: `packages/web/src/locales/zh.json` — add matching Chinese strings and clearer terminal-profile copy.
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx` — cover section order and terminal-control relocation.
- Modify: `packages/web/src/features/more/page.test.tsx` — cover `/more/settings/terminal`.
- Modify: `packages/web/src/shells/desktop-shell.test.tsx` — assert auth bypass works for `/more/settings/...` instead of `/settings`.
- Modify: `packages/web/src/shells/mobile-shell/index.test.tsx` — assert auth bypass works for `/more/settings/...` instead of `/settings`.
- Modify: `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx` — assert canonical terminal profile settings link.
- Modify: `packages/web/src/features/workspace/views/shared/footer-update-rail.test.tsx` — assert canonical about route.
- Modify: `packages/web/src/features/command-palette/components/command-palette.test.tsx` — assert command-palette settings navigation uses `/more/settings/general`.
- Modify: `packages/web/src/theme/icon-theme.test.ts` — assert the new `nav.settings.terminal` semantic resolves.
- Modify: `packages/web/src/ui-preview/catalog.test.tsx` — update preview-route expectations if they still hardcode `/settings`.

## Task 1: Add `Terminal` To the Shared Settings Route And Section Maps

**Files:**
- Modify: `packages/web/src/features/settings/components/settings-sections.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/more/routes.ts`
- Modify: `packages/web/src/features/more/page.tsx`
- Modify: `packages/web/src/shells/desktop-shell.tsx`
- Modify: `packages/web/src/shells/mobile-shell/index.tsx`
- Modify: `packages/web/src/theme/icon-theme.ts`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/features/more/page.test.tsx`
- Modify: `packages/web/src/shells/desktop-shell.test.tsx`
- Modify: `packages/web/src/shells/mobile-shell/index.test.tsx`
- Modify: `packages/web/src/theme/icon-theme.test.ts`

- [ ] **Step 1: Write the failing route/section tests first**

```ts
// packages/web/src/features/settings/components/settings-page.test.tsx
it("renders terminal between agents and appearance in the visible settings navigation", async () => {
  const store = createConnectedStore(vi.fn().mockResolvedValue({}));

  renderSettingsPage(store);

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "终端" })).toBeInTheDocument();
  });

  const labels = Array.from(document.querySelectorAll(".settings-nav-item")).map((item) =>
    item.textContent?.trim()
  );

  expect(labels).toEqual(["通用", "Agents", "终端", "外观", "快捷键"]);
});
```

```ts
// packages/web/src/features/more/page.test.tsx
it("parses the terminal settings route", () => {
  expect(parseMoreRoute("/more/settings/terminal")).toEqual({
    isValid: true,
    category: "settings",
    section: "terminal",
  });
});
```

```ts
// packages/web/src/shells/desktop-shell.test.tsx
it("renders MoreFeaturesPage on /more/settings/terminal while auth status is still unknown", async () => {
  window.history.replaceState({}, "", "/more/settings/terminal");

  const store = createStore();
  store.set(connectionStatusAtom, "connected");
  store.set(authEnabledAtom, null);
  store.set(authenticatedAtom, false);

  renderShell(store);

  expect(await screen.findByTestId("more-features-page")).toBeInTheDocument();
  expect(screen.queryByText("Page not found")).toBeNull();
});
```

```ts
// packages/web/src/theme/icon-theme.test.ts
expect(getIconPresentation(themeId, "nav.settings.terminal")).toEqual({
  semantic: "nav.settings.terminal",
  Icon: Terminal,
  tone: "secondary",
  surface: "none",
});
```

- [ ] **Step 2: Run the focused tests and verify they fail for the missing section/route**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx src/features/more/page.test.tsx src/shells/desktop-shell.test.tsx src/shells/mobile-shell/index.test.tsx src/theme/icon-theme.test.ts`

Expected: FAIL with at least one missing `终端`/`Terminal` navigation assertion, `parseMoreRoute("/more/settings/terminal")` mismatch, or missing `nav.settings.terminal` semantic.

- [ ] **Step 3: Add the new section and remove the legacy `/settings` shell route**

```ts
// packages/web/src/features/settings/components/settings-sections.tsx
export type SettingsSection =
  | "general"
  | "providers"
  | "terminal"
  | "appearance"
  | "shortcuts"
  | "monitoring"
  | "analysis"
  | "diagnostics"
  | "about";

const VISIBLE_SETTINGS_SECTIONS = [
  { id: "general", labelKey: "settings.general", iconSemantic: "nav.settings.general" },
  { id: "providers", labelKey: "settings.providers", iconSemantic: "nav.settings.providers" },
  { id: "terminal", labelKey: "settings.terminal.title", iconSemantic: "nav.settings.terminal" },
  { id: "appearance", labelKey: "settings.appearance", iconSemantic: "nav.settings.appearance" },
  { id: "shortcuts", labelKey: "settings.shortcuts.title", iconSemantic: "nav.settings.shortcuts" },
] as const satisfies readonly SettingsSectionMeta[];
```

```ts
// packages/web/src/features/more/routes.ts
sections: [
  {
    id: "general",
    labelKey: "settings.general",
    hintKey: "more.section.settings.general_hint",
    iconSemantic: "nav.settings.general",
  },
  {
    id: "providers",
    labelKey: "more.section.settings.agents",
    hintKey: "more.section.settings.agents_hint",
    iconSemantic: "nav.settings.providers",
  },
  {
    id: "terminal",
    labelKey: "settings.terminal.title",
    hintKey: "more.section.settings.terminal_hint",
    iconSemantic: "nav.settings.terminal",
  },
  {
    id: "appearance",
    labelKey: "settings.appearance",
    hintKey: "more.section.settings.appearance_hint",
    iconSemantic: "nav.settings.appearance",
  },
]
```

```ts
// packages/web/src/shells/desktop-shell.tsx
const shouldBypassAuthLoading =
  location.pathname.startsWith("/analytics") ||
  location.pathname.startsWith("/monitoring") ||
  location.pathname.startsWith("/diagnostics") ||
  location.pathname.startsWith("/more") ||
  location.pathname === "/session-gate";

<Routes>
  <Route path="/more/*" element={<MoreFeaturesPage />} />
  <Route path="/workspace" element={...} />
  <Route path="*" element={<NotFoundPage />} />
</Routes>
```

```ts
// packages/web/src/theme/icon-theme.ts
"nav.settings.terminal",

"nav.settings.terminal": { glyph: Terminal, tone: "secondary" },
```

- [ ] **Step 4: Re-run the focused tests and verify they pass**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx src/features/more/page.test.tsx src/shells/desktop-shell.test.tsx src/shells/mobile-shell/index.test.tsx src/theme/icon-theme.test.ts`

Expected: PASS with `0 failed`.

- [ ] **Step 5: Commit the route/section scaffold**

```bash
git add \
  packages/web/src/features/settings/components/settings-sections.tsx \
  packages/web/src/features/settings/components/settings-page.tsx \
  packages/web/src/features/more/routes.ts \
  packages/web/src/features/more/page.tsx \
  packages/web/src/shells/desktop-shell.tsx \
  packages/web/src/shells/mobile-shell/index.tsx \
  packages/web/src/theme/icon-theme.ts \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  packages/web/src/features/more/page.test.tsx \
  packages/web/src/shells/desktop-shell.test.tsx \
  packages/web/src/shells/mobile-shell/index.test.tsx \
  packages/web/src/theme/icon-theme.test.ts
git commit -m "feat: add dedicated terminal settings route"
```

## Task 2: Move Terminal Controls Into a Dedicated `TerminalSettingsSection`

**Files:**
- Create: `packages/web/src/features/settings/components/terminal-settings-section.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/terminal-profile-settings.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`

- [ ] **Step 1: Write the failing terminal-relocation tests first**

```ts
// packages/web/src/features/settings/components/settings-page.test.tsx
it("renders terminal controls under the terminal section instead of general", async () => {
  const store = createConnectedStore(vi.fn().mockResolvedValue({}));

  renderSettingsPage(store);

  fireEvent.click(screen.getByRole("button", { name: "终端" }));

  expect(await screen.findByRole("heading", { name: "终端渲染器" })).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "选中自动复制" })).toBeInTheDocument();
  expect(screen.getByRole("spinbutton", { name: "桌面端终端字号" })).toBeInTheDocument();
  expect(screen.getByRole("spinbutton", { name: "移动端终端字号" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "通用" }));
  expect(screen.queryByRole("heading", { name: "终端渲染器" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "外观" }));
  expect(screen.queryByRole("spinbutton", { name: "桌面端终端字号" })).not.toBeInTheDocument();
});
```

```ts
// packages/web/src/features/settings/components/settings-page.test.tsx
it("exposes the terminal profiles anchor from the terminal section route", async () => {
  const store = createConnectedStore(createDefaultCommandHandler());

  renderSettingsPage(store, {
    initialEntry: "/settings?section=terminal#terminal-profiles",
  });

  const terminalProfilesHeading = await screen.findByRole("heading", { name: "终端配置" });
  expect(document.getElementById("terminal-profiles")).toContainElement(terminalProfilesHeading);
});
```

- [ ] **Step 2: Run the focused settings-page tests and verify they fail before the extraction**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx`

Expected: FAIL because the `终端` section does not yet render terminal controls, or the controls still appear in `通用` / `外观`.

- [ ] **Step 3: Extract the terminal UI into a dedicated section component**

```ts
// packages/web/src/features/settings/components/settings-page.tsx
import {
  TerminalSettingsSection,
  type TerminalSettingsSectionProps,
} from "./terminal-settings-section";

const MOBILE_SETTINGS_GROUPS = [
  {
    titleKey: "settings.mobile_groups.workspace_runtime",
    sections: ["general", "providers", "terminal"],
  },
  {
    titleKey: "settings.mobile_groups.interface_interaction",
    sections: ["appearance", "shortcuts"],
  },
] as const;

const renderContent = (section: SettingsSection, currentAboutView: AboutSettingsView) => {
  switch (section) {
    case "general":
      return <GeneralSettings ... />;
    case "terminal":
      return (
        <TerminalSettingsSection
          terminalRenderer={terminalRenderer}
          setTerminalRenderer={handleTerminalRendererSelection}
          terminalCopyOnSelect={terminalPreferences.copyOnSelect}
          setTerminalCopyOnSelect={handleTerminalCopyOnSelectSelection}
          terminalProfiles={terminalProfiles}
          customTerminalProfiles={customTerminalProfiles}
          configuredTerminalDefaultProfileId={configuredTerminalDefaultProfileId}
          resolvedTerminalDefaultProfileId={resolvedTerminalDefaultProfileId}
          onTerminalProfileSettingsChange={handleTerminalProfileSettingsChange}
          desktopTerminalFontSize={getTerminalFontSizePreference(terminalPreferences, "desktop")}
          mobileTerminalFontSize={getTerminalFontSizePreference(terminalPreferences, "mobile")}
          setDesktopTerminalFontSize={handleDesktopTerminalFontSizeSelection}
          setMobileTerminalFontSize={handleMobileTerminalFontSizeSelection}
        />
      );
```

```ts
// packages/web/src/features/settings/components/terminal-settings-section.tsx
export function TerminalSettingsSection({
  terminalRenderer,
  setTerminalRenderer,
  terminalCopyOnSelect,
  setTerminalCopyOnSelect,
  terminalProfiles,
  customTerminalProfiles,
  configuredTerminalDefaultProfileId,
  resolvedTerminalDefaultProfileId,
  onTerminalProfileSettingsChange,
  desktopTerminalFontSize,
  mobileTerminalFontSize,
  setDesktopTerminalFontSize,
  setMobileTerminalFontSize,
}: TerminalSettingsSectionProps) {
  // keep the existing renderer, copy-on-select, terminal profile, and font-size UI here
}
```

```ts
// packages/web/src/features/settings/components/terminal-profile-settings.tsx
<div className="settings-config-control">
  <div style={{ width: "220px", maxWidth: "100%" }}>
    <Select ... />
  </div>
</div>
```

- [ ] **Step 4: Re-run the settings-page tests and verify they pass**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx`

Expected: PASS with the terminal controls only appearing in the `Terminal` section.

- [ ] **Step 5: Commit the terminal section extraction**

```bash
git add \
  packages/web/src/features/settings/components/terminal-settings-section.tsx \
  packages/web/src/features/settings/components/settings-page.tsx \
  packages/web/src/features/settings/components/terminal-profile-settings.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx
git commit -m "refactor: move terminal controls into terminal settings"
```

## Task 3: Update Links, Locale Copy, And Preview/Test Consumers

**Files:**
- Modify: `packages/web/src/features/terminal-panel/views/shared/terminal-profile-create-button.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/footer-update-rail.tsx`
- Modify: `packages/web/src/features/command-palette/components/command-palette.tsx`
- Modify: `packages/web/src/ui-preview/scenes/page-scenes.tsx`
- Modify: `packages/web/src/ui-preview/scenes/showcase-scenes.tsx`
- Modify: `packages/web/src/ui-preview/scenes/desktop-review-scenes.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/footer-update-rail.test.tsx`
- Modify: `packages/web/src/features/command-palette/components/command-palette.test.tsx`
- Modify: `packages/web/src/ui-preview/catalog.test.tsx`

- [ ] **Step 1: Write the failing link/copy tests first**

```ts
// packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx
expect(
  within(chooser).getByRole("link", { name: "Configure Terminal Profiles..." })
).toHaveAttribute("href", "/more/settings/terminal#terminal-profiles");
```

```ts
// packages/web/src/features/workspace/views/shared/footer-update-rail.test.tsx
fireEvent.click(screen.getByRole("button", { name: testCase.action }));
expect(navigateMock).toHaveBeenLastCalledWith("/more/about/update-status");
```

```ts
// packages/web/src/features/command-palette/components/command-palette.test.tsx
fireEvent.keyDown(palette!, { key: "Enter" });
expect(routerMocks.navigate).toHaveBeenCalledWith("/more/settings/general");
```

- [ ] **Step 2: Run the focused link tests and verify they fail before the updates**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/terminal-panel/__tests__/terminal-panel.test.tsx src/features/workspace/views/shared/footer-update-rail.test.tsx src/features/command-palette/components/command-palette.test.tsx src/ui-preview/catalog.test.tsx`

Expected: FAIL with `/settings?...` or `/settings` still showing up in one or more assertions.

- [ ] **Step 3: Update navigation helpers, preview routes, and locale copy**

```ts
// packages/web/src/features/terminal-panel/views/shared/terminal-profile-create-button.tsx
import { buildMorePath } from "../../../more/routes";

href={`${buildMorePath("settings", "terminal")}#terminal-profiles`}
```

```ts
// packages/web/src/features/workspace/views/shared/footer-update-rail.tsx
const openDetails = () => {
  navigate("/more/about/update-status");
};
```

```ts
// packages/web/src/features/command-palette/components/command-palette.tsx
{
  id: "settings",
  label: t("more.category.settings"),
  description: t("more.category.settings_hint"),
  action: () => navigate("/more/settings/general"),
}
```

```json
// packages/web/src/locales/en.json
"terminal": {
  "title": "Terminal"
},
"more": {
  "section": {
    "settings": {
      "general_hint": "Core workspace, notification, language, and runtime preferences.",
      "terminal_hint": "Renderer, copy-on-select, launch profiles, and terminal font sizes."
    }
  }
},
"terminal_profiles": {
  "hint": "Choose the default shell and manage reusable custom terminal launch presets. Detected profiles are read-only."
}
```

```json
// packages/web/src/locales/zh.json
"terminal": {
  "title": "终端"
},
"more": {
  "section": {
    "settings": {
      "general_hint": "工作区、通知、语言和运行时等基础偏好。",
      "terminal_hint": "终端渲染、选中复制、启动配置和终端字号。"
    }
  }
},
"terminal_profiles": {
  "hint": "选择默认 shell，并管理可复用的自定义终端启动配置。检测到的配置为只读。"
}
```

- [ ] **Step 4: Re-run the focused link/copy tests and verify they pass**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/terminal-panel/__tests__/terminal-panel.test.tsx src/features/workspace/views/shared/footer-update-rail.test.tsx src/features/command-palette/components/command-palette.test.tsx src/ui-preview/catalog.test.tsx`

Expected: PASS with no remaining `/settings` route expectations in these areas.

- [ ] **Step 5: Commit the navigation and copy cleanup**

```bash
git add \
  packages/web/src/features/terminal-panel/views/shared/terminal-profile-create-button.tsx \
  packages/web/src/features/workspace/views/shared/footer-update-rail.tsx \
  packages/web/src/features/command-palette/components/command-palette.tsx \
  packages/web/src/ui-preview/scenes/page-scenes.tsx \
  packages/web/src/ui-preview/scenes/showcase-scenes.tsx \
  packages/web/src/ui-preview/scenes/desktop-review-scenes.tsx \
  packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json \
  packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx \
  packages/web/src/features/workspace/views/shared/footer-update-rail.test.tsx \
  packages/web/src/features/command-palette/components/command-palette.test.tsx \
  packages/web/src/ui-preview/catalog.test.tsx
git commit -m "fix: align terminal settings links and copy"
```

## Task 4: Run Final Verification And Ship A Single Reviewable Branch State

**Files:**
- Modify: any files from Tasks 1-3 if final review finds issues

- [ ] **Step 1: Run the full targeted verification sweep**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx src/features/more/page.test.tsx src/shells/desktop-shell.test.tsx src/shells/mobile-shell/index.test.tsx src/features/terminal-panel/__tests__/terminal-panel.test.tsx src/features/workspace/views/shared/footer-update-rail.test.tsx src/features/command-palette/components/command-palette.test.tsx src/theme/icon-theme.test.ts src/ui-preview/catalog.test.tsx`

Expected: PASS with `0 failed`.

- [ ] **Step 2: Run repository-level web lint for the touched package**

Run: `pnpm --filter @coder-studio/web lint`

Expected: exit code `0`.

- [ ] **Step 3: Run the repo verification command required by the workspace instructions**

Run: `pnpm ci:verify`

Expected: exit code `0`.

- [ ] **Step 4: Commit any final fixes after review**

```bash
git add packages/web/src
git add docs/superpowers/plans/2026-06-25-terminal-settings-route-implementation.md
git commit -m "fix: split terminal settings into dedicated section"
```
