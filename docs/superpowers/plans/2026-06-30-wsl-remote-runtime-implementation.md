# WSL Remote Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a VS Code style WSL remote-runtime flow where Windows keeps one desktop UI and host control plane, while each WSL distro gets one host-managed runtime that all workspaces in that distro share.

**Architecture:** Reuse the current per-distro brokered runtime direction, but make it a real host-managed remote-runtime lifecycle. The server becomes responsible for distro runtime install records, strict version reconciliation, and bridge startup; the desktop app owns WSL launch/integration while the npm CLI remains host-only.

**Tech Stack:** TypeScript, Electron, Fastify/WebSocket, JSON-RPC, Vitest, existing `packages/server` runtime router/orchestrator, `packages/desktop` sidecar bootstrap, `packages/cli`, `packages/runtime`.

---

## Scope

This plan implements the architecture approved in:

- `docs/superpowers/specs/2026-06-30-wsl-remote-runtime-architecture-design.md`

> **2026-07-01 scope update:** treat this as a fresh requirement with no legacy migration. The npm CLI is single-environment and host-only. Any steps below that assume CLI-owned WSL launch behavior are superseded; desktop-owned WSL integration is the intended direction.

It covers:

- host-managed per-distro WSL runtime install state
- strict host/runtime version reconciliation
- desktop-owned WSL runtime source wiring with the npm CLI staying host-only
- a Windows/WSL `coder-studio` open flow that routes through the desktop host
- distro runtime diagnostics and lifecycle commands

It does not cover:

- broad settings UI federation
- remote multi-node aggregation
- provider-specific UX changes beyond lifecycle correctness

## File Structure

### Shared runtime source contract

- Create: `packages/runtime/src/wsl-runtime-source.ts`
  - defines the runtime source descriptor used by desktop-owned WSL launch flows
- Modify: `packages/runtime/src/index.ts`
  - exports the shared source helper
- Test: `packages/runtime/src/wsl-runtime-source.test.ts`
  - locks default path and validation behavior

### Server-side WSL runtime install lifecycle

- Modify: `packages/server/src/config.ts`
  - extends `ServerConfigInput` with a WSL runtime source contract
- Modify: `packages/server/src/runtime/wsl-distro-store.ts`
  - persists the active installed runtime pointer per distro
- Create: `packages/server/src/runtime/wsl-runtime-install-manager.ts`
  - installs, upgrades, and removes per-distro runtime payloads
- Modify: `packages/server/src/runtime/wsl-bridge-manager.ts`
  - uses installed runtime pointers instead of ad hoc source assumptions
- Modify: `packages/server/src/runtime/wsl-bootstrap.ts`
  - launches the installed per-distro runtime entry
- Modify: `packages/server/src/server.ts`
  - wires the install manager and bridge manager into the host runtime lifecycle
- Tests:
  - `packages/server/src/__tests__/runtime/wsl-distro-store.test.ts`
  - `packages/server/src/__tests__/runtime/wsl-runtime-install-manager.test.ts`
  - `packages/server/src/__tests__/runtime/wsl-bridge-manager.test.ts`
  - `packages/server/src/__tests__/server-workspace-runtime-orchestration.test.ts`

### Desktop and host-runtime startup alignment

- Modify: `packages/desktop/src/runtime-launch-entry.ts`
  - passes a real WSL runtime source into `createServer(...)`
- Modify: `packages/cli/src/server-runner.ts`
  - keeps npm CLI host mode explicitly WSL-disabled
- Modify: `packages/cli/src/desktop-server.ts`
  - keeps desktop-sidecar startup aligned with the same server config shape
- Tests:
  - `packages/desktop/src/runtime-launch-entry.test.ts`
  - `packages/cli/src/server-runner.test.ts`
  - `packages/cli/src/desktop-server.test.ts`

### Desktop open-request flow

- Create: `packages/desktop/src/workspace-open-request.ts`
  - parses and executes workspace open requests delivered via desktop process argv
- Modify: `packages/desktop/src/app-controller.ts`
  - can open a workspace against the sidecar after startup or after a second-instance request
- Modify: `packages/desktop/src/main.ts`
  - forwards second-instance argv into open-request handling
- Tests:
  - `packages/desktop/src/workspace-open-request.test.ts`
  - `packages/desktop/src/app-controller.test.ts`

