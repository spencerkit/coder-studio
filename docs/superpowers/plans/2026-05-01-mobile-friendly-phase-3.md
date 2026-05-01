# Mobile-Friendly Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the mobile workspace shell so the dock opens real Files, Git, Terminal, and Supervisor surfaces instead of placeholders, while keeping desktop workspace behavior unchanged.

**Architecture:** Continue treating mobile as a shell-only adaptation over shared feature modules. Reuse `FileTreePanel`, `GitPanel`, `GitDiffViewer`, `CodeEditorHost`, `TerminalPanel`, `SupervisorCard`, and supervisor atoms inside mobile-only sheet containers, and add a thin mobile navigation state layer for `Files list -> editor`, `Git status -> diff`, and `Supervisor badge -> sheet`.

**Tech Stack:** React 19, jotai, react-router-dom, vitest + Testing Library, existing workspace/terminal/supervisor feature modules, vanilla CSS tokens/components styles.

**Spec reference:** `docs/superpowers/specs/2026-04-30-mobile-friendly-design.md` §3.6, §3.7, §5.3, §5.5, §10 Phase 3.

---

## File Structure

**New files:**
- `packages/web/src/shells/mobile-shell/mobile-files-sheet.tsx` — mobile Files/Git root content plus in-sheet nav stack into editor and diff detail
- `packages/web/src/shells/mobile-shell/mobile-supervisor-badge.tsx` — compact supervisor badge rendered beside the agent strip when the active session has supervisor state
- `packages/web/src/shells/mobile-shell/mobile-supervisor-sheet.tsx` — mobile supervisor sheet content with `SupervisorCard`, `ObjectiveDialog`, and empty state

**Modified files:**
- `packages/web/src/features/workspace/components/file-tree.tsx` — optional `onSelectFile` callback so mobile can react to file picks without forking tree logic
- `packages/web/src/features/workspace/components/git-panel.tsx` — optional `onPreviewChange` callback so mobile can react to diff picks without depending on DOM events
- `packages/web/src/shells/mobile-shell/index.tsx` — replace Files/Terminal placeholders, add supervisor sheet state, hide inline supervisor inside the stage card
- `packages/web/src/shells/mobile-shell/mobile-dock.tsx` — support the supervisor dock/sheet selection state
- `packages/web/src/shells/mobile-shell/mobile-sheet.tsx` — support contextual kicker/title/back behavior for nested mobile sheet navigation
- `packages/web/src/shells/mobile-shell/mobile-topbar.tsx` — keep current behavior but allow supervisor badge/sheet coexistence in layout
- `packages/web/src/shells/mobile-shell/index.test.tsx` — add failing tests for Files/Git nav, Terminal sheet, and Supervisor badge/sheet behavior
- `packages/web/src/styles/components.css` — mobile Phase 3 layout and sheet content styling

**No changes in Phase 3:**
- `packages/web/src/features/settings/*`, `packages/web/src/features/welcome/*`, auth routing, command palette mobile conversion
- desktop split layout behavior in `packages/web/src/features/workspace/index.tsx`
- gesture system beyond existing open/close interactions

---

## Task 1: Write Failing Mobile Phase 3 Tests

**Files:**
- Modify: `packages/web/src/shells/mobile-shell/index.test.tsx`

- [ ] **Step 1: Mock reusable desktop feature modules at the mobile shell boundary**

Add focused mocks so mobile tests can assert shell behavior without loading Monaco/xterm:

```tsx
vi.mock('../../features/workspace/components/file-tree', () => ({
  FileTreePanel: ({ onSelectFile }: { onSelectFile?: (path: string) => void }) => (
    <button type="button" onClick={() => onSelectFile?.('src/app.tsx')}>
      mock-file-tree
    </button>
  ),
}));

vi.mock('../../features/workspace/components/git-panel', () => ({
  GitPanel: ({ onPreviewChange }: { onPreviewChange?: (path: string) => void }) => (
    <button type="button" onClick={() => onPreviewChange?.('src/app.tsx')}>
      mock-git-panel
    </button>
  ),
}));

vi.mock('../../features/workspace/components/git-diff-viewer', () => ({
  GitDiffViewer: () => <div data-testid="mobile-git-diff-viewer">GitDiffViewer</div>,
}));

vi.mock('../../features/code-editor', () => ({
  CodeEditorHost: () => <div data-testid="mobile-code-editor">CodeEditorHost</div>,
}));

vi.mock('../../features/terminal-panel', () => ({
  TerminalPanel: () => <div data-testid="mobile-terminal-panel">TerminalPanel</div>,
}));
```

- [ ] **Step 2: Add failing assertions for Files/Git nested navigation**

Cover root tabs, file push, diff push, and back behavior:

