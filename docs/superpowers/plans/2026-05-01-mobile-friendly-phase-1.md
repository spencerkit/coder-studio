# Mobile-Friendly Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 0 mobile-shell stub with a real mobile workspace scaffold that renders mobile chrome on `/workspace`, supports workspace switching, and opens/closes empty Files / Terminal sheets without regressing desktop behavior.

**Architecture:** Keep all existing feature pages (`WelcomePage`, `LoginPage`, `SettingsPage`, `WorkspacePage`) and atoms shared. Extract workspace bootstrap into a shared shell hook so both shells keep identical auth + workspace-loading behavior. Implement a route-aware `MobileShell` that only replaces the `/workspace` chrome with mobile-only components (`MobileTopBar`, `MobileWorkspaceDrawer`, `MobileDock`, `MobileSheet`) while deferring real agent/files/terminal content to later phases.

**Tech Stack:** React 19, jotai, react-router-dom, vitest + Testing Library, lucide-react, vanilla CSS tokens/components styles.

**Spec reference:** `docs/superpowers/specs/2026-04-30-mobile-friendly-design.md` §8, §10 Phase 1.

---

## File Structure

**New files:**
- `packages/web/src/shells/shared/use-workspace-bootstrap.ts` — shared bootstrap/navigation hook extracted from desktop shell
- `packages/web/src/shells/mobile-shell/mobile-topbar.tsx` — workspace pill, connection text, more-actions trigger
- `packages/web/src/shells/mobile-shell/mobile-dock.tsx` — Files / Terminal dock buttons
- `packages/web/src/shells/mobile-shell/mobile-sheet.tsx` — generic fullscreen mobile sheet with backdrop + close affordance
- `packages/web/src/shells/mobile-shell/mobile-workspace-drawer.tsx` — workspace list drawer with workspace switching and secondary actions

**Modified files:**
- `packages/web/src/shells/desktop-shell.tsx` — consume shared bootstrap hook, keep desktop behavior unchanged
- `packages/web/src/shells/mobile-shell/index.tsx` — replace Phase 0 stub with route-aware mobile shell
- `packages/web/src/shells/mobile-shell/index.test.tsx` — replace placeholder assertions with scaffold interaction tests
- `packages/web/src/styles/components.css` — add mobile shell chrome styles

**No changes in Phase 1:**
- `features/agent-panes`, `features/terminal-panel`, `features/workspace/*`, `features/code-editor/*`
- command-palette mobile sheet conversion
- gesture hooks for swipe/drag interactions beyond tap/backdrop close

---

## Task 1: Share Workspace Bootstrap

**Files:**
- Create: `packages/web/src/shells/shared/use-workspace-bootstrap.ts`
- Modify: `packages/web/src/shells/desktop-shell.tsx`

- [ ] **Step 1: Extract the existing bootstrap hook without changing behavior**

Create a shared hook that preserves the current desktop logic:

```tsx
export function useWorkspaceBootstrap() {
  const bootstrapRequestIdRef = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const workspaces = useAtomValue(orderedWorkspacesAtom);
  const authenticated = useAtomValue(authenticatedAtom);
  const authEnabled = useAtomValue(authEnabledAtom);
  const workspacesLoadState = useAtomValue(workspacesLoadStateAtom);
  const setWorkspaces = useSetAtom(workspacesAtom);
  const setWorkspaceOrder = useSetAtom(workspaceOrderAtom);
  const setWorkspacesLoadState = useSetAtom(workspacesLoadStateAtom);
  const setWorkspacesLoadError = useSetAtom(workspacesLoadErrorAtom);

  useEffect(() => {
    // copy the current DesktopShell bootstrap body verbatim
  }, [/* same dependency list as today */]);
}
```

- [ ] **Step 2: Re-point `DesktopShell` at the shared hook**

Replace the local `useWorkspaceBootstrap` definition with:

```tsx
import { useWorkspaceBootstrap } from './shared/use-workspace-bootstrap';
```

Expected result: `desktop-shell.test.tsx` remains green with no assertion updates.

---

## Task 2: Write Failing Mobile Scaffold Tests

**Files:**
- Modify: `packages/web/src/shells/mobile-shell/index.test.tsx`

- [ ] **Step 1: Replace the Phase 0 stub test with scaffold expectations**

Add tests that assert all of the following:

```tsx
it('renders mobile workspace chrome on /workspace', () => {
  expect(screen.getByRole('button', { name: /switch workspace/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /open files sheet/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /open terminal sheet/i })).toBeInTheDocument();
});

it('opens and closes the files sheet', async () => {
  await user.click(screen.getByRole('button', { name: /open files sheet/i }));
  expect(screen.getByText('Files 面板将在 Phase 3 接入')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /close current sheet/i }));
  expect(screen.queryByText('Files 面板将在 Phase 3 接入')).not.toBeInTheDocument();
});

it('opens the workspace drawer and switches active workspace', async () => {
  await user.click(screen.getByRole('button', { name: /switch workspace/i }));
  await user.click(screen.getByRole('button', { name: /switch to workspace Beta/i }));
  expect(store.get(activeWorkspaceIdAtom)).toBe('ws-2');
});
```

- [ ] **Step 2: Run the focused test file and confirm RED**

