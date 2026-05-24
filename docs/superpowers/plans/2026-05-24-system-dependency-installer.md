# System Dependency Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class system dependency installer for `git` and `node` that supports Linux/macOS package-manager installs, web-based interactive privilege escalation, and diagnostics-page recovery flows.

**Architecture:** Add a new `systemDeps` domain shared between `@coder-studio/core`, `@coder-studio/server`, and `@coder-studio/web`. Server-side runtime status and install jobs stay separate from provider installation, but reuse the same structured `job/step/failure` model. Interactive installs run in dedicated PTY-backed sessions owned by the system dependency install manager, and the diagnostics page drives them through `systemDeps.install.*` commands plus a dedicated output topic.

**Tech Stack:** TypeScript, React 19, Jotai, Vitest, Testing Library, Zod, existing websocket command dispatch, existing `node-pty` host, and diagnostics styles in `packages/web/src/styles/components.css`.

**Spec reference:** `docs/superpowers/specs/2026-05-24-system-dependency-installer-design.md`

**Git hygiene:** The worktree already contains unrelated user changes and an in-progress merge. Read files before patching them, stage only the files named in each task, and never revert unrelated edits.

---

## File Structure

**New files:**
- `packages/core/src/domain/system-dependency-install.ts` — shared runtime/install types, dependency ids, and output payload contract
- `packages/core/src/domain/system-dependency-install.test.ts` — runtime helpers and exported constant coverage
- `packages/server/src/system-deps/definitions.ts` — installable dependency definitions, package-manager command templates, docs, and manual guide keys
- `packages/server/src/system-deps/runtime-status.ts` — package-manager detection, version probing, and `autoInstallSupported` calculation
- `packages/server/src/system-deps/interaction-detector.ts` — PTY output parsing for `sudo` password and confirmation prompts
- `packages/server/src/system-deps/install-manager.ts` — job lifecycle, PTY session ownership, output broadcasting, input handling, cancelation, and final verification
- `packages/server/src/commands/system-deps.ts` — websocket command handlers for runtime status and install lifecycle
- `packages/server/src/__tests__/system-deps/runtime-status.test.ts` — runtime-status and package-manager detection tests
- `packages/server/src/__tests__/system-deps/interaction-detector.test.ts` — prompt-detection tests
- `packages/server/src/__tests__/system-deps/install-manager.test.ts` — install job lifecycle tests with a fake PTY host
- `packages/server/src/__tests__/system-deps/commands.test.ts` — command wiring tests for `systemDeps.install.*`
- `packages/web/src/features/diagnostics/actions/use-system-dependency-installer.ts` — hook for install start/get/input/cancel, output subscription, and automatic recheck
- `packages/web/src/features/diagnostics/components/system-dependency-install-panel.tsx` — embedded install log panel, password input state, and cancel action

**Modified files:**
- `packages/core/src/domain/diagnostics.ts` — enrich checks with `dependencyId` and install metadata
- `packages/core/src/index.ts` — export the new system dependency domain types
- `packages/core/src/protocol/topics.ts` — add install-output topic helper
- `packages/server/src/commands/diagnostics.ts` — consume runtime status and include base dependency checks in the right contexts
- `packages/server/src/commands/index.ts` — register system dependency commands
- `packages/server/src/server.ts` — construct the system dependency install manager and inject it into command context
- `packages/server/src/ws/dispatch.ts` — extend `CommandContext` with `systemDependencyInstallMgr`
- `packages/server/src/__tests__/diagnostics-commands.test.ts` — cover base runtime diagnostics wiring
- `packages/web/src/features/diagnostics/page.tsx` — render install actions, mount the installer panel, and gate session continuation on missing base dependencies
- `packages/web/src/features/diagnostics/index.test.tsx` — diagnostics page end-to-end behavior for install, password input, success recheck, and non-blocking workspace open
- `packages/web/src/locales/en.json` — install CTA, status, prompt, cancel, and fallback copy
- `packages/web/src/locales/zh.json` — Chinese translations for the same copy
- `packages/web/src/styles/components.css` — diagnostics install panel, log surface, password form, and mobile behavior
- `packages/web/src/styles/components.theme.test.ts` — lock diagnostic install panel onto theme tokens

**Testing commands used in this plan:**
- `pnpm --filter @coder-studio/core exec vitest run src/domain/system-dependency-install.test.ts`
- `pnpm --filter @coder-studio/server exec vitest run src/__tests__/system-deps/runtime-status.test.ts src/__tests__/diagnostics-commands.test.ts`
- `pnpm --filter @coder-studio/server exec vitest run src/__tests__/system-deps/interaction-detector.test.ts src/__tests__/system-deps/install-manager.test.ts src/__tests__/system-deps/commands.test.ts`
- `pnpm --filter @coder-studio/web exec vitest run src/features/diagnostics/index.test.tsx src/styles/components.theme.test.ts`

---

### Task 1: Add The Shared System Dependency Contract

**Files:**
- Create: `packages/core/src/domain/system-dependency-install.ts`
- Create: `packages/core/src/domain/system-dependency-install.test.ts`
- Modify: `packages/core/src/domain/diagnostics.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing shared-domain test**

Add this test to `packages/core/src/domain/system-dependency-install.test.ts`:

```ts
import {
  SYSTEM_DEPENDENCY_IDS,
  SYSTEM_DEPENDENCY_INSTALL_OUTPUT_TOPIC_SCOPE,
  isSystemDependencyId,
} from "./system-dependency-install.js";

describe("system dependency install domain", () => {
  it("exports the supported dependency ids in a stable order", () => {
    expect(SYSTEM_DEPENDENCY_IDS).toEqual(["git", "node"]);
  });

  it("recognizes supported dependency ids only", () => {
    expect(isSystemDependencyId("git")).toBe(true);
    expect(isSystemDependencyId("node")).toBe(true);
    expect(isSystemDependencyId("python")).toBe(false);
  });

  it("keeps the output topic scope stable for websocket subscribers", () => {
    expect(SYSTEM_DEPENDENCY_INSTALL_OUTPUT_TOPIC_SCOPE).toBe("systemDeps.install");
  });
});
```

- [ ] **Step 2: Run the core test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/system-dependency-install.test.ts
```

Expected: FAIL because `system-dependency-install.ts` does not exist yet.

- [ ] **Step 3: Add the shared system dependency types and exports**

Create `packages/core/src/domain/system-dependency-install.ts` with:

