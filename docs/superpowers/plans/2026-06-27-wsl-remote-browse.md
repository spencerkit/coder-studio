# WSL Remote Browse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WSL directory browsing before workspace open and add runtime-backed browse and absolute mkdir commands for opened WSL workspaces, while keeping the native launch flow unchanged.

**Architecture:** Pre-open WSL browsing stays host-mediated through new `workspace.wsl.*` commands executed via `wsl.exe`, while opened-workspace browse behavior lives under new runtime `file.*` commands. The launch modal branches between native and WSL browse commands but reuses one folder-picker UI and one `BrowseResult` shape.

**Tech Stack:** TypeScript, Node.js, React, Jotai, Vitest, WebSocket command dispatch, WSL host integration via `wsl.exe`

---

## File Map

- Create: `packages/server/src/fs/browse.ts`
  - Shared local filesystem browse helpers for host-native and runtime-backed absolute directory enumeration.
- Create: `packages/server/src/workspace/wsl-browse.ts`
  - Host-mediated WSL browse and mkdir helpers, including `wsl.exe` execution and error mapping.
- Create: `packages/server/src/__tests__/workspace/wsl-browse.test.ts`
  - Unit tests for host WSL browse helper parsing and failure mapping.
- Modify: `packages/server/src/commands/workspace.ts`
  - Register `workspace.wsl.browse` and `workspace.wsl.mkdir`, keep `workspace.browse` and `workspace.mkdir` working, and delegate native browse through the shared helper.
- Modify: `packages/server/src/commands/file.ts`
  - Register runtime `file.browse` and `file.mkdirAbsolute`.
- Modify: `packages/server/src/__tests__/workspace-commands.test.ts`
  - Regression tests for new host WSL workspace commands.
- Modify: `packages/server/src/__tests__/file-commands.test.ts`
  - Regression tests for runtime browse and absolute mkdir commands.
- Modify: `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`
  - Branch launch browse and mkdir behavior between native and WSL commands and keep `wslPath` synchronized with browse results.
- Modify: `packages/web/src/features/workspace/actions/use-workspace-launch-actions.test.tsx`
  - Action-level tests for WSL browse command selection and distro-driven reloads.
- Modify: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`
  - Render the existing folder picker for WSL launch mode in addition to distro and path controls.
- Modify: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`
  - UI regression tests for WSL browse, folder entry, and folder creation.
- Modify: `packages/web/src/ui-preview/preview-store.ts`
  - Add preview command handling for `workspace.wsl.browse` and `workspace.wsl.listDistros`.

### Task 1: Build the Host-Side WSL Browse Helper

**Files:**
- Create: `packages/server/src/workspace/wsl-browse.ts`
- Test: `packages/server/src/__tests__/workspace/wsl-browse.test.ts`

- [ ] **Step 1: Write the failing helper tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { browseWslDirectory, createWslDirectoryInDistro } from "../../workspace/wsl-browse.js";

describe("browseWslDirectory", () => {
  it("maps machine-readable WSL browse output into BrowseResult", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        ok: true,
        currentPath: "/home/spencer",
        parentPath: "/home",
        rootPaths: ["/", "/home/spencer"],
        directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
      }),
    });

    await expect(
      browseWslDirectory(
        { distro: "Ubuntu-24.04", path: "~" },
        { commandExists: async () => true, runCommand }
      )
    ).resolves.toEqual({
      currentPath: "/home/spencer",
      parentPath: "/home",
      rootPaths: ["/", "/home/spencer"],
      directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
    });
  });

  it("maps distro lookup failures to wsl_distro_not_found", async () => {
    const runCommand = vi.fn().mockRejectedValue(
      Object.assign(new Error("WSL_E_DISTRO_NOT_FOUND"), { stderr: "WSL_E_DISTRO_NOT_FOUND" })
    );

    await expect(
      browseWslDirectory(
        { distro: "Missing-Distro", path: "/home/spencer" },
        { commandExists: async () => true, runCommand }
      )
    ).rejects.toMatchObject({ code: "wsl_distro_not_found" });
  });

  it("rejects blank distro names before invoking wsl.exe", async () => {
    const runCommand = vi.fn();

    await expect(
      browseWslDirectory({ distro: "   " }, { commandExists: async () => true, runCommand })
    ).rejects.toMatchObject({ code: "invalid_path" });
    expect(runCommand).not.toHaveBeenCalled();
  });
});

