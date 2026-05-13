# Mobile Terminal Long-Press Line Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile terminal copy-mode overlay with direct long-press line copy that copies the wrapped logical line from the frontend xterm buffer when `Copy on select` is enabled.

**Architecture:** Keep gesture detection, clipboard side effects, toast side effects, and vibration inside [`packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`](/home/spencer/workspace/coder-studio/packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx). Extract target-to-row resolution and wrapped logical-line reconstruction into a small pure helper under `mobile/` so the tricky buffer mapping logic is unit-testable without mounting a real xterm instance. Delete the old DOM snapshot overlay path entirely, including its CSS, locale strings, tests, and helper files.

**Tech Stack:** TypeScript, React 19, xterm.js 6, Jotai, Vitest, Testing Library, Playwright.

---

## File Structure

- Create: `packages/web/src/features/terminal-panel/mobile/long-press-copy-line.ts` - pure helper that resolves `touchstart.target` to the nearest `.xterm-rows > *` row and reconstructs the wrapped logical line from `terminal.buffer.active`.
- Create: `packages/web/src/features/terminal-panel/mobile/long-press-copy-line.test.ts` - helper unit coverage for nested targets, viewport mapping, wrapped-line expansion, and final-segment trimming.
- Modify: `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx` - mobile long-press copy flow, success toast, vibration, and overlay removal.
- Modify: `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx` - mobile long-press behavior tests rewritten around direct copy instead of overlay entry.
- Modify: `packages/web/src/locales/en.json` - add `terminal.copied_current_line`, remove overlay-only `copy_mode_*` strings.
- Modify: `packages/web/src/locales/zh.json` - add `terminal.copied_current_line`, remove overlay-only `copy_mode_*` strings.
- Delete: `packages/web/src/features/terminal-panel/mobile/copy-mode-snapshot.ts` - obsolete DOM snapshot helper for removed overlay workflow.
- Delete: `packages/web/src/features/terminal-panel/mobile/copy-mode-snapshot.test.ts` - obsolete overlay helper tests.
- Modify: `packages/web/src/styles/components.css` - remove `.mobile-terminal-copy-mode*` rules.
- Modify: `packages/web/src/styles/components.theme.test.ts` - assert removed overlay CSS no longer ships.
- Modify: `e2e/specs/settings/mobile-copy-on-select.spec.ts` - mobile regression coverage for direct clipboard copy and disabled-state no-op behavior.

### Task 1: Add The Wrapped-Line Copy Helper

**Files:**
- Create: `packages/web/src/features/terminal-panel/mobile/long-press-copy-line.ts`
- Create: `packages/web/src/features/terminal-panel/mobile/long-press-copy-line.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Create `packages/web/src/features/terminal-panel/mobile/long-press-copy-line.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getLogicalLineTextFromTouchTarget } from "./long-press-copy-line";

interface MockBufferLine {
  isWrapped?: boolean;
  translateToString(trimRight?: boolean): string;
}

function createBufferLine(text: string, isWrapped = false): MockBufferLine {
  return {
    isWrapped,
    translateToString(trimRight = false) {
      return trimRight ? text.replace(/\s+$/u, "") : text;
    },
  };
}

function createTerminal(
  viewportY: number,
  lines: Array<[row: number, line: MockBufferLine]>
): {
  buffer: {
    active: {
      viewportY: number;
      getLine(row: number): MockBufferLine | undefined;
    };
  };
} {
  const byRow = new Map(lines);
  return {
    buffer: {
      active: {
        viewportY,
        getLine(row: number) {
          return byRow.get(row);
        },
      },
    },
  };
}

function createRowsDom() {
  const rows = document.createElement("div");
  rows.className = "xterm-rows";

  const firstRow = document.createElement("div");
  firstRow.innerHTML = "<span>first</span>";

  const secondRow = document.createElement("div");
  secondRow.innerHTML = "<span><span>second</span></span>";

  const thirdRow = document.createElement("div");
  thirdRow.innerHTML = "<span><span>third</span></span>";

  rows.append(firstRow, secondRow, thirdRow);

  return {
    rows,
    firstTarget: firstRow.querySelector("span") as HTMLSpanElement,
    secondTarget: secondRow.querySelector("span span") as HTMLSpanElement,
    thirdTarget: thirdRow.querySelector("span span") as HTMLSpanElement,
  };
}