```ts
export const SYSTEM_DEPENDENCY_IDS = ["git", "node"] as const;
export const SYSTEM_DEPENDENCY_INSTALL_OUTPUT_TOPIC_SCOPE = "systemDeps.install" as const;

export type SystemDependencyId = (typeof SYSTEM_DEPENDENCY_IDS)[number];
export type SystemDependencyPackageManager =
  | "brew"
  | "apt-get"
  | "dnf"
  | "yum"
  | "pacman"
  | "zypper";

export function isSystemDependencyId(value: string): value is SystemDependencyId {
  return (SYSTEM_DEPENDENCY_IDS as readonly string[]).includes(value);
}

export interface SystemDependencyRuntimeEntry {
  dependencyId: SystemDependencyId;
  available: boolean;
  version?: string;
  autoInstallSupported: boolean;
  installReadiness: "ready" | "unsupported_platform" | "unsupported_package_manager";
  packageManager?: SystemDependencyPackageManager;
  manualGuideKeys: string[];
  docUrl?: string;
}

export interface SystemDependencyRuntimeStatusResponse {
  dependencies: Record<SystemDependencyId, SystemDependencyRuntimeEntry>;
}

export interface SystemDependencyInstallInteraction {
  kind: "none" | "sudo_password" | "confirm";
  promptExcerpt?: string;
  echo: boolean;
}

export interface SystemDependencyInstallStepSnapshot {
  id: string;
  titleKey: string;
  kind: "check" | "install" | "verify";
  command: string;
  args: string[];
  status: "pending" | "running" | "succeeded" | "failed";
  startedAt?: number;
  finishedAt?: number;
  exitCode?: number;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
}

export interface SystemDependencyInstallFailure {
  code:
    | "unsupported_platform"
    | "unsupported_package_manager"
    | "permission_denied"
    | "user_cancelled"
    | "pty_disconnected"
    | "command_not_found"
    | "command_failed"
    | "verification_failed"
    | "unknown_failure";
  dependencyId: SystemDependencyId;
  failedStepId: string;
  message: string;
  command: string;
  args: string[];
  exitCode?: number;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
  packageManager?: SystemDependencyPackageManager;
  manualGuideKeys: string[];
  docUrl?: string;
}

export interface SystemDependencyInstallJobSnapshot {
  jobId: string;
  dependencyId: SystemDependencyId;
  status: "queued" | "running" | "waiting_input" | "succeeded" | "failed" | "cancelled";
  packageManager?: SystemDependencyPackageManager;
  currentStepId?: string;
  steps: SystemDependencyInstallStepSnapshot[];
  interaction: SystemDependencyInstallInteraction;
  failure?: SystemDependencyInstallFailure;
}

export interface SystemDependencyInstallOutputChunk {
  jobId: string;
  chunk: string;
  seq: number;
}
```

Update `packages/core/src/domain/diagnostics.ts` to import `SystemDependencyId` and extend `DiagnosticsCheck`:

```ts
import type { SystemDependencyId } from "./system-dependency-install";

export interface DiagnosticsCheck {
  id: string;
  code: DiagnosticsCheckCode;
  status: DiagnosticsCheckStatus;
  workspaceId?: string;
  workspacePath?: string;
  providerId?: string;
  dependencyId?: SystemDependencyId;
  autoInstallSupported?: boolean;
  installReadiness?:
    | "ready"
    | "missing_prerequisite"
    | "unsupported_platform"
    | "unsupported_package_manager";
  missingCommands?: string[];
  missingPrerequisites?: string[];
  manualGuideKeys?: string[];
  docUrl?: string;
  version?: string;
}
```

Update `packages/core/src/index.ts` to export:

```ts
export * from "./domain/system-dependency-install";
```

- [ ] **Step 4: Run the core test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/system-dependency-install.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the shared contract**

```bash
git add packages/core/src/domain/system-dependency-install.ts \
  packages/core/src/domain/system-dependency-install.test.ts \
  packages/core/src/domain/diagnostics.ts \
  packages/core/src/index.ts
git commit -m "feat(core): add system dependency install contracts"
```

### Task 2: Build Runtime Status Detection And Diagnostics Wiring

**Files:**
- Create: `packages/server/src/system-deps/definitions.ts`
- Create: `packages/server/src/system-deps/runtime-status.ts`
- Create: `packages/server/src/__tests__/system-deps/runtime-status.test.ts`
- Modify: `packages/server/src/commands/diagnostics.ts`
- Modify: `packages/server/src/__tests__/diagnostics-commands.test.ts`

- [ ] **Step 1: Write the failing server runtime-status and diagnostics tests**

Add this to `packages/server/src/__tests__/system-deps/runtime-status.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildSystemDependencyRuntimeStatus } from "../../system-deps/runtime-status.js";

describe("buildSystemDependencyRuntimeStatus", () => {
  it("marks git installable on macOS when brew exists but git is missing", async () => {
    const runCommand = vi.fn(async (file: string) => {
      if (file === "git") {
        throw Object.assign(new Error("missing git"), { exitCode: 127, stdout: "", stderr: "" });
      }
      if (file === "node") {
        return { stdout: "v24.1.0\n", stderr: "" };
      }
      throw new Error(`unexpected command: ${file}`);
    });

    const status = await buildSystemDependencyRuntimeStatus({
      platform: "darwin",
      commandExists: vi.fn(async (command: string) => command === "brew"),
      runCommand,
    });

    expect(status.dependencies.git).toMatchObject({
      dependencyId: "git",
      available: false,
      autoInstallSupported: true,
      installReadiness: "ready",
      packageManager: "brew",
    });
    expect(status.dependencies.node).toMatchObject({
      available: true,
      version: "v24.1.0",
    });
  });

  it("reports unsupported_package_manager when Linux has neither apt nor brew", async () => {
    const status = await buildSystemDependencyRuntimeStatus({
      platform: "linux",
      commandExists: vi.fn(async () => false),
      runCommand: vi.fn(async () => {
        throw Object.assign(new Error("missing"), { exitCode: 127, stdout: "", stderr: "" });
      }),
    });

    expect(status.dependencies.git.installReadiness).toBe("unsupported_package_manager");
    expect(status.dependencies.node.autoInstallSupported).toBe(false);
  });
});
```

Add this to `packages/server/src/__tests__/diagnostics-commands.test.ts`:

```ts
  it("blocks session start when node is missing but keeps workspace-open non-blocking", async () => {
    const nodeMissingContext = createContext({
      providerRuntimeDeps: {
        commandExists: async (command: string) => command === "brew" || command === "claude",
        runCommand: async (file: string) => {
          if (file === "git") return { stdout: "git version 2.49.0\n", stderr: "" };
          if (file === "node") throw Object.assign(new Error("missing node"), { exitCode: 127 });
          return { stdout: "", stderr: "" };
        },
        platform: "darwin",
      },
    });

    const sessionResult = await dispatch(
      {
        kind: "command",
        id: "diag-session-node-missing",
        op: "diagnostics.get",
        args: { context: "session_start", workspaceId: "ws-1", providerId: "claude" },
      },
      nodeMissingContext
    );

    expect(sessionResult.ok).toBe(true);
    expect(sessionResult.data).toMatchObject({ context: "session_start", canContinue: false });
    expect((sessionResult.data as { checks: Array<{ code: string }> }).checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "nodejs_missing" })])
    );

    const workspaceResult = await dispatch(
      {
        kind: "command",
        id: "diag-workspace-node-missing",
        op: "diagnostics.get",
        args: { context: "workspace_open", workspacePath: "/tmp/project" },
      },
      nodeMissingContext
    );

    expect(workspaceResult.ok).toBe(true);
    expect(workspaceResult.data).toMatchObject({ context: "workspace_open", canContinue: true });
  });
```

- [ ] **Step 2: Run the server diagnostics tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/__tests__/system-deps/runtime-status.test.ts \
  src/__tests__/diagnostics-commands.test.ts
```

Expected: FAIL because `system-deps/runtime-status.ts` and the new diagnostics behavior do not exist yet.

- [ ] **Step 3: Implement runtime status detection and reuse it from diagnostics**

Create `packages/server/src/system-deps/definitions.ts`:

```ts
import type { SystemDependencyId, SystemDependencyPackageManager } from "@coder-studio/core";

export interface SystemDependencyDefinition {
  dependencyId: SystemDependencyId;
  versionCommand: { file: string; args: string[] };
  docsUrl: string;
  manualGuideKeys: string[];
}

export const SYSTEM_DEPENDENCY_DEFINITIONS: Record<SystemDependencyId, SystemDependencyDefinition> =
  {
    git: {
      dependencyId: "git",
      versionCommand: { file: "git", args: ["--version"] },
      docsUrl: "https://git-scm.com/downloads",
      manualGuideKeys: ["system_deps.install.git.manual"],
    },
    node: {
      dependencyId: "node",
      versionCommand: { file: "node", args: ["--version"] },
      docsUrl: "https://nodejs.org/en/download",
      manualGuideKeys: ["system_deps.install.node.manual"],
    },
  };

