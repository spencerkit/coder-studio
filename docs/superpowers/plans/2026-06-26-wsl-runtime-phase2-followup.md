# WSL Runtime Phase 2 Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the runtime-facing preconditions for Windows opening WSL workspaces, then add a first `WslRuntimeHandle` over stdio JSON-RPC without reworking the Phase 1 extraction again.

**Architecture:** Keep the Phase 1 split exactly as shipped: host stays the only browser-facing control plane, `native-default` remains the in-process runtime, and runtime-owned state stays behind `RuntimeHandle`. Phase 2 is split into two layers. First, make runtime selection explicit end-to-end and remove the remaining host-local assumptions around routing, auth, assets, watchers, preview, and diagnostics. Second, add a per-workspace WSL runtime process launched by the Windows host and connected over stdio JSON-RPC.

**Tech Stack:** TypeScript, Fastify, WebSocket command dispatch, Vitest, existing host/runtime registries in `packages/server`, React web UI in `packages/web`, Windows `wsl.exe`.

**Depends on:** `docs/superpowers/plans/2026-06-21-runtime-extraction-and-wsl-architecture.md`, `docs/superpowers/plans/2026-06-21-runtime-extraction-phase1-implementation.md`, `docs/superpowers/plans/2026-06-24-terminal-profiles.md`, `docs/superpowers/specs/2026-06-24-terminal-profiles-design.md`

**Phase 1 baseline assumed complete:**
- Runtime-owned state already lives under `state/runtimes/<runtimeId>`.
- `dispatch.ts` already routes runtime commands through `RuntimeRouter`.
- `skills` remain runtime-owned and must stay that way.
- `memory` remains host-owned.
- `6.24` terminal profiles are complete, but they only solve terminal profile selection, not workspace runtime selection or WSL transport.

---

## Scope Decisions

- Canonical WSL workspace identity is `(targetRuntime="wsl", wslDistro, path=<linux-absolute-path>)`.
- Do not persist `\\wsl$` UNC paths or Windows-mounted paths as the source of truth for WSL workspaces.
- Keep `native-default` as the only shared native runtime.
- First shipped WSL runtime id format is `wsl:<workspaceId>`, not per-distro pooling.
- `workspace.browse` remains host-native. WSL workspace open uses explicit distro selection plus manual path entry in v1. A remote WSL directory browser is a later follow-up.
- Host callback traffic still goes through the host server. There is no browser-to-WSL direct connection and no WSL-hosted HTTP server.

## File Structure

**Create:**
- `packages/server/src/workspace/wsl-discovery.ts` — list WSL distros and probe distro availability.
- `packages/server/src/workspace/wsl-paths.ts` — canonicalize WSL paths and convert optional Windows/UNC inputs into Linux paths.
- `packages/server/src/runtime/wsl-runtime.ts` — `WslRuntimeHandle` lifecycle and process orchestration.
- `packages/server/src/runtime/wsl-bootstrap.ts` — host-side bootstrap contract and environment setup for the WSL runtime child process.
- `packages/server/src/runtime/remote/protocol.ts` — JSON-RPC payload types and error normalization shared by host and WSL runtime entrypoint.
- `packages/server/src/runtime/remote/stdio-json-rpc.ts` — stdio transport client used by `WslRuntimeHandle`.
- `packages/server/src/__tests__/workspace/wsl-discovery.test.ts`
- `packages/server/src/__tests__/workspace/wsl-paths.test.ts`
- `packages/server/src/__tests__/runtime/wsl-runtime.test.ts`
- `packages/server/src/__tests__/routes/runtime-asset-proxy.test.ts`