Run:

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/shells/mobile-shell/index.test.tsx
```

Expected: FAIL because the current stub still renders `DesktopShell` and none of the mobile controls exist.

---

## Task 3: Implement `MobileShell`

**Files:**
- Modify: `packages/web/src/shells/mobile-shell/index.tsx`
- Create: `packages/web/src/shells/mobile-shell/mobile-topbar.tsx`
- Create: `packages/web/src/shells/mobile-shell/mobile-dock.tsx`
- Create: `packages/web/src/shells/mobile-shell/mobile-sheet.tsx`
- Create: `packages/web/src/shells/mobile-shell/mobile-workspace-drawer.tsx`

- [ ] **Step 1: Make `MobileShell` route-aware instead of delegating to desktop**

Use the shared bootstrap hook and keep non-workspace routes on the existing pages:

```tsx
<Routes>
  <Route path="/" element={<WelcomePage />} />
  <Route path="/auth" element={<LoginPage />} />
  <Route path="/settings" element={<SettingsPage />} />
  <Route path="/workspace" element={<MobileWorkspaceScaffold />} />
</Routes>
```

- [ ] **Step 2: Add the mobile workspace scaffold with local UI state**

Use local state for the Phase 1 chrome only:

```tsx
const [drawerOpen, setDrawerOpen] = useState(false);
const [sheet, setSheet] = useState<'files' | 'terminal' | null>(null);
const [actionsOpen, setActionsOpen] = useState(false);
```

Render:

```tsx
<div className="mobile-shell">
  <MobileTopBar ... />
  <ConfigDriftBanner />
  <div className="mobile-shell__viewport">...</div>
  <MobileDock activeSheet={sheet} onSelectSheet={setSheet} />
  <MobileSheet ... />
  <MobileWorkspaceDrawer ... />
</div>
```

- [ ] **Step 3: Implement `MobileTopBar`**

Responsibilities:
- workspace pill showing active workspace name
- connection label (`已连接`, `连接中`, `重连中`, `离线`, `另一个标签页已激活`)
- `⋯` button toggling a small action menu
- action menu items for Settings and Quick Actions

- [ ] **Step 4: Implement `MobileWorkspaceDrawer`**

Responsibilities:
- render ordered workspaces from `orderedWorkspacesAtom`
- switch `activeWorkspaceIdAtom`
- navigate to `/workspace` when selecting
- close on backdrop click
- expose footer actions for `New Workspace` and `Settings`

- [ ] **Step 5: Implement `MobileDock` and `MobileSheet`**

`MobileDock`:

```tsx
<button aria-label="Open Files sheet">...</button>
<button aria-label="Open Terminal sheet">...</button>
```

`MobileSheet`:
- fullscreen/fixed overlay
- title + helper copy
- close button with `aria-label="Close current sheet"`
- backdrop click closes

Phase 1 content is placeholder-only:

```tsx
const placeholderBySheet = {
  files: {
    title: 'Files',
    body: 'Files 面板将在 Phase 3 接入',
  },
  terminal: {
    title: 'Terminal',
    body: 'Terminal 面板将在 Phase 3 接入',
  },
};
```

---

## Task 4: Add Mobile Chrome Styles

**Files:**
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Add a dedicated `Mobile Shell` section**

Define styles for:
- `.mobile-shell`
- `.mobile-topbar`
- `.mobile-workspace-drawer`
- `.mobile-dock`
- `.mobile-sheet`
- `.mobile-shell__placeholder`

Use the existing touch tokens:

```css
min-height: var(--touch-target-large);
padding: var(--sp-3) var(--sp-4);
border-radius: var(--radius-xl);
```

- [ ] **Step 2: Preserve desktop isolation**

Guard mobile-only visual overrides inside:

```css
@media (max-width: 899px), (pointer: coarse) {
  /* mobile shell classes only */
}
```

No changes to desktop component selectors like `.workspace-page`, `.app-topbar`, `.left-panel`, `.terminal-panel`.

---

## Task 5: Verify GREEN

**Files:** none

- [ ] **Step 1: Run the focused mobile shell tests**

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/shells/mobile-shell/index.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the full web package tests**

```bash
pnpm --filter @coder-studio/web test
```

Expected: PASS, including existing desktop shell tests.

- [ ] **Step 3: Run changed-file lint**

```bash
pnpm exec biome lint \
  packages/web/src/shells/desktop-shell.tsx \
  packages/web/src/shells/shared/use-workspace-bootstrap.ts \
  packages/web/src/shells/mobile-shell/index.tsx \
  packages/web/src/shells/mobile-shell/index.test.tsx \
  packages/web/src/shells/mobile-shell/mobile-topbar.tsx \
  packages/web/src/shells/mobile-shell/mobile-dock.tsx \
  packages/web/src/shells/mobile-shell/mobile-sheet.tsx \
  packages/web/src/shells/mobile-shell/mobile-workspace-drawer.tsx \
  packages/web/src/styles/components.css
```

Expected: PASS.

- [ ] **Step 4: Run desktop regression gate**

```bash
pnpm acceptance:phase1
```

Expected: PASS. Phase 1 mobile-shell work must not break the desktop acceptance suite.

---

## Notes

- Phase 1 intentionally does **not** mount real `AgentPanes`, `FileTreePanel`, `GitPanel`, or `TerminalPanel` inside mobile chrome.
- Phase 1 intentionally keeps `WelcomePage`, `LoginPage`, and `SettingsPage` as existing full-page routes.
- Phase 2 starts once the scaffold is stable and verified, adding real chat/chip/composer behavior inside the mobile workspace viewport.
