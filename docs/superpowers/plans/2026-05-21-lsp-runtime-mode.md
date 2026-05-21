# LSP Runtime Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global `LSP Runtime Mode` setting with `Auto` and `Off`, where `Off` immediately disposes active LSP sessions, prevents future LSP startup, and keeps plain editing usable.

**Architecture:** Extend the shared LSP domain with an explicit runtime mode and disabled readiness state, make `LspManager` the backend authority for runtime mode enforcement, expose a dedicated `lsp.setMode` runtime command, and hydrate a frontend runtime atom that controls Monaco LSP attachment in real time. Persistence remains in `settings.update`; immediate application is handled by the new runtime command.

**Tech Stack:** TypeScript, Vitest, Zod, Jotai, React, Monaco, existing websocket command dispatch.

---

## File Structure

### Shared Types

- Modify: `packages/core/src/domain/lsp.ts`
- Modify: `packages/core/src/domain/lsp.test.ts`

### Backend

- Modify: `packages/server/src/commands/settings.ts`
- Modify: `packages/server/src/commands/settings.test.ts`
- Modify: `packages/server/src/commands/lsp.ts`
- Modify: `packages/server/src/__tests__/lsp-commands.test.ts`
- Modify: `packages/server/src/lsp/manager.ts`
- Modify: `packages/server/src/lsp/manager.test.ts`
- Modify: `packages/server/src/server.ts`

### Frontend

- Create: `packages/web/src/features/code-editor/lsp/runtime-mode.ts`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/features/code-editor/components/monaco-host.tsx`
- Modify: `packages/web/src/features/code-editor/components/monaco-host.test.tsx`
- Modify: `packages/web/src/features/code-editor/lsp/bridge.ts`
- Modify: `packages/web/src/features/code-editor/lsp/bridge.test.tsx`
- Modify: `packages/web/src/features/code-editor/components/lsp-status-notice.tsx`
- Modify: `packages/web/src/features/code-editor/components/lsp-status-notice.test.tsx`

### Optional E2E Follow-Up

- Modify: `e2e/specs/settings/general.spec.ts`
- Modify or create: `e2e/specs/workspace/editor-lsp-runtime-mode.spec.ts`

## Task 1: Add Shared Runtime Mode Types

**Files:**
- Modify: `packages/core/src/domain/lsp.ts`
- Test: `packages/core/src/domain/lsp.test.ts`

- [ ] **Step 1: Write the failing shared-type test**

Add assertions in `packages/core/src/domain/lsp.test.ts` that require:

```ts
expectTypeOf<LspRuntimeMode>().toEqualTypeOf<"auto" | "off">();

expectTypeOf<LspEnsureSessionResult>().toEqualTypeOf<
  | { kind: "unsupported_language" }
  | {
      kind: "disabled";
      mode: "off";
      message: string;
    }
  | {
      kind: "ready";
      summary: LspSessionSummary;
      displayName: string;
      source: LspToolSource;
    }
  | {
      kind: "tool_missing" | "installing" | "failed";
      serverKind: "typescript" | "python" | "go" | "rust";
      displayName: string;
      errorCode:
        | "lsp_tool_missing"
        | "lsp_prerequisite_missing"
        | "lsp_install_in_progress"
        | "lsp_install_failed"
        | "lsp_start_failed";
      message: string;
      autoInstallSupported: boolean;
      missingCommands: string[];
      missingPrerequisites: string[];
      installJob?: LspToolInstallJobSnapshot;
    }