export const PACKAGE_MANAGER_ORDER: Partial<Record<NodeJS.Platform, SystemDependencyPackageManager[]>> =
  {
    darwin: ["brew"],
    linux: ["apt-get", "dnf", "yum", "pacman", "zypper"],
  };
```

Create `packages/server/src/system-deps/runtime-status.ts`:

```ts
import type {
  SystemDependencyId,
  SystemDependencyRuntimeEntry,
  SystemDependencyRuntimeStatusResponse,
} from "@coder-studio/core";
import type { RuntimeStatusDeps } from "../provider-runtime/runtime-status.js";
import { runCommandAsString } from "../provider-runtime/command-runner.js";
import { SYSTEM_DEPENDENCY_DEFINITIONS, PACKAGE_MANAGER_ORDER } from "./definitions.js";

async function readVersion(
  dependencyId: SystemDependencyId,
  deps: RuntimeStatusDeps
): Promise<string | undefined> {
  const definition = SYSTEM_DEPENDENCY_DEFINITIONS[dependencyId];
  const runner = deps.runCommand ?? runCommandAsString;

  try {
    const { stdout } = await runner(definition.versionCommand.file, definition.versionCommand.args, {
      windowsHide: true,
    });
    const version = stdout.trim();
    return version.length > 0 ? version : undefined;
  } catch {
    return undefined;
  }
}

