# WSL Distro Bridge Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-workspace WSL runtime launches with one host-managed bridge/runtime per WSL distro, shared by desktop and CLI, with strict host/WSL runtime version equality and managed per-distro Node.

**Architecture:** Keep the existing server runtime core as the execution engine, but move WSL lifecycle control into a host broker that manages one runtime store and one bridge daemon per distro. Desktop and CLI both delegate WSL startup and update decisions to the same shared broker path. The bridge stays RPC-based and serves multiple workspaces inside one distro, while the broker owns install, upgrade, stop, and health-check policy.

**Tech Stack:** TypeScript, pnpm workspaces, Node.js `fs/promises`, JSON-RPC over sockets, existing runtime store/installer primitives, Vitest.

**Spec reference:** `docs/superpowers/specs/2026-06-30-wsl-distro-bridge-runtime-design.md`

---

## File Structure

**Create:**

- `packages/server/src/runtime/wsl-distro-store.ts` - distro-local runtime/node store layout, pointer state, and version helpers
- `packages/server/src/runtime/wsl-bridge-contract.ts` - distro bridge RPC payloads and info/health types
- `packages/server/src/runtime/wsl-bridge-manager.ts` - host-side broker for per-distro bridge lifecycle
- `packages/server/src/runtime/wsl-node-store.ts` - managed per-distro Node resolution and compatibility helpers
- `packages/server/src/__tests__/runtime/wsl-distro-store.test.ts` - layout and pointer behavior tests
- `packages/server/src/__tests__/runtime/wsl-bridge-manager.test.ts` - lifecycle, reuse, stop, and version-drift tests
- `packages/server/src/__tests__/runtime/wsl-node-store.test.ts` - Node compatibility and resolution tests

**Modify:**

- `packages/server/src/runtime/wsl-bootstrap.ts` - stop treating WSL launch as per-workspace-only and add bridge-aware launch metadata
- `packages/server/src/runtime/wsl-runtime.ts` - create or attach to a per-distro bridge instead of always spawning a workspace-scoped runtime
- `packages/server/src/host/runtime-orchestrator.ts` - switch runtime identity from workspace-scoped WSL ids to distro bridge ids
- `packages/server/src/runtime/remote/protocol.ts` - extend RPC payloads with bridge-level info and lifecycle messages
- `packages/server/src/runtime/contract.ts` - reflect bridge-scoped WSL runtime summaries
- `packages/server/src/runtime/runtime-state.ts` - ensure WSL runtime state is stored per distro/bridge rather than per workspace
- `packages/server/src/server.ts` - wire the shared broker into runtime creation, snapshot sync, and host shutdown
- `packages/server/src/commands/workspace.ts` - keep workspace open/close commands aligned with distro-level runtime binding
- `packages/server/src/commands/diagnostics.ts` - surface distro runtime/Node/bridge state in diagnostics
- `packages/desktop/src/desktop-startup.ts` - make desktop startup delegate WSL runtime policy to shared broker logic
- `packages/cli/src/server-runner.ts` - keep CLI startup aligned with the same runtime broker contract
- `packages/cli/src/desktop-server.ts` - keep CLI runtime config generation compatible with the shared broker path
- `packages/runtime/src/index.ts` - export the new WSL distro bridge helpers
- `packages/runtime/src/wsl-runtime-entry.ts` - align WSL runtime entry behavior with bridge-level startup metadata if needed

**No changes in this plan:**

- no UI redesign
- no provider integration rewrite
- no WSL browse UX change
- no release channel or publishing redesign beyond runtime/bridge management

---

### Task 1: Add Distro-Scoped Runtime And Node Store Primitives

**Files:**
- Create: `packages/server/src/runtime/wsl-distro-store.ts`
- Create: `packages/server/src/runtime/wsl-node-store.ts`
- Create: `packages/server/src/__tests__/runtime/wsl-distro-store.test.ts`
- Create: `packages/server/src/__tests__/runtime/wsl-node-store.test.ts`

- [ ] **Step 1: Write the failing layout tests**

