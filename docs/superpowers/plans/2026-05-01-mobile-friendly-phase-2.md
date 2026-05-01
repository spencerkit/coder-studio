# Mobile-Friendly Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Phase 1 mobile workspace scaffold so mobile users can view one active agent session at a time, switch between open agents through a chip strip, and submit terminal-backed agent prompts from a mobile composer without the soft keyboard covering the bottom controls.

**Architecture:** Keep desktop workspace behavior unchanged and continue sharing jotai atoms, websocket state, `SessionCard`, and existing session bootstrap logic. Extract the `session.list` hydration behavior out of `AgentPanes`, flatten the persisted pane tree into a mobile-friendly one-dimensional session list, and add a mobile-only bottom control stack that contains the composer plus dock while reacting to `visualViewport` changes.

**Tech Stack:** React 19, jotai, react-router-dom, vitest + Testing Library, WebSocket client `sendTerminalInput`, vanilla CSS tokens/components styles.

**Spec reference:** `docs/superpowers/specs/2026-04-30-mobile-friendly-design.md` §3.4, §3.5, §4.1, §10 Phase 2.

---

## File Structure

**New files:**
- `packages/web/src/features/agent-panes/use-workspace-sessions.ts` — shared `session.list` hydration hook plus workspace session state access
- `packages/web/src/shells/mobile-shell/mobile-agent-strip.tsx` — horizontal active-agent chip list
- `packages/web/src/shells/mobile-shell/mobile-composer.tsx` — mobile textarea + send action backed by `sendTerminalInput`
- `packages/web/src/shells/mobile-shell/hooks/use-visual-viewport-inset.ts` — keyboard inset hook based on `window.visualViewport`

**Modified files:**
- `packages/web/src/features/agent-panes/index.tsx` — consume the shared session hook instead of owning hydration inline
- `packages/web/src/features/agent-panes/components/session-card.tsx` — allow mobile to force the terminal read-only and hide desktop-only header actions
- `packages/web/src/features/agent-panes/components/session-card.test.tsx` — cover the new optional props without regressing current defaults
- `packages/web/src/shells/mobile-shell/index.tsx` — replace the Phase 1 hero placeholder with mobile session stage, chip strip, composer, and keyboard-aware bottom stack
- `packages/web/src/shells/mobile-shell/index.test.tsx` — add failing tests for chip rendering, session switching, composer submit, empty-state fallback, and keyboard inset behavior
- `packages/web/src/styles/components.css` — add mobile phase2 layout, chip strip, composer, and bottom-stack styles

**No changes in Phase 2:**
- `packages/web/src/features/workspace/*` desktop split layout
- Files / Git / Terminal sheet content
- Settings / Welcome / Auth route redesign
- agent swipe gestures, unread badge syncing, and chip long-press menus

---

## Task 1: Share Workspace Session Hydration

**Files:**
- Create: `packages/web/src/features/agent-panes/use-workspace-sessions.ts`
- Modify: `packages/web/src/features/agent-panes/index.tsx`

- [ ] **Step 1: Extract the current `session.list` hydration effect into a shared hook**

Create a hook that owns:

```tsx
export function useWorkspaceSessions(workspace: Workspace | null) {
  const workspaceId = workspace?.id ?? '__workspace_empty__';
  const sessions = useAtomValue(sessionsByWorkspaceAtomFamily(workspaceId));
  const paneLayout = useAtomValue(paneLayoutAtomFamily(workspaceId));
  const setPaneLayout = useSetAtom(paneLayoutAtomFamily(workspaceId));

  useEffect(() => {
    // move the existing AgentPanes session.list + sanitizePaneLayout logic here
  }, [workspace, workspaceId, connectionStatus, dispatch, setSessions, setPaneLayout, store]);

  return { workspaceId, sessions, paneLayout, setPaneLayout };
}
```

- [ ] **Step 2: Update `AgentPanes` to consume the shared hook without changing behavior**

`AgentPanes` should switch from local hydration state to:

```tsx
const workspace = useAtomValue(activeWorkspaceAtom);
const { workspaceId, sessions, paneLayout, setPaneLayout } = useWorkspaceSessions(workspace);
```

Expected result: existing `AgentPanes` tests remain green after the extraction.

---

## Task 2: Write Failing Mobile Phase 2 Tests

**Files:**
- Modify: `packages/web/src/shells/mobile-shell/index.test.tsx`

- [ ] **Step 1: Add session-aware mobile shell fixtures**

Extend the mobile shell test helper so it can seed:

