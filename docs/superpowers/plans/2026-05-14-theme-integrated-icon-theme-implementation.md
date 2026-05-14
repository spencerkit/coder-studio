# Theme-Integrated Icon Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a theme-owned `iconTheme` layer plus a shared `ThemedIcon` renderer so a single `themeId` can control main application icon glyphs, tones, and light surface treatments across file tree, git, navigation, and feedback surfaces.

**Architecture:** Extend the existing web theme registry with icon-theme metadata instead of adding a second settings model. Feature code will resolve business meaning into stable icon semantics, a shared theme icon resolver will map those semantics to concrete glyph and style presentation, and a thin `ThemedIcon` primitive will render the final icon while CSS tokens continue to own final colors.

**Tech Stack:** React 19, TypeScript 6, Jotai, Lucide React, Vite, Vitest + Testing Library, CSS custom properties, existing theme registry and UI preview infrastructure.

**Spec reference:** `docs/superpowers/specs/2026-05-14-theme-integrated-icon-theme-design.md`

---

## File Structure

**New files:**
- `packages/web/src/theme/icon-theme.ts`
- `packages/web/src/theme/icon-theme.test.ts`
- `packages/web/src/components/ui/themed-icon/index.tsx`
- `packages/web/src/components/ui/themed-icon/index.module.css`
- `packages/web/src/components/ui/themed-icon/index.test.tsx`
- `packages/web/src/features/workspace/views/shared/file-tree-icon-semantics.ts`
- `packages/web/src/features/workspace/views/shared/file-tree-icon-semantics.test.ts`

