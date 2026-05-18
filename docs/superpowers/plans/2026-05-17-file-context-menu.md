# File Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser-native file-tree context menu with a custom file-aware menu that supports create, rename, delete, path copy, and open-in-terminal across desktop tree rows, desktop search rows, and mobile long-press.

**Architecture:** Keep `FileTreePanel` as the composition layer, but move context-target state, context-menu state, and action assembly into feature-owned hooks so tree rows, search rows, and mobile long-press consume one action model. Add the missing server primitives first (`file.rename`, `terminal.create(...cwdPath)`), then share terminal creation state across the terminal panel and file actions, then wire a dedicated desktop context menu plus a mobile sheet without mutating the shared `ActionMenu` primitive.

**Tech Stack:** TypeScript, React 19, Jotai, Vitest, Testing Library, Zod, Node `fs/promises`, existing `Sheet` and modal primitives, vanilla CSS in `components.css`.

**Spec reference:** `docs/superpowers/specs/2026-05-17-file-context-menu-design.md`

---

## File Structure

**New files:**
- `packages/web/src/lib/clipboard.ts`
- `packages/web/src/lib/clipboard.test.ts`
- `packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.ts`
- `packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.test.tsx`
- `packages/web/src/features/workspace/actions/use-file-actions.test.tsx`
- `packages/web/src/features/workspace/actions/use-file-context-actions.ts`
- `packages/web/src/features/workspace/actions/use-file-tree-context-menu.ts`
- `packages/web/src/features/workspace/views/shared/file-context-menu.tsx`
- `packages/web/src/features/workspace/views/shared/file-context-menu.test.tsx`

**Modified files:**
- `packages/server/src/fs/file-io.ts`
- `packages/server/src/commands/file.ts`
- `packages/server/src/commands/terminal.ts`
- `packages/server/src/__tests__/file-commands.test.ts`
- `packages/server/src/__tests__/terminal-commands.test.ts`
- `packages/web/src/features/terminal-panel/atoms/terminals.ts`
- `packages/web/src/features/terminal-panel/actions/use-terminal-actions.ts`
- `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx`
- `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
- `packages/web/src/features/workspace/actions/use-file-actions.ts`
- `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
- `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`
- `packages/web/src/locales/en.json`
- `packages/web/src/locales/zh.json`
- `packages/web/src/styles/components.css`

**No changes in this plan:**
- `packages/web/src/components/ui/action-menu/*`
- `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx`
- any global application-wide right-click system
- inline rename in the tree
- multi-select or drag-and-drop file actions

### Task 1: Add The Server `file.rename` Command

**Files:**
- Modify: `packages/server/src/__tests__/file-commands.test.ts`
- Modify: `packages/server/src/fs/file-io.ts`
- Modify: `packages/server/src/commands/file.ts`

- [ ] **Step 1: Write the failing rename command tests**

Add focused coverage to `packages/server/src/__tests__/file-commands.test.ts`:

```ts
import { readFile as fsReadFile } from "fs/promises";

it("renames files and emits fs.dirty", async () => {
  const result = await dispatch(
    {
      kind: "command",
      id: "file-rename-1",
      op: "file.rename",
      args: {
        workspaceId,
        fromPath: "README.md",
        toPath: "GUIDE.md",
      },
    },
    ctx
  );

  expect(result.ok).toBe(true);
  expect(await fsReadFile(join(testDir, "GUIDE.md"), "utf-8")).toBe("readme\n");
  expect(eventBus.emit).toHaveBeenCalledWith({
    type: "fs.dirty",
    workspaceId,
    reason: "fs_change",
  });
});

it("renames directories recursively", async () => {
  const result = await dispatch(
    {
      kind: "command",
      id: "file-rename-2",
      op: "file.rename",
      args: {
        workspaceId,
        fromPath: "docs",
        toPath: "guides",
      },
    },
    ctx
  );

  expect(result.ok).toBe(true);
  expect(await fsReadFile(join(testDir, "guides", "src-note.md"), "utf-8")).toBe("note\n");
});

it("rejects colliding or escaping rename targets", async () => {
  const collision = await dispatch(
    {
      kind: "command",
      id: "file-rename-3",
      op: "file.rename",
      args: {
        workspaceId,
        fromPath: "README.md",
        toPath: "src.ts",
      },
    },
    ctx
  );

  const escaped = await dispatch(
    {
      kind: "command",
      id: "file-rename-4",
      op: "file.rename",
      args: {
        workspaceId,
        fromPath: "README.md",
        toPath: "../outside.md",
      },
    },
    ctx
  );

  expect(collision.ok).toBe(false);
  expect(collision.error).toMatchObject({ code: "already_exists" });
  expect(escaped.ok).toBe(false);
  expect(escaped.error).toMatchObject({ code: "path_escape" });
});
```

- [ ] **Step 2: Run the server file-command tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/file-commands.test.ts
```

Expected: FAIL with `Unknown command: file.rename`.

- [ ] **Step 3: Implement `renameEntry()` and register `file.rename`**

Update `packages/server/src/fs/file-io.ts`:

```ts
import {
  readFile as fsReadFile,
  rename as fsRename,
  writeFile as fsWriteFile,
  mkdir,
  rm,
  stat,
} from "fs/promises";

export async function renameEntry(
  rootPath: string,
  fromPath: string,
  toPath: string
): Promise<void> {
  const fromAbs = resolveSafe(rootPath, fromPath);
  const toAbs = resolveSafe(rootPath, toPath);
  const source = await statSafe(fromAbs);
  const target = await statSafe(toAbs);

  if (!source) {
    throw { code: "not_found", message: "Source not found" };
  }

  if (target) {
    throw { code: "already_exists", message: "Target already exists" };
  }

  await mkdir(dirname(toAbs), { recursive: true });
  await fsRename(fromAbs, toAbs);
}
```

Update `packages/server/src/commands/file.ts`:

```ts
import {
  createDirectory,
  createFile,
  deleteEntry,
  readFile,
  renameEntry,
  writeFile,
} from "../fs/file-io.js";

