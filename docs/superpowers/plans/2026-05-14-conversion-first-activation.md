# Conversion-First Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a conversion-first product path that takes a new user from welcome to a first useful AI task, then promotes phone continuation and later resume.

**Architecture:** Add a dedicated `setup` feature on the web app, backed by a new `setup.status` command and shared setup DTOs in `@coder-studio/core`. Reuse existing workspace browse/open, provider runtime/install, session creation, last-viewed target, and supervisor state instead of building parallel systems; P0 ships the first-success path, P1 adds mobile continuation, and P2 adds return-and-resume.

**Tech Stack:** TypeScript, React, React Router, Jotai, Vitest, Zod, existing websocket command dispatch, existing `user_settings` storage

---

## Phase Tracking Index

This file remains the detailed source of truth. For day-to-day tracking, use the four phase plans below:

- Phase 1: [Conversion-First Activation Phase 1 Implementation Plan](./2026-05-14-conversion-first-activation-phase-1-foundation.md)
- Phase 2: [Conversion-First Activation Phase 2 Implementation Plan](./2026-05-14-conversion-first-activation-phase-2-first-value.md)
- Phase 3: [Conversion-First Activation Phase 3 Implementation Plan](./2026-05-14-conversion-first-activation-phase-3-mobile-continuation.md)
- Phase 4: [Conversion-First Activation Phase 4 Implementation Plan](./2026-05-14-conversion-first-activation-phase-4-return-and-retention.md)

## Scope Check

This spec spans three sequential product slices rather than one indivisible feature:

- P0: first successful task
- P1: cross-device continuation
- P2: return and resume

They are kept in one plan because each phase builds directly on the previous one and shares the same activation funnel. Execution should still stop after each task and verify the new slice is working before moving deeper into the funnel.

## File Structure

- Modify: `packages/core/src/domain/types.ts`
  - Add shared DTOs for setup readiness, mobile access status, first-task templates, and home summary.
- Modify: `packages/server/src/commands/index.ts`
  - Register new setup and home-summary commands.
- Modify: `packages/server/src/ws/dispatch.ts`
  - Extend `CommandContext` with server config so setup/mobile commands can report host, port, and auth readiness.
- Modify: `packages/server/src/ws/hub.ts`
  - Pass config into `CommandContext`.
- Create: `packages/server/src/commands/setup.ts`
  - Expose `setup.status` and `setup.mobileAccessStatus`.
- Create: `packages/server/src/commands/setup.test.ts`
  - Cover setup readiness and mobile access command behavior.
- Create: `packages/server/src/commands/home.ts`
  - Expose `home.summary`.
- Create: `packages/server/src/commands/home.test.ts`
  - Cover returning-summary behavior.
- Modify: `packages/web/src/shells/desktop-shell.tsx`
  - Add the `/setup` route.
- Modify: `packages/web/src/shells/desktop-shell.test.tsx`
  - Cover `/setup` and route transitions.
- Modify: `packages/web/src/features/welcome/index.tsx`
  - Rewrite the welcome CTA hierarchy and support a returning-summary variant.
- Modify: `packages/web/src/features/welcome/index.test.tsx`
  - Cover welcome-to-setup navigation and returning summary rendering.
- Modify: `packages/web/src/locales/en.json`
  - Add English strings for setup, mobile access, return summary, and supervisor templates.
- Modify: `packages/web/src/locales/zh.json`
  - Add Chinese strings for setup, mobile access, return summary, and supervisor templates.
- Create: `packages/web/src/features/setup/index.ts`
  - Export the new setup feature.
- Create: `packages/web/src/features/setup/actions/use-setup-flow.ts`
  - Centralize setup step state, goal selection, status refresh, and launch progression.
- Create: `packages/web/src/features/setup/actions/use-setup-status.ts`
  - Fetch `setup.status`, map checks into UI state, and expose refresh actions.
- Create: `packages/web/src/features/setup/views/setup-page.tsx`
  - Render the setup shell and route between goal, doctor, launch, and success steps.
- Create: `packages/web/src/features/setup/views/setup-page.test.tsx`
  - Cover the setup flow across steps.
- Create: `packages/web/src/features/setup/views/setup-goal-step.tsx`
  - Render the three goal choices.
- Create: `packages/web/src/features/setup/views/setup-doctor-step.tsx`
  - Render readiness checks, fix actions, and workspace selection.
- Create: `packages/web/src/features/setup/views/setup-launch-step.tsx`
  - Render provider readiness and first-task templates.
- Create: `packages/web/src/features/setup/views/setup-success-step.tsx`
  - Render success summary and `Continue on Phone`.
- Create: `packages/web/src/features/setup/components/setup-step-shell.tsx`
  - Shared setup header, progress, and footer actions.