async function detectPackageManager(deps: RuntimeStatusDeps) {
  const platform = deps.platform ?? process.platform;
  const candidates = PACKAGE_MANAGER_ORDER[platform] ?? [];
  const commandExists = deps.commandExists ?? (async () => false);

  for (const candidate of candidates) {
    if (await commandExists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export async function buildSystemDependencyRuntimeStatus(
  deps: RuntimeStatusDeps = {}
): Promise<SystemDependencyRuntimeStatusResponse> {
  const platform = deps.platform ?? process.platform;
  const packageManager = await detectPackageManager(deps);
  const dependencies = {} as Record<SystemDependencyId, SystemDependencyRuntimeEntry>;

  for (const dependencyId of ["git", "node"] as const) {
    const definition = SYSTEM_DEPENDENCY_DEFINITIONS[dependencyId];
    const version = await readVersion(dependencyId, deps);
    const available = Boolean(version);

    dependencies[dependencyId] = {
      dependencyId,
      available,
      version,
      autoInstallSupported: !available && Boolean(packageManager),
      installReadiness: available
        ? "ready"
        : packageManager
          ? "ready"
          : platform === "darwin" || platform === "linux"
            ? "unsupported_package_manager"
            : "unsupported_platform",
      packageManager,
      manualGuideKeys: definition.manualGuideKeys,
      docUrl: definition.docsUrl,
    };
  }

  return { dependencies };
}
```

Update `packages/server/src/commands/diagnostics.ts` so `buildBaseRuntimeChecks()` maps from the new runtime status and the contexts wire it like this:

```ts
async function buildBaseRuntimeChecks(
  ctx: CommandContext
): Promise<{ canContinue: boolean; checks: DiagnosticsCheck[] }> {
  const runtime = await buildSystemDependencyRuntimeStatus(ctx.providerRuntimeDeps);
  const git = runtime.dependencies.git;
  const node = runtime.dependencies.node;

  return {
    canContinue: git.available && node.available,
    checks: [
      {
        id: "runtime:git",
        code: git.available ? "git_ready" : "git_missing",
        status: git.available ? "ready" : "needs_attention",
        dependencyId: "git",
        autoInstallSupported: git.autoInstallSupported,
        installReadiness: git.installReadiness,
        manualGuideKeys: git.manualGuideKeys,
        docUrl: git.docUrl,
        version: git.version,
      },
      {
        id: "runtime:nodejs",
        code: node.available ? "nodejs_ready" : "nodejs_missing",
        status: node.available ? "ready" : "needs_attention",
        dependencyId: "node",
        autoInstallSupported: node.autoInstallSupported,
        installReadiness: node.installReadiness,
        manualGuideKeys: node.manualGuideKeys,
        docUrl: node.docUrl,
        version: node.version,
      },
    ],
  };
}
```

Then update the context builders:

```ts
// session_start
const baseRuntime = await buildBaseRuntimeChecks(ctx);
const checks = [
  ...workspaceSelection.checks,
  ...baseRuntime.checks,
  ...providerChecks.checks,
  buildServerAuthCheck(ctx),
  mobileHost.check,
];
const canContinue =
  workspaceSelection.canContinue &&
  baseRuntime.canContinue &&
  providerChecks.canContinueForPreferredProvider;

// workspace_open
const baseRuntime = await buildBaseRuntimeChecks(ctx);
checks: [
  ...workspaceSelection.checks,
  ...baseRuntime.checks,
  ...providerChecks.checks,
  buildServerAuthCheck(ctx),
  mobileHost.check,
]

// mobile_continue
// no baseRuntime injection
```

- [ ] **Step 4: Run the server diagnostics tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/__tests__/system-deps/runtime-status.test.ts \
  src/__tests__/diagnostics-commands.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit runtime status and diagnostics wiring**

```bash
git add packages/server/src/system-deps/definitions.ts \
  packages/server/src/system-deps/runtime-status.ts \
  packages/server/src/__tests__/system-deps/runtime-status.test.ts \
  packages/server/src/commands/diagnostics.ts \
  packages/server/src/__tests__/diagnostics-commands.test.ts
git commit -m "feat(server): add system dependency runtime diagnostics"
```

### Task 3: Implement PTY-Backed Install Jobs And Prompt Detection

**Files:**
- Create: `packages/server/src/system-deps/interaction-detector.ts`
- Create: `packages/server/src/system-deps/install-manager.ts`
- Create: `packages/server/src/__tests__/system-deps/interaction-detector.test.ts`
- Create: `packages/server/src/__tests__/system-deps/install-manager.test.ts`

- [ ] **Step 1: Write the failing interaction detector and install manager tests**

Add this to `packages/server/src/__tests__/system-deps/interaction-detector.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectSystemDependencyInteraction } from "../../system-deps/interaction-detector.js";

describe("detectSystemDependencyInteraction", () => {
  it("detects sudo password prompts without enabling echo", () => {
    expect(detectSystemDependencyInteraction("[sudo] password for spencer:")).toEqual({
      kind: "sudo_password",
      promptExcerpt: "[sudo] password for spencer:",
      echo: false,
    });
  });

  it("detects confirmation prompts", () => {
    expect(detectSystemDependencyInteraction("Proceed? [Y/n]")).toEqual({
      kind: "confirm",
      promptExcerpt: "Proceed? [Y/n]",
      echo: true,
    });
  });

  it("returns none when output is not interactive", () => {
    expect(detectSystemDependencyInteraction("installed git")).toEqual({
      kind: "none",
      echo: false,
    });
  });
});
```

Add this to `packages/server/src/__tests__/system-deps/install-manager.test.ts`:

```ts
import { Topics } from "@coder-studio/core";
import { describe, expect, it, vi } from "vitest";
import { SystemDependencyInstallManager } from "../../system-deps/install-manager.js";

function createFakePtyHost() {
  let onData: ((data: string) => void) | undefined;
  let onExit: ((event: { exitCode: number }) => void) | undefined;
  const writes: string[] = [];

  return {
    writes,
    host: {
      spawn: vi.fn(() => ({
        onData: (cb: (data: string) => void) => {
          onData = cb;
        },
        onExit: (cb: (event: { exitCode: number }) => void) => {
          onExit = cb;
        },
        write: (data: string | Buffer) => {
          writes.push(Buffer.isBuffer(data) ? data.toString("utf8") : data);
        },
        resize: () => {},
        kill: async () => {
          onExit?.({ exitCode: 130 });
        },
      })),
    },
    emitData: (data: string) => onData?.(data),
    emitExit: (exitCode = 0) => onExit?.({ exitCode }),
  };
}

describe("SystemDependencyInstallManager", () => {
  it("reuses the active job, broadcasts output, waits for password input, and verifies success", async () => {
    const pty = createFakePtyHost();
    const broadcast = vi.fn();
    let gitInstalled = false;
    const manager = new SystemDependencyInstallManager({
      platform: "linux",
      ptyHost: pty.host,
      broadcaster: { broadcast } as never,
      commandExists: vi.fn(async (command: string) => command === "apt-get"),
      runCommand: vi.fn(async (file: string) => {
        if (file === "git") {
          if (!gitInstalled) {
            throw Object.assign(new Error("missing"), { exitCode: 127, stdout: "", stderr: "" });
          }
          return { stdout: "git version 2.49.0\n", stderr: "" };
        }
        throw Object.assign(new Error("missing"), { exitCode: 127, stdout: "", stderr: "" });
      }),
    });

    const first = await manager.start("git");
    const second = await manager.start("git");

    expect(second.jobId).toBe(first.jobId);

    pty.emitData("[sudo] password for spencer:");

    await vi.waitFor(() => {
      expect(manager.get(first.jobId)?.status).toBe("waiting_input");
    });

    await manager.submitInput(first.jobId, "hunter2\n");
    expect(pty.writes.at(-1)).toBe("hunter2\n");

    gitInstalled = true;
    pty.emitData("installed git\n");
    pty.emitExit(0);

    await vi.waitFor(() => {
      expect(manager.get(first.jobId)?.status).toBe("succeeded");
    });

    expect(broadcast).toHaveBeenCalledWith(
      Topics.systemDependencyInstallOutput(first.jobId),
      expect.objectContaining({ jobId: first.jobId, chunk: "installed git\n" })
    );
  });

  it("marks a cancelled job when the user aborts the install", async () => {
    const pty = createFakePtyHost();
    const manager = new SystemDependencyInstallManager({
      platform: "linux",
      ptyHost: pty.host,
      broadcaster: { broadcast: vi.fn() } as never,
      commandExists: vi.fn(async (command: string) => command === "apt-get"),
      runCommand: vi.fn(async () => {
        throw Object.assign(new Error("missing"), { exitCode: 127, stdout: "", stderr: "" });
      }),
    });

    const job = await manager.start("git");
    await manager.cancel(job.jobId);

    expect(manager.get(job.jobId)).toMatchObject({
      status: "cancelled",
      failure: { code: "user_cancelled" },
    });
  });
});
```

- [ ] **Step 2: Run the install-manager tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/__tests__/system-deps/interaction-detector.test.ts \
  src/__tests__/system-deps/install-manager.test.ts
```

Expected: FAIL because the detector and install manager do not exist yet.

- [ ] **Step 3: Implement prompt detection and the PTY-backed install manager**

Create `packages/server/src/system-deps/interaction-detector.ts`:

```ts
import type { SystemDependencyInstallInteraction } from "@coder-studio/core";

const SUDO_PASSWORD_PATTERNS = [/\[sudo\] password for .*:$/i, /^password:$/i];
const CONFIRM_PATTERNS = [/proceed\?\s*\[y\/n\]/i, /continue\?\s*\[y\/n\]/i];

export function detectSystemDependencyInteraction(
  chunk: string
): SystemDependencyInstallInteraction {
  const trimmed = chunk.trim();

  if (SUDO_PASSWORD_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return {
      kind: "sudo_password",
      promptExcerpt: trimmed,
      echo: false,
    };
  }

  if (CONFIRM_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return {
      kind: "confirm",
      promptExcerpt: trimmed,
      echo: true,
    };
  }

  return {
    kind: "none",
    echo: false,
  };
}
```

Create `packages/server/src/system-deps/install-manager.ts` with the core pieces below:

```ts
import { randomUUID } from "node:crypto";
import { Topics, type SystemDependencyId, type SystemDependencyInstallJobSnapshot } from "@coder-studio/core";
import type { Broadcaster } from "../ws/hub.js";
import type { PtyHost, PtyProcess } from "../terminal/types.js";
import type { RuntimeStatusDeps } from "../provider-runtime/runtime-status.js";
import { SYSTEM_DEPENDENCY_DEFINITIONS } from "./definitions.js";
import { buildSystemDependencyRuntimeStatus } from "./runtime-status.js";
import { detectSystemDependencyInteraction } from "./interaction-detector.js";

interface InstallSession {
  process: PtyProcess;
  seq: number;
}

export interface SystemDependencyInstallManagerDeps extends RuntimeStatusDeps {
  ptyHost: PtyHost;
  broadcaster: Pick<Broadcaster, "broadcast">;
}

export class SystemDependencyInstallManager {
  private readonly jobs = new Map<string, SystemDependencyInstallJobSnapshot>();
  private readonly activeJobIdsByDependencyId = new Map<SystemDependencyId, string>();
  private readonly sessions = new Map<string, InstallSession>();

  constructor(private readonly deps: SystemDependencyInstallManagerDeps) {}

  async start(dependencyId: SystemDependencyId): Promise<SystemDependencyInstallJobSnapshot> {
    const activeJobId = this.activeJobIdsByDependencyId.get(dependencyId);
    if (activeJobId) {
      return structuredClone(this.jobs.get(activeJobId)!);
    }

    const runtime = await buildSystemDependencyRuntimeStatus(this.deps);
    const entry = runtime.dependencies[dependencyId];
    if (entry.available) {
      const readyJob: SystemDependencyInstallJobSnapshot = {
        jobId: randomUUID(),
        dependencyId,
        status: "succeeded",
        packageManager: entry.packageManager,
        currentStepId: undefined,
        steps: [],
        interaction: { kind: "none", echo: false },
      };
      this.jobs.set(readyJob.jobId, readyJob);
      return structuredClone(readyJob);
    }

    if (!entry.autoInstallSupported || !entry.packageManager) {
      const failedJob: SystemDependencyInstallJobSnapshot = {
        jobId: randomUUID(),
        dependencyId,
        status: "failed",
        packageManager: entry.packageManager,
        currentStepId: `install-${dependencyId}`,
        steps: [
          {
            id: `install-${dependencyId}`,
            titleKey: `system_deps.install.step.install.${dependencyId}`,
            kind: "install",
            command: entry.packageManager ?? dependencyId,
            args: [],
            status: "failed",
          },
        ],
        interaction: { kind: "none", echo: false },
        failure: {
          code:
            entry.installReadiness === "unsupported_platform"
              ? "unsupported_platform"
              : "unsupported_package_manager",
          dependencyId,
          failedStepId: `install-${dependencyId}`,
          message: `Cannot auto-install ${dependencyId}`,
          command: entry.packageManager ?? dependencyId,
          args: [],
          packageManager: entry.packageManager,
          manualGuideKeys: entry.manualGuideKeys,
          docUrl: entry.docUrl,
        },
      };
      this.jobs.set(failedJob.jobId, failedJob);
      return structuredClone(failedJob);
    }

    return this.spawnInstallJob(dependencyId, entry.packageManager);
  }

  async submitInput(jobId: string, text: string): Promise<SystemDependencyInstallJobSnapshot> {
    const job = this.jobs.get(jobId);
    const session = this.sessions.get(jobId);
    if (!job || !session) {
      throw { code: "system_dependency_install_job_not_found", message: `Install job not found: ${jobId}` };
    }

    job.status = "running";
    job.interaction = { kind: "none", echo: false };
    session.process.write(text);
    return structuredClone(job);
  }

  async cancel(jobId: string): Promise<SystemDependencyInstallJobSnapshot> {
    const job = this.jobs.get(jobId);
    const session = this.sessions.get(jobId);
    if (!job) {
      throw { code: "system_dependency_install_job_not_found", message: `Install job not found: ${jobId}` };
    }

    if (session) {
      await session.process.kill("SIGTERM");
      this.sessions.delete(jobId);
    }

    job.status = "cancelled";
    job.interaction = { kind: "none", echo: false };
    job.failure = {
      code: "user_cancelled",
      dependencyId: job.dependencyId,
      failedStepId: job.currentStepId ?? `install-${job.dependencyId}`,
      message: `Install cancelled for ${job.dependencyId}`,
      command: job.steps.find((step) => step.id === job.currentStepId)?.command ?? job.dependencyId,
      args: job.steps.find((step) => step.id === job.currentStepId)?.args ?? [],
      packageManager: job.packageManager,
      manualGuideKeys: SYSTEM_DEPENDENCY_DEFINITIONS[job.dependencyId].manualGuideKeys,
      docUrl: SYSTEM_DEPENDENCY_DEFINITIONS[job.dependencyId].docsUrl,
    };
    this.activeJobIdsByDependencyId.delete(job.dependencyId);
    return structuredClone(job);
  }
}
```

Inside the same file, add a private `spawnInstallJob()` that:

```ts
  private async spawnInstallJob(
    dependencyId: SystemDependencyId,
    packageManager: NonNullable<SystemDependencyInstallJobSnapshot["packageManager"]>
  ): Promise<SystemDependencyInstallJobSnapshot> {
    const command =
      packageManager === "brew"
        ? `brew install ${dependencyId === "git" ? "git" : "node"}`
        : packageManager === "apt-get"
          ? dependencyId === "git"
            ? "sudo apt-get update && sudo apt-get install -y git"
            : "sudo apt-get update && sudo apt-get install -y nodejs npm"
          : packageManager === "dnf"
            ? `sudo dnf install -y ${dependencyId === "git" ? "git" : "nodejs"}`
            : packageManager === "yum"
              ? `sudo yum install -y ${dependencyId === "git" ? "git" : "nodejs"}`
              : packageManager === "pacman"
                ? `sudo pacman -Sy --noconfirm ${dependencyId === "git" ? "git" : "nodejs npm"}`
                : `sudo zypper --non-interactive install ${dependencyId === "git" ? "git" : "nodejs"}`;

    const process = this.deps.ptyHost.spawn(["/bin/sh", "-lc", command], {
      cwd: process.cwd(),
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] != null)
        ),
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        FORCE_COLOR: "3",
      },
      cols: 120,
      rows: 30,
    });

    const job: SystemDependencyInstallJobSnapshot = {
      jobId: randomUUID(),
      dependencyId,
      status: "running",
      packageManager,
      currentStepId: `install-${dependencyId}`,
      steps: [
        {
          id: `install-${dependencyId}`,
          titleKey: `system_deps.install.step.install.${dependencyId}`,
          kind: "install",
          command: "/bin/sh",
          args: ["-lc", command],
          status: "running",
          startedAt: Date.now(),
        },
        {
          id: `verify-${dependencyId}`,
          titleKey: `system_deps.install.step.verify.${dependencyId}`,
          kind: "verify",
          command: SYSTEM_DEPENDENCY_DEFINITIONS[dependencyId].versionCommand.file,
          args: SYSTEM_DEPENDENCY_DEFINITIONS[dependencyId].versionCommand.args,
          status: "pending",
        },
      ],
      interaction: { kind: "none", echo: false },
    };

    this.jobs.set(job.jobId, job);
    this.activeJobIdsByDependencyId.set(dependencyId, job.jobId);
    this.sessions.set(job.jobId, { process, seq: 0 });

    process.onData((chunk) => this.handleOutput(job.jobId, chunk));
    process.onExit(({ exitCode }) => {
      void this.handleExit(job.jobId, exitCode);
    });

    return structuredClone(job);
  }
```

Also add `handleOutput()` and `handleExit()`:

```ts
  private handleOutput(jobId: string, chunk: string): void {
    const job = this.jobs.get(jobId);
    const session = this.sessions.get(jobId);
    if (!job || !session) return;

    session.seq += 1;
    this.deps.broadcaster.broadcast(Topics.systemDependencyInstallOutput(jobId), {
      jobId,
      chunk,
      seq: session.seq,
    });

    const interaction = detectSystemDependencyInteraction(chunk);
    if (interaction.kind !== "none") {
      job.status = "waiting_input";
      job.interaction = interaction;
    }

    const installStep = job.steps[0];
    if (installStep) {
      installStep.stdoutExcerpt = chunk.slice(-400);
    }
  }

  private async handleExit(jobId: string, exitCode: number): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const installStep = job.steps[0];
    if (installStep) {
      installStep.finishedAt = Date.now();
      installStep.exitCode = exitCode;
      installStep.status = exitCode === 0 ? "succeeded" : "failed";
    }

    this.sessions.delete(jobId);

    if (job.status === "cancelled") {
      this.activeJobIdsByDependencyId.delete(job.dependencyId);
      return;
    }

    if (exitCode !== 0) {
      job.status = "failed";
      job.interaction = { kind: "none", echo: false };
      job.failure = {
        code: "command_failed",
        dependencyId: job.dependencyId,
        failedStepId: installStep?.id ?? `install-${job.dependencyId}`,
        message: `Install failed for ${job.dependencyId}`,
        command: installStep?.command ?? "/bin/sh",
        args: installStep?.args ?? [],
        exitCode,
        packageManager: job.packageManager,
        manualGuideKeys: SYSTEM_DEPENDENCY_DEFINITIONS[job.dependencyId].manualGuideKeys,
        docUrl: SYSTEM_DEPENDENCY_DEFINITIONS[job.dependencyId].docsUrl,
      };
      this.activeJobIdsByDependencyId.delete(job.dependencyId);
      return;
    }

    const runtime = await buildSystemDependencyRuntimeStatus(this.deps);
    const entry = runtime.dependencies[job.dependencyId];
    const verifyStep = job.steps[1];
    if (verifyStep) {
      verifyStep.status = entry.available ? "succeeded" : "failed";
      verifyStep.startedAt = Date.now();
      verifyStep.finishedAt = Date.now();
      verifyStep.stdoutExcerpt = entry.version;
    }

    if (!entry.available) {
      job.status = "failed";
      job.failure = {
        code: "verification_failed",
        dependencyId: job.dependencyId,
        failedStepId: verifyStep?.id ?? `verify-${job.dependencyId}`,
        message: `Verification failed for ${job.dependencyId}`,
        command: verifyStep?.command ?? job.dependencyId,
        args: verifyStep?.args ?? [],
        packageManager: job.packageManager,
        manualGuideKeys: entry.manualGuideKeys,
        docUrl: entry.docUrl,
      };
      this.activeJobIdsByDependencyId.delete(job.dependencyId);
      return;
    }

    job.status = "succeeded";
    job.interaction = { kind: "none", echo: false };
    this.activeJobIdsByDependencyId.delete(job.dependencyId);
  }
```

- [ ] **Step 4: Run the install-manager tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/__tests__/system-deps/interaction-detector.test.ts \
  src/__tests__/system-deps/install-manager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the install manager**

```bash
git add packages/server/src/system-deps/interaction-detector.ts \
  packages/server/src/system-deps/install-manager.ts \
  packages/server/src/__tests__/system-deps/interaction-detector.test.ts \
  packages/server/src/__tests__/system-deps/install-manager.test.ts
git commit -m "feat(server): add interactive system dependency installer"
```

### Task 4: Wire Commands, Topics, And Server Bootstrap

**Files:**
- Create: `packages/server/src/commands/system-deps.ts`
- Create: `packages/server/src/__tests__/system-deps/commands.test.ts`
- Modify: `packages/core/src/protocol/topics.ts`
- Modify: `packages/server/src/commands/index.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/ws/dispatch.ts`

- [ ] **Step 1: Write the failing command and topic tests**

Add this to `packages/server/src/__tests__/system-deps/commands.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../../ws/dispatch.js";
import { dispatch } from "../../ws/dispatch.js";

import "../../commands/system-deps.js";

function createContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    workspaceMgr: {} as never,
    sessionMgr: {} as never,
    terminalMgr: {} as never,
    eventBus: {} as never,
    broadcaster: { broadcast: vi.fn(), sendToClient: () => true, sendBinaryToClient: () => true } as never,
    settingsRepo: {} as never,
    providerConfigRepo: {} as never,
    providerRegistry: [],
    fencingMgr: {} as never,
    supervisorMgr: {} as never,
    autoFetch: {} as never,
    activationMgr: {} as never,
    lspMgr: {} as never,
    providerRuntimeDeps: {
      platform: "darwin",
      commandExists: vi.fn(async (command: string) => command === "brew"),
      runCommand: vi.fn(async (file: string) => {
        if (file === "git") return { stdout: "git version 2.49.0\n", stderr: "" };
        if (file === "node") throw Object.assign(new Error("missing node"), { exitCode: 127, stdout: "", stderr: "" });
        return { stdout: "", stderr: "" };
      }),
    },
    ...overrides,
  };
}

describe("system deps commands", () => {
  it("returns runtime status through systemDeps.runtimeStatus", async () => {
    const result = await dispatch(
      { kind: "command", id: "sysdeps-status", op: "systemDeps.runtimeStatus", args: {} },
      createContext()
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      dependencies: {
        git: { available: true },
        node: { available: false, autoInstallSupported: true },
      },
    });
  });

  it("returns install lifecycle errors when the manager is missing or the job id is unknown", async () => {
    const unavailable = await dispatch(
      {
        kind: "command",
        id: "sysdeps-start-missing",
        op: "systemDeps.install.start",
        args: { dependencyId: "git" },
      },
      createContext()
    );
    expect(unavailable.ok).toBe(false);
    expect(unavailable.error?.code).toBe("system_dependency_install_unavailable");

    const contextWithManager = createContext({
      systemDependencyInstallMgr: {
        start: vi.fn(async () => ({ jobId: "job-1", dependencyId: "git", status: "queued", steps: [], interaction: { kind: "none", echo: false } })),
        get: vi.fn(() => undefined),
        submitInput: vi.fn(),
        cancel: vi.fn(),
      } as never,
    });

    const missingJob = await dispatch(
      {
        kind: "command",
        id: "sysdeps-get-missing",
        op: "systemDeps.install.get",
        args: { jobId: "missing-job" },
      },
      contextWithManager
    );
    expect(missingJob.ok).toBe(false);
    expect(missingJob.error?.code).toBe("system_dependency_install_job_not_found");
  });
});
```

Add this to `packages/core/src/protocol/topics.ts`:

```ts
  systemDependencyInstallOutput: (jobId: string) => `systemDeps.install.${jobId}.output`,
```

- [ ] **Step 2: Run the command tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/system-deps/commands.test.ts
```

Expected: FAIL because the command module, context field, and new topic do not exist yet.

- [ ] **Step 3: Add command handlers and bootstrap wiring**

Update `packages/server/src/ws/dispatch.ts`:

```ts
import type { SystemDependencyInstallManager } from "../system-deps/install-manager.js";

export interface CommandContext {
  // existing fields...
  systemDependencyInstallMgr?: SystemDependencyInstallManager;
}
```

Create `packages/server/src/commands/system-deps.ts`:

```ts
import type {
  SystemDependencyInstallJobSnapshot,
  SystemDependencyRuntimeStatusResponse,
} from "@coder-studio/core";
import { z } from "zod";
import { buildSystemDependencyRuntimeStatus } from "../system-deps/runtime-status.js";
import { registerCommand } from "../ws/dispatch.js";

registerCommand("systemDeps.runtimeStatus", z.object({}), async (_args, ctx) => {
  return buildSystemDependencyRuntimeStatus(ctx.providerRuntimeDeps);
});

registerCommand(
  "systemDeps.install.start",
  z.object({ dependencyId: z.enum(["git", "node"]) }),
  async (args, ctx) => {
    if (!ctx.systemDependencyInstallMgr) {
      throw {
        code: "system_dependency_install_unavailable",
        message: "System dependency install manager not configured",
      };
    }
    return ctx.systemDependencyInstallMgr.start(args.dependencyId);
  }
);

registerCommand(
  "systemDeps.install.get",
  z.object({ jobId: z.string() }),
  async (args, ctx): Promise<SystemDependencyInstallJobSnapshot> => {
    if (!ctx.systemDependencyInstallMgr) {
      throw {
        code: "system_dependency_install_unavailable",
        message: "System dependency install manager not configured",
      };
    }
    const job = ctx.systemDependencyInstallMgr.get(args.jobId);
    if (!job) {
      throw {
        code: "system_dependency_install_job_not_found",
        message: `Install job not found: ${args.jobId}`,
      };
    }
    return job;
  }
);

registerCommand(
  "systemDeps.install.input",
  z.object({ jobId: z.string(), text: z.string() }),
  async (args, ctx) => {
    if (!ctx.systemDependencyInstallMgr) {
      throw {
        code: "system_dependency_install_unavailable",
        message: "System dependency install manager not configured",
      };
    }
    return ctx.systemDependencyInstallMgr.submitInput(args.jobId, args.text);
  }
);

registerCommand(
  "systemDeps.install.cancel",
  z.object({ jobId: z.string() }),
  async (args, ctx) => {
    if (!ctx.systemDependencyInstallMgr) {
      throw {
        code: "system_dependency_install_unavailable",
        message: "System dependency install manager not configured",
      };
    }
    return ctx.systemDependencyInstallMgr.cancel(args.jobId);
  }
);
```

Update `packages/server/src/commands/index.ts`:

```ts
import "./system-deps.js";
```

Update `packages/server/src/server.ts` to construct and inject the new manager:

```ts
import { SystemDependencyInstallManager } from "./system-deps/install-manager.js";

const systemDependencyInstallMgr = new SystemDependencyInstallManager({
  ...providerRuntimeDeps,
  runCommand: providerMockOverrides?.runCommand ?? runCommandAsString,
  ptyHost: createPtyHost(),
  broadcaster: wsHub,
});

commandContext = {
  // existing fields...
  systemDependencyInstallMgr,
};
```

Add `get()` to the install manager if it is not already present:

```ts
  get(jobId: string): SystemDependencyInstallJobSnapshot | undefined {
    const job = this.jobs.get(jobId);
    return job ? structuredClone(job) : undefined;
  }
```

- [ ] **Step 4: Run the command tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/__tests__/system-deps/commands.test.ts \
  src/__tests__/system-deps/install-manager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit command and server wiring**

```bash
git add packages/server/src/commands/system-deps.ts \
  packages/server/src/__tests__/system-deps/commands.test.ts \
  packages/core/src/protocol/topics.ts \
  packages/server/src/commands/index.ts \
  packages/server/src/server.ts \
  packages/server/src/ws/dispatch.ts \
  packages/server/src/system-deps/install-manager.ts
git commit -m "feat(server): wire system dependency install commands"
```

### Task 5: Add Diagnostics Installer Hook And Embedded Install Panel

**Files:**
- Create: `packages/web/src/features/diagnostics/actions/use-system-dependency-installer.ts`
- Create: `packages/web/src/features/diagnostics/components/system-dependency-install-panel.tsx`
- Modify: `packages/web/src/features/diagnostics/page.tsx`
- Modify: `packages/web/src/features/diagnostics/index.test.tsx`

- [ ] **Step 1: Write the failing diagnostics page behavior tests**

Add these tests to `packages/web/src/features/diagnostics/index.test.tsx`:

```tsx
  it("installs a missing git dependency inline, accepts a sudo password, and rechecks on success", async () => {
    let diagnosticsCallCount = 0;
    let subscriptionHandler: ((topic: string, payload: unknown) => void) | undefined;
    const sendCommand = vi.fn(async (op: string, args?: Record<string, unknown>) => {
      if (op === "diagnostics.get") {
        diagnosticsCallCount += 1;
        if (diagnosticsCallCount === 1) {
          return createResponse(
            { context: "manual_check", canContinue: false },
            [
              {
                id: "git-missing",
                code: "git_missing",
                status: "needs_attention",
                dependencyId: "git",
                autoInstallSupported: true,
                installReadiness: "ready",
                manualGuideKeys: ["system_deps.install.git.manual"],
                docUrl: "https://git-scm.com/downloads",
              },
            ] as DiagnosticsCheck[]
          );
        }

        return createResponse(
          { context: "manual_check", canContinue: true },
          [
            {
              id: "git-ready",
              code: "git_ready",
              status: "ready",
              dependencyId: "git",
              version: "git version 2.49.0",
            },
          ] as DiagnosticsCheck[]
        );
      }

      if (op === "systemDeps.install.start") {
        expect(args).toEqual({ dependencyId: "git" });
        return {
          jobId: "job-1",
          dependencyId: "git",
          status: "waiting_input",
          packageManager: "apt-get",
          currentStepId: "install-git",
          steps: [],
          interaction: {
            kind: "sudo_password",
            promptExcerpt: "[sudo] password for spencer:",
            echo: false,
          },
        };
      }

      if (op === "systemDeps.install.input") {
        expect(args).toEqual({ jobId: "job-1", text: "hunter2\n" });
        return {
          jobId: "job-1",
          dependencyId: "git",
          status: "running",
          packageManager: "apt-get",
          currentStepId: "install-git",
          steps: [],
          interaction: { kind: "none", echo: false },
        };
      }

      if (op === "systemDeps.install.get") {
        return {
          jobId: "job-1",
          dependencyId: "git",
          status: "succeeded",
          packageManager: "apt-get",
          currentStepId: "verify-git",
          steps: [],
          interaction: { kind: "none", echo: false },
        };
      }

      throw new Error(`Unexpected op: ${op}`);
    });

    const store = createStoreWithClient(sendCommand);
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn((_topics: string[], handler: (topic: string, payload: unknown) => void) => {
        subscriptionHandler = handler;
        return () => {
          subscriptionHandler = undefined;
        };
      }),
    } as never);

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/diagnostics?context=manual_check"]}>
          <Routes>
            <Route path="/diagnostics" element={<DiagnosticsPage />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    expect(await screen.findByText("Git is missing")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Install Git" }));
    expect(await screen.findByText("Package manager: apt-get")).toBeInTheDocument();
    expect(screen.getByLabelText("Administrator password")).toHaveAttribute("type", "password");

    act(() => {
      subscriptionHandler?.("systemDeps.install.job-1.output", {
        jobId: "job-1",
        chunk: "downloading git\n",
        seq: 1,
      });
    });

    expect(await screen.findByText("downloading git")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Administrator password"), {
      target: { value: "hunter2" },
    });
    fireEvent.submit(screen.getByTestId("system-dependency-password-form"));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("systemDeps.install.get", { jobId: "job-1" }, undefined);
    });

    expect(await screen.findByText("Git is ready")).toBeInTheDocument();
  });

  it("shows missing git on workspace open without disabling the retry action", async () => {
    const workspace = createWorkspace("ws-1", "/repo");
    const sendCommand = vi.fn(async (op: string, args?: Record<string, unknown>) => {
      if (op === "diagnostics.get") {
        return createResponse(
          { context: "workspace_open", canContinue: true },
          [
            {
              id: "workspace-ready",
              code: "workspace_path_ready",
              status: "ready",
              workspacePath: "/repo",
            },
            {
              id: "git-missing",
              code: "git_missing",
              status: "needs_attention",
              dependencyId: "git",
              autoInstallSupported: true,
              installReadiness: "ready",
            },
          ] as DiagnosticsCheck[]
        );
      }

      if (op === "workspace.open") {
        return workspace;
      }

      if (op === "workspace.lastViewedTarget.set") {
        return { workspaceId: "ws-1", updatedAt: 1 };
      }

      throw new Error(`Unexpected op: ${op}`);
    });

    renderDiagnostics("/diagnostics?context=workspace_open&workspacePath=%2Frepo", sendCommand);

    expect(await screen.findByText("Git is missing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Opening Workspace" })).toBeEnabled();
  });