registerCommand(
  "file.rename",
  z.object({
    workspaceId: z.string(),
    fromPath: z.string(),
    toPath: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    await renameEntry(workspace.path, args.fromPath, args.toPath);
    ctx.eventBus.emit({
      type: "fs.dirty",
      workspaceId: args.workspaceId,
      reason: "fs_change",
    });
    return { ok: true };
  }
);
```

- [ ] **Step 4: Run the server file-command tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/file-commands.test.ts
```

Expected: PASS, including the new rename coverage.

- [ ] **Step 5: Commit the server rename slice**

```bash
git add packages/server/src/__tests__/file-commands.test.ts packages/server/src/fs/file-io.ts packages/server/src/commands/file.ts
git commit -m "feat: add server file rename command"
```

### Task 2: Support `cwdPath` In `terminal.create`

**Files:**
- Modify: `packages/server/src/__tests__/terminal-commands.test.ts`
- Modify: `packages/server/src/commands/terminal.ts`

- [ ] **Step 1: Write the failing terminal cwd tests**

Add coverage to `packages/server/src/__tests__/terminal-commands.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

it("uses cwdPath when creating a shell terminal", async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "terminal-create-cwd-"));
  await mkdir(join(workspacePath, "apps", "web"), { recursive: true });
  const ctx = createContext({
    workspaceMgr: {
      get: vi.fn().mockReturnValue({
        id: "ws-1",
        path: workspacePath,
      }),
    } as never,
  });

  try {
    const result = await dispatch(
      {
        kind: "command",
        id: "terminal-create-cwd-1",
        op: "terminal.create",
        args: {
          workspaceId: "ws-1",
          cwdPath: "apps/web",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.terminalMgr.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: join(workspacePath, "apps", "web"),
      })
    );
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

it("falls back to the workspace root when cwdPath is omitted", async () => {
  const ctx = createContext();

  await dispatch(
    {
      kind: "command",
      id: "terminal-create-cwd-2",
      op: "terminal.create",
      args: {
        workspaceId: "ws-1",
      },
    },
    ctx
  );

  expect(ctx.terminalMgr.create).toHaveBeenCalledWith(
    expect.objectContaining({
      cwd: "/tmp/workspace",
    })
  );
});

it("rejects absolute and non-directory cwdPath values", async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "terminal-create-cwd-invalid-"));
  await writeFile(join(workspacePath, "README.md"), "readme\n");
  const ctx = createContext({
    workspaceMgr: {
      get: vi.fn().mockReturnValue({
        id: "ws-1",
        path: workspacePath,
      }),
    } as never,
  });

  try {
    const absolute = await dispatch(
      {
        kind: "command",
        id: "terminal-create-cwd-3",
        op: "terminal.create",
        args: {
          workspaceId: "ws-1",
          cwdPath: join(workspacePath, "apps", "web"),
        },
      },
      ctx
    );

    const notDirectory = await dispatch(
      {
        kind: "command",
        id: "terminal-create-cwd-4",
        op: "terminal.create",
        args: {
          workspaceId: "ws-1",
          cwdPath: "README.md",
        },
      },
      ctx
    );

    expect(absolute.ok).toBe(false);
    expect(absolute.error).toMatchObject({ code: "invalid_cwd_path" });
    expect(notDirectory.ok).toBe(false);
    expect(notDirectory.error).toMatchObject({ code: "cwd_not_directory" });
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the terminal command tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/terminal-commands.test.ts
```

Expected: FAIL because `terminal.create` ignores `cwdPath`.

- [ ] **Step 3: Extend `terminal.create` to validate and use `cwdPath`**

Update `packages/server/src/commands/terminal.ts`:

```ts
import { stat } from "fs/promises";
import { basename, isAbsolute } from "node:path";
import { resolveSafe } from "../fs/file-io.js";

registerCommand(
  "terminal.create",
  z.object({
    workspaceId: z.string(),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional(),
    cwdPath: z.string().optional(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    let cwd = workspace.path;
    if (args.cwdPath && args.cwdPath !== ".") {
      if (isAbsolute(args.cwdPath)) {
        throw { code: "invalid_cwd_path", message: "cwdPath must be workspace-relative" };
      }

      const resolvedCwd = resolveSafe(workspace.path, args.cwdPath);
      const cwdStats = await stat(resolvedCwd).catch(() => null);
      if (!cwdStats) {
        throw { code: "cwd_not_found", message: `Directory not found: ${args.cwdPath}` };
      }
      if (!cwdStats.isDirectory()) {
        throw { code: "cwd_not_directory", message: `Not a directory: ${args.cwdPath}` };
      }

      cwd = resolvedCwd;
    }

    const shell = resolveShellCommand();
    return ctx.terminalMgr.create({
      workspaceId: args.workspaceId,
      kind: "shell",
      argv: shell.argv,
      title: shell.title,
      cwd,
      cols: args.cols ?? 120,
      rows: args.rows ?? 30,
    });
  }
);
```

- [ ] **Step 4: Run the terminal command tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/terminal-commands.test.ts
```

Expected: PASS with `cwdPath` success, root fallback, and invalid-path rejection.

- [ ] **Step 5: Commit the terminal cwd slice**

```bash
git add packages/server/src/__tests__/terminal-commands.test.ts packages/server/src/commands/terminal.ts
git commit -m "feat: support terminal cwd overrides"
```

### Task 3: Share Shell-Terminal Creation State Across Surfaces

**Files:**
- Create: `packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.ts`
- Create: `packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.test.tsx`
- Modify: `packages/web/src/features/terminal-panel/atoms/terminals.ts`
- Modify: `packages/web/src/features/terminal-panel/actions/use-terminal-actions.ts`
- Modify: `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx`

- [ ] **Step 1: Write the failing shared terminal-creation tests**

Create `packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { toastsAtom } from "../../notifications/atoms";
import {
  terminalActiveIdAtomFamily,
  terminalIdsAtomFamily,
  terminalMetaAtomFamily,
} from "../atoms";
import { useCreateShellTerminal } from "./use-create-shell-terminal";

function wrapperFor(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

it("creates a shell terminal, stores it under the workspace, and activates it immediately", async () => {
  const sendCommand = vi.fn().mockResolvedValue({
    id: "term_2",
    workspaceId: "ws-test",
    kind: "shell",
    title: "Workspace Shell",
    cwd: "/tmp/ws-test/src",
    argv: ["/bin/bash"],
    cols: 120,
    rows: 30,
    alive: true,
    createdAt: 1,
  });

  const store = createStore();
  store.set(localeAtom, "en");
  store.set(wsClientAtom, { sendCommand } as never);
  store.set(terminalIdsAtomFamily("ws-test"), ["term_1"]);
  store.set(terminalActiveIdAtomFamily("ws-test"), "term_1");

  const { result } = renderHook(() => useCreateShellTerminal("ws-test"), {
    wrapper: wrapperFor(store),
  });

  await act(async () => {
    await result.current.createShellTerminal({ cwdPath: "src" });
  });

  expect(sendCommand).toHaveBeenCalledWith(
    "terminal.create",
    {
      workspaceId: "ws-test",
      cwdPath: "src",
    },
    undefined
  );
  expect(store.get(terminalIdsAtomFamily("ws-test"))).toEqual(["term_1", "term_2"]);
  expect(store.get(terminalActiveIdAtomFamily("ws-test"))).toBe("term_2");
  expect(store.get(terminalMetaAtomFamily("term_2"))).toMatchObject({
    id: "term_2",
    workspaceId: "ws-test",
    kind: "shell",
  });
});

it("shows an error toast and leaves terminal atoms unchanged when creation fails", async () => {
  const sendCommand = vi.fn().mockRejectedValue(new Error("spawn failed"));
  const store = createStore();
  store.set(localeAtom, "en");
  store.set(wsClientAtom, { sendCommand } as never);
  store.set(terminalIdsAtomFamily("ws-test"), ["term_1"]);
  store.set(terminalActiveIdAtomFamily("ws-test"), "term_1");

  const { result } = renderHook(() => useCreateShellTerminal("ws-test"), {
    wrapper: wrapperFor(store),
  });

  await act(async () => {
    await result.current.createShellTerminal({ cwdPath: "src" });
  });

  expect(store.get(terminalIdsAtomFamily("ws-test"))).toEqual(["term_1"]);
  expect(store.get(terminalActiveIdAtomFamily("ws-test"))).toBe("term_1");
  expect(store.get(toastsAtom)[0]).toMatchObject({
    kind: "error",
    title: "Could not create terminal",
    body: "spawn failed",
  });
});
```

Keep `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx` green by asserting the existing immediate-render behavior still works after the refactor.

- [ ] **Step 2: Run the terminal-panel tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/terminal-panel/actions/use-create-shell-terminal.test.tsx \
  src/features/terminal-panel/__tests__/terminal-panel.test.tsx
```

Expected: FAIL because the shared hook and workspace-scoped terminal atoms do not exist yet.

- [ ] **Step 3: Add workspace-scoped terminal ids/active id atoms and the shared create hook**

Update `packages/web/src/features/terminal-panel/atoms/terminals.ts`:

```ts
export const terminalIdsAtomFamily = atomFamily((_workspaceId: string) => atom<string[]>([]));

export const terminalActiveIdAtomFamily = atomFamily((_workspaceId: string) =>
  atom<string | null>(null)
);

export const activeTerminalsAtomFamily = atomFamily((workspaceId: string) =>
  atom((get) => get(terminalIdsAtomFamily(workspaceId)))
);
```

Create `packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.ts`:

```ts
import type { Terminal as TerminalDto } from "@coder-studio/core";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { useTranslation } from "../../../lib/i18n";
import { pushToastAtom } from "../../notifications/atoms";
import {
  terminalActiveIdAtomFamily,
  terminalIdsAtomFamily,
  terminalMetaAtomFamily,
} from "../atoms";

function toTerminalMeta(terminal: TerminalDto) {
  return {
    id: terminal.id,
    workspaceId: terminal.workspaceId,
    kind: terminal.kind,
    alive: terminal.alive,
    exitCode: terminal.exitCode,
    title: terminal.title,
  } as const;
}

export function useCreateShellTerminal(workspaceId: string | null) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const store = useStore();

  return {
    async createShellTerminal(args: { cwdPath?: string } = {}) {
      if (!workspaceId) {
        pushToast({
          kind: "warning",
          title: t("terminal.create_unavailable_title"),
          body: t("terminal.create_unavailable_body"),
        });
        return null;
      }

      const result = await dispatch<TerminalDto>("terminal.create", {
        workspaceId,
        cwdPath: args.cwdPath,
      });

      if (!result.ok || !result.data) {
        pushToast({
          kind: "error",
          title: t("terminal.create_failed_title"),
          body: result.error?.message ?? t("terminal.create_failed_body"),
        });
        return null;
      }

      const terminal = result.data;
      store.set(terminalMetaAtomFamily(terminal.id), toTerminalMeta(terminal));
      store.set(terminalIdsAtomFamily(workspaceId), (current) =>
        current.includes(terminal.id) ? current : [...current, terminal.id]
      );
      store.set(terminalActiveIdAtomFamily(workspaceId), terminal.id);
      return terminal;
    },
  };
}
```

- [ ] **Step 4: Update `useTerminalActions()` to consume the shared state**

Replace local `useState()` terminal lists in `packages/web/src/features/terminal-panel/actions/use-terminal-actions.ts` with workspace-scoped atoms and the shared create hook:

```ts
const EMPTY_WORKSPACE_ID = "__terminal_panel_empty__";

const workspaceAtomKey = activeWorkspaceId ?? EMPTY_WORKSPACE_ID;
const [terminalIds, setTerminalIds] = useAtom(terminalIdsAtomFamily(workspaceAtomKey));
const [activeTerminalId, setActiveTerminalId] = useAtom(
  terminalActiveIdAtomFamily(workspaceAtomKey)
);
const { createShellTerminal } = useCreateShellTerminal(activeWorkspaceId);
```

Keep the rest of the hook behavior aligned with the current panel:

```ts
useEffect(() => {
  if (!activeWorkspaceId) {
    setTerminalIds([]);
    setActiveTerminalId(null);
    return;
  }

  let cancelled = false;
  setTerminalIds([]);
  setActiveTerminalId(null);

  void dispatch<TerminalDto[]>("terminal.list", { workspaceId: activeWorkspaceId }).then(
    (result) => {
      if (cancelled || !result.ok || !result.data) {
        return;
      }

      const shellTerminals = result.data.filter((terminal) => terminal.kind === "shell");
      const shellIds = shellTerminals.map((terminal) => terminal.id);

      for (const terminal of shellTerminals) {
        store.set(terminalMetaAtomFamily(terminal.id), toTerminalMeta(terminal));
      }

      setTerminalIds((current) => mergeTerminalIds(current, shellIds));
      setActiveTerminalId((current) => current ?? shellIds[0] ?? null);
    }
  );

  return () => {
    cancelled = true;
  };
}, [activeWorkspaceId, dispatch, setActiveTerminalId, setTerminalIds, store]);

const handleCreateTerminal = useCallback(async () => {
  await createShellTerminal();
}, [createShellTerminal]);
```

The WS `terminal.*.created` subscription should keep appending to `terminalIdsAtomFamily(activeWorkspaceId)` and setting `terminalActiveIdAtomFamily(activeWorkspaceId)` so both in-panel and out-of-panel creates converge on one state source.

- [ ] **Step 5: Re-run the shared terminal tests and commit**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/terminal-panel/actions/use-create-shell-terminal.test.tsx \
  src/features/terminal-panel/__tests__/terminal-panel.test.tsx
```

Expected: PASS, including the existing "renders the new terminal immediately from terminal.create result" regression.

Then commit:

```bash
git add packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.ts packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.test.tsx packages/web/src/features/terminal-panel/atoms/terminals.ts packages/web/src/features/terminal-panel/actions/use-terminal-actions.ts packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx
git commit -m "refactor: share shell terminal creation state"
```

### Task 4: Extract A Shared Clipboard Helper

**Files:**
- Create: `packages/web/src/lib/clipboard.ts`
- Create: `packages/web/src/lib/clipboard.test.ts`
- Modify: `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`

- [ ] **Step 1: Write the failing clipboard helper tests**

Create `packages/web/src/lib/clipboard.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextWithFallback } from "./clipboard";

describe("copyTextWithFallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers navigator.clipboard.writeText", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    await copyTextWithFallback("alpha");

    expect(writeText).toHaveBeenCalledWith("alpha");
  });

  it("falls back to document.execCommand when clipboard.writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, {
      clipboard: { writeText },
    });
    const execCommand = vi.spyOn(document, "execCommand").mockReturnValue(true);

    await copyTextWithFallback("beta");

    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("rethrows the clipboard error when the fallback is unavailable", async () => {
    const failure = new Error("denied");
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(failure) },
    });
    vi.spyOn(document, "execCommand").mockImplementation(undefined as never);

    await expect(copyTextWithFallback("gamma")).rejects.toThrow("denied");
  });
});
```

- [ ] **Step 2: Run the clipboard tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/lib/clipboard.test.ts
```