- Create: `packages/web/src/features/setup/components/setup-directory-picker.tsx`
  - Reuse workspace directory selection without depending on the legacy modal.
- Modify: `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`
  - Remove hardcoded root paths and expose reusable directory-picker state.
- Modify: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`
  - Reuse the extracted directory picker component and keep modal behavior for manual open.
- Modify: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`
  - Cover the updated root path behavior and shared picker integration.
- Modify: `packages/web/src/features/agent-panes/actions/use-provider-launcher.ts`
  - Support setup-driven provider readiness and `draft`-backed first-task session creation.
- Create: `packages/web/src/features/agent-panes/actions/use-provider-launcher.test.tsx`
  - Cover install, ready, and `draft` launch flows.
- Modify: `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`
  - Reuse the same provider-state vocabulary introduced in setup.
- Modify: `packages/web/src/features/settings/components/provider-settings.tsx`
  - Reuse the same provider-state vocabulary introduced in setup.
- Modify: `packages/web/src/features/settings/components/provider-settings.test.tsx`
  - Cover shared provider-state rendering.
- Create: `packages/web/src/features/mobile-access/index.ts`
  - Export the mobile access assistant.
- Create: `packages/web/src/features/mobile-access/actions/use-mobile-access.ts`
  - Fetch `setup.mobileAccessStatus` and expose QR/link actions.
- Create: `packages/web/src/features/mobile-access/views/mobile-access-assistant.tsx`
  - Render the mobile continuation surface for setup success and settings.
- Create: `packages/web/src/features/mobile-access/views/mobile-access-assistant.test.tsx`
  - Cover local-only vs ready states.
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
  - Expose the mobile access assistant from settings.
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
  - Cover settings integration.
- Modify: `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`
  - Surface `Continue on Phone` after first-task success and in the workspace shell.
- Create: `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.test.tsx`
  - Cover the workspace CTA.
- Create: `packages/web/src/features/welcome/components/return-summary-card.tsx`
  - Render the returning-user summary block.
- Create: `packages/web/src/features/welcome/components/return-summary-card.test.tsx`
  - Cover return-summary content and resume CTA.
- Modify: `packages/web/src/hooks/use-bootstrap.ts`
  - Hydrate home summary in returning mode without regressing existing workspace bootstrap.
- Modify: `packages/web/src/features/workspace/views/shared/workspace-route-gate.tsx`
  - Allow resume routing when the last-viewed target and home summary are present.
- Modify: `packages/web/src/features/supervisor/actions/use-objective-dialog-state.ts`
  - Support preset objective templates for quick-start.
- Modify: `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`
  - Add quick-start template actions.
- Modify: `packages/web/src/features/supervisor/components/supervisor-card.test.tsx`
  - Cover the quick-start entry points.

### Task 1: Rewrite welcome and add the setup route shell

**Files:**
- Modify: `packages/web/src/features/welcome/index.tsx`
- Modify: `packages/web/src/features/welcome/index.test.tsx`
- Modify: `packages/web/src/shells/desktop-shell.tsx`
- Modify: `packages/web/src/shells/desktop-shell.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Create: `packages/web/src/features/setup/index.ts`
- Create: `packages/web/src/features/setup/views/setup-page.tsx`
- Create: `packages/web/src/features/setup/views/setup-page.test.tsx`
- Create: `packages/web/src/features/setup/components/setup-step-shell.tsx`

- [ ] **Step 1: Write the failing route and CTA tests**

```tsx
it("navigates from Welcome to /setup from the primary CTA", () => {
  const store = createStore();
  store.set(localeAtom, "en");

  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<WelcomePage />} />
          <Route path="/setup" element={<div>Setup Screen</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

  fireEvent.click(screen.getByRole("button", { name: "Start Setup" }));

  expect(screen.getByText("Setup Screen")).toBeInTheDocument();
});

