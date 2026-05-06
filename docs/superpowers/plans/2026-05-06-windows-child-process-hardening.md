# Windows Child Process Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate avoidable Windows console popups from non-PTY child-process calls while keeping provider/session PTY startup behavior unchanged.

**Architecture:** Do not add Windows-specific branching to provider session command construction; `claude`/`codex` should continue to be launched the same way across platforms through `node-pty`. Instead, harden the separate non-PTY paths that currently use `spawn()`/`execFile()` directly by always setting `windowsHide: true`, then add tests and a Windows CI lane so the distinction stays enforced.

**Tech Stack:** TypeScript, Node.js `child_process`, node-pty, Vitest, GitHub Actions.

---

## File Structure

- Modify: `packages/server/src/supervisor/evaluator.ts` - add `windowsHide: true` to the headless evaluator `spawn()` path.
- Modify: `packages/server/src/provider-runtime/command-check.ts` - extend command lookup execution so `execFile()` can receive `windowsHide: true`.
- Modify: `packages/server/src/provider-runtime/install-manager.ts` - thread `windowsHide: true` through provider auto-install `execFile()` calls.
- Modify: `packages/server/src/workspace/runtime-check.ts` - thread `windowsHide: true` through git/node runtime checks.
- Modify: `packages/server/src/git/cli.ts` - add `windowsHide: true` to git subprocess execution.
- Modify: `packages/cli/src/browser.ts` - add `windowsHide: true` to the browser-launch `spawn()` path on Windows.
- Modify: `packages/server/src/__tests__/provider-runtime/command-check.test.ts` - assert Windows lookup uses `where` and passes `windowsHide: true`.
- Modify: `packages/server/src/__tests__/provider-runtime/install-manager.test.ts` - assert install steps pass `windowsHide: true` into the injected executor.
- Modify: `packages/server/src/__tests__/workspace/runtime-check.test.ts` - assert runtime checks pass `windowsHide: true` into the injected executor.
- Modify: `packages/server/src/__tests__/git/cli.test.ts` - assert git subprocesses use `windowsHide: true`.
- Create: `packages/server/src/supervisor/evaluator.windows.test.ts` - isolate the `spawn()` call and assert `windowsHide: true` is present.
- Create: `packages/cli/src/browser.test.ts` - isolate the browser-launch `spawn()` call and assert `windowsHide: true` is present.
- Modify: `.github/workflows/ci.yml` - add a `windows-latest` job for targeted tests/build verification.

## Task 1: Lock The Scope With Failing Windows-Option Tests

**Files:**
- Modify: `packages/server/src/__tests__/provider-runtime/command-check.test.ts`
- Modify: `packages/server/src/__tests__/provider-runtime/install-manager.test.ts`
- Modify: `packages/server/src/__tests__/workspace/runtime-check.test.ts`
- Modify: `packages/server/src/__tests__/git/cli.test.ts`
- Create: `packages/server/src/supervisor/evaluator.windows.test.ts`
- Create: `packages/cli/src/browser.test.ts`

- [ ] **Step 1: Extend the command-check test to expect `windowsHide: true`**

Update `packages/server/src/__tests__/provider-runtime/command-check.test.ts` so the injected executor records the options object:

```ts
it("passes windowsHide when checking commands on Windows", async () => {
  const execFile = vi.fn(async () => ({ stdout: "C:\\bin\\claude.cmd\n", stderr: "" }));

  await expect(
    checkCommandAvailable("claude", { platform: "win32", execFile })
  ).resolves.toBe(true);

  expect(execFile).toHaveBeenCalledWith("where", ["claude"], {
    windowsHide: true,
  });
});
```

- [ ] **Step 2: Extend install-manager and runtime-check tests to expect `windowsHide: true`**

Update the injected executor signatures in `packages/server/src/__tests__/provider-runtime/install-manager.test.ts` and `packages/server/src/__tests__/workspace/runtime-check.test.ts` so they assert the third argument:

```ts
const execFile = vi.fn(async (_file: string, _args: string[], options?: { windowsHide?: boolean }) => {
  expect(options).toEqual({ windowsHide: true });
  return { stdout: "", stderr: "" };
});
```

- [ ] **Step 3: Add a git executor test that proves `runGit()` hides Windows windows**

Add a targeted mock-based test in `packages/server/src/__tests__/git/cli.test.ts`:

```ts
it("passes windowsHide to execFile for git commands", async () => {
  const execFileMock = vi.fn((_file, _args, options, callback) => {
    callback(null, "ok", "");
    return { stdin: null } as never;
  });

  vi.doMock("child_process", () => ({ execFile: execFileMock }));
  const { runGit } = await import("../../git/cli.js");

  await expect(runGit("/repo", ["status"])).resolves.toEqual({ stdout: "ok", stderr: "" });
  expect(execFileMock).toHaveBeenCalledWith(
    "git",
    ["status"],
    expect.objectContaining({ windowsHide: true }),
    expect.any(Function)
  );
});
```

