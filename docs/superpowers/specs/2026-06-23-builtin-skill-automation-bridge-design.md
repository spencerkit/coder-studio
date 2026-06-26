# Built-in Skill Automation Bridge Design

> Status: Draft for user review
> Date: 2026-06-23
> Scope: `packages/server`, `packages/cli`, builtin skill assets, tests

## Problem

Coder Studio's built-in automation skills currently describe user-facing CLI commands such as:

```bash
coder-studio memory add ...
```

That contract is too weak for agent automation.

In the current dev and Windows workflow, the failure mode is not that the backend command is missing. The real failure is that the agent process can resolve a different `coder-studio` binary than the developer expects:

- the user terminal may hit a local dev shim
- the agent session may hit a global install
- PATH injection is not a strong enough contract for mounted skills
- shell-specific entry syntax (`$env:...`, `"$VAR"`, `%VAR%`) leaks compatibility concerns into the skill itself

This creates three product problems:

1. built-in skills are versioned separately from the real automation entry they need
2. skill docs rely on PATH/global command discovery
3. Windows/dev behavior can drift from the workspace runtime the session actually belongs to

The user wants a more stable agent-facing contract:

- the skill should ship its own stable Node entry
- that entry should read session/runtime context from environment
- the skill should not call `coder-studio` directly
- the skill should not require PATH or shell-specific environment expansion

## Goals

- Keep the existing backend command bus and websocket automation transport.
- Remove PATH and global `coder-studio` resolution from the built-in skill contract.
- Make the skill-facing command shell-stable by invoking `node <absolute-skill-cmd-path> ...`.
- Version the skill instructions and the skill launcher together.
- Bind provider-specific mounted paths at skill mount time.
- Bind runtime session context at session creation time.
- Allow all Coder Studio built-in automation skills to share the same launcher implementation.

## Non-Goals

- Do not add a new public human-facing CLI command such as `coder-studio-automation`.
- Do not move automation to MCP for this phase.
- Do not replace the current websocket command bus with a REST-only transport.
- Do not teach third-party or arbitrary local skills to use this launcher automatically.
- Do not redesign the full skill management system beyond what is needed for built-in automation skills.

## Current Context

Relevant current behavior:

- Built-in skills currently materialize only `SKILL.md`.
- Built-in skill definitions do not support extra files.
- Skill mount currently symlinks or copies the canonical skill directory into the provider's mounted skill directory.
- Agent sessions already inject:
  - `CODER_STUDIO_SESSION_TOKEN`
  - `CODER_STUDIO_API_URL`
  - `CODER_STUDIO_WORKSPACE_ID`
  - session/provider metadata
- The existing CLI already maps automation commands to backend websocket ops such as `memory.create`.

Relevant files:

- `packages/server/src/skills/builtin/definitions/types.ts`
- `packages/server/src/skills/builtin/materialize.ts`
- `packages/server/src/skills/mount-manager.ts`
- `packages/server/src/session/manager.ts`
- `packages/cli/src/automation-command-client.ts`
- `packages/server/src/skills/builtin/definitions/coder-studio-memory.ts`
- `packages/server/src/skills/builtin/definitions/coder-studio-canvas.ts`
- `packages/server/src/skills/builtin/definitions/coder-studio-open.ts`

## User Decisions Captured

- Do not keep a second public command name just for human use.
- The agent-facing contract should not depend on PATH.
- The most stable skill contract is a mounted `cmd.mjs` shipped with the skill.
- All Coder Studio built-in automation skills can use the same `cmd.mjs` content.
- The mount step should generate the final skill-facing command path for the current provider/environment.
- Session startup should inject runtime context such as API URL, workspace id, and session token.
- The launcher should be a thin bridge, not a second independent automation stack.

## Approaches Considered

### Option A: Keep using `coder-studio ...`

Pros:

- Minimal immediate code change

Cons:

- still depends on PATH/global resolution
- still reproduces the Windows/dev mismatch
- skill and runtime entry stay version-decoupled

Decision: reject.

### Option B: Expose a session env entry directly in the skill

Example:

```bash
"$CODER_STUDIO_AUTOMATION_ENTRY" memory create ...
```

Pros:

- removes PATH dependency
- reuses one real automation entry

Cons:

- pushes shell syntax differences into `SKILL.md`
- still leaves PowerShell / POSIX / cmd.exe compatibility as a skill concern
- makes the skill contract less portable to different providers

Decision: reject as the skill-facing contract.