```tsx
it('opens the files sheet and navigates from file list into the editor view', async () => {
  await user.click(screen.getByRole('button', { name: 'Open Files sheet' }));
  expect(screen.getByRole('tab', { name: 'Files' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'mock-file-tree' }));
  expect(screen.getByTestId('mobile-code-editor')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Go back' }));
  expect(screen.getByRole('button', { name: 'mock-file-tree' })).toBeInTheDocument();
});

it('switches to the git tab and navigates into the diff viewer', async () => {
  await user.click(screen.getByRole('button', { name: 'Open Files sheet' }));
  await user.click(screen.getByRole('tab', { name: 'Git Diff' }));
  await user.click(screen.getByRole('button', { name: 'mock-git-panel' }));
  expect(screen.getByTestId('mobile-git-diff-viewer')).toBeInTheDocument();
});
```

- [ ] **Step 3: Add failing assertions for Terminal and Supervisor sheet behavior**

Add coverage for the remaining Phase 3 entry points:

```tsx
it('opens the terminal sheet from the dock', async () => {
  await user.click(screen.getByRole('button', { name: 'Open Terminal sheet' }));
  expect(screen.getByTestId('mobile-terminal-panel')).toBeInTheDocument();
});

it('shows a supervisor badge for the active session and opens the supervisor sheet', async () => {
  expect(await screen.findByRole('button', { name: 'Open Supervisor sheet' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Open Supervisor sheet' }));
  expect(screen.getByText('Supervisor')).toBeInTheDocument();
});
```

- [ ] **Step 4: Run the focused mobile shell test file and confirm RED**

Run:

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/shells/mobile-shell/index.test.tsx
```

Expected: FAIL because the current shell still renders placeholder sheets and has no supervisor badge/sheet.

---

## Task 2: Implement Files/Git Mobile Sheet Navigation

**Files:**
- Create: `packages/web/src/shells/mobile-shell/mobile-files-sheet.tsx`
- Modify: `packages/web/src/features/workspace/components/file-tree.tsx`
- Modify: `packages/web/src/features/workspace/components/git-panel.tsx`
- Modify: `packages/web/src/shells/mobile-shell/mobile-sheet.tsx`
- Modify: `packages/web/src/shells/mobile-shell/index.tsx`

- [ ] **Step 1: Add optional callbacks to shared workspace panels**

Extend `FileTreePanel` and `GitPanel` with mobile-safe hooks:

```tsx
interface FileTreePanelProps {
  workspaceId: string;
  refreshToken?: number;
  createRequest?: CreateRequest | null;
  onCreateRequestConsumed?: () => void;
  onSelectFile?: (path: string) => void;
}

const handleSelectFile = (path: string) => {
  setActiveFilePath(path);
  onSelectFile?.(path);
};
```

```tsx
interface GitPanelProps {
  workspaceId: string;
  refreshToken?: number;
  onPreviewChange?: (preview: GitDiffPreview) => void;
}

setDiffPreview(preview);
onPreviewChange?.(preview);
```

- [ ] **Step 2: Build a dedicated mobile Files/Git sheet wrapper**

Create a mobile-only nav state layer:

```tsx
type MobileFilesRoute =
  | { kind: 'root' }
  | { kind: 'editor'; path: string }
  | { kind: 'diff'; path: string };

function MobileFilesSheet({ workspaceId, onRequestClose }: Props) {
  const [activeTab, setActiveTab] = useState<'files' | 'git'>('files');
  const [route, setRoute] = useState<MobileFilesRoute>({ kind: 'root' });

  const canGoBack = route.kind !== 'root';
  const title = route.kind === 'editor' ? 'Editor' : route.kind === 'diff' ? 'Diff' : 'Files';
}
```

Root view renders:

```tsx
<div className="panel-tabs" role="tablist" aria-label="Files sheet tabs">
  <button role="tab" aria-selected={activeTab === 'files'}>Files</button>
  <button role="tab" aria-selected={activeTab === 'git'}>Git Diff</button>
</div>
```

Detail routes render:

```tsx
{route.kind === 'editor' ? <CodeEditorHost /> : null}
{route.kind === 'diff' ? <GitDiffViewer workspaceId={workspaceId} /> : null}
```

- [ ] **Step 3: Wire the mobile shell to the real Files sheet**

Replace the placeholder body in `index.tsx` with:

```tsx
sheet === 'files'
  ? {
      title: filesSheetTitle,
      canGoBack: filesSheetCanGoBack,
      onBack: filesSheetHandleBack,
      body: <MobileFilesSheet workspaceId={activeWorkspace.id} ... />,
    }
  : null;
```

Expected behavior:
- root close button dismisses the sheet
- nested editor/diff route uses the header back button
- desktop `WorkspacePage` remains unchanged

- [ ] **Step 4: Re-run focused mobile shell tests and confirm GREEN for Files/Git flows**

Run:

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/shells/mobile-shell/index.test.tsx
```

Expected: Files/Git tests PASS; Terminal/Supervisor assertions may still fail until later tasks land.

---

## Task 3: Implement Terminal Mobile Sheet

**Files:**
- Modify: `packages/web/src/shells/mobile-shell/index.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Swap the terminal placeholder for the shared terminal panel**

Use the desktop feature module directly:

```tsx
sheet === 'terminal'
  ? {
      title: 'Terminal',
      body: (
        <div className="mobile-terminal-sheet">
          <TerminalPanel />
        </div>
      ),
    }
  : null;