describe("getLogicalLineTextFromTouchTarget", () => {
  it("maps the touched visual row through viewportY", () => {
    const { rows, secondTarget } = createRowsDom();
    document.body.appendChild(rows);

    const terminal = createTerminal(10, [[11, createBufferLine("beta")]]);

    expect(getLogicalLineTextFromTouchTarget({ target: secondTarget, terminal })).toBe("beta");

    rows.remove();
  });

  it("walks upward and downward across wrapped rows and trims only the final segment", () => {
    const { rows, thirdTarget } = createRowsDom();
    document.body.appendChild(rows);

    const terminal = createTerminal(20, [
      [20, createBufferLine("unrelated line")],
      [21, createBufferLine("prefix ", false)],
      [22, createBufferLine("middle ", true)],
      [23, createBufferLine("suffix   ", true)],
    ]);

    expect(getLogicalLineTextFromTouchTarget({ target: thirdTarget, terminal })).toBe(
      "prefix middle suffix"
    );

    rows.remove();
  });

  it("preserves meaningful internal spaces from wrapped intermediate segments", () => {
    const { rows, secondTarget } = createRowsDom();
    document.body.appendChild(rows);

    const terminal = createTerminal(30, [
      [30, createBufferLine("double  ", false)],
      [31, createBufferLine("space   ", true)],
    ]);

    expect(getLogicalLineTextFromTouchTarget({ target: secondTarget, terminal })).toBe(
      "double  space"
    );

    rows.remove();
  });

  it("returns null when the touch target does not resolve to a direct xterm row", () => {
    const outside = document.createElement("div");
    outside.innerHTML = "<span>outside</span>";
    document.body.appendChild(outside);

    const terminal = createTerminal(0, [[0, createBufferLine("ignored")]]);

    expect(
      getLogicalLineTextFromTouchTarget({
        target: outside.querySelector("span"),
        terminal,
      })
    ).toBeNull();

    outside.remove();
  });
});
```

- [ ] **Step 2: Run the helper tests to verify they fail**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/terminal-panel/mobile/long-press-copy-line.test.ts`

Expected: FAIL with a module resolution error because `long-press-copy-line.ts` does not exist yet.

- [ ] **Step 3: Write the minimal helper implementation**

Create `packages/web/src/features/terminal-panel/mobile/long-press-copy-line.ts`:

```ts
interface BufferLineLike {
  isWrapped?: boolean;
  translateToString(trimRight?: boolean): string;
}

interface ActiveBufferLike {
  viewportY: number;
  getLine(row: number): BufferLineLike | undefined;
}

export interface TerminalLikeForLongPressCopy {
  buffer: {
    active: ActiveBufferLike;
  };
}

export interface GetLogicalLineTextFromTouchTargetArgs {
  target: EventTarget | null;
  terminal: TerminalLikeForLongPressCopy;
}

function toElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target;
  }

  if (target instanceof Node) {
    return target.parentElement;
  }

  return null;
}

function findDirectXtermRow(target: EventTarget | null): HTMLElement | null {
  let current: Element | null = toElement(target);

  while (current) {
    const parent = current.parentElement;
    if (parent?.classList.contains("xterm-rows") && current instanceof HTMLElement) {
      return current;
    }
    current = parent;
  }

  return null;
}

export function getLogicalLineTextFromTouchTarget(
  args: GetLogicalLineTextFromTouchTargetArgs
): string | null {
  const rowElement = findDirectXtermRow(args.target);
  if (!rowElement) {
    return null;
  }

  const rowsElement = rowElement.parentElement;
  if (!rowsElement || !rowsElement.classList.contains("xterm-rows")) {
    return null;
  }

  const visualRowIndex = Array.prototype.indexOf.call(rowsElement.children, rowElement) as number;
  if (visualRowIndex < 0) {
    return null;
  }

  const activeBuffer = args.terminal.buffer.active;
  const bufferRow = activeBuffer.viewportY + visualRowIndex;

  let startRow = bufferRow;
  let currentLine = activeBuffer.getLine(startRow);
  if (!currentLine) {
    return null;
  }

  while (currentLine.isWrapped === true) {
    startRow -= 1;
    if (startRow < 0) {
      return null;
    }

    currentLine = activeBuffer.getLine(startRow);
    if (!currentLine) {
      return null;
    }
  }

  const segments: BufferLineLike[] = [currentLine];
  let scanRow = startRow;

  while (true) {
    const nextLine = activeBuffer.getLine(scanRow + 1);
    if (!nextLine || nextLine.isWrapped !== true) {
      break;
    }

    segments.push(nextLine);
    scanRow += 1;
  }

  return segments
    .map((line, index) => line.translateToString(index === segments.length - 1))
    .join("");
}
```