### Diagnostics and lifecycle commands

- Create: `packages/server/src/commands/wsl-runtime.ts`
  - host commands for list, restart, stop, remove, repair
- Modify: `packages/server/src/commands/index.ts`
  - registers the new command group
- Modify: `packages/server/src/host/context.ts`
  - exposes the runtime management dependency to host commands
- Modify: `packages/server/src/server.ts`
  - provides the lifecycle manager and status queries
- Tests:
  - `packages/server/src/__tests__/wsl-runtime-commands.test.ts`
  - `packages/server/src/__tests__/diagnostics-commands.test.ts`

### Docs

- Create: `docs/help/wsl-remote-runtime.md`
  - explains the host/WSL runtime split and first-use install behavior
- Modify: `docs/help/desktop-guide.md`
  - explains that WSL projects still open in the Windows desktop UI
- Modify: `packages/cli/README.md`
  - documents `coder-studio .` from WSL and lazy runtime install

## Task 1: Add A Shared WSL Runtime Source Contract

**Files:**
- Create: `packages/runtime/src/wsl-runtime-source.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/src/wsl-runtime-source.test.ts`

- [ ] **Step 1: Write the failing runtime-source tests**

```ts
import { describe, expect, it } from "vitest";
import { buildWslRuntimeSource } from "./wsl-runtime-source.js";

describe("buildWslRuntimeSource", () => {
  it("uses the default WSL entry relative path", () => {
    expect(
      buildWslRuntimeSource({
        runtimeVersion: "0.5.4",
        packageRoot: "/opt/coder-studio/runtime",
      })
    ).toEqual({
      runtimeVersion: "0.5.4",
      packageRoot: "/opt/coder-studio/runtime",
      entryPath: "/opt/coder-studio/runtime/dist/wsl-runtime-entry.mjs",
    });
  });

  it("rejects an empty runtime version", () => {
    expect(() =>
      buildWslRuntimeSource({
        runtimeVersion: "   ",
        packageRoot: "/opt/coder-studio/runtime",
      })
    ).toThrow("WSL runtime version is required");
  });
});
```

- [ ] **Step 2: Run the runtime-source tests to verify they fail**

Run: `pnpm --filter @coder-studio/runtime exec vitest run src/wsl-runtime-source.test.ts`

Expected: FAIL with `Cannot find module './wsl-runtime-source.js'` or `buildWslRuntimeSource is not defined`.

- [ ] **Step 3: Implement the shared source descriptor**

```ts
import { resolve } from "node:path";

export interface WslRuntimeSource {
  runtimeVersion: string;
  packageRoot: string;
  entryPath: string;
}

export function buildWslRuntimeSource(input: {
  runtimeVersion: string;
  packageRoot: string;
  entryRelativePath?: string;
}): WslRuntimeSource {
  const runtimeVersion = input.runtimeVersion.trim();
  if (!runtimeVersion) {
    throw new Error("WSL runtime version is required");
  }

  const packageRoot = input.packageRoot.trim();
  if (!packageRoot) {
    throw new Error("WSL runtime package root is required");
  }

  const entryRelativePath = input.entryRelativePath?.trim() || "dist/wsl-runtime-entry.mjs";
  return {
    runtimeVersion,
    packageRoot,
    entryPath: resolve(packageRoot, entryRelativePath),
  };
}
```

Also export it from `packages/runtime/src/index.ts`:

```ts
export * from "./wsl-runtime-source.js";
```

- [ ] **Step 4: Run the runtime-source tests to verify they pass**

Run: `pnpm --filter @coder-studio/runtime exec vitest run src/wsl-runtime-source.test.ts`

Expected: PASS with 2 tests passed.

- [ ] **Step 5: Commit the shared contract**

```bash
git add packages/runtime/src/wsl-runtime-source.ts \
        packages/runtime/src/index.ts \
        packages/runtime/src/wsl-runtime-source.test.ts
git commit -m "feat: add shared WSL runtime source contract"
```

## Task 2: Persist Installed Runtime State Per Distro

