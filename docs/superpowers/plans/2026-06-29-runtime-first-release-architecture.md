# Runtime-First Release Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make runtime the primary release artifact for CLI and desktop shell by introducing a dedicated runtime package, platform-specific runtime archives, and separate release flows for runtime, shell, and CLI launcher changes.

**Architecture:** Keep `packages/server` as the shared runtime core. Add `packages/runtime` as the composition layer that owns runtime entrypoints, manifest, and compatibility metadata. Make `packages/cli` a thin launcher that resolves and starts an installed runtime artifact, while `packages/desktop` keeps shell auto-update and runtime installation/activation. Runtime release assets are archive-based and variant-specific by platform and architecture.

**Tech Stack:** TypeScript, pnpm workspaces, Node.js `fs/promises`, esbuild, tar/zip archive handling, Vitest, GitHub Actions.

**Spec reference:** `docs/superpowers/specs/2026-06-29-runtime-first-release-architecture-design.md`

---

## File Structure

**Create:**

- `packages/runtime/package.json` - runtime package metadata, scripts, and workspace dependencies
- `packages/runtime/tsconfig.json` - runtime package TypeScript config
- `packages/runtime/src/runtime-manifest.ts` - runtime manifest schema and parser
- `packages/runtime/src/runtime-release-provider.ts` - release metadata types and selection logic
- `packages/runtime/src/runtime-release-github.ts` - GitHub Release-backed runtime index/provider
- `packages/runtime/src/runtime-store.ts` - local runtime activation store
- `packages/runtime/src/runtime-installer.ts` - download/unpack/activate runtime archives
- `packages/runtime/src/runtime-launch-entry.ts` - runtime launch entrypoint for launcher/shell
- `packages/runtime/src/wsl-runtime-entry.ts` - WSL-specific runtime entrypoint
- `packages/runtime/src/runtime-compat.ts` - launcher/runtime compatibility checks
- `packages/runtime/src/index.ts` - public exports for launcher and desktop consumers
- `packages/runtime/src/**/*.test.ts` - focused unit tests for each module above

**Modify:**

- `pnpm-workspace.yaml` - include `packages/runtime`
- `package.json` - add root scripts for runtime build and runtime publish validation
- `scripts/build.ts` - keep full build invoking runtime build as part of the product build
- `scripts/build-desktop-runtime.ts` - switch runtime composition to use `packages/runtime` sources and manifest
- `scripts/build-desktop.ts` - consume the runtime artifact produced by the runtime build layer
- `scripts/build-cli.ts` - stop bundling launcher/runtime entrypoints that move into `packages/runtime`
- `scripts/publish-cli.ts` - validate launcher-only publish scope and stop requiring runtime bundle artifacts in CLI publish
- `scripts/validate-changesets.ts` - allow runtime release scope once release policy is split
- `.github/workflows/ci.yml` - add runtime package verification and release metadata checks
- `.github/workflows/publish.yml` - split CLI publish from runtime release publishing
- `.github/workflows/release-pr.yml` - keep changeset PR flow aligned with launcher-only CLI release scope
- `packages/cli/src/server-runner.ts` - replace direct CLI version/runtime coupling with runtime resolution
- `packages/cli/src/update-runtime.ts` - stop treating the CLI npm package as the update target in the runtime-first path
- `packages/cli/src/desktop-server.ts` - resolve runtime config from the new runtime package
- `packages/server/src/runtime/wsl-bootstrap.ts` - stop resolving WSL runtime entry from `cli/dist`
- `packages/desktop/src/runtime-release-provider.ts` - align release metadata with runtime variant artifacts
- `packages/desktop/src/runtime-release-github.ts` - parse the new runtime release index format
- `packages/desktop/src/runtime-installer.ts` - install archive-based runtime variants into the runtime store
- `packages/desktop/src/runtime-store.ts` - store activated runtime variant metadata and compatibility fields
- `packages/desktop/src/runtime-manifest.ts` - validate runtime manifest fields for launcher/shell compatibility
- `packages/desktop/src/runtime-bootstrap.ts` - launch from runtime store instead of desktop-local assumptions
- `packages/desktop/src/desktop-startup.ts` - resolve runtime version/feed for shell startup
- `packages/desktop/src/main.ts` - wire shell update and runtime installation against the new runtime layer
- `packages/desktop/package.json` - update runtime dependencies, build entrypoints, and electron-builder extra resources

**No changes in this plan:**