### Option C: Mount-rendered `cmd.mjs` bridge inside the skill, with session-injected runtime context

Pros:

- skill-facing command becomes stable and shell-simple
- `SKILL.md` and `cmd.mjs` version together
- mounted absolute path can be rendered for the actual provider target directory
- runtime context stays in env, not in the skill files
- the same bridge file can be reused by memory, canvas, and open skills

Cons:

- requires built-in skill materialization to support extra files
- requires mount-time rendering instead of a pure symlink/copy flow for these skills

Decision: accept.

## Final Design

## 1. Contract Split

The final contract is intentionally split into two phases:

### Mount-time contract

At mount time, Coder Studio determines the provider's real mounted skill directory and writes a provider-specific `SKILL.md` that references the mounted launch script by absolute path.

This solves the path problem.

### Session-time contract

At session startup, Coder Studio injects runtime context into the agent process environment.

This solves the runtime binding problem.

The skill files must never embed secrets or session-specific tokens.

## 2. Skill-Facing Command Shape

Built-in automation skills will stop documenting `coder-studio ...` commands.

They will instead document commands in this shape:

```bash
node "<absolute-mounted-skill-path>/cmd.mjs" memory.create --type issue --content "..." --status not_started --json
```

Properties of this contract:

- no PATH lookup
- no `npx`
- no global install requirement
- no shell-specific env expansion syntax in the skill itself
- `node` remains the only required executable

The initial phase should use backend-op-aligned names such as:

- `memory.list`
- `memory.search`
- `memory.get`
- `memory.create`
- `memory.update`
- `memory.delete`
- `canvas.list`
- `canvas.create`
- `canvas.update`
- `canvas.render`
- `ui.open-file`
- `ui.open-url`
- `ui.open-canvas`

Friendly aliases may be added later, but they are not required for this phase.

## 3. Built-in Skill Packaging Model

Extend built-in skill definitions so they can materialize more than `SKILL.md`.

The built-in model should support:

- primary instruction content
- additional managed files

Recommended definition shape:

- keep `content` as the canonical library `SKILL.md`
- add a managed-files field such as `files[]` with relative path plus file content

For built-in automation skills, each canonical skill directory should contain at least:

- `SKILL.md`
- `cmd.mjs`

`cmd.mjs` content should be identical across Coder Studio's built-in automation skills.

This bridge is not a per-skill implementation file. It is a shared launcher that ships with each built-in automation skill so the skill remains self-contained when mounted.

Recommended source-of-truth structure:

- one shared runner template in the repository
- built-in definitions reference that template when materializing

This avoids hand-maintaining duplicate launcher code in multiple definition files.

## 4. Mount-Time Rendering

The mounted skill directory must be treated as the place where final skill-facing instructions are rendered.

This is required because the final command path is provider-specific:

- Codex may mount to `~/.agents/skills/...`
- Claude may mount to `~/.claude/skills/...`
- other providers may use different mounted skill roots

The absolute path embedded in `SKILL.md` must therefore be derived from:

```ts
join(mountRelation.targetPath, "cmd.mjs")
```

Not from:

- the workspace root
- the skill source path
- a PATH command name

### Rendering behavior

For built-in automation skills:

1. resolve the real provider target path
2. mount using `copy`, not `symlink`
3. ensure the target directory exists
4. copy managed files, including `cmd.mjs`, into the target directory
5. rewrite mounted `SKILL.md` using the final absolute `cmd.mjs` path
6. mark the mount as managed and synced

The canonical library copy may keep generic command text, but the mounted `SKILL.md` must be target-specific output.

This means built-in automation skills should not rely on a pure symlink mount. Their final mounted `SKILL.md` is target-specific output.

Other non-automation skills can keep the current symlink/copy behavior.

No new mount-mode enum is required for this phase. Existing `mountModeResolved: "copy"` is sufficient for rendered automation mounts.

## 5. Session-Time Environment Contract

Session startup continues to inject runtime context.

Required runtime env:

- `CODER_STUDIO_SESSION_TOKEN`
- `CODER_STUDIO_API_URL`
- `CODER_STUDIO_WORKSPACE_ID`

Built-in automation sessions should also inject an internal launcher path, but it is not part of the skill-facing shell contract:

- `CODER_STUDIO_AUTOMATION_ENTRY`

`CODER_STUDIO_AUTOMATION_ENTRY` must be an absolute filesystem path resolved by the server for the current runtime:

- in dev, it can point at the repo source or dev-built entry
- in packaged/runtime builds, it can point at the shipped dist entry
- skills never need to know which one they received