```

- [ ] **Step 2: Add mobile sheet containment styles so the panel can fill the available height**

Add rules like:

```css
.mobile-terminal-sheet,
.mobile-terminal-sheet > .bottom-terminal {
  display: flex;
  flex: 1;
  min-height: 0;
}

.mobile-terminal-sheet .bottom-terminal {
  border: none;
  background: transparent;
  box-shadow: none;
}
```

- [ ] **Step 3: Re-run the focused mobile shell tests**

Run:

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/shells/mobile-shell/index.test.tsx
```

Expected: Terminal sheet assertion PASS; Supervisor assertions may still fail.

---

## Task 4: Implement Supervisor Badge and Sheet

**Files:**
- Create: `packages/web/src/shells/mobile-shell/mobile-supervisor-badge.tsx`
- Create: `packages/web/src/shells/mobile-shell/mobile-supervisor-sheet.tsx`
- Modify: `packages/web/src/shells/mobile-shell/index.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Keep supervisor hydration but remove the inline card from the mobile stage**

Render the active session stage with:

```tsx
<SessionCard
  sessionId={activeSession.id}
  showHeaderActions={false}
  showSupervisorInline={false}
  terminalReadOnlyOverride
/>
```

If `SessionCard` does not yet support this, add:

```tsx
interface SessionCardProps {
  sessionId: string;
  showHeaderActions?: boolean;
  showSupervisorInline?: boolean;
  terminalReadOnlyOverride?: boolean;
}
```

- [ ] **Step 2: Add a compact badge beside the agent strip**

Use supervisor atoms plus the active session id:

```tsx
const supervisor = useAtomValue(supervisorBySessionAtom)(activeSessionId);

if (!supervisor) return null;

return (
  <button type="button" aria-label="Open Supervisor sheet">
    <span>📍</span>
    <span>{latestCycleLabel}</span>
  </button>
);
```

- [ ] **Step 3: Build the mobile supervisor sheet**

Render:

```tsx
<div className="mobile-supervisor-sheet">
  <SupervisorCard sessionId={session.id} workspaceId={session.workspaceId} />
  <ObjectiveDialog workspaceId={session.workspaceId} sessionId={session.id} />
</div>
```

Empty state:

```tsx
<div className="mobile-supervisor-sheet__empty">
  <p>Supervisor 未启用</p>
</div>
```

- [ ] **Step 4: Re-run focused tests and confirm GREEN**

Run:

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/shells/mobile-shell/index.test.tsx
```

Expected: mobile shell Phase 3 tests PASS.

---

## Task 5: Full Regression Verification

**Files:**
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/shells/mobile-shell/index.tsx`
- Modify: `packages/web/src/shells/mobile-shell/index.test.tsx`
- Modify: `packages/web/src/features/workspace/components/file-tree.tsx`
- Modify: `packages/web/src/features/workspace/components/git-panel.tsx`
- Create: `packages/web/src/shells/mobile-shell/mobile-files-sheet.tsx`
- Create: `packages/web/src/shells/mobile-shell/mobile-supervisor-badge.tsx`
- Create: `packages/web/src/shells/mobile-shell/mobile-supervisor-sheet.tsx`

- [ ] **Step 1: Run focused component tests**

Run:

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/shells/mobile-shell/index.test.tsx
pnpm --filter @coder-studio/web test -- packages/web/src/features/workspace/components/file-tree.test.tsx
pnpm --filter @coder-studio/web test -- packages/web/src/features/workspace/components/git-panel.test.tsx
pnpm --filter @coder-studio/web test -- packages/web/src/features/agent-panes/components/session-card.test.tsx
```

Expected: all four commands exit 0.

- [ ] **Step 2: Run lint on all changed web files**

Run:

```bash
pnpm exec biome lint \
  packages/web/src/shells/mobile-shell/index.tsx \
  packages/web/src/shells/mobile-shell/index.test.tsx \
  packages/web/src/shells/mobile-shell/mobile-sheet.tsx \
  packages/web/src/shells/mobile-shell/mobile-dock.tsx \
  packages/web/src/shells/mobile-shell/mobile-files-sheet.tsx \
  packages/web/src/shells/mobile-shell/mobile-supervisor-badge.tsx \
  packages/web/src/shells/mobile-shell/mobile-supervisor-sheet.tsx \
  packages/web/src/features/workspace/components/file-tree.tsx \
  packages/web/src/features/workspace/components/git-panel.tsx \
  packages/web/src/features/agent-panes/components/session-card.tsx \
  packages/web/src/styles/components.css
```

Expected: exit 0 with no lint errors.

- [ ] **Step 3: Run the full web suite and acceptance regression**

Run:

```bash
pnpm --filter @coder-studio/web test
pnpm acceptance:phase1
```

Expected: both commands exit 0, proving desktop regressions were not introduced while enabling mobile Phase 3.