**Modify:**
- `packages/server/src/commands/workspace.ts`
- `packages/server/src/workspace/manager.ts`
- `packages/server/src/workspace/validator.ts`
- `packages/server/src/workspace/runtime-check.ts`
- `packages/server/src/host/runtime-registry.ts`
- `packages/server/src/host/runtime-router.ts`
- `packages/server/src/host/workspace-runtime-binding.ts`
- `packages/server/src/runtime/contract.ts`
- `packages/server/src/server.ts`
- `packages/server/src/auth/plugin.ts`
- `packages/server/src/auth/session-token-repo.ts`
- `packages/server/src/session/manager.ts`
- `packages/server/src/routes/file-asset.ts`
- `packages/server/src/routes/skill-file-asset.ts`
- `packages/server/src/routes/preview.ts`
- `packages/server/src/fs/watcher.ts`
- `packages/server/src/git/auto-fetch.ts`
- `packages/server/src/commands/provider.ts`
- `packages/server/src/commands/system-deps.ts`
- `packages/server/src/commands/settings.ts`
- `packages/server/src/commands/lsp.ts`
- `packages/server/src/commands/skills/*.ts`
- `packages/server/src/commands/agent-instructions.ts`
- `packages/server/src/commands/session-review.ts`
- `packages/server/src/commands/work-analysis.ts`
- `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`
- `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`
- `packages/web/src/features/workspace/actions/use-worktree-management-actions.ts`
- `packages/web/src/features/diagnostics/page.tsx`
- related server/web tests covering workspace launch, diagnostics, auth, routes, and runtime routing

## Recommended Delivery Order

1. Open-path/runtime metadata plumbing.
2. Runtime id and binding model.
3. Runtime-global command de-defaulting.
4. WSL-capable callback URL and auth mode.
5. Runtime-backed host HTTP/file/watcher assumptions.
6. WSL runtime bootstrap and stdio RPC transport.

The order matters. Steps 1-5 remove the remaining architecture traps that would otherwise get encoded into the first remote runtime implementation.

---

### Task 1: Thread Explicit Runtime Selection Through Workspace Open

**Files:**
- Modify: `packages/server/src/commands/workspace.ts`
- Modify: `packages/server/src/workspace/manager.ts`
- Modify: `packages/server/src/workspace/validator.ts`
- Modify: `packages/server/src/workspace/runtime-check.ts`
- Create: `packages/server/src/workspace/wsl-discovery.ts`
- Create: `packages/server/src/workspace/wsl-paths.ts`
- Modify: `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`
- Modify: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`
- Modify: `packages/web/src/features/workspace/actions/use-worktree-management-actions.ts`
- Modify: `packages/web/src/features/diagnostics/page.tsx`
- Test: `packages/server/src/__tests__/workspace/manager.test.ts`
- Test: `packages/server/src/__tests__/workspace-commands.test.ts`
- Test: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`
- Test: `packages/web/src/features/diagnostics/index.test.tsx`

- [ ] Extend `workspace.open` to accept `{ path, targetRuntime, wslDistro? }` instead of hardcoding `"native"`.
- [ ] Add a host-side WSL discovery helper that uses `wsl.exe -l -q` and normalizes distro names once.
- [ ] Canonicalize WSL workspace paths before persistence. Inputs such as `/home/me/app`, `\\wsl$\\Ubuntu\\home\\me\\app`, or Windows-mounted drive paths must collapse to one Linux absolute path inside the selected distro.
- [ ] Keep `Workspace.path` runtime-native. For WSL that means a Linux path, not a Windows mirror path.
- [ ] Split validation semantics:
  - native workspace open still validates with host `stat/access`
  - WSL workspace open only validates host prerequisites on the host side (`wsl.exe`, distro existence, path string format)
  - actual directory existence/readability moves to the WSL runtime bootstrap handshake
- [ ] Update worktree-open flows to inherit the current workspace runtime metadata instead of defaulting back to native.
- [ ] Update the workspace-launch and diagnostics UI on Windows:
  - runtime selector: `Native Windows` or `WSL`
  - when `WSL` is selected, require distro selection and manual path entry
  - keep the current host directory browser only for native mode
- [ ] Re-run runtime readiness checks with explicit `targetRuntime` and `wslDistro` instead of assuming native.