**Modified files:**
- `packages/web/src/theme/index.ts`
- `packages/web/src/theme/registry.ts`
- `packages/web/src/theme/registry.test.ts`
- `packages/web/src/styles/base.css`
- `packages/web/src/styles/base.theme.test.ts`
- `packages/web/src/styles/components.css`
- `packages/web/src/styles/components.theme.test.ts`
- `packages/web/src/components/ui/index.ts`
- `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
- `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`
- `packages/web/src/features/workspace/views/shared/git-panel.tsx`
- `packages/web/src/features/workspace/views/shared/git-panel.test.tsx`
- `packages/web/src/features/workspace/views/shared/git-status-bar.tsx`
- `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx`
- `packages/web/src/features/topbar/index.tsx`
- `packages/web/src/features/topbar/index.test.tsx`
- `packages/web/src/features/workspace/views/mobile/mobile-dock.tsx`
- `packages/web/src/features/settings/components/settings-page.tsx`
- `packages/web/src/features/settings/components/settings-page.test.tsx`
- `packages/web/src/features/welcome/index.tsx`
- `packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx`
- `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx`
- `packages/web/src/features/settings/components/config-editor.tsx`
- `packages/web/src/features/settings/components/config-editor.test.tsx`
- `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`
- `packages/web/src/features/supervisor/views/shared/objective-dialog-content.test.tsx`
- `packages/web/src/components/ui/toast/index.tsx`
- `packages/web/src/components/ui/toast/index.test.tsx`
- `packages/web/src/ui-preview/scenes/showcase-scenes.tsx`

**Likely no changes in this plan:**
- `packages/web/src/atoms/app-ui.ts`
- `packages/web/src/app/providers.tsx`
- `packages/web/src/features/code-editor/*`
- `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
- server settings, storage, or database schema

## Task 1: Establish Theme-Owned Icon Types and Resolver

**Files:**
- Create: `packages/web/src/theme/icon-theme.ts`
- Create: `packages/web/src/theme/icon-theme.test.ts`
- Modify: `packages/web/src/theme/index.ts`
- Modify: `packages/web/src/theme/registry.ts`
- Modify: `packages/web/src/theme/registry.test.ts`

- [ ] **Step 1: Write failing resolver and registry tests**

Add tests in `packages/web/src/theme/icon-theme.test.ts` for:

```ts
import { describe, expect, it } from "vitest";
import { getIconPresentation, ICON_SEMANTICS } from "./index";

describe("theme icon resolver", () => {
  it("resolves the base semantic set for every built-in theme", () => {
    for (const themeId of [
      "mint-dark",
      "mint-light",
      "graphite-dark",
      "graphite-light",
      "nord-dark",
      "nord-light",
      "hc-dark",
      "hc-light",
    ]) {
      for (const semantic of ICON_SEMANTICS) {
        expect(getIconPresentation(themeId, semantic)).toEqual(
          expect.objectContaining({
            semantic,
            tone: expect.any(String),
            surface: expect.any(String),
            Icon: expect.any(Function),
          })
        );
      }
    }
  });

  it("allows themes to vary icon presentation for the same semantic", () => {
    const mintFolder = getIconPresentation("mint-dark", "file.folder.closed");
    const hcFolder = getIconPresentation("hc-dark", "file.folder.closed");

    expect(hcFolder).toEqual(
      expect.objectContaining({
        tone: expect.any(String),
        surface: expect.any(String),
      })
    );
    expect(mintFolder.Icon).not.toBeUndefined();
    expect(hcFolder.Icon).not.toBeUndefined();
  });
});
```

Extend `packages/web/src/theme/registry.test.ts` with assertions like:

```ts
for (const theme of THEMES) {
  expect(theme.iconTheme).toEqual(
    expect.objectContaining({
      icons: expect.any(Object),
    })
  );
}
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/theme/icon-theme.test.ts \
  src/theme/registry.test.ts
```

Expected: failures because `icon-theme.ts`, icon semantic exports, and `theme.iconTheme` do not exist yet.

- [ ] **Step 3: Implement shared icon theme types and base semantic inventory**

Create `packages/web/src/theme/icon-theme.ts` and define:

```ts
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Bot,
  File,
  FileCode2,
  FileJson2,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Image as ImageIcon,
  Info,
  PanelBottom,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Terminal,
  TerminalSquare,
  TriangleAlert,
  Zap,
} from "lucide-react";

export const ICON_SEMANTICS = [
  "file.folder.closed",
  "file.folder.open",
  "file.type.code",
  "file.type.data",
  "file.type.doc",
  "file.type.media",
  "file.type.default",
  "file.action.new",
  "file.action.newFolder",
  "file.action.search",
  "git.status.staged",
  "git.status.modified",
  "git.status.deleted",
  "git.status.untracked",
  "git.action.diff",
  "git.action.pull",
  "git.action.push",
  "git.action.refresh",
  "git.action.warning",
  "nav.settings",
  "nav.search",
  "nav.newWorkspace",
  "nav.panelFiles",
  "nav.panelTerminal",
  "nav.agent",
  "state.success",
  "state.warning",
  "state.error",
  "state.info",
  "state.emptyTerminal",
  "state.emptyConfig",
  "state.welcome.terminal",
  "state.welcome.workspace",
  "state.welcome.git",
  "state.welcome.lightning",
] as const;

export type IconSemantic = (typeof ICON_SEMANTICS)[number];

export type IconTone =
  | "current"
  | "primary"
  | "secondary"
  | "muted"
  | "accent"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "file-folder"
  | "file-code"
  | "file-data"
  | "file-doc"
  | "file-media"
  | "file-default"
  | "git-staged"
  | "git-modified"
  | "git-deleted"
  | "git-untracked";

export type IconSurface =
  | "none"
  | "subtle"
  | "accent"
  | "success"
  | "warning"
  | "error"
  | "info";

export interface IconPresentationDefinition {
  glyph: LucideIcon;
  tone: IconTone;
  surface?: IconSurface;
  strokeWidth?: number;
}

export interface IconThemeDefinition {
  icons: Record<IconSemantic, IconPresentationDefinition>;
}

export interface ResolvedIconPresentation {
  semantic: IconSemantic;
  Icon: LucideIcon;
  tone: IconTone;
  surface: IconSurface;
  strokeWidth?: number;
}

export const BASE_ICON_THEME: IconThemeDefinition = {
  icons: {
    "file.folder.closed": { glyph: Folder, tone: "file-folder" },
    "file.folder.open": { glyph: FolderOpen, tone: "file-folder" },
    "file.type.code": { glyph: FileCode2, tone: "file-code" },
    "file.type.data": { glyph: FileJson2, tone: "file-data" },
    "file.type.doc": { glyph: FileText, tone: "file-doc" },
    "file.type.media": { glyph: ImageIcon, tone: "file-media" },
    "file.type.default": { glyph: File, tone: "file-default" },
    "file.action.new": { glyph: FilePlus, tone: "secondary" },
    "file.action.newFolder": { glyph: FolderPlus, tone: "secondary" },
    "file.action.search": { glyph: Search, tone: "secondary" },
    "git.status.staged": { glyph: Plus, tone: "git-staged" },
    "git.status.modified": { glyph: GitBranch, tone: "git-modified" },
    "git.status.deleted": { glyph: TriangleAlert, tone: "git-deleted" },
    "git.status.untracked": { glyph: Plus, tone: "git-untracked" },
    "git.action.diff": { glyph: GitBranch, tone: "secondary" },
    "git.action.pull": { glyph: GitBranch, tone: "secondary" },
    "git.action.push": { glyph: GitBranch, tone: "secondary" },
    "git.action.refresh": { glyph: GitBranch, tone: "secondary" },
    "git.action.warning": { glyph: AlertTriangle, tone: "warning" },
    "nav.settings": { glyph: Settings, tone: "secondary" },
    "nav.search": { glyph: Search, tone: "secondary" },
    "nav.newWorkspace": { glyph: Plus, tone: "secondary" },
    "nav.panelFiles": { glyph: PanelLeft, tone: "current" },
    "nav.panelTerminal": { glyph: PanelBottom, tone: "current" },
    "nav.agent": { glyph: Bot, tone: "current" },
    "state.success": { glyph: Info, tone: "success", surface: "success" },
    "state.warning": { glyph: AlertTriangle, tone: "warning", surface: "warning" },
    "state.error": { glyph: AlertTriangle, tone: "error", surface: "error" },
    "state.info": { glyph: Info, tone: "info", surface: "info" },
    "state.emptyTerminal": { glyph: Terminal, tone: "muted", surface: "subtle" },
    "state.emptyConfig": { glyph: AlertTriangle, tone: "muted", surface: "subtle" },
    "state.welcome.terminal": { glyph: Terminal, tone: "accent", surface: "accent" },
    "state.welcome.workspace": { glyph: Plus, tone: "accent", surface: "accent" },
    "state.welcome.git": { glyph: GitBranch, tone: "accent", surface: "accent" },
    "state.welcome.lightning": { glyph: Zap, tone: "accent", surface: "accent" },
  },
};
```

- [ ] **Step 4: Add theme-aware resolver helpers and registry integration**

Extend `packages/web/src/theme/registry.ts` and `packages/web/src/theme/index.ts` with:

```ts
import { BASE_ICON_THEME, type IconSemantic, type IconThemeDefinition } from "./icon-theme";

export interface AppThemeDefinition {
  id: string;
  family: ThemeFamily;
  kind: ThemeKind;
  labelKey: string;
  pairedThemeId: string;
  isHighContrast: boolean;
  documentThemeAttr: string;
  terminalTheme: TerminalThemeDefinition;
  monaco: MonacoThemeDefinition;
  iconTheme: IconThemeDefinition;
}
```

Add resolver logic in `icon-theme.ts`:

```ts
import { getThemeById } from "./resolve";

export function getIconPresentation(
  themeId: string,
  semantic: IconSemantic
): ResolvedIconPresentation {
  const theme = getThemeById(themeId);
  const themed = theme.iconTheme.icons[semantic];
  const fallback = BASE_ICON_THEME.icons[semantic];
  const presentation = themed ?? fallback;

  return {
    semantic,
    Icon: presentation.glyph,
    tone: presentation.tone,
    surface: presentation.surface ?? "none",
    strokeWidth: presentation.strokeWidth,
  };
}
```

For first-phase built-in themes, start with:

```ts
iconTheme: BASE_ICON_THEME
```

and add only bounded overrides where needed, for example:

```ts
iconTheme: {
  icons: {
    ...BASE_ICON_THEME.icons,
    "file.folder.closed": { glyph: Folder, tone: "file-folder", strokeWidth: 1.8 },
    "file.folder.open": { glyph: FolderOpen, tone: "file-folder", strokeWidth: 1.8 },
  },
}
```

- [ ] **Step 5: Re-run the theme icon tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/theme/icon-theme.test.ts \
  src/theme/registry.test.ts \
  src/theme/resolve.test.ts
```

Expected: all theme icon registry and resolver tests pass.

- [ ] **Step 6: Commit**

```bash
git add \
  packages/web/src/theme/icon-theme.ts \
  packages/web/src/theme/icon-theme.test.ts \
  packages/web/src/theme/index.ts \
  packages/web/src/theme/registry.ts \
  packages/web/src/theme/registry.test.ts
git commit -m "feat(web): add theme-owned icon presentation registry"
```

## Task 2: Introduce the Shared `ThemedIcon` Primitive and Style Contract

**Files:**
- Create: `packages/web/src/components/ui/themed-icon/index.tsx`
- Create: `packages/web/src/components/ui/themed-icon/index.module.css`
- Create: `packages/web/src/components/ui/themed-icon/index.test.tsx`
- Modify: `packages/web/src/components/ui/index.ts`
- Modify: `packages/web/src/styles/base.css`
- Modify: `packages/web/src/styles/base.theme.test.ts`

- [ ] **Step 1: Write failing `ThemedIcon` component tests**

Create `packages/web/src/components/ui/themed-icon/index.test.tsx` with assertions like:

```tsx
import { render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { describe, expect, it } from "vitest";
import { themeAtom } from "../../../atoms/app-ui";
import { ThemedIcon } from ".";

describe("ThemedIcon", () => {
  it("renders the resolved icon with stable tone and surface classes", () => {
    const store = createStore();
    store.set(themeAtom, "mint-dark");

    render(
      <Provider store={store}>
        <ThemedIcon semantic="state.warning" size={16} />
      </Provider>
    );

    const icon = screen.getByTestId("themed-icon");
    expect(icon).toHaveAttribute("data-icon-semantic", "state.warning");
    expect(icon.className).toMatch(/themed-icon--tone-warning/);
    expect(icon.className).toMatch(/themed-icon--surface-warning/);
  });

  it("omits announcement for decorative icons", () => {
    const store = createStore();
    store.set(themeAtom, "mint-dark");

    render(
      <Provider store={store}>
        <ThemedIcon semantic="nav.settings" />
      </Provider>
    );

    expect(screen.getByTestId("themed-icon")).toHaveAttribute("aria-hidden", "true");
  });
});
```

- [ ] **Step 2: Run the `ThemedIcon` tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/themed-icon/index.test.tsx
```

Expected: failure because the component and styles do not exist yet.

- [ ] **Step 3: Implement the `ThemedIcon` renderer**

Create `packages/web/src/components/ui/themed-icon/index.tsx`:

```tsx
import clsx from "clsx";
import { useAtomValue } from "jotai";
import type { HTMLAttributes } from "react";
import { themeAtom } from "../../../atoms/app-ui";
import { getIconPresentation, type IconSemantic } from "../../../theme";
import styles from "./index.module.css";

export interface ThemedIconProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  readonly semantic: IconSemantic;
  readonly size?: number;
  readonly decorative?: boolean;
}

export function ThemedIcon({
  semantic,
  size = 14,
  decorative = true,
  className,
  ...spanProps
}: ThemedIconProps) {
  const themeId = useAtomValue(themeAtom);
  const presentation = getIconPresentation(themeId, semantic);
  const Icon = presentation.Icon;

  return (
    <span
      {...spanProps}
      aria-hidden={decorative ? "true" : undefined}
      className={clsx(
        styles.root,
        `themed-icon themed-icon--tone-${presentation.tone} themed-icon--surface-${presentation.surface}`,
        className
      )}
      data-icon-semantic={semantic}
      data-testid="themed-icon"
    >
      <Icon size={size} strokeWidth={presentation.strokeWidth} />
    </span>
  );
}
```

- [ ] **Step 4: Define the local module style and global tone/surface utilities**

Create `packages/web/src/components/ui/themed-icon/index.module.css`:

```css
.root {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
  color: inherit;
}
```

Extend `packages/web/src/styles/base.css` with shared utilities:

```css
.themed-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
}

.themed-icon--tone-current {
  color: currentColor;
}

.themed-icon--tone-primary {
  color: var(--icon-primary);
}

.themed-icon--tone-secondary {
  color: var(--icon-secondary);
}

.themed-icon--tone-muted {
  color: var(--icon-muted);
}

.themed-icon--tone-accent {
  color: var(--icon-accent);
}

.themed-icon--tone-success {
  color: var(--icon-success);
}

.themed-icon--tone-warning {
  color: var(--icon-warning);
}

.themed-icon--tone-error {
  color: var(--icon-error);
}

.themed-icon--tone-info {
  color: var(--icon-info);
}

.themed-icon--tone-file-folder {
  color: var(--icon-file-folder);
}

.themed-icon--tone-file-code {
  color: var(--icon-file-code);
}

.themed-icon--tone-file-data {
  color: var(--icon-file-data);
}

.themed-icon--tone-file-doc {
  color: var(--icon-file-doc);
}

.themed-icon--tone-file-media {
  color: var(--icon-file-media);
}

.themed-icon--tone-file-default {
  color: var(--icon-file-default);
}

.themed-icon--tone-git-staged {
  color: var(--icon-git-staged);
}

.themed-icon--tone-git-modified {
  color: var(--icon-git-modified);
}

.themed-icon--tone-git-deleted {
  color: var(--icon-git-deleted);
}

.themed-icon--tone-git-untracked {
  color: var(--icon-git-untracked);
}

.themed-icon--surface-none {
  background: transparent;
}

.themed-icon--surface-subtle {
  background: var(--icon-surface-subtle);
}

.themed-icon--surface-accent {
  background: var(--icon-surface-accent);
}

.themed-icon--surface-success {
  background: var(--icon-surface-success);
}

.themed-icon--surface-warning {
  background: var(--icon-surface-warning);
}

.themed-icon--surface-error {
  background: var(--icon-surface-error);
}

.themed-icon--surface-info {
  background: var(--icon-surface-info);
}

.icon-chip,
.themed-icon--surface-subtle,
.themed-icon--surface-accent,
.themed-icon--surface-success,
.themed-icon--surface-warning,
.themed-icon--surface-error,
.themed-icon--surface-info {
  border-radius: var(--radius-md);
}
```

- [ ] **Step 5: Export the primitive and verify style tests**

Update `packages/web/src/components/ui/index.ts`:

```ts
export type { ThemedIconProps } from "./themed-icon";
export { ThemedIcon } from "./themed-icon";
```

Extend `packages/web/src/styles/base.theme.test.ts` with:

```ts
const themedTone = getRuleBlock(".themed-icon--tone-warning");
const themedSurface = getRuleBlock(".themed-icon--surface-info");

expect(themedTone).toContain("var(--icon-warning)");
expect(themedSurface).toContain("var(--icon-surface-info)");
```

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/themed-icon/index.test.tsx \
  src/styles/base.theme.test.ts
```

Expected: `ThemedIcon` renders correctly and the shared style contract is covered by CSS tests.

- [ ] **Step 6: Commit**

```bash
git add \
  packages/web/src/components/ui/themed-icon/index.tsx \
  packages/web/src/components/ui/themed-icon/index.module.css \
  packages/web/src/components/ui/themed-icon/index.test.tsx \
  packages/web/src/components/ui/index.ts \
  packages/web/src/styles/base.css \
  packages/web/src/styles/base.theme.test.ts
git commit -m "feat(web): add shared themed icon primitive"
```

## Task 3: Migrate File Tree Semantics to `ThemedIcon`

**Files:**
- Create: `packages/web/src/features/workspace/views/shared/file-tree-icon-semantics.ts`
- Create: `packages/web/src/features/workspace/views/shared/file-tree-icon-semantics.test.ts`
- Modify: `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write failing file-tree semantic tests**

Create `packages/web/src/features/workspace/views/shared/file-tree-icon-semantics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getFileNodeSemantic } from "./file-tree-icon-semantics";

describe("getFileNodeSemantic", () => {
  it("maps folder states", () => {
    expect(getFileNodeSemantic({ name: "src", path: "src", kind: "dir" }, false)).toBe(
      "file.folder.closed"
    );
    expect(getFileNodeSemantic({ name: "src", path: "src", kind: "dir" }, true)).toBe(
      "file.folder.open"
    );
  });

  it("maps representative file extensions", () => {
    expect(getFileNodeSemantic({ name: "app.tsx", path: "app.tsx", kind: "file" }, false)).toBe(
      "file.type.code"
    );
    expect(getFileNodeSemantic({ name: "theme.json", path: "theme.json", kind: "file" }, false)).toBe(
      "file.type.data"
    );
    expect(getFileNodeSemantic({ name: "README.md", path: "README.md", kind: "file" }, false)).toBe(
      "file.type.doc"
    );
  });
});
```

Extend `file-tree-panel.test.tsx` with:

```tsx
expect(container.querySelector('[data-icon-semantic="file.folder.closed"]')).toBeTruthy();
expect(container.querySelector('[data-icon-semantic="file.type.code"]')).toBeTruthy();
```

- [ ] **Step 2: Run the file-tree tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/shared/file-tree-icon-semantics.test.ts \
  src/features/workspace/views/shared/file-tree-panel.test.tsx
```

Expected: failure because the helper and semantic-based DOM output do not exist.

- [ ] **Step 3: Implement file-tree semantic mapping**

Create `packages/web/src/features/workspace/views/shared/file-tree-icon-semantics.ts`:

```ts
import type { FileNode } from "@coder-studio/core";
import type { IconSemantic } from "../../../../theme";

export function getFileNodeSemantic(node: FileNode, isExpanded: boolean): IconSemantic {
  if (node.kind === "dir") {
    return isExpanded ? "file.folder.open" : "file.folder.closed";
  }

  const ext = node.name.split(".").pop()?.toLowerCase();

  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
    case "py":
    case "go":
    case "rs":
    case "java":
      return "file.type.code";
    case "json":
    case "yaml":
    case "yml":
    case "toml":
    case "lock":
      return "file.type.data";
    case "md":
    case "txt":
      return "file.type.doc";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
      return "file.type.media";
    default:
      return "file.type.default";
  }
}
```

- [ ] **Step 4: Replace direct Lucide imports in file-tree rendering**

Update `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`:

- remove `getNodeIcon()` and `getNodeToneClass()`
- import `ThemedIcon`
- import `getFileNodeSemantic`
- replace icon output with:

```tsx
<span className="tree-icon" aria-hidden="true">
  <ThemedIcon semantic={getFileNodeSemantic(node, isExpanded)} size={14} />
</span>
```

Replace search and create-action icons with:

```tsx
<ThemedIcon semantic="file.action.search" size={14} />
<ThemedIcon semantic="file.action.new" size={12} />
<ThemedIcon semantic="file.action.newFolder" size={12} />
```

Keep chevrons unchanged in this phase.

- [ ] **Step 5: Simplify file-tree CSS and verify token routing**

Update `packages/web/src/styles/components.css` by removing the old per-class tone rules:

```css
.tree-icon.folder { color: var(--icon-file-folder); }
.tree-icon.code { color: var(--icon-file-code); }
.tree-icon.data { color: var(--icon-file-data); }
.tree-icon.doc { color: var(--icon-file-doc); }
.tree-icon.media { color: var(--icon-file-media); }
.tree-icon.file { color: var(--icon-file-default); }
```

and make `.tree-icon` a neutral container:

```css
.tree-icon {
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
```

Update `components.theme.test.ts` so file-tree assertions target the shared themed classes:

```ts
expect(getLastRuleBlockFrom(baseStylesheet, ".themed-icon--tone-file-folder")).toContain(
  "var(--icon-file-folder)"
);
```

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/shared/file-tree-icon-semantics.test.ts \
  src/features/workspace/views/shared/file-tree-panel.test.tsx \
  src/styles/components.theme.test.ts \
  src/styles/base.theme.test.ts
```

Expected: file-tree semantics, rendering, and token routing pass through `ThemedIcon`.

- [ ] **Step 6: Commit**

```bash
git add \
  packages/web/src/features/workspace/views/shared/file-tree-icon-semantics.ts \
  packages/web/src/features/workspace/views/shared/file-tree-icon-semantics.test.ts \
  packages/web/src/features/workspace/views/shared/file-tree-panel.tsx \
  packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx \
  packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts
git commit -m "feat(web): migrate file tree icons to themed semantics"
```

## Task 4: Migrate Git and Worktree Status Surfaces

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/git-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/git-panel.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/git-status-bar.tsx`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write failing git icon assertions**

Extend `packages/web/src/features/workspace/views/shared/git-panel.test.tsx` with checks like:

```tsx
expect(container.querySelector('[data-icon-semantic="git.status.staged"]')).toBeTruthy();
expect(container.querySelector('[data-icon-semantic="git.status.modified"]')).toBeTruthy();
expect(container.querySelector('[data-icon-semantic="git.status.deleted"]')).toBeTruthy();
expect(container.querySelector('[data-icon-semantic="git.status.untracked"]')).toBeTruthy();
```

Add a git status bar assertion that warning states render:

```tsx
expect(container.querySelector('[data-icon-semantic="git.action.warning"]')).toBeTruthy();
```

- [ ] **Step 2: Run the git tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/shared/git-panel.test.tsx
```

Expected: failure because git surfaces still render raw Lucide imports and legacy icon class hooks.

- [ ] **Step 3: Replace git status and action icons with semantic rendering**

Update `packages/web/src/features/workspace/views/shared/git-panel.tsx`:

- keep close and generic plus/minus control icons outside scope where they are low-semantic controls
- replace status row marker output with `ThemedIcon` semantics:

```tsx
<span className="git-row-icon" aria-hidden="true">
  <ThemedIcon semantic="git.status.staged" size={13} />
</span>
```

Map each status bucket:

- staged -> `git.status.staged`
- modified -> `git.status.modified`
- deleted -> `git.status.deleted`
- untracked -> `git.status.untracked`

Update `packages/web/src/features/workspace/views/shared/git-status-bar.tsx` for:

- diff -> `git.action.diff`
- pull -> `git.action.pull`
- push -> `git.action.push`
- refresh -> `git.action.refresh`
- warning -> `git.action.warning`

- [ ] **Step 4: Remove direct git icon color classes from `components.css`**

Replace:

```css
.git-row-icon-staged { color: var(--icon-git-staged); }
.git-row-icon-modified { color: var(--icon-git-modified); }
.git-row-icon-deleted { color: var(--icon-git-deleted); }
.git-row-icon-untracked { color: var(--icon-git-untracked); }
```

with a neutral container:

```css
.git-row-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
```

Update `components.theme.test.ts` so git token coverage checks the shared `.themed-icon--tone-git-*` classes instead of per-surface color rules.

- [ ] **Step 5: Run git surface verification**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/shared/git-panel.test.tsx \
  src/styles/components.theme.test.ts
```

Expected: git and worktree status surfaces use semantic themed icons and shared token routing.

- [ ] **Step 6: Commit**

```bash
git add \
  packages/web/src/features/workspace/views/shared/git-panel.tsx \
  packages/web/src/features/workspace/views/shared/git-panel.test.tsx \
  packages/web/src/features/workspace/views/shared/git-status-bar.tsx \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts
git commit -m "feat(web): route git surfaces through themed icon semantics"
```

## Task 5: Migrate Navigation Entry Icons

**Files:**
- Modify: `packages/web/src/features/topbar/index.tsx`
- Modify: `packages/web/src/features/topbar/index.test.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-dock.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`

- [ ] **Step 1: Write failing navigation icon tests**

Add assertions in `topbar/index.test.tsx` and `settings-page.test.tsx` such as:

```tsx
expect(container.querySelector('[data-icon-semantic="nav.newWorkspace"]')).toBeTruthy();
expect(container.querySelector('[data-icon-semantic="nav.search"]')).toBeTruthy();
expect(container.querySelector('[data-icon-semantic="nav.settings"]')).toBeTruthy();
```

For mobile dock:

```tsx
expect(container.querySelector('[data-icon-semantic="nav.agent"]')).toBeTruthy();
expect(container.querySelector('[data-icon-semantic="nav.panelFiles"]')).toBeTruthy();
expect(container.querySelector('[data-icon-semantic="nav.panelTerminal"]')).toBeTruthy();
```

- [ ] **Step 2: Run the navigation tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/topbar/index.test.tsx \
  src/features/settings/components/settings-page.test.tsx
```

Expected: failure because those entry points still render direct Lucide icons.

- [ ] **Step 3: Replace topbar, mobile dock, and settings navigation icons**

Update `packages/web/src/features/topbar/index.tsx`:

```tsx
icon={<ThemedIcon semantic="nav.newWorkspace" size={14} />}
```

```tsx
<ThemedIcon semantic="nav.search" size={14} />
```

```tsx
icon={<ThemedIcon semantic="nav.panelTerminal" size={14} />}
icon={<ThemedIcon semantic="nav.panelFiles" size={14} />}
icon={<ThemedIcon semantic="nav.settings" size={14} />}
```

Update `packages/web/src/features/workspace/views/mobile/mobile-dock.tsx`:

```tsx
<ThemedIcon semantic="nav.agent" size={18} />
<ThemedIcon semantic="nav.panelFiles" size={18} />
<ThemedIcon semantic="nav.panelTerminal" size={18} />
```

Update `packages/web/src/features/settings/components/settings-page.tsx` only for stable navigation-entry icons such as `.settings-nav-icon` and `.settings-mobile-item__icon`. Do not migrate generic disclosure chevrons in this phase.

- [ ] **Step 4: Verify navigation icon intent still uses `currentColor` where designed**

Keep `mobile-dock__icon` on `currentColor` by ensuring:

- the `nav.*` semantics used in the mobile dock resolve to `tone: "current"`
- active/inactive dock item colors continue to come from the parent button

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/topbar/index.test.tsx \
  src/features/settings/components/settings-page.test.tsx \
  src/styles/components.theme.test.ts
```

Expected: navigation entry icons render through `ThemedIcon` while the mobile dock still follows parent-color intent.

- [ ] **Step 5: Commit**

```bash
git add \
  packages/web/src/features/topbar/index.tsx \
  packages/web/src/features/topbar/index.test.tsx \
  packages/web/src/features/workspace/views/mobile/mobile-dock.tsx \
  packages/web/src/features/settings/components/settings-page.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx
git commit -m "feat(web): migrate navigation entry icons to themed semantics"
```

## Task 6: Migrate Feedback, Empty-State, and Warning Surfaces

**Files:**
- Modify: `packages/web/src/features/welcome/index.tsx`
- Modify: `packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx`
- Modify: `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx`
- Modify: `packages/web/src/features/settings/components/config-editor.tsx`
- Modify: `packages/web/src/features/settings/components/config-editor.test.tsx`
- Modify: `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`
- Modify: `packages/web/src/features/supervisor/views/shared/objective-dialog-content.test.tsx`
- Modify: `packages/web/src/components/ui/toast/index.tsx`
- Modify: `packages/web/src/components/ui/toast/index.test.tsx`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write failing feedback-surface tests**

Add assertions like:

```tsx
expect(container.querySelector('[data-icon-semantic="state.welcome.lightning"]')).toBeTruthy();
expect(container.querySelector('[data-icon-semantic="state.emptyTerminal"]')).toBeTruthy();
expect(container.querySelector('[data-icon-semantic="state.emptyConfig"]')).toBeTruthy();
expect(container.querySelector('[data-icon-semantic="state.warning"]')).toBeTruthy();
```

For toast:

```tsx
expect(screen.getByTestId("themed-icon")).toHaveAttribute("data-icon-semantic", "state.success");
```

- [ ] **Step 2: Run the feedback tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/toast/index.test.tsx \
  src/features/settings/components/config-editor.test.tsx \
  src/features/supervisor/views/shared/objective-dialog-content.test.tsx \
  src/features/terminal-panel/__tests__/terminal-panel.test.tsx
```

Expected: failure because those surfaces still depend on direct icon imports and class-specific coloring.

- [ ] **Step 3: Replace empty-state and warning glyph imports with semantic themed icons**

Update:

- `packages/web/src/features/welcome/index.tsx`
- `packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx`
- `packages/web/src/features/settings/components/config-editor.tsx`
- `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`

Examples:

```tsx
<ThemedIcon semantic="state.welcome.lightning" size={18} />
<ThemedIcon semantic="state.welcome.git" size={18} />
<ThemedIcon semantic="state.welcome.terminal" size={18} />
```

```tsx
icon={<ThemedIcon semantic="state.emptyTerminal" size={32} />}
```

```tsx
icon={<ThemedIcon semantic="state.emptyConfig" size={16} />}
```

```tsx
<ThemedIcon semantic="state.warning" size={16} className="supervisor-danger-callout-icon" />
```

- [ ] **Step 4: Add semantic-aware toast defaults without breaking custom icon override**

Update `packages/web/src/components/ui/toast/index.tsx` so:

- `icon` prop remains supported
- if `icon` is omitted, the component resolves from `tone`
- default tone mapping is:

```ts
const toastSemanticByTone = {
  success: "state.success",
  error: "state.error",
  warning: "state.warning",
  info: "state.info",
} as const;
```

Use:

```tsx
const resolvedIcon = icon ?? <ThemedIcon semantic={toastSemanticByTone[tone]} size={16} />;
```

- [ ] **Step 5: Remove scattered feedback icon color rules and verify shared token routing**

In `packages/web/src/styles/components.css`, keep layout classes such as `.welcome-feature-icon`, `.config-empty-icon`, `.supervisor-danger-callout-icon`, and `.toast__icon`, but remove color ownership where the themed icon now supplies it.

Keep only structural or container concerns, for example:

```css
.welcome-feature-icon,
.toast__icon,
.config-empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
```

Update `components.theme.test.ts` so the tone and surface checks assert against:

- `.themed-icon--tone-accent`
- `.themed-icon--tone-muted`
- `.themed-icon--tone-warning`
- `.themed-icon--tone-success`
- `.themed-icon--surface-accent`
- `.themed-icon--surface-subtle`
- `.themed-icon--surface-warning`
- `.themed-icon--surface-success`

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/toast/index.test.tsx \
  src/features/settings/components/config-editor.test.tsx \
  src/features/supervisor/views/shared/objective-dialog-content.test.tsx \
  src/features/terminal-panel/__tests__/terminal-panel.test.tsx \
  src/styles/components.theme.test.ts \
  src/styles/base.theme.test.ts
```

Expected: feedback, empty-state, and warning surfaces now route through shared semantic icon presentation.

- [ ] **Step 6: Commit**

```bash
git add \
  packages/web/src/features/welcome/index.tsx \
  packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx \
  packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx \
  packages/web/src/features/settings/components/config-editor.tsx \
  packages/web/src/features/settings/components/config-editor.test.tsx \
  packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx \
  packages/web/src/features/supervisor/views/shared/objective-dialog-content.test.tsx \
  packages/web/src/components/ui/toast/index.tsx \
  packages/web/src/components/ui/toast/index.test.tsx \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts
git commit -m "feat(web): migrate feedback icons to themed presentation"
```

## Task 7: Refresh UI Preview Coverage and Final Verification

**Files:**
- Modify: `packages/web/src/ui-preview/scenes/showcase-scenes.tsx`
- Modify: `packages/web/src/styles/base.theme.test.ts`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Update showcase scenes to render semantic icon coverage**

In `packages/web/src/ui-preview/scenes/showcase-scenes.tsx`, replace the direct icon examples in the workspace icon review scene with `ThemedIcon` calls, for example:

```tsx
<ThemedIcon semantic="file.folder.closed" size={14} />
<ThemedIcon semantic="file.type.code" size={14} />
<ThemedIcon semantic="file.type.data" size={14} />
<ThemedIcon semantic="git.status.staged" size={14} />
<ThemedIcon semantic="state.warning" size={16} />
```

This scene should continue to exercise file-tree, git, toast, empty-state, and mobile dock visual output in one place.

- [ ] **Step 2: Run the focused preview and CSS verification**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/styles/base.theme.test.ts \
  src/styles/components.theme.test.ts
```

Expected: shared themed-icon utilities and migrated surface coverage both pass.

- [ ] **Step 3: Run the combined targeted test suite**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/theme/icon-theme.test.ts \
  src/theme/registry.test.ts \
  src/theme/resolve.test.ts \
  src/components/ui/themed-icon/index.test.tsx \
  src/features/workspace/views/shared/file-tree-icon-semantics.test.ts \
  src/features/workspace/views/shared/file-tree-panel.test.tsx \
  src/features/workspace/views/shared/git-panel.test.tsx \
  src/features/topbar/index.test.tsx \
  src/features/settings/components/settings-page.test.tsx \
  src/components/ui/toast/index.test.tsx \
  src/features/settings/components/config-editor.test.tsx \
  src/features/supervisor/views/shared/objective-dialog-content.test.tsx \
  src/features/terminal-panel/__tests__/terminal-panel.test.tsx \
  src/styles/base.theme.test.ts \
  src/styles/components.theme.test.ts
```

Expected: the full first-phase icon-theme slice passes without touching unrelated foundation controls.

- [ ] **Step 4: Inspect scoped diff and final status**

Run:

```bash
git diff -- \
  packages/web/src/theme \
  packages/web/src/components/ui/themed-icon \
  packages/web/src/features/workspace/views/shared/file-tree-panel.tsx \
  packages/web/src/features/workspace/views/shared/git-panel.tsx \
  packages/web/src/features/workspace/views/shared/git-status-bar.tsx \
  packages/web/src/features/topbar/index.tsx \
  packages/web/src/features/workspace/views/mobile/mobile-dock.tsx \
  packages/web/src/features/settings/components/settings-page.tsx \
  packages/web/src/features/welcome/index.tsx \
  packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx \
  packages/web/src/features/settings/components/config-editor.tsx \
  packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx \
  packages/web/src/components/ui/toast/index.tsx \
  packages/web/src/styles/base.css \
  packages/web/src/styles/components.css \
  packages/web/src/ui-preview/scenes/showcase-scenes.tsx
```

and:

```bash
git status --short
```

Expected: only the planned icon-theme files and any already-existing unrelated untracked files appear; no accidental edits to server or editor/terminal runtime code.

- [ ] **Step 5: Commit**

```bash
git add \
  packages/web/src/ui-preview/scenes/showcase-scenes.tsx \
  packages/web/src/styles/base.theme.test.ts \
  packages/web/src/styles/components.theme.test.ts
git commit -m "test(web): finalize icon theme preview and verification coverage"
```