```tsx
store.set(wsClientAtom, {
  sendCommand,
  sendTerminalInput,
  subscribe: vi.fn(() => () => {}),
} as never);

store.set(sessionsAtom, {
  sess_1: { id: 'sess_1', workspaceId: 'ws-1', terminalId: 'term-1', providerId: 'claude', state: 'idle', ... },
  sess_2: { id: 'sess_2', workspaceId: 'ws-1', terminalId: 'term-2', providerId: 'codex', state: 'running', ... },
});

store.set(paneLayoutAtomFamily('ws-1'), {
  id: 'root',
  type: 'split',
  direction: 'horizontal',
  children: [
    { id: 'left', type: 'leaf', sessionId: 'sess_1' },
    { id: 'right', type: 'leaf', sessionId: 'sess_2' },
  ],
});
```

- [ ] **Step 2: Add failing assertions for Phase 2 behavior**

Add tests covering:

```tsx
it('renders agent chips, the active session stage, and the mobile composer', () => {
  expect(screen.getByRole('tablist', { name: 'Mobile agents' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Switch to agent Claude' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Switch to agent Codex' })).toBeInTheDocument();
  expect(screen.getByTestId('mobile-session-card')).toHaveTextContent('sess_2');
  expect(screen.getByRole('textbox', { name: 'Agent composer' })).toBeInTheDocument();
});

it('switches the active session when a chip is tapped', async () => {
  await user.click(screen.getByRole('button', { name: 'Switch to agent Claude' }));
  expect(screen.getByTestId('mobile-session-card')).toHaveTextContent('sess_1');
});

it('submits composer text through sendTerminalInput', async () => {
  await user.type(screen.getByRole('textbox', { name: 'Agent composer' }), 'ship it');
  await user.click(screen.getByRole('button', { name: 'Send prompt' }));
  expect(sendTerminalInput).toHaveBeenCalledWith(
    'term-2',
    new TextEncoder().encode('ship it\r'),
    'submit',
    'ship it'
  );
});

it('falls back to the agent empty state when no sessions are open', () => {
  expect(screen.getByTestId('mobile-agent-empty')).toBeInTheDocument();
});

it('applies visualViewport inset to the bottom control stack', async () => {
  expect(screen.getByTestId('mobile-bottom-stack')).toHaveStyle({ paddingBottom: '240px' });
});
```

- [ ] **Step 3: Run the focused mobile shell test file and confirm RED**

Run:

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/shells/mobile-shell/index.test.tsx
```

Expected: FAIL because the current Phase 1 shell has no chips, no composer, and no keyboard-aware bottom stack.

---

## Task 3: Implement Mobile Session Stage and Chip Strip

**Files:**
- Create: `packages/web/src/shells/mobile-shell/mobile-agent-strip.tsx`
- Modify: `packages/web/src/shells/mobile-shell/index.tsx`
- Modify: `packages/web/src/features/agent-panes/components/session-card.tsx`
- Modify: `packages/web/src/features/agent-panes/components/session-card.test.tsx`

- [ ] **Step 1: Let `SessionCard` support a mobile presentation**

Add optional props that default to desktop behavior:

```tsx
interface SessionCardProps {
  sessionId: string;
  showHeaderActions?: boolean;
  terminalReadOnlyOverride?: boolean;
}
```

Use them like:

```tsx
const isInteractive = isSessionInteractive(session.state);
const terminalReadOnly = terminalReadOnlyOverride ?? !isInteractive;
```

and:

```tsx
{showHeaderActions !== false ? (
  <div className="session-header-actions">...</div>
) : null}
```

- [ ] **Step 2: Flatten the workspace pane layout into a mobile agent list**

Inside `MobileWorkspaceScaffold`:

```tsx
const { workspaceId, sessions, paneLayout } = useWorkspaceSessions(activeWorkspace);
const sessionMap = new Map(sessions.map((session) => [session.id, session]));
const orderedSessionIds = dedupe(
  collectSessionIds(paneLayout).filter((sessionId) => sessionMap.has(sessionId))
);
```

Fallback rule:
- keep the current `activeSessionId` if it still exists
- else pick the session with the largest `lastActiveAt`
- else pick the first flattened session id
- else `null`

- [ ] **Step 3: Render the mobile session stage**

If there is an active session:

```tsx
<section className="mobile-shell__agent-stage">
  <SessionCard
    sessionId={activeSessionId}
    showHeaderActions={false}
    terminalReadOnlyOverride
  />
</section>
```

If there are no sessions:

```tsx
<section className="mobile-shell__agent-empty" data-testid="mobile-agent-empty">
  <AgentPanes />