- no server core rewrite
- no desktop shell visual redesign
- no WSL browse behavior changes
- no provider-specific skill mirroring changes

---

### Task 1: Introduce The Runtime Package Skeleton

**Files:**
- Create: `packages/runtime/package.json`
- Create: `packages/runtime/tsconfig.json`
- Create: `packages/runtime/src/index.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`

- [ ] **Step 1: Write the failing workspace and build validation test**

Add a root test in `scripts` or extend an existing build test to assert the workspace includes `packages/runtime` and the root build scripts reference the new runtime package entrypoints:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("runtime workspace plumbing", () => {
  it("includes packages/runtime in the pnpm workspace", async () => {
    const workspace = await readFile("pnpm-workspace.yaml", "utf8");
    expect(workspace).toContain("packages/runtime");
  });

  it("exposes a runtime build script at the repo root", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["build:runtime"]).toBe("tsx scripts/build-runtime.ts");
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
pnpm exec vitest run scripts/build.test.ts
```

Expected: fail because `packages/runtime` and `build:runtime` are not wired yet.

- [ ] **Step 3: Add the runtime package metadata and tsconfig**

Create `packages/runtime/package.json`:

```json
{
  "name": "@coder-studio/runtime",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "build": "tsx ../../scripts/build-runtime.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@coder-studio/core": "workspace:*",
    "@coder-studio/server": "workspace:*",
    "@types/node": "^25.6.0",
    "esbuild": "^0.28.0",
    "fflate": "^0.8.2",
    "tar": "^7.5.1"
  }
}
```

Create `packages/runtime/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

Create `packages/runtime/src/index.ts`:

```ts
export * from "./runtime-manifest.js";
export * from "./runtime-release-provider.js";
export * from "./runtime-release-github.js";
export * from "./runtime-store.js";
export * from "./runtime-installer.js";
export * from "./runtime-launch-entry.js";
export * from "./wsl-runtime-entry.js";
export * from "./runtime-compat.js";
```

- [ ] **Step 4: Run the targeted validation again**

Run:

```bash
pnpm exec vitest run scripts/build.test.ts
```

Expected: still fail until the build script and package references are added.

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml package.json packages/runtime
git commit -m "feat: add runtime package skeleton"
```

### Task 2: Move Runtime Manifest, Release, Store, Installer, And Entrypoints Into `packages/runtime`

**Files:**
- Create: `packages/runtime/src/runtime-manifest.ts`
- Create: `packages/runtime/src/runtime-release-provider.ts`
- Create: `packages/runtime/src/runtime-release-github.ts`
- Create: `packages/runtime/src/runtime-store.ts`
- Create: `packages/runtime/src/runtime-installer.ts`
- Create: `packages/runtime/src/runtime-launch-entry.ts`
- Create: `packages/runtime/src/wsl-runtime-entry.ts`
- Create: `packages/runtime/src/runtime-compat.ts`
- Create: `packages/runtime/src/**/*.test.ts`
- Modify: `packages/desktop/src/runtime-release-provider.ts`
- Modify: `packages/desktop/src/runtime-release-github.ts`
- Modify: `packages/desktop/src/runtime-store.ts`
- Modify: `packages/desktop/src/runtime-installer.ts`
- Modify: `packages/desktop/src/runtime-manifest.ts`
- Modify: `packages/desktop/src/runtime-bootstrap.ts`
- Modify: `packages/desktop/src/desktop-startup.ts`
- Modify: `packages/desktop/src/main.ts`

- [ ] **Step 1: Write failing tests for runtime manifest parsing and release selection**

Add tests that assert:

```ts
import { describe, expect, it } from "vitest";
import { parseRuntimeManifest } from "@coder-studio/runtime";
import { pickLatestCompatibleRuntimeRelease } from "@coder-studio/runtime";

describe("runtime package contracts", () => {
  it("rejects manifests missing launcher compatibility fields", () => {
    expect(() =>
      parseRuntimeManifest({
        schemaVersion: 1,
        version: "1.2.3",
        entry: "dist/esm/runtime-launch-entry.mjs",
        webRoot: "dist/web"
      })
    ).toThrow();
  });

  it("selects the matching platform variant", () => {
    const release = pickLatestCompatibleRuntimeRelease(
      [
        {
          version: "1.2.3",
          platform: "win32",
          arch: "x64",
          artifactUrl: "https://example/runtime-win32-x64.zip",
          checksumSha256: "a",
          artifactSize: 1,
          publishedAt: "2026-06-29T00:00:00Z"
        },
        {
          version: "1.2.4",
          platform: "darwin",
          arch: "arm64",
          artifactUrl: "https://example/runtime-darwin-arm64.zip",
          checksumSha256: "b",
          artifactSize: 1,
          publishedAt: "2026-06-29T00:00:00Z"
        }
      ],
      { appVersion: "1.0.0", platform: "darwin", arch: "arm64" }
    );

    expect(release?.version).toBe("1.2.4");
  });
});
```

- [ ] **Step 2: Run the runtime package tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/runtime exec vitest run
```

Expected: fail because the package files do not exist yet.

- [ ] **Step 3: Implement the runtime package modules**

Move or re-export the runtime assets into `packages/runtime/src/` and keep `packages/desktop/src/*` as thin compatibility wrappers during the transition:

```ts
// packages/desktop/src/runtime-manifest.ts
export * from "@coder-studio/runtime/runtime-manifest";
```

Use the runtime package as the source of truth for:

- manifest validation
- release metadata parsing
- compatibility checks
- runtime store paths and activation
- archive install/unpack logic

- [ ] **Step 4: Run the runtime package tests again**

Run:

```bash
pnpm --filter @coder-studio/runtime exec vitest run
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime packages/desktop/src/runtime-*.ts packages/desktop/src/runtime-*.test.ts packages/desktop/src/runtime-bootstrap.ts packages/desktop/src/desktop-startup.ts packages/desktop/src/main.ts
git commit -m "feat: move runtime bundle logic into runtime package"
```

### Task 3: Make CLI A Thin Launcher Over Runtime Resolution

**Files:**
- Modify: `packages/cli/src/server-runner.ts`
- Modify: `packages/cli/src/update-runtime.ts`
- Modify: `packages/cli/src/desktop-server.ts`
- Modify: `packages/cli/src/bin.ts`
- Modify: `packages/server/src/runtime/wsl-bootstrap.ts`
- Modify: `scripts/build-cli.ts`
- Modify: `scripts/publish-cli.ts`
- Modify: `packages/cli/package.json`
- Create/Modify: `packages/cli/src/**/*.test.ts`

- [ ] **Step 1: Write a failing launcher-resolution test**

Add a test asserting `buildServerConfig()` stops hardcoding CLI version as runtime version and instead consumes resolved runtime metadata:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildServerConfig } from "./server-runner.js";

