# Codex Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Codex as a first-class provider in `coder-studio`, keeping session creation, startup, resume, history, recovery, and settings behavior aligned with the existing Claude flow wherever the two CLIs allow it.

**Architecture:** Treat `workspace_sessions.provider + workspace_sessions.resume_id` as the only recovery truth, then hide provider-specific CLI differences behind a small backend agent-client adapter boundary. On the frontend, keep the UX session-driven: draft sessions choose a provider, persisted sessions carry their own provider, and restart/resume decisions depend only on whether a `resume_id` exists. Settings stay backend-compatible and expose Claude/Codex as parallel providers with one shared default-provider choice.

**Tech Stack:** Rust, Tauri server RPC/WebSocket transport, SQLite, React 19, TypeScript, Vite

---

## Current In-Flight Baseline

- [x] Backend session model is provider-aware.
- [x] Storage moved from Claude-only `claude_session_id` to generic `resume_id`.
- [x] `agent_start` reads provider from persisted session instead of trusting frontend input.
- [x] Minimal Codex backend support exists for `codex ...` and `codex resume <resume_id>`.
- [x] Frontend draft panes can already choose `Claude` or `Codex`.
- [x] Frontend history/recovery logic already uses `resumeId`.
- [x] Existing compatibility notes started in `docs/development/codex-compatibility.md`.

## Execution Status

- [x] Task 1 completed: backend provider adapter boundary now exists via `services/agent_client.rs`.
- [x] Task 2 completed: provider / resume persistence and recovery semantics stayed generic.
- [x] Task 3 completed: frontend session truth remains `provider + resumeId`, and `tab.agent` is now treated as derived display state.
- [x] Task 4 completed: settings now include a shared default provider plus a dedicated Codex panel with `global / native / wsl` overrides, official structured Codex config fields, and `~/.codex/config.toml` / WSL hydration.
- [x] Task 5 completed: compatibility documentation and verification were updated.

## Target Alignment

- [ ] New session UX matches Claude: create draft, choose provider, submit first prompt, persist session, start agent.
- [ ] Recovery UX matches Claude: if `resume_id` exists, attempt resume; otherwise restart.
- [ ] History UX matches Claude: same list, same actions, provider only shown as metadata.
- [ ] Startup ownership matches Claude: frontend requests start, backend resolves actual command/profile.
- [x] Settings ownership matches Claude: frontend edits structured settings, backend resolves per-target runtime profile.

## Known Non-Goals / Accepted Degradation

- [ ] No auth flow design. Users configure local CLI credentials themselves.
- [ ] No pre-release migration work. Schema reset / non-recoverable old data is acceptable in this dev stage.
- [ ] No slash-command / skills parity for Codex in this phase.
- [ ] Native Windows Codex support can remain degraded if hooks or CLI behavior differ from Claude.

### Task 1: Finish the backend provider adapter boundary

**Files:**
- Modify: `apps/server/src/services/agent.rs`
- Modify: `apps/server/src/services/claude.rs`
- Modify: `apps/server/src/services/codex.rs`
- Modify: `apps/server/src/services/mod.rs`
- Create: `apps/server/src/services/agent_client.rs` (if extraction reduces branching cleanly)
- Test: `apps/server/src/command/http.rs`

- [ ] **Step 1: Define the adapter boundary used by the runtime path**

Keep the shared runtime path responsible only for:

```rust
load_session -> resolve provider client -> build launch request -> spawn PTY -> stream output
```

Provider clients should own only their differences:

```rust
pub(crate) trait AgentClient {
    fn build_launch_command(&self, target: &ExecTarget, resume_id: Option<&str>) -> String;
    fn runtime_env(&self) -> &BTreeMap<String, String>;
    fn ensure_workspace_hooks(&self, cwd: &str, target: &ExecTarget) -> Result<(), String>;
}
```

- [ ] **Step 2: Move provider-specific launch logic behind that boundary**

Claude keeps:

```rust
claude [startup_args...] --resume <resume_id>
```

Codex keeps:

```rust
codex [extra_args...]
codex resume <resume_id> [extra_args...]
```

`agent.rs` should stop branching on command assembly details directly once the adapter exists.

