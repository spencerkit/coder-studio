# Terminal Font Size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted global terminal font-size setting that applies to shell terminals and agent session terminals, updates open terminals immediately, and validates values end-to-end.

**Architecture:** Extend the existing `appearance.*` settings pipeline with a new `appearance.terminalFontSize` integer, thread it through the lightweight `terminalPreferencesAtom`, and let `XtermHost` treat font size as a live xterm runtime option. Reuse the current settings page numeric-input pattern and the existing stale-hydration guards in `AppProviders` and `SettingsPage` so user changes do not get overwritten by delayed `settings.get` responses.

**Tech Stack:** TypeScript, React, Jotai, xterm.js, Zod, Vitest, Testing Library

---

## File Structure

- Modify: `packages/server/src/commands/settings.ts`
  - Accept and validate `appearance.terminalFontSize`.
- Modify: `packages/server/src/commands/settings.test.ts`
  - Add persistence and validation coverage for the new setting.
- Modify: `packages/web/src/features/terminal-panel/preferences.ts`
  - Extend terminal preferences with font-size constants, resolver, and default state.
- Modify: `packages/web/src/app/providers.tsx`
  - Hydrate `terminalPreferencesAtom.fontSize` from `settings.get` and preserve local updates.
- Modify: `packages/web/src/app/providers.lifecycle.test.tsx`
  - Add hydration and stale-response regressions for font size.
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
  - Add local state, validation, save flow, and UI for terminal font size.
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
  - Add UI, validation, atom-sync, and stale-response tests for font size.
