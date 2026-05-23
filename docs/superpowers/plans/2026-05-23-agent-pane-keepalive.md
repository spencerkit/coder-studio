# Agent Pane Keepalive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep desktop agent terminals alive while the editor is foregrounded so same-page `agent -> editor -> agent` switches never rebuild `xterm`, rerun replay, or lose runtime state.

**Architecture:** Keep `AgentPanes` mounted inside a layered desktop main stage and render the editor as an overlay instead of an either-or branch. Thread a desktop visibility signal down to `XtermHost`, then use that signal to downgrade covered terminals to background hydration, disable interactivity, suppress replay overlays while covered, and refit when visible again without recreating the terminal instance.

**Tech Stack:** React 19, TypeScript, Jotai, xterm.js, Vitest, CSS

---

## File Map

- `packages/web/src/features/agent-panes/index.tsx`
  Propagates desktop visibility through the pane tree without changing pane layout behavior.
- `packages/web/src/features/agent-panes/index.test.tsx`
  Verifies `AgentPanes` passes the visibility signal to every rendered `SessionCard`.
- `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
  Forwards the visibility signal from a session card into `XtermHost`.
- `packages/web/src/features/agent-panes/components/session-card.test.tsx`
  Verifies `SessionCard` forwards `isVisible` to the terminal host.
- `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`
  Converts the desktop main stage from conditional rendering to layered rendering and passes desktop foreground visibility into `AgentPanes`.
- `packages/web/src/features/workspace/index.test.tsx`
  Verifies desktop editor mode keeps `AgentPanes` mounted and only toggles foreground visibility.
- `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
  Makes terminal interactivity, hydration priority, replay overlay visibility, and refit behavior aware of the new `isVisible` prop.
- `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`
  Verifies hidden terminals downgrade to background, stop accepting input, do not replay again on visibility-only rerenders, refit without refocusing, and suppress closed-session overlays while covered.
- `packages/web/src/styles/components.css`
  Adds layered desktop stage styles for the always-mounted agent layer and editor overlay.
- `packages/web/src/styles/components.theme.test.ts`
  Verifies the new desktop stage selectors and layout rules exist.

## Guardrails

- Leave `packages/web/src/features/workspace/actions/use-workspace-screen-model.ts` unchanged. `mainAreaMode` remains a foreground selector, not a mount selector.
- Do not change mobile behavior in this plan.
- Do not add a frontend terminal snapshot cache or runtime manager in this plan.
- Do not remove `terminal.replay` or `terminal.snapshot`; they stay as fallback for true recovery.

### Task 1: Thread Desktop Visibility Through AgentPanes and SessionCard

**Files:**
- Modify: `packages/web/src/features/agent-panes/index.tsx`
- Modify: `packages/web/src/features/agent-panes/index.test.tsx`
- Modify: `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
- Modify: `packages/web/src/features/agent-panes/components/session-card.test.tsx`

- [ ] **Step 1: Write the failing prop-threading tests**

Add this test to `packages/web/src/features/agent-panes/index.test.tsx`:

```tsx
type MockSessionCardProps = {
  sessionId: string;
  isVisible?: boolean;
  onSplitHorizontal?: () => void;
  onSplitVertical?: () => void;
  onClose?: () => void;
};

