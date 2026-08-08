# Unified Desktop and CLI Update Coordination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one Desktop update coordinator that safely plans Shell and Product Runtime updates while preserving the independent global npm CLI updater, explicit environment routing, component version boundaries, and trustworthy release-time display.

**Architecture:** Electron Main is the only Desktop update authority and composes a signed Desktop channel, an `electron-updater` Shell adapter, native/WSL Runtime adapters, atomic settings, and a durable plan journal. The Server remains the only CLI update authority; the Web resolves an explicit runtime context into Desktop, CLI, or read-only adapters and renders one normalized product-level state without mixing the component installation protocols.

**Tech Stack:** TypeScript, Electron, `electron-updater`, Ed25519 signatures, Node.js filesystem/process APIs, Fastify/WebSocket commands, React 19, Jotai, Vitest, Playwright, pnpm, npm registry metadata, GitHub Actions, and electron-builder.

**Spec reference:** `docs/superpowers/specs/2026-08-08-unified-desktop-cli-update-coordination-design.md`

**Delivery boundary:** This remains one plan because the routing contract, compatibility index, Desktop coordinator, Web adapters, and CLI regression gate must agree in one release. Every task leaves its own focused tests green, and Tasks 2–5 keep the current CLI check/install/restart path as an early blocking baseline rather than deferring CLI verification to the end.

**Git hygiene:** The worktree already contains unrelated user-owned changes and untracked documentation. Read before patching, never revert or sweep unrelated files, and stage only the exact files listed in each commit step.

---

## File Structure

- `packages/core/src/domain/update.ts` and new `product-update.ts` own the wire/presentation contracts shared by Server and Web.
- `packages/server/src/update/**`, `packages/server/src/storage/repositories/update-state-repo.ts`, and `packages/cli/src/update-*.ts` keep the CLI npm updater independent and backward compatible.
- `packages/desktop/src/runtime-manifest.ts`, new `desktop-channel.ts`, `build-info.ts`, settings/journal stores, and component adapters own Desktop trust and persistence boundaries.
- New `packages/desktop/src/desktop-update-coordinator.ts` owns Desktop policy; `main.ts`, `protocol.ts`, and `preload.ts` only wire lifecycle and IPC.
- New `packages/web/src/features/updates/controller.ts` and `use-update-controller.ts` resolve Desktop, CLI, or read-only authority; About/footer components only render normalized state and invoke controller actions.
- `scripts/build-desktop*.ts`, `desktop-release-artifacts.ts`, acceptance runners, and the Desktop/CLI release workflows enforce immutable metadata, release times, compatibility, and real-upgrade gates.

The appendix named “Complete File Map” records every created and modified file with its single responsibility.

---

### Task 1: Add shared authority and schema-v2 update contracts

**Files:**
- Create: `packages/core/src/domain/product-update.ts`
- Create: `packages/core/src/domain/product-update.test.ts`
- Modify: `packages/core/src/domain/update.ts`
- Modify: `packages/core/src/domain/update.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/server/src/storage/repositories/update-state-repo.ts`
- Modify: `packages/server/src/__tests__/update-state-repo.test.ts`

- [ ] **Step 1: Write failing contract and lazy-migration tests**

Add assertions that the CLI default is schema v2, Desktop defaults use six hours, and a schema-v1 file is normalized in memory without being rewritten until the next mutation:

```ts
// packages/core/src/domain/product-update.test.ts
import { describe, expect, it } from "vitest";
import {
  createDefaultDesktopUpdateSettings,
  createDefaultProductUpdateState,
} from "./product-update";

describe("product update contracts", () => {
  it("creates a read-only state from an explicit runtime context", () => {
    const context = {
      environment: "desktop-managed" as const,
      authority: "desktop" as const,
      supported: true,
      unsupportedReason: null,
    };
    expect(createDefaultProductUpdateState(context, "0.5.0", null)).toMatchObject({
      schemaVersion: 1,
      runtimeContext: context,
      status: "idle",
      productVersion: "0.5.0",
      productPublishedAt: null,
      planId: null,
      components: [],
      restartRequired: false,
    });
  });

  it("uses a six-hour Desktop automatic-check default", () => {
    expect(createDefaultDesktopUpdateSettings()).toEqual({
      schemaVersion: 1,
      autoCheckEnabled: true,
      checkIntervalSec: 21600,
    });
  });
});
```

```ts
// packages/server/src/__tests__/update-state-repo.test.ts
it("reads v1 without writing and upgrades on the next mutation", () => {
  writeFileSync(filePath, JSON.stringify({
    version: 1,
    currentVersion: "0.4.0",
    latestVersion: "0.5.0",
    availability: "update_available",
    updateStatus: "idle",
    lastCheckedAt: 100,
    targetVersion: null,
    startedAt: null,
    finishedAt: null,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
  }));

  expect(repo.get()).toMatchObject({
    version: 2,
    currentPublishedAt: null,
    latestPublishedAt: null,
  });
  expect(JSON.parse(readFileSync(filePath, "utf8")).version).toBe(1);

  repo.update({ latestPublishedAt: "2026-08-08T01:02:03.000Z" });
  expect(JSON.parse(readFileSync(filePath, "utf8"))).toMatchObject({
    version: 2,
    latestPublishedAt: "2026-08-08T01:02:03.000Z",
  });
});
```

- [ ] **Step 2: Run the tests and verify the missing contracts fail**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/update.test.ts src/domain/product-update.test.ts
pnpm --filter @coder-studio/server exec vitest run src/__tests__/update-state-repo.test.ts
```

Expected: FAIL because `product-update.ts` does not exist and the repository still emits `version: 1`.

- [ ] **Step 3: Implement the contracts and lossless reader**

Define the persisted CLI boundary in `packages/core/src/domain/update.ts`:

```ts
export interface UpdateStateFields {
  currentVersion: string;
  latestVersion: string | null;
  availability: UpdateAvailability;
  updateStatus: UpdateStatus;
  lastCheckedAt: number | null;
  targetVersion: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  requiresManualStep: boolean;
  manualCommand: string | null;
  errorSummary: string | null;
}

export interface UpdateStateSnapshotV1 extends UpdateStateFields {
  version: 1;
}

export interface UpdateStateSnapshot extends UpdateStateFields {
  version: 2;
  currentPublishedAt: string | null;
  latestPublishedAt: string | null;
}

export type ReadableUpdateStateSnapshot = UpdateStateSnapshotV1 | UpdateStateSnapshot;

export interface UpdateSupportInfo {
  supported: boolean;
  installKind: "global_npm" | "unsupported";
  unsupportedReason: string | null;
  runtimeContext: UpdateRuntimeContext;
}

export function createDefaultUpdateState(
  currentVersion: string,
  currentPublishedAt: string | null = null
): UpdateStateSnapshot {
  return {
    version: 2,
    currentVersion,
    currentPublishedAt,
    latestVersion: null,
    latestPublishedAt: null,
    availability: "unknown",
    updateStatus: "idle",
    lastCheckedAt: null,
    targetVersion: null,
    startedAt: null,
    finishedAt: null,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
  };
}
```

Create `packages/core/src/domain/product-update.ts` with the complete shared presentation boundary:

```ts
import type { UpdateActivitySummary, UpdateCheckIntervalSec } from "./update";

export type UpdateAuthority = "desktop" | "cli" | "none";
export type UpdateEnvironment =
  | "desktop-native"
  | "desktop-wsl"
  | "cli-global-npm"
  | "cli-unsupported"
  | "desktop-managed";

export interface UpdateRuntimeContext {
  environment: UpdateEnvironment;
  authority: UpdateAuthority;
  supported: boolean;
  unsupportedReason: string | null;
}

export type ProductUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "restarting"
  | "succeeded"
  | "failed"
  | "manual_required"
  | "unsupported";

export type UpdateComponentId =
  | "shell"
  | "runtime:win32-x64"
  | "runtime:linux-x64"
  | "cli";
export type UpdateComponentKind = "shell" | "runtime" | "cli";

export interface ProductUpdateComponent {
  id: UpdateComponentId;
  kind: UpdateComponentKind;
  target: "win32-x64" | "linux-x64" | null;
  currentVersion: string;
  currentPublishedAt: string | null;
  targetVersion: string | null;
  targetPublishedAt: string | null;
  status: ProductUpdateStatus;
  progressPercent: number | null;
  downloaded: boolean;
  verified: boolean;
  errorSummary: string | null;
}

export interface UpdateCompatibilityResult {
  compatible: boolean;
  code: string | null;
  summary: string | null;
}

export interface ProductUpdateDiagnostics {
  failedComponentId: UpdateComponentId | null;
  failedPhase: string | null;
  shellVersion: string | null;
  shellPublishedAt: string | null;
  shellBuiltAt: string | null;
  engineVersion: string | null;
  nodeVersion: string | null;
  runtimeHostApiVersion: number | null;
  apiProtocolVersion: number | null;
  dataSchemaVersion: number | null;
  logLocations: string[];
  recoveryAction: string | null;
}

export interface ProductUpdateState {
  schemaVersion: 1;
  runtimeContext: UpdateRuntimeContext;
  status: ProductUpdateStatus;
  productVersion: string;
  productPublishedAt: string | null;
  planId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastCheckedAt: number | null;
  components: ProductUpdateComponent[];
  compatibility: UpdateCompatibilityResult;
  diagnostics: ProductUpdateDiagnostics;
  restartRequired: boolean;
  requiresManualStep: boolean;
  manualCommand: string | null;
  errorSummary: string | null;
}

export interface DesktopUpdateSettings {
  schemaVersion: 1;
  autoCheckEnabled: boolean;
  checkIntervalSec: UpdateCheckIntervalSec;
}

export interface ProductUpdatePreparation {
  state: ProductUpdateState;
  activity: UpdateActivitySummary;
  canProceed: boolean;
}

export function createDefaultDesktopUpdateSettings(): DesktopUpdateSettings {
  return { schemaVersion: 1, autoCheckEnabled: true, checkIntervalSec: 21600 };
}