- [ ] **Step 4: Run the helper tests to verify they pass**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/terminal-panel/mobile/long-press-copy-line.test.ts`

Expected: PASS with 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/terminal-panel/mobile/long-press-copy-line.ts packages/web/src/features/terminal-panel/mobile/long-press-copy-line.test.ts
git commit -m "test(web): add mobile terminal line-copy helper"
```

### Task 2: Rewrite Mobile Long-Press Behavior Around Direct Copy

**Files:**
- Modify: `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
- Modify: `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Replace the mobile overlay tests with direct-copy tests**

Patch `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx` in two places.

First, extend the test scaffolding near the existing `mockTerminal` definition:

```ts
interface MockBufferLine {
  isWrapped?: boolean;
  translateToString(trimRight?: boolean): string;
}

const mockBufferLines = new Map<number, MockBufferLine>();

function createMockBufferLine(text: string, isWrapped = false): MockBufferLine {
  return {
    isWrapped,
    translateToString(trimRight = false) {
      return trimRight ? text.replace(/\s+$/u, "") : text;
    },
  };
}

function setMockBufferLines(entries: Array<[row: number, text: string, isWrapped?: boolean]>) {
  mockBufferLines.clear();
  for (const [row, text, isWrapped = false] of entries) {
    mockBufferLines.set(row, createMockBufferLine(text, isWrapped));
  }
}

function dispatchTouchEvent(
  target: Element,
  type: string,
  touches: Array<{ identifier: number; clientX: number; clientY: number }>,
  changedTouches = touches
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: touches });
  Object.defineProperty(event, "targetTouches", { value: touches });
  Object.defineProperty(event, "changedTouches", { value: changedTouches });
  target.dispatchEvent(event);
}
```

Update `mockTerminal.buffer.active` so it includes `getLine`:

```ts
  buffer: {
    active: {
      viewportY: 0,
      baseY: 0,
      getLine: vi.fn((row: number) => mockBufferLines.get(row)),
    },
  },
```

Reset the new buffer map in `beforeEach`:

```ts
    mockBufferLines.clear();
    mockTerminal.buffer.active.getLine.mockImplementation((row: number) => mockBufferLines.get(row));
```

Then replace the old overlay-only mobile copy tests in the `6895-8099` region with these direct-copy tests:

```tsx
  it("mobile line copy copies the wrapped logical line on long press when copy on select is enabled", async () => {
    vi.useFakeTimers();
    viewportMocks.viewport = "mobile";

    const originalMatchMedia = window.matchMedia;
    const writeText = vi.fn().mockResolvedValue(undefined);
    const vibrate = vi.fn();
    const store = createStore();

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: vibrate,
    });

    mockTerminal.buffer.active.viewportY = 20;
    setMockBufferLines([
      [20, "prefix ", false],
      [21, "middle ", true],
      [22, "suffix   ", true],
    ]);

    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, { copyOnSelect: true });
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ ok: true, data: { status: "ok" } }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
      sendTerminalInput: vi.fn().mockResolvedValue(undefined),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-line-copy-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const host = container.querySelector(".xterm-host") as HTMLDivElement | null;
    expect(host).toBeTruthy();

    const rows = document.createElement("div");
    rows.className = "xterm-rows";
    rows.innerHTML = `
      <div><span>prefix</span></div>
      <div><span><span>middle</span></span></div>
      <div><span><span>suffix</span></span></div>
    `;
    host!.appendChild(rows);

    const target = rows.querySelector("div:nth-child(2) span span") as HTMLSpanElement;

    dispatchTouchEvent(target, "touchstart", [{ identifier: 1, clientX: 40, clientY: 120 }]);

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("prefix middle suffix");
    });
    expect(vibrate).toHaveBeenCalledWith(10);
    expect(store.get(toastsAtom)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "success",
          title: "Copied current line",
        }),
      ])
    );
    expect(container.querySelector(".mobile-terminal-copy-mode")).toBeNull();

    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
  });

  it("mobile line copy does not copy on long press when copy on select is disabled", async () => {
    vi.useFakeTimers();
    viewportMocks.viewport = "mobile";

    const originalMatchMedia = window.matchMedia;
    const writeText = vi.fn().mockResolvedValue(undefined);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, { copyOnSelect: false });
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ ok: true, data: { status: "ok" } }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
      sendTerminalInput: vi.fn().mockResolvedValue(undefined),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-line-copy-disabled-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const host = container.querySelector(".xterm-host") as HTMLDivElement | null;
    expect(host).toBeTruthy();

    const rows = document.createElement("div");
    rows.className = "xterm-rows";
    rows.innerHTML = "<div><span><span>only line</span></span></div>";
    host!.appendChild(rows);

    const target = rows.querySelector("span span") as HTMLSpanElement;
    dispatchTouchEvent(target, "touchstart", [{ identifier: 1, clientX: 40, clientY: 120 }]);

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(store.get(toastsAtom)).toEqual([]);

    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
  });

  it("mobile line copy does not copy when the gesture becomes a scroll before long press matures", async () => {
    vi.useFakeTimers();
    viewportMocks.viewport = "mobile";

    const originalMatchMedia = window.matchMedia;
    const writeText = vi.fn().mockResolvedValue(undefined);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    mockTerminal.rows = 20;
    mockTerminal.buffer.active.viewportY = 6;
    mockTerminal.buffer.active.baseY = 80;

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, { copyOnSelect: true });

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-line-copy-scroll-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const host = container.querySelector(".xterm-host") as HTMLDivElement | null;
    expect(host).toBeTruthy();

    const rows = document.createElement("div");
    rows.className = "xterm-rows";
    rows.innerHTML = "<div><span><span>only line</span></span></div>";
    host!.appendChild(rows);

    const target = rows.querySelector("span span") as HTMLSpanElement;
    dispatchTouchEvent(target, "touchstart", [{ identifier: 1, clientX: 40, clientY: 120 }]);
    dispatchTouchEvent(target, "touchmove", [{ identifier: 1, clientX: 40, clientY: 88 }]);

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(mockTerminal.scrollLines).toHaveBeenCalled();

    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
  });

  it("mobile line copy does not copy when horizontal drift exceeds the long-press tolerance", async () => {
    vi.useFakeTimers();
    viewportMocks.viewport = "mobile";

    const originalMatchMedia = window.matchMedia;
    const writeText = vi.fn().mockResolvedValue(undefined);
    const vibrate = vi.fn();

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: vibrate,
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(terminalPreferencesAtom, { copyOnSelect: true });

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-line-copy-horizontal-drift-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const host = container.querySelector(".xterm-host") as HTMLDivElement | null;
    expect(host).toBeTruthy();

    const rows = document.createElement("div");
    rows.className = "xterm-rows";
    rows.innerHTML = "<div><span><span>only line</span></span></div>";
    host!.appendChild(rows);

    const target = rows.querySelector("span span") as HTMLSpanElement;
    dispatchTouchEvent(target, "touchstart", [{ identifier: 1, clientX: 40, clientY: 120 }]);
    dispatchTouchEvent(target, "touchmove", [{ identifier: 1, clientX: 56, clientY: 120 }]);

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
    expect(mockTerminal.scrollLines).not.toHaveBeenCalled();

    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
  });

  it("mobile line copy reuses the existing copy failure toast when clipboard write fails", async () => {
    vi.useFakeTimers();
    viewportMocks.viewport = "mobile";

    const originalMatchMedia = window.matchMedia;
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard failed"));
    const store = createStore();

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    mockTerminal.buffer.active.viewportY = 0;
    setMockBufferLines([[0, "failed line"]]);

    store.set(localeAtom, "zh");
    store.set(terminalPreferencesAtom, { copyOnSelect: true });
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue({ ok: true, data: { status: "ok" } }),
      subscribe: vi.fn(() => () => {}),
      getStatus: vi.fn(() => "connected"),
      onStatus: vi.fn(() => () => {}),
      sendTerminalInput: vi.fn().mockResolvedValue(undefined),
    } as never);

    const { container } = render(
      <Provider store={store}>
        <XtermHost terminalId="mobile-line-copy-failure-terminal" workspaceId="test-workspace" />
      </Provider>
    );

    const host = container.querySelector(".xterm-host") as HTMLDivElement | null;
    expect(host).toBeTruthy();

    const rows = document.createElement("div");
    rows.className = "xterm-rows";
    rows.innerHTML = "<div><span><span>failed line</span></span></div>";
    host!.appendChild(rows);

    const target = rows.querySelector("span span") as HTMLSpanElement;
    dispatchTouchEvent(target, "touchstart", [{ identifier: 1, clientX: 40, clientY: 120 }]);

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(store.get(toastsAtom)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "error",
            title: "自动复制失败",
          }),
        ])
      );
    });

    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
  });
```

