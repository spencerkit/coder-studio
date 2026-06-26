# Runtime Extraction Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the current in-process runtime out of the monolithic server so every runtime-owned command executes through a `RuntimeHandle`, while native behavior remains unchanged and WSL transport can be added later without another architectural rewrite.

**Architecture:** Keep the browser-facing Fastify/WebSocket server as the host control plane, then move execution concerns behind a runtime boundary made of split command registries, split contexts, a host runtime router, and an in-process `NativeRuntimeHandle`. Host-owned state stays in `state/host`; runtime-owned services and state move behind `runtime/assembly.ts`, and host-side projections replace direct reads from runtime managers in places like `WsHub`, auth scope checks, monitoring, and update gating.

**Tech Stack:** TypeScript, Fastify, WebSocket command dispatch, Vitest, existing repositories/managers in `packages/server`, shared domain types in `@coder-studio/core`.

**Spec reference:** `docs/superpowers/plans/2026-06-21-runtime-extraction-and-wsl-architecture.md`

**Git hygiene:** The repo already contains untracked plan/spec files. Read files before patching, stage only the files for the current task, and never revert unrelated user changes.

---

## File Structure

**New files:**
- `packages/server/src/host/context.ts` — host-only command context and WebSocket-facing dispatch context
- `packages/server/src/host/command-registry.ts` — host command registry and host command definition types
- `packages/server/src/host/runtime-router.ts` — runtime selection, route resolution, default-runtime fallback, and runtime execution entrypoint
- `packages/server/src/host/runtime-registry.ts` — named runtime handle registry and provider-registry fan-out
- `packages/server/src/host/workspace-runtime-binding.ts` — workspace/session/terminal/runtime binding index plus host-side projections
- `packages/server/src/runtime/contract.ts` — `RuntimeHandle`, `RuntimeExecuteMeta`, route-target types, and host bridge contract
- `packages/server/src/runtime/context.ts` — runtime command context and runtime command handler types
- `packages/server/src/runtime/command-registry.ts` — runtime command registry and route resolver metadata
- `packages/server/src/runtime/assembly.ts` — extracted runtime assembly from `server.ts`
- `packages/server/src/runtime/native-runtime.ts` — in-process `NativeRuntimeHandle`
- `packages/server/src/runtime/runtime-state.ts` — runtime state-root helpers for `state/runtimes/<runtimeId>`
- `packages/server/src/runtime/events.ts` — host bridge adapters that forward runtime domain events and topic messages back to host services
- `packages/server/src/__tests__/host-command-registry.test.ts` — host registry coverage
- `packages/server/src/__tests__/runtime-command-registry.test.ts` — runtime registry and route-target coverage
- `packages/server/src/__tests__/runtime-router.test.ts` — workspace/session/terminal/default route resolution coverage
- `packages/server/src/__tests__/runtime/native-runtime.test.ts` — native runtime execution and host bridge coverage
- `packages/server/src/__tests__/workspace-runtime-binding.test.ts` — host-side runtime binding/projection coverage

**Modified files:**
- `packages/server/src/server.ts` — host/runtime bootstrap split, runtime router wiring, host bridge creation, and test surface updates
- `packages/server/src/ws/dispatch.ts` — host/runtime routing, auth checks, and legacy `registerCommand` removal
- `packages/server/src/ws/index.ts` — export new host/runtime registration APIs
- `packages/server/src/ws/hub.ts` — resync and command dispatch driven by host projections instead of direct runtime manager access
- `packages/server/src/workspace/manager.ts` — explicit runtime metadata on open and runtime-aware close orchestration
- `packages/server/src/commands/index.ts` — explicit host/runtime registration bootstrap
- `packages/server/src/commands/workspace.ts` — `workspace.open` / `workspace.close` host orchestration, `workspace.intelligence` runtime routing
- `packages/server/src/commands/session.ts` — runtime registration for session commands and host-orchestrated `session.close`
- `packages/server/src/commands/terminal.ts` — runtime registration and terminal-id route selectors
- `packages/server/src/commands/file.ts`
- `packages/server/src/commands/git.ts`
- `packages/server/src/commands/recovery.ts`
- `packages/server/src/commands/task.ts`
- `packages/server/src/commands/lsp.ts`
- `packages/server/src/commands/worktree.ts`
- `packages/server/src/commands/provider.ts` — split host/runtime provider operations plus internal runtime config bridge ops
- `packages/server/src/commands/system-deps.ts` — runtime-global registration with owner/client propagation
- `packages/server/src/commands/settings.ts` — host-owned settings plus runtime-backed provider config and preview bridge
- `packages/server/src/commands/diagnostics.ts` — host-orchestrated aggregation over runtime status helpers
- `packages/server/src/commands/custom-provider.ts` — host-owned provider definition changes plus runtime registry fan-out
- `packages/server/src/commands/agent-context.ts`
- `packages/server/src/commands/agent-instructions.ts`
- `packages/server/src/commands/skills.ts`
- `packages/server/src/commands/skills/*.ts`
- `packages/server/src/commands/supervisor.ts`
- `packages/server/src/commands/session-metadata.ts`
- `packages/server/src/commands/session-review.ts`
- `packages/server/src/commands/work-analysis.ts`
- `packages/server/src/commands/fencing.ts` — stay host-only, update imports to host registry
- `packages/server/src/commands/automation.ts`
- `packages/server/src/commands/activation.ts`
- `packages/server/src/commands/connection.ts`
- `packages/server/src/commands/memory.ts`
- `packages/server/src/commands/monitoring.ts`
- `packages/server/src/commands/updates.ts`
- `packages/server/src/commands/ui-actions.ts`
- `packages/server/src/commands/workspace-activity.ts`
- `packages/server/src/session/manager.ts` — replace direct host token/runtime URL assumptions with host bridge capabilities
- `packages/server/src/system-deps/install-manager.ts` — bridge-backed client routing instead of raw `WsHub` dependency
- `packages/server/src/supervisor/manager.ts` — bridge-backed topic broadcast
- `packages/server/src/monitoring/service.ts` — runtime projections instead of direct session/terminal managers
- `packages/server/src/storage/repositories/session-metadata-repo.ts` — runtime-local workspace lookup instead of direct `WorkspaceRepo` coupling
- `packages/server/src/__tests__/dispatch.test.ts`
- `packages/server/src/__tests__/workspace/manager.test.ts`
- `packages/server/src/__tests__/workspace/manager-on-close.test.ts`
- `packages/server/src/__tests__/workspace-commands.test.ts`
- `packages/server/src/__tests__/session-commands.test.ts`
- `packages/server/src/__tests__/terminal-commands.test.ts`
- `packages/server/src/__tests__/file-commands.test.ts`
- `packages/server/src/__tests__/git-commands.test.ts`
- `packages/server/src/__tests__/task-commands.test.ts`
- `packages/server/src/__tests__/lsp-commands.test.ts`
- `packages/server/src/__tests__/worktree-commands.test.ts`
- `packages/server/src/__tests__/provider-runtime/runtime-status.test.ts`
- `packages/server/src/__tests__/provider-runtime/install-manager.test.ts`
- `packages/server/src/__tests__/system-deps/commands.test.ts`
- `packages/server/src/commands/settings.test.ts`
- `packages/server/src/__tests__/diagnostics-commands.test.ts`
- `packages/server/src/__tests__/skills/commands.test.ts`
- `packages/server/src/__tests__/server-builtin-skills-wiring.test.ts`
- `packages/server/src/__tests__/server-memory-wiring.test.ts`
- `packages/server/src/__tests__/server-provider-install-wiring.test.ts`
- `packages/server/src/__tests__/server-lsp-runtime-mode-hydration.test.ts`
- `packages/server/src/__tests__/server-runtime-config.test.ts`
- `packages/server/src/__tests__/ws-hub.test.ts`
- `packages/server/src/__tests__/monitoring/service.test.ts`

**Compatibility note for Phase 1:** runtime-global commands that currently have no `workspaceId` in the web protocol (`provider.runtimeStatus`, `provider.install.*`, `systemDeps.*`, most `skills.*`, and runtime-backed provider config helpers behind `settings.*`) will resolve to the `native-default` runtime through `RuntimeRouteTarget { kind: "default" }`. This preserves current UI payloads now. WSL follow-up work will thread explicit runtime/workspace targeting through those flows before mixed native/WSL execution ships.

**Testing commands used in this plan:**
- `pnpm --filter @coder-studio/server exec vitest run src/__tests__/host-command-registry.test.ts src/__tests__/runtime-command-registry.test.ts src/__tests__/runtime-router.test.ts src/__tests__/workspace-runtime-binding.test.ts`
- `pnpm --filter @coder-studio/server exec vitest run src/__tests__/workspace/manager.test.ts src/__tests__/workspace/manager-on-close.test.ts src/__tests__/workspace-commands.test.ts`
- `pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/native-runtime.test.ts src/__tests__/server-builtin-skills-wiring.test.ts src/__tests__/server-lsp-runtime-mode-hydration.test.ts src/__tests__/server-runtime-config.test.ts`
- `pnpm --filter @coder-studio/server exec vitest run src/__tests__/dispatch.test.ts src/__tests__/session-commands.test.ts src/__tests__/terminal-commands.test.ts src/__tests__/file-commands.test.ts src/__tests__/git-commands.test.ts src/__tests__/task-commands.test.ts src/__tests__/lsp-commands.test.ts src/__tests__/worktree-commands.test.ts`
- `pnpm --filter @coder-studio/server exec vitest run src/commands/settings.test.ts src/__tests__/diagnostics-commands.test.ts src/__tests__/provider-runtime/runtime-status.test.ts src/__tests__/provider-runtime/install-manager.test.ts src/__tests__/system-deps/commands.test.ts`
- `pnpm --filter @coder-studio/server exec vitest run src/__tests__/skills/commands.test.ts src/__tests__/agent-context-command.test.ts src/__tests__/agent-instructions-command.test.ts src/__tests__/session-analysis-commands.test.ts src/__tests__/session-review-command.test.ts src/__tests__/supervisor-commands.test.ts src/__tests__/work-analysis-commands.test.ts`
- `pnpm --filter @coder-studio/server exec vitest run src/__tests__/ws-hub.test.ts src/__tests__/monitoring/service.test.ts src/__tests__/server-memory-wiring.test.ts src/__tests__/server-provider-install-wiring.test.ts`