export function createDefaultProductUpdateState(
  runtimeContext: UpdateRuntimeContext,
  productVersion: string,
  productPublishedAt: string | null
): ProductUpdateState {
  return {
    schemaVersion: 1,
    runtimeContext,
    status: runtimeContext.supported ? "idle" : "unsupported",
    productVersion,
    productPublishedAt,
    planId: null,
    createdAt: null,
    updatedAt: null,
    lastCheckedAt: null,
    components: [],
    compatibility: { compatible: true, code: null, summary: null },
    diagnostics: {
      failedComponentId: null,
      failedPhase: null,
      shellVersion: null,
      shellPublishedAt: null,
      shellBuiltAt: null,
      engineVersion: null,
      nodeVersion: null,
      runtimeHostApiVersion: null,
      apiProtocolVersion: null,
      dataSchemaVersion: null,
      logLocations: [],
      recoveryAction: null,
    },
    restartRequired: false,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
  };
}
```

Export `./domain/product-update` from `packages/core/src/index.ts`. In `UpdateStateRepo`, normalize both schema versions to `UpdateStateSnapshot`, accept only valid ISO strings for release times, and force `version: 2` in `set`, `update`, and `reset`:

```ts
function normalizePublishedAt(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

// inside normalizeUpdateState
return {
  version: 2,
  currentVersion:
    typeof value.currentVersion === "string" ? value.currentVersion : defaults.currentVersion,
  currentPublishedAt: normalizePublishedAt(value.currentPublishedAt),
  latestVersion: typeof value.latestVersion === "string" ? value.latestVersion : null,
  latestPublishedAt: normalizePublishedAt(value.latestPublishedAt),
  availability,
  updateStatus,
  lastCheckedAt: typeof value.lastCheckedAt === "number" ? value.lastCheckedAt : null,
  targetVersion: typeof value.targetVersion === "string" ? value.targetVersion : null,
  startedAt: typeof value.startedAt === "number" ? value.startedAt : null,
  finishedAt: typeof value.finishedAt === "number" ? value.finishedAt : null,
  requiresManualStep:
    typeof value.requiresManualStep === "boolean" ? value.requiresManualStep : false,
  manualCommand: typeof value.manualCommand === "string" ? value.manualCommand : null,
  errorSummary: typeof value.errorSummary === "string" ? value.errorSummary : null,
};
```

- [ ] **Step 4: Run focused tests and type-check Core/Server**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/update.test.ts src/domain/product-update.test.ts
pnpm --filter @coder-studio/server exec vitest run src/__tests__/update-state-repo.test.ts
pnpm --filter @coder-studio/core exec tsc -p tsconfig.json --noEmit
pnpm --filter @coder-studio/server exec tsc -p tsconfig.json --noEmit
```

Expected: PASS; an existing v1 file remains v1 after `get()` and becomes v2 after `update()`.

- [ ] **Step 5: Commit the shared boundary**

```bash
git add packages/core/src/domain/product-update.ts packages/core/src/domain/product-update.test.ts packages/core/src/domain/update.ts packages/core/src/domain/update.test.ts packages/core/src/index.ts packages/server/src/storage/repositories/update-state-repo.ts packages/server/src/__tests__/update-state-repo.test.ts
git commit -m "feat: add unified update contracts"
```

---

### Task 2: Fetch npm versions and authoritative publication times

**Files:**
- Create: `packages/server/src/update/npm-release-metadata.ts`
- Create: `packages/server/src/update/npm-release-metadata.test.ts`
- Modify: `packages/server/src/update/update-service.ts`
- Modify: `packages/server/src/update/update-service.test.ts`
- Modify: `packages/server/src/commands/updates.test.ts`

- [ ] **Step 1: Write failing metadata and service tests**

```ts
// packages/server/src/update/npm-release-metadata.test.ts
import { describe, expect, it, vi } from "vitest";
import { lookupNpmReleaseMetadata } from "./npm-release-metadata.js";

describe("lookupNpmReleaseMetadata", () => {
  it("resolves the selected tag and both publication times", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      "dist-tags": { latest: "0.6.0", next: "0.7.0-beta.1" },
      time: {
        "0.5.0": "2026-07-01T02:03:04.000Z",
        "0.7.0-beta.1": "2026-08-08T03:04:05.000Z",
      },
    }), { status: 200 }));

    await expect(lookupNpmReleaseMetadata({
      packageName: "@spencer-kit/coder-studio",
      currentVersion: "0.5.0",
      distTag: "next",
      registryUrl: "https://registry.npmjs.org/",
      fetch: fetchImpl,
    })).resolves.toEqual({
      version: "0.7.0-beta.1",
      currentPublishedAt: "2026-07-01T02:03:04.000Z",
      latestPublishedAt: "2026-08-08T03:04:05.000Z",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://registry.npmjs.org/%40spencer-kit%2Fcoder-studio",
      expect.objectContaining({ cache: "no-store" })
    );
  });
});
```

Add service tests that assert a successful check persists both timestamps, an offline check retains cached timestamps while returning `availability: "check_failed"`, concurrent checks still return `update_busy`, and all pre-existing install/activity tests remain unchanged.

- [ ] **Step 2: Run the focused Server tests and confirm failure**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/update/npm-release-metadata.test.ts src/update/update-service.test.ts src/commands/updates.test.ts
```

Expected: FAIL because the packument client and schema-v2 timestamp persistence do not exist.

- [ ] **Step 3: Add the packument client and wire it into `UpdateService`**

Create `packages/server/src/update/npm-release-metadata.ts`:

```ts
export interface NpmReleaseMetadata {
  version: string;
  currentPublishedAt: string | null;
  latestPublishedAt: string | null;
}

function normalizePublishedAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export async function lookupNpmReleaseMetadata(input: {
  packageName: string;
  currentVersion: string;
  distTag: string;
  registryUrl: string;
  fetch?: typeof fetch;
}): Promise<NpmReleaseMetadata> {
  const registry = new URL(input.registryUrl.endsWith("/") ? input.registryUrl : `${input.registryUrl}/`);
  const url = new URL(encodeURIComponent(input.packageName), registry);
  if (url.origin !== registry.origin) throw new Error("npm registry package URL changed origin");
  const response = await (input.fetch ?? fetch)(url.toString(), { cache: "no-store" });
  if (!response.ok) throw new Error(`npm registry request failed with ${response.status}`);
  const data = await response.json() as {
    "dist-tags"?: Record<string, unknown>;
    time?: Record<string, unknown>;
  };
  const version = data["dist-tags"]?.[input.distTag];
  if (typeof version !== "string" || !version.trim()) {
    throw new Error(`npm registry did not return dist-tag ${input.distTag}`);
  }
  return {
    version: version.trim(),
    currentPublishedAt: normalizePublishedAt(data.time?.[input.currentVersion]),
    latestPublishedAt: normalizePublishedAt(data.time?.[version.trim()]),
  };
}
```

Extend `UpdateRuntimeConfig` with `registryUrl` and `distTag`. Replace `runLatestVersionLookup` with this dependency while retaining a compatibility injection for existing tests:

```ts
runReleaseMetadataLookup?: (input: {
  packageName: string;
  currentVersion: string;
  distTag: string;
  registryUrl: string;
}) => Promise<NpmReleaseMetadata>;
```

In `runCheckForUpdates()`, persist the returned fields and leave the cached release values untouched in the catch branch:

```ts
const release = await this.withCheckTimeout(this.runReleaseMetadataLookup({
  packageName: this.runtime.packageName,
  currentVersion: this.runtime.currentVersion,
  distTag: this.runtime.distTag,
  registryUrl: this.runtime.registryUrl,
}));
const availability = compareVersions(release.version, this.runtime.currentVersion) > 0
  ? "update_available"
  : "up_to_date";
return this.persistAndBroadcast({
  currentVersion: this.runtime.currentVersion,
  currentPublishedAt: release.currentPublishedAt,
  latestVersion: release.version,
  latestPublishedAt: release.latestPublishedAt,
  availability,
  updateStatus: "idle",
  lastCheckedAt: this.now(),
  errorSummary: null,
  requiresManualStep: false,
  manualCommand: null,
}, false);
```

When startup reconciliation detects the installed target, promote the cached target timestamp:

```ts
currentPublishedAt: current.latestPublishedAt,
latestPublishedAt: current.latestPublishedAt,
```

- [ ] **Step 4: Run the Server update suite**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/update/npm-release-metadata.test.ts src/update/update-service.test.ts src/commands/updates.test.ts src/__tests__/update-state-repo.test.ts
```

Expected: PASS, including the original check timeout, activity confirmation, exact target, manual fallback, and startup reconciliation cases.

- [ ] **Step 5: Commit npm release metadata support**

```bash
git add packages/server/src/update/npm-release-metadata.ts packages/server/src/update/npm-release-metadata.test.ts packages/server/src/update/update-service.ts packages/server/src/update/update-service.test.ts packages/server/src/commands/updates.test.ts
git commit -m "feat: include npm release times in updates"
```

---

### Task 3: Preserve schema-v2 metadata through the detached CLI worker

**Files:**
- Modify: `packages/server/src/update/update-service.ts`
- Modify: `packages/server/src/update/update-service.test.ts`
- Modify: `packages/cli/src/update-worker.ts`
- Modify: `packages/cli/src/update-worker.test.ts`

- [ ] **Step 1: Write failing worker metadata tests**

Extend the worker fixture with both timestamps and assert every terminal worker state retains them:

```ts
function createEnv() {
  const dir = mkdtempSync(join(tmpdir(), "update-worker-"));
  tempDirs.push(dir);
  return {
    stateFilePath: join(dir, "update-state.json"),
    logFilePath: join(dir, "update-worker.log"),
    packageName: "@spencer-kit/coder-studio",
    targetVersion: "0.5.0",
    cliCommand: "coder-studio",
    currentVersion: "0.4.0",
    currentPublishedAt: "2026-07-01T00:00:00.000Z",
    targetPublishedAt: "2026-08-08T00:00:00.000Z",
    npmCommand: "npm",
    restartArgs: ["serve", "--restart"],
    installArgsPrefix: ["install", "-g"],
  };
}

it.each([
  ["restarting", async (env: ReturnType<typeof createEnv>) =>
    runUpdateWorker(env, {
      runCommand: vi.fn(async () => {}),
      spawnDetachedProcess: vi.fn(async () => {}),
      now: () => 1000,
    })],
  ["manual_required", async (env: ReturnType<typeof createEnv>) =>
    runUpdateWorker(env, {
      runCommand: vi.fn(async () => { throw new Error("EACCES"); }),
      now: () => 1000,
    })],
])("writes v2 metadata for %s", async (updateStatus, run) => {
  const env = createEnv();
  await run(env);
  expect(JSON.parse(readFileSync(env.stateFilePath, "utf8"))).toMatchObject({
    version: 2,
    updateStatus,
    currentPublishedAt: env.currentPublishedAt,
    latestPublishedAt: env.targetPublishedAt,
  });
});
```

In the Server test, assert `spawnDetachedWorker` receives `currentPublishedAt` and `targetPublishedAt` from the persisted check result.

- [ ] **Step 2: Run CLI and Server tests and verify schema-v1 writes fail**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio exec vitest run src/update-worker.test.ts
pnpm --filter @coder-studio/server exec vitest run src/update/update-service.test.ts
```

Expected: FAIL because the worker environment has no publication fields and writes `version: 1`.

- [ ] **Step 3: Pass timestamps to the worker and centralize its state builder**

Add optional fields to `WorkerEnv`, environment parsing, environment serialization, and the Server spawn input:

```ts
interface WorkerEnv {
  stateFilePath: string;
  logFilePath: string;
  packageName: string;
  targetVersion: string;
  cliCommand: string;
  currentVersion: string;
  currentPublishedAt: string | null;
  targetPublishedAt: string | null;
  npmCommand: string;
  restartArgs: string[];
  installArgsPrefix: string[];
}

function createWorkerState(
  input: WorkerEnv,
  now: number,
  patch: Partial<Pick<UpdateStateSnapshot,
    | "availability"
    | "updateStatus"
    | "startedAt"
    | "finishedAt"
    | "requiresManualStep"
    | "manualCommand"
    | "errorSummary"
  >>
): UpdateStateSnapshot {
  return {
    version: 2,
    currentVersion: input.currentVersion,
    currentPublishedAt: input.currentPublishedAt,
    latestVersion: input.targetVersion,
    latestPublishedAt: input.targetPublishedAt,
    availability: "update_available",
    updateStatus: "installing",
    lastCheckedAt: now,
    targetVersion: input.targetVersion,
    startedAt: now,
    finishedAt: null,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
    ...patch,
  };
}
```

Use `createWorkerState()` for permission failure, ordinary failure, restarting, and restart-handoff failure. Add these environment variables in both Server spawn and `buildWorkerEnv()`:

```ts
CODER_STUDIO_UPDATE_CURRENT_PUBLISHED_AT: input.currentPublishedAt ?? "",
CODER_STUDIO_UPDATE_TARGET_PUBLISHED_AT: input.targetPublishedAt ?? "",
```

Read empty or invalid values as `null`. Do not read or write the Desktop journal from this worker.

- [ ] **Step 4: Run worker, service, and startup-reconcile regression tests**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio exec vitest run src/update-worker.test.ts src/server-runner.test.ts
pnpm --filter @coder-studio/server exec vitest run src/update/update-service.test.ts src/__tests__/update-state-repo.test.ts
```

Expected: PASS; exact `npm install -g <package>@<target>`, detached restart handoff, permission/manual fallback, ordinary failure, restart failure, and environment sanitization remain covered.

- [ ] **Step 5: Commit the detached-worker migration**

```bash
git add packages/server/src/update/update-service.ts packages/server/src/update/update-service.test.ts packages/cli/src/update-worker.ts packages/cli/src/update-worker.test.ts
git commit -m "feat: preserve update metadata in cli worker"
```

---

### Task 4: Route update authority explicitly for CLI and Desktop sidecars

**Files:**
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/src/config.test.ts`
- Modify: `packages/server/src/update/update-service.ts`
- Modify: `packages/server/src/update/update-service.test.ts`
- Modify: `packages/cli/src/update-runtime.ts`
- Modify: `packages/cli/src/update-runtime.test.ts`
- Modify: `packages/cli/src/server-runner.test.ts`
- Modify: `packages/desktop/src/sidecar.ts`
- Modify: `packages/desktop/src/sidecar.test.ts`

- [ ] **Step 1: Write the five routing-row tests**

Add assertions for supported global CLI, unsupported CLI, Desktop-managed Server, native Desktop bridge context, and WSL Desktop bridge context. The Server/CLI portion must include these exact expectations:

```ts
expect(getUpdateRuntimeInfo(import.meta.url)).toMatchObject({
  supported: true,
  installKind: "global_npm",
  runtimeContext: {
    environment: "cli-global-npm",
    authority: "cli",
    supported: true,
    unsupportedReason: null,
  },
  registryUrl: "https://registry.npmjs.org/",
  distTag: "latest",
});

expect(desktopManagedState).toMatchObject({
  supported: false,
  installKind: "unsupported",
  runtimeContext: {
    environment: "desktop-managed",
    authority: "desktop",
    supported: true,
    unsupportedReason: null,
  },
});
```

In `sidecar.test.ts`, dispatch `updates.check` and `updates.startInstall` against the constructed sidecar context and expect `update_unsupported`; also assert the injected `spawnDetachedWorker` and npm metadata lookup spies have zero calls.

- [ ] **Step 2: Run routing tests and verify missing contexts fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/config.test.ts src/update/update-service.test.ts
pnpm --filter @spencer-kit/coder-studio exec vitest run src/update-runtime.test.ts src/server-runner.test.ts
pnpm --filter @coder-studio/desktop exec vitest run src/sidecar.test.ts
```

Expected: FAIL because runtime context, registry URL, and dist-tag are not injected.

- [ ] **Step 3: Add explicit configuration without changing legacy support semantics**

Extend `ServerConfig.update` and `UpdateRuntimeConfig`:

```ts
update: {
  supported: boolean;
  installKind: "global_npm" | "unsupported";
  runtimeContext: UpdateRuntimeContext;
  packageName: string;
  currentVersion: string;
  cliCommand: string;
  workerEntryPath?: string;
  npmCommand: string;
  registryUrl: string;
  distTag: string;
  restartArgs: string[];
  installArgsPrefix: string[];
  unsupportedReason: string | null;
};
```

Use this unsupported CLI default in `parseServerConfig()`:

```ts
runtimeContext: {
  environment: "cli-unsupported",
  authority: "none",
  supported: false,
  unsupportedReason: "In-app update is only supported for global npm installs",
},
registryUrl: "https://registry.npmjs.org/",
distTag: "latest",
```

Use these environment-aware values in `getUpdateRuntimeInfo()`:

```ts
const registryUrl = process.env.CODER_STUDIO_UPDATE_REGISTRY_URL?.trim()
  || process.env.npm_config_registry?.trim()
  || "https://registry.npmjs.org/";
const distTag = process.env.CODER_STUDIO_UPDATE_DIST_TAG?.trim() || "latest";
const supported = workerEntryPath !== undefined;
return {
  supported,
  installKind: supported ? "global_npm" : "unsupported",
  runtimeContext: supported
    ? { environment: "cli-global-npm", authority: "cli", supported: true, unsupportedReason: null }
    : { environment: "cli-unsupported", authority: "none", supported: false, unsupportedReason },
  packageName,
  cliCommand: "coder-studio",
  workerEntryPath,
  npmCommand: "npm",
  registryUrl,
  distTag,
  restartArgs: ["serve", "--restart"],
  installArgsPrefix: ["install", "-g"],
  unsupportedReason,
};
```

Set the Desktop sidecar context explicitly:

```ts
runtimeContext: {
  environment: "desktop-managed",
  authority: "desktop",
  supported: true,
  unsupportedReason: null,
},
registryUrl: "https://registry.npmjs.org/",
distTag: "latest",
```

`UpdateService.getSupportInfo()` must return the configured `runtimeContext` in both supported and unsupported branches. It must not derive Desktop authority from `window.coderStudioDesktop` or change top-level `supported` to true.

- [ ] **Step 4: Run all focused routing and command tests**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/config.test.ts src/update/update-service.test.ts src/commands/updates.test.ts
pnpm --filter @spencer-kit/coder-studio exec vitest run src/update-runtime.test.ts src/server-runner.test.ts
pnpm --filter @coder-studio/desktop exec vitest run src/sidecar.test.ts
```

Expected: PASS; Desktop-managed sidecars expose Desktop authority but reject both npm check and npm install.

- [ ] **Step 5: Commit explicit authority routing**

```bash
git add packages/server/src/config.ts packages/server/src/config.test.ts packages/server/src/update/update-service.ts packages/server/src/update/update-service.test.ts packages/cli/src/update-runtime.ts packages/cli/src/update-runtime.test.ts packages/cli/src/server-runner.test.ts packages/desktop/src/sidecar.ts packages/desktop/src/sidecar.test.ts
git commit -m "feat: route updates by runtime authority"
```

---

### Task 5: Lock the CLI update path as a blocking regression gate

**Files:**
- Modify: `packages/server/src/update/update-service.test.ts`
- Modify: `packages/server/src/commands/updates.test.ts`
- Modify: `packages/cli/src/update-worker.test.ts`
- Modify: `packages/cli/src/server-runner.test.ts`

- [ ] **Step 1: Add one end-to-end-in-process CLI lifecycle test**

Use real temporary state files with injected metadata/spawn functions and assert the complete state sequence:

```ts
it("preserves check, prepare, exact install, restart, and reconcile", async () => {
  const service = createService({
    currentVersion: "0.4.0",
    runReleaseMetadataLookup: async () => ({
      version: "0.5.0",
      currentPublishedAt: "2026-07-01T00:00:00.000Z",
      latestPublishedAt: "2026-08-08T00:00:00.000Z",
    }),
    spawnDetachedWorker,
  });

  await expect(service.checkForUpdates({ manual: true })).resolves.toMatchObject({
    availability: "update_available",
    latestVersion: "0.5.0",
  });
  expect(service.prepareInstall()).toMatchObject({ canStartInstall: true });
  await expect(service.startInstall({ targetVersion: "0.5.0", force: false }))
    .resolves.toMatchObject({ updateStatus: "installing" });
  expect(spawnDetachedWorker).toHaveBeenCalledWith(expect.objectContaining({
    packageName: "@spencer-kit/coder-studio",
    targetVersion: "0.5.0",
    installArgsPrefix: ["install", "-g"],
    restartArgs: ["serve", "--restart"],
  }));
});
```

Keep separate assertions for active-work refusal without `force`, permission errors becoming `manual_required`, ordinary install errors becoming `failed`, restart handoff failures producing a manual restart command, interrupted startup states becoming failed, and successful target startup becoming `succeeded`.

- [ ] **Step 2: Run the test before completing fixture updates**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/update/update-service.test.ts src/commands/updates.test.ts
pnpm --filter @spencer-kit/coder-studio exec vitest run src/update-worker.test.ts src/server-runner.test.ts
```

Expected: FAIL until every fixture uses schema v2 and explicit `cli-global-npm` context.

- [ ] **Step 3: Update only fixtures and assertions needed by the additive contract**

Use this reusable fixture in Server/CLI tests; do not rewrite production behavior in this step:

```ts
const CLI_RUNTIME_CONTEXT = {
  environment: "cli-global-npm" as const,
  authority: "cli" as const,
  supported: true,
  unsupportedReason: null,
};

const BASE_UPDATE_STATE = {
  version: 2 as const,
  currentVersion: "0.4.0",
  currentPublishedAt: null,
  latestVersion: null,
  latestPublishedAt: null,
  availability: "unknown" as const,
  updateStatus: "idle" as const,
  lastCheckedAt: null,
  targetVersion: null,
  startedAt: null,
  finishedAt: null,
  requiresManualStep: false,
  manualCommand: null,
  errorSummary: null,
};
```

- [ ] **Step 4: Run the complete pre-change baseline plus type checks**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/update.test.ts src/domain/product-update.test.ts
pnpm --filter @coder-studio/server exec vitest run src/update/npm-release-metadata.test.ts src/update/update-service.test.ts src/commands/updates.test.ts src/__tests__/update-state-repo.test.ts src/config.test.ts
pnpm --filter @spencer-kit/coder-studio exec vitest run src/update-runtime.test.ts src/update-worker.test.ts src/server-runner.test.ts
pnpm --filter @coder-studio/core exec tsc -p tsconfig.json --noEmit
pnpm --filter @coder-studio/server exec tsc -p tsconfig.json --noEmit
```

Expected: PASS. Do not begin Desktop coordinator work if any original CLI case is failing.

- [ ] **Step 5: Commit the CLI regression gate**

```bash
git add packages/server/src/update/update-service.test.ts packages/server/src/commands/updates.test.ts packages/cli/src/update-worker.test.ts packages/cli/src/server-runner.test.ts
git commit -m "test: lock cli update regression baseline"
```

---

### Task 6: Upgrade Runtime manifests to signed schema v2 release times

**Files:**
- Create: `packages/desktop/src/signed-json.ts`
- Create: `packages/desktop/src/signed-json.test.ts`
- Modify: `packages/desktop/src/runtime-manifest.ts`
- Modify: `packages/desktop/src/runtime-manifest.test.ts`
- Modify: `packages/desktop/src/runtime-store.test.ts`
- Modify: `scripts/build-desktop-runtime.ts`
- Modify: `scripts/build-desktop-runtime.test.ts`

- [ ] **Step 1: Write failing schema, signature, and legacy-read tests**

```ts
it("signs publishedAt and requires v2 for network updates", () => {
  const keys = generateKeyPairSync("ed25519");
  const value: RuntimeManifestV2 = {
    ...manifestFields(),
    schemaVersion: 2,
    publishedAt: "2026-08-08T01:02:03.000Z",
  };
  value.signature = {
    algorithm: "ed25519",
    value: sign(null, getRuntimeManifestSigningPayload(value), keys.privateKey).toString("base64"),
  };
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  expect(parseNetworkRuntimeManifest(value).publishedAt).toBe("2026-08-08T01:02:03.000Z");
  value.publishedAt = "2026-08-09T01:02:03.000Z";
  expect(verifyRuntimeManifestSignature(value, publicKey)).toBe(false);
});

it("reads installed and unsigned local v1 but rejects v1 as a network candidate", () => {
  const legacy: RuntimeManifestV1 = { ...manifestFields(), schemaVersion: 1 };
  expect(parseInstalledRuntimeManifest(legacy).schemaVersion).toBe(1);
  expect(getRuntimePublishedAt(legacy)).toBeNull();
  expect(() => parseNetworkRuntimeManifest(legacy)).toThrow("schema 2");
});

it.each(["", "08/08/2026", "not-a-date"])("rejects invalid release time %j", (publishedAt) => {
  expect(() => parseNetworkRuntimeManifest({
    ...manifestFields(),
    schemaVersion: 2,
    publishedAt,
  })).toThrow("publishedAt");
});
```

In the build test, set `CODER_STUDIO_RELEASE_PUBLISHED_AT=2026-08-08T01:02:03.000Z`, build a signed fixture, and assert changing only `publishedAt` invalidates the signature. Also assert a signed/release build without the variable fails, while an unsigned local Factory Runtime without the variable remains schema v1 with an unknown release time.

- [ ] **Step 2: Run Desktop manifest/build tests and verify failure**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/signed-json.test.ts src/runtime-manifest.test.ts src/runtime-store.test.ts
pnpm exec vitest run --config scripts/vitest.config.ts scripts/build-desktop-runtime.test.ts
```

Expected: FAIL because only schema v1 exists and canonical JSON is private to `runtime-manifest.ts`.

- [ ] **Step 3: Implement canonical signing and dual installed/network parsers**

Create `signed-json.ts`:

```ts
import { verify } from "node:crypto";

export type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

export function canonicalizeJson(value: CanonicalJson): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalizeJson(value[key] as CanonicalJson)}`).join(",")}}`;
}

export function canonicalSigningPayload(value: object, omittedKey = "signature"): Buffer {
  const unsigned = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== omittedKey)
  );
  return Buffer.from(canonicalizeJson(unsigned as CanonicalJson), "utf8");
}

export function verifyEd25519Payload(payload: Buffer, signature: unknown, publicKeyPem: string): boolean {
  if (!signature || typeof signature !== "object") return false;
  const value = signature as { algorithm?: unknown; value?: unknown };
  if (value.algorithm !== "ed25519" || typeof value.value !== "string") return false;
  try {
    return verify(null, payload, publicKeyPem, Buffer.from(value.value, "base64"));
  } catch {
    return false;
  }
}
```

In `runtime-manifest.ts`, use shared fields plus two explicit versions:

```ts
export const RUNTIME_MANIFEST_SCHEMA_VERSION = 2;

interface RuntimeManifestFields {
  runtimeVersion: string;
  minShellVersion: string;
  requiredEngineVersion: string;
  requiredNodeVersion: string;
  runtimeHostApiVersion: number;
  apiProtocolVersion: number;
  dataSchemaVersion: number;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  entrypoint: string;
  webRoot?: string;
  packageFile?: string;
  files: RuntimeFileEntry[];
  signature?: RuntimeSignature;
}

export interface RuntimeManifestV1 extends RuntimeManifestFields { schemaVersion: 1 }
export interface RuntimeManifestV2 extends RuntimeManifestFields {
  schemaVersion: 2;
  publishedAt: string;
}
export type RuntimeManifest = RuntimeManifestV1 | RuntimeManifestV2;

export function getRuntimeManifestSigningPayload(manifest: RuntimeManifest): Buffer {
  return canonicalSigningPayload(manifest);
}

export function getRuntimePublishedAt(manifest: RuntimeManifest): string | null {
  return manifest.schemaVersion === 2 ? manifest.publishedAt : null;
}

export function parseInstalledRuntimeManifest(value: unknown): RuntimeManifest {
  return parseRuntimeManifestShape(value, { requireV2: false });
}

export function parseNetworkRuntimeManifest(value: unknown): RuntimeManifestV2 {
  return parseRuntimeManifestShape(value, { requireV2: true }) as RuntimeManifestV2;
}
```

`parseRuntimeManifestShape` must retain every existing path/file/capability check, accept only schema 1 or 2 for installed files, require schema 2 for network input, and normalize `publishedAt` only when `new Date(value).toISOString() === value`. Make `readRuntimeManifest()` call the installed parser. Task 9 changes the Runtime download managers' network call sites to `parseNetworkRuntimeManifest()`.

In `buildDesktopRuntime()`, require and normalize the release timestamp for signed/release artifacts and emit:

```ts
const releasePublishedAt = readOptionalReleaseTimestamp();
if (signingKey && !releasePublishedAt) {
  throw new Error("CODER_STUDIO_RELEASE_PUBLISHED_AT is required for signed Runtime artifacts");
}
const fields: RuntimeManifestFields = {
  runtimeVersion,
  minShellVersion,
  requiredEngineVersion: DESKTOP_ENGINE_VERSION,
  requiredNodeVersion: DESKTOP_NODE_VERSION,
  runtimeHostApiVersion: RUNTIME_HOST_API_VERSION,
  apiProtocolVersion: API_PROTOCOL_VERSION,
  dataSchemaVersion: DATA_SCHEMA_VERSION,
  platform: process.platform,
  arch: process.arch,
  entrypoint: "server.mjs",
  ...(includeWeb ? { webRoot: "web" } : {}),
  packageFile: `${packageBaseName}.tgz`,
  files: await createFileEntries(DESKTOP_FACTORY_RUNTIME_DIR),
};
const manifest: RuntimeManifest = releasePublishedAt
  ? signManifest({
      ...fields,
      schemaVersion: 2,
      publishedAt: new Date(releasePublishedAt).toISOString(),
    })
  : { ...fields, schemaVersion: 1 };
```

Unsigned local Factory Runtime builds may continue emitting schema v1 when no timestamp is supplied. Every signed, verification, acceptance, or production network artifact must supply the shared timestamp and emit schema v2. Do not infer it from `Date.now()` inside separate platform jobs.