- [ ] **Step 3: Keep backend session truth unchanged**

The runtime entrypoint must continue reading only:

```rust
stored_session.provider
stored_session.resume_id
```

and never reintroduce provider input from RPC payloads.

- [ ] **Step 4: Preserve unified hook env injection**

Shared env stays in one place:

```rust
CODER_STUDIO_APP_BIN
CODER_STUDIO_HOOK_ENDPOINT
CODER_STUDIO_WORKSPACE_ID
CODER_STUDIO_SESSION_ID
```

Provider modules stay responsible for writing their own workspace hook config files.

- [ ] **Step 5: Add or update backend tests**

Cover:

```rust
create_session(..., AgentProvider::Codex, ...)
agent_start() uses persisted provider instead of request payload
resume_id is preserved through lifecycle replay / attach
codex launch command becomes `codex resume <id>` when resume_id exists
```

- [ ] **Step 6: Run backend verification**

Run: `cargo test -- --nocapture`
Expected: PASS

### Task 2: Tighten backend persistence and recovery semantics

**Files:**
- Modify: `apps/server/src/models.rs`
- Modify: `apps/server/src/infra/db.rs`
- Modify: `apps/server/src/services/workspace.rs`
- Modify: `apps/server/src/services/workspace_runtime.rs`
- Modify: `apps/server/src/command/http.rs`

- [ ] **Step 1: Keep provider/resume fields aligned end-to-end**

The following types must match exactly:

```rust
SessionInfo { provider, resume_id/resumeId }
SessionHistoryRecord { provider, resume_id/resumeId }
SessionPatch { resume_id }
```

- [ ] **Step 2: Keep schema rules explicit**

Database contract stays:

```sql
workspace_sessions.provider TEXT NOT NULL
workspace_sessions.resume_id TEXT NULL
UNIQUE(workspace_id, provider, resume_id) WHERE resume_id IS NOT NULL
```

Because the project is still in development, incompatible old schemas can be dropped and recreated instead of migrated.

- [ ] **Step 3: Keep restart/resume semantics generic**

Recovery rule must remain:

```text
resume_id exists -> resume
resume_id missing -> restart
```

No extra invalidation heuristics should be added before attempting resume.

- [ ] **Step 4: Verify workspace attach/bootstrap paths**

Bootstrap and runtime attach should hydrate provider-aware sessions without Claude-only fallback fields.

- [ ] **Step 5: Run focused server tests after cleanup**

Run:

```bash
cargo test workspace:: -- --nocapture
cargo test command::http::tests::agent_start_uses_session_provider_from_storage -- --nocapture
```

Expected: PASS

### Task 3: Finish frontend session-level provider truth and remove unnecessary compatibility state

**Files:**
- Modify: `apps/web/src/state/workbench-core.ts`
- Modify: `apps/web/src/shared/utils/session.ts`
- Modify: `apps/web/src/shared/utils/workspace.ts`
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- Modify: `apps/web/src/features/workspace/session-actions.ts`
- Modify: `apps/web/src/features/workspace/session-history.ts`
- Modify: `apps/web/src/features/workspace/workspace-recovery.ts`
- Modify: `apps/web/src/features/workspace/workspace-sync-hooks.ts`
- Modify: `apps/web/src/features/agents/AgentWorkspaceFeature.tsx`
- Modify: `apps/web/src/components/HistoryDrawer/HistoryDrawer.tsx`

- [ ] **Step 1: Keep provider on every session object**

Frontend session truth should remain:

```ts
type Session = {
  provider: "claude" | "codex";
  resumeId?: string;
}
```

Draft sessions inherit the default provider; persisted sessions always use backend data.

- [ ] **Step 2: Make launch command resolution session-driven**

Where the UI needs a command preview or runtime validation key, use:

```ts
session.provider
```

and only fall back to `appSettings.agentDefaults.provider` when no session exists yet.

- [ ] **Step 3: Stop treating `tab.agent` as truth**

If `tab.agent` must remain for UI shape compatibility, it should become a derived display cache only. Startup, recovery, history, and provider switching should not depend on it as source of truth.

- [ ] **Step 4: Keep recovery logic generic**