**Files:**
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/src/runtime/wsl-distro-store.ts`
- Create: `packages/server/src/runtime/wsl-runtime-install-manager.ts`
- Modify: `packages/server/src/runtime/wsl-bridge-manager.ts`
- Modify: `packages/server/src/runtime/wsl-bootstrap.ts`
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/src/__tests__/runtime/wsl-distro-store.test.ts`
- Test: `packages/server/src/__tests__/runtime/wsl-runtime-install-manager.test.ts`
- Test: `packages/server/src/__tests__/runtime/wsl-bridge-manager.test.ts`

- [ ] **Step 1: Extend the store tests to require a persisted per-distro runtime pointer**

```ts
import { describe, expect, it } from "vitest";
import { createWslDistroRuntimeStore } from "../../runtime/wsl-distro-store.js";

describe("createWslDistroRuntimeStore", () => {
  it("persists one active runtime pointer per distro", async () => {
    const store = createWslDistroRuntimeStore({
      rootDir: "/tmp/coder-studio-wsl-store",
    });

    await store.writeActiveRuntime("Ubuntu-24.04", {
      runtimeVersion: "0.5.4",
      installDir: "/home/test/.coder-studio/runtime-store/versions/0.5.4",
      entryPath: "/home/test/.coder-studio/runtime-store/versions/0.5.4/dist/wsl-runtime-entry.mjs",
      installedAt: 1234,
    });

    await expect(store.readActiveRuntime("Ubuntu-24.04")).resolves.toMatchObject({
      runtimeVersion: "0.5.4",
      installDir: expect.stringContaining("/0.5.4"),
    });
  });
});
```

Add a new install-manager test:

```ts
import { describe, expect, it, vi } from "vitest";
import { createWslRuntimeInstallManager } from "../../runtime/wsl-runtime-install-manager.js";

describe("createWslRuntimeInstallManager", () => {
  it("reinstalls when the stored version differs from the host", async () => {
    const installRuntime = vi.fn(async ({ distro, runtimeVersion }) => ({
      distro,
      runtimeVersion,
      installDir: `/wsl/${distro}/${runtimeVersion}`,
      entryPath: `/wsl/${distro}/${runtimeVersion}/dist/wsl-runtime-entry.mjs`,
      installedAt: 100,
    }));

    const manager = createWslRuntimeInstallManager({
      hostRuntimeVersion: "0.5.4",
      store,
      installRuntime,
    });

    const pointer = await manager.ensureInstalled("Ubuntu-24.04");
    expect(pointer.runtimeVersion).toBe("0.5.4");
    expect(installRuntime).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the server tests to verify they fail**

Run: `pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-distro-store.test.ts src/__tests__/runtime/wsl-runtime-install-manager.test.ts src/__tests__/runtime/wsl-bridge-manager.test.ts`

Expected: FAIL because `createWslDistroRuntimeStore` and `createWslRuntimeInstallManager` do not expose the required methods yet.

- [ ] **Step 3: Implement the persisted pointer store and install manager**

In `packages/server/src/config.ts`, extend the host config contract:

```ts
import type { WslRuntimeSource } from "@coder-studio/runtime";

export interface ServerConfigInput {
  // existing fields...
  wslRuntime?: {
    source: WslRuntimeSource;
  };
}
```

In `packages/server/src/runtime/wsl-distro-store.ts`, add a real pointer API:

```ts
export interface InstalledWslRuntimePointer {
  runtimeVersion: string;
  installDir: string;
  entryPath: string;
  installedAt: number;
  nodePath?: string;
}