describe("createWslDirectoryInDistro", () => {
  it("returns ok after a successful mkdir helper run", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ ok: true }),
    });

    await expect(
      createWslDirectoryInDistro(
        { distro: "Ubuntu-24.04", path: "/home/spencer/workspace/demo" },
        { commandExists: async () => true, runCommand }
      )
    ).resolves.toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run the helper tests to confirm failure**

Run: `pnpm --filter @coder-studio/server test -- packages/server/src/__tests__/workspace/wsl-browse.test.ts`

Expected: FAIL with missing exports or missing module errors for `../../workspace/wsl-browse.js`.

- [ ] **Step 3: Write the minimal WSL helper implementation**

```ts
import { spawn } from "node:child_process";
import { type CommandAvailabilityCheck, checkCommandAvailable } from "../provider-runtime/command-check.js";
import { type CommandRunner } from "../provider-runtime/command-runner.js";

interface WslBrowseDeps {
  commandExists?: CommandAvailabilityCheck;
  runCommand?: CommandRunner;
}

interface WslBrowseArgs {
  distro: string;
  path?: string;
}

function requireDistro(distro: string): string {
  const trimmed = distro.trim();
  if (!trimmed) {
    throw { code: "invalid_path", message: "WSL distro is required" };
  }
  return trimmed;
}

async function ensureWslAvailable(deps: WslBrowseDeps): Promise<void> {
  const checker =
    deps.commandExists ??
    ((command: string) => checkCommandAvailable(command, { runCommand: deps.runCommand }));
  const hasWsl = (await checker("wsl")) || (await checker("wsl.exe"));
  if (!hasWsl) {
    throw { code: "wsl_unavailable", message: "wsl.exe is not available" };
  }
}

function buildWslShellSnippet(mode: "browse" | "mkdir", requestedPath?: string): string {
  const serializedPath = JSON.stringify(requestedPath ?? "~");

  if (mode === "mkdir") {
    return [
      `TARGET_PATH=${serializedPath}`,
      `if [ -z "$TARGET_PATH" ] || [ "$TARGET_PATH" = "~" ]; then TARGET_PATH="$HOME"; fi`,
      `case "$TARGET_PATH" in "~/"*) TARGET_PATH="$HOME/${TARGET_PATH#~/}" ;; esac`,
      `mkdir "$TARGET_PATH"`,
      `printf '{"ok":true}\\n'`,
    ].join("; ");
  }

  return [
    `TARGET_PATH=${serializedPath}`,
    `if [ -z "$TARGET_PATH" ] || [ "$TARGET_PATH" = "~" ]; then TARGET_PATH="$HOME"; fi`,
    `case "$TARGET_PATH" in "~/"*) TARGET_PATH="$HOME/${TARGET_PATH#~/}" ;; esac`,
    `CANONICAL_PATH=$(cd "$TARGET_PATH" 2>/dev/null && pwd -P) || { printf '{"code":"not_found","message":"Directory not found"}\\n'; exit 2; }`,
    `[ -d "$CANONICAL_PATH" ] || { printf '{"code":"not_directory","message":"Path is not a directory"}\\n'; exit 3; }`,
    `HOME_PATH=$(cd "$HOME" && pwd -P)`,
    `PARENT_PATH=$(dirname "$CANONICAL_PATH")`,
    `if [ "$CANONICAL_PATH" = "/" ]; then PARENT_JSON=null; else PARENT_JSON=$(printf '"%s"' "$PARENT_PATH"); fi`,
    `DIRECTORIES=$(find "$CANONICAL_PATH" -mindepth 1 -maxdepth 1 \\( -type d -o -xtype d \\) -printf '%f\\t%p\\n' | LC_ALL=C sort | awk 'BEGIN{printf "["} {if (NR>1) printf ","; gsub(/"/,"\\\\\\"",$1); gsub(/"/,"\\\\\\"",$2); printf "{\\"name\\":\\"%s\\",\\"path\\":\\"%s\\"}", $1, $2} END{printf "]"}')`,
    `printf '{"ok":true,"currentPath":"%s","parentPath":%s,"rootPaths":["/","%s"],"directories":%s}\\n' "$CANONICAL_PATH" "$PARENT_JSON" "$HOME_PATH" "$DIRECTORIES"`,
  ].join("; ");
}

async function runLocalWslCommand(args: string[]): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn("wsl.exe", args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on("data", (chunk: string | Buffer) => {
      stdoutChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });

    child.stderr?.on("data", (chunk: string | Buffer) => {
      stderrChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderrChunks).toString("utf8") || `wsl.exe exited with code ${code}`));
        return;
      }

      resolve(Buffer.concat(stdoutChunks).toString("utf8"));
    });
  });
}

function mapWslBrowseError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("WSL_E_DISTRO_NOT_FOUND")) {
    throw { code: "wsl_distro_not_found", message: "WSL distro not found" };
  }

  if (message.includes("Permission denied")) {
    throw { code: "permission_denied", message: "Permission denied" };
  }

  throw { code: "browse_failed", message };
}

async function runWslBrowseCommand(
  mode: "browse" | "mkdir",
  input: { distro: string; path?: string },
  deps: WslBrowseDeps
): Promise<string> {
  const args = ["-d", input.distro, "--", "sh", "-lc", buildWslShellSnippet(mode, input.path)];

  try {
    if (deps.runCommand) {
      return (await deps.runCommand("wsl.exe", args, { windowsHide: true })).stdout;
    }

    return await runLocalWslCommand(args);
  } catch (error) {
    mapWslBrowseError(error);
  }
}

export async function browseWslDirectory(args: WslBrowseArgs, deps: WslBrowseDeps = {}) {
  await ensureWslAvailable(deps);
  const distro = requireDistro(args.distro);
  const stdout = await runWslBrowseCommand("browse", { distro, path: args.path }, deps);
  const payload = JSON.parse(stdout) as {
    ok: boolean;
    currentPath: string;
    parentPath: string | null;
    rootPaths: string[];
    directories: Array<{ name: string; path: string }>;
  };

  return {
    currentPath: payload.currentPath,
    parentPath: payload.parentPath,
    rootPaths: payload.rootPaths,
    directories: payload.directories,
  };
}

export async function createWslDirectoryInDistro(args: WslBrowseArgs & { path: string }, deps: WslBrowseDeps = {}) {
  await ensureWslAvailable(deps);
  const distro = requireDistro(args.distro);
  await runWslBrowseCommand("mkdir", { distro, path: args.path }, deps);
  return { ok: true as const };
}
```