Recovery action stays:

```ts
session.resumeId ? "resume" : "restart"
```

No frontend-side prevalidation of resume IDs.

- [ ] **Step 5: Keep history and pane labeling aligned with Claude**

Use the existing Claude UX and add only a small provider label/badge. Do not add Codex-only controls in session panes or history.

- [ ] **Step 6: Run frontend verification**

Run: `pnpm build:web`
Expected: PASS

### Task 4: Align settings IA and Codex configuration handling

**Files:**
- Modify: `apps/web/src/types/app.ts`
- Modify: `apps/web/src/shared/app/claude-settings.ts`
- Modify: `apps/web/src/components/Settings/Settings.tsx`
- Modify: `apps/web/src/components/Settings/index.ts`
- Modify: `apps/web/src/features/settings/SettingsScreen.tsx`
- Modify: `apps/web/src/i18n.ts`
- Create: `apps/web/src/components/Settings/CodexSettingsPanel.tsx`

- [ ] **Step 1: Add one shared default-provider control**

General settings should expose:

```ts
agentDefaults.provider: "claude" | "codex"
```

This default is used only when creating a new draft session or when a workspace has no persisted session truth yet.

- [ ] **Step 2: Expose Codex settings as a parallel provider panel**

The settings nav should present separate provider panels rather than overloading Claude-only labels. Minimum Codex fields for this phase:

```ts
codex.global.executable
codex.global.extraArgs
codex.global.env
codex.overrides.native
codex.overrides.wsl
```

The panel layout should mirror Claude's scope structure where possible: `global / native / wsl`.

- [ ] **Step 3: Reuse shared settings helpers**

`claude-settings.ts` should become the shared agent settings utility module even if the filename stays unchanged for now. Put normalization, cloning, formatting, and override helpers for both providers there instead of duplicating logic inside components.

- [ ] **Step 4: Match backend payload shape**

Frontend payload must serialize exactly:

```ts
{
  general,
  agentDefaults,
  claude,
  codex,
}
```

No frontend-only launch semantics should be sent during `agent_start`.

- [ ] **Step 5: Document unaligned Codex options explicitly**

If Codex CLI options do not map cleanly onto Claude's current `Launch / Config / Advanced` structure, keep the UI minimal and record the gap in the compatibility doc instead of inventing fake parity.

- [ ] **Step 6: Re-run frontend build**

Run: `pnpm build:web`
Expected: PASS

### Task 5: Update compatibility documentation and verify final behavior

**Files:**
- Modify: `docs/development/codex-compatibility.md`
- Modify: `docs/plans/2026-03-30-codex-support.md` (checkbox status only)

- [ ] **Step 1: Split the compatibility doc into three sections**

Document:

```md
## 已对齐
## 无法完全对齐 / 接受降级
## 后续可收敛方向
```

- [ ] **Step 2: Record concrete incompatibilities**

At minimum call out:

```md
- Codex hooks dependency
- Native Windows degradation
- Slash/skills parity deferred
- Any settings surface intentionally left smaller than Claude
```

- [ ] **Step 3: Run final verification**

Run:

```bash
(cd apps/server && cargo test -- --nocapture)
pnpm build:web
```

Expected: both PASS

- [ ] **Step 4: Manual smoke-check list**

Verify these flows locally after build success:

```text
1. Create draft session and switch provider between Claude / Codex
2. Submit first prompt and confirm persisted session keeps selected provider
3. Start/restart the same session and confirm backend uses stored provider
4. Inject a resume_id through hook replay and confirm recovery action becomes resume
5. Open session history and confirm provider badge renders without changing actions
```

## Execution Order

- [ ] Task 1
- [ ] Task 2
- [ ] Task 3
- [ ] Task 4
- [ ] Task 5

## Risks To Watch While Executing

- [ ] `tab.agent` may still be read by UI code that was originally Claude-only.
- [ ] `claude-settings.ts` now acts like a shared agent-settings module; careless edits can break legacy settings hydration.
- [ ] Codex hook payload shape may differ from Claude hook payload shape; resume extraction must stay tolerant.
- [ ] Provider-aware runtime validation must not regress Claude startup for existing dev environments.