This internal env points to the real automation launcher that already resolves dev vs prod and any required repo/dist path differences.

The important boundary is:

- `SKILL.md` does not use `CODER_STUDIO_AUTOMATION_ENTRY` directly
- `cmd.mjs` may use it internally

## 6. `cmd.mjs` Responsibilities

`cmd.mjs` is a thin launcher with shared behavior across built-in automation skills.

It must:

- read required runtime env
- fail clearly if the required env is missing
- require `CODER_STUDIO_AUTOMATION_ENTRY` for built-in automation sessions
- delegate to the real automation backend entry by invoking `process.execPath` with the resolved entry path and the original argv payload
- forward stdout/stderr and exit code
- avoid any fallback to PATH-based `coder-studio`

It must not:

- guess the current server from PM2/runtime config
- call a global `coder-studio` command
- require shell-specific setup in `SKILL.md`
- parse backend-specific schemas itself

## 7. Internal Automation Backend Entry

The skill bridge is not the real automation client.

The real execution path remains an internal Coder Studio automation entry that reuses the existing websocket command infrastructure.

Recommended internal layering:

1. `SKILL.md` invokes mounted `cmd.mjs`
2. `cmd.mjs` reads runtime env and delegates
3. the delegated entry parses dotted op syntax such as `memory.create` and reuses the existing automation websocket client
4. backend continues to receive the same `memory.create`, `canvas.create`, and related ops

This preserves the existing transport and permission model.

No new public CLI name is required.

The delegated entry must operate in session-scoped mode only:

- it uses injected `CODER_STUDIO_API_URL`
- it uses injected `CODER_STUDIO_SESSION_TOKEN`
- it must not fall back to managed-server discovery, global status files, or PATH resolution

This keeps agent automation bound to the exact workspace session that mounted the skill.

## 8. Built-in Skill Content Changes

The following built-in skills should be migrated in this phase:

- `coder-studio-memory`
- `coder-studio-canvas`
- `coder-studio-open`

Required content changes:

- remove `coder-studio ...` command examples
- remove PATH-based fallback guidance
- remove shell-specific env-expansion examples as the primary contract
- switch to `node "<absolute-cmd-path>/cmd.mjs" ...`
- align command examples with current backend operation names

For memory specifically:

- stop teaching `memory add`
- teach `memory.create`
- keep source attribution explicit in examples, for example `--skill coder-studio-memory`, rather than adding skill-specific logic into the shared launcher

## 9. Failure Behavior

The mounted bridge should fail fast and clearly in these cases:

- `node` is unavailable
- `CODER_STUDIO_SESSION_TOKEN` is missing
- `CODER_STUDIO_API_URL` is missing
- `CODER_STUDIO_WORKSPACE_ID` is missing
- `CODER_STUDIO_AUTOMATION_ENTRY` is missing
- the delegated internal automation entry is unavailable

Example error direction:

`Coder Studio automation is not available in this session. Missing CODER_STUDIO_API_URL or session token.`

The bridge must not silently fall back to:

- `coder-studio`
- `npx coder-studio`
- local server discovery

## 10. Testing

Add coverage for:

- built-in skill definitions can materialize extra files
- built-in automation skills include `cmd.mjs`
- mount renders `SKILL.md` with the final provider target path
- rendered `SKILL.md` references `join(targetPath, "cmd.mjs")`
- session env includes required runtime context
- `cmd.mjs` fails clearly when runtime env is missing
- `cmd.mjs` delegates to the internal automation entry and preserves exit status
- Windows dev sessions no longer depend on resolving a global `coder-studio` binary
- built-in memory skill content no longer references `memory add`
- rendered automation mounts are recorded as `copy`

## Risks

- Mount-rendered skills cannot use a pure symlink flow, which increases mount implementation complexity.
- Absolute paths embedded in `SKILL.md` become stale if a mounted target moves without a re-sync.
- The bridge depends on `node` being present in the agent environment.
- If session secrets leak into mounted skill files, the design fails its security boundary.
- Dotted op syntax is less human-friendly than the public CLI shape, but that is acceptable because this contract is for mounted agent automation, not end users.

## Phase-One Decisions

- Built-in automation mounts use existing `mountModeResolved: "copy"`; no new mount enum is added.
- Phase one supports dotted op syntax only, such as `memory.create` and `ui.open-file`.
- The shared `cmd.mjs` stays transport-only; it does not inject skill-specific memory metadata automatically.