- Modify: `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
  - Initialize xterm with the configured font size and update `terminal.options.fontSize` at runtime.
- Modify: `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`
  - Add runtime font-size behavior tests and update terminal preference fixtures.
- Modify: `packages/web/src/locales/zh.json`
  - Add Chinese settings copy for terminal font size.
- Modify: `packages/web/src/locales/en.json`
  - Add English settings copy for terminal font size.

## Task 1: Lock The Server Contract In Tests

**Files:**
- Modify: `packages/server/src/commands/settings.test.ts`
- Test: `packages/server/src/commands/settings.test.ts`

- [ ] **Step 1: Write the failing persistence test for `appearance.terminalFontSize`**

Add this test near the existing appearance-setting coverage:

```ts
  it("settings.update persists appearance.terminalFontSize into user_settings", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "settings-update-terminal-font-size",
        op: "settings.update",
        args: {
          settings: {
            appearance: {
              terminalFontSize: 14,
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(
      db
        .prepare("SELECT value FROM user_settings WHERE key = ?")
        .get("appearance.terminalFontSize")
    ).toEqual({ value: "14" });
  });
```

- [ ] **Step 2: Write the failing validation tests for out-of-range and fractional values**

Add the invalid cases immediately after the persistence test:

```ts
  it("settings.update rejects appearance.terminalFontSize below the supported minimum", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "settings-update-terminal-font-size-too-small",
        op: "settings.update",
        args: {
          settings: {
            appearance: {
              terminalFontSize: 9,
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation_error");
    expect(
      db
        .prepare("SELECT value FROM user_settings WHERE key = ?")
        .get("appearance.terminalFontSize")
    ).toBeUndefined();
  });

  it("settings.update rejects appearance.terminalFontSize above the supported maximum", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "settings-update-terminal-font-size-too-large",
        op: "settings.update",
        args: {
          settings: {
            appearance: {
              terminalFontSize: 19,
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation_error");
  });

  it("settings.update rejects fractional appearance.terminalFontSize values", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "settings-update-terminal-font-size-fractional",
        op: "settings.update",
        args: {
          settings: {
            appearance: {
              terminalFontSize: 12.5,
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation_error");
  });
```

- [ ] **Step 3: Run the server settings tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server test -- packages/server/src/commands/settings.test.ts
```

Expected:

- FAIL because `SettingsSchema.appearance` does not yet accept `terminalFontSize`

- [ ] **Step 4: Implement the minimal server schema change**

Update `packages/server/src/commands/settings.ts` inside `SettingsSchema.appearance`:

```ts
const SettingsSchema = z.object({
  defaultProviderId: z.string().optional(),
  notifications: z
    .object({
      enabled: z.boolean().optional(),
      soundEnabled: z.boolean().optional(),
      onlyWhenBackgrounded: z.boolean().optional(),
    })
    .optional(),
  supervisor: z
    .object({
      evaluationTimeoutSec: z
        .number()
        .int()
        .min(1)
        .max(MAX_SUPERVISOR_EVALUATION_TIMEOUT_SEC)
        .default(DEFAULT_SUPERVISOR_EVALUATION_TIMEOUT_SEC)
        .optional(),
      retryEnabled: z.boolean().optional(),
      retryMaxCount: z.number().int().min(0).max(MAX_SUPERVISOR_RETRY_MAX_COUNT).optional(),
      retryDelaySec: z.number().int().min(1).max(MAX_SUPERVISOR_RETRY_DELAY_SEC).optional(),
      retryOnTimeout: z.boolean().optional(),
      retryOnEvaluatorError: z.boolean().optional(),
    })
    .optional(),
  appearance: z
    .object({
      theme: z.enum(["dark", "light"]).optional(),
      themeId: z.string().optional(),
      terminalRenderer: z.enum(["standard", "compatibility"]).optional(),
      terminalCopyOnSelect: z.boolean().optional(),
      terminalFontSize: z.number().int().min(10).max(18).optional(),
      locale: z.enum(["zh", "en"]).optional(),
    })
    .optional(),
  providers: ProviderSettingsSchema.optional(),
});
```

- [ ] **Step 5: Re-run the server settings tests**

Run:

```bash
pnpm --filter @coder-studio/server test -- packages/server/src/commands/settings.test.ts
```

Expected:

- PASS for the new terminal font-size persistence and validation tests
- PASS for existing settings command coverage

- [ ] **Step 6: Commit the server contract**

```bash
git add packages/server/src/commands/settings.ts packages/server/src/commands/settings.test.ts
git commit -m "feat(server): validate terminal font size setting"
```

## Task 2: Extend Terminal Preferences And Provider Hydration

**Files:**
- Modify: `packages/web/src/features/terminal-panel/preferences.ts`
- Modify: `packages/web/src/app/providers.tsx`
- Modify: `packages/web/src/app/providers.lifecycle.test.tsx`

- [ ] **Step 1: Write the failing preference resolver tests via provider lifecycle**

Add these tests to `packages/web/src/app/providers.lifecycle.test.tsx` near the existing terminal copy-on-select hydration tests:

```tsx
  it("hydrates terminal font-size preferences from settings.get once connected", async () => {
    const store = createStore();
    setVisibilityState("visible");

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.terminalCopyOnSelect": true,
          "appearance.terminalFontSize": 15,
        };
      }

      return undefined;
    });
    wsState.client!.sendCommand = sendCommand;

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    act(() => {
      wsState.client?.statusHandler?.("connected");
    });

    await vi.waitFor(() => {
      expect(store.get(terminalPreferencesAtom)).toEqual({
        copyOnSelect: true,
        fontSize: 15,
      });
    });
  });

  it("preserves a newer local terminal font-size update when startup hydration resolves later", async () => {
    const store = createStore();
    setVisibilityState("visible");

    let resolveSettingsGet: ((value: Record<string, unknown>) => void) | undefined;
    const settingsGetPromise = new Promise<Record<string, unknown>>((resolve) => {
      resolveSettingsGet = resolve;
    });
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return await settingsGetPromise;
      }

      return undefined;
    });
    wsState.client!.sendCommand = sendCommand;

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    act(() => {
      wsState.client?.statusHandler?.("connected");
    });

    await vi.waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("settings.get", {}, undefined);
    });

    act(() => {
      store.set(terminalPreferencesAtom, { copyOnSelect: false, fontSize: 16 });
    });

    await act(async () => {
      resolveSettingsGet?.({
        "appearance.terminalFontSize": 11,
      });
      await settingsGetPromise;
    });

    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: false,
      fontSize: 16,
    });
  });
```

- [ ] **Step 2: Run the provider lifecycle tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/app/providers.lifecycle.test.tsx
```

Expected:

- FAIL because `terminalPreferencesAtom` has no `fontSize`
- FAIL because hydration only writes `copyOnSelect`

- [ ] **Step 3: Implement terminal preference constants, defaults, and resolver**

Replace `packages/web/src/features/terminal-panel/preferences.ts` with this shape:

```ts
import { atomWithStorage } from "jotai/utils";

export const DEFAULT_TERMINAL_FONT_SIZE = 11;
export const MIN_TERMINAL_FONT_SIZE = 10;
export const MAX_TERMINAL_FONT_SIZE = 18;

export interface TerminalPreferences {
  copyOnSelect: boolean;
  fontSize: number;
}

export const DEFAULT_TERMINAL_PREFERENCES: TerminalPreferences = {
  copyOnSelect: false,
  fontSize: DEFAULT_TERMINAL_FONT_SIZE,
};

export function resolveTerminalCopyOnSelectSetting(settings: Record<string, unknown>): boolean {
  const value = settings["appearance.terminalCopyOnSelect"];
  return typeof value === "boolean" ? value : DEFAULT_TERMINAL_PREFERENCES.copyOnSelect;
}

export function resolveTerminalFontSizeSetting(settings: Record<string, unknown>): number {
  const value = settings["appearance.terminalFontSize"];
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_TERMINAL_FONT_SIZE &&
    value <= MAX_TERMINAL_FONT_SIZE
  ) {
    return value;
  }

  return DEFAULT_TERMINAL_FONT_SIZE;
}

export const terminalPreferencesAtom = atomWithStorage<TerminalPreferences>(
  "ui.terminalPreferences",
  DEFAULT_TERMINAL_PREFERENCES
);
```

- [ ] **Step 4: Hydrate both terminal preference fields in `AppProviders`**

Update the terminal preference hydration block in `packages/web/src/app/providers.tsx`:

```tsx
import {
  resolveTerminalCopyOnSelectSetting,
  resolveTerminalFontSizeSetting,
  terminalPreferencesAtom,
} from "../features/terminal-panel/preferences";

// ...

      setTerminalPreferences({
        copyOnSelect: resolveTerminalCopyOnSelectSetting(result.data),
        fontSize: resolveTerminalFontSizeSetting(result.data),
      });
```

Keep the existing `localTerminalPreferencesUpdated` guard unchanged so delayed `settings.get` results do not overwrite user updates.

- [ ] **Step 5: Normalize provider lifecycle fixtures to the expanded atom shape**

Update every `terminalPreferencesAtom` set/get in `packages/web/src/app/providers.lifecycle.test.tsx` to include `fontSize`, for example:

```tsx
    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: true,
      fontSize: 11,
    });

    act(() => {
      store.set(terminalPreferencesAtom, { copyOnSelect: true, fontSize: 11 });
    });

    act(() => {
      store.set(terminalPreferencesAtom, { copyOnSelect: false, fontSize: 11 });
      store.set(terminalPreferencesAtom, { copyOnSelect: true, fontSize: 11 });
    });
```

- [ ] **Step 6: Re-run the provider lifecycle tests**

Run:

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/app/providers.lifecycle.test.tsx
```

Expected:

- PASS for the new font-size hydration and stale-response tests
- PASS for the existing copy-on-select and theme hydration tests

- [ ] **Step 7: Commit the preference hydration layer**

```bash
git add \
  packages/web/src/features/terminal-panel/preferences.ts \
  packages/web/src/app/providers.tsx \
  packages/web/src/app/providers.lifecycle.test.tsx
git commit -m "feat(web): hydrate global terminal font size"
```

## Task 3: Add Settings Page State, Validation, And Copy

**Files:**
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/locales/en.json`

- [ ] **Step 1: Write the failing settings page hydration and save tests**

Add these tests near the existing terminal renderer / copy-on-select tests in `packages/web/src/features/settings/components/settings-page.test.tsx`:

```tsx
  it("renders terminal font size from loaded general settings", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.terminalFontSize": 15,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "通用" }));

    await waitFor(() => {
      expect(screen.getByLabelText("终端字号")).toHaveValue(15);
    });
    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: false,
      fontSize: 15,
    });
  });

  it("updates terminal font size through the general settings input and syncs the global atom", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.terminalFontSize": 11,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "通用" }));

    const input = await screen.findByLabelText("终端字号");
    fireEvent.change(input, { target: { value: "16" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            appearance: {
              terminalFontSize: 16,
            },
          },
        },
        undefined
      );
    });

    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: false,
      fontSize: 16,
    });
  });