```

- [ ] **Step 2: Run the diagnostics tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/diagnostics/index.test.tsx
```

Expected: FAIL because the installer hook, install panel, and install CTA do not exist yet.

- [ ] **Step 3: Implement the installer hook, panel, and diagnostics page integration**

Create `packages/web/src/features/diagnostics/actions/use-system-dependency-installer.ts`:

```tsx
import type {
  SystemDependencyId,
  SystemDependencyInstallJobSnapshot,
  SystemDependencyInstallOutputChunk,
} from "@coder-studio/core";
import { Topics } from "@coder-studio/core";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { dispatchCommandAtom, wsClientAtom } from "../../../atoms/connection";

export function useSystemDependencyInstaller(onSucceeded: () => Promise<void>) {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const wsClient = useAtomValue(wsClientAtom);
  const [job, setJob] = useState<SystemDependencyInstallJobSnapshot | null>(null);
  const [output, setOutput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!job || !wsClient) {
      return;
    }

    return wsClient.subscribe([Topics.systemDependencyInstallOutput(job.jobId)], (_topic, payload) => {
      const chunk = payload as SystemDependencyInstallOutputChunk;
      setOutput((prev) => `${prev}${chunk.chunk}`);
    });
  }, [job, wsClient]);

  const poll = async (jobId: string) => {
    const result = await dispatch<SystemDependencyInstallJobSnapshot>("systemDeps.install.get", { jobId });
    if (!result.ok || !result.data) {
      return;
    }

    setJob(result.data);

    if (
      result.data.status === "queued" ||
      result.data.status === "running" ||
      result.data.status === "waiting_input"
    ) {
      pollTimerRef.current = window.setTimeout(() => {
        void poll(jobId);
      }, 800);
      return;
    }

    if (result.data.status === "succeeded") {
      await onSucceeded();
    }
  };

  const start = async (dependencyId: SystemDependencyId) => {
    setOutput("");
    const result = await dispatch<SystemDependencyInstallJobSnapshot>("systemDeps.install.start", {
      dependencyId,
    });
    if (!result.ok || !result.data) {
      return;
    }
    setJob(result.data);
    if (result.data.status !== "succeeded" && result.data.status !== "failed") {
      pollTimerRef.current = window.setTimeout(() => {
        void poll(result.data!.jobId);
      }, 800);
    }
  };

  const submitInput = async (text: string) => {
    if (!job) return;
    setSubmitting(true);
    const result = await dispatch<SystemDependencyInstallJobSnapshot>("systemDeps.install.input", {
      jobId: job.jobId,
      text,
    });
    setSubmitting(false);
    if (result.ok && result.data) {
      setJob(result.data);
      pollTimerRef.current = window.setTimeout(() => {
        void poll(result.data!.jobId);
      }, 800);
    }
  };

  const cancel = async () => {
    if (!job) return;
    const result = await dispatch<SystemDependencyInstallJobSnapshot>("systemDeps.install.cancel", {
      jobId: job.jobId,
    });
    if (result.ok && result.data) {
      setJob(result.data);
    }
  };

  return { job, output, submitting, start, submitInput, cancel };
}
```

