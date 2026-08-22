# Product and Desktop Release Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release the CLI and Windows/WSL Product Runtime as one independently promoted Product version, release the Desktop Shell and Windows/WSL Engine as one independently promoted Desktop version, and let Desktop clients safely merge the two signed stable feeds.

**Architecture:** Replace the unified Desktop channel with signed `product-stable` and `desktop-stable` pointers whose immutable assets live on versioned releases. The Desktop main process loads the pointers independently, pins Electron and Runtime metadata to their signed versioned release tags, validates the installed/target compatibility tuple, and keeps the existing staging, rollback, installer, and one-restart behavior. GitHub Actions builds each candidate once, runs acceptance against the immutable candidate, and automatically advances only the owning stable pointer.

**Tech Stack:** TypeScript, Node.js 24, Electron/electron-updater, Vitest, pnpm, GitHub Actions, Changesets, npm, GitHub Releases, Ed25519 signed JSON.

---

## Task 1: Introduce independent signed channel contracts

**Files:**

- Create: `packages/desktop/src/release-channel.ts`
- Create: `packages/desktop/src/product-channel.ts`
- Modify: `packages/desktop/src/desktop-channel.ts`
- Create: `packages/desktop/src/product-channel.test.ts`
- Modify: `packages/desktop/src/desktop-channel.test.ts`

- [x] Write failing tests for strict Product/Desktop schemas, canonical signature verification, release-tag validation, manifest digests, Factory Runtime provenance, and versioned asset resolution.
- [x] Run `pnpm --filter @coder-studio/desktop exec vitest run src/product-channel.test.ts src/desktop-channel.test.ts` and confirm the new tests fail for missing contracts.
- [x] Add shared safe release resolution. The implementation must derive the immutable asset location from the trusted channel URL and signed tag, never accept an absolute asset URL:

```ts
export function resolveVersionedReleaseAsset(
  channelUrl: string,
  releaseTag: string,
  assetName: string
): string {
  assertSafeReleaseTag(releaseTag);
  assertSafeAssetName(assetName);
  const pointer = new URL(channelUrl);
  const marker = "/releases/download/";
  const markerIndex = pointer.pathname.indexOf(marker);
  if (markerIndex < 0) throw new Error("Release channel URL is not tag-pinned");
  pointer.pathname = `${pointer.pathname.slice(0, markerIndex + marker.length)}${releaseTag}/${assetName}`;
  pointer.search = "";
  pointer.hash = "";
  return pointer.toString();
}
```

- [x] Define `ProductChannel` with `channel: "product"`, one product version, two Runtime manifest names and SHA-256 digests, `minShellVersion`, capability requirements, release tag/time, and Ed25519 signature.
- [x] Redefine `DesktopChannel` with `channel: "desktop"`, Shell updater/installer identity, Desktop capability tuple, exact Factory Runtime Product tag/version/manifest digest, release tag/time, and Ed25519 signature. Remove Product Runtime entries from the Desktop contract.
- [x] Run the focused tests and commit: `feat(desktop): split product and desktop release channels`.

## Task 2: Build Product and Desktop pointers from immutable artifacts

**Files:**

- Replace: `scripts/build-desktop-channel.ts`
- Modify: `scripts/build-desktop-channel.test.ts`
- Modify: `package.json`

- [x] Replace carry-forward and inferred release-mode tests with failing tests that build one Product channel from two signed Runtime manifests and one Desktop channel from Shell/Engine metadata plus an accepted Factory Runtime identity.
- [x] Cover mismatched Product versions/capabilities, wrong Shell updater version, unsafe names/tags, wrong manifest digests, missing Factory Runtime provenance, signing, and deterministic CLI argument parsing.
- [x] Run `pnpm exec vitest run --config scripts/vitest.config.ts scripts/build-desktop-channel.test.ts` and confirm the split builders are absent.
- [x] Implement `buildProductChannel()` and `buildDesktopChannel()` with a shared SHA-256 helper. The Product builder must compare the complete shared Runtime tuple:

```ts
const shared = [
  "runtimeVersion",
  "publishedAt",
  "minShellVersion",
  "requiredEngineVersion",
  "requiredNodeVersion",
  "runtimeHostApiVersion",
  "apiProtocolVersion",
  "dataSchemaVersion",
] as const;
if (shared.some((field) => windows[field] !== linux[field])) {
  throw new Error("Windows and WSL Runtime metadata must describe one Product release");
}
```

- [x] Expose explicit `product` and `desktop` commands through `pnpm release:channel`; delete routine carry-forward helpers and `full/runtime-only/migration` options.
- [x] Run the focused tests and commit: `feat(release): build independent signed channel pointers`.

## Task 3: Pin Runtime and Electron metadata to signed versioned releases

**Files:**

- Modify: `packages/desktop/src/runtime-update-manager.ts`
- Modify: `packages/desktop/src/runtime-update-manager.test.ts`
- Modify: `packages/desktop/src/wsl-installer.ts`
- Modify: `packages/desktop/src/wsl-installer.test.ts`
- Modify: `packages/desktop/src/wsl-runtime-update-adapter.ts`
- Modify: `packages/desktop/src/wsl-runtime-update-adapter.test.ts`
- Modify: `packages/desktop/src/update-manager.ts`
- Modify: `packages/desktop/src/update-manager.test.ts`

- [x] Write failing tests proving Runtime manifest bytes must match the Product-channel SHA-256 before parsing, installed Runtime compatibility metadata is available to the coordinator, and Shell checks first configure a versioned generic feed.
- [x] Add `setFeedURL(options: { provider: "generic"; url: string })` to `ShellUpdaterPort` and require `DesktopShellUpdateAdapter.checkMetadata()` to derive the release base from the signed Desktop tag before `checkForUpdates()`.
- [x] Require updater metadata name and returned version to match the Desktop channel. Keep Authenticode and downloaded-version validation unchanged.
- [x] Change Runtime adapter input from `DesktopChannelRuntime` to `ProductChannelRuntime`, resolve the signed Product release tag, verify the raw manifest digest, then run existing manifest signature and compatibility checks.
- [x] Add `getCurrentManifest()` to both native and WSL adapters so Shell-only compatibility is evaluated against installed Runtime metadata.
- [x] Run focused Desktop tests and commit: `feat(desktop): pin update metadata to signed release tags`.

## Task 4: Merge independent feeds into one safe Desktop plan

**Files:**

- Modify: `packages/core/src/domain/product-update.ts`
- Modify: `packages/desktop/src/desktop-update-coordinator.ts`
- Modify: `packages/desktop/src/desktop-update-coordinator.test.ts`
- Modify: `packages/desktop/src/desktop-update-coordinator.integration.test.ts`
- Modify: `packages/web/src/features/updates/controller.ts`
- Modify relevant Web update fixtures/tests that construct `ProductUpdateDiagnostics`

- [ ] Add failing coordinator tests for combined, Runtime-only, Shell-only, Product-feed failure, Desktop-feed failure, both-feed failure, invalid signature propagation, incompatible minimum Shell, and Shell-only validation against the installed Runtime manifest.
- [ ] Extend diagnostics with optional `productChannelError` and `desktopChannelError` fields so partial failure is visible without invalidating a safe component.
- [ ] Replace `loadChannel` with `loadProductChannel` and `loadDesktopChannel`. Use `Promise.allSettled`, but fail the check only when neither feed can yield a safe plan:

```ts
const [productResult, desktopResult] = await Promise.allSettled([
  this.deps.loadProductChannel(),
  this.deps.loadDesktopChannel(),
]);
if (productResult.status === "rejected" && desktopResult.status === "rejected") {
  throw new AggregateError(
    [productResult.reason, desktopResult.reason],
    "Product and Desktop update channels are unavailable"
  );
}
```

- [ ] Construct metadata only for available feeds, then validate the effective tuple: target Runtime or installed Runtime versus target Shell or installed Shell. Do not report `idle`/up-to-date if either feed failed; retain a failed-feed diagnostic while exposing any safe available components.
- [ ] Preserve parallel component downloads, journal recovery, one confirmation, one restart, Runtime rollback/quarantine, and Shell manual recovery behavior.
- [ ] For an active WSL environment, stage the Product release's Windows Runtime (shared Web) and Linux Runtime together and reconcile both target versions after restart.
- [ ] Run Core, Desktop, and focused Web tests; commit: `feat(desktop): coordinate independent product and desktop updates`.