describe("cli server runner", () => {
  it("uses resolved runtime metadata instead of CLI package version as runtime version", () => {
    const config = buildServerConfig({
      runtimeVersion: "2.0.0",
      appVersion: "1.0.0"
    });

    expect(config.runtimeVersion).toBe("2.0.0");
    expect(config.appVersion).toBe("1.0.0");
  });
});
```

- [ ] **Step 2: Run the focused CLI test and verify it fails**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio exec vitest run src/server-runner.test.ts
```

Expected: fail because runtime resolution still comes from the CLI package path.

- [ ] **Step 3: Rewire CLI startup to resolve runtime artifacts**

Update CLI startup so it:

- resolves an installed runtime from the local runtime store
- reads launcher compatibility from runtime manifest
- starts runtime entrypoints from `packages/runtime`
- stops treating `@spencer-kit/coder-studio` npm package as the runtime container

Keep the CLI package as the published launcher package only.

- [ ] **Step 4: Remove runtime bundle responsibilities from CLI publish validation**

Update CLI publish checks to validate only launcher artifacts and launcher-related entrypoints.

Move runtime-specific publish validation into the runtime release flow.

- [ ] **Step 5: Run CLI and runtime-related tests**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio exec vitest run src/server-runner.test.ts src/bin.test.ts src/desktop-server.test.ts
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-bootstrap.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli packages/server/src/runtime/wsl-bootstrap.ts scripts/build-cli.ts scripts/publish-cli.ts
git commit -m "feat: make cli resolve runtime artifacts"
```

### Task 4: Split Runtime Release Assets From Desktop Shell Release Assets

**Files:**
- Create: `scripts/build-runtime.ts`
- Modify: `scripts/build-desktop-runtime.ts`
- Modify: `scripts/build-desktop.ts`
- Modify: `packages/desktop/src/runtime-release-provider.ts`
- Modify: `packages/desktop/src/runtime-release-github.ts`
- Modify: `packages/desktop/src/runtime-installer.ts`
- Modify: `packages/desktop/src/runtime-store.ts`
- Modify: `packages/desktop/package.json`

- [ ] **Step 1: Write the failing build test for runtime artifacts**

Add or extend a build test to assert the runtime build script emits:

```ts
expect(runtimeDir).toContain("runtime-manifest.json");
expect(runtimeDir).toContain("dist/esm/runtime-launch-entry.mjs");
expect(runtimeDir).toContain("dist/esm/wsl-runtime-entry.mjs");
```

- [ ] **Step 2: Run the runtime build test and verify it fails**

Run:

```bash
pnpm exec vitest run scripts/build-desktop-runtime.test.ts
```

Expected: fail until the new runtime build path is wired.

- [ ] **Step 3: Implement `scripts/build-runtime.ts`**

Create a dedicated build script that:

- compiles runtime entrypoints with esbuild
- vendors external runtime dependencies into a release archive
- writes runtime manifest metadata
- packages one archive per platform/arch variant

Keep `scripts/build-desktop-runtime.ts` as the desktop-specific consumer of the runtime artifact, not the sole owner of runtime packaging logic.

- [ ] **Step 4: Update desktop runtime installation to consume the new release metadata**

Make the desktop runtime provider and installer consume the variant index produced by the new runtime release pipeline instead of a desktop-local artifact assumption.

- [ ] **Step 5: Run the build and installer tests again**

Run:

```bash
pnpm exec vitest run scripts/build-desktop-runtime.test.ts packages/desktop/src/runtime-release-provider.test.ts packages/desktop/src/runtime-installer.test.ts packages/desktop/src/runtime-store.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-runtime.ts scripts/build-desktop-runtime.ts scripts/build-desktop.ts packages/desktop/src/runtime-release-provider.ts packages/desktop/src/runtime-release-github.ts packages/desktop/src/runtime-installer.ts packages/desktop/src/runtime-store.ts packages/desktop/package.json
git commit -m "feat: split runtime release assets from desktop shell"
```

### Task 5: Split CI And GitHub Workflows By Release Responsibility

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/publish.yml`
- Modify: `.github/workflows/release-pr.yml`
- Modify: `scripts/validate-changesets.ts`