```

- [ ] **Step 2: Write the failing settings page validation and stale-response tests**

Add these tests in the same area:

```tsx
  it("rejects invalid terminal font size input and restores the last saved value", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.terminalFontSize": 11,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "通用" }));

    const input = await screen.findByLabelText("终端字号");
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(input).toHaveValue(11);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("请输入 10 到 18 之间的整数");
    expect(sendCommand).not.toHaveBeenCalledWith("settings.update", expect.anything(), undefined);
  });

  it("preserves terminal font size when a stale general settings load resolves afterward", async () => {
    let resolveSettingsGet: ((value: Record<string, unknown>) => void) | undefined;
    const settingsGetPromise = new Promise<Record<string, unknown>>((resolve) => {
      resolveSettingsGet = resolve;
    });
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return await settingsGetPromise;
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "通用" }));

    const input = await screen.findByLabelText("终端字号");
    fireEvent.change(input, { target: { value: "16" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            appearance: {
              terminalFontSize: 16,
            },
          },
        },
        undefined
      );
    });

    await act(async () => {
      resolveSettingsGet?.({
        "appearance.terminalFontSize": 11,
      });
      await settingsGetPromise;
    });

    expect(screen.getByLabelText("终端字号")).toHaveValue(16);
    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: false,
      fontSize: 16,
    });
  });