export function createWslDistroRuntimeStore(input: { rootDir: string }) {
  return {
    async readActiveRuntime(distro: string): Promise<InstalledWslRuntimePointer | null> {
      // read <rootDir>/<encoded-distro>/current.json
    },
    async writeActiveRuntime(distro: string, pointer: InstalledWslRuntimePointer): Promise<void> {
      // write current.json atomically
    },
    async clearActiveRuntime(distro: string): Promise<void> {
      // remove current.json
    },
  };
}
```

Create `packages/server/src/runtime/wsl-runtime-install-manager.ts`:

```ts
export function createWslRuntimeInstallManager(input: {
  hostRuntimeVersion: string;
  store: ReturnType<typeof createWslDistroRuntimeStore>;
  installRuntime(input: {
    distro: string;
    runtimeVersion: string;
  }): Promise<InstalledWslRuntimePointer>;
}) {
  return {
    async ensureInstalled(distro: string): Promise<InstalledWslRuntimePointer> {
      const current = await input.store.readActiveRuntime(distro);
      if (current?.runtimeVersion === input.hostRuntimeVersion) {
        return current;
      }

      const installed = await input.installRuntime({
        distro,
        runtimeVersion: input.hostRuntimeVersion,
      });
      await input.store.writeActiveRuntime(distro, installed);
      return installed;
    },
  };
}
```

Then wire `createWslBridgeManager(...)` so the bridge creation path receives the installed pointer and `packages/server/src/runtime/wsl-bootstrap.ts` launches `pointer.entryPath` instead of assuming a host-relative source path.

- [ ] **Step 4: Run the targeted server tests to verify they pass**

Run: `pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-distro-store.test.ts src/__tests__/runtime/wsl-runtime-install-manager.test.ts src/__tests__/runtime/wsl-bridge-manager.test.ts`

Expected: PASS with the new install-manager coverage and the existing bridge-manager suite still green.

- [ ] **Step 5: Commit the persisted install lifecycle**

```bash
git add packages/server/src/config.ts \
        packages/server/src/runtime/wsl-distro-store.ts \
        packages/server/src/runtime/wsl-runtime-install-manager.ts \
        packages/server/src/runtime/wsl-bridge-manager.ts \
        packages/server/src/runtime/wsl-bootstrap.ts \
        packages/server/src/server.ts \
        packages/server/src/__tests__/runtime/wsl-distro-store.test.ts \
        packages/server/src/__tests__/runtime/wsl-runtime-install-manager.test.ts \
        packages/server/src/__tests__/runtime/wsl-bridge-manager.test.ts
git commit -m "feat: persist per-distro WSL runtime installs"
```

## Task 3: Converge Desktop And CLI Host Startup On The Same Runtime Source

**Files:**
- Modify: `packages/desktop/src/runtime-launch-entry.ts`
- Modify: `packages/cli/src/server-runner.ts`
- Modify: `packages/cli/src/desktop-server.ts`
- Test: `packages/desktop/src/runtime-launch-entry.test.ts`
- Test: `packages/cli/src/server-runner.test.ts`
- Test: `packages/cli/src/desktop-server.test.ts`

- [ ] **Step 1: Add failing startup tests for a shared `wslRuntime.source`**

In `packages/desktop/src/runtime-launch-entry.test.ts`:

```ts
expect(buildDesktopRuntimeServerConfig(env, import.meta.url).serverConfig.wslRuntime).toMatchObject({
  source: {
    runtimeVersion: expect.any(String),
    entryPath: expect.stringContaining("wsl-runtime-entry"),
  },
});
```

In `packages/cli/src/server-runner.test.ts`:

```ts
expect(buildServerConfig().wslRuntime).toMatchObject({
  source: {
    runtimeVersion: expect.any(String),
    entryPath: expect.stringContaining("wsl-runtime-entry"),
  },
});
```

- [ ] **Step 2: Run the desktop and host-runtime startup tests to verify they fail**

Run: `pnpm --filter @coder-studio/desktop exec vitest run src/runtime-launch-entry.test.ts && pnpm --filter @spencer-kit/coder-studio exec vitest run src/server-runner.test.ts src/desktop-server.test.ts`

Expected: FAIL because neither startup path passes `serverConfig.wslRuntime.source` yet.

- [ ] **Step 3: Build and pass the shared source from both launch surfaces**

In `packages/desktop/src/runtime-launch-entry.ts`:

```ts
import { buildWslRuntimeSource } from "@coder-studio/runtime";

const wslRuntimeSource = buildWslRuntimeSource({
  runtimeVersion,
  packageRoot: currentDir,
  entryRelativePath: "./wsl-runtime-entry.mjs",
});

const serverConfig: ServerConfigInput = {
  // existing fields...
  wslRuntime: {
    source: wslRuntimeSource,
  },
};
```

In `packages/cli/src/server-runner.ts`:

```ts
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { buildWslRuntimeSource } from "@coder-studio/runtime";

const currentDir = dirname(fileURLToPath(import.meta.url));
const wslRuntimeSource = buildWslRuntimeSource({
  runtimeVersion: getCliVersion(import.meta.url),
  packageRoot: resolve(currentDir, "../../runtime"),
  entryRelativePath: "src/wsl-runtime-entry.ts",
});