- [ ] **Step 2: Run the rewritten mobile host tests to verify they fail**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/terminal-panel/__tests__/xterm-host.test.tsx -t "mobile line copy"`

Expected: FAIL because `XtermHost` still tries to enter the removed overlay path and never copies directly from `touchstart.target`.

- [ ] **Step 3: Rewrite `XtermHost` to copy the logical line directly and add the success locale**

Make four exact changes in `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`.

Replace the old copy-mode snapshot import with the new helper import and remove the now-unused React mouse-event import:

```tsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getLogicalLineTextFromTouchTarget } from "../../mobile/long-press-copy-line";
```

Concretely, the React import block at the top should stop importing `type MouseEvent as ReactMouseEvent`.

Add the direct-copy callback near `pushCopyOnSelectFailureToast`:

```tsx
const copyMobileLongPressRef = useRef<(target: EventTarget | null) => void>(() => {});

const copyMobileLongPress = useCallback(
  async (target: EventTarget | null) => {
    if (viewport !== "mobile" || !terminalPreferences.copyOnSelect) {
      resetTouchStateRef.current();
      return;
    }

    const terminal = terminalRef.current;
    resetTouchStateRef.current();

    if (!terminal) {
      return;
    }

    const text = getLogicalLineTextFromTouchTarget({
      target,
      terminal,
    });
    if (text === null) {
      return;
    }

    try {
      if (!navigator.clipboard?.writeText) {
        pushCopyOnSelectFailureToast();
        return;
      }

      await navigator.clipboard.writeText(text);
      pushToast({
        kind: "success",
        title: t("terminal.copied_current_line"),
      });
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(10);
      }
    } catch {
      pushCopyOnSelectFailureToast();
    }
  },
  [pushCopyOnSelectFailureToast, pushToast, t, terminalPreferences.copyOnSelect, viewport]
);

useEffect(() => {
  copyMobileLongPressRef.current = (target) => {
    void copyMobileLongPress(target);
  };
}, [copyMobileLongPress]);
```

Replace the long-press timer logic inside the touch effect with target capture instead of overlay entry:

```tsx
let longPressTarget: EventTarget | null = null;

const clearLongPressTimer = () => {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  longPressTouchId = null;
  longPressStartClientX = 0;
  longPressStartClientY = 0;
  longPressTarget = null;
};