## Task 5: Compile independent stable URLs and record Factory Runtime provenance

**Files:**

- Modify: `scripts/build-desktop.ts`
- Modify: `scripts/build-desktop-runtime.ts`
- Modify: `scripts/build-desktop-runtime.test.ts`
- Modify: `scripts/prepare-desktop-package.ts`
- Modify: `scripts/prepare-desktop-package.test.ts`
- Modify: `packages/desktop/src/main.ts`
- Modify: `packages/desktop/src/main-update-wiring.test.ts`
- Modify: `packages/desktop/src/environment-manager.ts`
- Modify: `packages/desktop/src/environment-manager.test.ts`

- [ ] Write failing tests for compiled `product-stable/product-channel.json` and `desktop-stable/desktop-channel.json` URLs and for exact Factory Product tag/manifest digest in packaged resources.
- [ ] Replace `__CODER_STUDIO_RUNTIME_UPDATE_URL__`/the unified URL with independent Product/Desktop channel defines. Retain acceptance-only environment overrides for both feeds and one production public key.
- [ ] Make Desktop packaging consume a pre-resolved immutable Factory Runtime directory and provenance JSON. It must not build Product Runtime from the Desktop source checkout during a production Desktop release.
- [ ] Wire main-process loaders independently, pass both to the coordinator/environment manager, and derive WSL Product manifest locations from the Product channel.
- [ ] Run focused script/Desktop tests and commit: `feat(desktop): package accepted factory runtime provenance`.

## Task 6: Separate release artifact validation

**Files:**

- Replace: `scripts/desktop-release-artifacts.ts`
- Modify: `scripts/desktop-release-artifacts.test.ts`
- Create: `scripts/release-promotion.ts`
- Create: `scripts/release-promotion.test.ts`
- Modify: `package.json`

- [ ] Write failing tests for Product bundles (CLI version plus Windows/WSL Runtime equality), Desktop bundles (Shell/installer plus Windows/WSL Engine and immutable Factory Runtime provenance), and rejection of all carry-forward/release-kind flags.
- [ ] Implement explicit `stage-product`, `validate-product`, `stage-desktop`, and `validate-desktop` commands. Product validation owns Runtime artifacts; Desktop validation owns Shell/Engine/installer and only verifies referenced Factory Runtime bytes.
- [ ] Add pure idempotent promotion planners for Product and Desktop. Product order must be npm tag -> Product release -> Product pointer -> verification -> temporary-tag cleanup; Desktop order must be Desktop release -> Desktop pointer -> verification. Any immutable digest mismatch must stop.
- [ ] Generate `promotion.json` with commit, candidate tag, accepted digests/run, previous/final pointer digests, and timestamp.
- [ ] Run focused script tests and commit: `feat(release): validate and promote split release bundles`.

## Task 7: Add the Product release and reusable compatibility acceptance workflows

**Files:**

- Create: `.github/workflows/product-release.yml`
- Create: `.github/workflows/compatibility-acceptance.yml`
- Delete: `.github/workflows/publish.yml`
- Modify: `.github/workflows/desktop-verify.yml`
- Modify: `scripts/github-workflows.test.ts`

- [ ] First rewrite workflow structure tests to require path-filtered Product version triggers plus recovery dispatch, `product-production` concurrency, immutable `v<version>` prerelease, temporary npm dist-tag, signed Windows/WSL Runtime assets, acceptance by candidate tag/digest, reusable compatibility acceptance, and automatic promotion with no environment approval.
- [ ] Confirm the workflow tests fail because `product-release.yml` and the reusable acceptance workflow do not exist.
- [ ] Implement `product-release.yml` with jobs `prepare`, `windows-runtime`, `wsl-runtime`, `publish-candidate`, `accept-cli`, `accept-runtime`, `compatibility`, and `promote`. Every acceptance job must need `publish-candidate`; `promote` must need all acceptance jobs and use `if: success()`.
- [ ] Implement `compatibility-acceptance.yml` as `workflow_call` with explicit Product/Desktop tags and channel/manifest digests. It downloads only immutable assets and never builds or publishes.
- [ ] Ensure Product promotion uses `--latest=false`, removes run-ID inputs, never downloads Desktop build assets, and advances only `product-stable` after npm succeeds.
- [ ] Run workflow tests and commit: `ci(release): publish product runtime with cli`.