it("renders SetupPage on /setup in DesktopShell", () => {
  window.history.replaceState({}, "", "/setup");

  const store = createStore();
  store.set(connectionStatusAtom, "connected");
  store.set(authEnabledAtom, false);
  store.set(authenticatedAtom, true);

  renderShell(store);

  expect(screen.getByText("Choose your setup goal")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the desktop and welcome tests to verify they fail**

Run: `pnpm exec vitest run packages/web/src/features/welcome/index.test.tsx packages/web/src/shells/desktop-shell.test.tsx packages/web/src/features/setup/views/setup-page.test.tsx`

Expected: FAIL because `Start Setup`, `/setup`, and `SetupPage` do not exist yet

- [ ] **Step 3: Implement the new primary CTA and route shell**

```tsx
// packages/web/src/features/welcome/index.tsx
const handleStartSetup = () => {
  navigate("/setup");
};

<button className="welcome-btn" onClick={handleStartSetup}>
  <ThemedIcon semantic="state.welcome.lightning" size={18} />
  <span>{t("welcome.action.start_setup")}</span>
</button>
```

```tsx
// packages/web/src/shells/desktop-shell.tsx
import { SetupPage } from "../features/setup";

<Routes>
  <Route path="/" element={<WelcomePage />} />
  <Route path="/setup" element={<SetupPage />} />
  <Route path="/login" element={<LoginPage />} />
  <Route path="/session-gate" element={<SessionGatePage />} />
  <Route path="/workspace" element={<WorkspaceRouteGate><WorkspaceDesktopView /></WorkspaceRouteGate>} />
  <Route path="/settings" element={<SettingsPage />} />
  <Route path="*" element={<NotFoundPage />} />
</Routes>
```

```tsx
// packages/web/src/features/setup/views/setup-page.tsx
export function SetupPage() {
  return (
    <div className="setup-page">
      <SetupStepShell
        stepLabel="1 / 4"
        title="Choose your setup goal"
        description="Start on this machine, continue on your phone, or launch a long-running task."
      >
        <SetupGoalStep />
      </SetupStepShell>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify the route shell passes**

Run: `pnpm exec vitest run packages/web/src/features/welcome/index.test.tsx packages/web/src/shells/desktop-shell.test.tsx packages/web/src/features/setup/views/setup-page.test.tsx`

Expected: PASS with welcome navigation and `/setup` route coverage

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/welcome/index.tsx packages/web/src/features/welcome/index.test.tsx packages/web/src/shells/desktop-shell.tsx packages/web/src/shells/desktop-shell.test.tsx packages/web/src/locales/en.json packages/web/src/locales/zh.json packages/web/src/features/setup/index.ts packages/web/src/features/setup/views/setup-page.tsx packages/web/src/features/setup/views/setup-page.test.tsx packages/web/src/features/setup/components/setup-step-shell.tsx
git commit -m "feat: add setup route and welcome activation CTA"
```

### Task 2: Add shared setup DTOs and the setup/mobile server commands

**Files:**
- Modify: `packages/core/src/domain/types.ts`
- Modify: `packages/server/src/ws/dispatch.ts`
- Modify: `packages/server/src/ws/hub.ts`
- Modify: `packages/server/src/commands/index.ts`
- Create: `packages/server/src/commands/setup.ts`
- Create: `packages/server/src/commands/setup.test.ts`

- [ ] **Step 1: Write the failing server command tests for `setup.status` and `setup.mobileAccessStatus`**

```ts
it("returns setup readiness checks and provider status", async () => {
  const result = await dispatch(
    {
      kind: "command",
      id: "setup-status",
      op: "setup.status",
      args: {},
    },
    ctx
  );

  expect(result.ok).toBe(true);
  expect(result.data).toMatchObject({
    checks: expect.arrayContaining([
      expect.objectContaining({ id: "node" }),
      expect.objectContaining({ id: "git" }),
      expect.objectContaining({ id: "workspace_root" }),
      expect.objectContaining({ id: "provider" }),
    ]),
  });
});

it("returns mobile access candidates and auth state", async () => {
  const result = await dispatch(
    {
      kind: "command",
      id: "setup-mobile-status",
      op: "setup.mobileAccessStatus",
      args: {},
    },
    ctx
  );

  expect(result.ok).toBe(true);
  expect(result.data).toMatchObject({
    listenHost: "localhost",
    port: 4173,
    authEnabled: false,
    candidateUrls: expect.any(Array),
  });
});
```

- [ ] **Step 2: Run the new server tests to verify they fail**

Run: `pnpm exec vitest run packages/server/src/commands/setup.test.ts`

Expected: FAIL with unknown operations for `setup.status` and `setup.mobileAccessStatus`

- [ ] **Step 3: Add the shared DTOs and command implementations**

```ts
// packages/core/src/domain/types.ts
export type SetupCheckId =
  | "node"
  | "git"
  | "workspace_root"
  | "provider"
  | "provider_auth"
  | "mobile_host"
  | "mobile_password";

export type SetupCheckStatus = "checking" | "ready" | "needs_fix" | "fixing" | "fixed" | "failed";

export interface SetupCheckDto {
  id: SetupCheckId;
  status: SetupCheckStatus;
  detail: string;
  fixKind?: "open_workspace_picker" | "install_provider" | "open_settings" | "show_mobile_assistant";
}

export interface MobileAccessStatusDto {
  listenHost: string;
  port: number;
  authEnabled: boolean;
  candidateUrls: string[];
}
```

```ts
// packages/server/src/ws/dispatch.ts
import type { ServerConfig } from "../config.js";

export interface CommandContext {
  // existing fields...
  config: Pick<ServerConfig, "host" | "port" | "auth">;
}
```

```ts
// packages/server/src/commands/setup.ts
registerCommand("setup.status", z.object({}), async (_args, ctx) => {
  const runtime = await buildProviderRuntimeStatus(ctx.providerRegistry, ctx.providerRuntimeDeps);
  const hasWorkspace = ctx.workspaceMgr.list().length > 0;
  const providersReady = Object.values(runtime.providers).some((entry) => entry.available);

  return {
    checks: [
      {
        id: "workspace_root",
        status: hasWorkspace ? "ready" : "needs_fix",
        detail: hasWorkspace ? "Workspace root selected." : "Choose a workspace root to continue.",
        fixKind: hasWorkspace ? undefined : "open_workspace_picker",
      },
      {
        id: "provider",
        status: providersReady ? "ready" : "needs_fix",
        detail: providersReady ? "At least one provider runtime is available." : "Install Claude or Codex to launch a session.",
        fixKind: providersReady ? undefined : "install_provider",
      },
    ],
    providers: runtime.providers,
  };
});

registerCommand("setup.mobileAccessStatus", z.object({}), async (_args, ctx) => {
  const candidateUrls = getPrivateIpv4Addresses().map((ip) => `http://${ip}:${ctx.config.port}`);

  return {
    listenHost: ctx.config.host,
    port: ctx.config.port,
    authEnabled: ctx.config.auth.enabled,
    candidateUrls,
  };
});
```

Implementation note: `workspaceMgr.list()` and `getPrivateIpv4Addresses()` may require adding a small helper if the current manager/config surface lacks them; keep those helpers local to `setup.ts`.

- [ ] **Step 4: Run the server command tests to verify they pass**

Run: `pnpm exec vitest run packages/server/src/commands/setup.test.ts`

Expected: PASS with both setup commands returning structured readiness data

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/domain/types.ts packages/server/src/ws/dispatch.ts packages/server/src/ws/hub.ts packages/server/src/commands/index.ts packages/server/src/commands/setup.ts packages/server/src/commands/setup.test.ts
git commit -m "feat: add setup readiness commands"
```

### Task 3: Build the Environment Doctor UI and extract a reusable directory picker

**Files:**
- Create: `packages/web/src/features/setup/actions/use-setup-flow.ts`
- Create: `packages/web/src/features/setup/actions/use-setup-status.ts`
- Create: `packages/web/src/features/setup/views/setup-goal-step.tsx`
- Create: `packages/web/src/features/setup/views/setup-doctor-step.tsx`
- Create: `packages/web/src/features/setup/components/setup-directory-picker.tsx`
- Modify: `packages/web/src/features/setup/views/setup-page.tsx`
- Modify: `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`
- Modify: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`
- Modify: `packages/web/src/features/setup/views/setup-page.test.tsx`

- [ ] **Step 1: Write the failing setup flow tests for goal selection, doctor rendering, and root-path cleanup**

```tsx
it("moves from goal selection to Environment Doctor and shows failing checks", async () => {
  const dispatch = vi.fn()
    .mockResolvedValueOnce({
      ok: true,
      data: {
        checks: [
          { id: "workspace_root", status: "needs_fix", detail: "Choose a workspace root.", fixKind: "open_workspace_picker" },
          { id: "provider", status: "needs_fix", detail: "Install Claude or Codex.", fixKind: "install_provider" },
        ],
        providers: {},
      },
    });

  renderSetupPage(dispatch);

  fireEvent.click(screen.getByRole("button", { name: "Start on this machine" }));

  expect(await screen.findByText("Choose a workspace root.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Select Workspace Root" })).toBeInTheDocument();
});