**Verification:**
- `pnpm --filter @coder-studio/server exec vitest run src/__tests__/workspace/manager.test.ts src/__tests__/workspace-commands.test.ts`
- `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/workspace-launch-modal.test.tsx src/features/diagnostics/index.test.tsx`

### Task 2: Make Runtime Identity Truly Per Workspace For WSL

**Files:**
- Modify: `packages/server/src/host/runtime-registry.ts`
- Modify: `packages/server/src/host/runtime-router.ts`
- Modify: `packages/server/src/host/workspace-runtime-binding.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/runtime/contract.ts`
- Test: `packages/server/src/__tests__/runtime-router.test.ts`
- Test: `packages/server/src/__tests__/workspace-runtime-binding.test.ts`

- [ ] Keep `native-default` unchanged for native workspaces.
- [ ] Introduce per-workspace WSL runtime ids using `wsl:<workspaceId>`.
- [ ] Move runtime creation/binding behind a single host orchestration path:
  - `workspace.open` decides runtime kind from metadata
  - host creates or reuses `native-default` for native
  - host creates a fresh `WslRuntimeHandle` for each WSL workspace
  - host binds `workspaceId -> runtimeId` before any runtime-owned hydration runs
- [ ] Keep `WorkspaceRepo` free of runtime ids. Product metadata remains `targetRuntime` and `wslDistro`; runtime ids stay in the host runtime registry/binding store.
- [ ] Update startup rehydration in `server.ts` so persisted WSL workspaces rebuild their `wsl:<workspaceId>` runtime handles on boot instead of binding everything to `native-default`.
- [ ] Expand `RuntimeHandle` metadata so host code can distinguish `kind`, `id`, and optional runtime summary without peeking into implementation internals.

**Verification:**
- `pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime-router.test.ts src/__tests__/workspace-runtime-binding.test.ts src/__tests__/dispatch.test.ts`

### Task 3: Remove Mixed-Mode Ambiguity From Runtime-Global Commands

**Files:**
- Modify: `packages/server/src/commands/provider.ts`
- Modify: `packages/server/src/commands/system-deps.ts`
- Modify: `packages/server/src/commands/settings.ts`
- Modify: `packages/server/src/commands/lsp.ts`
- Modify: `packages/server/src/commands/skills/*.ts`
- Modify: `packages/server/src/commands/agent-instructions.ts`
- Modify: `packages/server/src/commands/session-review.ts`
- Modify: `packages/server/src/commands/work-analysis.ts`
- Modify: `packages/server/src/ws/dispatch.ts`
- Test: `packages/server/src/__tests__/dispatch.test.ts`
- Test: `packages/server/src/__tests__/skills/commands.test.ts`
- Test: `packages/server/src/__tests__/provider-runtime/runtime-status.test.ts`
- Test: `packages/server/src/__tests__/system-deps/commands.test.ts`

- [ ] Audit every remaining runtime-owned `registerCommand(...)` call and either:
  - migrate it to `registerRuntimeCommand(...)`, or
  - keep it host-owned but make it fan out to one or more runtimes explicitly.
- [ ] Remove reliance on `RuntimeRouteTarget { kind: "default" }` for user-facing runtime operations in mixed mode.
- [ ] Specific command-family decisions:
  - `provider.runtimeStatus`, `provider.install.*`, `systemDeps.*`, `skills.*`, runtime-backed provider config helpers, runtime-backed analysis commands, and runtime-backed agent-instructions helpers must accept a `workspaceId` or `runtimeId`.
  - `lsp.setMode` should become host-owned settings plus per-runtime fan-out, not a default-runtime write.
  - job polling APIs such as `lsp.install.get`, `provider.install.get`, and `systemDeps.install.get` must carry enough routing data to find the owning runtime after the start call.
- [ ] Update the web client to pass active workspace identity for runtime-owned panels instead of implicitly relying on `native-default`.
- [ ] Keep `default` target support only for truly singleton native compatibility paths that are not reachable from WSL workspaces.