it("passes visibility to session cards", async () => {
  const { store } = createAgentPaneStore();

  const { rerender } = render(
    <Provider store={store}>
      <AgentPanes isVisible />
    </Provider>
  );

  await waitFor(() => {
    expect(mockSessionCard).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessionId: "sess_1",
        isVisible: true,
      })
    );
  });

  rerender(
    <Provider store={store}>
      <AgentPanes isVisible={false} />
    </Provider>
  );

  await waitFor(() => {
    expect(mockSessionCard).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessionId: "sess_1",
        isVisible: false,
      })
    );
  });
});
```

Add this test to `packages/web/src/features/agent-panes/components/session-card.test.tsx`:

```tsx
it("passes terminal visibility through to XtermHost", () => {
  const { store } = createSessionStore({
    terminalId: "term-live",
    state: "running",
    endedAt: undefined,
  });

  render(
    <Provider store={store}>
      <SessionCard sessionId="sess_123456" isVisible={false} />
    </Provider>
  );

  expect(getLastXtermHostProps()).toEqual(
    expect.objectContaining({
      terminalId: "term-live",
      isVisible: false,
    })
  );
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web test -- src/features/agent-panes/index.test.tsx -t "passes visibility to session cards"
pnpm --filter @coder-studio/web test -- src/features/agent-panes/components/session-card.test.tsx -t "passes terminal visibility through to XtermHost"
```

Expected:

```text
FAIL  src/features/agent-panes/index.test.tsx
  AssertionError: expected last call to contain { isVisible: true }

FAIL  src/features/agent-panes/components/session-card.test.tsx
  AssertionError: expected object to contain { isVisible: false }
```

- [ ] **Step 3: Implement the prop threading with default-visible behavior**

In `packages/web/src/features/agent-panes/index.tsx`, replace the `AgentPanesProps` declaration and component signature with:

```tsx
interface AgentPanesProps {
  hydrateSessions?: boolean;
  isVisible?: boolean;
}

export const AgentPanes: FC<AgentPanesProps> = ({
  hydrateSessions = true,
  isVisible = true,
}) => {
  const t = useTranslation();
  const workspace = useAtomValue(activeWorkspaceAtom);
  const { workspaceId, sessions, paneLayout } = useWorkspaceSessions(workspace, {
    disabled: !hydrateSessions,
  });
  const paneActions = usePaneActions(workspaceId);
  const sessionActions = useSessionActions();
  const hasLayoutSessions = collectSessionIds(paneLayout).length > 0;
  const shouldShowStandaloneDraftLauncher =
    sessions.length === 0 &&
    (hasLayoutSessions ||
      (paneLayout.type === "leaf" && !paneLayout.sessionId && paneLayout.id === "root"));

  if (!workspace) {
    return (
      <div className="agent-panes-empty">
        <EmptyState
          style={{ padding: 0 }}
          title={<p style={emptyStateTitleStyle}>{t("workspace.no_workspace")}</p>}
        />
      </div>
    );
  }

  if (shouldShowStandaloneDraftLauncher) {
    return (
      <DraftLauncher
        workspaceId={workspaceId}
        onReplaceWithSession={paneActions.replaceWithSession}
      />
    );
  }

  return (
    <div className="agent-panes">
      <PaneNodeRenderer
        node={paneLayout}
        workspaceId={workspaceId}
        isVisible={isVisible}
        onCloseSession={paneActions.closeSessionPane}
        onSplitDraftPane={paneActions.splitDraftPane}
        onSplitSession={paneActions.splitSessionPane}
        onCloseDraftPane={paneActions.closeDraftPane}
        onAssignSession={paneActions.assignSession}
        onReplaceWithSession={paneActions.replaceWithSession}
        onCloseSessionCommand={sessionActions.closeSession}
      />
    </div>
  );
};
```

In the same file, replace `PaneNodeRendererProps` and the `SessionCard` render branch with:

```tsx
interface PaneNodeRendererProps {
  node: PaneNode;
  workspaceId: string;
  isVisible: boolean;
  onAssignSession: (paneId: string, sessionId: string) => void;
  onCloseDraftPane: (paneId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onCloseSessionCommand: (
    sessionId: string,
    paneDisposition?: "draft" | "remove"
  ) => Promise<boolean | void>;
  onReplaceWithSession: (sessionId: string) => void;
  onSplitDraftPane: (paneId: string, direction: "horizontal" | "vertical") => void;
  onSplitSession: (sessionId: string, direction: "horizontal" | "vertical") => void;
}

const PaneNodeRenderer: FC<PaneNodeRendererProps> = ({
  node,
  workspaceId,
  isVisible,
  onAssignSession,
  onCloseDraftPane,
  onCloseSession,
  onCloseSessionCommand,
  onReplaceWithSession,
  onSplitDraftPane,
  onSplitSession,
}) => {
  if (node.type === "leaf") {
    if (node.sessionId) {
      return (
        <SessionCard
          sessionId={node.sessionId}
          isVisible={isVisible}
          onClose={async () => {
            onCloseSession(node.sessionId!);
            await onCloseSessionCommand(node.sessionId!, "draft");
          }}
          onSplitHorizontal={() => onSplitSession(node.sessionId!, "horizontal")}
          onSplitVertical={() => onSplitSession(node.sessionId!, "vertical")}
        />
      );
    }

    return (
      <DraftLauncher
        workspaceId={workspaceId}
        paneId={node.id}
        onAssignSession={onAssignSession}
        onClosePane={onCloseDraftPane}
        onReplaceWithSession={onReplaceWithSession}
        onSplitPane={onSplitDraftPane}
      />
    );
  }

  const resolvedRatio = readPaneRatio(workspaceId, node.id) ?? node.ratio ?? 0.5;

  return (
    <PaneLayout
      splitId={node.id}
      direction={node.direction || "horizontal"}
      ratio={resolvedRatio}
      onRatioCommit={(ratio) => writePaneRatio(workspaceId, node.id, ratio)}
    >
      {node.children?.map((child) => (
        <PaneNodeRenderer
          key={child.id}
          node={child}
          workspaceId={workspaceId}
          isVisible={isVisible}
          onAssignSession={onAssignSession}
          onCloseDraftPane={onCloseDraftPane}
          onCloseSession={onCloseSession}
          onCloseSessionCommand={onCloseSessionCommand}
          onReplaceWithSession={onReplaceWithSession}
          onSplitDraftPane={onSplitDraftPane}
          onSplitSession={onSplitSession}
        />
      ))}
    </PaneLayout>
  );
};
```

In `packages/web/src/features/agent-panes/views/shared/session-card.tsx`, replace the props definition and `XtermHost` usage with:

```tsx
interface SessionCardProps {
  sessionId: string;
  isVisible?: boolean;
  showHeaderActions?: boolean;
  showSupervisorInline?: boolean;
  terminalReadOnlyOverride?: boolean;
  headerAccessory?: ReactNode;
  onClose?: SessionCardAction;
  onSplitHorizontal?: SessionCardAction;
  onSplitVertical?: SessionCardAction;
}

export const SessionCard: FC<SessionCardProps> = ({
  sessionId,
  isVisible = true,
  showHeaderActions = true,
  showSupervisorInline = true,
  terminalReadOnlyOverride,
  headerAccessory,
  onClose,
  onSplitHorizontal,
  onSplitVertical,
}) => {
```

```tsx
      <div className="session-terminal">
        <XtermHost
          closedSessionProviderLabel={providerLabel}
          onClosedSessionClose={() => {
            void handleClosedSessionClose();
          }}
          onClosedSessionContinue={() => {
            void handleClosedSessionContinue();
          }}
          terminalId={session.terminalId}
          workspaceId={session.workspaceId}
          readOnly={terminalReadOnly}
          isActiveSession={isActiveSession}
          isVisible={isVisible}
          terminalKind="agent"
        />
      </div>
```

- [ ] **Step 4: Run the focused tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web test -- src/features/agent-panes/index.test.tsx -t "passes visibility to session cards"
pnpm --filter @coder-studio/web test -- src/features/agent-panes/components/session-card.test.tsx -t "passes terminal visibility through to XtermHost"
```

Expected:

```text
PASS  src/features/agent-panes/index.test.tsx
PASS  src/features/agent-panes/components/session-card.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add \
  packages/web/src/features/agent-panes/index.tsx \
  packages/web/src/features/agent-panes/index.test.tsx \
  packages/web/src/features/agent-panes/views/shared/session-card.tsx \
  packages/web/src/features/agent-panes/components/session-card.test.tsx
git commit -m "refactor: thread desktop terminal visibility"
```

### Task 2: Keep AgentPanes Mounted in the Desktop Stage

**Files:**
- Modify: `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`
- Modify: `packages/web/src/features/workspace/index.test.tsx`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write the failing desktop keepalive and CSS tests**

In `packages/web/src/features/workspace/index.test.tsx`, change the `AgentPanes` mock to expose lifecycle and visibility:

```tsx
const agentPaneLifecycle = { mounts: 0, unmounts: 0 };

vi.mock("../agent-panes", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    AgentPanes: ({ isVisible = true }: { isVisible?: boolean }) => {
      React.useEffect(() => {
        agentPaneLifecycle.mounts += 1;
        return () => {
          agentPaneLifecycle.unmounts += 1;
        };
      }, []);

      return <div data-testid="agent-panes" data-visible={String(isVisible)} />;
    },
  };
});
```

Reset the lifecycle object in the existing `afterEach` block:

```tsx
agentPaneLifecycle.mounts = 0;
agentPaneLifecycle.unmounts = 0;
```

Add this new workspace test:

```tsx
it("keeps agent panes mounted beneath the editor overlay", async () => {
  const sendCommand = vi.fn().mockImplementation(async (op: string) => {
    if (op === "git.status") {
      return {
        branch: "main",
        ahead: 0,
        behind: 0,
        staged: [],
        modified: [],
        deleted: [],
        untracked: [],
      };
    }

    return [];
  });

  const store = createStore();
  store.set(connectionStatusAtom, "connected");
  store.set(wsClientAtom, { sendCommand } as never);
  seedReadyWorkspaceState(store, {
    "ws-test": {
      id: "ws-test",
      path: "/home/spencer/workspace/coder-studio",
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 280,
        bottomPanelHeight: 200,
        focusMode: false,
      },
    },
  });

  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/workspace"]}>
        <Routes>
          <Route path="/workspace" element={<WorkspaceDesktopView />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

  await screen.findByTestId("agent-panes");
  expect(agentPaneLifecycle).toEqual({ mounts: 1, unmounts: 0 });

  act(() => {
    store.set(activeFilePathAtomFamily("ws-test"), "src/app.tsx");
  });

  expect(screen.getByTestId("agent-panes")).toBeInTheDocument();
  expect(screen.getByTestId("agent-panes")).toHaveAttribute("data-visible", "false");
  expect(screen.getByTestId("code-editor-host")).toBeInTheDocument();
  expect(agentPaneLifecycle).toEqual({ mounts: 1, unmounts: 0 });
  expect(document.querySelector(".workspace-main-stage__agent-layer")).toHaveAttribute(
    "aria-hidden",
    "true"
  );
  expect(document.querySelector(".workspace-main-stage__editor-layer")).not.toBeNull();
});
```

Replace the two editor-mode assertions that currently remove agent panes with these assertions:

```tsx
expect(screen.getByTestId("code-editor-host")).toBeInTheDocument();
expect(screen.getByTestId("agent-panes")).toHaveAttribute("data-visible", "false");
```

In the existing desktop surface test inside `packages/web/src/styles/components.theme.test.ts`, replace the old stage selector capture:

```ts
const agentPanes = getLastRuleBlock(".workspace-main-stage > .agent-panes");
```

with:

```ts
const agentLayer = getLastRuleBlock(".workspace-main-stage__agent-layer");
const coveredAgentLayer = getLastRuleBlock(".workspace-main-stage__agent-layer--covered");
const editorLayer = getLastRuleBlock(".workspace-main-stage__editor-layer");
const nestedAgentPanes = getLastRuleBlock(".workspace-main-stage__agent-layer > .agent-panes");
```

Replace the old agent-pane expectations:

```ts
expect(agentPanes).toContain("flex: 1");
expect(agentPanes).toContain("min-height: 0");
expect(agentPanes).toContain("padding: 0");
```

with:

```ts
expect(mainStage).toContain("position: relative");
expect(mainStage).toContain("overflow: hidden");
expect(agentLayer).toContain("display: flex");
expect(agentLayer).toContain("min-height: 0");
expect(coveredAgentLayer).toContain("pointer-events: none");
expect(editorLayer).toContain("position: absolute");
expect(editorLayer).toContain("inset: 0");
expect(nestedAgentPanes).toContain("flex: 1");
expect(nestedAgentPanes).toContain("min-height: 0");
expect(nestedAgentPanes).toContain("padding: 0");
```
```

- [ ] **Step 2: Run the focused desktop tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web test -- src/features/workspace/index.test.tsx -t "keeps agent panes mounted beneath the editor overlay"
pnpm --filter @coder-studio/web test -- src/styles/components.theme.test.ts -t "emits layered desktop workspace stage rules"
```

Expected:

```text
FAIL  src/features/workspace/index.test.tsx
  Unable to find an element by: [data-testid="agent-panes"]

FAIL  src/styles/components.theme.test.ts
  expected CSS rule for .workspace-main-stage__agent-layer
```

- [ ] **Step 3: Layer the desktop stage and keep AgentPanes mounted**

In `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`, replace the current main-stage branch with:

```tsx
        <div className="workspace-main-area">
          <div className="workspace-main-stage">
            <div
              className={`workspace-main-stage__agent-layer${mainAreaMode === "editor" ? " workspace-main-stage__agent-layer--covered" : ""}`}
              aria-hidden={mainAreaMode === "editor" ? true : undefined}
            >
              <AgentPanes hydrateSessions={false} isVisible={mainAreaMode === "agent"} />
            </div>

            {mainAreaMode === "editor" ? (
              <div className="workspace-main-stage__editor-layer">
                <CodeEditorHost />
              </div>
            ) : null}
          </div>
```

In `packages/web/src/styles/components.css`, replace the current desktop stage block with:

```css
.workspace-main-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.workspace-main-stage__agent-layer {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
}

.workspace-main-stage__agent-layer > .agent-panes {
  flex: 1;
  min-height: 0;
  padding: 0;
}

.workspace-main-stage__agent-layer--covered {
  pointer-events: none;
}

.workspace-main-stage__editor-layer {
  position: absolute;
  inset: 0;
  z-index: 1;
  min-width: 0;
  min-height: 0;
}

.workspace-main-stage__editor-layer > * {
  height: 100%;
  min-height: 0;
}
```

- [ ] **Step 4: Run the focused desktop tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web test -- src/features/workspace/index.test.tsx -t "keeps agent panes mounted beneath the editor overlay"
pnpm --filter @coder-studio/web test -- src/styles/components.theme.test.ts -t "emits layered desktop workspace stage rules"
```

Expected:

```text
PASS  src/features/workspace/index.test.tsx
PASS  src/styles/components.theme.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add \
  packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx \
  packages/web/src/features/workspace/index.test.tsx \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts
git commit -m "feat: keep desktop agent panes mounted"
```

### Task 3: Make XtermHost Visibility-Aware Without Recreating xterm

**Files:**
- Modify: `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
- Modify: `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`

- [ ] **Step 1: Write the failing visibility-behavior tests**

Add this test to `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`:

```tsx
it("treats covered desktop terminals as background hydration and disables stdin", async () => {
  const store = createStore();
  store.set(wsClientAtom, {
    sendCommand: vi.fn().mockResolvedValue({ status: "ok" }),
    subscribe: vi.fn(() => () => {}),
    getStatus: vi.fn(() => "connected"),
    onStatus: vi.fn(() => () => {}),
  } as never);

  render(
    <Provider store={store}>
      <XtermHost terminalId="covered-terminal" workspaceId="test-workspace" isVisible={false} />
    </Provider>
  );

  expect(hydrationCoordinatorMocks.request).toHaveBeenCalledWith({
    terminalId: "covered-terminal",
    tier: "background",
  });

  await waitFor(() => {
    expect(mockTerminal.options).toEqual(
      expect.objectContaining({
        disableStdin: true,
        cursorBlink: false,
      })
    );
  });
});
```

Add this test to the same file:

```tsx
it("does not rerun recovery when only desktop visibility changes", async () => {
  const store = createStore();
  const sendCommand = vi.fn().mockImplementation((op: string) => {
    if (op === "terminal.snapshot") {
      return Promise.resolve({ status: "unsupported" });
    }

    if (op === "terminal.replay") {
      return Promise.resolve({ status: "ok", seq: 0 });
    }

    return Promise.resolve({ ok: true, data: { status: "ok" } });
  });
  const subscribe = vi.fn(() => vi.fn());
  const rafCallbacks: FrameRequestCallback[] = [];
  const originalRequestAnimationFrame = global.requestAnimationFrame;
  const originalCancelAnimationFrame = global.cancelAnimationFrame;

  mockTerminal.cols = 132;
  mockTerminal.rows = 36;

  global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  }) as typeof requestAnimationFrame;
  global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

  store.set(wsClientAtom, {
    sendCommand,
    subscribe,
    getStatus: vi.fn(() => "connected"),
    onStatus: vi.fn(() => () => {}),
  } as never);

  const { rerender } = render(
    <Provider store={store}>
      <XtermHost terminalId="keepalive-terminal" workspaceId="test-workspace" isVisible />
    </Provider>
  );

  await act(async () => {
    rafCallbacks.shift()?.(16);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  mockFitAddon.fit.mockClear();
  mockTerminal.focus.mockClear();

  rerender(
    <Provider store={store}>
      <XtermHost terminalId="keepalive-terminal" workspaceId="test-workspace" isVisible={false} />
    </Provider>
  );

  rerender(
    <Provider store={store}>
      <XtermHost terminalId="keepalive-terminal" workspaceId="test-workspace" isVisible />
    </Provider>
  );

  await act(async () => {
    await Promise.resolve();
  });

  const { Terminal } = await import("@xterm/xterm");

  expect(Terminal).toHaveBeenCalledTimes(1);
  expect(sendCommand.mock.calls.filter(([op]) => op === "terminal.snapshot")).toHaveLength(1);
  expect(sendCommand.mock.calls.filter(([op]) => op === "terminal.replay")).toHaveLength(1);
  expect(mockFitAddon.fit).toHaveBeenCalled();
  expect(mockTerminal.focus).not.toHaveBeenCalled();

  global.requestAnimationFrame = originalRequestAnimationFrame;
  global.cancelAnimationFrame = originalCancelAnimationFrame;
});
```

Add this test to the same file:

```tsx
it("suppresses the closed-session overlay while the terminal is covered", async () => {
  const store = createStore();
  const sendCommand = vi.fn().mockImplementation((op: string) => {
    if (op === "terminal.replay") {
      return Promise.resolve({ status: "unknown" });
    }

    return Promise.resolve({ ok: true, data: { status: "ok" } });
  });
  const subscribe = vi.fn(() => vi.fn());
  const rafCallbacks: FrameRequestCallback[] = [];
  const originalRequestAnimationFrame = global.requestAnimationFrame;
  const originalCancelAnimationFrame = global.cancelAnimationFrame;

  mockTerminal.cols = 132;
  mockTerminal.rows = 36;

  global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  }) as typeof requestAnimationFrame;
  global.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;

  const { rerender } = render(
    <Provider store={store}>
      <XtermHost
        terminalId="covered-closed-terminal"
        workspaceId="test-workspace"
        readOnly
        terminalKind="agent"
        isVisible={false}
        closedSessionProviderLabel="Codex"
        onClosedSessionContinue={vi.fn()}
        onClosedSessionClose={vi.fn()}
      />
    </Provider>
  );

  await act(async () => {
    rafCallbacks.shift()?.(16);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(screen.queryByText("当前会话已结束")).not.toBeInTheDocument();
  expect(document.querySelector(".xterm-replay-overlay")).toBeFalsy();

  rerender(
    <Provider store={store}>
      <XtermHost
        terminalId="covered-closed-terminal"
        workspaceId="test-workspace"
        readOnly
        terminalKind="agent"
        isVisible
        closedSessionProviderLabel="Codex"
        onClosedSessionContinue={vi.fn()}
        onClosedSessionClose={vi.fn()}
      />
    </Provider>
  );

  await waitFor(() => {
    expect(screen.getByText("当前会话已结束")).toBeInTheDocument();
  });

  global.requestAnimationFrame = originalRequestAnimationFrame;
  global.cancelAnimationFrame = originalCancelAnimationFrame;
});
```

- [ ] **Step 2: Run the terminal host test file and verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web test -- src/features/terminal-panel/__tests__/xterm-host.test.tsx
```

Expected:

```text
FAIL  src/features/terminal-panel/__tests__/xterm-host.test.tsx
  Property 'isVisible' does not exist on type 'XtermHostProps'
  expected hydration request tier to equal "background"
  expected terminal.replay call count to remain 1
  expected overlay not to be rendered while hidden
```

- [ ] **Step 3: Add visibility-aware hydration, interactivity, overlay gating, and refit logic**

In `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`, add a shared helper near the prop types:

```tsx
function resolveHydrationTier({
  alive,
  isActiveSession,
  isVisible,
}: {
  alive: boolean | undefined;
  isActiveSession: boolean;
  isVisible: boolean;
}): HydrationTier {
  if (!isVisible || alive === false) {
    return "background";
  }

  return isActiveSession ? "visible-active" : "visible-other";
}
```

Replace the `XtermHostProps` block and function signature with:

```tsx
interface XtermHostProps {
  terminalId: string;
  workspaceId: string;
  readOnly?: boolean;
  isActiveSession?: boolean;
  isVisible?: boolean;
  terminalKind?: "agent" | "shell";
  containerRef?: React.RefObject<HTMLDivElement>;
  closedSessionContinueLabel?: string;
  closedSessionProviderLabel?: string;
  onClosedSessionContinue?: () => void;
  onClosedSessionClose?: () => void;
}

export function XtermHost({
  closedSessionContinueLabel,
  closedSessionProviderLabel,
  onClosedSessionClose,
  onClosedSessionContinue,
  terminalId,
  workspaceId,
  readOnly = false,
  isActiveSession = false,
  isVisible = true,
  terminalKind: terminalKindProp,
}: XtermHostProps) {
```

Replace the interactivity and visibility refs near the top of the component with:

```tsx
  const terminalMetaRef = useRef(meta);
  const terminalKind = terminalKindProp ?? meta?.kind ?? "shell";
  const isInteractive = isVisible && !readOnly && meta?.alive !== false;
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const fitFrameRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const fitResolversRef = useRef<Array<() => void>>([]);
  const resizeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interactiveRef = useRef(true);
  const visibleRef = useRef(isVisible);
  const previousVisibleRef = useRef(isVisible);
  const lastReportedSizeRef = useRef<{ cols: number; rows: number } | null>(null);
```

Add this effect after the `terminalMetaRef` sync effect:

```tsx
  useEffect(() => {
    visibleRef.current = isVisible;
  }, [isVisible]);
```

Replace both hydration-tier calculations with the shared helper:

```tsx
    const handle = globalHydrationCoordinator.request({
      terminalId,
      tier: resolveHydrationTier({
        alive: meta?.alive,
        isActiveSession,
        isVisible,
      }),
    });
```

```tsx
    hydrationHandleRef.current?.promote(
      resolveHydrationTier({
        alive: meta?.alive,
        isActiveSession,
        isVisible,
      })
    );
  }, [isActiveSession, isVisible, meta?.alive, viewport]);
```

Keep the existing focus effect dependency list stable, but gate focus with the visibility ref so covered terminals never refocus:

```tsx
  useEffect(() => {
    if (
      viewport !== "mobile" &&
      hydrationState.kind === "granted" &&
      meta?.alive &&
      terminalRef.current &&
      visibleRef.current
    ) {
      terminalRef.current.focus();
    }
  }, [hydrationState.kind, meta?.alive, viewport]);
```

Add a new visibility-restore refit effect immediately after the focus effect:

```tsx
  useEffect(() => {
    const wasVisible = previousVisibleRef.current;
    previousVisibleRef.current = isVisible;

    if (viewport === "mobile") {
      return;
    }

    if (!isVisible || wasVisible || hydrationState.kind !== "granted") {
      return;
    }

    if (terminalRef.current) {
      scheduleFit();
    }
  }, [hydrationState.kind, isVisible, scheduleFit, viewport]);
```

Finally, gate the replay overlay by visibility:

```tsx
  const showReplayOverlay =
    (isVisible || viewport === "mobile") &&
    (replayUiState.kind === "degraded" ||
      (replayUiState.kind === "loading" && loadingOverlayVisible)) &&
    (viewport === "mobile" ||
      hydrationState.kind === "granted" ||
      activeRecoveryUiModeRef.current === "non_blocking_recovering");
```

- [ ] **Step 4: Run the terminal host test file and verify it passes**

Run:

```bash
pnpm --filter @coder-studio/web test -- src/features/terminal-panel/__tests__/xterm-host.test.tsx
```

Expected:

```text
PASS  src/features/terminal-panel/__tests__/xterm-host.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add \
  packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx \
  packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx
git commit -m "feat: make xterm keepalive visibility-aware"
```

## Final Verification

Run:

```bash
pnpm --filter @coder-studio/web test -- \
  src/features/agent-panes/index.test.tsx \
  src/features/agent-panes/components/session-card.test.tsx \
  src/features/workspace/index.test.tsx \
  src/features/terminal-panel/__tests__/xterm-host.test.tsx \
  src/styles/components.theme.test.ts
```

Expected:

```text
PASS  src/features/agent-panes/index.test.tsx
PASS  src/features/agent-panes/components/session-card.test.tsx
PASS  src/features/workspace/index.test.tsx
PASS  src/features/terminal-panel/__tests__/xterm-host.test.tsx
PASS  src/styles/components.theme.test.ts
```

If you want one extra safety check after the test run, use:

```bash
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
```

Expected:

```text
Found 0 errors.
```