- [ ] **Step 4: Run manifest, store, WSL, and build tests**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/signed-json.test.ts src/runtime-manifest.test.ts src/runtime-store.test.ts src/wsl-installer.test.ts
pnpm exec vitest run --config scripts/vitest.config.ts scripts/build-desktop-runtime.test.ts
```

Expected: PASS; installed v1 manifests remain valid launch/rollback candidates with `null` release time, while new network v1 manifests are rejected.

- [ ] **Step 5: Commit Runtime schema v2**

```bash
git add packages/desktop/src/signed-json.ts packages/desktop/src/signed-json.test.ts packages/desktop/src/runtime-manifest.ts packages/desktop/src/runtime-manifest.test.ts packages/desktop/src/runtime-store.test.ts scripts/build-desktop-runtime.ts scripts/build-desktop-runtime.test.ts
git commit -m "feat: sign runtime release timestamps"
```

---

### Task 7: Add Shell build info and the signed Desktop channel

**Files:**
- Create: `packages/desktop/src/build-info.ts`
- Create: `packages/desktop/src/build-info.test.ts`
- Create: `packages/desktop/src/desktop-channel.ts`
- Create: `packages/desktop/src/desktop-channel.test.ts`
- Modify: `scripts/build-desktop.ts`
- Modify: `scripts/build-desktop-runtime.test.ts`
- Modify: `packages/desktop/electron-builder.yml`

- [ ] **Step 1: Write failing metadata parser tests**

```ts
it("parses release build info", () => {
  expect(parseDesktopBuildInfo({
    schemaVersion: 1,
    shellVersion: "0.3.0",
    builtAt: "2026-08-08T00:55:00.000Z",
    publishedAt: "2026-08-08T01:02:03.000Z",
    engineVersion: "2",
    nodeVersion: "24.19.0",
    runtimeHostApiVersion: 1,
    apiProtocolVersion: 1,
    dataSchemaVersion: 1,
  })).toMatchObject({ shellVersion: "0.3.0", publishedAt: "2026-08-08T01:02:03.000Z" });
});

it("verifies a pinned same-origin Desktop channel", () => {
  const channel = signChannel({
    schemaVersion: 1,
    channel: "stable",
    releaseTag: "desktop-v0.3.0",
    generatedAt: "2026-08-08T01:02:03.000Z",
    shell: {
      version: "0.3.0",
      publishedAt: "2026-08-08T01:02:03.000Z",
      updaterMetadata: "latest.yml",
      engineVersion: "2",
      nodeVersion: "24.19.0",
      runtimeHostApiVersion: 1,
      apiProtocolVersion: 1,
      dataSchemaVersion: 1,
    },
    runtimes: {
      "win32-x64": {
        version: "0.6.0",
        publishedAt: "2026-08-08T01:02:03.000Z",
        manifest: "coder-studio-runtime-win32-x64.manifest.json",
      },
      "linux-x64": {
        version: "0.6.0",
        publishedAt: "2026-08-08T01:02:03.000Z",
        manifest: "coder-studio-server-runtime-linux-x64.manifest.json",
      },
    },
  });
  expect(parseDesktopChannel(channel, publicKeyPem, "https://github.com/o/r/releases/download/t/desktop-channel.json"))
    .toMatchObject({ releaseTag: "desktop-v0.3.0" });
});
```

Add rejection cases for an invalid signature, absolute/cross-origin manifest location, `../` traversal, invalid timestamp, mismatched Windows/WSL product versions, and unsupported platform/architecture.

- [ ] **Step 2: Run Desktop parser tests and verify failure**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/build-info.test.ts src/desktop-channel.test.ts
```

Expected: FAIL because both parsers are absent.

- [ ] **Step 3: Implement build info, channel parsing, and packaged metadata**

Define `DesktopBuildInfo` exactly as exercised above. `readDesktopBuildInfo(resourcesPath,
actualShellVersion)` reads `resources/build-info.json`; missing/malformed development or legacy data
returns a diagnostic object with the explicitly supplied actual `app.getVersion()` and
`publishedAt: null`, while release validation later rejects missing metadata.

Define the signed channel contract in `desktop-channel.ts`:

```ts
export interface DesktopChannelRuntime {
  version: string;
  publishedAt: string;
  manifest: string;
}

export interface DesktopChannel {
  schemaVersion: 1;
  channel: "stable" | "prerelease";
  releaseTag: string;
  generatedAt: string;
  shell: {
    version: string;
    publishedAt: string;
    updaterMetadata: "latest.yml";
    engineVersion: string;
    nodeVersion: string;
    runtimeHostApiVersion: number;
    apiProtocolVersion: number;
    dataSchemaVersion: number;
  };
  runtimes: Record<"win32-x64" | "linux-x64", DesktopChannelRuntime>;
  signature: RuntimeSignature;
}

export function resolveChannelAsset(indexUrl: string, relativePath: string): string {
  if (!isSafeRuntimeRelativePath(relativePath) || relativePath.includes("/")) {
    throw new Error("Desktop channel asset path is unsafe");
  }
  const index = new URL(indexUrl);
  const asset = new URL(relativePath, index);
  if (asset.origin !== index.origin || asset.username || asset.password) {
    throw new Error("Desktop channel asset changed origin");
  }
  return asset.toString();
}
```

`parseDesktopChannel` validates all strings/integers/timestamps, matching Runtime product versions, signature over `canonicalSigningPayload`, and resolves both Runtime manifest locations through `resolveChannelAsset`.

In `buildDesktopShell()`, write `packages/desktop/dist/build-info.json` from package versions/constants and two explicit timestamps:

```ts
const buildInfo = {
  schemaVersion: 1,
  shellVersion: desktopManifest.version,
  builtAt: new Date().toISOString(),
  publishedAt: releasePublishedAt,
  engineVersion: DESKTOP_ENGINE_VERSION,
  nodeVersion: DESKTOP_NODE_VERSION,
  runtimeHostApiVersion: RUNTIME_HOST_API_VERSION,
  apiProtocolVersion: API_PROTOCOL_VERSION,
  dataSchemaVersion: DATA_SCHEMA_VERSION,
};
await writeFile(resolve(DESKTOP_DIST_DIR, "build-info.json"), `${JSON.stringify(buildInfo, null, 2)}\n`);
```

Add `dist/build-info.json -> build-info.json` under `extraResources` in `electron-builder.yml`. Replace the compiled Runtime manifest URL define with `__CODER_STUDIO_DESKTOP_CHANNEL_URL__`, defaulting to `https://github.com/spencerkit/coder-studio/releases/latest/download/desktop-channel.json`.

- [ ] **Step 4: Run metadata tests and Desktop typecheck**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/signed-json.test.ts src/build-info.test.ts src/desktop-channel.test.ts
pnpm --filter @coder-studio/desktop typecheck
pnpm exec vitest run --config scripts/vitest.config.ts scripts/build-desktop-runtime.test.ts
```

Expected: PASS; development/legacy Shells report unknown release time, and signed release metadata cannot escape the channel origin.

- [ ] **Step 5: Commit Desktop metadata contracts**

```bash
git add packages/desktop/src/build-info.ts packages/desktop/src/build-info.test.ts packages/desktop/src/desktop-channel.ts packages/desktop/src/desktop-channel.test.ts scripts/build-desktop.ts scripts/build-desktop-runtime.test.ts packages/desktop/electron-builder.yml
git commit -m "feat: add signed desktop channel metadata"
```

---

### Task 8: Persist Desktop settings and update plans atomically

**Files:**
- Create: `packages/desktop/src/atomic-json-file.ts`
- Create: `packages/desktop/src/atomic-json-file.test.ts`
- Create: `packages/desktop/src/desktop-update-settings.ts`
- Create: `packages/desktop/src/desktop-update-settings.test.ts`
- Create: `packages/desktop/src/desktop-update-journal.ts`
- Create: `packages/desktop/src/desktop-update-journal.test.ts`

- [ ] **Step 1: Write failing persistence tests**

```ts
it("falls back from malformed settings and reports a warning", async () => {
  await writeFile(settingsPath, "{broken", "utf8");
  const warnings: string[] = [];
  const repo = new DesktopUpdateSettingsRepo({ filePath: settingsPath, onWarning: (v) => warnings.push(v) });
  await expect(repo.get()).resolves.toEqual({
    schemaVersion: 1,
    autoCheckEnabled: true,
    checkIntervalSec: 21600,
  });
  expect(warnings[0]).toContain("desktop-update-settings.json");
});

it("round-trips a credential-free ready plan", async () => {
  const journal = new DesktopUpdateJournal({ filePath: journalPath });
  await journal.write({
    schemaVersion: 1,
    planId: "plan-1",
    status: "ready",
    createdAt: "2026-08-08T01:00:00.000Z",
    updatedAt: "2026-08-08T01:02:00.000Z",
    runtimeTarget: "win32-x64",
    compatibility: { compatible: true, code: null, summary: null },
    restartIntent: false,
    components: [{
      id: "runtime:win32-x64",
      currentVersion: "0.5.0",
      targetVersion: "0.6.0",
      currentPublishedAt: "2026-07-01T00:00:00.000Z",
      targetPublishedAt: "2026-08-08T01:02:03.000Z",
      downloaded: true,
      verified: true,
      installed: false,
      errorSummary: null,
    }],
    lastError: null,
  });
  const serialized = await readFile(journalPath, "utf8");
  expect(serialized).not.toMatch(/token|secret|password|authorization/i);
  await expect(journal.read()).resolves.toMatchObject({ planId: "plan-1", status: "ready" });
});
```

Also simulate a rename failure and assert the old destination survives while the temporary file is removed.

- [ ] **Step 2: Run persistence tests and verify missing modules fail**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/atomic-json-file.test.ts src/desktop-update-settings.test.ts src/desktop-update-journal.test.ts
```

Expected: FAIL because the repositories do not exist.

- [ ] **Step 3: Implement atomic JSON, validated settings, and journal records**

Create the atomic writer:

```ts
export async function writeJsonFileAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
```

`DesktopUpdateSettingsRepo.get()` accepts schema 1, a boolean, and one of `[3600, 21600, 43200, 86400]`; otherwise it returns `createDefaultDesktopUpdateSettings()` and calls `onWarning`. `set()` merges a `Partial<DesktopUpdateSettings>`, validates the final value, and uses the atomic writer.

Use this durable journal schema:

```ts
export interface DesktopUpdateJournalComponent {
  id: UpdateComponentId;
  currentVersion: string;
  targetVersion: string;
  currentPublishedAt: string | null;
  targetPublishedAt: string;
  downloaded: boolean;
  verified: boolean;
  installed: boolean;
  errorSummary: string | null;
}

export interface DesktopUpdateJournalRecord {
  schemaVersion: 1;
  planId: string;
  status: "available" | "downloading" | "ready" | "restarting" | "failed";
  createdAt: string;
  updatedAt: string;
  runtimeTarget: "win32-x64" | "linux-x64";
  compatibility: UpdateCompatibilityResult;
  restartIntent: boolean;
  components: DesktopUpdateJournalComponent[];
  lastError: { componentId: UpdateComponentId; phase: string; summary: string } | null;
}
```

`read()` returns `null` for missing/malformed files and emits a warning; `write()` validates every version/timestamp/component ID, Runtime target, compatibility field, and error phase before atomic replacement; `clear()` removes only its explicit file path. Runtime pending/failed pointers remain in `RuntimeStore`. Startup treats persisted compatibility as diagnostic history and revalidates against actual versions before activation.

- [ ] **Step 4: Run persistence tests and Desktop typecheck**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/atomic-json-file.test.ts src/desktop-update-settings.test.ts src/desktop-update-journal.test.ts
pnpm --filter @coder-studio/desktop typecheck
```

Expected: PASS; invalid data never becomes an actionable plan, and atomic failure preserves the previous valid file.

- [ ] **Step 5: Commit Desktop persistence**

```bash
git add packages/desktop/src/atomic-json-file.ts packages/desktop/src/atomic-json-file.test.ts packages/desktop/src/desktop-update-settings.ts packages/desktop/src/desktop-update-settings.test.ts packages/desktop/src/desktop-update-journal.ts packages/desktop/src/desktop-update-journal.test.ts
git commit -m "feat: persist desktop update plans"
```

---

### Task 9: Split native and WSL Runtime checks from downloads

**Files:**
- Modify: `packages/desktop/src/runtime-store.ts`
- Modify: `packages/desktop/src/runtime-store.test.ts`
- Modify: `packages/desktop/src/runtime-update-manager.ts`
- Modify: `packages/desktop/src/runtime-update-manager.test.ts`
- Modify: `packages/desktop/src/wsl-installer.ts`
- Modify: `packages/desktop/src/wsl-installer.test.ts`
- Modify: `packages/desktop/src/wsl-runtime-store.ts`
- Modify: `packages/desktop/src/wsl-runtime-store.test.ts`
- Create: `packages/desktop/src/wsl-runtime-update-adapter.ts`
- Create: `packages/desktop/src/wsl-runtime-update-adapter.test.ts`
- Modify: `packages/desktop/src/environment-manager.ts`
- Modify: `packages/desktop/src/environment-manager.test.ts`

- [ ] **Step 1: Write failing check/download separation and planned-Shell tests**

```ts
it("checks native metadata without downloading the package", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(jsonResponse(signedManifestV2({ runtimeVersion: "0.6.0" })));
  const adapter = createNativeAdapter({ fetch: fetchImpl });

  await expect(adapter.checkMetadata(expectedWinRuntime)).resolves.toMatchObject({
    componentId: "runtime:win32-x64",
    version: "0.6.0",
    publishedAt: "2026-08-08T01:02:03.000Z",
  });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(await runtimeStore.readPendingVersion()).toBeNull();
});

it("stages against the planned Shell but rechecks the actual Shell at launch", async () => {
  const runtime = await store.stageDownloadedRuntime(payloadRoot, { shellVersion: "0.3.0" });
  expect(runtime.manifest.minShellVersion).toBe("0.3.0");
  const oldShellStore = createStore({ shellVersion: "0.2.0", root: storeRoot });
  expect((await oldShellStore.getLaunchCandidate()).manifest.runtimeVersion).not.toBe("0.6.0");
  expect(await oldShellStore.readPendingVersion()).toBe("0.6.0");
});

it("stages WSL Runtime through the Windows host without invoking npm", async () => {
  await adapter.downloadAndStage(metadata, {
    signal: new AbortController().signal,
    onProgress,
    explicitRetry: false,
  });
  expect(wslRunner).toHaveBeenCalledWith(expect.arrayContaining([
    "--distribution", "Ubuntu", "--exec", "/bin/sh",
  ]), expect.any(Buffer));
  expect(wslRunner.mock.calls.flat().join(" ")).not.toMatch(/npm|pnpm|yarn/);
});

it("requires an explicit retry before redownloading a quarantined Runtime", async () => {
  const quarantined = await runtimeStore.stageDownloadedRuntime(payloadRoot, {
    shellVersion: metadata.plannedShellVersion,
  });
  await runtimeStore.fallbackAfterFailure(quarantined, new Error("health check failed"));
  await expect(adapter.downloadAndStage(metadata, {
    signal: new AbortController().signal,
    onProgress,
    explicitRetry: false,
  })).rejects.toThrow("explicit retry");
  await expect(adapter.downloadAndStage(metadata, {
    signal: new AbortController().signal,
    onProgress,
    explicitRetry: true,
  })).resolves.toMatchObject({ manifest: { runtimeVersion: "0.6.0" } });
});
```

Also assert for both native and WSL adapters: network schema v1 is rejected; channel/manifest version
or `publishedAt` mismatch is rejected; package download starts only in `downloadAndStage`; abort
removes work files and leaves no pending pointer; progress is monotonic; failed/quarantined versions
are not redownloaded unless the user explicitly retries.

- [ ] **Step 2: Run Runtime/WSL tests and verify current eager download fails**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/runtime-store.test.ts src/runtime-update-manager.test.ts src/wsl-installer.test.ts src/wsl-runtime-update-adapter.test.ts src/environment-manager.test.ts
```

Expected: FAIL because `check()` currently downloads/stages, WSL exposes only `prepare()`, and RuntimeStore validates only against the currently installed Shell.

- [ ] **Step 3: Implement metadata handles and explicit download/stage methods**

Add an optional compatibility host to RuntimeStore without weakening startup:

```ts
export interface RuntimeCompatibilityHost {
  shellVersion: string;
  nodeVersion: string;
  engineVersion: string;
  runtimeHostApiVersion: number;
  apiProtocolVersion: number;
  dataSchemaVersion: number;
}

async stageDownloadedRuntime(
  sourceRoot: string,
  options?: { shellVersion?: string }
): Promise<ProductRuntime> {
  await this.initialize();
  const manifest = await this.validateRuntimeRoot(sourceRoot, false, {
    shellVersion: options?.shellVersion ?? this.options.shellVersion,
  });
  return this.persistPendingRuntime(sourceRoot, manifest);
}
```

`validateRuntimeRoot()` uses the supplied Shell only for staging. `getLaunchCandidate()` always uses `this.options.shellVersion`; if pending is incompatible, it starts the previous active/Factory Runtime but retains the valid pending pointer so a later successful Shell install can activate it. Invalid signature/hash/file-set pointers are still removed.

Define the native metadata handle and adapter methods:

```ts
export interface RuntimeUpdateMetadata {
  componentId: "runtime:win32-x64" | "runtime:linux-x64";
  manifestUrl: string;
  manifest: RuntimeManifestV2;
  version: string;
  publishedAt: string;
  plannedShellVersion: string;
}

checkMetadata(expected: DesktopChannelRuntime, plannedShellVersion: string): Promise<RuntimeUpdateMetadata>;
downloadAndStage(
  metadata: RuntimeUpdateMetadata,
  options: {
    signal: AbortSignal;
    onProgress: (percent: number) => void;
    explicitRetry: boolean;
  }
): Promise<ProductRuntime>;
```

`checkMetadata()` fetches only the manifest with `parseNetworkRuntimeManifest`, verifies its Ed25519 signature through the store, checks version/time/target against the signed channel, and checks compatibility against `plannedShellVersion`. `downloadAndStage()` uses `ReadableStream` progress, aborts through `options.signal`, retains all current byte/path/file/signature checks, and calls `stageDownloadedRuntime(extractedRoot, { shellVersion: metadata.plannedShellVersion })` only after full verification. It rejects a failed/quarantined version when `options.explicitRetry` is `false`; only the coordinator's user-triggered retry path passes `true`. `DesktopEnvironmentManager.createRuntimeUpdateAdapter(target, environmentId)` returns a fresh adapter for the requested native or discovered WSL environment so Main can resolve both the current target and a target selected later.

Refactor WSL `WslInstaller` to the same two phases:

```ts
checkRuntime(probe: WslDistroProbe, expected: DesktopChannelRuntime, plannedShellVersion: string)
  : Promise<WslRuntimeUpdateMetadata>;
downloadAndStageRuntime(
  metadata: WslRuntimeUpdateMetadata,
  options: {
    signal: AbortSignal;
    onProgress: (percent: number) => void;
    explicitRetry: boolean;
  }
): Promise<WslInstalledRuntime>;
```

Add `WslRuntimeStoreClient.readFailedVersion(): Promise<string | null>` using a fixed Node script that
reads only `<dataRoot>/runtime-store/failed.json`, validates `runtimeVersion` as a string, and returns
`null` for missing/malformed data. The host checks that value before transferring package bytes:
`downloadAndStageRuntime()` rejects the matching quarantined version unless
`options.explicitRetry === true`.

The host downloads/verifies/repackages bytes and pipes only the validated tar archive to the existing `/bin/sh` install script. `WslRuntimeUpdateAdapter` binds the requested discovered distro, forwards all three options including `explicitRetry`, maps progress, and never runs an npm command. `DesktopEnvironmentManager.createRuntimeUpdateAdapter(target, environmentId)` returns this adapter only when the selected environment exists, is supported, and matches the requested platform/architecture.

