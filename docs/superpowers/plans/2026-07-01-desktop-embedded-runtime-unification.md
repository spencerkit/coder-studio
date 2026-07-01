# Desktop Embedded Runtime Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the desktop repo build outputs from separate `runtime-bundle` and `runtime/seed` trees into one canonical embedded runtime directory consumed by desktop packaging, local smoke tests, and embedded runtime fallback paths.

**Architecture:** Keep the deploy/materialize step that turns `pnpm deploy` output into a portable runtime directory, but treat that directory as the sole repo-local embedded runtime artifact. Desktop packaging still copies resources into the installer and runtime-store activation still copies into user data, but there is no second peer runtime tree inside the repo. Runtime path resolution and smoke-local seeding both read from the same embedded runtime directory.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Vitest, esbuild, electron-builder

---

### Task 1: Lock the New Embedded Runtime Layout in Tests

**Files:**
- Modify: `scripts/build-desktop-runtime.test.ts`
- Modify: `scripts/desktop-smoke-local.test.ts`
- Modify: `packages/desktop/src/sidecar-manager.test.ts`

- [ ] **Step 1: Update the failing path expectations to the new canonical directory**

```ts
expect(buildOptions.outfile).toBe(
  "/repo/packages/desktop/dist/runtime/embedded/dist/esm/runtime-launch-entry.mjs"
);
```

```ts
const runtimeEmbeddedDir = join(repoRoot, "packages", "desktop", "dist", "runtime", "embedded");
```

```ts
runtimeEntry:
  "/Applications/Coder Studio.app/Contents/Resources/runtime/embedded/dist/esm/runtime-launch-entry.mjs",
webRoot: "/Applications/Coder Studio.app/Contents/Resources/runtime/embedded/dist/web",
```

- [ ] **Step 2: Run the targeted tests to verify they fail on the old layout**

Run: `pnpm exec vitest run --config scripts/vitest.config.ts scripts/build-desktop-runtime.test.ts scripts/desktop-smoke-local.test.ts packages/desktop/src/sidecar-manager.test.ts`

Expected: FAIL because the current implementation still references `runtime-bundle` and `runtime/seed`.

### Task 2: Switch the Build Outputs and Consumers to `runtime/embedded`

**Files:**
- Modify: `scripts/build-desktop-runtime.ts`
- Modify: `scripts/build-desktop.ts`
- Modify: `scripts/desktop-smoke-local.ts`
- Modify: `packages/desktop/src/runtime-paths.ts`

- [ ] **Step 1: Make the runtime builder emit to the canonical embedded runtime directory**

```ts
const runtimeDir = input?.runtimeDir ?? resolve(DESKTOP_DIR, "dist/runtime/embedded");
```

```ts
success(`Desktop embedded runtime built in ${resolve(DESKTOP_DIR, "dist/runtime/embedded")}`);
```

- [ ] **Step 2: Remove the repo-local second copy from the desktop build orchestration**

```ts
await buildDesktopRuntimeBundle({
  runtimeDir: join(DESKTOP_RUNTIME_DIR, "embedded"),
});
```

```ts
await mkdir(join(DESKTOP_RUNTIME_DIR, "node"), { recursive: true });
```

- [ ] **Step 3: Point smoke-local seeding and embedded runtime fallback resolution at the same directory**

```ts
const runtimeEmbeddedDir = join(repoRoot, "packages", "desktop", "dist", "runtime", "embedded");
```

```ts
runtimeEntry: activeRuntimePointer
  ? resolve(activeRuntimePointer.path, activeRuntimePointer.entry)
  : join(runtimeRoot, "embedded", "dist", "esm", "runtime-launch-entry.mjs"),
```

- [ ] **Step 4: Run the targeted tests to verify the new layout passes**

Run: `pnpm exec vitest run --config scripts/vitest.config.ts scripts/build-desktop-runtime.test.ts scripts/desktop-smoke-local.test.ts packages/desktop/src/sidecar-manager.test.ts`

Expected: PASS

### Task 3: Remove Old Layout Terminology and Re-verify

**Files:**
- Modify: `scripts/build-desktop.test.ts`
- Modify: `scripts/build-desktop-runtime.test.ts`
- Modify: `scripts/desktop-smoke-local.test.ts`
- Modify: `packages/desktop/src/runtime-store.test.ts`

- [ ] **Step 1: Rename remaining test descriptions and temporary directory names away from `seed` / `runtime-bundle` where they now describe the embedded artifact**

```ts
it("seeds the isolated runtime-store from the embedded desktop runtime", async () => {
```

```ts
const runtimeDir = await mkdtemp(join(tmpdir(), "coder-studio-runtime-embedded-"));
```

- [ ] **Step 2: Search for stale repo-local `runtime-bundle` and `runtime/seed` references**

Run: `rg -n "runtime-bundle|runtime/seed" scripts packages/desktop -S`

Expected: no repo-local embedded runtime path references remain except where user-data/runtime-store semantics intentionally differ.

- [ ] **Step 3: Re-run the focused script and desktop test suites**

Run: `pnpm exec vitest run --config scripts/vitest.config.ts scripts/build-desktop-runtime.test.ts scripts/build-desktop.test.ts scripts/desktop-smoke-local.test.ts packages/desktop/src/sidecar-manager.test.ts packages/desktop/src/runtime-store.test.ts`

Expected: PASS