Expected: FAIL because the helper does not exist yet.

- [ ] **Step 3: Implement the shared helper and switch `xterm-host` to it**

Create `packages/web/src/lib/clipboard.ts`:

```ts
export async function copyTextWithFallback(text: string): Promise<void> {
  let clipboardError: unknown;

  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch (error) {
    clipboardError = error;
  }

  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    throw clipboardError ?? new Error("Clipboard copy unavailable");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.padding = "0";
  textarea.style.border = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  document.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    if (!document.execCommand("copy")) {
      throw clipboardError ?? new Error("Clipboard copy unavailable");
    }
  } finally {
    textarea.remove();
  }
}
```

Update `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx` to import this helper and remove the private inline copy implementation so terminal copy and file-path copy share identical fallback behavior.

- [ ] **Step 4: Re-run the clipboard test and one xterm regression**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/lib/clipboard.test.ts \
  src/features/terminal-panel/__tests__/terminal-panel.test.tsx
```

Expected: PASS, with no terminal regressions from the import swap.

- [ ] **Step 5: Commit the shared clipboard slice**

```bash
git add packages/web/src/lib/clipboard.ts packages/web/src/lib/clipboard.test.ts packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx
git commit -m "refactor: share clipboard fallback helper"
```

### Task 5: Extend `useFileActions()` With Rename State And Path Rewrites

**Files:**
- Create: `packages/web/src/features/workspace/actions/use-file-actions.test.tsx`
- Modify: `packages/web/src/features/workspace/actions/use-file-actions.ts`

- [ ] **Step 1: Write the failing rename hook tests**

Create `packages/web/src/features/workspace/actions/use-file-actions.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../atoms/connection";
import {
  activeFilePathAtomFamily,
  fileTreeAtomFamily,
  openFilesAtomFamily,
} from "../atoms";
import { useFileActions } from "./use-file-actions";