- [ ] **Step 4: Run Runtime and WSL suites**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/runtime-manifest.test.ts src/runtime-store.test.ts src/runtime-update-manager.test.ts src/wsl-installer.test.ts src/wsl-runtime-update-adapter.test.ts src/environment-manager.test.ts src/wsl-runtime-store.test.ts
pnpm --filter @coder-studio/desktop typecheck
```

Expected: PASS; checking performs no package transfer, downloads can be cancelled, installation/Runtime pointer writes are not cancellable, and WSL contains no npm update path.

- [ ] **Step 5: Commit Runtime adapters**

```bash
git add packages/desktop/src/runtime-store.ts packages/desktop/src/runtime-store.test.ts packages/desktop/src/runtime-update-manager.ts packages/desktop/src/runtime-update-manager.test.ts packages/desktop/src/wsl-installer.ts packages/desktop/src/wsl-installer.test.ts packages/desktop/src/wsl-runtime-store.ts packages/desktop/src/wsl-runtime-store.test.ts packages/desktop/src/wsl-runtime-update-adapter.ts packages/desktop/src/wsl-runtime-update-adapter.test.ts packages/desktop/src/environment-manager.ts packages/desktop/src/environment-manager.test.ts
git commit -m "feat: split desktop runtime check and download"
```

---

### Task 10: Convert `electron-updater` into a UI-free Shell adapter

**Files:**
- Modify: `packages/desktop/src/update-manager.ts`
- Create: `packages/desktop/src/update-manager.test.ts`

- [ ] **Step 1: Write failing Shell adapter tests**

```ts
it("pins the updater result to the signed channel version", async () => {
  const updater = createMockUpdater();
  updater.checkForUpdates.mockResolvedValue({ updateInfo: { version: "0.3.0" } });
  const adapter = new DesktopShellUpdateAdapter({ updater, currentVersion: "0.2.0", isPackaged: true });
  await expect(adapter.checkMetadata({
    version: "0.3.0",
    publishedAt: "2026-08-08T01:02:03.000Z",
    updaterMetadata: "latest.yml",
  })).resolves.toMatchObject({ version: "0.3.0" });
  expect(dialog.showMessageBox).not.toHaveBeenCalled();
});

it("rejects source drift", async () => {
  const updater = createMockUpdater();
  updater.checkForUpdates.mockResolvedValue({ updateInfo: { version: "0.4.0" } });
  await expect(createAdapter(updater).checkMetadata(expectedShell))
    .rejects.toThrow("does not match signed Desktop channel");
});

it("accepts the carried current Shell without asking electron-updater for a newer version", async () => {
  const updater = createMockUpdater();
  const adapter = new DesktopShellUpdateAdapter({
    updater, currentVersion: "0.3.0", isPackaged: true,
  });
  await expect(adapter.checkMetadata({ ...expectedShell, version: "0.3.0" }))
    .resolves.toMatchObject({ version: "0.3.0", updateNeeded: false });
  expect(updater.checkForUpdates).not.toHaveBeenCalled();
});

it("reports progress and cancels only an active download", async () => {
  const updater = createMockUpdater();
  const adapter = createAdapter(updater);
  const promise = adapter.download(expectedShellMetadata, onProgress);
  updater.emit("download-progress", { percent: 45 });
  expect(onProgress).toHaveBeenCalledWith(45);
  expect(adapter.cancelDownload()).toBe(true);
  await expect(promise).rejects.toMatchObject({ name: "CancellationError" });
});
```

Also assert `autoDownload=false`, `autoInstallOnAppQuit=false` until a verified journaled restart intent is armed, update-downloaded resolves only for the expected version, errors are returned rather than dialoged, and `quitAndInstall(false, true)` is called once.

- [ ] **Step 2: Run the new Shell tests and verify the dialog-owning manager fails**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/update-manager.test.ts
```

Expected: FAIL because `DesktopUpdateManager` owns dialogs, automatic scheduling, and immediate restart prompts.

- [ ] **Step 3: Implement the Shell adapter boundary**

Use an injectable updater surface so tests do not load a real Electron updater:

```ts
export interface ShellUpdaterPort {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  on(event: "download-progress", listener: (progress: { percent: number }) => void): unknown;
  on(event: "update-downloaded", listener: (info: UpdateInfo) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  checkForUpdates(): Promise<{ updateInfo: UpdateInfo } | null>;
  downloadUpdate(token?: CancellationToken): Promise<string[]>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface ShellUpdateMetadata {
  componentId: "shell";
  version: string;
  publishedAt: string;
  updateNeeded: boolean;
}

export interface ShellUpdateDiagnostics {
  logLocations: string[];
  recoveryAction: string | null;
}
```

`DesktopShellUpdateAdapter.start()` sets `autoDownload=false`, `autoInstallOnAppQuit=false`, and prerelease policy. `checkMetadata(expected)` first compares the signed expected version to the injected actual current version; equality returns `{ version, updateNeeded: false }` without calling `electron-updater`, which is required for Runtime-only releases carrying the same Shell. For a newer expected Shell it awaits `checkForUpdates()`, requires the returned version to equal `expected.version`, and returns `{ version, updateNeeded: true }` without prompting. A lower expected version is rejected as channel drift. `download()` is allowed only for `updateNeeded: true`, creates one `CancellationToken`, translates `download-progress`, and resolves only after `update-downloaded` matches the expected version. `cancelDownload()` calls `token.cancel()` only during download. Use these explicit handoff methods:

```ts
armInstallOnQuit(): void {
  this.updater.autoInstallOnAppQuit = true;
}

disarmInstallOnQuit(): void {
  this.updater.autoInstallOnAppQuit = false;
}

getDiagnostics(): ShellUpdateDiagnostics {
  return {
    logLocations: [...this.logLocations],
    recoveryAction: this.manualInstallerUrl,
  };
}

quitAndInstall(): void {
  this.updater.quitAndInstall(false, true);
}
```

Inject the updater log locations and trusted release/manual-installer URL when constructing the
adapter; do not derive a recovery URL from an error string. Remove all `dialog` imports, window
progress ownership, timers, and restart prompts from this class. Main/coordinator will own
scheduling and UI state.

- [ ] **Step 4: Run Shell tests and Desktop typecheck**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/update-manager.test.ts
pnpm --filter @coder-studio/desktop typecheck
```

Expected: PASS; the adapter exposes only metadata/download/handoff events and never opens a dialog.

- [ ] **Step 5: Commit the Shell adapter**

```bash
git add packages/desktop/src/update-manager.ts packages/desktop/src/update-manager.test.ts
git commit -m "refactor: isolate electron shell updater"
```

---

### Task 11: Implement `DesktopUpdateCoordinator`

**Files:**
- Create: `packages/desktop/src/desktop-update-coordinator.ts`
- Create: `packages/desktop/src/desktop-update-coordinator.test.ts`
- Create: `packages/desktop/src/desktop-update-coordinator.integration.test.ts`

- [ ] **Step 1: Write failing plan, concurrency, and recovery tests**

Cover the complete matrix with table-driven tests:

```ts
it.each([
  ["no update", "0.3.0", "0.6.0", [], "idle"],
  ["Shell only", "0.2.0", "0.6.0", ["shell"], "available"],
  ["Runtime only", "0.3.0", "0.5.0", ["runtime:win32-x64"], "available"],
  ["combined", "0.2.0", "0.5.0", ["shell", "runtime:win32-x64"], "available"],
])("creates %s plan", async (_name, shellVersion, runtimeVersion, ids, status) => {
  const coordinator = createCoordinator({ shellVersion, runtimeVersion });
  const state = await coordinator.check({ manual: true });
  expect(state.status).toBe(status);
  expect(state.components.map((component) => component.id)).toEqual(ids);
  expect(new Set(state.components.map((component) => component.targetPublishedAt)))
    .not.toContain(null);
});

it("starts Shell and Runtime downloads in parallel and journals one ready plan", async () => {
  const shell = deferred<void>();
  const runtime = deferred<void>();
  const coordinator = createCombinedCoordinator({ shellDownload: shell.promise, runtimeDownload: runtime.promise });
  await coordinator.check({ manual: true });
  const download = coordinator.download();
  await vi.waitFor(() => {
    expect(shellAdapter.download).toHaveBeenCalledTimes(1);
    expect(runtimeAdapter.downloadAndStage).toHaveBeenCalledTimes(1);
  });
  shell.resolve();
  runtime.resolve();
  await expect(download).resolves.toMatchObject({ status: "ready", restartRequired: true });
  expect((await journal.read())?.components.every((item) => item.verified)).toBe(true);
});

it("retains a verified component and retries only the failed component", async () => {
  runtimeAdapter.downloadAndStage.mockRejectedValueOnce(new Error("hash mismatch"));
  await coordinator.check({ manual: true });
  await expect(coordinator.download()).resolves.toMatchObject({ status: "failed" });
  expect(runtimeAdapter.downloadAndStage).toHaveBeenNthCalledWith(1, runtimeMetadata, {
    signal: expect.any(AbortSignal),
    onProgress: expect.any(Function),
    explicitRetry: false,
  });
  runtimeAdapter.downloadAndStage.mockResolvedValueOnce(stagedRuntime);
  await coordinator.retryFailed();
  expect(shellAdapter.download).toHaveBeenCalledTimes(1);
  expect(runtimeAdapter.downloadAndStage).toHaveBeenCalledTimes(2);
  expect(runtimeAdapter.downloadAndStage).toHaveBeenNthCalledWith(2, runtimeMetadata, {
    signal: expect.any(AbortSignal),
    onProgress: expect.any(Function),
    explicitRetry: true,
  });
});

it("downloads mocked electron-updater and signed HTTP Runtime assets concurrently", async () => {
  const feed = await startSignedRuntimeFeed(runtimeFixture);
  const shell = createEventedUpdaterPort({ blockDownload: true });
  const coordinator = createCoordinator({
    shellUpdaterPort: shell,
    runtimeManifestUrl: feed.manifestUrl,
  });
  await coordinator.check({ manual: true });
  const downloading = coordinator.download();
  await vi.waitFor(() => {
    expect(shell.downloadStarted).toBe(true);
    expect(feed.packageRequestStarted).toBe(true);
  });
  shell.releaseDownload();
  feed.releasePackageResponse();
  await expect(downloading).resolves.toMatchObject({ status: "ready" });
  expect(feed.manifestSignatureVerified).toBe(true);
});
```

Add tests for: channel/source version drift; incompatible Shell-only, Runtime-only, and combined subsets; target Shell unable to run previous Runtime; API/Engine/Node/data-schema mismatch; a second check/download returning `update_busy`; cancellation returning to `available` without deleting already verified artifacts; one durable restart intent; actual Shell target reached; Shell target not reached with Runtime left pending; a Shell installer failure exposing its updater log/manual installer link without claiming rollback; fully downloaded journal recovering to `ready`; already installed components recovering to succeeded; stale/indeterminate journal becoming failed with a recovery action; automatic schedule disabled/enabled and six-hour interval; switching from native to WSL preflights/stages `linux-x64` before launch; an incompatible target blocks launch; and an environment switch during download returns `update_busy`.

- [ ] **Step 2: Run coordinator tests and verify the class is absent**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/desktop-update-coordinator.test.ts src/desktop-update-coordinator.integration.test.ts
```

Expected: FAIL because `DesktopUpdateCoordinator` does not exist.

- [ ] **Step 3: Implement the coordinator as the only Desktop policy owner**

Use explicit ports; adapters remain responsible for artifact mechanics:

```ts
export interface DesktopUpdateCoordinatorDeps {
  runtimeContext: UpdateRuntimeContext;
  currentProductVersion: () => string;
  currentProductPublishedAt: () => string | null;
  getBuildInfo: () => DesktopBuildInfo;
  loadChannel: () => Promise<DesktopChannel>;
  shell: DesktopShellUpdateAdapter;
  getRuntimeAdapter: (
    target: "win32-x64" | "linux-x64",
    environmentId: string
  ) => Promise<{
    checkMetadata(expected: DesktopChannelRuntime, plannedShellVersion: string): Promise<RuntimeUpdateMetadata>;
    downloadAndStage(
      metadata: RuntimeUpdateMetadata,
      options: {
        signal: AbortSignal;
        onProgress: (percent: number) => void;
        explicitRetry: boolean;
      }
    ): Promise<unknown>;
    getPendingVersion(): Promise<string | null>;
  }>;
  initialRuntimeTarget: "win32-x64" | "linux-x64";
  initialEnvironmentId: string;
  settings: DesktopUpdateSettingsRepo;
  journal: DesktopUpdateJournal;
  now: () => number;
  randomId: () => string;
  onStateChanged: (state: ProductUpdateState) => void;
  relaunch: () => void;
  quit: () => void;
}
```

The constructor performs a runtime assertion that `runtimeContext.authority === "desktop"`, the
environment is `desktop-native` or `desktop-wsl`, and `supported === true`. `UpdateRuntimeContext`
is an interface rather than a discriminated union, so do not use `Extract<>` to imply a narrowing
that TypeScript cannot provide.

Expose one stable lifecycle API:

```ts
start(): Promise<void>;
stop(): void;
getState(): ProductUpdateState;
check(options: { manual: boolean }): Promise<ProductUpdateState>;
download(): Promise<ProductUpdateState>;
retryFailed(): Promise<ProductUpdateState>;
cancelDownload(): ProductUpdateState;
prepareRestart(): Promise<ProductUpdateState>;
restartAndInstall(): Promise<boolean>;
getSettings(): Promise<DesktopUpdateSettings>;
setSettings(patch: Pick<DesktopUpdateSettings, "autoCheckEnabled" | "checkIntervalSec">)
  : Promise<DesktopUpdateSettings>;
prepareEnvironmentTarget(
  target: "win32-x64" | "linux-x64",
  environmentId: string
): Promise<void>;
setActiveRuntimeTarget(
  target: "win32-x64" | "linux-x64",
  environmentId: string,
  runtimeContext: UpdateRuntimeContext
): Promise<ProductUpdateState>;
reconcileOnStartup(actual: { shellVersion: string; runtimeVersion: string; pendingRuntimeVersion: string | null })
  : Promise<ProductUpdateState>;
```

Implement `check()` in this order:

```ts
const channel = await this.deps.loadChannel();
const buildInfo = this.deps.getBuildInfo();
const runtimeEntry = channel.runtimes[this.runtimeTarget];
const runtimeAdapter = await this.deps.getRuntimeAdapter(
  this.runtimeTarget,
  this.runtimeEnvironmentId
);
const plannedShellVersion = compareVersions(channel.shell.version, buildInfo.shellVersion) > 0
  ? channel.shell.version
  : buildInfo.shellVersion;
const [shellMetadata, runtimeMetadata] = await Promise.all([
  this.deps.shell.checkMetadata(channel.shell),
  runtimeAdapter.checkMetadata(runtimeEntry, plannedShellVersion),
]);
this.assertSourceMatchesChannel(channel, shellMetadata, runtimeMetadata);
const components = this.createNeededComponents(channel, buildInfo, shellMetadata, runtimeMetadata);
const compatibility = this.validatePlan(channel, buildInfo, components);
this.state = this.createAvailableState(components, compatibility);
await this.persistPlanIfActionable();
return this.publish();
```

`validatePlan()` enforces all capability fields and these subset rules: Shell-only must support the current Runtime; Runtime-only must support the actual current Shell/Engine/Node/Host API/protocol/data schema; combined must let the target Shell run both the previous Runtime and target Runtime. A false result remains visible with `status: "failed"`, `compatibility.compatible: false`, and no download/restart action.

`download()` creates one `AbortController` per unverified component and starts them before awaiting `Promise.allSettled`. It passes `{ signal, onProgress, explicitRetry: false }` to each Runtime adapter. Update component progress and journal after each transition. Successful verified artifacts remain marked when another fails. `retryFailed()` selects only failed/unverified components and passes `{ signal, onProgress, explicitRetry: true }`; no automatic or first-attempt path can bypass Runtime quarantine. `cancelDownload()` aborts active controllers and is rejected once install/restart handoff starts.

`prepareRestart()` requires every plan component verified and compatible, sets `restartIntent: true` atomically, and arms Shell install-on-quit only when Shell is included. `restartAndInstall()` invokes `shell.quitAndInstall()` for Shell plans; Runtime-only calls injected relaunch/quit once. Normal quit installs a Shell only after the same verified journal has restart intent.

`reconcileOnStartup()` treats actual versions and RuntimeStore pointers as truth. Mark actual target versions installed, return fully verified/uninstalled plans to ready, keep a Runtime pending when its required Shell is absent, and fail indeterminate records with a concrete recovery summary. It never claims automatic Shell rollback.

`prepareEnvironmentTarget()` is called before a later native/WSL environment launch. It verifies the
same signed channel, resolves that target's adapter, and stages only a compatible newer target
Runtime through the Windows host. If the target requires a Shell update or is otherwise
incompatible, it creates the normal blocked/actionable plan and rejects the environment launch
instead of running an incompatible or npm-based fallback. `setActiveRuntimeTarget()` is called only
after launch/health success; it validates the new Desktop context, replaces the active target,
clears only a non-ready stale discovery plan, and republishes product state for that environment.
An in-progress download or restart returns `update_busy` rather than switching adapters.

Every published Desktop state fills `diagnostics` from `DesktopBuildInfo`, journal errors, adapter
log locations, and recovery data. It records `failedComponentId` and `failedPhase` without replacing
the component's own error. CLI/Desktop-only fields remain explicitly `null` where unknown.

`start()` calls reconciliation, waits 15 seconds, runs an automatic check only when enabled, and starts one interval at the stored duration. Automatic checks only create `available` plans; they never download. `setSettings()` restarts this schedule. `stop()` clears timers/controllers and disarms install-on-quit unless a verified restart-intent journal exists.

- [ ] **Step 4: Run the coordinator and all adapter/persistence tests**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/desktop-update-coordinator.test.ts src/desktop-update-coordinator.integration.test.ts src/update-manager.test.ts src/runtime-update-manager.test.ts src/wsl-runtime-update-adapter.test.ts src/desktop-update-settings.test.ts src/desktop-update-journal.test.ts src/runtime-store.test.ts
pnpm --filter @coder-studio/desktop typecheck
```

Expected: PASS; combined download is demonstrably concurrent, one plan/journal survives restart, and no component-specific dialog is emitted.

- [ ] **Step 5: Commit the Desktop coordinator**

```bash
git add packages/desktop/src/desktop-update-coordinator.ts packages/desktop/src/desktop-update-coordinator.test.ts packages/desktop/src/desktop-update-coordinator.integration.test.ts
git commit -m "feat: coordinate desktop update plans"
```

---

### Task 12: Wire unified Desktop IPC, startup reconciliation, and WSL host routing

**Files:**
- Modify: `packages/desktop/src/protocol.ts`
- Modify: `packages/desktop/src/preload.ts`
- Modify: `packages/desktop/src/main.ts`
- Create: `packages/desktop/src/main-update-wiring.test.ts`

- [ ] **Step 1: Write failing bridge, menu, and compatibility-shim tests**

```ts
it("registers one unified update surface and one Help action", async () => {
  const harness = createMainUpdateHarness();
  await harness.register();
  expect(harness.registeredChannels()).toEqual(expect.arrayContaining([
    "desktop:get-update-state",
    "desktop:check-for-updates",
    "desktop:download-update",
    "desktop:retry-update",
    "desktop:cancel-update-download",
    "desktop:prepare-update-restart",
    "desktop:restart-and-install-update",
    "desktop:get-update-settings",
    "desktop:set-update-settings",
  ]));
  expect(harness.helpLabels().filter((label) => label.includes("Update")))
    .toEqual(["Check for Updates..."]);
});

it.each([
  ["native", "desktop-native", "runtime:win32-x64"],
  ["wsl", "desktop-wsl", "runtime:linux-x64"],
])("routes %s through Desktop Main", async (kind, environment, componentId) => {
  const harness = createMainUpdateHarness({ environmentKind: kind });
  await harness.start();
  expect(harness.coordinatorDeps.runtimeContext.environment).toBe(environment);
  expect(harness.coordinatorDeps.runtimeComponentId).toBe(componentId);
  expect(harness.serverNpmUpdaterStarted).toBe(false);
});

it("delegates legacy Runtime IPC to the coordinator", async () => {
  const harness = createMainUpdateHarness();
  await harness.invoke("desktop:check-runtime-update");
  expect(harness.coordinator.check).toHaveBeenCalledWith({ manual: true });
  expect(await harness.invoke("desktop:get-runtime-update-state"))
    .toMatchObject({ status: "ready", pendingVersion: "0.6.0" });
});