- [ ] **Step 4: Re-run the helper tests**

Run: `pnpm --filter @coder-studio/server test -- packages/server/src/__tests__/workspace/wsl-browse.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the helper**

```bash
git add packages/server/src/workspace/wsl-browse.ts packages/server/src/__tests__/workspace/wsl-browse.test.ts
git commit -m "feat: add host wsl browse helper"
```

### Task 2: Wire Host Workspace Commands for WSL Browse and Mkdir

**Files:**
- Modify: `packages/server/src/commands/workspace.ts`
- Test: `packages/server/src/__tests__/workspace-commands.test.ts`

- [ ] **Step 1: Add failing host command tests**

```ts
describe("workspace.wsl.browse", () => {
  it("returns WSL browse results through the workspace command surface", async () => {
    ctx.providerRuntimeDeps = {
      commandExists: vi.fn(async () => true),
      runCommand: vi.fn(async () => ({
        stdout: JSON.stringify({
          ok: true,
          currentPath: "/home/spencer",
          parentPath: "/home",
          rootPaths: ["/", "/home/spencer"],
          directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
        }),
      })),
    } as never;

    const result = await dispatch(
      {
        kind: "command",
        id: "workspace-wsl-browse",
        op: "workspace.wsl.browse",
        args: { distro: "Ubuntu-24.04", path: "/home/spencer" },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      currentPath: "/home/spencer",
      directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
    });
  });
});