const config: ServerConfigInput = {
  // existing fields...
  wslRuntime: {
    source: wslRuntimeSource,
  },
};
```

In `packages/cli/src/desktop-server.ts`, thread the same config shape through `startServer(...)` so the sidecar server path stays aligned.

- [ ] **Step 4: Run the startup tests to verify they pass**

Run: `pnpm --filter @coder-studio/desktop exec vitest run src/runtime-launch-entry.test.ts && pnpm --filter @spencer-kit/coder-studio exec vitest run src/server-runner.test.ts src/desktop-server.test.ts`

Expected: PASS with desktop asserting the WSL runtime source contract and the npm CLI asserting that WSL remains disabled in host-only mode.

- [ ] **Step 5: Commit the converged startup wiring**

```bash
git add packages/desktop/src/runtime-launch-entry.ts \
        packages/cli/src/server-runner.ts \
        packages/cli/src/desktop-server.ts \
        packages/desktop/src/runtime-launch-entry.test.ts \
        packages/cli/src/server-runner.test.ts \
        packages/cli/src/desktop-server.test.ts
git commit -m "feat: align desktop and host runtime startup contracts"
```

## Task 4: Add A Desktop Open-Workspace Flow For Windows And Desktop-Owned WSL Invocations

**Files:**
- Create: `packages/desktop/src/workspace-open-request.ts`
- Modify: `packages/desktop/src/app-controller.ts`
- Modify: `packages/desktop/src/main.ts`
- Test: `packages/desktop/src/workspace-open-request.test.ts`
- Test: `packages/desktop/src/app-controller.test.ts`

- [ ] **Step 1: Write the failing argv/open-request tests**

Create `packages/desktop/src/workspace-open-request.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseWorkspaceOpenRequest } from "./workspace-open-request.js";

describe("parseWorkspaceOpenRequest", () => {
  it("parses a WSL workspace request", () => {
    expect(
      parseWorkspaceOpenRequest([
        "Coder Studio.exe",
        "--desktop-open-workspace",
        "--target-runtime",
        "wsl",
        "--wsl-distro",
        "Ubuntu-24.04",
        "--path",
        "/home/test/repo",
      ])
    ).toEqual({
      targetRuntime: "wsl",
      wslDistro: "Ubuntu-24.04",
      path: "/home/test/repo",
    });
  });
});
```

- [ ] **Step 2: Run the desktop tests to verify they fail**

Run: `pnpm --filter @coder-studio/desktop exec vitest run src/workspace-open-request.test.ts src/app-controller.test.ts`

Expected: FAIL because the parser and controller open hook do not exist yet.

- [ ] **Step 3: Implement the desktop open-request parser and controller hook**

Create `packages/desktop/src/workspace-open-request.ts`:

```ts
export interface WorkspaceOpenRequest {
  path: string;
  targetRuntime: "native" | "wsl";
  wslDistro?: string;
}

export function parseWorkspaceOpenRequest(argv: string[]): WorkspaceOpenRequest | null {
  if (!argv.includes("--desktop-open-workspace")) {
    return null;
  }

  const targetRuntime = readArg(argv, "--target-runtime");
  const path = readArg(argv, "--path");
  const wslDistro = targetRuntime === "wsl" ? readArg(argv, "--wsl-distro") : undefined;

  return {
    path,
    targetRuntime: targetRuntime === "wsl" ? "wsl" : "native",
    ...(wslDistro ? { wslDistro } : {}),
  };
}
```

Update `packages/desktop/src/app-controller.ts` with an explicit open path:

```ts
async openWorkspace(request: WorkspaceOpenRequest): Promise<void> {
  const sidecar = this.sidecar ?? (await this.deps.startSidecar());
  await this.deps.openWorkspace(sidecar.browserUrl, request);
  this.window?.focus();
}
```

Update `packages/desktop/src/main.ts`:

```ts
app.on("second-instance", (_event, argv) => {
  const request = parseWorkspaceOpenRequest(argv);
  if (request) {
    void controller?.openWorkspace(request);
    return;
  }

  controller?.focus();
});
```

Wire the desktop-owned WSL launcher to pass explicit args instead of trying to install or start the runtime itself inside the launcher process.

- [ ] **Step 4: Run the desktop tests to verify they pass**

Run: `pnpm --filter @coder-studio/desktop exec vitest run src/workspace-open-request.test.ts src/app-controller.test.ts`

Expected: PASS with argv parsing, second-instance forwarding, and desktop-owned WSL forwarding all covered.

- [ ] **Step 5: Commit the open-workspace flow**

```bash
git add packages/desktop/src/workspace-open-request.ts \
        packages/desktop/src/workspace-open-request.test.ts \
        packages/desktop/src/app-controller.ts \
        packages/desktop/src/app-controller.test.ts \
        packages/desktop/src/main.ts