function wrapperFor(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

it("renames the active file and rewrites the open-file map key", async () => {
  const sendCommand = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({ path: "/workspace", children: [] });

  const store = createStore();
  store.set(wsClientAtom, { sendCommand } as never);
  store.set(activeFilePathAtomFamily("ws-test"), "src/app.tsx");
  store.set(openFilesAtomFamily("ws-test"), {
    "src/app.tsx": {
      kind: "text",
      path: "src/app.tsx",
      content: "export {};",
      baseHash: "hash-1",
      isDirty: false,
    },
  });
  store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));

  const { result } = renderHook(() => useFileActions({ workspaceId: "ws-test" }), {
    wrapper: wrapperFor(store),
  });

  act(() => {
    result.current.openRenameDialog({
      path: "src/app.tsx",
      name: "app.tsx",
      kind: "file",
    });
    result.current.updateRenameDraft("main.tsx");
  });

  await act(async () => {
    await result.current.submitRenameDialog();
  });

  expect(sendCommand).toHaveBeenNthCalledWith(
    1,
    "file.rename",
    {
      workspaceId: "ws-test",
      fromPath: "src/app.tsx",
      toPath: "src/main.tsx",
    },
    undefined
  );
  expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/main.tsx");
  expect(store.get(openFilesAtomFamily("ws-test"))["src/main.tsx"]).toMatchObject({
    path: "src/main.tsx",
  });
});

it("rewrites descendant editor paths when renaming a directory", async () => {
  const sendCommand = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({ path: "/workspace", children: [] });

  const store = createStore();
  store.set(wsClientAtom, { sendCommand } as never);
  store.set(activeFilePathAtomFamily("ws-test"), "src/nested/app.tsx");
  store.set(openFilesAtomFamily("ws-test"), {
    "src/nested/app.tsx": {
      kind: "text",
      path: "src/nested/app.tsx",
      content: "export {};",
      baseHash: "hash-2",
      isDirty: false,
    },
  });
  store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));

  const { result } = renderHook(() => useFileActions({ workspaceId: "ws-test" }), {
    wrapper: wrapperFor(store),
  });

  act(() => {
    result.current.openRenameDialog({
      path: "src/nested",
      name: "nested",
      kind: "dir",
    });
    result.current.updateRenameDraft("renamed");
  });

  await act(async () => {
    await result.current.submitRenameDialog();
  });

  expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/renamed/app.tsx");
  expect(store.get(openFilesAtomFamily("ws-test"))["src/renamed/app.tsx"]).toMatchObject({
    path: "src/renamed/app.tsx",
  });
});

it("rejects blank names and names containing path separators before dispatch", async () => {
  const sendCommand = vi.fn();
  const store = createStore();
  store.set(wsClientAtom, { sendCommand } as never);
  store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));

  const { result } = renderHook(() => useFileActions({ workspaceId: "ws-test" }), {
    wrapper: wrapperFor(store),
  });

  act(() => {
    result.current.openRenameDialog({
      path: "src/app.tsx",
      name: "app.tsx",
      kind: "file",
    });
    result.current.updateRenameDraft("bad/name.tsx");
  });

  await act(async () => {
    await result.current.submitRenameDialog();
  });

  expect(sendCommand).not.toHaveBeenCalled();
  expect(result.current.renameDialog?.error).toBeTruthy();
});
```

- [ ] **Step 2: Run the rename hook tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/actions/use-file-actions.test.tsx
```

Expected: FAIL because the rename dialog state and rename path rewrite logic are missing.

- [ ] **Step 3: Add rename dialog state, validation, and path-rewrite helpers**

Update `packages/web/src/features/workspace/actions/use-file-actions.ts`:

```ts
export interface RenameDialogState {
  fromPath: string;
  currentName: string;
  nextName: string;
  kind: "file" | "dir";
  error: string | null;
}

function rewriteDescendantPath(path: string, fromPath: string, toPath: string): string {
  if (path === fromPath) {
    return toPath;
  }

  if (path.startsWith(`${fromPath}/`)) {
    return `${toPath}${path.slice(fromPath.length)}`;
  }

  return path;
}

function rewriteOpenFiles(
  openFiles: Record<string, OpenFile>,
  fromPath: string,
  toPath: string
): Record<string, OpenFile> {
  const nextEntries = Object.entries(openFiles).map(([path, file]) => {
    const rewrittenPath = rewriteDescendantPath(path, fromPath, toPath);
    if (rewrittenPath === path) {
      return [path, file] as const;
    }

    return [
      rewrittenPath,
      {
        ...file,
        path: rewrittenPath,
      },
    ] as const;
  });

  return Object.fromEntries(nextEntries);
}
```

Expose rename state from the hook:

```ts
const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null);

const openRenameDialog = useCallback(
  ({ path, name, kind }: { path: string; name: string; kind: "file" | "dir" }) => {
    setRenameDialog({
      fromPath: path,
      currentName: name,
      nextName: name,
      kind,
      error: null,
    });
  },
  []
);

const updateRenameDraft = useCallback((nextName: string) => {
  setRenameDialog((current) =>
    current
      ? {
          ...current,
          nextName,
          error: null,
        }
      : current
  );
}, []);
```

- [ ] **Step 4: Implement rename submit behavior and return it from the hook**

Continue `packages/web/src/features/workspace/actions/use-file-actions.ts`:

```ts
const submitRenameDialog = useCallback(async () => {
  if (!renameDialog) {
    return;
  }

  const nextName = renameDialog.nextName.trim();
  if (!nextName) {
    setRenameDialog((current) =>
      current
        ? {
            ...current,
            error: t("file.rename_required"),
          }
        : current
    );
    return;
  }

  if (nextName.includes("/") || nextName.includes("\\")) {
    setRenameDialog((current) =>
      current
        ? {
            ...current,
            error: t("file.rename_invalid_name"),
          }
        : current
    );
    return;
  }

  if (nextName === renameDialog.currentName) {
    setRenameDialog(null);
    return;
  }

  const lastSlashIndex = renameDialog.fromPath.lastIndexOf("/");
  const parentDir = lastSlashIndex === -1 ? "" : renameDialog.fromPath.slice(0, lastSlashIndex);
  const toPath = parentDir ? `${parentDir}/${nextName}` : nextName;

  const result = await dispatch("file.rename", {
    workspaceId,
    fromPath: renameDialog.fromPath,
    toPath,
  });

  if (!result.ok) {
    setRenameDialog((current) =>
      current
        ? {
            ...current,
            error: result.error?.message ?? t("file.rename_failed"),
          }
        : current
    );
    return;
  }

  setActiveFilePath((current) =>
    current ? rewriteDescendantPath(current, renameDialog.fromPath, toPath) : current
  );
  setOpenFiles((current) => rewriteOpenFiles(current, renameDialog.fromPath, toPath));
  await loadFileTree();
  setRenameDialog(null);
}, [dispatch, loadFileTree, renameDialog, setActiveFilePath, setOpenFiles, t, workspaceId]);
```