it("stages a later-selected WSL target before launching it", async () => {
  const harness = createMainUpdateHarness({ environmentKind: "native" });
  await harness.start();
  await harness.openEnvironment("wsl:Ubuntu");
  expect(harness.coordinator.prepareEnvironmentTarget).toHaveBeenCalledWith(
    "linux-x64", "wsl:Ubuntu"
  );
  expect(harness.environmentManager.openEnvironment).toHaveBeenCalledWith("wsl:Ubuntu");
  expect(harness.coordinator.setActiveRuntimeTarget).toHaveBeenCalledWith(
    "linux-x64",
    "wsl:Ubuntu",
    expect.objectContaining({ environment: "desktop-wsl", authority: "desktop" })
  );
  expect(harness.callOrder()).toEqual([
    "prepare:linux-x64", "launch:wsl:Ubuntu", "activate:linux-x64",
  ]);
});

it.each(["darwin", "linux"])("keeps %s Desktop updates read-only without acceptance", async (platform) => {
  const harness = createMainUpdateHarness({ platform });
  await harness.start();
  expect(harness.coordinatorStarted).toBe(false);
  expect(await harness.invoke("desktop:get-update-state")).toMatchObject({
    status: "unsupported",
    runtimeContext: { authority: "none", supported: false },
  });
});
```

Assert the preload exposes frozen functions, event unsubscribe removes the exact listener, startup reads actual `app.getVersion()` before selecting pending Runtime, and `before-quit` stops coordinator without disarming a valid restart intent.

- [ ] **Step 2: Run Desktop wiring tests and verify missing IPC fails**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/main-update-wiring.test.ts src/environment-manager.test.ts src/sidecar.test.ts
```

Expected: FAIL because Main still constructs two managers and registers Runtime-only IPC.

- [ ] **Step 3: Add the versioned unified bridge and replace manager wiring**

Extend `DesktopApi` with these methods while retaining the four Runtime compatibility members:

```ts
updateApiVersion: 1;
getUpdateState(): Promise<ProductUpdateState>;
checkForUpdates(): Promise<ProductUpdateState>;
downloadUpdate(): Promise<ProductUpdateState>;
retryUpdate(): Promise<ProductUpdateState>;
cancelUpdateDownload(): Promise<ProductUpdateState>;
prepareUpdateRestart(): Promise<ProductUpdateState>;
restartAndInstallUpdate(): Promise<boolean>;
getUpdateSettings(): Promise<DesktopUpdateSettings>;
setUpdateSettings(patch: Pick<DesktopUpdateSettings, "autoCheckEnabled" | "checkIntervalSec">)
  : Promise<DesktopUpdateSettings>;
onUpdateStateChanged(listener: (state: ProductUpdateState) => void): () => void;
```

Map them directly in preload. Register IPC through a focused helper so each handler delegates once:

```ts
ipcMain.handle("desktop:get-update-state", () => coordinator.getState());
ipcMain.handle("desktop:check-for-updates", () => coordinator.check({ manual: true }));
ipcMain.handle("desktop:download-update", () => coordinator.download());
ipcMain.handle("desktop:retry-update", () => coordinator.retryFailed());
ipcMain.handle("desktop:cancel-update-download", () => coordinator.cancelDownload());
ipcMain.handle("desktop:prepare-update-restart", () => coordinator.prepareRestart());
ipcMain.handle("desktop:restart-and-install-update", () => coordinator.restartAndInstall());
ipcMain.handle("desktop:get-update-settings", () => coordinator.getSettings());
ipcMain.handle("desktop:set-update-settings", (_event, patch) => coordinator.setSettings(patch));
```

Construct one coordinator for packaged, non-smoke instances. Native selects `ProductRuntimeUpdateManager` with `runtime:win32-x64`; WSL asks `DesktopEnvironmentManager` for the Windows-hosted `WslRuntimeUpdateAdapter` with `runtime:linux-x64`. Both use `desktop-managed` Servers and never enable the Server npm updater.

Wrap the existing `openEnvironment` handler with the coordinator handoff. Resolve the requested
summary first, call `prepareEnvironmentTarget()` before `DesktopEnvironmentManager.openEnvironment`,
and call `setActiveRuntimeTarget()` only after the new sidecar health handshake succeeds. If
preparation fails, leave the current environment active and surface the coordinator plan/error. Do
not edit `EnvironmentActivationCoordinator`'s focus/acknowledgement semantics for this update flow.
On unsupported macOS/Linux Desktop targets, expose a read-only unsupported context and do not start
either updater until an installed-upgrade lane is enabled.

Before `RuntimeStore.getLaunchCandidate()`, read the journal and compare its target Shell with actual `app.getVersion()`. RuntimeStore still performs the final actual-host compatibility check. After sidecar/health success, call `markLaunchSuccessful()` and coordinator reconciliation, then broadcast the resulting state.

Translate unified state to `DesktopRuntimeUpdateState` in one `toLegacyRuntimeUpdateState()` function. Legacy check delegates `coordinator.check({ manual: true })`; legacy restart delegates `prepareRestart()` then `restartAndInstall()`. Keep `desktop:runtime-update-state-changed` broadcasts until minimum Shell compatibility removes the shim.

Replace both Help entries with:

```ts
{
  label: "Check for Updates...",
  click: () => void coordinator?.check({ manual: true }),
}
```

Remove `promptForRuntimeRestart`, `checkRuntimeUpdatesManually`, `updateManager`, and `runtimeUpdateManager` globals. The coordinator emits state to the renderer; Main may log errors but must not create competing update dialogs.

- [ ] **Step 4: Run all Desktop tests and typecheck**

Run:

```bash
pnpm --filter @coder-studio/desktop test
pnpm --filter @coder-studio/desktop typecheck
```

Expected: PASS; native/WSL both use Desktop Main, old Runtime IPC still works, and the Help menu contains one update entry.

- [ ] **Step 5: Commit Desktop lifecycle wiring**

```bash
git add packages/desktop/src/protocol.ts packages/desktop/src/preload.ts packages/desktop/src/main.ts packages/desktop/src/main-update-wiring.test.ts
git commit -m "feat: expose unified desktop update ipc"
```

---

### Task 13: Resolve one Web `UpdateController` for Desktop, CLI, or read-only sessions

**Files:**
- Modify: `packages/web/src/desktop-api.d.ts`
- Create: `packages/web/src/features/updates/types.ts`
- Create: `packages/web/src/features/updates/controller.ts`
- Create: `packages/web/src/features/updates/controller.test.ts`
- Create: `packages/web/src/features/updates/use-update-controller.ts`
- Create: `packages/web/src/features/updates/use-update-controller.test.tsx`
- Modify: `packages/web/src/features/updates/atoms.ts`
- Modify: `packages/web/src/app/providers.tsx`
- Modify: `packages/web/src/app/providers.lifecycle.test.tsx`
- Modify: `packages/web/src/app/providers.test.tsx`

- [ ] **Step 1: Write failing authority-resolution and lifecycle tests**

Use one table to lock every routing row and both mismatch cases:

```ts
// packages/web/src/features/updates/controller.test.ts
it.each([
  ["Desktop native", desktopManagedServer, desktopBridge("desktop-native"), "desktop"],
  ["Desktop WSL", desktopManagedServer, desktopBridge("desktop-wsl"), "desktop"],
  ["global CLI", cliServer, undefined, "cli"],
  ["unsupported CLI", unsupportedCliServer, undefined, "readonly"],
  ["external Desktop sidecar", desktopManagedServer, undefined, "readonly"],
  ["Desktop bridge against CLI", cliServer, desktopBridge("desktop-native"), "readonly"],
])("resolves %s to %s", async (_name, serverState, bridge, expectedKind) => {
  const controller = await createUpdateController({
    serverState,
    desktopBridge: bridge,
    dispatch: createDispatch(),
  });
  expect(controller.kind).toBe(expectedKind);
});

it("uses only unified IPC for Desktop component actions", async () => {
  const bridge = desktopBridge("desktop-native", { status: "available" });
  const dispatch = createDispatch({ prepareActivity: noActiveWork });
  const controller = await createUpdateController({
    serverState: desktopManagedServer,
    desktopBridge: bridge,
    dispatch,
  });

  await controller.check();
  await controller.download();
  await controller.retry();

  expect(bridge.checkForUpdates).toHaveBeenCalledTimes(1);
  expect(bridge.downloadUpdate).toHaveBeenCalledTimes(1);
  expect(bridge.retryUpdate).toHaveBeenCalledTimes(1);
  expect(dispatch).not.toHaveBeenCalledWith("updates.check", expect.anything(), undefined);
  expect(dispatch).not.toHaveBeenCalledWith("updates.startInstall", expect.anything(), undefined);
});

it("preserves the CLI prepare and exact-install command sequence", async () => {
  const dispatch = createDispatch({ prepareActivity: noActiveWork });
  const controller = await createUpdateController({
    serverState: cliAvailableState,
    desktopBridge: undefined,
    dispatch,
  });
  const prepared = await controller.prepare();
  await controller.start(prepared, false);

  expect(dispatch).toHaveBeenNthCalledWith(1, "updates.prepareInstall", {}, undefined);
  expect(dispatch).toHaveBeenNthCalledWith(2, "updates.startInstall", {
    targetVersion: "0.6.0",
    force: false,
  }, undefined);
});

it("blocks all mutation for an external Desktop sidecar", async () => {
  const dispatch = createDispatch();
  const controller = await createUpdateController({
    serverState: desktopManagedServer,
    desktopBridge: undefined,
    dispatch,
  });
  await expect(controller.check()).rejects.toMatchObject({ code: "update_read_only" });
  expect(dispatch).not.toHaveBeenCalled();
});
```

In `use-update-controller.test.tsx`, connect, reconnect with a new Server context, and unmount. Assert
that the old Desktop subscription is removed exactly once, the new controller owns the state, and a
late event from the disposed controller cannot overwrite it. In `providers.lifecycle.test.tsx`, add
one Desktop-managed connection and one CLI connection; assert the Server state is hydrated before
resolution. In `providers.test.tsx`, emit `update.state.changed` after a Desktop controller is
active and assert it updates only `serverUpdateStateAtom`, not `productUpdateStateAtom`.

- [ ] **Step 2: Run the controller/provider tests and verify the old bridge inference fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/updates/controller.test.ts src/features/updates/use-update-controller.test.tsx src/app/providers.lifecycle.test.tsx src/app/providers.test.tsx
```

Expected: FAIL because the Web has no controller, still chooses Desktop solely from bridge presence,
and maps Runtime-only IPC into `UpdateStateView` inside About.

- [ ] **Step 3: Define adapters, normalized CLI mapping, and deterministic resolution**

Create `types.ts` with the exact bridge and controller surface used by the hook and views:

```ts
import type {
  DesktopUpdateSettings,
  ProductUpdatePreparation,
  ProductUpdateState,
  UpdatePrepareInstallResponse,
  UpdateStateView,
} from "@coder-studio/core";

export type UpdateControllerKind = "desktop" | "cli" | "readonly";

export interface UpdateCommandResult<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message: string };
}

export type UpdateCommandDispatcher = <T>(
  operation: string,
  args: Record<string, unknown>,
  requestId?: string
) => Promise<UpdateCommandResult<T>>;

export interface DesktopUpdateBridge {
  updateApiVersion: 1;
  getUpdateState(): Promise<ProductUpdateState>;
  checkForUpdates(): Promise<ProductUpdateState>;
  downloadUpdate(): Promise<ProductUpdateState>;
  retryUpdate(): Promise<ProductUpdateState>;
  cancelUpdateDownload(): Promise<ProductUpdateState>;
  prepareUpdateRestart(): Promise<ProductUpdateState>;
  restartAndInstallUpdate(): Promise<boolean>;
  getUpdateSettings(): Promise<DesktopUpdateSettings>;
  setUpdateSettings(
    patch: Pick<DesktopUpdateSettings, "autoCheckEnabled" | "checkIntervalSec">
  ): Promise<DesktopUpdateSettings>;
  onUpdateStateChanged(listener: (state: ProductUpdateState) => void): () => void;
}

export interface UpdateController {
  readonly kind: UpdateControllerKind;
  getState(): ProductUpdateState;
  refresh(): Promise<ProductUpdateState>;
  check(): Promise<ProductUpdateState>;
  download(): Promise<ProductUpdateState>;
  retry(): Promise<ProductUpdateState>;
  cancelDownload(): Promise<ProductUpdateState>;
  prepare(): Promise<ProductUpdatePreparation>;
  start(prepared: ProductUpdatePreparation, force: boolean): Promise<ProductUpdateState>;
  getSettings(): Promise<DesktopUpdateSettings | null>;
  setSettings(
    patch: Pick<DesktopUpdateSettings, "autoCheckEnabled" | "checkIntervalSec">
  ): Promise<DesktopUpdateSettings | null>;
  subscribe(listener: (state: ProductUpdateState) => void): () => void;
  dispose(): void;
}

export interface CreateUpdateControllerInput {
  serverState: UpdateStateView;
  desktopBridge: DesktopUpdateBridge | undefined;
  dispatch: UpdateCommandDispatcher;
}
```

Move the unified Desktop members added in Task 12 into `CoderStudioDesktopApi extends
DesktopUpdateBridge` in `desktop-api.d.ts`; retain the Runtime-specific members as the compatibility
surface, but new Web code must not call them.

In `controller.ts`, implement and export one lossless CLI mapper. The component status uses the
normalized aggregate status; npm installation remains represented by the single `cli` component:

```ts
export function mapCliUpdateState(state: UpdateStateView): ProductUpdateState {
  const status: ProductUpdateStatus =
    state.updateStatus === "installing" ? "downloading"
      : state.updateStatus === "restarting" ? "restarting"
        : state.updateStatus === "succeeded" ? "succeeded"
          : state.updateStatus === "failed" ? "failed"
            : state.updateStatus === "manual_required" ? "manual_required"
              : state.updateStatus === "checking" ? "checking"
                : state.availability === "update_available" ? "available"
                  : state.supported ? "idle" : "unsupported";
  const targetVersion = state.targetVersion ?? state.latestVersion;
  return {
    schemaVersion: 1,
    runtimeContext: state.runtimeContext,
    status,
    productVersion: state.currentVersion,
    productPublishedAt: state.currentPublishedAt,
    planId: null,
    createdAt: null,
    updatedAt: null,
    lastCheckedAt: state.lastCheckedAt,
    components: [{
      id: "cli",
      kind: "cli",
      target: null,
      currentVersion: state.currentVersion,
      currentPublishedAt: state.currentPublishedAt,
      targetVersion,
      targetPublishedAt: state.latestPublishedAt,
      status,
      progressPercent: null,
      downloaded: state.updateStatus === "restarting" || state.updateStatus === "succeeded",
      verified: state.updateStatus === "succeeded",
      errorSummary: state.errorSummary,
    }],
    compatibility: { compatible: true, code: null, summary: null },
    diagnostics: {
      failedComponentId: state.errorSummary ? "cli" : null,
      failedPhase: state.updateStatus === "failed" || state.updateStatus === "manual_required"
        ? state.updateStatus
        : null,
      shellVersion: null,
      shellPublishedAt: null,
      shellBuiltAt: null,
      engineVersion: null,
      nodeVersion: null,
      runtimeHostApiVersion: null,
      apiProtocolVersion: null,
      dataSchemaVersion: null,
      logLocations: [],
      recoveryAction: state.manualCommand,
    },
    restartRequired: state.updateStatus === "restarting",
    requiresManualStep: state.requiresManualStep,
    manualCommand: state.manualCommand,
    errorSummary: state.errorSummary,
  };
}
```

Use a shared command guard so command failures retain their Server code:

```ts
async function dispatchData<T>(
  dispatch: UpdateCommandDispatcher,
  operation: string,
  args: Record<string, unknown>
): Promise<T> {
  const result = await dispatch<T>(operation, args, undefined);
  if (!result.ok || !result.data) {
    throw Object.assign(new Error(result.error?.message ?? `${operation} failed`), {
      code: result.error?.code ?? "update_command_failed",
    });
  }
  return result.data;
}
```

Implement `DesktopUpdateAdapter` by calling only the versioned bridge. Its `prepare()` calls
`updates.prepareInstall` only to obtain the connected Server's activity summary, returns the current
Desktop state with `canProceed: state.status === "ready"`, and does not ask the Server to install.
Its `start()` first calls `prepareUpdateRestart()`, then `restartAndInstallUpdate()`, and throws
`update_restart_failed` if Main returns false. Implement `CliUpdateAdapter` with
`updates.getState`, `updates.check`, `updates.prepareInstall`, and `updates.startInstall`; `download`,
`retry`, and `cancelDownload` reject with `update_action_unavailable`. Implement
`ReadOnlyUpdateAdapter` with a normalized `unsupported` state and mutation methods that reject with
`update_read_only`; its refresh is local and never dispatches a command.

Resolve without fallback:

```ts
export async function createUpdateController(
  input: CreateUpdateControllerInput
): Promise<UpdateController> {
  const context = input.serverState.runtimeContext;
  if (context.environment === "desktop-managed" && context.authority === "desktop") {
    if (!input.desktopBridge || input.desktopBridge.updateApiVersion !== 1) {
      return new ReadOnlyUpdateAdapter(input.serverState, "Open this update in Coder Studio Desktop");
    }
    const desktopState = await input.desktopBridge.getUpdateState();
    const validDesktopContext = desktopState.runtimeContext.authority === "desktop"
      && desktopState.runtimeContext.supported
      && (desktopState.runtimeContext.environment === "desktop-native"
        || desktopState.runtimeContext.environment === "desktop-wsl");
    return validDesktopContext
      ? new DesktopUpdateAdapter(input.desktopBridge, input.dispatch, desktopState)
      : new ReadOnlyUpdateAdapter(input.serverState, "Desktop update context mismatch");
  }
  if (context.environment === "cli-global-npm" && context.authority === "cli") {
    return input.desktopBridge
      ? new ReadOnlyUpdateAdapter(input.serverState, "Desktop bridge and CLI context disagree")
      : new CliUpdateAdapter(input.dispatch, input.serverState);
  }
  return new ReadOnlyUpdateAdapter(
    input.serverState,
    context.unsupportedReason ?? "Updates are unavailable in this environment"
  );
}
```

- [ ] **Step 4: Hydrate Server context first, then own normalized state through the hook**

Change `atoms.ts` to keep the wire source separate from presentation state:

```ts
export const serverUpdateStateAtom = atom<UpdateStateView | null>(null);
export const productUpdateStateAtom = atom<ProductUpdateState | null>(null);
export const updateControllerAtom = atom<UpdateController | null>(null);
export const updatePreparationAtom = atom<ProductUpdatePreparation | null>(null);

// Temporary source-level alias until Task 14 migrates the existing views.
export const updateStateAtom = serverUpdateStateAtom;
```

Implement `useUpdateController(serverState, dispatch)` with a monotonically increasing generation
token. On each context/connection change it disposes the previous controller, awaits
`createUpdateController`, ignores stale completions, stores the controller and initial state, and
subscribes to later state. Cleanup unsubscribes and disposes exactly once. It returns the controller
and normalized state from atoms.

In `providers.tsx`, keep hydrating `updates.getState` before controller resolution. Route
`update.state.changed` events into `serverUpdateStateAtom`; only copy them through
`mapCliUpdateState()` when the active controller kind is `cli`. Desktop bridge events remain the
only writer of Desktop `productUpdateStateAtom`. Reset both controller/state atoms on disconnect so
an old authority cannot survive reconnection.

- [ ] **Step 5: Run Web tests and typecheck**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/updates/controller.test.ts src/features/updates/use-update-controller.test.tsx src/app/providers.lifecycle.test.tsx src/app/providers.test.tsx
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
```

Expected: PASS; all routing rows are deterministic, Desktop uses IPC only, CLI uses the original
WebSocket commands only, and external sidecar pages cannot mutate updates.

- [ ] **Step 6: Commit the Web authority boundary**

```bash
git add packages/web/src/desktop-api.d.ts packages/web/src/features/updates/types.ts packages/web/src/features/updates/controller.ts packages/web/src/features/updates/controller.test.ts packages/web/src/features/updates/use-update-controller.ts packages/web/src/features/updates/use-update-controller.test.tsx packages/web/src/features/updates/atoms.ts packages/web/src/app/providers.tsx packages/web/src/app/providers.lifecycle.test.tsx packages/web/src/app/providers.test.tsx
git commit -m "feat: route web updates through one controller"
```

---

### Task 14: Render product release time, one primary action, and component diagnostics