- [ ] **Step 4: Add isolated spawn tests for the supervisor evaluator and browser opener**

Create `packages/server/src/supervisor/evaluator.windows.test.ts` and `packages/cli/src/browser.test.ts` with hoisted `vi.mock("node:child_process")` setup:

```ts
const { spawn } = vi.hoisted(() => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event, cb) => {
      if (event === "exit") cb(0);
    }),
    once: vi.fn((event, cb) => {
      if (event === "spawn") cb();
    }),
    unref: vi.fn(),
    pid: 123,
  })),
}));

vi.mock("node:child_process", () => ({ spawn }));
```

Assert both call sites include `windowsHide: true`:

```ts
expect(spawn).toHaveBeenCalledWith(
  expect.any(String),
  expect.any(Array),
  expect.objectContaining({ windowsHide: true })
);
```

- [ ] **Step 5: Run the targeted tests to verify they fail before production changes**

Run:

```bash
pnpm --filter @coder-studio/server vitest run \
  src/__tests__/provider-runtime/command-check.test.ts \
  src/__tests__/provider-runtime/install-manager.test.ts \
  src/__tests__/workspace/runtime-check.test.ts \
  src/__tests__/git/cli.test.ts \
  src/supervisor/evaluator.windows.test.ts

pnpm --filter @spencer-kit/coder-studio vitest run src/browser.test.ts
```

Expected: FAIL because the current implementation does not pass `windowsHide: true` and the injected executor signatures do not yet accept an options object.

- [ ] **Step 6: Commit the failing-test scaffold**

```bash
git add \
  packages/server/src/__tests__/provider-runtime/command-check.test.ts \
  packages/server/src/__tests__/provider-runtime/install-manager.test.ts \
  packages/server/src/__tests__/workspace/runtime-check.test.ts \
  packages/server/src/__tests__/git/cli.test.ts \
  packages/server/src/supervisor/evaluator.windows.test.ts \
  packages/cli/src/browser.test.ts
git commit -m "test: cover windows child process options"
```

## Task 2: Add `windowsHide: true` To Every Non-PTY Runtime Subprocess Path

**Files:**
- Modify: `packages/server/src/supervisor/evaluator.ts`
- Modify: `packages/server/src/provider-runtime/command-check.ts`
- Modify: `packages/server/src/provider-runtime/install-manager.ts`
- Modify: `packages/server/src/workspace/runtime-check.ts`
- Modify: `packages/server/src/git/cli.ts`
- Modify: `packages/cli/src/browser.ts`

- [ ] **Step 1: Update the shared `execFile` dependency signatures to accept options**

Change the server-side dependency types from:

```ts
execFile?: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
```

to:

```ts
execFile?: (
  file: string,
  args: string[],
  options?: { windowsHide?: boolean }
) => Promise<{ stdout: string; stderr: string }>;
```

Apply this in:

- `packages/server/src/provider-runtime/command-check.ts`
- `packages/server/src/provider-runtime/install-manager.ts`
- `packages/server/src/workspace/runtime-check.ts`

- [ ] **Step 2: Pass `windowsHide: true` through all server `execFile()` wrappers**

Update each real executor to forward the option into Node:

```ts
const execFile = deps.execFile ?? ((file: string, args: string[], options) =>
  execFileAsync(file, args, options)
);
```

and each invocation to use:

```ts
await execFile(lookup, [command], { windowsHide: true });
```

Apply the same pattern to provider install and runtime check calls.

- [ ] **Step 3: Add `windowsHide: true` to direct `spawn()`/`execFile()` runtime call sites**

Update:

- `packages/server/src/supervisor/evaluator.ts`

```ts
const child = spawn(command.argv[0]!, command.argv.slice(1), {
  cwd: command.cwd,
  detached: process.platform !== "win32",
  env: { ...process.env, ...command.env },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
```

- `packages/server/src/git/cli.ts`

```ts
const child = execFile(
  "git",
  gitArgs,
  {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
      LANG: "C",
      ...options.env,
    },
    maxBuffer: 10 * 1024 * 1024,
    timeout: options.timeoutMs,
    windowsHide: true,
  },
  callback
);
```

- `packages/cli/src/browser.ts`

```ts
const child = spawn(command, args, {
  detached: true,
  stdio: "ignore",
  windowsHide: true,
});
```

- [ ] **Step 4: Re-run the targeted tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server vitest run \
  src/__tests__/provider-runtime/command-check.test.ts \
  src/__tests__/provider-runtime/install-manager.test.ts \
  src/__tests__/workspace/runtime-check.test.ts \
  src/__tests__/git/cli.test.ts \
  src/supervisor/evaluator.windows.test.ts

