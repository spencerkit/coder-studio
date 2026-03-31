# Agent Config Current-Runtime-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `native`/`wsl` agent setting overrides so Claude and Codex always use a single runtime profile bound to the environment where Coder Studio itself is running.

**Architecture:** Keep workspace `ExecTarget` for file/git/terminal behavior, but stop using it as the source of truth for agent settings. Agent settings storage, settings UI, and runtime profile resolution collapse to one profile per provider; agent process launch resolves the workspace path into the current runtime when needed, then starts Claude/Codex from the current runtime only.

**Tech Stack:** Rust backend, React + TypeScript frontend, node:test, cargo test, pnpm build

---

## File Map

### Modify

- `apps/web/src/types/app.ts` — remove Claude/Codex target-override types and the settings scope type.
- `apps/web/src/shared/app/claude-settings.ts` — collapse settings defaults, normalization, patch helpers, and runtime command resolution to one profile per provider.
- `apps/web/src/components/Settings/ClaudeSettingsPanel.tsx` — remove scope switcher / override toggle and bind controls directly to the single Claude profile.
- `apps/web/src/components/Settings/CodexSettingsPanel.tsx` — remove scope switcher / override toggle and bind controls directly to the single Codex profile.
- `apps/web/src/i18n.ts` — remove native/WSL override wording and update Codex/Claude hints to current-runtime wording.
- `tests/claude-settings.test.ts` — replace override-oriented assertions with single-profile behavior and target-agnostic resolution checks.
- `apps/server/src/models.rs` — remove Claude/Codex override payload structs from the persisted settings model.
- `apps/server/src/services/app_settings.rs` — stop hydrating both native and WSL agent homes, simplify patch normalization/replacement paths, and hydrate only the current runtime environment.
- `apps/server/src/services/claude.rs` — make runtime profile resolution target-agnostic and keep launch command generation separate from workspace target handling.
- `apps/server/src/services/codex.rs` — same as Claude for Codex.
- `apps/server/src/services/agent_client.rs` — stop resolving provider profiles from workspace target.
- `apps/server/src/services/agent.rs` — launch agents in the current runtime only, while resolving workspace cwd into that runtime when necessary.
- `apps/server/src/infra/runtime.rs` — add or reuse path resolution needed to launch current-runtime agents against WSL-backed workspaces on Windows.
- `apps/server/src/command/http.rs` — update app-settings RPC tests to the new payload shape.

## Task 1: Lock The Single-Profile Settings Contract With Failing Tests

**Files:**
- Modify: `tests/claude-settings.test.ts`
- Modify: `apps/server/src/services/claude.rs`
- Modify: `apps/server/src/services/codex.rs`
- Modify: `apps/server/src/command/http.rs`

- [ ] **Step 1: Rewrite the frontend/shared settings tests for single-profile behavior**

Add failing coverage for:
- `defaultAppSettings()` returning only one Claude profile and one Codex profile.
- `forceClaudeExecutableDefaults()` only touching `claude.global`.
- `resolveClaudeRuntimeProfile()` returning the same result for `native` and `wsl` targets.
- `patchClaudeStructuredSettings()` and `replaceClaudeAdvancedJson()` updating the single profile directly.

- [ ] **Step 2: Run the frontend/shared tests and confirm failure**

Run:

```bash
node --test tests/claude-settings.test.ts
```

Expected: failures referencing removed override helpers / old payload shape.

- [ ] **Step 3: Rewrite the Rust unit tests and HTTP settings RPC tests for single-profile payloads**

Add failing coverage for:
- `resolve_claude_runtime_profile()` ignoring workspace target.
- `resolve_codex_runtime_profile()` ignoring workspace target.
- `app_settings_get` / `app_settings_update` round-tripping settings without `overrides.native` or `overrides.wsl`.

- [ ] **Step 4: Run the targeted Rust tests and confirm failure**

Run:

```bash
cargo test --manifest-path apps/server/Cargo.toml services::claude::tests:: services::codex::tests:: command::http::tests::app_settings -- --nocapture
```