**Files:**
- Modify: `packages/web/src/features/settings/components/about-settings.tsx`
- Modify: `packages/web/src/features/settings/components/about-settings.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/footer-update-rail.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/footer-update-rail.test.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/features/updates/atoms.ts`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Replace legacy view tests with normalized Desktop/CLI/read-only cases**

Use `ProductUpdateState` fixtures whose product version intentionally differs from the Shell
version so the hierarchy cannot regress:

```ts
function desktopState(overrides: Partial<ProductUpdateState> = {}): ProductUpdateState {
  return {
    schemaVersion: 1,
    runtimeContext: {
      environment: "desktop-native",
      authority: "desktop",
      supported: true,
      unsupportedReason: null,
    },
    status: "available",
    productVersion: "0.6.0",
    productPublishedAt: "2026-08-08T01:02:03.000Z",
    planId: "plan-1",
    createdAt: "2026-08-08T01:03:00.000Z",
    updatedAt: "2026-08-08T01:04:00.000Z",
    lastCheckedAt: Date.parse("2026-08-08T01:04:00.000Z"),
    components: [
      {
        id: "shell",
        kind: "shell",
        target: "win32-x64",
        currentVersion: "0.2.0",
        currentPublishedAt: "2026-07-01T00:00:00.000Z",
        targetVersion: "0.3.0",
        targetPublishedAt: "2026-08-08T01:02:03.000Z",
        status: "available",
        progressPercent: null,
        downloaded: false,
        verified: false,
        errorSummary: null,
      },
      {
        id: "runtime:win32-x64",
        kind: "runtime",
        target: "win32-x64",
        currentVersion: "0.6.0",
        currentPublishedAt: "2026-07-20T00:00:00.000Z",
        targetVersion: "0.7.0",
        targetPublishedAt: "2026-08-08T01:02:03.000Z",
        status: "available",
        progressPercent: null,
        downloaded: false,
        verified: false,
        errorSummary: null,
      },
    ],
    compatibility: { compatible: true, code: null, summary: null },
    diagnostics: {
      failedComponentId: null,
      failedPhase: null,
      shellVersion: "0.2.0",
      shellPublishedAt: "2026-07-01T00:00:00.000Z",
      shellBuiltAt: "2026-06-30T23:50:00.000Z",
      engineVersion: "2",
      nodeVersion: "24.19.0",
      runtimeHostApiVersion: 1,
      apiProtocolVersion: 1,
      dataSchemaVersion: 1,
      logLocations: ["desktop-update.log"],
      recoveryAction: null,
    },
    restartRequired: true,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
    ...overrides,
  };
}

it("shows Runtime as the Desktop product version and Shell only in diagnostics", () => {
  renderAbout({ state: desktopState() });
  expect(screen.getByTestId("product-version")).toHaveTextContent("v0.6.0");
  expect(screen.queryByText("Shell v0.2.0")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Component diagnostics" }));
  expect(screen.getByText("Shell v0.2.0 → v0.3.0")).toBeInTheDocument();
});

it("renders signed UTC release time in the local time zone and preserves unknown", () => {
  renderAbout({ state: desktopState() });
  expect(screen.getByTestId("product-release-time")).toHaveTextContent("2026");
  cleanup();
  renderAbout({ state: desktopState({ productPublishedAt: null }) });
  expect(screen.getByTestId("product-release-time")).toHaveTextContent("Release time unknown");
});

it.each([
  ["desktop available", desktopState(), "Download update", "download"],
  ["desktop ready", desktopState({ status: "ready" }), "Restart and update", "prepare"],
  ["desktop failed", desktopState({ status: "failed" }), "Retry", "retry"],
  ["cli available", cliState({ status: "available" }), "Update and restart", "prepare"],
])("routes the primary action for %s", async (_name, state, label, method) => {
  const controller = createController(state);
  renderAbout({ state, controller });
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => expect(controller[method]).toHaveBeenCalled());
});
```

Add cases for Desktop download progress and cancellation, active-work confirmation, restart later,
CLI manual command, unsupported CLI, external Desktop sidecar guidance, WSL management copy,
compatibility failure, missing timestamps, component errors, and diagnostics containing authority,
environment, plan ID, actual/target versions, failed phase, and recovery text. Assert there is never
more than one primary action in About.

For `footer-update-rail.test.tsx`, cover exactly these presentation rows:

```ts
it.each([
  ["available", "Download update"],
  ["ready", "Restart and update"],
  ["failed", "Retry"],
  ["manual_required", "View details"],
])("renders actionable %s", (status, action) => {
  renderRail(productState({ status }));
  expect(screen.getByRole("button", { name: action })).toBeInTheDocument();
});

it.each(["idle", "checking", "downloading", "restarting", "succeeded", "unsupported"] as const)(
  "hides non-actionable %s",
  (status) => {
    const { container } = renderRail(productState({ status }));
    expect(container).toBeEmptyDOMElement();
  }
);
```

In `settings-page.test.tsx`, assert Desktop hydrates/writes update settings through the controller,
while CLI continues to read/write `updates.autoCheckEnabled` and `updates.checkIntervalSec` through
the existing Server settings command.

- [ ] **Step 2: Run view tests and verify the legacy Runtime/CLI branching fails**

Run:

```bash
TZ=Asia/Shanghai pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/about-settings.test.tsx src/features/workspace/views/shared/footer-update-rail.test.tsx src/features/settings/components/settings-page.test.tsx
```

Expected: FAIL because About still maps `DesktopRuntimeUpdateState` to the CLI shape, displays the
Shell app version as a product peer, has no release time, and the footer dispatches CLI commands
directly.

- [ ] **Step 3: Make About a presentation over the controller and local-time formatters**

Replace `formatTime` with separate check/release helpers so UTC ISO strings are never interpreted as
epoch seconds or substituted with another timestamp:

```ts
export function formatReleaseTime(
  value: string | null,
  locale: "zh" | "en",
  unknownLabel: string
): string {
  if (!value) return unknownLabel;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return unknownLabel;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function formatCheckTime(value: number | null, locale: "zh" | "en", empty: string): string {
  if (value === null) return empty;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
```

Read `productUpdateStateAtom`, `updateControllerAtom`, and `updatePreparationAtom`; remove
`mapDesktopRuntimeUpdateState`, direct `dispatchCommandAtom` mutation calls, `getAppVersion()`, and
all Runtime-only bridge subscriptions. Use this explicit primary-action mapping:

```ts
function primaryActionFor(
  state: ProductUpdateState,
  controller: UpdateController
): "check" | "download" | "cancel" | "prepare" | "retry" | null {
  if (controller.kind === "readonly" || !state.runtimeContext.supported) return null;
  if (state.status === "idle" || state.status === "succeeded") return "check";
  if (state.status === "available") return controller.kind === "desktop" ? "download" : "prepare";
  if (state.status === "downloading") return controller.kind === "desktop" ? "cancel" : null;
  if (state.status === "ready") return "prepare";
  if (state.status === "failed" && controller.kind === "desktop") return "retry";
  return null;
}
```

`prepare` stores `ProductUpdatePreparation`. If there is active work, show the existing one-confirm
dialog; otherwise call `controller.start(prepared, false)`. Confirmation calls
`controller.start(prepared, true)`. Closing the dialog leaves a ready Desktop plan untouched. Show
`productVersion` and `productPublishedAt` in the normal section. Render components, Shell build or
release time, Engine ABI, authority, environment, plan ID, compatibility, progress, and errors under
one collapsed diagnostics disclosure using `ProductUpdateState.diagnostics`. Engine ABI/build data
must come from packaged build info and must not be invented from the product or Shell semantic
version. CLI leaves Desktop-only diagnostic fields `null`.

For read-only states, render `runtimeContext.unsupportedReason` and environment-specific guidance.
Never expose an install button when `controller.kind === "readonly"`, even if stale component data
claims an update is available.

- [ ] **Step 4: Route the footer and automatic-check settings through the same controller**

Rewrite `FooterUpdateRail` to read `productUpdateStateAtom` and `updateControllerAtom`, reuse the
same prepare/start confirmation sequence, and never call `updates.*` directly. It renders only
`available`, `ready`, `failed`, and `manual_required`; all other states return `null`. Desktop
`available` calls `download`, Desktop `failed` calls `retry`, CLI `available` calls `prepare`, and
manual-required opens `/more/about/update-status`.

In `SettingsPage`, retain the existing Server settings hydration for all non-update preferences.
For an active Desktop controller, ignore Server values for the two update keys and hydrate them from
`controller.getSettings()`:

```ts
useEffect(() => {
  if (updateController?.kind !== "desktop") return;
  let disposed = false;
  void updateController.getSettings().then((settings) => {
    if (!disposed && settings) {
      setUpdateAutoCheckEnabled(settings.autoCheckEnabled);
      setUpdateCheckIntervalSec(settings.checkIntervalSec);
    }
  });
  return () => { disposed = true; };
}, [updateController]);
```

The change callbacks optimistically update local state, then call `controller.setSettings()` for
Desktop or the current Server `settings.update` path for CLI. On failure restore the previous value
and show the existing settings error. Read-only contexts disable both controls and explain where the
preference is managed. Desktop defaults continue to be six hours; CLI defaults remain one hour.

- [ ] **Step 5: Add complete English and Chinese copy**

Add matching keys for product release time, unknown release time, download, cancel, retry, ready,
restart/update, restart later, component diagnostics, Shell, Runtime target, CLI, authority,
environment, plan ID, compatibility error, progress, recovery action, Desktop-managed guidance,
WSL Windows-host guidance, and read-only context mismatch. Replace the old copy that says Desktop
app and Runtime updates are separate.

Use these core strings verbatim so tests and UX stay aligned:

```json
// en.json under settings.about
"product_release_time": "Released",
"release_time_unknown": "Release time unknown",
"download_update": "Download update",
"restart_and_update": "Restart and update",
"restart_later": "Restart later",
"retry_update": "Retry",
"component_diagnostics": "Component diagnostics",
"managed_in_desktop": "Open Coder Studio Desktop to manage this update."
```

```json
// zh.json under settings.about
"product_release_time": "发布时间",
"release_time_unknown": "发布时间未知",
"download_update": "下载更新",
"restart_and_update": "重启并更新",
"restart_later": "稍后重启",
"retry_update": "重试",
"component_diagnostics": "组件诊断",
"managed_in_desktop": "请在 Coder Studio 桌面端管理此更新。"
```

- [ ] **Step 6: Run Web update regressions and typecheck**

Run:

```bash
TZ=Asia/Shanghai pnpm --filter @coder-studio/web exec vitest run src/features/updates/controller.test.ts src/features/updates/use-update-controller.test.tsx src/features/settings/components/about-settings.test.tsx src/features/workspace/views/shared/footer-update-rail.test.tsx src/features/settings/components/settings-page.test.tsx src/app/providers.lifecycle.test.tsx src/app/providers.test.tsx
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
```

Expected: PASS; normal UI shows Product Runtime/npm product version plus local release time, Desktop
components remain diagnostic details, and each authority has one correct primary action.

- [ ] **Step 7: Commit the unified update presentation**

```bash
git add packages/web/src/features/settings/components/about-settings.tsx packages/web/src/features/settings/components/about-settings.test.tsx packages/web/src/features/workspace/views/shared/footer-update-rail.tsx packages/web/src/features/workspace/views/shared/footer-update-rail.test.tsx packages/web/src/features/settings/components/settings-page.tsx packages/web/src/features/settings/components/settings-page.test.tsx packages/web/src/features/updates/atoms.ts packages/web/src/locales/en.json packages/web/src/locales/zh.json
git commit -m "feat: present unified product updates"
```

---

### Task 15: Build and validate one immutable signed Desktop release channel

**Files:**
- Create: `scripts/build-desktop-channel.ts`
- Create: `scripts/build-desktop-channel.test.ts`
- Modify: `scripts/desktop-release-artifacts.ts`
- Modify: `scripts/desktop-release-artifacts.test.ts`
- Modify: `scripts/github-workflows.test.ts`
- Modify: `.github/workflows/desktop-verify.yml`
- Modify: `.github/workflows/desktop-release.yml`
- Modify: `package.json`

- [ ] **Step 1: Write failing full-release, Runtime-only, and publication-gate tests**

Build one complete fixture directory containing installer/updater metadata, packaged build info,
Windows and WSL Runtime manifests/packages, and WSL Engine. Lock the two release modes:

```ts
// scripts/build-desktop-channel.test.ts
it("signs a full channel from the staged immutable artifacts", async () => {
  await buildDesktopChannel({
    directory: fixture.root,
    releaseTag: "desktop-v0.3.0",
    channel: "stable",
    generatedAt: "2026-08-08T01:02:03.000Z",
    privateKeyPem,
  });
  const channel = await readJson<DesktopChannel>(join(fixture.root, "desktop-channel.json"));
  expect(channel).toMatchObject({
    releaseTag: "desktop-v0.3.0",
    shell: { version: "0.3.0", publishedAt: "2026-08-08T01:02:03.000Z" },
    runtimes: {
      "win32-x64": { version: "0.6.0", publishedAt: "2026-08-08T01:02:03.000Z" },
      "linux-x64": { version: "0.6.0", publishedAt: "2026-08-08T01:02:03.000Z" },
    },
  });
  expect(verifyEd25519Payload(
    canonicalSigningPayload(channel), channel.signature, publicKeyPem
  )).toBe(true);
});

it("carries the original Shell metadata and bytes into a Runtime-only channel", async () => {
  const before = await hashFiles(previousRelease.root, [
    "Coder-Studio-Setup-0.3.0.exe",
    "latest.yml",
    "build-info.json",
    "coder-studio-engine-linux-x64.tar.gz",
  ]);
  await carryForwardDesktopBase(previousRelease.root, nextRelease.root);
  await buildDesktopChannel({
    directory: nextRelease.root,
    releaseTag: "desktop-runtime-v0.7.0",
    channel: "stable",
    generatedAt: "2026-09-01T02:03:04.000Z",
    privateKeyPem,
  });
  const after = await hashFiles(nextRelease.root, Object.keys(before));
  expect(after).toEqual(before);
  expect((await readChannel(nextRelease.root)).shell.publishedAt)
    .toBe("2026-08-08T01:02:03.000Z");
  expect((await readChannel(nextRelease.root)).runtimes["win32-x64"].publishedAt)
    .toBe("2026-09-01T02:03:04.000Z");
});
```

In `desktop-release-artifacts.test.ts`, add one named case for every hard publication rejection:

```ts
it.each([
  "missing build-info.json",
  "missing desktop-channel.json",
  "invalid channel signature",
  "invalid Runtime signature",
  "channel or manifest release time missing",
  "channel and manifest release time mismatch",
  "channel and updater Shell version mismatch",
  "index references a missing asset",
  "Runtime hash or signed file set mismatch",
  "Runtime minShellVersion exceeds planned Shell",
  "target Shell cannot run previous Runtime",
  "Engine ABI mismatch",
  "Node version mismatch",
  "Runtime Host API mismatch",
  "API protocol mismatch",
  "Windows and WSL product version mismatch",
  "Windows and WSL shared capability mismatch",
  "platform or architecture mismatch",
  "Runtime-only Engine ABI change",
  "Runtime-only data-schema change",
  "Runtime-only release without a prior unified channel",
])("rejects %s", async (fault) => {
  const fixture = await createCompleteReleaseFixture();
  await fixture.inject(fault);
  await expect(validateDesktopReleaseArtifacts(fixture.options))
    .rejects.toThrow(fixture.expectedMessage(fault));
});
```

Extend `github-workflows.test.ts` to assert a single `published_at` output is passed to both build
jobs, channel construction runs after carry-forward and before validation, attestation and release
publication depend on validation, Runtime-only uses previous immutable Shell/Engine assets, and no
job synthesizes its own publication time.

- [ ] **Step 2: Run script tests and verify channel generation/gates are absent**

Run:

```bash
pnpm exec vitest run --config scripts/vitest.config.ts scripts/build-desktop-channel.test.ts scripts/desktop-release-artifacts.test.ts scripts/github-workflows.test.ts
```

Expected: FAIL because no channel builder exists, validation does not know build/channel metadata,
and platform jobs currently create artifacts without one shared release timestamp.

- [ ] **Step 3: Implement deterministic channel construction from staged artifacts**

Create `build-desktop-channel.ts` as a library plus direct CLI. It reads and validates data instead
of accepting duplicate version flags:

```ts
export interface BuildDesktopChannelOptions {
  directory: string;
  releaseTag: string;
  channel: "stable" | "prerelease";
  generatedAt: string;
  privateKeyPem: string;
}

export async function buildDesktopChannel(
  options: BuildDesktopChannelOptions
): Promise<DesktopChannel> {
  const buildInfo = parseDesktopBuildInfo(await readJson(join(options.directory, "build-info.json")));
  if (!buildInfo.publishedAt) throw new Error("Shell release time is required");
  const updater = parseUpdaterMetadata(await readFile(join(options.directory, "latest.yml"), "utf8"));
  const windows = parseNetworkRuntimeManifest(await readJson(join(
    options.directory, "coder-studio-runtime-win32-x64.manifest.json"
  )));
  const wsl = parseNetworkRuntimeManifest(await readJson(join(
    options.directory, "coder-studio-server-runtime-linux-x64.manifest.json"
  )));
  if (updater.version !== buildInfo.shellVersion) {
    throw new Error("Electron updater metadata does not match Shell build info");
  }
  assertMatchingProductRuntimePair(windows, wsl);
  const unsigned: Omit<DesktopChannel, "signature"> = {
    schemaVersion: 1,
    channel: options.channel,
    releaseTag: options.releaseTag,
    generatedAt: normalizeUtcTimestamp(options.generatedAt, "generatedAt"),
    shell: {
      version: buildInfo.shellVersion,
      publishedAt: buildInfo.publishedAt,
      updaterMetadata: "latest.yml",
      engineVersion: buildInfo.engineVersion,
      nodeVersion: buildInfo.nodeVersion,
      runtimeHostApiVersion: buildInfo.runtimeHostApiVersion,
      apiProtocolVersion: buildInfo.apiProtocolVersion,
      dataSchemaVersion: buildInfo.dataSchemaVersion,
    },
    runtimes: {
      "win32-x64": {
        version: windows.runtimeVersion,
        publishedAt: windows.publishedAt,
        manifest: "coder-studio-runtime-win32-x64.manifest.json",
      },
      "linux-x64": {
        version: wsl.runtimeVersion,
        publishedAt: wsl.publishedAt,
        manifest: "coder-studio-server-runtime-linux-x64.manifest.json",
      },
    },
  };
  const channel: DesktopChannel = {
    ...unsigned,
    signature: {
      algorithm: "ed25519",
      value: sign(null, canonicalSigningPayload(unsigned), options.privateKeyPem).toString("base64"),
    },
  };
  await atomicWriteJson(join(options.directory, "desktop-channel.json"), channel);
  return channel;
}
```

The direct CLI accepts `--directory`, `--release-tag`, `--channel`, `--generated-at`, and a private
key file path. It resolves paths beneath the explicit release directory, rejects symlinks/path
escape, never logs the key, and writes only `desktop-channel.json`. `generatedAt` and all release
times must already be canonical UTC ISO strings.

- [ ] **Step 4: Extend staging and validation to the complete signed contract**

Add `desktop-channel.json` and `build-info.json` to the Desktop component staging allowlist. Do not
use a recursive copy or include unpacked credentials. Extend `ValidateDesktopReleaseOptions` with:

```ts
export interface ValidateDesktopReleaseOptions extends ArtifactOptions {
  publicKeyPem?: string;
  allowUnsigned: boolean;
  previousReleaseDirectory?: string;
  releaseKind: "full" | "runtime-only";
}
```

For signed verification/acceptance/production, `publicKeyPem` is mandatory and `allowUnsigned` is
false. Parse the channel and network manifests through the Task 6/7 parsers, then enforce this
sequence:

```ts
const channel = parseDesktopChannel(channelJson, publicKeyPem, channelUrl);
await assertUpdaterMatchesChannel(directory, channel.shell);
const runtimes = await assertRuntimeArtifactsMatchChannel(directory, channel.runtimes, publicKeyPem);
assertRuntimePairCompatibility(runtimes.windows, runtimes.wsl);
assertPlannedHostCompatibility(channel.shell, runtimes, previousRuntimeManifests);
if (options.releaseKind === "runtime-only") {
  await assertByteIdenticalCarryForward(options.previousReleaseDirectory, directory);
  assertRuntimeOnlyCapabilitiesUnchanged(previousChannel, channel);
}
```