git commit -m "feat: route desktop-owned WSL opens through desktop host"
```

## Task 5: Expose Distro Runtime Diagnostics And Lifecycle Commands

**Files:**
- Create: `packages/server/src/commands/wsl-runtime.ts`
- Modify: `packages/server/src/commands/index.ts`
- Modify: `packages/server/src/host/context.ts`
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/src/__tests__/wsl-runtime-commands.test.ts`
- Test: `packages/server/src/__tests__/diagnostics-commands.test.ts`

- [ ] **Step 1: Write the failing command tests**

Create `packages/server/src/__tests__/wsl-runtime-commands.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { dispatch } from "../ws/dispatch.js";

describe("wslRuntime.list", () => {
  it("returns distro runtime status from the host lifecycle manager", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "test-wsl-runtime-list",
        op: "wslRuntime.list",
        args: {},
      },
      commandContext
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      runtimes: [
        expect.objectContaining({
          distro: "Ubuntu-24.04",
          runtimeVersion: "0.5.4",
          health: "healthy",
        }),
      ],
    });
  });
});
```

Extend `packages/server/src/__tests__/diagnostics-commands.test.ts`:

```ts
expect(diagnostics.checks).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      key: "wsl_runtime_version_match",
      status: "ok",
    }),
  ])
);
```

- [ ] **Step 2: Run the command tests to verify they fail**

Run: `pnpm --filter @coder-studio/server exec vitest run src/__tests__/wsl-runtime-commands.test.ts src/__tests__/diagnostics-commands.test.ts`

Expected: FAIL because the host context and command registrations do not expose WSL runtime lifecycle data yet.

- [ ] **Step 3: Implement host commands and diagnostics integration**

Create `packages/server/src/commands/wsl-runtime.ts`:

```ts
registerHostCommand({
  op: "wslRuntime.list",
  handler: async (_args, ctx) => ({
    runtimes: await ctx.wslRuntimeManager.list(),
  }),
});

registerHostCommand({
  op: "wslRuntime.restart",
  handler: async (args, ctx) => ctx.wslRuntimeManager.restart(args.distro),
});

registerHostCommand({
  op: "wslRuntime.remove",
  handler: async (args, ctx) => ctx.wslRuntimeManager.remove(args.distro),
});
```

In `packages/server/src/host/context.ts`, expose:

```ts
wslRuntimeManager: {
  list(): Promise<WslRuntimeStatus[]>;
  restart(distro: string): Promise<void>;
  stop(distro: string): Promise<void>;
  remove(distro: string): Promise<void>;
  repair(distro: string): Promise<void>;
};
```

Then thread the concrete implementation from `packages/server/src/server.ts` and surface the version-match state through diagnostics.

- [ ] **Step 4: Run the command tests to verify they pass**

Run: `pnpm --filter @coder-studio/server exec vitest run src/__tests__/wsl-runtime-commands.test.ts src/__tests__/diagnostics-commands.test.ts`

Expected: PASS with both the dedicated runtime commands and diagnostics coverage green.

- [ ] **Step 5: Commit the lifecycle command surface**

```bash
git add packages/server/src/commands/wsl-runtime.ts \
        packages/server/src/commands/index.ts \
        packages/server/src/host/context.ts \
        packages/server/src/server.ts \
        packages/server/src/__tests__/wsl-runtime-commands.test.ts \
        packages/server/src/__tests__/diagnostics-commands.test.ts
git commit -m "feat: expose WSL runtime lifecycle commands"
```

## Task 6: Document The Flow And Run The Final Verification Matrix