---

### Task 1: Add Split Contexts And Command Registries

**Files:**
- Create: `packages/server/src/host/context.ts`
- Create: `packages/server/src/host/command-registry.ts`
- Create: `packages/server/src/runtime/contract.ts`
- Create: `packages/server/src/runtime/context.ts`
- Create: `packages/server/src/runtime/command-registry.ts`
- Create: `packages/server/src/__tests__/host-command-registry.test.ts`
- Create: `packages/server/src/__tests__/runtime-command-registry.test.ts`
- Modify: `packages/server/src/ws/index.ts`

- [ ] **Step 1: Write the failing registry tests**

Create `packages/server/src/__tests__/host-command-registry.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  clearHostCommandsForTest,
  getHostCommandDefinition,
  registerHostCommand,
} from "../host/command-registry.js";

describe("host command registry", () => {
  it("stores host command definitions by op", () => {
    clearHostCommandsForTest();
    registerHostCommand("host.test", z.object({ value: z.number() }), async (args) => ({
      doubled: args.value * 2,
    }));

    const definition = getHostCommandDefinition("host.test");
    expect(definition?.schema.parse({ value: 2 })).toEqual({ value: 2 });
  });
});
```

Create `packages/server/src/__tests__/runtime-command-registry.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  clearRuntimeCommandsForTest,
  getRuntimeCommandDefinition,
  registerRuntimeCommand,
} from "../runtime/command-registry.js";

describe("runtime command registry", () => {
  it("keeps route resolution metadata next to the runtime handler", () => {
    clearRuntimeCommandsForTest();
    registerRuntimeCommand(
      "runtime.test",
      z.object({ workspaceId: z.string() }),
      {
        resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
        handler: async () => ({ ok: true }),
      }
    );

    const definition = getRuntimeCommandDefinition("runtime.test");
    expect(definition?.resolveTarget({ workspaceId: "ws-1" })).toEqual({
      kind: "workspace",
      workspaceId: "ws-1",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/host-command-registry.test.ts src/__tests__/runtime-command-registry.test.ts
```

Expected: FAIL because the new host/runtime registry modules do not exist yet.

- [ ] **Step 3: Write the split context and registry implementation**

Create `packages/server/src/runtime/contract.ts` with:

```ts
import type { DomainEvent, ProviderDefinition } from "@coder-studio/core";
import type { RequestAuthContext } from "../auth/index.js";

export type RuntimeRouteTarget =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "session"; sessionId: string }
  | { kind: "terminal"; terminalId: string }
  | { kind: "default" };

export interface RuntimeExecuteMeta {
  clientId?: string;
  authContext?: RequestAuthContext;
}

export interface RuntimeHostBridge {
  issueSessionToken(input: {
    sessionId: string;
    workspaceId: string;
    providerId: string;
    permissions: readonly string[];
  }): { token: string };
  revokeSessionTokensBySessionId(sessionId: string): void;
  getHostApiUrl(): string | undefined;
  emitDomainEvent(event: DomainEvent): void;
  broadcast(topic: string, payload: unknown): void;
  sendToClient(clientId: string, payload: unknown): boolean;
  sendBinaryToClient(clientId: string, payload: Buffer): boolean;
}

export interface RuntimeHandle {
  id: string;
  kind: "native" | "wsl";
  execute(op: string, args: unknown, meta?: RuntimeExecuteMeta): Promise<unknown>;
  disposeWorkspace(workspaceId: string): Promise<void>;
  setProviderRegistry?(providers: ProviderDefinition[]): void;
  health(): Promise<{ ok: true }>;
}
```

Create `packages/server/src/host/context.ts` with:

```ts
import type { ProviderDefinition } from "@coder-studio/core";
import type { RequestAuthContext } from "../auth/index.js";
import type { AutomationAuditLog } from "../automation/audit-log.js";
import type { ServerConfig } from "../config.js";
import type { MonitoringService } from "../monitoring/service.js";
import type { CustomProviderRepo } from "../storage/repositories/custom-provider-repo.js";
import type { MemoryRepo } from "../storage/repositories/memory-repo.js";
import type { SettingsRepo } from "../storage/repositories/settings-repo.js";
import type { UpdateService } from "../update/update-service.js";
import type { WorkspaceManager } from "../workspace/manager.js";
import type { ActivationManager } from "../ws/activation.js";
import type { Broadcaster } from "../ws/hub.js";
import type { RuntimeRouter } from "./runtime-router.js";
import type { WorkspaceRuntimeBindingStore } from "./workspace-runtime-binding.js";

export interface HostCommandContext {
  workspaceMgr: WorkspaceManager;
  settingsRepo: SettingsRepo;
  memoryRepo?: MemoryRepo;
  activationMgr: ActivationManager;
  automationAuditLog?: AutomationAuditLog;
  broadcaster: Broadcaster;
  runtimeRouter: RuntimeRouter;
  runtimeBindings: WorkspaceRuntimeBindingStore;
  config?: Pick<ServerConfig, "auth" | "host">;
  updateService?: UpdateService;
  monitoringService?: MonitoringService;
  customProviderRepo?: CustomProviderRepo;
  providerRegistry: ProviderDefinition[];
  setProviderRegistry?: (providers: ProviderDefinition[]) => void;
}

export interface HostDispatchMeta {
  clientId?: string;
  authContext?: RequestAuthContext;
}
```

Create `packages/server/src/runtime/context.ts` with:

```ts
import type { ProviderDefinition } from "@coder-studio/core";
import type { AgentInstructionsPublisher } from "../agent-instructions/publisher.js";
import type { EventBus } from "../bus/event-bus.js";
import type { LspManager } from "../lsp/manager.js";
import type { LspToolInstallManager } from "../lsp-tools/install-manager.js";
import type { LspToolManager } from "../lsp-tools/manager.js";
import type { ProviderInstallManager } from "../provider-runtime/install-manager.js";
import type { RuntimeStatusDeps } from "../provider-runtime/runtime-status.js";
import type { SessionManager } from "../session/manager.js";
import type { SessionAnalysisService } from "../session-analysis/service.js";
import type { BuiltinSkillSyncManager } from "../skills/builtin/sync-manager.js";
import type { SkillHealthManager } from "../skills/health-manager.js";
import type { SkillInstallManager } from "../skills/install-manager.js";
import type { SkillMountManager } from "../skills/mount-manager.js";
import type { SkillsHubClient } from "../skills/skills-hub-client.js";
import type { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import type { SessionMetadataRepo } from "../storage/repositories/session-metadata-repo.js";
import type { SkillLibraryRepo } from "../storage/repositories/skill-library-repo.js";
import type { SkillMountRepo } from "../storage/repositories/skill-mount-repo.js";
import type { SkillTargetRepo } from "../storage/repositories/skill-target-repo.js";
import type { SupervisorManager } from "../supervisor/manager.js";
import type { SystemDependencyInstallManager } from "../system-deps/install-manager.js";
import type { TaskManager } from "../tasks/manager.js";
import type { TerminalManager } from "../terminal/manager.js";
import type { WorkAnalysisService } from "../work-analysis/service.js";
import type { RuntimeHostBridge } from "./contract.js";

export interface RuntimeCommandContext {
  runtimeId: string;
  workspaceLookup: {
    get(workspaceId: string): { id: string; path: string; targetRuntime: "native" | "wsl" } | undefined;
    list(): Array<{ id: string; path: string; targetRuntime: "native" | "wsl" }>;
  };
  hostBridge: RuntimeHostBridge;
  eventBus: EventBus;
  providerConfigRepo: ProviderConfigRepo;
  providerRegistry: ProviderDefinition[];
  sessionMgr: SessionManager;
  terminalMgr: TerminalManager;
  taskMgr: TaskManager;
  lspMgr: LspManager;
  lspToolMgr?: LspToolManager;
  lspToolInstallMgr?: LspToolInstallManager;
  supervisorMgr: SupervisorManager;
  providerRuntimeDeps?: RuntimeStatusDeps;
  providerInstallMgr?: ProviderInstallManager;
  systemDependencyInstallMgr?: SystemDependencyInstallManager;
  skillsHubClient?: SkillsHubClient;
  skillInstallMgr?: SkillInstallManager;
  skillMountMgr?: SkillMountManager;
  skillHealthMgr?: SkillHealthManager;
  skillLibraryRepo?: SkillLibraryRepo;
  skillTargetRepo?: SkillTargetRepo;
  skillMountRepo?: SkillMountRepo;
  builtinSkillSyncMgr?: BuiltinSkillSyncManager;
  sessionMetadataRepo?: SessionMetadataRepo;
  sessionAnalysisService?: SessionAnalysisService;
  workAnalysisService?: WorkAnalysisService;
  agentInstructionPublisher?: AgentInstructionsPublisher;
}
```