**Verification:**
- `pnpm --filter @coder-studio/server exec vitest run src/__tests__/dispatch.test.ts src/__tests__/skills/commands.test.ts src/__tests__/provider-runtime/runtime-status.test.ts src/__tests__/system-deps/commands.test.ts src/__tests__/agent-instructions-command.test.ts`

### Task 4: Add WSL-Capable Host Callback Addressing And Remote-Runtime Auth

**Files:**
- Modify: `packages/server/src/auth/plugin.ts`
- Modify: `packages/server/src/auth/session-token-repo.ts`
- Modify: `packages/server/src/session/manager.ts`
- Modify: `packages/server/src/runtime/contract.ts`
- Modify: `packages/server/src/server.ts`
- Create: `packages/server/src/runtime/wsl-bootstrap.ts`
- Test: `packages/server/src/auth/plugin.test.ts`
- Test: `packages/server/src/__tests__/activation-commands.test.ts`
- Test: `packages/server/src/__tests__/session-commands.test.ts`

- [ ] Replace the current bearer-token loopback-only assumption for runtime callbacks.
- [ ] Introduce explicit token modes in the session token repo:
  - `loopback_runtime` for in-process/native callbacks
  - `remote_runtime` for WSL callbacks
- [ ] Tighten `remote_runtime` tokens instead of trusting IP alone:
  - short TTL
  - session-scoped permissions only
  - runtime id recorded on issuance
  - revoked on session close and runtime stop
- [ ] Accept non-loopback bearer-auth `/ws` requests only when:
  - the token mode is `remote_runtime`
  - the token is valid for the requested runtime/session
  - the source IP is still local-machine private space (`127.0.0.1`, `::1`, RFC1918, or link-local), not arbitrary public traffic
- [ ] Replace `getHostApiUrl()` with a resolver that can advertise a WSL-reachable host address.
- [ ] Preferred callback resolution order:
  - explicit config/env override
  - if host is already bound to a non-loopback address, reuse it
  - otherwise resolve a distro-specific reachable Windows host IP by probing the distro through `wsl.exe` before runtime launch
- [ ] Keep the CLI callback contract unchanged: runtime still injects `CODER_STUDIO_SESSION_TOKEN` and `CODER_STUDIO_API_URL`; only the token mode and host URL source change.

**Verification:**
- `pnpm --filter @coder-studio/server exec vitest run src/auth/plugin.test.ts src/__tests__/activation-commands.test.ts src/__tests__/session-commands.test.ts`

### Task 5: Remove Remaining Host-Local Filesystem Assumptions