pnpm --filter @spencer-kit/coder-studio vitest run src/browser.test.ts
```

Expected: PASS with every non-PTY child process now explicitly hiding its console window on Windows.

- [ ] **Step 5: Commit the runtime hardening changes**

```bash
git add \
  packages/server/src/supervisor/evaluator.ts \
  packages/server/src/provider-runtime/command-check.ts \
  packages/server/src/provider-runtime/install-manager.ts \
  packages/server/src/workspace/runtime-check.ts \
  packages/server/src/git/cli.ts \
  packages/cli/src/browser.ts
git commit -m "fix: hide windows console windows for background subprocesses"
```

## Task 3: Prove Provider/PTy Startup Semantics Stay Unchanged

**Files:**
- Verify: `packages/providers/src/claude/definition.ts`
- Verify: `packages/providers/src/codex/definition.ts`
- Verify: `packages/server/src/session/manager.ts`
- Verify: `packages/server/src/terminal/pty-host.ts`

- [ ] **Step 1: Re-read the provider/PTy launch chain and confirm no Windows-specific provider branching is introduced**

Confirm these invariants remain true:

```ts
// packages/providers/src/claude/definition.ts
argv: ["claude", ...modelArg, ...(cfg.additionalArgs ?? [])]

// packages/providers/src/codex/definition.ts
argv: ["codex", ...cfg.additionalArgs]

// packages/server/src/session/manager.ts
const terminalSpec: TerminalSpec = {
  kind: "agent",
  argv: cmd.argv,
  cwd: cmd.cwd,
  env: { ...cmd.env, CODER_STUDIO_SESSION_ID: sessionId },
};
```

- [ ] **Step 2: Run existing provider and session tests to keep that contract locked**

Run:

```bash
pnpm --filter @coder-studio/providers vitest run src/claude/definition.test.ts src/codex/definition.test.ts
pnpm --filter @coder-studio/server vitest run src/__tests__/session-integration.test.ts src/__tests__/session-commands.test.ts
```

Expected: PASS with no changes to `claude`/`codex` argv construction and no new Windows-only provider branching.

- [ ] **Step 3: Commit only if a regression guard needed adjustment**

If no source changes were needed, skip committing in this task. If any expectation text was tightened, use:

```bash
git add packages/providers/src/claude/definition.test.ts packages/providers/src/codex/definition.test.ts packages/server/src/__tests__/session-integration.test.ts packages/server/src/__tests__/session-commands.test.ts
git commit -m "test: lock provider launch parity across platforms"
```

## Task 4: Add Windows CI Coverage And Document What It Can And Cannot Prove

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add a Windows job that runs targeted runtime tests and builds**

Update `.github/workflows/ci.yml` to keep the existing Ubuntu job and add a focused Windows lane:

```yaml
  windows-runtime:
    name: Windows runtime verification
    runs-on: windows-latest
    permissions:
      contents: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10.33.2
          run_install: false

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: "pnpm"

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run targeted Windows tests
        run: |
          pnpm --filter @coder-studio/providers test -- --run src/claude/definition.test.ts src/codex/definition.test.ts
          pnpm --filter @coder-studio/server test -- --run src/__tests__/provider-runtime/command-check.test.ts src/__tests__/provider-runtime/install-manager.test.ts src/__tests__/workspace/runtime-check.test.ts src/__tests__/git/cli.test.ts src/supervisor/evaluator.windows.test.ts src/__tests__/session-commands.test.ts src/__tests__/session-integration.test.ts
          pnpm --filter @spencer-kit/coder-studio test -- --run src/browser.test.ts src/bin.test.ts src/pm2-control.test.ts src/server-control.test.ts

      - name: Build server and cli packages
        run: |
          pnpm --filter @coder-studio/server build
          pnpm --filter @spencer-kit/coder-studio build
```

- [ ] **Step 2: Run local workflow validation for YAML syntax**

Run:

```bash
pnpm exec biome check .github/workflows/ci.yml
```

Expected: PASS with no YAML/formatting issues.

- [ ] **Step 3: State the verification boundary explicitly in the PR/final summary**

Use this exact language in the close-out:

```md
Windows CI now proves that our non-PTY subprocess paths pass `windowsHide: true` and that provider/session PTY startup still works with the existing cross-platform argv contract. It does not visually prove the absence of a transient desktop console flash from node-pty itself; that still requires a manual smoke check on a real Windows desktop.
```

- [ ] **Step 4: Commit the CI coverage update**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add windows runtime verification"
```

## Self-Review

- [ ] Provider session startup is explicitly kept cross-platform and unchanged; the plan only hardens non-PTY subprocesses.
- [ ] `execFile` is retained for one-shot commands; the plan does not switch to `exec`, because `exec` would introduce an unnecessary shell layer.
- [ ] `spawn` call sites are only used where streaming/detached behavior is already needed, and the plan adds `windowsHide: true` there as well.
- [ ] The plan distinguishes what code inspection and CI can prove from what still requires manual Windows desktop validation.