Create `packages/server/src/host/command-registry.ts` and `packages/server/src/runtime/command-registry.ts` with module-level registries mirroring the current `registerCommand()` pattern, plus `clear*ForTest()` helpers used only by tests. Keep the host signature aligned with the current handler shape and give runtime command definitions this shape:

```ts
export interface RuntimeCommandDefinition<S extends z.ZodTypeAny = z.ZodTypeAny, R = unknown> {
  schema: S;
  resolveTarget: (args: z.output<S>) => RuntimeRouteTarget;
  handler: (
    args: z.output<S>,
    ctx: RuntimeCommandContext,
    meta?: RuntimeExecuteMeta
  ) => Promise<R>;
}
```

Update `packages/server/src/ws/index.ts` to export:

```ts
export {
  registerHostCommand,
  getHostCommandDefinition,
} from "../host/command-registry.js";
export {
  registerRuntimeCommand,
  getRuntimeCommandDefinition,
} from "../runtime/command-registry.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/host-command-registry.test.ts src/__tests__/runtime-command-registry.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/host/context.ts packages/server/src/host/command-registry.ts packages/server/src/runtime/contract.ts packages/server/src/runtime/context.ts packages/server/src/runtime/command-registry.ts packages/server/src/ws/index.ts packages/server/src/__tests__/host-command-registry.test.ts packages/server/src/__tests__/runtime-command-registry.test.ts
git commit -m "refactor: add host and runtime command registries"
```

### Task 2: Add Runtime Routing, Workspace Bindings, And Host Projections

**Files:**
- Create: `packages/server/src/host/runtime-registry.ts`
- Create: `packages/server/src/host/runtime-router.ts`
- Create: `packages/server/src/host/workspace-runtime-binding.ts`
- Create: `packages/server/src/__tests__/runtime-router.test.ts`
- Create: `packages/server/src/__tests__/workspace-runtime-binding.test.ts`

- [ ] **Step 1: Write the failing routing and binding tests**

Create `packages/server/src/__tests__/workspace-runtime-binding.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { WorkspaceRuntimeBindingStore } from "../host/workspace-runtime-binding.js";

describe("WorkspaceRuntimeBindingStore", () => {
  it("tracks workspace, session, and terminal bindings together", () => {
    const store = new WorkspaceRuntimeBindingStore();
    store.bindWorkspace("ws-1", "native-default");
    store.bindSession({ id: "sess-1", workspaceId: "ws-1", terminalId: "term-1", state: "running" });
    store.bindTerminal({ id: "term-1", workspaceId: "ws-1", kind: "agent", title: "Claude", cwd: "/repo" });

    expect(store.getRuntimeIdForWorkspace("ws-1")).toBe("native-default");
    expect(store.findWorkspaceIdBySessionId("sess-1")).toBe("ws-1");
    expect(store.findWorkspaceIdByTerminalId("term-1")).toBe("ws-1");
    expect(store.listSessionsForWorkspace("ws-1")).toHaveLength(1);
    expect(store.listTerminalsForWorkspace("ws-1")).toHaveLength(1);
  });
});
```

Create `packages/server/src/__tests__/runtime-router.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";
import { RuntimeRegistry } from "../host/runtime-registry.js";
import { RuntimeRouter } from "../host/runtime-router.js";
import { WorkspaceRuntimeBindingStore } from "../host/workspace-runtime-binding.js";

describe("RuntimeRouter", () => {
  it("resolves workspace, session, terminal, and default targets", async () => {
    const bindings = new WorkspaceRuntimeBindingStore();
    bindings.bindWorkspace("ws-1", "native-default");
    bindings.bindSession({ id: "sess-1", workspaceId: "ws-1", terminalId: "term-1", state: "running" });
    bindings.bindTerminal({ id: "term-1", workspaceId: "ws-1", kind: "agent", title: "agent", cwd: "/repo" });

    const execute = vi.fn(async () => ({ ok: true }));
    const registry = new RuntimeRegistry();
    registry.register({
      id: "native-default",
      kind: "native",
      execute,
      disposeWorkspace: vi.fn(),
      health: async () => ({ ok: true }),
    });

    const router = new RuntimeRouter({ runtimeRegistry: registry, bindings, defaultRuntimeId: "native-default" });

    await router.executeOnTarget({ kind: "workspace", workspaceId: "ws-1" }, "file.read", {});
    await router.executeOnTarget({ kind: "session", sessionId: "sess-1" }, "session.stop", {});
    await router.executeOnTarget({ kind: "terminal", terminalId: "term-1" }, "terminal.read", {});
    await router.executeOnTarget({ kind: "default" }, "skills.library.list", {});

    expect(execute).toHaveBeenCalledTimes(4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime-router.test.ts src/__tests__/workspace-runtime-binding.test.ts
```

Expected: FAIL because the runtime router and binding store do not exist yet.

- [ ] **Step 3: Implement runtime registry, router, and host-side projection store**

Create `packages/server/src/host/workspace-runtime-binding.ts` with a single store that owns:

```ts
import type { Session, Terminal } from "@coder-studio/core";

export class WorkspaceRuntimeBindingStore {
  private readonly runtimeIdByWorkspaceId = new Map<string, string>();
  private readonly workspaceIdBySessionId = new Map<string, string>();
  private readonly workspaceIdByTerminalId = new Map<string, string>();
  private readonly sessionsByWorkspaceId = new Map<string, Map<string, Session>>();
  private readonly terminalsByWorkspaceId = new Map<string, Map<string, Terminal>>();

  bindWorkspace(workspaceId: string, runtimeId: string): void {
    this.runtimeIdByWorkspaceId.set(workspaceId, runtimeId);
  }

  unbindWorkspace(workspaceId: string): void {
    this.runtimeIdByWorkspaceId.delete(workspaceId);
    const sessions = this.sessionsByWorkspaceId.get(workspaceId);
    for (const sessionId of sessions?.keys() ?? []) this.workspaceIdBySessionId.delete(sessionId);
    const terminals = this.terminalsByWorkspaceId.get(workspaceId);
    for (const terminalId of terminals?.keys() ?? []) this.workspaceIdByTerminalId.delete(terminalId);
    this.sessionsByWorkspaceId.delete(workspaceId);
    this.terminalsByWorkspaceId.delete(workspaceId);
  }

  bindSession(session: Session): void {
    this.workspaceIdBySessionId.set(session.id, session.workspaceId);
    const bucket = this.sessionsByWorkspaceId.get(session.workspaceId) ?? new Map<string, Session>();
    bucket.set(session.id, session);
    this.sessionsByWorkspaceId.set(session.workspaceId, bucket);
  }

  removeSession(sessionId: string): void {
    const workspaceId = this.workspaceIdBySessionId.get(sessionId);
    if (!workspaceId) return;
    this.workspaceIdBySessionId.delete(sessionId);
    this.sessionsByWorkspaceId.get(workspaceId)?.delete(sessionId);
  }

  bindTerminal(terminal: Terminal): void {
    this.workspaceIdByTerminalId.set(terminal.id, terminal.workspaceId);
    const bucket = this.terminalsByWorkspaceId.get(terminal.workspaceId) ?? new Map<string, Terminal>();
    bucket.set(terminal.id, terminal);
    this.terminalsByWorkspaceId.set(terminal.workspaceId, bucket);
  }

  removeTerminal(terminalId: string): void {
    const workspaceId = this.workspaceIdByTerminalId.get(terminalId);
    if (!workspaceId) return;
    this.workspaceIdByTerminalId.delete(terminalId);
    this.terminalsByWorkspaceId.get(workspaceId)?.delete(terminalId);
  }
}
```

Create `packages/server/src/host/runtime-registry.ts` with a small named registry:

```ts
import type { ProviderDefinition } from "@coder-studio/core";
import type { RuntimeHandle } from "../runtime/contract.js";

export class RuntimeRegistry {
  private readonly runtimes = new Map<string, RuntimeHandle>();

  register(runtime: RuntimeHandle): void {
    this.runtimes.set(runtime.id, runtime);
  }

  get(runtimeId: string): RuntimeHandle | undefined {
    return this.runtimes.get(runtimeId);
  }

  setProviderRegistry(providers: ProviderDefinition[]): void {
    for (const runtime of this.runtimes.values()) {
      runtime.setProviderRegistry?.(providers);
    }
  }
}
```

Create `packages/server/src/host/runtime-router.ts` with:

```ts
import type { RequestAuthContext } from "../auth/index.js";
import type { RuntimeExecuteMeta, RuntimeRouteTarget } from "../runtime/contract.js";
import type { RuntimeRegistry } from "./runtime-registry.js";
import type { WorkspaceRuntimeBindingStore } from "./workspace-runtime-binding.js";

export class RuntimeRouter {
  constructor(
    private readonly deps: {
      runtimeRegistry: RuntimeRegistry;
      bindings: WorkspaceRuntimeBindingStore;
      defaultRuntimeId: string;
    }
  ) {}

  private resolveRuntimeId(target: RuntimeRouteTarget): string {
    if (target.kind === "default") {
      return this.deps.defaultRuntimeId;
    }

    const workspaceId =
      target.kind === "workspace"
        ? target.workspaceId
        : target.kind === "session"
          ? this.deps.bindings.findWorkspaceIdBySessionId(target.sessionId)
          : this.deps.bindings.findWorkspaceIdByTerminalId(target.terminalId);

    if (!workspaceId) {
      throw { code: "workspace_not_found", message: "Unable to resolve runtime target" };
    }

    const runtimeId = this.deps.bindings.getRuntimeIdForWorkspace(workspaceId);
    if (!runtimeId) {
      throw { code: "runtime_not_bound", message: `No runtime bound for workspace: ${workspaceId}` };
    }

    return runtimeId;
  }

  async executeOnTarget(
    target: RuntimeRouteTarget,
    op: string,
    args: unknown,
    meta?: RuntimeExecuteMeta
  ): Promise<unknown> {
    const runtimeId = this.resolveRuntimeId(target);
    const runtime = this.deps.runtimeRegistry.get(runtimeId);
    if (!runtime) {
      throw { code: "runtime_not_found", message: `Runtime not found: ${runtimeId}` };
    }
    return runtime.execute(op, args, meta);
  }

  getAuthContextForClient(_clientId?: string): RequestAuthContext | undefined {
    return undefined;
  }
}
```