const handleTouchStart = (event: TouchEvent) => {
  if (event.touches.length !== 1) {
    resetTouchState();
    return;
  }

  const touch = getTouchAt(event.touches, 0);
  if (!touch) {
    resetTouchState();
    return;
  }

  stopMomentumScroll();
  state.activeTouchId = touch.identifier;
  state.lastClientY = touch.clientY;
  state.carryPx = 0;
  state.pxPerLine = terminalRef.current
    ? getTouchScrollPxPerLine(terminalRef.current, container)
    : MOBILE_TOUCH_SCROLL_FALLBACK_PX_PER_LINE;
  state.gestureDidScroll = false;
  state.samples = [];
  recordTouchSample(touch.clientY, performance.now());

  if (viewport === "mobile" && terminalPreferences.copyOnSelect) {
    longPressTouchId = touch.identifier;
    longPressStartClientX = touch.clientX;
    longPressStartClientY = touch.clientY;
    longPressTarget = event.target;
    longPressTimer = setTimeout(() => {
      const target = longPressTarget;
      copyMobileLongPressRef.current(target);
    }, MOBILE_COPY_MODE_LONG_PRESS_MS);
  }
};
```

Delete the entire overlay-specific path:

```tsx
// Delete these copy-mode-only refs/state/callbacks/effects entirely:
// - enterMobileCopyModeRef
// - mobileCopyModeActiveRef
// - mobileCopyModeSnapshot state
// - pushCopyModeFailureToast
// - exitMobileCopyMode
// - handleMobileCopyModeBackgroundClick
// - enterMobileCopyMode
// - the effect that syncs enterMobileCopyModeRef
// - the effect that clears mobileCopyModeSnapshot on viewport changes
// - the `setMobileCopyModeSnapshot(null)` branch in the terminalId/workspaceId useLayoutEffect
// - the `if (mobileCopyModeActiveRef.current)` early-return guards in touchstart/touchmove/touchend
// - `getMeasuredTerminalLineHeightPx`, which becomes dead after the snapshot overlay is removed
//
// Replace the terminalId/workspaceId reset effect with:
useLayoutEffect(() => {
  resetTouchStateRef.current();
}, [terminalId, workspaceId]);
//
// Delete the entire JSX block below from the render return:
// {viewport === "mobile" && mobileCopyModeSnapshot ? (
//   <div className="mobile-terminal-copy-mode">
//     <div className="mobile-terminal-copy-mode__toolbar">
//       <div className="mobile-terminal-copy-mode__title">{t("terminal.copy_mode_title")}</div>
//       <div className="mobile-terminal-copy-mode__hint">{t("terminal.copy_mode_hint")}</div>
//       <button
//         type="button"
//         className="mobile-terminal-copy-mode__done"
//         onClick={exitMobileCopyMode}
//       >
//         {t("terminal.copy_mode_done")}
//       </button>
//     </div>
//     <div
//       className="mobile-terminal-copy-mode__content"
//       onClick={handleMobileCopyModeBackgroundClick}
//     >
//       <div
//         className="mobile-terminal-copy-mode__text"
//         style={{
//           fontFamily: mobileCopyModeSnapshot.fontFamily,
//           fontSize: `${mobileCopyModeSnapshot.fontSize}px`,
//           lineHeight: `${mobileCopyModeSnapshot.lineHeightPx}px`,
//         }}
//         dangerouslySetInnerHTML={{ __html: mobileCopyModeSnapshot.html }}
//       />
//     </div>
//   </div>
// ) : null}
```

Add the success toast key and keep the existing failure toast keys in the locale files.

Patch `packages/web/src/locales/en.json`:

```json
    "create_unavailable_title": "No workspace selected",
    "create_unavailable_body": "Open or switch to a workspace before creating a terminal.",
    "copied_current_line": "Copied current line",
    "hide": "Hide Terminal",
```

Patch `packages/web/src/locales/zh.json`:

```json
    "create_unavailable_title": "当前没有已选中的工作区",
    "create_unavailable_body": "请先打开或切换到一个工作区，再新建终端。",
    "copied_current_line": "已复制当前行",
    "hide": "隐藏终端",
```

- [ ] **Step 4: Run the mobile host tests to verify they pass**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/terminal-panel/__tests__/xterm-host.test.tsx -t "mobile line copy"`

Expected: PASS with the rewritten mobile long-press tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx packages/web/src/locales/en.json packages/web/src/locales/zh.json
git commit -m "feat(web): copy mobile terminal lines on long press"
```

### Task 3: Remove The Obsolete Overlay Files, CSS, And Theme Assertions

**Files:**
- Delete: `packages/web/src/features/terminal-panel/mobile/copy-mode-snapshot.ts`
- Delete: `packages/web/src/features/terminal-panel/mobile/copy-mode-snapshot.test.ts`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Replace the old overlay CSS assertion with a removal assertion**

Patch `packages/web/src/styles/components.theme.test.ts` by deleting the entire `it("mobile terminal copy mode overlay styles", ...)` block and replacing it with:

```ts
  it("does not ship removed mobile terminal copy mode overlay CSS", () => {
    expect(stylesheet).not.toContain(".mobile-terminal-copy-mode");
  });
```

- [ ] **Step 2: Run the theme test to verify it fails**

Run: `pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts -t "does not ship removed mobile terminal copy mode overlay CSS"`

Expected: FAIL because `components.css` still contains the `.mobile-terminal-copy-mode*` rules.

- [ ] **Step 3: Delete the obsolete helper files, remove overlay CSS, and remove overlay-only locale keys**

Delete the old overlay helper files:

```bash
git rm packages/web/src/features/terminal-panel/mobile/copy-mode-snapshot.ts
git rm packages/web/src/features/terminal-panel/mobile/copy-mode-snapshot.test.ts
```

Delete this entire CSS block from `packages/web/src/styles/components.css`:

```css
.mobile-terminal-copy-mode {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  flex-direction: column;
  min-height: 0;
  box-sizing: border-box;
  overflow: hidden;
  background: color-mix(in srgb, var(--bg-terminal) 94%, var(--bg-page) 6%);
  color: var(--text-primary);
  user-select: text;
  -webkit-user-select: text;
}