Expected: failures caused by the old override-oriented structs and expectations.

## Task 2: Collapse Frontend Settings State And UI

**Files:**
- Modify: `apps/web/src/types/app.ts`
- Modify: `apps/web/src/shared/app/claude-settings.ts`
- Modify: `apps/web/src/components/Settings/ClaudeSettingsPanel.tsx`
- Modify: `apps/web/src/components/Settings/CodexSettingsPanel.tsx`
- Modify: `apps/web/src/i18n.ts`
- Test: `tests/claude-settings.test.ts`

- [ ] **Step 1: Remove target-override types and helpers from the shared settings module**

Implement:
- `claude.global` remains the only Claude runtime profile.
- `codex.global` remains the only Codex runtime profile.
- normalization drops any incoming `overrides` branches instead of materializing them.
- patch helpers update the single profile directly and no longer accept a `scope`.
- runtime command resolution no longer depends on `ExecTarget`.

- [ ] **Step 2: Remove scope-switch UI from Claude and Codex settings panels**

Implement:
- delete scope tabs and override toggles.
- bind all inputs to the single profile.
- keep the visible UI otherwise aligned with current Claude/Codex sections.

- [ ] **Step 3: Update settings copy**

Implement:
- remove `global/native/WSL` wording.
- change command preview hints to “current runtime” wording.

- [ ] **Step 4: Run the frontend/shared tests**

Run:

```bash
node --test tests/claude-settings.test.ts
```

Expected: pass.

## Task 3: Make Agent Resolution And Launch Use The Current Runtime Only

**Files:**
- Modify: `apps/server/src/models.rs`
- Modify: `apps/server/src/services/app_settings.rs`
- Modify: `apps/server/src/services/claude.rs`
- Modify: `apps/server/src/services/codex.rs`
- Modify: `apps/server/src/services/agent_client.rs`
- Modify: `apps/server/src/services/agent.rs`
- Modify: `apps/server/src/infra/runtime.rs`
- Modify: `apps/server/src/command/http.rs`

- [ ] **Step 1: Simplify persisted settings structs and patch normalization**

Implement:
- remove Claude/Codex override structs from Rust models.
- remove override-specific replace-path rules and camelCase normalization branches.
- keep `global` as the storage key for the single provider profile to minimize churn.

- [ ] **Step 2: Hydrate only the current runtime environment**

Implement:
- load Claude/Codex home files for the current runtime only.
- stop hydrating a parallel WSL override profile.

- [ ] **Step 3: Launch agents in the current runtime even for WSL workspaces**

Implement:
- resolve provider profiles without workspace target.
- use a current-runtime agent target for command building and escaping.
- convert WSL workspace cwd to a current-runtime path when the host runtime requires it.

- [ ] **Step 4: Keep the failure mode explicit**

Implement:
- if cwd conversion into the current runtime fails, return a clear agent-start error instead of silently falling back to a WSL-specific profile/launch path.

- [ ] **Step 5: Run the targeted Rust tests**

Run:

```bash
cargo test --manifest-path apps/server/Cargo.toml services::app_settings::tests:: services::claude::tests:: services::codex::tests:: command::http::tests::app_settings -- --nocapture
```

Expected: pass.

## Task 4: Verify End-To-End Surface And Prepare Commit

**Files:**
- Modify if needed based on verification fallout.

- [ ] **Step 1: Run the frontend build**

Run:

```bash
pnpm build:web
```

Expected: success.

- [ ] **Step 2: Run the core test sweep touched by this change**

Run:

```bash
node --test tests/claude-settings.test.ts tests/agent-startup-policy.test.ts tests/workspace-empty-snapshot.test.ts
```

```bash
cargo test --manifest-path apps/server/Cargo.toml
```

Expected: success.

- [ ] **Step 3: Summarize compatibility boundaries before commit**

Document in the final response:
- aligned areas: settings storage, settings UI, runtime profile resolution, current-runtime launch.
- non-aligned / degraded area: Windows host + WSL workspace now relies on current-runtime path conversion instead of a dedicated WSL agent configuration path.