Create `packages/server/src/__tests__/runtime/wsl-distro-store.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { resolveWslDistroRuntimeStoreLayout } from "../../runtime/wsl-distro-store.js";

describe("wsl distro store", () => {
  it("uses one runtime store per distro home directory", () => {
    expect(
      resolveWslDistroRuntimeStoreLayout("/home/me").runtimeCurrentPointerPath
    ).toBe("/home/me/.coder-studio/runtime-store/current.json");
  });

  it("stores distro-local bridge state under run", () => {
    expect(resolveWslDistroRuntimeStoreLayout("/home/me").bridgeRunDir).toBe(
      "/home/me/.coder-studio/run"
    );
  });
});
```

Create `packages/server/src/__tests__/runtime/wsl-node-store.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { resolveManagedWslNodePath, isCompatibleManagedNodeVersion } from "../../runtime/wsl-node-store.js";

describe("wsl node store", () => {
  it("places managed node under the distro-local node root", () => {
    expect(resolveManagedWslNodePath("/home/me", "20.11.1")).toBe(
      "/home/me/.coder-studio/node/20.11.1/bin/node"
    );
  });

  it("accepts a node version that satisfies the required semver range", () => {
    expect(isCompatibleManagedNodeVersion("20.11.1", ">=20 <21")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-distro-store.test.ts src/__tests__/runtime/wsl-node-store.test.ts
```

Expected: fail because the new modules do not exist yet.

- [ ] **Step 3: Add the store and compatibility helpers**

Implement `wsl-distro-store.ts` and `wsl-node-store.ts` with exact path helpers for:

- distro runtime store root
- distro current runtime pointer
- distro runtime versions directory
- distro managed Node root
- distro managed Node binary path
- distro bridge run-state directory
- semver-based Node compatibility check

- [ ] **Step 4: Re-run the focused tests**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-distro-store.test.ts src/__tests__/runtime/wsl-node-store.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/runtime/wsl-distro-store.ts packages/server/src/runtime/wsl-node-store.ts packages/server/src/__tests__/runtime/wsl-distro-store.test.ts packages/server/src/__tests__/runtime/wsl-node-store.test.ts
git commit -m "feat: add wsl distro store primitives"
```

### Task 2: Define The Distro Bridge RPC Contract

**Files:**
- Create: `packages/server/src/runtime/wsl-bridge-contract.ts`
- Modify: `packages/server/src/runtime/remote/protocol.ts`
- Modify: `packages/server/src/runtime/contract.ts`
- Create: `packages/server/src/__tests__/runtime/wsl-bridge-contract.test.ts`

- [ ] **Step 1: Write the failing contract test**

Create `packages/server/src/__tests__/runtime/wsl-bridge-contract.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { isWslBridgeInfo, isWslBridgeReady } from "../../runtime/wsl-bridge-contract.js";