Return these from the hook:

```ts
return {
  activeFilePath,
  createDialog,
  renameDialog,
  pendingDelete,
  cancelDelete,
  confirmDelete,
  handleSelectFile,
  loadChildren,
  loadSearchResults,
  openCreateDialog,
  openRenameDialog,
  requestDelete: setPendingDelete,
  updateRenameDraft,
  submitRenameDialog,
  closeRenameDialog: () => setRenameDialog(null),
  updateDraftPath,
  submitCreateDialog,
  closeCreateDialog,
};
```

- [ ] **Step 5: Re-run the hook tests and commit**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/actions/use-file-actions.test.tsx
```

Expected: PASS, including active-file and open-file path rewrites.

Then commit:

```bash
git add packages/web/src/features/workspace/actions/use-file-actions.ts packages/web/src/features/workspace/actions/use-file-actions.test.tsx
git commit -m "feat: add file rename dialog state"
```

### Task 6: Build Shared File Context Actions And A Dedicated Menu Surface

**Files:**
- Create: `packages/web/src/features/workspace/actions/use-file-context-actions.ts`
- Create: `packages/web/src/features/workspace/actions/use-file-tree-context-menu.ts`
- Create: `packages/web/src/features/workspace/views/shared/file-context-menu.tsx`
- Create: `packages/web/src/features/workspace/views/shared/file-context-menu.test.tsx`

- [ ] **Step 1: Write the failing custom menu tests**

Create `packages/web/src/features/workspace/views/shared/file-context-menu.test.tsx`:

```tsx
// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileContextMenu } from "./file-context-menu";

const sections = [
  {
    id: "edit",
    title: "Edit",
    items: [
      { id: "rename", label: "Rename", onSelect: vi.fn() },
      { id: "delete", label: "Delete", tone: "danger", onSelect: vi.fn() },
    ],
  },
];

it("renders a desktop menu with menu semantics and keyboard navigation", () => {
  const onClose = vi.fn();
  render(
    <FileContextMenu
      mode="desktop"
      anchorPoint={{ x: 120, y: 80 }}
      open
      sections={sections}
      title="File actions"
      onClose={onClose}
    />
  );

  const menu = screen.getByRole("menu", { name: "File actions" });
  expect(menu).toBeInTheDocument();

  fireEvent.keyDown(menu, { key: "ArrowDown" });
  fireEvent.keyDown(menu, { key: "Enter" });

  expect(sections[0]?.items[0]?.onSelect).toHaveBeenCalled();

  fireEvent.keyDown(menu, { key: "Escape" });
  expect(onClose).toHaveBeenCalled();
});

it("renders a mobile sheet with grouped actions", () => {
  render(
    <FileContextMenu
      mode="mobile"
      open
      sections={sections}
      title="File actions"
      onClose={vi.fn()}
    />
  );

  expect(screen.getByText("Edit")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the menu tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/file-context-menu.test.tsx
```

Expected: FAIL because the dedicated menu component and the action/state hooks do not exist yet.

- [ ] **Step 3: Implement the shared action builder and context-menu state hook**

Create `packages/web/src/features/workspace/actions/use-file-context-actions.ts`:

```ts
import type { FileNode } from "@coder-studio/core";
import { useMemo } from "react";
import { copyTextWithFallback } from "../../../lib/clipboard";

export interface FileContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  tone?: "default" | "danger";
  disabled?: boolean;
  onSelect: () => void | Promise<void>;
}

export interface FileContextMenuSection {
  id: string;
  title: string;
  items: FileContextMenuItem[];
}

function toAbsolutePath(workspacePath: string, relativePath: string): string {
  const separator = workspacePath.includes("\\") ? "\\" : "/";
  const normalizedBase = workspacePath.replace(/[\\/]+$/, "");
  const normalizedRelative = relativePath.split("/").join(separator);
  return normalizedRelative ? `${normalizedBase}${separator}${normalizedRelative}` : normalizedBase;
}

function getTerminalCwdPath(node: FileNode): string | undefined {
  if (node.kind === "dir") {
    return node.path === "." ? undefined : node.path;
  }

  const lastSlash = node.path.lastIndexOf("/");
  return lastSlash === -1 ? undefined : node.path.slice(0, lastSlash);
}
```

Build the four required groups in one place:

```ts
return useMemo<FileContextMenuSection[]>(() => {
  if (!target) {
    return [];
  }

  const relativePath = target.node.path;
  const absolutePath = workspacePath ? toAbsolutePath(workspacePath, relativePath) : null;
  const terminalCwdPath = getTerminalCwdPath(target.node);

  const createSection =
    target.node.kind === "dir"
      ? [
          {
            id: "create",
            title: t("file.context_section_create"),
            items: [
              { id: "new-file", label: t("file.new_file"), onSelect: () => openCreateDialog("file", target.node.path) },
              { id: "new-folder", label: t("file.new_folder"), onSelect: () => openCreateDialog("folder", target.node.path) },
            ],
          },
        ]
      : [];

  return [
    ...createSection,
    {
      id: "edit",
      title: t("file.context_section_edit"),
      items: [
        { id: "rename", label: t("file.rename"), onSelect: () => openRenameDialog({ path: target.node.path, name: target.node.name, kind: target.node.kind }) },
        { id: "delete", label: t("file.delete"), tone: "danger", onSelect: () => requestDelete({ path: target.node.path, name: target.node.name, error: null }) },
      ],
    },
    {
      id: "path",
      title: t("file.context_section_path"),
      items: [
        { id: "copy-relative-path", label: t("file.copy_relative_path"), onSelect: () => copyTextWithFallback(relativePath) },
        { id: "copy-absolute-path", label: t("file.copy_absolute_path"), disabled: !absolutePath, onSelect: () => absolutePath ? copyTextWithFallback(absolutePath) : undefined },
      ],
    },
    {
      id: "terminal",
      title: t("file.context_section_terminal"),
      items: [
        { id: "open-in-terminal", label: t("file.open_in_terminal"), onSelect: () => createShellTerminal(terminalCwdPath ? { cwdPath: terminalCwdPath } : {}) },
      ],
    },
  ];
}, [createShellTerminal, openCreateDialog, openRenameDialog, requestDelete, t, target, workspacePath]);
```

Create `packages/web/src/features/workspace/actions/use-file-tree-context-menu.ts`:

```ts
const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

export interface FileContextTarget {
  node: FileNode;
  surface: "tree" | "search" | "mobile";
  triggerElement: HTMLElement | null;
}

export function useFileTreeContextMenu() {
  const [contextTarget, setContextTarget] = useState<FileContextTarget | null>(null);
  const [desktopAnchorPoint, setDesktopAnchorPoint] = useState<{ x: number; y: number } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const suppressNextClickRef = useRef(false);
  const longPressRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    timer: number;
    target: FileContextTarget;
  } | null>(null);

  const closeMenu = useCallback(() => {
    setDesktopAnchorPoint(null);
    setMobileOpen(false);
  }, []);

  const openDesktopMenu = useCallback((event: React.MouseEvent<HTMLElement>, target: FileContextTarget) => {
    event.preventDefault();
    setContextTarget(target);
    setDesktopAnchorPoint({ x: event.clientX, y: event.clientY });
    setMobileOpen(false);
  }, []);
```

Continue the same file with long-press open/cancel behavior:

```ts
  const beginLongPress = useCallback((event: React.PointerEvent<HTMLElement>, target: FileContextTarget) => {
    if (event.pointerType === "mouse") {
      return;
    }

    window.clearTimeout(longPressRef.current?.timer);
    longPressRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timer: window.setTimeout(() => {
        setContextTarget(target);
        setMobileOpen(true);
        setDesktopAnchorPoint(null);
        suppressNextClickRef.current = true;
      }, LONG_PRESS_MS),
      target,
    };
  }, []);

  const updateLongPress = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const current = longPressRef.current;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }

    const movedX = Math.abs(event.clientX - current.startX);
    const movedY = Math.abs(event.clientY - current.startY);
    if (movedX > MOVE_TOLERANCE_PX || movedY > MOVE_TOLERANCE_PX) {
      window.clearTimeout(current.timer);
      longPressRef.current = null;
    }
  }, []);

  const cancelLongPress = useCallback((pointerId?: number) => {
    const current = longPressRef.current;
    if (!current) {
      return;
    }

    if (pointerId !== undefined && current.pointerId !== pointerId) {
      return;
    }

    window.clearTimeout(current.timer);
    longPressRef.current = null;
  }, []);

  const consumeSuppressedClick = useCallback(() => {
    const suppressed = suppressNextClickRef.current;
    suppressNextClickRef.current = false;
    return suppressed;
  }, []);