```

- [ ] **Step 3: Run the settings page tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/features/settings/components/settings-page.test.tsx
```

Expected:

- FAIL because there is no terminal font-size field
- FAIL because `terminalPreferencesAtom` does not yet carry `fontSize` through the settings page

- [ ] **Step 4: Implement settings page state, validation, and save flow**

In `packages/web/src/features/settings/components/settings-page.tsx`, add:

```tsx
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  resolveTerminalCopyOnSelectSetting,
  resolveTerminalFontSizeSetting,
  terminalPreferencesAtom,
} from "../../terminal-panel/preferences";

function parseTerminalFontSizeInput(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_TERMINAL_FONT_SIZE ||
    parsed > MAX_TERMINAL_FONT_SIZE
  ) {
    return null;
  }

  return parsed;
}
```

Extend page state and version tracking:

```tsx
  const appearanceSelectionVersionRef = useRef({
    theme: 0,
    locale: 0,
    terminalRenderer: 0,
    terminalCopyOnSelect: 0,
    terminalFontSize: 0,
  });
```

Hydrate from `settings.get` using the same stale-response guard:

```tsx
      if (
        appearanceSelectionVersionRef.current.terminalFontSize ===
        appearanceSelectionVersionAtRequestStart.terminalFontSize
      ) {
        const resolvedTerminalFontSize = resolveTerminalFontSizeSetting(settings);
        setTerminalPreferences((current) => ({
          ...current,
          fontSize: resolvedTerminalFontSize,
        }));
      }
```

Add a local selection helper:

```tsx
  const handleTerminalFontSizeSelection = (value: number) => {
    appearanceSelectionVersionRef.current.terminalFontSize += 1;
    setTerminalPreferences((current) => ({
      ...current,
      fontSize: value,
    }));
  };
```

Keep `copyOnSelect` updates merged instead of replacing the whole object:

```tsx
  const handleTerminalCopyOnSelectSelection = (value: boolean) => {
    appearanceSelectionVersionRef.current.terminalCopyOnSelect += 1;
    setTerminalPreferences((current) => ({
      ...current,
      copyOnSelect: value,
    }));
  };
```

- [ ] **Step 5: Render the input and localized copy in `GeneralSettings`**

Add localized strings:

```json
// packages/web/src/locales/zh.json
"terminal_font_size": "终端字号",
"terminal_font_size_hint": "应用到所有终端和会话",
"terminal_font_size_validation_error": "请输入 10 到 18 之间的整数"
```

```json
// packages/web/src/locales/en.json
"terminal_font_size": "Terminal font size",
"terminal_font_size_hint": "Applied to all terminals and sessions",
"terminal_font_size_validation_error": "Enter an integer between 10 and 18"
```

Add the `GeneralSettings` props and UI:

```tsx
interface GeneralSettingsProps {
  // ...
  terminalFontSize: number;
  setTerminalFontSize: (value: number) => void;
}

  const terminalFontSizeLabelId = useId();
  const terminalFontSizeDescId = useId();
  const [terminalFontSizeDraft, setTerminalFontSizeDraft] = useState(String(terminalFontSize));
  const [terminalFontSizeError, setTerminalFontSizeError] = useState<string | null>(null);

  useEffect(() => {
    setTerminalFontSizeDraft(String(terminalFontSize));
  }, [terminalFontSize]);

  useEffect(() => {
    setTerminalFontSizeError(null);
  }, [terminalFontSize]);

  const commitTerminalFontSize = async () => {
    const parsed = parseTerminalFontSizeInput(terminalFontSizeDraft);
    if (parsed === null) {
      setTerminalFontSizeDraft(String(terminalFontSize));
      setTerminalFontSizeError(t("settings.terminal_font_size_validation_error"));
      return;
    }

    if (parsed === terminalFontSize) {
      setTerminalFontSizeDraft(String(parsed));
      setTerminalFontSizeError(null);
      return;
    }

    const result = await saveSettings({
      appearance: {
        terminalFontSize: parsed,
      },
    });

    if (!result.ok) {
      setTerminalFontSizeDraft(String(terminalFontSize));
      setTerminalFontSizeError(result.error?.message || t("settings.config_files.save_failed"));
      return;
    }

    setTerminalFontSize(parsed);
    setTerminalFontSizeDraft(String(parsed));
    setTerminalFontSizeError(null);
  };
```

Render the field in the terminal settings group:

```tsx
        <div className="settings-config-field settings-config-field--inline">
          <label className="settings-config-label" htmlFor="terminal-font-size">
            {t("settings.terminal_font_size")}
          </label>
          <div className="settings-config-control">
            <Input
              id="terminal-font-size"
              aria-describedby={terminalFontSizeDescId}
              aria-labelledby={terminalFontSizeLabelId}
              className="settings-input-compact"
              type="number"
              min={MIN_TERMINAL_FONT_SIZE}
              max={MAX_TERMINAL_FONT_SIZE}
              step={1}
              inputMode="numeric"
              invalid={Boolean(terminalFontSizeError)}
              value={terminalFontSizeDraft}
              onChange={(event) => {
                setTerminalFontSizeDraft(event.target.value);
                if (terminalFontSizeError) {
                  setTerminalFontSizeError(null);
                }
              }}
              onBlur={() => {
                void commitTerminalFontSize();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitTerminalFontSize();
                }
              }}
            />
          </div>
          <span className="settings-toggle-desc" id={terminalFontSizeDescId}>
            {t("settings.terminal_font_size_hint")}
          </span>
          {terminalFontSizeError ? (
            <span className="form-error" role="alert">
              {terminalFontSizeError}
            </span>
          ) : null}
        </div>
```

- [ ] **Step 6: Normalize settings page terminal preference expectations**

Update existing `terminalPreferencesAtom` expectations in `packages/web/src/features/settings/components/settings-page.test.tsx` to include `fontSize: 11`, for example:

```tsx
    expect(store.get(terminalPreferencesAtom)).toEqual({
      copyOnSelect: true,
      fontSize: 11,
    });

    store.set(terminalPreferencesAtom, { copyOnSelect: true, fontSize: 11 });
```

- [ ] **Step 7: Re-run the settings page tests**

Run:

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/features/settings/components/settings-page.test.tsx
```

Expected:

- PASS for new terminal font-size UI and validation tests
- PASS for existing general and appearance settings tests

- [ ] **Step 8: Commit the settings page work**

```bash
git add \
  packages/web/src/features/settings/components/settings-page.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  packages/web/src/locales/zh.json \
  packages/web/src/locales/en.json
git commit -m "feat(web): add terminal font size setting"
```

## Task 4: Update XtermHost To Apply Font Size Live

**Files:**
- Modify: `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
- Modify: `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`

- [ ] **Step 1: Write the failing xterm host tests**

Add these tests to `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`:

```tsx
  it("creates the xterm instance with the configured terminal font size", () => {
    const store = createStore();
    store.set(terminalPreferencesAtom, { copyOnSelect: false, fontSize: 15 });

    render(
      <Provider store={store}>
        <XtermHost terminalId="font-size-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    expect(mockTerminal.options.fontSize).toBe(15);
  });

  it("updates terminal.options.fontSize when the global terminal font size changes", async () => {
    const store = createStore();
    store.set(terminalPreferencesAtom, { copyOnSelect: false, fontSize: 11 });

    render(
      <Provider store={store}>
        <XtermHost terminalId="live-font-size-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    expect(mockTerminal.options.fontSize).toBe(11);

    act(() => {
      store.set(terminalPreferencesAtom, { copyOnSelect: false, fontSize: 16 });
    });

    await waitFor(() => {
      expect(mockTerminal.options.fontSize).toBe(16);
      expect(mockFitAddon.fit).toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run the xterm host tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx
```

Expected:

- FAIL because `XtermHost` still hardcodes `fontSize: 11`
- FAIL because no runtime effect updates `terminal.options.fontSize`

- [ ] **Step 3: Implement live font-size support in `XtermHost`**

In `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`, use the atom value during terminal creation:

```tsx
    const terminal = new Terminal({
      theme: getThemeById(initialThemeRef.current).terminalTheme,
      fontFamily: "JetBrains Mono, Fira Code, SF Mono, monospace",
      fontSize: terminalPreferences.fontSize,
      scrollback: 5000,
      cursorBlink: isInteractive && !uploadBusy,
      cursorStyle: "block",
      disableStdin: !isInteractive || uploadBusy,
      allowProposedApi: true,
    });
```

Add a runtime update effect next to the existing theme effect:

```tsx
  useEffect(() => {
    if (!terminalRef.current) {
      return;
    }

    if (terminalRef.current.options.fontSize === terminalPreferences.fontSize) {
      return;
    }

    terminalRef.current.options.fontSize = terminalPreferences.fontSize;
    scheduleFit();
  }, [scheduleFit, terminalPreferences.fontSize]);
```

Do not modify `lineHeight`.

- [ ] **Step 4: Normalize xterm host terminal preference fixtures**

Update all `terminalPreferencesAtom` seeds in `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx` to include `fontSize: 11` unless a test needs another value, for example:

```tsx
    store.set(terminalPreferencesAtom, { copyOnSelect: true, fontSize: 11 });
    store.set(terminalPreferencesAtom, { copyOnSelect: false, fontSize: 11 });
```

- [ ] **Step 5: Re-run the xterm host tests**

Run:

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx
```

Expected:

- PASS for the new initialization and live-update tests
- PASS for existing copy-on-select, replay, and mobile-input tests

- [ ] **Step 6: Commit the xterm host changes**

```bash
git add \
  packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx \
  packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx
git commit -m "feat(web): apply terminal font size to xterm"
```

## Task 5: Final Verification And Integration Review

**Files:**
- Test: `packages/server/src/commands/settings.test.ts`
- Test: `packages/web/src/app/providers.lifecycle.test.tsx`
- Test: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Test: `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`

- [ ] **Step 1: Run the full targeted verification set**

Run:

```bash
pnpm --filter @coder-studio/server test -- packages/server/src/commands/settings.test.ts
pnpm --filter @coder-studio/web test -- packages/web/src/app/providers.lifecycle.test.tsx
pnpm --filter @coder-studio/web test -- packages/web/src/features/settings/components/settings-page.test.tsx
pnpm --filter @coder-studio/web test -- packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx
```

Expected:

- PASS with 0 failures in all four commands

- [ ] **Step 2: Run one combined web verification pass**

Run:

```bash
pnpm --filter @coder-studio/web test -- \
  packages/web/src/app/providers.lifecycle.test.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx
```

Expected:

- PASS so the new terminal preference shape works across the hydrated app, settings page, and xterm host together

- [ ] **Step 3: Review spec coverage before handoff**

Confirm the implementation covers all approved requirements:

```text
- global-only font size, no session override
- persisted appearance.terminalFontSize setting
- settings page numeric input with 10-18 integer validation
- shell terminal and session terminal both read the same value
- already-open terminals update without terminal recreation
- invalid or stale settings fall back to 11
```

- [ ] **Step 4: Commit the verification checkpoint**

```bash
git add docs/superpowers/plans/2026-05-17-terminal-font-size.md
git commit -m "docs: add terminal font size implementation plan"
```

- [ ] **Step 5: Report exact verification evidence**

Include the exact commands from Steps 1 and 2 and whether they passed. Do not claim completion without fresh test output.