`assertPlannedHostCompatibility` checks Shell minimum/previous Runtime rollback compatibility,
Engine ABI, Node, Host API, protocol, data schema, platform, and architecture. Validation must compare
signed fields to archive contents, updater metadata, build info, and channel values; matching only
filenames is insufficient. `allowUnsigned` remains limited to explicit local smoke runs and cannot
skip timestamps, paths, hashes, file lists, or compatibility checks.

- [ ] **Step 5: Make verification and release jobs share metadata and validate before exposure**

In both workflows, the prepare job emits exactly one UTC value:

```bash
published_at=$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')
echo "published_at=${published_at}" >> "${GITHUB_OUTPUT}"
```

Pass it unchanged as `CODER_STUDIO_RELEASE_PUBLISHED_AT` to Windows and Linux Runtime/Shell builds.
`desktop-verify.yml` stages both platform bundles, builds a signed test channel after merging them,
and validates the complete set with the acceptance public key.

In `desktop-release.yml`, keep the `full`/`runtime-only` input. For Runtime-only, download the last
stable release's installer, `latest.yml`, `build-info.json`, previous channel, and Engine artifacts
into a separate read-only comparison directory; copy only the allowlisted base artifacts into the
new staging directory. Merge newly built Runtime assets, build the new signed channel, validate with
`--release-kind runtime-only --previous-release-directory ...`, then attest. For full releases,
stage newly built Shell/Engine/Runtime assets and validate with `--release-kind full`.

Reject Runtime-only mode when the previous stable release lacks a valid signed unified channel or
its Shell does not advertise the unified Host/API capabilities. This makes the first production
release of the architecture a full release that ships the coordinator, compatibility shim, and
schema-v2-capable Factory Runtime together.

Only after validation and attestation may the workflow create a non-latest prerelease containing
those exact bytes. It must not mark the release stable or latest; Task 16 runs installed-upgrade
acceptance and promotes that same prerelease without rebuilding. Add:

```json
"desktop:channel": "tsx scripts/build-desktop-channel.ts"
```

to root `package.json`.

- [ ] **Step 6: Run all metadata, artifact, workflow, and package tests**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/signed-json.test.ts src/runtime-manifest.test.ts src/build-info.test.ts src/desktop-channel.test.ts
pnpm exec vitest run --config scripts/vitest.config.ts scripts/build-desktop-runtime.test.ts scripts/build-desktop-channel.test.ts scripts/desktop-release-artifacts.test.ts scripts/github-workflows.test.ts
pnpm --filter @coder-studio/desktop typecheck
```

Expected: PASS; a complete bundle has one trustworthy signed plan, and every incomplete,
incompatible, timestamp-drifted, signature-drifted, or byte-changed carry-forward fixture fails.

- [ ] **Step 7: Commit Desktop publication gates**

```bash
git add scripts/build-desktop-channel.ts scripts/build-desktop-channel.test.ts scripts/desktop-release-artifacts.ts scripts/desktop-release-artifacts.test.ts scripts/github-workflows.test.ts .github/workflows/desktop-verify.yml .github/workflows/desktop-release.yml package.json
git commit -m "build: validate signed desktop update channels"
```

---

### Task 16: Gate promotion on real installed Desktop and isolated packaged CLI upgrades

**Files:**
- Create: `scripts/verify-cli-update.ts`
- Create: `scripts/verify-cli-update.test.ts`
- Create: `scripts/verify-desktop-installed-update.ts`
- Create: `scripts/verify-desktop-installed-update.test.ts`
- Create: `scripts/verify-desktop-installed-update.ps1`
- Modify: `packages/desktop/src/main.ts`
- Modify: `packages/desktop/src/main-update-wiring.test.ts`
- Modify: `.github/workflows/desktop-acceptance.yml`
- Modify: `.github/workflows/desktop-release.yml`
- Modify: `.github/workflows/publish.yml`
- Modify: `scripts/github-workflows.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing acceptance-runner and promotion-order tests**

Unit-test the CLI runner with injected process/npm/WebSocket dependencies. The success case must
prove the global prefix, exact target, restart, persisted metadata, and cleanup boundary:

```ts
// scripts/verify-cli-update.test.ts
it("upgrades a packaged CLI inside one isolated npm prefix", async () => {
  const deps = createAcceptanceDeps();
  deps.command
    .mockResolvedValueOnce({ stdout: packageInstallOutput("0.5.0") })
    .mockResolvedValueOnce({ stdout: "configured" });
  deps.callWs
    .mockResolvedValueOnce(cliState({ currentVersion: "0.5.0", latestVersion: "0.6.0" }))
    .mockResolvedValueOnce(cliPrepared({ hasActiveWork: false }))
    .mockResolvedValueOnce(cliState({ updateStatus: "restarting", targetVersion: "0.6.0" }))
    .mockResolvedValueOnce(cliState({ currentVersion: "0.6.0", updateStatus: "succeeded" }));

  const report = await verifyCliUpdate({
    packageName: "@spencer-kit/coder-studio",
    previousVersion: "0.5.0",
    candidateVersion: "0.6.0",
    registryUrl: "https://registry.npmjs.org/",
    distTag: "coder-studio-accept-42",
    prefix: "/tmp/coder-studio-cli-acceptance-42",
  }, deps);

  expect(deps.command).toHaveBeenCalledWith("npm", [
    "install", "--global", "--prefix", "/tmp/coder-studio-cli-acceptance-42",
    "@spencer-kit/coder-studio@0.5.0",
  ], expect.any(Object));
  expect(deps.callWs).toHaveBeenCalledWith(expect.objectContaining({ op: "updates.check" }));
  expect(deps.callWs).toHaveBeenCalledWith(expect.objectContaining({
    op: "updates.startInstall",
    args: { targetVersion: "0.6.0", force: false },
  }));
  expect(report).toMatchObject({
    previousVersion: "0.5.0",
    candidateVersion: "0.6.0",
    exactInstallObserved: true,
    restartObserved: true,
    reconciledStatus: "succeeded",
  });
});

it.each([
  ["permission", "manual_required", "npm install -g @spencer-kit/coder-studio@0.6.0"],
  ["install", "failed", null],
  ["restart", "failed", "coder-studio serve --restart"],
])("records the %s failure without escaping the prefix", async (scenario, status, manualCommand) => {
  const report = await verifyCliFailureScenario(scenario, createAcceptanceDeps());
  expect(report.state).toMatchObject({ updateStatus: status, manualCommand });
  expect(report.workerLog).toContain(scenario);
  expect(report.paths.every((path) => path.startsWith(report.prefix))).toBe(true);
});
```

For the Desktop driver, test its CDP commands and journal assertions without launching Electron:

```ts
// scripts/verify-desktop-installed-update.test.ts
it("drives one confirmation and validates actual component versions", async () => {
  const deps = createInstalledDesktopDeps();
  const report = await verifyInstalledDesktopScenario(combinedScenario, deps);
  expect(deps.desktop.evaluate).toHaveBeenCalledWith("checkForUpdates");
  expect(deps.desktop.evaluate).toHaveBeenCalledWith("downloadUpdate");
  expect(deps.desktop.evaluate).toHaveBeenCalledWith("prepareUpdateRestart");
  expect(deps.desktop.evaluate).toHaveBeenCalledWith("restartAndInstallUpdate");
  expect(report).toMatchObject({
    scenario: "combined",
    confirmationCount: 1,
    restartCount: 1,
    actualShellVersion: combinedScenario.targetShellVersion,
    actualRuntimeVersion: combinedScenario.targetRuntimeVersion,
  });
});

it("proves WSL staging never invokes npm inside the distro", async () => {
  const deps = createInstalledDesktopDeps({ wslNpmMarkerExists: false });
  const report = await verifyInstalledDesktopScenario(wslScenario, deps);
  expect(report.wslRuntimeVersion).toBe(wslScenario.targetRuntimeVersion);
  expect(report.wslNpmMarkerExists).toBe(false);
});
```

Extend `github-workflows.test.ts` with these invariants: CLI package bytes are published once under
an ephemeral dist-tag, acceptance runs before `npm dist-tag add`, stable Desktop promotion depends
on installed Windows/WSL and CLI reports, promotion edits the existing prerelease, report
commit/version/signature identities must match, and no promotion job contains a build or publish
command that can replace candidate bytes.

- [ ] **Step 2: Run acceptance/workflow tests and verify the gates are absent**

Run:

```bash
pnpm exec vitest run --config scripts/vitest.config.ts scripts/verify-cli-update.test.ts scripts/verify-desktop-installed-update.test.ts scripts/github-workflows.test.ts
```

Expected: FAIL because neither installed runner exists, Desktop acceptance stops at artifact
validation, and CLI currently publishes directly to the requested final dist-tag.

- [ ] **Step 3: Implement the isolated packaged CLI acceptance runner**

`verify-cli-update.ts` accepts explicit options and provides an injectable dependency boundary:

```ts
export interface VerifyCliUpdateOptions {
  packageName: string;
  previousVersion: string;
  candidateVersion: string;
  registryUrl: string;
  distTag: string;
  prefix: string;
  reportPath?: string;
}

export interface CliUpdateAcceptanceReport {
  schemaVersion: 1;
  packageName: string;
  previousVersion: string;
  candidateVersion: string;
  candidatePublishedAt: string;
  prefix: string;
  exactInstallObserved: boolean;
  restartObserved: boolean;
  reconciledStatus: "succeeded";
  scenarios: Array<{
    name: "permission" | "install" | "restart";
    updateStatus: "manual_required" | "failed";
    manualCommand: string | null;
    logVerified: boolean;
  }>;
}
```

Create the prefix with `mkdtemp` when one is not supplied; otherwise require an absolute path whose
basename starts with `coder-studio-cli-acceptance-`. Determine the executable as
`<prefix>/coder-studio.cmd` on Windows or `<prefix>/bin/coder-studio` elsewhere. Run:

```ts
await command("npm", [
  "install", "--global", "--prefix", prefix,
  `${packageName}@${previousVersion}`,
], { env: acceptanceEnv });
await command(cliExecutable, [
  "config", "--host", "127.0.0.1", "--port", String(port), "--state-dir", stateDir,
], { env: acceptanceEnv });
await command(cliExecutable, ["serve"], { env: acceptanceEnv });
```

`acceptanceEnv` prepends the isolated npm bin directory to `PATH`, sets `npm_config_prefix`,
`CODER_STUDIO_UPDATE_REGISTRY_URL`, and `CODER_STUDIO_UPDATE_DIST_TAG`, and uses an isolated
`CODER_STUDIO_HOME`/state directory; it does not replace `HOME`. Poll `/healthz`, then call the
existing `callCoderStudioWsCommand()` for `updates.getState`, `updates.check`,
`updates.prepareInstall`, and `updates.startInstall`. Require the candidate returned by the selected
dist-tag and its npm `time[candidateVersion]`, wait through the detached worker/restart, reconnect,
and require the running version plus schema-v2 state to reconcile to `succeeded` with timestamps
preserved.

For fault scenarios, prepend a temporary npm/coder-studio shim that records arguments within the
prefix and emits deterministic EACCES, ordinary install, or restart failures. Permission must become
`manual_required`; install/restart failures must become `failed`; every scenario verifies the worker
log and generated command. Always stop the managed server and delete only the validated acceptance
prefix created by the runner. Write the report atomically when `reportPath` is supplied.

- [ ] **Step 4: Implement the installed Windows/WSL Desktop driver and acceptance-only source pin**

Allow a tag-pinned channel override only for explicit acceptance launches:

```ts
function resolveDesktopChannelUrl(env: NodeJS.ProcessEnv): string {
  const acceptance = env.CODER_STUDIO_DESKTOP_ACCEPTANCE === "1";
  const override = env.CODER_STUDIO_DESKTOP_CHANNEL_URL?.trim();
  if (override && acceptance) return new URL(override).toString();
  return __CODER_STUDIO_DESKTOP_CHANNEL_URL__;
}
```

Add a wiring test proving the override is ignored without the acceptance flag. Signature, origin,
channel/version, and artifact checks remain fully enabled; this flag changes only the tag-pinned
index location and never enables unsigned artifacts or a different Electron provider.

`verify-desktop-installed-update.ps1` requires explicit previous installer, candidate tag/channel,
expected versions, public key, scenario, and report paths. It creates a uniquely named temporary
user-data directory, installs the previous signed NSIS package silently, launches the installed
`Coder Studio.exe` with a random CDP port plus the two acceptance environment variables, invokes
`verify-desktop-installed-update.ts`, and removes only that test installation/user-data directory.
It fails if the candidate installer is not Authenticode-valid.

The TypeScript driver connects with Playwright `chromium.connectOverCDP`, waits for the renderer,
and calls only the public frozen preload bridge through `page.evaluate`. Implement these scenario
steps explicitly:

```ts
const state = await invokeDesktop("checkForUpdates");
assertExpectedPlan(state, scenario.expectedComponentIds);
await invokeDesktop("downloadUpdate");
await waitForState("ready");
const activity = await callCoderStudioWsCommand<UpdatePrepareInstallResponse>({
  apiUrl: sidecarUrl, op: "updates.prepareInstall", args: {},
});
await invokeDesktop("prepareUpdateRestart");
await invokeDesktop("restartAndInstallUpdate");
await reconnectAfterRestart();
await assertInstalledState(scenario);
```

The full matrix contains `runtime-only`, `combined`, `wsl`, `runtime-health-rollback`,
`interrupted-download`, `restart-journal-recovery`, and `external-sidecar-browser`. The WSL setup
installs a failing `npm` marker shim inside the disposable distro before updating; success plus an
absent marker proves Windows staged the signed Linux Runtime without npm. Rollback uses a
correctly signed candidate that fails the health handshake and must select the previous trusted
Runtime. Interruption kills the Electron process at the named phase and checks the durable journal
after relaunch. The external browser opens the sidecar URL without preload and asserts no install
action or `updates.check/startInstall` request occurs.

Write an atomic JSON report containing commit SHA, release tag, channel signature digest, previous
and actual versions, each scenario result, confirmation/restart counts, Runtime rollback target,
WSL marker result, journal result, and log paths. Never place signing keys or auth tokens in it.

- [ ] **Step 5: Stage CLI bytes once, run acceptance, and move only the dist-tag**

Change `publish.yml` to build and `npm pack --json` once. Resolve an ephemeral tag such as
`coder-studio-accept-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}`. If the version is not in the registry,
publish the tarball once under that tag. On retry, require the registry `dist.integrity` to equal the
packed tarball and reuse it; never republish different bytes for an existing version.

Run `pnpm acceptance:cli:update -- --previous-version ... --candidate-version ... --dist-tag ...`
and upload the report. For final `latest` promotion, download the required Desktop acceptance report
identified by the workflow input and require matching commit SHA/product version. Then execute only:

```bash
npm dist-tag add "@spencer-kit/coder-studio@${candidate_version}" "${final_dist_tag}"
npm dist-tag rm "@spencer-kit/coder-studio" "${acceptance_dist_tag}"
```

Create/push the git tag and GitHub Release only after that succeeds. A non-`latest` manual channel
still requires CLI acceptance but not the production Desktop report. Failed acceptance leaves the
candidate addressable only through its ephemeral tag and produces no final tag/release.

- [ ] **Step 6: Run installed Desktop acceptance before promoting the same prerelease bytes**

Extend `desktop-acceptance.yml` to publish tag-pinned, test-key-signed scenario channels and execute
the entire matrix on a clean Windows x64 runner with WSL Linux x64 enabled. Retain packaged smoke,
signed Runtime, and WSL setup checks as prerequisites. Upload the JSON report even on failure, but
mark the job failed when any scenario is not successful.

In `desktop-release.yml`, keep Task 15's validated/attested non-latest prerelease unchanged. Run the
applicable production installed-upgrade scenario against that exact release. For a stable promotion,
also download the required full Desktop matrix report and CLI acceptance report and validate their
commit SHA, product version, targets, and signature identity. Promotion is only:

```bash
gh release edit "${release_tag}" --prerelease=false --latest
```

For an intentionally prerelease channel, keep `--prerelease --latest=false` after acceptance. No
promotion job checks out build inputs, invokes pnpm build/dist, edits artifacts, or uploads with
`--clobber`.

Add root scripts:

```json
"acceptance:cli:update": "tsx scripts/verify-cli-update.ts",
"acceptance:desktop:installed": "powershell -NoProfile -File scripts/verify-desktop-installed-update.ps1"
```

- [ ] **Step 7: Run acceptance-unit, workflow, CLI regression, and Desktop wiring tests**

Run:

```bash
pnpm exec vitest run --config scripts/vitest.config.ts scripts/verify-cli-update.test.ts scripts/verify-desktop-installed-update.test.ts scripts/github-workflows.test.ts
pnpm --filter @coder-studio/core exec vitest run src/domain/update.test.ts src/domain/product-update.test.ts
pnpm --filter @coder-studio/server exec vitest run src/update/npm-release-metadata.test.ts src/update/update-service.test.ts src/commands/updates.test.ts src/__tests__/update-state-repo.test.ts
pnpm --filter @spencer-kit/coder-studio exec vitest run src/update-runtime.test.ts src/update-worker.test.ts src/server-runner.test.ts
pnpm --filter @coder-studio/desktop exec vitest run src/main-update-wiring.test.ts
```

Expected: PASS. On a release runner, additionally execute both new acceptance commands and require
their reports before promotion. The CLI focused suites must still contain every pre-change case,
including exact npm install, manual fallback, restart failure, and startup reconciliation.

- [ ] **Step 8: Commit installed-upgrade promotion gates**

```bash
git add scripts/verify-cli-update.ts scripts/verify-cli-update.test.ts scripts/verify-desktop-installed-update.ts scripts/verify-desktop-installed-update.test.ts scripts/verify-desktop-installed-update.ps1 packages/desktop/src/main.ts packages/desktop/src/main-update-wiring.test.ts .github/workflows/desktop-acceptance.yml .github/workflows/desktop-release.yml .github/workflows/publish.yml scripts/github-workflows.test.ts package.json
git commit -m "ci: gate update promotion on installed upgrades"
```

---

### Task 17: Add UI E2E coverage, operator documentation, and run the full regression gate

**Files:**
- Create: `e2e/specs/settings/updates.spec.ts`
- Modify: `docs/wiki/Known-Limitations.md`
- Modify: `docs/wiki/Troubleshooting.md`

- [ ] **Step 1: Write the failing routed-update UI E2E scenarios**

Use Playwright's WebSocket routing to proxy all normal traffic to the real E2E Server while replacing
only `updates.getState/check/prepareInstall/startInstall` results. Use `page.addInitScript` before
navigation when a Desktop bridge is required. Do not mutate application atoms from the test.

```ts
// e2e/specs/settings/updates.spec.ts
test("CLI About shows npm product version, local release time, and CLI action only", async ({ page }) => {
  await installUpdateProtocolFixture(page, {
    serverState: cliAvailableState({
      currentVersion: "0.6.0",
      currentPublishedAt: "2026-08-08T01:02:03.000Z",
      latestVersion: "0.7.0",
      latestPublishedAt: "2026-09-01T02:03:04.000Z",
    }),
  });
  await openSettingsSection(page, "about");
  await expect(page.getByTestId("product-version")).toHaveText("v0.6.0");
  await expect(page.getByTestId("product-release-time")).not.toHaveText(/unknown|未知/i);
  await expect(page.getByRole("button", { name: /Update and restart|更新并重启/ })).toBeVisible();
  await expect(page.getByText(/Shell v/)).toHaveCount(0);
});

test("Desktop renders one combined plan and one confirmation", async ({ page }) => {
  const desktop = await installDesktopUpdateFixture(page, combinedDesktopState);
  await installUpdateProtocolFixture(page, { serverState: desktopManagedState });
  await openSettingsSection(page, "about");
  await page.getByRole("button", { name: /Download update|下载更新/ }).click();
  expect(desktop.calls).toEqual(["downloadUpdate"]);
  desktop.emit(readyCombinedDesktopState);
  await page.getByRole("button", { name: /Restart and update|重启并更新/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByRole("button", { name: /Restart and update|重启并更新/ }).last().click();
  expect(desktop.calls).toEqual([
    "downloadUpdate", "prepareUpdateRestart", "restartAndInstallUpdate",
  ]);
});

test("external Desktop sidecar is read-only and never falls back to npm", async ({ page }) => {
  const commands = await installUpdateProtocolFixture(page, { serverState: desktopManagedState });
  await openSettingsSection(page, "about");
  await expect(page.getByText(/Open Coder Studio Desktop|请在 Coder Studio 桌面端/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Update|更新/ })).toHaveCount(0);
  expect(commands).not.toContain("updates.check");
  expect(commands).not.toContain("updates.startInstall");
});
```