Create `packages/web/src/features/diagnostics/components/system-dependency-install-panel.tsx`:

```tsx
import type { SystemDependencyInstallJobSnapshot } from "@coder-studio/core";
import { useState } from "react";
import { Button } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";

export function SystemDependencyInstallPanel(props: {
  job: SystemDependencyInstallJobSnapshot;
  output: string;
  submitting: boolean;
  onSubmitPassword: (text: string) => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const t = useTranslation();
  const [password, setPassword] = useState("");

  return (
    <div className="diagnostics-install-panel">
      <div className="diagnostics-install-panel__meta">
        <span>{t("system_deps.install.package_manager")}: {props.job.packageManager ?? "—"}</span>
        <span>{t(`system_deps.install.status.${props.job.status}`)}</span>
      </div>
      <pre className="diagnostics-install-panel__log">{props.output}</pre>

      {props.job.interaction.kind === "sudo_password" ? (
        <form
          className="diagnostics-install-panel__prompt"
          data-testid="system-dependency-password-form"
          onSubmit={(event) => {
            event.preventDefault();
            void props.onSubmitPassword(`${password}\n`);
            setPassword("");
          }}
        >
          <label className="diagnostics-install-panel__label" htmlFor="system-dependency-password">
            {t("system_deps.install.password_label")}
          </label>
          <input
            id="system-dependency-password"
            className="input diagnostics-install-panel__input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Button loading={props.submitting} type="submit" size="sm" variant="primary">
            {t("system_deps.install.submit_password")}
          </Button>
        </form>
      ) : null}

      {(props.job.status === "queued" ||
        props.job.status === "running" ||
        props.job.status === "waiting_input") ? (
        <Button
          onClick={() => {
            void props.onCancel();
          }}
          size="sm"
          variant="ghost"
        >
          {t("system_deps.install.cancel")}
        </Button>
      ) : null}
    </div>
  );
}
```