Also add `getRuntimeIdForWorkspace()`, `findWorkspaceIdBySessionId()`, `findWorkspaceIdByTerminalId()`, `listSessionsForWorkspace()`, and `listTerminalsForWorkspace()` methods to the binding store because later tasks use them for auth scope checks, `WsHub.resync`, update gating, and monitoring.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime-router.test.ts src/__tests__/workspace-runtime-binding.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/host/runtime-registry.ts packages/server/src/host/runtime-router.ts packages/server/src/host/workspace-runtime-binding.ts packages/server/src/__tests__/runtime-router.test.ts packages/server/src/__tests__/workspace-runtime-binding.test.ts
git commit -m "refactor: add runtime router and workspace bindings"
```

### Task 3: Make Workspace Lifecycle Carry Explicit Runtime Metadata

**Files:**
- Modify: `packages/server/src/workspace/manager.ts`
- Modify: `packages/server/src/commands/workspace.ts`
- Test: `packages/server/src/__tests__/workspace/manager.test.ts`
- Test: `packages/server/src/__tests__/workspace/manager-on-close.test.ts`
- Test: `packages/server/src/__tests__/workspace-commands.test.ts`

- [ ] **Step 1: Write the failing workspace metadata tests**

Add this test to `packages/server/src/__tests__/workspace/manager.test.ts`:

```ts
it("persists explicit targetRuntime and wslDistro on new workspaces", async () => {
  const workspace = await manager.open({
    path: testDir,
    targetRuntime: "wsl",
    wslDistro: "Ubuntu-24.04",
  });

  expect(workspace.targetRuntime).toBe("wsl");
  expect(workspace.wslDistro).toBe("Ubuntu-24.04");
});
```

Add this test to `packages/server/src/__tests__/workspace-commands.test.ts`:

```ts
it("workspace.open still records a native workspace through the command layer", async () => {
  const workspaceDir = join(tmpdir(), `workspace-open-native-${Date.now()}`);
  await mkdir(workspaceDir, { recursive: true });

  const result = await dispatch(
    {
      kind: "command",
      id: "workspace-open-native",
      op: "workspace.open",
      args: { path: workspaceDir },
    },
    ctx
  );

  expect(result.ok).toBe(true);
  expect(result.data).toMatchObject({ targetRuntime: "native" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/workspace/manager.test.ts src/__tests__/workspace/manager-on-close.test.ts src/__tests__/workspace-commands.test.ts
```

Expected: FAIL because `WorkspaceManager.open()` still hardcodes `targetRuntime: "native"` and its request type does not accept explicit runtime metadata.

- [ ] **Step 3: Implement explicit runtime metadata in workspace lifecycle**

Update `packages/server/src/workspace/manager.ts`:

```ts
import type { DomainEvent, Workspace } from "@coder-studio/core";

export interface OpenWorkspaceRequest {
  path: string;
  targetRuntime: Workspace["targetRuntime"];
  wslDistro?: string;
}

// inside open():
const workspace: Workspace = {
  id: generateWorkspaceId(),
  path: req.path,
  targetRuntime: req.targetRuntime,
  wslDistro: req.targetRuntime === "wsl" ? req.wslDistro : undefined,
  openedAt: Date.now(),
  lastActiveAt: Date.now(),
  uiState: {
    leftPanelWidth: 250,
    bottomPanelHeight: 200,
    focusMode: false,
    paneLayout: { id: "root", type: "leaf", leafKind: "draft" },
  },
};
```

Update `packages/server/src/commands/workspace.ts` temporarily to keep current behavior until the runtime router lands:

```ts
const workspace = await ctx.workspaceMgr.open({
  path: args.path,
  targetRuntime: "native",
});
```

Do not change the public `workspace.open` wire format yet; the host runtime decision will replace the hardcoded `"native"` in Task 5.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/workspace/manager.test.ts src/__tests__/workspace/manager-on-close.test.ts src/__tests__/workspace-commands.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/workspace/manager.ts packages/server/src/commands/workspace.ts packages/server/src/__tests__/workspace/manager.test.ts packages/server/src/__tests__/workspace-commands.test.ts
git commit -m "refactor: make workspace metadata runtime explicit"
```

### Task 4: Extract Runtime Assembly And Native Runtime Handle

**Files:**
- Create: `packages/server/src/runtime/runtime-state.ts`
- Create: `packages/server/src/runtime/events.ts`
- Create: `packages/server/src/runtime/assembly.ts`
- Create: `packages/server/src/runtime/native-runtime.ts`
- Create: `packages/server/src/__tests__/runtime/native-runtime.test.ts`
- Modify: `packages/server/src/session/manager.ts`
- Modify: `packages/server/src/system-deps/install-manager.ts`
- Modify: `packages/server/src/storage/repositories/session-metadata-repo.ts`

- [ ] **Step 1: Write the failing native-runtime tests**

Create `packages/server/src/__tests__/runtime/native-runtime.test.ts` with:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeRuntime } from "../../runtime/native-runtime.js";

describe("NativeRuntimeHandle", () => {
  let stateDir: string;

  afterEach(() => {
    if (stateDir) {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("stores runtime-owned state under state/runtimes/native-default", async () => {
    stateDir = mkdtempSync(join(tmpdir(), "native-runtime-state-"));
    const runtime = await createNativeRuntime({
      runtimeId: "native-default",
      stateRoot: stateDir,
      hostBridge: {
        issueSessionToken: vi.fn(() => ({ token: "token" })),
        revokeSessionTokensBySessionId: vi.fn(),
        getHostApiUrl: () => "http://127.0.0.1:4173",
        emitDomainEvent: vi.fn(),
        broadcast: vi.fn(),
        sendToClient: vi.fn(() => true),
        sendBinaryToClient: vi.fn(() => true),
      },
      providerRegistry: [],
      providerConfigRepoFactory: undefined,
    });

    expect(runtime.id).toBe("native-default");
  });
});
```

Add this assertion to `packages/server/src/__tests__/session-commands.test.ts` after the existing runtime URL env check:

```ts
expect(createdSpecs[0]?.env?.CODER_STUDIO_SESSION_TOKEN).toMatch(/^[a-f0-9]{64}$/);
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/native-runtime.test.ts src/__tests__/session-commands.test.ts
```

Expected: FAIL because the extracted runtime assembly and native runtime modules do not exist yet.

- [ ] **Step 3: Implement runtime state helpers, host bridge adapters, and native runtime**

Create `packages/server/src/runtime/runtime-state.ts`:

```ts
import { join } from "node:path";

export function getRuntimeStateRoot(stateRoot: string, runtimeId: string): string {
  return join(stateRoot, "state", "runtimes", runtimeId);
}

export function getRuntimeStateFile(stateRoot: string, runtimeId: string, ...parts: string[]): string {
  return join(getRuntimeStateRoot(stateRoot, runtimeId), ...parts);
}
```

Create `packages/server/src/runtime/events.ts` with host bridge adapters:

```ts
import type { DomainEvent } from "@coder-studio/core";
import type { RuntimeHostBridge } from "./contract.js";

export function emitRuntimeEvent(hostBridge: RuntimeHostBridge, event: DomainEvent): void {
  hostBridge.emitDomainEvent(event);
}

export function broadcastRuntimeTopic(
  hostBridge: RuntimeHostBridge,
  topic: string,
  payload: unknown
): void {
  hostBridge.broadcast(topic, payload);
}
```

Update `packages/server/src/session/manager.ts` to stop owning host token/runtime URL concerns directly. Replace:

```ts
import { SessionTokenRepo } from "../auth/session-token-repo.js";

export interface SessionRuntimeContext {
  apiUrl?: string;
}
```

with bridge-driven dependencies:

```ts
import type { RuntimeHostBridge } from "../runtime/contract.js";

export interface SessionManagerDeps {
  // existing deps...
  hostBridge: RuntimeHostBridge;
}
```

Then inside `create()`:

```ts
const tokenRecord = this.deps.hostBridge.issueSessionToken({
  sessionId,
  workspaceId: req.workspaceId,
  providerId: req.providerId,
  permissions,
});

env: {
  ...cmd.env,
  CODER_STUDIO_SESSION_TOKEN: tokenRecord.token,
  ...(this.deps.hostBridge.getHostApiUrl()
    ? { CODER_STUDIO_API_URL: this.deps.hostBridge.getHostApiUrl() }
    : {}),
}
```

and replace every `this.sessionTokenRepo.revokeBySessionId(...)` call with:

```ts
this.deps.hostBridge.revokeSessionTokensBySessionId(session.id);
```

Update `packages/server/src/system-deps/install-manager.ts` so the broadcaster dependency becomes:

```ts
export interface SystemDependencyInstallManagerDeps extends RuntimeStatusDeps {
  ptyHost: PtyHost;
  hostBridge: Pick<RuntimeHostBridge, "sendToClient">;
}
```

and replace `this.deps.broadcaster.sendToClient(...)` with `this.deps.hostBridge.sendToClient(...)`.

Update `packages/server/src/storage/repositories/session-metadata-repo.ts` so the constructor depends on a small `workspaceLookup` interface instead of `WorkspaceRepo`:

```ts
interface SessionMetadataWorkspaceLookup {
  list(): SessionMetadataWorkspace[];
  get(workspaceId: string): SessionMetadataWorkspace | undefined;
}
```

Create `packages/server/src/runtime/assembly.ts` that moves the runtime-owned repo/manager graph out of `server.ts` and returns:

```ts
export interface RuntimeAssembly {
  context: RuntimeCommandContext;
  stop(): Promise<void>;
}
```

Create `packages/server/src/runtime/native-runtime.ts`:

```ts
import { executeRuntimeCommand } from "../ws/dispatch.js";
import type { RuntimeHandle, RuntimeHostBridge } from "./contract.js";
import { assembleRuntime } from "./assembly.js";

export async function createNativeRuntime(input: {
  runtimeId: string;
  stateRoot: string;
  hostBridge: RuntimeHostBridge;
  providerRegistry: ProviderDefinition[];
  workspaceLookup: RuntimeCommandContext["workspaceLookup"];
  providerRuntimeDeps?: RuntimeStatusDeps;
}): Promise<RuntimeHandle> {
  const assembly = await assembleRuntime(input);
  return {
    id: input.runtimeId,
    kind: "native",
    execute: (op, args, meta) => executeRuntimeCommand(op, args, assembly.context, meta),
    disposeWorkspace: async (workspaceId) => {
      await assembly.context.lspMgr.disposeWorkspace(workspaceId);
      await assembly.context.sessionMgr.stopForWorkspace(workspaceId);
      assembly.context.sessionMgr.deleteEndedForWorkspace(workspaceId);
      assembly.context.taskMgr.clearWorkspace(workspaceId);
      await assembly.context.terminalMgr.closeForWorkspace(workspaceId);
    },
    setProviderRegistry: (providers) => {
      assembly.context.providerRegistry = providers;
      assembly.context.sessionMgr.setProviderRegistry(providers);
      assembly.context.supervisorMgr.setProviderRegistry(providers);
    },
    health: async () => ({ ok: true }),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/native-runtime.test.ts src/__tests__/session-commands.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/runtime/runtime-state.ts packages/server/src/runtime/events.ts packages/server/src/runtime/assembly.ts packages/server/src/runtime/native-runtime.ts packages/server/src/session/manager.ts packages/server/src/system-deps/install-manager.ts packages/server/src/storage/repositories/session-metadata-repo.ts packages/server/src/__tests__/runtime/native-runtime.test.ts packages/server/src/__tests__/session-commands.test.ts
git commit -m "refactor: extract native runtime assembly"
```

### Task 5: Rebuild Server Bootstrap Around Host And Runtime

**Files:**
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/commands/index.ts`
- Modify: `packages/server/src/__tests__/server-builtin-skills-wiring.test.ts`
- Modify: `packages/server/src/__tests__/server-lsp-runtime-mode-hydration.test.ts`
- Modify: `packages/server/src/__tests__/server-runtime-config.test.ts`

- [ ] **Step 1: Write the failing bootstrap assertions**

Add this assertion to `packages/server/src/__tests__/server-builtin-skills-wiring.test.ts`:

```ts
expect(server.__test__?.hostContext.runtimeRouter).toBeDefined();
expect(server.__test__?.nativeRuntime).toBeDefined();
```

Add this assertion to `packages/server/src/__tests__/server-lsp-runtime-mode-hydration.test.ts`:

```ts
expect(server.__test__?.nativeRuntime).toBeDefined();
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/server-builtin-skills-wiring.test.ts src/__tests__/server-lsp-runtime-mode-hydration.test.ts src/__tests__/server-runtime-config.test.ts
```

Expected: FAIL because `createServer()` still exposes a monolithic `commandContext` instead of host/runtime pieces.

- [ ] **Step 3: Move runtime assembly out of `server.ts` and wire host bridge + router**

Refactor `packages/server/src/server.ts` so host-owned assembly stays in `createServer()` and runtime-owned assembly moves behind `createNativeRuntime()`. The key shape should become:

```ts
const eventBus = new EventBus();
const activationMgr = new ActivationManager();
const fencingMgr = new FencingManager();
const wsHub = new WsHub({ eventBus, commandContext: null, config, fencingMgr });

const bindings = new WorkspaceRuntimeBindingStore();
const runtimeRegistry = new RuntimeRegistry();
const runtimeRouter = new RuntimeRouter({
  runtimeRegistry,
  bindings,
  defaultRuntimeId: "native-default",
});

const hostBridge = {
  issueSessionToken: (input) => sessionTokenRepo.issue(input),
  revokeSessionTokensBySessionId: (sessionId) => sessionTokenRepo.revokeBySessionId(sessionId),
  getHostApiUrl: () =>
    `http://${config.host === "0.0.0.0" ? "127.0.0.1" : config.host}:${config.port}`,
  emitDomainEvent: (event) => {
    eventBus.emit(event);
    if (event.type === "session.state.changed" && event.session) {
      bindings.bindSession(event.session);
    }
    if (event.type === "session.lifecycle" && event.event === "removed") {
      bindings.removeSession(event.sessionId);
    }
    if (event.type === "terminal.created") {
      bindings.bindTerminal({
        id: event.terminalId,
        workspaceId: event.workspaceId,
        kind: event.kind,
        title: event.title,
        cwd: event.cwd,
      } as never);
    }
    if (event.type === "terminal.exited") {
      bindings.removeTerminal(event.terminalId);
    }
  },
  broadcast: (topic, payload) => wsHub.broadcast(topic, payload),
  sendToClient: (clientId, payload) => wsHub.sendToClient(clientId as never, payload as never),
  sendBinaryToClient: (clientId, payload) => wsHub.sendBinaryToClient(clientId as never, payload),
} satisfies RuntimeHostBridge;

const nativeRuntime = await createNativeRuntime({
  runtimeId: "native-default",
  stateRoot,
  hostBridge,
  providerRegistry: activeProviderRegistry,
  workspaceLookup: workspaceMgr,
  providerRuntimeDeps,
});

runtimeRegistry.register(nativeRuntime);
```

Change `packages/server/src/commands/index.ts` from side-effect-only imports into explicit registration functions:

```ts
export function registerHostCommands(): void { ... }
export function registerRuntimeCommands(): void { ... }
```

Then `createServer()` should call both registration functions after building the router.

Expose this new test surface:

```ts
return {
  app,
  stop: stopServer,
  __test__: {
    hostContext,
    nativeRuntime,
    sessionTokenRepo,
  },
};
```

Keep runtime config writing behavior unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/server-builtin-skills-wiring.test.ts src/__tests__/server-lsp-runtime-mode-hydration.test.ts src/__tests__/server-runtime-config.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/server.ts packages/server/src/commands/index.ts packages/server/src/__tests__/server-builtin-skills-wiring.test.ts packages/server/src/__tests__/server-lsp-runtime-mode-hydration.test.ts packages/server/src/__tests__/server-runtime-config.test.ts
git commit -m "refactor: bootstrap server around host and native runtime"
```

### Task 6: Route Dispatch Through Host And Runtime Registries

**Files:**
- Modify: `packages/server/src/ws/dispatch.ts`
- Modify: `packages/server/src/ws/hub.ts`
- Test: `packages/server/src/__tests__/dispatch.test.ts`

- [ ] **Step 1: Write the failing dispatch-routing tests**

Add these tests to `packages/server/src/__tests__/dispatch.test.ts`:

```ts
it("dispatches runtime commands through the runtime router", async () => {
  const executeOnTarget = vi.fn(async () => ({ ok: true }));
  ctx = {
    ...ctx,
    runtimeRouter: { executeOnTarget } as never,
  };

  registerRuntimeCommand(
    "runtime.echo",
    z.object({ workspaceId: z.string(), message: z.string() }),
    {
      resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
      handler: async () => ({ echoed: true }),
    }
  );

  const result = await dispatch(
    {
      kind: "command",
      id: "runtime-dispatch-1",
      op: "runtime.echo",
      args: { workspaceId: "ws-test", message: "hello" },
    },
    ctx
  );

  expect(result.ok).toBe(true);
  expect(executeOnTarget).toHaveBeenCalledWith(
    { kind: "workspace", workspaceId: "ws-test" },
    "runtime.echo",
    { workspaceId: "ws-test", message: "hello" },
    expect.anything()
  );
});

it("checks terminal session scope from host projections instead of runtime managers", async () => {
  ctx = {
    ...ctx,
    runtimeBindings: {
      findWorkspaceIdByTerminalId: vi.fn(() => "ws-1"),
      findSessionIdByTerminalId: vi.fn(() => "sess-1"),
    } as never,
  };

  expect(ctx.runtimeBindings.findSessionIdByTerminalId("term-1")).toBe("sess-1");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/dispatch.test.ts
```

Expected: FAIL because `dispatch()` still uses the old single handler map and single `CommandContext`.

- [ ] **Step 3: Implement host/runtime dispatch with auth preserved on host**

Refactor `packages/server/src/ws/dispatch.ts` into three entry points:

```ts
export async function dispatch(
  msg: Command,
  ctx: HostCommandContext,
  clientId?: string
): Promise<Result> { ... }

export async function executeHostCommand(
  op: string,
  args: unknown,
  ctx: HostCommandContext,
  meta?: HostDispatchMeta
): Promise<unknown> { ... }

export async function executeRuntimeCommand(
  op: string,
  args: unknown,
  ctx: RuntimeCommandContext,
  meta?: RuntimeExecuteMeta
): Promise<unknown> { ... }
```

Host dispatch should keep current behavior for:
- activation gating
- session-token allowlist checks
- schema validation
- unknown-op normalization

Then route commands like this:

```ts
const hostDefinition = getHostCommandDefinition(msg.op);
if (hostDefinition) {
  const args = hostDefinition.schema.parse(msg.args);
  const data = await hostDefinition.handler(args, ctx, { clientId, authContext });
  return { kind: "result", id: msg.id, ok: true, data };
}

const runtimeDefinition = getRuntimeCommandDefinition(msg.op);
if (runtimeDefinition) {
  const args = runtimeDefinition.schema.parse(msg.args);
  const target = runtimeDefinition.resolveTarget(args);
  const data = await ctx.runtimeRouter.executeOnTarget(target, msg.op, args, {
    clientId,
    authContext,
  });
  return { kind: "result", id: msg.id, ok: true, data };
}
```

Update terminal-related session-token scope checks to read from host projections:

```ts
const sessionId = ctx.runtimeBindings.findSessionIdByTerminalId(terminalId);
```

Keep `normalizeError()` untouched so wire behavior does not change.

Update `packages/server/src/ws/hub.ts` only enough for this task to type against `HostCommandContext` instead of the removed monolithic `CommandContext`.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/dispatch.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/ws/dispatch.ts packages/server/src/ws/hub.ts packages/server/src/__tests__/dispatch.test.ts
git commit -m "refactor: route websocket dispatch through host and runtime registries"
```

### Task 7: Migrate Batch 1 Runtime Commands And Host-Orchestrated Workspace/Session Flow

**Files:**
- Modify: `packages/server/src/commands/workspace.ts`
- Modify: `packages/server/src/commands/session.ts`
- Modify: `packages/server/src/commands/terminal.ts`
- Modify: `packages/server/src/commands/file.ts`
- Modify: `packages/server/src/commands/git.ts`
- Modify: `packages/server/src/commands/recovery.ts`
- Modify: `packages/server/src/commands/task.ts`
- Modify: `packages/server/src/commands/lsp.ts`
- Modify: `packages/server/src/commands/worktree.ts`
- Test: `packages/server/src/__tests__/workspace-commands.test.ts`
- Test: `packages/server/src/__tests__/session-commands.test.ts`
- Test: `packages/server/src/__tests__/terminal-commands.test.ts`
- Test: `packages/server/src/__tests__/file-commands.test.ts`
- Test: `packages/server/src/__tests__/git-commands.test.ts`
- Test: `packages/server/src/__tests__/task-commands.test.ts`
- Test: `packages/server/src/__tests__/lsp-commands.test.ts`
- Test: `packages/server/src/__tests__/worktree-commands.test.ts`

- [ ] **Step 1: Write the failing routing tests for representative batch-1 commands**

Add one route assertion to each of the following:

In `packages/server/src/__tests__/session-commands.test.ts`:

```ts
expect(ctx.runtimeBindings?.findWorkspaceIdBySessionId(openResult.data!.id)).toBeUndefined();
```

Then replace it after migration with:

```ts
expect(ctx.runtimeBindings.findWorkspaceIdBySessionId(result.data!.id)).toBe(openResult.data!.id);
```

In `packages/server/src/__tests__/terminal-commands.test.ts` add:

```ts
expect(sendCommand).toHaveBeenCalledWith("terminal.read", { terminalId: "term-1" }, undefined);
```

In `packages/server/src/__tests__/workspace-commands.test.ts` add:

```ts
expect(result.data).toMatchObject({ targetRuntime: "native" });
```

- [ ] **Step 2: Run the batch-1 tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/workspace-commands.test.ts src/__tests__/session-commands.test.ts src/__tests__/terminal-commands.test.ts src/__tests__/file-commands.test.ts src/__tests__/git-commands.test.ts src/__tests__/task-commands.test.ts src/__tests__/lsp-commands.test.ts src/__tests__/worktree-commands.test.ts
```

Expected: FAIL because these command files still register against the host/global registry and `workspace.open` / `session.close` are not orchestrating runtime routing yet.

- [ ] **Step 3: Move batch-1 commands behind `registerRuntimeCommand()` and make host flows orchestrate them**

Convert the following command registrations:

- `file.*` — route by `{ kind: "workspace", workspaceId: args.workspaceId }`
- `git.*` — route by workspace for most ops; route by terminal/session projections only if a command truly lacks `workspaceId`
- `recovery.reconcile` — route by `{ kind: "terminal", terminalId: args.terminals[0]!.terminalId }`
- `task.*` — route by workspace
- `lsp.*` — route by workspace for all existing ops except `lsp.install.get`, which should use `{ kind: "default" }` in Phase 1 because jobs are runtime-global
- `worktree.*` — route by workspace
- `session.list` / `session.create` — route by workspace
- `session.stop` / `session.remove` — route by session
- `terminal.read` / `terminal.replay` / `terminal.snapshot` / `terminal.close` / `terminal.input` / `terminal.resize` — route by terminal
- `terminal.create` / `terminal.list` / `terminal.syncThemeBackground` — route by workspace

Use this pattern in `packages/server/src/commands/terminal.ts`:

```ts
registerRuntimeCommand(
  "terminal.read",
  z.object({
    terminalId: z.string(),
    bytes: z.number().int().positive().max(MAX_TERMINAL_READ_BYTES).optional(),
  }),
  {
    resolveTarget: (args) => ({ kind: "terminal", terminalId: args.terminalId }),
    handler: async (args, ctx, meta) => {
      const bytes = args.bytes ?? DEFAULT_TERMINAL_READ_BYTES;
      const tail = ctx.terminalMgr.getRingBufferTail(args.terminalId, bytes);
      return { terminalId: args.terminalId, bytes, text: tail.toString("utf8") };
    },
  }
);
```

Rewrite `workspace.open` as a host command:

```ts
registerHostCommand(
  "workspace.open",
  z.object({ path: z.string() }),
  async (args, ctx) => {
    const targetRuntime = "native";
    const workspace = await ctx.workspaceMgr.open({
      path: args.path,
      targetRuntime,
    });
    ctx.runtimeBindings.bindWorkspace(workspace.id, "native-default");
    new WorkspaceHistoryStore(ctx.settingsRepo).recordOpen(workspace.path);
    return workspace;
  }
);
```

Keep `session.close` host-side and implement it as orchestration:

```ts
registerHostCommand(
  "session.close",
  z.object({
    sessionId: z.string(),
    paneDisposition: z.enum(["draft", "remove"]).default("draft"),
  }),
  async (args, ctx) => {
    const workspaceId = ctx.runtimeBindings.findWorkspaceIdBySessionId(args.sessionId);
    if (!workspaceId) {
      throw { code: "workspace_not_found", message: `Workspace not found for session: ${args.sessionId}` };
    }

    await ctx.runtimeRouter.executeOnTarget(
      { kind: "session", sessionId: args.sessionId },
      "session.stop",
      { sessionId: args.sessionId }
    );

    const workspace = ctx.workspaceMgr.get(workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${workspaceId}` };
    }

    ctx.workspaceMgr.updateUiState(workspaceId, {
      ...workspace.uiState,
      paneLayout: applyPaneDisposition(workspace.uiState.paneLayout, args.sessionId, args.paneDisposition),
    });

    await ctx.runtimeRouter.executeOnTarget(
      { kind: "session", sessionId: args.sessionId },
      "session.remove",
      { sessionId: args.sessionId }
    );
    ctx.runtimeBindings.removeSession(args.sessionId);
  }
);
```

Also move `workspace.intelligence` from `workspace.ts` to runtime registration using `{ kind: "workspace", workspaceId: args.workspaceId }`, and keep `workspace.close` host-side so it can call `runtimeHandle.disposeWorkspace()` before deleting host metadata and uploads.

- [ ] **Step 4: Run the batch-1 tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/workspace-commands.test.ts src/__tests__/session-commands.test.ts src/__tests__/terminal-commands.test.ts src/__tests__/file-commands.test.ts src/__tests__/git-commands.test.ts src/__tests__/task-commands.test.ts src/__tests__/lsp-commands.test.ts src/__tests__/worktree-commands.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/commands/workspace.ts packages/server/src/commands/session.ts packages/server/src/commands/terminal.ts packages/server/src/commands/file.ts packages/server/src/commands/git.ts packages/server/src/commands/recovery.ts packages/server/src/commands/task.ts packages/server/src/commands/lsp.ts packages/server/src/commands/worktree.ts packages/server/src/__tests__/workspace-commands.test.ts packages/server/src/__tests__/session-commands.test.ts packages/server/src/__tests__/terminal-commands.test.ts packages/server/src/__tests__/file-commands.test.ts packages/server/src/__tests__/git-commands.test.ts packages/server/src/__tests__/task-commands.test.ts packages/server/src/__tests__/lsp-commands.test.ts packages/server/src/__tests__/worktree-commands.test.ts
git commit -m "refactor: route batch one commands through runtime handles"
```

### Task 8: Bridge Runtime-Backed Provider Config, Diagnostics, And Batch 2 Commands

**Files:**
- Modify: `packages/server/src/commands/provider.ts`
- Modify: `packages/server/src/commands/system-deps.ts`
- Modify: `packages/server/src/commands/settings.ts`
- Modify: `packages/server/src/commands/diagnostics.ts`
- Modify: `packages/server/src/commands/custom-provider.ts`
- Test: `packages/server/src/commands/settings.test.ts`
- Test: `packages/server/src/__tests__/diagnostics-commands.test.ts`
- Test: `packages/server/src/__tests__/provider-runtime/runtime-status.test.ts`
- Test: `packages/server/src/__tests__/provider-runtime/install-manager.test.ts`
- Test: `packages/server/src/__tests__/system-deps/commands.test.ts`
- Test: `packages/server/src/__tests__/server-provider-install-wiring.test.ts`

- [ ] **Step 1: Write the failing settings/diagnostics bridge tests**

Add this test to `packages/server/src/commands/settings.test.ts`:

```ts
it("settings.previewCommand reads provider config through the runtime bridge", async () => {
  ctx.runtimeRouter = {
    executeOnTarget: vi.fn(async () => ({
      argv: ["claude", "--print"],
      cwd: "/repo",
      env: { REVIEW_MODE: "strict" },
      preview: "claude --print  # cwd=/repo",
    })),
  } as never;

  const result = await dispatch(
    {
      kind: "command",
      id: "settings-preview-runtime",
      op: "settings.previewCommand",
      args: {
        providerId: "claude",
        config: {},
      },
    },
    ctx
  );

  expect(result.ok).toBe(true);
  expect(ctx.runtimeRouter.executeOnTarget).toHaveBeenCalled();
});
```

Add this test to `packages/server/src/__tests__/diagnostics-commands.test.ts`:

```ts
it("aggregates runtime checks through the runtime router", async () => {
  ctx.runtimeRouter = {
    executeOnTarget: vi.fn(async (target, op) => {
      if (op === "systemDeps.runtimeStatus") {
        return {
          dependencies: {
            git: { dependencyId: "git", available: true, autoInstallSupported: true, installReadiness: "ready", manualGuideKeys: [] },
            node: { dependencyId: "node", available: true, autoInstallSupported: true, installReadiness: "ready", manualGuideKeys: [] },
          },
        };
      }
      if (op === "provider.runtimeStatus") {
        return { providers: {} };
      }
      return { lspServices: [] };
    }),
  } as never;
});
```

- [ ] **Step 2: Run the batch-2 tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/commands/settings.test.ts src/__tests__/diagnostics-commands.test.ts src/__tests__/provider-runtime/runtime-status.test.ts src/__tests__/provider-runtime/install-manager.test.ts src/__tests__/system-deps/commands.test.ts src/__tests__/server-provider-install-wiring.test.ts
```

Expected: FAIL because these commands still reach runtime managers and provider config repos directly from the host context.

- [ ] **Step 3: Split host and runtime responsibilities for provider config and diagnostics**

Keep `provider.list` as a host command, but move these existing public ops to runtime registration:

- `provider.runtimeStatus` → `{ kind: "default" }`
- `provider.install.start` → `{ kind: "default" }`
- `provider.install.get` → `{ kind: "default" }`
- `systemDeps.runtimeStatus` → `{ kind: "default" }`
- `systemDeps.install.*` → `{ kind: "default" }`

Add internal runtime-only provider config bridge ops in `packages/server/src/commands/provider.ts`:

```ts
registerRuntimeCommand(
  "provider.config.getAll",
  z.object({}),
  {
    resolveTarget: () => ({ kind: "default" }),
    handler: async (_args, ctx) => ctx.providerConfigRepo.getAll(),
  }
);

registerRuntimeCommand(
  "provider.config.merge",
  z.object({
    providerId: z.string(),
    config: z.record(z.string(), z.unknown()),
  }),
  {
    resolveTarget: () => ({ kind: "default" }),
    handler: async (args, ctx) => {
      const provider = getProviderFromRegistryOrThrow(ctx.providerRegistry, args.providerId);
      const merged = mergeProviderConfigs(provider, ctx.providerConfigRepo.get(args.providerId), args.config);
      ctx.providerConfigRepo.set(args.providerId, merged);
      return merged;
    },
  }
);

registerRuntimeCommand(
  "provider.previewCommand",
  z.object({
    providerId: z.string(),
    config: z.record(z.string(), z.unknown()),
    workspacePath: z.string().optional(),
  }),
  {
    resolveTarget: () => ({ kind: "default" }),
    handler: async (args, ctx) => {
      const provider = getProviderFromRegistryOrThrow(ctx.providerRegistry, args.providerId);
      const command = provider.buildCommand(
        mergeProviderConfigs(provider, ctx.providerConfigRepo.get(provider.id), args.config),
        {
          sessionId: "preview-session",
          workspacePath: args.workspacePath ?? process.cwd(),
        }
      );
      return {
        argv: command.argv,
        cwd: command.cwd,
        env: command.env,
        preview: `${command.argv.join(" ")}${command.cwd ? `  # cwd=${command.cwd}` : ""}`,
      };
    },
  }
);
```

Update `packages/server/src/commands/settings.ts`:

- `settings.get` stays host-owned for normal settings, then overlays runtime provider config by calling:

```ts
const providerConfigs = (await ctx.runtimeRouter.executeOnTarget(
  { kind: "default" },
  "provider.config.getAll",
  {}
)) as Record<string, ProviderConfig>;
```

- `settings.update` persists host settings locally, then for each `providers.<id>` branch calls:

```ts
await ctx.runtimeRouter.executeOnTarget(
  { kind: "default" },
  "provider.config.merge",
  { providerId, config }
);
```

- `settings.previewCommand` becomes a host command that forwards to runtime:

```ts
return ctx.runtimeRouter.executeOnTarget(
  { kind: "default" },
  "provider.previewCommand",
  args
);
```

Update `packages/server/src/commands/diagnostics.ts` so it becomes host-orchestrated:

- keep workspace path validation, auth, and host checks local
- replace direct calls to `buildProviderRuntimeStatus()`, `buildSystemDependencyRuntimeStatus()`, and `ctx.lspToolMgr.runtimeStatus()` with runtime router calls to `provider.runtimeStatus`, `systemDeps.runtimeStatus`, and `lsp.runtimeStatus`
- keep `fencing.*` host-only; do not route it through runtime

Update `packages/server/src/commands/custom-provider.ts` so host custom provider mutations still write `CustomProviderRepo`, but now fan out provider definitions through:

```ts
ctx.setProviderRegistry?.(providers);
ctx.runtimeRouter.setProviderRegistry?.(providers);
```

- [ ] **Step 4: Run the batch-2 tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/commands/settings.test.ts src/__tests__/diagnostics-commands.test.ts src/__tests__/provider-runtime/runtime-status.test.ts src/__tests__/provider-runtime/install-manager.test.ts src/__tests__/system-deps/commands.test.ts src/__tests__/server-provider-install-wiring.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/commands/provider.ts packages/server/src/commands/system-deps.ts packages/server/src/commands/settings.ts packages/server/src/commands/diagnostics.ts packages/server/src/commands/custom-provider.ts packages/server/src/commands/settings.test.ts packages/server/src/__tests__/diagnostics-commands.test.ts packages/server/src/__tests__/provider-runtime/runtime-status.test.ts packages/server/src/__tests__/provider-runtime/install-manager.test.ts packages/server/src/__tests__/system-deps/commands.test.ts packages/server/src/__tests__/server-provider-install-wiring.test.ts
git commit -m "refactor: bridge provider config and diagnostics through runtime router"
```

### Task 9: Migrate Batch 3 Runtime Commands, Host Projections, And Final Host Consumers

**Files:**
- Modify: `packages/server/src/commands/agent-context.ts`
- Modify: `packages/server/src/commands/agent-instructions.ts`
- Modify: `packages/server/src/commands/skills.ts`
- Modify: `packages/server/src/commands/skills/*.ts`
- Modify: `packages/server/src/commands/supervisor.ts`
- Modify: `packages/server/src/commands/session-metadata.ts`
- Modify: `packages/server/src/commands/session-review.ts`
- Modify: `packages/server/src/commands/work-analysis.ts`
- Modify: `packages/server/src/commands/fencing.ts`
- Modify: `packages/server/src/commands/automation.ts`
- Modify: `packages/server/src/commands/activation.ts`
- Modify: `packages/server/src/commands/connection.ts`
- Modify: `packages/server/src/commands/memory.ts`
- Modify: `packages/server/src/commands/monitoring.ts`
- Modify: `packages/server/src/commands/updates.ts`
- Modify: `packages/server/src/commands/ui-actions.ts`
- Modify: `packages/server/src/commands/workspace-activity.ts`
- Modify: `packages/server/src/ws/hub.ts`
- Modify: `packages/server/src/monitoring/service.ts`
- Modify: `packages/server/src/__tests__/skills/commands.test.ts`
- Modify: `packages/server/src/__tests__/agent-context-command.test.ts`
- Modify: `packages/server/src/__tests__/agent-instructions-command.test.ts`
- Modify: `packages/server/src/__tests__/session-analysis-commands.test.ts`
- Modify: `packages/server/src/__tests__/session-review-command.test.ts`
- Modify: `packages/server/src/__tests__/supervisor-commands.test.ts`
- Modify: `packages/server/src/__tests__/work-analysis-commands.test.ts`
- Modify: `packages/server/src/__tests__/ws-hub.test.ts`
- Modify: `packages/server/src/__tests__/monitoring/service.test.ts`
- Modify: `packages/server/src/__tests__/server-memory-wiring.test.ts`

- [ ] **Step 1: Write the failing projection and batch-3 migration tests**

Add a `WsHub` resync assertion in `packages/server/src/__tests__/ws-hub.test.ts` that expects resync to send sessions from the binding store rather than a runtime manager mock.

Add a monitoring assertion in `packages/server/src/__tests__/monitoring/service.test.ts` that uses only projected sessions/terminals.

Add one runtime registration assertion to a representative skills test:

```ts
expect(sendCommand).toHaveBeenCalledWith("skills.library.list", {}, undefined);
```

and one agent-instructions assertion that still calls:

```ts
expect(sendCommand).toHaveBeenCalledWith(
  "agentInstructions.generateAndWriteByAgent",
  { workspaceId },
  expect.anything()
);
```

- [ ] **Step 2: Run the batch-3 and host-consumer tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/skills/commands.test.ts src/__tests__/agent-context-command.test.ts src/__tests__/agent-instructions-command.test.ts src/__tests__/session-analysis-commands.test.ts src/__tests__/session-review-command.test.ts src/__tests__/supervisor-commands.test.ts src/__tests__/work-analysis-commands.test.ts src/__tests__/ws-hub.test.ts src/__tests__/monitoring/service.test.ts src/__tests__/server-memory-wiring.test.ts
```

Expected: FAIL because these command modules still import the old registration API and `WsHub` / `MonitoringService` still read directly from runtime managers.

- [ ] **Step 3: Migrate batch-3 runtime commands and make final host services read projections**

Move these command groups to `registerRuntimeCommand()`:

- `agent-context.*`
- `agentInstructions.*`
- `skills.*`
- `session.analysis.*`
- `session.review.*`
- `work.analysis.*`
- `supervisor.*`

Use `{ kind: "default" }` for runtime-global compatibility flows in Phase 1:

- `skills.library.list`
- `skills.search`
- `skills.versions.check`
- `skills.install.*`
- `skills.health.scan`
- `skills.targets.list`
- `skills.files.*`
- `supervisor.*` ops that only carry `supervisorId`

Use workspace routing where the wire format already has it:

- `skills.recommend`
- `agentInstructions.generateAndWriteByAgent`
- `agentInstructions.status`
- `agent-context.package`
- `work.analysis.*` when `workspaceId` is present

Keep these commands host-only and switch them to `registerHostCommand()`:

- `automation.*`
- `activation.*`
- `connection.probe`
- `memory.*`
- `monitoring.*`
- `updates.*`
- `uiAction.*`
- `workspace.activate`
- `workspace.deactivate`
- `workspace.lastViewedTarget.*`
- `workspace.history.*`
- `fencing.*`

Then update host consumers:

In `packages/server/src/ws/hub.ts`, replace direct resync reads from `sessionMgr` with the binding store:

```ts
const workspaces = commandContext.workspaceMgr.list();
for (const workspace of workspaces) {
  const sessions = commandContext.runtimeBindings.listSessionsForWorkspace(workspace.id);
  for (const session of sessions) {
    // existing topic fan-out
  }
}
```

In `packages/server/src/monitoring/service.ts`, inject projection access instead of runtime managers:

```ts
sessionStore: {
  getAll(): Session[];
  findSessionIdByTerminal(terminalId: string): string | undefined;
}
terminalStore: {
  getAll(): Terminal[];
}
```

Back them with `WorkspaceRuntimeBindingStore`.

Also update `UpdateService` count lambdas in `server.ts` to use projections instead of direct `sessionMgr` / `terminalMgr` reads, so runtime extraction does not leave host services peeking back into runtime managers.

Finish by removing any remaining command-file imports of the legacy `registerCommand()` helper.

- [ ] **Step 4: Run the batch-3 and host-consumer tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/skills/commands.test.ts src/__tests__/agent-context-command.test.ts src/__tests__/agent-instructions-command.test.ts src/__tests__/session-analysis-commands.test.ts src/__tests__/session-review-command.test.ts src/__tests__/supervisor-commands.test.ts src/__tests__/work-analysis-commands.test.ts src/__tests__/ws-hub.test.ts src/__tests__/monitoring/service.test.ts src/__tests__/server-memory-wiring.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/commands/agent-context.ts packages/server/src/commands/agent-instructions.ts packages/server/src/commands/skills.ts packages/server/src/commands/skills packages/server/src/commands/supervisor.ts packages/server/src/commands/session-metadata.ts packages/server/src/commands/session-review.ts packages/server/src/commands/work-analysis.ts packages/server/src/commands/fencing.ts packages/server/src/commands/automation.ts packages/server/src/commands/activation.ts packages/server/src/commands/connection.ts packages/server/src/commands/memory.ts packages/server/src/commands/monitoring.ts packages/server/src/commands/updates.ts packages/server/src/commands/ui-actions.ts packages/server/src/commands/workspace-activity.ts packages/server/src/ws/hub.ts packages/server/src/monitoring/service.ts packages/server/src/__tests__/skills/commands.test.ts packages/server/src/__tests__/agent-context-command.test.ts packages/server/src/__tests__/agent-instructions-command.test.ts packages/server/src/__tests__/session-analysis-commands.test.ts packages/server/src/__tests__/session-review-command.test.ts packages/server/src/__tests__/supervisor-commands.test.ts packages/server/src/__tests__/work-analysis-commands.test.ts packages/server/src/__tests__/ws-hub.test.ts packages/server/src/__tests__/monitoring/service.test.ts packages/server/src/__tests__/server-memory-wiring.test.ts
git commit -m "refactor: finish runtime command migration and host projections"
```

### Task 10: Final Verification And Cleanup

**Files:**
- Modify as needed based on failing verification output from Tasks 1-9

- [ ] **Step 1: Run the targeted server suites**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/host-command-registry.test.ts src/__tests__/runtime-command-registry.test.ts src/__tests__/runtime-router.test.ts src/__tests__/workspace-runtime-binding.test.ts src/__tests__/workspace/manager.test.ts src/__tests__/workspace/manager-on-close.test.ts src/__tests__/workspace-commands.test.ts src/__tests__/runtime/native-runtime.test.ts src/__tests__/server-builtin-skills-wiring.test.ts src/__tests__/server-lsp-runtime-mode-hydration.test.ts src/__tests__/server-runtime-config.test.ts src/__tests__/dispatch.test.ts src/__tests__/session-commands.test.ts src/__tests__/terminal-commands.test.ts src/__tests__/file-commands.test.ts src/__tests__/git-commands.test.ts src/__tests__/task-commands.test.ts src/__tests__/lsp-commands.test.ts src/__tests__/worktree-commands.test.ts src/commands/settings.test.ts src/__tests__/diagnostics-commands.test.ts src/__tests__/provider-runtime/runtime-status.test.ts src/__tests__/provider-runtime/install-manager.test.ts src/__tests__/system-deps/commands.test.ts src/__tests__/skills/commands.test.ts src/__tests__/agent-context-command.test.ts src/__tests__/agent-instructions-command.test.ts src/__tests__/session-analysis-commands.test.ts src/__tests__/session-review-command.test.ts src/__tests__/supervisor-commands.test.ts src/__tests__/work-analysis-commands.test.ts src/__tests__/ws-hub.test.ts src/__tests__/monitoring/service.test.ts src/__tests__/server-memory-wiring.test.ts src/__tests__/server-provider-install-wiring.test.ts
```

Expected: PASS

- [ ] **Step 2: Run repository-level verification**

Run:

```bash
pnpm ci:verify
```

Expected: PASS

- [ ] **Step 3: Fix only the failing areas if verification reveals drift**

If a failure points back to an old host/runtime leak, fix it in the smallest possible place rather than adding another compatibility shim. Typical final fixes should be in:

```ts
// packages/server/src/ws/dispatch.ts
// packages/server/src/ws/hub.ts
// packages/server/src/server.ts
// packages/server/src/commands/settings.ts
// packages/server/src/host/workspace-runtime-binding.ts
```

- [ ] **Step 4: Re-run the failing verification command(s) until green**

Run only the commands that failed in Steps 1-2, then re-run:

```bash
pnpm ci:verify
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src
git commit -m "refactor: complete runtime extraction phase one"
```

## Self-Review

**Spec coverage:** This plan covers the spec’s required host/runtime context split, command registry split, in-process `NativeRuntimeHandle`, runtime assembly extraction, workspace/runtime binding, command migration in batches, host-controlled HTTP/WS transport, skills/runtime ownership, and preservation of the host callback model. It also adds the repo-grounded gaps discovered during code review: runtime-global compatibility routing for no-`workspaceId` commands, settings/provider-config bridging, `WsHub.resync` projections, update-service counting, monitoring projections, and `SessionMetadataRepo` workspace lookup decoupling.

**Placeholder scan:** No `TBD`, `TODO`, or “implement later” placeholders remain. The compatibility behavior for runtime-global commands is explicit rather than implicit.

**Type consistency:** The plan uses one route-target vocabulary everywhere: `workspace`, `session`, `terminal`, and `default`. Host dispatch uses `HostCommandContext`; runtime execution uses `RuntimeCommandContext`; runtime execution metadata uses `RuntimeExecuteMeta`; runtime access goes through `RuntimeRouter` and `RuntimeHandle`.

Plan complete and saved to `docs/superpowers/plans/2026-06-21-runtime-extraction-phase1-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