**Files:**
- Create: `docs/help/wsl-remote-runtime.md`
- Modify: `docs/help/desktop-guide.md`
- Modify: `packages/cli/README.md`

- [ ] **Step 1: Add the dedicated WSL runtime help doc**

Write `docs/help/wsl-remote-runtime.md` with the key user-facing contract:

```md
# WSL Remote Runtime

Coder Studio keeps one Windows desktop UI.

When you open a WSL project, Coder Studio:

1. detects the target distro
2. checks whether that distro already has the matching runtime version
3. installs or upgrades it if needed
4. starts one shared runtime for that distro
5. opens the workspace in the Windows desktop app

`coder-studio .` inside WSL opens the Windows desktop UI. It does not start a second Linux UI.
```

- [ ] **Step 2: Update the desktop and installer docs**

Add this note to `docs/help/desktop-guide.md`:

```md
### Opening WSL projects

If you run `coder-studio .` inside a WSL terminal, the same Windows desktop app opens the project.
Coder Studio may install or update the matching runtime inside that distro on first use.
```

Add this note to `packages/cli/README.md`:

```md
### WSL

The npm CLI remains host-only. To open WSL workspaces in the Windows desktop UI, install the desktop app and use its `coder-studio` launcher integration instead of the npm CLI package.
```

- [ ] **Step 3: Run the final targeted verification matrix**

Run:

```bash
pnpm --filter @coder-studio/runtime exec vitest run src/wsl-runtime-source.test.ts
pnpm --filter @coder-studio/server exec vitest run \
  src/__tests__/runtime/wsl-distro-store.test.ts \
  src/__tests__/runtime/wsl-runtime-install-manager.test.ts \
  src/__tests__/runtime/wsl-bridge-manager.test.ts \
  src/__tests__/runtime/wsl-runtime-broker.test.ts \
  src/__tests__/runtime/wsl-runtime.test.ts \
  src/__tests__/runtime/wsl-bootstrap.test.ts \
  src/__tests__/server-workspace-runtime-orchestration.test.ts \
  src/__tests__/wsl-runtime-commands.test.ts \
  src/__tests__/diagnostics-commands.test.ts
pnpm --filter @coder-studio/server exec tsc -p tsconfig.json --noEmit
pnpm --filter @coder-studio/desktop exec vitest run src/runtime-launch-entry.test.ts src/workspace-open-request.test.ts src/app-controller.test.ts
pnpm --filter @spencer-kit/coder-studio exec vitest run src/server-runner.test.ts src/desktop-server.test.ts src/bin.test.ts
```

Expected: all commands PASS with no type errors.

- [ ] **Step 4: Run a manual smoke checklist**

Verify these flows manually:

```text
1. Launch desktop app and open a native Windows workspace.
2. Run `coder-studio .` in WSL distro A and confirm the Windows desktop app opens that workspace.
3. Open a second workspace in the same distro and confirm it reuses the same distro runtime id.
4. Open a workspace in distro B and confirm it gets a different runtime id.
5. Bump the host runtime version locally, restart, and confirm startup forces distro runtime reconciliation before the workspace opens.
6. Quit the desktop app and confirm active WSL bridge processes exit.
```

- [ ] **Step 5: Commit docs and final verification results**

```bash
git add docs/help/wsl-remote-runtime.md \
        docs/help/desktop-guide.md \
        packages/cli/README.md
git commit -m "docs: explain WSL remote runtime flow"
```

## Self-Review Checklist

### Spec coverage

- host-managed per-distro runtime lifecycle: Task 2
- strict host/runtime version equality: Tasks 2 and 5
- desktop/runtime ownership split: Tasks 1 and 3
- Windows/WSL `coder-studio` open flow: Task 4
- distro diagnostics and lifecycle actions: Task 5
- user-facing documentation: Task 6

### Placeholder scan

- No `TBD`
- No `TODO`
- No "write tests for the above" placeholders
- Every task has explicit files, code snippets, commands, and commit boundaries

### Type consistency

The plan uses one shared set of names throughout:

- `WslRuntimeSource`
- `InstalledWslRuntimePointer`
- `createWslRuntimeInstallManager`
- `WorkspaceOpenRequest`
- `wslRuntime.list`

Those names should stay stable during implementation.