Update `packages/web/src/features/diagnostics/page.tsx` to mount the hook and panel:

```tsx
import { useSystemDependencyInstaller } from "./actions/use-system-dependency-installer";
import { SystemDependencyInstallPanel } from "./components/system-dependency-install-panel";

const installer = useSystemDependencyInstaller(async () => {
  await loadDiagnostics("diagnostics.recheck");
});
```

Inside `response.checks.map(...)`, extend actions:

```tsx
{check.dependencyId && check.status === "needs_attention" && check.autoInstallSupported ? (
  <Button
    onClick={() => {
      void installer.start(check.dependencyId!);
    }}
    size="sm"
    variant="primary"
  >
    {check.dependencyId === "git"
      ? t("system_deps.install.install_git")
      : t("system_deps.install.install_node")}
  </Button>
) : null}
```

Render the panel directly under the actions when the active job matches:

```tsx
{installer.job?.dependencyId === check.dependencyId ? (
  <SystemDependencyInstallPanel
    job={installer.job}
    output={installer.output}
    submitting={installer.submitting}
    onSubmitPassword={installer.submitInput}
    onCancel={installer.cancel}
  />
) : null}
```

Leave the primary diagnostics action logic unchanged for `workspace_open`, but keep the session-start `canContinue` derived from server diagnostics so missing `node` blocks session continuation until recheck succeeds.