>();
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run packages/core/src/domain/lsp.test.ts
```

Expected: FAIL because `LspRuntimeMode` and the disabled union member do not exist yet.

- [ ] **Step 3: Write the minimal shared implementation**

Update `packages/core/src/domain/lsp.ts` to add:

```ts
export type LspRuntimeMode = "auto" | "off";
```

and expand `LspEnsureSessionResult` with:

```ts
  | {
      kind: "disabled";
      mode: "off";
      message: string;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run packages/core/src/domain/lsp.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/domain/lsp.ts packages/core/src/domain/lsp.test.ts
git commit -m "feat: add lsp runtime mode shared types"
```

## Task 2: Persist `lsp.mode` Through Settings

**Files:**
- Modify: `packages/server/src/commands/settings.ts`
- Test: `packages/server/src/commands/settings.test.ts`

- [ ] **Step 1: Write the failing settings tests**

Add tests in `packages/server/src/commands/settings.test.ts` that:

```ts
it("settings.update persists lsp.mode into the file-backed settings store", async () => {
  const result = await dispatch(
    {
      kind: "command",
      id: "settings-update-lsp-mode",
      op: "settings.update",
      args: {
        settings: {
          lsp: {
            mode: "off",
          },
        },
      },
    },
    ctx
  );

  expect(result.ok).toBe(true);
  expect(settingsRepo.get("lsp.mode")).toBe("off");
});

it("settings.get returns the persisted lsp.mode value", async () => {
  settingsRepo.set("lsp.mode", "auto");

  const result = await dispatch(
    {
      kind: "command",
      id: "settings-get-lsp-mode",
      op: "settings.get",
      args: {},
    },
    ctx
  );

  expect(result.ok).toBe(true);
  expect(result.data).toMatchObject({
    "lsp.mode": "auto",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run packages/server/src/commands/settings.test.ts
```

Expected: FAIL because the settings schema rejects `lsp.mode`.

- [ ] **Step 3: Write the minimal settings implementation**

Update `packages/server/src/commands/settings.ts` so `SettingsSchema` includes:

```ts
  lsp: z
    .object({
      mode: z.enum(["auto", "off"]).optional(),
    })
    .optional(),
```

No special flattening logic is needed because the existing `flattenSettings()` helper already handles nested objects.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run packages/server/src/commands/settings.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/commands/settings.ts packages/server/src/commands/settings.test.ts
git commit -m "feat: persist lsp runtime mode in settings"
```

## Task 3: Add Backend Runtime Mode Enforcement

**Files:**
- Modify: `packages/server/src/lsp/manager.ts`
- Test: `packages/server/src/lsp/manager.test.ts`

- [ ] **Step 1: Write the failing manager tests**

Add tests in `packages/server/src/lsp/manager.test.ts` for:

```ts
it("returns disabled when runtime mode is off", async () => {
  const manager = new LspManager(/* existing deps */);

  await manager.setRuntimeMode("off");

  await expect(
    manager.ensureSession({
      workspaceId: "ws-1",
      path: "e2e/fixtures/lsp-workspace/shared.ts",
    })
  ).resolves.toEqual({
    kind: "disabled",
    mode: "off",
    message: "LSP is disabled by runtime mode",
  });
});

it("disposes active sessions immediately when switching to off", async () => {
  const stop = vi.fn(async () => {});
  const manager = new LspManager({
    /* existing deps */
    createSession: vi.fn(() => ({
      start: async () => readySummary,
      stop,
      getSummary: () => readySummary,
      openDocument: async () => 1,
      changeDocument: async () => 2,
      closeDocument: async () => {},
      definition: async () => [],
      declaration: async () => [],
      typeDefinition: async () => [],
      references: async () => [],
      hover: async () => null,
      documentSymbols: async () => [],
    })),
  });

  await manager.ensureSession({
    workspaceId: "ws-1",
    path: "e2e/fixtures/lsp-workspace/shared.ts",
  });

  expect(manager.getSessionCount()).toBe(1);

  await manager.setRuntimeMode("off");

  expect(manager.getSessionCount()).toBe(0);
  expect(stop).toHaveBeenCalledTimes(1);
});
```

Also add a test that `openDocument()` returns `null` and does not create a session while off.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run packages/server/src/lsp/manager.test.ts
```

Expected: FAIL because `setRuntimeMode()` and disabled behavior do not exist.

- [ ] **Step 3: Write the minimal manager implementation**

Update `packages/server/src/lsp/manager.ts` to:

- import `LspRuntimeMode`
- add:

```ts
private runtimeMode: LspRuntimeMode = "auto";
```

- add:

```ts
async setRuntimeMode(mode: LspRuntimeMode): Promise<void> {
  this.runtimeMode = mode;
  if (mode === "off") {
    await this.disposeAll();
  }
}

getRuntimeMode(): LspRuntimeMode {
  return this.runtimeMode;
}
```

- short-circuit `ensureSession()`:

```ts
if (this.runtimeMode === "off") {
  return {
    kind: "disabled",
    mode: "off",
    message: "LSP is disabled by runtime mode",
  };
}
```

- short-circuit `openDocument`, `changeDocument`, `definition`, `declaration`, `typeDefinition`, `references`, `hover`, and `documentSymbols` to return `null` immediately while off

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run packages/server/src/lsp/manager.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/lsp/manager.ts packages/server/src/lsp/manager.test.ts
git commit -m "feat: enforce lsp runtime mode in manager"
```

## Task 4: Expose `lsp.setMode` and Hydrate Startup Mode

**Files:**
- Modify: `packages/server/src/commands/lsp.ts`
- Modify: `packages/server/src/__tests__/lsp-commands.test.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Write the failing command-level tests**

Extend `FakeLspManager` in `packages/server/src/__tests__/lsp-commands.test.ts`:

```ts
class FakeLspManager {
  mode: "auto" | "off" = "auto";

  async setRuntimeMode(mode: "auto" | "off") {
    this.mode = mode;
  }

  getRuntimeMode() {
    return this.mode;
  }

  // existing methods...
}
```

Add a command test:

```ts
it("applies lsp runtime mode through lsp.setMode", async () => {
  const result = await dispatch(
    {
      kind: "command",
      id: crypto.randomUUID(),
      op: "lsp.setMode",
      args: { mode: "off" },
    },
    ctx
  );

  expect(result.ok).toBe(true);
  expect(result.data).toEqual({ mode: "off" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run packages/server/src/__tests__/lsp-commands.test.ts
```

Expected: FAIL because `lsp.setMode` is not registered.

- [ ] **Step 3: Write the minimal command and startup implementation**

Add to `packages/server/src/commands/lsp.ts`:

```ts
registerCommand(
  "lsp.setMode",
  z.object({
    mode: z.enum(["auto", "off"]),
  }),
  async (args, ctx) => {
    await ctx.lspMgr.setRuntimeMode(args.mode);
    return { mode: ctx.lspMgr.getRuntimeMode() };
  }
);
```

Hydrate startup mode in `packages/server/src/server.ts` after creating `lspMgr`:

```ts
const persistedLspMode = settingsRepo.get<"auto" | "off">("lsp.mode");
if (persistedLspMode === "off") {
  await lspMgr.setRuntimeMode("off");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run packages/server/src/__tests__/lsp-commands.test.ts
pnpm --filter @coder-studio/server exec vitest run packages/server/src/lsp/manager.test.ts packages/server/src/commands/settings.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/commands/lsp.ts packages/server/src/__tests__/lsp-commands.test.ts packages/server/src/server.ts
git commit -m "feat: add lsp runtime mode command and startup hydration"
```

## Task 5: Add Frontend Runtime Mode Atom and Settings Hydration

**Files:**
- Create: `packages/web/src/features/code-editor/lsp/runtime-mode.ts`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Test: `packages/web/src/features/settings/components/settings-page.test.tsx`

- [ ] **Step 1: Write the failing settings-page tests**

Add tests in `packages/web/src/features/settings/components/settings-page.test.tsx`:

```ts
it("hydrates lsp runtime mode from settings.get", async () => {
  const sendCommand = vi.fn(async (op: string) => {
    if (op === "settings.get") {
      return { "lsp.mode": "off" };
    }
    return {};
  });

  renderSettingsPage(createConnectedStore(sendCommand));

  expect(await screen.findByText("LSP Runtime Mode")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
});

it("persists and applies lsp runtime mode before updating the local selection", async () => {
  const sendCommand = vi.fn(async (op: string) => {
    if (op === "settings.get") {
      return { "lsp.mode": "auto" };
    }
    if (op === "settings.update") {
      return { updated: ["lsp.mode"] };
    }
    if (op === "lsp.setMode") {
      return { mode: "off" };
    }
    return {};
  });

  renderSettingsPage(createConnectedStore(sendCommand));

  fireEvent.click(await screen.findByRole("button", { name: "Off" }));

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith("settings.update", {
      settings: {
        lsp: {
          mode: "off",
        },
      },
    });
    expect(sendCommand).toHaveBeenCalledWith("lsp.setMode", { mode: "off" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run packages/web/src/features/settings/components/settings-page.test.tsx
```

Expected: FAIL because no LSP runtime mode control or state exists.

- [ ] **Step 3: Write the minimal frontend settings implementation**

Create `packages/web/src/features/code-editor/lsp/runtime-mode.ts`:

```ts
import { atom } from "jotai";
import type { LspRuntimeMode } from "@coder-studio/core";

export const lspRuntimeModeAtom = atom<LspRuntimeMode>("auto");
```

Update `packages/web/src/features/settings/components/settings-page.tsx` to:

- import `LspRuntimeMode` and `lspRuntimeModeAtom`
- hydrate `lsp.mode` from `settings.get`
- add local state for current LSP mode
- render a new General settings pill group
- on click:
  - call `settings.update({ lsp: { mode: nextMode } })`
  - then call `lsp.setMode({ mode: nextMode })`
  - only after both succeed, update local state and `lspRuntimeModeAtom`

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run packages/web/src/features/settings/components/settings-page.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/code-editor/lsp/runtime-mode.ts packages/web/src/features/settings/components/settings-page.tsx packages/web/src/features/settings/components/settings-page.test.tsx
git commit -m "feat: add lsp runtime mode settings control"
```

## Task 6: Disable Monaco LSP Attachment in Real Time

**Files:**
- Modify: `packages/web/src/features/code-editor/components/monaco-host.tsx`
- Test: `packages/web/src/features/code-editor/components/monaco-host.test.tsx`

- [ ] **Step 1: Write the failing Monaco host tests**

Add tests in `packages/web/src/features/code-editor/components/monaco-host.test.tsx`:

```ts
it("does not attach the lsp bridge when runtime mode is off", async () => {
  const store = createStore();
  store.set(lspRuntimeModeAtom, "off");

  render(
    <Provider store={store}>
      <MonacoHost
        workspaceId="ws-test"
        workspaceRootPath="/repo"
        filePath="src/example.ts"
        content="export const a = 1;"
      />
    </Provider>
  );

  await waitFor(() => {
    expect(mockAttachLspBridgeModel).not.toHaveBeenCalled();
  });
});

it("detaches an existing lsp handle when runtime mode switches from auto to off", async () => {
  const detach = vi.fn();
  mockAttachLspBridgeModel.mockImplementationOnce(() =>
    Object.assign(detach, {
      install: vi.fn(async () => {}),
      retry: vi.fn(async () => {}),
    })
  );

  const store = createStore();
  store.set(lspRuntimeModeAtom, "auto");

  const view = render(
    <Provider store={store}>
      <MonacoHost
        workspaceId="ws-test"
        workspaceRootPath="/repo"
        filePath="src/example.ts"
        content="export const a = 1;"
      />
    </Provider>
  );

  await waitFor(() => {
    expect(mockAttachLspBridgeModel).toHaveBeenCalledTimes(1);
  });

  act(() => {
    store.set(lspRuntimeModeAtom, "off");
  });

  await waitFor(() => {
    expect(detach).toHaveBeenCalledTimes(1);
  });

  view.unmount();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run packages/web/src/features/code-editor/components/monaco-host.test.tsx
```

Expected: FAIL because `MonacoHost` does not read runtime mode.

- [ ] **Step 3: Write the minimal Monaco host implementation**

Update `packages/web/src/features/code-editor/components/monaco-host.tsx` to:

- import and read `lspRuntimeModeAtom`
- gate the attach effect on `lspRuntimeMode === "auto"`
- set a neutral local state when `lspRuntimeMode === "off"`

The attach effect condition should become equivalent to:

```ts
if (!model || !isWorkspaceBacked || !workspaceId || !workspaceRootPath || lspRuntimeMode !== "auto") {
  return;
}
```

Add a small effect:

```ts
useEffect(() => {
  if (lspRuntimeMode === "off") {
    setLspState({ kind: "unsupported_language" });
  }
}, [lspRuntimeMode]);
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run packages/web/src/features/code-editor/components/monaco-host.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/code-editor/components/monaco-host.tsx packages/web/src/features/code-editor/components/monaco-host.test.tsx
git commit -m "feat: detach monaco lsp on runtime mode off"
```

## Task 7: Handle Disabled Readiness in the LSP Bridge and Notice UI

**Files:**
- Modify: `packages/web/src/features/code-editor/lsp/bridge.ts`
- Modify: `packages/web/src/features/code-editor/lsp/bridge.test.tsx`
- Modify: `packages/web/src/features/code-editor/components/lsp-status-notice.tsx`
- Modify: `packages/web/src/features/code-editor/components/lsp-status-notice.test.tsx`

- [ ] **Step 1: Write the failing bridge and notice tests**

Add a bridge test in `packages/web/src/features/code-editor/lsp/bridge.test.tsx`:

```ts
it("does not open a document when ensureSession returns disabled", async () => {
  const sendCommand = vi
    .fn()
    .mockResolvedValueOnce({
      kind: "disabled",
      mode: "off",
      message: "LSP is disabled by runtime mode",
    });

  const bridge = createLspBridge({
    sendCommand: sendCommand as BridgeSendCommand,
    subscribe: vi.fn(() => () => {}),
  });

  bridge.attachModel({
    workspaceId: "ws-1",
    workspaceRootPath: "/repo",
    path: "e2e/fixtures/lsp-workspace/shared.ts",
    monacoLanguage: "typescript",
    model: createMockModel("export const sharedValue = 1;\\n"),
  });

  await vi.waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith("lsp.ensureSession", {
      workspaceId: "ws-1",
      path: "e2e/fixtures/lsp-workspace/shared.ts",
    });
  });

  expect(sendCommand).not.toHaveBeenCalledWith("lsp.openDocument", expect.anything());
});
```

Add a notice test in `packages/web/src/features/code-editor/components/lsp-status-notice.test.tsx`:

```tsx
it("renders a disabled notice without install or retry actions", () => {
  render(
    <LspStatusNotice
      state={{
        kind: "disabled",
        mode: "off",
        message: "LSP is turned off in Settings to reduce memory usage.",
      }}
      onInstall={vi.fn()}
      onRetry={vi.fn()}
      installing={false}
    />
  );

  expect(screen.getByText("Language server disabled")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run packages/web/src/features/code-editor/lsp/bridge.test.tsx packages/web/src/features/code-editor/components/lsp-status-notice.test.tsx
```

Expected: FAIL because disabled readiness is not handled.

- [ ] **Step 3: Write the minimal bridge and notice implementation**

Update `packages/web/src/features/code-editor/lsp/bridge.ts` so `ensureReady()`:

- propagates the `disabled` state via `onStateChange`
- does not schedule install polling
- does not call `lsp.openDocument`

Update `packages/web/src/features/code-editor/components/lsp-status-notice.tsx` to render:

```tsx
if (state.kind === "disabled") {
  return (
    <Notice
      title="Language server disabled"
      message="LSP is turned off in Settings to reduce memory usage."
    />
  );
}
```

using the component pattern already present in the file.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run packages/web/src/features/code-editor/lsp/bridge.test.tsx packages/web/src/features/code-editor/components/lsp-status-notice.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/code-editor/lsp/bridge.ts packages/web/src/features/code-editor/lsp/bridge.test.tsx packages/web/src/features/code-editor/components/lsp-status-notice.tsx packages/web/src/features/code-editor/components/lsp-status-notice.test.tsx
git commit -m "feat: handle disabled lsp readiness in editor ui"
```

## Task 8: Verify End-to-End Integration

**Files:**
- Test: `packages/core/src/domain/lsp.test.ts`
- Test: `packages/server/src/commands/settings.test.ts`
- Test: `packages/server/src/lsp/manager.test.ts`
- Test: `packages/server/src/__tests__/lsp-commands.test.ts`
- Test: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Test: `packages/web/src/features/code-editor/components/monaco-host.test.tsx`
- Test: `packages/web/src/features/code-editor/lsp/bridge.test.tsx`
- Test: `packages/web/src/features/code-editor/components/lsp-status-notice.test.tsx`

- [ ] **Step 1: Run the targeted verification suite**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run packages/core/src/domain/lsp.test.ts
pnpm --filter @coder-studio/server exec vitest run packages/server/src/commands/settings.test.ts packages/server/src/lsp/manager.test.ts packages/server/src/__tests__/lsp-commands.test.ts
pnpm --filter @coder-studio/web exec vitest run packages/web/src/features/settings/components/settings-page.test.tsx packages/web/src/features/code-editor/components/monaco-host.test.tsx packages/web/src/features/code-editor/lsp/bridge.test.tsx packages/web/src/features/code-editor/components/lsp-status-notice.test.tsx
```

Expected: PASS

- [ ] **Step 2: Run typecheck for touched packages**

Run:

```bash
pnpm --filter @coder-studio/core exec tsc -p tsconfig.json --noEmit
pnpm --filter @coder-studio/server exec tsc -p tsconfig.json --noEmit
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "test: verify lsp runtime mode integration"
```

## Notes For Implementation

- Do not replace the existing idle TTL reclaim behavior in `auto`; the new mode is additive.
- Keep `LspManager` as the backend source of truth. Frontend cleanup improves UX but must not be the only guard.
- Do not optimize for localStorage-backed persistence for LSP mode. This setting should reflect server-backed state first.
- Avoid introducing a third visible mode in this implementation. `auto` and `off` are the entire product surface for this milestone.