## Task 8: Make Desktop publication explicit and automatically promoted

**Files:**

- Replace: `.github/workflows/desktop-release.yml`
- Modify: `.github/workflows/desktop-acceptance.yml`
- Modify: `.github/workflows/desktop-verify.yml`
- Modify: `scripts/github-workflows.test.ts`

- [ ] Add failing workflow tests for Desktop-only version trigger/recovery dispatch, `desktop-production` concurrency, Factory Runtime download from `product-stable`, immutable `desktop-v<version>` prerelease, Shell/Engine-only ownership, installed/fresh/offline/fallback acceptance, current/previous Product compatibility calls, and automatic promotion without run-ID inputs or a production environment gate.
- [ ] Rewrite `desktop-release.yml` as jobs `prepare`, `resolve-factory-product`, `windows-assets`, `wsl-engine`, `publish-candidate`, `accept-installation`, `accept-factory`, `compatibility`, and `promote`.
- [ ] Remove `full`, `runtime-only`, and inferred `migration` branches. The workflow must not publish npm or build Product Runtime; it must embed the downloaded accepted Factory Runtime and provenance.
- [ ] Keep `desktop-acceptance.yml` only as the explicit bridge/migration acceptance operation, clearly separated from routine publication.
- [ ] Promote with `--latest=false`, advance only `desktop-stable`, and upload `promotion.json` to the immutable Desktop release.
- [ ] Run workflow tests and commit: `ci(release): publish desktop shell and engine independently`.

## Task 9: Preserve the one-time legacy bridge and document operations

**Files:**

- Create: `.github/workflows/desktop-bridge-release.yml`
- Create: `docs/promotion/product-desktop-release-runbook.md`
- Modify: `scripts/github-workflows.test.ts`

- [ ] Add failing structural tests proving only the explicit bridge workflow may call `gh release edit ... --latest`, later Product/Desktop releases use `--latest=false`, and the bridge verifies both stable feeds before becoming repository-wide latest.
- [ ] Implement a manual, one-time bridge workflow that bootstraps `product-stable`, consumes an immutable bridge candidate, runs legacy installed-upgrade plus independent-feed checks, bootstraps `desktop-stable`, and then marks the bridge as the final repository-wide latest.
- [ ] Document normal Product/Desktop release triggers, automatic promotion/retry behavior, immutable-byte mismatch recovery, pointer bootstrap, bridge sequencing, and the two-release compatibility window.
- [ ] Run workflow tests and commit: `ci(release): add independent channel migration bridge`.

## Task 10: Full verification and review

**Files:** All changed files.

- [ ] Run targeted suites while fixing failures:

```bash
pnpm exec vitest run --config scripts/vitest.config.ts \
  scripts/build-desktop-channel.test.ts \
  scripts/desktop-release-artifacts.test.ts \
  scripts/release-promotion.test.ts \
  scripts/github-workflows.test.ts
pnpm --filter @coder-studio/desktop test
pnpm --filter @coder-studio/core test
pnpm --filter @coder-studio/web test
```

- [ ] Search for stale production coupling and remove it outside the documented bridge:

```bash
rg -n "releases/latest/download|desktop_acceptance_run_id|cli_acceptance_run_id|release_kind|runtime-only|migration|publish-release-channel" \
  .github/workflows packages/desktop/src scripts
```

- [ ] Run `pnpm ci:verify` and require exit code 0.
- [ ] Review the diff against every design Goal, Non-goal, acceptance scenario, promotion order, failure behavior, and migration invariant. Check for placeholders, unpinned assets, arbitrary URLs, rebuilt candidates, manual approvals, copied run IDs, and cross-owned artifacts.
- [ ] Use `superpowers:requesting-code-review`, address findings with `superpowers:receiving-code-review`, rerun affected tests, then run `pnpm ci:verify` again.
- [ ] Commit final corrections and hand off with changed-file summary, verification evidence, risks, skipped hosted acceptance, and assumptions.