- [ ] **Step 4: Run the diagnostics tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/diagnostics/index.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the diagnostics installer flow**

```bash
git add packages/web/src/features/diagnostics/actions/use-system-dependency-installer.ts \
  packages/web/src/features/diagnostics/components/system-dependency-install-panel.tsx \
  packages/web/src/features/diagnostics/page.tsx \
  packages/web/src/features/diagnostics/index.test.tsx
git commit -m "feat(web): add diagnostics system dependency installer"
```

### Task 6: Add Copy, Styling, And Final Regression Coverage

**Files:**
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write the failing theme/style regression**

Add this to `packages/web/src/styles/components.theme.test.ts`:

```ts
  it("keeps diagnostics install surfaces on theme tokens", () => {
    expect(stylesheet).toContain(".diagnostics-install-panel");
    expect(stylesheet).toContain("var(--bg-surface)");
    expect(stylesheet).toContain("var(--border-default)");
    expect(stylesheet).toContain("var(--text-secondary)");
  });
```

- [ ] **Step 2: Run the web diagnostics and style tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/diagnostics/index.test.tsx \
  src/styles/components.theme.test.ts
```

Expected: FAIL because the new locale keys and install panel styles do not exist yet.

- [ ] **Step 3: Add locales and install panel styles**

Update `packages/web/src/locales/en.json` with:

```json
"system_deps": {
  "install": {
    "install_git": "Install Git",
    "install_node": "Install Node.js",
    "package_manager": "Package manager",
    "password_label": "Administrator password",
    "submit_password": "Submit password",
    "cancel": "Cancel install",
    "status": {
      "queued": "Queued",
      "running": "Installing",
      "waiting_input": "Waiting for password",
      "succeeded": "Installed",
      "failed": "Install failed",
      "cancelled": "Install cancelled"
    },
    "git": {
      "manual": "Install Git manually if automatic install is not available for this machine."
    },
    "node": {
      "manual": "Install Node.js manually if automatic install is not available for this machine."
    }
  }
}
```

Update `packages/web/src/locales/zh.json` with:

```json
"system_deps": {
  "install": {
    "install_git": "安装 Git",
    "install_node": "安装 Node.js",
    "package_manager": "包管理器",
    "password_label": "管理员密码",
    "submit_password": "提交密码",
    "cancel": "取消安装",
    "status": {
      "queued": "等待中",
      "running": "安装中",
      "waiting_input": "等待输入密码",
      "succeeded": "安装完成",
      "failed": "安装失败",
      "cancelled": "安装已取消"
    },
    "git": {
      "manual": "如果当前机器不支持自动安装，请手动安装 Git。"
    },
    "node": {
      "manual": "如果当前机器不支持自动安装，请手动安装 Node.js。"
    }
  }
}
```

Update `packages/web/src/styles/components.css` with:

```css
.diagnostics-install-panel {
  display: grid;
  gap: 10px;
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--border-default);
  border-radius: 14px;
  background: var(--bg-surface);
}

.diagnostics-install-panel__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  color: var(--text-secondary);
  font-size: 12px;
}

.diagnostics-install-panel__log {
  min-height: 120px;
  max-height: 220px;
  overflow: auto;
  margin: 0;
  padding: 12px;
  border-radius: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
}

.diagnostics-install-panel__prompt {
  display: grid;
  gap: 8px;
}

.diagnostics-install-panel__label {
  color: var(--text-secondary);
  font-size: 12px;
}

.diagnostics-install-panel__input {
  width: 100%;
}
```

- [ ] **Step 4: Run the focused regression suite to verify everything passes**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/system-dependency-install.test.ts
pnpm --filter @coder-studio/server exec vitest run \
  src/__tests__/system-deps/runtime-status.test.ts \
  src/__tests__/diagnostics-commands.test.ts \
  src/__tests__/system-deps/interaction-detector.test.ts \
  src/__tests__/system-deps/install-manager.test.ts \
  src/__tests__/system-deps/commands.test.ts
pnpm --filter @coder-studio/web exec vitest run \
  src/features/diagnostics/index.test.tsx \
  src/styles/components.theme.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit the copy, styles, and final regression coverage**

```bash
git add packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts
git commit -m "feat(web): polish system dependency installer diagnostics"
```