```

- [ ] **Step 4: Implement the dedicated desktop menu and mobile sheet**

Create `packages/web/src/features/workspace/views/shared/file-context-menu.tsx` with feature-local rendering, not `ActionMenu` mutation:

```tsx
import { Sheet } from "../../../../components/ui";
import { Portal } from "../../../../components/ui/_internal/portal";

export function FileContextMenu({
  mode,
  anchorPoint,
  open,
  sections,
  title,
  onClose,
}: FileContextMenuProps) {
  if (!open) {
    return null;
  }

  if (mode === "mobile") {
    return (
      <Sheet
        title={title}
        onClose={onClose}
        body={
          <div className="file-context-menu-sheet">
            {sections.map((section) => (
              <div key={section.id} className="file-context-menu-sheet__section">
                <div className="file-context-menu-sheet__title">{section.title}</div>
                {section.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`file-context-menu__item ${item.tone === "danger" ? "file-context-menu__item--danger" : ""}`}
                    disabled={item.disabled}
                    onClick={() => {
                      void Promise.resolve(item.onSelect()).finally(onClose);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        }
      />
    );
  }

  return (
    <Portal>
      <div className="file-context-menu-layer">
        <div
          className="file-context-menu"
          role="menu"
          aria-label={title}
          style={{ left: anchorPoint?.x ?? 0, top: anchorPoint?.y ?? 0 }}
        >
          {sections.map((section) => (
            <div key={section.id} className="file-context-menu__section">
              <div className="file-context-menu__section-title">{section.title}</div>
              {section.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  className={`file-context-menu__item ${item.tone === "danger" ? "file-context-menu__item--danger" : ""}`}
                  disabled={item.disabled}
                  onClick={() => {
                    void Promise.resolve(item.onSelect()).finally(onClose);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Portal>
  );
}
```

Match the keyboard rules from the spec in this component:
- `Escape` closes the desktop menu.
- `ArrowUp` / `ArrowDown` move between enabled items.
- `Enter` / `Space` invoke the focused item.
- focus returns to the triggering row element after close.

- [ ] **Step 5: Re-run the menu test and commit**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/file-context-menu.test.tsx
```

Expected: PASS with both desktop and mobile render modes.

Then commit:

```bash
git add packages/web/src/features/workspace/actions/use-file-context-actions.ts packages/web/src/features/workspace/actions/use-file-tree-context-menu.ts packages/web/src/features/workspace/views/shared/file-context-menu.tsx packages/web/src/features/workspace/views/shared/file-context-menu.test.tsx
git commit -m "feat: add file context menu primitives"
```

### Task 7: Integrate The Custom Menu Into `FileTreePanel`

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write the failing integration tests**

Add coverage to `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx` for all required surfaces:

```tsx
import { seedReadyWorkspaceState } from "../../../test-utils/workspace-state";

it("opens the custom menu on desktop file right-click and prevents the native menu", async () => {
  const sendCommand = vi.fn().mockResolvedValue({ path: "/workspace", children: [] });
  const store = createStore();
  store.set(wsClientAtom, { sendCommand } as never);
  store.set(
    fileTreeAtomFamily("ws-test"),
    new Map([
      [
        ".",
        [
          {
            path: "src/app.tsx",
            name: "app.tsx",
            kind: "file",
          },
        ],
      ],
    ])
  );

  render(
    <Provider store={store}>
      <FileTreePanel workspaceId="ws-test" />
    </Provider>
  );

  const row = screen.getByText("app.tsx").closest(".tree-item");
  const preventDefault = vi.fn();
  fireEvent.contextMenu(row!, { preventDefault });

  expect(preventDefault).toHaveBeenCalled();
  expect(await screen.findByRole("menu")).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "file.rename" })).toBeInTheDocument();
});

it("opens the same menu from a search result row", async () => {
  const sendCommand = vi
    .fn()
    .mockResolvedValueOnce({
      files: [{ path: "src/app.tsx", name: "app.tsx", kind: "file" }],
    })
    .mockResolvedValue({ path: "/workspace", children: [] });
  const store = createStore();
  store.set(wsClientAtom, { sendCommand } as never);
  store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));

  render(
    <Provider store={store}>
      <FileTreePanel workspaceId="ws-test" />
    </Provider>
  );

  fireEvent.change(screen.getByRole("searchbox", { name: "action.search_files" }), {
    target: { value: "app" },
  });

  const row = (await screen.findByText("app.tsx")).closest(".tree-item");
  fireEvent.contextMenu(row!);

  expect(await screen.findByRole("menu")).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "file.rename" })).toBeInTheDocument();
});

it("dispatches file.rename from the rename modal", async () => {
  const sendCommand = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({ path: "/workspace", children: [] });
  const store = createStore();
  store.set(wsClientAtom, { sendCommand } as never);
  store.set(
    fileTreeAtomFamily("ws-test"),
    new Map([
      [
        ".",
        [
          {
            path: "src/app.tsx",
            name: "app.tsx",
            kind: "file",
          },
        ],
      ],
    ])
  );

  render(
    <Provider store={store}>
      <FileTreePanel workspaceId="ws-test" />
    </Provider>
  );

  fireEvent.contextMenu(screen.getByText("app.tsx").closest(".tree-item")!);
  fireEvent.click(await screen.findByRole("menuitem", { name: "file.rename" }));
  fireEvent.change(screen.getByLabelText("file.rename_name"), {
    target: { value: "main.tsx" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

  await waitFor(() => {
    expect(sendCommand).toHaveBeenNthCalledWith(
      1,
      "file.rename",
      {
        workspaceId: "ws-test",
        fromPath: "src/app.tsx",
        toPath: "src/main.tsx",
      },
      undefined
    );
  });
});

it("copies relative and absolute paths through the shared clipboard helper", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, {
    clipboard: { writeText },
  });

  const store = createStore();
  seedReadyWorkspaceState(store, {
    "ws-test": {
      id: "ws-test",
      path: "/tmp/ws-test",
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
  store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
  store.set(
    fileTreeAtomFamily("ws-test"),
    new Map([
      [
        ".",
        [
          {
            path: "src/app.tsx",
            name: "app.tsx",
            kind: "file",
          },
        ],
      ],
    ])
  );

  render(
    <Provider store={store}>
      <FileTreePanel workspaceId="ws-test" />
    </Provider>
  );

  fireEvent.contextMenu(screen.getByText("app.tsx").closest(".tree-item")!);
  fireEvent.click(await screen.findByRole("menuitem", { name: "file.copy_relative_path" }));
  fireEvent.contextMenu(screen.getByText("app.tsx").closest(".tree-item")!);
  fireEvent.click(await screen.findByRole("menuitem", { name: "file.copy_absolute_path" }));

  expect(writeText).toHaveBeenNthCalledWith(1, "src/app.tsx");
  expect(writeText).toHaveBeenNthCalledWith(2, "/tmp/ws-test/src/app.tsx");
});

it("dispatches terminal.create with a folder-aware cwdPath", async () => {
  const sendCommand = vi.fn().mockResolvedValue({
    id: "term_2",
    workspaceId: "ws-test",
    kind: "shell",
    title: "Workspace Shell",
    cwd: "/tmp/ws-test/src",
    argv: ["/bin/bash"],
    cols: 120,
    rows: 30,
    alive: true,
    createdAt: 1,
  });
  const store = createStore();
  seedReadyWorkspaceState(store, {
    "ws-test": {
      id: "ws-test",
      path: "/tmp/ws-test",
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
  store.set(wsClientAtom, { sendCommand } as never);
  store.set(
    fileTreeAtomFamily("ws-test"),
    new Map([
      [
        ".",
        [
          {
            path: "src",
            name: "src",
            kind: "dir",
            children: [],
          },
          {
            path: "README.md",
            name: "README.md",
            kind: "file",
          },
        ],
      ],
    ])
  );

  render(
    <Provider store={store}>
      <FileTreePanel workspaceId="ws-test" />
    </Provider>
  );

  fireEvent.contextMenu(screen.getByText("README.md").closest(".tree-item")!);
  fireEvent.click(await screen.findByRole("menuitem", { name: "file.open_in_terminal" }));
  fireEvent.contextMenu(screen.getByText("src").closest(".tree-item")!);
  fireEvent.click(await screen.findByRole("menuitem", { name: "file.open_in_terminal" }));

  expect(sendCommand).toHaveBeenNthCalledWith(
    1,
    "terminal.create",
    { workspaceId: "ws-test" },
    undefined
  );
  expect(sendCommand).toHaveBeenNthCalledWith(
    2,
    "terminal.create",
    { workspaceId: "ws-test", cwdPath: "src" },
    undefined
  );
});

it("opens a mobile action sheet on long press but not on ordinary tap", async () => {
  vi.useFakeTimers();
  const sendCommand = vi.fn().mockResolvedValue({ path: "/workspace", children: [] });
  const store = createStore();
  store.set(wsClientAtom, { sendCommand } as never);
  store.set(
    fileTreeAtomFamily("ws-test"),
    new Map([
      [
        ".",
        [
          {
            path: "src/app.tsx",
            name: "app.tsx",
            kind: "file",
          },
        ],
      ],
    ])
  );

  render(
    <Provider store={store}>
      <FileTreePanel workspaceId="ws-test" variant="mobile" />
    </Provider>
  );

  const row = screen.getByText("app.tsx").closest(".tree-item")!;
  fireEvent.click(row);
  expect(screen.queryByText("file.context_section_edit")).toBeNull();

  fireEvent.pointerDown(row, {
    pointerId: 1,
    pointerType: "touch",
    clientX: 20,
    clientY: 20,
  });
  await vi.advanceTimersByTimeAsync(450);

  expect(await screen.findByText("file.context_section_edit")).toBeInTheDocument();
});

it("cancels the long press when the pointer moves before the timeout", async () => {
  vi.useFakeTimers();
  const sendCommand = vi.fn().mockResolvedValue({ path: "/workspace", children: [] });
  const store = createStore();
  store.set(wsClientAtom, { sendCommand } as never);
  store.set(
    fileTreeAtomFamily("ws-test"),
    new Map([
      [
        ".",
        [
          {
            path: "src/app.tsx",
            name: "app.tsx",
            kind: "file",
          },
        ],
      ],
    ])
  );

  render(
    <Provider store={store}>
      <FileTreePanel workspaceId="ws-test" variant="mobile" />
    </Provider>
  );

  const row = screen.getByText("app.tsx").closest(".tree-item")!;
  fireEvent.pointerDown(row, {
    pointerId: 1,
    pointerType: "touch",
    clientX: 20,
    clientY: 20,
  });
  fireEvent.pointerMove(row, {
    pointerId: 1,
    pointerType: "touch",
    clientX: 50,
    clientY: 50,
  });
  await vi.advanceTimersByTimeAsync(450);

  expect(screen.queryByText("file.context_section_edit")).toBeNull();
});
```

Add these assertions in the same test file:
- desktop file rows no longer show delete buttons
- desktop folder rows keep only `New File` and `New Folder`
- mobile rows render no `.tree-item-actions`

- [ ] **Step 2: Run the file-tree panel tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/file-tree-panel.test.tsx
```

Expected: FAIL because the panel still uses native right-click behavior and has no rename flow.

- [ ] **Step 3: Wire the panel, menu, rename modal, and row-behavior changes**

Update `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx` to compose the new hooks:

```tsx
import { useAtomValue } from "jotai";
import { workspaceByIdAtomFamily } from "../../../../atoms/workspaces";
import { useCreateShellTerminal } from "../../../terminal-panel/actions/use-create-shell-terminal";
import { useFileContextActions } from "../../actions/use-file-context-actions";
import { useFileTreeContextMenu } from "../../actions/use-file-tree-context-menu";
import { FileContextMenu } from "./file-context-menu";

const workspace = useAtomValue(workspaceByIdAtomFamily(workspaceId));
const { createShellTerminal } = useCreateShellTerminal(workspaceId);
const contextMenu = useFileTreeContextMenu();
const contextSections = useFileContextActions({
  target: contextMenu.contextTarget,
  workspacePath: workspace?.path ?? null,
  createShellTerminal,
  openCreateDialog,
  openRenameDialog,
  requestDelete,
});
```

Mount the rename modal and the custom menu:

```tsx
<RenamePathModal
  dialog={renameDialog}
  onCancel={closeRenameDialog}
  onConfirm={submitRenameDialog}
  onNameChange={updateRenameDraft}
/>

<FileContextMenu
  mode={variant === "mobile" ? "mobile" : "desktop"}
  anchorPoint={contextMenu.desktopAnchorPoint}
  open={contextMenu.isOpen}
  sections={contextSections}
  title={t("file.context_menu_title")}
  onClose={contextMenu.closeMenu}
/>
```

Update tree rows and search rows so they use both active-file selection and context-target highlighting:

```tsx
<div
  className={`tree-item tree-item--${node.kind} ${selectedPath === node.path ? "selected" : ""} ${contextTargetPath === node.path ? "tree-item--context-target" : ""}`}
  onClick={() => {
    if (variant === "mobile" && contextMenu.consumeSuppressedClick()) {
      return;
    }
    onSelectFile(node.path);
  }}
  onContextMenu={(event) => {
    handleSelectFile(node.path);
    contextMenu.openDesktopMenu(event, {
      node,
      surface: "search",
      triggerElement: event.currentTarget,
    });
  }}
  onPointerDown={(event) =>
    variant === "mobile"
      ? contextMenu.beginLongPress(event, {
          node,
          surface: "mobile",
          triggerElement: event.currentTarget,
        })
      : undefined
  }
  onPointerMove={variant === "mobile" ? contextMenu.updateLongPress : undefined}
  onPointerUp={(event) => (variant === "mobile" ? contextMenu.cancelLongPress(event.pointerId) : undefined)}
  onPointerCancel={(event) => (variant === "mobile" ? contextMenu.cancelLongPress(event.pointerId) : undefined)}
>
```

Also make these concrete edits inside the same file:
- files: right-click selects the file first, then opens the custom menu
- folders: right-click only sets the context target, never toggles expansion
- search rows: use the same context menu entry point as tree rows
- desktop file rows: remove delete icon
- desktop folder rows: keep only create-file and create-folder icons
- mobile rows: remove `.tree-item-actions` entirely

Add a dedicated rename modal beside the existing create/delete modals:

```tsx
function RenamePathModal({
  dialog,
  onCancel,
  onConfirm,
  onNameChange,
}: {
  dialog: RenameDialogState | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  onNameChange: (value: string) => void;
}) {
  if (!dialog) {
    return null;
  }

  return (
    <Modal initialFocus={() => inputRef.current} onOpenChange={onCancel} open>
      <ModalHeader>
        <ModalTitle>{t("file.rename")}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <div className="form-group">
          <label htmlFor="file-rename">{t("file.rename_name")}</label>
          <Input
            id="file-rename"
            ref={inputRef}
            value={dialog.nextName}
            onChange={(event) => onNameChange(event.target.value)}
            invalid={Boolean(dialog.error)}
          />
          <span className="dialog-helper">{t("file.rename_helper")}</span>
          {dialog.error ? <span className="form-error">{dialog.error}</span> : null}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button onClick={onCancel}>{t("action.cancel")}</Button>
        <Button variant="primary" onClick={() => void onConfirm()}>
          {t("action.confirm")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
```

- [ ] **Step 4: Add strings, styles, then run the focused verification set**

Add localized labels to `packages/web/src/locales/en.json` and `packages/web/src/locales/zh.json`:

```json
"file": {
  "rename": "Rename",
  "rename_name": "Name",
  "rename_helper": "Rename within the current directory only.",
  "rename_required": "Name is required.",
  "rename_invalid_name": "Name cannot contain / or \\.",
  "rename_failed": "Could not rename file",
  "copy_relative_path": "Copy Relative Path",
  "copy_absolute_path": "Copy Absolute Path",
  "open_in_terminal": "Open in Terminal",
  "context_menu_title": "File actions",
  "context_section_create": "Create",
  "context_section_edit": "Edit",
  "context_section_path": "Path",
  "context_section_terminal": "Terminal"
}
```

Add the new classes to `packages/web/src/styles/components.css`:

```css
.tree-item--context-target {
  background: color-mix(in srgb, var(--bg-accent) 18%, transparent);
}

.file-context-menu-layer {
  position: fixed;
  inset: 0;
  z-index: var(--z-dropdown);
}

.file-context-menu {
  position: fixed;
  min-width: 220px;
  padding: var(--sp-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-surface);
  box-shadow: var(--shadow-lg);
}

.file-context-menu__section + .file-context-menu__section {
  margin-top: var(--sp-2);
  padding-top: var(--sp-2);
  border-top: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
}

.file-context-menu__item {
  display: flex;
  width: 100%;
  min-height: 44px;
  align-items: center;
  padding: var(--sp-3);
  border: 0;
  border-radius: var(--radius-lg);
  background: transparent;
  text-align: left;
}

.file-context-menu__item--danger {
  color: var(--color-error);
}

.file-tree-shell--desktop .tree-item--file .tree-item-actions {
  display: none;
}

.file-tree-shell--mobile .tree-item-actions {
  display: none;
}
```

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/__tests__/file-commands.test.ts \
  src/__tests__/terminal-commands.test.ts
```

and:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/lib/clipboard.test.ts \
  src/features/terminal-panel/actions/use-create-shell-terminal.test.tsx \
  src/features/terminal-panel/__tests__/terminal-panel.test.tsx \
  src/features/workspace/actions/use-file-actions.test.tsx \
  src/features/workspace/views/shared/file-context-menu.test.tsx \
  src/features/workspace/views/shared/file-tree-panel.test.tsx
```

and:

```bash
pnpm --filter @coder-studio/web exec biome check \
  src/lib/clipboard.ts \
  src/lib/clipboard.test.ts \
  src/features/terminal-panel/actions/use-create-shell-terminal.ts \
  src/features/terminal-panel/actions/use-create-shell-terminal.test.tsx \
  src/features/terminal-panel/atoms/terminals.ts \
  src/features/terminal-panel/actions/use-terminal-actions.ts \
  src/features/terminal-panel/views/shared/xterm-host.tsx \
  src/features/workspace/actions/use-file-actions.ts \
  src/features/workspace/actions/use-file-actions.test.tsx \
  src/features/workspace/actions/use-file-context-actions.ts \
  src/features/workspace/actions/use-file-tree-context-menu.ts \
  src/features/workspace/views/shared/file-context-menu.tsx \
  src/features/workspace/views/shared/file-context-menu.test.tsx \
  src/features/workspace/views/shared/file-tree-panel.tsx \
  src/features/workspace/views/shared/file-tree-panel.test.tsx \
  src/locales/en.json \
  src/locales/zh.json \
  src/styles/components.css
```

Expected: all targeted server tests, web tests, and Biome checks pass.

- [ ] **Step 5: Commit the integrated file-context menu feature**

```bash
git add packages/web/src/features/workspace/views/shared/file-tree-panel.tsx packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx packages/web/src/locales/en.json packages/web/src/locales/zh.json packages/web/src/styles/components.css
git commit -m "feat: add custom file context menus"
```

## Self-Review

- Spec coverage:
  - desktop tree-row right-click is covered in Task 7
  - desktop search-result right-click is covered in Task 7
  - mobile long-press action sheet is covered in Tasks 6-7
  - `rename`, `delete`, `copy relative path`, `copy absolute path`, and `open in terminal` all route through Task 6
  - `rename` command path, validation, and active/open-file rewrites are covered in Tasks 1 and 5
  - `open in terminal` with immediate terminal activation is covered in Tasks 2-3
- Placeholder scan:
  - no `TODO`, `TBD`, or “similar to Task N” shortcuts remain
- Type consistency:
  - `cwdPath`, `terminalIdsAtomFamily`, `terminalActiveIdAtomFamily`, `RenameDialogState`, and `FileContextTarget` are named consistently across later tasks