</section>
```

- [ ] **Step 4: Implement `MobileAgentStrip`**

Render a horizontally scrollable chip row:

```tsx
<div className="mobile-agent-strip" role="tablist" aria-label="Mobile agents">
  {sessions.map((session) => (
    <button
      key={session.id}
      type="button"
      className={active ? 'mobile-agent-strip__chip mobile-agent-strip__chip--active' : 'mobile-agent-strip__chip'}
      aria-pressed={active}
      aria-label={`Switch to agent ${label}`}
      onClick={() => onSelect(session.id)}
    >
      <span className={`mobile-agent-strip__dot mobile-agent-strip__dot--${session.state}`} />
      <span>{label}</span>
    </button>
  ))}
</div>
```

Chip label priority:
- `session.title`
- provider name with initial uppercase
- fallback `SESSION-XX`

---

## Task 4: Implement the Mobile Composer and Keyboard Inset

**Files:**
- Create: `packages/web/src/shells/mobile-shell/mobile-composer.tsx`
- Create: `packages/web/src/shells/mobile-shell/hooks/use-visual-viewport-inset.ts`
- Modify: `packages/web/src/shells/mobile-shell/index.tsx`

- [ ] **Step 1: Add a `visualViewport` keyboard inset hook**

Create:

```tsx
export function useVisualViewportInset() {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      const nextInset = Math.max(window.innerHeight - viewport.height - viewport.offsetTop, 0);
      setInset(Math.round(nextInset));
    };

    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
```

- [ ] **Step 2: Implement `MobileComposer` with textarea + submit**

Use local draft state:

```tsx
const [draft, setDraft] = useState('');
```

Send logic:

```tsx
await wsClient.sendTerminalInput(
  terminalId,
  new TextEncoder().encode(`${draft}\r`),
  'submit',
  draft
);
setDraft('');
```

UI requirements for Phase 2:
- textarea `aria-label="Agent composer"`
- send button `aria-label="Send prompt"`
- attachment button shell only, disabled for now
- disable send when there is no active session, no websocket client, or the draft is blank

- [ ] **Step 3: Move composer and dock into a shared bottom stack**

Replace the direct dock render with:

```tsx
const keyboardInset = useVisualViewportInset();

<div
  className="mobile-shell__bottom-stack"
  data-testid="mobile-bottom-stack"
  style={{ paddingBottom: `${keyboardInset}px` }}
>
  <MobileComposer session={activeSession} />
  <MobileDock ... />
</div>
```

This keeps the bottom controls above the soft keyboard without affecting desktop layout.

---

## Task 5: Add Mobile Phase 2 Styles

**Files:**
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Replace the Phase 1 hero placeholder layout with session-stage styles**

Add classes for:
- `.mobile-shell__content`
- `.mobile-shell__agent-stage`
- `.mobile-shell__agent-empty`
- `.mobile-shell__bottom-stack`

- [ ] **Step 2: Add chip strip and composer styles**

Add classes for:
- `.mobile-agent-strip`
- `.mobile-agent-strip__chip`
- `.mobile-agent-strip__chip--active`
- `.mobile-agent-strip__dot`
- `.mobile-composer`
- `.mobile-composer__input`
- `.mobile-composer__icon-button`
- `.mobile-composer__send`

Keep all selectors inside:

```css
@media (max-width: 899px), (pointer: coarse) {
  /* mobile shell only */
}
```

---

## Task 6: Verify GREEN

**Files:** none

- [ ] **Step 1: Run the focused mobile shell tests**

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/shells/mobile-shell/index.test.tsx
```

Expected: PASS

- [ ] **Step 2: Run the touched unit tests**

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/features/agent-panes/components/session-card.test.tsx
pnpm --filter @coder-studio/web test -- packages/web/src/features/agent-panes/index.test.tsx
```

Expected: PASS

- [ ] **Step 3: Run the full web test suite**

```bash
pnpm --filter @coder-studio/web test
```

Expected: PASS

- [ ] **Step 4: Lint the changed files**

```bash
pnpm exec biome lint \
  packages/web/src/features/agent-panes/index.tsx \
  packages/web/src/features/agent-panes/use-workspace-sessions.ts \
  packages/web/src/features/agent-panes/components/session-card.tsx \
  packages/web/src/features/agent-panes/components/session-card.test.tsx \
  packages/web/src/shells/mobile-shell/index.tsx \
  packages/web/src/shells/mobile-shell/index.test.tsx \
  packages/web/src/shells/mobile-shell/mobile-agent-strip.tsx \
  packages/web/src/shells/mobile-shell/mobile-composer.tsx \
  packages/web/src/shells/mobile-shell/hooks/use-visual-viewport-inset.ts
```

Expected: no errors

- [ ] **Step 5: Re-run the existing mobile scaffold acceptance gate**

```bash
pnpm acceptance:phase1
```

Expected: PASS, proving mobile Phase 2 work does not regress the earlier shell baseline.