describe("wsl bridge contract", () => {
  it("recognizes a bridge info payload with runtime and node version", () => {
    expect(
      isWslBridgeInfo({
        runtimeVersion: "0.5.6",
        nodeVersion: "20.11.1",
        distro: "Ubuntu-24.04",
        pid: 123,
        uptimeMs: 10,
        activeWorkspaceIds: ["ws-1"],
      })
    ).toBe(true);
  });

  it("recognizes a bridge ready payload", () => {
    expect(isWslBridgeReady({ type: "wslBridge.ready", host: "127.0.0.1", port: 4174 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-bridge-contract.test.ts
```

Expected: fail because the contract helpers do not exist yet.

- [ ] **Step 3: Add the bridge contract types**

Define distro-bridge payloads for:

- `health`
- `runtime.info`
- `workspace.attach`
- `workspace.dispose`
- `execute`
- `drain`
- `stop`
- `wslBridge.ready`

Update the existing remote protocol and runtime summary types so the host can distinguish bridge-scoped WSL runtimes from the old workspace-scoped model.

- [ ] **Step 4: Re-run the focused test**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-bridge-contract.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/runtime/wsl-bridge-contract.ts packages/server/src/runtime/remote/protocol.ts packages/server/src/runtime/contract.ts packages/server/src/__tests__/runtime/wsl-bridge-contract.test.ts
git commit -m "feat: define wsl bridge rpc contract"
```

### Task 3: Build The Host Broker For Per-Distro Bridge Lifecycle

**Files:**
- Create: `packages/server/src/runtime/wsl-bridge-manager.ts`
- Modify: `packages/server/src/host/runtime-orchestrator.ts`
- Modify: `packages/server/src/server.ts`
- Create: `packages/server/src/__tests__/runtime/wsl-bridge-manager.test.ts`

- [ ] **Step 1: Write lifecycle tests first**

Create `packages/server/src/__tests__/runtime/wsl-bridge-manager.test.ts` with tests for:

```ts
import { describe, expect, it, vi } from "vitest";
import { createWslBridgeManager } from "../../runtime/wsl-bridge-manager.js";

describe("wsl bridge manager", () => {
  it("reuses one bridge per distro", async () => {
    const createBridge = vi.fn(async () => ({ id: "bridge:Ubuntu-24.04" }));
    const manager = createWslBridgeManager({ createBridge });

    const first = await manager.ensureBridgeForDistro("Ubuntu-24.04");
    const second = await manager.ensureBridgeForDistro("Ubuntu-24.04");

    expect(first).toBe(second);
    expect(createBridge).toHaveBeenCalledTimes(1);
  });

  it("stops a running bridge when the host runtime version changes", async () => {
    const stop = vi.fn(async () => {});
    const createBridge = vi.fn(async () => ({ id: "bridge:Ubuntu-24.04", stop, runtimeVersion: "0.5.5" }));
    const manager = createWslBridgeManager({ createBridge, getHostRuntimeVersion: () => "0.5.6" });

    await manager.ensureBridgeForDistro("Ubuntu-24.04");
    await manager.reconcileOnHostRuntimeUpdate();

    expect(stop).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-bridge-manager.test.ts
```

Expected: fail because the manager module does not exist yet.

- [ ] **Step 3: Implement the broker manager**

Add lifecycle management for:

- one bridge instance per distro
- runtime version equality checks
- managed Node readiness checks
- bridge stop/restart on host runtime update
- host exit shutdown of all tracked bridges

Keep the manager host-side. Do not move policy into the bridge itself.

- [ ] **Step 4: Re-run the focused test**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-bridge-manager.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/runtime/wsl-bridge-manager.ts packages/server/src/host/runtime-orchestrator.ts packages/server/src/server.ts packages/server/src/__tests__/runtime/wsl-bridge-manager.test.ts
git commit -m "feat: add wsl bridge lifecycle broker"
```

### Task 4: Convert WSL Runtime Startup To Use The Broker

**Files:**
- Modify: `packages/server/src/runtime/wsl-bootstrap.ts`
- Modify: `packages/server/src/runtime/wsl-runtime.ts`
- Modify: `packages/server/src/runtime/runtime-state.ts`
- Modify: `packages/server/src/runtime/remote/protocol.ts`
- Modify: `packages/server/src/runtime/contract.ts`
- Modify: `packages/server/src/server.ts`
- Create: `packages/server/src/__tests__/runtime/wsl-runtime-broker.test.ts`

- [ ] **Step 1: Write the failing broker-startup test**

Create `packages/server/src/__tests__/runtime/wsl-runtime-broker.test.ts` that asserts:

- the broker is asked for a distro bridge before a WSL workspace is served
- multiple workspaces in the same distro share the same bridge id
- the bridge startup path rejects a runtime version mismatch

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-runtime-broker.test.ts
```

Expected: fail because the broker-backed startup path is not wired yet.

- [ ] **Step 3: Wire the runtime startup through the broker**

Refactor the WSL runtime creation path so that:

- the runtime handle is keyed by distro bridge id, not workspace id
- the host asks the broker to ensure/install/start the bridge
- `workspace.attach` happens against the bridge
- `execute` flows through the bridge RPC

Preserve existing runtime command semantics for workspace operations while changing the transport and lifecycle ownership.

- [ ] **Step 4: Re-run the focused test**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-runtime-broker.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/runtime/wsl-bootstrap.ts packages/server/src/runtime/wsl-runtime.ts packages/server/src/runtime/runtime-state.ts packages/server/src/runtime/remote/protocol.ts packages/server/src/runtime/contract.ts packages/server/src/server.ts packages/server/src/__tests__/runtime/wsl-runtime-broker.test.ts
git commit -m "feat: route wsl runtime through distro bridge"
```

### Task 5: Align Desktop And CLI Startup With The Shared Broker

**Files:**
- Modify: `packages/desktop/src/desktop-startup.ts`
- Modify: `packages/desktop/src/desktop-update-bridge.ts`
- Modify: `packages/cli/src/server-runner.ts`
- Modify: `packages/cli/src/desktop-server.ts`
- Modify: `packages/runtime/src/index.ts`
- Create: `packages/desktop/src/__tests__/desktop-wsl-broker.test.ts`
- Create: `packages/cli/src/__tests__/wsl-broker-entry.test.ts`

- [ ] **Step 1: Write entrypoint tests**

Add tests that prove desktop and CLI both resolve through the same broker-facing runtime contract instead of their own WSL-specific lifecycle logic.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/__tests__/desktop-wsl-broker.test.ts
pnpm --filter @coder-studio/cli exec vitest run src/__tests__/wsl-broker-entry.test.ts
```

Expected: fail until the shared broker wiring exists.

- [ ] **Step 3: Move desktop and CLI onto the shared path**

Update desktop and CLI startup so they:

- share the same WSL runtime selection and validation flow
- use the same broker-managed version checks
- no longer diverge in WSL lifecycle handling

- [ ] **Step 4: Re-run the focused tests**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/__tests__/desktop-wsl-broker.test.ts
pnpm --filter @coder-studio/cli exec vitest run src/__tests__/wsl-broker-entry.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/desktop-startup.ts packages/desktop/src/desktop-update-bridge.ts packages/cli/src/server-runner.ts packages/cli/src/desktop-server.ts packages/runtime/src/index.ts packages/desktop/src/__tests__/desktop-wsl-broker.test.ts packages/cli/src/__tests__/wsl-broker-entry.test.ts
git commit -m "feat: unify desktop and cli wsl broker startup"
```

### Task 6: Add Diagnostics, Cleanup, And End-To-End Verification

**Files:**
- Modify: `packages/server/src/commands/diagnostics.ts`
- Modify: `packages/server/src/commands/workspace.ts`
- Modify: `packages/server/src/server.ts`
- Create: `packages/server/src/__tests__/runtime/wsl-distro-diagnostics.test.ts`
- Create: `packages/server/src/__tests__/runtime/wsl-bridge-e2e.test.ts`

- [ ] **Step 1: Write diagnostics tests**

Add tests that verify diagnostics report:

- distro runtime version
- managed Node version
- bridge pid and health
- workspace ids attached to a distro bridge

- [ ] **Step 2: Run the diagnostics test and verify it fails**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-distro-diagnostics.test.ts
```

Expected: fail until diagnostics expose bridge-level state.

- [ ] **Step 3: Implement the diagnostics and cleanup paths**

Surface bridge/runtime/node state in diagnostics and make host shutdown cleanly stop all tracked distro bridges.

- [ ] **Step 4: Run the end-to-end runtime verification tests**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-distro-diagnostics.test.ts src/__tests__/runtime/wsl-bridge-e2e.test.ts
pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-bridge-manager.test.ts src/__tests__/runtime/wsl-runtime-broker.test.ts
pnpm --filter @coder-studio/desktop exec vitest run src/__tests__/desktop-wsl-broker.test.ts
pnpm --filter @coder-studio/cli exec vitest run src/__tests__/wsl-broker-entry.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/commands/diagnostics.ts packages/server/src/commands/workspace.ts packages/server/src/server.ts packages/server/src/__tests__/runtime/wsl-distro-diagnostics.test.ts packages/server/src/__tests__/runtime/wsl-bridge-e2e.test.ts
git commit -m "feat: finalize wsl distro bridge runtime lifecycle"
```

## Coverage Check

This plan covers the spec requirements as follows:

- per-distro bridge daemon: Tasks 3 and 4
- shared desktop/CLI architecture: Task 5
- strict runtime version equality: Tasks 1, 3, and 4
- managed per-distro Node: Tasks 1 and 3
- host-managed install/stop/update/health: Tasks 1, 3, 4, and 6
- RPC-based host/WSL communication: Tasks 2 and 4
- stop all bridges on host exit: Tasks 3 and 6

## Self-Review Notes

- No placeholder text remains.
- Every task has exact file paths and concrete verification commands.
- The plan is scoped to a single architecture change, not multiple independent projects.