**Files:**
- Modify: `packages/server/src/routes/file-asset.ts`
- Modify: `packages/server/src/routes/skill-file-asset.ts`
- Modify: `packages/server/src/routes/preview.ts`
- Modify: `packages/server/src/workspace/manager.ts`
- Modify: `packages/server/src/fs/watcher.ts`
- Modify: `packages/server/src/git/auto-fetch.ts`
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/src/routes/file-asset.test.ts`
- Test: `packages/server/src/routes/skill-file-asset.test.ts`
- Test: `packages/server/src/__tests__/workspace/manager.test.ts`

- [ ] Convert `/api/file` from direct host filesystem reads into a runtime-backed asset proxy for WSL workspaces.
- [ ] Convert `/api/skill-file` from direct `SkillLibraryRepo.libraryPath` reads into a runtime-backed asset proxy for WSL runtimes. Runtime remains the source of truth for skill files.
- [ ] Convert preview resource loading to runtime-backed reads for WSL workspaces. `PreviewSessionStore` can remain host-owned, but actual workspace resource bytes cannot assume host-local access.
- [ ] Keep uploads host-owned for now, but document and enforce that any later write-into-workspace flow must cross the runtime boundary for WSL workspaces.
- [ ] Stop starting host chokidar watchers for WSL workspaces. WSL runtimes must emit the same `workspaceFsDirty`, `workspaceGitState`, and agent-instruction dirty events back through the host bridge.
- [ ] Remove the process-global dispatch assumption from auto-fetch. Schedule on the host if needed, but execute fetches through runtime routing tied to the workspace binding.

**Verification:**
- `pnpm --filter @coder-studio/server exec vitest run src/routes/file-asset.test.ts src/routes/skill-file-asset.test.ts src/__tests__/workspace/manager.test.ts src/__tests__/git-commands.test.ts`

### Task 6: Add The First WSL Runtime Over Stdio JSON-RPC

**Files:**
- Create: `packages/server/src/runtime/wsl-runtime.ts`
- Create: `packages/server/src/runtime/wsl-bootstrap.ts`
- Create: `packages/server/src/runtime/remote/protocol.ts`
- Create: `packages/server/src/runtime/remote/stdio-json-rpc.ts`
- Modify: `packages/server/src/runtime/assembly.ts`
- Modify: `packages/server/src/runtime/context.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/commands/index.ts`
- Test: `packages/server/src/__tests__/runtime/wsl-runtime.test.ts`
- Test: `packages/server/src/__tests__/server-runtime-config.test.ts`

- [ ] Launch the WSL runtime as a child process via `wsl.exe -d <distro> ...`.
- [ ] Bootstrap a runtime state root inside the distro instead of reusing Windows `state/runtimes/...`.
- [ ] Reuse the extracted runtime assembly inside the WSL process so session, terminal, git, provider installs, skills, LSP, supervisor, and work analysis remain runtime-owned there too.
- [ ] Implement a thin stdio JSON-RPC transport:
  - host sends `execute`, `disposeWorkspace`, `health`, `stop`
  - remote side sends command results plus domain/topic events that the host projects back into `EventBus` and `WsHub`
- [ ] Fail WSL workspace open early when the bootstrap handshake cannot validate:
  - distro missing
  - runtime entrypoint missing
  - callback URL unreachable
  - workspace path invalid inside the distro
- [ ] Preserve native behavior and test parity. `native-default` must keep using the existing in-process runtime path.

**Verification:**
- `pnpm --filter @coder-studio/server exec vitest run src/__tests__/runtime/wsl-runtime.test.ts src/__tests__/runtime/native-runtime.test.ts src/__tests__/server-runtime-config.test.ts src/__tests__/session-commands.test.ts`

---

## Risks And Mitigations

- `workspace.path` dual-format drift.
  Mitigation: canonicalize to Linux absolute paths before persistence and never persist UNC mirrors as the source of truth.
- Runtime-global job polling still tied to `default`.
  Mitigation: require `workspaceId` or `runtimeId` in every runtime-owned start/get pair before enabling WSL workspaces in UI.
- Remote callback auth becoming too permissive.
  Mitigation: explicit token mode, runtime binding, TTL, revocation, and private-address restrictions.
- WSL asset routes silently falling back to host paths.
  Mitigation: add explicit WSL route tests that fail if host-local reads are attempted.
- Watcher/event parity drift between native and WSL.
  Mitigation: assert topic-level compatibility (`workspaceFsDirty`, `workspaceGitState`, agent-instruction dirties) instead of asserting implementation details.

## Exit Criteria

Phase 2 is ready to ship when all of the following are true:

1. A Windows user can choose `WSL`, choose a distro, enter a Linux path, and open the workspace successfully.
2. The persisted workspace record stores `targetRuntime="wsl"` and the selected `wslDistro`, while runtime binding uses `wsl:<workspaceId>`.
3. Runtime-owned commands no longer rely on `native-default` fallback when invoked from a WSL workspace.
4. Agent callbacks from WSL use a WSL-reachable host URL and pass auth without loopback-only hacks.
5. Image preview, skill asset preview, preview resource loading, watcher dirties, and auto-fetch work for WSL workspaces without host filesystem reads.
6. Native workspaces still pass the existing server/web regression suite.