describe("workspace.wsl.mkdir", () => {
  it("creates a WSL directory through the workspace command surface", async () => {
    ctx.providerRuntimeDeps = {
      commandExists: vi.fn(async () => true),
      runCommand: vi.fn(async () => ({ stdout: JSON.stringify({ ok: true }) })),
    } as never;

    const result = await dispatch(
      {
        kind: "command",
        id: "workspace-wsl-mkdir",
        op: "workspace.wsl.mkdir",
        args: { distro: "Ubuntu-24.04", path: "/home/spencer/workspace/demo" },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run the workspace command tests**

Run: `pnpm --filter @coder-studio/server test -- packages/server/src/__tests__/workspace-commands.test.ts`

Expected: FAIL with `unknown command: workspace.wsl.browse` and `unknown command: workspace.wsl.mkdir`.

- [ ] **Step 3: Register the new host commands**

```ts
import { browseWslDirectory, createWslDirectoryInDistro } from "../workspace/wsl-browse.js";

registerHostCommand(
  "workspace.wsl.browse",
  z.object({
    distro: z.string(),
    path: z.string().optional(),
  }),
  async (args, ctx) =>
    browseWslDirectory(
      { distro: args.distro, path: args.path },
      {
        commandExists: ctx.providerRuntimeDeps?.commandExists,
        runCommand: ctx.providerRuntimeDeps?.runCommand,
      }
    )
);

registerHostCommand(
  "workspace.wsl.mkdir",
  z.object({
    distro: z.string(),
    path: z.string(),
  }),
  async (args, ctx) =>
    createWslDirectoryInDistro(
      { distro: args.distro, path: args.path },
      {
        commandExists: ctx.providerRuntimeDeps?.commandExists,
        runCommand: ctx.providerRuntimeDeps?.runCommand,
      }
    )
);
```

- [ ] **Step 4: Re-run the workspace command tests**

Run: `pnpm --filter @coder-studio/server test -- packages/server/src/__tests__/workspace-commands.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the host command wiring**

```bash
git add packages/server/src/commands/workspace.ts packages/server/src/__tests__/workspace-commands.test.ts
git commit -m "feat: expose workspace wsl browse commands"
```

### Task 3: Add Shared Local Browse Utilities and Runtime `file.*` Commands

**Files:**
- Create: `packages/server/src/fs/browse.ts`
- Modify: `packages/server/src/commands/workspace.ts`
- Modify: `packages/server/src/commands/file.ts`
- Test: `packages/server/src/__tests__/file-commands.test.ts`

- [ ] **Step 1: Add failing runtime browse and mkdir tests**

```ts
it("browses an absolute directory through file.browse", async () => {
  const result = await dispatch(
    {
      kind: "command",
      id: "file-browse-1",
      op: "file.browse",
      args: {
        workspaceId,
        path: testDir,
      },
    },
    ctx
  );

  expect(result.ok).toBe(true);
  expect(result.data).toMatchObject({
    currentPath: testDir,
    directories: expect.arrayContaining([expect.objectContaining({ name: "docs" })]),
  });
});

it("creates an absolute directory through file.mkdirAbsolute", async () => {
  const targetPath = join(testDir, "runtime-created");

  const result = await dispatch(
    {
      kind: "command",
      id: "file-mkdir-absolute-1",
      op: "file.mkdirAbsolute",
      args: {
        workspaceId,
        path: targetPath,
      },
    },
    ctx
  );

  expect(result.ok).toBe(true);
  const createdEntry = await stat(targetPath);
  expect(createdEntry.isDirectory()).toBe(true);
});
```

- [ ] **Step 2: Run the file command tests**

Run: `pnpm --filter @coder-studio/server test -- packages/server/src/__tests__/file-commands.test.ts`

Expected: FAIL with `unknown command: file.browse` and `unknown command: file.mkdirAbsolute`.

- [ ] **Step 3: Add the shared browse helper and runtime commands**

```ts
// packages/server/src/fs/browse.ts
import { mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export interface BrowseResult {
  currentPath: string;
  parentPath: string | null;
  directories: Array<{ name: string; path: string }>;
  rootPaths: string[];
}

export async function browseAbsoluteDirectory(inputPath: string): Promise<BrowseResult> {
  const currentPath = path.resolve(inputPath);
  const entries = await readdir(currentPath, { withFileTypes: true });
  const directories = (
    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          return { name: entry.name, path: entryPath };
        }
        if (!entry.isSymbolicLink()) {
          return null;
        }
        const entryStats = await stat(entryPath).catch(() => null);
        return entryStats?.isDirectory() ? { name: entry.name, path: entryPath } : null;
      })
    )
  )
    .filter((entry): entry is { name: string; path: string } => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name));

  const homePath = homedir();
  const rootPaths = Array.from(new Set([path.parse(currentPath).root, homePath]));

  return {
    currentPath,
    parentPath: currentPath === path.parse(currentPath).root ? null : path.dirname(currentPath),
    directories,
    rootPaths,
  };
}

export async function mkdirAbsoluteDirectory(inputPath: string): Promise<void> {
  const trimmedPath = inputPath.trim();

  if (!trimmedPath || !path.isAbsolute(trimmedPath)) {
    throw { code: "invalid_path", message: "Absolute path is required" };
  }

  await mkdir(path.resolve(trimmedPath), { recursive: false });
}
```

```ts
// packages/server/src/commands/workspace.ts
registerCommand(
  "workspace.browse",
  z.object({
    path: z.string().optional(),
  }),
  async (args) => browseAbsoluteDirectory(resolveBrowsePath(args.path))
);
```

```ts
// packages/server/src/commands/file.ts
registerRuntimeCommand(
  "file.browse",
  z.object({
    workspaceId: z.string(),
    path: z.string().optional(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      return browseAbsoluteDirectory(args.path ?? workspace.path);
    },
  }
);

registerRuntimeCommand(
  "file.mkdirAbsolute",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (_args, _ctx) => {
      await mkdirAbsoluteDirectory(_args.path);
      return { ok: true as const };
    },
  }
);
```

- [ ] **Step 4: Re-run the file command tests**

Run: `pnpm --filter @coder-studio/server test -- packages/server/src/__tests__/file-commands.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the runtime browse commands**

```bash
git add packages/server/src/fs/browse.ts packages/server/src/commands/workspace.ts packages/server/src/commands/file.ts packages/server/src/__tests__/file-commands.test.ts
git commit -m "feat: add runtime file browse commands"
```

### Task 4: Branch Launch Actions Between Native and WSL Browse Commands

**Files:**
- Modify: `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`
- Test: `packages/web/src/features/workspace/actions/use-workspace-launch-actions.test.tsx`

- [ ] **Step 1: Add failing action tests for WSL browse selection**

```tsx
function Harness({ onClose }: { onClose: () => void }) {
  const actions = useWorkspaceLaunchActions(onClose);

  return (
    <div>
      <div data-testid="current-path">{actions.currentPath}</div>
      <div data-testid="directories">{actions.directories.map((dir) => dir.name).join("|")}</div>
      <button type="button" onClick={() => actions.setTargetRuntime("wsl")}>
        set-runtime-wsl
      </button>
      <button type="button" onClick={() => actions.setWslDistro("Ubuntu-24.04")}>
        set-distro-ubuntu
      </button>
      <button type="button" onClick={() => actions.setWslDistro("Debian")}>
        set-distro-debian
      </button>
    </div>
  );
}

it("loads WSL directories through workspace.wsl.browse when the runtime target is wsl", async () => {
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    value: "Win32",
  });

  const sendCommand = vi.fn().mockImplementation(async (op: string) => {
    if (op === "workspace.browse") {
      return { currentPath: "/Users/tester", parentPath: "/Users", directories: [] };
    }

    if (op === "workspace.wsl.listDistros") {
      return { distros: ["Ubuntu-24.04"] };
    }

    if (op === "workspace.wsl.browse") {
      return {
        currentPath: "/home/spencer",
        parentPath: "/home",
        rootPaths: ["/", "/home/spencer"],
        directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
      };
    }

    return {};
  });

  const store = createStore();
  store.set(localeAtom, "en");
  store.set(wsClientAtom, { sendCommand } as never);

  render(
    <Provider store={store}>
      <MemoryRouter>
        <Harness onClose={vi.fn()} />
      </MemoryRouter>
    </Provider>
  );

  fireEvent.click(await screen.findByRole("button", { name: "set-runtime-wsl" }));

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith("workspace.wsl.browse", { distro: "Ubuntu-24.04" }, undefined);
  });
});

it("reloads WSL browse results when the selected distro changes", async () => {
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    value: "Win32",
  });

  const sendCommand = vi.fn().mockImplementation(async (op: string, args?: { distro?: string }) => {
    if (op === "workspace.browse") {
      return { currentPath: "/Users/tester", parentPath: "/Users", directories: [] };
    }

    if (op === "workspace.wsl.listDistros") {
      return { distros: ["Ubuntu-24.04", "Debian"] };
    }

    if (op === "workspace.wsl.browse") {
      return {
        currentPath: args?.distro === "Debian" ? "/home/debian" : "/home/spencer",
        parentPath: "/home",
        rootPaths: ["/", args?.distro === "Debian" ? "/home/debian" : "/home/spencer"],
        directories: [],
      };
    }

    return {};
  });

  const store = createStore();
  store.set(localeAtom, "en");
  store.set(wsClientAtom, { sendCommand } as never);

  render(
    <Provider store={store}>
      <MemoryRouter>
        <Harness onClose={vi.fn()} />
      </MemoryRouter>
    </Provider>
  );

  fireEvent.click(await screen.findByRole("button", { name: "set-runtime-wsl" }));

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith("workspace.wsl.browse", { distro: "Ubuntu-24.04" }, undefined);
  });

  fireEvent.click(screen.getByRole("button", { name: "set-distro-debian" }));

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith("workspace.wsl.browse", { distro: "Debian" }, undefined);
  });
});
```

- [ ] **Step 2: Run the action tests**

Run: `pnpm --filter @coder-studio/web test -- packages/web/src/features/workspace/actions/use-workspace-launch-actions.test.tsx`

Expected: FAIL because the hook still always calls `workspace.browse` and `workspace.mkdir`.

- [ ] **Step 3: Implement command branching in the launch hook**

```ts
function applyBrowseResult(result: BrowseResult) {
  setCurrentPath(result.currentPath);
  setDirectories(result.directories);
  setParentPath(result.parentPath);
  const nextRootPaths = result.rootPaths?.filter(Boolean) ?? ["/"];
  setRootPaths(nextRootPaths);
  setHomePath(nextRootPaths.find((candidate) => candidate !== "/") ?? null);
}

const loadDirectory = useCallback(
  async (path?: string) => {
    setBrowsing(true);
    setError(null);

    const isWslLaunch = isWindowsPlatform && targetRuntime === "wsl";
    const result = isWslLaunch
      ? await dispatch<BrowseResult>("workspace.wsl.browse", {
          distro: wslDistro,
          path: path ?? wslPath.trim() || undefined,
        })
      : await dispatch<BrowseResult>("workspace.browse", { path });

    if (!result.ok || !result.data) {
      setError(result.error?.message || t("workspace.launch.browse_failed"));
      return;
    }

    applyBrowseResult(result.data);
    if (isWslLaunch) {
      setWslPath(result.data.currentPath);
    }
  },
  [dispatch, isWindowsPlatform, targetRuntime, t, wslDistro, wslPath]
);
```

```ts
const submitCreateFolder = useCallback(async () => {
  const trimmedName = newFolderName.trim();
  if (!trimmedName) {
    setCreateFolderError(t("workspace.launch.folder_name_required"));
    return;
  }

  const createPath = joinChildPath(currentPath, trimmedName);
  const isWslLaunch = isWindowsPlatform && targetRuntime === "wsl";
  const createResult = isWslLaunch
    ? await dispatch<CreateDirectoryResult>("workspace.wsl.mkdir", {
        distro: wslDistro,
        path: createPath,
      })
    : await dispatch<CreateDirectoryResult>("workspace.mkdir", {
        path: createPath,
      });

  if (!createResult.ok) {
    setCreateFolderError(createResult.error?.message || t("workspace.launch.create_folder_failed"));
    return;
  }

  await loadDirectory(currentPath);
  setSelectedPath(createPath);
  setWslPath((previousPath) => (isWslLaunch ? currentPath : previousPath));
}, [currentPath, dispatch, isWindowsPlatform, loadDirectory, newFolderName, t, targetRuntime, wslDistro]);
```

```ts
useEffect(() => {
  if (!isWindowsPlatform || targetRuntime !== "wsl" || !wslDistro) {
    return;
  }

  void loadDirectory();
}, [isWindowsPlatform, loadDirectory, targetRuntime, wslDistro]);
```

- [ ] **Step 4: Re-run the action tests**

Run: `pnpm --filter @coder-studio/web test -- packages/web/src/features/workspace/actions/use-workspace-launch-actions.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit the action branching**

```bash
git add packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts packages/web/src/features/workspace/actions/use-workspace-launch-actions.test.tsx
git commit -m "feat: branch launch actions for wsl browse"
```

### Task 5: Render the WSL Folder Picker and Update Preview Wiring

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`
- Modify: `packages/web/src/ui-preview/preview-store.ts`

- [ ] **Step 1: Add failing UI tests for WSL browse and folder creation**

```tsx
it("renders the folder picker while in WSL launch mode", async () => {
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    value: "Win32",
  });

  const sendCommand = vi.fn().mockImplementation(async (op: string) => {
    if (op === "workspace.browse") {
      return { currentPath: "/Users/tester", parentPath: "/Users", directories: [] };
    }
    if (op === "workspace.wsl.listDistros") {
      return { distros: ["Ubuntu-24.04"] };
    }
    if (op === "workspace.wsl.browse") {
      return {
        currentPath: "/home/spencer",
        parentPath: "/home",
        rootPaths: ["/", "/home/spencer"],
        directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
      };
    }
    return {};
  });

  const store = createStore();
  store.set(localeAtom, "en");
  store.set(wsClientAtom, { sendCommand } as never);

  render(
    <Provider store={store}>
      <MemoryRouter>
        <WorkspaceLaunchModal onClose={vi.fn()} />
      </MemoryRouter>
    </Provider>
  );

  fireEvent.mouseDown(await screen.findByLabelText("Runtime"));
  fireEvent.click(await screen.findByText("WSL"));

  expect(await screen.findByText("workspace")).toBeInTheDocument();
  expect(screen.getByLabelText("WSL Distro")).toBeInTheDocument();
  expect(screen.getByLabelText("WSL Path")).toHaveValue("/home/spencer");
});

it("creates folders through workspace.wsl.mkdir while in WSL mode", async () => {
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    value: "Win32",
  });

  const sendCommand = vi.fn().mockImplementation(async (op: string, args?: { path?: string }) => {
    if (op === "workspace.browse") {
      return { currentPath: "/Users/tester", parentPath: "/Users", directories: [] };
    }
    if (op === "workspace.wsl.listDistros") {
      return { distros: ["Ubuntu-24.04"] };
    }
    if (op === "workspace.wsl.browse") {
      return {
        currentPath: "/home/spencer",
        parentPath: "/home",
        rootPaths: ["/", "/home/spencer"],
        directories:
          args?.path === "/home/spencer"
            ? [{ name: "workspace", path: "/home/spencer/workspace" }]
            : [
                { name: "workspace", path: "/home/spencer/workspace" },
                { name: "demo", path: "/home/spencer/demo" },
              ],
      };
    }
    if (op === "workspace.wsl.mkdir") {
      return { ok: true };
    }
    return {};
  });

  const store = createStore();
  store.set(localeAtom, "en");
  store.set(wsClientAtom, { sendCommand } as never);

  render(
    <Provider store={store}>
      <MemoryRouter>
        <WorkspaceLaunchModal onClose={vi.fn()} />
      </MemoryRouter>
    </Provider>
  );

  fireEvent.change(await screen.findByRole("combobox", { name: "Workspace Runtime" }), {
    target: { value: "wsl" },
  });
  fireEvent.click(await screen.findByRole("button", { name: "New Folder" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Folder Name" }), {
    target: { value: "demo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create Folder" }));

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith(
      "workspace.wsl.mkdir",
      { distro: "Ubuntu-24.04", path: "/home/spencer/demo" },
      undefined
    );
  });
});
```

- [ ] **Step 2: Run the modal tests**

Run: `pnpm --filter @coder-studio/web test -- packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`

Expected: FAIL because WSL mode currently swaps the folder picker out for the manual distro/path form.

- [ ] **Step 3: Render the shared picker in WSL mode and add preview handlers**

```tsx
const wslLaunchControls =
  isWindowsPlatform && targetRuntime === "wsl" ? (
    <div className="launch-wsl">
      <label className="launch-runtime__label" htmlFor="workspace-wsl-distro">
        {t("workspace.launch.wsl_distro_label")}
      </label>
      <Select
        id="workspace-wsl-distro"
        aria-label={t("workspace.launch.wsl_distro_label")}
        options={wslDistros.map((distro) => ({ value: distro, label: distro }))}
        value={wslDistro}
        onValueChange={(value) => setWslDistro(value)}
      />
      <label className="launch-runtime__label" htmlFor="workspace-wsl-path">
        {t("workspace.launch.wsl_path_label")}
      </label>
      <Input
        id="workspace-wsl-path"
        aria-label={t("workspace.launch.wsl_path_label")}
        value={wslPath}
        onChange={(event) => setWslPath(event.target.value)}
      />
    </div>
  ) : null;

const launchBody = (
  <div className="launch-body">
    {recentSection}
    {runtimeSection}
    {wslLaunchControls}
    {nativeFolderPicker}
    {error ? <div className="form-error">{error}</div> : null}
  </div>
);
```

```ts
// packages/web/src/ui-preview/preview-store.ts
export interface UiPreviewCommands {
  workspaceBrowse?: {
    currentPath: string;
    parentPath: string | null;
    directories: Array<{ name: string; path: string; itemCount?: number }>;
    rootPaths?: string[];
  };
  workspaceWslBrowse?: {
    currentPath: string;
    parentPath: string | null;
    directories: Array<{ name: string; path: string; itemCount?: number }>;
    rootPaths?: string[];
  };
  workspaceWslDistros?: string[];
}

if (op === "workspace.wsl.browse") {
  return ok((commands.workspaceWslBrowse ?? commands.workspaceBrowse) as T);
}

if (op === "workspace.wsl.listDistros") {
  return ok({ distros: commands.workspaceWslDistros ?? [] } as unknown as T);
}
```

- [ ] **Step 4: Re-run the modal tests**

Run: `pnpm --filter @coder-studio/web test -- packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit the WSL picker UI**

```bash
git add packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx packages/web/src/ui-preview/preview-store.ts
git commit -m "feat: add wsl folder picker to launch modal"
```

### Task 6: Run Final Verification and Create the Delivery Commit

**Files:**
- Modify only if a verification failure exposes a real defect in the files above.

- [ ] **Step 1: Run the targeted server suites**

Run:

```bash
pnpm --filter @coder-studio/server test -- packages/server/src/__tests__/workspace/wsl-browse.test.ts
pnpm --filter @coder-studio/server test -- packages/server/src/__tests__/workspace-commands.test.ts
pnpm --filter @coder-studio/server test -- packages/server/src/__tests__/file-commands.test.ts
```

Expected: PASS for all three commands.

- [ ] **Step 2: Run the targeted web suites**

Run:

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/features/workspace/actions/use-workspace-launch-actions.test.tsx
pnpm --filter @coder-studio/web test -- packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx
```

Expected: PASS for both commands.

- [ ] **Step 3: Run repository verification**

Run: `pnpm ci:verify`

Expected: PASS

- [ ] **Step 4: Inspect the final worktree state**

Run: `git status --short`

Expected: only the intended WSL remote browse changes are present before the final commit, and the output is empty immediately after the commit.

- [ ] **Step 5: Create the final delivery commit**

```bash
git add packages/server/src/fs/browse.ts packages/server/src/workspace/wsl-browse.ts packages/server/src/commands/workspace.ts packages/server/src/commands/file.ts packages/server/src/__tests__/workspace/wsl-browse.test.ts packages/server/src/__tests__/workspace-commands.test.ts packages/server/src/__tests__/file-commands.test.ts packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts packages/web/src/features/workspace/actions/use-workspace-launch-actions.test.tsx packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx packages/web/src/ui-preview/preview-store.ts
git commit -m "feat: add wsl remote browse"
```
