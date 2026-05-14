# Mobile Terminal Paste/Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two mobile terminal actions: paste from clipboard and upload files/images from the device picker.

**Architecture:** Keep the existing terminal upload pipeline in `use-paste-drop-upload`, but extend it with explicit entry points for clipboard reads and file picker uploads. `MobileTerminalInputBar` owns the visible buttons and emits user intent; `XtermHost` wires those intents to workspace-scoped upload helpers and disables the controls while uploads are in flight. Desktop terminal behavior stays unchanged.

**Tech Stack:** React, TypeScript, Jotai, browser Clipboard API, browser file input, Vitest, Testing Library.

---

### Task 1: Add mobile toolbar actions and wiring hooks

**Files:**
- Modify: `packages/web/src/features/terminal-panel/mobile/mobile-terminal-input-bar.tsx`
- Modify: `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
- Test: `packages/web/src/features/terminal-panel/mobile/mobile-terminal-input-bar.test.tsx`

- [ ] **Step 1: Write the failing test**

Add assertions that the mobile input bar renders two new buttons labeled `Paste` and `Upload`, and that clicking them invokes dedicated callbacks instead of terminal key handlers.

```tsx
it("renders paste and upload actions and dispatches their callbacks", () => {
  const onPaste = vi.fn();
  const onUpload = vi.fn();

  render(
    <MobileTerminalInputBar
      ctrlMode="off"
      shiftArmed={false}
      labels={labels}
      onKeyPress={vi.fn()}
      onCtrlTap={vi.fn()}
      onCtrlLongPress={vi.fn()}
      onShiftTap={vi.fn()}
      onPaste={onPaste}
      onUpload={onUpload}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "Paste" }));
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));

  expect(onPaste).toHaveBeenCalledTimes(1);
  expect(onUpload).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest packages/web/src/features/terminal-panel/mobile/mobile-terminal-input-bar.test.tsx -t "renders paste and upload actions and dispatches their callbacks" -v`

Expected: fail because the props and buttons do not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Add `onPaste` and `onUpload` props to `MobileTerminalInputBar`, render two leading action buttons in the mobile bar, and forward clicks to the callbacks. In `xterm-host.tsx`, pass handlers that will be implemented in the next task.

```tsx
interface MobileTerminalInputBarProps {
  // existing props...
  onPaste: () => void;
  onUpload: () => void;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest packages/web/src/features/terminal-panel/mobile/mobile-terminal-input-bar.test.tsx -v`

Expected: pass, with the new buttons appearing before the terminal key group.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/terminal-panel/mobile/mobile-terminal-input-bar.tsx packages/web/src/features/terminal-panel/mobile/mobile-terminal-input-bar.test.tsx packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx
git commit -m "feat: add mobile terminal paste and upload actions"
```

### Task 2: Implement clipboard paste and file-picker upload flows

**Files:**
- Modify: `packages/web/src/features/terminal-panel/uploads/use-paste-drop-upload.ts`
- Modify: `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
- Test: `packages/web/src/features/terminal-panel/uploads/use-paste-drop-upload.test.tsx`
- Test: `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`

- [ ] **Step 1: Write the failing test**

Add coverage for two new helpers:
- a clipboard path that reads `ClipboardItem`s or text and uploads image files when present
- a file-picker path that uploads selected files and then writes the quoted terminal command back into the PTY

```ts
it("uploads clipboard image files when paste is requested", async () => {
  // mock navigator.clipboard.read() to return an image ClipboardItem
  // assert uploadFiles receives a File and sendTextToTerminal gets the quoted path
});

it("uploads files selected from the picker when upload is requested", async () => {
  // mock an <input type=\"file\"> selection and assert the same upload path is used
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
`pnpm vitest packages/web/src/features/terminal-panel/uploads/use-paste-drop-upload.test.tsx packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx -v`

Expected: fail because the new public helpers and host wiring do not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Extend `use-paste-drop-upload` with explicit methods for:
- reading clipboard files/text from a user gesture
- uploading an arbitrary `File[]`

Keep the existing paste/drop DOM listeners intact for desktop and non-mobile surfaces. In `xterm-host.tsx`, wire the new mobile buttons to the new helpers and add a hidden file input or equivalent picker flow scoped to mobile only.

```ts
// shape only; keep existing uploadFiles/quoteShellSingle flow
type UploadSource = "clipboard" | "picker";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
`pnpm vitest packages/web/src/features/terminal-panel/uploads/use-paste-drop-upload.test.tsx packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx -v`

Expected: pass, with clipboard and picker uploads both producing quoted terminal insertions and error toasts on failure.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/terminal-panel/uploads/use-paste-drop-upload.ts packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx packages/web/src/features/terminal-panel/uploads/use-paste-drop-upload.test.tsx packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx
git commit -m "feat: wire mobile terminal clipboard and file upload"
```

### Task 3: Add labels, polish layout, and verify mobile behavior

**Files:**
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/styles/components.css`
- Test: `packages/web/src/features/terminal-panel/mobile/mobile-terminal-input-bar.test.tsx`

- [ ] **Step 1: Write the failing test**

Extend the mobile input bar test to assert the new action buttons are present, readable, and do not collapse the existing terminal key order on narrow layouts.

```ts
expect(screen.getByRole("button", { name: "Paste" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest packages/web/src/features/terminal-panel/mobile/mobile-terminal-input-bar.test.tsx -v`

Expected: fail until the labels and layout styles are added.

- [ ] **Step 3: Write the minimal implementation**

Add localized labels for the two actions in `en.json` and `zh.json`, then update `components.css` so the two action buttons read as a separate group from the terminal keys without shrinking the existing soft-key row.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest packages/web/src/features/terminal-panel/mobile/mobile-terminal-input-bar.test.tsx packages/web/src/features/terminal-panel/uploads/use-paste-drop-upload.test.tsx packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx -v`

Expected: pass, and the mobile bar should still fit on small screens with horizontal scrolling for the terminal keys.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/locales/en.json packages/web/src/locales/zh.json packages/web/src/styles/components.css packages/web/src/features/terminal-panel/mobile/mobile-terminal-input-bar.test.tsx
git commit -m "feat: polish mobile terminal paste and upload actions"
```