.mobile-terminal-copy-mode__toolbar {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding-inline: var(--sp-3);
  padding-bottom: var(--sp-3);
}

.mobile-terminal-copy-mode__title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}

.mobile-terminal-copy-mode__hint {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.mobile-terminal-copy-mode__done {
  margin-left: auto;
  flex-shrink: 0;
}

.mobile-terminal-copy-mode__content {
  flex: 1;
  min-height: 0;
  min-width: 0;
  max-width: 100%;
  max-height: 100%;
  overflow: auto;
  padding-inline: var(--sp-3);
  user-select: text;
  -webkit-user-select: text;
  -webkit-touch-callout: default;
  -webkit-overflow-scrolling: touch;
}

.mobile-terminal-copy-mode__text {
  display: block;
  width: max-content;
  max-width: 100%;
  min-width: 100%;
  margin: 0;
  white-space: pre;
  user-select: text;
  -webkit-user-select: text;
}
```

Remove the overlay-only locale keys from the `terminal` group in both locale files.

Delete these lines from `packages/web/src/locales/en.json`:

```json
    "copy_mode_title": "Copy Mode",
    "copy_mode_hint": "Drag to select text",
    "copy_mode_done": "Done",
    "copy_mode_failed_title": "Couldn't enter copy mode",
    "copy_mode_failed_body": "Try again, or scroll the terminal and long press again",
```

Delete these lines from `packages/web/src/locales/zh.json`:

```json
    "copy_mode_title": "复制模式",
    "copy_mode_hint": "拖动选择文本",
    "copy_mode_done": "完成",
    "copy_mode_failed_title": "无法进入复制模式",
    "copy_mode_failed_body": "请重试，或先滚动终端后再长按",
```

- [ ] **Step 4: Run the helper, host, and theme tests together**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/terminal-panel/mobile/long-press-copy-line.test.ts src/features/terminal-panel/__tests__/xterm-host.test.tsx src/styles/components.theme.test.ts`

Expected: PASS with the new helper tests, rewritten `XtermHost` tests, and the CSS removal assertion all green.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/styles/components.css packages/web/src/styles/components.theme.test.ts packages/web/src/locales/en.json packages/web/src/locales/zh.json
git add -u packages/web/src/features/terminal-panel/mobile
git commit -m "refactor(web): remove mobile terminal copy mode overlay"
```

### Task 4: Rewrite The Mobile E2E Around Direct Clipboard Copy

**Files:**
- Modify: `e2e/specs/settings/mobile-copy-on-select.spec.ts`

- [ ] **Step 1: Rewrite the Playwright spec to capture clipboard writes and dispatch the touch on a real row target**

Patch `e2e/specs/settings/mobile-copy-on-select.spec.ts` in three places.

First, add a tiny clipboard probe in `beforeEach`:

```ts
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("ui.locale", JSON.stringify("en"));

      let copiedText = "";
      Object.defineProperty(window, "__mobileCopiedText", {
        configurable: true,
        get() {
          return copiedText;
        },
      });

      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            copiedText = text;
          },
        },
      });
    });
  });