- [ ] **Step 1: Write failing workflow validation tests**

Add lightweight script tests for release scope expectations:

```ts
import { describe, expect, it } from "vitest";
import { extractChangesetPackages } from "./validate-changesets.js";

describe("release scope", () => {
  it("allows runtime release packages in changesets when the split release flow is enabled", () => {
    const packages = extractChangesetPackages(`---
"@coder-studio/runtime": minor
---
`);

    expect(packages).toEqual(["@coder-studio/runtime"]);
  });
});
```

- [ ] **Step 2: Run the release-scope test and verify it fails**

Run:

```bash
pnpm exec vitest run scripts/validate-changesets.test.ts
```

Expected: fail until runtime release scope is allowed.

- [ ] **Step 3: Split release validation and publishing**

Update workflows so that:

- CI validates runtime build artifacts and launcher build artifacts separately
- runtime publishing publishes runtime archives and index assets
- shell publishing publishes electron installer assets
- CLI publishing stays launcher-only

Keep `release-pr.yml` aligned with the package set that changesets should version.

- [ ] **Step 4: Run the workflow-adjacent validation commands**

Run:

```bash
pnpm changeset:validate
pnpm ci:verify
```

Expected: PASS after the workflows and release scope are split.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/publish.yml .github/workflows/release-pr.yml scripts/validate-changesets.ts
git commit -m "feat: split runtime and shell release workflows"
```

### Task 6: Final Verification And Clean Handoff

**Files:**
- All files touched above

- [ ] **Step 1: Run the repository verification suite**

Run:

```bash
pnpm ci:verify
pnpm ci:test
```

Expected: PASS.

- [ ] **Step 2: Run targeted desktop runtime validation**

Run:

```bash
pnpm exec vitest run packages/desktop/src/runtime-release-provider.test.ts packages/desktop/src/runtime-release-github.test.ts packages/desktop/src/runtime-installer.test.ts packages/desktop/src/runtime-store.test.ts packages/desktop/src/runtime-bootstrap.test.ts scripts/build-desktop-runtime.test.ts scripts/build-desktop.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run targeted CLI/runtime validation**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio exec vitest run src/server-runner.test.ts src/bin.test.ts src/desktop-server.test.ts
pnpm --filter @coder-studio/runtime exec vitest run
```

Expected: PASS.

- [ ] **Step 4: Commit the final integration state**

```bash
git add -A
git commit -m "feat: move Coder Studio to runtime-first releases"
```