Add Desktop WSL, missing release time, component diagnostic expansion, download progress, retry,
manual CLI fallback, unsupported CLI, and local-time assertions. The fixture forwards unrelated
commands/events unchanged and waits for the real connection handshake, so this remains an E2E UI
test rather than a component-test duplicate.

- [ ] **Step 2: Run the new E2E spec and verify missing unified UI behavior fails**

Run:

```bash
pnpm build
pnpm --dir e2e exec playwright test --config playwright.config.ts specs/settings/updates.spec.ts
```

Expected: FAIL until Tasks 13–14 expose the normalized controller UI and test IDs.

- [ ] **Step 3: Document authority, versions, release times, and recovery boundaries**

Add an “Updates” section to `Known-Limitations.md` with these facts:

- Desktop Shell and Product Runtime versions are intentionally independent; Desktop's normal
  product version is the Runtime version, while CLI's is the npm package version.
- Engine ABI is diagnostic compatibility metadata, not a product version.
- Desktop native and WSL updates are managed by the Windows Desktop application; WSL never updates
  this Runtime with npm.
- Global npm CLI retains its own check/install/restart workflow. Unsupported/bundled/source CLI
  environments are read-only.
- External browsers connected to a Desktop sidecar must open Desktop to install updates.
- Release time is shown only when it comes from signed Desktop metadata or npm registry metadata;
  legacy/offline unknown values remain unknown.
- Runtime activation can automatically roll back after health failure. Electron/NSIS Shell install
  does not promise automatic rollback, so the release gate requires compatibility with the previous
  Runtime and real installed-upgrade acceptance.
- Windows x64 and WSL Linux x64 are the initial production Desktop update targets; other Desktop
  feeds remain disabled until they have installed-upgrade lanes.

Add a concise “Update recovery” section to `Troubleshooting.md`: where to find About diagnostics,
how to copy the manual CLI command, how restart-later behaves, what a pending/quarantined Runtime
means, how to open Desktop from an external sidecar page, and which log/journal paths diagnostics
report. Do not tell users to edit/delete the journal or Runtime pointers manually.

- [ ] **Step 4: Run focused cross-package regression suites**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/update.test.ts src/domain/product-update.test.ts
pnpm --filter @coder-studio/server exec vitest run src/update/npm-release-metadata.test.ts src/update/update-service.test.ts src/commands/updates.test.ts src/__tests__/update-state-repo.test.ts src/config.test.ts
pnpm --filter @spencer-kit/coder-studio exec vitest run src/update-runtime.test.ts src/update-worker.test.ts src/server-runner.test.ts
pnpm --filter @coder-studio/desktop test
pnpm --filter @coder-studio/desktop typecheck
TZ=Asia/Shanghai pnpm --filter @coder-studio/web exec vitest run src/features/updates/controller.test.ts src/features/updates/use-update-controller.test.tsx src/features/settings/components/about-settings.test.tsx src/features/workspace/views/shared/footer-update-rail.test.tsx src/features/settings/components/settings-page.test.tsx src/app/providers.lifecycle.test.tsx src/app/providers.test.tsx
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
pnpm exec vitest run --config scripts/vitest.config.ts scripts/build-desktop-runtime.test.ts scripts/build-desktop-channel.test.ts scripts/desktop-release-artifacts.test.ts scripts/verify-cli-update.test.ts scripts/verify-desktop-installed-update.test.ts scripts/github-workflows.test.ts
```

Expected: PASS with every original CLI test name from the verified baseline still present and green.
Treat any CLI check/prepare/exact-install/restart/manual/reconcile failure as a release blocker even
when all Desktop tests pass.

- [ ] **Step 5: Run repository and UI regression commands**

Run:

```bash
pnpm ci:verify
pnpm ci:test
pnpm e2e-ui
pnpm --dir e2e exec playwright test --config playwright.config.ts specs/settings/updates.spec.ts
git diff --check
```

Expected: every command exits `0`. The Windows installed Desktop and real isolated-registry CLI
acceptance lanes require their release runners and signed/staged artifacts; attach their successful
JSON reports to the release rather than claiming them from a non-release local machine.

- [ ] **Step 6: Commit E2E coverage and operator documentation**

```bash
git add e2e/specs/settings/updates.spec.ts docs/wiki/Known-Limitations.md docs/wiki/Troubleshooting.md
git commit -m "docs: explain unified update recovery"
```

---

## Appendix: Complete File Map

### Shared contracts

- Create `packages/core/src/domain/product-update.ts` — explicit runtime authority, normalized product/component state, release timestamps, diagnostic metadata, Desktop settings, and activity-confirmation contracts.
- Create `packages/core/src/domain/product-update.test.ts` — default state, routing-shape, interval, and release-time tests.
- Modify `packages/core/src/domain/update.ts` — CLI persisted state schema v2, schema-v1 read type, and additive release-time/runtime-context fields.
- Modify `packages/core/src/domain/update.test.ts` — CLI schema-v2 defaults and backward-compatible contract tests.
- Modify `packages/core/src/index.ts` — export the new product update contracts.

### CLI and Server authority

- Create `packages/server/src/update/npm-release-metadata.ts` — npm packument lookup for the selected dist-tag and authoritative `time[version]` values.
- Create `packages/server/src/update/npm-release-metadata.test.ts` — registry payload, timestamp, tag, timeout-source, and malformed metadata tests.
- Modify `packages/server/src/storage/repositories/update-state-repo.ts` — read schema v1/v2 and atomically write schema v2.
- Modify `packages/server/src/__tests__/update-state-repo.test.ts` — lossless lazy migration and malformed timestamp tests.
- Modify `packages/server/src/update/update-service.ts` — persist release metadata, expose runtime context, retain existing activity/install/reconcile behavior, and pass v2 metadata to the worker.
- Modify `packages/server/src/update/update-service.test.ts` — npm metadata, cached timestamp, check failure, install, manual fallback, restart reconcile, and unsupported behavior.
- Modify `packages/server/src/commands/updates.test.ts` — additive response fields without command-semantic changes.
- Modify `packages/server/src/config.ts` — explicit update runtime context, registry URL, and dist-tag configuration.
- Modify `packages/server/src/config.test.ts` — unsupported CLI defaults and explicit override tests.
- Modify `packages/cli/src/update-runtime.ts` — declare `cli-global-npm` or `cli-unsupported`, registry origin, and channel tag.
- Modify `packages/cli/src/update-runtime.test.ts` — supported/unsupported CLI routing tests.
- Modify `packages/cli/src/update-worker.ts` — write schema-v2 snapshots and preserve current/target release timestamps through install and restart handoff.
- Modify `packages/cli/src/update-worker.test.ts` — exact install, permission/manual fallback, restart failure, and metadata-preservation tests.
- Modify `packages/cli/src/server-runner.test.ts` — prove the normal CLI entry injects CLI authority and still starts through the existing runner.
- Modify `packages/desktop/src/sidecar.ts` — explicitly report `desktop-managed` while retaining `supported: false` for npm installation.
- Modify `packages/desktop/src/sidecar.test.ts` — prove Desktop sidecars cannot invoke npm update installation.

### Signed Desktop metadata and persistence

- Create `packages/desktop/src/signed-json.ts` — deterministic canonical JSON and Ed25519 verification shared by Runtime and channel manifests.
- Create `packages/desktop/src/signed-json.test.ts` — canonical ordering and signature tests.
- Modify `packages/desktop/src/runtime-manifest.ts` — schema-v2 `publishedAt`, network-v2 enforcement, and legacy installed schema-v1 support.
- Modify `packages/desktop/src/runtime-manifest.test.ts` — signed timestamp, invalid timestamp, network-v1 rejection, and installed-v1 acceptance.
- Create `packages/desktop/src/build-info.ts` — parse packaged Shell build/release metadata with legacy/development fallback.
- Create `packages/desktop/src/build-info.test.ts` — release metadata and unknown-time behavior.
- Create `packages/desktop/src/desktop-channel.ts` — parse and verify the signed same-origin Desktop plan index and compatibility metadata.
- Create `packages/desktop/src/desktop-channel.test.ts` — signature, release time, path/origin, target, and capability tests.
- Create `packages/desktop/src/atomic-json-file.ts` — reusable temporary-file-plus-rename persistence.
- Create `packages/desktop/src/atomic-json-file.test.ts` — atomic replacement and cleanup behavior.
- Create `packages/desktop/src/desktop-update-settings.ts` — `<userData>/desktop-update-settings.json` with six-hour Desktop defaults.
- Create `packages/desktop/src/desktop-update-settings.test.ts` — defaults, valid writes, malformed fallback, and diagnostics.
- Create `packages/desktop/src/desktop-update-journal.ts` — `<userData>/desktop-update-plan.json` schema and reconciliation-safe records.
- Create `packages/desktop/src/desktop-update-journal.test.ts` — round trip, malformed fallback, and credential-free serialization.

### Desktop adapters and coordinator

- Modify `packages/desktop/src/runtime-store.ts` — allow a verified Runtime to be staged against the planned Shell while startup always rechecks the actual Shell.
- Modify `packages/desktop/src/runtime-store.test.ts` — combined-update staging, actual-Shell rejection, health success, quarantine, and fallback.
- Modify `packages/desktop/src/runtime-update-manager.ts` — split metadata check from cancellable download/stage and report progress/release time.
- Modify `packages/desktop/src/runtime-update-manager.test.ts` — check-without-download, download verification, retry, cancellation, and progress.
- Modify `packages/desktop/src/wsl-installer.ts` — expose host-driven metadata check and Runtime staging for an expected channel target.
- Modify `packages/desktop/src/wsl-installer.test.ts` — prove no npm command runs in WSL and only signed host-selected assets are staged.
- Modify `packages/desktop/src/wsl-runtime-store.ts` — expose the quarantined WSL Runtime version to the Windows-hosted adapter without adding an in-WSL updater.
- Modify `packages/desktop/src/wsl-runtime-store.test.ts` — missing, malformed, and valid failed-pointer reads plus explicit-retry gating.
- Create `packages/desktop/src/wsl-runtime-update-adapter.ts` — coordinator adapter for the active WSL target.
- Create `packages/desktop/src/wsl-runtime-update-adapter.test.ts` — active-target selection, check/download split, and progress mapping.
- Modify `packages/desktop/src/update-manager.ts` — convert the dialog-owning manager into a UI-free `electron-updater` Shell adapter.
- Create `packages/desktop/src/update-manager.test.ts` — expected-version pinning, progress, cancellation, ready state, and quit/install handoff.
- Create `packages/desktop/src/desktop-update-coordinator.ts` — checking, compatibility planning, parallel downloads, retry, cancellation, one restart intent, scheduling, and recovery.
- Create `packages/desktop/src/desktop-update-coordinator.test.ts` — no-update, Shell-only, Runtime-only, combined, partial failure, incompatibility, concurrency, cancellation, and journal recovery.
- Create `packages/desktop/src/desktop-update-coordinator.integration.test.ts` — mocked electron-updater plus signed local HTTP Runtime feed, parallel download, and one ready plan.
- Modify `packages/desktop/src/environment-manager.ts` — create WSL Runtime update adapters from the Windows host for the active distribution.
- Modify `packages/desktop/src/environment-manager.test.ts` — active WSL adapter and target Runtime behavior.

### Desktop bridge and Web presentation

- Modify `packages/desktop/src/protocol.ts` — versioned unified update IPC plus the retained Runtime-specific compatibility surface.
- Modify `packages/desktop/src/preload.ts` — frozen unified bridge methods and subscriptions.
- Modify `packages/desktop/src/main.ts` — coordinator construction, actual-version startup reconciliation, one Help menu action, unified/retry IPC, legacy shims, acceptance-only tag pinning, and clean shutdown.
- Create `packages/desktop/src/main-update-wiring.test.ts` — IPC delegation, menu consolidation, native/WSL adapter choice, acceptance source gating, and legacy shim tests.
- Modify `packages/web/src/desktop-api.d.ts` — unified Desktop bridge typings and legacy members.
- Create `packages/web/src/features/updates/types.ts` — Web controller/adapter action types over the shared presentation contract.
- Create `packages/web/src/features/updates/controller.ts` — deterministic Desktop/CLI/read-only resolution with no authority fallback.
- Create `packages/web/src/features/updates/controller.test.ts` — all routing rows and mismatch/read-only behavior.
- Create `packages/web/src/features/updates/use-update-controller.ts` — lifecycle, subscription, active-work preparation, and settings hook.
- Create `packages/web/src/features/updates/use-update-controller.test.tsx` — Desktop IPC, CLI WebSocket, external sidecar, and cleanup tests.
- Modify `packages/web/src/features/updates/atoms.ts` — normalized state, controller, and preparation atoms.
- Modify `packages/web/src/app/providers.tsx` — hydrate Server context first, then resolve and subscribe the controller.
- Modify `packages/web/src/app/providers.lifecycle.test.tsx` — connection/reconnection routing and context mismatch tests.
- Modify `packages/web/src/app/providers.test.tsx` — Server update event forwarding without overwriting Desktop state.
- Modify `packages/web/src/features/settings/components/about-settings.tsx` — product version/release time, diagnostics, one primary action, and authority-specific settings.
- Modify `packages/web/src/features/settings/components/about-settings.test.tsx` — Desktop, CLI, read-only, local-time, unknown-time, diagnostics, and confirmation tests.
- Modify `packages/web/src/features/workspace/views/shared/footer-update-rail.tsx` — normalized actionable statuses and controller actions.
- Modify `packages/web/src/features/workspace/views/shared/footer-update-rail.test.tsx` — download, ready/restart, retry, manual, unsupported, and non-actionable hidden-state cases.
- Modify `packages/web/src/features/settings/components/settings-page.tsx` — stop persisting Desktop update preferences through Server settings.
- Modify `packages/web/src/features/settings/components/settings-page.test.tsx` — authority-specific settings persistence.
- Modify `packages/web/src/locales/en.json` — unified update, release-time, component diagnostics, and recovery copy.
- Modify `packages/web/src/locales/zh.json` — matching Chinese copy.

### Build, release, and acceptance

- Modify `scripts/build-desktop-runtime.ts` — require one UTC release timestamp and emit signed Runtime schema v2.
- Modify `scripts/build-desktop-runtime.test.ts` — timestamp/signature/build target tests.
- Modify `scripts/build-desktop.ts` — embed the Desktop channel URL and generate Shell `build-info.json`.
- Create `scripts/build-desktop-channel.ts` — build/sign `desktop-channel.json` from staged immutable artifacts.
- Create `scripts/build-desktop-channel.test.ts` — full/runtime-only index generation and prior Shell timestamp carry-forward.
- Modify `packages/desktop/electron-builder.yml` — package `build-info.json` under `resources`.
- Modify `scripts/desktop-release-artifacts.ts` — stage and validate build info, channel index, versions, signatures, paths, hashes, and compatibility.
- Modify `scripts/desktop-release-artifacts.test.ts` — incomplete bundle and every publication-gate failure.
- Modify `.github/workflows/desktop-verify.yml` — common UTC timestamp, signed channel inputs, and complete bundle validation.
- Modify `.github/workflows/desktop-release.yml` — immutable full/runtime-only channel generation, carry-forward, validation, and acceptance gating.
- Modify `.github/workflows/desktop-acceptance.yml` — publish a tag-pinned signed channel and run installed Windows/WSL upgrades before producing the report.
- Modify `.github/workflows/publish.yml` — publish CLI to a staging dist-tag, run isolated-prefix acceptance, then promote the same package bytes.
- Modify `scripts/github-workflows.test.ts` — assert ordering, permissions, carry-forward, staging, acceptance, and promotion boundaries.
- Create `scripts/verify-cli-update.ts` — isolated npm-prefix packaged CLI check/install/restart/reconcile acceptance runner.
- Create `scripts/verify-cli-update.test.ts` — command, prefix, state, log, and failure-mode tests.
- Create `scripts/verify-desktop-installed-update.ts` — CDP/preload driver for installed Shell/Runtime/WSL/recovery scenarios.
- Create `scripts/verify-desktop-installed-update.test.ts` — installed-driver action, version, journal, rollback, and no-WSL-npm tests.
- Create `scripts/verify-desktop-installed-update.ps1` — previous-stable Windows install and Shell/Runtime/WSL/journal/rollback scenarios.
- Modify `package.json` — channel-build and update-acceptance commands.
- Create `e2e/specs/settings/updates.spec.ts` — routed CLI/Desktop/read-only UI behavior, release-time, diagnostics, progress, and confirmation coverage.
- Modify `docs/wiki/Known-Limitations.md` — supported Desktop platforms, Shell rollback boundary, release-time fallback, and CLI/Desktop authority notes.
- Modify `docs/wiki/Troubleshooting.md` — update diagnostics, restart-later, manual CLI, pending/quarantine, and external-sidecar recovery guidance.

## Stable Interface Decisions

Use these names consistently in every task:

```ts
type UpdateAuthority = "desktop" | "cli" | "none";
type UpdateEnvironment =
  | "desktop-native"
  | "desktop-wsl"
  | "cli-global-npm"
  | "cli-unsupported"
  | "desktop-managed";

interface UpdateRuntimeContext {
  environment: UpdateEnvironment;
  authority: UpdateAuthority;
  supported: boolean;
  unsupportedReason: string | null;
}

type ProductUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "restarting"
  | "succeeded"
  | "failed"
  | "manual_required"
  | "unsupported";

type UpdateComponentId = "shell" | "runtime:win32-x64" | "runtime:linux-x64" | "cli";

interface ProductUpdateDiagnostics {
  failedComponentId: UpdateComponentId | null;
  failedPhase: string | null;
  shellVersion: string | null;
  shellPublishedAt: string | null;
  shellBuiltAt: string | null;
  engineVersion: string | null;
  nodeVersion: string | null;
  runtimeHostApiVersion: number | null;
  apiProtocolVersion: number | null;
  dataSchemaVersion: number | null;
  logLocations: string[];
  recoveryAction: string | null;
}
```

Release timestamps are UTC ISO 8601 strings or `null`. Check/start/finish timestamps remain epoch milliseconds in the existing CLI contract. Desktop journal creation/update timestamps are UTC ISO strings. Never substitute a check time or file modification time for a missing release time.

The top-level legacy `UpdateStateView.supported` continues to mean “this Server can perform its npm install.” A Desktop-managed Server therefore reports `supported: false` and `installKind: "unsupported"`, while its additive `runtimeContext` is `{ environment: "desktop-managed", authority: "desktop", supported: true, unsupportedReason: null }`. This preserves old-client safety and gives new clients the correct external authority.

The first production release using this contract is a full Desktop release. Runtime-only publication
is enabled only after a signed prior unified channel exists. Windows x64 and WSL Linux x64 are the
initial mutable Desktop targets; other Desktop platforms stay read-only until their installed lanes
exist. The unified Desktop bridge is `updateApiVersion: 1` and includes `retryUpdate`; the retained
Runtime-only methods are compatibility shims, not an alternate authority.

## Verified Pre-change CLI Baseline

Run before Task 1 and preserve the same assertions throughout Tasks 1–5:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/update.test.ts
pnpm --filter @coder-studio/server exec vitest run src/update/update-service.test.ts src/commands/updates.test.ts src/__tests__/update-state-repo.test.ts
pnpm --filter @spencer-kit/coder-studio exec vitest run src/update-runtime.test.ts src/update-worker.test.ts src/server-runner.test.ts
```

Expected: Core `1` file / `4` tests pass, Server `3` files / `19` tests pass, and CLI `3` files / `14` tests pass. These counts describe the 2026-08-08 baseline; later tasks must pass all original named cases plus their new cases even when the totals increase.

---