```

Second, replace `longPressTerminalRows` so it dispatches the synthetic touch on a nested row target instead of the host:

```ts
async function longPressTerminalRows(page: Page, rowIndex = 1): Promise<void> {
  const row = page.locator(".mobile-sheet--terminal .xterm-rows > div").nth(rowIndex);
  const target = row.locator("span").first();
  await expect(target).toBeVisible({ timeout: 10000 });

  const box = await target.boundingBox();
  expect(box).toBeTruthy();
  if (!box) {
    throw new Error("xterm row target bounding box missing");
  }

  const x = box.x + Math.max(4, box.width / 2);
  const y = box.y + Math.max(4, box.height / 2);

  await target.evaluate(
    (node, { clientX, clientY }) => {
      const touches = [{ identifier: 1, clientX, clientY }];
      const buildEvent = (
        type: string,
        activeTouches: typeof touches,
        changedTouches = activeTouches
      ) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "touches", { value: activeTouches });
        Object.defineProperty(event, "targetTouches", { value: activeTouches });
        Object.defineProperty(event, "changedTouches", { value: changedTouches });
        return event;
      };

      node.dispatchEvent(buildEvent("touchstart", touches));
      window.setTimeout(() => {
        node.dispatchEvent(buildEvent("touchend", [], touches));
      }, 650);
    },
    { clientX: x, clientY: y }
  );
}
```

Third, replace the two tests at the bottom of the file with direct-copy assertions:

```ts
  test("mobile long press copies the wrapped logical line without opening a copy overlay", async ({
    page,
  }) => {
    await setMobileCopyOnSelect(page, true);
    await openMobileWorkspace(page);
    await openMobileTerminalSheet(page);
    await ensureTerminalExists(page);
    await seedLongTerminalLine(page);

    await expect.poll(async () => {
      return page.locator(".mobile-sheet--terminal .xterm-rows > div").count();
    }).toBeGreaterThan(1);

    const rowCount = await page.locator(".mobile-sheet--terminal .xterm-rows > div").count();
    await longPressTerminalRows(page, rowCount - 1);

    await expect(
      page.getByText(translateForE2E("terminal.copied_current_line", "en"))
    ).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".mobile-terminal-copy-mode")).toHaveCount(0);

    await expect.poll(async () => {
      return page.evaluate(() => {
        return (window as Window & { __mobileCopiedText?: string }).__mobileCopiedText ?? "";
      });
    }).toBe(LONG_LINE_TEXT);
  });

  test("mobile long press does not copy when copy on select is disabled", async ({ page }) => {
    await setMobileCopyOnSelect(page, false);
    await openMobileWorkspace(page);
    await openMobileTerminalSheet(page);
    await ensureTerminalExists(page);
    await seedLongTerminalLine(page);

    await longPressTerminalRows(page, 1);

    await expect(page.locator(".mobile-terminal-copy-mode")).toHaveCount(0);
    await expect(page.getByText(translateForE2E("terminal.copied_current_line", "en"))).toHaveCount(0);
    await expect.poll(async () => {
      return page.evaluate(() => {
        return (window as Window & { __mobileCopiedText?: string }).__mobileCopiedText ?? "";
      });
    }).toBe("");
  });
```

- [ ] **Step 2: Run the Playwright spec**

Run: `pnpm --dir e2e exec playwright test --config playwright.config.ts specs/settings/mobile-copy-on-select.spec.ts`

Expected: PASS with both mobile copy-on-select scenarios green.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/settings/mobile-copy-on-select.spec.ts
git commit -m "test(e2e): cover mobile terminal long-press line copy"
```

### Task 5: Final Verification Sweep

**Files:**
- No new files

- [ ] **Step 1: Run the targeted web verification suite**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/terminal-panel/mobile/long-press-copy-line.test.ts src/features/terminal-panel/__tests__/xterm-host.test.tsx src/styles/components.theme.test.ts`

Expected: PASS.

- [ ] **Step 2: Run the targeted mobile e2e spec**

Run: `pnpm --dir e2e exec playwright test --config playwright.config.ts specs/settings/mobile-copy-on-select.spec.ts`

Expected: PASS.

- [ ] **Step 3: Confirm the worktree only contains the intended feature files**

Run: `git status --short`

Expected:

```txt
<no output>
```

or only the intentional untracked docs files that pre-existed outside this feature if commits have not been created yet.

- [ ] **Step 4: Push the branch**

Run: `git push`

Expected: the current branch updates successfully on `origin`.

## Self-Review

- Spec coverage: Task 1 covers target-to-row resolution, viewport mapping, wrapped logical-line reconstruction, and last-segment trimming. Task 2 covers mobile long-press gating by `Copy on select`, direct clipboard copy, success toast, vibration, scroll-cancel behavior, and failure-toast reuse. Task 3 removes the overlay helper, CSS, and locale baggage required by the new design. Task 4 rewrites the mobile e2e away from overlay assertions toward direct clipboard-copy assertions.
- Placeholder scan: no `TODO`, `TBD`, `appropriate`, `similar to`, or deferred implementation placeholders remain.
- Type consistency: the helper API is consistently named `getLogicalLineTextFromTouchTarget`, the new locale key is consistently named `terminal.copied_current_line`, and the clipboard failure path consistently reuses `settings.copy_on_select_failed_*`.

Plan complete and saved to `docs/superpowers/plans/2026-05-13-mobile-terminal-long-press-line-copy.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