it("does not include /home/spencer in the workspace root chips anymore", async () => {
  renderWorkspaceLaunchModalWithBrowseResult({
    currentPath: "/home/me",
    parentPath: "/home",
    directories: [],
    rootPaths: ["/", "~", "/workspaces"],
  });

  expect(screen.queryByText("/home/spencer")).not.toBeInTheDocument();
  expect(screen.getByText("/workspaces")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the setup and workspace-launch tests to verify they fail**

Run: `pnpm exec vitest run packages/web/src/features/setup/views/setup-page.test.tsx packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`

Expected: FAIL because the doctor step, shared picker, and cleaned root path behavior do not exist yet

- [ ] **Step 3: Implement the doctor step and reusable directory picker**

```tsx
// packages/web/src/features/setup/actions/use-setup-flow.ts
export type SetupStepId = "goal" | "doctor" | "launch" | "success";

export function useSetupFlow() {
  const [step, setStep] = useState<SetupStepId>("goal");
  const [goal, setGoal] = useState<"local" | "phone" | "long_task" | null>(null);

  return {
    step,
    goal,
    selectGoal(nextGoal: "local" | "phone" | "long_task") {
      setGoal(nextGoal);
      setStep("doctor");
    },
    goToLaunch() {
      setStep("launch");
    },
    complete() {
      setStep("success");
    },
  };
}
```

```tsx
// packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts
const [rootPaths, setRootPaths] = useState<string[]>(["/", "~"]);

setRootPaths(result.data.rootPaths?.length ? result.data.rootPaths : ["/", "~"]);
```

```tsx
// packages/web/src/features/setup/views/setup-doctor-step.tsx
{checks.map((check) => (
  <div key={check.id} className={`setup-check setup-check--${check.status}`}>
    <div className="setup-check__title">{t(`setup.check.${check.id}.title`)}</div>
    <p className="setup-check__detail">{check.detail}</p>
    {check.fixKind === "open_workspace_picker" ? (
      <button onClick={() => setWorkspacePickerOpen(true)}>
        {t("setup.action.select_workspace_root")}
      </button>
    ) : null}
  </div>
))}
```

- [ ] **Step 4: Run the tests to verify the doctor and picker integration passes**

Run: `pnpm exec vitest run packages/web/src/features/setup/views/setup-page.test.tsx packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`

Expected: PASS with goal-to-doctor coverage and root-path cleanup covered

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/setup/actions/use-setup-flow.ts packages/web/src/features/setup/actions/use-setup-status.ts packages/web/src/features/setup/views/setup-goal-step.tsx packages/web/src/features/setup/views/setup-doctor-step.tsx packages/web/src/features/setup/components/setup-directory-picker.tsx packages/web/src/features/setup/views/setup-page.tsx packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx packages/web/src/features/setup/views/setup-page.test.tsx
git commit -m "feat: add setup doctor and shared directory picker"
```

### Task 4: Move provider readiness and first-task launch into setup

**Files:**
- Modify: `packages/web/src/features/agent-panes/actions/use-provider-launcher.ts`
- Create: `packages/web/src/features/agent-panes/actions/use-provider-launcher.test.tsx`
- Create: `packages/web/src/features/setup/views/setup-launch-step.tsx`
- Modify: `packages/web/src/features/setup/views/setup-page.tsx`
- Modify: `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`
- Modify: `packages/web/src/features/settings/components/provider-settings.tsx`
- Modify: `packages/web/src/features/settings/components/provider-settings.test.tsx`
- Modify: `packages/web/src/features/setup/views/setup-page.test.tsx`

- [ ] **Step 1: Write the failing setup launch tests for ready providers, installable providers, and first-task templates**

```tsx
it("creates a first session with a starter draft when the provider is ready", async () => {
  const dispatch = vi.fn()
    .mockResolvedValueOnce({
      ok: true,
      data: {
        checks: [
          { id: "workspace_root", status: "ready", detail: "Workspace root selected." },
          { id: "provider", status: "ready", detail: "Claude is ready." },
        ],
        providers: {
          claude: { available: true, autoInstallSupported: true, missingCommands: [], missingPrerequisites: [] },
        },
      },
    })
    .mockResolvedValueOnce({
      ok: true,
      data: { id: "sess-1", workspaceId: "ws-1", providerId: "claude" },
    });

  renderSetupLaunchStep(dispatch, { workspaceId: "ws-1" });

  fireEvent.click(screen.getByRole("button", { name: "Explain this project" }));

  await waitFor(() => {
    expect(dispatch).toHaveBeenCalledWith("session.create", {
      workspaceId: "ws-1",
      providerId: "claude",
      draft: "Explain the structure of this repository and where to start.",
    });
  });
});
```

- [ ] **Step 2: Run the provider and setup launch tests to verify they fail**

Run: `pnpm exec vitest run packages/web/src/features/agent-panes/actions/use-provider-launcher.test.tsx packages/web/src/features/settings/components/provider-settings.test.tsx packages/web/src/features/setup/views/setup-page.test.tsx`

Expected: FAIL because setup launch does not yet pass `draft`, and provider status is not shared across setup/settings/draft launcher

- [ ] **Step 3: Extend provider launch support and add the first-task launch step**

```ts
// packages/web/src/features/agent-panes/actions/use-provider-launcher.ts
interface LaunchProviderOptions {
  draft?: string;
}

const launch = async (providerId: ProviderId, options?: LaunchProviderOptions): Promise<void> => {
  // existing runtime/install logic...
  const createResult = await dispatch<Session>("session.create", {
    workspaceId,
    providerId,
    draft: options?.draft,
  });
};
```

```tsx
// packages/web/src/features/setup/views/setup-launch-step.tsx
const templates = [
  {
    id: "explain_project",
    title: t("setup.template.explain_project.title"),
    draft: "Explain the structure of this repository and where to start.",
  },
  {
    id: "run_tests",
    title: t("setup.template.run_tests.title"),
    draft: "Run the relevant tests for this repository, summarize failures, and suggest the next fix.",
  },
  {
    id: "review_codebase",
    title: t("setup.template.review_codebase.title"),
    draft: "Read the key files in this codebase and suggest the most important improvements.",
  },
];
```

- [ ] **Step 4: Run the setup/provider tests to verify the first-task flow passes**

Run: `pnpm exec vitest run packages/web/src/features/agent-panes/actions/use-provider-launcher.test.tsx packages/web/src/features/settings/components/provider-settings.test.tsx packages/web/src/features/setup/views/setup-page.test.tsx`

Expected: PASS with `draft`-backed session creation and shared provider-state wording

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/agent-panes/actions/use-provider-launcher.ts packages/web/src/features/agent-panes/actions/use-provider-launcher.test.tsx packages/web/src/features/setup/views/setup-launch-step.tsx packages/web/src/features/setup/views/setup-page.tsx packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx packages/web/src/features/settings/components/provider-settings.tsx packages/web/src/features/settings/components/provider-settings.test.tsx packages/web/src/features/setup/views/setup-page.test.tsx
git commit -m "feat: launch first tasks from setup"
```

### Task 5: Add the mobile access assistant and `Continue on Phone`

**Files:**
- Create: `packages/web/src/features/mobile-access/index.ts`
- Create: `packages/web/src/features/mobile-access/actions/use-mobile-access.ts`
- Create: `packages/web/src/features/mobile-access/views/mobile-access-assistant.tsx`
- Create: `packages/web/src/features/mobile-access/views/mobile-access-assistant.test.tsx`
- Modify: `packages/web/src/features/setup/views/setup-success-step.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`
- Create: `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Write the failing mobile-access and workspace CTA tests**

```tsx
it("shows candidate LAN URLs and an auth warning when only localhost is configured", async () => {
  const dispatch = vi.fn().mockResolvedValue({
    ok: true,
    data: {
      listenHost: "localhost",
      port: 4173,
      authEnabled: false,
      candidateUrls: ["http://192.168.1.23:4173"],
    },
  });

  renderMobileAccessAssistant(dispatch);

  expect(await screen.findByText("http://192.168.1.23:4173")).toBeInTheDocument();
  expect(screen.getByText("Add a password before exposing this workspace on your network.")).toBeInTheDocument();
});

it("renders Continue on Phone in the workspace shell after setup success", () => {
  renderWorkspaceDesktopView({ showContinueOnPhone: true });

  expect(screen.getByRole("button", { name: "Continue on Phone" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the mobile access tests to verify they fail**

Run: `pnpm exec vitest run packages/web/src/features/mobile-access/views/mobile-access-assistant.test.tsx packages/web/src/features/settings/components/settings-page.test.tsx packages/web/src/features/workspace/views/desktop/workspace-desktop-view.test.tsx`

Expected: FAIL because the mobile assistant and workspace CTA do not exist yet

- [ ] **Step 3: Implement the mobile assistant and success-path CTA**

```ts
// packages/web/src/features/mobile-access/actions/use-mobile-access.ts
export function useMobileAccess() {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const [status, setStatus] = useState<MobileAccessStatusDto | null>(null);

  useEffect(() => {
    void dispatch<MobileAccessStatusDto>("setup.mobileAccessStatus", {}).then((result) => {
      if (result.ok && result.data) {
        setStatus(result.data);
      }
    });
  }, [dispatch]);

  return {
    status,
    primaryUrl: status?.candidateUrls[0] ?? null,
  };
}
```

```tsx
// packages/web/src/features/setup/views/setup-success-step.tsx
<div className="setup-success-actions">
  <button onClick={onOpenWorkspace}>{t("setup.success.open_workspace")}</button>
  <button onClick={onContinueOnPhone}>{t("setup.success.continue_on_phone")}</button>
</div>
<MobileAccessAssistant />
```

- [ ] **Step 4: Run the tests to verify the mobile continuation flow passes**

Run: `pnpm exec vitest run packages/web/src/features/mobile-access/views/mobile-access-assistant.test.tsx packages/web/src/features/settings/components/settings-page.test.tsx packages/web/src/features/workspace/views/desktop/workspace-desktop-view.test.tsx`

Expected: PASS with the assistant available from setup success, settings, and the workspace shell

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/mobile-access/index.ts packages/web/src/features/mobile-access/actions/use-mobile-access.ts packages/web/src/features/mobile-access/views/mobile-access-assistant.tsx packages/web/src/features/mobile-access/views/mobile-access-assistant.test.tsx packages/web/src/features/setup/views/setup-success-step.tsx packages/web/src/features/settings/components/settings-page.tsx packages/web/src/features/settings/components/settings-page.test.tsx packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx packages/web/src/features/workspace/views/desktop/workspace-desktop-view.test.tsx packages/web/src/locales/en.json packages/web/src/locales/zh.json
git commit -m "feat: add mobile continuation assistant"
```

### Task 6: Add the returning home summary and resume behavior

**Files:**
- Create: `packages/server/src/commands/home.ts`
- Create: `packages/server/src/commands/home.test.ts`
- Modify: `packages/server/src/commands/index.ts`
- Modify: `packages/core/src/domain/types.ts`
- Modify: `packages/web/src/hooks/use-bootstrap.ts`
- Modify: `packages/web/src/features/welcome/index.tsx`
- Create: `packages/web/src/features/welcome/components/return-summary-card.tsx`
- Create: `packages/web/src/features/welcome/components/return-summary-card.test.tsx`
- Modify: `packages/web/src/features/welcome/index.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/workspace-route-gate.tsx`

- [ ] **Step 1: Write the failing home-summary and returning-welcome tests**

```ts
it("returns the last viewed target, latest session, and supervisor summary", async () => {
  const result = await dispatch(
    {
      kind: "command",
      id: "home-summary",
      op: "home.summary",
      args: {},
    },
    ctx
  );

  expect(result.ok).toBe(true);
  expect(result.data).toMatchObject({
    lastViewedTarget: expect.anything(),
    latestSession: expect.anything(),
  });
});
```

```tsx
it("renders a returning summary with a resume CTA when home.summary is available", async () => {
  renderWelcomeReturningState({
    summary: {
      lastViewedTarget: { workspaceId: "ws-1", sessionId: "sess-1", updatedAt: 1 },
      latestSession: { id: "sess-1", title: "Run tests", providerId: "codex", state: "idle", lastActiveAt: 1 },
      latestSupervisor: null,
    },
  });

  expect(await screen.findByText("Continue your last task")).toBeInTheDocument();
  expect(screen.getByText("Run tests")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the home-summary and welcome tests to verify they fail**

Run: `pnpm exec vitest run packages/server/src/commands/home.test.ts packages/web/src/features/welcome/index.test.tsx packages/web/src/features/welcome/components/return-summary-card.test.tsx`

Expected: FAIL because `home.summary` and the returning summary card do not exist yet

- [ ] **Step 3: Implement the returning summary DTO, command, and welcome variant**

```ts
// packages/core/src/domain/types.ts
export interface HomeSummaryDto {
  lastViewedTarget: WorkspaceLastViewedTarget | null;
  latestSession: {
    id: string;
    title: string;
    providerId: string;
    state: string;
    lastActiveAt: number;
  } | null;
  latestSupervisor: {
    id: string;
    objective: string;
    state: string;
    sessionId: string;
  } | null;
}
```

```ts
// packages/server/src/commands/home.ts
registerCommand("home.summary", z.object({}), async (_args, ctx) => {
  const lastViewedTarget = readLastViewedTarget(ctx.db);
  if (!lastViewedTarget) {
    return {
      lastViewedTarget: null,
      latestSession: null,
      latestSupervisor: null,
    };
  }

  const sessions = ctx.sessionMgr.getForWorkspace(lastViewedTarget.workspaceId);
  const latestSession =
    sessions.find((session) => session.id === lastViewedTarget.sessionId) ??
    sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0] ??
    null;

  return {
    lastViewedTarget,
    latestSession: latestSession
      ? {
          id: latestSession.id,
          title: latestSession.title ?? "Untitled session",
          providerId: latestSession.providerId,
          state: latestSession.state,
          lastActiveAt: latestSession.lastActiveAt,
        }
      : null,
    latestSupervisor: latestSession ? summarizeSupervisor(ctx.supervisorMgr.getBySession(latestSession.id)) : null,
  };
});
```

```tsx
// packages/web/src/features/welcome/index.tsx
if (homeSummary?.latestSession) {
  return (
    <ReturnSummaryCard
      summary={homeSummary}
      onResume={() => navigate("/workspace")}
      onOpenSettings={handleOpenSettings}
    />
  );
}
```

- [ ] **Step 4: Run the home-summary and welcome tests to verify the returning flow passes**

Run: `pnpm exec vitest run packages/server/src/commands/home.test.ts packages/web/src/features/welcome/index.test.tsx packages/web/src/features/welcome/components/return-summary-card.test.tsx`

Expected: PASS with a resume-ready welcome state

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/commands/home.ts packages/server/src/commands/home.test.ts packages/server/src/commands/index.ts packages/core/src/domain/types.ts packages/web/src/hooks/use-bootstrap.ts packages/web/src/features/welcome/index.tsx packages/web/src/features/welcome/components/return-summary-card.tsx packages/web/src/features/welcome/components/return-summary-card.test.tsx packages/web/src/features/welcome/index.test.tsx packages/web/src/features/workspace/views/shared/workspace-route-gate.tsx
git commit -m "feat: add returning welcome summary"
```

### Task 7: Add Supervisor quick-start templates and run the final regression sweep

**Files:**
- Modify: `packages/web/src/features/supervisor/actions/use-objective-dialog-state.ts`
- Modify: `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`
- Modify: `packages/web/src/features/supervisor/components/supervisor-card.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Write the failing supervisor quick-start test**

```tsx
it("prefills the enable dialog when a quick-start template is clicked", async () => {
  render(
    <Provider store={store}>
      <SupervisorCard sessionId="sess-1" workspaceId="ws-1" />
    </Provider>
  );

  fireEvent.click(screen.getByRole("button", { name: "Enable Supervisor" }));
  fireEvent.click(screen.getByRole("button", { name: "Run tests and summarize failures" }));

  expect(screen.getByLabelText("Objective")).toHaveValue(
    "Run the relevant tests, summarize failures, and decide whether to continue automatically or stop for review."
  );
});
```

- [ ] **Step 2: Run the supervisor test to verify it fails**

Run: `pnpm exec vitest run packages/web/src/features/supervisor/components/supervisor-card.test.tsx`

Expected: FAIL because the dialog does not expose preset templates yet

- [ ] **Step 3: Add template support to the objective dialog state and content**

```ts
// packages/web/src/features/supervisor/actions/use-objective-dialog-state.ts
export const SUPERVISOR_OBJECTIVE_TEMPLATES = [
  {
    id: "run_tests",
    labelKey: "supervisor.template.run_tests",
    objective:
      "Run the relevant tests, summarize failures, and decide whether to continue automatically or stop for review.",
  },
  {
    id: "review_code",
    labelKey: "supervisor.template.review_code",
    objective:
      "Review the current code changes, summarize the most important risks, and stop if manual intervention is needed.",
  },
  {
    id: "background_progress",
    labelKey: "supervisor.template.background_progress",
    objective:
      "Keep evaluating the session in the background and report when progress stalls or a human decision is needed.",
  },
] as const;
```

```tsx
// packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx
<div className="supervisor-template-row">
  {SUPERVISOR_OBJECTIVE_TEMPLATES.map((template) => (
    <button
      key={template.id}
      type="button"
      className="supervisor-template-chip"
      onClick={() => onDraftObjectiveChange(template.objective)}
    >
      {t(template.labelKey)}
    </button>
  ))}
</div>
```

- [ ] **Step 4: Run the supervisor test suite and then the targeted final regression sweep**

Run: `pnpm exec vitest run packages/web/src/features/supervisor/components/supervisor-card.test.tsx packages/web/src/features/welcome/index.test.tsx packages/web/src/features/setup/views/setup-page.test.tsx packages/web/src/features/mobile-access/views/mobile-access-assistant.test.tsx packages/server/src/commands/setup.test.ts packages/server/src/commands/home.test.ts`

Expected: PASS with supervisor templates plus the core activation path still green

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/supervisor/actions/use-objective-dialog-state.ts packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx packages/web/src/features/supervisor/components/supervisor-card.test.tsx packages/web/src/locales/en.json packages/web/src/locales/zh.json
git commit -m "feat: add supervisor quick start templates"
```

## Self-Review

### Spec coverage

The plan covers each requirement from the spec:

- welcome rewrite and setup-first positioning: Task 1
- setup wizard and environment doctor: Tasks 1 through 3
- workspace readiness cleanup: Task 3
- provider readiness and first-task templates: Task 4
- mobile access assistant and phone continuation: Task 5
- return summary and resume: Task 6
- supervisor quick-start: Task 7

No spec requirement is intentionally left without a task.

### Placeholder scan

This plan avoids `TODO`, `TBD`, and similar placeholders. Each task names exact files, exact tests, specific command names, and specific UI strings or DTOs.

### Type consistency

The plan uses these stable names throughout:

- `SetupCheckDto`
- `SetupCheckStatus`
- `MobileAccessStatusDto`
- `HomeSummaryDto`
- `setup.status`
- `setup.mobileAccessStatus`
- `home.summary`

Do not rename them mid-implementation without updating all later tasks.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-14-conversion-first-activation.md`.

Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
